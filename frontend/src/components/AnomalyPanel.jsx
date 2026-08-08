import { LuTriangleAlert, LuDownload } from 'react-icons/lu'
import { STRESS_COLORS } from '../constants'

const SHORT_STRESS = {
  aucun: 'Aucun', faible: 'Faible', modere: 'Modéré', eleve: 'Élevé', severe: 'Sévère',
}

export default function AnomalyPanel({ anomalyData }) {
  if (!anomalyData) return null

  const { anomalies, n_anomalies, total_arbres, methode, mission_id } = anomalyData
  const top10 = anomalies.slice(0, 10)

  function exportCsv() {
    const header = 'id,cwsi,temp_moy,hauteur,stress,anomaly_score,lon,lat'
    const rows = anomalies.map(a =>
      `${a.id},${a.cwsi},${a.temp_moy},${a.hauteur},${a.stress},${a.anomaly_score},${a.lon},${a.lat}`
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href     = url
    link.download = `anomalies_${mission_id}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="anomaly-panel">

      <div className="anomaly-panel-header">
        <div className="anomaly-panel-title">
          <LuTriangleAlert size={15} style={{ color: '#dc2626', flexShrink: 0 }} />
          Anomalies détectées
          <span className="anomaly-badge">{n_anomalies}</span>
        </div>
        <button className="anomaly-csv-btn" onClick={exportCsv} title="Exporter CSV">
          <LuDownload size={12} />
          CSV
        </button>
      </div>

      <div className="anomaly-subtitle">
        {methode} · {n_anomalies} / {total_arbres} arbres
      </div>

      <div className="anomaly-list">
        {top10.map((a, i) => (
          <div key={a.id} className="anomaly-row">
            <span className="anomaly-row-rank">#{i + 1}</span>
            <span className="anomaly-row-id">Arbre {a.id}</span>
            <span
              className="anomaly-row-stress"
              style={{ background: STRESS_COLORS[a.stress] ?? '#7e8c80' }}
            >
              {SHORT_STRESS[a.stress] ?? a.stress}
            </span>
            <span className="anomaly-row-cwsi">{a.cwsi.toFixed(2)}</span>
            <span className="anomaly-row-score">{a.anomaly_score.toFixed(3)}</span>
          </div>
        ))}
      </div>

    </div>
  )
}
