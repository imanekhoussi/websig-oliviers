"""
Prédicteur de rendement (singleton) — le modèle .joblib est chargé une seule fois
au premier appel, puis réutilisé pour toutes les requêtes suivantes.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

MODEL_PATH = Path("models/modele_rendement_olivier.joblib")

# Nom de feature du modèle  →  colonne dans le GeoDataFrame
# (data_loader.py renomme : chm_mean→hauteur, temp_mean→temp_moy, cwsi_mean→cwsi)
FEATURE_COL_MAP: dict[str, str] = {
    "CWSI":             "cwsi",
    "chm_max":          "chm_max",
    "chm_mean":         "hauteur",           # renommé par data_loader
    "surface_couronne": "surface_couronne",
    "T_mean":           "temp_moy",
    "T_min":            "temp_min",
    "T_max":            "temp_max",
}

_model = None
_feature_names: list[str] = []


def _load() -> None:
    """Charge le modèle joblib une seule fois (pattern singleton)."""
    global _model, _feature_names
    if _model is not None:
        return
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Modèle introuvable : '{MODEL_PATH}'. "
            "Placez 'modele_rendement_olivier.joblib' dans backend/models/."
        )
    import joblib
    artifact = joblib.load(MODEL_PATH)
    if isinstance(artifact, dict):
        _model         = artifact["model"]
        _feature_names = list(artifact.get("features", FEATURE_COL_MAP.keys()))
    else:
        _model         = artifact
        _feature_names = list(FEATURE_COL_MAP.keys())
    logger.info("[rendement_predictor] Modèle chargé · features=%s", _feature_names)


def _build_row(features) -> list[float]:
    """
    Construit le vecteur de features dans l'ordre attendu par le modèle.
    Accepte un dict ou une pandas Series.
    Valeurs manquantes / NaN / sentinelle -9999 → imputées à 0.0.
    """
    row: list[float] = []
    for feat_name in _feature_names:
        col_name = FEATURE_COL_MAP.get(feat_name, feat_name)
        # Pandas Series et dict ont tous les deux .get()
        val = features.get(col_name) if hasattr(features, "get") else getattr(features, col_name, None)
        try:
            f = float(val)
            if f != f or f <= -9000:   # NaN ou sentinelle nodata
                f = 0.0
        except (TypeError, ValueError):
            f = 0.0
        row.append(f)
    return row


def predire_rendement(tree_features: dict) -> float:
    """
    Prédit le rendement (kg/arbre) pour un seul arbre.

    tree_features : dict dont les clés sont des colonnes GeoDataFrame
                    (cwsi, hauteur, chm_max, surface_couronne, temp_moy, temp_min, temp_max).
    """
    _load()
    row = _build_row(tree_features)
    return float(_model.predict(np.array([row]))[0])


def predire_batch(gdf) -> np.ndarray:
    """
    Prédit le rendement pour tout un GeoDataFrame en un seul appel .predict.
    Retourne un np.ndarray de float, même ordre que gdf.
    """
    _load()
    rows = [_build_row(row) for _, row in gdf.iterrows()]
    return _model.predict(np.array(rows))
