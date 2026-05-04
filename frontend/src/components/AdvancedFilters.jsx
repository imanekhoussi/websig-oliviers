import { useState, useEffect } from 'react'
import { LuX } from 'react-icons/lu'

/**
 * NumericRange — Deux champs number (Min / Max) pour filtrer un critère continu.
 *
 * UX : l'utilisateur saisit librement, le filtre s'applique sur blur (perte de focus).
 * Si lo/hi couvre exactement la plage complète [globalMin, globalMax],
 * onChange est appelé avec null → le filtre revient à "inactif".
 */
function NumericRange({ label, unit, globalMin, globalMax, value, onChange }) {
  // État local en string pour permettre la saisie partielle (ex: "1" avant "15")
  const [loStr, setLoStr] = useState(String(value?.[0] ?? globalMin))
  const [hiStr, setHiStr] = useState(String(value?.[1] ?? globalMax))

  // Synchronise l'affichage si la valeur change depuis l'extérieur (ex: reset)
  useEffect(() => {
    setLoStr(String(value?.[0] ?? globalMin))
    setHiStr(String(value?.[1] ?? globalMax))
  }, [value, globalMin, globalMax])

  function commitLo(raw) {
    const lo = Math.max(globalMin, Math.min(parseFloat(raw) || globalMin, parseFloat(hiStr) - 0.1))
    const hi = parseFloat(hiStr)
    setLoStr(String(+lo.toFixed(1)))
    // Si l'intervalle couvre la totalité de la plage → filtre inactif
    if (lo <= globalMin && hi >= globalMax) onChange(null)
    else onChange([+lo.toFixed(1), +hi.toFixed(1)])
  }

  function commitHi(raw) {
    const lo = parseFloat(loStr)
    const hi = Math.min(globalMax, Math.max(parseFloat(raw) || globalMax, lo + 0.1))
    setHiStr(String(+hi.toFixed(1)))
    if (lo <= globalMin && hi >= globalMax) onChange(null)
    else onChange([+lo.toFixed(1), +hi.toFixed(1)])
  }

  return (
    <div className="af-range-row">
      <span className="af-range-label">{label}</span>
      <div className="af-num-pair">
        <div className="af-num-field">
          <span className="af-num-tag">Min</span>
          <input
            type="number"
            className="af-num-input"
            value={loStr}
            step="0.1"
            onChange={e => setLoStr(e.target.value)}
            onBlur={e  => commitLo(e.target.value)}
          />
          <span className="af-num-unit">{unit}</span>
        </div>
        <span className="af-num-sep">–</span>
        <div className="af-num-field">
          <span className="af-num-tag">Max</span>
          <input
            type="number"
            className="af-num-input"
            value={hiStr}
            step="0.1"
            onChange={e => setHiStr(e.target.value)}
            onBlur={e  => commitHi(e.target.value)}
          />
          <span className="af-num-unit">{unit}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * AdvancedFilters — Contenu du popover de filtres spatiaux.
 *
 * Ce composant est "headless" : il n'a plus de logique open/close.
 * La gestion du popover (ouverture, fermeture, positionnement) est entièrement
 * déléguée à App.jsx, qui rend ce composant dans une div à position: fixed.
 *
 * Props :
 *   dataRanges      { hauteur: [min,max], temp: [min,max] }
 *   filterHauteur   [min,max] | null
 *   filterTemp      [min,max] | null
 *   onHauteurChange ([min,max] | null) => void
 *   onTempChange    ([min,max] | null) => void
 *   onReset         () => void
 */
export default function AdvancedFilters({
  dataRanges,
  filterHauteur,
  filterTemp,
  onHauteurChange,
  onTempChange,
  onReset,
}) {
  const isActive = filterHauteur !== null || filterTemp !== null

  return (
    <div className="af-content">

      <NumericRange
        label="Hauteur"
        unit="m"
        globalMin={dataRanges.hauteur[0]}
        globalMax={dataRanges.hauteur[1]}
        value={filterHauteur}
        onChange={onHauteurChange}
      />

      <NumericRange
        label="Temp. moy."
        unit="°C"
        globalMin={dataRanges.temp[0]}
        globalMax={dataRanges.temp[1]}
        value={filterTemp}
        onChange={onTempChange}
      />

      {isActive && (
        <button className="af-reset" onClick={onReset}>
          <LuX size={11} /> Réinitialiser
        </button>
      )}

    </div>
  )
}
