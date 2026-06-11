import { useState, useEffect, useRef } from 'react'
import { LuChevronDown, LuCheck } from 'react-icons/lu'

export default function MissionSelector({ missions, currentId, onSelect }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = missions.find(m => m.id === currentId)

  useEffect(() => {
    if (!open) return
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="ms-wrap">
      <button
        className={`ms-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Changer de mission"
      >
        {current ? (
          <span className="ms-trigger-content">
            <span className="ms-trigger-date">{current.date}</span>
            <span className="ms-trigger-name">{current.nom || current.id}</span>
            <span className={`ms-badge${current.has_shapefile ? ' ms-badge--ok' : ' ms-badge--warn'}`}>
              {current.has_shapefile ? 'TERMINÉE' : 'SANS DONNÉES'}
            </span>
          </span>
        ) : (
          <span className="ms-placeholder">— Sélectionner une mission —</span>
        )}
        <LuChevronDown
          size={12}
          className="ms-chevron"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.18s' }}
        />
      </button>

      {open && (
        <div className="ms-menu">
          {missions.length === 0 && (
            <div className="ms-empty">Aucune mission disponible</div>
          )}
          {missions.map(m => (
            <button
              key={m.id}
              className={`ms-option${m.id === currentId ? ' active' : ''}`}
              onClick={() => { onSelect(m.id); setOpen(false) }}
            >
              <div className="ms-option-row">
                <span className="ms-option-date">{m.date}</span>
                <span className={`ms-badge ms-badge--sm${m.has_shapefile ? ' ms-badge--ok' : ' ms-badge--warn'}`}>
                  {m.has_shapefile ? 'TERMINÉE' : 'SANS DONNÉES'}
                </span>
              </div>
              <div className="ms-option-name">{m.nom || m.id}</div>
              {m.id === currentId && (
                <LuCheck size={11} className="ms-option-check" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
