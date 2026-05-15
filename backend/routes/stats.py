"""
Endpoints stats pour une mission donnée.
"""
from fastapi import APIRouter, HTTPException
from collections import Counter
import numpy as np

from data_loader import load_trees
from config import STRESS_COLORS

router = APIRouter(prefix="/api/missions/{mission_id}/stats", tags=["stats"])


_EMPTY_STATS = {
    "total_arbres": 0,
    "stress_breakdown": [
        {"classe": l, "count": 0, "color": STRESS_COLORS.get(l, "#95a5a6")}
        for l in ["aucun", "faible", "modere", "eleve", "severe"]
    ],
    "cwsi":        {"moyenne": None, "min": None, "max": None},
    "temperature": {"moyenne": None, "min": None, "max": None},
    "hauteur":     {"moyenne": None, "min": None, "max": None},
    "circonf":     {"moyenne": None, "min": None, "max": None},
    "histogram_cwsi": [],
}


@router.get("")
def get_stats(mission_id: str):
    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError:
        # Mission sans shapefile → stats vides (200, headers CORS présents)
        return _EMPTY_STATS
    except ValueError as e:
        raise HTTPException(422, str(e))

    stress_counts = Counter(gdf["stress"].tolist())
    stress_breakdown = [
        {
            "classe": label,
            "count": stress_counts.get(label, 0),
            "color": STRESS_COLORS.get(label, "#95a5a6"),
        }
        for label in ["aucun", "faible", "modere", "eleve", "severe"]
    ]

    def stats_of(series):
        clean = series.dropna().astype(float)
        clean = clean[np.isfinite(clean)]
        if clean.empty:
            return {"moyenne": None, "min": None, "max": None}
        return {
            "moyenne": round(float(clean.mean()), 3),
            "min":     round(float(clean.min()),  3),
            "max":     round(float(clean.max()),  3),
        }

    cwsi_clean = gdf["cwsi"].dropna().astype(float)
    cwsi_clean = cwsi_clean[np.isfinite(cwsi_clean)]

    bin_edges = np.linspace(0.0, 1.0, 11)          # 10 intervalles de 0.1
    counts, _ = np.histogram(cwsi_clean, bins=bin_edges)
    histogram = [
        {"bin": f"{bin_edges[i]:.1f}-{bin_edges[i+1]:.1f}", "count": int(counts[i])}
        for i in range(len(counts))
    ]

    return {
        "total_arbres": len(gdf),
        "stress_breakdown": stress_breakdown,
        "cwsi": stats_of(gdf["cwsi"]),
        "temperature": stats_of(gdf["temp_moy"]),
        "hauteur": stats_of(gdf["hauteur"]),
        "circonf": stats_of(gdf["circonf"]),
        "histogram_cwsi": histogram,
    }
