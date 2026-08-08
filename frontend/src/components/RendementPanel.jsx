import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, Cell,
} from 'recharts'
import { LuLeaf, LuTrendingUp, LuX } from 'react-icons/lu'

const BINS = [
  { label: '0–5',  min: 0,  max: 5,       color: '#bf3226' },
  { label: '5–10', min: 5,  max: 10,       color: '#c96e1c' },
  { label: '10–15',min: 10, max: 15,       color: '#a89520' },
  { label: '15–20',min: 15, max: 20,       color: '#86c9a0' },
  { label: '20+',  min: 20, max: Infinity, color: '#3d9960' },
]

const panelStyle = {
  background: 'var(--bg-glass, rgba(15,23,42,0.78))',
  backdropFilter: 'blur(12px)',
  border: '1px solid var(--border-md, rgba(255,255,255,0.10))',
  borderRadius: 10,
  padding: '10px 12px',
  marginBottom: 8,
}
const headerStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  marginBottom: 8,
}
const titleStyle = {
  display: 'flex', alignItems: 'center', gap: 5,
  fontSize: 11, fontWeight: 600, color: '#3d9960', letterSpacing: '0.03em',
}
const closeBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-muted, #94a3b8)', padding: 2, lineHeight: 1,
  fontSize: 12, borderRadius: 4,
}
const kpisStyle = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 6, marginBottom: 10,
}
const kpiStyle = {
  background: 'rgba(255,255,255,0.04)',
  borderRadius: 7, padding: '6px 8px',
  display: 'flex', flexDirection: 'column', gap: 2,
}
const kpiLabelStyle = {
  fontSize: 9, color: 'var(--text-muted, #94a3b8)', textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
const kpiValueStyle = {
  fontSize: 14, fontWeight: 700, color: 'var(--text-primary, #f1f5f9)',
  lineHeight: 1.2,
}
const kpiUnitStyle = { fontSize: 10, fontWeight: 400, color: 'var(--text-muted, #94a3b8)' }
const chartTitleStyle = {
  fontSize: 10, color: 'var(--text-muted, #94a3b8)',
  marginBottom: 4, letterSpacing: '0.03em',
}
const legendStyle = {
  display: 'flex', flexWrap: 'wrap', gap: '4px 10px',
  marginTop: 6,
}
const legendItemStyle = {
  display: 'flex', alignItems: 'center', gap: 4,
  fontSize: 9, color: 'var(--text-muted, #94a3b8)',
}
const dotStyle = { width: 8, height: 8, borderRadius: 2, display: 'inline-block' }

const ttStyle = {
  background: 'var(--bg-elevated, #1e293b)',
  border: '1px solid var(--border-md, rgba(255,255,255,0.10))',
  borderRadius: 6, fontSize: 10,
}

export default function RendementPanel({ data, onClose }) {
  // data: { predictions: [{tree_id, rendement_kg}], aggregats: {...} }
  const { aggregats, predictions } = data

  const histData = useMemo(() =>
    BINS.map(b => ({
      label: b.label,
      count: predictions.filter(p => p.rendement_kg >= b.min && p.rendement_kg < b.max).length,
      color: b.color,
    })),
  [predictions])

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span style={titleStyle}>
          <LuLeaf size={13} /> Rendement prédit
        </span>
        {onClose && (
          <button style={closeBtnStyle} onClick={onClose} title="Revenir au mode stress">
            <LuX size={12} />
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={kpisStyle}>
        <div style={kpiStyle}>
          <span style={kpiLabelStyle}>Total</span>
          <span style={kpiValueStyle}>
            {aggregats.rendement_total_kg.toFixed(0)}
            <span style={kpiUnitStyle}> kg</span>
          </span>
        </div>
        <div style={kpiStyle}>
          <span style={kpiLabelStyle}>Moyen</span>
          <span style={kpiValueStyle}>
            {aggregats.rendement_moyen_kg.toFixed(1)}
            <span style={kpiUnitStyle}> kg/arbre</span>
          </span>
        </div>
        <div style={kpiStyle}>
          <span style={kpiLabelStyle}>Arbres</span>
          <span style={kpiValueStyle}>{aggregats.nb_arbres}</span>
        </div>
      </div>

      {/* Histogram */}
      <div style={chartTitleStyle}>Distribution (kg / arbre)</div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart data={histData} barCategoryGap="22%"
          margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
          <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted, #94a3b8)' }} />
          <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted, #94a3b8)' }} allowDecimals={false} />
          <Tooltip
            contentStyle={ttStyle}
            formatter={(v) => [v + ' arbres', 'Effectif']}
          />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {histData.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={legendStyle}>
        {BINS.map(b => (
          <span key={b.label} style={legendItemStyle}>
            <span style={{ ...dotStyle, background: b.color }} />
            {b.label} kg
          </span>
        ))}
      </div>
    </div>
  )
}
