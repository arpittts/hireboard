import { useId, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { STATUSES, capitalize } from '../constants';
import { SAMPLE_JOBS } from '../sampleJobs';
import { errorMessage } from '../services/api';
import { useExtractJobDescription } from '../services/queries';

// Today in the user's timezone (toISOString would give the UTC date).
const today = () => new Date().toLocaleDateString('en-CA');

const TYPES = ['job', 'internship', 'freelance', 'contract'];
const PRIORITIES = ['low', 'medium', 'high'];

const EMPTY_FORM = {
  company_name: '', role: '', type: 'job', status: 'applied',
  deadline: '', url: '', location: '', salary: '', notes: '',
  contact_name: '', contact_email: '', contact_phone: '', contact_linkedin: '',
  follow_up_date: '', priority: 'medium', job_description: '',
};

// The form starts from the application being edited, or empty for a new one.
// The parent gives each application its own `key`, so the form resets when that changes.
function initialForm(application) {
  if (!application) return { ...EMPTY_FORM, application_date: today() };
  const form = { application_date: application.application_date?.split('T')[0] || '' };
  for (const [key, empty] of Object.entries(EMPTY_FORM)) {
    const value = application[key];
    form[key] = typeof value === 'string' && key.endsWith('date') ? value.split('T')[0] : value || empty;
  }
  return form;
}

// A labelled form field. `check` is a short hint shown when the AI wasn't sure
// about a value ("please check") or couldn't find a required one.
function Field({ label, check, children }) {
  const id = useId();
  return (
    <div className={`form-group ${check ? 'field-check' : ''}`}>
      <label className="form-label" htmlFor={id}>
        {label}
        {check && <span className="field-check-hint"> · {check}</span>}
      </label>
      {children(id)}
    </div>
  );
}

// "Paste job description": the AI fills the form, the user checks it.
function PasteJobDescription({ onExtracted }) {
  const [text, setText] = useState('');
  const extract = useExtractJobDescription();
  const textId = useId();

  const run = () => extract.mutate(text, { onSuccess: (result) => onExtracted(text, result) });

  return (
    <div>
      <label className="form-label" htmlFor={textId}>Job description</label>
      <textarea
        id={textId}
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the whole job posting here: title, company, location, pay, requirements…"
        style={{ resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>
        No posting handy? Try a sample:
        {SAMPLE_JOBS.map((sample) => (
          <button key={sample.label} type="button" className="link-button" onClick={() => setText(sample.text)}>
            {sample.label}
          </button>
        ))}
      </div>
      {extract.isError && (
        <div role="alert" className="form-error">{errorMessage(extract.error, 'Could not read the job description.')}</div>
      )}
      <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={run} disabled={extract.isPending || text.trim().length < 80}>
        <Sparkles size={16} /> {extract.isPending ? 'Reading the job description…' : 'Fill the form from this'}
      </button>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
        Uses Google's free Gemini tier, so only paste public job postings. You'll check every field before saving.
      </p>
    </div>
  );
}

// Fields the AI fills, and the matching confidence key in its answer.
const AI_FIELDS = ['company_name', 'role', 'location', 'type', 'salary', 'deadline', 'url'];
const CONFIDENCE_KEY = { company_name: 'company_name', role: 'role', location: 'location', type: 'type', salary: 'salary', deadline: 'deadline' };

// A job saved with the Chrome extension: the server already read the posting.
function formFromImport({ text, url, result }) {
  // Saved while browsing, so not applied to yet.
  const form = { ...initialForm(null), status: 'wishlist', job_description: text };
  for (const key of AI_FIELDS) if (result.fields[key]) form[key] = result.fields[key];
  if (!form.url && url) form.url = url; // no apply link in the posting: keep the page it came from
  return form;
}

// `imported` ({ text, url, title, result }) opens the form already filled from the extension.
export default function ApplicationModal({ onClose, onSave, application, imported }) {
  const [form, setForm] = useState(() => (imported ? formFromImport(imported) : initialForm(application)));
  const [mode, setMode] = useState(application || imported ? 'manual' : 'paste');
  const [ai, setAi] = useState(imported?.result ?? null); // { extraction, warnings, model, promptVersion } after "Fill the form"
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // After "Fill the form": a hint for values the AI marked low or medium confidence,
  // and for required fields it couldn't find (for example an agency hiding the employer).
  const needsCheck = (key) => {
    if (!ai) return null;
    if (!form[key]) return key === 'company_name' || key === 'role' ? 'not in the posting, please fill in' : null;
    const level = ai.extraction.confidence[CONFIDENCE_KEY[key]];
    return level && level !== 'high' ? 'please check' : null;
  };

  const onExtracted = (text, result) => {
    setForm(f => {
      const next = { ...f, job_description: text };
      for (const key of AI_FIELDS) if (result.fields[key]) next[key] = result.fields[key];
      return next;
    });
    setAi(result);
    setMode('manual');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = { ...form };
      if (ai) {
        data.source = imported ? 'extension' : 'jd_paste';
        data.jd_extraction = {
          requirements: ai.extraction.requirements,
          model: ai.model,
          promptVersion: ai.promptVersion,
          warnings: ai.warnings,
        };
      }
      await onSave(data);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the application.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="application-modal-title" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="application-modal-title">{application ? 'Edit Application' : 'New Application'}</h2>
          <button className="btn-icon" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        {!application && !imported && (
          <div className="tabs" role="tablist" style={{ padding: '0 24px', marginBottom: 0 }}>
            <button type="button" role="tab" className="tab" aria-selected={mode === 'paste'} onClick={() => setMode('paste')}>
              <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />Paste job description
            </button>
            <button type="button" role="tab" className="tab" aria-selected={mode === 'manual'} onClick={() => setMode('manual')}>
              {ai ? 'Check & save' : 'Enter manually'}
            </button>
          </div>
        )}

        {mode === 'paste' ? (
          <div className="modal-body"><PasteJobDescription onExtracted={onExtracted} /></div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {ai && (
                <div className="ai-filled-note" role="status">
                  <strong>Filled from {imported ? `the page you saved${imported.title ? ` ("${imported.title}")` : ''}` : 'the job description'}{ai.cached ? ' (saved answer)' : ''}.</strong> Check the fields before saving
                  {AI_FIELDS.some(needsCheck) ? '; highlighted ones need a closer look.' : '.'}
                  {ai.warnings.length > 0 && <ul>{ai.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
                  {ai.extraction.requirements.length > 0 && (
                    <div style={{ marginTop: 6 }}>{ai.extraction.requirements.length} requirements will be saved with the application.</div>
                  )}
                </div>
              )}
              <div className="form-row">
                <Field label="Company Name *" check={needsCheck('company_name')}>
                  {id => <input id={id} value={form.company_name} onChange={e => update('company_name', e.target.value)} placeholder="Google" required />}
                </Field>
                <Field label="Role *" check={needsCheck('role')}>
                  {id => <input id={id} value={form.role} onChange={e => update('role', e.target.value)} placeholder="Software Engineer" required />}
                </Field>
              </div>
              <div className="form-row">
                <Field label="Type" check={needsCheck('type')}>
                  {id => (
                    <select id={id} value={form.type} onChange={e => update('type', e.target.value)}>
                      {TYPES.map(t => <option key={t} value={t}>{capitalize(t)}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Status">
                  {id => (
                    <select id={id} value={form.status} onChange={e => update('status', e.target.value)}>
                      {STATUSES.map(s => <option key={s} value={s}>{capitalize(s)}</option>)}
                    </select>
                  )}
                </Field>
              </div>
              <div className="form-row">
                <Field label="Priority">
                  {id => (
                    <select id={id} value={form.priority} onChange={e => update('priority', e.target.value)}>
                      {PRIORITIES.map(p => <option key={p} value={p}>{capitalize(p)}</option>)}
                    </select>
                  )}
                </Field>
                <Field label="Application Date">
                  {id => <input id={id} type="date" value={form.application_date} onChange={e => update('application_date', e.target.value)} />}
                </Field>
              </div>
              <div className="form-row">
                <Field label="Deadline" check={needsCheck('deadline')}>
                  {id => <input id={id} type="date" value={form.deadline} onChange={e => update('deadline', e.target.value)} />}
                </Field>
                <Field label="Follow-up Date">
                  {id => <input id={id} type="date" value={form.follow_up_date} onChange={e => update('follow_up_date', e.target.value)} />}
                </Field>
              </div>
              <div className="form-row">
                <Field label="Location" check={needsCheck('location')}>
                  {id => <input id={id} value={form.location} onChange={e => update('location', e.target.value)} placeholder="Bengaluru (hybrid)" />}
                </Field>
                <Field label="Salary" check={needsCheck('salary')}>
                  {id => <input id={id} value={form.salary} onChange={e => update('salary', e.target.value)} placeholder="₹8–12 LPA" />}
                </Field>
              </div>
              <Field label="Job URL">
                {id => <input id={id} value={form.url} onChange={e => update('url', e.target.value)} placeholder="https://careers.company.com/..." />}
              </Field>

              <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0', paddingTop: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: 'var(--accent-light)' }}>📇 Contact Info</h3>
                <div className="form-row">
                  <Field label="Contact Name">
                    {id => <input id={id} value={form.contact_name} onChange={e => update('contact_name', e.target.value)} placeholder="Jane Smith" />}
                  </Field>
                  <Field label="Contact Email">
                    {id => <input id={id} type="email" value={form.contact_email} onChange={e => update('contact_email', e.target.value)} placeholder="recruiter@company.com" />}
                  </Field>
                </div>
                <div className="form-row">
                  <Field label="Contact Phone">
                    {id => <input id={id} value={form.contact_phone} onChange={e => update('contact_phone', e.target.value)} placeholder="+91 98765 43210" />}
                  </Field>
                  <Field label="LinkedIn">
                    {id => <input id={id} value={form.contact_linkedin} onChange={e => update('contact_linkedin', e.target.value)} placeholder="linkedin.com/in/..." />}
                  </Field>
                </div>
              </div>

              <Field label="Notes">
                {id => <textarea id={id} value={form.notes} onChange={e => update('notes', e.target.value)} placeholder="Add any notes about this application..." rows={4} style={{ resize: 'vertical' }} />}
              </Field>
              <Field label="Job description">
                {id => <textarea id={id} value={form.job_description} onChange={e => update('job_description', e.target.value)} placeholder="The full job posting, for later reference" rows={5} style={{ resize: 'vertical' }} />}
              </Field>
            </div>
            {error && <div role="alert" className="form-error" style={{ margin: '0 24px 12px' }}>{error}</div>}
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : (application ? 'Update' : 'Add Application')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
