import { useState, useEffect } from 'react';
import { Plus, Search, Trash2, Edit3, ExternalLink, MapPin, Calendar, Star, User, Mail, Phone } from 'lucide-react';
import api from '../services/api';
import ApplicationModal from '../components/ApplicationModal';

export default function Applications() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editApp, setEditApp] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [detailApp, setDetailApp] = useState(null);

  const fetchApps = async () => {
    try {
      const params = {};
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get('/applications', { params });
      setApps(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchApps(); }, [statusFilter]);
  useEffect(() => { const t = setTimeout(fetchApps, 300); return () => clearTimeout(t); }, [search]);

  const handleSave = async (formData) => {
    if (editApp) {
      await api.put(`/applications/${editApp.id}`, formData);
    } else {
      await api.post('/applications', formData);
    }
    fetchApps();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this application?')) return;
    await api.delete(`/applications/${id}`);
    setDetailApp(null);
    fetchApps();
  };

  const viewDetail = async (app) => {
    try {
      const res = await api.get(`/applications/${app.id}`);
      setDetailApp(res.data);
    } catch (err) { console.error(err); }
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Applications</h1>
          <p className="page-subtitle">{apps.length} total application{apps.length !== 1 ? 's' : ''}</p>
        </div>
        <button className="btn btn-primary" onClick={() => { setEditApp(null); setModalOpen(true); }}>
          <Plus size={16} /> Add Application
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <div className="search-bar" style={{ flex: 1, minWidth: 200 }}>
          <Search size={16} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company or role..." />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 160 }}>
          <option value="">All Statuses</option>
          {['wishlist','applied','interview','offer','rejected','accepted','withdrawn'].map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {apps.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📭</div>
          <div className="empty-state-title">No applications yet</div>
          <div className="empty-state-text">Start tracking your job search by adding your first application.</div>
          <button className="btn btn-primary" onClick={() => { setEditApp(null); setModalOpen(true); }}>
            <Plus size={16} /> Add Your First Application
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {apps.map(app => (
            <div key={app.id} className="card" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }} onClick={() => viewDetail(app)}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{app.company_name}</span>
                  <span className={`badge badge-${app.status}`}>{app.status}</span>
                  {app.priority === 'high' && <Star size={14} className="priority-high" fill="currentColor" />}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{app.role}</div>
                <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                  <span><Calendar size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{formatDate(app.application_date)}</span>
                  {app.location && <span><MapPin size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />{app.location}</span>}
                  {app.salary && <span>💰 {app.salary}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
                {app.url && <a href={app.url} target="_blank" rel="noopener noreferrer" className="btn-icon"><ExternalLink size={14} /></a>}
                <button className="btn-icon" onClick={() => { setEditApp(app); setModalOpen(true); }}><Edit3 size={14} /></button>
                <button className="btn-icon" style={{ color: 'var(--red)' }} onClick={() => handleDelete(app.id)}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail side panel */}
      {detailApp && (
        <div className="modal-overlay" onClick={() => setDetailApp(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <div>
                <h2>{detailApp.company_name}</h2>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{detailApp.role}</p>
              </div>
              <button className="btn-icon" onClick={() => setDetailApp(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                <span className={`badge badge-${detailApp.status}`}>{detailApp.status}</span>
                <span className={`badge badge-${detailApp.type === 'internship' ? 'interview' : 'applied'}`}>{detailApp.type}</span>
                <span className={`badge priority-${detailApp.priority}`} style={{ background: 'var(--bg-card)' }}>{detailApp.priority} priority</span>
              </div>

              <div className="detail-section">
                <div className="detail-section-title">Details</div>
                <div className="detail-row"><span className="detail-label">Applied</span><span className="detail-value">{formatDate(detailApp.application_date)}</span></div>
                {detailApp.deadline && <div className="detail-row"><span className="detail-label">Deadline</span><span className="detail-value">{formatDate(detailApp.deadline)}</span></div>}
                {detailApp.location && <div className="detail-row"><span className="detail-label">Location</span><span className="detail-value">{detailApp.location}</span></div>}
                {detailApp.salary && <div className="detail-row"><span className="detail-label">Salary</span><span className="detail-value">{detailApp.salary}</span></div>}
                {detailApp.follow_up_date && <div className="detail-row"><span className="detail-label">Follow-up</span><span className="detail-value" style={{ color: 'var(--accent-light)' }}>{formatDate(detailApp.follow_up_date)}</span></div>}
              </div>

              {(detailApp.contact_name || detailApp.contact_email) && (
                <div className="detail-section">
                  <div className="detail-section-title">📇 Contact</div>
                  {detailApp.contact_name && <div className="detail-row"><User size={14} style={{ color: 'var(--text-muted)', marginTop: 2 }} /><span className="detail-value">{detailApp.contact_name}</span></div>}
                  {detailApp.contact_email && <div className="detail-row"><Mail size={14} style={{ color: 'var(--text-muted)', marginTop: 2 }} /><a href={`mailto:${detailApp.contact_email}`}>{detailApp.contact_email}</a></div>}
                  {detailApp.contact_phone && <div className="detail-row"><Phone size={14} style={{ color: 'var(--text-muted)', marginTop: 2 }} /><span className="detail-value">{detailApp.contact_phone}</span></div>}
                </div>
              )}

              {detailApp.notes && (
                <div className="detail-section">
                  <div className="detail-section-title">📝 Notes</div>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', background: 'var(--bg-card)', padding: 14, borderRadius: 8 }}>{detailApp.notes}</p>
                </div>
              )}

              {detailApp.statusHistory?.length > 0 && (
                <div className="detail-section">
                  <div className="detail-section-title">📜 Status History</div>
                  <div className="timeline">
                    {detailApp.statusHistory.map(h => (
                      <div key={h.id} className="timeline-item">
                        <div className="timeline-dot" style={{ background: h.to_status ? (h.to_status === 'rejected' ? '#e17055' : h.to_status === 'offer' ? '#00b894' : '#6C5CE7') : '#6C5CE7' }} />
                        <div className="timeline-content">
                          {h.from_status ? <span>{h.from_status} → <strong>{h.to_status}</strong></span> : <strong>{h.to_status}</strong>}
                        </div>
                        <div className="timeline-date">{new Date(h.changed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ApplicationModal isOpen={modalOpen} onClose={() => { setModalOpen(false); setEditApp(null); }} onSave={handleSave} application={editApp} />
    </div>
  );
}
