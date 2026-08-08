import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { fetchTrees } from '../api'
import { STRESS_COLORS } from '../constants'

const W = 560
const H = 320
const DOT_R = 5

function normalizeTrees(features) {
  const pts = features
    .filter(f => f.geometry?.coordinates?.length >= 1)
    .map(f => {
      let lng, lat
      if (f.geometry.type === 'Point') {
        lng = f.geometry.coordinates[0]
        lat = f.geometry.coordinates[1]
      } else if (f.geometry.type === 'Polygon') {
        const ring = f.geometry.coordinates[0]
        lng = ring.reduce((s, c) => s + c[0], 0) / ring.length
        lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
      } else if (f.geometry.type === 'MultiPolygon') {
        const ring = f.geometry.coordinates[0][0]
        lng = ring.reduce((s, c) => s + c[0], 0) / ring.length
        lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
      } else {
        return null
      }
      return {
        lng, lat,
        color: STRESS_COLORS[f.properties.stress] ?? '#7e8c80',
        cwsi:  f.properties.cwsi,
        id:    f.properties.id,
      }
    })
    .filter(Boolean)
  if (!pts.length) return []
  const lngs = pts.map(p => p.lng)
  const lats = pts.map(p => p.lat)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const rangeLng = maxLng - minLng || 1
  const rangeLat = maxLat - minLat || 1
  const pad = DOT_R + 6
  return pts.map(p => ({
    ...p,
    cx: pad + ((p.lng - minLng) / rangeLng) * (W - 2 * pad),
    cy: pad + (1 - (p.lat - minLat) / rangeLat) * (H - 2 * pad),
  }))
}

export default function BeforeAfterSlider({ mission1, mission2 }) {
  const [sliderPct, setSliderPct] = useState(50)
  const [trees1,    setTrees1]    = useState([])
  const [trees2,    setTrees2]    = useState([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const containerRef = useRef(null)
  const dragging     = useRef(false)

  useEffect(() => {
    if (!mission1?.id || !mission2?.id) return
    setLoading(true)
    setError(null)
    Promise.all([fetchTrees(mission1.id), fetchTrees(mission2.id)])
      .then(([g1, g2]) => {
        setTrees1(normalizeTrees(g1.features ?? []))
        setTrees2(normalizeTrees(g2.features ?? []))
      })
      .catch(() => setError('Impossible de charger les données'))
      .finally(() => setLoading(false))
  }, [mission1?.id, mission2?.id])

  const sliderX = (sliderPct / 100) * W

  const updateFromEvent = useCallback((clientX) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const scaleX = W / rect.width
    const raw = (clientX - rect.left) * scaleX
    setSliderPct(Math.max(4, Math.min(96, (raw / W) * 100)))
  }, [])

  const onMouseDown = useCallback(e => { e.preventDefault(); dragging.current = true }, [])
  const onMouseMove = useCallback(e => { if (dragging.current) updateFromEvent(e.clientX) }, [updateFromEvent])
  const onMouseUp   = useCallback(() => { dragging.current = false }, [])
  const onTouchMove = useCallback(e => updateFromEvent(e.touches[0].clientX), [updateFromEvent])

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [onMouseMove, onMouseUp])

  // Dots for both missions
  const dots1 = useMemo(() => trees1.map((t, i) => (
    <circle
      key={`t1-${i}`}
      cx={t.cx} cy={t.cy} r={DOT_R}
      fill={t.color} fillOpacity={0.88}
      stroke="white" strokeWidth={0.8}
    />
  )), [trees1])

  const dots2 = useMemo(() => trees2.map((t, i) => (
    <circle
      key={`t2-${i}`}
      cx={t.cx} cy={t.cy} r={DOT_R}
      fill={t.color} fillOpacity={0.88}
      stroke="white" strokeWidth={0.8}
    />
  )), [trees2])

  const isEmpty = !loading && !error && trees1.length === 0 && trees2.length === 0

  if (!mission1 || !mission2) return null

  return (
    <div className="bas-wrap">
      <div className="bas-labels">
        <span className="bas-label bas-label--left">{mission1.nom || mission1.id}</span>
        <span className="bas-label bas-label--right">{mission2.nom || mission2.id}</span>
      </div>

      <div
        className="bas-container"
        ref={containerRef}
        onMouseDown={onMouseDown}
        onTouchMove={onTouchMove}
        onTouchStart={e => updateFromEvent(e.touches[0].clientX)}
      >
        {loading && (
          <div className="bas-loading">Chargement des données…</div>
        )}
        {error && !loading && (
          <div className="bas-loading bas-loading--error">{error}</div>
        )}
        {isEmpty && (
          <div className="bas-loading">
            Aucune donnée de géométrie disponible pour cette comparaison.
            <br />
            <span style={{ fontSize: 10, opacity: 0.6 }}>
              Vérifiez que les deux missions ont des shapefiles importés.
            </span>
          </div>
        )}

        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%" height="100%"
          style={{ display: 'block', userSelect: 'none' }}
        >
          <defs>
            {/* Clip-path : left half → mission 1 */}
            <clipPath id="bas-clip-left">
              <rect x={0} y={0} width={sliderX} height={H} />
            </clipPath>
            {/* Clip-path : right half → mission 2 */}
            <clipPath id="bas-clip-right">
              <rect x={sliderX} y={0} width={W - sliderX} height={H} />
            </clipPath>
          </defs>

          {/* Background */}
          <rect x={0}       y={0} width={sliderX}       height={H} rx={0} fill="rgba(16,32,24,0.35)" />
          <rect x={sliderX} y={0} width={W - sliderX}   height={H} rx={0} fill="rgba(12,24,40,0.35)" />

          {/* Mission 1 trees (left half) */}
          <g clipPath="url(#bas-clip-left)">{dots1}</g>

          {/* Mission 2 trees (right half) */}
          <g clipPath="url(#bas-clip-right)">{dots2}</g>

          {/* Divider line */}
          <line
            x1={sliderX} y1={0} x2={sliderX} y2={H}
            stroke="white" strokeWidth={2} strokeOpacity={0.9}
          />

          {/* Handle */}
          <g transform={`translate(${sliderX}, ${H / 2})`} style={{ cursor: 'ew-resize' }}>
            <circle r={18} fill="white" fillOpacity={0.95} filter="url(#bas-shadow)" />
            <text textAnchor="middle" dominantBaseline="central" fontSize={13} fill="#1a3a2a" fontWeight={700}>
              ⇔
            </text>
          </g>

          {/* Left label overlay */}
          <text x={12} y={22} fontSize={11} fill="rgba(255,255,255,0.7)" fontWeight={600}>
            {(mission1.nom || mission1.id)?.slice(0, 18)}
          </text>
          {/* Right label overlay */}
          <text x={W - 12} y={22} fontSize={11} fill="rgba(255,255,255,0.7)" fontWeight={600} textAnchor="end">
            {(mission2.nom || mission2.id)?.slice(0, 18)}
          </text>

          {/* Date badges */}
          {mission1.date && (
            <text x={12} y={H - 10} fontSize={10} fill="rgba(255,255,255,0.55)">{mission1.date}</text>
          )}
          {mission2.date && (
            <text x={W - 12} y={H - 10} fontSize={10} fill="rgba(255,255,255,0.55)" textAnchor="end">{mission2.date}</text>
          )}
        </svg>
      </div>

      <p className="bas-hint">Glissez le curseur pour comparer les deux missions</p>
    </div>
  )
}
