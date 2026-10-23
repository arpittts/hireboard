import { Link } from 'react-router-dom';
import { CheckCircle2, CircleHelp, CircleX, RefreshCw } from 'lucide-react';
import { errorMessage } from '../services/api';
import { useRequirementCheck, useRunRequirementCheck } from '../services/queries';

const VERDICT = {
  met: { label: 'Shown on your resume', icon: CheckCircle2, className: 'verdict-met' },
  missing: { label: 'Not on your resume', icon: CircleX, className: 'verdict-missing' },
  unverified: { label: 'Not verified', icon: CircleHelp, className: 'verdict-unverified' },
};

// Which job requirements the active resume shows. A checklist to prepare from,
// deliberately without a score.
export default function RequirementsChecklist({ application }) {
  const { data: check, isPending } = useRequirementCheck(application.id);
  const run = useRunRequirementCheck(application.id);
  const hasJob = Boolean(application.jd_extraction?.requirements?.length || application.job_description);

  if (isPending) return <div className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />;

  const runButton = (
    <button className="btn btn-primary" onClick={() => run.mutate()} disabled={run.isPending || !hasJob}>
      <RefreshCw size={14} /> {run.isPending ? 'Checking against your resume…' : check ? 'Check again' : 'Check requirements'}
    </button>
  );
  const error = run.isError && (
    <div role="alert" className="form-error">
      {errorMessage(run.error, 'Could not check the requirements.')}
      {run.error.response?.data?.error?.code === 'NO_RESUME' && <> <Link to="/resume">Add a resume</Link></>}
    </div>
  );

  if (!check) {
    return (
      <div className="empty-state" style={{ padding: 40 }}>
        <div className="empty-state-title">Which requirements does your resume show?</div>
        <div className="empty-state-text">
          {hasJob
            ? 'Compare this job\'s requirements with your active resume. Each "shown" item cites the resume line that proves it.'
            : 'Add the job description first (Edit → Job description), then check it against your resume.'}
        </div>
        {runButton}
        {error}
      </div>
    );
  }

  const counts = { met: 0, missing: 0, unverified: 0 };
  for (const v of check.verdicts) counts[v.verdict] += 1;
  const order = { missing: 0, unverified: 1, met: 2 };
  const sorted = [...check.verdicts].sort((a, b) => order[a.verdict] - order[b.verdict] || (a.kind === 'must' ? -1 : 1));

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ fontSize: 14 }}>
          <strong>{counts.met}</strong> of {check.verdicts.length} shown on your resume
          {counts.missing > 0 && <> · <strong>{counts.missing}</strong> to prepare for</>}
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Checked against "{check.resume_title ?? 'a deleted resume'}" on {new Date(check.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </div>
        </div>
        {runButton}
      </div>
      {error}
      <div className="req-list">
        {sorted.map((v, i) => {
          const { label, icon: Icon, className } = VERDICT[v.verdict];
          return (
            <div key={i} className={`req-item ${className}`}>
              <Icon size={18} aria-label={label} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ flex: 1 }}>
                <div>
                  {v.requirement} <span className={`req-kind req-kind-${v.kind}`}>{v.kind === 'must' ? 'Must' : 'Nice'}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{v.reason}</div>
                {v.evidence.map(e => (
                  <blockquote key={e.bulletId} className="evidence"><span className="line-id">{e.bulletId}</span>{e.text}</blockquote>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
        AI ({check.model}, {check.prompt_version}) cites resume lines by id, and only lines that exist are shown. It can still misjudge; you know your experience best.
      </p>
    </div>
  );
}
