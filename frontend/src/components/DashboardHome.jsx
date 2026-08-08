import { useState, useEffect, useMemo } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  BarChart, Bar,
} from 'recharts'
import { fetchStats, fetchTrees } from '../api'
import { STRESS_COLORS, STRESS_LABELS } from '../constants'
import WeatherWidget from './WeatherWidget'
import BeforeAfterSlider from './BeforeAfterSlider'
import {
  LuMap, LuLeaf, LuDroplet, LuTriangleAlert, LuTrendingUp,
  LuSatellite, LuArrowRight, LuCalendar, LuArrowUpRight,
  LuArrowDownRight, LuMinus, LuActivity,
} from 'react-icons/lu'

const STRESS_ORDER = ['aucun', 'faible', 'modere', 'eleve', 'severe']

function missionLabel(m) {
  if (!m) return ''
  const name = m.nom || m.id || ''
  if (m.date && !name.includes(m.date)) return `${name} — ${m.date}`
  return name
}

const TOOLTIP_STYLE = {
  background: 'rgba(15,23,42,0.97)',
  border: '1px solid rgba(148,163,184,0.18)',
  borderRadius: 8,
  fontSize: 12,
  color: '#f1f5f9',
  boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
  backdropFilter: 'blur(16px)',
}

function fmtDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
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
                  {missionLabel(m)}
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
                  {missionLabel(m)}
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
                    dataKey="name" fontSize={9} tick={{ fill: '#8ba08e' }}
                    tickLine={false} angle={-20} textAnchor="end" interval={0}
                  />
                  <YAxis fontSize={9} tick={{ fill: '#8ba08e' }} tickLine={false} axisLine={false} />
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
                    dataKey="date" fontSize={10} tick={{ fill: '#8ba08e' }}
                    tickLine={false} angle={-30} textAnchor="end" interval={0}
                  />
                  <YAxis domain={[0, 1]} fontSize={10} tick={{ fill: '#8ba08e' }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={v => [v?.toFixed(2), 'CWSI moyen']} contentStyle={TOOLTIP_STYLE} />
                  <Line
                    type="monotone" dataKey="cwsi" stroke="#4a7c59" strokeWidth={2.5}
                    dot={{ r: 4, fill: '#4a7c59', strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: '#4a7c59', stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="dh-empty">{loading ? 'Chargement…' : 'Au moins 2 missions requises'}</div>
            )}
          </div>

          {/* ── Bilan de la période ── */}
          <div className="dh-card">
            <h3 className="dh-card-title">
              <LuActivity size={13} /> Bilan de la période
            </h3>

            {filteredStats.length >= 1 ? (() => {
              const first = filteredStats[0]
              const last  = filteredStats[filteredStats.length - 1]

              const cwsiFirst = first.stats.cwsi?.moyenne
              const cwsiLast  = last.stats.cwsi?.moyenne
              const deltaCwsi = cwsiFirst != null && cwsiLast != null
                ? +(cwsiLast - cwsiFirst).toFixed(3) : null

              const getCritPct = m => {
                const total = m.stats.total_arbres || 1
                const crit  = (m.stats.stress_breakdown ?? [])
                  .filter(s => s.classe === 'eleve' || s.classe === 'severe')
                  .reduce((n, s) => n + s.count, 0)
                return Math.round((crit / total) * 100)
              }
              const critFirst = getCritPct(first)
              const critLast  = getCritPct(last)
              const deltaCrit = critLast - critFirst

              const rows = [
                {
                  label: 'CWSI moyen',
                  first: cwsiFirst?.toFixed(3) ?? '—',
                  last:  cwsiLast?.toFixed(3)  ?? '—',
                  delta: deltaCwsi,
                  unit:  '',
                  lowerIsBetter: true,
                },
                {
                  label: 'Stress critique',
                  first: `${critFirst}%`,
                  last:  `${critLast}%`,
                  delta: deltaCrit,
                  unit:  '%',
                  lowerIsBetter: true,
                },
                {
                  label: 'Arbres totaux',
                  first: first.stats.total_arbres ?? '—',
                  last:  last.stats.total_arbres  ?? '—',
                  delta: null,
                  unit:  '',
                  lowerIsBetter: false,
                },
              ]

              return (
                <div className="dh-bilan">
                  <div className="dh-bilan-header">
                    <span />
                    <span className="dh-bilan-col">{first.nom || first.id}</span>
                    <span className="dh-bilan-col">{last.nom  || last.id}</span>
                    <span className="dh-bilan-col">Évolution</span>
                  </div>
                  {rows.map(row => (
                    <div key={row.label} className="dh-bilan-row">
                      <span className="dh-bilan-label">{row.label}</span>
                      <span className="dh-bilan-val">{row.first}</span>
                      <span className="dh-bilan-val">{row.last}</span>
                      <span className={`dh-bilan-delta ${
                        row.delta == null ? '' :
                        row.delta === 0 ? 'neutral' :
                        (row.lowerIsBetter ? row.delta < 0 : row.delta > 0) ? 'good' : 'bad'
                      }`}>
                        {row.delta == null ? '—' :
                         row.delta === 0  ? '=' :
                         `${row.delta > 0 ? '▲' : '▼'} ${Math.abs(row.delta)}${row.unit}`}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })() : (
              <div className="dh-empty">
                {loading ? 'Chargement…' : 'Données insuffisantes'}
              </div>
            )}
          </div>

          {/* ── Comparaison before/after ── */}
          {startMission && endMission && startMission.id !== endMission.id && (
            <div className="dh-card dh-card--full">
              <h3 className="dh-card-title">
                <LuTrendingUp size={13} /> Comparaison visuelle — Carte de stress
              </h3>
              <BeforeAfterSlider mission1={startMission} mission2={endMission} />
            </div>
          )}

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
                          background: (STRESS_COLORS[t.stress] ?? '#7e8c80') + '22',
                          color:      STRESS_COLORS[t.stress] ?? '#7e8c80',
                          border:     `1px solid ${STRESS_COLORS[t.stress] ?? '#7e8c80'}55`,
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
