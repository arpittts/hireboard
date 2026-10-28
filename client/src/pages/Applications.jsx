import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Trash2, Edit3, ExternalLink, MapPin, Calendar, Star, Sparkles } from 'lucide-react';
import ApplicationModal from '../components/ApplicationModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { STATUSES, capitalize } from '../constants';
import { useApplications, useDeleteApplication, useSaveApplication, useSmartSearch } from '../services/queries';
import { errorMessage } from '../services/api';

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

// The server marks matched words with [[ ]]; shown as <mark> without parsing any HTML.
const Highlighted = ({ text }) => text.split(/\[\[(.*?)\]\]/g).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));

export default function Applications() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, 'new', or an application
  const [deleting, setDeleting] = useState(null);

  // Typing filters by company and role. Enter runs smart search over job
  // descriptions and notes (keyword + meaning) until the text changes again.
  const [smartQuery, setSmartQuery] = useState('');
  const typed = search.trim();
  const smart = Boolean(smartQuery) && smartQuery === typed;

  const debouncedSearch = useDebounced(typed, 300);
  const params = {};
  if (debouncedSearch && !smart) params.search = debouncedSearch;
  if (statusFilter && !smart) params.status = statusFilter;

  const list = useApplications(params);
  const smartSearch = useSmartSearch(smart ? smartQuery : '');
  const { isPending, isError, error, refetch } = smart ? smartSearch : list;
  const apps = smart
    ? (smartSearch.data?.results ?? []).filter((a) => !statusFilter || a.status === statusFilter)
    : list.data ?? [];
  const save = useSaveApplication();
  const remove = useDeleteApplication();
  const filtering = Boolean(debouncedSearch || statusFilter);

  const confirmDelete = () => remove.mutate(deleting.id, { onSettled: () => setDeleting(null) });

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Applications</h1>
          <p className="page-subtitle">{apps.length} application{apps.length !== 1 ? 's' : ''}{filtering || smart ? ' match' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} /> Add Application
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <Search size={16} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && typed.length >= 2) setSmartQuery(typed); }}
            placeholder="Search company or role, or press Enter to search everything..."
            aria-label="Search applications"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 170 }} aria-label="Filter by status">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
        </select>
      </div>

      {typed.length >= 2 && !smart && (
        <p className="search-hint">
          Matching company and role. <button onClick={() => setSmartQuery(typed)}>Press Enter to also search job descriptions and notes by meaning.</button>
        </p>
      )}
      {smart && (
        <p className="search-hint">
          <Sparkles size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Smart search: words and meaning across job descriptions and notes.{' '}
          {smartSearch.data?.mode === 'keyword' && 'Meaning search is unavailable right now (AI is off or today\'s AI limit is used up), so these are word matches only. '}
          <button onClick={() => setSmartQuery('')}>Back to company and role.</button>
        </p>
      )}

      {isPending ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}><div className="spinner" /></div>
      ) : isError ? (
        <div className="empty-state">
          <div className="empty-state-title">{smart ? errorMessage(error, "Search didn't work") : "Couldn't load applications"}</div>
          <button className="btn btn-secondary" onClick={() => refetch()}>Try again</button>
        </div>
      ) : apps.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-title">{filtering || smart ? 'Nothing matches' : 'No applications yet'}</div>
          <div className="empty-state-text">
            {filtering || smart ? 'Try another search or status.' : 'Start tracking your job search by adding your first application.'}
          </div>
          {!filtering && !smart && (
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
                <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                  {smart && app.matchedBy.map(m => (
                    <span key={m} className="badge match-badge" title={m === 'meaning' ? `Similar meaning (${Math.round(app.similarity * 100)}% similar)` : 'Contains your words'}>
                      {m === 'meaning' ? 'by meaning' : 'by keyword'}
                    </span>
                  ))}
                  <span><Calendar size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{formatDate(app.application_date)}</span>
                  {app.location && <span><MapPin size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{app.location}</span>}
                  {app.salary && <span>💰 {app.salary}</span>}
                </div>
                {smart && app.snippet && <div className="snippet"><Highlighted text={app.snippet} /></div>}
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
