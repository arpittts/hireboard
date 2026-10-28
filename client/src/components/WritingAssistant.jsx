import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, PenLine, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { errorMessage, streamPost } from '../services/api';
import { toast } from '../services/toast';
import { useCheckDraft, useDeleteDraft, useDrafts, useSaveDraft } from '../services/queries';

const KINDS = [
  { id: 'cover_letter', label: 'Cover letter', hint: 'For the application itself' },
  { id: 'outreach', label: 'Message to recruiter', hint: 'Email or LinkedIn' },
  { id: 'follow_up', label: 'Follow-up', hint: 'A week or two after applying' },
  { id: 'thank_you', label: 'Thank-you note', hint: 'After an interview' },
];
const kindLabel = (id) => KINDS.find(k => k.id === id)?.label ?? id;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Removes the sentence that contains `claim` (claims are copied from the draft).
function removeSentenceWith(content, claim) {
  const at = content.toLowerCase().indexOf(claim.toLowerCase());
  if (at < 0) return content;
  const before = content.slice(0, at);
  const start = Math.max(before.lastIndexOf('. '), before.lastIndexOf('! '), before.lastIndexOf('? '), before.lastIndexOf('\n')) + 1;
  const afterMatch = content.slice(at).search(/[.!?](\s|$)/);
  const end = afterMatch < 0 ? content.length : at + afterMatch + 1;
  return (content.slice(0, start) + content.slice(end)).replace(/[ \t]{2,}/g, ' ').replace(/\n /g, '\n').trim();
}

// The draft with unsupported claims and unknown numbers marked.
function Highlighted({ content, claims, numbers }) {
  const patterns = [
    ...claims.filter(c => !c.supported).map(c => escapeRegex(c.text)),
    ...numbers.map(n => `\\b${n.replace(/\B(?=(\d{3})+(?!\d))/g, ',?')}\\b%?`),
  ];
  if (patterns.length === 0) return <div className="draft-preview">{content}</div>;
  const parts = content.split(new RegExp(`(${patterns.join('|')})`, 'gi'));
  return (
    <div className="draft-preview">
      {parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className={/^\d/.test(part) ? 'mark-number' : 'mark-claim'}>{part}</mark> : part))}
    </div>
  );
}

function CheckResult({ draft, onRemove }) {
  const claims = draft.claims ?? [];
  const unsupported = claims.filter(c => !c.supported);
  const numbers = draft.number_flags ?? [];
  const [showAll, setShowAll] = useState(false);
  return (
    <div className="check-result">
      <div className={`check-summary ${unsupported.length || numbers.length ? 'check-warn' : 'check-ok'}`}>
        {unsupported.length || numbers.length ? <AlertTriangle size={16} aria-hidden /> : <ShieldCheck size={16} aria-hidden />}
        <span>
          {claims.length - unsupported.length} of {claims.length} claims about you are backed by your resume
          {unsupported.length > 0 && `; ${unsupported.length} ${unsupported.length === 1 ? 'is' : 'are'} not`}
          {numbers.length > 0 && `; ${numbers.length} number${numbers.length === 1 ? '' : 's'} (${numbers.join(', ')}) ${numbers.length === 1 ? 'appears' : 'appear'} nowhere in your resume or the job`}.
        </span>
      </div>
      {unsupported.map((c, i) => (
        <div key={i} className="claim-row">
          <span className="claim-text">“{c.text}”</span>
          <button className="btn btn-secondary btn-sm" onClick={() => onRemove(c.text)}>Remove sentence</button>
        </div>
      ))}
      {claims.length > unsupported.length && (
        <button className="link-button" style={{ fontSize: 13, marginTop: 8 }} onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Hide' : 'Show'} the backed-up claims and their resume lines
        </button>
      )}
      {showAll && claims.filter(c => c.supported).map((c, i) => (
        <div key={i} className="claim-row claim-ok">
          <CheckCircle2 size={14} aria-hidden />
          <div><div>“{c.text}”</div>{c.evidence.map(e => <blockquote key={e.bulletId} className="evidence">{e.text}</blockquote>)}</div>
        </div>
      ))}
    </div>
  );
}

// Cover letters and messages for one application, written from the active resume.
export default function WritingAssistant({ application }) {
  const queryClient = useQueryClient();
  const { data: drafts = [], isPending } = useDrafts(application.id);
  const check = useCheckDraft(application.id);
  const save = useSaveDraft(application.id);
  const remove = useDeleteDraft(application.id);
  const [kind, setKind] = useState('cover_letter');
  const [tone, setTone] = useState('formal');
  const [length, setLength] = useState('medium');
  const [streaming, setStreaming] = useState(null); // text so far while writing
  const [streamError, setStreamError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [edits, setEdits] = useState({}); // unsaved editor text by draft id
  const toneId = useId();
  const lengthId = useId();
  const editorId = useId();

  const selected = drafts.find(d => d.id === selectedId) ?? (streaming === null ? drafts[0] : null);
  const editorText = selected ? (edits[selected.id] ?? selected.content) : '';
  const dirty = selected && edits[selected.id] !== undefined && edits[selected.id] !== selected.content;

  const write = async (avoid) => {
    setStreaming('');
    setStreamError('');
    try {
      await streamPost(`/applications/${application.id}/drafts`, { kind, tone, length, avoid }, (event, data) => {
        if (event === 'text') setStreaming(text => text + data.text);
        if (event === 'error') setStreamError(data.error.message);
        if (event === 'done') {
          setSelectedId(data.draft.id);
          queryClient.setQueryData(['drafts', application.id], (list = []) => [data.draft, ...list]);
          check.mutate(data.draft.id); // check the claims straight away
        }
      });
    } catch (err) {
      setStreamError(errorMessage(err, 'Could not write the draft.'));
    } finally {
      setStreaming(null);
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    }
  };

  const rewriteWithout = () => {
    const avoid = [...(selected.claims ?? []).filter(c => !c.supported).map(c => c.text), ...(selected.number_flags ?? []).map(n => `the number ${n}`)];
    setKind(selected.kind); setTone(selected.tone); setLength(selected.length);
    write(avoid);
  };

  const saveAndCheck = () => save.mutate({ id: selected.id, content: editorText }, {
    onSuccess: () => { setEdits(e => ({ ...e, [selected.id]: undefined })); check.mutate(selected.id); },
  });

  const copy = async () => {
    try { await navigator.clipboard.writeText(editorText); toast.success('Copied to the clipboard'); }
    catch { toast.error('Could not copy. Select the text and copy it yourself.'); }
  };

  if (isPending) return <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />;

  return (
    <div>
      <div className="kind-grid" role="radiogroup" aria-label="What to write">
        {KINDS.map(k => (
          <button key={k.id} role="radio" aria-checked={kind === k.id} className={`kind-card ${kind === k.id ? 'kind-card-on' : ''}`} onClick={() => setKind(k.id)}>
            <strong>{k.label}</strong><span>{k.hint}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', margin: '12px 0 20px' }}>
        <div><label className="form-label" htmlFor={toneId}>Tone</label>
          <select id={toneId} value={tone} onChange={e => setTone(e.target.value)} style={{ width: 140 }}><option value="formal">Formal</option><option value="friendly">Friendly</option></select></div>
        <div><label className="form-label" htmlFor={lengthId}>Length</label>
          <select id={lengthId} value={length} onChange={e => setLength(e.target.value)} style={{ width: 140 }}><option value="medium">Medium</option><option value="short">Short</option></select></div>
        <button className="btn btn-primary" onClick={() => write()} disabled={streaming !== null}>
          <PenLine size={14} /> {streaming !== null ? 'Writing…' : `Write ${kindLabel(kind).toLowerCase()}`}
        </button>
      </div>
      {streamError && <div role="alert" className="form-error">{streamError}</div>}

      {streaming !== null && (
        <div className="card"><div className="draft-preview" aria-live="polite">{streaming}<span className="caret" aria-hidden /></div></div>
      )}

      {selected && streaming === null && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <strong>{kindLabel(selected.kind)} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 13 }}>· {selected.tone}, {selected.length}</span></strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={copy}><Copy size={12} /> Copy</button>
              <button className="btn-icon" aria-label="Delete this draft" style={{ color: 'var(--red)' }} onClick={() => remove.mutate(selected.id, { onSuccess: () => setSelectedId(null) })}><Trash2 size={14} /></button>
            </div>
          </div>

          {check.isPending ? (
            <div className="check-summary"><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Checking every claim against your resume…</div>
          ) : check.isError && check.variables === selected.id ? (
            <div role="alert" className="form-error">{errorMessage(check.error, 'Could not check the claims.')} <button className="link-button" onClick={() => check.mutate(selected.id)}>Try again</button></div>
          ) : selected.claims ? (
            <>
              <CheckResult draft={selected} onRemove={(text) => setEdits(e => ({ ...e, [selected.id]: removeSentenceWith(editorText, text) }))} />
              {!dirty && <Highlighted content={selected.content} claims={selected.claims} numbers={selected.number_flags ?? []} />}
            </>
          ) : (
            <div className="check-summary">Not checked since the last edit. <button className="link-button" onClick={() => check.mutate(selected.id)}>Check claims</button></div>
          )}

          <label className="form-label" htmlFor={editorId} style={{ marginTop: 14 }}>Edit</label>
          <textarea id={editorId} rows={12} value={editorText} onChange={e => setEdits(x => ({ ...x, [selected.id]: e.target.value }))} style={{ resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={saveAndCheck} disabled={!dirty || save.isPending}><ShieldCheck size={14} /> Save and check again</button>
            {selected.claims && ((selected.claims.some(c => !c.supported)) || selected.number_flags?.length > 0) && (
              <button className="btn btn-secondary" onClick={rewriteWithout}><RefreshCw size={14} /> Rewrite without the unsupported claims</button>
            )}
          </div>
        </div>
      )}

      {drafts.length > 1 && (
        <div className="detail-section" style={{ marginTop: 20 }}>
          <div className="detail-section-title">Versions</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {drafts.map(d => {
              const issues = (d.claims ?? []).filter(c => !c.supported).length + (d.number_flags ?? []).length;
              return (
                <button key={d.id} className="card link-card" style={{ borderColor: d.id === selected?.id ? 'var(--border-hover)' : undefined }} onClick={() => setSelectedId(d.id)}>
                  <span>{kindLabel(d.kind)} · {new Date(d.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  <span style={{ fontSize: 12, color: d.claims === null ? 'var(--text-muted)' : issues ? 'var(--orange)' : 'var(--green)' }}>
                    {d.claims === null ? 'Not checked' : issues ? `${issues} to fix` : 'All claims backed'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {drafts.length === 0 && streaming === null && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Drafts use only facts from your active resume, and every claim about you is checked against it before you copy anything. Drafts are never sent for you.
        </p>
      )}
    </div>
  );
}
