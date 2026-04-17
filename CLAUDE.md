# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**WebSIG Oliviers** — A web GIS application for monitoring water stress in olive trees using thermal drone imagery. It supports multi-mission management and CWSI (Crop Water Stress Index) analysis.

## Development Commands

### Backend (FastAPI)
```bash
cd backend
# First-time setup
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Run dev server (http://localhost:8000)
python main.py
# or
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev       # Dev server at http://localhost:5173
npm run build     # Production build to dist/
npm run preview   # Preview production build
```

There is no test suite at this time.

## Architecture

### Data Model
Each **mission** is an isolated folder under `backend/data/missions/{mission_id}/` containing:
- A shapefile (`.shp`, `.shx`, `.dbf`, `.prj`) or GeoPackage (`.gpkg`) with per-tree attributes
- `metadata.json` with mission date, name, notes, and weather conditions

Supported shapefile attributes: `id, hauteur, temp_moy, temp_min, temp_max, cwsi, circonf` (missing fields are silently ignored).

### Backend Structure (`backend/`)
- `main.py` — FastAPI app entry point, CORS setup (localhost:5173 & 3000), router registration
- `config.py` — CRS constants (`SOURCE_CRS=EPSG:32629` UTM 29N Morocco, `WEB_CRS=EPSG:4326`), CWSI stress thresholds (5 levels: aucun/faible/modere/eleve/severe), and stress color mapping
- `missions_manager.py` — Mission CRUD: create/list/get/update/delete mission folders and metadata JSON
- `data_loader.py` — GeoPandas-based spatial loader: reads shapefile or GeoPackage, reprojects to WGS84, normalizes column names, classifies stress by CWSI, returns GeoJSON
- `routes/missions.py` — Mission CRUD endpoints + file upload (zip or individual files)
- `routes/trees.py` — Tree GeoJSON endpoints (all trees or single tree by ID)
- `routes/stats.py` — Aggregated statistics (stress distribution, CWSI histogram, value ranges)

### Frontend Structure (`frontend/src/`)

**Layout paradigm:** the Leaflet map is the absolute full-screen background (`position: fixed; inset: 0`). All UI panels float on top via glassmorphism overlays.

**Hooks (`hooks/`)**
- `useToast.jsx` — Toast context + `ToastProvider` + `useToast()` hook. Wrap the app in `<ToastProvider>` (done in `App.jsx`). Call `toast(message, 'success'|'error'|'info')` anywhere inside it.
- `useMissions.js` — Fetches the mission list, exposes `{ missions, loading, refresh }`. Errors are surfaced via toast.
- `useMissionData.js` — Fetches trees + stats for `currentId`. Re-fetches only when `currentId` or `has_shapefile` changes. Exposes `{ geojson, stats, dataLoading }`.

**Components (`components/`)**
- `App.jsx` — Wraps `<ToastProvider>` around `<Dashboard>`. `Dashboard` uses the custom hooks and renders the full-screen map + floating panels.
- `api.js` — All `fetch()` calls; single source of truth for API URLs.
- `constants.js` — Stress color codes and labels (must stay in sync with `config.py`).
- `components/MissionSelector.jsx` — Panel widget: mission dropdown, create form (modal), delete via `ConfirmModal` (no `confirm()`), upload zone. Uses `useToast`.
- `components/ConfirmModal.jsx` — Reusable confirmation modal (replaces `confirm()`). Props: `title`, `message`, `confirmLabel`, `danger`, `onConfirm`, `onCancel`.
- `components/TreeMap.jsx` — Full-screen Leaflet map. Always renders (even without data). Internal `MapController` uses `useMap()` to `flyTo` the data center when `geojson` changes. Premium popups strip Leaflet's default chrome.
- `components/StatsPanel.jsx` — Recharts bar charts with glassmorphism custom tooltips. Accepts `{ stats, mission }`.
- `components/TrendPanel.jsx` — Line chart of avg CWSI over all missions. Highlights active mission with `ReferenceDot`. Glassmorphism tooltip.
- `components/Legend.jsx` — `position: fixed` overlay at bottom-left.
- `components/Skeleton.jsx` — `StatsSkeleton` and `TrendSkeleton` for loading states.

### Key Data Flow
1. `useMissions` fetches the list on mount; `Dashboard` auto-selects the first mission with data.
2. `useMissionData` fetches trees + stats whenever `currentId` or `has_shapefile` changes.
3. `TreeMap` always renders the basemap; `MapController` flies to the data on mission switch.
4. `StatsPanel` and `TrendPanel` display via Recharts in the floating side panels.
5. The CWSI threshold slider (floating filter bar) filters the rendered markers client-side.
6. All API errors and successes are surfaced via the `useToast` system — never `alert()` or `confirm()`.

### Coordinate Systems
- Source data: **EPSG:32629** (UTM Zone 29N — Morocco)
- Web display: **EPSG:4326** (WGS84)
- Reprojection is done server-side in `data_loader.py` before returning GeoJSON

### Stress Classification (CWSI thresholds — defined in `config.py`)
| Level | CWSI range | Color |
|-------|-----------|-------|
| aucun | < 0.1 | green |
| faible | 0.1–0.3 | yellow |
| modere | 0.3–0.5 | orange |
| eleve | 0.5–0.7 | red |
| severe | ≥ 0.7 | purple |
