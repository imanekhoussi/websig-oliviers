import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import { fetchAiAdvice } from '../api'
import { LuX, LuLeaf } from 'react-icons/lu'

// ── Stades correspondant aux valeurs retournées par guessPhenologicalStage ──
const STADES = [
  'Développement des grappes',
  'Floraison / Nouaison',
  'Grossissement du fruit / Durcissement du noyau',
  'Véraison',
  'Maturation / Repos végétatif',
]

const SOLS = [
  'Argileux',
  'Argilo-limoneux',
  'Limoneux',
  'Sablo-limoneux',
  'Sableux',
  'Calcaire',
]

const VERGERS = [
  'Irrigué (goutte-à-goutte)',
  'Irrigué (aspersion)',
  'Bour (pluvial)',
  'Intensif',
  'Super-intensif',
]

const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

/**
 * Déduit le stade phénologique probable de l'olivier (Maroc / climat méditerranéen)
 * à partir d'une date au format "YYYY-MM-DD".
 */
function guessPhenologicalStage(dateString) {
  const month = parseInt(dateString?.split('-')[1], 10)
  if (month >= 3 && month <= 4)  return 'Développement des grappes'
  if (month >= 5 && month <= 6)  return 'Floraison / Nouaison'
  if (month >= 7 && month <= 8)  return 'Grossissement du fruit / Durcissement du noyau'
  if (month >= 9 && month <= 10) return 'Véraison'
  return 'Maturation / Repos végétatif'           // Nov–Fév
}

/** Retourne le nom du mois en français depuis "YYYY-MM-DD". */
function monthName(dateString) {
  const month = parseInt(dateString?.split('-')[1], 10)
  return MOIS_FR[month - 1] ?? ''
}

export default function AiAdvisorModal({ mission, onClose }) {
  const [stadePhe,   setStagePhe]   = useState(() => guessPhenologicalStage(mission.date))
  const [typeSol,    setTypeSol]    = useState('Argilo-limoneux')
  const [typeVerger, setTypeVerger] = useState('Irrigué (goutte-à-goutte)')
  const [advice,  setAdvice]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)

  // Recalcule le stade si la mission change (cas de rerendermodale réutilisée)
  useEffect(() => {
    setStagePhe(guessPhenologicalStage(mission.date))
    setAdvice(null)
    setError(null)
  }, [mission.id])

  async function handleGenerate() {
    setLoading(true)
    setAdvice(null)
    setError(null)
    try {
      const data = await fetchAiAdvice(mission.id, {
        stade_pheno:  stadePhe,
        type_sol:     typeSol,
        type_verger:  typeVerger,
      })
      setAdvice(data.advice)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="aia-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="aia-panel">

        {/* ── Header ── */}
        <div className="aia-header">
          <div className="aia-title">
            <span className="aia-title-icon">✨</span>
            Conseil Agronomique IA
          </div>
          <button className="aia-close" onClick={onClose} aria-label="Fermer">
            <LuX size={15} />
          </button>
        </div>

        <div className="aia-body">

          {/* ── Formulaire de contexte ── */}
          <div className="aia-form">
            <p className="aia-mission-tag">
              {mission.nom || mission.id} · {mission.date}
            </p>

            <div className="aia-fields">

              {/* Stade phénologique — auto-détecté + modifiable */}
              <div className="aia-field">
                <label className="aia-label">Stade phénologique</label>
                <div className="aia-auto-hint">
                  💡 Déduit d'après la date du vol (Mois de {monthName(mission.date)})
                </div>
                <select
                  className="aia-select"
                  value={stadePhe}
                  onChange={e => setStagePhe(e.target.value)}
                >
                  {STADES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="aia-field">
                <label className="aia-label">Type de sol</label>
                <select className="aia-select" value={typeSol} onChange={e => setTypeSol(e.target.value)}>
                  {SOLS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="aia-field">
                <label className="aia-label">Type de verger</label>
                <select className="aia-select" value={typeVerger} onChange={e => setTypeVerger(e.target.value)}>
                  {VERGERS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>

            </div>

            <button
              className="aia-generate-btn"
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading
                ? <><span className="aia-spinner" /> Analyse en cours…</>
                : <>✨ Générer le bulletin agronomique</>
              }
            </button>

            {error && <p className="aia-error">⚠ {error}</p>}
          </div>

          {/* ── Résultat Markdown ── */}
          {advice && (
            <div className="aia-result">
              <div className="aia-result-header">
                <LuLeaf size={13} />
                <span>Bulletin · LLaMA 3.3 70B via Groq</span>
                <span className="aia-result-context">
                  {stadePhe} · {typeSol} · {typeVerger}
                </span>
              </div>
              <div className="aia-markdown">
                <ReactMarkdown>{advice}</ReactMarkdown>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
