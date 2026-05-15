"""
Pipeline de calcul automatique du CWSI.

Le CWSI est calculé directement depuis la colonne temp_moy du fichier vecteur
(Shapefile ou GeoPackage). Aucun raster thermique n'est requis.

Deux méthodes disponibles :
  - "empirical"  : T_wet = p10(temp_moy arbres),  T_dry = temp_air + 5 °C
  - "bian_2019"  : T_wet = p0.5(temp_moy arbres), T_dry = p99.5(temp_moy arbres)
"""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np
import pandas as pd
import geopandas as gpd

from missions_manager import _mission_dir, get_mission, save_cwsi_results
from data_loader import _load_raw_trees


SUPPORTED_METHODS: tuple[str, ...] = ("empirical", "bian_2019")
NODATA = -9999.0


def compute_mission_cwsi(
    mission_id: str,
    method: str = "empirical",
    force_recalc: bool = False,
) -> dict:
    """
    Calcule et persiste le CWSI pour chaque arbre d'une mission.

    Lit la colonne temp_moy du fichier vecteur — aucun raster thermique requis.

    Args:
        mission_id:   identifiant de la mission.
        method:       "empirical" (requiert temp_air) ou "bian_2019" (autosuffisant).
        force_recalc: si False et que les CWSI existent déjà, retourne "already_computed".

    Returns:
        dict avec les clés : status, mission_id, method, t_wet, t_dry,
                             n_trees, n_updated, computed_at.

    Raises:
        FileNotFoundError : fichier vecteur absent.
        ValueError        : méthode inconnue, colonne temp_moy manquante,
                            temp_air manquant (empirical), T_dry ≤ T_wet.
    """
    if method not in SUPPORTED_METHODS:
        raise ValueError(
            f"Méthode '{method}' inconnue. "
            f"Valeurs acceptées : {', '.join(SUPPORTED_METHODS)}"
        )

    # ── 1. Localise le fichier vecteur ───────────────────────────────────────
    mission_dir = _mission_dir(mission_id)
    gpkg_path   = mission_dir / "trees.gpkg"
    shp_path    = mission_dir / "trees.shp"

    if gpkg_path.exists():
        vec_path = gpkg_path
    elif shp_path.exists():
        vec_path = shp_path
    else:
        raise FileNotFoundError(
            f"Aucun fichier vecteur (trees.gpkg ou trees.shp) pour '{mission_id}'. "
            "Uploadez-le via POST /upload."
        )

    # ── 2. Charge le GeoDataFrame ────────────────────────────────────────────
    gdf = gpd.read_file(vec_path)

    if gdf.crs is None:
        raise ValueError("Le fichier vecteur n'a pas de CRS défini.")
    if len(gdf) == 0:
        raise ValueError("Le fichier vecteur ne contient aucune géométrie.")

    # Normalise les noms de colonnes (même logique que data_loader)
    gdf.columns = [c.lower() for c in gdf.columns]
    gdf = gdf.rename(columns={
        "temp_mean": "temp_moy",
        "cwsi_mean": "cwsi",
        "chm_mean":  "hauteur",
    })

    # ── 3. Vérifie la présence de temp_moy ───────────────────────────────────
    if "temp_moy" not in gdf.columns:
        raise ValueError(
            "La colonne 'temp_moy' est manquante dans le fichier spatial. "
            "Assurez-vous que votre fichier contient une colonne nommée "
            "'temp_moy' ou 'temp_mean'."
        )

    # ── 4. Vérification idempotence ───────────────────────────────────────────
    if not force_recalc and "cwsi" in gdf.columns:
        existing = pd.to_numeric(gdf["cwsi"], errors="coerce").dropna()
        existing = existing[existing > NODATA]
        if not existing.empty:
            print(
                f"[geoprocessing] '{mission_id}' — CWSI déjà calculé "
                f"({len(existing)}/{len(gdf)} arbres). "
                "Passez force_recalc=True pour recalculer."
            )
            return {
                "status":      "already_computed",
                "mission_id":  mission_id,
                "method":      method,
                "t_wet":       None,
                "t_dry":       None,
                "n_trees":     len(gdf),
                "n_updated":   int(len(existing)),
                "computed_at": None,
            }

    # ── 5. Extrait les valeurs temp_moy valides ───────────────────────────────
    temp_col    = pd.to_numeric(gdf["temp_moy"], errors="coerce")
    temp_col    = temp_col.where(temp_col > NODATA)   # NODATA → NaN
    tree_means  = temp_col.dropna().values

    if tree_means.size == 0:
        raise ValueError(
            "La colonne 'temp_moy' ne contient aucune valeur valide. "
            "Vérifiez que vos données thermiques ont bien été traitées "
            "et que la colonne n'est pas entièrement vide ou à -9999."
        )

    # ── 6. Calcul de T_wet et T_dry ──────────────────────────────────────────
    t_wet: float
    t_dry: float

    if method == "empirical":
        meta     = get_mission(mission_id)
        temp_air = (meta or {}).get("meteo", {}).get("temp_air")
        if temp_air is None:
            raise ValueError(
                "La température de l'air (T_air) est requise pour la méthode empirique. "
                "Renseignez-la dans les métadonnées de la mission avant de lancer le calcul."
            )
        t_wet = float(np.percentile(tree_means, 10))
        t_dry = float(temp_air) + 5.0
    else:
        t_wet = float(np.percentile(tree_means, 0.5))
        t_dry = float(np.percentile(tree_means, 99.5))

    if t_dry <= t_wet:
        raise ValueError(
            f"T_dry ({t_dry:.4f} °C) ≤ T_wet ({t_wet:.4f} °C) : "
            "impossible de calculer le CWSI. "
            "Vérifiez les valeurs de temp_moy dans vos données."
        )

    print(
        f"[geoprocessing] '{mission_id}' [{method}] — "
        f"T_wet={t_wet:.4f} °C  T_dry={t_dry:.4f} °C  "
        f"(base : {tree_means.size} arbres avec données)"
    )

    # ── 7. Calcul vectorisé du CWSI ──────────────────────────────────────────
    denominator = t_dry - t_wet
    cwsi_col = ((temp_col - t_wet) / denominator).clip(0.0, 1.0).round(4)
    # Arbres sans temp_moy valide reçoivent la sentinelle NODATA
    cwsi_col = cwsi_col.fillna(NODATA)

    gdf["cwsi"] = cwsi_col.values

    # ── 8. Persistance en GPKG ───────────────────────────────────────────────
    out_path = mission_dir / "trees.gpkg"
    gdf.to_file(out_path, driver="GPKG")
    print(f"[geoprocessing] ✓ trees.gpkg mis à jour : {out_path}")

    # ── 9. Résultats dans metadata.json ──────────────────────────────────────
    computed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    n_updated   = int((cwsi_col > NODATA).sum())

    results: dict = {
        "method":      method,
        "t_wet":       round(t_wet, 4),
        "t_dry":       round(t_dry, 4),
        "n_trees":     len(gdf),
        "n_updated":   n_updated,
        "computed_at": computed_at,
    }
    if method == "empirical":
        results["temp_air"] = float(temp_air)  # type: ignore[arg-type]

    save_cwsi_results(mission_id, results)

    # ── 10. Vide le cache RAM ─────────────────────────────────────────────────
    _load_raw_trees.cache_clear()
    print(f"[geoprocessing] ✓ Cache vidé pour '{mission_id}'.")

    return {"status": "computed", "mission_id": mission_id, **results}
