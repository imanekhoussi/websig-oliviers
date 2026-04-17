"""
Chargement des données spatiales (Shapefile ou GeoPackage) pour une mission donnée.
Résultats mis en cache en RAM pour éviter des lectures disque répétées.
"""
from functools import lru_cache

import geopandas as gpd

from config import WEB_CRS, CWSI_THRESHOLDS
from missions_manager import _mission_dir


def classify_stress(cwsi) -> str:
    if cwsi is None or (isinstance(cwsi, float) and cwsi != cwsi):
        return "inconnu"
    for label, (low, high) in CWSI_THRESHOLDS.items():
        if low <= cwsi < high:
            return label
    return "inconnu"


@lru_cache(maxsize=10)
def load_trees(mission_id: str) -> gpd.GeoDataFrame:
    d = _mission_dir(mission_id)
    
    # 1. On cherche en priorité le GeoPackage (.gpkg), sinon le Shapefile (.shp)
    gpkg_path = d / "trees.gpkg"
    shp_path = d / "trees.shp"
    
    if gpkg_path.exists():
        file_to_load = gpkg_path
    elif shp_path.exists():
        file_to_load = shp_path
    else:
        raise FileNotFoundError(
            f"Aucune donnée spatiale (.gpkg ou .shp) pour la mission '{mission_id}'."
        )

    # 2. On lit le fichier trouvé
    gdf = gpd.read_file(file_to_load)
    
    # 3. Gestion du système de coordonnées
    if gdf.crs is None:
        raise ValueError("Le fichier spatial n'a pas de CRS défini")
        
    gdf = gdf.to_crs(WEB_CRS)
    
    # 4. Uniformisation : tout en minuscules (ex: CWSI_mean devient cwsi_mean)
    gdf.columns = [c.lower() for c in gdf.columns]

    # 5. TRADUCTION : On fait correspondre tes colonnes QGIS avec celles de React
    gdf = gdf.rename(columns={
        "temp_mean": "temp_moy",
        "chm_mean": "hauteur",
        "cwsi_mean": "cwsi"
    })

    # 6. On garantit que React aura toutes les colonnes qu'il demande (même vides)
    for col in ("id", "hauteur", "temp_moy", "temp_min", "temp_max",
                "cwsi", "circonf", "stress"):
        if col not in gdf.columns:
            gdf[col] = None

    # 7. Calcul automatique du niveau de stress hydrique basé sur le CWSI
    gdf["stress"] = gdf["cwsi"].apply(classify_stress)
    
    return gdf