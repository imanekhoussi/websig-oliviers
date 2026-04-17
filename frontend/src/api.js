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
  if (!r.ok) throw new Error('Erreur suppression mission')
  return r.json()
}

export async function uploadShapefile(missionId, files) {
  const fd = new FormData()
  for (const f of files) fd.append('files', f)
  const r = await fetch(`${API}/api/missions/${missionId}/upload`, {
    method: 'POST', body: fd,
  })
  const d = await r.json()
  if (!r.ok) throw new Error(d.detail || 'Erreur upload')
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

export function exportCsvUrl(missionId) {
  return `${API}/api/missions/${missionId}/export`
}

export async function fetchTreeHistory(treeId) {
  const r = await fetch(`${API}/api/trees/${treeId}/history`)
  if (!r.ok) throw new Error('Erreur chargement historique')
  return r.json()
}
