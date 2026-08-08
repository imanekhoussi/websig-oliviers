import { useState, useMemo, useRef } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid, LabelList,
  PieChart, Pie,
} from 'recharts'
import { STRESS_COLORS } from '../constants'
import { LuPrinter, LuFileText, LuCheck } from 'react-icons/lu'

const SHORT_STRESS = { aucun: 'Aucun', faible: 'Faible', modere: 'Modéré', eleve: 'Élevé', severe: 'Sévère', inconnu: '—' }
const STRESS_ORDER  = { severe: 5, eleve: 4, modere: 3, faible: 2, aucun: 1, inconnu: 0 }

const COLS = [
  { key: 'id',       label: 'ID' },
  { key: 'stress',   label: 'Stress' },
  { key: 'cwsi',     label: 'CWSI' },
  { key: 'temp_moy', label: 'Temp. (°C)' },
  { key: 'hauteur',  label: 'Hauteur (m)' },
]

// ── Helpers ──────────────────────────────────────────────────────────────────
function GlassTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const v = payload[0].value
  return (
    <div style={{
      background: 'rgba(15,23,42,0.97)',
      border: '1px solid rgba(148,163,184,0.18)',
      borderRadius: 8, padding: '8px 12px',
      fontSize: 12, color: '#f1f5f9',
      boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
      backdropFilter: 'blur(16px)',
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 3 }}>{label}</div>
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
      badge: 'État hydrique satisfaisant', level: 'ok',
      color: '#16a34a', bg: 'rgba(22,163,74,0.07)', border: 'rgba(22,163,74,0.22)',
      borderCard: 'rgba(22,163,74,0.30)', pill: 'Satisfaisant',
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
      badge: 'Vigilance recommandée', level: 'warn',
      color: '#d97706', bg: 'rgba(217,119,6,0.07)', border: 'rgba(217,119,6,0.28)',
      borderCard: 'rgba(217,119,6,0.35)', pill: 'Vigilance',
      items: [
        `${pct}% des arbres présentent un stress hydrique modéré — augmenter la fréquence des apports.`,
        "Irriguer tôt le matin pour limiter l'évapotranspiration ; éviter les apports en plein soleil.",
        "Concentrer les ressources sur les secteurs à CWSI ≥ 0.3 identifiés dans le tableau ci-dessus.",
      ],
      water: 25,
    }
  }
  return {
    badge: 'Intervention urgente', level: 'danger',
    color: '#dc2626', bg: 'rgba(220,38,38,0.06)', border: 'rgba(220,38,38,0.28)',
    borderCard: 'rgba(220,38,38,0.35)', pill: 'Urgent',
    items: [
      `Stress hydrique sévère détecté (CWSI moyen = ${cwsiMoy.toFixed(2)}) — irrigation d'urgence recommandée sous 24–48 h.`,
      "Prioriser les arbres à CWSI ≥ 0.7 (stress sévère) ; réaliser un apport prolongé par goutte-à-goutte.",
      "Vérifier l'état du réseau d'irrigation (pression, colmatage goutteurs) et organiser les interventions terrain.",
    ],
    water: 45,
  }
}

// ── Jauge CWSI améliorée ─────────────────────────────────────────────────────
function CwsiGauge({ value }) {
  if (value == null) return null
  const pct = Math.min(1, Math.max(0, value))
  const col  = pct < 0.3 ? '#16a34a' : pct < 0.5 ? '#f59e0b' : pct < 0.7 ? '#ef4444' : '#7c3aed'
  const stressLabel = pct < 0.3 ? 'Faible' : pct < 0.5 ? 'Modéré' : pct < 0.7 ? 'Élevé' : 'Sévère'
  const r = 38
  const circumference = 2 * Math.PI * r
  const arcLen   = (270 / 360) * circumference
  const dashOffset = arcLen - pct * arcLen

  // Tick marks aux valeurs 0.25, 0.50, 0.75
  // angle = 135 + v*270 degrés (horaire depuis 3h)
  function tickCoords(v, rOuter, rInner) {
    const angle = (135 + v * 270) * Math.PI / 180
    return {
      x1: 50 + rOuter * Math.cos(angle),
      y1: 62 + rOuter * Math.sin(angle),
      x2: 50 + rInner * Math.cos(angle),
      y2: 62 + rInner * Math.sin(angle),
    }
  }
  const ticks = [0.25, 0.50, 0.75].map(v => tickCoords(v, 38, 30))
  const filterId = `glow-${Math.round(value * 1000)}`

  return (
    <svg width={100} height={90} viewBox="0 0 100 95">
      <defs>
        <filter id={filterId}>
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Arc de fond */}
      <circle
        cx={50} cy={62} r={r}
        fill="none" stroke="rgba(60,100,60,0.12)" strokeWidth={10}
        strokeDasharray={`${arcLen} ${circumference}`}
        strokeDashoffset={0}
        transform="rotate(135 50 62)"
        strokeLinecap="round"
      />

      {/* Arc coloré avec drop-shadow */}
      <circle
        cx={50} cy={62} r={r}
        fill="none" stroke={col} strokeWidth={10}
        strokeDasharray={`${arcLen} ${circumference}`}
        strokeDashoffset={dashOffset}
        transform="rotate(135 50 62)"
        strokeLinecap="round"
        filter={`url(#${filterId})`}
      />

      {/* Tick marks */}
      {ticks.map((t, i) => (
        <line
          key={i}
          x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke="rgba(60,100,60,0.30)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      ))}

      {/* Valeur numérique */}
      <text x={50} y={60} textAnchor="middle" fontSize={16} fontWeight={700} fill={col}>
        {value.toFixed(2)}
      </text>
      {/* Label "CWSI" */}
      <text x={50} y={72} textAnchor="middle" fontSize={9} fill="#8ba08e">CWSI</text>
      {/* Label niveau de stress */}
      <text x={50} y={84} textAnchor="middle" fontSize={9} fontWeight={600} fill={col}>
        {stressLabel}
      </text>
    </svg>
  )
}

// ── Calculs irrigation inline pour le PDF ───────────────────────────────────
function computeIrrForPDF(stats, src, parcelSettings, mission) {
  const tmean = mission?.meteo?.temp_air
  let eto = 5.0
  if (tmean != null && mission?.date) {
    const d   = new Date(mission.date)
    const J   = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000)
    const lat = 35.76
    const phi = lat * Math.PI / 180
    const dr    = 1 + 0.033 * Math.cos(2 * Math.PI * J / 365)
    const delta = 0.409 * Math.sin(2 * Math.PI * J / 365 - 1.39)
    const ws    = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))))
    const Ra    = (24 * 60 / Math.PI) * 0.0820 * dr * (
      ws * Math.sin(phi) * Math.sin(delta) +
      Math.cos(phi) * Math.cos(delta) * Math.sin(ws)
    )
    eto = Math.max(0, parseFloat((0.0023 * Ra * (tmean + 17.8) * Math.sqrt(6)).toFixed(1)))
  }

  let kc = 0.65
  if (parcelSettings && mission?.date) {
    const m = new Date(mission.date).getMonth() + 1
    if ([12, 1, 2].includes(m)) kc = parcelSettings.kcHiver ?? 0.45
    else if ([3, 4, 5].includes(m)) kc = parcelSettings.kcPrintemps ?? 0.65
    else kc = parcelSettings.kcEte ?? 0.70
  }

  const eff       = parcelSettings?.irrigationEfficiency ?? 0.90
  const nb        = Math.max(1, stats?.total_arbres ?? src.length)
  const surfaceHa = parseFloat(parcelSettings?.surface) || null
  const s2arbre   = Math.max(15, (surfaceHa ? surfaceHa * 10000 : nb * 25) / nb)
  const pumpFlow  = Math.max(0.1, parcelSettings?.pumpFlow ?? 3.0)

  const cwsiVals = src.map(f => f.properties.cwsi ?? 0)
  const cwsiMoy  = cwsiVals.length ? cwsiVals.reduce((a, b) => a + b, 0) / cwsiVals.length : (stats?.cwsi?.moyenne ?? 0)

  const deficitMm   = eto * kc * (1 + cwsiMoy * 1.5)
  const volumeM3    = (deficitMm / 1000) * s2arbre * nb / Math.max(0.01, eff)
  const dureeH      = volumeM3 / pumpFlow
  const coutTotal   = volumeM3 * ((parcelSettings?.waterCost ?? 0) + (parcelSettings?.energyKwh ?? 0.75) * (parcelSettings?.energyPrice ?? 1.05))

  return { deficitMm, volumeM3, dureeH, coutTotal }
}

// ── Strip emoji pour jsPDF (helvetica ne supporte pas les non-BMP) ───────────
function pdfStr(s) {
  if (s == null) return '—'
  return String(s).replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/[✓⚠☑]/g, '').replace(/\s+/g, ' ').trim() || '—'
}

// ── Composant principal ──────────────────────────────────────────────────────
export default function MissionReport({
  mission, stats, features, allFeatures, onBack, parcelSettings,
  yieldPredictions = null, irrigationResult = null,
}) {
  const [sortCol,  setSortCol]  = useState('cwsi')
  const [sortDir,  setSortDir]  = useState('desc')
  const [printing, setPrinting] = useState(false)
  const [pdfState, setPdfState] = useState('idle') // 'idle' | 'loading' | 'success'

  const src = allFeatures?.length ? allFeatures : (features ?? [])

  const criticalTrees = useMemo(() => {
    const withCwsi = src.filter(f => f.properties.cwsi != null)
    const top10 = [...withCwsi]
      .sort((a, b) => (b.properties.cwsi ?? 0) - (a.properties.cwsi ?? 0))
      .slice(0, 10)
    return [...top10].sort((a, b) => {
      let av = sortCol === 'stress' ? (STRESS_ORDER[a.properties.stress] ?? 0) : (a.properties[sortCol] ?? null)
      let bv = sortCol === 'stress' ? (STRESS_ORDER[b.properties.stress] ?? 0) : (b.properties[sortCol] ?? null)
      const sentinel = sortDir === 'asc' ? Infinity : -Infinity
      av = av ?? sentinel; bv = bv ?? sentinel
      if (av === bv) return 0
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (bv > av ? 1 : -1)
    })
  }, [src, sortCol, sortDir])

  const stressChartData = useMemo(() => {
    if (!stats?.stress_breakdown) return []
    return stats.stress_breakdown.map(s => ({ ...s, label: SHORT_STRESS[s.classe] ?? s.classe }))
  }, [stats?.stress_breakdown])

  const cwsiMoy     = stats?.cwsi?.moyenne
  const tempMoy     = stats?.temperature?.moyenne
  const total       = stats?.total_arbres ?? 0
  const stressed    = useMemo(
    () => (stats?.stress_breakdown ?? []).filter(s => ['eleve', 'severe'].includes(s.classe)).reduce((n, s) => n + s.count, 0),
    [stats?.stress_breakdown],
  )
  const pctStressed = total > 0 ? Math.round((stressed / total) * 100) : 0
  const surface     = useMemo(() => estimateSurface(src), [src])
  const reco        = getRecommendation(cwsiMoy, stressed, total)

  const donutData = useMemo(() =>
    (stats?.stress_breakdown ?? []).filter(s => s.count > 0).map(s => ({
      value: s.count,
      color: s.color ?? STRESS_COLORS[s.classe] ?? '#7e8c80',
    })),
    [stats?.stress_breakdown]
  )

  // Barre d'alerte CWSI
  const alertColor = cwsiMoy == null ? '#94a3b8' : cwsiMoy < 0.3 ? '#16a34a' : cwsiMoy < 0.5 ? '#d97706' : '#dc2626'
  const alertBg    = cwsiMoy == null ? 'rgba(148,163,184,0.08)' : cwsiMoy < 0.3 ? 'rgba(22,163,74,0.08)' : cwsiMoy < 0.5 ? 'rgba(245,158,11,0.08)' : 'rgba(220,38,38,0.08)'
  const alertBadgeBg = cwsiMoy == null ? 'rgba(148,163,184,0.14)' : cwsiMoy < 0.3 ? 'rgba(22,163,74,0.14)' : cwsiMoy < 0.5 ? 'rgba(245,158,11,0.14)' : 'rgba(220,38,38,0.14)'
  const alertLabel = cwsiMoy == null ? 'Données insuffisantes' : cwsiMoy < 0.3 ? 'Aucun stress hydrique' : cwsiMoy < 0.5 ? 'Stress modéré' : 'Stress élevé / sévère'
  const alertBadge = cwsiMoy == null ? 'INDÉTERMINÉ' : cwsiMoy < 0.3 ? 'VERT' : cwsiMoy < 0.5 ? 'ORANGE' : 'ROUGE'

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function SortIndicator({ col }) {
    if (sortCol !== col) return <span className="report-sort-icon">↕</span>
    return <span className="report-sort-icon active">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  function handlePrint() {
    setPrinting(true)
    setTimeout(() => { window.print(); setPrinting(false) }, 80)
  }

  // ── Couleur CWSI dans le tableau ──────────────────────────────────────────
  function cwsiCellColor(v) {
    if (v == null) return 'var(--text-muted)'
    if (v >= 0.7) return '#7c3aed'
    if (v >= 0.5) return '#dc2626'
    if (v >= 0.3) return '#d97706'
    return '#16a34a'
  }

  // ── Génération PDF ────────────────────────────────────────────────────────
  async function generatePDF() {
    if (pdfState === 'loading') return
    setPdfState('loading')
    try {
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

      const W  = 210
      const ML = 12
      const UW = 186
      const PRI   = [74, 124, 89]
      const DARK  = [15, 23, 42]
      const MID   = [71, 85, 105]
      const LITE  = [148, 163, 184]
      const WHITE = [255, 255, 255]

      const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

      const top10 = [...src]
        .filter(f => f.properties.cwsi != null)
        .sort((a, b) => (b.properties.cwsi ?? 0) - (a.properties.cwsi ?? 0))
        .slice(0, 10)

      const validCoords = src.map(f => f.geometry?.coordinates).filter(Boolean)
      const centLat = validCoords.length ? (validCoords.reduce((s, c) => s + c[1], 0) / validCoords.length).toFixed(4) : null
      const centLon = validCoords.length ? (validCoords.reduce((s, c) => s + c[0], 0) / validCoords.length).toFixed(4) : null

      const irr = irrigationResult ?? computeIrrForPDF(stats, src, parcelSettings, mission)

      const alertTextPdf = cwsiMoy == null ? 'INDETERMINE' : cwsiMoy < 0.3 ? 'VERT' : cwsiMoy < 0.5 ? 'ORANGE' : 'ROUGE'
      const alertBgPdf   = cwsiMoy == null ? [226, 232, 240] : cwsiMoy < 0.3 ? [220, 252, 231] : cwsiMoy < 0.5 ? [254, 243, 199] : [254, 226, 226]
      const alertColPdf  = cwsiMoy == null ? [100, 116, 139] : cwsiMoy < 0.3 ? [22, 163, 74]  : cwsiMoy < 0.5 ? [180, 83, 9]   : [185, 28, 28]

      const cwsiByClass = {}
      src.forEach(f => {
        const { stress, cwsi } = f.properties
        if (stress && cwsi != null) {
          if (!cwsiByClass[stress]) cwsiByClass[stress] = []
          cwsiByClass[stress].push(cwsi)
        }
      })

      let y = 0

      // ── PAGE 1 ──
      pdf.setFillColor(...PRI)
      pdf.rect(0, 0, W, 30, 'F')
      pdf.setTextColor(...WHITE)
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20)
      pdf.text('GeoOlive', ML, 14)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
      pdf.text('WebSIG Oliviers - Surveillance par drone thermique', ML, 21)
      pdf.text(`Rapport genere le ${today}`, W - ML, 21, { align: 'right' })

      y = 40
      pdf.setTextColor(...DARK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15)
      pdf.text('RAPPORT DE MISSION', ML, y); y += 8

      pdf.setDrawColor(...LITE); pdf.line(ML, y, W - ML, y); y += 6

      const c2 = ML + UW / 2
      function metaRow(l1, v1, l2, v2) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...MID)
        pdf.text(l1, ML, y)
        if (l2) pdf.text(l2, c2, y)
        pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...DARK)
        pdf.text(pdfStr(v1), ML + 28, y)
        if (v2 !== undefined) pdf.text(pdfStr(v2), c2 + 24, y)
        y += 6
      }
      metaRow('Mission :', mission.nom || mission.id, 'Date :', mission.date)
      metaRow('Parcelle :', parcelSettings?.parcelName, 'Surface :', surface ? `${surface} ha` : parcelSettings?.surface ? `${parcelSettings.surface} ha` : null)
      if (parcelSettings?.owner || parcelSettings?.variety) {
        metaRow('Proprietaire :', parcelSettings?.owner, 'Variete :', parcelSettings?.variety)
      }

      y += 2; pdf.setDrawColor(...LITE); pdf.line(ML, y, W - ML, y); y += 7

      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...PRI)
      pdf.text('INDICATEURS CLES', ML, y); y += 7

      const kpiW = UW / 4
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...MID)
      ;['Total arbres','CWSI moyen','Temperature moy.','Arbres stresses'].forEach((lbl, i) => pdf.text(lbl, ML + i * kpiW, y))
      y += 5

      pdf.setFontSize(14)
      const cwsiColPdf = cwsiMoy == null ? DARK : cwsiMoy < 0.3 ? [22,163,74] : cwsiMoy < 0.5 ? [180,83,9] : [185,28,28]
      const pctColPdf  = pctStressed > 30 ? [185,28,28] : pctStressed > 10 ? [180,83,9] : [22,163,74]

      pdf.setTextColor(...DARK);     pdf.text(`${total}`, ML, y)
      pdf.setTextColor(...cwsiColPdf); pdf.text(cwsiMoy != null ? cwsiMoy.toFixed(3) : '—', ML + kpiW, y)
      pdf.setTextColor(...DARK);     pdf.text(tempMoy != null ? `${tempMoy.toFixed(1)} C` : '—', ML + 2 * kpiW, y)
      pdf.setTextColor(...pctColPdf); pdf.text(`${stressed} (${pctStressed}%)`, ML + 3 * kpiW, y)
      y += 10

      pdf.setFillColor(...alertBgPdf)
      pdf.rect(ML, y - 5, UW, 10, 'F')
      pdf.setDrawColor(...alertColPdf); pdf.rect(ML, y - 5, UW, 10)
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...alertColPdf)
      pdf.text(`NIVEAU D'ALERTE : ${alertTextPdf}`, ML + 5, y + 1.5)
      y += 14

      pdf.setDrawColor(...LITE); pdf.line(ML, y, W - ML, y); y += 7

      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...PRI)
      pdf.text('RECOMMANDATIONS AGRONOMIQUES', ML, y); y += 6

      if (reco) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...alertColPdf)
        pdf.text(pdfStr(reco.badge), ML, y); y += 6
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...DARK)
        reco.items.forEach(item => {
          const lines = pdf.splitTextToSize(`- ${pdfStr(item)}`, UW - 4)
          lines.forEach(line => { pdf.text(line, ML + 2, y); y += 4.5 }); y += 1
        })
      }

      y += 4; pdf.setDrawColor(...LITE); pdf.line(ML, y, W - ML, y); y += 7

      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...PRI)
      pdf.text("SIMULATION D'IRRIGATION", ML, y); y += 6

      ;[
        ["Dose estimee / arbre", `${irr.deficitMm?.toFixed(1) ?? '—'} mm`],
        ["Volume total",         `${irr.volumeM3?.toFixed(1)  ?? '—'} m3`],
        ["Duree de pompage",     `${irr.dureeH?.toFixed(1)    ?? '—'} h`],
        ["Cout estime",          `${irr.coutTotal?.toFixed(0)  ?? '—'} MAD`],
      ].forEach(([lbl, val]) => {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...MID)
        pdf.text(lbl + ' :', ML, y)
        pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...DARK)
        pdf.text(val, ML + 52, y)
        y += 5.5
      })

      pdf.setFontSize(8); pdf.setTextColor(...LITE)
      pdf.text("GeoOlive - Rapport d'analyse CWSI", ML, 290)
      pdf.text('Page 1 / 3', W - ML, 290, { align: 'right' })

      // ── PAGE 2 ──
      pdf.addPage(); y = 0

      pdf.setFillColor(...PRI); pdf.rect(0, 0, W, 16, 'F')
      pdf.setTextColor(...WHITE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12)
      pdf.text('GeoOlive - Analyse detaillee', ML, 10)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
      pdf.text(pdfStr(mission.nom || mission.id), W - ML, 10, { align: 'right' })

      y = 26

      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...PRI)
      pdf.text('REPARTITION PAR NIVEAU DE STRESS', ML, y); y += 6

      const sCols = [
        { label: 'Classe de stress', x: ML,       w: 50 },
        { label: 'Nb arbres',        x: ML + 50,  w: 34 },
        { label: '% parcelle',       x: ML + 84,  w: 34 },
        { label: 'CWSI moyen',       x: ML + 118, w: 38 },
        { label: 'Couleur',          x: ML + 156, w: 30 },
      ]
      pdf.setFillColor(...PRI); pdf.rect(ML, y - 5, UW, 7, 'F')
      pdf.setTextColor(...WHITE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9)
      sCols.forEach(col => pdf.text(col.label, col.x + 1, y)); y += 5

      ;(stats?.stress_breakdown ?? []).forEach((s, i) => {
        if (i % 2 === 0) { pdf.setFillColor(248, 250, 252); pdf.rect(ML, y - 4, UW, 6.5, 'F') }
        const vals = cwsiByClass[s.classe] ?? []
        const avg  = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : '—'
        const pct  = total > 0 ? Math.round(s.count / total * 100) : 0
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...DARK)
        pdf.text(SHORT_STRESS[s.classe] ?? s.classe, ML + 1, y)
        pdf.text(`${s.count}`, ML + 51, y)
        pdf.text(`${pct}%`, ML + 85, y)
        pdf.text(avg, ML + 119, y)
        if (s.color) {
          const rgb = parseInt(s.color.slice(1), 16)
          pdf.setFillColor((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255)
          pdf.circle(ML + 160, y - 1.5, 2.5, 'F')
        }
        y += 6.5
      })

      y += 8

      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...PRI)
      pdf.text('TOP 10 - ARBRES LES PLUS STRESSES', ML, y); y += 6

      const tCols = [
        { label: 'ID',        x: ML,       w: 22 },
        { label: 'CWSI',      x: ML + 22,  w: 28 },
        { label: 'Stress',    x: ML + 50,  w: 38 },
        { label: 'Temp. (C)', x: ML + 88,  w: 38 },
        { label: 'Haut. (m)', x: ML + 126, w: 60 },
      ]
      pdf.setFillColor(...PRI); pdf.rect(ML, y - 5, UW, 7, 'F')
      pdf.setTextColor(...WHITE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9)
      tCols.forEach(col => pdf.text(col.label, col.x + 1, y)); y += 5

      top10.forEach((f, i) => {
        const p = f.properties
        if (i % 2 === 0) { pdf.setFillColor(248, 250, 252); pdf.rect(ML, y - 4, UW, 6.5, 'F') }
        const cv = p.cwsi ?? 0
        const cc = cv >= 0.7 ? [109,40,217] : cv >= 0.5 ? [185,28,28] : cv >= 0.3 ? [180,83,9] : DARK
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
        pdf.setTextColor(...DARK); pdf.text(pdfStr(p.id), ML + 1, y)
        pdf.setTextColor(...cc);   pdf.text(p.cwsi?.toFixed(3) ?? '—', ML + 23, y)
        pdf.setTextColor(...DARK)
        pdf.text(SHORT_STRESS[p.stress] ?? p.stress ?? '—', ML + 51, y)
        pdf.text(p.temp_moy?.toFixed(1) ?? '—', ML + 89, y)
        pdf.text(p.hauteur?.toFixed(1)  ?? '—', ML + 127, y)
        y += 6.5
      })

      if (yieldPredictions && Object.keys(yieldPredictions).length > 0) {
        y += 8
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...PRI)
        pdf.text('PREVISIONS DE RENDEMENT', ML, y); y += 6
        const yields = Object.values(yieldPredictions).filter(v => v != null && !isNaN(v))
        if (yields.length > 0) {
          const yMoy = yields.reduce((s, v) => s + v, 0) / yields.length
          const yTot = yields.reduce((s, v) => s + v, 0)
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...DARK)
          ;[
            `Rendement predit moyen : ${yMoy.toFixed(1)} kg/arbre`,
            `Rendement total estime : ${yTot.toFixed(0)} kg`,
            `Arbres avec prevision : ${yields.length}`,
          ].forEach(line => { pdf.text(line, ML, y); y += 5 })
        }
      }

      pdf.setFontSize(8); pdf.setTextColor(...LITE)
      pdf.text("GeoOlive - Rapport d'analyse CWSI", ML, 290)
      pdf.text('Page 2 / 3', W - ML, 290, { align: 'right' })

      // ── PAGE 3 ──
      pdf.addPage(); y = 0

      pdf.setFillColor(...PRI); pdf.rect(0, 0, W, 16, 'F')
      pdf.setTextColor(...WHITE); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12)
      pdf.text('GeoOlive - Metadonnees', ML, 10)
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9)
      pdf.text('Page 3 / 3', W - ML, 10, { align: 'right' })

      y = 28
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...PRI)
      pdf.text('METADONNEES DU RAPPORT', ML, y); y += 8

      const meta = [
        ['Date de generation',         today],
        ['Version dashboard',           'GeoOlive v2.0'],
        ['Mission ID',                  pdfStr(mission.id)],
        ['Date de la mission',          pdfStr(mission.date)],
        ['Coordonnees GPS (centroide)', centLat && centLon ? `Lat ${centLat} / Lon ${centLon}` : '—'],
        ['Systeme de coordonnees',      'WGS84 / EPSG:4326'],
        ['Capteur / Methode CWSI',      'Drone thermique - Jackson et al. (1981)'],
        ['Partenaires',                 'Drone Globe x FST Tanger'],
        ['Programme',                   'IAVH - Master Geoinformatique - PFE 2025-2026'],
      ]
      meta.forEach(([lbl, val]) => {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...MID)
        pdf.text(lbl + ' :', ML, y)
        pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...DARK)
        pdf.text(String(val), ML + 68, y)
        y += 6.5
      })

      y += 8; pdf.setDrawColor(...LITE); pdf.line(ML, y, W - ML, y); y += 7

      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...LITE)
      const disc = pdf.splitTextToSize(
        "Ce rapport est genere automatiquement par GeoOlive. Les donnees CWSI sont issues de l'imagerie thermique par drone et doivent etre interpretees par un agronome qualifie.",
        UW,
      )
      disc.forEach(line => { pdf.text(line, ML, y); y += 4.5 })

      pdf.setFontSize(8); pdf.setTextColor(...LITE)
      pdf.text("GeoOlive - Rapport d'analyse CWSI", ML, 290)
      pdf.text('Page 3 / 3', W - ML, 290, { align: 'right' })

      pdf.save(`rapport_${mission.id}_${mission.date ?? 'export'}.pdf`)
      setPdfState('success')
      setTimeout(() => setPdfState('idle'), 2200)
    } catch (_err) {
      window.print()
      setPdfState('idle')
    }
  }

  const today = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div className="report-page">

      {/* ════════ PAGE DE GARDE (print-only) ════════ */}
      <div className="report-cover print-only">
        <div className="report-cover-top">
          <div className="report-cover-logo">🌿</div>
          <div className="report-cover-brand">GeoOlive</div>
          <div className="report-cover-subtitle">Système de monitoring par drone thermique</div>
        </div>
        <div className="report-cover-center">
          <div className="report-cover-tag">Rapport d'analyse CWSI</div>
          <h1 className="report-cover-title">{mission.nom || mission.id}</h1>
          <div className="report-cover-meta-grid">
            <div className="report-cover-meta-item">
              <span className="report-cover-meta-label">Date de mission</span>
              <span className="report-cover-meta-val">{mission.date ?? '—'}</span>
            </div>
            <div className="report-cover-meta-item">
              <span className="report-cover-meta-label">Nombre d'arbres</span>
              <span className="report-cover-meta-val">{total}</span>
            </div>
            <div className="report-cover-meta-item">
              <span className="report-cover-meta-label">Surface estimée</span>
              <span className="report-cover-meta-val">{surface ? `${surface} ha` : '—'}</span>
            </div>
            <div className="report-cover-meta-item">
              <span className="report-cover-meta-label">CWSI moyen</span>
              <span className="report-cover-meta-val" style={{ color: cwsiMoy > 0.5 ? '#dc2626' : cwsiMoy > 0.3 ? '#d97706' : '#16a34a' }}>
                {cwsiMoy?.toFixed(3) ?? '—'}
              </span>
            </div>
            {parcelSettings?.parcelName && (
              <div className="report-cover-meta-item">
                <span className="report-cover-meta-label">Parcelle</span>
                <span className="report-cover-meta-val">{parcelSettings.parcelName}</span>
              </div>
            )}
            {parcelSettings?.owner && (
              <div className="report-cover-meta-item">
                <span className="report-cover-meta-label">Propriétaire</span>
                <span className="report-cover-meta-val">{parcelSettings.owner}</span>
              </div>
            )}
            {parcelSettings?.variety && (
              <div className="report-cover-meta-item">
                <span className="report-cover-meta-label">Variété</span>
                <span className="report-cover-meta-val">{parcelSettings.variety}</span>
              </div>
            )}
          </div>
        </div>
        <div className="report-cover-bottom">
          <div>Rapport généré le {today}</div>
          <div>IAVH · Master Géoinformatique · PFE 2025–2026</div>
        </div>
      </div>

      {/* ════════ EN-TÊTE ÉCRAN ════════ */}
      <div
        className="report-header no-print"
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}
      >
        {/* Ligne titre + boutons */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div className="report-header-left">
            <button className="report-back-btn no-print" onClick={onBack}>← Carte</button>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 4 }}>
                📋 Rapport de mission
              </div>
              <h1 className="report-title">{mission.nom || mission.id}</h1>
              <div className="report-meta">
                <span>📅 {mission.date}</span>
                <span>🌳 {total} arbre{total !== 1 ? 's' : ''}</span>
                {surface && <span>📐 {surface} ha</span>}
                <span className="report-status-badge">Terminée</span>
              </div>
            </div>
          </div>

          {/* Boutons */}
          <div className="report-btn-group">
            <button
              className="report-btn-print"
              onClick={handlePrint}
              disabled={printing}
            >
              {printing
                ? <><span className="spinner" style={{ borderTopColor: 'var(--color-primary)' }} /> Préparation…</>
                : <><LuPrinter size={13} /> Imprimer</>
              }
            </button>
            <button
              className={`btn-pdf${pdfState === 'loading' ? ' btn-pdf--loading' : pdfState === 'success' ? ' btn-pdf--success' : ''}`}
              onClick={generatePDF}
              disabled={pdfState === 'loading'}
            >
              {pdfState === 'loading'
                ? <><span className="spinner" /> Génération…</>
                : pdfState === 'success'
                ? <><LuCheck size={13} /> Exporté</>
                : <><LuFileText size={13} /> Exporter PDF</>
              }
            </button>
          </div>
        </div>

        {/* Barre d'alerte CWSI */}
        <div
          className="report-alert-bar"
          style={{
            borderLeft: `4px solid ${alertColor}`,
            background: alertBg,
          }}
        >
          <span className="report-alert-bar-text" style={{ color: alertColor }}>
            CWSI moyen : <strong>{cwsiMoy?.toFixed(3) ?? '—'}</strong> — {alertLabel}
          </span>
          <span
            className="report-alert-bar-badge"
            style={{ background: alertBadgeBg, color: alertColor, border: `1px solid ${alertColor}44` }}
          >
            {alertBadge}
          </span>
        </div>
      </div>

      <div className="report-body">

        {/* ── Résumé exécutif ── */}
        <section className="report-section">
          <h2 className="report-section-title">Résumé exécutif</h2>
          <div className="report-kpis">
            <div className="report-kpi report-kpi--gauge">
              <CwsiGauge value={cwsiMoy} />
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
          <div className="report-charts-row">
            <div className="report-chart-wrap" style={{ flex: 2 }}>
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
            {donutData.length > 0 && (
              <div className="report-donut-wrap">
                <ResponsiveContainer width={140} height={140}>
                  <PieChart>
                    <Pie data={donutData} cx="50%" cy="50%" innerRadius={38} outerRadius={60}
                      paddingAngle={2} dataKey="value">
                      {donutData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="report-donut-legend">
                  {stressChartData.filter(s => s.count > 0).map(s => (
                    <div key={s.classe} className="report-donut-item">
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.label}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                        {total > 0 ? Math.round(s.count / total * 100) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Informations parcelle ── */}
        {parcelSettings && (parcelSettings.parcelName || parcelSettings.owner || parcelSettings.variety) && (
          <section className="report-section">
            <h2 className="report-section-title">Informations de la parcelle</h2>
            <div className="report-parcel-grid">
              {[
                { label: 'Nom de la parcelle',   val: parcelSettings.parcelName },
                { label: 'Propriétaire',          val: parcelSettings.owner },
                { label: 'Variété',               val: parcelSettings.variety },
                { label: 'Surface',               val: autoInfo => surface ? `${surface} ha` : parcelSettings.surface ? `${parcelSettings.surface} ha` : null },
                { label: 'Système d\'irrigation', val: parcelSettings.irrigationType?.replace(/_/g, ' ') },
                { label: 'Seuils CWSI',           val: parcelSettings.cwsiThresholds?.join(' / ') },
              ].filter(r => {
                const v = typeof r.val === 'function' ? r.val() : r.val
                return v != null && v !== '' && v !== 'undefined'
              }).map(({ label, val }, i) => {
                const v = typeof val === 'function' ? val() : val
                return (
                  <div key={i} className="report-parcel-item">
                    <span className="report-parcel-label">{label}</span>
                    <span className="report-parcel-val">{v}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Tableau top 10 arbres critiques ── */}
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
                    const c = STRESS_COLORS[s] ?? '#7e8c80'
                    return (
                      <tr key={p.id ?? i} className={`report-tr${i % 2 === 0 ? ' even' : ''}`}>
                        <td className="report-td report-td-id">{p.id ?? '—'}</td>
                        <td className="report-td">
                          <span
                            className="report-stress-badge"
                            style={{ background: c + '1a', color: c, border: `1px solid ${c}44` }}
                          >
                            {SHORT_STRESS[s] ?? s}
                          </span>
                        </td>
                        <td className="report-td report-td-cwsi" style={{ color: cwsiCellColor(p.cwsi), fontWeight: (p.cwsi ?? 0) > 0.5 ? 600 : 400 }}>
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

        {/* ── Recommandations agronomiques (carte structurée) ── */}
        {reco && (
          <section className="report-section">
            <h2 className="report-section-title">Recommandations agronomiques</h2>
            <div
              className="report-reco-card"
              style={{ borderColor: reco.borderCard }}
            >
              {/* Header */}
              <div
                className="report-reco-card-header"
                style={{ background: reco.bg }}
              >
                <span className="report-reco-card-title" style={{ color: reco.color }}>
                  {reco.badge}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {reco.water && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      💧 ~{reco.water} L/arbre
                      {total ? ` — ${(reco.water * total / 1000).toFixed(1)} m³` : ''}
                    </span>
                  )}
                  <span
                    className="report-reco-card-pill"
                    style={{ color: reco.color, borderColor: reco.border, background: reco.bg }}
                  >
                    {reco.pill}
                  </span>
                </div>
              </div>

              {/* Corps — items */}
              <div className="report-reco-card-body">
                {reco.items.map((item, i) => (
                  <div key={i} className="report-reco-card-item">
                    <span style={{ color: reco.color, flexShrink: 0, fontWeight: 600 }}>→</span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>

              {/* Footer dose d'irrigation */}
              {reco.water && (
                <div className="report-reco-card-footer">
                  💧 Dose estimée : {reco.water} mm/arbre
                  {total ? ` · Total : ${(reco.water * total / 1000).toFixed(1)} m³ pour la parcelle` : ''}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Méthodologie (print only) ── */}
        <section className="report-section report-section--methodology print-only">
          <h2 className="report-section-title">Méthodologie</h2>
          <div className="report-methodology">
            <p>
              Le CWSI (Crop Water Stress Index) est calculé selon la formule de <strong>Idso et al. (1981)</strong>,
              calibrée pour l'olivier (<em>Olea europaea</em>) au Maroc. L'imagerie thermique est acquise par drone
              entre 11h et 14h solaire. Les températures de canopée sont extraites par segmentation des couronnes
              arborées et comparées aux valeurs théoriques baselines.
            </p>
            <p style={{ marginTop: 8 }}>
              Cinq niveaux de stress : <strong>Aucun</strong> (&lt;0.1), <strong>Faible</strong> (0.1–0.3),
              <strong> Modéré</strong> (0.3–0.5), <strong>Élevé</strong> (0.5–0.7), <strong>Sévère</strong> (≥0.7).
              Référence : FAO-56, Allen et al. (1998).
            </p>
          </div>
        </section>

        <div className="report-footer no-print">
          GeoOlive · Rapport généré le {today}
        </div>
      </div>

      <div className="report-print-footer print-only">
        <span>GeoOlive — Rapport d'analyse CWSI · {mission.nom || mission.id}</span>
        <span>{today}</span>
      </div>

    </div>
  )
}
