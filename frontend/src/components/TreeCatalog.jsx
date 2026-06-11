import { useState, useMemo } from 'react'
import { STRESS_COLORS, STRESS_LABELS } from '../constants'

const PAGE_SIZE    = 25
const STRESS_LEVELS = ['aucun', 'faible', 'modere', 'eleve', 'severe']

const COLS = [
  { key: 'id',       label: 'ID' },
  { key: 'stress',   label: 'Stress' },
  { key: 'cwsi',     label: 'CWSI' },
  { key: 'temp_moy', label: 'Temp. (°C)' },
  { key: 'hauteur',  label: 'Hauteur (m)' },
  { key: 'mission',  label: 'Mission' },
]

function fmt(v, dec = 2) {
  if (v == null) return '—'
  return typeof v === 'number' ? v.toFixed(dec) : String(v)
}

function exportCsv(rows) {
  const headers = ['ID', 'Stress', 'CWSI', 'Temperature (C)', 'Hauteur (m)', 'Mission']
  const csv = [
    headers.join(';'),
    ...rows.map(f => {
      const p = f.properties
      return [
        p.id ?? '',
        STRESS_LABELS[p.stress] ?? p.stress ?? '',
        p.cwsi ?? '',
        p.temp_moy ?? '',
        p.hauteur ?? '',
        p.missionName ?? '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')
    }),
  ].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = 'catalogue_arbres.csv'; a.click()
  URL.revokeObjectURL(url)
}

export default function TreeCatalog({ features = [], loading = false, onSelectTree, onClose }) {
  const [search,       setSearch]       = useState('')
  const [stressFilter, setStressFilter] = useState('')
  const [cwsiMin,      setCwsiMin]      = useState(0)
  const [cwsiMax,      setCwsiMax]      = useState(1)
  const [sortKey,      setSortKey]      = useState('id')
  const [sortAsc,      setSortAsc]      = useState(true)
  const [page,         setPage]         = useState(0)

  function handleSort(key) {
    if (sortKey === key) setSortAsc(v => !v)
    else { setSortKey(key); setSortAsc(true) }
    setPage(0)
  }

  function handleCwsiMin(v) { setCwsiMin(Math.min(+v, cwsiMax)); setPage(0) }
  function handleCwsiMax(v) { setCwsiMax(Math.max(+v, cwsiMin)); setPage(0) }

  const filtered = useMemo(() => features.filter(f => {
    const p = f.properties
    if (search && !String(p.id ?? '').toLowerCase().includes(search.toLowerCase())) return false
    if (stressFilter && p.stress !== stressFilter) return false
    const c = p.cwsi ?? 0
    if (c < cwsiMin || c > cwsiMax) return false
    return true
  }), [features, search, stressFilter, cwsiMin, cwsiMax])

  const sorted = useMemo(() => [...filtered].sort((a, b) => {
    const pa = a.properties, pb = b.properties
    const va = sortKey === 'mission' ? (pa.missionName ?? '') : (pa[sortKey] ?? '')
    const vb = sortKey === 'mission' ? (pb.missionName ?? '') : (pb[sortKey] ?? '')
    if (typeof va === 'number' && typeof vb === 'number') return sortAsc ? va - vb : vb - va
    return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va))
  }), [filtered, sortKey, sortAsc])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageData   = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function SortIcon({ col }) {
    if (sortKey !== col) return <span className="tc-sort-icon tc-sort-inactive">↕</span>
    return <span className="tc-sort-icon">{sortAsc ? '↑' : '↓'}</span>
  }

  return (
    <div className="tc-page">

      {/* ── En-tête ── */}
      <div className="tc-header">
        <div className="tc-header-row">
          <h2 className="tc-title">🌳 Catalogue des arbres</h2>
          <button className="tc-close-btn" onClick={onClose}>✕ Fermer</button>
        </div>
        <p className="tc-subtitle">
          <span className="tc-count-pill">{filtered.length}</span>
          {' '}arbre{filtered.length !== 1 ? 's' : ''} affiché{filtered.length !== 1 ? 's' : ''}
          {' '}sur <strong>{features.length}</strong> au total
        </p>
      </div>

      {/* ── Barre de filtres ── */}
      <div className="tc-filters">
        <input
          className="tc-search"
          type="search"
          placeholder="Rechercher par ID…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
        />
        <select
          className="tc-select"
          value={stressFilter}
          onChange={e => { setStressFilter(e.target.value); setPage(0) }}
        >
          <option value="">Tous les niveaux</option>
          {STRESS_LEVELS.map(s => (
            <option key={s} value={s}>{STRESS_LABELS[s]}</option>
          ))}
        </select>
        <div className="tc-cwsi-filter">
          <span className="tc-cwsi-label">CWSI</span>
          <input type="range" className="tc-slider" min={0} max={1} step={0.05}
            value={cwsiMin} onChange={e => handleCwsiMin(e.target.value)} />
          <span className="tc-cwsi-val">{cwsiMin.toFixed(2)}</span>
          <span className="tc-cwsi-sep">–</span>
          <input type="range" className="tc-slider" min={0} max={1} step={0.05}
            value={cwsiMax} onChange={e => handleCwsiMax(e.target.value)} />
          <span className="tc-cwsi-val">{cwsiMax.toFixed(2)}</span>
        </div>
        <button className="tc-csv-btn" onClick={() => exportCsv(sorted)} title="Exporter les lignes filtrées en CSV">
          ⬇ Export CSV
        </button>
      </div>

      {/* ── Tableau ── */}
      <div className="tc-table-wrap">
        {loading ? (
          <div className="tc-loading">
            <div className="loading-spinner" />
            <span>Chargement des données…</span>
          </div>
        ) : (
          <table className="tc-table">
            <thead>
              <tr>
                {COLS.map(col => (
                  <th
                    key={col.key}
                    className={`tc-th${sortKey === col.key ? ' tc-th-active' : ''}`}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}&nbsp;<SortIcon col={col.key} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="tc-empty-cell">
                    Aucun arbre ne correspond aux filtres sélectionnés.
                  </td>
                </tr>
              ) : pageData.map((f, i) => {
                const p     = f.properties
                const color = STRESS_COLORS[p.stress]
                return (
                  <tr
                    key={`${p.missionId}-${p.id ?? i}`}
                    className="tc-row"
                    onClick={() => onSelectTree(p.id, p.missionId)}
                    title="Cliquer pour zoomer sur cet arbre dans la carte"
                  >
                    <td className="tc-td tc-td-id">{p.id ?? '—'}</td>
                    <td className="tc-td">
                      {p.stress && color ? (
                        <span
                          className="tc-badge"
                          style={{ color, background: color + '1a', border: `1px solid ${color}44` }}
                        >
                          {STRESS_LABELS[p.stress] ?? p.stress}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="tc-td tc-mono">{fmt(p.cwsi)}</td>
                    <td className="tc-td tc-mono">{fmt(p.temp_moy, 1)}</td>
                    <td className="tc-td tc-mono">{fmt(p.hauteur, 1)}</td>
                    <td className="tc-td tc-td-mission">{p.missionName ?? p.missionId ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="tc-pagination">
          <button className="tc-pg-btn" disabled={page === 0}
            onClick={() => setPage(0)}>«</button>
          <button className="tc-pg-btn" disabled={page === 0}
            onClick={() => setPage(p => p - 1)}>‹</button>
          <span className="tc-pg-info">Page {page + 1} / {totalPages}</span>
          <button className="tc-pg-btn" disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}>›</button>
          <button className="tc-pg-btn" disabled={page >= totalPages - 1}
            onClick={() => setPage(totalPages - 1)}>»</button>
        </div>
      )}

    </div>
  )
}
