import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  ComposedChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  LuThermometer, LuDroplet, LuWind, LuCloudSun, LuCloudRain,
  LuChevronDown, LuChevronUp, LuFlame,
} from 'react-icons/lu'
import * as turf from '@turf/turf'

const DEFAULT_LAT = 35.76
const DEFAULT_LON = -5.83

function dayOfYear(dateStr) {
  const d = new Date(dateStr)
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000)
}

function computeETo(tmax, tmin, tmean, dateStr) {
  if (tmax == null || tmin == null || tmean == null) return 0
  const J   = dayOfYear(dateStr)
  const phi = DEFAULT_LAT * Math.PI / 180
  const dr  = 1 + 0.033 * Math.cos(2 * Math.PI * J / 365)
  const delta = 0.409 * Math.sin(2 * Math.PI * J / 365 - 1.39)
  const ws  = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))))
  const Ra  = (24 * 60 / Math.PI) * 0.0820 * dr * (
    ws * Math.sin(phi) * Math.sin(delta) +
    Math.cos(phi) * Math.cos(delta) * Math.sin(ws)
  )
  return Math.max(0, +(0.0023 * Ra * (tmean + 17.8) * Math.sqrt(Math.max(0, tmax - tmin))).toFixed(1))
}

function fmtShort(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

const TOOLTIP_STYLE = {
  background: '#fff',
  border: '1px solid rgba(99,140,200,0.26)',
  borderRadius: 8,
  fontSize: 11,
}

export default function WeatherWidget({ geojson, startDate, endDate }) {
  const [current,    setCurrent]    = useState(null)
  const [histCache,  setHistCache]  = useState({})
  const [histLoading, setHistLoading] = useState(false)
  const [expanded,   setExpanded]   = useState(false)
  const [error,      setError]      = useState(false)

  // Derive lat/lon from geojson centroid, or use defaults
  const { lat, lon } = useMemo(() => {
    if (geojson?.features?.length) {
      try {
        const c = turf.centroid(geojson)
        return { lat: c.geometry.coordinates[1], lon: c.geometry.coordinates[0] }
      } catch { /* use defaults */ }
    }
    return { lat: DEFAULT_LAT, lon: DEFAULT_LON }
  }, [geojson])

  // Fetch current weather
  useEffect(() => {
    setError(false)
    fetch(
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation` +
      `&timezone=Africa%2FCasablanca`
    )
      .then(r => r.json())
      .then(d => d?.current && setCurrent(d.current))
      .catch(() => setError(true))
  }, [lat, lon])

  const histKey = startDate && endDate ? `${lat.toFixed(3)}_${lon.toFixed(3)}_${startDate}_${endDate}` : null
  const historical = histKey ? (histCache[histKey] ?? null) : null

  const fetchHistorical = useCallback(() => {
    if (!histKey || histCache[histKey] || histLoading || !startDate || !endDate) return
    setHistLoading(true)
    fetch(
      `https://archive-api.open-meteo.com/v1/archive` +
      `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
      `&start_date=${startDate}&end_date=${endDate}` +
      `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,` +
      `precipitation_sum,wind_speed_10m_max,relative_humidity_2m_mean` +
      `&wind_speed_unit=ms` +
      `&timezone=Africa%2FCasablanca`
    )
      .then(r => r.json())
      .then(d => {
        if (!d?.daily?.time) return
        const { time, temperature_2m_max: tmax, temperature_2m_min: tmin,
                temperature_2m_mean: tmean, precipitation_sum: precip,
                wind_speed_10m_max: wind, relative_humidity_2m_mean: hum } = d.daily
        const days = time.map((t, i) => ({
          date:   t,
          label:  fmtShort(t),
          tmax:   tmax[i],
          tmin:   tmin[i],
          tmean:  tmean[i],
          precip: precip[i] ?? 0,
          wind:   wind[i],
          hum:    hum[i],
          eto:    computeETo(tmax[i], tmin[i], tmean[i], t),
        }))
        setHistCache(prev => ({ ...prev, [histKey]: days }))
      })
      .catch(() => {})
      .finally(() => setHistLoading(false))
  }, [lat, lon, histKey, startDate, endDate]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (expanded && histKey) fetchHistorical()
  }, [expanded, histKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Weekly summaries
  const weeklySummaries = useMemo(() => {
    if (!historical) return []
    const weeks = {}
    historical.forEach(d => {
      const dt  = new Date(d.date)
      const dow = dt.getDay()
      const mon = new Date(dt)
      mon.setDate(dt.getDate() - (dow === 0 ? 6 : dow - 1))
      const key = mon.toISOString().slice(0, 10)
      if (!weeks[key]) weeks[key] = { key, days: [] }
      weeks[key].days.push(d)
    })
    return Object.values(weeks)
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(w => {
        const days  = w.days
        const valid = days.filter(d => d.tmean != null)
        const tmoy  = valid.length ? +(valid.reduce((s, d) => s + d.tmean, 0) / valid.length).toFixed(1) : '—'
        const pluie = +days.reduce((s, d) => s + (d.precip ?? 0), 0).toFixed(1)
        const eto   = +days.reduce((s, d) => s + (d.eto   ?? 0), 0).toFixed(1)
        const stressDays = days.filter(d => d.tmax != null && d.tmax > 35).length
        return { semaine: fmtShort(w.key), tmoy, pluie, eto, stressDays }
      })
  }, [historical])

  const thermalStressDays = historical
    ? historical.filter(d => d.tmax != null && d.tmax > 35).length
    : 0

  const xInterval = historical ? Math.max(0, Math.floor(historical.length / 8) - 1) : 0
  const canExpand = !!startDate && !!endDate

  if (error && !current) return null

  return (
    <div className={`weather-panel${expanded ? ' weather-panel--expanded' : ''}`}>

      {/* ── Header compact (toujours visible) ── */}
      <div
        className="ww-compact-header"
        onClick={() => canExpand && setExpanded(v => !v)}
        style={{ cursor: canExpand ? 'pointer' : 'default' }}
      >
        <div className="ww-header-left">
          <LuCloudSun size={12} className="ww-icon-main" />
          <span className="ww-location">Météo Parcelle</span>
        </div>

        {current && (
          <div className="ww-metrics">
            <span className="ww-metric">
              <LuThermometer size={11} className="ww-icon temp" />
              <strong>{current.temperature_2m?.toFixed(1)}°C</strong>
            </span>
            <span className="ww-sep">·</span>
            <span className="ww-metric">
              <LuDroplet size={11} className="ww-icon hum" />
              <strong>{current.relative_humidity_2m} %</strong>
            </span>
            <span className="ww-sep">·</span>
            <span className="ww-metric">
              <LuCloudRain size={11} className="ww-icon rain" />
              <strong>{current.precipitation?.toFixed(1) ?? '0.0'} mm</strong>
            </span>
            <span className="ww-sep">·</span>
            <span className="ww-metric">
              <LuWind size={11} className="ww-icon wind" />
              <strong>{current.wind_speed_10m?.toFixed(1)} km/h</strong>
            </span>
          </div>
        )}

        {canExpand && (
          <div className="ww-toggle-btn">
            {expanded ? <LuChevronUp size={12} /> : <LuChevronDown size={12} />}
            <span>Détails météo</span>
          </div>
        )}
      </div>

      {/* ── Panel étendu ── */}
      {expanded && (
        <div className="ww-detail">
          {histLoading && (
            <div className="ww-loading">Chargement des données historiques…</div>
          )}

          {historical && (
            <>
              {/* Indicateur stress thermique */}
              <div
                className="ww-stress-banner"
                style={{
                  background:   thermalStressDays > 0 ? 'rgba(239,68,68,0.07)'  : 'rgba(34,197,94,0.07)',
                  borderColor:  thermalStressDays > 0 ? 'rgba(239,68,68,0.28)'  : 'rgba(34,197,94,0.28)',
                  color:        thermalStressDays > 0 ? '#dc2626' : '#16a34a',
                }}
              >
                <LuFlame size={13} />
                <span>
                  Stress thermique cumulé :&nbsp;
                  <strong>{thermalStressDays}</strong> jour{thermalStressDays !== 1 ? 's' : ''} avec Tmax &gt; 35°C
                </span>
              </div>

              {/* Graphique 1 : Tmin / Tmoy / Tmax + précipitations */}
              <div className="ww-chart-section">
                <div className="ww-chart-title">Températures & Précipitations</div>
                <ResponsiveContainer width="100%" height={200}>
                  <ComposedChart data={historical} margin={{ top: 6, right: 38, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
                    <XAxis
                      dataKey="label" fontSize={9} tick={{ fill: '#9ab1c8' }}
                      tickLine={false} interval={xInterval}
                    />
                    <YAxis
                      yAxisId="temp" domain={['auto', 'auto']}
                      fontSize={9} tick={{ fill: '#9ab1c8' }} tickLine={false} axisLine={false}
                    />
                    <YAxis
                      yAxisId="rain" orientation="right"
                      fontSize={9} tick={{ fill: '#60a5fa' }} tickLine={false} axisLine={false}
                    />
                    <RTooltip contentStyle={TOOLTIP_STYLE}
                      formatter={(v, n) => [v != null ? v.toFixed(1) : '—', n]} />
                    <Bar   yAxisId="rain" dataKey="precip" name="Précip. (mm)" fill="#93c5fd" opacity={0.65} radius={[2, 2, 0, 0]} />
                    <Line  yAxisId="temp" type="monotone" dataKey="tmax"  name="Tmax (°C)" stroke="#ef4444" strokeWidth={1.5} dot={false} />
                    <Line  yAxisId="temp" type="monotone" dataKey="tmean" name="Tmoy (°C)" stroke="#f97316" strokeWidth={2}   dot={false} />
                    <Line  yAxisId="temp" type="monotone" dataKey="tmin"  name="Tmin (°C)" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Graphique 2 : Humidité + Vent */}
              <div className="ww-chart-section">
                <div className="ww-chart-title">Humidité relative & Vent</div>
                <ResponsiveContainer width="100%" height={150}>
                  <ComposedChart data={historical} margin={{ top: 4, right: 38, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
                    <XAxis
                      dataKey="label" fontSize={9} tick={{ fill: '#9ab1c8' }}
                      tickLine={false} interval={xInterval}
                    />
                    <YAxis
                      yAxisId="hum"  domain={[0, 100]}
                      fontSize={9} tick={{ fill: '#9ab1c8' }} tickLine={false} axisLine={false}
                    />
                    <YAxis
                      yAxisId="wind" orientation="right"
                      fontSize={9} tick={{ fill: '#94a3b8' }} tickLine={false} axisLine={false}
                    />
                    <RTooltip contentStyle={TOOLTIP_STYLE}
                      formatter={(v, n) => [v != null ? v.toFixed(1) : '—', n]} />
                    <Bar  yAxisId="hum"  dataKey="hum"  name="Humidité (%)"  fill="#67e8f9" opacity={0.6} radius={[2, 2, 0, 0]} />
                    <Line yAxisId="wind" type="monotone" dataKey="wind" name="Vent max (m/s)" stroke="#94a3b8" strokeWidth={1.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Tableau hebdomadaire */}
              {weeklySummaries.length > 0 && (
                <div className="ww-chart-section">
                  <div className="ww-chart-title">Récapitulatif hebdomadaire</div>
                  <div className="ww-table-wrap">
                    <table className="ww-table">
                      <thead>
                        <tr>
                          <th>Semaine</th>
                          <th>T moy (°C)</th>
                          <th>Pluie (mm)</th>
                          <th>ETo (mm)</th>
                          <th>J. stress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weeklySummaries.map((w, i) => (
                          <tr key={i}>
                            <td>{w.semaine}</td>
                            <td>{w.tmoy}</td>
                            <td>{w.pluie}</td>
                            <td>{w.eto}</td>
                            <td style={{ color: w.stressDays > 0 ? '#ef4444' : 'inherit', fontWeight: w.stressDays > 0 ? 600 : 400 }}>
                              {w.stressDays}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {!histLoading && !historical && (
            <div className="ww-loading">Aucune donnée historique disponible pour cette période.</div>
          )}
        </div>
      )}
    </div>
  )
}
