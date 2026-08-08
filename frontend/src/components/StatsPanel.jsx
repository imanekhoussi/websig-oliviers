import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid, LabelList,
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, Legend,
} from 'recharts'
import { STRESS_COLORS } from '../constants'
// exportXlsxUrl / exportPdfUrl moved to ExportModal
import { LuActivity, LuMapPin, LuThermometer, LuDroplet, LuWind, LuChartBar, LuChevronLeft, LuChevronRight, LuTrees } from 'react-icons/lu'
import AnalyticsModal from './AnalyticsModal'
import AiAdvisorModal from './AiAdvisorModal'
import IrrigationSimulator from './IrrigationSimulator'
import SummaryCard from './SummaryCard'
// Note: export buttons removed — export is now in the ExportModal (navbar "Extraire")

function cwsiColor(val) {
  if (val == null) return 'var(--text-main)'
  if (val < 0.4) return 'var(--color-success)'
  if (val < 0.7) return 'var(--color-warning)'
  return 'var(--color-danger)'
}
function cwsiBg(val) {
  if (val == null) return 'var(--bg-elevated)'
  if (val < 0.4) return 'var(--color-success-dim)'
  if (val < 0.7) return 'var(--color-warning-dim)'
  return 'var(--color-danger-dim)'
}

const SHORT_STRESS = { aucun: 'Aucun', faible: 'Faible', modere: 'Modéré', eleve: 'Élevé', severe: 'Sévère', inconnu: '—' }

function CompareRadar({ data, labelA, labelB }) {
  if (!data?.length) return null
  return (
    <div className="compare-radar-wrap">
      <h4 className="compare-radar-title">Comparaison multidimensionnelle</h4>
      <p className="compare-radar-sub">Score 0–100 · plus haut = meilleur état</p>
      <ResponsiveContainer width="100%" height={240}>
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid stroke="rgba(148,163,184,0.2)" />
          <PolarAngleAxis
            dataKey="metric"
            tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 500 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: '#64748b', fontSize: 9 }}
            tickCount={4}
            stroke="rgba(148,163,184,0.1)"
          />
          <Radar
            name={labelA}
            dataKey="A"
            stroke="#4a7c59"
            fill="#4a7c59"
            fillOpacity={0.25}
            strokeWidth={2}
            dot={{ r: 3, fill: '#4a7c59', strokeWidth: 0 }}
          />
          <Radar
            name={labelB}
            dataKey="B"
            stroke="#3b82f6"
            fill="#3b82f6"
            fillOpacity={0.20}
            strokeWidth={2}
            dot={{ r: 3, fill: '#3b82f6', strokeWidth: 0 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            iconType="circle"
            iconSize={8}
          />
          <Tooltip
            contentStyle={{
              background: 'rgba(15,23,42,0.92)',
              border: '1px solid rgba(148,163,184,0.2)',
              borderRadius: 8,
              fontSize: 11,
              color: '#f1f5f9',
            }}
            formatter={(val, name) => [`${val}/100`, name]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}

function GlassTip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip-label">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="chart-tip-value">
          {formatter ? formatter(entry.value) : entry.value}
        </div>
      ))}
    </div>
  )
}

function StressTip(props) {
  return <GlassTip {...props} formatter={v => `${v} arbre${v !== 1 ? 's' : ''}`} />
}

export default function StatsPanel({
  stats, mission, statsCompare, missionCompare,
  isZonalActive = false, onClearZonal, features,
  allFeatures = [],
  anomalyData = null,
  yieldPredictions = null,
  onMapAction = null,
  parcelSettings = null,
  missions = [],
  currentId = null,
  onSelectMission = null,
}) {
  const isCompare = !!(statsCompare && missionCompare)
  const [showAnalytics,  setShowAnalytics]  = useState(false)
  const [showAiModal,    setShowAiModal]    = useState(false)
  const [showSummary,    setShowSummary]    = useState(false)

  // GeoJSON synthétique pour IrrigationSimulator (centroïde → latitude pour ETo)
  const syntheticGeojson = useMemo(() => ({
    type: 'FeatureCollection',
    features: allFeatures,
  }), [allFeatures])

  // Mini navigation prev/next mission
  const missionIdx = missions.findIndex(m => m.id === currentId)
  const prevMission = missionIdx > 0 ? missions[missionIdx - 1] : null
  const nextMission = missionIdx >= 0 && missionIdx < missions.length - 1 ? missions[missionIdx + 1] : null
  // L'historique du chat est conservé dans StatsPanel (survit aux fermetures de la modale)
  const [chatMessages,   setChatMessages]   = useState([])

  const stressChartData = useMemo(() => {
    if (!stats?.stress_breakdown) return []
    const featureSrc = isZonalActive && features?.length ? features : allFeatures
    const cwsiByClass = {}
    featureSrc.forEach(f => {
      const { stress, cwsi } = f.properties
      if (stress && cwsi != null) {
        if (!cwsiByClass[stress]) cwsiByClass[stress] = []
        cwsiByClass[stress].push(cwsi)
      }
    })
    return stats.stress_breakdown.map(s => {
      const vals = cwsiByClass[s.classe] ?? []
      const avg  = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      return {
        ...s,
        label:   SHORT_STRESS[s.classe] ?? s.classe,
        avgCwsi: avg != null ? parseFloat(avg.toFixed(2)) : null,
      }
    })
  }, [stats?.stress_breakdown, allFeatures, features, isZonalActive])

  // ── Score de santé (0–100) ──────────────────────────────────────────────
  const healthScore = useMemo(() => {
    if (!stats) return null
    const cwsiMoy = stats.cwsi?.moyenne ?? 0.5
    const scoreCwsi = Math.max(0, (1 - cwsiMoy) * 50)
    const total = stats.total_arbres ?? 1
    const critiques = (stats.stress_breakdown ?? [])
      .filter(s => s.classe === 'eleve' || s.classe === 'severe')
      .reduce((n, s) => n + s.count, 0)
    const pctSains = 1 - (critiques / total)
    const scoreStress = pctSains * 30
    let scoreYield = 10
    if (yieldPredictions) {
      const vals = Object.values(yieldPredictions).filter(v => v != null && v >= 0)
      if (vals.length) {
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length
        scoreYield = Math.min(20, (avg / 20) * 20)
      }
    }
    return Math.round(scoreCwsi + scoreStress + scoreYield)
  }, [stats, yieldPredictions])

  const healthLabel = healthScore == null ? null
    : healthScore >= 75 ? { label: 'Bon état',        color: '#16a34a', bg: 'rgba(22,163,74,0.10)'  }
    : healthScore >= 50 ? { label: 'État acceptable',  color: '#d97706', bg: 'rgba(217,119,6,0.10)'  }
    : healthScore >= 30 ? { label: 'État préoccupant', color: '#dc2626', bg: 'rgba(220,38,38,0.10)'  }
    :                     { label: 'État critique',    color: '#7c3aed', bg: 'rgba(124,58,237,0.10)' }

  const radarData = useMemo(() => {
    if (!isCompare || !stats || !statsCompare) return []

    const cwsiA = Math.round((1 - (stats.cwsi?.moyenne ?? 0.5)) * 100)
    const cwsiB = Math.round((1 - (statsCompare.cwsi?.moyenne ?? 0.5)) * 100)

    const tempNorm = t => t == null ? 50 : Math.max(0, Math.min(100, Math.round((45 - t) / 20 * 100)))
    const tempA = tempNorm(stats.temperature?.moyenne)
    const tempB = tempNorm(statsCompare.temperature?.moyenne)

    const hautNorm = h => h == null ? 50 : Math.min(100, Math.round(h / 10 * 100))
    const hautA = hautNorm(
      stats.hauteur?.min != null && stats.hauteur?.max != null
        ? (stats.hauteur.min + stats.hauteur.max) / 2 : null
    )
    const hautB = hautNorm(
      statsCompare.hauteur?.min != null && statsCompare.hauteur?.max != null
        ? (statsCompare.hauteur.min + statsCompare.hauteur.max) / 2 : null
    )

    const pctSainA = stats.total_arbres > 0
      ? Math.round((1 - (stats.stress_breakdown ?? [])
          .filter(s => ['eleve', 'severe'].includes(s.classe))
          .reduce((n, s) => n + s.count, 0) / stats.total_arbres) * 100)
      : 50
    const pctSainB = statsCompare.total_arbres > 0
      ? Math.round((1 - (statsCompare.stress_breakdown ?? [])
          .filter(s => ['eleve', 'severe'].includes(s.classe))
          .reduce((n, s) => n + s.count, 0) / statsCompare.total_arbres) * 100)
      : 50

    const densA = stats.total_arbres > 0
      ? Math.round((stats.stress_breakdown ?? [])
          .filter(s => ['aucun', 'faible'].includes(s.classe))
          .reduce((n, s) => n + s.count, 0) / stats.total_arbres * 100)
      : 50
    const densB = statsCompare.total_arbres > 0
      ? Math.round((statsCompare.stress_breakdown ?? [])
          .filter(s => ['aucun', 'faible'].includes(s.classe))
          .reduce((n, s) => n + s.count, 0) / statsCompare.total_arbres * 100)
      : 50

    return [
      { metric: 'Santé CWSI', A: cwsiA,    B: cwsiB    },
      { metric: 'Confort T°', A: tempA,    B: tempB    },
      { metric: 'Vigueur',    A: hautA,    B: hautB    },
      { metric: '% Sains',    A: pctSainA, B: pctSainB },
      { metric: 'Arbres OK',  A: densA,    B: densB    },
    ]
  }, [isCompare, stats, statsCompare])

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

  console.log('[Render StatsPanel] État showAnalytics:', showAnalytics);

  return (
    <div className="panel">


      {/* ── Bannière sélection zonale ── */}
      {isZonalActive && (
        <div className="zonal-header">
          <div className="zonal-header-left">
            <LuMapPin size={14} />
            <div>
              <span className="zonal-header-label">Zone sélectionnée</span>
              <span className="zonal-header-stats">
                {stats.total_arbres} arbre{stats.total_arbres !== 1 ? 's' : ''}
                {stats.cwsi?.moyenne != null && ` · CWSI moy. ${stats.cwsi.moyenne.toFixed(2)}`}
                {(() => {
                  const n = (stats.stress_breakdown ?? [])
                    .filter(s => s.classe === 'eleve' || s.classe === 'severe')
                    .reduce((sum, s) => sum + s.count, 0)
                  return n > 0 ? ` · ${n} critique${n > 1 ? 's' : ''}` : ' · aucun critique'
                })()}
              </span>
            </div>
          </div>
          <button className="btn-clear-zonal" onClick={onClearZonal}>
            ✕ Effacer la zone
          </button>
        </div>
      )}

      {/* ── Infos mission ── */}
      <div className="mission-info">
        <div className="mission-info-header">

          <div className="mission-info-meta">
            <div className="mission-title-row">
              <h2 className="mission-title">{mission.nom || mission.id}</h2>
              <span className="mission-status-badge">Terminée</span>
            </div>
            <div className="mission-date">{mission.date}</div>
          </div>


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

      {/* ── KPIs ── */}
      {isCompare ? (
        <div className="kpis-compare">
          <div className="kpis-compare-col">
            <div className="kpis-compare-label">{mission.nom || mission.id}</div>
            <Kpi label="Arbres"    value={stats.total_arbres} unit=""       icon={<LuTrees size={14} />} />
            <Kpi label="CWSI moy." value={stats.cwsi.moyenne?.toFixed(2) ?? '—'} unit="" icon={<LuDroplet size={14} />} accent={cwsiColor(stats.cwsi.moyenne)} bg={cwsiBg(stats.cwsi.moyenne)} />
            <Kpi label="T° moy."   value={stats.temperature.moyenne?.toFixed(1) ?? '—'} unit="°C" icon={<LuThermometer size={14} />} />
          </div>
          <div className="kpis-compare-divider" />
          <div className="kpis-compare-col">
            <div className="kpis-compare-label">{missionCompare.nom || missionCompare.id}</div>
            <KpiDelta label="Arbres"    value={statsCompare.total_arbres} delta={statsCompare.total_arbres - stats.total_arbres} neutral />
            <KpiDelta label="CWSI moy." value={statsCompare.cwsi.moyenne?.toFixed(2) ?? '—'} delta={statsCompare.cwsi.moyenne != null && stats.cwsi.moyenne != null ? statsCompare.cwsi.moyenne - stats.cwsi.moyenne : null} lowerIsBetter />
            <KpiDelta label="T° moy."   value={statsCompare.temperature.moyenne != null ? `${statsCompare.temperature.moyenne.toFixed(1)}°C` : '—'} delta={statsCompare.temperature.moyenne != null && stats.temperature.moyenne != null ? statsCompare.temperature.moyenne - stats.temperature.moyenne : null} lowerIsBetter />
          </div>
        </div>
      ) : (
        <div className="kpis-cards">
          <KpiCard
            label="Arbres"
            value={stats.total_arbres}
            unit=""
            icon={<LuTrees size={16} />}
            color="var(--color-primary)"
            bg="var(--color-primary-dim)"
          />
          <KpiCard
            label="CWSI moy."
            value={stats.cwsi.moyenne?.toFixed(2) ?? '—'}
            unit=""
            icon={<LuDroplet size={16} />}
            color={cwsiColor(stats.cwsi.moyenne)}
            bg={cwsiBg(stats.cwsi.moyenne)}
          />
          <KpiCard
            label="T° moy."
            value={stats.temperature.moyenne?.toFixed(1) ?? '—'}
            unit="°C"
            icon={<LuThermometer size={16} />}
            color="var(--color-warning)"
            bg="var(--color-warning-dim)"
          />
        </div>
      )}

      {/* ── Radar comparaison ── */}
      {isCompare && radarData.length > 0 && (
        <CompareRadar
          data={radarData}
          labelA={mission.nom || mission.id}
          labelB={missionCompare.nom || missionCompare.id}
        />
      )}

      {/* ── Score de santé ── */}
      {healthScore != null && healthLabel && (
        <HealthGauge
          score={healthScore}
          label={healthLabel.label}
          color={healthLabel.color}
          bg={healthLabel.bg}
        />
      )}

      {/* ── Répartition stress ── */}
      <div className="stress-chart-header">
        <h3 className="stress-chart-title">Répartition par stress</h3>
        <span className="stress-chart-hint">CWSI moyen par classe</span>
      </div>
      <div className="stress-chart-wrap" style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <BarChart
            data={stressChartData}
            margin={{ top: 20, right: 10, left: 10, bottom: 4 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(0,0,0,0.06)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              interval={0}
              fontSize={10}
              angle={0}
              textAnchor="middle"
              tick={{ fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              height={24}
            />
            <YAxis
              fontSize={10}
              tick={{ fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
              width={32}
            />
            <Tooltip content={<StressTip />} cursor={{ fill: 'rgba(74,124,89,0.04)' }} />
            <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={48}>
              {stressChartData.map((e, i) => (
                <Cell key={i} fill={e.color} fillOpacity={0.85} />
              ))}
              <LabelList
                dataKey="count"
                position="top"
                fontSize={10}
                fontWeight={600}
                fill="#334155"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Carte anomalies IA ── */}
      {anomalyData && (
        <div className={`anomaly-stats-card ${anomalyData.n_anomalies > 0 ? 'has-anomalies' : 'no-anomalies'}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="anomaly-stats-title">Détection d'anomalies IA</div>
              <div className="anomaly-stats-subtitle">Isolation Forest — 10% contamination</div>
            </div>
            <div>
              <span className="anomaly-stats-count">{anomalyData.n_anomalies}</span>
              <span className="anomaly-stats-total">/ {anomalyData.total_arbres}</span>
            </div>
          </div>
          <div className="anomaly-stats-footer">
            {anomalyData.n_anomalies > 0
              ? `${anomalyData.n_anomalies} arbre${anomalyData.n_anomalies > 1 ? 's' : ''} présentent des valeurs atypiques`
              : 'Aucune anomalie détectée'}
          </div>
        </div>
      )}

      {/* ── Simulateur d'irrigation ── */}
      <IrrigationSimulator
        stats={stats}
        features={isZonalActive && features?.length ? features : allFeatures}
        parcelSettings={parcelSettings}
        geojson={syntheticGeojson}
        mission={mission}
        yieldPredictions={yieldPredictions}
      />

      {/* ── Bouton analyses détaillées ── */}
      <button
        className="btn-primary"
        style={{ width: '100%', marginTop: 16 }}
        onClick={() => { console.log('[Clic] Bouton Analyses détaillées cliqué'); setShowAnalytics(true); }}
      >
        <LuChartBar size={14} style={{ marginRight: 6 }} />
        Analyses détaillées
      </button>

      {/* ── Bouton fiche de synthèse ── */}
      <button
        className="btn-secondary"
        style={{ width: '100%', marginTop: 8 }}
        onClick={() => setShowSummary(true)}
      >
        📋 Fiche de synthèse
      </button>

      {/* ── Bouton conseil IA ── */}
      <button
        className="ai-advice-btn"
        onClick={() => setShowAiModal(true)}
      >
        🌿 Ouvrir l'Agronome IA
      </button>

      {/* ── Modal conseiller IA ── */}
      {showAiModal && (
        <AiAdvisorModal
          mission={mission}
          onClose={() => setShowAiModal(false)}
          stats={stats}
          yieldPredictions={yieldPredictions}
          messages={chatMessages}
          setMessages={setChatMessages}
          onMapAction={onMapAction}
        />
      )}

      {/* ── Modal analyses ── */}
      {showAnalytics && (
        <AnalyticsModal
          stats={stats}
          mission={mission}
          missionCompare={missionCompare}
          statsCompare={statsCompare}
          isZonalActive={isZonalActive}
          features={features}
          allFeatures={allFeatures}
          onClose={() => setShowAnalytics(false)}
          parcelSettings={parcelSettings}
        />
      )}

      {/* ── Modal fiche de synthèse ── */}
      {showSummary && (
        <div className="sc-modal-backdrop" onClick={() => setShowSummary(false)}>
          <div onClick={e => e.stopPropagation()}>
            <SummaryCard
              stats={stats}
              mission={mission}
              features={isZonalActive && features?.length ? features : allFeatures}
              allFeatures={allFeatures}
              parcelSettings={parcelSettings}
              yieldPredictions={yieldPredictions}
              onClose={() => setShowSummary(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function HealthGauge({ score, label, color, bg }) {
  const r = 28
  const circumference = 2 * Math.PI * r
  const arcLen  = (270 / 360) * circumference
  const fillLen = (score / 100) * arcLen

  return (
    <div className="health-gauge-wrap" style={{ background: bg }}>
      <svg width={72} height={60} viewBox="0 0 72 65" style={{ flexShrink: 0 }}>
        <circle cx={36} cy={42} r={r} fill="none"
          stroke="rgba(0,0,0,0.07)" strokeWidth={7}
          strokeDasharray={`${arcLen} ${circumference}`}
          strokeDashoffset={0}
          transform="rotate(135 36 42)"
          strokeLinecap="round"
        />
        <circle cx={36} cy={42} r={r} fill="none"
          stroke={color} strokeWidth={7}
          strokeDasharray={`${fillLen} ${circumference}`}
          strokeDashoffset={0}
          transform="rotate(135 36 42)"
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color}55)`, transition: 'stroke-dasharray 0.8s ease' }}
        />
        <text x={36} y={46} textAnchor="middle"
          fontSize={15} fontWeight={800} fill={color}>
          {score}
        </text>
      </svg>
      <div className="health-gauge-text">
        <div className="health-gauge-label" style={{ color }}>{label}</div>
        <div className="health-gauge-sub">Score santé · /100</div>
        <div className="health-gauge-detail">
          CWSI × 50% + Stress × 30% + Rendement × 20%
        </div>
      </div>
    </div>
  )
}

function KpiCard({ label, value, unit, icon, color, bg }) {
  return (
    <div className="kpi-card" style={{ '--kpi-color': color, '--kpi-bg': bg }}>
      <div className="kpi-card-icon">{icon}</div>
      <div className="kpi-card-body">
        <div className="kpi-card-value">
          {value}
          {unit && <span className="kpi-card-unit">{unit}</span>}
        </div>
        <div className="kpi-card-label">{label}</div>
      </div>
    </div>
  )
}

function Kpi({ label, value, unit, icon, accent, bg }) {
  return (
    <div className="kpi" style={{ color: accent, background: bg }}>
      <div className="kpi-value">{value}{unit && <span style={{ fontSize: 10, marginLeft: 2 }}>{unit}</span>}</div>
      <div className="kpi-label">
        {icon && <span style={{ display: 'inline-flex', alignItems: 'center', marginRight: 3 }}>{icon}</span>}
        {label}
      </div>
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
