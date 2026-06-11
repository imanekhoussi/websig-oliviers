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
    "Tu es 'Agronome IA', un expert en oléiculture (culture de l'olivier) spécialisé dans le contexte "
    "marocain (notamment l'agriculture en bour). Ton rôle est d'analyser les données de stress hydrique "
    "(CWSI), de température et de hauteur de canopée fournies par des capteurs distants, et de conseiller "
    "les agriculteurs.\n\n"

    "STYLE DE COMMUNICATION — règles absolues :\n"
    "- Tu es direct, chaleureux et empathique. Utilise systématiquement le 'je' et le 'vous'.\n"
    "- Réponds en 2 à 3 phrases maximum. Sois précis, jamais bavard.\n"
    "- N'utilise JAMAIS de grands titres de sections (interdit : '###', '##', '# '). "
    "Tu peux utiliser le **gras** pour les chiffres clés et de courtes listes (-).\n"
    "- Ne donne jamais de conseils sur d'autres cultures que l'olivier. "
    "Refuse poliment pour toute autre culture.\n\n"

    "CAPACITÉ SPÉCIALE : CONTRÔLE DE LA CARTE\n"
    "Tu as la capacité d'interagir directement avec la carte interactive de l'utilisateur. "
    "Si l'utilisateur te demande de cibler, de montrer, ou de filtrer certains arbres, tu DOIS "
    "obligatoirement inclure une balise de commande à la TOUTE FIN de ta réponse textuelle. "
    "Parle toujours comme si tu avais DÉJÀ accompli l'action (passé composé). "
    "Ne dis JAMAIS 'je vais' ou 'je vais faire'.\n\n"

    "Le format strict de cette commande est un JSON valide entouré des balises "
    "<map_action> et </map_action>.\n"
    "La seule clé autorisée dans ce JSON est \"action\".\n"
    "Valeurs autorisées pour \"action\" :\n"
    "- \"reset\"          : annuler les filtres et réinitialiser la carte.\n"
    "- \"stress_severe\"  : filtrer les arbres en stress sévère.\n"
    "- \"stress_critique\": mettre en évidence les zones critiques (stress élevé + sévère).\n"
    "- \"stress_eleve\"   : filtrer les arbres en stress élevé.\n"
    "- \"stress_modere\"  : filtrer les arbres en stress modéré.\n"
    "- \"stress_faible\"  : filtrer les arbres en stress faible.\n"
    "- \"stress_aucun\"   : afficher les arbres sans stress.\n\n"

    "RÈGLES IMPORTANTES :\n"
    "1. N'utilise JAMAIS d'autres valeurs d'action que celles listées ci-dessus.\n"
    "2. N'ajoute pas de formatage Markdown (pas de ```json) à l'intérieur de la balise <map_action>.\n"
    "3. Ne mentionne pas explicitement la balise, dis simplement que tu as mis à jour la carte.\n"
    "4. N'inclus ce bloc JSON que si la demande porte explicitement sur la visualisation d'arbres "
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
