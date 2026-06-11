import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Cell,
  ScatterChart, Scatter,
  ComposedChart, Line, Area,
} from 'recharts'
import {
  LuLeaf, LuX, LuTrendingUp, LuDroplets, LuTriangleAlert,
} from 'react-icons/lu'
import { STRESS_COLORS } from '../constants'
import { fetchYieldPredictionsAll } from '../api'

const STRESS_ORDER = ['aucun', 'faible', 'modere', 'eleve', 'severe']
const STRESS_LABEL = {
  aucun: 'Aucun', faible: 'Faible', modere: 'Modéré',
  eleve: 'Élevé', severe: 'Sévère',
}

const DIST_BINS = [
  { label: '0–5 kg',   min: 0,  max: 5 },
  { label: '5–10 kg',  min: 5,  max: 10 },
  { label: '10–15 kg', min: 10, max: 15 },
  { label: '15–20 kg', min: 15, max: 20 },
  { label: '20+ kg',   min: 20, max: Infinity },
]
const DIST_COLORS = ['#ef4444', '#f97316', '#fbbf24', '#86efac', '#22c55e']

function ChartTooltip({ contentStyle, ...props }) {
  return (
    <Tooltip
      {...props}
      contentStyle={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border-md)',
        borderRadius: 8,
        fontSize: 11,
        ...contentStyle,
      }}
    />
  )
}

export default function PredictiveAnalysis({
  yieldPredictions,
  features,
  missions,
  currentId,
  currentMission,
  onPredictYield,
  yieldLoading,
  onClose,
}) {
  const [missionYields, setMissionYields] = useState({})
  const [loadingAll, setLoadingAll] = useState(false)

  // Join features with yield predictions into per-tree records
  const treeData = useMemo(() => {
    if (!yieldPredictions || !features.length) return []
    return features.flatMap(f => {
      const p = f.properties
      const rendement = yieldPredictions[p.id]
      if (rendement == null) return []
      return [{ id: p.id, cwsi: p.cwsi, stress: p.stress, rendement, hauteur: p.hauteur }]
    })
  }, [yieldPredictions, features])

  const hasData = treeData.length > 0

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!treeData.length) return null
    const yields = treeData.map(t => t.rendement)
    const avg = yields.reduce((a, b) => a + b, 0) / yields.length
    const total = yields.reduce((a, b) => a + b, 0)
    const below5 = yields.filter(y => y < 5).length
    const grouped = {}
    treeData.forEach(t => {
      if (!grouped[t.stress]) grouped[t.stress] = []
      grouped[t.stress].push(t.rendement)
    })
    let bestZone = null, bestAvg = -Infinity
    Object.entries(grouped).forEach(([s, ys]) => {
      const a = ys.reduce((x, y) => x + y, 0) / ys.length
      if (a > bestAvg) { bestAvg = a; bestZone = s }
    })
    return { avg, total, below5, bestZone, bestAvg }
  }, [treeData])

  // ── Distribution ─────────────────────────────────────────────────────────
  const distributionData = useMemo(() =>
    DIST_BINS.map((bin, i) => ({
      label: bin.label,
      count: treeData.filter(t => t.rendement >= bin.min && t.rendement < bin.max).length,
      color: DIST_COLORS[i],
    })),
  [treeData])

  // ── Scatter: grouped by stress for per-group colors ──────────────────────
  const scatterByStress = useMemo(() => {
    const groups = {}
    STRESS_ORDER.forEach(s => { groups[s] = [] })
    treeData.forEach(t => {
      if (groups[t.stress]) groups[t.stress].push({ cwsi: t.cwsi, rendement: t.rendement })
    })
    return groups
  }, [treeData])

  // ── Recommendations (top 5 trees by CWSI desc) ───────────────────────────
  const faibleAvg = useMemo(() => {
    const low = treeData.filter(t => t.cwsi < 0.3)
    return low.length ? low.reduce((s, t) => s + t.rendement, 0) / low.length : 15
  }, [treeData])

  const recommendations = useMemo(() =>
    treeData
      .filter(t => t.cwsi >= 0.7)
      .sort((a, b) => b.cwsi - a.cwsi)
      .slice(0, 5)
      .map(t => ({ ...t, gain: Math.max(0, faibleAvg - t.rendement) })),
  [treeData, faibleAvg])

  const severeCount = treeData.filter(t => t.cwsi >= 0.7).length
  const totalGain = treeData
    .filter(t => t.cwsi >= 0.7)
    .reduce((sum, t) => sum + Math.max(0, faibleAvg - t.rendement), 0)

  // ── Heatmap: groups of 10 trees → avg yield per row ─────────────────────
  const heatmapData = useMemo(() => {
    const ROW = 10
    const rows = []
    for (let i = 0; i < treeData.length; i += ROW) {
      const slice = treeData.slice(i, i + ROW)
      const avg = slice.reduce((s, t) => s + t.rendement, 0) / slice.length
      rows.push({ label: `R${Math.floor(i / ROW) + 1}`, avg: +avg.toFixed(1), trees: slice })
    }
    return rows
  }, [treeData])

  const maxYield = useMemo(() =>
    treeData.length ? Math.max(...treeData.map(t => t.rendement), 1) : 20,
  [treeData])

  // ── Inter-mission comparison ──────────────────────────────────────────────
  useEffect(() => {
    const withData = missions.filter(m => m.has_shapefile)
    if (withData.length < 2) return
    let cancelled = false
    setLoadingAll(true)
    Promise.all(
      withData.map(m =>
        fetchYieldPredictionsAll(m.id)
          .then(data => {
            const ys = data.predictions.map(p => p.rendement_kg_predit)
            return {
              id: m.id,
              date: m.date ?? '',
              nom: m.nom || m.id,
              avg: ys.reduce((a, b) => a + b, 0) / ys.length,
              min: Math.min(...ys),
              max: Math.max(...ys),
            }
          })
          .catch(() => null)
      )
    ).then(results => {
      if (cancelled) return
      const map = {}
      results.filter(Boolean).forEach(r => { map[r.id] = r })
      setMissionYields(map)
    }).finally(() => { if (!cancelled) setLoadingAll(false) })
    return () => { cancelled = true }
  }, [missions]) // eslint-disable-line react-hooks/exhaustive-deps

  const interMissionData = useMemo(() =>
    Object.values(missionYields)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(m => ({
        name: m.nom,
        avg: +m.avg.toFixed(2),
        baseline: +m.min.toFixed(2),
        range: +(m.max - m.min).toFixed(2),
      })),
  [missionYields])

  const showInterMission = interMissionData.length >= 2

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="pa-page">
      <div className="pa-wrap">

        {/* Header */}
        <div className="pa-header">
          <div className="pa-header-left">
            <LuLeaf size={22} className="pa-header-icon" />
            <div>
              <h2 className="pa-title">Analyse prédictive du rendement</h2>
              <p className="pa-subtitle">
                {currentMission
                  ? `${currentMission.nom || currentMission.id} · ${currentMission.date}`
                  : 'Aucune mission sélectionnée'}
              </p>
            </div>
          </div>
          <div className="pa-header-actions">
            {currentMission?.has_shapefile && (
              <button className="pa-btn-predict" onClick={onPredictYield} disabled={yieldLoading}>
                {yieldLoading ? '⏳ Calcul en cours…' : '✨ Recalculer'}
              </button>
            )}
            <button className="pa-btn-close" onClick={onClose} title="Fermer">
              <LuX size={16} />
            </button>
          </div>
        </div>

        {/* Empty / loading state */}
        {!hasData && (
          <div className="pa-empty">
            {yieldLoading ? (
              <>
                <div className="pa-spinner" />
                <p>Calcul de la prédiction IA en cours…</p>
              </>
            ) : (
              <>
                <LuLeaf size={48} style={{ color: 'var(--text-dim)', marginBottom: 12 }} />
                <p>Aucune donnée de prédiction disponible pour cette mission.</p>
                {currentMission?.has_shapefile && (
                  <button className="pa-btn-predict" style={{ marginTop: 16 }} onClick={onPredictYield}>
                    ✨ Lancer la prédiction
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {hasData && (
          <>
            {/* KPIs */}
            <div className="pa-kpis">
              <div className="pa-kpi">
                <div className="pa-kpi-icon" style={{ background: 'rgba(34,197,94,.12)' }}>
                  <LuLeaf size={18} style={{ color: '#22c55e' }} />
                </div>
                <div>
                  <div className="pa-kpi-label">Rendement moyen</div>
                  <div className="pa-kpi-value">
                    {kpis.avg.toFixed(1)}<span className="pa-kpi-unit"> kg/arbre</span>
                  </div>
                </div>
              </div>

              <div className="pa-kpi">
                <div className="pa-kpi-icon" style={{ background: 'rgba(59,130,246,.12)' }}>
                  <LuTrendingUp size={18} style={{ color: '#3b82f6' }} />
                </div>
                <div>
                  <div className="pa-kpi-label">Production totale estimée</div>
                  <div className="pa-kpi-value">
                    {kpis.total.toFixed(0)}<span className="pa-kpi-unit"> kg</span>
                    <span className="pa-kpi-secondary"> · {(kpis.total / 1000).toFixed(2)} t</span>
                  </div>
                </div>
              </div>

              <div className="pa-kpi">
                <div className="pa-kpi-icon" style={{ background: 'rgba(239,68,68,.12)' }}>
                  <LuTriangleAlert size={18} style={{ color: '#ef4444' }} />
                </div>
                <div>
                  <div className="pa-kpi-label">Arbres &lt; 5 kg/arbre</div>
                  <div className="pa-kpi-value">
                    {kpis.below5}<span className="pa-kpi-unit"> / {treeData.length}</span>
                    <span className="pa-kpi-secondary"> ({((kpis.below5 / treeData.length) * 100).toFixed(0)} %)</span>
                  </div>
                </div>
              </div>

              <div className="pa-kpi">
                <div className="pa-kpi-icon" style={{ background: 'rgba(234,179,8,.12)' }}>
                  <LuDroplets size={18} style={{ color: '#eab308' }} />
                </div>
                <div>
                  <div className="pa-kpi-label">Meilleure zone de stress</div>
                  <div className="pa-kpi-value">
                    {STRESS_LABEL[kpis.bestZone] ?? kpis.bestZone}
                    <span className="pa-kpi-secondary"> · {kpis.bestAvg.toFixed(1)} kg/arbre</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Charts grid */}
            <div className="pa-grid">

              {/* Distribution */}
              <div className="pa-card">
                <div className="pa-card-title">Distribution du rendement</div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={distributionData} barCategoryGap="28%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} allowDecimals={false} />
                    <ChartTooltip formatter={(v) => [v + ' arbres', 'Effectif']} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {distributionData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Scatter Rendement × CWSI */}
              <div className="pa-card">
                <div className="pa-card-title">Rendement × CWSI (par niveau de stress)</div>
                <ResponsiveContainer width="100%" height={200}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                    <XAxis
                      type="number" dataKey="cwsi" name="CWSI" domain={[0, 1]}
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      label={{ value: 'CWSI', position: 'insideBottom', offset: -8, fontSize: 10, fill: 'var(--text-muted)' }}
                    />
                    <YAxis
                      type="number" dataKey="rendement" name="Rendement (kg)"
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                    />
                    <ChartTooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      formatter={(v, name) => [
                        name === 'CWSI' ? (+v).toFixed(3) : (+v).toFixed(1) + ' kg',
                        name,
                      ]}
                    />
                    {STRESS_ORDER.map(s =>
                      scatterByStress[s]?.length > 0 && (
                        <Scatter
                          key={s}
                          name={STRESS_LABEL[s]}
                          data={scatterByStress[s]}
                          fill={STRESS_COLORS[s]}
                          fillOpacity={0.75}
                        />
                      )
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
                <div className="pa-scatter-legend">
                  {STRESS_ORDER.filter(s => scatterByStress[s]?.length > 0).map(s => (
                    <span key={s} className="pa-scatter-dot">
                      <span style={{ background: STRESS_COLORS[s] }} />
                      {STRESS_LABEL[s]}
                    </span>
                  ))}
                </div>
              </div>

              {/* Inter-mission comparison */}
              {showInterMission && (
                <div className="pa-card pa-card--wide">
                  <div className="pa-card-title">Comparaison inter-missions</div>
                  {loadingAll ? (
                    <div className="pa-loading-bar"><div className="pa-loading-bar-inner" /></div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={interMissionData} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
                        <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} unit=" kg" />
                        <ChartTooltip
                          formatter={(v, name) => {
                            if (name === 'avg') return [v.toFixed(1) + ' kg/arbre', 'Moyenne']
                            if (name === 'range') return [v.toFixed(1) + ' kg', 'Amplitude min-max']
                            return [v, name]
                          }}
                        />
                        <Area type="monotone" dataKey="baseline" stackId="band"
                          stroke="none" fill="transparent" legendType="none" />
                        <Area type="monotone" dataKey="range" stackId="band"
                          stroke="none" fill="#22c55e" fillOpacity={0.15} legendType="none" />
                        <Line type="monotone" dataKey="avg" stroke="#22c55e" strokeWidth={2}
                          dot={{ r: 4, fill: '#22c55e' }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )}

            </div>

            {/* Heatmap */}
            {heatmapData.length > 0 && (
              <div className="pa-card pa-card--full">
                <div className="pa-card-title">Carte thermique — rendement par rangée</div>
                <div className="pa-heatmap">
                  {heatmapData.map((row, i) => {
                    const rowPct = row.avg / maxYield
                    return (
                      <div key={i} className="pa-heatmap-row">
                        <span className="pa-heatmap-label">{row.label}</span>
                        <div className="pa-heatmap-cells">
                          {row.trees.map((t, j) => {
                            const pct = t.rendement / maxYield
                            const r = Math.round(240 - pct * 200)
                            const g = Math.round(60  + pct * 160)
                            const b = 70
                            return (
                              <div key={j} className="pa-heatmap-cell"
                                style={{ background: `rgb(${r},${g},${b})` }}
                                title={`Arbre ${t.id} · ${t.rendement.toFixed(1)} kg`}
                              />
                            )
                          })}
                        </div>
                        <span
                          className="pa-heatmap-avg"
                          style={{ color: rowPct > 0.5 ? '#22c55e' : '#ef4444' }}
                        >
                          {row.avg} kg
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="pa-heatmap-legend">
                  <span style={{ background: 'rgb(240,60,70)' }} /> Faible
                  <span style={{ background: 'rgb(140,140,70)' }} /> Moyen
                  <span style={{ background: 'rgb(40,220,70)' }} /> Élevé
                </div>
              </div>
            )}

            {/* Recommendations */}
            {severeCount > 0 && (
              <div className="pa-card pa-card--full">
                <div className="pa-card-title">
                  Arbres prioritaires à irriguer
                  <span className="pa-card-badge">{recommendations.length} sur {severeCount} stress sévère</span>
                </div>
                <p className="pa-reco-intro">
                  Si les <strong>{severeCount} arbres en stress sévère</strong> (CWSI ≥ 0.7) atteignent un CWSI &lt; 0.3,
                  le gain de production estimé est de <strong>{totalGain.toFixed(0)} kg</strong>.
                </p>
                <div className="pa-reco-list">
                  {recommendations.map((t, i) => (
                    <div key={t.id} className="pa-reco-item">
                      <span className="pa-reco-rank">#{i + 1}</span>
                      <div className="pa-reco-info">
                        <span className="pa-reco-id">Arbre {t.id}</span>
                        <span className="pa-reco-detail">
                          CWSI {t.cwsi?.toFixed(3)} · {t.rendement.toFixed(1)} kg estimé actuellement
                        </span>
                      </div>
                      <div className="pa-reco-gain">
                        +{t.gain.toFixed(1)} kg potentiel
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
