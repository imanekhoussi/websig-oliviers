import { useState } from 'react'
import { LuX, LuDownload, LuFileSpreadsheet, LuFileText, LuCheck } from 'react-icons/lu'
import { exportXlsxUrl, exportPdfUrl } from '../api'

const COLUMNS = [
  { id: 'id',     label: 'ID arbre',          always: true },
  { id: 'cwsi',   label: 'CWSI',              always: false },
  { id: 'classe', label: 'Classe de stress',  always: false },
  { id: 'chm',    label: 'Hauteur CHM (m)',   always: false },
  { id: 'temp',   label: 'Température (°C)',  always: false },
]

export default function ExportModal({ mission, selectedTreeIds = null, onClose }) {
  const [cols, setCols] = useState({
    id: true, cwsi: true, classe: true, chm: true, temp: true,
  })

  function toggle(id) {
    setCols(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const activeCols = COLUMNS.filter(c => c.always || cols[c.id]).map(c => c.id)

  function buildXlsxUrl() {
    let url = exportXlsxUrl(mission?.id, selectedTreeIds)
    if (activeCols.length < COLUMNS.length) {
      const sep = url.includes('?') ? '&' : '?'
      url += `${sep}columns=${activeCols.join(',')}`
    }
    return url
  }

  if (!mission) return null

  return (
    <div className="em-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="em-modal">

        <div className="em-header">
          <span className="em-header-title">
            <LuDownload size={15} /> Extraire les données
          </span>
          <button className="em-close" onClick={onClose}>
            <LuX size={14} />
          </button>
        </div>

        <div className="em-body">
          <div className="em-section-label">Mission</div>
          <div className="em-mission-info">
            <span className="em-mission-name">{mission.nom || mission.id}</span>
            <span className="em-mission-date">{mission.date}</span>
            {selectedTreeIds && (
              <span className="em-selection-pill">
                Sélection · {selectedTreeIds.length} arbres
              </span>
            )}
          </div>

          <div className="em-section-label" style={{ marginTop: 18 }}>
            Colonnes à inclure
          </div>
          <div className="em-cols-grid">
            {COLUMNS.map(col => (
              <label
                key={col.id}
                className={`em-col-label${cols[col.id] ? ' checked' : ''}${col.always ? ' disabled' : ''}`}
              >
                <span className={`em-col-check${cols[col.id] ? ' on' : ''}`}>
                  {cols[col.id] && <LuCheck size={9} />}
                </span>
                <input
                  type="checkbox"
                  checked={cols[col.id]}
                  disabled={col.always}
                  onChange={() => !col.always && toggle(col.id)}
                  style={{ display: 'none' }}
                />
                {col.label}
                {col.always && <span className="em-col-always">obligatoire</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="em-footer">
          <a
            href={buildXlsxUrl()}
            download
            className="em-btn em-btn--excel"
            onClick={onClose}
          >
            <LuFileSpreadsheet size={14} />
            Exporter Excel
          </a>
          {!selectedTreeIds && (
            <a
              href={exportPdfUrl(mission.id)}
              download
              className="em-btn em-btn--pdf"
              onClick={onClose}
            >
              <LuFileText size={14} />
              Exporter PDF
            </a>
          )}
        </div>

      </div>
    </div>
  )
}
