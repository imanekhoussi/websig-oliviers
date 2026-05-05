/**
 * geoWorker.js — Web Worker pour les géotraitements Turf.js lourds
 *
 * Architecture : ce worker tourne dans un thread V8 séparé du Main Thread React.
 * Il reçoit des GeoJSON via postMessage, exécute les calculs spatiaux et renvoie
 * les résultats sérialisés. Aucun accès au DOM, aucune dépendance React.
 *
 * Protocole de messages (→ = envoyé au worker, ← = reçu du worker) :
 *   → { type: 'IDW',    payload: { geojson, idwResolution },              reqId: number }
 *   → { type: 'KMEANS', payload: { geojson, activeStress, sectorCount }, reqId: number }
 *   → { type: 'TSP',    payload: { geojson },                            reqId: number }
 *   → { type: 'HEXBIN', payload: { geojson },                            reqId: number }
 *   ← { type: 'IDW_RESULT',    result: FeatureCollection | null, reqId }
 *   ← { type: 'KMEANS_RESULT', result: FeatureCollection | null, reqId }
 *   ← { type: 'TSP_RESULT',    result: { line, start, count } | null, reqId }
 *   ← { type: 'HEXBIN_RESULT', result: FeatureCollection | null, reqId }
 *   ← { type: 'ERROR',         error: string, reqId }
 *
 * Gestion des courses (race conditions) : chaque requête reçoit un reqId unique.
 * TreeMap compare le reqId reçu au reqId de la dernière requête envoyée ; si
 * obsolète, le résultat est ignoré sans mettre à jour le state React.
 */

import * as turf from '@turf/turf'

// ── 1. Interpolation IDW — Krigeage simplifié sur le champ CWSI ─────────────
//    Génère une grille de cellules carrées (10 m) interpolée par IDW (p = 2).
//    Nécessite au moins 3 arbres avec une valeur CWSI connue.
function computeIDW(geojson, resolution) {
  const withCwsi = geojson.features.filter(f => f.properties.cwsi != null)
  if (withCwsi.length < 3) return null

  // Centroïde de chaque arbre (fonctionne sur Point ET Polygon)
  const points = withCwsi.map(f => {
    const pt = turf.centroid(f)
    pt.properties = { cwsi: f.properties.cwsi }
    return pt
  })

  try {
    return turf.interpolate(turf.featureCollection(points), resolution, {
      gridType: 'square',
      property: 'cwsi',
      units:    'meters',
      weight:   2,           // exposant IDW — p=2 est le standard
    })
  } catch {
    return null
  }
}

// ── 2. Clustering K-Means — 3 secteurs d'irrigation homogènes ───────────────
//    Partitionne les arbres visibles en 3 clusters spatiaux.
//    Retourne une FeatureCollection de polygones convexes bufférisés (5 m).
function computeKMeans(geojson, activeStress, sectorCount) {
  const filtered = geojson.features.filter(
    f => activeStress.includes(f.properties.stress || 'inconnu')
  )
  if (filtered.length < sectorCount) return null

  const points = turf.featureCollection(
    filtered.map(f => {
      const pt = turf.centroid(f)
      pt.properties = { ...f.properties }
      return pt
    })
  )

  let clustered
  try {
    clustered = turf.clustersKmeans(points, { numberOfClusters: sectorCount })
  } catch {
    return null
  }

  const polygons = []
  for (let i = 0; i < sectorCount; i++) {
    const clusterPts = turf.featureCollection(
      clustered.features.filter(f => f.properties.cluster === i)
    )
    if (clusterPts.features.length < 3) continue

    const hull     = turf.convex(clusterPts)
    if (!hull) continue
    const buffered = turf.buffer(hull, 5, { units: 'meters' })
    if (!buffered) continue

    buffered.properties = { cluster_id: i }
    polygons.push(buffered)
  }

  return polygons.length > 0 ? turf.featureCollection(polygons) : null
}

// ── 3. TSP Nearest Neighbor — tournée d'inspection des arbres sévères ────────
//    Algorithme glouton O(n²) : à chaque étape, on va vers l'arbre non visité
//    le plus proche du dernier arbre visité. Retourne la polyligne de la tournée,
//    le point de départ (pour le marqueur Leaflet) et le nombre d'arbres inclus.
function computeTSP(geojson) {
  const severe = geojson.features.filter(f => f.properties.stress === 'severe')
  if (severe.length < 2) return null

  const pts = severe.map(f => {
    const pt = turf.centroid(f)
    pt.properties = { ...f.properties }
    return pt
  })

  let unvisited = [...pts]
  let current   = unvisited.shift()
  const ordered = [current]

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

  const coords = ordered.map(p => p.geometry.coordinates)
  return {
    line:  turf.lineString(coords),
    start: coords[0],
    count: ordered.length,
  }
}

// ── 4. Hexbin — grille hexagonale avec moyenne CWSI par cellule ──────────────
//    Génère une grille hex (0.02 km = 20 m), agrège les CWSI des arbres
//    contenus dans chaque hexagone, filtre les cellules vides.
function computeHexbin(geojson) {
  const withCwsi = geojson.features.filter(f => f.properties.cwsi != null)
  if (withCwsi.length < 3) return null

  const bbox = turf.bbox(geojson)
  let grid
  try {
    grid = turf.hexGrid(bbox, 0.02, { units: 'kilometers' })
  } catch {
    return null
  }
  if (!grid?.features?.length) return null

  // Centroïdes des arbres avec cwsi
  const points = withCwsi.map(f => {
    const pt = turf.centroid(f)
    pt.properties = { cwsi: f.properties.cwsi }
    return pt
  })

  const filled = []
  for (const hex of grid.features) {
    const vals = []
    for (const pt of points) {
      try {
        if (turf.booleanPointInPolygon(pt, hex)) vals.push(pt.properties.cwsi)
      } catch { /* continue */ }
    }
    if (vals.length === 0) continue
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length
    filled.push({
      ...hex,
      properties: { cwsi: +mean.toFixed(3), count: vals.length },
    })
  }

  return filled.length > 0 ? turf.featureCollection(filled) : null
}

// ── Dispatcher principal ─────────────────────────────────────────────────────
self.onmessage = function (e) {
  const { type, payload, reqId } = e.data
  try {
    switch (type) {
      case 'IDW':
        self.postMessage({ type: 'IDW_RESULT',    result: computeIDW(payload.geojson, payload.idwResolution ?? 10), reqId })
        break
      case 'KMEANS':
        self.postMessage({ type: 'KMEANS_RESULT', result: computeKMeans(payload.geojson, payload.activeStress, payload.sectorCount ?? 3), reqId })
        break
      case 'TSP':
        self.postMessage({ type: 'TSP_RESULT',    result: computeTSP(payload.geojson), reqId })
        break
      case 'HEXBIN':
        self.postMessage({ type: 'HEXBIN_RESULT', result: computeHexbin(payload.geojson), reqId })
        break
      default:
        self.postMessage({ type: 'ERROR', error: `Type de calcul inconnu : ${type}`, reqId })
    }
  } catch (err) {
    self.postMessage({ type: 'ERROR', error: err?.message ?? String(err), reqId })
  }
}
