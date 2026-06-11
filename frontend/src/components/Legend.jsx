import { STRESS_COLORS, STRESS_LABELS } from '../constants'

const NIVEAUX = ['aucun', 'faible', 'modere', 'eleve', 'severe']

export default function Legend({ activeStress, onToggle, visibleCount, stressCounts }) {
  const isInteractive = !!onToggle

  const countMap = stressCounts
    ? Object.fromEntries(stressCounts.map(s => [s.classe, s.count]))
    : null

  const total = countMap ? Object.values(countMap).reduce((s, v) => s + v, 0) : 0

  return (
    <div className="legend">
      <h4 className="legend-title">
        Stress hydrique
        <span className="legend-info-icon" aria-label="Source scientifique">
          ℹ️
          <span className="legend-info-tooltip">
            Classification basée sur la littérature scientifique : Sánchez-Piñero et al. (2022) et García-Tejero et al. (2017)
          </span>
        </span>
      </h4>

      {/* ── Barre empilée compacte ── */}
      {countMap && total > 0 && (
        <div className="legend-stacked-bar">
          {NIVEAUX.map(k => {
            const count = countMap[k] ?? 0
            const pct = (count / total) * 100
            if (pct < 0.5) return null
            return (
              <div
                key={k}
                className="legend-stacked-segment"
                style={{ width: `${pct}%`, background: STRESS_COLORS[k] }}
                title={`${STRESS_LABELS[k]} : ${count} (${pct.toFixed(0)}%)`}
              />
            )
          })}
        </div>
      )}

      <div className="legend-items">
        {NIVEAUX.map(k => {
          const active = !isInteractive || activeStress?.includes(k)
          const count  = countMap?.[k] ?? 0
          const pct    = total > 0 ? ((count / total) * 100).toFixed(0) : 0
          return (
            <div
              key={k}
              className={`legend-item${active ? '' : ' inactive'}`}
              onClick={isInteractive ? () => onToggle(k) : undefined}
              role={isInteractive ? 'checkbox' : undefined}
              aria-checked={isInteractive ? active : undefined}
              tabIndex={isInteractive ? 0 : undefined}
              onKeyDown={isInteractive ? e => e.key === 'Enter' && onToggle(k) : undefined}
            >
              <span className="swatch" style={{ background: STRESS_COLORS[k] }} />
              <span className="legend-item-label">{STRESS_LABELS[k]}</span>
              {countMap && (
                <span className="legend-item-count">
                  {count}
                  {total > 0 && <span className="legend-item-pct"> {pct}%</span>}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {isInteractive && visibleCount != null && (
        <div className="legend-count">
          <b>{visibleCount}</b> arbre{visibleCount !== 1 ? 's' : ''} visibles
        </div>
      )}
    </div>
  )
}
