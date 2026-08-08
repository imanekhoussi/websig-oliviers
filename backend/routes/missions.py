"""
Endpoints de gestion des missions.
"""
import io
import os
import shutil
import zipfile
from collections import Counter
from datetime import date as _date
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File, Body, Query
from fastapi.responses import Response
from typing import List, Optional
from pydantic import BaseModel, field_validator
import numpy as np
import pandas as pd
from fpdf import FPDF

import missions_manager as mm
import geoprocessing
import rendement_predictor
from data_loader import load_trees
from config import STRESS_COLORS

router = APIRouter(prefix="/api/missions", tags=["missions"])


class CWSIPayload(BaseModel):
    method: str = "empirical"
    force_recalc: bool = True  # True par défaut : le bouton UI recalcule toujours

    @field_validator("method")
    @classmethod
    def _check_method(cls, v: str) -> str:
        if v not in geoprocessing.SUPPORTED_METHODS:
            raise ValueError(
                f"Méthode '{v}' inconnue. "
                f"Valeurs acceptées : {', '.join(geoprocessing.SUPPORTED_METHODS)}"
            )
        return v


def _bg_compute_cwsi(mission_id: str) -> None:
    """Tâche de fond déclenchée après upload.

    Essaie 'empirical' si temp_air est renseigné, sinon replie sur 'bian_2019'.
    Les erreurs sont loguées sans faire crasher le serveur.
    """
    meta     = mm.get_mission(mission_id)
    temp_air = (meta or {}).get("meteo", {}).get("temp_air")
    method   = "empirical" if temp_air is not None else "bian_2019"

    try:
        result = geoprocessing.compute_mission_cwsi(
            mission_id, method=method, force_recalc=False
        )
        print(
            f"[bg_compute] '{mission_id}' [{method}] → {result['status']} "
            f"({result.get('n_updated', 0)}/{result.get('n_trees', 0)} arbres mis à jour)"
        )
    except FileNotFoundError:
        # Fichier encore absent (race condition théorique) — on ignore silencieusement
        pass
    except Exception as exc:
        print(f"[bg_compute] ❌ '{mission_id}' [{method}] — {exc}")


class MissionCreate(BaseModel):
    date: str  # YYYY-MM-DD
    nom: Optional[str] = ""
    notes: Optional[str] = ""
    temp_air: Optional[float] = None
    humidite: Optional[float] = None
    vent: Optional[float] = None


class MissionUpdate(BaseModel):
    nom: Optional[str] = None
    notes: Optional[str] = None
    meteo: Optional[dict] = None
    cwsi_thresholds: Optional[dict] = None


@router.get("")
def list_all():
    return mm.list_missions()


@router.post("")
def create(payload: MissionCreate):
    try:
        return mm.create_mission(**payload.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{mission_id}")
def get_one(mission_id: str):
    m = mm.get_mission(mission_id)
    if m is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable")
    return m


@router.patch("/{mission_id}")
def update(mission_id: str, payload: MissionUpdate):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None or k == "cwsi_thresholds"}
    m = mm.update_mission_metadata(mission_id, updates)
    if m is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable")
    return m


@router.delete("/{mission_id}")
def delete(mission_id: str):
    try:
        ok = mm.delete_mission(mission_id)
    except RuntimeError as e:
        # Dossier verrouillé ou autre erreur disque → message explicite au frontend
        raise HTTPException(500, str(e))
    except Exception as e:
        raise HTTPException(500, f"Erreur inattendue lors de la suppression : {e}")
    if not ok:
        # Déjà supprimé ou introuvable → réponse idempotente (pas de 404)
        return {"status": "ok", "message": "Déjà supprimé"}
    return {"status": "ok", "deleted": mission_id}


@router.post("/{mission_id}/upload")
async def upload(
    mission_id: str,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
):
    try:
        result = mm.upload_shapefile(mission_id, files)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Erreur upload : {e}")

    # Lance le calcul CWSI automatiquement (lit temp_moy depuis le fichier vecteur)
    background_tasks.add_task(_bg_compute_cwsi, mission_id)

    return result


@router.post("/{mission_id}/upload-ortho")
async def upload_ortho(
    mission_id: str,
    ortho_type: str = Query(..., pattern="^(rgb|thermal)$"),
    file: UploadFile = File(...),
):
    m = mm.get_mission(mission_id)
    if m is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable")

    fname = (file.filename or "").lower()

    if not fname.endswith(".zip"):
        raise HTTPException(
            400,
            "Seuls les fichiers .zip (tuiles XYZ pré-générées) sont acceptés. "
            "Le format GeoTIFF n'est plus supporté.",
        )

    # Thermal → data/missions/{id}/thermal/  (Leaflet : /tiles/{id}/thermal/{z}/{x}/{y}.png)
    # RGB     → data/missions/{id}/rgb_tiles/
    if ortho_type == "thermal":
        tiles_dir = Path("data/missions") / mission_id / "thermal"
    else:
        tiles_dir = Path("data/missions") / mission_id / f"{ortho_type}_tiles"

    tiles_dir.mkdir(parents=True, exist_ok=True)
    tmp_zip = tiles_dir.parent / f"_tmp_{ortho_type}.zip"
    print(f"[upload_ortho] ZIP reçu → sauvegarde temporaire : {tmp_zip}")
    try:
        with open(tmp_zip, "wb") as f_out:
            shutil.copyfileobj(file.file, f_out)
        print(f"[upload_ortho] Extraction vers {tiles_dir} …")
        with zipfile.ZipFile(tmp_zip, "r") as z:
            z.extractall(tiles_dir)

        # Aplatissement : si le ZIP contenait un dossier racine intermédiaire,
        # remonte son contenu d'un niveau pour que {z}/{x}/{y}.png fonctionne.
        children = list(tiles_dir.iterdir())
        if len(children) == 1 and children[0].is_dir():
            intermediate = children[0]
            for item in list(intermediate.iterdir()):
                shutil.move(str(item), str(tiles_dir / item.name))
            os.rmdir(intermediate)

        print(f"[upload_ortho] ✓ {ortho_type} extrait dans {tiles_dir}")
    except Exception as e:
        print(f"[upload_ortho] ❌ Erreur ZIP ({ortho_type}) : {e}")
        if tiles_dir.exists():
            shutil.rmtree(tiles_dir, ignore_errors=True)
        raise HTTPException(500, f"Erreur extraction ZIP : {e}")
    finally:
        tmp_zip.unlink(missing_ok=True)

    if ortho_type == "thermal":
        mm.set_thermal_flag(mission_id, "has_thermal_zip", True)
        tile_url = f"/tiles/{mission_id}/thermal/{{z}}/{{x}}/{{y}}.png"
    else:
        mm.set_ortho_format(mission_id, ortho_type, "zip")
        mm.update_ortho_status(mission_id, ortho_type, "zip", True)
        tile_url = f"/tiles/{mission_id}/{ortho_type}_tiles/{{z}}/{{x}}/{{y}}.png"

    return {
        "status": "ok",
        "ortho_type": ortho_type,
        "format": "zip",
        "url": tile_url,
    }


@router.post("/{mission_id}/compute-cwsi")
def compute_cwsi(mission_id: str, payload: CWSIPayload):
    """
    Lance (ou relance) le pipeline de calcul CWSI de façon synchrone.

    Body JSON :
      - method        : "empirical" | "bian_2019"  (défaut : "empirical")
      - force_recalc  : true | false               (défaut : true)

    Pré-requis :
      - POST /upload             → trees.gpkg / trees.shp avec colonne temp_moy
      - PATCH /api/missions/{id} → temp_air renseigné (si method=empirical)

    Retourne T_wet, T_dry et les compteurs d'arbres mis à jour.
    """
    m = mm.get_mission(mission_id)
    if m is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable")

    try:
        result = geoprocessing.compute_mission_cwsi(
            mission_id,
            method=payload.method,
            force_recalc=payload.force_recalc,
        )
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, f"Erreur calcul CWSI : {e}")

    return result


@router.post("/{mission_id}/predict-yield")
def predict_yield(mission_id: str):
    """
    Prédit le rendement (kg/arbre) via rendement_predictor (singleton).
    Features : CWSI, chm_max, chm_mean, surface_couronne, T_mean, T_min, T_max.
    Valeurs manquantes imputées à 0. Répond dans le format historique pour
    compatibilité avec PredictiveAnalysis.jsx.
    """
    if mm.get_mission(mission_id) is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable.")
    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    if gdf.empty:
        raise HTTPException(422, "Aucun arbre dans cette mission.")

    try:
        preds_arr = rendement_predictor.predire_batch(gdf)
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Erreur prédiction : {exc}")

    results = []
    for i, (_, row) in enumerate(gdf.iterrows()):
        geom = row.geometry
        ref  = geom if geom.geom_type == "Point" else geom.centroid
        tid  = row["id"]
        cwsi_val = row.get("cwsi") if hasattr(row, "get") else getattr(row, "cwsi", None)
        try:
            cwsi_rounded = round(float(cwsi_val), 4) if cwsi_val is not None else None
        except (TypeError, ValueError):
            cwsi_rounded = None
        results.append({
            "id":                  int(tid) if not isinstance(tid, str) else tid,
            "lon":                 round(float(ref.x), 6),
            "lat":                 round(float(ref.y), 6),
            "cwsi":                cwsi_rounded,
            "rendement_kg_predit": round(float(preds_arr[i]), 2),
        })

    return {
        "mission_id":  mission_id,
        "n_arbres":    len(results),
        "modele":      rendement_predictor.MODEL_PATH.name,
        "predictions": results,
    }


@router.get("/{mission_id}/rendement")
def get_rendement(mission_id: str):
    """
    Retourne les prédictions de rendement + agrégats pour tous les arbres
    de la mission.

    Réponse :
      {
        "mission_id": "...",
        "predictions": [{"tree_id": ..., "rendement_kg": ...}, ...],
        "aggregats": {
          "rendement_total_kg": ...,
          "rendement_moyen_kg": ...,
          "nb_arbres": ...
        }
      }
    """
    if mm.get_mission(mission_id) is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable.")
    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    if gdf.empty:
        raise HTTPException(422, "Aucun arbre dans cette mission.")

    try:
        preds_arr = rendement_predictor.predire_batch(gdf)
    except FileNotFoundError as exc:
        raise HTTPException(503, str(exc))
    except Exception as exc:
        raise HTTPException(500, f"Erreur prédiction : {exc}")

    predictions = []
    for i, (_, row) in enumerate(gdf.iterrows()):
        tid = row["id"]
        predictions.append({
            "tree_id":     int(tid) if not isinstance(tid, str) else tid,
            "rendement_kg": round(float(preds_arr[i]), 2),
        })

    yields     = [p["rendement_kg"] for p in predictions]
    total      = sum(yields)
    nb         = len(yields)
    moyen      = total / nb if nb else 0.0

    return {
        "mission_id":  mission_id,
        "predictions": predictions,
        "aggregats": {
            "rendement_total_kg": round(total, 2),
            "rendement_moyen_kg": round(moyen, 2),
            "nb_arbres":          nb,
        },
    }


@router.get("/{mission_id}/yield-predictions")
def get_yield_predictions(mission_id: str):
    """GET alias de predict-yield pour les appels multi-missions en parallèle."""
    return predict_yield(mission_id)


@router.delete("/{mission_id}/ortho/{ortho_type}/{fmt}")
def delete_ortho(
    mission_id: str,
    ortho_type: str,
    fmt: str,
):
    if ortho_type not in ("rgb", "thermal"):
        raise HTTPException(400, "ortho_type doit être 'rgb' ou 'thermal'")
    if fmt not in ("tif", "zip"):
        raise HTTPException(400, "fmt doit être 'tif' ou 'zip'")
    ok = mm.delete_ortho(mission_id, ortho_type, fmt)
    if not ok:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable")
    return {"status": "ok", "deleted": ortho_type, "fmt": fmt}


@router.get("/{mission_id}/export")
def export_mission_excel(
    mission_id: str,
    ids: Optional[str] = Query(default=None, description="IDs arbres séparés par virgule (export zonal)"),
):
    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    meta  = mm.get_mission(mission_id) or {}
    meteo = meta.get("meteo") or {}

    # ── Coordonnées ──────────────────────────────────────────────────────────────
    df = gdf.copy()
    if df.geometry.geom_type.eq("Point").all():
        df["lon"] = df.geometry.x.round(6)
        df["lat"] = df.geometry.y.round(6)
    else:
        centroid = df.geometry.centroid
        df["lon"] = centroid.x.round(6)
        df["lat"] = centroid.y.round(6)

    cols = [c for c in ("id", "lon", "lat", "temp_moy", "cwsi", "stress", "hauteur", "circonf") if c in df.columns]
    df_trees = df[cols].copy()

    # ── Filtrage zonal (IDs fournis par le frontend) ──────────────────────────
    if ids:
        try:
            id_list = [int(i) for i in ids.split(",") if i.strip()]
            if id_list and "id" in df_trees.columns:
                df_trees = df_trees[df_trees["id"].isin(id_list)]
        except ValueError:
            pass  # IDs non numériques → on exporte tout

    # ── Statistiques globales du jeu exporté ─────────────────────────────────
    cwsi_mean = None
    if "cwsi" in df_trees.columns:
        clean = df_trees["cwsi"].dropna().astype(float)
        if not clean.empty:
            cwsi_mean = round(float(clean.mean()), 3)

    # ── Feuille 1 : Résumé mission ────────────────────────────────────────────
    summary_rows = [
        ("Date",                     meta.get("date", "")),
        ("Nom de la mission",        meta.get("nom", "")),
        ("Notes",                    meta.get("notes", "") or ""),
        ("Température air (°C)",     meteo.get("temp_air")),
        ("Humidité (%)",             meteo.get("humidite")),
        ("Vent (m/s)",               meteo.get("vent")),
        ("",                         ""),
        ("Nombre d'arbres exportés", len(df_trees)),
        ("CWSI moyen",               cwsi_mean),
    ]
    df_summary = pd.DataFrame(summary_rows, columns=["Indicateur", "Valeur"])

    # ── Feuille 2 : Données arbres (colonnes lisibles) ────────────────────────
    col_labels = {
        "id":      "ID Arbre",
        "lon":     "Longitude",
        "lat":     "Latitude",
        "temp_moy":"Temp. moy. (°C)",
        "cwsi":    "CWSI",
        "stress":  "Niveau de stress",
        "hauteur": "Hauteur (m)",
        "circonf": "Circonférence (cm)",
    }
    df_export = df_trees.rename(columns={k: v for k, v in col_labels.items() if k in df_trees.columns})

    # ── Génération Excel en mémoire ───────────────────────────────────────────
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df_summary.to_excel(writer, sheet_name="Résumé",        index=False)
        df_export.to_excel( writer, sheet_name="Données Arbres", index=False)
    buf.seek(0)

    return Response(
        content=buf.read(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="rapport_mission_{mission_id}.xlsx"'
        },
    )


# ── PDF helpers ──────────────────────────────────────────────────────────────

def _hex_rgb(hex_color: str):
    h = hex_color.lstrip('#')
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _safe(text: str) -> str:
    if not text:
        return ""
    _REPLACEMENTS = {
        "–": "-",    # – en-dash
        "—": "-",    # — em-dash
        "’": "'",    # ' right single quotation mark
        "‘": "'",    # ' left single quotation mark
        "“": '"',    # " left double quotation mark
        "”": '"',    # " right double quotation mark
        "«": '"',    # «
        "»": '"',    # »
        "…": "...",  # … ellipsis
        "×": "x",    # × multiplication
        "°": " deg", # ° degree
    }
    for ch, repl in _REPLACEMENTS.items():
        text = text.replace(ch, repl)
    return text.encode("latin-1", errors="replace").decode("latin-1")


def _build_pdf(mission_id: str, meta: dict, gdf) -> bytes:
    meteo  = meta.get('meteo') or {}
    nom    = meta.get('nom') or mission_id
    date_  = meta.get('date', '')
    notes  = meta.get('notes') or ''

    total    = len(gdf)
    cwsi_s   = gdf['cwsi'].dropna().astype(float)    if 'cwsi'    in gdf.columns else pd.Series(dtype=float)
    temp_s   = gdf['temp_moy'].dropna().astype(float) if 'temp_moy' in gdf.columns else pd.Series(dtype=float)
    s_counts = Counter(gdf['stress']) if 'stress' in gdf.columns else {}

    cwsi_mean = round(float(cwsi_s.mean()), 3) if not cwsi_s.empty else None
    cwsi_min  = round(float(cwsi_s.min()),  3) if not cwsi_s.empty else None
    cwsi_max  = round(float(cwsi_s.max()),  3) if not cwsi_s.empty else None
    temp_mean = round(float(temp_s.mean()), 1) if not temp_s.empty else None

    pdf = FPDF(orientation='P', unit='mm', format='A4')
    pdf.set_margins(10, 10, 10)
    pdf.add_page()
    pdf.set_auto_page_break(auto=True, margin=20)
    W = 190

    # ── Header bar ───────────────────────────────────────────────────────────
    pdf.set_fill_color(*_hex_rgb('#0f172a'))
    pdf.rect(0, 0, 210, 36, 'F')

    pdf.set_font('Helvetica', 'B', 22)
    pdf.set_text_color(*_hex_rgb('#38bdf8'))
    pdf.set_xy(10, 7)
    pdf.cell(80, 10, 'GeoOlive')

    pdf.set_font('Helvetica', '', 10)
    pdf.set_text_color(180, 210, 240)
    pdf.set_xy(10, 21)
    pdf.cell(130, 6, 'Rapport de Surveillance Hydrique des Oliviers')

    pdf.set_font('Helvetica', '', 8)
    pdf.set_text_color(100, 130, 160)
    pdf.set_xy(120, 27)
    pdf.cell(80, 4, f'Genere le {_date.today().strftime("%d/%m/%Y")}', align='R')

    # ── Mission info ─────────────────────────────────────────────────────────
    y = 44
    pdf.set_font('Helvetica', 'B', 14)
    pdf.set_text_color(15, 23, 42)
    pdf.set_xy(10, y); pdf.cell(W, 7, _safe(nom))
    y += 8

    pdf.set_font('Helvetica', '', 9)
    pdf.set_text_color(100, 116, 139)
    pdf.set_xy(10, y)
    pdf.cell(W, 5, f'ID mission : {mission_id}    |    Date : {date_}')
    y += 7

    if notes:
        pdf.set_font('Helvetica', 'I', 9)
        pdf.set_text_color(71, 85, 105)
        pdf.set_xy(10, y)
        pdf.multi_cell(W, 4.5, _safe(notes))
        y = pdf.get_y() + 3
    else:
        y += 2

    # ── Meteo KPIs ───────────────────────────────────────────────────────────
    temp_air = meteo.get('temp_air')
    humidite = meteo.get('humidite')
    vent     = meteo.get('vent')

    if any(v is not None for v in [temp_air, humidite, vent]):
        pdf.set_font('Helvetica', 'B', 10)
        pdf.set_text_color(15, 23, 42)
        pdf.set_xy(10, y); pdf.cell(W, 5, 'Conditions Meteorologiques')
        y += 7

        boxes = [
            ('Temperature Air', f'{temp_air} C'  if temp_air is not None else '-', '#ef4444'),
            ('Humidite',        f'{humidite} %'  if humidite is not None else '-', '#0ea5e9'),
            ('Vent',            f'{vent} m/s'    if vent     is not None else '-', '#f97316'),
        ]
        bw, bh, gap = 57, 17, 7
        for i, (lbl, val, col) in enumerate(boxes):
            bx = 10 + i * (bw + gap)
            pdf.set_fill_color(*_hex_rgb(col))
            pdf.rect(bx, y, 4, bh, 'F')
            pdf.set_fill_color(245, 248, 252)
            pdf.rect(bx + 4, y, bw - 4, bh, 'F')
            pdf.set_font('Helvetica', '', 7)
            pdf.set_text_color(100, 116, 139)
            pdf.set_xy(bx + 6, y + 2); pdf.cell(bw - 8, 4, lbl)
            pdf.set_font('Helvetica', 'B', 12)
            pdf.set_text_color(15, 23, 42)
            pdf.set_xy(bx + 6, y + 7); pdf.cell(bw - 8, 7, val)
        y += bh + 4

        is_chergui = (
            temp_air is not None and vent is not None
            and float(temp_air) > 35 and float(vent) > 4
        )
        if is_chergui:
            pdf.set_fill_color(255, 235, 235)
            pdf.rect(10, y, W, 8, 'F')
            pdf.set_font('Helvetica', 'B', 9)
            pdf.set_text_color(*_hex_rgb('#e74c3c'))
            pdf.set_xy(14, y + 1.5)
            pdf.cell(W - 8, 5, 'ALERTE CHERGUI : Vent chaud et sec detecte (T > 35 C, Vent > 4 m/s)')
            y += 12

    y += 3

    # ── CWSI KPIs row ────────────────────────────────────────────────────────
    pdf.set_font('Helvetica', 'B', 10)
    pdf.set_text_color(15, 23, 42)
    pdf.set_xy(10, y); pdf.cell(W, 5, 'Indicateurs CWSI')
    y += 7

    kpis = [
        ('Total arbres', str(total)),
        ('CWSI moyen',   str(cwsi_mean) if cwsi_mean is not None else 'N/A'),
        ('CWSI min',     str(cwsi_min)  if cwsi_min  is not None else 'N/A'),
        ('CWSI max',     str(cwsi_max)  if cwsi_max  is not None else 'N/A'),
        ('T moy. (C)',   str(temp_mean) if temp_mean is not None else 'N/A'),
    ]
    kw = W / len(kpis)
    kh = 16
    for i, (lbl, val) in enumerate(kpis):
        kx = 10 + i * kw
        pdf.set_fill_color(241, 245, 249)
        pdf.rect(kx, y, kw - 2, kh, 'F')
        pdf.set_font('Helvetica', '', 7)
        pdf.set_text_color(100, 116, 139)
        pdf.set_xy(kx + 2, y + 2); pdf.cell(kw - 4, 4, lbl)
        pdf.set_font('Helvetica', 'B', 11)
        pdf.set_text_color(15, 23, 42)
        pdf.set_xy(kx + 2, y + 8); pdf.cell(kw - 4, 6, val)
    y += kh + 6

    # ── Stress breakdown table ────────────────────────────────────────────────
    pdf.set_font('Helvetica', 'B', 10)
    pdf.set_text_color(15, 23, 42)
    pdf.set_xy(10, y); pdf.cell(W, 5, 'Repartition par Niveau de Stress')
    y += 7

    cols = [50, 28, 28, 46, 38]   # sum = 190
    hdrs = ['Niveau de Stress', 'Arbres', '% Total', 'Seuil CWSI', '']
    pdf.set_fill_color(*_hex_rgb('#0f172a'))
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('Helvetica', 'B', 8)
    cx = 10
    for wc, hdr in zip(cols, hdrs):
        pdf.set_xy(cx, y); pdf.cell(wc, 8, hdr, fill=True)
        cx += wc
    y += 8

    labels_fr = {
        'aucun':  'Aucun stress',
        'faible': 'Stress faible',
        'modere': 'Stress modere',
        'eleve':  'Stress eleve',
        'severe': 'Stress severe',
    }
    thresholds = {
        'aucun':  '< 0.20',
        'faible': '0.20 - 0.35',
        'modere': '0.35 - 0.50',
        'eleve':  '0.50 - 0.75',
        'severe': '>= 0.75',
    }
    for j, classe in enumerate(['aucun', 'faible', 'modere', 'eleve', 'severe']):
        cnt   = s_counts.get(classe, 0)
        pct   = f'{round(100 * cnt / total, 1)} %' if total > 0 else '0 %'
        color = STRESS_COLORS.get(classe, '#95a5a6')

        bg = (248, 250, 252) if j % 2 == 0 else (255, 255, 255)
        pdf.set_fill_color(*bg)
        pdf.rect(10, y, W, 8, 'F')

        r3, g3, b3 = _hex_rgb(color)
        pdf.set_fill_color(r3, g3, b3)
        pdf.rect(10, y, 3, 8, 'F')

        cx = 10
        pdf.set_font('Helvetica', 'B', 8)
        pdf.set_text_color(15, 23, 42)
        pdf.set_xy(cx + 5, y + 1.5); pdf.cell(cols[0] - 5, 5, labels_fr[classe])
        cx += cols[0]

        pdf.set_font('Helvetica', '', 8)
        pdf.set_xy(cx, y + 1.5); pdf.cell(cols[1], 5, str(cnt))
        cx += cols[1]
        pdf.set_xy(cx, y + 1.5); pdf.cell(cols[2], 5, pct)
        cx += cols[2]
        pdf.set_xy(cx, y + 1.5); pdf.cell(cols[3], 5, thresholds[classe])
        cx += cols[3]

        pdf.set_fill_color(r3, g3, b3)
        pdf.rect(cx + 2, y + 1.5, 14, 5, 'F')
        y += 8

    # total row
    pdf.set_fill_color(*_hex_rgb('#0f172a'))
    pdf.set_text_color(255, 255, 255)
    pdf.set_font('Helvetica', 'B', 8)
    pdf.rect(10, y, W, 8, 'F')
    pdf.set_xy(15, y + 1.5); pdf.cell(cols[0] - 5, 5, 'TOTAL')
    pdf.set_xy(10 + cols[0], y + 1.5); pdf.cell(cols[1], 5, str(total))
    pdf.set_xy(10 + cols[0] + cols[1], y + 1.5); pdf.cell(cols[2], 5, '100 %')

    # ── Footer bar ───────────────────────────────────────────────────────────
    pdf.set_fill_color(*_hex_rgb('#0f172a'))
    pdf.rect(0, 282, 210, 15, 'F')
    pdf.set_font('Helvetica', '', 7)
    pdf.set_text_color(100, 116, 139)
    pdf.set_xy(10, 285.5); pdf.cell(95, 4, f'Mission : {mission_id}')
    pdf.set_xy(105, 285.5); pdf.cell(95, 4, 'GeoOlive - Surveillance Hydrique des Oliviers', align='R')

    return bytes(pdf.output())


# ── PDF endpoint ──────────────────────────────────────────────────────────────

@router.get("/{mission_id}/export-pdf")
def export_mission_pdf(mission_id: str):
    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    meta = mm.get_mission(mission_id) or {}

    try:
        pdf_bytes = _build_pdf(mission_id, meta, gdf)
    except Exception as e:
        raise HTTPException(500, f"Erreur generation PDF : {e}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="rapport_mission_{mission_id}.pdf"'
        },
    )
