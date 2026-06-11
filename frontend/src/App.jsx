import { useState, useEffect, useRef, useMemo } from 'react'
import logoSvg from './assets/images/logo.svg'
import { ToastProvider } from './hooks/useToast'
import { useToast }       from './hooks/useToast'
import { useMissions }    from './hooks/useMissions'
import { useMissionData } from './hooks/useMissionData'
import TreeMap        from './components/TreeMap'
import StatsPanel     from './components/StatsPanel'
import Legend         from './components/Legend'
import TrendPanel     from './components/TrendPanel'
import MapFilterBar   from './components/MapFilterBar'
import AnomalyPanel   from './components/AnomalyPanel'
import MissionSelector from './components/MissionSelector'
import MissionManager  from './components/MissionManager'
import DashboardHome   from './components/DashboardHome'
import { StatsSkeleton } from './components/Skeleton'
import { STRESS_COLORS } from './constants'
import MCDAPanel from './components/MCDAPanel'
import MissionReport from './components/MissionReport'
import TreeCatalog from './components/TreeCatalog'
import ParcelSettings from './components/ParcelSettings'
import PredictiveAnalysis from './components/PredictiveAnalysis'
import { fetchAnomalies, fetchYieldPredictions, fetchTrees, fetchRendement } from './api'
import RendementPanel from './components/RendementPanel'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from './constants'
import {
  LuDroplets, LuTriangleAlert, LuMap, LuRoute,
  LuSlidersHorizontal, LuSatellite, LuTrendingUp, LuSettings, LuHexagon,
  LuScanSearch, LuLeaf, LuLayoutDashboard, LuFileText, LuTable2,
  LuDownload, LuGitCompare,
} from 'react-icons/lu'
import ExportModal from './components/ExportModal'

function loadParcelSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch (_) {}
  return { ...DEFAULT_SETTINGS }
}


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
  const toast = useToast()
  const { missions, loading, refresh } = useMissions()
  const [currentId, setCurrentId]       = useState(null)
  const [activeStress, setActiveStress] = useState([...STRESS_LEVELS])
  const [isCompareMode, setIsCompareMode] = useState(false)
  const [compareId, setCompareId]         = useState(null)
  const [currentView,  setCurrentView]    = useState('home')
  const [showManager,  setShowManager]    = useState(false)
  const [showHotspots, setShowHotspots]   = useState(false)
  const [selectedTrees, setSelectedTrees] = useState(null)
  const [showIDW, setShowIDW]             = useState(false)
  const [showRoute, setShowRoute]         = useState(false)
  const [showMCDA, setShowMCDA]           = useState(false)
  const [showSectors, setShowSectors]     = useState(false)
  const [weightStress, setWeightStress]   = useState(60)
  const [weightHeight, setWeightHeight]   = useState(40)
  const [hotspotRadius, setHotspotRadius] = useState(15)
  const [idwResolution, setIdwResolution] = useState(10)
  const [sectorCount,   setSectorCount]   = useState(3)
  const [sectorAngle,   setSectorAngle]   = useState(0)
  const [showHexbins,   setShowHexbins]   = useState(false)
  const [routeTarget,   setRouteTarget]   = useState('severe_eleve')
  const [routeMaxTrees, setRouteMaxTrees] = useState(50)

  // ── Paramètres persistants de la parcelle ────────────────────────────────────
  const [parcelSettings, setParcelSettings] = useState(loadParcelSettings)
  const prevViewRef = useRef('home')

  // ── Auto-déclenchement prédiction à l'ouverture de la vue prédictive ────────
  useEffect(() => {
    if (currentView !== 'predictive') return
    if (!yieldPredictions && !yieldLoading && currentMission?.has_shapefile) {
      handlePredictYield()
    }
  }, [currentView, currentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Détection d'anomalies ────────────────────────────────────────────────
  const [showAnomalies,  setShowAnomalies]  = useState(false)
  const [anomalyData,    setAnomalyData]    = useState(null)
  const [anomalyLoading, setAnomalyLoading] = useState(false)

  // ── Prédiction de rendement IA ───────────────────────────────────────────
  // yieldPredictions : dict { treeId → rendement_kg } pour lookup O(1) dans TreeMap
  // rendementData    : réponse complète GET /rendement (agrégats + prédictions)
  // mapMode          : 'stress' (défaut) | 'yield'
  const [yieldPredictions, setYieldPredictions] = useState(null)
  const [rendementData,    setRendementData]    = useState(null)
  const [mapMode,          setMapMode]          = useState('stress')
  const [yieldLoading,     setYieldLoading]     = useState(false)

  // ── Filtre IA carte (déclenché par l'agent chat) ─────────────────────────
  const [mapFilter, setMapFilter] = useState(null)

  // ── Modal export ─────────────────────────────────────────────────────────
  const [showExport, setShowExport] = useState(false)

  // ── Catalogue des arbres (toutes missions agrégées) ──────────────────────
  const [catalogFeatures, setCatalogFeatures] = useState([])
  const [catalogLoading,  setCatalogLoading]  = useState(false)
  const [flyToTree,       setFlyToTree]       = useState(null)

  // ── Filtres cross-critères (état global → source unique pour carte + stats) ─
  // null = inactif (toutes les valeurs passent) ; [min, max] = filtre actif.
  const [filterHauteur, setFilterHauteur] = useState(null)
  const [filterCwsi,    setFilterCwsi]    = useState(null)
  const [filterCirc,    setFilterCirc]    = useState(null)

  // Auto-sélectionne la première mission avec données au premier chargement
  const didInit = useRef(false)
  useEffect(() => {
    if (!loading && !didInit.current && missions.length > 0) {
      didInit.current = true
      const withData = missions.find(m => m.has_shapefile)
      setCurrentId(withData?.id || missions[0]?.id || null)
    }
  }, [loading, missions])

  // Charge toutes les features quand le catalogue est ouvert.
  useEffect(() => {
    if (currentView !== 'catalog') return
    const missionsWithData = missions.filter(m => m.has_shapefile)
    if (!missionsWithData.length) { setCatalogFeatures([]); return }
    let cancelled = false
    setCatalogLoading(true)
    setCatalogFeatures([])
    Promise.all(
      missionsWithData.map(m =>
        fetchTrees(m.id).then(g =>
          (g.features || []).map(f => ({
            ...f,
            properties: { ...f.properties, missionId: m.id, missionName: m.nom || m.id },
          }))
        )
      )
    )
    .then(all => { if (!cancelled) setCatalogFeatures(all.flat()) })
    .catch(err => { if (!cancelled) toast(err.message, 'error') })
    .finally(() => { if (!cancelled) setCatalogLoading(false) })
    return () => { cancelled = true }
  }, [currentView]) // eslint-disable-line react-hooks/exhaustive-deps

  // Charge les anomalies quand le mode est activé ; les efface quand il est coupé.
  useEffect(() => {
    if (!showAnomalies || !currentId) {
      setAnomalyData(null)
      return
    }
    let cancelled = false
    setAnomalyLoading(true)
    fetchAnomalies(currentId)
      .then(data => { if (!cancelled) setAnomalyData(data) })
      .catch(e   => { if (!cancelled) { toast(e.message, 'error'); setShowAnomalies(false) } })
      .finally(() => { if (!cancelled) setAnomalyLoading(false) })
    return () => { cancelled = true }
  }, [showAnomalies, currentId]) // eslint-disable-line react-hooks/exhaustive-deps

  const { geojson, stats, dataLoading } = useMissionData(currentId, missions)
  const { geojson: geojsonCompare, stats: statsCompare } =
    useMissionData(isCompareMode ? compareId : null, missions)

  const currentMission = missions.find(m => m.id === currentId)
  const compareMission = missions.find(m => m.id === compareId)
  const hasMapData = currentMission?.has_shapefile && geojson

  // ── Bornes réelles des données — alimentent MapFilterBar ───────────────────
  const dataRanges = useMemo(() => {
    const fallback = { hauteur: [0, 20], temp: [0, 60], cwsi: [0, 1] }
    if (!geojson?.features?.length) return fallback
    const hs = geojson.features.map(f => f.properties.chm_max ?? f.properties.hauteur).filter(v => v != null)
    const ts = geojson.features.map(f => f.properties.temp_moy).filter(v => v != null)
    const cs = geojson.features.map(f => f.properties.cwsi).filter(v => v != null)
    return {
      hauteur: hs.length ? [Math.floor(Math.min(...hs)),  Math.ceil(Math.max(...hs))]  : fallback.hauteur,
      temp:    ts.length ? [Math.floor(Math.min(...ts)),  Math.ceil(Math.max(...ts))]  : fallback.temp,
      cwsi:    cs.length ? [+Math.min(...cs).toFixed(2), +Math.max(...cs).toFixed(2)] : fallback.cwsi,
    }
  }, [geojson])

  // Plage de circonférence estimée dérivée de la plage de hauteur
  const circRange = useMemo(() => {
    const [hMin, hMax] = dataRanges.hauteur
    return [
      Math.floor(Math.PI * hMin * 0.6 * 100),
      Math.ceil(Math.PI  * hMax * 0.6 * 100),
    ]
  }, [dataRanges.hauteur])

  // ── GeoJSON filtré — source unique pour carte ET stats ─────────────────────
  const filteredGeojson = useMemo(() => {
    if (!geojson?.features?.length) return geojson
    if (!filterHauteur && !filterCwsi && !filterCirc) return geojson
    const features = geojson.features.filter(f => {
      const { hauteur, cwsi, chm_max } = f.properties
      const h = chm_max ?? hauteur
      if (filterHauteur && h    != null && (h    < filterHauteur[0] || h    > filterHauteur[1])) return false
      if (filterCwsi    && cwsi != null && (cwsi < filterCwsi[0]    || cwsi > filterCwsi[1]))    return false
      if (filterCirc    && h    != null) {
        const circCm = Math.PI * h * 0.6 * 100
        if (circCm < filterCirc[0] || circCm > filterCirc[1]) return false
      }
      return true
    })
    return { ...geojson, features }
  }, [geojson, filterHauteur, filterCwsi, filterCirc])

  // ── Stats zonales : recalculées côté client sur le sous-ensemble sélectionné
  const zonalStats = useMemo(
    () => selectedTrees ? computeZonalStats(selectedTrees) : null,
    [selectedTrees]
  )
  // Quand les filtres cross-critères sont actifs (sans sélection zonale),
  // on recalcule les stats sur le sous-ensemble filtré.
  const advancedFilterStats = useMemo(() => {
    if (selectedTrees || filteredGeojson === geojson) return null
    return filteredGeojson?.features?.length
      ? computeZonalStats(filteredGeojson.features)
      : null
  }, [filteredGeojson, geojson, selectedTrees])

  const displayStats = zonalStats ?? advancedFilterStats ?? stats

  // Calcul des indices de vulnérabilité MCDA (AHP) en temps réel
  const mcdaScores = useMemo(() => {
    if (!showMCDA || !geojson?.features?.length) return {}
    const stressScore = { aucun: 0, faible: 25, modere: 50, eleve: 75, severe: 100 }
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

  const KNOWN_STRESS = new Set(['aucun', 'faible', 'modere', 'eleve', 'severe'])
  const visibleCount = geojson?.features.filter(f => {
    const s = f.properties.stress
    if (!s || !KNOWN_STRESS.has(s)) return true   // inconnu → toujours compté visible
    return activeStress.includes(s)
  }).length ?? 0

  async function handlePredictYield() {
    if (!currentMission || yieldLoading) return
    setYieldLoading(true)
    try {
      // GET /rendement : prédictions + agrégats en un seul appel (singleton backend)
      const data = await fetchRendement(currentMission.id)
      const dict = {}
      data.predictions.forEach(p => { dict[p.tree_id] = p.rendement_kg })
      setYieldPredictions(dict)
      setRendementData(data)
      setMapMode('yield')
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setYieldLoading(false)
    }
  }

  function handleResetMode() {
    setMapMode('stress')
    setRendementData(null)
  }

  function handleMapAction(action) {
    if (!action || action.action === 'reset') {
      setMapFilter(null)
    } else {
      setMapFilter(action)
    }
  }

  function handleOpenSettings() {
    if (currentView !== 'settings') prevViewRef.current = currentView
    setCurrentView('settings')
  }

  function handleCloseSettings() {
    setCurrentView(prevViewRef.current || 'home')
  }

  function handleSettingsSaved(newSettings) {
    setParcelSettings(newSettings)
    setCurrentView(prevViewRef.current || 'home')
  }

  function handleSelect(id) {
    setFlyToTree(null)
    setCurrentId(id)
    setCurrentView('map')
    setActiveStress([...STRESS_LEVELS])
    setSelectedTrees(null)
    setFilterHauteur(null)
    setFilterCwsi(null)
    setFilterCirc(null)
    setShowAnomalies(false)
    setAnomalyData(null)
    setMapMode('stress')
    setYieldPredictions(null)
    setRendementData(null)
    setMapFilter(null)
    if (id === compareId) setCompareId(null)
  }

  function handleSelectTree(treeId, missionId) {
    const feat = catalogFeatures.find(
      f => f.properties.id === treeId && f.properties.missionId === missionId
    )
    setCurrentId(missionId)
    setCurrentView('map')
    setActiveStress([...STRESS_LEVELS])
    setSelectedTrees(null)
    if (feat?.geometry?.coordinates) {
      const [lng, lat] = feat.geometry.coordinates
      setFlyToTree({ lat, lng, key: Date.now() })
    }
  }

  function resetFilters() {
    setFilterHauteur(null)
    setFilterCwsi(null)
    setFilterCirc(null)
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

  console.log('[Render App] État showManager:', showManager);

  return (
    <div className="app">

      {/* ── HEADER ── */}
      <header className="header-bar" style={{ position: 'relative', zIndex: 2000 }}>
        <div className="brand">
          <img src={logoSvg} alt="Logo GeoOlive" className="brand-logo" />
          <h1>GeoOlive</h1>
        </div>

        <nav className="header-nav">
          <button
            className={`header-nav-btn${currentView === 'home' ? ' active' : ''}`}
            onClick={() => setCurrentView('home')}
          >
            <LuLayoutDashboard size={13} /> Synthèse
          </button>
          <button
            className={`header-nav-btn${currentView === 'map' ? ' active' : ''}`}
            onClick={() => setCurrentView('map')}
          >
            <LuMap size={13} /> Carte
          </button>
          {currentMission?.has_shapefile && (
            <button
              className={`header-nav-btn${currentView === 'report' ? ' active' : ''}`}
              onClick={() => setCurrentView('report')}
            >
              <LuFileText size={13} /> Rapport
            </button>
          )}
          {missions.some(m => m.has_shapefile) && (
            <button
              className={`header-nav-btn${currentView === 'catalog' ? ' active' : ''}`}
              onClick={() => setCurrentView('catalog')}
            >
              <LuTable2 size={13} /> Catalogue
            </button>
          )}
          {missions.some(m => m.has_shapefile) && (
            <button
              className={`header-nav-btn header-nav-btn--yield${currentView === 'predictive' ? ' active' : ''}`}
              onClick={() => {
                if (currentView !== 'predictive') prevViewRef.current = currentView
                setCurrentView('predictive')
              }}
            >
              <LuLeaf size={13} /> Prédictif
            </button>
          )}
          <button
            className={`header-nav-btn${currentView === 'settings' ? ' active' : ''}`}
            onClick={handleOpenSettings}
          >
            <LuSettings size={13} /> Paramètres
          </button>
        </nav>

        <div className="header-status">
          <div style={{ position: 'relative', zIndex: 1100 }}>
            <MissionSelector
              missions={missions}
              currentId={currentId}
              onSelect={handleSelect}
            />
          </div>

          <span className="header-sep" />

          {/* Bouton Extraire */}
          {currentMission?.has_shapefile && (
            <button
              className="btn-header-extract"
              onClick={() => setShowExport(true)}
              title="Extraire les données (Excel / PDF)"
            >
              <LuDownload size={14} /> Extraire
            </button>
          )}

          <button
            className={`btn-header-manage${showManager ? ' active' : ''}`}
            onClick={() => setShowManager(v => !v)}
            title="Gérer les missions"
          >
            <LuSettings size={14} /> Gérer
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
            <LuGitCompare size={13} />
            {isCompareMode ? 'Arrêter' : 'Comparer'}
          </button>
        </div>
      </header>

      {/* ── VUE PARAMÈTRES ── */}
      {currentView === 'settings' && (
        <ParcelSettings
          geojson={geojson}
          onClose={handleCloseSettings}
          onSaved={handleSettingsSaved}
        />
      )}

      {/* ── VUE SYNTHÈSE ── */}
      {currentView === 'home' && (
        <div className="dh-container">
          <DashboardHome
            missions={missions}
            onOpenMap={() => setCurrentView('map')}
          />
        </div>
      )}

      {/* ── VUE RAPPORT ── */}
      {currentView === 'report' && currentMission?.has_shapefile && (
        <div className="dh-container">
          <MissionReport
            mission={currentMission}
            stats={stats}
            features={filteredGeojson?.features ?? []}
            allFeatures={geojson?.features ?? []}
            onBack={() => setCurrentView('map')}
          />
        </div>
      )}

      {/* ── VUE CATALOGUE ── */}
      {currentView === 'catalog' && (
        <div className="tc-container">
          <TreeCatalog
            features={catalogFeatures}
            loading={catalogLoading}
            onSelectTree={handleSelectTree}
            onClose={() => setCurrentView('map')}
          />
        </div>
      )}

      {/* ── VUE ANALYSE PRÉDICTIVE ── */}
      {currentView === 'predictive' && (
        <PredictiveAnalysis
          yieldPredictions={yieldPredictions}
          features={geojson?.features ?? []}
          missions={missions}
          currentId={currentId}
          currentMission={currentMission}
          onPredictYield={handlePredictYield}
          yieldLoading={yieldLoading}
          onClose={() => setCurrentView(prevViewRef.current || 'home')}
        />
      )}

      {/* ── VUE CARTE ── */}
      {currentView === 'map' && <>

      {/* ── COLONNE GAUCHE : Missions & Statistiques ── */}
      <aside className="col-left">
        <div className="panel-float-header">
          <span className="panel-float-title">
            <LuSatellite size={14} />
            Missions & Statistiques
          </span>
        </div>

        <div className="panel-float-body">

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
                allFeatures={filteredGeojson?.features ?? []}
                anomalyData={anomalyData}
                yieldPredictions={yieldPredictions}
                onMapAction={handleMapAction}
                parcelSettings={parcelSettings}
                missions={missions}
                currentId={currentId}
                onSelectMission={handleSelect}
              />
          }

          {/* ── Groupes d'outils ── */}
          {hasMapData && (
            <div className="tools-container">

              {/* ── Groupe : Analyse ── */}
              <div className="tools-group">
                <div className="tools-group-label">🔬 Analyse</div>
                <div className="tools-grid">
                  <button
                    className={`tool-btn${showMCDA ? ' active' : ''}`}
                    onClick={() => setShowMCDA(v => !v)}
                    title="Analyse multicritère AHP"
                  >
                    <LuSlidersHorizontal size={12} /> Multicritère
                  </button>
                  <button
                    className={`tool-btn${showHotspots ? ' active' : ''}`}
                    onClick={() => setShowHotspots(v => !v)}
                    title="Analyser les zones de stress élevé"
                  >
                    <LuTriangleAlert size={12} /> Zones critiques
                  </button>
                  <button
                    className={`tool-btn${showAnomalies ? ' active' : ''}`}
                    onClick={() => setShowAnomalies(v => !v)}
                    disabled={anomalyLoading}
                    title="Détecter les arbres anomaux par IA"
                    style={{ gridColumn: '1 / -1' }}
                  >
                    <LuScanSearch size={12} />
                    {anomalyLoading ? 'Analyse en cours…' : showAnomalies ? 'Masquer les anomalies' : 'Détection anomalies IA'}
                  </button>
                </div>
                {showMCDA && (
                  <MCDAPanel
                    weightStress={weightStress}
                    weightHeight={weightHeight}
                    onChange={(wS, wH) => { setWeightStress(wS); setWeightHeight(wH) }}
                  />
                )}
                {showHotspots && (
                  <div className="tool-param">
                    <div className="tool-param-row">
                      <label>Rayon de fusion</label>
                      <span>{hotspotRadius} m</span>
                    </div>
                    <input type="range" className="tool-range" min={5} max={30} step={1} value={hotspotRadius}
                      onChange={e => setHotspotRadius(Number(e.target.value))} />
                  </div>
                )}
              </div>

              {/* ── Groupe : Visualisation ── */}
              <div className="tools-group">
                <div className="tools-group-label">🗺️ Visualisation carte</div>
                <div className="tools-grid">
                  <button
                    className={`tool-btn${showIDW ? ' active' : ''}`}
                    onClick={() => setShowIDW(v => !v)}
                    title="Surface continue par interpolation IDW"
                  >
                    <LuMap size={12} /> Surface IDW
                  </button>
                  <button
                    className={`tool-btn${showHexbins ? ' active' : ''}`}
                    onClick={() => setShowHexbins(v => !v)}
                    title="Densité par maillage hexagonal"
                  >
                    <LuHexagon size={12} /> Hexagones
                  </button>
                </div>
                {showIDW && (
                  <div className="tool-param">
                    <div className="tool-param-row">
                      <label>Taille des cellules</label>
                      <span>{idwResolution} m</span>
                    </div>
                    <input type="range" className="tool-range" min={5} max={30} step={1} value={idwResolution}
                      onChange={e => setIdwResolution(Number(e.target.value))} />
                    <p className="tool-param-hint">⚠ Valeur faible = calcul plus lourd</p>
                  </div>
                )}
              </div>

              {/* ── Groupe : Planification ── */}
              <div className="tools-group">
                <div className="tools-group-label">🛣️ Planification terrain</div>
                <div className="tools-grid">
                  <button
                    className={`tool-btn${showRoute ? ' active' : ''}`}
                    onClick={() => setShowRoute(v => !v)}
                    title="Générer la tournée d'inspection optimale"
                  >
                    <LuRoute size={12} /> Tournée
                  </button>
                  <button
                    className={`tool-btn${showSectors ? ' active' : ''}`}
                    onClick={() => setShowSectors(v => !v)}
                    title="Délimiter les secteurs d'irrigation"
                  >
                    <LuDroplets size={12} /> Secteurs
                  </button>
                </div>
                {showRoute && (
                  <div className="tool-param">
                    <div className="tool-param-row">
                      <label>Cible</label>
                    </div>
                    <select
                      className="cwsi-method-select"
                      value={routeTarget}
                      onChange={e => setRouteTarget(e.target.value)}
                    >
                      <option value="severe_eleve">Stress sévère + élevé</option>
                      <option value="severe">Stress sévère uniquement</option>
                      <option value="all">Tous les arbres</option>
                    </select>
                    <div className="tool-param-row" style={{ marginTop: 4 }}>
                      <label>Limite d'arbres</label>
                      <span>{routeMaxTrees}</span>
                    </div>
                    <input
                      type="range" className="tool-range"
                      min={10} max={200} step={5}
                      value={routeMaxTrees}
                      onChange={e => setRouteMaxTrees(Number(e.target.value))}
                    />
                    <p className="tool-param-hint">🏠 Déplacez le marqueur pour changer le dépôt</p>
                  </div>
                )}
                {showSectors && (
                  <div className="tool-param">
                    <div className="tool-param-row">
                      <label>Nombre de secteurs</label>
                      <span>{sectorCount}</span>
                    </div>
                    <input type="range" className="tool-range" min={2} max={6} step={1} value={sectorCount}
                      onChange={e => setSectorCount(Number(e.target.value))} />
                    <div className="tool-param-row" style={{ marginTop: 6 }}>
                      <label>Orientation des rangées</label>
                      <span>{sectorAngle}°</span>
                    </div>
                    <input type="range" className="tool-range" min={0} max={180} step={1} value={sectorAngle}
                      onChange={e => setSectorAngle(Number(e.target.value))} />
                    <p className="tool-param-hint">↔ 0° = bandes N/S · 90° = bandes E/O</p>
                  </div>
                )}
              </div>

              {/* ── Groupe : IA Rendement ── */}
              <div className="tools-group">
                <div className="tools-group-label">🌿 Rendement IA</div>
                <div className="tools-grid">
                  <button
                    className={`tool-btn yield-accent${mapMode === 'yield' ? ' active' : ''}`}
                    onClick={mapMode === 'yield' ? handleResetMode : handlePredictYield}
                    disabled={yieldLoading}
                    style={{ gridColumn: '1 / -1' }}
                  >
                    <LuLeaf size={12} />
                    {yieldLoading ? '⏳ Calcul en cours…' : mapMode === 'yield' ? '💧 Revenir au mode stress' : '✨ Prédire le rendement'}
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>
      </aside>

      {/* ── CARTE CENTRALE ── */}
      <main className="col-map">

        {/* ── Barre de filtres flottante (bas gauche) ── */}
        <MapFilterBar
          filterCwsi={filterCwsi}
          onCwsiChange={setFilterCwsi}
          cwsiRange={dataRanges.cwsi}
          filterHauteur={filterHauteur}
          onHauteurChange={setFilterHauteur}
          hauteurRange={dataRanges.hauteur}
          filterCirc={filterCirc}
          onCircChange={setFilterCirc}
          circRange={circRange}
          onReset={resetFilters}
          filteredCount={filteredGeojson?.features?.length ?? 0}
          totalCount={geojson?.features?.length ?? 0}
        />

        <TreeMap
          geojson={filteredGeojson}
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
          routeTarget={routeTarget}
          routeMaxTrees={routeMaxTrees}
          showMCDA={showMCDA}
          mcdaScores={mcdaScores}
          showSectors={showSectors}
          showHexbins={showHexbins}
          hotspotRadius={hotspotRadius}
          idwResolution={idwResolution}
          sectorCount={sectorCount}
          sectorAngle={sectorAngle}
          dataRanges={dataRanges}
          filterHauteur={filterHauteur}
          filterCwsi={filterCwsi}
          filterCirc={filterCirc}
          onHauteurChange={setFilterHauteur}
          onCwsiChange={setFilterCwsi}
          onCircChange={setFilterCirc}
          onFilterReset={resetFilters}
          totalCount={geojson?.features?.length ?? 0}
          showAnomalies={showAnomalies}
          anomalyData={anomalyData}
          anomalyLoading={anomalyLoading}
          onToggleAnomalies={() => setShowAnomalies(v => !v)}
          mapMode={mapMode}
          yieldPredictions={yieldPredictions}
          mapFilter={mapFilter}
          onMapFilterReset={() => setMapFilter(null)}
          flyToTree={flyToTree}
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

          {rendementData && mapMode === 'yield' && (
            <RendementPanel
              data={rendementData}
              onClose={handleResetMode}
            />
          )}

          <TrendPanel missions={missions} currentId={currentId} geojson={filteredGeojson} onSelectMission={handleSelect} />

          {anomalyData && <AnomalyPanel anomalyData={anomalyData} />}

          <Legend
            activeStress={activeStress}
            onToggle={hasMapData ? toggleStress : undefined}
            visibleCount={hasMapData ? visibleCount : null}
            stressCounts={displayStats?.stress_breakdown}
          />
        </div>
      </aside>

      {/* ── fin VUE CARTE ── */}
      </>}

      {/* ── Modal export ── */}
      {showExport && currentMission && (
        <ExportModal
          mission={currentMission}
          selectedTreeIds={selectedTrees?.map(f => f.properties.id) ?? null}
          onClose={() => setShowExport(false)}
        />
      )}

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