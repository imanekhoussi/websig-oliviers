export default function MissionSelector({ missions, currentId, onSelect }) {
  return (
    <select
      className="header-mission-select"
      value={currentId || ''}
      onChange={e => onSelect(e.target.value || null)}
    >
      <option value="">— Sélectionner une mission —</option>
      {missions.map(m => (
        <option key={m.id} value={m.id}>
          {m.date} · {m.nom} {m.has_shapefile ? '✓' : '⚠️'}
        </option>
      ))}
    </select>
  )
}
