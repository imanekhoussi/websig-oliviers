/**
 * geoWorker.js — Web Worker pour les géotraitements Turf.js lourds
 *
 * Architecture : ce worker tourne dans un thread V8 séparé du Main Thread React.
 * Il reçoit des GeoJSON via postMessage, exécute les calculs spatiaux et renvoie
 * les résultats sérialisés. Aucun accès au DOM, aucune dépendance React.
 *
 * Protocole de messages (→ = envoyé au worker, ← = reçu du worker) :
 *   → { type: 'IDW',    payload: { geojson, idwResolution },              reqId: number }
 *   → { type: 'KMEANS', payload: { geojson, activeStress, sectorCount, sectorAngle }, reqId: number }
 *   → { type: 'TSP',    payload: { geojson, startPos, maxTrees },         reqId: number }
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

// ── 2. Sectorisation par bandes orientées — découpage agronomique ────────────
//    Regroupe les arbres en bandes parallèles aux rangées de goutte-à-goutte.
//    Algorithme :
//      1) Centroïde global de tous les arbres filtrés par stress.
//      2) turf.transformRotate pivote chaque point de -sectorAngle° autour du centroïde.
//      3) Lecture de la coordonnée Y (latitude) pivotée → étendue [minY, maxY].
//      4) Découpe en sectorCount bandes de largeur égale sur cet axe Y pivoté.
//      5) Enveloppe convexe (+ buffer 5 m) sur les coordonnées ORIGINALES → polygones.
//    Retourne une FeatureCollection de polygones colorés par cluster_id.
function computeBandSectors(geojson, activeStress, sectorCount, sectorAngle) {
  // Garde défensive : si activeStress manque/null, on inclut tous les arbres
  const filtered = Array.isArray(activeStress)
    ? geojson.features.filter(f => activeStress.includes(f.properties.stress || 'inconnu'))
    : geojson.features

  if (filtered.length < sectorCount) return null

  // Centroïdes des arbres filtrés — toujours des Points, même si les features sont des Polygones
  const pts = filtered.map(f => {
    const pt = turf.centroid(f)
    pt.properties = { ...f.properties }
    return pt
  })

  // Forçage numérique — postMessage sérialise en JSON, un string passerait sinon
  const angle = Number(sectorAngle) || 0

  // Pivot = [lng, lat] pur — turf.transformRotate n'accepte pas un Feature comme pivot
  const pivotCoords = turf.centroid(turf.featureCollection(pts)).geometry.coordinates

  // Rotation de chaque centroïde Point : .geometry.coordinates[1] est toujours un nombre
  const rotatedWithOrig = pts.map(pt => ({
    original: pt,
    ry: turf.transformRotate(pt, -angle, { pivot: pivotCoords }).geometry.coordinates[1],
  }))

  // Étendue Y pivotée → sectorCount bandes de hauteur égale
  let minY = Infinity, maxY = -Infinity
  rotatedWithOrig.forEach(({ ry }) => {
    if (ry < minY) minY = ry
    if (ry > maxY) maxY = ry
  })
  if (maxY === minY) maxY = minY + 0.0001  // évite division par zéro si tous colinéaires

  const bandH   = (maxY - minY) / sectorCount
  const buckets = Array.from({ length: sectorCount }, () => [])

  rotatedWithOrig.forEach(({ original, ry }) => {
    let idx = Math.floor((ry - minY) / bandH)
    if (idx >= sectorCount) idx = sectorCount - 1
    if (idx < 0)            idx = 0
    buckets[idx].push(original)
  })

  // Polygones d'enveloppe convexe sur coordonnées originales (non pivotées)
  const polygons = []
  for (let i = 0; i < sectorCount; i++) {
    const clusterPts = turf.featureCollection(buckets[i])
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

// ── 3. VRP Nearest Neighbor — tournée sous contraintes (Manhattan + dépôt) ───
//    • startPos  : [lng, lat] point de départ imposé (dépôt) — null = 1er arbre
//    • maxTrees  : quota maximum d'arbres à visiter (simule une limite de temps)
//    • Distance  : Manhattan absolue sur coordonnées géo (déplacement en allées)
//    Les features sont déjà filtrées par l'appelant (cible : sévère, élevé, tous…)
function computeTSP(geojson, startPos = null, maxTrees = null) {
  const features = geojson.features
  if (features.length < 1) return null

  // Centroïdes de chaque arbre cible
  const pts = features.map(f => {
    const pt = turf.centroid(f)
    pt.properties = { ...f.properties }
    return pt
  })

  // Distance Manhattan sur coordonnées projetées (lat/lng ≈ équivalent local)
  function manhattan([ax, ay], [bx, by]) {
    return Math.abs(bx - ax) + Math.abs(by - ay)
  }

  const limit     = maxTrees != null ? Math.min(maxTrees, pts.length) : pts.length
  let currentCoord = startPos ?? pts[0].geometry.coordinates
  let unvisited    = startPos ? [...pts] : pts.slice(1)
  const ordered    = startPos ? [] : [pts[0]]

  while (unvisited.length > 0 && ordered.length < limit) {
    let bestIdx  = 0
    let bestDist = manhattan(currentCoord, unvisited[0].geometry.coordinates)

    for (let i = 1; i < unvisited.length; i++) {
      const d = manhattan(currentCoord, unvisited[i].geometry.coordinates)
      if (d < bestDist) { bestDist = d; bestIdx = i }
    }

    const nearest = unvisited[bestIdx]
    ordered.push(nearest)
    unvisited.splice(bestIdx, 1)
    currentCoord = nearest.geometry.coordinates
  }

  if (ordered.length === 0) return null

  const treeCoords = ordered.map(p => p.geometry.coordinates)
  const allCoords  = startPos ? [startPos, ...treeCoords] : treeCoords

  return {
    line:  turf.lineString(allCoords),
    start: allCoords[0],
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
        self.postMessage({ type: 'KMEANS_RESULT', result: computeBandSectors(payload.geojson, payload.activeStress, payload.sectorCount ?? 3, payload.sectorAngle ?? 0), reqId })
        break
      case 'TSP':
        self.postMessage({ type: 'TSP_RESULT',    result: computeTSP(payload.geojson, payload.startPos ?? null, payload.maxTrees ?? null), reqId })
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
