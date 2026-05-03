import { useState, useEffect, useRef, useMemo } from 'react'
import { ToastProvider } from './hooks/useToast'
import { useMissions }    from './hooks/useMissions'
import { useMissionData } from './hooks/useMissionData'
import TreeMap        from './components/TreeMap'
import StatsPanel     from './components/StatsPanel'
import Legend         from './components/Legend'
import TrendPanel     from './components/TrendPanel'
import MissionSelector from './components/MissionSelector'
import MissionManager  from './components/MissionManager'
import { StatsSkeleton } from './components/Skeleton'
import { STRESS_COLORS } from './constants'
import MCDAPanel from './components/MCDAPanel'
import {
  LuDroplets, LuTriangleAlert, LuMap, LuRoute,
  LuSlidersHorizontal, LuSatellite, LuTrendingUp, LuSettings,
} from 'react-icons/lu'


const STRESS_LEVELS = ['faible', 'modere', 'eleve', 'severe']

/** Recalcule les stats serveur-équivalentes sur un sous-ensemble de features */
function computeZonalStats(features) {
  if (!features?.length) return null

  const cwsiVals  = features.map(f => f.properties.cwsi).filter(v => v != null)
  const tempVals  = features.map(f => f.properties.temp_moy).filter(v => v != null)
  const hautVals  = features.map(f => f.properties.hauteur).filter(v => v != null)

  const avg = arr => arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(3) : null
  const min = arr => arr.length ? +Math.min(...arr).toFixed(3) : null
  const max = arr => arr.length ? +Math.max(...arr).toFixed(3) : null

  // Répartition par stress
  const counts = {}
  features.forEach(f => {
    const k = f.properties.stress || 'inconnu'
    counts[k] = (counts[k] || 0) + 1
  })
  const stress_breakdown = STRESS_LEVELS.map(k => ({
    classe: k, count: counts[k] || 0, color: STRESS_COLORS[k],
  }))

  // Histogramme CWSI en 10 bins [0–1]
  const bins = Array.from({ length: 10 }, (_, i) => ({
    bin: `${(i * 0.1).toFixed(1)}–${((i + 1) * 0.1).toFixed(1)}`,
    count: 0,
  }))
  cwsiVals.forEach(v => {
    const i = Math.min(Math.floor(v * 10), 9)
    bins[i].count++
  })

  return {
    total_arbres:    features.length,
    cwsi:            { moyenne: avg(cwsiVals), min: min(cwsiVals), max: max(cwsiVals) },
    temperature:     { moyenne: avg(tempVals), min: min(tempVals), max: max(tempVals) },
    hauteur:         { min: min(hautVals),     max: max(hautVals) },
    stress_breakdown,
    histogram_cwsi:  bins,
  }
}

/* ── Écran de chargement initial ── */
function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
      <span className="loading-text">Initialisation du SIG…</span>
    </div>
  )
}

/* ── Dashboard principal (dans le ToastProvider) ── */
function Dashboard() {
  const { missions, loading, refresh } = useMissions()
  const [currentId, setCurrentId]       = useState(null)
  const [activeStress, setActiveStress] = useState([...STRESS_LEVELS])
  const [isCompareMode, setIsCompareMode] = useState(false)
  const [compareId, setCompareId]         = useState(null)
  const [showManager,  setShowManager]    = useState(false)
  const [showHotspots, setShowHotspots]   = useState(false)
  const [selectedTrees, setSelectedTrees] = useState(null)
  const [showIDW, setShowIDW]             = useState(false)
  const [showRoute, setShowRoute]         = useState(false)
  const [showMCDA, setShowMCDA]           = useState(false)
  const [showSectors, setShowSectors]     = useState(false)
  const [weightStress, setWeightStress]   = useState(60)
  const [weightHeight, setWeightHeight]   = useState(40)

  // Auto-sélectionne la première mission avec données au premier chargement
  const didInit = useRef(false)
  useEffect(() => {
    if (!loading && !didInit.current && missions.length > 0) {
      didInit.current = true
      const withData = missions.find(m => m.has_shapefile)
      setCurrentId(withData?.id || missions[0]?.id || null)
    }
  }, [loading, missions])

  const { geojson, stats, dataLoading } = useMissionData(currentId, missions)
  const { geojson: geojsonCompare, stats: statsCompare } =
    useMissionData(isCompareMode ? compareId : null, missions)

  const currentMission = missions.find(m => m.id === currentId)
  const compareMission = missions.find(m => m.id === compareId)
  const hasMapData = currentMission?.has_shapefile && geojson

  // Stats zonales : recalculées côté client sur le sous-ensemble sélectionné
  const zonalStats = useMemo(
    () => selectedTrees ? computeZonalStats(selectedTrees) : null,
    [selectedTrees]
  )
  const displayStats = zonalStats ?? stats

  // Calcul des indices de vulnérabilité MCDA (AHP) en temps réel
  const mcdaScores = useMemo(() => {
    if (!showMCDA || !geojson?.features?.length) return {}
    const stressScore = { faible: 25, modere: 50, eleve: 75, severe: 100 }
    const heights = geojson.features.map(f => f.properties.hauteur).filter(h => h != null)
    const maxH = heights.length ? Math.max(...heights) : 1
    const scores = {}
    geojson.features.forEach(f => {
      const p = f.properties
      const sStress = stressScore[p.stress] ?? 0
      const sHeight = maxH > 0 ? ((maxH - (p.hauteur ?? maxH)) / maxH) * 100 : 0
      scores[p.id] = +((sStress * weightStress + sHeight * weightHeight) / 100).toFixed(1)
    })
    return scores
  }, [showMCDA, geojson, weightStress, weightHeight])

  const KNOWN_STRESS = new Set(['faible', 'modere', 'eleve', 'severe'])
  const visibleCount = geojson?.features.filter(f => {
    const s = f.properties.stress
    if (!s || !KNOWN_STRESS.has(s)) return true   // inconnu → toujours compté visible
    return activeStress.includes(s)
  }).length ?? 0

  function handleSelect(id) {
    setCurrentId(id)
    setActiveStress([...STRESS_LEVELS])
    setSelectedTrees(null)
    if (id === compareId) setCompareId(null)
  }

  function toggleStress(level) {
    setActiveStress(prev =>
      prev.includes(level)
        ? prev.filter(s => s !== level)
        : [...prev, level]
    )
  }

  function toggleCompareMode() {
    if (isCompareMode) {
      setIsCompareMode(false)
      setCompareId(null)
    } else {
      const other = missions.find(m => m.id !== currentId && m.has_shapefile)
      setCompareId(other?.id || null)
      setIsCompareMode(true)
    }
  }

  if (loading) return <LoadingScreen />

  return (
    <div className="app">

      {/* ── HEADER ── */}
      <header className="header-bar">
        <div className="brand">
          <span className="brand-icon">◈</span>
          <h1>GeoOlive</h1>
        </div>
        <div className="header-status">
          <MissionSelector
            missions={missions}
            currentId={currentId}
            onSelect={handleSelect}
          />

          <span className="header-sep" />

          <button
            className={`btn-header-manage${showManager ? ' active' : ''}`}
            onClick={() => setShowManager(v => !v)}
            title="Gérer les missions"
          >
            <LuSettings size={14} /> Gérer les missions
          </button>

          <span className="header-sep" />

          {isCompareMode && (
            <>
              <span className="compare-vs">vs</span>
              <select
                className="compare-select"
                value={compareId || ''}
                onChange={e => setCompareId(e.target.value || null)}
              >
                <option value="">— Mission —</option>
                {missions
                  .filter(m => m.id !== currentId && m.has_shapefile)
                  .map(m => (
                    <option key={m.id} value={m.id}>
                      {m.nom || m.id} · {m.date}
                    </option>
                  ))}
              </select>
            </>
          )}

          <button
            className={`btn-compare${isCompareMode ? ' active' : ''}`}
            onClick={toggleCompareMode}
            title={isCompareMode ? 'Désactiver la comparaison' : 'Comparer deux missions'}
          >
            {isCompareMode ? '× Comparaison' : '⊞ Comparer'}
          </button>
        </div>
      </header>

      {/* ── COLONNE GAUCHE : Missions & Statistiques ── */}
      <aside className="col-left">
        <div className="panel-float-header">
          <span className="panel-float-title">
            <LuSatellite size={14} />
            Missions & Statistiques
          </span>
        </div>
        <div className="panel-float-body">
          {hasMapData && (
            <button
              className={`btn-mcda${showMCDA ? ' active' : ''}`}
              onClick={() => setShowMCDA(v => !v)}
            >
              <LuSlidersHorizontal size={16} />
              {showMCDA ? 'Désactiver le Multicritère' : 'Mode Multicritère (AHP)'}
            </button>
          )}

          {showMCDA && hasMapData && (
            <MCDAPanel
              weightStress={weightStress}
              weightHeight={weightHeight}
              onChange={(wS, wH) => { setWeightStress(wS); setWeightHeight(wH) }}
            />
          )}

          {dataLoading
            ? <StatsSkeleton />
            : <StatsPanel
                stats={displayStats}
                mission={currentMission}
                statsCompare={isCompareMode && !selectedTrees ? statsCompare : null}
                missionCompare={isCompareMode && !selectedTrees ? compareMission : null}
                isZonalActive={selectedTrees !== null}
                onClearZonal={() => setSelectedTrees(null)}
                features={selectedTrees}
              />
          }

          {hasMapData && (
            <button
              className={`btn-hotspots${showHotspots ? ' active' : ''}`}
              onClick={() => setShowHotspots(v => !v)}
            >
              <LuTriangleAlert size={16} />
              {showHotspots ? 'Masquer les zones critiques' : 'Analyser les zones critiques'}
            </button>
          )}

          {hasMapData && (
            <button
              className={`btn-idw${showIDW ? ' active' : ''}`}
              onClick={() => setShowIDW(v => !v)}
            >
              <LuMap size={16} />
              {showIDW ? 'Masquer la surface IDW' : 'Activer la surface continue (IDW)'}
            </button>
          )}

          {hasMapData && (
            <button
              className={`btn-route${showRoute ? ' active' : ''}`}
              onClick={() => setShowRoute(v => !v)}
            >
              <LuRoute size={16} />
              {showRoute ? 'Masquer la tournée' : "Générer la tournée d'inspection"}
            </button>
          )}

          {hasMapData && (
            <button
              className={`btn-sectors${showSectors ? ' active' : ''}`}
              onClick={() => setShowSectors(v => !v)}
            >
              <LuDroplets size={16} />
              {showSectors ? "Masquer les secteurs d'irrigation" : "Générer les secteurs d'irrigation"}
            </button>
          )}
        </div>
      </aside>

      {/* ── CARTE CENTRALE ── */}
      <main className="col-map">
        <TreeMap
          geojson={geojson}
          activeStress={activeStress}
          isCompareMode={isCompareMode}
          geojsonCompare={geojsonCompare}
          currentLabel={currentMission ? (currentMission.nom || currentMission.id) + ' · ' + currentMission.date : ''}
          compareLabel={compareMission ? (compareMission.nom || compareMission.id) + ' · ' + compareMission.date : ''}
          currentId={currentId}
          currentMission={currentMission ?? null}
          compareMission={compareMission ?? null}
          showHotspots={showHotspots}
          setSelectedTrees={setSelectedTrees}
          selectedTrees={selectedTrees}
          showIDW={showIDW}
          showRoute={showRoute}
          showMCDA={showMCDA}
          mcdaScores={mcdaScores}
          showSectors={showSectors}
        />

        {/* Indicateurs quand aucune donnée */}
        {!hasMapData && !dataLoading && currentMission && (
          <div className="map-no-data">
            <span className="map-no-data-icon">🛰️</span>
            <p className="map-no-data-text">
              Importez un shapefile pour<br />visualiser les données sur la carte.
            </p>
          </div>
        )}
        {!currentMission && !loading && (
          <div className="map-no-data">
            <span className="map-no-data-icon">🗺️</span>
            <p className="map-no-data-text">
              Sélectionnez ou créez une mission<br />dans le panneau à gauche.
            </p>
          </div>
        )}

      </main>

      {/* ── COLONNE DROITE : Tendances ── */}
      <aside className="col-right">
        <div className="panel-float-header">
          <span className="panel-float-title">
            <LuTrendingUp size={14} />
            Tendances temporelles
          </span>
        </div>
        <div className="panel-float-body">
          <TrendPanel missions={missions} currentId={currentId} />

          <Legend
            activeStress={activeStress}
            onToggle={hasMapData ? toggleStress : undefined}
            visibleCount={hasMapData ? visibleCount : null}
            stressCounts={displayStats?.stress_breakdown}
          />
        </div>
      </aside>

      {showManager && (
        <MissionManager
          missions={missions}
          onRefresh={refresh}
          onClose={() => setShowManager(false)}
          onMissionDeleted={(deletedId) => {
            if (currentId === deletedId) setCurrentId(null)
          }}
        />
      )}

    </div>
  )
}

/* ── Export principal : Dashboard enveloppé dans les providers ── */
export default function App() {
  return (
    <ToastProvider>
      <Dashboard />
    </ToastProvider>
  )
}
