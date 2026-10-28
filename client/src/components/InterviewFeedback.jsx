import { CheckCircle2, Lightbulb, Target } from 'lucide-react';
import { errorMessage } from '../services/api';
import { useGetFeedback, useRubric } from '../services/queries';

const CRITERIA = [
  ['relevance', 'Relevance'],
  ['specificity', 'Specificity'],
  ['structure', 'Structure'],
  ['depth', 'Depth'],
];

function ScoreBar({ label, result }) {
  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <span className="score-pips" aria-label={`${result.score} of 4`}>
        {[1, 2, 3, 4].map(n => <span key={n} className={`pip ${n <= result.score ? `pip-on pip-${result.score}` : ''}`} />)}
      </span>
      <span className="score-reason">
        {result.reason}
        {result.quote && <q className="score-quote">{result.quote}</q>}
        {!result.counted && <em className="score-unproven"> Not counted: no line of your answer backs this score.</em>}
      </span>
    </div>
  );
}

function Rubric() {
  const { data } = useRubric();
  if (!data) return null;
  // The rubric is simple Markdown: "## " headings and "- **4** text" lines.
  return (
    <details className="rubric">
      <summary>How answers are scored ({data.version})</summary>
      {data.markdown.split('\n').map((line, i) => {
        if (line.startsWith('## ')) return <h4 key={i}>{line.slice(3)}</h4>;
        const level = line.match(/^- \*\*(\d)\*\* (.*)$/);
        if (level) return <p key={i}><strong>{level[1]}</strong> {level[2]}</p>;
        return null;
      })}
    </details>
  );
}

// Feedback after a mock interview: a summary computed from the scores, then each answer.
export default function InterviewFeedback({ session }) {
  const getFeedback = useGetFeedback(session.id);
  const answeredIndexes = [...new Set(session.turns.filter(t => t.speaker === 'candidate').map(t => t.question_index))];
  const summary = session.summary;

  if (!summary) {
    return (
      <div className="practice-card" style={{ marginTop: 20 }}>
        <div>
          <strong>{session.status === 'completed' ? 'Interview complete.' : 'Interview ended.'}</strong>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            Get feedback on each of your {answeredIndexes.length} answer{answeredIndexes.length === 1 ? '' : 's'}: four scores from 1 to 4, each backed by your own words, and one thing to improve.
          </div>
          {getFeedback.isError && <div role="alert" className="form-error">{errorMessage(getFeedback.error, 'Could not get feedback.')}</div>}
        </div>
        <button className="btn btn-primary" onClick={() => getFeedback.mutate()} disabled={getFeedback.isPending || answeredIndexes.length === 0}>
          <Target size={14} /> {getFeedback.isPending ? 'Reviewing your answers (about 30 s)…' : 'Get feedback'}
        </button>
      </div>
    );
  }

  const byIndex = new Map(session.feedback.map(f => [f.question_index, f]));
  const skipped = new Set(summary.skippedIndexes ?? []);
  const missing = answeredIndexes.filter(i => !byIndex.has(i) && !skipped.has(i));

  return (
    <div style={{ marginTop: 24 }}>
      <h2 className="page-title" style={{ fontSize: 22 }}>Feedback</h2>
      <div className="card" style={{ marginTop: 12 }}>
        <div className="summary-grid">
          {CRITERIA.map(([key, label]) => (
            <div key={key} className="summary-score">
              <div className="stat-value" style={{ fontSize: 28 }}>{summary.averages[key]?.toFixed(1) ?? '–'}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
          Averages out of 4 over {summary.answered} answer{summary.answered === 1 ? '' : 's'}{summary.skipped ? `; ${summary.skipped} skipped` : ''}.
        </p>
        {summary.strengths.length > 0 && (
          <div className="summary-block"><CheckCircle2 size={16} aria-hidden /> <div><strong>Strengths:</strong> {summary.strengths.join(', ')}</div></div>
        )}
        {summary.improvements.length > 0 && (
          <div className="summary-block">
            <Lightbulb size={16} aria-hidden />
            <div>
              <strong>Work on next:</strong>
              <ul>{summary.improvements.map((imp, i) => <li key={i}>{imp.text}</li>)}</ul>
            </div>
          </div>
        )}
        {summary.notDemonstrated.length > 0 && (
          <div className="summary-block"><Target size={16} aria-hidden /> <div><strong>Not shown yet:</strong> {summary.notDemonstrated.join('; ')}. Prepare a concrete example for each.</div></div>
        )}
      </div>

      {missing.length > 0 && (
        <div className="practice-card" style={{ marginTop: 12 }}>
          <span>{missing.length} answer(s) still need feedback.</span>
          <button className="btn btn-secondary btn-sm" onClick={() => getFeedback.mutate()} disabled={getFeedback.isPending}>
            {getFeedback.isPending ? 'Reviewing…' : 'Try again'}
          </button>
        </div>
      )}

      {session.questions.map((q, index) => {
        const f = byIndex.get(index);
        if (!f) return null;
        return (
          <div key={q.id} className="card feedback-card">
            <div style={{ fontWeight: 600, marginBottom: 10 }}>Q{index + 1}. {q.text}</div>
            {f.removed_instructions?.length > 0 && (
              <p className="score-unproven" style={{ marginBottom: 8 }}>
                Ignored when grading, because it was addressed to the grader: “{f.removed_instructions.join(' ')}”
              </p>
            )}
            {CRITERIA.map(([key, label]) => <ScoreBar key={key} label={label} result={f.scores[key]} />)}
            <div className="summary-block" style={{ marginTop: 10 }}><Lightbulb size={16} aria-hidden /> <div>{f.improvement}</div></div>
          </div>
        );
      })}
      <Rubric />
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
        Graded by AI ({session.feedback[0]?.model}, {session.feedback[0]?.prompt_version}). Quotes are checked against your answers; it can still misjudge, so use it as a second opinion.
      </p>
    </div>
  );
}
