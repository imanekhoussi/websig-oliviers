import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid,
} from 'recharts'
import { STRESS_LABELS } from '../constants'
import { exportCsvUrl } from '../api'

/* Tooltip glassmorphism partagé */
function GlassTip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(8, 14, 26, 0.95)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(148, 163, 184, 0.2)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      color: '#f1f5f9',
      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      lineHeight: 1.6,
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 3 }}>{label}</div>
      {payload.map((entry, i) => (
        <div key={i}>
          <b>{formatter ? formatter(entry.value) : entry.value}</b>
        </div>
      ))}
    </div>
  )
}

function StressTip(props) {
  return <GlassTip {...props} formatter={v => `${v} arbre${v !== 1 ? 's' : ''}`} />
}

function CwsiTip(props) {
  return <GlassTip {...props} />
}

export default function StatsPanel({ stats, mission, statsCompare, missionCompare, isZonalActive = false, onClearZonal }) {
  const isCompare = !!(statsCompare && missionCompare)

  if (!mission) {
    return (
      <div className="panel">
        <div className="panel-empty">
          <span style={{ fontSize: 32, display: 'block', marginBottom: 8, opacity: 0.4 }}>📊</span>
          Sélectionnez ou créez une mission<br />pour voir les statistiques.
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="panel">
        <div className="panel-empty">Chargement des statistiques…</div>
      </div>
    )
  }

  return (
    <div className="panel">

      {/* ── Bannière sélection zonale ── */}
      {isZonalActive && (
        <div className="zonal-header">
          <div className="zonal-header-label">
            <span className="zonal-header-icon">📍</span>
            <span>Zone sélectionnée</span>
            <span className="zonal-header-count">{stats.total_arbres} arbre{stats.total_arbres !== 1 ? 's' : ''}</span>
          </div>
          <button className="btn-clear-zonal" onClick={onClearZonal}>
            Afficher la parcelle entière
          </button>
        </div>
      )}

      {/* ── Infos mission ── */}
      <div className="mission-info">
        <div className="mission-info-header">
          <div>
            <h2>{mission.nom || mission.id}</h2>
            <div className="mission-date">{mission.date}</div>
          </div>
          <a
            href={exportCsvUrl(mission.id)}
            download
            className="btn-export-csv"
            title="Télécharger le rapport CSV"
          >
            📥 CSV
          </a>
        </div>
        {mission.notes && <p className="notes">{mission.notes}</p>}
        {mission.meteo && (mission.meteo.temp_air != null || mission.meteo.humidite != null) && (
          <div className="meteo">
            {mission.meteo.temp_air  != null && <span>🌡️ {mission.meteo.temp_air}°C</span>}
            {mission.meteo.humidite  != null && <span>💧 {mission.meteo.humidite}%</span>}
            {mission.meteo.vent      != null && <span>💨 {mission.meteo.vent} m/s</span>}
          </div>
        )}
      </div>

      {/* ── KPIs (mode normal ou comparaison) ── */}
      {isCompare ? (
        <div className="kpis-compare">
          <div className="kpis-compare-col">
            <div className="kpis-compare-label">{mission.nom || mission.id}</div>
            <Kpi label="Arbres"    value={stats.total_arbres} />
            <Kpi label="CWSI moy." value={stats.cwsi.moyenne?.toFixed(2) ?? '—'} />
            <Kpi label="T° moy."   value={stats.temperature.moyenne != null ? `${stats.temperature.moyenne}°C` : '—'} />
          </div>
          <div className="kpis-compare-divider" />
          <div className="kpis-compare-col">
            <div className="kpis-compare-label">{missionCompare.nom || missionCompare.id}</div>
            <KpiDelta
              label="Arbres"
              value={statsCompare.total_arbres}
              delta={statsCompare.total_arbres - stats.total_arbres}
              neutral
            />
            <KpiDelta
              label="CWSI moy."
              value={statsCompare.cwsi.moyenne?.toFixed(2) ?? '—'}
              delta={statsCompare.cwsi.moyenne != null && stats.cwsi.moyenne != null
                ? statsCompare.cwsi.moyenne - stats.cwsi.moyenne
                : null}
              lowerIsBetter
            />
            <KpiDelta
              label="T° moy."
              value={statsCompare.temperature.moyenne != null ? `${statsCompare.temperature.moyenne}°C` : '—'}
              delta={statsCompare.temperature.moyenne != null && stats.temperature.moyenne != null
                ? statsCompare.temperature.moyenne - stats.temperature.moyenne
                : null}
              lowerIsBetter
            />
          </div>
        </div>
      ) : (
        <div className="kpis">
          <Kpi label="Arbres"    value={stats.total_arbres} />
          <Kpi label="CWSI moy." value={stats.cwsi.moyenne?.toFixed(2) ?? '—'} />
          <Kpi label="T° moy."   value={stats.temperature.moyenne != null ? `${stats.temperature.moyenne}°C` : '—'} />
        </div>
      )}

      {/* ── Répartition stress ── */}
      <h3>Répartition par stress</h3>
      <div style={{ width: '100%', height: 175 }}>
        <ResponsiveContainer>
          <BarChart
            data={stats.stress_breakdown.map(s => ({ ...s, label: STRESS_LABELS[s.classe] }))}
            margin={{ top: 6, right: 6, left: 20, bottom: 45 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.07)" vertical={false} />
            <XAxis
              dataKey="label" angle={-28} textAnchor="end"
              interval={0} fontSize={12}
              tick={{ fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
            />
            <YAxis
              fontSize={12}
              tick={{ fill: '#94a3b8' }}
              tickLine={false} axisLine={false}
              width={28}
            />
            <Tooltip content={<StressTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {stats.stress_breakdown.map((e, i) => (
                <Cell key={i} fill={e.color} fillOpacity={0.88} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Distribution CWSI ── */}
      <h3>Distribution CWSI</h3>
      <div style={{ width: '100%', height: 155 }}>
        <ResponsiveContainer>
          <BarChart
            data={stats.histogram_cwsi}
            margin={{ top: 6, right: 6, left: -10, bottom: 30 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.07)" vertical={false} />
            <XAxis
              dataKey="bin" fontSize={11} angle={-45} textAnchor="end"
              interval={0}
              tick={{ fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
            />
            <YAxis
              fontSize={12}
              tick={{ fill: '#94a3b8' }}
              tickLine={false} axisLine={false}
              width={28}
            />
            <Tooltip content={<CwsiTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Bar dataKey="count" fill="#38bdf8" fillOpacity={0.8} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Plages ── */}
      <div className="range-info">
        <small>
          CWSI : {stats.cwsi.min ?? '—'} → {stats.cwsi.max ?? '—'}<br />
          T° : {stats.temperature.min ?? '—'} → {stats.temperature.max ?? '—'} °C<br />
          Hauteur : {stats.hauteur?.min ?? '—'} → {stats.hauteur?.max ?? '—'} m
        </small>
      </div>
    </div>
  )
}

function Kpi({ label, value }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">{label}</div>
    </div>
  )
}

function KpiDelta({ label, value, delta, lowerIsBetter = false, neutral = false }) {
  let arrow = null
  if (!neutral && delta != null && Math.abs(delta) > 0.001) {
    const isImprovement = lowerIsBetter ? delta < 0 : delta > 0
    arrow = (
      <span
        className="kpi-delta"
        style={{ color: isImprovement ? 'var(--color-primary)' : 'var(--color-danger)' }}
      >
        {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(2)}
      </span>
    )
  }
  return (
    <div className="kpi">
      <div className="kpi-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        {value}
        {arrow}
      </div>
      <div className="kpi-label">{label}</div>
    </div>
  )
}
