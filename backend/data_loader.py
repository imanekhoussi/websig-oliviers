"""
Chargement des données spatiales (Shapefile ou GeoPackage) pour une mission donnée.
Résultats mis en cache en RAM pour éviter des lectures disque répétées.
"""
from functools import lru_cache

import geopandas as gpd

from config import WEB_CRS, CWSI_THRESHOLDS
from missions_manager import _mission_dir, get_mission


_NODATA = -9999.0   # sentinelle partagée avec geoprocessing.py


def classify_stress(cwsi, thresholds=None) -> str:
    """Classe un CWSI en niveau de stress. Robuste à None, NaN et sentinelle -9999.
    Si thresholds est fourni (dict label→(low,high)), il remplace les seuils par défaut."""
    if cwsi is None:
        return "inconnu"
    try:
        f = float(cwsi)
    except (TypeError, ValueError):
        return "inconnu"
    if f != f or f <= _NODATA:  # NaN ou sentinelle nodata
        return "inconnu"
    active = thresholds if thresholds is not None else CWSI_THRESHOLDS
    for label, (low, high) in active.items():
        if low <= f < high:
            return label
    return "inconnu"


@lru_cache(maxsize=10)
def _load_raw_trees(mission_id: str) -> gpd.GeoDataFrame:
    """Charge et normalise le fichier spatial. Résultat mis en cache (I/O coûteux).
    Ne stocke PAS la colonne stress — elle est recalculée à chaque appel de load_trees."""
    d = _mission_dir(mission_id)

    gpkg_path = d / "trees.gpkg"
    shp_path  = d / "trees.shp"

    if gpkg_path.exists():
        file_to_load = gpkg_path
    elif shp_path.exists():
        file_to_load = shp_path
    else:
        raise FileNotFoundError(
            f"Aucune donnée spatiale (.gpkg ou .shp) pour la mission '{mission_id}'."
        )

    try:
        gdf = gpd.read_file(file_to_load)
    except Exception as exc:
        print(f"[data_loader] ❌ Impossible de lire '{file_to_load}': {exc}")
        raise ValueError(
            f"Lecture échouée pour '{file_to_load.name}'. "
            "Vérifiez que le fichier n'est pas corrompu et que le ZIP contient "
            "bien les 4 fichiers : .shp, .shx, .dbf, .prj"
        ) from exc

    if gdf.crs is None:
        raise ValueError("Le fichier spatial n'a pas de CRS défini")

    gdf = gdf.to_crs(WEB_CRS)
    gdf.columns = [c.lower() for c in gdf.columns]
    gdf = gdf.rename(columns={
        "temp_mean": "temp_moy",
        "chm_mean":  "hauteur",
        "cwsi_mean": "cwsi",
    })
    for col in ("id", "hauteur", "temp_moy", "temp_min", "temp_max",
                "cwsi", "circonf"):
        if col not in gdf.columns:
            gdf[col] = None

    return gdf


def load_trees(mission_id: str) -> gpd.GeoDataFrame:
    """Retourne le GeoDataFrame avec la classification stress toujours à jour.
    Le chargement fichier est mis en cache ; la classification utilise les seuils courants.
    Si la mission possède des seuils personnalisés (cwsi_thresholds), ils sont appliqués."""
    gdf = _load_raw_trees(mission_id).copy()
    for col in ("temp_moy", "temp_min", "temp_max", "cwsi"):
        if col in gdf.columns:
            gdf[col] = gdf[col].where(gdf[col] > _NODATA, other=None)

    # Seuils personnalisés par mission (list→tuple pour chaque classe)
    custom_thresholds = None
    meta = get_mission(mission_id)
    if meta and "cwsi_thresholds" in meta:
        try:
            custom_thresholds = {
                k: tuple(v) for k, v in meta["cwsi_thresholds"].items()
            }
        except Exception:
            custom_thresholds = None

    gdf["stress"] = gdf["cwsi"].apply(
        lambda v: classify_stress(v, custom_thresholds)
    )
    return gdf