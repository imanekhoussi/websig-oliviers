import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { fetchChat } from '../api'
import { LuX, LuSend, LuLeaf, LuBot } from 'react-icons/lu'

// ── Regex pour détecter le bloc agent <map_action>…</map_action> ──────────────
const MAP_ACTION_RE = /<map_action>([\s\S]*?)<\/map_action>/

function parseMapAction(rawText) {
  const m = rawText.match(MAP_ACTION_RE)
  if (!m) return { text: rawText, action: null }
  let action = null
  try { action = JSON.parse(m[1].trim()) } catch (_) {}
  const text = rawText.replace(MAP_ACTION_RE, '').trim()
  return { text, action }
}

// ── Labels des badges d'action ────────────────────────────────────────────────
const ACTION_BADGE_LABELS = {
  reset:            { icon: '🗺️', label: 'Carte réinitialisée' },
  stress_severe:    { icon: '🎯', label: 'Stress sévère mis en évidence' },
  stress_critique:  { icon: '🎯', label: 'Zones critiques mises en évidence' },
  stress_eleve:     { icon: '🎯', label: 'Stress élevé mis en évidence' },
  stress_modere:    { icon: '🎯', label: 'Stress modéré mis en évidence' },
  stress_faible:    { icon: '🎯', label: 'Arbres faiblement stressés filtrés' },
  stress_aucun:     { icon: '✅', label: 'Arbres sains filtrés' },
  rendement_faible: { icon: '📉', label: 'Faible rendement mis en évidence' },
}

function getActionBadge(action) {
  if (!action) return null
  if (action.action === 'reset') return ACTION_BADGE_LABELS.reset
  return ACTION_BADGE_LABELS[action.type] ?? { icon: '🎯', label: 'Filtre appliqué' }
}

// ── Smart suggestions — toujours visibles au-dessus du champ ─────────────────
const SMART_SUGGESTIONS = [
  { emoji: '💧', label: 'Quels arbres irriguer en urgence ?' },
  { emoji: '📊', label: 'Analyse mon rendement prédit' },
  { emoji: '🌍', label: 'Remettre la vue globale' },
]

function dictAvg(dict) {
  if (!dict) return null
  const vals = Object.values(dict).filter(v => v != null && !isNaN(v))
  return vals.length ? +(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2) : null
}

// ── Badge d'action — affiché sous le texte de la bulle IA ────────────────────
function ActionBadge({ action }) {
  const badge = getActionBadge(action)
  if (!badge) return null
  const isReset = action.action === 'reset'
  return (
    <span className={`aia-action-badge ${isReset ? 'aia-action-badge--reset' : ''}`}>
      {badge.icon} {badge.label}
    </span>
  )
}

// ── Bulle de message individuelle ─────────────────────────────────────────────
function ChatBubble({ msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`aia-bubble-row ${isUser ? 'aia-bubble-row--user' : 'aia-bubble-row--ai'}`}>
      {!isUser && (
        <div className="aia-avatar">
          <LuBot size={14} />
        </div>
      )}
      <div className={`aia-bubble ${isUser ? 'aia-bubble--user' : 'aia-bubble--ai'}`}>
        {isUser
          ? <span>{msg.content}</span>
          : (
            <>
              <div className="aia-markdown"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
              {msg.action && <ActionBadge action={msg.action} />}
            </>
          )
        }
      </div>
    </div>
  )
}

// ── Suggestions écran vide (contextuel, remplit le champ sans envoyer) ────────
const EMPTY_SUGGESTIONS = [
  'Quel est le risque pour le rendement actuel ?',
  'Quels arbres irriguer en priorité ?',
  "Quelle dose d'eau recommandes-tu cette semaine ?",
]

// ── Composant principal ───────────────────────────────────────────────────────
export default function AiAdvisorModal({
  mission,
  onClose,
  stats,
  yieldPredictions,
  messages,
  setMessages,
  onMapAction = null,
}) {
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const bottomRef = useRef(null)
  const inputRef  = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => { inputRef.current?.focus() }, [])

  function buildContextData() {
    return {
      mission_name:    mission?.nom || mission?.id || null,
      mission_date:    mission?.date || null,
      total_arbres:    stats?.total_arbres ?? null,
      cwsi_moyen:      stats?.cwsi?.moyenne ?? null,
      rendement_moyen: dictAvg(yieldPredictions),
    }
  }

  // Fonction centrale d'envoi — accepte le texte directement (chips + textarea)
  async function sendMessage(text) {
    if (!text || loading) return

    const userMsg     = { role: 'user', content: text }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const { reply } = await fetchChat(nextMessages, buildContextData())
      const { text: cleanText, action } = parseMapAction(reply)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: cleanText, action: action ?? null },
      ])
      if (action) onMapAction?.(action)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleSend()        { sendMessage(input.trim()) }
  function handleChip(text)    { sendMessage(text) }
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const yieldAvg = dictAvg(yieldPredictions)

  return (
    <div className="aia-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="aia-panel aia-panel--chat">

        {/* ── Header ── */}
        <div className="aia-header">
          <div className="aia-title">
            <span className="aia-title-icon">🌿</span>
            Agronome IA — Chat expert
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {mission && (
              <span className="aia-mission-tag" style={{ margin: 0 }}>
                {mission.nom || mission.id} · {mission.date}
              </span>
            )}
            <button className="aia-close" onClick={onClose} aria-label="Fermer">
              <LuX size={15} />
            </button>
          </div>
        </div>

        {/* ── Bande de contexte ── */}
        {stats && (
          <div className="aia-context-bar">
            <LuLeaf size={11} />
            <span>
              Contexte actif ·{' '}
              {stats.total_arbres != null && `${stats.total_arbres} arbres`}
              {stats.cwsi?.moyenne != null && ` · CWSI moy. ${stats.cwsi.moyenne.toFixed(3)}`}
              {yieldAvg != null && ` · Rendement prédit ${yieldAvg} kg/arbre`}
            </span>
          </div>
        )}

        {/* ── Zone de chat ── */}
        <div className="aia-chat-body">

          {/* Écran vide */}
          {messages.length === 0 && (
            <div className="aia-chat-empty">
              <div className="aia-chat-empty-icon">🌿</div>
              <p className="aia-chat-empty-title">Agronome IA prêt</p>
              <p className="aia-chat-empty-hint">
                Posez vos questions sur le stress hydrique, l'irrigation ou le rendement.<br />
                Je connais déjà l'état de votre parcelle.
              </p>
              <div className="aia-chat-suggestions">
                {EMPTY_SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    className="aia-suggestion-chip"
                    onClick={() => { setInput(s); inputRef.current?.focus() }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Historique des messages */}
          {messages.map((msg, i) => <ChatBubble key={i} msg={msg} />)}

          {/* Indicateur de chargement */}
          {loading && (
            <div className="aia-bubble-row aia-bubble-row--ai">
              <div className="aia-avatar"><LuBot size={14} /></div>
              <div className="aia-bubble aia-bubble--ai aia-bubble--thinking">
                <span className="aia-thinking-dot" />
                <span className="aia-thinking-dot" />
                <span className="aia-thinking-dot" />
                <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  L'IA réfléchit…
                </span>
              </div>
            </div>
          )}

          {error && <div className="aia-chat-error">⚠ {error}</div>}
          <div ref={bottomRef} />
        </div>

        {/* ── Smart suggestions — raccourcis rapides toujours visibles ── */}
        <div className="aia-smart-chips">
          {SMART_SUGGESTIONS.map(({ emoji, label }) => (
            <button
              key={label}
              className="aia-smart-chip"
              onClick={() => handleChip(`${emoji} ${label}`)}
              disabled={loading}
              title={label}
            >
              {emoji} {label}
            </button>
          ))}
        </div>

        {/* ── Champ de saisie ── */}
        <div className="aia-chat-input-row">
          <textarea
            ref={inputRef}
            className="aia-chat-input"
            placeholder="Posez votre question agronomique… (Entrée pour envoyer)"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            disabled={loading}
          />
          <button
            className="aia-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || loading}
            aria-label="Envoyer"
          >
            <LuSend size={16} />
          </button>
        </div>

      </div>
    </div>
  )
}
