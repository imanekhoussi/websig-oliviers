"""
Endpoints arbres pour une mission donnée + historique inter-missions.
"""
from fastapi import APIRouter, HTTPException
import json

import missions_manager as mm
from data_loader import load_trees

router = APIRouter(prefix="/api/missions/{mission_id}/trees", tags=["trees"])
history_router = APIRouter(prefix="/api/trees", tags=["history"])


@router.get("")
def get_all_trees(mission_id: str):
    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError:
        # Mission existe mais pas encore de shapefile → GeoJSON vide (200)
        return {"type": "FeatureCollection", "features": []}
    except ValueError as e:
        raise HTTPException(422, str(e))
    return json.loads(gdf.to_json())


@router.get("/{tree_id}")
def get_tree(mission_id: str, tree_id: int):
    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    row = gdf[gdf["id"] == tree_id]
    if row.empty:
        raise HTTPException(404, f"Arbre {tree_id} introuvable")
    r = row.iloc[0]

    def safe(v):
        if v is None:
            return None
        try:
            f = float(v)
            return f if f == f else None  # NaN → None
        except (TypeError, ValueError):
            return None

    return {
        "id": int(r["id"]),
        "hauteur": safe(r["hauteur"]),
        "temp_moy": safe(r["temp_moy"]),
        "temp_min": safe(r["temp_min"]),
        "temp_max": safe(r["temp_max"]),
        "cwsi": safe(r["cwsi"]),
        "circonf": safe(r["circonf"]),
        "stress": r["stress"],
        "lon": r.geometry.x,
        "lat": r.geometry.y,
    }


@history_router.get("/{tree_id}/history")
def get_tree_history(tree_id: int):
    """Retourne l'évolution du CWSI d'un arbre à travers toutes les missions."""
    results = []
    for mission in mm.list_missions():
        if not mission.get("has_shapefile"):
            continue
        try:
            gdf = load_trees(mission["id"])   # bénéficie du cache lru_cache
            row = gdf[gdf["id"] == tree_id]
            if row.empty:
                continue
            cwsi = row.iloc[0]["cwsi"]
            # Écarte les NaN/None
            if cwsi is None or (isinstance(cwsi, float) and cwsi != cwsi):
                continue
            results.append({
                "date":   mission["date"],
                "nom":    mission.get("nom") or mission["id"],
                "cwsi":   round(float(cwsi), 3),
            })
        except Exception:
            continue
    results.sort(key=lambda x: x["date"])
    return results
