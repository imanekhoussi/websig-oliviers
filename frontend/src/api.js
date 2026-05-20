const API = 'http://localhost:8000'

// ===== Missions =====
export async function listMissions() {
  const r = await fetch(`${API}/api/missions`)
  if (!r.ok) throw new Error('Erreur chargement missions')
  return r.json()
}

export async function createMission(data) {
  const r = await fetch(`${API}/api/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || 'Erreur création mission')
  return d
}

export async function updateMission(id, data) {
  const r = await fetch(`${API}/api/missions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || 'Erreur update mission')
  return d
}

export async function deleteMission(id) {
  const r = await fetch(`${API}/api/missions/${id}`, { method: 'DELETE' })
  if (!r.ok) {
    let detail = 'Erreur lors de la suppression de la mission'
    try {
      const d = await r.json()
      detail = Array.isArray(d.detail)
        ? d.detail.map(e => e.msg || JSON.stringify(e)).join(' · ')
        : d.detail || detail
    } catch (_) { /* réponse non-JSON : on garde le message par défaut */ }
    throw new Error(detail)
  }
  return r.json()
}

export async function uploadShapefile(missionId, files) {
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  const r = await fetch(`${API}/api/missions/${missionId}/upload`, {
    method: 'POST', body: fd,
  })
  const d = await r.json()
  if (!r.ok) {
    // FastAPI renvoie detail en string (HTTPException) ou en tableau (validation error)
    const detail = Array.isArray(d.detail)
      ? d.detail.map(e => e.msg || JSON.stringify(e)).join(' · ')
      : d.detail || "Erreur lors de l'importation du fichier"
    throw new Error(detail)
  }
  return d
}

// ===== Trees & Stats (par mission) =====
export async function fetchTrees(missionId) {
  const r = await fetch(`${API}/api/missions/${missionId}/trees`)
  if (!r.ok) throw new Error('Erreur chargement arbres')
  return r.json()
}

export async function fetchStats(missionId) {
  const r = await fetch(`${API}/api/missions/${missionId}/stats`)
  if (!r.ok) throw new Error('Erreur chargement stats')
  return r.json()
}

/** Construit l'URL d'export Excel. Si ids est fourni (export zonal), les filtre. */
export function exportXlsxUrl(missionId, ids = null) {
  const base = `${API}/api/missions/${missionId}/export`
  const filtered = ids?.filter(id => id != null) ?? []
  return filtered.length > 0 ? `${base}?ids=${filtered.join(',')}` : base
}

export function exportPdfUrl(missionId) {
  return `${API}/api/missions/${missionId}/export-pdf`
}

export async function uploadOrtho(missionId, orthoType, file) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(
    `${API}/api/missions/${missionId}/upload-ortho?ortho_type=${orthoType}`,
    { method: 'POST', body: fd },
  )
  if (!r.ok) {
    let detail = "Erreur lors de l'import de l'orthomosaïque"
    try {
      const d = await r.json()
      detail = Array.isArray(d.detail)
        ? d.detail.map(e => e.msg || JSON.stringify(e)).join(' · ')
        : d.detail || detail
    } catch (_) { /* réponse non-JSON (timeout, proxy) : on garde le message par défaut */ }
    throw new Error(detail)
  }
  return r.json()
}

export async function deleteOrtho(missionId, orthoType, fmt) {
  const r = await fetch(
    `${API}/api/missions/${missionId}/ortho/${orthoType}/${fmt}`,
    { method: 'DELETE' },
  )
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || 'Erreur suppression ortho')
  return d
}

export async function fetchTreeHistory(treeId) {
  const r = await fetch(`${API}/api/trees/${treeId}/history`)
  if (!r.ok) throw new Error('Erreur chargement historique')
  return r.json()
}

// ===== CWSI =====
export async function fetchAiAdvice(missionId, params) {
  const r = await fetch(`${API}/api/missions/${missionId}/ai-advice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || 'Erreur lors de la génération du conseil IA')
  return d
}

export async function fetchAnomalies(missionId) {
  const r = await fetch(`${API}/api/missions/${missionId}/anomalies`)
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || 'Erreur détection anomalies')
  return d
}

export async function fetchYieldPredictions(missionId) {
  const r = await fetch(`${API}/api/missions/${missionId}/predict-yield`, {
    method: 'POST',
  })
  const d = await r.json()
  if (!r.ok) throw new Error(
    Array.isArray(d.detail)
      ? d.detail.map(e => e.msg || JSON.stringify(e)).join(' · ')
      : d.detail || 'Erreur prédiction rendement'
  )
  return d
}

export async function fetchChat(messages, contextData = null) {
  const r = await fetch(`${API}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context_data: contextData }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || "Erreur lors de l'appel au chat IA")
  return d
}

export async function computeCwsi(missionId, method = 'empirical') {
  const r = await fetch(`${API}/api/missions/${missionId}/compute-cwsi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, force_recalc: true }),
  })
  const d = await r.json()
  if (!r.ok) {
    const detail = Array.isArray(d.detail)
      ? d.detail.map(e => e.msg || JSON.stringify(e)).join(' · ')
      : d.detail || 'Erreur calcul CWSI'
    throw new Error(detail)
  }
  return d
}
