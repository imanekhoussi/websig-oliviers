import { useState, useEffect, useMemo } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar, ScatterChart, Scatter, ZAxis,
} from 'recharts'
import { fetchStats, fetchTrees } from '../api'
import { STRESS_COLORS, STRESS_LABELS } from '../constants'
import WeatherWidget from './WeatherWidget'
import {
  LuMap, LuLeaf, LuDroplet, LuTriangleAlert, LuTrendingUp,
  LuSatellite, LuArrowRight, LuCalendar, LuArrowUpRight,
  LuArrowDownRight, LuMinus, LuActivity,
} from 'react-icons/lu'

const STRESS_ORDER = ['aucun', 'faible', 'modere', 'eleve', 'severe']

const TOOLTIP_STYLE = {
  background: '#fff',
  border: '1px solid rgba(99,140,200,0.26)',
  borderRadius: 8,
  fontSize: 12,
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function linearRegression(points) {
  const n = points.length
  if (n < 2) return null
  const sumX  = points.reduce((s, p) => s + p.x, 0)
  const sumY  = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (Math.abs(denom) < 1e-10) return null
  const m     = (n * sumXY - sumX * sumY) / denom
  const b     = (sumY - m * sumX) / n
  const yMean = sumY / n
  const ssTot = points.reduce((s, p) => s + (p.y - yMean) ** 2, 0)
  const ssRes = points.reduce((s, p) => s + (p.y - (m * p.x + b)) ** 2, 0)
  const r2    = ssTot > 0 ? +(1 - ssRes / ssTot).toFixed(2) : 0
  return { m: +m.toFixed(4), b: +b.toFixed(4), r2 }
}

export default function DashboardHome({ missions, onOpenMap }) {
  const [allStats,       setAllStats]       = useState([])
  const [topTrees,       setTopTrees]       = useState([])
  const [loading,        setLoading]        = useState(true)
  const [startMissionId, setStartMissionId] = useState(null)
  const [endMissionId,   setEndMissionId]   = useState(null)

  const missionsWithData = useMemo(
    () => missions.filter(m => m.has_shapefile),
    [missions]
  )
  const missionsSorted = useMemo(
    () => [...missionsWithData].sort((a, b) => a.date.localeCompare(b.date)),
    [missionsWithData]
  )

  // Charge les stats de toutes les missions avec données
  useEffect(() => {
    if (!missionsWithData.length) { setLoading(false); return }
    setLoading(true)
    Promise.all(
      missionsWithData.map(m =>
        fetchStats(m.id)
          .then(s => ({ id: m.id, nom: m.nom, date: m.date, stats: s }))
          .catch(() => null)
      )
    ).then(results => {
      setAllStats(results.filter(Boolean))
      setLoading(false)
    })
  }, [missionsWithData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-sélectionne début = 1ère mission, fin = dernière mission
  useEffect(() => {
    if (!missionsSorted.length || startMissionId) return
    setStartMissionId(missionsSorted[0].id)
    setEndMissionId(missionsSorted[missionsSorted.length - 1].id)
  }, [missionsSorted]) // eslint-disable-line react-hooks/exhaustive-deps

  // Période (canonique : toujours startDate ≤ endDate)
  const startMission = missionsSorted.find(m => m.id === startMissionId)
  const endMission   = missionsSorted.find(m => m.id === endMissionId)

  const [periodStart, periodEnd] = useMemo(() => {
    const a = startMission?.date
    const b = endMission?.date
    if (!a || !b) return [null, null]
    return a <= b ? [a, b] : [b, a]
  }, [startMission?.date, endMission?.date])

  const periodBadge = useMemo(() => {
    if (!periodStart || !periodEnd) return null
    const d1   = new Date(periodStart)
    const d2   = new Date(periodEnd)
    const days = Math.round((d2 - d1) / 86400000) + 1
    return `${fmtDate(periodStart)} → ${fmtDate(periodEnd)} · ${days} jour${days !== 1 ? 's' : ''}`
  }, [periodStart, periodEnd])

  // Stats filtrées sur la période
  const filteredStats = useMemo(() => {
    if (!allStats.length) return []
    if (!periodStart || !periodEnd) return allStats
    return allStats
      .filter(m => m.date >= periodStart && m.date <= periodEnd)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [allStats, periodStart, periodEnd])

  // Top trees filtrés sur la période
  useEffect(() => {
    const inPeriod = missionsSorted.filter(m =>
      !periodStart || !periodEnd || (m.date >= periodStart && m.date <= periodEnd)
    ).slice(0, 3)
    if (!inPeriod.length) { setTopTrees([]); return }
    Promise.all(
      inPeriod.map(m =>
        fetchTrees(m.id)
          .then(g => (g.features || []).map(f => ({
            id:      f.properties.id,
            cwsi:    f.properties.cwsi,
            stress:  f.properties.stress,
            mission: m.nom || m.id,
            date:    m.date,
          })))
          .catch(() => [])
      )
    ).then(arrays => {
      const flat = arrays.flat().filter(t => t.cwsi != null)
      flat.sort((a, b) => b.cwsi - a.cwsi)
      setTopTrees(flat.slice(0, 8))
    })
  }, [periodStart, periodEnd]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!filteredStats.length) return null
    const totalArbres = filteredStats.reduce((s, m) => s + (m.stats.total_arbres || 0), 0)
    const cwsiVals    = filteredStats.map(m => m.stats.cwsi?.moyenne).filter(v => v != null)
    const cwsiMoyen   = cwsiVals.length
      ? +(cwsiVals.reduce((s, v) => s + v, 0) / cwsiVals.length).toFixed(2)
      : null
    let total = 0, critiques = 0
    filteredStats.forEach(m => {
      m.stats.stress_breakdown?.forEach(s => {
        total += s.count
        if (s.classe === 'eleve' || s.classe === 'severe') critiques += s.count
      })
    })
    const pctCritique = total > 0 ? Math.round((critiques / total) * 100) : 0
    return { totalArbres, cwsiMoyen, pctCritique }
  }, [filteredStats])

  // ── Donut ────────────────────────────────────────────────────────────────────
  const donutData = useMemo(() => {
    if (!filteredStats.length) return []
    const totals = Object.fromEntries(STRESS_ORDER.map(k => [k, 0]))
    filteredStats.forEach(m => {
      m.stats.stress_breakdown?.forEach(s => {
        if (totals[s.classe] !== undefined) totals[s.classe] += s.count
      })
    })
    return STRESS_ORDER
      .map(k => ({ name: STRESS_LABELS[k], value: totals[k], color: STRESS_COLORS[k], classe: k }))
      .filter(d => d.value > 0)
  }, [filteredStats])

  // ── Line chart CWSI ──────────────────────────────────────────────────────────
  const lineData = useMemo(() =>
    filteredStats
      .filter(m => m.stats.cwsi?.moyenne != null)
      .map(m => ({ name: m.nom || m.id, date: m.date, cwsi: +m.stats.cwsi.moyenne.toFixed(2) })),
    [filteredStats]
  )

  // ── Stacked bar (répartition stress par mission) ─────────────────────────────
  const stackedBarData = useMemo(() =>
    filteredStats.map(m => {
      const row = { name: (m.nom || m.id).slice(0, 12) }
      STRESS_ORDER.forEach(k => { row[k] = 0 })
      m.stats.stress_breakdown?.forEach(s => {
        if (row[s.classe] !== undefined) row[s.classe] = s.count
      })
      return row
    }),
    [filteredStats]
  )

  // ── Delta stress élevé+sévère ────────────────────────────────────────────────
  const deltaStress = useMemo(() => {
    const sorted = filteredStats.filter(m => m.stats.stress_breakdown?.length)
    if (sorted.length < 2) return null
    const getCritique = m =>
      (m.stats.stress_breakdown || [])
        .filter(s => s.classe === 'eleve' || s.classe === 'severe')
        .reduce((sum, s) => sum + s.count, 0)
    const first = sorted[0]
    const last  = sorted[sorted.length - 1]
    const delta = getCritique(last) - getCritique(first)
    return { delta, firstName: first.nom || first.id, lastName: last.nom || last.id }
  }, [filteredStats])

  // ── Scatter plot température × CWSI ─────────────────────────────────────────
  const scatterData = useMemo(() =>
    filteredStats
      .filter(m => m.stats.temperature?.moyenne != null && m.stats.cwsi?.moyenne != null)
      .map(m => ({
        x:    +m.stats.temperature.moyenne.toFixed(1),
        y:    +m.stats.cwsi.moyenne.toFixed(3),
        name: m.nom || m.id,
        date: m.date,
      })),
    [filteredStats]
  )

  const regInfo  = useMemo(() => linearRegression(scatterData), [scatterData])
  const regLine  = useMemo(() => {
    if (!regInfo || scatterData.length < 2) return []
    const xs   = scatterData.map(d => d.x)
    const xMin = Math.min(...xs)
    const xMax = Math.max(...xs)
    return [
      { x: xMin, y: +(regInfo.m * xMin + regInfo.b).toFixed(3) },
      { x: xMax, y: +(regInfo.m * xMax + regInfo.b).toFixed(3) },
    ]
  }, [regInfo, scatterData])

  // ── RENDU ────────────────────────────────────────────────────────────────────
  return (
    <div className="dh-page">

      {/* ── Hero ── */}
      <div className="dh-hero">
        <div className="dh-hero-content">
          <h2 className="dh-hero-title">Tableau de bord GeoOlive</h2>
          <p className="dh-hero-sub">
            {missions.length} mission{missions.length !== 1 ? 's' : ''}
            {missionsWithData.length > 0 && ` · ${missionsWithData.length} avec données`}
          </p>
        </div>
        <div className="dh-hero-actions">
          <button className="dh-cta" onClick={onOpenMap}>
            <LuMap size={15} /> Ouvrir la carte <LuArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* ── Sélecteur de période ── */}
      {missionsSorted.length >= 1 && (
        <div className="dh-period-bar">
          <div className="dh-period-selectors">
            <LuCalendar size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
            <span className="dh-period-label">Période</span>
            <select
              className="dh-period-select"
              value={startMissionId || ''}
              onChange={e => setStartMissionId(e.target.value)}
            >
              {missionsSorted.map(m => (
                <option key={m.id} value={m.id}>
                  {m.nom || m.id} — {m.date}
                </option>
              ))}
            </select>
            <span className="dh-period-arrow">→</span>
            <select
              className="dh-period-select"
              value={endMissionId || ''}
              onChange={e => setEndMissionId(e.target.value)}
            >
              {missionsSorted.map(m => (
                <option key={m.id} value={m.id}>
                  {m.nom || m.id} — {m.date}
                </option>
              ))}
            </select>
          </div>
          {periodBadge && (
            <div className="dh-period-badge">
              <LuCalendar size={11} />
              {periodBadge}
            </div>
          )}
        </div>
      )}

      {/* ── Widget météo expandable ── */}
      <WeatherWidget startDate={periodStart} endDate={periodEnd} />

      {/* ── KPIs ── */}
      <div className="dh-kpi-row">
        <div className="dh-kpi">
          <div className="dh-kpi-icon dh-kpi-icon--blue"><LuSatellite size={18} /></div>
          <div className="dh-kpi-body">
            <span className="dh-kpi-value">{missionsWithData.length} / {missions.length}</span>
            <span className="dh-kpi-label">Missions avec données</span>
          </div>
        </div>
        <div className="dh-kpi">
          <div className="dh-kpi-icon dh-kpi-icon--green"><LuLeaf size={18} /></div>
          <div className="dh-kpi-body">
            <span className="dh-kpi-value">{loading ? '…' : (kpis?.totalArbres ?? '—')}</span>
            <span className="dh-kpi-label">Arbres sur la période</span>
          </div>
        </div>
        <div className="dh-kpi">
          <div className="dh-kpi-icon dh-kpi-icon--sky"><LuDroplet size={18} /></div>
          <div className="dh-kpi-body">
            <span className="dh-kpi-value">{loading ? '…' : (kpis?.cwsiMoyen ?? '—')}</span>
            <span className="dh-kpi-label">CWSI moyen période</span>
          </div>
        </div>
        <div className={`dh-kpi${!loading && kpis?.pctCritique > 30 ? ' dh-kpi--warn' : ''}`}>
          <div className="dh-kpi-icon dh-kpi-icon--red"><LuTriangleAlert size={18} /></div>
          <div className="dh-kpi-body">
            <span className="dh-kpi-value">{loading ? '…' : `${kpis?.pctCritique ?? '—'} %`}</span>
            <span className="dh-kpi-label">Stress élevé + sévère</span>
          </div>
        </div>
      </div>

      {missionsWithData.length === 0 ? (
        <div className="dh-no-data">
          <span className="dh-no-data-icon">🛰️</span>
          <p>Aucune mission avec données cartographiques.<br />Créez une mission et importez un shapefile.</p>
          <button className="btn-primary" onClick={onOpenMap} style={{ marginTop: 16 }}>
            Gérer les missions
          </button>
        </div>
      ) : (
        <div className="dh-grid">

          {/* ── Donut répartition stress ── */}
          <div className="dh-card">
            <h3 className="dh-card-title">
              <LuDroplet size={13} /> Répartition du stress hydrique
            </h3>
            {donutData.length > 0 ? (
              <div className="dh-donut-wrap">
                <ResponsiveContainer width="55%" height={190}>
                  <PieChart>
                    <Pie
                      data={donutData} cx="50%" cy="50%"
                      innerRadius={48} outerRadius={74}
                      paddingAngle={2} dataKey="value"
                    >
                      {donutData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v, n) => [`${v} arbres`, n]}
                      contentStyle={TOOLTIP_STYLE}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="dh-donut-legend">
                  {donutData.map(d => (
                    <div key={d.classe} className="dh-donut-item">
                      <span className="dh-donut-swatch" style={{ background: d.color }} />
                      <span className="dh-donut-label">{d.name}</span>
                      <span className="dh-donut-val">{d.value}</span>
                    </div>
                  ))}
                  {/* Delta indicator */}
                  {deltaStress && (
                    <div className={`dh-delta${deltaStress.delta > 0 ? ' dh-delta--up' : deltaStress.delta < 0 ? ' dh-delta--down' : ''}`}>
                      {deltaStress.delta > 0
                        ? <LuArrowUpRight size={13} />
                        : deltaStress.delta < 0
                          ? <LuArrowDownRight size={13} />
                          : <LuMinus size={13} />
                      }
                      <span>
                        Δ stress élevé+sévère :&nbsp;
                        <strong>{deltaStress.delta > 0 ? '+' : ''}{deltaStress.delta}</strong> arbres
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="dh-empty">{loading ? 'Chargement…' : 'Aucune donnée de stress'}</div>
            )}
          </div>

          {/* ── Barres empilées comparaison missions ── */}
          <div className="dh-card">
            <h3 className="dh-card-title">
              <LuTrendingUp size={13} /> Évolution stress par mission
            </h3>
            {stackedBarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={stackedBarData} margin={{ top: 4, right: 8, left: -24, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.3)" vertical={false} />
                  <XAxis
                    dataKey="name" fontSize={9} tick={{ fill: '#9ab1c8' }}
                    tickLine={false} angle={-20} textAnchor="end" interval={0}
                  />
                  <YAxis fontSize={9} tick={{ fill: '#9ab1c8' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  {STRESS_ORDER.map(k => (
                    <Bar key={k} dataKey={k} name={STRESS_LABELS[k]} stackId="a"
                      fill={STRESS_COLORS[k]}
                      radius={k === 'severe' ? [3, 3, 0, 0] : undefined}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="dh-empty">{loading ? 'Chargement…' : 'Aucune donnée'}</div>
            )}
          </div>

          {/* ── Line chart CWSI ── */}
          <div className="dh-card">
            <h3 className="dh-card-title">
              <LuTrendingUp size={13} /> CWSI moyen par mission
            </h3>
            {lineData.length > 0 ? (
              <ResponsiveContainer width="100%" height={190}>
                <LineChart data={lineData} margin={{ top: 8, right: 12, left: -20, bottom: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.3)" vertical={false} />
                  <XAxis
                    dataKey="date" fontSize={10} tick={{ fill: '#9ab1c8' }}
                    tickLine={false} angle={-30} textAnchor="end" interval={0}
                  />
                  <YAxis domain={[0, 1]} fontSize={10} tick={{ fill: '#9ab1c8' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={v => [v?.toFixed(2), 'CWSI moyen']} contentStyle={TOOLTIP_STYLE} />
                  <Line
                    type="monotone" dataKey="cwsi" stroke="#0e74c6" strokeWidth={2.5}
                    dot={{ r: 4, fill: '#0e74c6', strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: '#0e74c6', stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="dh-empty">{loading ? 'Chargement…' : 'Au moins 2 missions requises'}</div>
            )}
          </div>

          {/* ── Scatter plot Température × CWSI ── */}
          <div className="dh-card">
            <h3 className="dh-card-title">
              <LuActivity size={13} /> Corrélation Température × CWSI
            </h3>
            {scatterData.length >= 2 ? (
              <>
                <ResponsiveContainer width="100%" height={170}>
                  <ScatterChart margin={{ top: 8, right: 12, left: -20, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.3)" />
                    <XAxis
                      type="number" dataKey="x" name="Temp moy (°C)"
                      domain={['auto', 'auto']}
                      fontSize={10} tick={{ fill: '#9ab1c8' }} tickLine={false} axisLine={false}
                      label={{ value: '°C', position: 'insideRight', offset: -4, fontSize: 9, fill: '#9ab1c8' }}
                    />
                    <YAxis
                      type="number" dataKey="y" name="CWSI"
                      domain={[0, 1]}
                      fontSize={10} tick={{ fill: '#9ab1c8' }} tickLine={false} axisLine={false}
                      label={{ value: 'CWSI', angle: -90, position: 'insideLeft', offset: 12, fontSize: 9, fill: '#9ab1c8' }}
                    />
                    <ZAxis range={[55, 55]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v, n) => [v, n]}
                      content={({ payload }) => {
                        if (!payload?.length) return null
                        const d = payload[0]?.payload
                        return (
                          <div style={{ ...TOOLTIP_STYLE, padding: '6px 10px' }}>
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>{d?.name}</div>
                            <div>Temp : {d?.x} °C</div>
                            <div>CWSI : {d?.y}</div>
                          </div>
                        )
                      }}
                    />
                    <Scatter name="Missions" data={scatterData} fill="#0e74c6" opacity={0.85} />
                    {regLine.length === 2 && (
                      <Scatter
                        name="Tendance" data={regLine} fill="none"
                        line={{ stroke: '#f97316', strokeWidth: 2, strokeDasharray: '6 3' }}
                        shape={({ cx, cy }) => <circle cx={cx} cy={cy} r={0} />}
                      />
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
                {regInfo && (
                  <div className="dh-reg-info">
                    <span>y = {regInfo.m > 0 ? '+' : ''}{regInfo.m} × T {regInfo.b >= 0 ? '+' : ''}{regInfo.b}</span>
                    <span className="dh-reg-r2">R² = {regInfo.r2}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="dh-empty">
                {loading ? 'Chargement…' : scatterData.length < 2
                  ? 'Au moins 2 missions avec température requises'
                  : 'Données insuffisantes'
                }
              </div>
            )}
          </div>

          {/* ── Alertes prioritaires ── */}
          <div className="dh-card dh-card--full">
            <h3 className="dh-card-title">
              <LuTriangleAlert size={13} /> Arbres prioritaires — CWSI le plus élevé
            </h3>
            {topTrees.length > 0 ? (
              <div className="dh-alerts-grid">
                {topTrees.map((t, i) => (
                  <div key={`${t.mission}-${t.id}-${i}`} className="dh-alert-item">
                    <span className="dh-alert-rank">#{i + 1}</span>
                    <div className="dh-alert-body">
                      <span className="dh-alert-id">Arbre #{t.id}</span>
                      <span className="dh-alert-mission">{t.mission} · {t.date}</span>
                    </div>
                    <div className="dh-alert-right">
                      <span
                        className="dh-alert-badge"
                        style={{
                          background: (STRESS_COLORS[t.stress] ?? '#95a5a6') + '22',
                          color:      STRESS_COLORS[t.stress] ?? '#95a5a6',
                          border:     `1px solid ${STRESS_COLORS[t.stress] ?? '#95a5a6'}55`,
                        }}
                      >
                        {STRESS_LABELS[t.stress] ?? t.stress}
                      </span>
                      <span className="dh-alert-cwsi">{t.cwsi?.toFixed(3)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dh-empty">
                {loading ? 'Chargement des arbres…' : 'Aucun arbre avec données CWSI sur cette période'}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
