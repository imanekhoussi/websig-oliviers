import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, TileLayer, LayerGroup, Marker, CircleMarker, Polygon, GeoJSON, Popup, Pane, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'react-leaflet-cluster/lib/assets/MarkerCluster.css'
import 'react-leaflet-cluster/lib/assets/MarkerCluster.Default.css'
import * as turf from '@turf/turf'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import {
  LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, ReferenceDot,
} from 'recharts'
import { STRESS_COLORS, STRESS_LABELS } from '../constants'
import { fetchTreeHistory, API } from '../api'
import {
  LuThermometer, LuRuler, LuDroplet, LuFootprints,
  LuZoomIn, LuZoomOut, LuLocate,
  LuPentagon, LuSquare, LuMapPin, LuPencil, LuTrash2,
  LuTreePine, LuSatellite, LuThermometer as LuThermIcon,
  LuGrid3X3, LuCrosshair,
} from 'react-icons/lu'
import html2canvas from 'html2canvas'
import WeatherWidget from './WeatherWidget'
import { useToast } from '../hooks/useToast'
import Deck3DOverlay from './Deck3DOverlay'
import LayerDrawer, { BASEMAPS } from './LayerDrawer'
import MapFilterBar from './MapFilterBar'

const DEFAULT_CENTER = [35.76, -5.83]
const DEFAULT_ZOOM   = 7

/**
 * Outil de dessin natif Leaflet.Draw.
 * Outils actifs : Polygon, Rectangle, Polyline (mesure), Marker.
 * Circle et CircleMarker désactivés (non nécessaires).
 *
 * Pour Polygon / Rectangle :
 *   - sélection spatiale des arbres via turf.booleanPointInPolygon
 *   - calcul de surface en hectares via turf.area
 *   - notification Toast "Zone sélectionnée : X.XX ha · Y arbres"
 *
 * Pour Polyline / Marker : désélectionne uniquement (pas de zone).
 */
function DrawControl({ allFeaturesRef, setSelectedTrees, setMeasureResult }) {
  const map  = useMap()
  const toast = useToast()

  useEffect(() => {
    if (!map || !setSelectedTrees) return

    // Traductions françaises
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
      d.handlers.marker.tooltip.start   = 'Cliquez sur la carte pour placer un marqueur.'
    }

    const fg = new window.L.FeatureGroup()
    map.addLayer(fg)

    // Couleur primaire du thème pour toutes les formes dessinées
    const DRAW_COLOR   = '#2563eb'
    const shapeOptions = { color: DRAW_COLOR, weight: 2, fillOpacity: 0.12 }

    const drawControl = new window.L.Control.Draw({
      edit: { featureGroup: fg },
      draw: {
        polygon:      { shapeOptions },
        rectangle:    { shapeOptions },
        polyline:     { shapeOptions: { color: DRAW_COLOR, weight: 2 } },
        marker:       true,
        circle:       false,
        circlemarker: false,
      },
    })
    map.addControl(drawControl)

    function handleCreated(e) {
      fg.clearLayers()
      fg.addLayer(e.layer)

      // Polyline : mesure de distance
      if (e.layerType === 'polyline') {
        const coords = e.layer.getLatLngs()
        let totalM = 0
        for (let i = 0; i < coords.length - 1; i++) {
          const from = turf.point([coords[i].lng, coords[i].lat])
          const to   = turf.point([coords[i + 1].lng, coords[i + 1].lat])
          totalM += turf.distance(from, to, { units: 'meters' })
        }
        const display = totalM >= 1000
          ? `${(totalM / 1000).toFixed(3)} km`
          : `${totalM.toFixed(1)} m`
        if (setMeasureResult) setMeasureResult({ type: 'distance', value: display, n: coords.length })
        toast(`Distance mesurée : ${display}`, 'info')
        setSelectedTrees(null)
        return
      }

      // Marker : pas de traitement
      if (e.layerType === 'marker') {
        setSelectedTrees(null)
        return
      }

      const selectionPolygon = e.layer.toGeoJSON()
      const features         = allFeaturesRef.current

      // Calcul de la surface en hectares
      const areaM2 = turf.area(selectionPolygon)
      const areaHa = (areaM2 / 10000).toFixed(2)

      // Calcul du périmètre
      const perimCoords = e.layer.getLatLngs()[0] ?? []
      let perimM = 0
      for (let i = 0; i < perimCoords.length; i++) {
        const from = turf.point([perimCoords[i].lng, perimCoords[i].lat])
        const to   = turf.point([perimCoords[(i + 1) % perimCoords.length].lng, perimCoords[(i + 1) % perimCoords.length].lat])
        perimM += turf.distance(from, to, { units: 'meters' })
      }
      const areaDisplay  = Number(areaHa) >= 1 ? `${areaHa} ha` : `${areaM2.toFixed(1)} m²`
      const perimDisplay = perimM >= 1000 ? `${(perimM / 1000).toFixed(3)} km` : `${perimM.toFixed(1)} m`
      if (setMeasureResult) setMeasureResult({
        type: 'surface',
        value: areaDisplay,
        extra: `Périmètre : ${perimDisplay}`,
        n: perimCoords.length,
      })

      if (!features?.length) {
        setSelectedTrees([])
        toast(`Zone : ${areaHa} ha · 0 arbre dans les données`, 'info')
        return
      }

      const selected = features.filter(feature => {
        try {
          const center = turf.centroid(feature)
          return turf.booleanPointInPolygon(center, selectionPolygon)
        } catch {
          return false
        }
      })

      const n = selected.length
      toast(
        `Zone sélectionnée : ${areaHa} ha · ${n} arbre${n !== 1 ? 's' : ''}`,
        n > 0 ? 'success' : 'info',
      )
      setSelectedTrees(selected)
    }

    function handleDeleted() { setSelectedTrees(null) }

    function handleDrawVertex(e) {
      const latlngs = e.layers?._layers
        ? Object.values(e.layers._layers).flatMap(l => l.getLatLngs?.() ?? [])
        : []
      if (!latlngs.length) return

      const lats = latlngs.flat().map(ll => ll.lat)
      const lngs = latlngs.flat().map(ll => ll.lng)
      const minLat = Math.min(...lats), maxLat = Math.max(...lats)
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)

      const liveCount = (allFeaturesRef.current ?? []).filter(f => {
        const c = f.geometry?.coordinates
        if (!c) return false
        const [lng, lat] = Array.isArray(c[0]) ? c[0] : c
        return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng
      }).length

      const tooltip = document.querySelector('.leaflet-draw-tooltip')
      if (tooltip) {
        const existing = tooltip.querySelector('.live-count-badge')
        if (existing) {
          existing.textContent = `~${liveCount} arbres`
        } else {
          const badge = document.createElement('span')
          badge.className = 'live-count-badge'
          badge.textContent = `~${liveCount} arbres`
          badge.style.cssText = `
            display: block; margin-top: 4px;
            background: rgba(74,124,89,0.9); color: white;
            padding: 2px 8px; border-radius: 99px;
            font-size: 11px; font-weight: 700; text-align: center;
          `
          tooltip.appendChild(badge)
        }
      }
    }

    map.on(window.L.Draw.Event.CREATED, handleCreated)
    map.on(window.L.Draw.Event.DELETED, handleDeleted)
    map.on('draw:drawvertex', handleDrawVertex)

    return () => {
      map.off(window.L.Draw.Event.CREATED, handleCreated)
      map.off(window.L.Draw.Event.DELETED, handleDeleted)
      map.off('draw:drawvertex', handleDrawVertex)
      map.removeControl(drawControl)
      map.removeLayer(fg)
    }
  }, [map, setSelectedTrees]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

function reverseCoordinates(coords) {
  if (typeof coords[0] === 'number') return [coords[1], coords[0]]
  return coords.map(reverseCoordinates)
}

/** Contrôleur interne : ajuste la vue pour englober toute l'emprise des données.
 *  Suit l'ID de mission (pas la référence geojson) pour ne pas voler sur
 *  un simple changement de filtre (filteredGeojson crée un nouvel objet). */
function MapController({ geojson, flyToTree, currentId }) {
  const map         = useMap()
  const prevFlyRef  = useRef(null)  // dernier currentId pour lequel on a volé

  useEffect(() => {
    if (!geojson?.features?.length) return
    if (currentId === prevFlyRef.current) return  // même mission → filtre changé, pas de flyTo
    prevFlyRef.current = currentId
    if (flyToTree) return  // zoom arbre du catalogue a priorité sur flyToBounds
    const bbox   = turf.bbox(geojson)
    const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]]
    map.flyToBounds(bounds, { padding: [40, 40], duration: 1.5 })
  }, [currentId, geojson, map, flyToTree])

  useEffect(() => {
    if (!flyToTree) return
    map.flyTo([flyToTree.lat, flyToTree.lng], 19, { duration: 1.2 })
  }, [flyToTree, map])

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
function TreePopup({ p, color, history, yieldKg = null }) {
  const cwsiPct   = Math.min((p.cwsi || 0) * 100, 100)
  const hasHistory = Array.isArray(history) && history.length >= 2

  return (
    <Popup className="tree-popup-wrapper" minWidth={310}>
      <div className="custom-popup">

        {/* ── En-tête ── */}
        <div className="popup-header">
          <span className="popup-title">🌳 Olivier #{p.id ?? 'N/A'}</span>
          <span className="stress-badge" style={{ backgroundColor: color }}>
            {STRESS_LABELS[p.stress] ?? 'Inconnu'}
          </span>
        </div>

        {/* ── Rendement prédit (mode yield uniquement) ── */}
        {yieldKg != null && (
          <div className="yield-popup-row">
            <span>🫒 Rendement prédit</span>
            <span style={{ fontWeight: 700, color: yieldToColor(yieldKg) }}>
              {yieldKg.toFixed(1)} kg
            </span>
          </div>
        )}

        {/* ── Grille 4 colonnes ── */}
        <div className="popup-grid">
          <div className="popup-cell">
            <span className="popup-cell-icon"><LuThermometer size={16} /></span>
            <span className="popup-cell-label">Temp.</span>
            <span className="popup-cell-value">{p.temp_moy?.toFixed(1) ?? '—'}<small>°C</small></span>
          </div>
          <div className="popup-cell">
            <span className="popup-cell-icon"><LuRuler size={16} /></span>
            <span className="popup-cell-label">Hauteur</span>
            <span className="popup-cell-value">
              {p.hauteur != null ? <>{p.hauteur.toFixed(1)}<small>m</small></> : '—'}
            </span>
          </div>
          <div className="popup-cell">
            <span className="popup-cell-icon"><LuDroplet size={16} /></span>
            <span className="popup-cell-label">CWSI</span>
            <span className="popup-cell-value" style={{ color }}>{p.cwsi?.toFixed(3) ?? '—'}</span>
          </div>
          <div className="popup-cell">
            <span className="popup-cell-icon"><LuRuler size={16} /></span>
            <span className="popup-cell-label">Circonf.</span>
            <span className="popup-cell-value">
              {p.circonf != null ? <>{p.circonf.toFixed(2)}<small>m</small></> : '—'}
            </span>
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

/** Classe un score CWSI en niveau de stress et retourne la couleur associée (5 classes) */
function cwsiToStressColor(cwsi) {
  if (cwsi == null) return STRESS_COLORS.inconnu
  if (cwsi < 0.20)  return STRESS_COLORS.aucun
  if (cwsi < 0.35)  return STRESS_COLORS.faible
  if (cwsi < 0.50)  return STRESS_COLORS.modere
  if (cwsi < 0.75)  return STRESS_COLORS.eleve
  return STRESS_COLORS.severe
}

/** Traduit un rendement prédit (kg/arbre) en couleur pour le mode 'yield'. */
function yieldToColor(kg) {
  if (kg == null) return '#7e8c80'
  if (kg < 15)    return '#bf3226'
  if (kg < 25)    return '#c96e1c'
  return '#3d9960'
}

// ── Helpers pour les couches GeoJSON du mode comparaison ────────────────────
// Définis au niveau module (références stables → pas de re-render parasite).

/** Style Leaflet pour les features polygones en mode comparaison CWSI */
function cmpStressStyle(feature) {
  const color = STRESS_COLORS[feature.properties.stress] || STRESS_COLORS.inconnu
  return {
    fillColor:   color,
    fillOpacity: 0.90,
    color:       'rgba(255,255,255,0.60)',
    weight:      1.2,
    stroke:      true,
  }
}

/** pointToLayer pour les features Point dans le pane gauche (mission courante) */
function cmpPtLeft(feature, latlng) {
  const color = STRESS_COLORS[feature.properties.stress] || STRESS_COLORS.inconnu
  return L.circleMarker(latlng, {
    radius: 10, pane: 'left-pane',
    fillColor: color, fillOpacity: 0.90,
    color: 'rgba(255,255,255,0.60)', weight: 1.5,
  })
}

/** pointToLayer pour les features Point dans le pane droit (mission comparée) */
function cmpPtRight(feature, latlng) {
  const color = STRESS_COLORS[feature.properties.stress] || STRESS_COLORS.inconnu
  return L.circleMarker(latlng, {
    radius: 10, pane: 'right-pane',
    fillColor: color, fillOpacity: 0.90,
    color: 'rgba(255,255,255,0.60)', weight: 1.5,
  })
}

/** Icône de cluster personnalisée — couleur = stress le plus grave parmi les enfants */
function createClusterIcon(cluster) {
  const count   = cluster.getChildCount()
  const markers = cluster.getAllChildMarkers()

  const stressCounts = { severe: 0, eleve: 0, modere: 0, faible: 0, aucun: 0 }
  markers.forEach(m => {
    const stress = m.feature?.properties?.stress ?? m.options?.stress
    if (stress && stressCounts[stress] !== undefined) stressCounts[stress]++
  })

  const dominantColor =
    stressCounts.severe > 0 ? '#8e44ad' :
    stressCounts.eleve  > 0 ? '#e74c3c' :
    stressCounts.modere > 0 ? '#e67e22' :
    stressCounts.faible > 0 ? '#f1c40f' :
    '#2ecc71'

  const size = count > 100 ? 44 : count > 20 ? 38 : 32

  return L.divIcon({
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${dominantColor};
      border:2.5px solid rgba(255,255,255,0.9);
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:${count > 99 ? 10 : 12}px;
      font-weight:700;color:white;
      box-shadow:0 2px 8px rgba(0,0,0,0.35);
      font-family:system-ui,sans-serif;
    ">${count}</div>`,
    className: '',
    iconSize:   [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}


const SECTOR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6']

const KNOWN_STRESS_CLASSES = new Set(['aucun', 'faible', 'modere', 'eleve', 'severe'])

function vulnerabilityToColor(score) {
  if (score == null) return '#64748b'
  if (score < 20)   return '#3d9960'
  if (score < 40)   return '#a89520'
  if (score < 60)   return '#c96e1c'
  if (score < 80)   return '#bf3226'
  return '#7b3e97'
}

/** Labels lisibles pour chaque type de filtre IA */
const MAP_FILTER_LABELS = {
  stress_severe:    'Stress sévère uniquement',
  stress_critique:  'Stress élevé + sévère',
  stress_eleve:     'Stress élevé uniquement',
  stress_modere:    'Stress modéré uniquement',
  stress_faible:    'Stress faible uniquement',
  stress_aucun:     'Sans stress uniquement',
  rendement_faible: 'Rendement sous la moyenne',
}

/**
 * Retourne true si l'arbre doit être atténué (non conforme au filtre IA actif).
 * @param {object} p               - feature.properties
 * @param {object|null} mapFilter  - { action: string } | null
 * @param {object|null} yieldPred  - dict { id → rendement_kg }
 * @param {number|null} yieldAvg   - moyenne globale du rendement (pré-calculée)
 */
function isFilteredOut(p, mapFilter, yieldPred, yieldAvg) {
  if (!mapFilter || mapFilter.action === 'reset') return false
  switch (mapFilter.action) {
    case 'stress_severe':    return p.stress !== 'severe'
    case 'stress_critique':  return !['eleve', 'severe'].includes(p.stress)
    case 'stress_eleve':     return p.stress !== 'eleve'
    case 'stress_modere':    return p.stress !== 'modere'
    case 'stress_faible':    return p.stress !== 'faible'
    case 'stress_aucun':     return p.stress !== 'aucun'
    case 'rendement_faible': {
      const y = yieldPred?.[p.id]
      if (y == null) return true
      return yieldAvg != null && y >= yieldAvg
    }
    default: return false
  }
}

/** Style Leaflet pour les secteurs K-Means */
function sectorStyleFn(feature) {
  const color = SECTOR_COLORS[feature?.properties?.cluster_id] ?? '#94a3b8'
  return { color, weight: 2, dashArray: '4, 4', fillColor: color, fillOpacity: 0.2 }
}

/** Style Leaflet appliqué à chaque cellule de la grille IDW */
function idwStyleFn(feature) {
  return {
    stroke:      false,
    fillColor:   cwsiToStressColor(feature?.properties?.cwsi),
    fillOpacity: 0.45,
  }
}

/** Style Leaflet pour les hexagones — contour blanc fin, remplissage par CWSI moyen */
function hexbinStyleFn(feature) {
  return {
    color:       'rgba(255,255,255,0.35)',
    weight:      0.8,
    fillColor:   cwsiToStressColor(feature?.properties?.cwsi),
    fillOpacity: 0.60,
  }
}

/** Conversion degrés décimaux → DMS (Degrés Minutes Secondes) */
function toDMS(dd, dirs) {
  const [pos, neg] = dirs.split('/')
  const dir = dd >= 0 ? pos : neg
  const abs = Math.abs(dd)
  const deg = Math.floor(abs)
  const minFull = (abs - deg) * 60
  const min = Math.floor(minFull)
  const sec = ((minFull - min) * 60).toFixed(1)
  return `${deg}° ${min}' ${sec}" ${dir}`
}

/** Écoute le mousemove sur la carte et remonte les coordonnées */
function CursorCoords({ active, onMove }) {
  const map = useMap()
  useEffect(() => {
    if (!active) return
    function onMouseMove(e) { onMove({ lat: e.latlng.lat, lng: e.latlng.lng }) }
    map.on('mousemove', onMouseMove)
    return () => map.off('mousemove', onMouseMove)
  }, [map, active, onMove])
  return null
}

/** Grille de coordonnées (graticule) dessinée avec des Polyline Leaflet */
function Graticule({ visible }) {
  const map = useMap()
  const layerRef = useRef(null)

  useEffect(() => {
    if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }
    if (!visible) return

    function drawGraticule() {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null }

      const zoom  = map.getZoom()
      const step  = zoom >= 17 ? 0.001 : zoom >= 15 ? 0.005 : zoom >= 13 ? 0.01 : zoom >= 11 ? 0.05 : 0.1
      const decimals = step < 0.01 ? 4 : step < 0.1 ? 3 : 2

      const bounds = map.getBounds()
      const minLat = Math.floor(bounds.getSouth() / step) * step
      const maxLat = Math.ceil(bounds.getNorth()  / step) * step
      const minLng = Math.floor(bounds.getWest()  / step) * step
      const maxLng = Math.ceil(bounds.getEast()   / step) * step

      const layers = []
      const lineStyle = { color: 'rgba(148,163,184,0.35)', weight: 0.8, dashArray: '3 6', interactive: false }

      for (let lat = minLat; lat <= maxLat + step * 0.1; lat = +(lat + step).toFixed(6)) {
        layers.push(L.polyline([[lat, minLng], [lat, maxLng]], lineStyle))
        layers.push(L.marker([lat, minLng + (maxLng - minLng) * 0.02], {
          icon: L.divIcon({
            html: `<span class="graticule-label">${lat.toFixed(decimals)}°N</span>`,
            className: '', iconAnchor: [0, 8],
          }),
          interactive: false,
        }))
      }
      for (let lng = minLng; lng <= maxLng + step * 0.1; lng = +(lng + step).toFixed(6)) {
        layers.push(L.polyline([[minLat, lng], [maxLat, lng]], lineStyle))
      }

      layerRef.current = L.layerGroup(layers).addTo(map)
    }

    drawGraticule()
    map.on('moveend zoomend', drawGraticule)
    return () => {
      map.off('moveend zoomend', drawGraticule)
      if (layerRef.current) map.removeLayer(layerRef.current)
    }
  }, [map, visible])

  return null
}

/**
 * Toolbar de dessin personnalisée — remplace visuellement les contrôles leaflet-draw.
 * Les boutons déclenchent programmatiquement les handlers cachés de leaflet-draw.
 */
function MapDrawToolbar({ mapRef, geojson, showCoords, setShowCoords, showGraticule, setShowGraticule }) {
  const [activeTool, setActiveTool] = useState(null)

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onStop    = () => setActiveTool(null)
    const onEditSt  = () => setActiveTool('edit')
    const onDelSt   = () => setActiveTool('delete')
    map.on('draw:drawstop',    onStop)
    map.on('draw:editstart',   onEditSt)
    map.on('draw:editstop',    onStop)
    map.on('draw:deletestart', onDelSt)
    map.on('draw:deletestop',  onStop)
    return () => {
      map.off('draw:drawstop',    onStop)
      map.off('draw:editstart',   onEditSt)
      map.off('draw:editstop',    onStop)
      map.off('draw:deletestart', onDelSt)
      map.off('draw:deletestop',  onStop)
    }
  }, [mapRef])

  function trigger(cssClass, toolId) {
    const btn = document.querySelector(`.${cssClass}`)
    if (!btn) return
    setActiveTool(prev => (prev === toolId ? null : toolId))
    btn.click()
  }

  function recenter() {
    if (!geojson?.features?.length || !mapRef.current) return
    const bbox = turf.bbox(geojson)
    mapRef.current.flyToBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [40, 40], duration: 1 })
  }

  const T = ({ icon, title, cls, toolId }) => (
    <button
      className={`mdt-btn${activeTool === toolId ? ' tool-active' : ''}`}
      title={title}
      onClick={() => toolId ? trigger(cls, toolId) : undefined}
    >
      {icon}
    </button>
  )

  return (
    <div className="mdt-toolbar">
      {/* Navigation */}
      <div className="mdt-group">
        <button className="mdt-btn" title="Zoom avant"               onClick={() => mapRef.current?.zoomIn()}><LuZoomIn  size={14} /></button>
        <button className="mdt-btn" title="Zoom arrière"             onClick={() => mapRef.current?.zoomOut()}><LuZoomOut size={14} /></button>
        <button className="mdt-btn" title="Recentrer sur la parcelle" onClick={recenter}><LuLocate size={14} /></button>
      </div>

      <div className="mdt-divider" />

      {/* Dessin / Sélection */}
      <div className="mdt-group">
        <T icon={<LuPentagon size={14} />} title="Polygone libre"   cls="leaflet-draw-draw-polygon"   toolId="polygon"   />
        <T icon={<LuSquare   size={14} />} title="Rectangle"        cls="leaflet-draw-draw-rectangle"  toolId="rectangle" />
        <T icon={<LuMapPin   size={14} />} title="Point / Marqueur" cls="leaflet-draw-draw-marker"     toolId="marker"    />
      </div>

      <div className="mdt-divider" />

      {/* Édition */}
      <div className="mdt-group">
        <T icon={<LuPencil size={14} />} title="Éditer la sélection"    cls="leaflet-draw-edit-edit"   toolId="edit"   />
        <T icon={<LuTrash2 size={14} />} title="Supprimer la sélection" cls="leaflet-draw-edit-remove" toolId="delete" />
      </div>

      <div className="mdt-divider" />

      {/* Outils SIG */}
      <div className="mdt-group">
        <T icon={<LuRuler    size={14} />} title="Mesure distance"  cls="leaflet-draw-draw-polyline" toolId="polyline"       />
        <T icon={<LuPentagon size={14} />} title="Mesure surface"   cls="leaflet-draw-draw-polygon"  toolId="polygon-measure"/>
        <button
          className={`mdt-btn${showCoords ? ' active' : ''}`}
          title="Coordonnées curseur"
          onClick={() => setShowCoords(v => !v)}
        >
          <LuCrosshair size={14} />
        </button>
        <button
          className={`mdt-btn${showGraticule ? ' active' : ''}`}
          title="Grille de coordonnées"
          onClick={() => setShowGraticule(v => !v)}
        >
          <LuGrid3X3 size={14} />
        </button>
      </div>
    </div>
  )
}


const TreeMap = React.memo(function TreeMap({
  geojson,
  activeStress = ['aucun', 'faible', 'modere', 'eleve', 'severe'],
  isCompareMode = false,
  geojsonCompare,
  currentLabel = '',
  compareLabel = '',
  currentId = null,
  currentMission = null,
  compareMission = null,
  showHotspots = false,
  setSelectedTrees = null,
  selectedTrees = null,
  showIDW = false,
  showRoute     = false,
  routeTarget   = 'severe_eleve',
  routeMaxTrees = 50,
  showMCDA = false,
  mcdaScores = {},
  showSectors = false,
  showHexbins = false,
  hotspotRadius = 15,
  idwResolution = 10,
  sectorCount   = 3,
  sectorAngle   = 0,
  // ── filtres cross-critères ──────────────────────────
  dataRanges    = { hauteur: [0, 20], temp: [0, 60], cwsi: [0, 1] },
  filterHauteur = null,
  filterCwsi    = null,
  filterCirc    = null,
  onHauteurChange = () => {},
  onCwsiChange    = () => {},
  onCircChange    = () => {},
  onFilterReset   = () => {},
  totalCount    = 0,
  // ── anomalies ───────────────────────────────────────
  showAnomalies    = false,
  anomalyData      = null,
  anomalyLoading   = false,
  onToggleAnomalies = () => {},
  // ── mode rendement IA ────────────────────────────────
  mapMode          = 'stress',
  yieldPredictions = null,
  // ── filtre IA carte ──────────────────────────────────
  mapFilter        = null,
  onMapFilterReset = () => {},
  // ── zoom depuis le catalogue ─────────────────────────
  flyToTree        = null,
}) {
  const compareId = compareMission?.id ?? null

  // Injecte les keyframes CSS de l'animation pulse une seule fois au montage.
  useEffect(() => {
    const id = '__anomaly-pulse-style__'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = `
        @keyframes anomaly-pulse-anim {
          0%   { transform: translate(-50%,-50%) scale(0.4); opacity: 0.9; }
          100% { transform: translate(-50%,-50%) scale(2.6); opacity: 0; }
        }
        .anomaly-pin { position: relative; width: 24px; height: 24px; }
        .anomaly-pulse-ring {
          width: 24px; height: 24px; border-radius: 50%;
          background: rgba(231,76,60,0.45);
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%,-50%);
          animation: anomaly-pulse-anim 1.6s ease-out infinite;
          pointer-events: none;
        }
        .anomaly-dot {
          width: 12px; height: 12px; background: #bf3226;
          border-radius: 50%; border: 2px solid white;
          box-shadow: 0 0 6px rgba(191,50,38,0.55);
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%,-50%);
        }
      `
      document.head.appendChild(style)
    }
  }, [])

  const anomalyIcon = useMemo(() => L.divIcon({
    className: '',
    html: '<div class="anomaly-pin"><div class="anomaly-pulse-ring"></div><div class="anomaly-dot"></div></div>',
    iconSize:   [24, 24],
    iconAnchor: [12, 12],
  }), [])

  const depotIcon = useMemo(() => L.divIcon({
    className: '',
    html: `<div style="
      width:30px;height:30px;border-radius:50%;
      background:#e67e22;border:3px solid rgba(255,255,255,0.9);
      box-shadow:0 2px 10px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
      font-size:15px;cursor:grab;
    ">🏠</div>`,
    iconSize:   [30, 30],
    iconAnchor: [15, 15],
  }), [])

  // Cache de l'historique : { [treeId]: data[] }
  const historyCache = useRef({})
  const [historyTick, setHistoryTick] = useState(0)

  // Split screen — ref seulement, pas de state, zéro re-render pendant le glissement
  const splitPosRef = useRef(50)
  const isDragging  = useRef(false)
  const wrapperRef  = useRef(null)
  const mapRef         = useRef(null)   // instance Leaflet Map
  const allFeaturesRef = useRef(geojson?.features ?? [])
  const [capturing, setCapturing] = useState(false)
  const [selectedTreeId, setSelectedTreeId] = useState(null)
  const [parcelInfoOpen, setParcelInfoOpen] = useState(false)

  // ── Web Worker — géotraitements asynchrones (IDW, K-Means, TSP) ───────────
  // Le worker tourne dans un thread V8 séparé : aucun blocage du Main Thread.
  const workerRef    = useRef(null)
  // Compteurs de requêtes par type — permet de rejeter les résultats obsolètes.
  const latestReqId  = useRef({ IDW: 0, KMEANS: 0, TSP: 0, HEXBIN: 0 })

  // Résultats géospatiaux issus du worker (remplacent les anciens useMemo)
  const [idwGrid,        setIdwGrid]        = useState(null)
  const [routeResult,    setRouteResult]    = useState(null)
  const [routeStart,     setRouteStart]     = useState(null)   // [lng, lat] dépôt
  const [sectorPolygons, setSectorPolygons] = useState(null)
  const [hexbinGrid,     setHexbinGrid]     = useState(null)
  // Ensemble des calculs en cours — alimente l'overlay "Calcul spatial en cours…"
  const [pendingCalcs, setPendingCalcs]   = useState(new Set())

  // ── Vue 3D Deck.gl ────────────────────────────────────────────────────────
  const [show3D,            setShow3D]            = useState(false)
  const [deck3DInitialState, setDeck3DInitialState] = useState(null)

  // ── Outils SIG ────────────────────────────────────────────────────────────
  const [showCoords,    setShowCoords]    = useState(false)
  const [showGraticule, setShowGraticule] = useState(false)
  const [cursorCoords,  setCursorCoords]  = useState(null)
  const [measureResult, setMeasureResult] = useState(null)

  // ── Gestion des couches (LayerDrawer) ─────────────────────────────────────
  const [activeBasemap,    setActiveBasemap]    = useState('satellite')
  const [activeOverlays,   setActiveOverlays]   = useState(['polygones'])
  const [overlayOpacities, setOverlayOpacities] = useState({ rgb: 1, thermal: 1 })

  // ── Mode comparaison : vue par défaut = stress coloré (pas l'orthophoto brute) ──
  const [compareView, setCompareView] = useState('stress') // 'stress' | 'ortho'

  function toggleOverlay(id) {
    setActiveOverlays(prev =>
      prev.includes(id) ? prev.filter(o => o !== id) : [...prev, id]
    )
  }
  function setOpacity(id, val) {
    setOverlayOpacities(prev => ({ ...prev, [id]: val }))
  }

  function handle3DToggle() {
    if (show3D) { setShow3D(false); return }
    const center = mapRef.current?.getCenter()
    setDeck3DInitialState({
      longitude: center?.lng ?? DEFAULT_CENTER[1],
      latitude:  center?.lat ?? DEFAULT_CENTER[0],
      zoom:      mapRef.current?.getZoom() ?? 15,
    })
    setShow3D(true)
  }

  // Sync allFeaturesRef avec geojson pour que DrawControl ait toujours les données fraîches
  useEffect(() => {
    allFeaturesRef.current = geojson?.features ?? []
  }, [geojson])

  async function captureMap() {
    if (capturing) return
    setCapturing(true)
    try {
      await new Promise(r => setTimeout(r, 600))
      const element = wrapperRef.current
      if (!element) return
      const canvas = await html2canvas(element, {
        useCORS:         true,
        allowTaint:      false,
        backgroundColor: '#0f172a',
        scale:            2,
        logging:          false,
        ignoreElements: (el) =>
          el.classList?.contains('mdt-toolbar') ||
          el.classList?.contains('map-toggle-group') ||
          el.classList?.contains('map-top-right-group') ||
          el.classList?.contains('sig-measure-result') ||
          el.classList?.contains('sig-coords-display') ||
          el.classList?.contains('sig-parcel-info') ||
          el.classList?.contains('leaflet-control-container'),
      })
      const timestamp = new Date().toISOString().slice(0, 10)
      const filename  = `GeoOlive_carte_${timestamp}.png`
      const link = document.createElement('a')
      link.download = filename
      link.href     = canvas.toDataURL('image/png', 1.0)
      link.click()
    } catch (err) {
      console.warn('[captureMap] Erreur :', err)
    } finally {
      setCapturing(false)
    }
  }

  // Initialise le worker une fois au montage ; le termine au démontage.
  useEffect(() => {
    const w = new Worker(
      new URL('../workers/geoWorker.js', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = w
    console.log('[Worker Debug] Worker initialisé:', w)

    w.onmessage = ({ data: { type, result, reqId } }) => {
      console.log('[Worker Debug] Message reçu:', type, '| reqId:', reqId, '| latest TSP:', latestReqId.current.TSP)
      if (type === 'IDW_RESULT' && reqId === latestReqId.current.IDW) {
        setIdwGrid(result)
        setPendingCalcs(s => { const n = new Set(s); n.delete('IDW'); return n })
      } else if (type === 'KMEANS_RESULT' && reqId === latestReqId.current.KMEANS) {
        setSectorPolygons(result)
        setPendingCalcs(s => { const n = new Set(s); n.delete('KMEANS'); return n })
      } else if (type === 'TSP_RESULT' && reqId === latestReqId.current.TSP) {
        console.log('[TSP Debug] Résultat reçu du worker:', result)
        setRouteResult({ ...result, _reqId: reqId })
        setPendingCalcs(s => { const n = new Set(s); n.delete('TSP'); return n })
      } else if (type === 'HEXBIN_RESULT' && reqId === latestReqId.current.HEXBIN) {
        setHexbinGrid(result)
        setPendingCalcs(s => { const n = new Set(s); n.delete('HEXBIN'); return n })
      }
      // Les résultats avec un reqId inférieur au dernier connu sont silencieusement ignorés.
    }

    w.onerror = (err) => console.error('[Worker Debug] ERREUR dans le worker:', err.message, err)

    return () => w.terminate()
  }, [])

  // Déclenche le calcul IDW dans le worker quand showIDW ou les données changent.
  useEffect(() => {
    if (!showIDW || !geojson?.features?.length) {
      latestReqId.current.IDW++          // invalide tout résultat en vol
      setIdwGrid(null)
      setPendingCalcs(s => { const n = new Set(s); n.delete('IDW'); return n })
      return
    }
    const reqId = ++latestReqId.current.IDW
    setPendingCalcs(s => new Set(s).add('IDW'))
    workerRef.current?.postMessage({ type: 'IDW', payload: { geojson, idwResolution }, reqId })
  }, [showIDW, geojson, idwResolution])

  // Déclenche le calcul K-Means dans le worker.
  useEffect(() => {
    if (!showSectors || !geojson?.features?.length) {
      latestReqId.current.KMEANS++
      setSectorPolygons(null)
      setPendingCalcs(s => { const n = new Set(s); n.delete('KMEANS'); return n })
      return
    }
    const reqId = ++latestReqId.current.KMEANS
    setPendingCalcs(s => new Set(s).add('KMEANS'))
    workerRef.current?.postMessage({ type: 'KMEANS', payload: { geojson, activeStress, sectorCount, sectorAngle }, reqId })
  }, [showSectors, geojson, activeStress, sectorCount, sectorAngle])

  // Déclenche le calcul hexbin dans le worker.
  useEffect(() => {
    if (!showHexbins || !geojson?.features?.length) {
      latestReqId.current.HEXBIN++
      setHexbinGrid(null)
      setPendingCalcs(s => { const n = new Set(s); n.delete('HEXBIN'); return n })
      return
    }
    const reqId = ++latestReqId.current.HEXBIN
    setPendingCalcs(s => new Set(s).add('HEXBIN'))
    workerRef.current?.postMessage({ type: 'HEXBIN', payload: { geojson }, reqId })
  }, [showHexbins, geojson])

  // Initialise / réinitialise le point de départ (dépôt) au centre de la parcelle.
  useEffect(() => {
    if (!showRoute) { setRouteStart(null); return }
    if (!geojson?.features?.length) return
    setRouteStart(prev => {
      if (prev) return prev   // conserver le dépôt si l'utilisateur l'a déjà déplacé
      const bbox = turf.bbox(geojson)
      return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2]
    })
  }, [showRoute, geojson])

  // Déclenche le calcul VRP (Manhattan NN) dans le worker.
  useEffect(() => {
    if (!showRoute || !geojson?.features?.length || !routeStart) {
      latestReqId.current.TSP++
      setRouteResult(null)
      setPendingCalcs(s => { const n = new Set(s); n.delete('TSP'); return n })
      return
    }

    // Filtre les features selon la cible choisie
    let targetFeatures
    if (routeTarget === 'severe') {
      targetFeatures = geojson.features.filter(f => f.properties.stress === 'severe')
    } else if (routeTarget === 'severe_eleve') {
      targetFeatures = geojson.features.filter(f => ['severe', 'eleve'].includes(f.properties.stress))
    } else {
      targetFeatures = geojson.features   // 'all' — déjà filtré en amont par App.jsx
    }

    if (targetFeatures.length === 0) { setRouteResult(null); return }

    const reqId = ++latestReqId.current.TSP
    setPendingCalcs(s => new Set(s).add('TSP'))
    console.log('[TSP Debug] Envoi au worker:', {
      targetFeaturesCount: targetFeatures.length,
      routeStart,
      routeMaxTrees,
      routeTarget,
      reqId,
    })
    workerRef.current?.postMessage({
      type: 'TSP',
      payload: {
        geojson:  { ...geojson, features: targetFeatures },
        startPos: routeStart,
        maxTrees: routeMaxTrees,
      },
      reqId,
    })
  }, [showRoute, geojson, routeTarget, routeMaxTrees, routeStart])

  const fetchHistory = useCallback((treeId) => {
    if (treeId == null || historyCache.current[treeId]) return
    fetchTreeHistory(treeId)
      .then(data => {
        historyCache.current[treeId] = data
        setHistoryTick(n => n + 1)
      })
      .catch(() => {
        historyCache.current[treeId] = []
      })
  }, [])

  // Réinitialise la vue comparaison en mode stress dès qu'on sort du mode comparaison
  useEffect(() => {
    if (!isCompareMode) setCompareView('stress')
  }, [isCompareMode])

  // Désélectionne l'arbre courant à chaque changement de mission
  useEffect(() => {
    setSelectedTreeId(null)
  }, [currentId])

  // Initialise le clip-path à 50 % dès l'activation du mode comparaison.
  // setTimeout(0) garantit que les <Pane> enfants ont fini leur montage.
  useEffect(() => {
    if (!isCompareMode) {
      splitPosRef.current = 50
      return
    }
    const timer = setTimeout(() => {
      const pct       = splitPosRef.current
      const leftPane  = mapRef.current?.getPane('left-pane')
      const rightPane = mapRef.current?.getPane('right-pane')
      if (leftPane) {
        leftPane.style.clipPath  = `inset(0 ${100 - pct}% 0 0)`
        leftPane.style.transform = 'translateZ(0)'   // GPU compositing → élimine coutures de tuiles
      }
      if (rightPane) {
        rightPane.style.clipPath = `inset(0 0 0 ${pct}%)`
        rightPane.style.transform = 'translateZ(0)'
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [isCompareMode])

  // Glisser-déposer du séparateur — manipulation DOM directe, 0 setState → 60 fps
  useEffect(() => {
    function applySplit(clientX) {
      if (!isDragging.current || !wrapperRef.current) return
      const rect = wrapperRef.current.getBoundingClientRect()
      const pct  = Math.min(Math.max((clientX - rect.left) / rect.width * 100, 10), 90)
      splitPosRef.current = pct

      // Panes Leaflet — clip-path direct
      const leftPane  = mapRef.current?.getPane('left-pane')
      const rightPane = mapRef.current?.getPane('right-pane')
      if (leftPane)  leftPane.style.clipPath  = `inset(0 ${100 - pct}% 0 0)`
      if (rightPane) rightPane.style.clipPath = `inset(0 0 0 ${pct}%)`

      // Éléments UI — style direct
      const divider = document.getElementById('split-divider')
      if (divider) divider.style.left = `calc(${pct}% - 2px)`
      const labelLeft  = document.getElementById('split-label-left')
      const labelRight = document.getElementById('split-label-right')
      if (labelLeft)  labelLeft.style.left  = `${pct / 2}%`
      if (labelRight) labelRight.style.left = `${pct + (100 - pct) / 2}%`
    }
    function onMouseMove(e)  { applySplit(e.clientX) }
    function onTouchMove(e)  { if (e.touches[0]) applySplit(e.touches[0].clientX) }
    function onMouseUp()     { isDragging.current = false }
    function onTouchEnd()    { isDragging.current = false }

    window.addEventListener('mousemove',  onMouseMove)
    window.addEventListener('mouseup',    onMouseUp)
    window.addEventListener('touchmove',  onTouchMove, { passive: true })
    window.addEventListener('touchend',   onTouchEnd)
    return () => {
      window.removeEventListener('mousemove',  onMouseMove)
      window.removeEventListener('mouseup',    onMouseUp)
      window.removeEventListener('touchmove',  onTouchMove)
      window.removeEventListener('touchend',   onTouchEnd)
    }
  }, [])

  // ── Calcul des hotspots (buffer + union des arbres critiques) ──
  // Reste en useMemo car c'est un calcul léger (pas de clustering, pas d'IDW).
  const hotspotPolygons = useMemo(() => {
    if (!showHotspots || !geojson?.features?.length) return null

    const critical = geojson.features.filter(
      f => ['eleve', 'severe'].includes(f.properties.stress)
    )
    if (!critical.length) return null

    const fc       = turf.featureCollection(critical)
    const buffered = turf.buffer(fc, hotspotRadius, { units: 'meters' })
    if (!buffered?.features?.length) return null

    const merged = buffered.features.reduce((acc, feat) =>
      acc ? turf.union(turf.featureCollection([acc, feat])) : feat
    , null)

    return merged ? turf.featureCollection([merged]) : null
  }, [showHotspots, geojson, hotspotRadius])

  // Set des IDs sélectionnés pour lookup O(1)
  const selectedIds = useMemo(
    () => new Set((selectedTrees ?? []).map(f => f.properties.id)),
    [selectedTrees]
  )
  const hasSelection = selectedTrees !== null

  // Moyenne du rendement prédit — seuil pour le filtre 'rendement_faible'
  const yieldAvg = useMemo(() => {
    if (!yieldPredictions) return null
    const vals = Object.values(yieldPredictions).filter(v => v != null && !isNaN(v))
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }, [yieldPredictions])

  const KNOWN_CLASSES = new Set(['aucun', 'faible', 'modere', 'eleve', 'severe'])
  const visibleFeatures = useMemo(() => {
    if (!geojson?.features) return []
    return geojson.features.filter(f => {
      const s = f.properties?.stress
      if (!s || !KNOWN_CLASSES.has(s)) return true
      return activeStress.includes(s)
    })
  }, [geojson, activeStress])
  const visibleCompareFeatures = useMemo(() => {
    if (!geojsonCompare?.features) return []
    return geojsonCompare.features.filter(f => {
      const s = f.properties?.stress
      if (!s || !KNOWN_CLASSES.has(s)) return true
      return activeStress.includes(s)
    })
  }, [geojsonCompare, activeStress])

  // Plage de circonférence estimée (cm) dérivée de la plage de hauteur
  const circRange = useMemo(() => {
    const [hMin, hMax] = dataRanges.hauteur
    return [
      Math.floor(Math.PI * hMin * 0.6 * 100),
      Math.ceil(Math.PI  * hMax * 0.6 * 100),
    ]
  }, [dataRanges.hauteur])

  // Info statique de la parcelle courante (centroïde, surface convexe, nombre d'arbres)
  const parcelInfo = useMemo(() => {
    if (!geojson?.features?.length) return null
    try {
      const fc       = turf.featureCollection(geojson.features)
      const centroid = turf.centroid(fc)
      const hull     = turf.convex(fc)
      const surface  = hull ? (turf.area(hull) / 10000).toFixed(2) : '—'
      const [lng, lat] = centroid.geometry.coordinates
      return { lat: lat.toFixed(5), lng: lng.toFixed(5), surface, n: geojson.features.length }
    } catch { return null }
  }, [geojson])

  function vulnerabilityToColor(score) {
    if (score == null) return '#64748b'
    if (score < 20)   return '#3d9960'
    if (score < 40)   return '#a89520'
    if (score < 60)   return '#c96e1c'
    if (score < 80)   return '#bf3226'
    return '#7b3e97'
  }

  const renderedMarkers = useMemo(() => {
    if (isCompareMode) return null
    const features = (geojson?.features ?? []).filter(f => {
      const s = f.properties?.stress
      if (!s || !KNOWN_CLASSES.has(s)) return true
      return activeStress.includes(s)
    })
    return features.map((feat, index) => {
      if (!feat.geometry?.coordinates) return null

      const p       = feat.properties
      const yieldKg = mapMode === 'yield' ? (yieldPredictions?.[p.id] ?? null) : null
      const color   = mapMode === 'yield'
        ? yieldToColor(yieldKg)
        : showMCDA && mcdaScores[p.id] != null
          ? vulnerabilityToColor(mcdaScores[p.id])
          : STRESS_COLORS[p.stress] || STRESS_COLORS.inconnu
      const key     = `markerPane-${p.id != null ? p.id : index}`
      const history = historyCache.current[p.id]

      const aiDimmed = isFilteredOut(p, mapFilter, yieldPredictions, yieldAvg)
      const dimmed   = aiDimmed || (hasSelection && !selectedIds.has(p.id))
      const fillO    = dimmed ? 0.10 : 0.92
      const strokeO  = dimmed ? 0.08 : 1

      if (feat.geometry.type === 'Point') {
        const isSelected = p.id === selectedTreeId
        return (
          <CircleMarker
            key={key}
            center={[feat.geometry.coordinates[1], feat.geometry.coordinates[0]]}
            radius={isSelected ? 14 : 8}
            pathOptions={{
              color:       isSelected ? '#ffffff' : (dimmed ? 'rgba(255,255,255,0.15)' : '#1e293b'),
              weight:      isSelected ? 3 : 1.5,
              fillColor:   color,
              fillOpacity: fillO,
              opacity:     strokeO,
            }}
            pane="markerPane"
            eventHandlers={{
              click: () => {
                fetchHistory(p.id)
                setSelectedTreeId(prev => prev === p.id ? null : p.id)
              },
              mouseover: e => {
                if (dimmed) return
                e.target.setRadius(isSelected ? 14 : 13)
                e.target.setStyle({ weight: 2.5 })
              },
              mouseout: e => {
                if (dimmed) return
                e.target.setRadius(isSelected ? 14 : 8)
                e.target.setStyle({ weight: isSelected ? 3 : 1.5 })
              },
            }}
          >
            <TreePopup p={p} color={color} history={history} yieldKg={yieldKg} />
          </CircleMarker>
        )
      }

      if (feat.geometry.type === 'Polygon' || feat.geometry.type === 'MultiPolygon') {
        return (
          <Polygon
            key={key}
            positions={reverseCoordinates(feat.geometry.coordinates)}
            pathOptions={{
              stroke:      !dimmed,
              color:       '#1e293b',
              weight:      0.8,
              fillColor:   color,
              fillOpacity: dimmed ? 0.08 : 0.90,
            }}
            pane="markerPane"
            eventHandlers={{
              click: () => fetchHistory(p.id),
            }}
          >
            <TreePopup p={p} color={color} history={history} yieldKg={yieldKg} />
          </Polygon>
        )
      }

      return null
    })
  }, [
    isCompareMode,
    geojson,
    activeStress,
    mapMode,
    yieldPredictions,
    showMCDA,
    mcdaScores,
    mapFilter,
    yieldAvg,
    selectedIds,
    hasSelection,
    historyTick,
    selectedTreeId,
  ])

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <MapContainer
        ref={mapRef}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        maxZoom={24}
        zoomControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <MapController geojson={geojson} flyToTree={flyToTree} currentId={currentId} />
        <DrawControl allFeaturesRef={allFeaturesRef} setSelectedTrees={setSelectedTrees} setMeasureResult={setMeasureResult} />
        <CursorCoords active={showCoords} onMove={setCursorCoords} />
        <Graticule visible={showGraticule} />


        {isCompareMode && (
          <>
            <Pane name="left-pane"  style={{ zIndex: 401 }} />
            <Pane name="right-pane" style={{ zIndex: 402 }} />
          </>
        )}

        {/* ── Fond de carte actif ── */}
        <TileLayer
          key={activeBasemap}
          url={BASEMAPS[activeBasemap].url}
          maxZoom={24}
          maxNativeZoom={BASEMAPS[activeBasemap].maxNativeZoom}
          attribution={BASEMAPS[activeBasemap].attribution}
        />

        {/* ── Orthomosaïque RGB — mission courante ──
            En mode comparaison : seulement si vue 'ortho' sélectionnée */}
        {currentId && currentMission?.ortho_formats?.rgb === 'zip' && activeOverlays.includes('rgb') &&
         (!isCompareMode || compareView === 'ortho') && (
          <TileLayer
            url={`${API}/tiles/${currentId}/rgb_tiles/{z}/{x}/{y}.png`}
            maxZoom={24} maxNativeZoom={20} opacity={overlayOpacities.rgb ?? 1}
            pane={isCompareMode ? 'left-pane' : 'overlayPane'}
          />
        )}

        {/* ── Orthomosaïque Thermique — mission courante ── */}
        {currentId && currentMission?.has_thermal_zip && activeOverlays.includes('thermal') &&
         (!isCompareMode || compareView === 'ortho') && (
          <TileLayer
            url={`${API}/tiles/${currentId}/thermal/{z}/{x}/{y}.png`}
            maxZoom={24} maxNativeZoom={20} opacity={overlayOpacities.thermal ?? 1}
            pane={isCompareMode ? 'left-pane' : 'overlayPane'}
          />
        )}

        {/* ── Orthomosaïques mission comparée — seulement en vue 'ortho' ── */}
        {isCompareMode && compareView === 'ortho' && compareId && compareMission?.ortho_formats?.rgb === 'zip' && (
          <TileLayer
            url={`${API}/tiles/${compareId}/rgb_tiles/{z}/{x}/{y}.png`}
            maxZoom={24} maxNativeZoom={20} pane="right-pane"
          />
        )}
        {isCompareMode && compareView === 'ortho' && compareId && compareMission?.has_thermal_zip && (
          <TileLayer
            url={`${API}/tiles/${compareId}/thermal/{z}/{x}/{y}.png`}
            maxZoom={24} maxNativeZoom={20} opacity={1} pane="right-pane"
          />
        )}

        {/* ── Polygones oliviers — mode NORMAL ── */}
        {!isCompareMode && geojson && activeOverlays.includes('polygones') && (
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={40}
            disableClusteringAtZoom={17}
            spiderfyOnMaxZoom={true}
            iconCreateFunction={createClusterIcon}
          >
            {renderedMarkers}
          </MarkerClusterGroup>
        )}

        {/* ── Comparaison — vue Stress CWSI ──
            Utilise <GeoJSON> natif plutôt qu'une liste de <CircleMarker>/<Polygon>.
            L.GeoJSON propage l'option `pane` à tous ses sous-layers (polygones ET points),
            garantissant leur placement dans le bon pane Leaflet dès la création. */}
        {isCompareMode && compareView === 'stress' && geojson && (
          <GeoJSON
            key={`cmp-l-${currentId}-${visibleFeatures.length}-${activeStress.length}`}
            data={{ type: 'FeatureCollection', features: visibleFeatures }}
            style={cmpStressStyle}
            pointToLayer={cmpPtLeft}
            pane="left-pane"
          />
        )}
        {isCompareMode && compareView === 'stress' && geojsonCompare && (
          <GeoJSON
            key={`cmp-r-${compareId}-${visibleCompareFeatures.length}-${activeStress.length}`}
            data={{ type: 'FeatureCollection', features: visibleCompareFeatures }}
            style={cmpStressStyle}
            pointToLayer={cmpPtRight}
            pane="right-pane"
          />
        )}

        {/* ── Hexbin : z405, entre ortho et secteurs ── */}
        <Pane name="hexbin-pane" style={{ zIndex: 405 }} />
        {hexbinGrid && (
          <GeoJSON
            key={`hexbin-${hexbinGrid.features.length}-${geojson?.features?.length ?? 0}`}
            data={hexbinGrid}
            style={hexbinStyleFn}
            pane="hexbin-pane"
          />
        )}

        {/* ── Secteurs K-Means : z410, au-dessus de l'ortho (z400), sous IDW (z420) ── */}
        <Pane name="sectors-pane" style={{ zIndex: 410 }} />
        {sectorPolygons && (
          <GeoJSON
            key={`sectors-${sectorPolygons.features.length}-${geojson?.features?.length ?? 0}-${activeStress.join('')}`}
            data={sectorPolygons}
            style={sectorStyleFn}
            pane="sectors-pane"
          />
        )}

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
        {routeResult && console.log('[Render Debug] Rendu route — geometry.type:', routeResult.line?.geometry?.type, '| coords sample:', routeResult.line?.geometry?.coordinates?.[0])}
        {routeResult && (
          <GeoJSON
            key={`route-${routeResult._reqId}`}
            data={routeResult.line}
            style={{ color: '#ff4d4d', weight: 6, opacity: 1, dashArray: '12, 10', lineCap: 'round' }}
            pane="route-pane"
          />
        )}

        {/* ── Dépôt déplaçable (point de départ tournée) ── */}
        {showRoute && routeStart && (
          <Marker
            position={[routeStart[1], routeStart[0]]}
            draggable={true}
            icon={depotIcon}
            eventHandlers={{
              dragend: (e) => {
                const ll = e.target.getLatLng()
                setRouteStart([ll.lng, ll.lat])
              },
            }}
          >
            <Popup className="tree-popup-wrapper" minWidth={170}>
              <div className="custom-popup">
                <div className="popup-header">
                  <span className="popup-title">🏠 Dépôt de départ</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px 0' }}>
                  Faites glisser pour repositionner
                  {routeResult && (
                    <><br />{routeResult.count} arbre{routeResult.count !== 1 ? 's' : ''} dans la tournée</>
                  )}
                </div>
              </div>
            </Popup>
          </Marker>
        )}

        {/* ── Anomalies : z650, au-dessus de tous les markers (z600) ── */}
        <Pane name="anomaly-pane" style={{ zIndex: 650 }} />
        {showAnomalies && anomalyData?.anomalies?.length > 0 && (
          <LayerGroup pane="anomaly-pane">
            {anomalyData.anomalies.map(a => (
              <Marker
                key={`anomaly-${a.id}`}
                position={[a.lat, a.lon]}
                icon={anomalyIcon}
                pane="anomaly-pane"
              >
                <Popup className="tree-popup-wrapper" minWidth={210}>
                  <div className="custom-popup">
                    <div className="popup-header">
                      <span className="popup-title">⚠ Anomalie #{a.id}</span>
                      <span className="stress-badge" style={{ backgroundColor: STRESS_COLORS[a.stress] ?? '#7e8c80' }}>
                        {STRESS_LABELS[a.stress] ?? a.stress}
                      </span>
                    </div>
                    <div className="popup-grid">
                      <div className="popup-cell">
                        <span className="popup-cell-icon"><LuDroplet size={16} /></span>
                        <span className="popup-cell-label">CWSI</span>
                        <span className="popup-cell-value" style={{ color: '#bf3226' }}>
                          {a.cwsi.toFixed(3)}
                        </span>
                      </div>
                      <div className="popup-cell">
                        <span className="popup-cell-icon"><LuThermometer size={16} /></span>
                        <span className="popup-cell-label">Temp.</span>
                        <span className="popup-cell-value">
                          {a.temp_moy.toFixed(1)}<small>°C</small>
                        </span>
                      </div>
                      <div className="popup-cell">
                        <span className="popup-cell-icon"><LuRuler size={16} /></span>
                        <span className="popup-cell-label">Hauteur</span>
                        <span className="popup-cell-value">
                          {a.hauteur.toFixed(1)}<small>m</small>
                        </span>
                      </div>
                    </div>
                    <div style={{ padding: '6px 0 2px', fontSize: 11, color: 'var(--text-muted)' }}>
                      Score d'anomalie :&nbsp;
                      <span style={{ color: '#bf3226', fontWeight: 700 }}>
                        {a.anomaly_score.toFixed(4)}
                      </span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </LayerGroup>
        )}

      </MapContainer>

      {/* ── Toolbar dessin + outils SIG ── */}
      <MapDrawToolbar
        mapRef={mapRef}
        geojson={geojson}
        showCoords={showCoords}
        setShowCoords={setShowCoords}
        showGraticule={showGraticule}
        setShowGraticule={setShowGraticule}
      />

      {/* ── Zone C : Capturer + LayerDrawer côte à côte — coin supérieur droit ── */}
      <div className="map-top-right-group">
        <button
          className={`btn-capture-map${capturing ? ' capturing' : ''}`}
          onClick={captureMap}
          disabled={capturing}
          title="Capturer la carte en PNG"
        >
          {capturing
            ? <><span className="capture-spinner" /> Export…</>
            : <>📸 Capturer</>
          }
        </button>
        {(() => {
          const availableOverlays = [
            { id: 'polygones', label: "Polygones oliviers", icon: <LuTreePine size={13} />, color: '#3d9960', hasOpacity: false },
            ...(currentId && currentMission?.ortho_formats?.rgb === 'zip'
              ? [{ id: 'rgb', label: 'Orthomosaïque RGB', icon: <LuSatellite size={13} />, color: '#0ea5e9', hasOpacity: true }]
              : []),
            ...(currentId && currentMission?.has_thermal_zip
              ? [{ id: 'thermal', label: 'Raster thermique', icon: <LuThermIcon size={13} />, color: '#f97316', hasOpacity: true }]
              : []),
          ]
          return (
            <div className="map-layer-drawer-wrap">
              <LayerDrawer
                activeBasemap={activeBasemap}
                onBasemapChange={setActiveBasemap}
                activeOverlays={activeOverlays}
                onOverlayToggle={toggleOverlay}
                overlayOpacities={overlayOpacities}
                onOpacityChange={setOpacity}
                availableOverlays={availableOverlays}
              />
            </div>
          )
        })()}
      </div>

      {/* ── Zone B : groupe de toggles visuels — bas gauche ── */}
      <div className="map-toggle-group">
        {geojson?.features?.length > 0 && (
          <button
            className={`map-toggle-btn${show3D ? ' active' : ''}`}
            onClick={handle3DToggle}
            title="Vue 3D des arbres"
          >
            🏔 Vue 3D
          </button>
        )}

        <MapFilterBar
          filterCwsi={filterCwsi}
          onCwsiChange={onCwsiChange}
          cwsiRange={dataRanges.cwsi}
          filterHauteur={filterHauteur}
          onHauteurChange={onHauteurChange}
          hauteurRange={dataRanges.hauteur}
          filterCirc={filterCirc}
          onCircChange={onCircChange}
          circRange={circRange}
          onReset={onFilterReset}
          filteredCount={geojson?.features?.length ?? 0}
          totalCount={totalCount}
        />
      </div>

      {/* ── Badge filtre IA — centré en haut de carte ── */}
      {mapFilter && mapFilter.action !== 'reset' && (
        <div className="map-ai-filter-badge">
          <span className="map-ai-filter-badge__icon">🤖</span>
          <span className="map-ai-filter-badge__label">
            Filtre IA · {MAP_FILTER_LABELS[mapFilter.action] ?? mapFilter.action}
          </span>
          <button
            className="map-ai-filter-badge__reset"
            onClick={onMapFilterReset}
            title="Réinitialiser le filtre"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Résultat de mesure — centré en haut ── */}
      {measureResult && (
        <div className="sig-measure-result">
          <span className="sig-measure-icon">
            {measureResult.type === 'distance' ? '📐' : '⬡'}
          </span>
          <div className="sig-measure-body">
            <span className="sig-measure-label">
              {measureResult.type === 'distance' ? 'Distance mesurée' : 'Surface mesurée'}
            </span>
            <span className="sig-measure-value">{measureResult.value}</span>
            {measureResult.extra && (
              <span className="sig-measure-extra">{measureResult.extra}</span>
            )}
          </div>
          <button className="sig-measure-close" onClick={() => setMeasureResult(null)}>✕</button>
        </div>
      )}

      {/* ── Coordonnées curseur — coin inférieur droit ── */}
      {showCoords && cursorCoords && (
        <div className="sig-coords-display">
          <span className="sig-coords-label">📍 Curseur</span>
          <span className="sig-coords-value">
            {cursorCoords.lat.toFixed(6)}°N,&nbsp;{cursorCoords.lng.toFixed(6)}°E
          </span>
          <span className="sig-coords-dms">
            {toDMS(cursorCoords.lat, 'N/S')}&nbsp;&nbsp;{toDMS(cursorCoords.lng, 'E/W')}
          </span>
        </div>
      )}

      {/* ── Info-box parcelle — coin inférieur droit ── */}
      {parcelInfo && (
        <div className={`sig-parcel-info${parcelInfoOpen ? ' open' : ''}`}>
          <div
            className="sig-pi-header"
            onClick={() => setParcelInfoOpen(v => !v)}
            style={{ cursor: 'pointer' }}
          >
            <span className="sig-pi-title">📍 Informations parcelle</span>
            <span className="sig-pi-chevron">{parcelInfoOpen ? '▲' : '▼'}</span>
          </div>
          {parcelInfoOpen && (
            <div className="sig-pi-grid">
              <div className="sig-pi-item">
                <span className="sig-pi-label">Centroïde</span>
                <span className="sig-pi-val mono">{parcelInfo.lat}°N</span>
                <span className="sig-pi-val mono">{parcelInfo.lng}°E</span>
              </div>
              <div className="sig-pi-item">
                <span className="sig-pi-label">Surface</span>
                <span className="sig-pi-val accent">{parcelInfo.surface} ha</span>
              </div>
              <div className="sig-pi-item">
                <span className="sig-pi-label">Arbres</span>
                <span className="sig-pi-val accent">{parcelInfo.n}</span>
              </div>
              <div className="sig-pi-item">
                <span className="sig-pi-label">Densité</span>
                <span className="sig-pi-val">
                  {parcelInfo.surface > 0
                    ? `${(parcelInfo.n / parcelInfo.surface).toFixed(0)} arb/ha`
                    : '—'}
                </span>
              </div>
              <div className="sig-pi-item sig-pi-item--full">
                <span className="sig-pi-label">Projection</span>
                <span className="sig-pi-val mono">WGS 84 · EPSG:4326</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Widget météo — coin inférieur droit, au-dessus de l'attribution Leaflet ── */}
      <WeatherWidget geojson={geojson} />

      {/* ── Overlay "Calcul spatial en cours…" — affiché pendant les traitements worker ── */}
      {pendingCalcs.size > 0 && (
        <div className="geo-calc-overlay">
          <div className="geo-calc-spinner" />
          <span>
            Calcul spatial en cours…
            {' '}({[...pendingCalcs].map(t => ({ IDW: 'IDW', KMEANS: 'Secteurs', TSP: 'Tournée', HEXBIN: 'Hexbin' }[t] ?? t)).join(', ')})
          </span>
        </div>
      )}

      {/* ── Overlay Vue 3D Deck.gl — couvre toute la carte quand actif ── */}
      {show3D && deck3DInitialState && (
        <Deck3DOverlay
          geojson={geojson}
          initialViewState={deck3DInitialState}
          onClose={() => setShow3D(false)}
        />
      )}

      {/* ── Overlay split-screen — positions initiales à 50 %, mises à jour par DOM direct ── */}
      {isCompareMode && (
        <>
          {currentLabel && (
            <div
              id="split-label-left"
              className="split-label"
              style={{ left: '25%', transform: 'translateX(-50%)' }}
            >
              {currentLabel}
            </div>
          )}
          {compareLabel ? (
            <div
              id="split-label-right"
              className="split-label"
              style={{ left: '75%', transform: 'translateX(-50%)' }}
            >
              {compareLabel}
            </div>
          ) : (
            <div
              className="split-no-data"
              style={{ left: '75%', transform: 'translateX(-50%)' }}
            >
              Aucune mission sélectionnée
            </div>
          )}
          {compareId && !compareMission?.has_shapefile && (
            <div className="split-no-data" style={{ left: '75%', top: '50%', transform: 'translate(-50%, -50%)' }}>
              🛰️ Aucune donnée<br />pour cette mission
            </div>
          )}
          {/* ── Toggle vue : Stress CWSI vs Orthophoto ── */}
          <div className="split-view-toggle">
            <button
              className={`split-toggle-btn${compareView === 'stress' ? ' split-toggle-btn--active' : ''}`}
              onClick={() => setCompareView('stress')}
              title="Afficher les couleurs de stress CWSI"
            >
              Stress CWSI
            </button>
            <button
              className={`split-toggle-btn${compareView === 'ortho' ? ' split-toggle-btn--active' : ''}`}
              onClick={() => setCompareView('ortho')}
              title="Afficher l'orthophoto brute"
            >
              Orthophoto
            </button>
          </div>

          <div
            id="split-divider"
            className="split-divider"
            style={{ left: 'calc(50% - 2px)' }}
            onMouseDown={e => { e.preventDefault(); isDragging.current = true }}
            onTouchStart={e => { e.stopPropagation(); isDragging.current = true }}
          >
            <div className="split-handle">⇔</div>
          </div>
        </>
      )}
    </div>
  )
})
export default TreeMap
