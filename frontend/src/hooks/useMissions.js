import { useState, useCallback, useEffect } from 'react'
import { listMissions } from '../api'
import { useToast } from './useToast'

/**
 * Gère la liste des missions et leur rechargement.
 * Retourne { missions, loading, refresh }
 */
export function useMissions() {
  const [missions, setMissions] = useState([])
  const [loading, setLoading]   = useState(true)
  const toast = useToast()

  const refresh = useCallback(async () => {
    try {
      const list = await listMissions()
      setMissions(list)
      return list
    } catch (err) {
      toast(err.message, 'error')
      return []
    }
  }, [toast])

  // Chargement initial
  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [refresh])

  return { missions, loading, refresh }
}
