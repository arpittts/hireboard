import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Trash2, Edit3, ExternalLink, MapPin, Calendar, Star } from 'lucide-react';
import ApplicationModal from '../components/ApplicationModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { STATUSES, capitalize } from '../constants';
import { useApplications, useDeleteApplication, useSaveApplication } from '../services/queries';

const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

// Waits until the value stops changing for `delay` ms (so search runs after typing stops).
function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function Applications() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, 'new', or an application
  const [deleting, setDeleting] = useState(null);

  const debouncedSearch = useDebounced(search.trim(), 300);
  const params = {};
  if (debouncedSearch) params.search = debouncedSearch;
  if (statusFilter) params.status = statusFilter;

  const { data: apps = [], isPending, isError, refetch } = useApplications(params);
  const save = useSaveApplication();
  const remove = useDeleteApplication();
  const filtering = Boolean(debouncedSearch || statusFilter);

  const confirmDelete = () => remove.mutate(deleting.id, { onSettled: () => setDeleting(null) });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Applications</h1>
          <p className="page-subtitle">{apps.length} application{apps.length !== 1 ? 's' : ''}{filtering ? ' match' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Add Application
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <Search size={16} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company or role..." aria-label="Search company or role" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 170 }} aria-label="Filter by status">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
      </div>

      {isPending ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><div className="spinner" /></div>
      ) : isError ? (
        <div className="empty-state">
          <div className="empty-state-title">Couldn't load applications</div>
          <button className="btn btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      ) : apps.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-title">{filtering ? 'Nothing matches' : 'No applications yet'}</div>
          <div className="empty-state-text">
            {filtering ? 'Try another search or status.' : 'Start tracking your job search by adding your first application.'}
          </div>
          {!filtering && (
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Add Your First Application
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {apps.map(app => (
            <div
              key={app.id}
              className="card"
              role="link"
              tabIndex={0}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
              onClick={() => navigate(`/applications/${app.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/applications/${app.id}`); }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{app.company_name}</span>
                  <span className={`badge badge-${app.status}`}>{app.status}</span>
                  {app.priority === 'high' && <Star size={14} className="priority-high" fill="currentColor" aria-label="High priority" />}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.role}</div>
                <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                  <span><Calendar size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{formatDate(app.application_date)}</span>
                  {app.location && <span><MapPin size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{app.location}</span>}
                  {app.salary && <span>💰 {app.salary}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                {app.url && <a href={app.url} target="_blank" rel="noopener noreferrer" className="btn-icon" aria-label="Open job posting"><ExternalLink size={14} /></a>}
                <button className="btn-icon" aria-label={`Edit ${app.company_name}`} onClick={() => setEditing(app)}><Edit3 size={14} /></button>
                <button className="btn-icon" aria-label={`Delete ${app.company_name}`} style={{ color: 'var(--red)' }} onClick={() => setDeleting(app)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ApplicationModal
          key={editing === 'new' ? 'new' : editing.id}
          application={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(form) => save.mutateAsync({ id: editing === 'new' ? undefined : editing.id, data: form })}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete application?"
          message={`${deleting.company_name}, ${deleting.role}, and its status history will be deleted. This can't be undone.`}
          busy={remove.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
