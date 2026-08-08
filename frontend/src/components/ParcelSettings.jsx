import { useState, useRef, useMemo } from 'react'
import * as turf from '@turf/turf'
import { STRESS_COLORS, DEFAULT_CWSI_THRESHOLDS, DEFAULT_SETTINGS, SETTINGS_KEY } from '../constants'
import { LuCheck, LuRotateCcw, LuArrowLeft, LuPencil, LuX } from 'react-icons/lu'
import { useToast } from '../hooks/useToast'

const IRRIGATION_TYPES = [
  { value: 'goutte_a_goutte', label: 'Goutte-à-goutte', efficiency: 0.90 },
  { value: 'micro_aspersion', label: 'Micro-aspersion',  efficiency: 0.75 },
  { value: 'gravitaire',      label: 'Gravitaire',       efficiency: 0.60 },
]

const THRESHOLD_LABELS = ['Aucun / Faible', 'Faible / Modéré', 'Modéré / Élevé', 'Élevé / Sévère']
const SEGMENT_COLORS   = [
  STRESS_COLORS.aucun, STRESS_COLORS.faible,
  STRESS_COLORS.modere, STRESS_COLORS.eleve, STRESS_COLORS.severe,
]
const SEGMENT_NAMES = ['Aucun', 'Faible', 'Modéré', 'Élevé', 'Sévère']

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch (_) {}
  return { ...DEFAULT_SETTINGS }
}

export default function ParcelSettings({ geojson, onClose, onSaved }) {
  const toast  = useToast()
  const [form, setForm] = useState(loadSettings)
  const [editMode, setEditMode] = useState(false)
  const savedSnapshot = useRef(null)

  // ── Auto-calcul depuis le GeoJSON actif ─────────────────────────────────────
  const autoInfo = useMemo(() => {
    if (!geojson?.features?.length) return { surface: null, centroid: null }
    try {
      const fc       = turf.featureCollection(geojson.features)
      const centroid = turf.centroid(fc)
      const [lng, lat] = centroid.geometry.coordinates
      const hull       = turf.convex(fc)
      const surfaceHa  = hull ? (turf.area(hull) / 10000).toFixed(2) : null
      return {
        surface:  surfaceHa,
        centroid: { lat: lat.toFixed(6), lng: lng.toFixed(6) },
      }
    } catch (_) {
      return { surface: null, centroid: null }
    }
  }, [geojson])

  function startEdit() {
    savedSnapshot.current = { ...form, cwsiThresholds: [...form.cwsiThresholds] }
    setEditMode(true)
  }

  function cancelEdit() {
    if (savedSnapshot.current) setForm(savedSnapshot.current)
    setEditMode(false)
  }

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function setThreshold(idx, rawValue) {
    const value = parseFloat(rawValue)
    setForm(prev => {
      const t = [...prev.cwsiThresholds]
      t[idx] = value
      return { ...prev, cwsiThresholds: t }
    })
  }

  function handleIrrigationType(value) {
    const tp = IRRIGATION_TYPES.find(t => t.value === value)
    setForm(prev => ({
      ...prev,
      irrigationType:      value,
      irrigationEfficiency: tp?.efficiency ?? prev.irrigationEfficiency,
    }))
  }

  function handleSave() {
    try {
      const toSave = { ...form }
      if (autoInfo.surface) toSave.surface = parseFloat(autoInfo.surface)
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave))
      toast('Paramètres enregistrés', 'success')
      onSaved?.(toSave)
      setEditMode(false)
      onClose()
    } catch (_) {
      toast('Erreur lors de la sauvegarde', 'error')
    }
  }

  const t = form.cwsiThresholds

  const segments = [
    { color: SEGMENT_COLORS[0], name: SEGMENT_NAMES[0], min: 0,    max: t[0] },
    { color: SEGMENT_COLORS[1], name: SEGMENT_NAMES[1], min: t[0], max: t[1] },
    { color: SEGMENT_COLORS[2], name: SEGMENT_NAMES[2], min: t[1], max: t[2] },
    { color: SEGMENT_COLORS[3], name: SEGMENT_NAMES[3], min: t[2], max: t[3] },
    { color: SEGMENT_COLORS[4], name: SEGMENT_NAMES[4], min: t[3], max: 1    },
  ]

  return (
    <div className="ps-page">
      <div className="ps-wrap">

        {/* ── En-tête ── */}
        <div className="ps-header">
          <button className="ps-back-btn" onClick={onClose}>
            <LuArrowLeft size={14} /> Retour
          </button>
          <h2 className="ps-page-title">Paramètres de la parcelle</h2>
          <div className="ps-header-actions">
            {editMode ? (
              <>
                <button className="btn-secondary" onClick={cancelEdit}>
                  <LuX size={13} /> Annuler
                </button>
                <button className="btn-primary" onClick={handleSave}>
                  <LuCheck size={13} /> Enregistrer
                </button>
              </>
            ) : (
              <button className="btn-primary" onClick={startEdit}>
                <LuPencil size={13} /> Modifier
              </button>
            )}
          </div>
        </div>

        <div className="ps-body">

          {/* ── Section 1 : Informations générales ── */}
          <section className="ps-section">
            <h3 className="ps-section-title">Informations générales</h3>
            <div className="ps-form-grid">

              <div className="ps-field">
                <label className="ps-label">Nom de la parcelle</label>
                {editMode ? (
                  <input className="ps-input" value={form.parcelName}
                    onChange={e => set('parcelName', e.target.value)}
                    placeholder="ex : Parcelle Nord" />
                ) : (
                  <div className="ps-value-text">{form.parcelName || <span className="ps-value-empty">Non renseigné</span>}</div>
                )}
              </div>

              <div className="ps-field">
                <label className="ps-label">Propriétaire</label>
                {editMode ? (
                  <input className="ps-input" value={form.owner}
                    onChange={e => set('owner', e.target.value)}
                    placeholder="Nom du propriétaire" />
                ) : (
                  <div className="ps-value-text">{form.owner || <span className="ps-value-empty">Non renseigné</span>}</div>
                )}
              </div>

              <div className="ps-field">
                <label className="ps-label">Variété d'olivier</label>
                {editMode ? (
                  <input className="ps-input" value={form.variety}
                    onChange={e => set('variety', e.target.value)}
                    placeholder="ex : Picholine marocaine" />
                ) : (
                  <div className="ps-value-text">{form.variety || <span className="ps-value-empty">Non renseigné</span>}</div>
                )}
              </div>

              <div className="ps-field">
                <label className="ps-label">
                  Surface (ha)
                  {autoInfo.surface && <span className="ps-auto-badge">auto</span>}
                </label>
                {autoInfo.surface ? (
                  <div className="ps-value-text">{autoInfo.surface} ha</div>
                ) : editMode ? (
                  <input className="ps-input" type="number" min="0" step="0.01"
                    value={form.surface}
                    onChange={e => set('surface', e.target.value)}
                    placeholder="Saisie manuelle (ha)" />
                ) : (
                  <div className="ps-value-text">{form.surface ? `${form.surface} ha` : <span className="ps-value-empty">Non renseigné</span>}</div>
                )}
              </div>

              {autoInfo.centroid && (
                <div className="ps-field ps-field-full">
                  <label className="ps-label">
                    Centroïde GPS <span className="ps-auto-badge">calculé</span>
                  </label>
                  <div className="ps-coords">
                    <span className="ps-coord-chip">Lat {autoInfo.centroid.lat}</span>
                    <span className="ps-coord-chip">Lng {autoInfo.centroid.lng}</span>
                  </div>
                </div>
              )}

            </div>
          </section>

          {/* ── Section 2 : Seuils CWSI ── */}
          <section className="ps-section">
            <div className="ps-section-hd">
              <h3 className="ps-section-title">Seuils CWSI personnalisables</h3>
              {editMode && (
                <button className="ps-reset-btn"
                  onClick={() => setForm(p => ({ ...p, cwsiThresholds: [...DEFAULT_CWSI_THRESHOLDS] }))}>
                  <LuRotateCcw size={11} /> Réinitialiser
                </button>
              )}
            </div>

            {/* Barre de prévisualisation en temps réel */}
            <div className="ps-cwsi-bar">
              {segments.map((seg, i) => (
                <div
                  key={i}
                  className="ps-cwsi-seg"
                  style={{ flex: Math.max(seg.max - seg.min, 0.01), background: seg.color }}
                  title={`${seg.name} : ${seg.min.toFixed(2)} – ${seg.max.toFixed(2)}`}
                >
                  <span className="ps-cwsi-seg-lbl">{seg.name}</span>
                </div>
              ))}
            </div>

            {/* Sliders */}
            <div className="ps-thresholds">
              {THRESHOLD_LABELS.map((label, i) => {
                const minVal = i === 0 ? 0.01 : +(t[i - 1] + 0.01).toFixed(2)
                const maxVal = i === 3 ? 0.99 : +(t[i + 1] - 0.01).toFixed(2)
                return (
                  <div key={i} className="ps-threshold-row">
                    <div className="ps-threshold-meta">
                      <span className="ps-thresh-dot" style={{ background: SEGMENT_COLORS[i] }} />
                      <span className="ps-thresh-dot" style={{ background: SEGMENT_COLORS[i + 1] }} />
                      <span className="ps-label">{label}</span>
                    </div>
                    <div className="ps-threshold-ctrl">
                      <input
                        type="range" className="ps-range"
                        min={minVal} max={maxVal} step={0.01}
                        value={t[i]}
                        onChange={e => editMode && setThreshold(i, e.target.value)}
                        disabled={!editMode}
                        style={!editMode ? { opacity: 0.55, cursor: 'default', pointerEvents: 'none' } : undefined}
                      />
                      <span className="ps-threshold-val">{t[i].toFixed(2)}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="ps-footnote">Allen et al. (1998), FAO-56 — adapté pour l'olivier</p>
          </section>

          {/* ── Section 3 : Coefficients Kc ── */}
          <section className="ps-section">
            <h3 className="ps-section-title">
              Coefficients culturaux Kc
              <span className="ps-source-pill">FAO-56</span>
            </h3>
            <div className="ps-kc-grid">
              {[
                { key: 'kcHiver',     label: 'Hiver',     icon: '❄️', hint: 'Repos végétatif' },
                { key: 'kcPrintemps', label: 'Printemps', icon: '🌸', hint: 'Floraison'         },
                { key: 'kcEte',       label: 'Été',       icon: '☀️', hint: 'Dév. noyau'         },
              ].map(({ key, label, icon, hint }) => (
                <div key={key} className="ps-kc-card">
                  <div className="ps-kc-icon">{icon}</div>
                  <div className="ps-kc-label">{label}</div>
                  <div className="ps-kc-hint">{hint}</div>
                  {editMode ? (
                    <input
                      type="number" className="ps-kc-input"
                      min="0.10" max="1.50" step="0.01"
                      value={form[key]}
                      onChange={e => set(key, parseFloat(e.target.value) || 0)}
                    />
                  ) : (
                    <div className="ps-kc-input ps-kc-readonly">{form[key]}</div>
                  )}
                </div>
              ))}
            </div>
            <p className="ps-footnote">Kc = coefficient cultural par stade phénologique (Allen et al., FAO-56)</p>
          </section>

          {/* ── Section 4 : Système d'irrigation ── */}
          <section className="ps-section">
            <h3 className="ps-section-title">Système d'irrigation</h3>

            <div className="ps-irrig-chips">
              {IRRIGATION_TYPES.map(tp => (
                <button
                  key={tp.value}
                  className={`ps-irrig-chip${form.irrigationType === tp.value ? ' active' : ''}${!editMode ? ' ps-irrig-chip--readonly' : ''}`}
                  onClick={() => editMode && handleIrrigationType(tp.value)}
                  disabled={!editMode}
                >
                  {tp.label}
                  <span className="ps-irrig-eff">{Math.round(tp.efficiency * 100)} %</span>
                </button>
              ))}
            </div>

            <div className="ps-form-grid">
              {[
                { key: 'pumpFlow',   label: 'Débit pompe (m³/h)',   step: 0.5,  unit: 'm³/h' },
                { key: 'waterCost',  label: 'Coût eau (MAD/m³)',    step: 0.1,  unit: 'MAD/m³' },
                { key: 'energyKwh',  label: 'Conso. pompe (kWh/m³)', step: 0.05, unit: 'kWh/m³' },
                { key: 'energyPrice',label: 'Tarif ONEE (MAD/kWh)', step: 0.01, unit: 'MAD/kWh' },
              ].map(({ key, label, step, unit }) => (
                <div key={key} className="ps-field">
                  <label className="ps-label">{label}</label>
                  {editMode ? (
                    <input className="ps-input" type="number" min="0" step={step}
                      value={form[key]}
                      onChange={e => set(key, parseFloat(e.target.value) || 0)} />
                  ) : (
                    <div className="ps-value-text">{form[key]} <span className="ps-value-unit">{unit}</span></div>
                  )}
                </div>
              ))}
            </div>

            <p className="ps-footnote">Ces valeurs deviennent les défauts dans le simulateur de bilan hydrique.</p>
          </section>

        </div>

        {/* ── Pied de page sticky (mode édition uniquement) ── */}
        {editMode && (
          <div className="ps-footer">
            <button className="btn-secondary" onClick={cancelEdit}>
              <LuX size={13} /> Annuler
            </button>
            <button className="btn-primary" onClick={handleSave}>
              <LuCheck size={13} /> Enregistrer les paramètres
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
