import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  LuSettings, LuX, LuPlus, LuTrash2, LuUpload,
  LuCheck, LuFileText, LuSatellite, LuCalendar, LuThermometer, LuCloud, LuSlidersHorizontal,
} from 'react-icons/lu'
import { createMission, updateMission, deleteMission, uploadShapefile, uploadOrtho, deleteOrtho, computeCwsi } from '../api'
import { useToast } from '../hooks/useToast'
import ConfirmModal from './ConfirmModal'

const DEFAULT_THRESHOLDS = {
  aucun:  [0.00, 0.20],
  faible: [0.20, 0.35],
  modere: [0.35, 0.50],
  eleve:  [0.50, 0.75],
  severe: [0.75, 1.00],
}

const THRESH_META = [
  { key: 'aucun',  label: 'Aucun stress',  color: '#2ecc71' },
  { key: 'faible', label: 'Stress faible',  color: '#f1c40f' },
  { key: 'modere', label: 'Stress modéré',  color: '#e67e22' },
  { key: 'eleve',  label: 'Stress élevé',   color: '#e74c3c' },
  { key: 'severe', label: 'Stress sévère',  color: '#8e44ad' },
]

/* ── Panneau d'administration des missions ───────────────────────────────── */
export default function MissionManager({ missions, onRefresh, onClose, onMissionDeleted }) {
  const toast = useToast()
  const [managedId,     setManagedId]     = useState(missions[0]?.id ?? null)
  const [showCreate,    setShowCreate]    = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  const managed = missions.find(m => m.id === managedId) ?? null

  async function handleDeleteConfirm() {
    const deletedId = pendingDelete
    try {
      await deleteMission(deletedId)
      toast('Mission supprimée.', 'success')
      const next = missions.find(m => m.id !== deletedId)
      setManagedId(next?.id ?? null)
      // Désélectionne la mission dans la carte si c'était la mission active
      onMissionDeleted?.(deletedId)
      onRefresh()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setPendingDelete(null)
    }
  }

  return createPortal(
    <>
      <div className="mm-backdrop" onClick={onClose}>
        <div className="mm-panel" onClick={e => e.stopPropagation()}>

          {/* ── En-tête ── */}
          <div className="mm-header">
            <span className="mm-title">
              <LuSettings size={18} /> Gestion des missions
            </span>
            <button className="mm-close" onClick={onClose} title="Fermer">
              <LuX size={18} />
            </button>
          </div>

          {/* ── Corps ── */}
          <div className="mm-body">

            {/* Colonne gauche : liste */}
            <aside className="mm-list">
              <div className="mm-list-header">
                <button
                  className="mm-btn-new"
                  onClick={() => { setShowCreate(true); setManagedId(null) }}
                >
                  <LuPlus size={14} /> Nouvelle mission
                </button>
              </div>
              <div className="mm-missions">
                {missions.map(m => (
                  <button
                    key={m.id}
                    className={`mm-mission-item${managedId === m.id && !showCreate ? ' active' : ''}`}
                    onClick={() => { setManagedId(m.id); setShowCreate(false) }}
                  >
                    <span className="mm-mission-name">{m.nom || m.id}</span>
                    <span className="mm-mission-meta">
                      {m.date} · {m.has_shapefile ? '✓ données' : '⚠️ sans données'}
                    </span>
                  </button>
                ))}
                {missions.length === 0 && (
                  <p className="mm-list-empty">Aucune mission. Créez-en une !</p>
                )}
              </div>
            </aside>

            {/* Colonne droite : détail */}
            <section className="mm-detail">
              {showCreate ? (
                <CreateForm
                  onCreated={m => { onRefresh(); setManagedId(m.id); setShowCreate(false) }}
                  onCancel={() => { setShowCreate(false); setManagedId(managed?.id ?? missions[0]?.id ?? null) }}
                />
              ) : managed ? (
                <MissionDetail
                  key={managed.id}
                  mission={managed}
                  onRefresh={onRefresh}
                  onDelete={() => setPendingDelete(managed.id)}
                />
              ) : (
                <div className="mm-empty">
                  Sélectionnez une mission dans la liste<br />ou créez-en une nouvelle.
                </div>
              )}
            </section>

          </div>
        </div>
      </div>

      {pendingDelete && (
        <ConfirmModal
          title="Supprimer la mission"
          message={`Toutes les données de « ${pendingDelete} » seront définitivement supprimées. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          danger
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>,
    document.body
  )
}

/* ── Détail d'une mission ────────────────────────────────────────────────── */
function MissionDetail({ mission, onRefresh, onDelete }) {
  const toast = useToast()
  const [nom,            setNom]            = useState(mission.nom || '')
  const [nomBusy,        setNomBusy]        = useState(false)
  const [dragging,       setDragging]       = useState(false)
  const [shpBusy,        setShpBusy]        = useState(false)
  const [shpError,       setShpError]       = useState(null)
  const [orthoUploading,  setOrthoUploading]  = useState(null)
  const [orthoError,      setOrthoError]      = useState(null)
  const [orthoDeleting,   setOrthoDeleting]   = useState(null)
  const [pendingOrtho,    setPendingOrtho]    = useState(null)
  const [cwsiMethod,      setCwsiMethod]      = useState('empirical')
  const [isCalculating,   setIsCalculating]   = useState(false)
  const [progress,        setProgress]        = useState(0)
  const [meteoForm,       setMeteoForm]       = useState({
    temp_air: mission.meteo?.temp_air ?? '',
    humidite: mission.meteo?.humidite ?? '',
    vent:     mission.meteo?.vent     ?? '',
  })
  const [meteoBusy,       setMeteoBusy]       = useState(false)
  const [threshForm,      setThreshForm]      = useState(
    mission.cwsi_thresholds
      ? Object.fromEntries(Object.entries(mission.cwsi_thresholds).map(([k, v]) => [k, [...v]]))
      : Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([k, v]) => [k, [...v]]))
  )
  const [threshBusy,      setThreshBusy]      = useState(false)
  const [showCalibration, setShowCalibration] = useState(false)
  const [showAdvanced,    setShowAdvanced]    = useState(false)
  const [showThresholds,  setShowThresholds]  = useState(false)
  const [calcError,       setCalcError]       = useState(null)

  // Vrai uniquement si au moins un champ météo diffère de la valeur enregistrée
  const toNum = v => (v === '' || v == null) ? null : parseFloat(v)
  const isMeteoModified =
    toNum(meteoForm.temp_air) !== (mission.meteo?.temp_air ?? null) ||
    toNum(meteoForm.humidite) !== (mission.meteo?.humidite ?? null) ||
    toNum(meteoForm.vent)     !== (mission.meteo?.vent     ?? null)

  async function saveThresholds() {
    setThreshBusy(true)
    try {
      await updateMission(mission.id, { cwsi_thresholds: threshForm })
      toast('Seuils CWSI enregistrés.', 'success')
      onRefresh()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setThreshBusy(false)
    }
  }

  function resetThresholds() {
    setThreshForm(Object.fromEntries(Object.entries(DEFAULT_THRESHOLDS).map(([k, v]) => [k, [...v]])))
  }

  async function saveName() {
    if (nom === mission.nom || nomBusy) return
    setNomBusy(true)
    try {
      await updateMission(mission.id, { nom })
      toast('Nom enregistré.', 'success')
      onRefresh()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setNomBusy(false)
    }
  }

  async function uploadShp(files) {
    setShpBusy(true); setShpError(null)
    try {
      await uploadShapefile(mission.id, files)
      toast('Données spatiales importées !', 'success')
      onRefresh()
    } catch (e) {
      const msg = e.message || "Erreur lors de l'importation du fichier"
      setShpError(msg)
      toast(msg, 'error')
    } finally {
      setShpBusy(false)
    }
  }

  async function handleDeleteOrtho() {
    const { type, fmt } = pendingOrtho
    setPendingOrtho(null)
    setOrthoDeleting({ type, fmt }); setOrthoError(null)
    try {
      await deleteOrtho(mission.id, type, fmt)
      const label    = type === 'rgb' ? 'RGB' : 'Thermique'
      const fmtLabel = fmt === 'zip' ? 'Tuiles' : 'GeoTIFF'
      toast(`${fmtLabel} ${label} supprimé.`, 'success')
      onRefresh()
    } catch (e) {
      setOrthoError(e.message)
    } finally {
      setOrthoDeleting(null)
    }
  }

  async function saveMeteo() {
    setMeteoBusy(true)
    try {
      await updateMission(mission.id, {
        meteo: {
          temp_air: meteoForm.temp_air !== '' ? parseFloat(meteoForm.temp_air) : null,
          humidite: meteoForm.humidite !== '' ? parseFloat(meteoForm.humidite) : null,
          vent:     meteoForm.vent     !== '' ? parseFloat(meteoForm.vent)     : null,
        },
      })
      toast('Conditions météo enregistrées.', 'success')
      onRefresh()
    } catch (e) {
      toast(e.message, 'error')
    } finally {
      setMeteoBusy(false)
    }
  }

  async function handleComputeCwsi() {
    setCalcError(null)
    setIsCalculating(true)
    setProgress(20)
    const t1 = setTimeout(() => setProgress(50), 600)
    const t2 = setTimeout(() => setProgress(80), 1400)
    try {
      const result = await computeCwsi(mission.id, cwsiMethod)
      setProgress(100)
      if (result.status === 'already_computed') {
        toast('CWSI déjà calculé pour cette mission.', 'info')
      } else {
        toast(
          `CWSI calculé sur ${result.n_updated} arbres · T_wet = ${result.t_wet} °C · T_dry = ${result.t_dry} °C`,
          'success'
        )
      }
      onRefresh()
    } catch (e) {
      setCalcError(e.message)
    } finally {
      clearTimeout(t1); clearTimeout(t2)
      setTimeout(() => { setIsCalculating(false); setProgress(0) }, 700)
    }
  }

  async function handleOrtho(type, fmt, file) {
    setOrthoUploading({ type, fmt }); setOrthoError(null)
    try {
      await uploadOrtho(mission.id, type, file)
      const label  = type === 'rgb' ? 'RGB' : 'Thermique'
      const fmtMsg = fmt === 'zip' ? '(tuiles XYZ)' : '(GeoTIFF brut)'
      toast(`Orthomosaïque ${label} ${fmtMsg} importée !`, 'success')
      onRefresh()
    } catch (e) {
      setOrthoError(e.message)
    } finally {
      setOrthoUploading(null)
    }
  }

  return (
    <div className="mm-detail-inner">

      {/* Informations */}
      <div className="mm-section">
        <h3><LuFileText size={14} /> Informations</h3>
        <div className="mm-name-row">
          <input
            className="mm-name-input"
            value={nom}
            onChange={e => setNom(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveName()}
            placeholder="Nom de la mission"
          />
          <button
            className="mm-btn-save"
            onClick={saveName}
            disabled={nomBusy || nom === mission.nom}
          >
            <LuCheck size={14} />
            {nomBusy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
        <div className="mm-meta-chips">
          <span className="mm-meta-chip"><LuCalendar size={11} /> {mission.date}</span>
          {mission.meteo?.temp_air != null && <span className="mm-meta-chip">🌡 {mission.meteo.temp_air} °C</span>}
          {mission.meteo?.humidite != null && <span className="mm-meta-chip">💧 {mission.meteo.humidite} %</span>}
          {mission.meteo?.vent     != null && <span className="mm-meta-chip">💨 {mission.meteo.vent} m/s</span>}
        </div>
      </div>

      {/* Données spatiales */}
      <div className="mm-section">
        <h3><LuUpload size={14} /> Données spatiales (Shapefile · GeoPackage)</h3>
        <div
          className={`mm-dropzone${dragging ? ' dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); uploadShp(Array.from(e.dataTransfer.files)) }}
          onClick={() => document.getElementById(`shp-${mission.id}`).click()}
          role="button" tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && document.getElementById(`shp-${mission.id}`).click()}
        >
          {shpBusy ? (
            <><div className="mm-dropzone-spinner" /><span>Import en cours…</span></>
          ) : mission.has_shapefile ? (
            <><span className="mm-drop-ok">✓</span><span>Données présentes</span><small>Déposez ici pour remplacer</small></>
          ) : (
            <><span className="mm-dropzone-icon">📁</span><b>Déposer le shapefile ici</b><small>.zip ou .shp .shx .dbf .prj · .gpkg</small></>
          )}
          <input
            id={`shp-${mission.id}`} type="file" multiple hidden
            accept=".shp,.shx,.dbf,.prj,.cpg,.zip,.gpkg"
            onChange={e => uploadShp(Array.from(e.target.files))}
          />
        </div>
        {shpError && <div className="error">⚠️ {shpError}</div>}
      </div>

      {/* Images / orthomosaïques */}
      <div className="mm-section">
        <h3><LuSatellite size={14} /> Images de la mission</h3>

        {['rgb', 'thermal'].map(type => {
          const typeLabel = type === 'rgb' ? 'RGB' : 'Thermique'
          const hasZip = type === 'thermal'
            ? (mission.has_thermal_zip ?? false)
            : ((mission.ortho_status?.[type]?.has_zip) ?? (mission.ortho_formats?.[type] === 'zip'))
          const fmt = 'zip'
          const busyUpload = orthoUploading?.type === type && orthoUploading?.fmt === fmt
          const busyDelete = orthoDeleting?.type  === type && orthoDeleting?.fmt  === fmt
          const busy = busyUpload || busyDelete
          return (
            <div key={type} className="ortho-type-block">
              <div className="ortho-type-label">{type === 'rgb' ? '🌿' : '🌡'} {typeLabel}</div>
              <div className="ortho-fmt-row">
                <span className="ortho-fmt-icon">📁</span>
                <span className="ortho-fmt-label">Tuiles d&apos;affichage (ZIP)</span>
                {hasZip ? (
                  <span className="ortho-fmt-status ortho-fmt-ok">✓ Présent</span>
                ) : (
                  <span className="ortho-fmt-status ortho-fmt-missing">— Absent</span>
                )}
                <div className="ortho-fmt-actions">
                  {busy ? (
                    <span className="ortho-row-busy">
                      <div className="mm-dropzone-spinner" style={{ width: 12, height: 12 }} />
                      {busyUpload ? 'Import…' : 'Suppression…'}
                    </span>
                  ) : (
                    <>
                      <label className="ortho-row-btn ortho-row-btn-upload" title="Importer les tuiles ZIP">
                        <LuUpload size={12} />
                        <input
                          type="file" hidden accept=".zip"
                          onChange={e => e.target.files[0] && handleOrtho(type, fmt, e.target.files[0])}
                        />
                      </label>
                      {hasZip && (
                        <button
                          className="ortho-row-btn ortho-row-btn-delete"
                          title="Supprimer les tuiles"
                          onClick={() => setPendingOrtho({ type, fmt })}
                        >
                          <LuTrash2 size={12} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {orthoError && <div className="error">⚠️ {orthoError}</div>}
      </div>

      {/* ── Confirmation suppression ortho ── */}
      {pendingOrtho && (
        <ConfirmModal
          title="Supprimer l'orthomosaïque"
          message={`Les fichiers ${pendingOrtho.fmt === 'zip' ? 'Tuiles (ZIP)' : 'GeoTIFF (TIF)'} ${pendingOrtho.type === 'rgb' ? 'RGB' : 'Thermique'} seront définitivement supprimés. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          danger
          onConfirm={handleDeleteOrtho}
          onCancel={() => setPendingOrtho(null)}
        />
      )}

      {/* ── Toggle : paramètres avancés (Météo + CWSI) ── */}
      <button
        className="mm-toggle-section"
        onClick={() => setShowAdvanced(v => !v)}
      >
        <span>⚙️ {showAdvanced ? 'Masquer les paramètres de calcul' : 'Modifier les paramètres et recalculer'}</span>
        <span className="mm-toggle-chevron">{showAdvanced ? '▲' : '▼'}</span>
      </button>

      {showAdvanced && (
        <>
          {/* ── BLOC 1 : Météo éditable ── */}
          <div className="mm-section mm-section-inset">
            <h3><LuCloud size={14} /> Conditions météo au vol</h3>
            <div className="mission-form">
              <div className="weather-grid">
                <div className="form-group">
                  <label>T° air (°C)</label>
                  <input
                    type="number" step="0.1" placeholder="ex : 32.5"
                    value={meteoForm.temp_air}
                    onChange={e => setMeteoForm(f => ({ ...f, temp_air: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Humidité (%)</label>
                  <input
                    type="number" step="1" placeholder="ex : 45"
                    value={meteoForm.humidite}
                    onChange={e => setMeteoForm(f => ({ ...f, humidite: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label>Vent (m/s)</label>
                  <input
                    type="number" step="0.1" placeholder="ex : 2.5"
                    value={meteoForm.vent}
                    onChange={e => setMeteoForm(f => ({ ...f, vent: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            {isMeteoModified && (
              <button
                className="mm-btn-save"
                onClick={saveMeteo}
                disabled={meteoBusy}
                style={{ alignSelf: 'flex-start' }}
              >
                <LuCheck size={14} />
                {meteoBusy ? 'Enregistrement…' : 'Sauvegarder la météo'}
              </button>
            )}
          </div>

          {/* ── BLOC 2 : Calcul CWSI ── */}
          <div className="mm-section mm-section-inset">
            <h3><LuThermometer size={14} /> Calcul du stress hydrique (CWSI)</h3>

            {/* Sélecteur de méthode + bouton de calcul */}
            <div className="cwsi-compute-row">
              <select
                className="cwsi-method-select"
                value={cwsiMethod}
                onChange={e => setCwsiMethod(e.target.value)}
                disabled={isCalculating}
              >
                <option value="empirical">Méthode Empirique (T_air + 5 °C)</option>
                <option value="bian_2019">Méthode Statistique (Bian 2019)</option>
              </select>
              <button
                className="cwsi-compute-btn"
                onClick={handleComputeCwsi}
                disabled={isCalculating || !mission.has_shapefile}
                title={
                  !mission.has_shapefile
                    ? "Importez d'abord le fichier spatial (avec colonne temp_moy)"
                    : 'Lancer le calcul CWSI'
                }
              >
                {isCalculating
                  ? <><div className="mm-dropzone-spinner" style={{ width: 13, height: 13 }} /> Calcul…</>
                  : '⚡ Recalculer le CWSI'}
              </button>
            </div>

            {/* Bouton constantes scientifiques */}
            <button className="btn-secondary" onClick={() => setShowCalibration(!showCalibration)}>
              📊 {showCalibration ? 'Masquer' : 'Afficher'} les constantes
            </button>

            {/* Encart T_wet / T_dry */}
            {showCalibration && (mission.cwsi_results ?? mission.cwsi_calibration) && (() => {
              const cal = mission.cwsi_results ?? mission.cwsi_calibration
              return (
                <div className="cwsi-sci-panel">
                  <div className="cwsi-sci-header">
                    <span className="cwsi-sci-title">Constantes de calibration</span>
                    <span className="cwsi-sci-date">
                      {new Date(cal.computed_at).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <pre className="cwsi-sci-code">{[
                    `Méthode : ${cal.method === 'empirical' ? 'Empirique (T_air + 5 °C)' : 'Statistique (Bian 2019)'}`,
                    cal.temp_air != null ? `T_air   : ${cal.temp_air} °C` : null,
                    `T_wet   : ${cal.t_wet} °C`,
                    `T_dry   : ${cal.t_dry} °C`,
                    ``,
                    `CWSI = (T_feuille − T_wet) / (T_dry − T_wet)`,
                    `     = clip( résultat, 0.0, 1.0 )`,
                    cal.n_updated != null ? `` : null,
                    cal.n_updated != null ? `Arbres traités : ${cal.n_updated} / ${cal.n_trees}` : null,
                  ].filter(l => l !== null).join('\n')}</pre>
                </div>
              )
            })()}

            {/* Barre de progression */}
            {isCalculating && (
              <div className="cwsi-progress-wrap">
                <div className="cwsi-progress-bar">
                  <div className="cwsi-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <span className="cwsi-progress-pct">{progress} %</span>
              </div>
            )}

            {/* Erreur inline du calcul CWSI */}
            {calcError && (
              <div className="cwsi-calc-error">
                <span className="cwsi-calc-error-icon">⚠️</span>
                <span>{calcError}</span>
                <button
                  className="cwsi-calc-error-close"
                  onClick={() => setCalcError(null)}
                  title="Fermer"
                >✕</button>
              </div>
            )}

            {/* Avertissements contextuels */}
            {cwsiMethod === 'empirical' && mission.meteo?.temp_air == null && (
              <p className="cwsi-warn">
                ⚠️ La méthode empirique requiert la température de l&apos;air (T° air).
                Renseignez-la dans la section Météo ci-dessus.
              </p>
            )}
            {!mission.has_shapefile && (
              <p className="cwsi-warn">
                ⚠️ Aucun fichier spatial importé — importez un Shapefile ou GeoPackage contenant la colonne temp_moy.
              </p>
            )}
          </div>
        </>
      )}

      {/* Bouton toggle constantes scientifiques — toujours accessible */}
      {mission.cwsi_results && (
        <button
          className="mm-toggle-section mm-toggle-section--secondary"
          onClick={() => setShowCalibration(v => !v)}
        >
          <span>📊 {showCalibration ? 'Masquer' : 'Afficher'} les constantes scientifiques</span>
          <span className="mm-toggle-chevron">{showCalibration ? '▲' : '▼'}</span>
        </button>
      )}

      {/* Encart constantes scientifiques */}
      {showCalibration && mission.cwsi_results && (
        <div className="cwsi-sci-panel">
          <div className="cwsi-sci-header">
            <span className="cwsi-sci-title">Paramètres de calibration</span>
            <span className="cwsi-sci-date">
              {new Date(mission.cwsi_results.computed_at).toLocaleString('fr-FR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </span>
          </div>
          <pre className="cwsi-sci-code">{[
            `Méthode   : ${mission.cwsi_results.method === 'empirical' ? 'Empirique (T_air + 5 °C)' : 'Statistique (Bian 2019)'}`,
            mission.cwsi_results.temp_air != null
              ? `T_air     : ${mission.cwsi_results.temp_air} °C`
              : null,
            `T_wet     : ${mission.cwsi_results.t_wet} °C`,
            `T_dry     : ${mission.cwsi_results.t_dry} °C`,
            ``,
            `CWSI = (T_feuille − T_wet) / (T_dry − T_wet)`,
            `     = clip( résultat, 0.0, 1.0 )`,
            ``,
            `Arbres traités : ${mission.cwsi_results.n_updated} / ${mission.cwsi_results.n_trees}`,
          ].filter(l => l !== null).join('\n')}</pre>
        </div>
      )}

      {/* ── Toggle : seuils de stress ── */}
      <button
        className="mm-toggle-section mm-toggle-section--secondary"
        onClick={() => setShowThresholds(v => !v)}
      >
        <span>🎛️ {showThresholds ? 'Masquer les seuils' : 'Personnaliser les seuils de stress'}</span>
        <span className="mm-toggle-chevron">{showThresholds ? '▲' : '▼'}</span>
      </button>

      {/* ── BLOC 3 : Seuils CWSI personnalisés ── */}
      {showThresholds && (
        <div className="mm-section mm-section-inset">
          <h3><LuSlidersHorizontal size={14} /> Seuils de stress hydrique (CWSI)</h3>
          <p className="cwsi-thresh-hint">
            Personnalisez les plages CWSI pour cette mission. La classification des arbres sera recalculée automatiquement.
          </p>
          <table className="cwsi-thresh-table">
            <thead>
              <tr>
                <th>Niveau</th>
                <th>Min</th>
                <th>Max</th>
              </tr>
            </thead>
            <tbody>
              {THRESH_META.map(({ key, label, color }) => (
                <tr key={key}>
                  <td>
                    <span className="thresh-swatch" style={{ background: color }} />
                    {label}
                  </td>
                  <td>
                    <input
                      type="number" step="0.01" min="0" max="1"
                      className="thresh-input"
                      value={threshForm[key]?.[0] ?? ''}
                      onChange={e => setThreshForm(f => ({
                        ...f, [key]: [parseFloat(e.target.value) || 0, f[key][1]]
                      }))}
                    />
                  </td>
                  <td>
                    <input
                      type="number" step="0.01" min="0" max="99"
                      className="thresh-input"
                      value={threshForm[key]?.[1] ?? ''}
                      onChange={e => setThreshForm(f => ({
                        ...f, [key]: [f[key][0], parseFloat(e.target.value) || 0]
                      }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="thresh-actions">
            <button className="btn-secondary" onClick={resetThresholds} disabled={threshBusy}>
              Réinitialiser
            </button>
            <button className="mm-btn-save" onClick={saveThresholds} disabled={threshBusy}>
              <LuCheck size={14} />
              {threshBusy ? 'Enregistrement…' : 'Sauvegarder les seuils'}
            </button>
          </div>
        </div>
      )}

      {/* Zone danger */}
      <div className="mm-danger-zone">
        <button className="mm-btn-delete" onClick={onDelete}>
          <LuTrash2 size={15} /> Supprimer cette mission
        </button>
      </div>

    </div>
  )
}

/* ── Formulaire de création ───────────────────────────────────────────────── */
function CreateForm({ onCreated, onCancel }) {
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    date: today, nom: '', notes: '',
    temp_air: '', humidite: '', vent: '',
  })
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const payload = {
        date:     form.date,
        nom:      form.nom,
        notes:    form.notes,
        temp_air: form.temp_air !== '' ? parseFloat(form.temp_air) : null,
        humidite: form.humidite !== '' ? parseFloat(form.humidite) : null,
        vent:     form.vent     !== '' ? parseFloat(form.vent)     : null,
      }
      const m = await createMission(payload)
      toast(`Mission « ${m.nom || m.id} » créée.`, 'success')
      onCreated(m)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="mm-create-form">
      <div className="mm-section">
        <h3><LuPlus size={14} /> Nouvelle mission</h3>
      </div>
      <form onSubmit={submit} className="mission-form">
        <div className="form-group">
          <label>Date *</label>
          <input type="date" value={form.date} onChange={set('date')} required />
        </div>
        <div className="form-group">
          <label>Nom de la mission</label>
          <input type="text" value={form.nom} onChange={set('nom')}
            placeholder="ex : Parcelle Nord – Aïn Tizgha" />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea value={form.notes} onChange={set('notes')} rows={3}
            placeholder="Conditions de vol, observations…" />
        </div>
        <div className="weather-section">
          <p className="section-title">Météo au moment du vol (optionnel)</p>
          <div className="weather-grid">
            <div className="form-group">
              <label>T° air (°C)</label>
              <input type="number" step="0.1" value={form.temp_air} onChange={set('temp_air')} placeholder="22.5" />
            </div>
            <div className="form-group">
              <label>Humidité (%)</label>
              <input type="number" step="1" value={form.humidite} onChange={set('humidite')} placeholder="45" />
            </div>
            <div className="form-group">
              <label>Vent (m/s)</label>
              <input type="number" step="0.1" value={form.vent} onChange={set('vent')} placeholder="2.5" />
            </div>
          </div>
        </div>
        {error && <div className="error">⚠️ {error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? '⏳ Création…' : 'Créer la mission'}
          </button>
        </div>
      </form>
    </div>
  )
}
