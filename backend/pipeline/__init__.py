"""
Module pipeline automatique - MISSION 2.

À remplir plus tard avec :
- detection.py : détection automatique des oliviers (K-means QGIS ou CNN)
- zonal_stats.py : extraction température par arbre depuis thermal_georef.tif
- cwsi.py : calcul CWSI par arbre (méthode percentile Bian 2019)
- classification.py : classification stress via Random Forest

Workflow visé :
    input  : thermal.tif + RGB.tif + DSM.tif + DTM.tif
    output : shapefile oliviers avec champs id, hauteur, temp_moy, cwsi, stress

L'endpoint /api/process prendra un upload d'images et lancera ce pipeline.
"""
