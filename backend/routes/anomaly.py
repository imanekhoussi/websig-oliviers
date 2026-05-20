"""
Détection d'anomalies par Isolation Forest.
GET /api/missions/{mission_id}/anomalies
"""
from fastapi import APIRouter, HTTPException

import missions_manager as mm
from data_loader import load_trees

router = APIRouter(prefix="/api/missions", tags=["anomaly"])

_FEATURES = ["cwsi", "temp_moy", "hauteur"]


@router.get("/{mission_id}/anomalies")
def get_anomalies(mission_id: str):
    # Vérifie que la mission existe
    if mm.get_mission(mission_id) is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable.")

    # Charge les arbres
    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError:
        raise HTTPException(404, f"Aucun shapefile trouvé pour la mission '{mission_id}'.")
    except ValueError as exc:
        raise HTTPException(422, str(exc))

    # Import tardif pour renvoyer un 503 explicite si sklearn manque
    try:
        import numpy as np
        from sklearn.ensemble import IsolationForest
        from sklearn.preprocessing import StandardScaler
    except ImportError:
        raise HTTPException(
            503,
            "scikit-learn n'est pas installé. "
            "Lancez : pip install scikit-learn",
        )

    # Sous-ensemble valide sur les trois features
    df = gdf[_FEATURES + ["id", "stress", "geometry"]].copy()
    df = df.dropna(subset=_FEATURES)
    total = len(gdf)
    n_valid = len(df)

    if n_valid < 10:
        raise HTTPException(
            422,
            f"Seulement {n_valid} arbres avec des données complètes "
            f"(cwsi, temp_moy, hauteur). Minimum requis : 10.",
        )

    # Normalisation + Isolation Forest
    X = df[_FEATURES].astype(float).values
    X_scaled = StandardScaler().fit_transform(X)

    model = IsolationForest(contamination=0.1, random_state=42)
    predictions = model.fit_predict(X_scaled)
    scores = model.score_samples(X_scaled)          # log-likelihood ; plus négatif = plus anormal

    df = df.copy()
    df["_pred"] = predictions
    df["_score"] = scores

    anomalies_df = df[df["_pred"] == -1]

    anomalies = []
    for _, row in anomalies_df.iterrows():
        geom = row.geometry
        ref  = geom if geom.geom_type == "Point" else geom.centroid
        lon, lat = ref.x, ref.y
        anomalies.append(
            {
                "id":            int(row["id"]) if not isinstance(row["id"], str) else row["id"],
                "cwsi":          round(float(row["cwsi"]),    4),
                "temp_moy":      round(float(row["temp_moy"]), 4),
                "hauteur":       round(float(row["hauteur"]),  4),
                "stress":        str(row["stress"]),
                "anomaly_score": round(float(row["_score"]),   4),
                "lon":           round(lon, 6),
                "lat":           round(lat, 6),
            }
        )

    # Tri du plus anormal au moins anormal
    anomalies.sort(key=lambda a: a["anomaly_score"])

    return {
        "mission_id":   mission_id,
        "total_arbres": total,
        "n_anomalies":  len(anomalies),
        "methode":      "Isolation Forest (sklearn)",
        "anomalies":    anomalies,
    }
