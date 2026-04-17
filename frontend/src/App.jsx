import { useState, useEffect, useRef, useMemo } from 'react'
import { ToastProvider } from './hooks/useToast'
import { useMissions }    from './hooks/useMissions'
import { useMissionData } from './hooks/useMissionData'
import TreeMap        from './components/TreeMap'
import StatsPanel     from './components/StatsPanel'
import Legend         from './components/Legend'
import TrendPanel     from './components/TrendPanel'
import MissionSelector, { MissionUploadZone } from './components/MissionSelector'
import { StatsSkeleton } from './components/Skeleton'
import { STRESS_COLORS } from './constants'


const STRESS_LEVELS = ['aucun', 'faible', 'modere', 'eleve', 'severe']

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
  const [showHotspots, setShowHotspots]   = useState(false)
  const [selectedTrees, setSelectedTrees] = useState(null)
  const [showIDW, setShowIDW]             = useState(false)
  const [showRoute, setShowRoute]         = useState(false)

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

  const visibleCount = geojson?.features.filter(
    f => activeStress.includes(f.properties.stress || 'inconnu')
  ).length ?? 0

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
          {currentMission && (
            <>
              <span className="status-dot" />
              <span className="status-pill">
                {currentMission.nom || currentMission.id} · {currentMission.date}
              </span>
            </>
          )}

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
            <span className="panel-float-icon">📡</span>
            Missions & Statistiques
          </span>
        </div>
        <div className="panel-float-body">
          <MissionSelector
            missions={missions}
            currentId={currentId}
            onSelect={handleSelect}
            onRefresh={refresh}
          />

          {currentMission && !currentMission.has_shapefile && (
            <MissionUploadZone missionId={currentId} onUploaded={refresh} />
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
              />
          }

          {hasMapData && (
            <button
              className={`btn-hotspots${showHotspots ? ' active' : ''}`}
              onClick={() => setShowHotspots(v => !v)}
            >
              🚨 {showHotspots ? 'Masquer les zones critiques' : 'Analyser les zones critiques'}
            </button>
          )}

          {hasMapData && (
            <button
              className={`btn-idw${showIDW ? ' active' : ''}`}
              onClick={() => setShowIDW(v => !v)}
            >
              🗺️ {showIDW ? 'Masquer la surface IDW' : 'Activer la surface continue (IDW)'}
            </button>
          )}

          {hasMapData && (
            <button
              className={`btn-route${showRoute ? ' active' : ''}`}
              onClick={() => setShowRoute(v => !v)}
            >
              🚶‍♂️ {showRoute ? 'Masquer la tournée' : 'Générer la tournée d\'inspection'}
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
          showHotspots={showHotspots}
          setSelectedTrees={setSelectedTrees}
          selectedTrees={selectedTrees}
          showIDW={showIDW}
          showRoute={showRoute}
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
            <span className="panel-float-icon">📈</span>
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
