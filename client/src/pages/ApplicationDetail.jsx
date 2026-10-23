import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Edit3, ExternalLink, Link2, Mail, Phone, Trash2, User } from 'lucide-react';
import ApplicationModal from '../components/ApplicationModal';
import ConfirmDialog from '../components/ConfirmDialog';
import StatusMenu from '../components/StatusMenu';
import { useApplication, useDeleteApplication, useSaveApplication } from '../services/queries';

// More tabs (job description, interview prep, drafts) arrive in later phases.
const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'history', label: 'History' },
];

const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';
const formatDateTime = (d) => new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function Row({ label, children }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children}</span>
    </div>
  );
}

function Overview({ app }) {
  const hasContact = app.contact_name || app.contact_email || app.contact_phone || app.contact_linkedin;
  return (
    <>
      <div className="detail-section">
        <div className="detail-section-title">Details</div>
        <Row label="Type">{app.type}</Row>
        <Row label="Priority"><span className={`priority-${app.priority}`}>{app.priority}</span></Row>
        <Row label="Applied">{formatDate(app.application_date)}</Row>
        {app.deadline && <Row label="Deadline">{formatDate(app.deadline)}</Row>}
        {app.follow_up_date && <Row label="Follow-up"><span style={{ color: 'var(--accent-light)' }}>{formatDate(app.follow_up_date)}</span></Row>}
        {app.location && <Row label="Location">{app.location}</Row>}
        {app.salary && <Row label="Salary">{app.salary}</Row>}
        {app.url && (
          <Row label="Posting">
            <a href={app.url} target="_blank" rel="noopener noreferrer">Open <ExternalLink size={12} style={{ verticalAlign: 'middle' }} /></a>
          </Row>
        )}
      </div>

      {hasContact && (
        <div className="detail-section">
          <div className="detail-section-title">📇 Contact</div>
          {app.contact_name && <div className="detail-row"><User size={14} aria-hidden /><span className="detail-value">{app.contact_name}</span></div>}
          {app.contact_email && <div className="detail-row"><Mail size={14} aria-hidden /><a href={`mailto:${app.contact_email}`}>{app.contact_email}</a></div>}
          {app.contact_phone && <div className="detail-row"><Phone size={14} aria-hidden /><span className="detail-value">{app.contact_phone}</span></div>}
          {app.contact_linkedin && <div className="detail-row"><Link2 size={14} aria-hidden /><span className="detail-value">{app.contact_linkedin}</span></div>}
        </div>
      )}

      <div className="detail-section">
        <div className="detail-section-title">📝 Notes</div>
        {app.notes
          ? <p style={{ fontSize: 14, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', background: 'var(--bg-card)', padding: 14, borderRadius: 8 }}>{app.notes}</p>
          : <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No notes yet. Use Edit to add some.</p>}
      </div>
    </>
  );
}

function History({ history }) {
  return (
    <div className="timeline">
      {history.map(h => (
        <div key={h.id} className="timeline-item">
          <div className="timeline-dot" style={{ background: h.to_status === 'rejected' ? '#e17055' : h.to_status === 'offer' ? '#00b894' : '#6C5CE7' }} />
          <div className="timeline-content">
            {h.from_status ? <span>{h.from_status} → <strong>{h.to_status}</strong></span> : <strong>{h.to_status}</strong>}
            {h.note && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{h.note}</div>}
          </div>
          <div className="timeline-date">{formatDateTime(h.changed_at)}</div>
        </div>
      ))}
    </div>
  );
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: app, isPending, isError, error } = useApplication(id);
  const save = useSaveApplication();
  const remove = useDeleteApplication();
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (isPending) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><div className="spinner" /></div>;
  if (isError) {
    const notFound = [400, 404].includes(error.response?.status);
    return (
      <div className="empty-state">
        <div className="empty-state-title">{notFound ? 'Application not found' : "Couldn't load this application"}</div>
        <Link to="/applications" className="btn btn-secondary">Back to applications</Link>
      </div>
    );
  }

  const confirmDelete = () => remove.mutate(app.id, { onSuccess: () => navigate('/applications') });

  return (
    <div style={{ maxWidth: 860 }}>
      <Link to="/applications" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 16 }}>
        <ArrowLeft size={14} /> All applications
      </Link>

      <div className="page-header">
        <div>
          <h1 className="page-title">{app.company_name}</h1>
          <p className="page-subtitle">{app.role}{app.location ? ` · ${app.location}` : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusMenu application={app} />
          <button className="btn btn-secondary" onClick={() => setEditing(true)}><Edit3 size={14} /> Edit</button>
          <button className="btn btn-danger" onClick={() => setDeleting(true)}><Trash2 size={14} /> Delete</button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}{t.id === 'history' ? ` (${app.statusHistory.length})` : ''}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'overview' ? <Overview app={app} /> : <History history={app.statusHistory} />}
      </div>

      {editing && (
        <ApplicationModal application={app} onClose={() => setEditing(false)} onSave={(form) => save.mutateAsync({ id: app.id, data: form })} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete application?"
          message={`${app.company_name}, ${app.role}, and its status history will be deleted. This can't be undone.`}
          busy={remove.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
