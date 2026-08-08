# 🌿 GeoOlive — WebGIS Dashboard for Olive Tree Water Stress Monitoring

> Full-stack WebGIS platform for detecting water stress from drone thermal imagery, predicting yield with AI, and generating irrigation recommendations.

[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-Frontend-646cff.svg)](https://vitejs.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688.svg)](https://fastapi.tiangolo.com/)
[![Leaflet](https://img.shields.io/badge/Leaflet-Mapping-199900.svg)](https://leafletjs.com/)
[![Docker](https://img.shields.io/badge/Docker-Deployment-2496ed.svg)](https://www.docker.com/)

---

## 📌 Overview

GeoOlive is a WebGIS dashboard built to monitor water stress in an olive orchard (Aïn Tizgha plot, Benslimane) using drone-based thermal imagery. The system combines remote sensing, machine learning, and agronomic modeling to provide:

- ✅ **Per-tree CWSI mapping** — water stress index (CWSIsi method, Bian 2019) computed for every olive tree
- ✅ **Cross-mission comparison** — temporal tracking of water stress between flight campaigns
- ✅ **FAO-56 water balance** — evapotranspiration and daily water deficit per tree, with a 7-day forecast
- ✅ **ML-based yield prediction** — Ridge model trained on FAO-56 synthetic data
- ✅ **AI-based stress classification** — five supervised classifiers compared (decision tree, neural network, Naive Bayes, SVM, KNN)
- ✅ **AI Agronomist** — conversational assistant (Llama-3.3-70b via Groq API) that can trigger map filters automatically
- ✅ **Advanced modules** — anomaly detection (Isolation Forest), IDW interpolation, hexagonal binning, optimized inspection routing (VRP), plot sectorization

---

## 🏗️ Project Architecture

```
geoolive/
├── backend/                    # FastAPI
│   ├── app/
│   │   ├── cwsi/               # CWSI computation (empirical + CWSIsi methods)
│   │   ├── fao56/               # Water balance, ET0, Kc, Ks
│   │   ├── ml/                  # Stress classification + yield prediction
│   │   ├── missions/             # Multi-mission management
│   │   ├── weather/               # Open-Meteo / ERA5-Land integration
│   │   └── agronome_ia/            # AI agent (Llama-3.3-70b via Groq)
│   └── requirements.txt
│
├── frontend/                   # React + Vite
│   ├── src/
│   │   ├── components/
│   │   │   ├── map/              # Leaflet map, CWSI polygons
│   │   │   ├── overview/          # Key indicators, Recharts charts
│   │   │   ├── predictive/         # Yield prediction
│   │   │   ├── settings/            # CWSI thresholds, calculation method
│   │   │   └── ai-agronomist/         # AI Agronomist interface
│   │   └── services/
│   └── package.json
│
├── docker-compose.yml
└── README.md
```

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: React 18 + Vite
- **Mapping**: Leaflet
- **Charts**: Recharts
- **Styling**: Plus Jakarta Sans, light theme

### Backend
- **Framework**: FastAPI
- **Geospatial processing**: zonal statistics per olive tree polygon
- **Machine Learning**: scikit-learn (Ridge, Random Forest, Gradient Boosting, SVR, KNN for yield; decision tree, neural network, Naive Bayes, SVM, KNN for stress classification)
- **Weather**: Open-Meteo API (ERA5-Land reanalysis)
- **Conversational AI**: Llama-3.3-70b via Groq API

### Deployment
- **Containerization**: Docker (React + Vite + FastAPI)

---

## 📊 Project Data

- **968 olive trees** total (ML dataset, combining both missions)
- **965 trees** mapped in Mission 1 (April 1, 2026)
- **957 trees** mapped in Mission 2 (April 28, 2026)
- **Mean CWSI**: 0.60 (Mission 1) → 0.58 (Mission 2)
- Thermal acquisitions with a DJI Mavic 3T (Mission 1) and a DJI Mavic 3M (Mission 2)

---

## 🖥️ Dashboard Interfaces

The dashboard is organized into six tabs: **Overview**, **Map**, **Report**, **Catalog**, **Predictive**, and **Settings**.

### 1. Overview

![Overview](docs/images/dashboard_synthese.png)
*The landing page of the dashboard. Four headline indicators — number of available missions, total trees mapped, global mean CWSI, and share of trees under high/severe stress — sit above four charts: a donut of trees by stress class, a stacked bar chart comparing class distribution across missions, a line chart tracking mean CWSI over time, and a scatter plot correlating canopy temperature with CWSI.*

![Weather panel](docs/images/dashboard_meteo.png)
*A weather panel fed by the Open-Meteo API, since the plot has no permanent on-site weather station. It plots daily min/mean/max temperature and precipitation, relative humidity, and wind speed over the inter-mission period, plus a weekly table with estimated ET₀ — the same parameters that feed the FAO-56 water balance module.*

---

### 2. Map View

![Map view](docs/images/dashboard_vue_generale.png)
*The core Leaflet map: every digitized olive tree polygon is colored by its CWSI stress class. A left-hand panel summarizes the selected mission's statistics, and a right-hand panel shows the cross-mission trend, making it easy to spot clusters of persistent stress from one flight to the next.*

![Tree detail card](docs/images/fig_dashboard_popup_arbre.png)
*Clicking a polygon opens this per-tree card: mean leaf temperature (°C), canopy height (m), CWSI value, and trunk circumference (cm), with a colored badge for the stress class — the same attributes extracted by zonal statistics in the processing pipeline.*

---

### 3. Mission Management

![Mission selector](docs/images/fig_dashboard_selecteur_mission.png)
*Lets the user switch between flight campaigns (Mission 1, Mission 2, etc.) without touching any code — the multi-mission architecture is designed so each new campaign just gets imported as new data.*

![Mission creation](docs/images/fig_dashboard_creation_mission.png)
*The form used to register a new mission: flight date, weather conditions, and import of the tree shapefile plus RGB/thermal orthomosaics generated from the photogrammetric processing.*

---

### 4. CWSI Settings

![CWSI calculation method](docs/images/fig_dashboard_calcul_cwsi.png)
*Toggle between the empirical CWSI formula and the statistical CWSIsi method (Bian et al., 2019), which estimates $T_{wet}$ and $T_{dry}$ from percentiles of the canopy temperature distribution instead of requiring ground weather stations.*

![Classification thresholds](docs/images/fig_dashboard_seuils_cwsi.png)
*The five stress-class thresholds (None / Low / Moderate / High / Severe) are editable per mission, with all maps and statistics recalculating automatically once a threshold is changed.*

---

### 5. Detailed Analytics

![Analytics module](docs/images/fig_dashboard_analyses_detaillees.png)
*A histogram of CWSI values across all 968 trees in the ML dataset, alongside a scatter plot of trunk circumference against CWSI colored by stress class — used to check whether tree size relates to observed stress levels.*

---

### 6. FAO-56 Water Balance

![Water balance](docs/images/fig_dashboard_bilan_hydrique.png)
*Implements the FAO-56 Penman-Monteith method: the crop coefficient $K_c$ is chosen automatically by phenological stage and modulated by the mean CWSI, producing a 7-day irrigation-needs forecast (via Open-Meteo) together with an estimated water budget in MAD.*

---

### 7. Advanced Features

![Feature panel](docs/images/fig_dashboard_panneau_fonctionnalites.png)
*A side panel bundling the dashboard's advanced spatial tools: multi-criteria filtering, AI-based anomaly detection (Isolation Forest), IDW interpolation for continuous stress surfaces, hexagonal binning for aggregated views, an optimized inspection route (VRP) for field visits, and plot sectorization for zone-level planning.*

---

### 8. AI Agronomist

![AI Agronomist interface](docs/images/fig_dashboard_agronome_ia.png)
*A conversational assistant powered by Llama-3.3-70b via the Groq API. Each query is answered with the active mission's agronomic data as context, so responses are grounded in the actual CWSI, weather, and yield figures rather than generic advice.*

![Automatic map filter](docs/images/fig_dashboard_filtre_stress_eleve.png)
*A distinctive capability: the assistant can trigger a spatial filter directly on the Leaflet map in response to a natural-language query — here, isolating trees under high and severe stress — linking textual diagnosis directly to spatial representation.*

---

## 🌡️ CWSI Method

The Crop Water Stress Index is computed using the **CWSIsi** statistical method (Bian et al., 2019), which removes the need for permanent on-site weather instrumentation by estimating the reference temperatures $T_{wet}$ and $T_{dry}$ from percentiles of the canopy temperature (LST) distribution on the thermal orthomosaic.

$$\mathrm{CWSI} = \frac{T_{canopy} - T_{wet}}{T_{dry} - T_{wet}}$$

**Stress classes** (configurable thresholds):

| Class | CWSI range |
|---|---|
| None | ≤ 0.20 |
| Low | 0.21 – 0.40 |
| Moderate | 0.41 – 0.60 |
| High | 0.61 – 0.80 |
| Severe | > 0.80 |

---

## 💧 FAO-56 Water Balance

The module calculates the daily water deficit per tree using the FAO-56 Penman-Monteith method:

- $\mathrm{ET}_0$ (reference evapotranspiration) via Open-Meteo/ERA5-Land
- $K_c$ (crop coefficient) selected according to the olive tree's phenological stage
- $K_s = 1 - \mathrm{CWSI}$ (stress coefficient)
- $\mathrm{ET}_c = \mathrm{ET}_0 \times K_c \times K_s$

---

## 🤖 Machine Learning Modules

### Water stress classification
Five classifiers compared via 5-fold cross-validation, with a cross-mission generalization test to assess real-world robustness against changing acquisition conditions (sensor, resolution, air temperature).

### Yield prediction
Five regression models compared (Random Forest, Gradient Boosting, SVR, KNN, Ridge), trained on a synthetic dataset generated through FAO-56 simulation. The Ridge model achieves the best performance. External field validation is planned for the October–December 2026 harvest.

---

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose
- Node.js 20+ (frontend development)
- Python 3.10+ (backend development)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/geoolive.git
cd geoolive

# Run with Docker
docker-compose up --build
```

### Access Points
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs

---

## 🔮 Roadmap

- 📏 **Field validation of CWSI** — leaf water potential and stomatal conductance measurements, not yet collected
- 🌾 **External yield validation** — field weighing at the October–December 2026 harvest
- 🧠 **Automated canopy segmentation** — integration of a U-Net pipeline developed in parallel
- 📡 **Soil IoT sensor fusion** — capacitive probes (TDR/FDR) over LoRaWAN/MQTT for near real-time irrigation control
- ☁️ **Cloud deployment** — containerization, PostGIS database, multi-user authentication
- 🔄 **Incremental learning** — progressive classifier retraining with each new mission
- 🌍 **Extension to other crops** — adapting $K_c$/$K_y$ coefficients to other Mediterranean tree species

---

## 🙏 Acknowledgments

- **Drone Globe** for the project framework and field data access
- **FST Tangier** for academic supervision
- **Open-source community** for the frameworks and libraries used

---

*Faculty of Sciences and Technology, Tangier – Geoinformation Engineering Program*
