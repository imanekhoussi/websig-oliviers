"""
Gestion des missions (CRUD).
Chaque mission = un dossier data/missions/{mission_id}/ avec :
  - trees.shp (+.shx .dbf .prj)
  - metadata.json (date, nom, notes, météo)
  - [plus tard] rgb.tif, thermal.tif, chm.tif
"""
import json
import shutil
import zipfile
from pathlib import Path
from datetime import datetime
from typing import Optional

from config import BASE_DIR

MISSIONS_DIR = BASE_DIR / "data" / "missions"
MISSIONS_DIR.mkdir(parents=True, exist_ok=True)

REQUIRED_EXTS = {".shp", ".shx", ".dbf", ".prj"}


def _mission_dir(mission_id: str) -> Path:
    """Retourne le chemin du dossier d'une mission."""
    # Sécurité : pas de traversal
    if "/" in mission_id or "\\" in mission_id or ".." in mission_id:
        raise ValueError("ID de mission invalide")
    return MISSIONS_DIR / mission_id


def list_missions() -> list[dict]:
    """Liste toutes les missions, triées par date décroissante."""
    missions = []
    for d in MISSIONS_DIR.iterdir():
        if not d.is_dir():
            continue
        meta_file = d / "metadata.json"
        if not meta_file.exists():
            continue
        
        # --- NOUVEAU BLOC TRY / EXCEPT ---
        try:
            with open(meta_file, encoding="utf-8") as f:
                meta = json.load(f)
            meta["id"] = d.name
            meta["has_shapefile"] = (d / "trees.shp").exists() or (d / "trees.gpkg").exists()
            missions.append(meta)
        except json.JSONDecodeError:
            # Si le fichier est vide ou corrompu, on l'ignore sans faire crasher l'API
            print(f"⚠️ Fichier ignoré car corrompu : {meta_file}")
            continue 
            
    missions.sort(key=lambda m: m.get("date", ""), reverse=True)
    return missions
def get_mission(mission_id: str) -> Optional[dict]:
    """Retourne les métadonnées d'une mission."""
    d = _mission_dir(mission_id)
    meta_file = d / "metadata.json"
    if not meta_file.exists():
        return None
        
    # --- NOUVEAU BLOC TRY / EXCEPT ---
    try:
        with open(meta_file, encoding="utf-8") as f:
            meta = json.load(f)
    except json.JSONDecodeError:
        return None  # Retourne None si le fichier est corrompu

    meta["id"] = mission_id
    meta["has_shapefile"] = (d / "trees.shp").exists() or (d / "trees.gpkg").exists()
    return meta

def create_mission(date: str, nom: str = "", notes: str = "",
                   temp_air: Optional[float] = None,
                   humidite: Optional[float] = None,
                   vent: Optional[float] = None) -> dict:
    """Crée une nouvelle mission. ID = date (ISO) + suffixe si conflit."""
    # Validation date
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise ValueError("La date doit être au format YYYY-MM-DD")

    # ID basé sur la date, ajoute suffixe si déjà existant
    base_id = date
    mission_id = base_id
    counter = 2
    while _mission_dir(mission_id).exists():
        mission_id = f"{base_id}-{counter}"
        counter += 1

    d = _mission_dir(mission_id)
    d.mkdir(parents=True)

    meta = {
        "date": date,
        "nom": nom or f"Mission {date}",
        "notes": notes,
        "meteo": {
            "temp_air": temp_air,
            "humidite": humidite,
            "vent": vent,
        },
        "has_thermal_zip": False,
        "has_thermal_tif": False,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    }
    with open(d / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    meta["id"] = mission_id
    meta["has_shapefile"] = False
    return meta


def delete_mission(mission_id: str) -> bool:
    """Supprime une mission et tous ses fichiers (data + uploads)."""
    d = _mission_dir(mission_id)
    print(f"[delete_mission] Tentative de suppression : {d}")

    if not d.exists():
        print(f"[delete_mission] Dossier introuvable, rien à faire.")
        return False

    # ── 1. Dossier principal de la mission (data/missions/{id}) ──────────────
    try:
        shutil.rmtree(d)
        print(f"[delete_mission] ✓ Dossier mission supprimé : {d}")
    except Exception as e:
        print(f"[delete_mission] ❌ Échec rmtree({d}) : {e}")
        raise RuntimeError(
            f"Impossible de supprimer le dossier mission. "
            f"Un fichier est peut-être ouvert dans un autre programme (WinError 32). "
            f"Détail : {e}"
        )

    # ── 2. Dossier d'images associé (uploads/{id}) ───────────────────────────
    uploads_dir = BASE_DIR / "uploads" / mission_id
    if uploads_dir.exists():
        try:
            shutil.rmtree(uploads_dir)
            print(f"[delete_mission] ✓ Dossier uploads supprimé : {uploads_dir}")
        except Exception as e:
            # Non bloquant : les données de la mission sont déjà supprimées
            print(f"[delete_mission] ⚠️ Impossible de supprimer uploads ({uploads_dir}) : {e}")

    # ── 3. Vide le cache RAM ─────────────────────────────────────────────────
    from data_loader import _load_raw_trees
    _load_raw_trees.cache_clear()
    print(f"[delete_mission] ✓ Cache vidé pour '{mission_id}'.")
    return True


def update_ortho_status(
    mission_id: str, ortho_type: str, fmt: str, value: bool
) -> None:
    """Met à jour ortho_status.{ortho_type}.has_{fmt} dans metadata.json.

    fmt doit être "tif" ou "zip".
    Maintient aussi ortho_formats pour la rétrocompatibilité (URL tuiles).
    """
    d = _mission_dir(mission_id)
    meta_file = d / "metadata.json"
    if not meta_file.exists():
        return
    try:
        with open(meta_file, encoding="utf-8") as f:
            meta = json.load(f)
    except json.JSONDecodeError:
        return

    # ── ortho_status ────────────────────────────────────────────────────────
    status     = meta.get("ortho_status", {})
    type_state = status.get(ortho_type, {"has_tif": False, "has_zip": False})
    type_state[f"has_{fmt}"] = value
    status[ortho_type]       = type_state
    meta["ortho_status"]     = status

    # ── ortho_formats (rétrocompat) ──────────────────────────────────────────
    # ZIP prioritaire pour l'affichage (tuiles = plus rapide) ; TIF sinon
    fmts = meta.get("ortho_formats", {})
    if type_state.get("has_zip"):
        fmts[ortho_type] = "zip"
    elif type_state.get("has_tif"):
        fmts[ortho_type] = "tif"
    else:
        fmts.pop(ortho_type, None)
    meta["ortho_formats"] = fmts

    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def delete_ortho(mission_id: str, ortho_type: str, fmt: str) -> bool:
    """Supprime les fichiers d'un format d'orthomosaïque (tif ou zip) et met à jour metadata."""
    meta = get_mission(mission_id)
    if meta is None:
        return False

    d = _mission_dir(mission_id)

    if fmt == "tif":
        tif_path = BASE_DIR / "uploads" / mission_id / f"{ortho_type}.tif"
        if tif_path.exists():
            tif_path.unlink()

    elif fmt == "zip":
        if ortho_type == "thermal":
            # Nouveau chemin : data/missions/{id}/thermal/
            # Fallback legacy : data/missions/{id}/thermal_tiles/
            for tiles_dir in (d / "thermal", d / "thermal_tiles"):
                if tiles_dir.exists():
                    shutil.rmtree(tiles_dir)
                    break
        else:
            tiles_dir = d / f"{ortho_type}_tiles"
            if tiles_dir.exists():
                shutil.rmtree(tiles_dir)

    # Mise à jour metadata : drapeaux plats pour thermal, ortho_status pour RGB
    if ortho_type == "thermal":
        set_thermal_flag(mission_id, f"has_thermal_{fmt}", False)
    else:
        update_ortho_status(mission_id, ortho_type, fmt, False)
    return True


def set_ortho_format(mission_id: str, ortho_type: str, fmt: str) -> None:
    """Enregistre le format d'orthomosaïque (zip|tif) dans metadata.json."""
    d = _mission_dir(mission_id)
    meta_file = d / "metadata.json"
    if not meta_file.exists():
        return
    try:
        with open(meta_file, encoding="utf-8") as f:
            meta = json.load(f)
    except json.JSONDecodeError:
        return
    ortho_formats = meta.get("ortho_formats", {})
    ortho_formats[ortho_type] = fmt
    meta["ortho_formats"] = ortho_formats
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def set_thermal_flag(mission_id: str, key: str, value: bool) -> None:
    """Met à jour has_thermal_zip ou has_thermal_tif dans metadata.json.

    Les deux drapeaux sont indépendants : mettre has_thermal_tif=True ne
    touche pas à has_thermal_zip, et vice-versa.
    """
    if key not in ("has_thermal_zip", "has_thermal_tif"):
        raise ValueError(f"Clé invalide : {key!r}")
    d = _mission_dir(mission_id)
    meta_file = d / "metadata.json"
    if not meta_file.exists():
        return
    try:
        with open(meta_file, encoding="utf-8") as f:
            meta = json.load(f)
    except json.JSONDecodeError:
        return
    meta[key] = value
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"[missions_manager] ✓ {key}={value} pour '{mission_id}'.")


def save_cwsi_calibration(mission_id: str, calibration: dict) -> None:
    """Persiste les paramètres de calibration CWSI dans metadata.json (clé cwsi_calibration)."""
    d = _mission_dir(mission_id)
    meta_file = d / "metadata.json"
    if not meta_file.exists():
        return
    try:
        with open(meta_file, encoding="utf-8") as f:
            meta = json.load(f)
    except json.JSONDecodeError:
        return
    meta["cwsi_calibration"] = calibration
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"[missions_manager] ✓ cwsi_calibration enregistrée pour '{mission_id}'.")


def save_cwsi_results(mission_id: str, results: dict) -> None:
    """Persiste les résultats du calcul CWSI dans metadata.json (clé cwsi_results)."""
    d = _mission_dir(mission_id)
    meta_file = d / "metadata.json"
    if not meta_file.exists():
        return
    try:
        with open(meta_file, encoding="utf-8") as f:
            meta = json.load(f)
    except json.JSONDecodeError:
        return
    meta["cwsi_results"] = results
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"[missions_manager] ✓ cwsi_results enregistrés pour '{mission_id}'.")


def update_mission_metadata(mission_id: str, updates: dict) -> Optional[dict]:
    """Met à jour les métadonnées d'une mission."""
    meta = get_mission(mission_id)
    if meta is None:
        return None

    # Champs modifiables
    for key in ("nom", "notes"):
        if key in updates:
            meta[key] = updates[key]
    if "meteo" in updates and isinstance(updates["meteo"], dict):
        meta["meteo"] = {**meta.get("meteo", {}), **updates["meteo"]}
    if "cwsi_thresholds" in updates:
        if updates["cwsi_thresholds"] is None:
            meta.pop("cwsi_thresholds", None)
        elif isinstance(updates["cwsi_thresholds"], dict):
            meta["cwsi_thresholds"] = updates["cwsi_thresholds"]

    # Retire les champs calculés avant sauvegarde
    to_save = {k: v for k, v in meta.items() if k not in ("id", "has_shapefile")}
    d = _mission_dir(mission_id)
    with open(d / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(to_save, f, ensure_ascii=False, indent=2)
    return meta


def upload_shapefile(mission_id: str, files: list) -> dict:
    """
    Upload du shapefile pour une mission.
    `files` = liste de UploadFile (FastAPI).
    Accepte soit un .zip soit les 4 fichiers séparés.
    """
    d = _mission_dir(mission_id)
    if not d.exists():
        raise FileNotFoundError(f"Mission {mission_id} inexistante")

    # Nettoie les anciens fichiers shapefile
    for f in d.glob("trees.*"):
        if f.suffix.lower() in {".shp", ".shx", ".dbf", ".prj", ".cpg", ".qmd"}:
            f.unlink()

    # Cas 1 : Fichier GeoPackage (.gpkg) ---
    gpkg_file = next((f for f in files if f.filename.lower().endswith(".gpkg")), None)
    if gpkg_file:
        target = d / "trees.gpkg"
        with open(target, "wb") as f:
            shutil.copyfileobj(gpkg_file.file, f)

        from data_loader import _load_raw_trees
        _load_raw_trees.cache_clear()

        # Met à jour metadata.json
        meta = get_mission(mission_id)
        meta["has_shapefile"] = True
        return meta

    # --- Cas 2 : zip
    if len(files) == 1 and files[0].filename.lower().endswith(".zip"):
        zip_path = d / "_upload.zip"
        with open(zip_path, "wb") as f:
            shutil.copyfileobj(files[0].file, f)
        try:
            extracted = set()
            with zipfile.ZipFile(zip_path, "r") as z:
                for name in z.namelist():
                    ext = Path(name).suffix.lower()
                    if ext in REQUIRED_EXTS | {".cpg"}:
                        target = d / f"trees{ext}"
                        with z.open(name) as src, open(target, "wb") as dst:
                            shutil.copyfileobj(src, dst)
                        extracted.add(ext)
        finally:
            zip_path.unlink(missing_ok=True)
        missing = REQUIRED_EXTS - extracted
        if missing:
            raise ValueError(f"Fichiers manquants dans le zip : {missing}")

    # Cas 2 : fichiers séparés
    else:
        received = set()
        for file in files:
            ext = Path(file.filename).suffix.lower()
            if ext not in REQUIRED_EXTS | {".cpg"}:
                continue
            target = d / f"trees{ext}"
            with open(target, "wb") as f:
                shutil.copyfileobj(file.file, f)
            received.add(ext)
        missing = REQUIRED_EXTS - received
        if missing:
            missing_str = ", ".join(sorted(missing))
            raise ValueError(
                f"Fichiers manquants : {missing_str}. "
                "Un Shapefile nécessite obligatoirement les 4 fichiers : .shp .shx .dbf .prj. "
                "Conseil : compressez-les en un seul .zip ou utilisez un fichier .gpkg (GeoPackage)."
            )

    from data_loader import _load_raw_trees, load_trees
    _load_raw_trees.cache_clear()

    # ── Validation spatiale : s'assure que geopandas peut réellement lire le fichier
    try:
        load_trees(mission_id)
    except Exception as exc:
        # Fichier illisible → on nettoie ce qu'on vient de sauvegarder
        print(f"[upload] ❌ Validation spatiale échouée pour '{mission_id}': {exc}")
        for bad in d.glob("trees.*"):
            bad.unlink(missing_ok=True)
        _load_raw_trees.cache_clear()
        raise ValueError(str(exc))

    return get_mission(mission_id)
