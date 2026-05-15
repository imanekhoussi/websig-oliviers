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

# Seuils CWSI — 5 classes.
# La borne supérieure de "severe" est volontairement large (99) pour absorber
# les valeurs légèrement > 1 dues aux arrondis de calcul.
CWSI_THRESHOLDS = {
    "aucun":  (0.0,   0.20),
    "faible": (0.20,  0.35),
    "modere": (0.35,  0.50),
    "eleve":  (0.50,  0.75),
    "severe": (0.75, 99.0),
}

# Couleurs par niveau de stress (utilisées côté frontend aussi)
STRESS_COLORS = {
    "aucun":  "#2ecc71",   # vert
    "faible": "#f1c40f",   # jaune
    "modere": "#e67e22",   # orange
    "eleve":  "#e74c3c",   # rouge
    "severe": "#8e44ad",   # violet
}
