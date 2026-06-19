import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

const STATUSES = ['wishlist', 'applied', 'interview', 'offer', 'rejected', 'accepted', 'withdrawn'];
const TYPES = ['job', 'internship', 'freelance', 'contract'];
const PRIORITIES = ['low', 'medium', 'high'];

export default function ApplicationModal({ isOpen, onClose, onSave, application }) {
  const [form, setForm] = useState({
    company_name: '', role: '', type: 'job', status: 'applied',
    application_date: new Date().toISOString().split('T')[0],
    deadline: '', url: '', location: '', salary: '', notes: '',
    contact_name: '', contact_email: '', contact_phone: '', contact_linkedin: '',
    follow_up_date: '', priority: 'medium',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (application) {
      setForm({
        company_name: application.company_name || '',
        role: application.role || '',
        type: application.type || 'job',
        status: application.status || 'applied',
        application_date: application.application_date?.split('T')[0] || '',
        deadline: application.deadline?.split('T')[0] || '',
        url: application.url || '',
        location: application.location || '',
        salary: application.salary || '',
        notes: application.notes || '',
        contact_name: application.contact_name || '',
        contact_email: application.contact_email || '',
        contact_phone: application.contact_phone || '',
        contact_linkedin: application.contact_linkedin || '',
        follow_up_date: application.follow_up_date?.split('T')[0] || '',
        priority: application.priority || 'medium',
      });
    } else {
      setForm({
        company_name: '', role: '', type: 'job', status: 'applied',
        application_date: new Date().toISOString().split('T')[0],
        deadline: '', url: '', location: '', salary: '', notes: '',
        contact_name: '', contact_email: '', contact_phone: '', contact_linkedin: '',
        follow_up_date: '', priority: 'medium',
      });
    }
  }, [application, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{application ? 'Edit Application' : 'New Application'}</h2>
          <button className="btn-icon" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Company Name *</label>
                <input value={form.company_name} onChange={e => update('company_name', e.target.value)} placeholder="Google" required />
              </div>
              <div className="form-group">
                <label className="form-label">Role *</label>
                <input value={form.role} onChange={e => update('role', e.target.value)} placeholder="Software Engineer" required />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Type</label>
                <select value={form.type} onChange={e => update('type', e.target.value)}>
                  {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select value={form.status} onChange={e => update('status', e.target.value)}>
                  {STATUSES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Priority</label>
                <select value={form.priority} onChange={e => update('priority', e.target.value)}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Application Date</label>
                <input type="date" value={form.application_date} onChange={e => update('application_date', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Deadline</label>
                <input type="date" value={form.deadline} onChange={e => update('deadline', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Follow-up Date</label>
                <input type="date" value={form.follow_up_date} onChange={e => update('follow_up_date', e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Location</label>
                <input value={form.location} onChange={e => update('location', e.target.value)} placeholder="San Francisco, CA" />
              </div>
              <div className="form-group">
                <label className="form-label">Salary</label>
                <input value={form.salary} onChange={e => update('salary', e.target.value)} placeholder="$120k - $150k" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Job URL</label>
              <input value={form.url} onChange={e => update('url', e.target.value)} placeholder="https://careers.company.com/..." />
            </div>

            <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0', paddingTop: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--accent-light)' }}>📇 Contact Info</h3>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Contact Name</label>
                  <input value={form.contact_name} onChange={e => update('contact_name', e.target.value)} placeholder="Jane Smith" />
                </div>
                <div className="form-group">
                  <label className="form-label">Contact Email</label>
                  <input type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} placeholder="recruiter@company.com" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Contact Phone</label>
                  <input value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} placeholder="+1 (555) 000-0000" />
                </div>
                <div className="form-group">
                  <label className="form-label">LinkedIn</label>
                  <input value={form.contact_linkedin} onChange={e => update('contact_linkedin', e.target.value)} placeholder="linkedin.com/in/..." />
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Add any notes about this application..." rows={4} style={{ resize: 'vertical' }} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : (application ? 'Update' : 'Add Application')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
