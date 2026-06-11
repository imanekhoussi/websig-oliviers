import { useState } from 'react'
import { LuSlidersHorizontal, LuRotateCcw, LuX } from 'react-icons/lu'
import { LuRuler, LuDroplet } from 'react-icons/lu'

function DualRange({ min, max, lo, hi, step = 0.05, onLoChange, onHiChange }) {
  const loPct = max > min ? ((lo - min) / (max - min)) * 100 : 0
  const hiPct = max > min ? ((hi - min) / (max - min)) * 100 : 100
  return (
    <div
      className="fb-dual-range"
      style={{ '--lo': `${loPct}%`, '--hi': `${hiPct}%` }}
    >
      <input
        type="range" className="fb-thumb fb-thumb-lo"
        min={min} max={max} step={step} value={lo}
        onChange={e => onLoChange(parseFloat(e.target.value))}
      />
      <input
        type="range" className="fb-thumb fb-thumb-hi"
        min={min} max={max} step={step} value={hi}
        onChange={e => onHiChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

export default function MapFilterBar({
  filterCwsi,
  onCwsiChange,
  cwsiRange = [0, 1],
  filterHauteur,
  onHauteurChange,
  hauteurRange = [0, 20],
  filterCirc,
  onCircChange,
  circRange = [0, 400],
  onReset,
  filteredCount = 0,
  totalCount = 0,
}) {
  const [open, setOpen] = useState(false)

  const activeCount =
    (filterCwsi    ? 1 : 0) +
    (filterHauteur ? 1 : 0) +
    (filterCirc    ? 1 : 0)

  const [cwsiLo, cwsiHi] = filterCwsi    ?? cwsiRange
  const [hautLo, hautHi] = filterHauteur ?? hauteurRange
  const [circLo, circHi] = filterCirc    ?? circRange

  function handleCwsiLo(val) {
    const lo = Math.min(+val.toFixed(2), cwsiHi - 0.05)
    if (lo <= cwsiRange[0] && cwsiHi >= cwsiRange[1]) onCwsiChange(null)
    else onCwsiChange([lo, cwsiHi])
  }
  function handleCwsiHi(val) {
    const hi = Math.max(+val.toFixed(2), cwsiLo + 0.05)
    if (cwsiLo <= cwsiRange[0] && hi >= cwsiRange[1]) onCwsiChange(null)
    else onCwsiChange([cwsiLo, hi])
  }

  function handleHautLo(val) {
    const lo = Math.min(+val.toFixed(1), hautHi - 0.1)
    if (lo <= hauteurRange[0] && hautHi >= hauteurRange[1]) onHauteurChange(null)
    else onHauteurChange([lo, hautHi])
  }
  function handleHautHi(val) {
    const hi = Math.max(+val.toFixed(1), hautLo + 0.1)
    if (hautLo <= hauteurRange[0] && hi >= hauteurRange[1]) onHauteurChange(null)
    else onHauteurChange([hautLo, hi])
  }

  function handleCircLo(val) {
    const lo = Math.min(Math.round(val / 5) * 5, circHi - 5)
    if (lo <= circRange[0] && circHi >= circRange[1]) onCircChange(null)
    else onCircChange([lo, circHi])
  }
  function handleCircHi(val) {
    const hi = Math.max(Math.round(val / 5) * 5, circLo + 5)
    if (circLo <= circRange[0] && hi >= circRange[1]) onCircChange(null)
    else onCircChange([circLo, hi])
  }

  return (
    <div className="fb-pill-wrap">
      {open && (
        <div className="fb-pill-bar">

          {/* CWSI */}
          <div className="fb-pill-group">
            <div className="fb-pill-group-header">
              <span className="fb-pill-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <LuDroplet size={11} /> CWSI
              </span>
              <span className="fb-pill-vals">{cwsiLo.toFixed(2)} – {cwsiHi.toFixed(2)}</span>
            </div>
            <DualRange
              min={cwsiRange[0]} max={cwsiRange[1]} step={0.05}
              lo={cwsiLo} hi={cwsiHi}
              onLoChange={handleCwsiLo} onHiChange={handleCwsiHi}
            />
          </div>

          <div className="fb-pill-sep" />

          {/* Hauteur CHM */}
          <div className="fb-pill-group">
            <div className="fb-pill-group-header">
              <span className="fb-pill-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <LuRuler size={11} /> Hauteur (CHM)
              </span>
              <span className="fb-pill-vals">{hautLo.toFixed(1)} m – {hautHi.toFixed(1)} m</span>
            </div>
            <DualRange
              min={hauteurRange[0]} max={hauteurRange[1]} step={0.1}
              lo={hautLo} hi={hautHi}
              onLoChange={handleHautLo} onHiChange={handleHautHi}
            />
          </div>

          <div className="fb-pill-sep" />

          {/* Circonférence estimée */}
          <div className="fb-pill-group">
            <div className="fb-pill-group-header">
              <span className="fb-pill-label">Circonférence (est.)</span>
              <span className="fb-pill-vals">{circLo} cm – {circHi} cm</span>
            </div>
            <DualRange
              min={circRange[0]} max={circRange[1]} step={5}
              lo={circLo} hi={circHi}
              onLoChange={handleCircLo} onHiChange={handleCircHi}
            />
          </div>

          {/* Stats + actions */}
          <div className="fb-pill-actions">
            {totalCount > 0 && (
              <span className={`fb-pill-count${filteredCount === 0 && activeCount > 0 ? ' warn' : ''}`}>
                {filteredCount === 0 && activeCount > 0 ? '⚠ Aucun' : `${filteredCount}/${totalCount}`}
              </span>
            )}
            <button
              className="fb-pill-reset"
              onClick={() => { onReset(); setOpen(false) }}
              title="Réinitialiser les filtres"
            >
              <LuRotateCcw size={11} /> Réinitialiser
            </button>
            <button
              className="fb-pill-close"
              onClick={() => setOpen(false)}
              title="Fermer"
            >
              <LuX size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Bouton toggle */}
      <button
        className={`fb-pill-btn${open ? ' open' : ''}${activeCount > 0 ? ' has-filters' : ''}`}
        onClick={() => setOpen(v => !v)}
      >
        <LuSlidersHorizontal size={13} />
        <span>Filtres</span>
        {activeCount > 0 && <span className="fb-pill-badge">{activeCount}</span>}
      </button>
    </div>
  )
}
