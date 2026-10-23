import { STATUSES, capitalize } from '../constants';
import { useMoveApplication } from '../services/queries';

// A keyboard-friendly way to change status: an alternative to drag and drop.
export default function StatusMenu({ application, compact = false }) {
  const move = useMoveApplication();
  return (
    <select
      className={compact ? 'status-select status-select-compact' : 'status-select'}
      aria-label={`Status of ${application.company_name}`}
      value={application.status}
      disabled={move.isPending}
      // Keep clicks and key presses from opening or dragging the card underneath.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => move.mutate({ id: application.id, status: e.target.value })}
    >
      {STATUSES.map((s) => <option key={s} value={s}>{capitalize(s)}</option>)}
    </select>
  );
}
