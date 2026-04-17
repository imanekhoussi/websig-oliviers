import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Polygon, GeoJSON, Popup, LayersControl, Pane, useMap, FeatureGroup } from 'react-leaflet'
import * as turf from '@turf/turf'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import {
  LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, ReferenceDot,
} from 'recharts'
import { STRESS_COLORS, STRESS_LABELS } from '../constants'
import { fetchTreeHistory } from '../api'

const { BaseLayer, Overlay } = LayersControl

const DEFAULT_CENTER = [35.76, -5.83]
const DEFAULT_ZOOM   = 7

/**
 * Outil de dessin natif Leaflet.Draw.
 * Monte un L.Control.Draw sur la carte et appelle setSelectedTrees
 * après chaque création ou suppression de forme.
 */
function DrawControl({ allFeatures, setSelectedTrees }) {
  const map             = useMap()
  // Ref pour que handleCreated lise toujours la valeur courante de allFeatures,
  // même si le handler a été créé avant le chargement du geojson.
  const allFeaturesRef  = useRef(allFeatures)

  // Synchronise la ref à chaque rendu — pas de remontage du contrôle nécessaire.
  useEffect(() => { allFeaturesRef.current = allFeatures }, [allFeatures])

  useEffect(() => {
    if (!map || !setSelectedTrees) return

    // Traduction française des tooltips Leaflet Draw
    if (window.L?.drawLocal) {
      const d = window.L.drawLocal.draw
      d.toolbar.actions.title = 'Annuler le dessin'
      d.toolbar.actions.text  = 'Annuler'
      d.toolbar.finish.title  = 'Terminer le dessin'
      d.toolbar.finish.text   = 'Terminer'
      d.toolbar.undo.title    = 'Supprimer le dernier point'
      d.toolbar.undo.text     = 'Annuler le point'
      d.handlers.polygon.tooltip.start  = 'Cliquez pour commencer à dessiner la zone.'
      d.handlers.polygon.tooltip.cont   = 'Cliquez pour continuer le dessin.'
      d.handlers.polygon.tooltip.end    = 'Cliquez sur le premier point pour fermer la zone.'
      d.handlers.polyline.tooltip.start = 'Cliquez pour commencer la ligne de mesure.'
      d.handlers.circle.tooltip.start   = 'Cliquez et glissez pour dessiner une zone circulaire.'
      d.handlers.marker.tooltip.start   = 'Cliquez sur la carte pour placer un marqueur.'
    }

    const fg = new window.L.FeatureGroup()
    map.addLayer(fg)

    const drawControl = new window.L.Control.Draw({
      edit: { featureGroup: fg },
      draw: {
        polygon:      { shapeOptions: { color: '#38bdf8', weight: 2 } },
        rectangle:    { shapeOptions: { color: '#38bdf8', weight: 2 } },
        circle:       { shapeOptions: { color: '#38bdf8', weight: 2 } },
        polyline:     { shapeOptions: { color: '#38bdf8', weight: 2 } },
        marker:       true,
        circlemarker: false,
      },
    })
    map.addControl(drawControl)

    function handleCreated(e) {
      fg.clearLayers()
      fg.addLayer(e.layer)

      const features = allFeaturesRef.current   // toujours à jour

      // Polyline et marker ne définissent pas de zone de sélection
      if (e.layerType === 'polyline' || e.layerType === 'marker') {
        setSelectedTrees(null)
        return
      }

      // Circle : convertit le cercle Leaflet en polygone GeoJSON via Turf
      let selectionPolygon
      if (e.layerType === 'circle') {
        const { lat, lng } = e.layer.getLatLng()
        const radiusKm = e.layer.getRadius() / 1000
        selectionPolygon = turf.circle([lng, lat], radiusKm, { units: 'kilometers' })
      } else {
        selectionPolygon = e.layer.toGeoJSON()
      }

      if (!features?.length) { setSelectedTrees([]); return }

      const selected = features.filter(feature => {
        try {
          // turf.centroid fonctionne sur Point ET Polygon (couronne d'arbre)
          const center = turf.centroid(feature)
          return turf.booleanPointInPolygon(center, selectionPolygon)
        } catch {
          return false
        }
      })

      setSelectedTrees(selected)
    }

    function handleDeleted() {
      setSelectedTrees(null)
    }

    map.on(window.L.Draw.Event.CREATED, handleCreated)
    map.on(window.L.Draw.Event.DELETED, handleDeleted)

    return () => {
      map.off(window.L.Draw.Event.CREATED, handleCreated)
      map.off(window.L.Draw.Event.DELETED, handleDeleted)
      map.removeControl(drawControl)
      map.removeLayer(fg)
    }
  }, [map, setSelectedTrees])

  return null
}

function reverseCoordinates(coords) {
  if (typeof coords[0] === 'number') return [coords[1], coords[0]]
  return coords.map(reverseCoordinates)
}

/** Contrôleur interne : fait voler la carte vers les nouvelles données */
function MapController({ geojson }) {
  const map     = useMap()
  const prevRef = useRef(null)

  useEffect(() => {
    if (!geojson?.features?.length || geojson === prevRef.current) return
    prevRef.current = geojson

    const first = geojson.features.find(f => f.geometry?.coordinates)
    if (!first) return

    let center
    if (first.geometry.type === 'Point') {
      center = [first.geometry.coordinates[1], first.geometry.coordinates[0]]
    } else {
      const c = first.geometry.type === 'Polygon'
        ? first.geometry.coordinates[0][0]
        : first.geometry.coordinates[0][0][0]
      center = [c[1], c[0]]
    }

    map.flyTo(center, 18, { duration: 1.3, easeLinearity: 0.4 })
  }, [geojson, map])

  return null
}

/** Applique clip-path sur les panes gauche/droite selon splitPos */
function ClipController({ splitPos, isCompareMode }) {
  const map = useMap()

  useEffect(() => {
    const leftPane  = map.getPane('left-pane')
    const rightPane = map.getPane('right-pane')
    if (!isCompareMode) {
      if (leftPane)  leftPane.style.clipPath  = ''
      if (rightPane) rightPane.style.clipPath = ''
      return
    }
    if (leftPane)  leftPane.style.clipPath  = `inset(0 ${100 - splitPos}% 0 0)`
    if (rightPane) rightPane.style.clipPath = `inset(0 0 0 ${splitPos}%)`
  }, [splitPos, isCompareMode, map])

  return null
}

/** Tooltip minimaliste pour le graphique historique */
function HistoryTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(8,14,26,0.96)',
      border: '1px solid rgba(148,163,184,0.2)',
      borderRadius: 6,
      padding: '5px 9px',
      fontSize: 11,
      color: '#f1f5f9',
      lineHeight: 1.5,
    }}>
      <div style={{ color: '#64748b' }}>{label}</div>
      <div>CWSI : <b>{payload[0].value}</b></div>
    </div>
  )
}

/** Data card popup pour un arbre */
function TreePopup({ p, color, history }) {
  const cwsiPct   = Math.min((p.cwsi || 0) * 100, 100)
  const hasHistory = Array.isArray(history) && history.length >= 2

  return (
    <Popup className="tree-popup-wrapper" minWidth={260}>
      <div className="custom-popup">

        {/* ── En-tête ── */}
        <div className="popup-header">
          <span className="popup-title">🌳 Olivier #{p.id ?? 'N/A'}</span>
          <span className="stress-badge" style={{ backgroundColor: color }}>
            {STRESS_LABELS[p.stress] ?? 'Inconnu'}
          </span>
        </div>

        {/* ── Grille 3 colonnes ── */}
        <div className="popup-grid">
          <div className="popup-cell">
            <span className="popup-cell-icon">🌡️</span>
            <span className="popup-cell-label">Temp.</span>
            <span className="popup-cell-value">{p.temp_moy?.toFixed(1) ?? '—'}<small>°C</small></span>
          </div>
          <div className="popup-cell">
            <span className="popup-cell-icon">📏</span>
            <span className="popup-cell-label">Hauteur</span>
            <span className="popup-cell-value">
              {p.hauteur != null ? <>{p.hauteur.toFixed(1)}<small>m</small></> : '—'}
            </span>
          </div>
          <div className="popup-cell">
            <span className="popup-cell-icon">💧</span>
            <span className="popup-cell-label">CWSI</span>
            <span className="popup-cell-value" style={{ color }}>{p.cwsi?.toFixed(3) ?? '—'}</span>
          </div>
        </div>

        {/* ── Historique CWSI ou jauge selon disponibilité ── */}
        {hasHistory ? (
          <div className="cwsi-history-chart">
            <div className="cwsi-bar-label">
              <span>Historique CWSI</span>
              <span>{history.length} missions</span>
            </div>
            <ResponsiveContainer width="100%" height={88}>
              <LineChart data={history} margin={{ top: 6, right: 6, bottom: 0, left: -28 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#64748b', fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 1]}
                  tick={{ fill: '#64748b', fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  tickCount={3}
                />
                <ReTooltip content={<HistoryTooltip />} />
                <Line
                  type="monotone"
                  dataKey="cwsi"
                  stroke={color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: color, strokeWidth: 0 }}
                  activeDot={{ r: 4, fill: color, stroke: 'white', strokeWidth: 1.5 }}
                  connectNulls
                />
                {p.cwsi != null && (
                  <ReferenceDot
                    x={history[history.length - 1]?.date}
                    y={history[history.length - 1]?.cwsi}
                    r={5}
                    fill="white"
                    stroke={color}
                    strokeWidth={2}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="cwsi-bar-wrap">
            <div className="cwsi-bar-label">
              <span>Stress hydrique</span>
              <span>{cwsiPct.toFixed(0)} %</span>
            </div>
            <div className="cwsi-bar-bg">
              <div
                className="cwsi-bar-fill"
                style={{ width: `${cwsiPct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        )}

      </div>
    </Popup>
  )
}

const HOTSPOT_STYLE = {
  color: '#ff4444',
  weight: 2,
  dashArray: '5, 5',
  fillColor: '#ff4444',
  fillOpacity: 0.2,
}

/** Classe un score CWSI en niveau de stress et retourne la couleur associée */
function cwsiToStressColor(cwsi) {
  if (cwsi == null) return STRESS_COLORS.inconnu
  if (cwsi < 0.1)  return STRESS_COLORS.aucun
  if (cwsi < 0.3)  return STRESS_COLORS.faible
  if (cwsi < 0.5)  return STRESS_COLORS.modere
  if (cwsi < 0.7)  return STRESS_COLORS.eleve
  return STRESS_COLORS.severe
}

/** Style Leaflet appliqué à chaque cellule de la grille IDW */
function idwStyleFn(feature) {
  return {
    stroke:      false,
    fillColor:   cwsiToStressColor(feature?.properties?.cwsi),
    fillOpacity: 0.45,
  }
}

export default function TreeMap({
  geojson,
  activeStress = ['aucun', 'faible', 'modere', 'eleve', 'severe'],
  isCompareMode = false,
  geojsonCompare,
  currentLabel = '',
  compareLabel = '',
  currentId = null,
  showHotspots = false,
  setSelectedTrees = null,
  selectedTrees = null,
  showIDW = false,
  showRoute = false,
  showMCDA = false,
  mcdaScores = {},
}) {
  // Cache de l'historique : { [treeId]: data[] }
  const historyCache = useRef({})
  const [, forceUpdate] = useState(0)

  // Split screen
  const [splitPos, setSplitPos] = useState(50)
  const isDragging = useRef(false)
  const wrapperRef = useRef(null)

  const fetchHistory = useCallback((treeId) => {
    if (treeId == null || historyCache.current[treeId]) return
    fetchTreeHistory(treeId)
      .then(data => {
        historyCache.current[treeId] = data
        forceUpdate(n => n + 1)
      })
      .catch(() => {
        historyCache.current[treeId] = []
      })
  }, [])

  // Gestion du glisser-déposer du séparateur
  useEffect(() => {
    function onMouseMove(e) {
      if (!isDragging.current || !wrapperRef.current) return
      const rect = wrapperRef.current.getBoundingClientRect()
      const pct  = Math.min(Math.max((e.clientX - rect.left) / rect.width * 100, 10), 90)
      setSplitPos(pct)
    }
    function onMouseUp() { isDragging.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',  onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',  onMouseUp)
    }
  }, [])

  // ── Calcul des hotspots (buffer + union des arbres critiques) ──
  const hotspotPolygons = useMemo(() => {
    if (!showHotspots || !geojson?.features?.length) return null

    const critical = geojson.features.filter(
      f => ['eleve', 'severe'].includes(f.properties.stress)
    )
    if (!critical.length) return null

    const fc = turf.featureCollection(critical)
    const buffered = turf.buffer(fc, 15, { units: 'meters' })
    if (!buffered?.features?.length) return null

    // Union itératif pour fusionner tous les buffers en zones continues
    const merged = buffered.features.reduce((acc, feat) =>
      acc ? turf.union(turf.featureCollection([acc, feat])) : feat
    , null)

    return merged ? turf.featureCollection([merged]) : null
  }, [showHotspots, geojson])

  // ── Grille IDW (Inverse Distance Weighting sur le CWSI) ──
  const idwGrid = useMemo(() => {
    if (!showIDW || !geojson?.features?.length) return null

    // A — Arbres avec CWSI valide uniquement
    const withCwsi = geojson.features.filter(f => f.properties.cwsi != null)
    if (withCwsi.length < 3) return null   // min 3 points pour interpoler

    // B — Centroïde de chaque arbre (Point ou Polygon) + propriété cwsi
    const points = withCwsi.map(f => {
      const pt = turf.centroid(f)
      pt.properties = { cwsi: f.properties.cwsi }
      return pt
    })
    const fc = turf.featureCollection(points)

    // C & D — Interpolation IDW sur une grille de 10 m
    try {
      return turf.interpolate(fc, 10, {
        gridType: 'square',
        property: 'cwsi',
        units:    'meters',
        weight:   2,
      })
    } catch {
      return null
    }
  }, [showIDW, geojson])

  // ── Itinéraire Nearest-Neighbor sur les arbres sévères ──
  const routeResult = useMemo(() => {
    if (!showRoute || !geojson?.features?.length) return null

    // 1 — Filtre les arbres en stress sévère
    const severe = geojson.features.filter(f => f.properties.stress === 'severe')
    if (severe.length < 2) return null

    // 2 — Centroïdes (Points ou Polygones → toujours un point)
    const pts = severe.map(f => {
      const pt = turf.centroid(f)
      pt.properties = { ...f.properties }
      return pt
    })

    // 3 — Greedy Nearest Neighbor (TSP approché)
    let unvisited  = [...pts]
    let current    = unvisited.shift()           // premier arbre = départ
    const ordered  = [current]

    while (unvisited.length > 0) {
      const nearest = turf.nearestPoint(current, turf.featureCollection(unvisited))
      ordered.push(nearest)
      const idx = unvisited.findIndex(
        p => p.geometry.coordinates[0] === nearest.geometry.coordinates[0] &&
             p.geometry.coordinates[1] === nearest.geometry.coordinates[1]
      )
      unvisited.splice(idx, 1)
      current = nearest
    }

    // 4 — Ligne de l'itinéraire
    const pathCoords = ordered.map(p => p.geometry.coordinates)
    const line = turf.lineString(pathCoords)

    // 5 — Point de départ (pour le marqueur visuel)
    const start = pathCoords[0]

    return { line, start, count: ordered.length }
  }, [showRoute, geojson])

  // Set des IDs sélectionnés pour lookup O(1)
  const selectedIds = useMemo(
    () => new Set((selectedTrees ?? []).map(f => f.properties.id)),
    [selectedTrees]
  )
  const hasSelection = selectedTrees !== null

  const visibleFeatures = (geojson?.features ?? []).filter(
    f => activeStress.includes(f.properties.stress || 'inconnu')
  )
  const visibleCompareFeatures = (geojsonCompare?.features ?? []).filter(
    f => activeStress.includes(f.properties.stress || 'inconnu')
  )

  function vulnerabilityToColor(score) {
    if (score == null) return '#64748b'
    if (score < 20)   return '#22c55e'
    if (score < 40)   return '#84cc16'
    if (score < 60)   return '#f59e0b'
    if (score < 80)   return '#ef4444'
    return '#7c3aed'
  }

  // applySelection=true uniquement pour la mission courante (pas le panneau de comparaison)
  function renderMarkers(features, pane, applySelection = false) {
    return features.map((feat, index) => {
      if (!feat.geometry?.coordinates) return null

      const p         = feat.properties
      const color     = showMCDA && mcdaScores[p.id] != null
        ? vulnerabilityToColor(mcdaScores[p.id])
        : STRESS_COLORS[p.stress] || STRESS_COLORS.inconnu
      const key       = `${pane ?? 'default'}-${p.id != null ? p.id : index}`
      const history   = historyCache.current[p.id]
      const paneProps = pane ? { pane } : {}

      // Dimming : arbre hors-sélection → quasi-transparent
      const dimmed = applySelection && hasSelection && !selectedIds.has(p.id)
      const fillO  = dimmed ? 0.15 : 0.92
      const strokeO = dimmed ? 0.1 : 1

      if (feat.geometry.type === 'Point') {
        return (
          <CircleMarker
            key={key}
            center={[feat.geometry.coordinates[1], feat.geometry.coordinates[0]]}
            radius={8}
            pathOptions={{
              color: dimmed ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.7)',
              weight: 1.5,
              fillColor: color,
              fillOpacity: fillO,
              opacity: strokeO,
            }}
            {...paneProps}
            eventHandlers={{
              click:     () => fetchHistory(p.id),
              mouseover: e => {
                if (dimmed) return
                e.target.setRadius(13)
                e.target.setStyle({ weight: 2.5, color: 'white' })
              },
              mouseout: e => {
                if (dimmed) return
                e.target.setRadius(8)
                e.target.setStyle({ weight: 1.5, color: 'rgba(255,255,255,0.7)' })
              },
            }}
          >
            <TreePopup p={p} color={color} history={history} />
          </CircleMarker>
        )
      }

      if (feat.geometry.type === 'Polygon' || feat.geometry.type === 'MultiPolygon') {
        const polyFillO = dimmed ? 0.08 : 0.55
        return (
          <Polygon
            key={key}
            positions={reverseCoordinates(feat.geometry.coordinates)}
            pathOptions={{
              color: dimmed ? 'rgba(255,255,255,0.1)' : color,
              weight: dimmed ? 0.5 : 1.5,
              fillColor: color,
              fillOpacity: polyFillO,
              opacity: strokeO,
            }}
            {...paneProps}
            eventHandlers={{
              click:     () => fetchHistory(p.id),
              mouseover: e => { if (!dimmed) e.target.setStyle({ fillOpacity: 0.85, weight: 2.5 }) },
              mouseout:  e => { if (!dimmed) e.target.setStyle({ fillOpacity: 0.55, weight: 1.5 }) },
            }}
          >
            <TreePopup p={p} color={color} history={history} />
          </Polygon>
        )
      }

      return null
    })
  }

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        maxZoom={22}
        style={{ height: '100%', width: '100%' }}
      >
        <MapController geojson={geojson} />
        <ClipController splitPos={splitPos} isCompareMode={isCompareMode} />
        <DrawControl allFeatures={geojson?.features ?? []} setSelectedTrees={setSelectedTrees} />

        {isCompareMode && (
          <>
            <Pane name="left-pane"  style={{ zIndex: 401 }} />
            <Pane name="right-pane" style={{ zIndex: 402 }} />
          </>
        )}

        <LayersControl position="topright">
          <BaseLayer checked name="Satellite (Esri)">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={22}
              maxNativeZoom={17}
              attribution="&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
            />
          </BaseLayer>
          <BaseLayer name="Mode Sombre (CartoDB)">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              attribution="&copy; CARTO"
            />
          </BaseLayer>
          <BaseLayer name="OpenStreetMap">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OSM"
            />
          </BaseLayer>

          {currentId && (
            <Overlay name="Orthomosaïque Drone RGB" checked={false}>
              <TileLayer
                url={`http://localhost:8000/tiles/${currentId}/rgb_tiles/{z}/{x}/{y}.png`}
                maxNativeZoom={22}
                maxZoom={24}
                errorTileUrl=""
                attribution="Drone RGB"
              />
            </Overlay>
          )}
        </LayersControl>

        {/* ── Grille IDW : z420, au-dessus de l'ortho (z400), sous hotspots (z450) ── */}
        <Pane name="idw-pane" style={{ zIndex: 420 }} />
        {idwGrid && (
          <GeoJSON
            key={`idw-${idwGrid.features.length}-${geojson?.features?.length ?? 0}`}
            data={idwGrid}
            style={idwStyleFn}
            pane="idw-pane"
          />
        )}

        {/* ── Hotspots : entre tuiles (z400) et markers (z600) ── */}
        <Pane name="hotspot-pane" style={{ zIndex: 450 }} />
        {hotspotPolygons && (
          <GeoJSON
            key={JSON.stringify(hotspotPolygons)}
            data={hotspotPolygons}
            style={HOTSPOT_STYLE}
            pane="hotspot-pane"
          />
        )}

        {/* ── Tournée d'inspection : z470, au-dessus des hotspots, sous les markers ── */}
        <Pane name="route-pane" style={{ zIndex: 470 }} />
        {routeResult && (
          <>
            <GeoJSON
              key={`route-${routeResult.count}-${geojson?.features?.length ?? 0}`}
              data={routeResult.line}
              style={{ color: '#f39c12', weight: 4, dashArray: '8, 8', opacity: 0.9 }}
              pane="route-pane"
            />
            <CircleMarker
              center={[routeResult.start[1], routeResult.start[0]]}
              radius={10}
              pathOptions={{ color: '#e74c3c', weight: 2.5, fillColor: 'white', fillOpacity: 1 }}
              pane="route-pane"
            >
              <Popup className="tree-popup-wrapper" minWidth={140}>
                <div className="custom-popup">
                  <div className="popup-header">
                    <span className="popup-title">🚶‍♂️ Départ tournée</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', padding: '4px 0' }}>
                    {routeResult.count} arbre{routeResult.count !== 1 ? 's' : ''} sévères à inspecter
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          </>
        )}

        {renderMarkers(visibleFeatures, isCompareMode ? 'left-pane' : null, true)}
        {isCompareMode && renderMarkers(visibleCompareFeatures, 'right-pane', false)}
      </MapContainer>

      {/* ── Overlay split-screen ── */}
      {isCompareMode && (
        <>
          {currentLabel && (
            <div
              className="split-label"
              style={{ left: `${splitPos / 2}%`, transform: 'translateX(-50%)' }}
            >
              {currentLabel}
            </div>
          )}
          {compareLabel && (
            <div
              className="split-label"
              style={{ left: `${splitPos + (100 - splitPos) / 2}%`, transform: 'translateX(-50%)' }}
            >
              {compareLabel}
            </div>
          )}
          <div
            className="split-divider"
            style={{ left: `calc(${splitPos}% - 2px)` }}
            onMouseDown={e => { e.preventDefault(); isDragging.current = true }}
          >
            <div className="split-handle">⇔</div>
          </div>
        </>
      )}
    </div>
  )
}
