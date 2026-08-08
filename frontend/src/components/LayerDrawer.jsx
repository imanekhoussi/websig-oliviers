import { useState } from 'react'
import { LuLayers, LuX, LuMap, LuSatellite, LuMoon, LuEye, LuEyeOff } from 'react-icons/lu'

export const BASEMAPS = {
  satellite: {
    label: 'Satellite ESRI',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 18,
    attribution: '&copy; Esri',
  },
  osm: {
    label: 'OpenStreetMap',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxNativeZoom: 19,
    attribution: '&copy; OSM',
  },
  dark: {
    label: 'CartoDB Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    maxNativeZoom: 20,
    attribution: '&copy; CARTO',
  },
}

const BASEMAP_META = [
  { id: 'satellite', icon: <LuSatellite size={14} />, color: '#0ea5e9' },
  { id: 'osm',       icon: <LuMap      size={14} />, color: '#3d9960' },
  { id: 'dark',      icon: <LuMoon     size={14} />, color: '#818cf8' },
]

export default function LayerDrawer({
  activeBasemap,
  onBasemapChange,
  activeOverlays,
  onOverlayToggle,
  overlayOpacities,
  onOpacityChange,
  availableOverlays,
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        className={`ld-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Couches et fonds de carte"
      >
        <LuLayers size={16} />
      </button>

      {open && (
        <div className="ld-drawer">
          <div className="ld-header">
            <span className="ld-title">
              <LuLayers size={13} /> Couches
            </span>
            <button className="ld-close" onClick={() => setOpen(false)}>
              <LuX size={13} />
            </button>
          </div>

          <div className="ld-section-label">Fonds de carte</div>
          {BASEMAP_META.map(bm => (
            <label
              key={bm.id}
              className={`ld-basemap-row${activeBasemap === bm.id ? ' active' : ''}`}
            >
              <input
                type="radio"
                name="basemap"
                value={bm.id}
                checked={activeBasemap === bm.id}
                onChange={() => onBasemapChange(bm.id)}
                className="ld-radio"
              />
              <span className="ld-bm-icon" style={{ color: bm.color }}>{bm.icon}</span>
              <span className="ld-bm-label">{BASEMAPS[bm.id].label}</span>
            </label>
          ))}

          {availableOverlays.length > 0 && (
            <>
              <div className="ld-divider" />
              <div className="ld-section-label">Couches données</div>
              {availableOverlays.map(overlay => {
                const active  = activeOverlays.includes(overlay.id)
                const opacity = overlayOpacities?.[overlay.id] ?? 1
                return (
                  <div key={overlay.id} className="ld-overlay-item">
                    <span className="ld-overlay-icon" style={{ color: overlay.color }}>
                      {overlay.icon}
                    </span>
                    <span className="ld-overlay-label">{overlay.label}</span>
                    <button
                      className={`ld-vis-btn${active ? ' on' : ''}`}
                      onClick={() => onOverlayToggle(overlay.id)}
                      title={active ? 'Masquer' : 'Afficher'}
                    >
                      {active ? <LuEye size={13} /> : <LuEyeOff size={13} />}
                    </button>
                    {active && overlay.hasOpacity && (
                      <div className="ld-opacity-row">
                        <span className="ld-opacity-label">Opacité</span>
                        <input
                          type="range" className="ld-opacity-slider"
                          min={0} max={1} step={0.05} value={opacity}
                          onChange={e => onOpacityChange(overlay.id, parseFloat(e.target.value))}
                        />
                        <span className="ld-opacity-val">{Math.round(opacity * 100)}%</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}
    </>
  )
}
