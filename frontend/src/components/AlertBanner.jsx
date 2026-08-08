import { useState, useEffect } from 'react'

const LEVEL_CONFIG = {
  critique: {
    color: '#dc2626',
    background: 'rgba(220,38,38,0.10)',
    border: 'rgba(220,38,38,0.35)',
    icon: '🚨',
    getMessage: n => `Stress sévère détecté — ${n} arbres nécessitent une intervention sous 24h`,
  },
  eleve: {
    color: '#d97706',
    background: 'rgba(217,119,6,0.10)',
    border: 'rgba(217,119,6,0.35)',
    icon: '⚠',
    getMessage: n => `Stress hydrique élevé — ${n} arbres en situation à risque`,
  },
  modere: {
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.25)',
    icon: 'ℹ',
    getMessage: n => `Stress modéré détecté — surveiller ${n} arbres`,
  },
}

function getLevel(cwsiMoy) {
  if (cwsiMoy >= 0.75) return 'critique'
  if (cwsiMoy >= 0.50) return 'eleve'
  if (cwsiMoy >= 0.35) return 'modere'
  return null
}

export default function AlertBanner({ stats, mission, onDismiss, autoHideMs = 8000 }) {
  const cwsiMoy = stats?.cwsi?.moyenne ?? 0
  const levelKey = getLevel(cwsiMoy)

  const [closing, setClosing] = useState(false)
  const [barWidth, setBarWidth] = useState(100)

  function handleDismiss() {
    setClosing(true)
    setTimeout(onDismiss, 250)
  }

  useEffect(() => {
    const raf = requestAnimationFrame(() => setBarWidth(0))
    const timer = setTimeout(handleDismiss, autoHideMs)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!levelKey) return null

  const cfg = LEVEL_CONFIG[levelKey]
  const n = (stats?.stress_breakdown ?? [])
    .filter(s => s.classe === 'eleve' || s.classe === 'severe')
    .reduce((acc, s) => acc + s.count, 0)

  return (
    <div
      className="alert-banner"
      style={{
        background: cfg.background,
        borderColor: cfg.border,
        color: cfg.color,
        animation: closing
          ? 'alertSlideOut 0.25s ease forwards'
          : 'alertSlideIn 0.35s ease',
      }}
    >
      <div className="alert-banner-body">
        <span className="alert-banner-icon">{cfg.icon}</span>
        <div className="alert-banner-text">
          <div className="alert-banner-main">{cfg.getMessage(n)}</div>
          <div className="alert-banner-detail">
            Mission : {mission?.nom || mission?.id || '—'} · CWSI moy. {cwsiMoy.toFixed(2)} · {mission?.date || ''}
          </div>
        </div>
        <button
          className="alert-banner-close"
          onClick={handleDismiss}
          aria-label="Fermer"
        >
          ✕
        </button>
      </div>
      <div className="alert-banner-progress-track">
        <div
          className="alert-banner-progress-fill"
          style={{
            width: `${barWidth}%`,
            background: cfg.color,
            transitionDuration: `${autoHideMs}ms`,
          }}
        />
      </div>
    </div>
  )
}
