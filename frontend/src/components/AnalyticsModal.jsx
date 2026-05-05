import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid,
  AreaChart, Area, ReferenceLine,
  ScatterChart, Scatter, ZAxis,
} from 'recharts'
import * as turf from '@turf/turf'
import { STRESS_COLORS } from '../constants'
import {
  LuX, LuChartBar, LuWind, LuGitBranchPlus, LuDroplet, LuThermometer,
} from 'react-icons/lu'

// ── Constantes agro (dupliquées depuis StatsPanel, source unique cohérente) ──
const KC_BY_STAGE = { hiver: 0.45, printemps: 0.65, ete: 0.70 }

const SOIL_PROFILES = {
  sableux: {
    label: 'Sableux',  freq: 'Tous les 2–3 jours', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',
    advice: "Faible capacité de rétention hydrique. Fractionner les apports en plusieurs petits tours d'eau pour éviter le lessivage des nutriments. Privilégier le goutte-à-goutte basse pression.",
  },
  limoneux: {
    label: 'Limoneux', freq: 'Tous les 4–5 jours', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)',
    advice: "Rétention équilibrée, bonne disponibilité en eau. Apports réguliers et modérés recommandés. Surveiller la compaction de surface qui peut réduire l'infiltration après aspersion.",
  },
  argileux: {
    label: 'Argileux', freq: 'Tous les 6–8 jours', color: '#10b981', bg: 'rgba(16,185,129,0.08)',
    advice: "Fort pouvoir de rétention — risque d'asphyxie racinaire en cas de sur-irrigation. Espacer les apports, assurer un bon drainage, et surveiller le CWSI avant toute décision.",
  },
}

const SOIL_TYPES = [
  { value: 'sableux',  label: 'Sableux'  },
  { value: 'limoneux', label: 'Limoneux' },
  { value: 'argileux', label: 'Argileux' },
]

// ── Tooltip partagé ───────────────────────────────────────────────────────────
const TIP_STYLE = {
  background: 'rgba(255,255,255,0.97)',
  backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(203,213,225,0.8)', borderRadius: 8,
  padding: '8px 12px', fontSize: 12, color: '#0f172a',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)', lineHeight: 1.6,
}

function GlassTip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div style={TIP_STYLE}>
      <div style={{ color: '#64748b', marginBottom: 3 }}>{label}</div>
      {payload.map((e, i) => <div key={i}><b>{formatter ? formatter(e.value) : e.value}</b></div>)}
    </div>
  )
}
function CwsiTip(props)     { return <GlassTip {...props} /> }
function ForecastTip(props) { return <GlassTip {...props} formatter={v => `${v} m³`} /> }

function ScatterTip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{ ...TIP_STYLE, lineHeight: 1.7, padding: '7px 11px' }}>
      <div style={{ color: '#64748b', marginBottom: 2 }}>Olivier #{d?.id ?? '—'}</div>
      <div>Hauteur : <b>{d?.hauteur?.toFixed(1)} m</b></div>
      <div>CWSI : <b style={{ color: d?.color }}>{d?.cwsi?.toFixed(3)}</b></div>
    </div>
  )
}

function CherguiTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div style={{ ...TIP_STYLE, lineHeight: 1.7, padding: '7px 11px' }}>
      <div style={{ color: '#64748b', marginBottom: 2 }}>{label}</div>
      <div>T° max : <b>{d?.tMax != null ? d.tMax.toFixed(1) : '—'}°C</b></div>
      <div>Vent max : <b>{d?.windMs != null ? d.windMs.toFixed(1) : '—'} m/s</b></div>
      {d?.isChergui && <div style={{ color: '#e74c3c', fontWeight: 600, marginTop: 2 }}>⚠ Chergui</div>}
    </div>
  )
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function AnalyticsModal({
  stats,
  mission,
  missionCompare,
  statsCompare,
  isZonalActive,
  features,
  allFeatures = [],
  onClose,
}) {
  const isCompare = !!(statsCompare && missionCompare)

  // ── État local ─────────────────────────────────────────────────────────────
  const [waterCostPerM3,       setWaterCostPerM3]       = useState(0)
  const [energyKwhPerM3,       setEnergyKwhPerM3]       = useState(0.75)
  const [energyPriceMad,       setEnergyPriceMad]       = useState(1.05)
  const [irrigationEfficiency, setIrrigationEfficiency] = useState(0.90)
  const [phenoStage,           setPhenoStage]           = useState('printemps')
  const [soilType,             setSoilType]             = useState('limoneux')
  const [forecastData,         setForecastData]         = useState(null)
  const [isFetchingMeteo,      setIsFetchingMeteo]      = useState(false)
  const [cherguiData,          setCherguiData]          = useState(null)
  const [isLoadingChergui,     setIsLoadingChergui]     = useState(false)

  // ── Fetch ET0 Penman-Monteith ──────────────────────────────────────────────
  useEffect(() => {
    if (!isZonalActive) return
    setIsFetchingMeteo(true)
    fetch('https://api.open-meteo.com/v1/forecast?latitude=35.76&longitude=-5.83&daily=et0_fao_evapotranspiration&timezone=Africa%2FCasablanca')
      .then(r => r.json())
      .then(data => { if (data?.daily) setForecastData(data.daily) })
      .catch(() => {})
      .finally(() => setIsFetchingMeteo(false))
  }, [isZonalActive])

  // ── Fetch Chergui inter-missions ───────────────────────────────────────────
  useEffect(() => {
    if (!isCompare || !mission?.date || !missionCompare?.date) { setCherguiData(null); return }
    const dates = [mission.date, missionCompare.date].sort()
    const [d1, d2] = dates
    if (d1 === d2) { setCherguiData([]); return }
    setIsLoadingChergui(true)
    fetch(
      `https://archive-api.open-meteo.com/v1/archive?latitude=35.76&longitude=-5.83` +
      `&start_date=${d1}&end_date=${d2}` +
      `&daily=temperature_2m_max,wind_speed_10m_max&wind_speed_unit=ms&timezone=Africa%2FCasablanca`
    )
      .then(r => r.json())
      .then(data => {
        if (data?.daily) {
          const { time, temperature_2m_max, wind_speed_10m_max } = data.daily
          setCherguiData(time.map((t, i) => ({
            date: t, tMax: temperature_2m_max[i], windMs: wind_speed_10m_max[i],
            isChergui: temperature_2m_max[i] > 35 && wind_speed_10m_max[i] > 4,
          })))
        }
      })
      .catch(() => setCherguiData([]))
      .finally(() => setIsLoadingChergui(false))
  }, [isCompare, mission?.date, missionCompare?.date]) // eslint-disable-line react-hooks/exhaustive-deps

  const todayEt0 = forecastData?.et0_fao_evapotranspiration?.[0] ?? 4.0
  const kc       = KC_BY_STAGE[phenoStage] ?? 0.65

  const totalDeficitM3 = useMemo(() => {
    if (!isZonalActive || !features?.length) return 0
    const etcWeekly = todayEt0 * kc * 7
    let liters = 0
    features.forEach(feat => {
      const area = turf.area(feat)
      const cwsi = feat.properties.cwsi
      if (cwsi == null || isNaN(cwsi) || cwsi < 0) return
      liters += (area * etcWeekly * Math.min(cwsi, 1.0)) / irrigationEfficiency
    })
    return (liters / 1000).toFixed(2)
  }, [isZonalActive, features, todayEt0, irrigationEfficiency, kc])

  const projectionChartData = useMemo(() => {
    if (!isZonalActive || !features?.length || !forecastData) return []
    let totalArea = 0
    features.forEach(f => { totalArea += turf.area(f) })
    if (!totalArea) return []
    const M = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']
    return forecastData.time.slice(0, 7).map((iso, i) => {
      const et0 = forecastData.et0_fao_evapotranspiration?.[i] ?? 0
      const d   = new Date(iso)
      return {
        date:     `${d.getDate()} ${M[d.getMonth()]}`,
        besoinM3: parseFloat(((totalArea * et0 * kc) / irrigationEfficiency / 1000).toFixed(2)),
      }
    })
  }, [isZonalActive, features, forecastData, irrigationEfficiency, kc])

  const scatterData = useMemo(() => {
    const src = isZonalActive ? (features ?? []) : allFeatures
    return src
      .filter(f => f.properties.hauteur != null && f.properties.cwsi != null)
      .map(f => ({
        id: f.properties.id, hauteur: f.properties.hauteur, cwsi: f.properties.cwsi,
        color: STRESS_COLORS[f.properties.stress] || STRESS_COLORS.inconnu,
      }))
  }, [isZonalActive, features, allFeatures])

  const cherguiDays = useMemo(() => (cherguiData || []).filter(d => d.isChergui), [cherguiData])

  // ── Raccourci clavier Escape ───────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="am-backdrop" onClick={onClose}>
      <div className="am-panel" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">

        {/* ── En-tête ── */}
        <div className="am-header">
          <span className="am-title">
            <LuChartBar size={17} /> Analyses Détaillées
          </span>
          <button className="am-close" onClick={onClose} aria-label="Fermer">
            <LuX size={15} />
          </button>
        </div>

        {/* ── Corps ── */}
        <div className="am-body">
          <div className="am-grid">

            {/* ── Distribution CWSI ── */}
            <div className="am-card">
              <h4 className="am-card-title">Distribution CWSI</h4>
              <div className="am-chart-wrap">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stats.histogram_cwsi}
                    margin={{ top: 20, right: 20, left: 0, bottom: 40 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" vertical={false} />
                    <XAxis
                      dataKey="bin" fontSize={11} angle={-45} textAnchor="end"
                      interval={0} tick={{ fill: '#94a3b8' }} tickLine={false}
                      axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
                    />
                    <YAxis fontSize={12} tick={{ fill: '#94a3b8' }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip content={<CwsiTip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                    <Bar dataKey="count" fill="#38bdf8" fillOpacity={0.82} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="am-range-row">
                <span>CWSI</span>
                <span>{stats.cwsi.min ?? '—'} → {stats.cwsi.max ?? '—'}</span>
              </div>
            </div>

            {/* ── Scatter Plot Hauteur × CWSI ── */}
            <div className="am-card">
              <h4 className="am-card-title">
                <LuGitBranchPlus size={12} style={{ color: 'var(--primary)' }} />
                Corrélation Hauteur / CWSI
              </h4>
              {scatterData.length >= 2 ? (
                <>
                  <div className="am-chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 6, right: 10, left: 0, bottom: 6 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.3)" />
                        <XAxis
                          dataKey="hauteur" type="number" name="Hauteur" unit=" m"
                          fontSize={11} tick={{ fill: '#94a3b8' }} tickLine={false}
                          axisLine={{ stroke: 'rgba(148,163,184,0.15)' }} domain={['auto','auto']}
                        />
                        <YAxis
                          dataKey="cwsi" type="number" name="CWSI" domain={[0, 1]}
                          fontSize={11} tick={{ fill: '#94a3b8' }} tickLine={false} axisLine={false} width={40}
                        />
                        <ZAxis range={[28, 28]} />
                        <Tooltip content={<ScatterTip />} cursor={{ strokeDasharray: '3 3' }} />
                        <Scatter
                          data={scatterData}
                          shape={({ cx, cy, payload }) => (
                            <circle cx={cx} cy={cy} r={5} fill={payload.color}
                              fillOpacity={0.82} stroke="white" strokeWidth={1} />
                          )}
                        />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="am-footnote">Chaque point = un olivier · couleur = niveau de stress</p>
                </>
              ) : (
                <div className="am-empty">Données insuffisantes (min. 2 arbres requis).</div>
              )}
              <div className="am-range-row">
                <span style={{ display:'flex', alignItems:'center', gap:4 }}>
                  <LuThermometer size={11} /> T°
                </span>
                <span>{stats.temperature.min ?? '—'} → {stats.temperature.max ?? '—'} °C</span>
              </div>
              <div className="am-range-row">
                <span>Hauteur</span>
                <span>{stats.hauteur?.min ?? '—'} → {stats.hauteur?.max ?? '—'} m</span>
              </div>
            </div>

            {/* ── Analyse Chergui (comparaison active uniquement) ── */}
            {isCompare && (
              <div className="am-card am-card-full">
                <h4 className="am-card-title">
                  <LuWind size={13} style={{ color: '#f97316' }} />
                  Analyse Chergui inter-missions
                  {isLoadingChergui && (
                    <span className="am-loading-badge">⏳ chargement…</span>
                  )}
                </h4>

                {isLoadingChergui && cherguiData === null ? (
                  <p className="am-muted">Récupération des données météo historiques…</p>
                ) : cherguiData === null ? null
                : cherguiData.length === 0 ? (
                  <p className="am-muted">Données météo non disponibles pour cette période.</p>
                ) : (
                  <div className="am-chergui-layout">
                    <div>
                      {cherguiDays.length === 0 ? (
                        <span className="am-badge am-badge-ok">✓ Aucune période de Chergui détectée</span>
                      ) : (
                        <span className="am-badge am-badge-warn">
                          ⚠ {cherguiDays.length} jour{cherguiDays.length > 1 ? 's' : ''} de Chergui
                          {cherguiDays.length <= 5 && ` · ${cherguiDays.map(d => d.date.slice(5)).join(', ')}`}
                        </span>
                      )}
                      <div className="am-chart-wrap" style={{ marginTop: 12 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={cherguiData} margin={{ top: 4, right: 6, left: 0, bottom: 30 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" vertical={false} />
                            <XAxis
                              dataKey="date" fontSize={10} angle={-45} textAnchor="end"
                              interval={cherguiData.length <= 14 ? 0 : Math.ceil(cherguiData.length / 8)}
                              tick={{ fill: '#94a3b8' }} tickLine={false}
                              axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
                            />
                            <YAxis fontSize={11} tick={{ fill: '#94a3b8' }} tickLine={false} axisLine={false} width={40} domain={[0,'auto']} />
                            <Tooltip content={<CherguiTip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                            <ReferenceLine y={35} stroke="#f97316" strokeDasharray="4 2" strokeWidth={1.5} />
                            <Bar dataKey="tMax" radius={[3, 3, 0, 0]}>
                              {cherguiData.map((d, i) => (
                                <Cell key={i} fill={d.isChergui ? '#e74c3c' : '#38bdf8'} fillOpacity={0.82} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="am-footnote">T° max quotidienne · barres rouges = Chergui (T° &gt; 35°C + Vent &gt; 4 m/s)</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Bilan Hydrique FAO-56 + Prévision J+7 ── */}
            {isZonalActive && features?.length > 0 && (
              <div className="am-card am-card-full">
                <h4 className="am-card-title">
                  <LuDroplet size={13} style={{ color: '#3b82f6' }} />
                  Bilan Hydrique (FAO-56)
                  {isFetchingMeteo && <span className="am-loading-badge">⏳ Météo…</span>}
                </h4>

                <div className="am-wb-grid">
                  {/* Colonne gauche : paramètres + budget */}
                  <div className="am-wb-inputs">

                    <div className="wb-row">
                      <label className="wb-label" htmlFor="am-pheno">Stade phénologique</label>
                      <select id="am-pheno" className="wb-select" value={phenoStage} onChange={e => setPhenoStage(e.target.value)}>
                        <option value="hiver">Hiver (Kc = 0.45)</option>
                        <option value="printemps">Printemps / Floraison (Kc = 0.65)</option>
                        <option value="ete">Été / Développement noyau (Kc = 0.70)</option>
                      </select>
                    </div>

                    <div className="wb-row">
                      <label className="wb-label">Type de sol</label>
                      <div className="wb-soil-chips">
                        {SOIL_TYPES.map(({ value, label }) => (
                          <button
                            key={value}
                            className={`wb-soil-chip${soilType === value ? ' active' : ''}`}
                            onClick={() => setSoilType(value)}
                            style={soilType === value
                              ? { borderColor: SOIL_PROFILES[value].color, background: SOIL_PROFILES[value].bg, color: SOIL_PROFILES[value].color }
                              : undefined}
                          >{label}</button>
                        ))}
                      </div>
                    </div>

                    <div className="wb-row">
                      <label className="wb-label" htmlFor="am-irrig">Système d'irrigation</label>
                      <select id="am-irrig" className="wb-select" value={irrigationEfficiency} onChange={e => setIrrigationEfficiency(Number(e.target.value))}>
                        <option value={0.90}>Goutte-à-goutte (90 %)</option>
                        <option value={0.75}>Micro-aspersion (75 %)</option>
                        <option value={0.60}>Gravitaire (60 %)</option>
                      </select>
                    </div>

                    <div className="wb-row">
                      <label className="wb-label" htmlFor="am-wc">Coût eau (MAD/m³)</label>
                      <input id="am-wc" className="wb-input" type="number" min="0" step="0.1"
                        value={waterCostPerM3} onChange={e => setWaterCostPerM3(Math.max(0, Number(e.target.value)))} />
                    </div>

                    <div className="wb-row">
                      <label className="wb-label" htmlFor="am-ek">Efficacité pompe (kWh/m³)</label>
                      <input id="am-ek" className="wb-input" type="number" min="0" step="0.05"
                        value={energyKwhPerM3} onChange={e => setEnergyKwhPerM3(Math.max(0, Number(e.target.value)))} />
                    </div>

                    <div className="wb-row">
                      <label className="wb-label" htmlFor="am-ep">Tarif ONEE (MAD/kWh)</label>
                      <input id="am-ep" className="wb-input" type="number" min="0" step="0.01"
                        value={energyPriceMad} onChange={e => setEnergyPriceMad(Math.max(0, Number(e.target.value)))} />
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

                    {SOIL_PROFILES[soilType] && (
                      <div className="wb-soil-advisory" style={{ borderLeftColor: SOIL_PROFILES[soilType].color }}>
                        <div className="wb-soil-advisory-header" style={{ color: SOIL_PROFILES[soilType].color }}>
                          <span className="wb-soil-advisory-pill">{SOIL_PROFILES[soilType].label}</span>
                          <span className="wb-soil-advisory-freq">· {SOIL_PROFILES[soilType].freq}</span>
                        </div>
                        <p className="wb-soil-advisory-text">{SOIL_PROFILES[soilType].advice}</p>
                      </div>
                    )}

                    <p className="wb-footnote">
                      ET0 : {todayEt0} mm/j · Kc = {kc.toFixed(2)} ({phenoStage === 'hiver' ? 'Hiver' : phenoStage === 'printemps' ? 'Printemps' : 'Été'})
                      · Déficit : {totalDeficitM3} m³/sem.
                    </p>
                  </div>

                  {/* Colonne droite : Prévision J+7 */}
                  <div className="am-wb-chart">
                    <h5 className="am-card-title" style={{ marginBottom: 12 }}>Prévision Besoins (J+7)</h5>
                    {projectionChartData.length > 0 ? (
                      <>
                        <div className="am-chart-wrap">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={projectionChartData} margin={{ top: 6, right: 6, left: -10, bottom: 24 }}>
                              <defs>
                                <linearGradient id="amColorBesoin" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.35} />
                                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.3)" vertical={false} />
                              <XAxis
                                dataKey="date" fontSize={11} tick={{ fill: '#94a3b8' }}
                                tickLine={false} axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
                                angle={-30} textAnchor="end" interval={0}
                              />
                              <YAxis hide />
                              <Tooltip content={<ForecastTip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                              <Area
                                type="monotone" dataKey="besoinM3"
                                stroke="#3b82f6" strokeWidth={2}
                                fill="url(#amColorBesoin)"
                                dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }}
                                activeDot={{ r: 5, fill: '#3b82f6', stroke: 'white', strokeWidth: 1.5 }}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                        <p className="am-footnote">Volume journalier requis · prévisions ET0 Open-Meteo</p>
                      </>
                    ) : (
                      <div className="am-empty">Prévision disponible après chargement météo.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
