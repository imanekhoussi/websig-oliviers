import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceDot, CartesianGrid,
} from 'recharts'
import { fetchStats } from '../api'
import { TrendSkeleton } from './Skeleton'

/* Tooltip glassmorphism */
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const val = payload[0].value
  return (
    <div style={{
      background: 'rgba(8, 14, 26, 0.97)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(148,163,184,0.22)',
      borderRadius: 8,
      padding: '9px 13px',
      fontSize: 12,
      color: '#f1f5f9',
      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
      lineHeight: 1.6,
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 3 }}>Mission : {label}</div>
      <div>CWSI moyen : <b>{val != null ? val.toFixed(3) : '—'}</b></div>
    </div>
  )
}

export default function TrendPanel({ missions, currentId }) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const avecDonnees = missions.filter(m => m.has_shapefile)
    if (!avecDonnees.length) { setData([]); return }

    setLoading(true)
    Promise.all(
      avecDonnees.map(m =>
        fetchStats(m.id)
          .then(s => ({
            id:   m.id,
            date: m.date,
            nom:  m.nom || m.id,
            cwsi: s.cwsi?.moyenne != null
              ? parseFloat(s.cwsi.moyenne.toFixed(3))
              : null,
          }))
          .catch(() => null)
      )
    ).then(res => {
      setData(res.filter(Boolean).sort((a, b) => a.date.localeCompare(b.date)))
      setLoading(false)
    })
  }, [missions])

  const missionActive = data.find(d => d.id === currentId)

  return (
    <div className="trend-panel">
      <div className="trend-header">
        <h3>Tendance CWSI</h3>
        <p className="trend-subtitle">Évolution du stress hydrique moyen par mission</p>
      </div>

      {loading && <TrendSkeleton />}

      {!loading && data.length === 0 && (
        <div className="panel-empty">
          <span style={{ fontSize: 32, display: 'block', marginBottom: 8, opacity: 0.4 }}>📉</span>
          Aucune donnée disponible.<br />
          Importez des shapefiles pour visualiser les tendances temporelles.
        </div>
      )}

      {!loading && data.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={205}>
            <LineChart data={data} margin={{ top: 16, right: 16, left: -16, bottom: 58 }}>
              <CartesianGrid
                strokeDasharray="4 4"
                stroke="rgba(148,163,184,0.08)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                angle={-35} textAnchor="end" interval={0}
                fontSize={11}
                tick={{ fill: '#94a3b8' }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
              />
              <YAxis
                domain={[0, 1]}
                fontSize={11}
                tick={{ fill: '#94a3b8' }}
                tickLine={false} axisLine={false}
                tickFormatter={v => v.toFixed(1)}
                label={{
                  value: 'CWSI',
                  angle: -90,
                  position: 'insideLeft',
                  fill: '#64748b',
                  fontSize: 11,
                  offset: 18,
                }}
              />
              <Tooltip content={<TrendTooltip />} />
              <Line
                type="monotone"
                dataKey="cwsi"
                stroke="#38bdf8"
                strokeWidth={2.5}
                dot={{ fill: '#38bdf8', r: 4, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#38bdf8', stroke: 'white', strokeWidth: 2 }}
                connectNulls
              />
              {missionActive?.cwsi != null && (
                <ReferenceDot
                  x={missionActive.date}
                  y={missionActive.cwsi}
                  r={8}
                  fill="#22c55e"
                  stroke="white"
                  strokeWidth={2.5}
                />
              )}
            </LineChart>
          </ResponsiveContainer>

          {missionActive && (
            <div className="trend-current">
              <span className="trend-label">Mission sélectionnée</span>
              <span className="trend-value" style={{ color: '#22c55e' }}>
                CWSI {missionActive.cwsi?.toFixed(3) ?? '—'}
              </span>
            </div>
          )}

          <div className="trend-legend">
            <span className="swatch" style={{ background: '#38bdf8' }} />
            <span>CWSI moyen</span>
            <span className="swatch" style={{ background: '#22c55e', marginLeft: 12 }} />
            <span>Mission active</span>
          </div>

          {data.length === 1 && (
            <p className="trend-hint">
              Ajoutez d'autres missions pour révéler la tendance temporelle.
            </p>
          )}
        </>
      )}
    </div>
  )
}
