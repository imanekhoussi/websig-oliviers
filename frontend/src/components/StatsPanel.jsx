import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid, LabelList,
} from 'recharts'
import { STRESS_COLORS } from '../constants'
import { exportXlsxUrl, exportPdfUrl } from '../api'
import { LuActivity, LuMapPin, LuThermometer, LuDroplet, LuWind, LuChartBar } from 'react-icons/lu'
import AnalyticsModal from './AnalyticsModal'
import AiAdvisorModal from './AiAdvisorModal'

const SHORT_STRESS = { aucun: 'Aucun', faible: 'Faible', modere: 'Modéré', eleve: 'Élevé', severe: 'Sévère', inconnu: '—' }

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

export default function StatsPanel({
  stats, mission, statsCompare, missionCompare,
  isZonalActive = false, onClearZonal, features,
  allFeatures = [],
  anomalyData = null,
  yieldPredictions = null,
  onMapAction = null,
}) {
  const isCompare = !!(statsCompare && missionCompare)
  const [showAnalytics,  setShowAnalytics]  = useState(false)
  const [showAiModal,    setShowAiModal]    = useState(false)
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

          <div className="mission-info-meta">
            <div className="mission-title-row">
              <h2 className="mission-title">{mission.nom || mission.id}</h2>
              <span className="mission-status-badge">Terminée</span>
            </div>
            <div className="mission-date">{mission.date}</div>
          </div>

          <div className="mission-export-actions">
            <a
              href={exportXlsxUrl(mission.id, features?.map(f => f.properties.id))}
              download
              className="btn-export-xlsx"
              title={isZonalActive ? 'Exporter la sélection (Excel)' : 'Télécharger le rapport complet (Excel)'}
            >
              📊 {isZonalActive ? 'Sélection' : 'Excel'}
            </a>
            {!isZonalActive && (
              <a
                href={exportPdfUrl(mission.id)}
                download
                className="btn-export-pdf"
                title="Télécharger le rapport PDF"
              >
                📄 PDF
              </a>
            )}
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

      {/* ── KPIs (mode normal ou comparaison) ── */}
      {isCompare ? (
        <div className="kpis-compare">
          <div className="kpis-compare-col">
            <div className="kpis-compare-label">{mission.nom || mission.id}</div>
            <Kpi label="Arbres"    value={stats.total_arbres}                                                             icon="🌳" />
            <Kpi label="CWSI moy." value={stats.cwsi.moyenne?.toFixed(2) ?? '—'}                                         icon={<LuDroplet size={11} />} />
            <Kpi label="T° moy."   value={stats.temperature.moyenne != null ? `${stats.temperature.moyenne.toFixed(1)}°C` : '—'} icon={<LuThermometer size={11} />} />
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
              value={statsCompare.temperature.moyenne != null ? `${statsCompare.temperature.moyenne.toFixed(1)}°C` : '—'}
              delta={statsCompare.temperature.moyenne != null && stats.temperature.moyenne != null
                ? statsCompare.temperature.moyenne - stats.temperature.moyenne
                : null}
              lowerIsBetter
            />
          </div>
        </div>
      ) : (
        <div className="kpis">
          <Kpi label="Arbres"    value={stats.total_arbres}                                                             icon="🌳" />
          <Kpi label="CWSI moy." value={stats.cwsi.moyenne?.toFixed(2) ?? '—'}                                         icon={<LuDroplet size={11} />} />
          <Kpi label="T° moy."   value={stats.temperature.moyenne != null ? `${stats.temperature.moyenne.toFixed(1)}°C` : '—'} icon={<LuThermometer size={11} />} />
        </div>
      )}

      {/* ── Répartition stress ── */}
      <h3 style={{ marginBottom: 2 }}>Répartition par stress</h3>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '0 0 6px', lineHeight: 1.4 }}>
        (CWSI : Valeur moyenne de l'indice de stress hydrique pour cette catégorie)
      </p>
      <div style={{ width: '100%', height: 310 }}>
        <ResponsiveContainer>
          <BarChart
            data={stressChartData}
            margin={{ top: 24, right: 6, left: 22, bottom: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" vertical={false} />
            <XAxis
              dataKey="label"
              interval={0}
              fontSize={11}
              angle={-45}
              textAnchor="end"
              tick={{ fill: '#94a3b8' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148,163,184,0.15)' }}
              height={55}
            />
            <YAxis
              fontSize={11}
              tick={{ fill: '#94a3b8' }}
              tickLine={false}
              axisLine={false}
              width={48}
              label={{
                value: "Nb d'oliviers",
                angle: -90,
                position: 'insideLeft',
                offset: 10,
                style: { fill: '#94a3b8', fontSize: 10 },
              }}
            />
            <Tooltip content={<StressTip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {stressChartData.map((e, i) => (
                <Cell key={i} fill={e.color} fillOpacity={0.88} />
              ))}
              <LabelList
                dataKey="avgCwsi"
                position="top"
                formatter={val => val != null ? `CWSI: ${val}` : ''}
                fill="var(--text-main)"
                fontSize={10}
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

      {/* ── Bouton analyses détaillées ── */}
      <button
        className="btn-primary"
        style={{ width: '100%', marginTop: 16 }}
        onClick={() => setShowAnalytics(true)}
      >
        <LuChartBar size={14} style={{ marginRight: 6 }} />
        Analyses détaillées
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
        />
      )}
    </div>
  )
}

function Kpi({ label, value, icon }) {
  return (
    <div className="kpi">
      <div className="kpi-value">{value}</div>
      <div className="kpi-label">
        {icon && (
          <span style={{
            display: 'inline-flex', alignItems: 'center',
            color: 'var(--text-muted)', marginRight: 3, lineHeight: 1,
          }}>
            {icon}
          </span>
        )}
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
