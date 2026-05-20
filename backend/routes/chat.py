"""
Chat agronomique IA context-aware — Groq / LLaMA 3.3 70B
POST /api/chat
"""
import os
import requests
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

_GROQ_KEY   = os.environ.get("GROQ_API_KEY", "")
_GROQ_MODEL = "llama-3.3-70b-versatile"
_GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions"

router = APIRouter(prefix="/api", tags=["chat"])

_SYSTEM_PROMPT = (
    "Tu es un assistant agronome expert en oléiculture au Maroc (région de Fès-Meknès), "
    "spécialisé dans l'analyse de données de drones thermiques (CWSI, température, rendement).\n\n"

    "STYLE DE COMMUNICATION — règles absolues :\n"
    "- Tu es direct, chaleureux et empathique. Utilise systématiquement le 'je' et le 'vous'.\n"
    "- Réponds en 2 à 3 phrases maximum. Sois précis, jamais bavard.\n"
    "- N'utilise JAMAIS de grands titres de sections (interdit : '###', '##', '# '). "
    "Tu peux utiliser le **gras** pour les chiffres clés et de courtes listes (-).\n"
    "- Ne propose que des solutions d'irrigation de précision et d'agriculture intelligente.\n\n"

    "CAPACITÉ AGENT — INTERACTION CARTE :\n"
    "Si l'utilisateur te demande de localiser, montrer, mettre en évidence ou filtrer des arbres "
    "sur la carte (exemples : 'montre les arbres stressés', 'arbres critiques', "
    "'filtre stress sévère', 'faible rendement', 'remets la vue', 'tout afficher'), tu DOIS :\n"
    "1. Parler comme si tu avais DÉJÀ accompli l'action — utilise le passé composé ou le présent "
    "accompli (ex : 'Voilà, j\\'ai mis en évidence les arbres en stress sévère sur votre carte.' "
    "ou 'J\\'ai réinitialisé la vue, vous voyez maintenant tous les arbres.'). "
    "Ne dis JAMAIS 'je vais' ou 'je vais faire'.\n"
    "2. Inclure à la TOUTE FIN de ta réponse un bloc JSON délimité par <map_action> et </map_action>. "
    "Types disponibles :\n"
    "  - stress sévère seul        : <map_action>{\"action\":\"filter\",\"type\":\"stress_severe\"}</map_action>\n"
    "  - stress élevé + sévère     : <map_action>{\"action\":\"filter\",\"type\":\"stress_critique\"}</map_action>\n"
    "  - stress élevé seul         : <map_action>{\"action\":\"filter\",\"type\":\"stress_eleve\"}</map_action>\n"
    "  - stress modéré seul        : <map_action>{\"action\":\"filter\",\"type\":\"stress_modere\"}</map_action>\n"
    "  - sans stress (sains)       : <map_action>{\"action\":\"filter\",\"type\":\"stress_aucun\"}</map_action>\n"
    "  - rendement faible (< moy.) : <map_action>{\"action\":\"filter\",\"type\":\"rendement_faible\"}</map_action>\n"
    "  - tout réafficher           : <map_action>{\"action\":\"reset\"}</map_action>\n"
    "N'inclus ce bloc JSON que si la demande porte explicitement sur la visualisation d'arbres "
    "sur la carte. Pour les conseils agronomiques généraux, n'inclus JAMAIS ce bloc."
)


class ChatMessage(BaseModel):
    role: str      # "user" | "assistant"
    content: str


class ContextData(BaseModel):
    mission_name:    Optional[str]   = None
    mission_date:    Optional[str]   = None
    total_arbres:    Optional[int]   = None
    cwsi_moyen:      Optional[float] = None
    rendement_moyen: Optional[float] = None


class ChatRequest(BaseModel):
    messages:     List[ChatMessage]
    context_data: Optional[ContextData] = None


def _build_context_message(ctx: ContextData) -> str:
    lines = ["**[Données actuelles de la parcelle analysée par drone]**"]
    if ctx.mission_name:
        lines.append(f"- Mission : {ctx.mission_name}")
    if ctx.mission_date:
        lines.append(f"- Date du vol : {ctx.mission_date}")
    if ctx.total_arbres is not None:
        lines.append(f"- Nombre d'arbres analysés : {ctx.total_arbres}")
    if ctx.cwsi_moyen is not None:
        stress_label = (
            "aucun stress (< 0.1)" if ctx.cwsi_moyen < 0.1 else
            "stress faible (0.1–0.3)" if ctx.cwsi_moyen < 0.3 else
            "stress modéré (0.3–0.5)" if ctx.cwsi_moyen < 0.5 else
            "stress élevé (0.5–0.7)" if ctx.cwsi_moyen < 0.7 else
            "stress sévère (≥ 0.7)"
        )
        lines.append(f"- CWSI moyen de la parcelle : {ctx.cwsi_moyen:.3f} → {stress_label}")
    if ctx.rendement_moyen is not None:
        lines.append(f"- Rendement moyen prédit par IA : {ctx.rendement_moyen:.1f} kg/arbre")
    lines.append(
        "\nBase tes conseils sur ces données réelles. "
        "Si une valeur est absente, adapte ta réponse sans l'inventer."
    )
    return "\n".join(lines)


@router.post("/chat")
def chat_with_ai(body: ChatRequest):
    if not _GROQ_KEY:
        raise HTTPException(500, "Clé API Groq non configurée (GROQ_API_KEY)")
    if not body.messages:
        raise HTTPException(400, "La liste de messages ne peut pas être vide")

    groq_messages = [{"role": "system", "content": _SYSTEM_PROMPT}]

    if body.context_data:
        groq_messages.append({
            "role": "system",
            "content": _build_context_message(body.context_data),
        })

    for msg in body.messages:
        if msg.role not in ("user", "assistant"):
            raise HTTPException(400, f"Rôle invalide : {msg.role}")
        groq_messages.append({"role": msg.role, "content": msg.content})

    try:
        resp = requests.post(
            _GROQ_URL,
            headers={
                "Authorization": f"Bearer {_GROQ_KEY}",
                "Content-Type":  "application/json",
            },
            json={
                "model":       _GROQ_MODEL,
                "messages":    groq_messages,
                "temperature": 0.6,
                "max_tokens":  1024,
            },
            timeout=30,
        )
        resp.raise_for_status()
        reply = resp.json()["choices"][0]["message"]["content"].strip()
        return {"reply": reply}

    except requests.exceptions.Timeout:
        raise HTTPException(504, "Délai dépassé lors de l'appel à l'API Groq")
    except requests.exceptions.HTTPError as exc:
        raise HTTPException(502, f"Erreur Groq ({exc.response.status_code}) : {exc.response.text}")
    except Exception as exc:
        raise HTTPException(502, f"Erreur API Groq : {exc}")
