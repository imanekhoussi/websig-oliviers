/**
 * Système de notifications Toast
 * Usage : const toast = useToast()
 *         toast('Message', 'success' | 'error' | 'info')
 */
import { createContext, useContext, useReducer, useCallback } from 'react'

const ToastContext = createContext(null)

const DURATION = 4200

function reducer(state, action) {
  switch (action.type) {
    case 'ADD':    return [...state, action.payload]
    case 'REMOVE': return state.filter(t => t.id !== action.payload)
    default:       return state
  }
}

export function ToastProvider({ children }) {
  const [toasts, dispatch] = useReducer(reducer, [])

  const addToast = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random()}`
    dispatch({ type: 'ADD', payload: { id, message, type } })
    setTimeout(() => dispatch({ type: 'REMOVE', payload: id }), DURATION)
  }, [])

  const remove = useCallback(id => dispatch({ type: 'REMOVE', payload: id }), [])

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <ToastContainer toasts={toasts} onRemove={remove} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast doit être utilisé dans <ToastProvider>')
  return ctx
}

/* ── Conteneur de toasts ────────────────────────────────────────────────── */
const ICONS   = { success: '✓', error: '✕', info: 'ℹ' }

function ToastContainer({ toasts, onRemove }) {
  if (!toasts.length) return null
  return (
    <div className="toast-container" role="region" aria-label="Notifications">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`} role="alert">
          <span className="toast-icon">{ICONS[t.type]}</span>
          <span className="toast-message">{t.message}</span>
          <button className="toast-close" onClick={() => onRemove(t.id)} aria-label="Fermer">×</button>
        </div>
      ))}
    </div>
  )
}
