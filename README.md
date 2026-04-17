# WebSIG Oliviers v2.0 — Multi-missions

Dashboard de surveillance du stress hydrique des oliviers par imagerie thermique drone,
avec gestion multi-missions pour comparaison temporelle.

**PFE Imane** · Drone Globe × FST Tanger

---

## 🚀 Installation

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```
→ API sur `http://localhost:8000` · Docs sur `http://localhost:8000/docs`

### Frontend (autre terminal)
```bash
cd frontend
npm install
npm run dev
```
→ Interface sur `http://localhost:5173`

---

## 📅 Workflow multi-missions

1. **Crée une mission** (bouton ➕) → date, nom, notes, météo (Tair, humidité, vent)
2. **Upload le shapefile** pour cette mission (drag & drop zip ou 4 fichiers)
3. **Switch entre missions** via le dropdown en haut
4. Chaque mission est isolée dans `backend/data/missions/{id}/`

---

## 📊 Attributs shapefile supportés

`id, hauteur, temp_moy, temp_min, temp_max, cwsi, circonf`
(les champs manquants sont simplement ignorés)

---

## 🗺️ API v2.0

| Endpoint | Description |
|---|---|
| `GET /api/missions` | Liste toutes les missions |
| `POST /api/missions` | Crée une mission |
| `GET /api/missions/{id}` | Détails d'une mission |
| `PATCH /api/missions/{id}` | Modifie métadonnées |
| `DELETE /api/missions/{id}` | Supprime mission + données |
| `POST /api/missions/{id}/upload` | Upload shapefile |
| `GET /api/missions/{id}/trees` | GeoJSON arbres |
| `GET /api/missions/{id}/trees/{tree_id}` | Détail arbre |
| `GET /api/missions/{id}/stats` | Statistiques |

---

## 🔮 Prochaines étapes

- **Étape 3** : comparaison temporelle (2 missions côte à côte, évolution CWSI)
- **Mission 2** : upload rasters (RGB/thermique/CHM) + pipeline auto de détection
- Filtres dynamiques, export CSV/GeoJSON, alertes anomalies
