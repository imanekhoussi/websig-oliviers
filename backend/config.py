"""
Configuration du projet.
Modifie SHAPEFILE_PATH pour pointer vers ton fichier oliviers_01042026.shp
"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# Chemin vers ton shapefile (à adapter selon ton système)
# Exemple Windows : r"C:\Users\Imane\PFE\data\oliviers_01042026.shp"
# Exemple Linux/Mac : "/home/imane/PFE/data/oliviers_01042026.shp"
SHAPEFILE_PATH = BASE_DIR / "data" / "oliviers_01042026.shp"

# CRS du shapefile (EPSG:32629 = UTM zone 29N, Maroc)
SOURCE_CRS = "EPSG:32629"
# CRS pour affichage web (Leaflet utilise WGS84)
WEB_CRS = "EPSG:4326"

# Seuils CWSI — 4 classes. Bornes extrêmes larges pour absorber
# les valeurs aberrantes (CWSI négatif = surplus hydrique, CWSI > 1 = erreur capteur).
CWSI_THRESHOLDS = {
    "faible": (-99.0, 0.25),  # < 0.25 (inclut valeurs négatives)
    "modere": ( 0.25, 0.50),
    "eleve":  ( 0.50, 0.75),
    "severe": ( 0.75, 99.0),  # ≥ 0.75 (inclut valeurs > 1)
}

# Couleurs par niveau de stress (utilisées côté frontend aussi)
STRESS_COLORS = {
    "faible": "#f1c40f",   # jaune
    "modere": "#e67e22",   # orange
    "eleve":  "#e74c3c",   # rouge
    "severe": "#8e44ad",   # violet
}
