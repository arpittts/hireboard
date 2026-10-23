import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { errorMessage } from '../services/api';
import { useGenerateQuestions, useInterviews, useQuestionBank, useSaveQuestions, useStartInterview } from '../services/queries';

const KIND_LABELS = {
  behavioral: 'Behavioural', technical: 'Technical', resume: 'About your resume',
  role: 'About the role', gap: 'Missing skill', custom: 'Your question',
};

const formatDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function PastInterviews({ applicationId }) {
  const { data: sessions = [] } = useInterviews(applicationId);
  const navigate = useNavigate();
  if (sessions.length === 0) return null;
  return (
    <div className="detail-section">
      <div className="detail-section-title">Mock interviews</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sessions.map(s => (
          <button key={s.id} className="card link-card" onClick={() => navigate(`/interviews/${s.id}`)}>
            <span>{formatDate(s.created_at)}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {s.status === 'active' ? 'In progress' : s.status === 'completed' ? 'Completed' : 'Ended early'} · {s.answers} answer{s.answers === 1 ? '' : 's'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Likely interview questions for this job, and the button to practise them.
export default function InterviewPrep({ application }) {
  const navigate = useNavigate();
  const { data: bank, isPending } = useQuestionBank(application.id);
  const generate = useGenerateQuestions(application.id);
  const save = useSaveQuestions(application.id);
  const start = useStartInterview(application.id);
  const [newQuestion, setNewQuestion] = useState('');
  const addId = useId();
  const hasJob = Boolean(application.jd_extraction?.requirements?.length);

  if (isPending) return <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />;

  const generateError = generate.isError && (
    <div role="alert" className="form-error">{errorMessage(generate.error, 'Could not write the questions.')}</div>
  );

  if (!bank) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <div className="empty-state-title">Prepare for this interview</div>
        <div className="empty-state-text">
          {hasJob
            ? 'Get the 10 questions an interviewer for this role is most likely to ask, built from the job, your resume and the skills you are missing. Then practise them in a mock interview.'
            : 'Add the job description first (Edit → Job description), so the questions fit this role.'}
        </div>
        <button className="btn btn-primary" onClick={() => generate.mutate()} disabled={!hasJob || generate.isPending}>
          <Sparkles size={14} /> {generate.isPending ? 'Writing questions…' : 'Get likely questions'}
        </button>
        {generateError}
        <PastInterviews applicationId={application.id} />
      </div>
    );
  }

  const keep = (questions) => questions.map(q => ({ id: q.id, text: q.text }));
  const remove = (id) => save.mutate(keep(bank.questions.filter(q => q.id !== id)));
  const add = (e) => {
    e.preventDefault();
    save.mutate([...keep(bank.questions), { text: newQuestion.trim() }], { onSuccess: () => setNewQuestion('') });
  };
  const startInterview = () => start.mutate(undefined, { onSuccess: (session) => navigate(`/interviews/${session.id}`) });

  return (
    <div>
      <div className="practice-card">
        <div>
          <strong>Mock interview</strong>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            Five of these questions, one at a time, with a follow-up when an answer needs more detail. No feedback until the end, like a real interview.
          </div>
        </div>
        <button className="btn btn-primary" onClick={startInterview} disabled={start.isPending}>
          <MessageSquare size={14} /> {start.isPending ? 'Starting…' : 'Start mock interview'}
        </button>
      </div>

      <PastInterviews applicationId={application.id} />

      <div className="detail-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div className="detail-section-title" style={{ margin: 0 }}>Likely questions ({bank.questions.length})</div>
          <button className="btn btn-secondary btn-sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <RefreshCw size={12} /> {generate.isPending ? 'Writing…' : 'New set'}
          </button>
        </div>
        {generateError}
        <div className="req-list">
          {bank.questions.map(q => (
            <div key={q.id} className="req-item">
              <div style={{ flex: 1 }}>
                <span className={`question-kind question-kind-${q.kind}`}>{KIND_LABELS[q.kind]}</span>
                <div style={{ marginTop: 6 }}>{q.text}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  {q.whyAsked}{q.requirement ? ` Tests: ${q.requirement}.` : ''}
                </div>
                {q.resumeLine && <blockquote className="evidence">{q.resumeLine.text}</blockquote>}
              </div>
              <button className="btn-icon" aria-label="Remove this question" onClick={() => remove(q.id)} disabled={save.isPending || bank.questions.length <= 1}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <form onSubmit={add} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <label htmlFor={addId} className="sr-only">Add your own question</label>
          <input id={addId} value={newQuestion} onChange={e => setNewQuestion(e.target.value)} placeholder="Add your own question (for example one a friend was asked)" maxLength={400} />
          <button type="submit" className="btn btn-secondary" disabled={newQuestion.trim().length < 10 || save.isPending}><Plus size={14} /> Add</button>
        </form>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
          Written by AI ({bank.model ?? 'edited by you'}). Questions about your resume always point to a real line of it.
        </p>
      </div>
    </div>
  );
}
