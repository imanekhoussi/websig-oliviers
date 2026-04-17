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

# Seuils CWSI pour classification stress (à ajuster selon Bian 2019 / tes résultats)
CWSI_THRESHOLDS = {
    "aucun": (0.0, 0.2),        # Pas de stress
    "faible": (0.2, 0.4),       # Stress faible
    "modere": (0.4, 0.6),       # Stress modéré
    "eleve": (0.6, 0.8),        # Stress élevé
    "severe": (0.8, 1.01),      # Stress sévère
}

# Couleurs par niveau de stress (utilisées côté frontend aussi)
STRESS_COLORS = {
    "aucun": "#2ecc71",    # vert
    "faible": "#f1c40f",   # jaune
    "modere": "#e67e22",   # orange
    "eleve": "#e74c3c",    # rouge
    "severe": "#8e44ad",   # violet
}
