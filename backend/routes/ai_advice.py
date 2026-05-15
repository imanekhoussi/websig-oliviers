"""
Conseil agronomique IA — Groq / LLaMA 3.3 70B.
POST /api/missions/{mission_id}/ai-advice
"""
import os
import requests
from collections import Counter
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import missions_manager as mm
from data_loader import load_trees

_GROQ_KEY   = os.environ.get("GROQ_API_KEY", "")
_GROQ_MODEL = "llama-3.3-70b-versatile"
_GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions"

router = APIRouter(prefix="/api/missions", tags=["ai"])


class AiAdviceRequest(BaseModel):
    stade_pheno:  str = "Floraison"
    type_sol:     str = "Argilo-limoneux"
    type_verger:  str = "Irrigué (goutte-à-goutte)"


_STRESS_LABELS = {
    "aucun":  "aucun stress",
    "faible": "stress faible",
    "modere": "stress modéré",
    "eleve":  "stress élevé",
    "severe": "stress sévère",
}

_PROMPT_TEMPLATE = """\
Agis en tant que Docteur en Agronomie spécialisé dans l'oléiculture de précision au Maroc.
Voici le rapport d'un vol drone thermique (CWSI) d'une parcelle d'oliviers.

[CONTEXTE AGRONOMIQUE ET MÉTÉO]
- Stade phénologique actuel : {stade_pheno}
- Type de sol : {type_sol}
- Type de verger : {type_verger}
- Météo : T° {meteo_temp}°C, Humidité {meteo_hum}%, Vent {meteo_vent} m/s.

[DONNÉES DE STRESS HYDRIQUE]
Répartition : {stats_text}

Rédige un bulletin d'alerte agronomique ultra-technique. Utilise des balises Markdown (### pour les titres, ** pour le gras). Pas d'introduction. Structure stricte :

### 🔬 Analyse Écophysiologique
(Adapte l'analyse selon le type de sol et la météo)

### 📉 Risque sur le Rendement
(Quels sont les risques spécifiques pour ce stade phénologique exact ?)

### 💧 Prescription d'Irrigation (RDI)
(Recommandation précise en mm, adaptée au stade de l'arbre)\
"""


def _build_stats_text(gdf) -> str:
    total = len(gdf)
    counts = Counter(gdf["stress"].tolist()) if "stress" in gdf.columns else {}
    cwsi_s = gdf["cwsi"].dropna().astype(float) if "cwsi" in gdf.columns else None
    cwsi_mean = round(float(cwsi_s.mean()), 2) if cwsi_s is not None and not cwsi_s.empty else None

    lines = [
        f"Total arbres : {total}",
        f"CWSI moyen : {cwsi_mean if cwsi_mean is not None else 'N/A'}",
    ]
    for classe in ["aucun", "faible", "modere", "eleve", "severe"]:
        cnt = counts.get(classe, 0)
        pct = round(100 * cnt / total, 1) if total else 0
        lines.append(f"  - {_STRESS_LABELS[classe]} : {cnt} arbres ({pct} %)")
    return "\n".join(lines)


def _meteo_val(meta: dict, key: str) -> str:
    val = (meta.get("meteo") or {}).get(key)
    return str(val) if val is not None else "N/A"


@router.post("/{mission_id}/ai-advice")
def get_ai_advice(mission_id: str, body: AiAdviceRequest):
    meta = mm.get_mission(mission_id)
    if meta is None:
        raise HTTPException(404, f"Mission '{mission_id}' introuvable")

    try:
        gdf = load_trees(mission_id)
    except FileNotFoundError:
        raise HTTPException(404, "Aucune donnée d'arbres disponible pour cette mission")

    prompt = _PROMPT_TEMPLATE.format(
        stade_pheno=body.stade_pheno,
        type_sol=body.type_sol,
        type_verger=body.type_verger,
        meteo_temp=_meteo_val(meta, "temp_air"),
        meteo_hum=_meteo_val(meta, "humidite"),
        meteo_vent=_meteo_val(meta, "vent"),
        stats_text=_build_stats_text(gdf),
    )

    try:
        resp = requests.post(
            _GROQ_URL,
            headers={
                "Authorization": f"Bearer {_GROQ_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": _GROQ_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.7,
                "max_tokens": 1024,
            },
            timeout=30,
        )
        resp.raise_for_status()
        advice = resp.json()["choices"][0]["message"]["content"].strip()
        return {"advice": advice, "mission_id": mission_id}
    except requests.exceptions.Timeout:
        raise HTTPException(504, "Délai dépassé lors de l'appel à l'API Groq")
    except requests.exceptions.HTTPError as exc:
        raise HTTPException(502, f"Erreur API Groq ({exc.response.status_code}) : {exc.response.text}")
    except Exception as exc:
        raise HTTPException(502, f"Erreur API Groq : {exc}")
