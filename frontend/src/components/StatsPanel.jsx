import { useState, useMemo, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid,
  AreaChart, Area,
} from 'recharts'
import * as turf from '@turf/turf'
import { STRESS_LABELS } from '../constants'
import { exportCsvUrl } from '../api'
import { LuActivity, LuMapPin, LuThermometer, LuDroplet, LuWind } from 'react-icons/lu'

/* Tooltip glassmorphism partagé */
function GlassTip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.97)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(203, 213, 225, 0.8)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      color: '#0f172a',
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      lineHeight: 1.6,
    }}>
      <div style={{ color: '#64748b', marginBottom: 3 }}>{label}</div>
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

function ForecastTip(props) {
  return <GlassTip {...props} formatter={v => `${v} m³`} />
}

export default function StatsPanel({ stats, mission, statsCompare, missionCompare, isZonalActive = false, onClearZonal, features }) {
  const isCompare = !!(statsCompare && missionCompare)
  const [waterCostPerM3,       setWaterCostPerM3]       = useState(0)
  const [energyKwhPerM3,       setEnergyKwhPerM3]       = useState(0.75)
  const [energyPriceMad,       setEnergyPriceMad]       = useState(1.05)
  const [irrigationEfficiency, setIrrigationEfficiency] = useState(0.90)
  const [forecastData,         setForecastData]         = useState(null)
  const [isFetchingMeteo,      setIsFetchingMeteo]      = useState(false)

  // ET0 + prévisions J+7 — Penman-Monteith FAO-56 via Open-Meteo
  useEffect(() => {
    if (!isZonalActive) return
    setIsFetchingMeteo(true)
    fetch('https://api.open-meteo.com/v1/forecast?latitude=35.76&longitude=-5.83&daily=et0_fao_evapotranspiration&timezone=Africa%2FCasablanca')
      .then(r => r.json())
      .then(data => { if (data?.daily) setForecastData(data.daily) })
      .catch(() => { /* conserve les valeurs par défaut */ })
      .finally(() => setIsFetchingMeteo(false))
  }, [isZonalActive])

  const todayEt0 = forecastData?.et0_fao_evapotranspiration?.[0] ?? 4.0

  // Bilan hydrique FAO-56 — CWSI continu, efficience système, ET0 dynamique
  const totalDeficitM3 = useMemo(() => {
    if (!isZonalActive || !features?.length) return 0
    const kc        = 0.65
    const etcWeekly = todayEt0 * kc * 7                             // mm/semaine (ET0 × Kc × 7j)
    let totalLiters = 0
    features.forEach(feat => {
      const area  = turf.area(feat)                                  // m² géodésique WGS84
      const cwsi  = feat.properties.cwsi
      if (cwsi == null || isNaN(cwsi) || cwsi < 0) return
      const deficitNet_mm     = etcWeekly * Math.min(cwsi, 1.0)     // mm proportionnel au CWSI
      const volumeBrut_Liters = (area * deficitNet_mm) / irrigationEfficiency
      totalLiters += volumeBrut_Liters
    })
    return (totalLiters / 1000).toFixed(2)                          // → m³/semaine
  }, [isZonalActive, features, todayEt0, irrigationEfficiency])

  // Données J+7 pour le graphique de prévision
  const projectionChartData = useMemo(() => {
    if (!isZonalActive || !features?.length || !forecastData) return []
    let totalArea = 0
    features.forEach(feat => { totalArea += turf.area(feat) })
    if (totalArea === 0) return []
    const MOIS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']
    return forecastData.time.slice(0, 7).map((isoDate, i) => {
      const et0 = forecastData.et0_fao_evapotranspiration?.[i] ?? 0
      const d = new Date(isoDate)
      const dateCourte = `${d.getDate()} ${MOIS_FR[d.getMonth()]}`
      const besoinLiters = (totalArea * et0 * 0.65) / irrigationEfficiency
      return { date: dateCourte, besoinM3: parseFloat((besoinLiters / 1000).toFixed(2)), et0 }
    })
  }, [isZonalActive, features, forecastData, irrigationEfficiency])

  if (!mission) {
    return (
      <div className="panel">
        <div className="panel-empty">
          <LuActivity size={40} style={{ opacity: 0.4, marginBottom: 8 }} />
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
            <LuMapPin size={14} />
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
            {mission.meteo.temp_air != null && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><LuThermometer size={14} /> {mission.meteo.temp_air}°C</span>}
            {mission.meteo.humidite != null && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><LuDroplet size={14} /> {mission.meteo.humidite}%</span>}
            {mission.meteo.vent     != null && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><LuWind size={14} /> {mission.meteo.vent} m/s</span>}
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
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <BarChart
            data={stats.stress_breakdown.map(s => ({ ...s, label: STRESS_LABELS[s.classe] }))}
            margin={{ top: 6, right: 6, left: 0, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" vertical={false} />
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
            <Tooltip content={<StressTip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
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
      <div style={{ width: '100%', height: 190 }}>
        <ResponsiveContainer>
          <BarChart
            data={stats.histogram_cwsi}
            margin={{ top: 6, right: 6, left: -10, bottom: 45 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" vertical={false} />
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
            <Tooltip content={<CwsiTip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
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

      {/* ── Bilan hydrique FAO-56 + Prévision J+7 (sélection zonale uniquement) ── */}
      {isZonalActive && features?.length > 0 && (
        <>
          <div className="water-balance-card">

            <div className="wb-header">
              <span className="wb-title">
                💧 Bilan Hydrique (FAO-56)
                {isFetchingMeteo && <span className="wb-meteo-badge">⏳ Météo…</span>}
              </span>
              <span className="wb-deficit">{totalDeficitM3} m³ / sem.</span>
            </div>

            <div className="wb-row">
              <label className="wb-label" htmlFor="irrig-system">Système d'irrigation</label>
              <select
                id="irrig-system"
                className="wb-select"
                value={irrigationEfficiency}
                onChange={e => setIrrigationEfficiency(Number(e.target.value))}
              >
                <option value={0.90}>Goutte-à-goutte (90 %)</option>
                <option value={0.75}>Micro-aspersion (75 %)</option>
                <option value={0.60}>Gravitaire (60 %)</option>
              </select>
            </div>

            <div className="wb-row">
              <label className="wb-label" htmlFor="water-cost">Coût eau (MAD/m³)</label>
              <input
                id="water-cost"
                className="wb-input"
                type="number" min="0" step="0.1"
                value={waterCostPerM3}
                onChange={e => setWaterCostPerM3(Math.max(0, Number(e.target.value)))}
                placeholder="0 si solaire"
              />
            </div>

            <div className="wb-row">
              <label className="wb-label" htmlFor="energy-kwh">Efficacité pompe (kWh/m³)</label>
              <input
                id="energy-kwh"
                className="wb-input"
                type="number" min="0" step="0.05"
                value={energyKwhPerM3}
                onChange={e => setEnergyKwhPerM3(Math.max(0, Number(e.target.value)))}
              />
            </div>

            <div className="wb-row">
              <label className="wb-label" htmlFor="energy-price">Tarif ONEE (MAD/kWh)</label>
              <input
                id="energy-price"
                className="wb-input"
                type="number" min="0" step="0.01"
                value={energyPriceMad}
                onChange={e => setEnergyPriceMad(Math.max(0, Number(e.target.value)))}
              />
            </div>

            <div className="wb-subtotal-row">
              <span>Coût pompage seul</span>
              <span>{(totalDeficitM3 * energyKwhPerM3 * energyPriceMad).toFixed(2)} MAD</span>
            </div>

            <div className="wb-total-row">
              <span>Budget d'irrigation estimé</span>
              <span className="wb-total-value">
                {(totalDeficitM3 * waterCostPerM3 + totalDeficitM3 * energyKwhPerM3 * energyPriceMad).toFixed(2)} MAD
              </span>
            </div>

            <p className="wb-footnote">
              ET0 dynamique : {todayEt0} mm/j (Penman-Monteith, Open-Meteo) · Aire géodésique WGS84 ·
              CWSI continu · Kc oliviers = 0.65 · Prescrit une irrigation de maintien.
            </p>
          </div>

          {projectionChartData.length > 0 && (
            <>
              <h3>Prévision des Besoins (J+7)</h3>
              <div style={{ width: '100%', height: 180 }}>
                <ResponsiveContainer>
                  <AreaChart
                    data={projectionChartData}
                    margin={{ top: 6, right: 6, left: -10, bottom: 24 }}
                  >
                    <defs>
                      <linearGradient id="colorBesoin" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      fontSize={11}
                      tick={{ fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
                      angle={-30}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis hide />
                    <Tooltip content={<ForecastTip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                    <Area
                      type="monotone"
                      dataKey="besoinM3"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#colorBesoin)"
                      dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#3b82f6', stroke: 'white', strokeWidth: 1.5 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <p style={{ fontSize: 11, color: '#64748b', textAlign: 'center', padding: '0 4px 4px', lineHeight: 1.5 }}>
                Volume d'eau journalier requis pour la zone sélectionnée<br />
                selon les prévisions d'évapotranspiration.
              </p>
            </>
          )}
        </>
      )}
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
