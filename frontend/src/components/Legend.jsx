import { STRESS_COLORS, STRESS_LABELS } from '../constants'

const NIVEAUX = ['aucun', 'faible', 'modere', 'eleve', 'severe']

export default function Legend({ activeStress, onToggle, visibleCount, stressCounts }) {
  const isInteractive = !!onToggle

  // Transforme le tableau stress_breakdown en map { classe → count } pour lookup O(1)
  const countMap = stressCounts
    ? Object.fromEntries(stressCounts.map(s => [s.classe, s.count]))
    : null

  return (
    <div className="legend">
      <h4 className="legend-title">Stress hydrique</h4>

      <div className="legend-items">
        {NIVEAUX.map(k => {
          const active = !isInteractive || activeStress?.includes(k)
          const count  = countMap?.[k] ?? 0
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
                <span className="legend-item-count">{count}</span>
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
