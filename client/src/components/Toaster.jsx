import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { dismiss, getToasts, subscribeToToasts } from '../services/toast';

export default function Toaster() {
  const toasts = useSyncExternalStore(subscribeToToasts, getToasts);
  return (
    // aria-live makes screen readers announce new messages.
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button className="btn-icon" aria-label="Dismiss" onClick={() => dismiss(t.id)} style={{ width: 24, height: 24 }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
