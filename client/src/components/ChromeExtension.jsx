import { useCallback, useEffect, useState } from 'react';
import { Puzzle } from 'lucide-react';
import api, { API_URL, errorMessage } from '../services/api';
import { toast } from '../services/toast';

// The "Save to HireBoard" extension (extension/ in the repo). Its id is fixed by the
// key in its manifest. Chrome lets this page message it because the extension lists
// HireBoard under externally_connectable; nothing else on the web can.
const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID || 'cnfkcgfemjafknicklcmdadgpokmajji';
const INSTALL_GUIDE = 'https://github.com/arpittts/hireboard#-save-to-hireboard-chrome-extension';

// Resolves with the extension's answer, or null if it isn't installed (or this isn't Chrome).
function askExtension(message) {
  return new Promise((resolve) => {
    if (!window.chrome?.runtime?.sendMessage) return resolve(null);
    try {
      window.chrome.runtime.sendMessage(EXTENSION_ID, message, (reply) => {
        resolve(window.chrome.runtime.lastError ? null : reply ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

export default function ChromeExtension() {
  const [status, setStatus] = useState(undefined); // undefined: checking, null: not installed
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => askExtension({ type: 'status' }).then(setStatus), []);
  useEffect(() => { refresh(); }, [refresh]);

  const connect = async () => {
    setBusy(true);
    try {
      // A token that can only save jobs: the API refuses it everywhere else.
      const { token, user } = (await api.post('/auth/extension-token')).data;
      const reply = await askExtension({ type: 'connect', token, apiUrl: new URL(API_URL, window.location.href).href, user });
      if (!reply?.ok) throw new Error(reply?.error ?? 'The extension did not answer. Reload this page and try again.');
      toast.success('Extension connected. Open a job posting and click the HireBoard icon.');
      refresh();
    } catch (err) {
      toast.error(errorMessage(err, err.message));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await askExtension({ type: 'disconnect' });
    refresh();
  };

  return (
    <section className="card settings-section" aria-labelledby="extension-title">
      <h2 id="extension-title" className="chart-title"><Puzzle size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Chrome extension</h2>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        Save a job from any careers page in two clicks: the extension sends the posting to HireBoard, which fills in the form for you to check.
        It reads a page only when you click Save.
      </p>
      {status === undefined ? (
        <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
      ) : status === null ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Not installed in this browser. <a href={INSTALL_GUIDE} target="_blank" rel="noopener noreferrer">How to install it</a> (Chrome on a computer).
        </p>
      ) : status.connected ? (
        <div className="settings-row">
          <p style={{ fontSize: 13 }}>Connected as <strong>{status.connected.email}</strong>. The connection lasts 30 days.</p>
          <button className="btn btn-secondary" onClick={disconnect}>Disconnect</button>
        </div>
      ) : (
        <div className="settings-row">
          <p style={{ fontSize: 13 }}>Installed (version {status.version}), not connected yet.</p>
          <button className="btn btn-primary" onClick={connect} disabled={busy}>{busy ? 'Connecting…' : 'Connect Chrome extension'}</button>
        </div>
      )}
    </section>
  );
}
