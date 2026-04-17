import { useState } from 'react'
import { createMission, deleteMission, uploadShapefile } from '../api'
import { useToast } from '../hooks/useToast'
import ConfirmModal from './ConfirmModal'

export default function MissionSelector({ missions, currentId, onSelect, onRefresh }) {
  const toast = useToast()
  const [showForm,      setShowForm]      = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)  // remplace confirm()

  async function handleDeleteConfirm() {
    try {
      await deleteMission(pendingDelete)
      toast('Mission supprimée avec succès.', 'success')
      if (currentId === pendingDelete) onSelect(null)
      onRefresh()
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <div className="mission-selector">
      <div className="mission-selector-title">Mission active</div>

      <div className="mission-select-row">
        <select
          value={currentId || ''}
          onChange={e => onSelect(e.target.value || null)}
        >
          <option value="">— Sélectionner —</option>
          {missions.map(m => (
            <option key={m.id} value={m.id}>
              {m.date} · {m.nom} {m.has_shapefile ? '✓' : '⚠️ vide'}
            </option>
          ))}
        </select>
      </div>

      <div className="mission-actions">
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Nouvelle
        </button>
        {currentId && (
          <button
            className="btn-danger"
            onClick={() => setPendingDelete(currentId)}
            title="Supprimer cette mission"
          >
            🗑 Supprimer
          </button>
        )}
      </div>

      {/* Formulaire de création */}
      {showForm && (
        <NouvellesMissionForm
          onClose={() => setShowForm(false)}
          onCreated={m => { setShowForm(false); onRefresh(); onSelect(m.id) }}
        />
      )}

      {/* Modal de confirmation de suppression */}
      {pendingDelete && (
        <ConfirmModal
          title="Supprimer la mission"
          message={`Toutes les données de la mission « ${pendingDelete} » seront définitivement effacées. Cette action est irréversible.`}
          confirmLabel="Supprimer"
          danger
          onConfirm={handleDeleteConfirm}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

/* ── Formulaire de création ───────────────────────────────────────────────── */
function NouvellesMissionForm({ onClose, onCreated }) {
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    date: today, nom: '', notes: '',
    temp_air: '', humidite: '', vent: '',
  })
  const [error, setError] = useState(null)
  const [busy,  setBusy]  = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
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
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const set = k => e => setForm({ ...form, [k]: e.target.value })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Nouvelle mission</h2>
          <button className="close-btn" onClick={onClose} title="Fermer">×</button>
        </div>

        <form onSubmit={submit} className="mission-form">
          <div className="form-group">
            <label>Date *</label>
            <input type="date" value={form.date} onChange={set('date')} required />
          </div>

          <div className="form-group">
            <label>Nom de la mission</label>
            <input
              type="text" value={form.nom} onChange={set('nom')}
              placeholder="ex : Parcelle Nord – Aïn Tizgha"
            />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea
              value={form.notes} onChange={set('notes')} rows={3}
              placeholder="Conditions de vol, observations…"
            />
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
            <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? '⏳ Création…' : 'Créer la mission'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ── Zone de dépôt de shapefile ──────────────────────────────────────────── */
export function MissionUploadZone({ missionId, onUploaded }) {
  const toast = useToast()
  const [dragging, setDragging] = useState(false)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState(null)

  async function upload(files) {
    setBusy(true); setError(null)
    try {
      await uploadShapefile(missionId, files)
      toast('Données spatiales importées avec succès !', 'success')
      onUploaded()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mission-upload">
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); upload(Array.from(e.dataTransfer.files)) }}
        onClick={() => document.getElementById('file-input-mission').click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && document.getElementById('file-input-mission').click()}
      >
        {busy ? (
          <>
            <span className="dropzone-icon">⏳</span>
            Import en cours…
          </>
        ) : (
          <>
            <span className="dropzone-icon">📁</span>
            <b>Déposer le shapefile ici</b><br />
            <small>Un fichier .zip ou les 4 fichiers .shp .shx .dbf .prj</small>
          </>
        )}
        <input
          id="file-input-mission" type="file" multiple hidden
          accept=".shp,.shx,.dbf,.prj,.cpg,.zip,.gpkg"
          onChange={e => upload(Array.from(e.target.files))}
        />
      </div>
      {error && <div className="error">⚠️ {error}</div>}
    </div>
  )
}
