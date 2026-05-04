import { useState, useEffect, useRef } from 'react'
import { LuFilter, LuX, LuSlidersHorizontal, LuChevronDown, LuRotateCcw } from 'react-icons/lu'

/**
 * CriterionRow — une ligne de filtre :
 *   label + indicateur "actif" en haut,
 *   deux inputs [MIN / MAX] côte à côte en dessous via CSS grid.
 *
 * Le commit se fait à la perte de focus (onBlur) → aucun re-render pendant
 * la frappe, ce qui équivaut à un debounce naturel même sur de gros datasets.
 */
function CriterionRow({ label, unit, globalMin, globalMax, value, onChange, precision = 1 }) {
  const fmt  = v => String(+Number(v).toFixed(precision))
  const step = precision >= 2 ? 0.01 : 0.1

  const [loStr, setLoStr] = useState(fmt(value?.[0] ?? globalMin))
  const [hiStr, setHiStr] = useState(fmt(value?.[1] ?? globalMax))

  useEffect(() => {
    setLoStr(fmt(value?.[0] ?? globalMin))
    setHiStr(fmt(value?.[1] ?? globalMax))
  }, [value, globalMin, globalMax]) // eslint-disable-line react-hooks/exhaustive-deps

  function commitLo(raw) {
    const lo = Math.max(globalMin, Math.min(parseFloat(raw) || globalMin, parseFloat(hiStr) - step))
    const hi = parseFloat(hiStr)
    setLoStr(fmt(lo))
    if (lo <= globalMin && hi >= globalMax) onChange(null)
    else onChange([+lo.toFixed(precision), +hi.toFixed(precision)])
  }

  function commitHi(raw) {
    const lo = parseFloat(loStr)
    const hi = Math.min(globalMax, Math.max(parseFloat(raw) || globalMax, lo + step))
    setHiStr(fmt(hi))
    if (lo <= globalMin && hi >= globalMax) onChange(null)
    else onChange([+lo.toFixed(precision), +hi.toFixed(precision)])
  }

  const isActive = value !== null && value !== undefined

  return (
    <div className="mfo-criterion">

      {/* Label row */}
      <div className="mfo-criterion-header">
        <span className="mfo-criterion-label">{label}</span>
        <div className="mfo-criterion-meta">
          {unit && <span className="mfo-criterion-unit">{unit}</span>}
          {isActive && <span className="mfo-criterion-dot" title="Filtre actif" />}
        </div>
      </div>

      {/* Inputs grid : MIN  –  MAX */}
      <div className="mfo-criterion-inputs">
        <input
          type="number"
          className="mfo-input"
          placeholder="MIN"
          value={loStr}
          step={step}
          onChange={e => setLoStr(e.target.value)}
          onBlur={e  => commitLo(e.target.value)}
          aria-label={`${label} minimum`}
        />
        <span className="mfo-input-sep" aria-hidden>–</span>
        <input
          type="number"
          className="mfo-input"
          placeholder="MAX"
          value={hiStr}
          step={step}
          onChange={e => setHiStr(e.target.value)}
          onBlur={e  => commitHi(e.target.value)}
          aria-label={`${label} maximum`}
        />
      </div>

    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────── */

export default function MapFilterOverlay({
  dataRanges,
  filterHauteur,
  filterTemp,
  filterCwsi,
  onHauteurChange,
  onTempChange,
  onCwsiChange,
  onReset,
  filteredCount = 0,
  totalCount    = 0,
}) {
  const [open, setOpen]   = useState(false)
  const containerRef      = useRef(null)

  const activeCount = [filterHauteur, filterTemp, filterCwsi].filter(Boolean).length
  const isFiltered  = activeCount > 0
  const noResults   = isFiltered && filteredCount === 0

  // Ferme le popover sur clic extérieur
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target))
        setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <>
      {/* ── Conteneur principal (trigger + popover) ── */}
      <div ref={containerRef} className="mfo-container">

        {/* Bouton déclencheur */}
        <button
          className={`mfo-trigger${isFiltered ? ' active' : ''}${open ? ' open' : ''}`}
          onClick={() => setOpen(v => !v)}
          title="Filtres croisés : hauteur, température, CWSI"
        >
          <LuFilter size={12} />
          <span className="mfo-trigger-label">
            {isFiltered ? `Filtres (${activeCount})` : 'Filtres'}
          </span>
          <LuChevronDown size={11} className="mfo-chevron" />
        </button>

        {/* Popover — 284 px fixe, ancré en haut à droite du conteneur */}
        {open && (
          <div className="mfo-popover" role="dialog" aria-label="Filtres cross-critères">

            {/* En-tête */}
            <div className="mfo-popover-header">
              <span className="mfo-popover-title">
                <LuSlidersHorizontal size={12} />
                Filtres cross-critères
              </span>
              <button
                className="mfo-popover-close"
                onClick={() => setOpen(false)}
                aria-label="Fermer le panneau de filtres"
              >
                <LuX size={12} />
              </button>
            </div>

            {/* Corps : trois critères séparés par des règles fines */}
            <div className="mfo-popover-body">
              <CriterionRow
                label="Hauteur"    unit="m"
                globalMin={dataRanges.hauteur[0]}
                globalMax={dataRanges.hauteur[1]}
                value={filterHauteur}
                onChange={onHauteurChange}
                precision={1}
              />
              <CriterionRow
                label="Temp. moy." unit="°C"
                globalMin={dataRanges.temp[0]}
                globalMax={dataRanges.temp[1]}
                value={filterTemp}
                onChange={onTempChange}
                precision={1}
              />
              <CriterionRow
                label="CWSI"       unit=""
                globalMin={dataRanges.cwsi[0]}
                globalMax={dataRanges.cwsi[1]}
                value={filterCwsi}
                onChange={onCwsiChange}
                precision={2}
              />
            </div>

            {/* Pied : badge de résultats + bouton reset (seulement si filtre actif) */}
            {isFiltered && (
              <div className="mfo-popover-footer">
                <span className={`mfo-count-pill${noResults ? ' no-results' : ''}`}>
                  {noResults
                    ? '⚠ Aucun arbre'
                    : `${filteredCount} / ${totalCount} arbres`}
                </span>
                <button
                  className="mfo-reset-btn"
                  onClick={() => { onReset(); setOpen(false) }}
                >
                  <LuRotateCcw size={10} />
                  Réinitialiser
                </button>
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── Bandeau d'alerte centré en bas quand 0 résultat ── */}
      {noResults && (
        <div className="mfo-no-results" role="alert">
          <span className="mfo-no-results-icon">⚠</span>
          Aucun arbre ne correspond aux filtres actifs.
        </div>
      )}
    </>
  )
}
