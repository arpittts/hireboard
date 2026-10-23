import { useEffect, useRef } from 'react';

// An in-page replacement for window.confirm(), which some browsers block.
// Escape or a click outside cancels; focus starts on Cancel so Enter is safe.
export default function ConfirmDialog({ title, message, confirmLabel = 'Delete', danger = true, busy, disabled, onConfirm, onCancel, children }) {
  const cancelRef = useRef(null);
  // The latest onCancel, so the key listener below is added only once.
  const onCancelRef = useRef(onCancel);
  useEffect(() => { onCancelRef.current = onCancel; });

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancelRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2 id="confirm-title">{title}</h2></div>
        <div className="modal-body">
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{message}</p>
          {children}
        </div>
        <div className="modal-footer">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || disabled} onClick={onConfirm}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
