import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip } from 'recharts'
import { STRESS_COLORS } from '../constants'

const SHORT_STRESS = { aucun: 'Aucun', faible: 'Faible', modere: 'Modéré', eleve: 'Élevé', severe: 'Sévère' }

const ALERT_LEVELS = [
  { min: 0.75, icon: '🚨', label: 'CRITIQUE',  color: '#dc2626', bg: 'rgba(220,38,38,0.10)',   border: 'rgba(220,38,38,0.35)' },
  { min: 0.50, icon: '⚠',  label: 'VIGILANCE', color: '#d97706', bg: 'rgba(217,119,6,0.10)',   border: 'rgba(217,119,6,0.35)' },
  { min: 0.35, icon: 'ℹ',  label: 'MODÉRÉ',    color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)' },
]

function getAlert(cwsi) {
  return ALERT_LEVELS.find(l => cwsi >= l.min) ?? null
}

function ScKpi({ label, value }) {
  return (
    <div className="sc-kpi-card">
      <div className="sc-kpi-value">{value}</div>
      <div className="sc-kpi-label">{label}</div>
    </div>
  )
}

export default function SummaryCard({ stats, mission, features, allFeatures, parcelSettings, yieldPredictions, onClose }) {
  const cwsiMoy = stats?.cwsi?.moyenne ?? null
  const total = stats?.total_arbres ?? 0
  const critiques = (stats?.stress_breakdown ?? [])
    .filter(s => s.classe === 'eleve' || s.classe === 'severe')
    .reduce((n, s) => n + s.count, 0)
  const pctCritique = total > 0 ? Math.round((critiques / total) * 100) : 0

  const yieldAvg = useMemo(() => {
    if (!yieldPredictions) return null
    const vals = Object.values(yieldPredictions).filter(v => v != null)
    if (!vals.length) return null
    return vals.reduce((s, v, _, a) => s + v / a.length, 0)
  }, [yieldPredictions])

  const top3 = useMemo(() => {
    return [...(allFeatures ?? features ?? [])]
      .filter(f => f.properties.cwsi != null)
      .sort((a, b) => b.properties.cwsi - a.properties.cwsi)
      .slice(0, 3)
  }, [allFeatures, features])

  const donutData = useMemo(() => {
    return (stats?.stress_breakdown ?? [])
      .filter(s => s.count > 0)
      .map(s => ({ name: SHORT_STRESS[s.classe] ?? s.classe, value: s.count, color: s.color }))
  }, [stats])

  const alert = cwsiMoy != null ? getAlert(cwsiMoy) : null
  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="sc-page">

      {/* ── Header ── */}
      <div className="sc-header">
        <div>
          <div className="sc-brand">🌿 GeoOlive — WebSIG Oliviers</div>
          <div className="sc-subtitle">
            Fiche de synthèse · {mission?.nom || mission?.id || '—'} · {mission?.date || '—'}
          </div>
        </div>
        <div className="sc-header-meta">Drone Globe × FST Tanger</div>
      </div>
      <hr className="sc-divider" />

      {/* ── KPIs + Donut ── */}
      <div className="sc-kpi-row">
        <div className="sc-kpis">
          <ScKpi label="ARBRES" value={total} />
          <ScKpi label="CWSI MOY" value={cwsiMoy != null ? cwsiMoy.toFixed(2) : '—'} />
          <ScKpi label="CRITIQUE" value={`${pctCritique}%`} />
          <ScKpi label="RENDEMENT" value={yieldAvg != null ? `${yieldAvg.toFixed(1)} kg` : '—'} />
        </div>
        <div className="sc-donut-wrap">
          <PieChart width={130} height={110}>
            <Pie
              data={donutData}
              cx={65}
              cy={55}
              innerRadius={30}
              outerRadius={50}
              dataKey="value"
              stroke="none"
            >
              {donutData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name) => [`${value} arbres`, name]}
              contentStyle={{ fontSize: 10, padding: '4px 8px' }}
            />
          </PieChart>
          <div className="sc-donut-legend">
            {donutData.map((d, i) => (
              <div key={i} className="sc-donut-legend-item">
                <span className="sc-donut-dot" style={{ background: d.color }} />
                <span className="sc-donut-legend-name">{d.name}</span>
                <span className="sc-donut-count">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Top 3 arbres critiques ── */}
      {top3.length > 0 && (
        <>
          <div className="sc-section-title">TOP 3 ARBRES CRITIQUES</div>
          <table className="sc-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>CWSI</th>
                <th>Stress</th>
                <th>Temp °C</th>
                <th>Hauteur m</th>
              </tr>
            </thead>
            <tbody>
              {top3.map((f, i) => {
                const p = f.properties
                const stressColor = STRESS_COLORS[p.stress] ?? '#94a3b8'
                return (
                  <tr key={i}>
                    <td>{p.id ?? '—'}</td>
                    <td>{p.cwsi?.toFixed(2) ?? '—'}</td>
                    <td>
                      <span
                        className="sc-stress-badge"
                        style={{
                          background: stressColor + '20',
                          color: stressColor,
                          border: `1px solid ${stressColor}60`,
                        }}
                      >
                        {SHORT_STRESS[p.stress] ?? p.stress ?? '—'}
                      </span>
                    </td>
                    <td>{p.temp_moy?.toFixed(1) ?? '—'}</td>
                    <td>{p.hauteur?.toFixed(1) ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      {/* ── Footer ── */}
      <div className="sc-footer">
        <div className="sc-footer-left">
          {alert && cwsiMoy != null && (
            <span
              className="sc-alert-badge"
              style={{ background: alert.bg, color: alert.color, border: `1px solid ${alert.border}` }}
            >
              {alert.icon} CWSI {cwsiMoy.toFixed(2)} — {alert.label}
            </span>
          )}
        </div>
        <div className="sc-footer-right">
          <span className="sc-footer-meta">Généré le {today}</span>
          <span className="sc-footer-meta sc-footer-brand">GeoOlive v2.0</span>
        </div>
      </div>

      {/* ── Actions (no-print) ── */}
      <div className="sc-actions sc-no-print">
        <button className="sc-btn" onClick={() => window.print()}>🖨 Imprimer</button>
        <button className="sc-btn sc-btn-close" onClick={onClose}>✕ Fermer</button>
      </div>

    </div>
  )
}
