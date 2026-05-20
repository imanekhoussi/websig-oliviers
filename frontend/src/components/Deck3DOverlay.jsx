import { useMemo } from 'react'
import DeckGL from '@deck.gl/react'
import { ColumnLayer, BitmapLayer } from '@deck.gl/layers'
import { TileLayer } from '@deck.gl/geo-layers'
import { STRESS_COLORS } from '../constants'

function hexToRgb(hex) {
  const m = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [149, 165, 166]
}

function featureCentroid(feature) {
  const g = feature?.geometry
  if (!g) return null
  if (g.type === 'Point') return g.coordinates.slice(0, 2)
  if (g.type === 'Polygon') {
    const ring = g.coordinates[0]
    return [
      ring.reduce((s, c) => s + c[0], 0) / ring.length,
      ring.reduce((s, c) => s + c[1], 0) / ring.length,
    ]
  }
  if (g.type === 'MultiPolygon') {
    const ring = g.coordinates[0][0]
    return [
      ring.reduce((s, c) => s + c[0], 0) / ring.length,
      ring.reduce((s, c) => s + c[1], 0) / ring.length,
    ]
  }
  return null
}

// Facteur multiplicateur pour rendre la hauteur visible à l'écran
const ELEV_SCALE = 10

export default function Deck3DOverlay({ geojson, initialViewState, onClose }) {
  const columnData = useMemo(() => {
    if (!geojson?.features?.length) return []
    return geojson.features
      .map(f => {
        const pos = featureCentroid(f)
        if (!pos) return null
        const { hauteur, cwsi, stress, id } = f.properties
        return {
          position: pos,
          elevation: Math.max(hauteur ?? 2, 0.5) * ELEV_SCALE,
          color: hexToRgb(STRESS_COLORS[stress] ?? '#95a5a6'),
          id,
          hauteur,
          cwsi,
        }
      })
      .filter(Boolean)
  }, [geojson])

  const layers = useMemo(() => [
    new TileLayer({
      id: '3d-basemap-satellite',
      data: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      minZoom: 0,
      maxZoom: 19,
      tileSize: 256,
      renderSubLayers: props => {
        const { bbox: { west, south, east, north } } = props.tile
        return new BitmapLayer(props, {
          data: null,
          image: props.data,
          bounds: [west, south, east, north],
        })
      },
    }),
    new ColumnLayer({
      id: 'tree-columns-3d',
      data: columnData,
      diskResolution: 16,
      radius: 2,           // rayon en mètres
      extruded: true,
      getPosition: d => d.position,
      getElevation: d => d.elevation,
      getFillColor: d => [...d.color, 215],
      getLineColor: [30, 41, 59],
      lineWidthMinPixels: 1,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 80],
    }),
  ], [columnData])

  return (
    <>
      <DeckGL
        initialViewState={{
          ...initialViewState,
          pitch: 45,
          bearing: 0,
          transitionDuration: 800,
        }}
        controller
        layers={layers}
        style={{ position: 'absolute', inset: 0, zIndex: 900 }}
        getTooltip={({ object: d }) =>
          d && {
            html: `<div style="
              background:rgba(15,23,42,0.92);
              padding:9px 13px;
              border-radius:8px;
              font-size:12px;
              color:#f1f5f9;
              line-height:1.75;
              border:1px solid rgba(148,163,184,0.2);
              box-shadow:0 4px 16px rgba(0,0,0,0.4)">
              <b style="font-size:13px">🌳 Arbre #${d.id ?? '?'}</b><br/>
              Hauteur&nbsp;: <b>${d.hauteur != null ? d.hauteur.toFixed(1) + ' m' : '—'}</b><br/>
              CWSI&nbsp;&nbsp;&nbsp;: <b>${d.cwsi != null ? d.cwsi.toFixed(3) : '—'}</b>
            </div>`,
            style: { background: 'none', padding: 0 },
          }
        }
      />

      {/* Bouton centré en haut pour quitter le mode 3D */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          background: 'rgba(15,23,42,0.88)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(148,163,184,0.25)',
          color: '#f1f5f9',
          borderRadius: 8,
          padding: '8px 20px',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          whiteSpace: 'nowrap',
        }}
      >
        ✕ Quitter la Vue 3D
      </button>
    </>
  )
}
