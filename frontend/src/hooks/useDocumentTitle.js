import { useEffect } from 'react'

export function useDocumentTitle(title, cwsi = null) {
  useEffect(() => {
    const prev = document.title
    document.title = title ?? 'GeoOlive — WebSIG Oliviers'

    const color = cwsi == null  ? '#4a7c59'
                : cwsi >= 0.75  ? '#8e44ad'
                : cwsi >= 0.50  ? '#dc2626'
                : cwsi >= 0.35  ? '#d97706'
                :                 '#16a34a'

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="16" fill="${color}"/>
      <text x="16" y="21" text-anchor="middle"
        font-family="system-ui,sans-serif"
        font-size="16" font-weight="700" fill="white">G</text>
    </svg>`

    const encoded = `data:image/svg+xml;base64,${btoa(svg)}`

    let link = document.querySelector("link[rel~='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.type = 'image/svg+xml'
    link.href = encoded

    return () => {
      document.title = prev
      const original = document.querySelector("link[data-original-favicon]")
      if (original && link) link.href = original.href
    }
  }, [title, cwsi])
}
