import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, LayerGroup, FeatureGroup, CircleMarker, Polygon, GeoJSON, Popup, LayersControl, Pane, useMap } from 'react-leaflet'
import parseGeoraster from 'georaster'
import GeoRasterLayer from 'georaster-layer-for-leaflet'
import * as turf from '@turf/turf'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import {
  LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip,
  ResponsiveContainer, ReferenceDot,
} from 'recharts'
import { STRESS_COLORS, STRESS_LABELS } from '../constants'
import { fetchTreeHistory } from '../api'
import { LuThermometer, LuRuler, LuDroplet, LuFootprints } from 'react-icons/lu'
import MapFilterOverlay from './MapFilterOverlay'
import WeatherWidget from './WeatherWidget'
import { useToast } from '../hooks/useToast'

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
function DrawControl({ allFeatures, setSelectedTrees }) {
  const map          = useMap()
  const toast        = useToast()
  const allFeaturesRef = useRef(allFeatures)

  useEffect(() => { allFeaturesRef.current = allFeatures }, [allFeatures])

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

      // Polyline et marker : pas de sélection spatiale
      if (e.layerType === 'polyline' || e.layerType === 'marker') {
        setSelectedTrees(null)
        return
      }

      const selectionPolygon = e.layer.toGeoJSON()
      const features         = allFeaturesRef.current

      // Calcul de la surface en hectares
      const areaM2 = turf.area(selectionPolygon)
      const areaHa = (areaM2 / 10000).toFixed(2)

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

    map.on(window.L.Draw.Event.CREATED, handleCreated)
    map.on(window.L.Draw.Event.DELETED, handleDeleted)

    return () => {
      map.off(window.L.Draw.Event.CREATED, handleCreated)
      map.off(window.L.Draw.Event.DELETED, handleDeleted)
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

/** Contrôleur interne : ajuste la vue pour englober toute l'emprise des données */
function MapController({ geojson }) {
  const map     = useMap()
  const prevRef = useRef(null)

  useEffect(() => {
    if (!geojson?.features?.length || geojson === prevRef.current) return
    prevRef.current = geojson

    // Calcul de l'emprise (Bounding Box) de toutes les données
    const bbox = turf.bbox(geojson) // [minLng, minLat, maxLng, maxLat]

    // Conversion au format Leaflet : [[Sud, Ouest], [Nord, Est]]
    const bounds = [
      [bbox[1], bbox[0]],
      [bbox[3], bbox[2]],
    ]

    map.flyToBounds(bounds, { padding: [40, 40], duration: 1.5 })
  }, [geojson, map])

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

/** Classe un score CWSI en niveau de stress et retourne la couleur associée (4 classes) */
function cwsiToStressColor(cwsi) {
  if (cwsi == null) return STRESS_COLORS.inconnu
  if (cwsi < 0.25)  return STRESS_COLORS.faible
  if (cwsi < 0.50)  return STRESS_COLORS.modere
  if (cwsi < 0.75)  return STRESS_COLORS.eleve
  return STRESS_COLORS.severe
}

const SECTOR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6']

/** Style Leaflet pour les secteurs K-Means */
function sectorStyleFn(feature) {
  const color = SECTOR_COLORS[feature?.properties?.cluster_id] ?? '#94a3b8'
  return { color, weight: 2, dashArray: '4, 4', fillColor: color, fillOpacity: 0.2 }
}

/**
 * Charge un GeoTIFF brut et l'ajoute à la carte via GeoRasterLayer.
 * Doit être rendu comme enfant d'un <LayersControl.Overlay> pour apparaître
 * dans le contrôleur de couches — le parent gère la case à cocher.
 */
function GeoRasterRenderer({ missionId, orthoType, opacity = 0.8, pane = 'overlayPane' }) {
  const map = useMap()
  const tag = `[GeoRaster:${orthoType}]`

  useEffect(() => {
    if (!missionId) return

    let layer     = null
    let cancelled = false

    async function load() {
      const url = `http://localhost:8000/uploads/${missionId}/${orthoType}.tif`
      console.log(`${tag} 1. Début du fetch TIF… → ${url}`)

      let res
      try {
        res = await fetch(url)
      } catch (err) {
        console.error(`${tag} Erreur réseau / CORS :`, err)
        return
      }

      if (!res.ok) {
        if (res.status !== 404) {
          console.error(`${tag} HTTP ${res.status} pour ${url}`)
        } else {
          console.log(`${tag} 404 — fichier absent, couche ignorée.`)
        }
        return
      }
      if (cancelled) return

      const arrayBuffer = await res.arrayBuffer()
      if (cancelled) return
      console.log(`${tag} 2. Buffer reçu, taille :`, arrayBuffer.byteLength)

      let georaster
      try {
        georaster = await parseGeoraster(arrayBuffer)
      } catch (err) {
        console.error(`${tag} parseGeoraster a échoué :`, err)
        return
      }
      if (cancelled) return
      console.log(`${tag} 3. GeoRaster parsé :`, georaster)

      layer = new GeoRasterLayer({
        georaster,
        opacity,
        resolution: 256,
        pane,
        maxZoom: 24,
        maxNativeZoom: 20,
      })
      layer.addTo(map)
      console.log(`${tag} 4. Couche ajoutée à la carte.`)

      try {
        const bounds = layer.getBounds()
        if (bounds && bounds.isValid()) {
          map.fitBounds(bounds)
          console.log(`${tag} 5. fitBounds effectué.`)
        } else {
          console.warn(`${tag} getBounds() invalide — zoom manuel nécessaire.`)
        }
      } catch (e) {
        console.warn(`${tag} fitBounds a échoué :`, e)
      }
    }

    load()

    return () => {
      cancelled = true
      if (layer && map.hasLayer(layer)) map.removeLayer(layer)
    }
  }, [missionId, orthoType, map, opacity, tag])

  return null
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

export default function TreeMap({
  geojson,
  activeStress = ['faible', 'modere', 'eleve', 'severe'],
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
  showRoute = false,
  showMCDA = false,
  mcdaScores = {},
  showSectors = false,
  showHexbins = false,
  hotspotRadius = 15,
  idwResolution = 10,
  sectorCount   = 3,
  // ── filtres cross-critères ──────────────────────────
  dataRanges    = { hauteur: [0, 20], temp: [0, 60], cwsi: [0, 1] },
  filterHauteur = null,
  filterTemp    = null,
  filterCwsi    = null,
  onHauteurChange = () => {},
  onTempChange    = () => {},
  onCwsiChange    = () => {},
  onFilterReset   = () => {},
  totalCount    = 0,
}) {
  const compareId = compareMission?.id ?? null

  // Cache de l'historique : { [treeId]: data[] }
  const historyCache = useRef({})
  const [, forceUpdate] = useState(0)

  // Split screen — ref seulement, pas de state, zéro re-render pendant le glissement
  const splitPosRef = useRef(50)
  const isDragging  = useRef(false)
  const wrapperRef  = useRef(null)
  const mapRef      = useRef(null)   // instance Leaflet Map

  // ── Web Worker — géotraitements asynchrones (IDW, K-Means, TSP) ───────────
  // Le worker tourne dans un thread V8 séparé : aucun blocage du Main Thread.
  const workerRef    = useRef(null)
  // Compteurs de requêtes par type — permet de rejeter les résultats obsolètes.
  const latestReqId  = useRef({ IDW: 0, KMEANS: 0, TSP: 0, HEXBIN: 0 })

  // Résultats géospatiaux issus du worker (remplacent les anciens useMemo)
  const [idwGrid,        setIdwGrid]        = useState(null)
  const [routeResult,    setRouteResult]    = useState(null)
  const [sectorPolygons, setSectorPolygons] = useState(null)
  const [hexbinGrid,     setHexbinGrid]     = useState(null)
  // Ensemble des calculs en cours — alimente l'overlay "Calcul spatial en cours…"
  const [pendingCalcs, setPendingCalcs]   = useState(new Set())

  // Initialise le worker une fois au montage ; le termine au démontage.
  useEffect(() => {
    const w = new Worker(
      new URL('../workers/geoWorker.js', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = w

    w.onmessage = ({ data: { type, result, reqId } }) => {
      if (type === 'IDW_RESULT' && reqId === latestReqId.current.IDW) {
        setIdwGrid(result)
        setPendingCalcs(s => { const n = new Set(s); n.delete('IDW'); return n })
      } else if (type === 'KMEANS_RESULT' && reqId === latestReqId.current.KMEANS) {
        setSectorPolygons(result)
        setPendingCalcs(s => { const n = new Set(s); n.delete('KMEANS'); return n })
      } else if (type === 'TSP_RESULT' && reqId === latestReqId.current.TSP) {
        setRouteResult(result)
        setPendingCalcs(s => { const n = new Set(s); n.delete('TSP'); return n })
      } else if (type === 'HEXBIN_RESULT' && reqId === latestReqId.current.HEXBIN) {
        setHexbinGrid(result)
        setPendingCalcs(s => { const n = new Set(s); n.delete('HEXBIN'); return n })
      }
      // Les résultats avec un reqId inférieur au dernier connu sont silencieusement ignorés.
    }

    w.onerror = (e) => console.error('[geoWorker]', e.message)

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
    workerRef.current?.postMessage({ type: 'KMEANS', payload: { geojson, activeStress, sectorCount }, reqId })
  }, [showSectors, geojson, activeStress, sectorCount])

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

  // Déclenche le calcul TSP (Nearest Neighbor) dans le worker.
  useEffect(() => {
    if (!showRoute || !geojson?.features?.length) {
      latestReqId.current.TSP++
      setRouteResult(null)
      setPendingCalcs(s => { const n = new Set(s); n.delete('TSP'); return n })
      return
    }
    const reqId = ++latestReqId.current.TSP
    setPendingCalcs(s => new Set(s).add('TSP'))
    workerRef.current?.postMessage({ type: 'TSP', payload: { geojson }, reqId })
  }, [showRoute, geojson])

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
      if (leftPane)  leftPane.style.clipPath  = `inset(0 ${100 - pct}% 0 0)`
      if (rightPane) rightPane.style.clipPath = `inset(0 0 0 ${pct}%)`
    }, 0)
    return () => clearTimeout(timer)
  }, [isCompareMode])

  // Glisser-déposer du séparateur — manipulation DOM directe, 0 setState → 60 fps
  useEffect(() => {
    function onMouseMove(e) {
      if (!isDragging.current || !wrapperRef.current) return
      const rect = wrapperRef.current.getBoundingClientRect()
      const pct  = Math.min(Math.max((e.clientX - rect.left) / rect.width * 100, 10), 90)
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
    function onMouseUp() { isDragging.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',  onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',  onMouseUp)
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

  const KNOWN_CLASSES = new Set(['faible', 'modere', 'eleve', 'severe'])
  const visibleFeatures = (geojson?.features ?? []).filter(f => {
    const s = f.properties.stress
    if (!s || !KNOWN_CLASSES.has(s)) return true   // inconnu / héritage → toujours visible
    return activeStress.includes(s)
  })
  const visibleCompareFeatures = (geojsonCompare?.features ?? []).filter(f => {
    const s = f.properties.stress
    if (!s || !KNOWN_CLASSES.has(s)) return true
    return activeStress.includes(s)
  })

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
      const paneProps = pane ? { pane } : { pane: 'markerPane' }

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
              color: dimmed ? 'rgba(255,255,255,0.15)' : '#1e293b',
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
                e.target.setStyle({ weight: 2.5, color: '#1e293b' })
              },
              mouseout: e => {
                if (dimmed) return
                e.target.setRadius(8)
                e.target.setStyle({ weight: 1.5, color: '#1e293b' })
              },
            }}
          >
            <TreePopup p={p} color={color} history={history} />
          </CircleMarker>
        )
      }

      if (feat.geometry.type === 'Polygon' || feat.geometry.type === 'MultiPolygon') {
        return (
          <Polygon
            key={key}
            positions={reverseCoordinates(feat.geometry.coordinates)}
            pathOptions={{
              stroke:      false,
              fillColor:   color,
              fillOpacity: dimmed ? 0.08 : 1,
            }}
            {...paneProps}
            eventHandlers={{
              click: () => fetchHistory(p.id),
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
        ref={mapRef}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        maxZoom={24}
        style={{ height: '100%', width: '100%' }}
      >
        <MapController geojson={geojson} />
        <DrawControl allFeatures={geojson?.features ?? []} setSelectedTrees={setSelectedTrees} />


        {isCompareMode && (
          <>
            <Pane name="left-pane"  style={{ zIndex: 401 }} />
            <Pane name="right-pane" style={{ zIndex: 402 }} />
          </>
        )}

        <LayersControl position="topright">

          {/* ── Fonds de carte ── */}
          <LayersControl.BaseLayer checked name="Satellite (Esri)">
            <TileLayer
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={24} maxNativeZoom={18}
              attribution="&copy; Esri"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Mode Sombre (CartoDB)">
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              maxZoom={24} maxNativeZoom={20}
              attribution="&copy; CARTO"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenStreetMap">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={24} maxNativeZoom={19}
              attribution="&copy; OSM"
            />
          </LayersControl.BaseLayer>

          {/* ── Orthomosaïque RGB — mission courante (left-pane en comparaison) ── */}
          {currentId && currentMission?.ortho_formats?.rgb === 'tif' && (
            <LayersControl.Overlay checked name="Orthomosaïque RGB">
              <LayerGroup>
                <GeoRasterRenderer
                  missionId={currentId} orthoType="rgb" opacity={0.8}
                  pane={isCompareMode ? 'left-pane' : 'overlayPane'}
                />
              </LayerGroup>
            </LayersControl.Overlay>
          )}
          {currentId && currentMission?.ortho_formats?.rgb === 'zip' && (
            <LayersControl.Overlay checked name="Orthomosaïque RGB">
              <TileLayer
                url={`http://localhost:8000/tiles/${currentId}/rgb_tiles/{z}/{x}/{y}.png`}
                maxZoom={24} maxNativeZoom={20}
                pane={isCompareMode ? 'left-pane' : 'overlayPane'}
              />
            </LayersControl.Overlay>
          )}

          {/* ── Orthomosaïque Thermique — mission courante (left-pane en comparaison) ── */}
          {currentId && currentMission?.ortho_formats?.thermal === 'tif' && (
            <LayersControl.Overlay checked name="Orthomosaïque Thermique">
              <LayerGroup>
                <GeoRasterRenderer
                  missionId={currentId} orthoType="thermal" opacity={0.9}
                  pane={isCompareMode ? 'left-pane' : 'overlayPane'}
                />
              </LayerGroup>
            </LayersControl.Overlay>
          )}
          {currentId && currentMission?.ortho_formats?.thermal === 'zip' && (
            <LayersControl.Overlay checked name="Orthomosaïque Thermique">
              <TileLayer
                url={`http://localhost:8000/tiles/${currentId}/thermal_tiles/{z}/{x}/{y}.png`}
                maxZoom={24} maxNativeZoom={20} opacity={0.9}
                pane={isCompareMode ? 'left-pane' : 'overlayPane'}
              />
            </LayersControl.Overlay>
          )}

          {/* ── Orthomosaïques — mission comparée (right-pane uniquement) ── */}
          {isCompareMode && compareId && compareMission?.ortho_formats?.rgb === 'tif' && (
            <LayersControl.Overlay checked name="Ortho RGB (comparaison)">
              <LayerGroup>
                <GeoRasterRenderer missionId={compareId} orthoType="rgb" opacity={0.8} pane="right-pane" />
              </LayerGroup>
            </LayersControl.Overlay>
          )}
          {isCompareMode && compareId && compareMission?.ortho_formats?.rgb === 'zip' && (
            <LayersControl.Overlay checked name="Ortho RGB (comparaison)">
              <TileLayer
                url={`http://localhost:8000/tiles/${compareId}/rgb_tiles/{z}/{x}/{y}.png`}
                maxZoom={24} maxNativeZoom={20} pane="right-pane"
              />
            </LayersControl.Overlay>
          )}
          {isCompareMode && compareId && compareMission?.ortho_formats?.thermal === 'tif' && (
            <LayersControl.Overlay checked name="Ortho Thermique (comparaison)">
              <LayerGroup>
                <GeoRasterRenderer missionId={compareId} orthoType="thermal" opacity={0.9} pane="right-pane" />
              </LayerGroup>
            </LayersControl.Overlay>
          )}
          {isCompareMode && compareId && compareMission?.ortho_formats?.thermal === 'zip' && (
            <LayersControl.Overlay checked name="Ortho Thermique (comparaison)">
              <TileLayer
                url={`http://localhost:8000/tiles/${compareId}/thermal_tiles/{z}/{x}/{y}.png`}
                maxZoom={24} maxNativeZoom={20} opacity={0.9} pane="right-pane"
              />
            </LayersControl.Overlay>
          )}

          {/* ── Parcelles d'Oliviers — source unique, strictement isolée ── */}
          {geojson && (
            <LayersControl.Overlay checked name="Parcelles d'Oliviers">
              <LayerGroup>
                {renderMarkers(visibleFeatures, isCompareMode ? 'left-pane' : 'markerPane', true)}
                {isCompareMode && renderMarkers(visibleCompareFeatures, 'right-pane', false)}
              </LayerGroup>
            </LayersControl.Overlay>
          )}

        </LayersControl>

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
                    <span className="popup-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><LuFootprints size={16} /> Départ tournée</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', padding: '4px 0' }}>
                    {routeResult.count} arbre{routeResult.count !== 1 ? 's' : ''} sévères à inspecter
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          </>
        )}

      </MapContainer>

      {/* ── Overlay filtres cross-critères — coin supérieur droit ── */}
      {totalCount > 0 && (
        <MapFilterOverlay
          dataRanges={dataRanges}
          filterHauteur={filterHauteur}
          filterTemp={filterTemp}
          filterCwsi={filterCwsi}
          onHauteurChange={onHauteurChange}
          onTempChange={onTempChange}
          onCwsiChange={onCwsiChange}
          onReset={onFilterReset}
          filteredCount={geojson?.features?.length ?? 0}
          totalCount={totalCount}
        />
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
          {compareLabel && (
            <div
              id="split-label-right"
              className="split-label"
              style={{ left: '75%', transform: 'translateX(-50%)' }}
            >
              {compareLabel}
            </div>
          )}
          <div
            id="split-divider"
            className="split-divider"
            style={{ left: 'calc(50% - 2px)' }}
            onMouseDown={e => { e.preventDefault(); isDragging.current = true }}
          >
            <div className="split-handle">⇔</div>
          </div>
        </>
      )}
    </div>
  )
}
