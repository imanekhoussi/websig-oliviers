/**
 * Modal de confirmation réutilisable — remplace les appels natifs confirm().
 * Props :
 *   title?         Titre de la boîte (optionnel)
 *   message        Corps du message
 *   confirmLabel?  Texte du bouton de confirmation (défaut "Confirmer")
 *   danger?        Si true, le bouton de confirmation est rouge
 *   onConfirm      Callback sur confirmation
 *   onCancel       Callback sur annulation
 */
import { createPortal } from 'react-dom'

export default function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirmer',
  danger = false,
  onConfirm,
  onCancel,
}) {
  return createPortal(
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="confirm-icon">{danger ? '⚠️' : '❓'}</div>
        {title && <h3 className="confirm-title">{title}</h3>}
        <p className="confirm-message">{message}</p>
        <div className="modal-actions" style={{ justifyContent: 'center' }}>
          <button className="btn-secondary" onClick={onCancel}>Annuler</button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
