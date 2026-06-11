import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid, LabelList,
} from 'recharts'
import { STRESS_COLORS } from '../constants'

const SHORT_STRESS = { aucun: 'Aucun', faible: 'Faible', modere: 'Modéré', eleve: 'Élevé', severe: 'Sévère', inconnu: '—' }
const STRESS_ORDER  = { severe: 5, eleve: 4, modere: 3, faible: 2, aucun: 1, inconnu: 0 }

const COLS = [
  { key: 'id',       label: 'ID' },
  { key: 'stress',   label: 'Stress' },
  { key: 'cwsi',     label: 'CWSI' },
  { key: 'temp_moy', label: 'Temp. (°C)' },
  { key: 'hauteur',  label: 'Hauteur (m)' },
]

function GlassTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const v = payload[0].value
  return (
    <div style={{
      background: 'rgba(255,255,255,0.97)',
      border: '1px solid rgba(203,213,225,0.8)',
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 12,
      color: '#0f172a',
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    }}>
      <div style={{ color: '#64748b', marginBottom: 3 }}>{label}</div>
      <b>{v} arbre{v !== 1 ? 's' : ''}</b>
    </div>
  )
}

function estimateSurface(features) {
  if (!features?.length) return null
  const coords = features.map(f => f.geometry?.coordinates).filter(Boolean)
  if (coords.length < 2) return null
  const lons = coords.map(c => c[0])
  const lats = coords.map(c => c[1])
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2
  const dy = (Math.max(...lats) - Math.min(...lats)) * 111000
  const dx = (Math.max(...lons) - Math.min(...lons)) * 111000 * Math.cos(latMid * Math.PI / 180)
  const ha = (dy * dx) / 10000
  return ha >= 0.01 ? ha.toFixed(2) : null
}

function getRecommendation(cwsiMoy, stressedCount, totalTrees) {
  if (cwsiMoy == null) return null
  const pct = totalTrees > 0 ? Math.round((stressedCount / totalTrees) * 100) : 0

  if (cwsiMoy < 0.3) {
    return {
      badge: '✓ État hydrique satisfaisant',
      color: '#16a34a',
      bg: 'rgba(22,163,74,0.07)',
      border: 'rgba(22,163,74,0.22)',
      items: [
        "Maintenir le programme d'irrigation actuel — aucun déficit hydrique significatif détecté.",
        "Effectuer un suivi de routine toutes les 2–3 semaines avec sonde tensiométrique.",
        "Surveiller les secteurs à CWSI > 0.2 pour prévenir toute dégradation localisée.",
      ],
      water: null,
    }
  }
  if (cwsiMoy < 0.5) {
    return {
      badge: '⚠ Vigilance recommandée',
      color: '#d97706',
      bg: 'rgba(217,119,6,0.07)',
      border: 'rgba(217,119,6,0.28)',
      items: [
        `${pct}% des arbres présentent un stress hydrique modéré — augmenter la fréquence des apports.`,
        "Irriguer tôt le matin pour limiter l'évapotranspiration ; éviter les apports en plein soleil.",
        "Concentrer les ressources sur les secteurs à CWSI ≥ 0.3 identifiés dans le tableau ci-dessus.",
      ],
      water: 25,
    }
  }
  return {
    badge: '🚨 Intervention urgente',
    color: '#dc2626',
    bg: 'rgba(220,38,38,0.06)',
    border: 'rgba(220,38,38,0.28)',
    items: [
      `Stress hydrique sévère détecté (CWSI moyen = ${cwsiMoy.toFixed(2)}) — irrigation d'urgence recommandée sous 24–48 h.`,
      "Prioriser les arbres à CWSI ≥ 0.7 (stress sévère) ; réaliser un apport prolongé par goutte-à-goutte.",
      "Vérifier l'état du réseau d'irrigation (pression, colmatage goutteurs) et organiser les interventions terrain.",
    ],
    water: 45,
  }
}

export default function MissionReport({ mission, stats, features, allFeatures, onBack }) {
  const [sortCol, setSortCol] = useState('cwsi')
  const [sortDir, setSortDir] = useState('desc')

  const src = allFeatures?.length ? allFeatures : (features ?? [])

  // Top 10 arbres les plus stressés (CWSI le plus élevé), puis re-triés par colonne choisie
  const criticalTrees = useMemo(() => {
    const withCwsi = src.filter(f => f.properties.cwsi != null)
    const top10 = [...withCwsi]
      .sort((a, b) => (b.properties.cwsi ?? 0) - (a.properties.cwsi ?? 0))
      .slice(0, 10)

    return [...top10].sort((a, b) => {
      let av = sortCol === 'stress' ? (STRESS_ORDER[a.properties.stress] ?? 0) : (a.properties[sortCol] ?? null)
      let bv = sortCol === 'stress' ? (STRESS_ORDER[b.properties.stress] ?? 0) : (b.properties[sortCol] ?? null)
      const sentinel = sortDir === 'asc' ? Infinity : -Infinity
      av = av ?? sentinel
      bv = bv ?? sentinel
      if (av === bv) return 0
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (bv > av ? 1 : -1)
    })
  }, [src, sortCol, sortDir])

  const stressChartData = useMemo(() => {
    if (!stats?.stress_breakdown) return []
    return stats.stress_breakdown.map(s => ({
      ...s,
      label: SHORT_STRESS[s.classe] ?? s.classe,
    }))
  }, [stats?.stress_breakdown])

  const cwsiMoy  = stats?.cwsi?.moyenne
  const tempMoy  = stats?.temperature?.moyenne
  const total    = stats?.total_arbres ?? 0
  const stressed = useMemo(
    () => (stats?.stress_breakdown ?? []).filter(s => ['eleve', 'severe'].includes(s.classe)).reduce((n, s) => n + s.count, 0),
    [stats?.stress_breakdown],
  )
  const pctStressed = total > 0 ? Math.round((stressed / total) * 100) : 0
  const surface     = useMemo(() => estimateSurface(src), [src])
  const reco        = getRecommendation(cwsiMoy, stressed, total)

  function handleSort(col) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('desc')
    }
  }

  function SortIndicator({ col }) {
    if (sortCol !== col) return <span className="report-sort-icon">↕</span>
    return <span className="report-sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="report-page">

      {/* ── En-tête ── */}
      <div className="report-header">
        <div className="report-header-left">
          <button className="report-back-btn no-print" onClick={onBack}>← Carte</button>
          <div>
            <h1 className="report-title">{mission.nom || mission.id}</h1>
            <div className="report-meta">
              <span>📅 {mission.date}</span>
              <span>🌳 {total} arbre{total !== 1 ? 's' : ''}</span>
              <span className="report-status-badge">Terminée</span>
            </div>
          </div>
        </div>
        <button className="report-print-btn no-print" onClick={() => window.print()}>
          🖨️ Exporter PDF
        </button>
      </div>

      <div className="report-body">

        {/* ── Résumé exécutif ── */}
        <section className="report-section">
          <h2 className="report-section-title">Résumé exécutif</h2>
          <div className="report-kpis">
            <div className="report-kpi">
              <span className="report-kpi-icon">💧</span>
              <div className="report-kpi-val">{cwsiMoy?.toFixed(2) ?? '—'}</div>
              <div className="report-kpi-lbl">CWSI moyen</div>
            </div>
            <div className={`report-kpi${pctStressed > 30 ? ' report-kpi--warn' : ''}`}>
              <span className="report-kpi-icon">⚠️</span>
              <div className="report-kpi-val">{pctStressed}%</div>
              <div className="report-kpi-lbl">Arbres stressés</div>
              <div className="report-kpi-sub">élevé + sévère</div>
            </div>
            <div className="report-kpi">
              <span className="report-kpi-icon">🌡️</span>
              <div className="report-kpi-val">{tempMoy != null ? `${tempMoy.toFixed(1)}°C` : '—'}</div>
              <div className="report-kpi-lbl">Température moy.</div>
            </div>
            <div className="report-kpi">
              <span className="report-kpi-icon">📐</span>
              <div className="report-kpi-val">{surface != null ? `${surface} ha` : '—'}</div>
              <div className="report-kpi-lbl">Surface estimée</div>
              {surface != null && <div className="report-kpi-sub">bounding box</div>}
            </div>
          </div>
        </section>

        {/* ── Répartition par stress ── */}
        <section className="report-section">
          <h2 className="report-section-title">Répartition par niveau de stress</h2>
          <div className="report-chart-wrap">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stressChartData} margin={{ top: 20, right: 20, left: 10, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
                <XAxis
                  dataKey="label"
                  fontSize={12}
                  tick={{ fill: '#5a7a9a' }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148,163,184,0.2)' }}
                />
                <YAxis
                  fontSize={11}
                  tick={{ fill: '#94a3b8' }}
                  tickLine={false}
                  axisLine={false}
                  width={38}
                  label={{ value: 'arbres', angle: -90, position: 'insideLeft', offset: 8, style: { fill: '#94a3b8', fontSize: 10 } }}
                />
                <Tooltip content={<GlassTip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                  {stressChartData.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.85} />)}
                  <LabelList dataKey="count" position="top" fontSize={11} fill="var(--text-muted)" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ── Tableau arbres critiques ── */}
        <section className="report-section">
          <h2 className="report-section-title">Top 10 — Arbres les plus stressés</h2>
          <div className="report-table-wrap">
            <table className="report-table">
              <thead>
                <tr>
                  {COLS.map(({ key, label }) => (
                    <th key={key} className="report-th" onClick={() => handleSort(key)}>
                      {label}<SortIndicator col={key} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {criticalTrees.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="report-td" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24 }}>
                      Aucune donnée CWSI disponible
                    </td>
                  </tr>
                ) : (
                  criticalTrees.map((f, i) => {
                    const p = f.properties
                    const s = p.stress ?? 'inconnu'
                    const c = STRESS_COLORS[s] ?? '#95a5a6'
                    return (
                      <tr key={p.id ?? i} className={`report-tr${i % 2 === 0 ? ' even' : ''}`}>
                        <td className="report-td report-td-id">{p.id ?? '—'}</td>
                        <td className="report-td">
                          <span
                            className="report-stress-badge"
                            style={{ background: c + '1a', color: c, border: `1px solid ${c}40` }}
                          >
                            {SHORT_STRESS[s] ?? s}
                          </span>
                        </td>
                        <td
                          className="report-td report-td-num"
                          style={{ color: (p.cwsi ?? 0) > 0.5 ? 'var(--color-danger)' : 'inherit', fontWeight: (p.cwsi ?? 0) > 0.5 ? 600 : 400 }}
                        >
                          {p.cwsi?.toFixed(3) ?? '—'}
                        </td>
                        <td className="report-td report-td-num">{p.temp_moy?.toFixed(1) ?? '—'}</td>
                        <td className="report-td report-td-num">{p.hauteur?.toFixed(1) ?? '—'}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Recommandations agronomiques ── */}
        {reco && (
          <section className="report-section">
            <h2 className="report-section-title">Recommandations agronomiques</h2>
            <div
              className="report-reco"
              style={{ background: reco.bg, border: `1px solid ${reco.border}` }}
            >
              <div className="report-reco-header">
                <span className="report-reco-badge" style={{ color: reco.color, borderColor: reco.border }}>
                  {reco.badge}
                </span>
                {reco.water && (
                  <span className="report-reco-water">
                    💧 ~{reco.water} L/arbre
                    {total ? ` — ${(reco.water * total / 1000).toFixed(1)} m³ pour la parcelle` : ''}
                  </span>
                )}
              </div>
              <ul className="report-reco-list">
                {reco.items.map((item, i) => (
                  <li key={i} className="report-reco-item">{item}</li>
                ))}
              </ul>
            </div>
          </section>
        )}

        <div className="report-footer no-print">
          GeoOlive · Rapport généré le {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
        </div>

      </div>
    </div>
  )
}
