import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Download, Trash2 } from 'lucide-react';
import { toast } from '../services/toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../context/auth';
import api, { errorMessage } from '../services/api';
import { useSettings, useUpdateSettings } from '../services/queries';

function Reminders() {
  const { data: settings, isPending } = useSettings();
  const update = useUpdateSettings();
  if (isPending || !settings) return <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />;

  return (
    <>
      <div className="settings-row">
        <label className="switch">
          <input
            type="checkbox"
            checked={settings.remindersEnabled}
            disabled={settings.isDemo || update.isPending}
            onChange={(e) => update.mutate({ remindersEnabled: e.target.checked })}
          />
          Email me on an application's follow-up date
        </label>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>
        {settings.isDemo
          ? 'Not available in the demo account: its email address is not real.'
          : 'Sent once a day at about 9:00 India time, at most 5 a day. Rejected, accepted and withdrawn applications are skipped.'}
        {!settings.isDemo && !settings.emailConfigured && ' Email sending is not set up on this server yet, so nothing will be sent for now.'}
      </p>
    </>
  );
}

async function downloadExport() {
  const res = await api.get('/export', { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = `hireboard-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function Settings() {
  const { user, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const exportData = async () => {
    setExporting(true);
    try {
      await downloadExport();
      toast.success('Your data was downloaded');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not export your data.'));
    } finally {
      setExporting(false);
    }
  };

  const closeDelete = () => {
    setConfirmingDelete(false);
    setPassword('');
    setDeleteError('');
  };

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteAccount(user.isDemo ? undefined : password);
      toast.success('Your account was deleted');
      navigate('/login');
    } catch (err) {
      setDeleteError(errorMessage(err, 'Could not delete your account.'));
      setDeleting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">{user.isDemo ? 'Demo account' : `Signed in as ${user.email}`}</p>
        </div>
      </div>

      <section className="card settings-section" aria-labelledby="reminders-title">
        <h2 id="reminders-title" className="chart-title"><Bell size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Follow-up reminders</h2>
        <Reminders />
      </section>

      <section className="card settings-section" aria-labelledby="export-title">
        <h2 id="export-title" className="chart-title"><Download size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Export your data</h2>
        <div className="settings-row">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Download every application and status change as a JSON file.</p>
          <button className="btn btn-secondary" onClick={exportData} disabled={exporting}>
            {exporting ? 'Preparing…' : 'Download JSON'}
          </button>
        </div>
      </section>

      <section className="card settings-section" aria-labelledby="delete-title" style={{ borderColor: 'rgba(225,112,85,0.3)' }}>
        <h2 id="delete-title" className="chart-title" style={{ color: 'var(--red)' }}><Trash2 size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Delete account</h2>
        <div className="settings-row">
          <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Permanently delete your account, applications and history.</p>
          <button className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>Delete account</button>
        </div>
      </section>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete your account?"
          message="Everything in HireBoard will be deleted for good. Export your data first if you want a copy."
          confirmLabel="Delete everything"
          busy={deleting}
          disabled={!user.isDemo && !password}
          onConfirm={confirmDelete}
          onCancel={closeDelete}
        >
          {!user.isDemo && (
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label" htmlFor="delete-password">Current password</label>
              <input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          {deleteError && <div role="alert" style={{ background: 'var(--red-bg)', color: 'var(--red)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginTop: 12 }}>{deleteError}</div>}
        </ConfirmDialog>
      )}
    </div>
  );
}
