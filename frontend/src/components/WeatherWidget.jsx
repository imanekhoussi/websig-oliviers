import { useEffect, useState } from 'react'
import { LuThermometer, LuDroplet, LuWind, LuCloudSun, LuCloudRain } from 'react-icons/lu'
import * as turf from '@turf/turf'

const DEFAULT_LAT = 35.76
const DEFAULT_LON = -5.83

export default function WeatherWidget({ geojson }) {
  const [weather, setWeather] = useState(null)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let lat = DEFAULT_LAT
    let lon = DEFAULT_LON

    if (geojson?.features?.length) {
      try {
        const center = turf.centroid(geojson)
        lon = center.geometry.coordinates[0]
        lat = center.geometry.coordinates[1]
      } catch { /* conserve le fallback */ }
    }

    setWeather(null)
    setError(false)

    fetch(
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation` +
      `&timezone=Africa%2FCasablanca`
    )
      .then(r => r.json())
      .then(d => { if (d?.current) setWeather(d.current) })
      .catch(() => setError(true))
  }, [geojson])

  if (error || !weather) return null

  return (
    <div className="weather-widget">
      <div className="ww-header">
        <LuCloudSun size={12} className="ww-icon-main" />
        <span className="ww-location">Météo Parcelle</span>
      </div>
      <div className="ww-metrics">
        <span className="ww-metric">
          <LuThermometer size={11} className="ww-icon temp" />
          <strong>{weather.temperature_2m?.toFixed(1)}°C</strong>
        </span>
        <span className="ww-sep">·</span>
        <span className="ww-metric">
          <LuDroplet size={11} className="ww-icon hum" />
          <strong>{weather.relative_humidity_2m} %</strong>
        </span>
        <span className="ww-sep">·</span>
        <span className="ww-metric">
          <LuCloudRain size={11} className="ww-icon rain" />
          <strong>{weather.precipitation?.toFixed(1) ?? '0.0'} mm</strong>
        </span>
        <span className="ww-sep">·</span>
        <span className="ww-metric">
          <LuWind size={11} className="ww-icon wind" />
          <strong>{weather.wind_speed_10m?.toFixed(1)} km/h</strong>
        </span>
      </div>
    </div>
  )
}
