import { useState, useEffect } from 'react'
import { fetchTrees, fetchStats } from '../api'
import { useToast } from './useToast'

/**
 * Charge les arbres (GeoJSON) et les statistiques pour la mission courante.
 * Retourne { geojson, stats, dataLoading }
 */
export function useMissionData(currentId, missions) {
  const [geojson, setGeojson]         = useState(null)
  const [stats, setStats]             = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const toast = useToast()

  // Dérive un signal stable : on ne recharge que si la mission ou son statut change
  const currentHasData = missions.find(x => x.id === currentId)?.has_shapefile

  useEffect(() => {
    if (!currentId || !currentHasData) {
      setGeojson(null)
      setStats(null)
      return
    }

    // Réinitialise avant le chargement pour déclencher le squelette
    setGeojson(null)
    setStats(null)
    setDataLoading(true)

    Promise.all([fetchTrees(currentId), fetchStats(currentId)])
      .then(([g, s]) => { setGeojson(g); setStats(s) })
      .catch(err => toast(err.message, 'error'))  // eslint-disable-line react-hooks/exhaustive-deps
      .finally(() => setDataLoading(false))
  }, [currentId, currentHasData]) // eslint-disable-line react-hooks/exhaustive-deps

  return { geojson, stats, dataLoading }
}
