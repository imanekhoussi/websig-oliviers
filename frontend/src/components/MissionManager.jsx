import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  LuSettings, LuX, LuPlus, LuTrash2, LuUpload,
  LuCheck, LuFileText, LuSatellite, LuCalendar,
} from 'react-icons/lu'
import { createMission, updateMission, deleteMission, uploadShapefile, uploadOrtho, deleteOrtho } from '../api'
import { useToast } from '../hooks/useToast'
import ConfirmModal from './ConfirmModal'

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
    const type = pendingOrtho
    setPendingOrtho(null)
    setOrthoDeleting(type); setOrthoError(null)
    try {
      await deleteOrtho(mission.id, type)
      const label = type === 'rgb' ? 'RGB' : 'Thermique'
      toast(`Orthomosaïque ${label} supprimée.`, 'success')
      onRefresh()
    } catch (e) {
      setOrthoError(e.message)
    } finally {
      setOrthoDeleting(null)
    }
  }

  async function handleOrtho(type, file) {
    const ext = file.name.split('.').pop().toLowerCase()
    setOrthoUploading({ type, ext }); setOrthoError(null)
    try {
      await uploadOrtho(mission.id, type, file)
      const label  = type === 'rgb' ? 'RGB' : 'Thermique'
      const fmtMsg = ext === 'zip' ? '(tuiles XYZ)' : '(GeoTIFF brut)'
      toast(`Orthomosaïque ${label} ${fmtMsg} importée !`, 'success')
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

        {/* ── État + actions pour chaque type d'ortho ── */}
        {['rgb', 'thermal'].map(type => {
          const fmt   = mission.ortho_formats?.[type] ?? null
          const label = type === 'rgb' ? 'RGB' : 'Thermique'
          const busy  = orthoUploading?.type === type || orthoDeleting === type
          return (
            <div key={type} className="ortho-row">
              <div className="ortho-row-info">
                <span className="ortho-row-label">{type === 'rgb' ? '🌿' : '🌡'} {label}</span>
                {fmt === 'tif'  && <span className="ortho-badge ortho-badge-tif">Image brute (TIF)</span>}
                {fmt === 'zip'  && <span className="ortho-badge ortho-badge-zip">Tuiles (ZIP)</span>}
                {!fmt           && <span className="ortho-badge ortho-badge-none">Aucun fichier</span>}
              </div>
              <div className="ortho-row-actions">
                {busy ? (
                  <span className="ortho-row-busy">
                    <div className="mm-dropzone-spinner" style={{ width: 14, height: 14 }} />
                    {orthoUploading?.type === type ? 'Import…' : 'Suppression…'}
                  </span>
                ) : (
                  <>
                    <label className="ortho-row-btn ortho-row-btn-upload" title={`Importer ${label}`}>
                      <LuUpload size={13} />
                      <input type="file" hidden accept=".zip,.tif,.tiff"
                        onChange={e => e.target.files[0] && handleOrtho(type, e.target.files[0])} />
                    </label>
                    {fmt && (
                      <button
                        className="ortho-row-btn ortho-row-btn-delete"
                        title={`Supprimer l'ortho ${label}`}
                        onClick={() => setPendingOrtho(type)}
                      >
                        <LuTrash2 size={13} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )
        })}

        <p className="ortho-format-hint">
          Formats : <strong>.zip</strong> (tuiles XYZ) · <strong>.tif/.tiff</strong> (GeoTIFF brut)
        </p>
        {orthoError && <div className="error">⚠️ {orthoError}</div>}
      </div>

      {/* ── Confirmation suppression ortho ── */}
      {pendingOrtho && (
        <ConfirmModal
          title="Supprimer l'orthomosaïque"
          message={`Les fichiers ${pendingOrtho === 'rgb' ? 'RGB' : 'Thermique'} de cette mission seront définitivement supprimés du serveur. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          danger
          onConfirm={handleDeleteOrtho}
          onCancel={() => setPendingOrtho(null)}
        />
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
