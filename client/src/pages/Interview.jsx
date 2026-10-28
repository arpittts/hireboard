import { useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Send, SkipForward, Square } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import InterviewFeedback from '../components/InterviewFeedback';
import { errorMessage } from '../services/api';
import { useAnswer, useEndInterview, useInterview } from '../services/queries';

const MAX_ANSWER = 2000;

function Bubble({ turn }) {
  const mine = turn.speaker === 'candidate';
  return (
    <div className={`bubble-row ${mine ? 'bubble-row-mine' : ''}`}>
      <div className={`bubble ${mine ? 'bubble-mine' : ''}`}>
        {turn.kind === 'follow_up' && <div className="bubble-label">Follow-up</div>}
        {turn.content}
      </div>
    </div>
  );
}

export default function Interview() {
  const { id } = useParams();
  const { data: session, isPending, isError } = useInterview(id);
  const answer = useAnswer(id);
  const end = useEndInterview(id);
  const [text, setText] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const bottomRef = useRef(null);
  const answerId = useId();

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [session?.turns.length, answer.isPending]);

  if (isPending) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}><div className="spinner" /></div>;
  if (isError) return <div className="empty-state"><div className="empty-state-title">Interview not found</div><Link to="/applications" className="btn btn-secondary">Back</Link></div>;

  const total = session.questions.length;
  const active = session.status === 'active';
  const questionNumber = Math.min(session.current_index + 1, total);

  const send = (value) => {
    answer.mutate(value, { onSuccess: () => setText('') });
  };
  const submit = (e) => {
    e.preventDefault();
    if (text.trim()) send(text.trim());
  };
  // Cmd/Ctrl + Enter sends, like most chat apps.
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) send(text.trim());
  };

  return (
    <div style={{ maxWidth: 760 }}>
      <Link to={`/applications/${session.application_id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 16 }}>
        <ArrowLeft size={14} /> {session.company_name}
      </Link>
      <div className="page-header">
        <div>
          <h1 className="page-title">Mock interview</h1>
          <p className="page-subtitle">
            {session.role} at {session.company_name} ·{' '}
            {active ? `Question ${questionNumber} of ${total}` : session.status === 'completed' ? 'Completed' : 'Ended early'}
          </p>
        </div>
        {active && (
          <button className="btn btn-secondary" onClick={() => setConfirmEnd(true)}><Square size={14} /> End interview</button>
        )}
      </div>

      <div className="progress-dots" aria-hidden>
        {session.questions.map((q, i) => (
          <span key={q.id} className={`dot ${i < session.current_index ? 'dot-done' : i === session.current_index && active ? 'dot-now' : ''}`} />
        ))}
      </div>

      <div className="chat" aria-live="polite">
        <div className="bubble-row"><div className="bubble bubble-intro">{session.opening}</div></div>
        {session.turns.map((turn, i) => <Bubble key={i} turn={turn} />)}
        {answer.isPending && (
          <>
            <div className="bubble-row bubble-row-mine"><div className="bubble bubble-mine">{answer.variables}</div></div>
            <div className="bubble-row"><div className="bubble typing" aria-label="The interviewer is typing"><span /><span /><span /></div></div>
          </>
        )}
        {/* scroll-margin keeps the newest message above the sticky answer box */}
        <div ref={bottomRef} style={{ scrollMarginBottom: 280 }} />
      </div>

      {active ? (
        <form onSubmit={submit} className="answer-box">
          <label htmlFor={answerId} className="sr-only">Your answer</label>
          <textarea
            id={answerId}
            rows={5}
            maxLength={MAX_ANSWER}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={answer.isPending}
            placeholder="Answer as you would out loud. Specific examples, your own role and the result work best."
          />
          {answer.isError && <div role="alert" className="form-error">{errorMessage(answer.error, 'Could not send your answer.')}</div>}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{text.length}/{MAX_ANSWER} · Cmd/Ctrl + Enter to send</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={() => send('skip')} disabled={answer.isPending}>
                <SkipForward size={14} /> Skip
              </button>
              <button type="submit" className="btn btn-primary" disabled={answer.isPending || !text.trim()}>
                <Send size={14} /> {answer.isPending ? 'Sending…' : 'Send answer'}
              </button>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Your answers go to Google's free Gemini tier so the interviewer can respond. Avoid sharing private details.
          </p>
        </form>
      ) : (
        <InterviewFeedback session={session} />
      )}

      {confirmEnd && (
        <ConfirmDialog
          title="End the interview now?"
          message="Your answers so far are kept. You can start a new interview later."
          confirmLabel="End interview"
          danger={false}
          busy={end.isPending}
          onConfirm={() => end.mutate(undefined, { onSettled: () => setConfirmEnd(false) })}
          onCancel={() => setConfirmEnd(false)}
        />
      )}
    </div>
  );
}
