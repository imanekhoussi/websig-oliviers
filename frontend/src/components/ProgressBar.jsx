import { useEffect, useState, useRef } from 'react'

export default function ProgressBar({ loading, color = '#4a7c59' }) {
  const [visible,  setVisible]  = useState(false)
  const [progress, setProgress] = useState(0)
  const [fading,   setFading]   = useState(false)
  const timerRef = useRef(null)
  const rafRef   = useRef(null)

  useEffect(() => {
    if (loading) {
      setVisible(true)
      setFading(false)
      setProgress(0)

      let current = 0
      function tick() {
        current = current < 70
          ? current + 4
          : current < 85
            ? current + 0.8
            : current < 92
              ? current + 0.2
              : current
        setProgress(Math.min(current, 92))
        if (current < 92) rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)

    } else {
      cancelAnimationFrame(rafRef.current)
      setProgress(100)
      setFading(false)

      timerRef.current = setTimeout(() => {
        setFading(true)
        timerRef.current = setTimeout(() => {
          setVisible(false)
          setProgress(0)
          setFading(false)
        }, 300)
      }, 200)
    }

    return () => {
      cancelAnimationFrame(rafRef.current)
      clearTimeout(timerRef.current)
    }
  }, [loading])

  if (!visible) return null

  return (
    <div
      className="nprogress-bar"
      style={{
        opacity:    fading ? 0 : 1,
        width:      `${progress}%`,
        background: color,
      }}
    >
      <div className="nprogress-glow" style={{ boxShadow: `0 0 8px 2px ${color}` }} />
    </div>
  )
}
