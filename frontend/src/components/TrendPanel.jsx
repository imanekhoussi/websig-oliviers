import { useEffect, useState } from 'react'
import * as turf from '@turf/turf'
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceDot, CartesianGrid,
} from 'recharts'
import { LuHistory } from 'react-icons/lu'
import { fetchStats } from '../api'
import { TrendSkeleton } from './Skeleton'

/* Tooltip glassmorphism */
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const val = payload[0].value
  return (
    <div style={{
      background: 'rgba(255,255,255,0.97)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(203,213,225,0.8)',
      borderRadius: 8,
      padding: '9px 13px',
      fontSize: 12,
      color: '#0f172a',
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      lineHeight: 1.6,
    }}>
      <div style={{ color: '#64748b', marginBottom: 3 }}>Mission : {label}</div>
      <div>CWSI moyen : <b>{val != null ? val.toFixed(3) : '—'}</b></div>
    </div>
  )
}

export default function TrendPanel({ missions, currentId, geojson }) {
  const [data,               setData]               = useState([])
  const [loading,            setLoading]            = useState(false)
  const [historicalInsights, setHistoricalInsights] = useState(null)
  const [isLoadingInsights,  setIsLoadingInsights]  = useState(false)
  const [showWeatherHistory, setShowWeatherHistory] = useState(false)

  /* ── Fetch CWSI moyen par mission ── */
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

  /* ── Fetch archives climatiques Open-Meteo entre la 1ʳᵉ et la dernière mission ── */
  useEffect(() => {
    const avecDonnees = missions.filter(m => m.has_shapefile && m.date)
    if (avecDonnees.length < 2 || !geojson?.features?.length) {
      setHistoricalInsights(null)
      return
    }

    const sorted    = [...avecDonnees].sort((a, b) => a.date.localeCompare(b.date))
    const startDate = sorted[0].date
    const endDate   = sorted[sorted.length - 1].date

    let lat, lon
    try {
      const centroid = turf.centroid(geojson)
      lon = +centroid.geometry.coordinates[0].toFixed(5)
      lat = +centroid.geometry.coordinates[1].toFixed(5)
    } catch {
      return
    }

    setIsLoadingInsights(true)
    setHistoricalInsights(null)

    fetch(
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat}&longitude=${lon}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&daily=temperature_2m_max,precipitation_sum` +
      `&timezone=Africa%2FCasablanca`
    )
      .then(r => r.json())
      .then(json => {
        const daily = json?.daily
        if (!daily) return

        const hotDays = (daily.temperature_2m_max ?? [])
          .filter(t => t != null && t > 30).length

        const totalRain = (daily.precipitation_sum ?? [])
          .filter(p => p != null)
          .reduce((acc, p) => acc + p, 0)

        setHistoricalInsights({ hotDays, totalRain: +totalRain.toFixed(1) })
      })
      .catch(() => setHistoricalInsights(null))
      .finally(() => setIsLoadingInsights(false))
  }, [missions, geojson])

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
          <ResponsiveContainer width="100%" height={130}>
            <LineChart data={data} margin={{ top: 10, right: 10, left: 15, bottom: 25 }}>
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
                width={45}
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

          {/* ── Légende + bouton archives climatiques ── */}
          <div className="trend-legend">
            <span className="swatch" style={{ background: '#38bdf8' }} />
            <span>CWSI moyen</span>
            <span className="swatch" style={{ background: '#22c55e', marginLeft: 12 }} />
            <span>Mission active</span>

            {/* Bouton + popover climatique — visible uniquement si ≥ 2 missions */}
            {data.length >= 2 && (
              <span style={{ marginLeft: 'auto', position: 'relative' }}>
                <button
                  className={`btn-mini-history${showWeatherHistory ? ' active' : ''}`}
                  onClick={() => setShowWeatherHistory(v => !v)}
                  title="Analyse climatique inter-missions"
                  aria-expanded={showWeatherHistory}
                >
                  <LuHistory size={14} />
                </button>

                {showWeatherHistory && (
                  <div className="history-popup" role="tooltip">
                    {isLoadingInsights && (
                      <span className="history-popup-loader">
                        Analyse des archives climatiques…
                      </span>
                    )}
                    {!isLoadingInsights && historicalInsights && (
                      <p style={{ margin: 0 }}>
                        <b>💡 Analyse climatique de la période :</b>{' '}
                        L'évolution du stress hydrique est corrélée aux conditions réelles.
                        La parcelle a enregistré{' '}
                        <b>{historicalInsights.hotDays} jours au-dessus de 30°C</b>{' '}
                        et un cumul de précipitations de{' '}
                        <b>{historicalInsights.totalRain} mm</b>{' '}
                        entre ces deux missions.
                      </p>
                    )}
                    {!isLoadingInsights && !historicalInsights && (
                      <span style={{ fontStyle: 'italic' }}>
                        Données climatiques indisponibles.
                      </span>
                    )}
                  </div>
                )}
              </span>
            )}
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
