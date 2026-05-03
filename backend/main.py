"""
WebSIG Oliviers - API principale (multi-missions)
Projet PFE Imane - Drone Globe x FST Tanger
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from routes import missions, trees, stats
from routes.trees import history_router

app = FastAPI(
    title="WebSIG Oliviers - API",
    description="Dashboard multi-missions pour surveillance stress hydrique oliviers",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/tiles", StaticFiles(directory="data/missions"), name="tiles")

os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.include_router(missions.router)
app.include_router(trees.router)
app.include_router(history_router)
app.include_router(stats.router)


@app.get("/")
def root():
    return {
        "projet": "WebSIG Oliviers - Multi-missions",
        "version": "2.0.0",
        "endpoints": [
            "GET    /api/missions",
            "POST   /api/missions",
            "GET    /api/missions/{id}",
            "PATCH  /api/missions/{id}",
            "DELETE /api/missions/{id}",
            "POST   /api/missions/{id}/upload",
            "GET    /api/missions/{id}/trees",
            "GET    /api/missions/{id}/trees/{tree_id}",
            "GET    /api/missions/{id}/stats",
        ],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
