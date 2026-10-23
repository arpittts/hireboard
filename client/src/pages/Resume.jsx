import { useId, useState } from 'react';
import { CheckCircle2, FileText, Trash2, Upload } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { errorMessage } from '../services/api';
import { useActivateResume, useAddResume, useDeleteResume, useResume, useResumes } from '../services/queries';

const SECTION_LABELS = {
  experience: 'Experience', projects: 'Projects', skills: 'Skills',
  education: 'Education', achievements: 'Achievements', other: 'Other',
};

// The parsed lines of one resume. Each line has an id that the checklist cites.
function ResumeLines({ id }) {
  const { data: resume, isPending } = useResume(id);
  if (isPending) return <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />;
  return (
    <div>
      {resume.sections.map((section, i) => (
        <div key={i} className="detail-section">
          <div className="detail-section-title">
            {section.title}
            {section.title.toLowerCase() !== section.kind && (
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {SECTION_LABELS[section.kind]}</span>
            )}
          </div>
          <ul className="resume-lines">
            {section.bullets.map(b => <li key={b.id}><span className="line-id">{b.id}</span>{b.text}</li>)}
          </ul>
        </div>
      ))}
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Split into lines by AI ({resume.model}, {resume.promptVersion}). Only lines found word for word in your resume are kept
        {resume.dropped > 0 && ` (${resume.dropped} left out)`}; contact details are never kept as lines.
      </p>
    </div>
  );
}

function AddResume({ onDone }) {
  const [mode, setMode] = useState('pdf');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const add = useAddResume();
  const titleId = useId();
  const fileId = useId();
  const textId = useId();

  const submit = (e) => {
    e.preventDefault();
    add.mutate(
      mode === 'pdf' ? { title, file } : { title, text },
      { onSuccess: (resume) => onDone(resume.id) },
    );
  };
  const ready = title.trim() && (mode === 'pdf' ? file : text.trim().length >= 200);

  return (
    <form onSubmit={submit} className="card" style={{ marginBottom: 20 }}>
      <h2 className="chart-title"><Upload size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />Add a resume</h2>
      <div className="privacy-note" role="note">
        <strong>Before you upload:</strong> your resume's text is sent to Google's free Gemini tier, and Google may use free-tier
        inputs to improve its products. Only the text is kept here (never the file), and you can delete it any time.
        To just try the feature, use the demo account's sample resume.
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor={titleId}>Name</label>
        <input id={titleId} value={title} onChange={e => setTitle(e.target.value)} placeholder="For example: AI internships 2026" maxLength={120} />
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
        <button type="button" role="tab" className="tab" aria-selected={mode === 'pdf'} onClick={() => setMode('pdf')}>Upload PDF</button>
        <button type="button" role="tab" className="tab" aria-selected={mode === 'text'} onClick={() => setMode('text')}>Paste text</button>
      </div>
      {mode === 'pdf' ? (
        <div className="form-group">
          <label className="form-label" htmlFor={fileId}>PDF (up to 2 MB and 5 pages, with selectable text)</label>
          <input id={fileId} type="file" accept="application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        </div>
      ) : (
        <div className="form-group">
          <label className="form-label" htmlFor={textId}>Resume text</label>
          <textarea id={textId} rows={10} value={text} onChange={e => setText(e.target.value)} placeholder="Paste your whole resume" style={{ resize: 'vertical' }} />
        </div>
      )}
      {add.isError && <div role="alert" className="form-error">{errorMessage(add.error, 'Could not read the resume.')}</div>}
      <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }} disabled={!ready || add.isPending}>
        {add.isPending ? 'Reading your resume…' : 'Save resume'}
      </button>
    </form>
  );
}

export default function Resume() {
  const { data: resumes = [], isPending } = useResumes();
  const activate = useActivateResume();
  const remove = useDeleteResume();
  const [openId, setOpenId] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [adding, setAdding] = useState(false);

  const shownId = openId ?? resumes.find(r => r.isActive)?.id;

  if (isPending) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><div className="spinner" /></div>;

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Resume</h1>
          <p className="page-subtitle">Your active resume is used to check each job's requirements.</p>
        </div>
        {resumes.length > 0 && resumes.length < 3 && !adding && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Upload size={16} /> Add resume</button>
        )}
      </div>

      {(adding || resumes.length === 0) && <AddResume onDone={(id) => { setAdding(false); setOpenId(id); }} />}

      {resumes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {resumes.map(r => (
            <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, borderColor: r.id === shownId ? 'var(--border-hover)' : undefined }}>
              <FileText size={18} aria-hidden style={{ color: 'var(--accent-light)' }} />
              <button className="link-button" style={{ flex: 1, textAlign: 'left', color: 'var(--text-primary)' }} onClick={() => setOpenId(r.id)}>
                {r.title} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>· {r.bulletCount} lines</span>
              </button>
              {r.isActive
                ? <span className="badge badge-offer"><CheckCircle2 size={12} style={{ verticalAlign: 'middle' }} /> Active</span>
                : <button className="btn btn-secondary btn-sm" onClick={() => activate.mutate(r.id)} disabled={activate.isPending}>Make active</button>}
              <button className="btn-icon" aria-label={`Delete ${r.title}`} style={{ color: 'var(--red)' }} onClick={() => setDeleting(r)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {shownId && <div className="card"><ResumeLines id={shownId} /></div>}

      {deleting && (
        <ConfirmDialog
          title="Delete resume?"
          message={`"${deleting.title}" will be deleted. Requirement checks made with it stay, but can't be re-run with it.`}
          busy={remove.isPending}
          onConfirm={() => remove.mutate(deleting.id, { onSettled: () => { setDeleting(null); setOpenId(null); } })}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
