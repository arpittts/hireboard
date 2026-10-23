import { useSyncExternalStore } from 'react';
import { isServerSlow, subscribeToSlowRequests } from '../services/api';

// Shown while any request has taken more than 3 seconds: usually the free
// server waking up after sleeping.
export default function ServerWakeBanner() {
  const slow = useSyncExternalStore(subscribeToSlowRequests, isServerSlow);
  if (!slow) return null;
  return (
    <div className="wake-banner" role="status">
      <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
      Waking the free server. This can take up to a minute after it has been idle.
    </div>
  );
}
