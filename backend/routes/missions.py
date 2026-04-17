"""
Endpoints de gestion des missions.
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Body
from fastapi.responses import Response
from typing import List, Optional
from pydantic import BaseModel

import missions_manager as mm
from data_loader import load_trees

router = APIRouter(prefix="/api/missions", tags=["missions"])


class MissionCreate(BaseModel):
    date: str  # YYYY-MM-DD
    nom: Optional[str] = ""
    notes: Optional[str] = ""
    temp_air: Optional[float] = None
    humidite: Optional[float] = None
    vent: Optional[float] = None


class MissionUpdate(BaseModel):
    nom: Optional[str] = None
    notes: Optional[str] = None
    meteo: Optional[dict] = None


@router.get("")
def list_all():
    return mm.list_missions()


@router.post("")
def create(payload: MissionCreate):
    try:
        return mm.create_mission(**payload.model_dump())
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.get("/{mission_id}")
def get_one(mission_id: str):
    m = mm.get_mission(mission_id)
    if m is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable")
    return m


@router.patch("/{mission_id}")
def update(mission_id: str, payload: MissionUpdate):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    m = mm.update_mission_metadata(mission_id, updates)
    if m is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable")
    return m


@router.delete("/{mission_id}")
def delete(mission_id: str):
    ok = mm.delete_mission(mission_id)
    if not ok:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable")
    return {"status": "ok", "deleted": mission_id}


@router.post("/{mission_id}/upload")
async def upload(mission_id: str, files: List[UploadFile] = File(...)):
    try:
        return mm.upload_shapefile(mission_id, files)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Erreur upload : {e}")


@router.get("/{mission_id}/export")
def export_mission_csv(mission_id: str):
    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))

    df = gdf.copy()
    if df.geometry.geom_type.eq("Point").all():
        df["lon"] = df.geometry.x.round(6)
        df["lat"] = df.geometry.y.round(6)
    else:
        centroid = df.geometry.centroid
        df["lon"] = centroid.x.round(6)
        df["lat"] = centroid.y.round(6)

    cols = [c for c in ("id", "lon", "lat", "temp_moy", "cwsi", "stress", "hauteur", "circonf") if c in df.columns]
    csv_data = df[cols].to_csv(index=False)

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="rapport_mission_{mission_id}.csv"'},
    )
