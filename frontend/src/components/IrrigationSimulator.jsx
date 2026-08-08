import { useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, CartesianGrid, LabelList,
} from 'recharts'
import { STRESS_COLORS } from '../constants'
import * as turf from '@turf/turf'
import {
  LuDroplets, LuPackage, LuClock, LuBanknote, LuChevronDown,
} from 'react-icons/lu'

// ── Constantes ──────────────────────────────────────────────────────────────
const DEFAULT_LAT  = 35.76
const STRESS_ORDER = ['aucun', 'faible', 'modere', 'eleve', 'severe']
const STRESS_SHORT = { aucun: 'Aucun', faible: 'Faible', modere: 'Modéré', eleve: 'Élevé', severe: 'Sévère', inconnu: '—' }

const KPI_META = [
  { key: 'deficitMm', label: 'Déficit',  unit: 'mm',   Icon: LuDroplets,  color: '#3b82f6', bg: 'rgba(59,130,246,0.12)'  },
  { key: 'volumeM3',  label: 'Volume',   unit: 'm³',   Icon: LuPackage,   color: '#4a7c59', bg: 'rgba(74,124,89,0.12)'   },
  { key: 'dureeH',    label: 'Durée',    unit: 'h',    Icon: LuClock,     color: '#f59e0b', bg: 'rgba(245,158,11,0.12)'  },
  { key: 'coutTotal', label: 'Coût',     unit: 'MAD',  Icon: LuBanknote,  color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)'  },
]

const PRIORITY_META = [
  {
    key: 'urgent',
    emoji: '🔴',
    label: 'Urgence (< 24h)',
    badge: 'Irriguer sous 24h',
    color: '#dc2626',
    bg:   'rgba(220,38,38,0.10)',
    border: 'rgba(220,38,38,0.28)',
  },
  {
    key: 'watch',
    emoji: '🟠',
    label: 'Surveillance (< 72h)',
    badge: 'Irriguer sous 72h',
    color: '#d97706',
    bg:   'rgba(245,158,11,0.10)',
    border: 'rgba(245,158,11,0.28)',
  },
  {
    key: 'ok',
    emoji: '🟢',
    label: 'OK — Aucune intervention',
    badge: 'État satisfaisant',
    color: '#16a34a',
    bg:   'rgba(22,163,74,0.10)',
    border: 'rgba(22,163,74,0.28)',
  },
]

const CAL_EMOJIS = ['🔴', '🟠', '🟢']

// ── Calculs ETo / Kc ────────────────────────────────────────────────────────
function dayOfYear(dateStr) {
  const d = new Date(dateStr)
  return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000)
}

function computeRa(dateStr, lat) {
  const J     = dayOfYear(dateStr)
  const phi   = lat * Math.PI / 180
  const dr    = 1 + 0.033 * Math.cos(2 * Math.PI * J / 365)
  const delta = 0.409 * Math.sin(2 * Math.PI * J / 365 - 1.39)
  const ws    = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(delta))))
  return (24 * 60 / Math.PI) * 0.0820 * dr * (
    ws * Math.sin(phi) * Math.sin(delta) +
    Math.cos(phi) * Math.cos(delta) * Math.sin(ws)
  )
}

// Hargreaves simplifié — Tmax = Tmean+3, Tmin = Tmean-3 → sqrt(6)
function computeETo(tmean, dateStr, lat) {
  const Ra = computeRa(dateStr, lat)
  return Math.max(0, parseFloat((0.0023 * Ra * (tmean + 17.8) * Math.sqrt(6)).toFixed(1)))
}

function getKcForMonth(ps, missionDate) {
  if (!ps || !missionDate) return 0.65
  const m = new Date(missionDate).getMonth() + 1
  if ([12, 1, 2].includes(m)) return ps.kcHiver ?? 0.45
  if ([3, 4, 5].includes(m)) return ps.kcPrintemps ?? 0.65
  return ps.kcEte ?? 0.70
}

// ── Tooltip glassmorphism ────────────────────────────────────────────────────
function VolTip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <div className="chart-tip-label">{label}</div>
      <div className="chart-tip-value">{Number(payload[0].value).toFixed(2)} m³</div>
    </div>
  )
}

// ── Sous-composants internes ─────────────────────────────────────────────────
function PriorityRow({ meta, count, total }) {
  const pct = total > 0 ? Math.round(count / total * 100) : 0
  return (
    <div className="irr-priority-row" style={{ borderLeftColor: meta.color }}>
      <div className="irr-priority-header">
        <span className="irr-priority-title">
          {meta.emoji} {meta.label}
        </span>
        <div className="irr-priority-meta">
          <span className="irr-priority-count">{count} arbre{count !== 1 ? 's' : ''}</span>
          <span
            className="irr-priority-badge"
            style={{ background: meta.bg, color: meta.color, borderColor: meta.border }}
          >
            {meta.badge}
          </span>
        </div>
      </div>
      <div className="irr-progress-track">
        <div
          className="irr-progress-fill"
          style={{ width: `${pct}%`, background: meta.color + 'cc' }}
        />
      </div>
    </div>
  )
}

// ── Composant principal ──────────────────────────────────────────────────────
export default function IrrigationSimulator({
  stats,
  features,
  parcelSettings,
  geojson,
  mission,
  yieldPredictions,
}) {
  const [open,     setOpen]     = useState(false)
  const [etoInput, setEtoInput] = useState('')
  const [kcInput,  setKcInput]  = useState('')
  const [effInput, setEffInput] = useState('') // valeur en % (ex: "90")

  // Latitude depuis centroïde GeoJSON pour le calcul Ra
  const lat = useMemo(() => {
    if (geojson?.features?.length) {
      try { return turf.centroid(geojson).geometry.coordinates[1] } catch { /* fallback */ }
    }
    return DEFAULT_LAT
  }, [geojson])

  // Valeurs par défaut
  const defaultETo = useMemo(() => {
    const tmean = mission?.meteo?.temp_air
    return (tmean != null && mission?.date) ? computeETo(tmean, mission.date, lat) : 5.0
  }, [mission, lat])
  const defaultKc  = useMemo(() => getKcForMonth(parcelSettings, mission?.date), [parcelSettings, mission?.date])
  const defaultEff = parcelSettings?.irrigationEfficiency ?? 0.90

  // Valeurs effectives (input prioritaire sur défaut)
  const eto = etoInput !== '' ? (parseFloat(etoInput) || defaultETo) : defaultETo
  const kc  = kcInput  !== '' ? (parseFloat(kcInput)  || defaultKc)  : defaultKc
  const eff = effInput !== '' ? (parseFloat(effInput) / 100 || defaultEff) : defaultEff

  // Paramètres parcelle
  const src         = features ?? []
  const nb          = Math.max(1, stats?.total_arbres ?? src.length)
  const surfaceHa   = parseFloat(parcelSettings?.surface) || null
  const surfaceM2   = surfaceHa ? surfaceHa * 10000 : nb * 25
  const s2arbre     = Math.max(15, surfaceM2 / nb)
  const pumpFlow    = Math.max(0.1, parcelSettings?.pumpFlow  ?? 3.0)
  const waterCost   = parcelSettings?.waterCost   ?? 0
  const energyKwh   = parcelSettings?.energyKwh   ?? 0.75
  const energyPrice = parcelSettings?.energyPrice ?? 1.05

  // ── Calculs bilan hydrique ──
  const sim = useMemo(() => {
    const etc       = eto * kc
    const cwsiVals  = src.map(f => f.properties.cwsi ?? 0)
    const cwsiMoy   = cwsiVals.length
      ? cwsiVals.reduce((a, b) => a + b, 0) / cwsiVals.length
      : (stats?.cwsi?.moyenne ?? 0)
    const deficitMm   = etc * (1 + cwsiMoy * 1.5)
    const volumeM3    = (deficitMm / 1000) * s2arbre * nb / Math.max(0.01, eff)
    const dureeH      = volumeM3 / pumpFlow
    const coutEau     = volumeM3 * waterCost
    const coutEnergie = volumeM3 * energyKwh * energyPrice
    return { etc, deficitMm, volumeM3, dureeH, coutEau, coutEnergie, coutTotal: coutEau + coutEnergie }
  }, [eto, kc, eff, src, stats, s2arbre, nb, pumpFlow, waterCost, energyKwh, energyPrice])

  // ── Groupes de priorité ──
  const groups = useMemo(() => ({
    urgent: src.filter(f => (f.properties.cwsi ?? 0) >= 0.50),
    watch:  src.filter(f => { const c = f.properties.cwsi ?? 0; return c >= 0.35 && c < 0.50 }),
    ok:     src.filter(f => (f.properties.cwsi ?? 0) < 0.35),
  }), [src])

  // ── Volume par classe de stress ──
  const volumeByStress = useMemo(() => STRESS_ORDER.map(classe => {
    const trees = src.filter(f => f.properties.stress === classe)
    if (!trees.length) return null
    const cwsiAvg = trees.reduce((s, f) => s + (f.properties.cwsi ?? 0), 0) / trees.length
    const vol = ((eto * kc * (1 + cwsiAvg * 1.5)) / 1000) * s2arbre * trees.length / Math.max(0.01, eff)
    return { label: STRESS_SHORT[classe], volume: parseFloat(vol.toFixed(2)), color: STRESS_COLORS[classe] }
  }).filter(Boolean), [src, eto, kc, eff, s2arbre])

  // ── Calendrier suggéré ──
  const calendar = useMemo(() => {
    const DAYS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']
    const base  = mission?.date ? new Date(mission.date) : new Date()
    const dayAt  = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return DAYS[d.getDay()] }
    const dateAt = (n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) }
    const vol    = (trees, cwsiRef) =>
      ((eto * kc * (1 + cwsiRef * 1.5)) / 1000) * s2arbre * trees.length / Math.max(0.01, eff)

    const slots = []
    if (groups.urgent.length) slots.push({ day: dayAt(0), date: dateAt(0), count: groups.urgent.length, vol: vol(groups.urgent, 0.60) })
    if (groups.watch.length)  slots.push({ day: dayAt(2), date: dateAt(2), count: groups.watch.length,  vol: vol(groups.watch,  0.425) })
    if (groups.ok.length)     slots.push({ day: dayAt(4), date: dateAt(4), count: groups.ok.length,     vol: vol(groups.ok,     0.10)  })
    return slots
  }, [groups, mission?.date, eto, kc, eff, s2arbre])

  // ── Valeurs affichées dans les KPI cards ──
  const kpiValues = {
    deficitMm: `${sim.deficitMm.toFixed(1)} mm`,
    volumeM3:  `${sim.volumeM3.toFixed(1)} m³`,
    dureeH:    `${sim.dureeH.toFixed(1)} h`,
    coutTotal: `${sim.coutTotal.toFixed(0)} MAD`,
  }

  return (
    <div className="irr-wrap">

      {/* ── En-tête / toggle ── */}
      <div
        className={`irr-header${open ? ' open' : ''}`}
        onClick={() => setOpen(v => !v)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(v => !v)}
      >
        <div className="irr-header-left">
          <span className="irr-header-icon">💧</span>
          <div className="irr-header-text">
            <div className="irr-header-title">Simulateur d'irrigation</div>
            <div className="irr-header-subtitle">Bilan hydrique FAO-56 · Hargreaves</div>
          </div>
        </div>
        <div className="irr-header-right">
          <span className="irr-badge">FAO-56</span>
          <LuChevronDown size={16} className={`irr-chevron${open ? ' open' : ''}`} />
        </div>
      </div>

      {/* ── Corps (visible quand open) ── */}
      {open && (
        <div className="irr-body">

          {/* Métadonnées mission */}
          {mission && (
            <div className="irr-mission-meta">
              {mission.nom || mission.id}
              {mission.date ? ` · ${mission.date}` : ''}
              {mission.meteo?.temp_air != null ? ` · ${mission.meteo.temp_air}°C` : ''}
            </div>
          )}

          {/* ── Paramètres inline modifiables ── */}
          <div className="irr-params-grid">
            <div className="irr-params-label irr-section-label">Paramètres</div>

            <div className="irr-pill-input">
              <span className="irr-pill-label">ETo</span>
              <div className="irr-pill-field">
                <input
                  type="number"
                  value={etoInput}
                  placeholder={defaultETo.toFixed(1)}
                  step="0.1"
                  onChange={e => setEtoInput(e.target.value)}
                  aria-label="ETo mm/j"
                />
                <span className="irr-pill-unit">mm/j</span>
              </div>
            </div>

            <div className="irr-pill-input">
              <span className="irr-pill-label">Kc</span>
              <div className="irr-pill-field">
                <input
                  type="number"
                  value={kcInput}
                  placeholder={defaultKc.toFixed(2)}
                  step="0.05"
                  min="0.1"
                  max="1.5"
                  onChange={e => setKcInput(e.target.value)}
                  aria-label="Coefficient cultural Kc"
                />
              </div>
            </div>

            <div className="irr-pill-input">
              <span className="irr-pill-label">Efficacité</span>
              <div className="irr-pill-field">
                <input
                  type="number"
                  value={effInput}
                  placeholder={(defaultEff * 100).toFixed(0)}
                  step="5"
                  min="50"
                  max="100"
                  onChange={e => setEffInput(e.target.value)}
                  aria-label="Efficacité irrigation %"
                />
                <span className="irr-pill-unit">%</span>
              </div>
            </div>
          </div>

          {/* ── KPI cards ── */}
          <div className="irr-kpi-grid">
            {KPI_META.map(({ key, label, Icon, color, bg }) => (
              <div key={key} className="irr-kpi-card">
                <div className="irr-kpi-icon-wrap" style={{ background: bg }}>
                  <Icon size={15} color={color} />
                </div>
                <div className="irr-kpi-value" style={{ color }}>{kpiValues[key]}</div>
                <div className="irr-kpi-lbl">{label}</div>
              </div>
            ))}
          </div>

          {/* ── Priorités d'intervention ── */}
          <div className="irr-priorities">
            <div className="irr-section-label irr-priorities-label">Priorités d'intervention</div>
            {PRIORITY_META.map(meta => (
              <PriorityRow
                key={meta.key}
                meta={meta}
                count={groups[meta.key].length}
                total={nb}
              />
            ))}
          </div>

          {/* ── Bar chart volume par stress ── */}
          {volumeByStress.length > 0 && (
            <div className="irr-chart-section">
              <div className="irr-section-label">Volume d'eau par niveau de stress (m³)</div>
              <div style={{ width: '100%', height: Math.max(100, volumeByStress.length * 36) }}>
                <ResponsiveContainer>
                  <BarChart
                    layout="vertical"
                    data={volumeByStress}
                    margin={{ top: 2, right: 54, left: 4, bottom: 2 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(148,163,184,0.08)"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      fontSize={10}
                      tick={{ fill: '#94a3b8' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      fontSize={11}
                      tick={{ fill: '#516657' }}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                    />
                    <Tooltip content={<VolTip />} cursor={{ fill: 'rgba(74,124,89,0.05)' }} />
                    <Bar dataKey="volume" radius={[0, 4, 4, 0]}>
                      {volumeByStress.map((e, i) => <Cell key={i} fill={e.color} fillOpacity={0.85} />)}
                      <LabelList
                        dataKey="volume"
                        position="right"
                        fontSize={10}
                        fill="#8ba08e"
                        formatter={v => `${v.toFixed(1)} m³`}
                      />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Calendrier suggéré ── */}
          {calendar.length > 0 && (
            <div className="irr-calendar-section">
              <div className="irr-section-label">Calendrier d'irrigation suggéré</div>
              <div className="irr-cal-grid">
                {calendar.map((slot, i) => (
                  <div key={i} className="irr-cal-chip">
                    <div className="irr-cal-day">{slot.day}</div>
                    <div className="irr-cal-date">{slot.date}</div>
                    <div className="irr-cal-count">{CAL_EMOJIS[i]} {slot.count}</div>
                    <div className="irr-cal-sublabel">arbres</div>
                    <div className="irr-cal-vol">{slot.vol.toFixed(1)} m³</div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  )
}
