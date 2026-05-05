import { LuDroplets, LuRuler } from 'react-icons/lu'

export default function MCDAPanel({ weightStress, weightHeight, onChange }) {
  return (
    <div className="mcda-panel">
      <p className="mcda-description">
        Modélisation AHP : Équilibrez l'importance relative des critères.
        Le système verrouille automatiquement la somme à 100 %.
      </p>

      <div className="mcda-slider-row">
        <div className="mcda-slider-meta">
          <span className="mcda-criterion-label">
            <LuDroplets size={14} style={{ color: 'var(--primary)' }} />
            Stress hydrique
          </span>
          <span className="mcda-pct">{weightStress} %</span>
        </div>
        <input
          type="range" min={0} max={100} value={weightStress}
          onChange={e => { const v = Number(e.target.value); onChange(v, 100 - v) }}
          className="mcda-range"
        />
      </div>

      <div className="mcda-slider-row">
        <div className="mcda-slider-meta">
          <span className="mcda-criterion-label">
            <LuRuler size={14} style={{ color: 'var(--text-muted)' }} />
            Vulnérabilité hauteur
          </span>
          <span className="mcda-pct">{weightHeight} %</span>
        </div>
        <input
          type="range" min={0} max={100} value={weightHeight}
          onChange={e => { const v = Number(e.target.value); onChange(100 - v, v) }}
          className="mcda-range"
        />
      </div>

      <div className="mcda-legend-row">
        <span className="mcda-legend-label">Indice de vulnérabilité</span>
        <div className="mcda-gradient-bar" />
        <div className="mcda-gradient-ticks">
          <span>0 – Faible</span>
          <span>100 – Critique</span>
        </div>
      </div>
    </div>
  )
}
