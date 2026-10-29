import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Send, ShieldCheck, Trash2, X } from 'lucide-react';
import { errorMessage, streamPost } from '../services/api';
import { useClearCopilot, useCopilotMessages, useResolveAction } from '../services/queries';

const SUGGESTIONS = [
  'What follow-ups do I have this week?',
  'Which applications are at the interview stage?',
  'Which deadlines are coming up?',
  'I got an interview call from Quillstack',
];

// What the copilot is doing while it looks things up.
const TOOL_LABELS = {
  search_applications: 'Searching your applications',
  get_application: 'Reading an application',
  get_dashboard_stats: 'Counting your applications',
  list_follow_ups: 'Checking follow-ups and deadlines',
  get_requirement_check: 'Reading the requirements check',
  get_interview_progress: 'Reading your mock interviews',
  propose_status_change: 'Preparing a status change',
  propose_follow_up: 'Preparing a follow-up',
  propose_application: 'Preparing a new application',
};

// Model replies use **bold** and "- " lists; shown as text, never parsed as HTML.
function Reply({ text }) {
  return text.split('\n').map((line, i) => (
    <div key={i} style={{ minHeight: line.trim() ? undefined : 8, paddingLeft: /^\s*[-*•] /.test(line) ? 12 : 0 }}>
      {line.replace(/^\s*[-*•] /, '• ').split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 ? <strong key={j}>{part}</strong> : part))}
    </div>
  ));
}

function ActionCard({ action }) {
  const resolve = useResolveAction();
  const pending = action.status === 'pending' && new Date(action.expiresAt) > new Date();
  const status = action.status === 'pending' && !pending ? 'expired' : action.status;
  return (
    <div className="action-card">
      <div style={{ fontSize: 13 }}>{action.summary}</div>
      {pending ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button className="btn btn-primary btn-sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: action.id, confirm: true })}>
            <Check size={14} /> Confirm
          </button>
          <button className="btn btn-secondary btn-sm" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: action.id, confirm: false })}>
            <X size={14} /> Cancel
          </button>
        </div>
      ) : (
        <div className={`action-status action-${status}`}>
          {status === 'confirmed' ? 'Done' : status === 'cancelled' ? 'Cancelled' : 'Expired: proposals last 30 minutes'}
        </div>
      )}
    </div>
  );
}

function Message({ message }) {
  const mine = message.role === 'user';
  return (
    <div className={`chat-row ${mine ? 'mine' : ''}`}>
      <div className={`chat-bubble ${mine ? 'mine' : ''}`}>
        {mine ? message.content : <Reply text={message.content} />}
        {message.actions?.map(a => <ActionCard key={a.id} action={a} />)}
      </div>
    </div>
  );
}

export default function Copilot() {
  const queryClient = useQueryClient();
  const { data: messages = [], isPending } = useCopilotMessages();
  const clear = useClearCopilot();
  const [input, setInput] = useState('');
  // The turn being answered: { question, text, tool, actions } while streaming.
  const [live, setLive] = useState(null);
  const [error, setError] = useState('');
  const bottom = useRef(null);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length, live?.text, live?.actions.length]);

  const ask = async (question) => {
    const content = question.trim();
    if (!content || live) return;
    setInput('');
    setError('');
    setLive({ question: content, text: '', tool: null, actions: [] });
    try {
      await streamPost('/copilot/messages', { content }, (event, data) => {
        if (event === 'tool') setLive(l => ({ ...l, tool: data.name }));
        if (event === 'text') setLive(l => ({ ...l, tool: null, text: l.text + data.text }));
        if (event === 'retry') setLive(l => ({ ...l, text: '' }));
        if (event === 'action') setLive(l => ({ ...l, actions: [...l.actions, data] }));
        if (event === 'error') { setError(data.error.message); setInput(content); }
        if (event === 'done') queryClient.setQueryData(['copilot'], (list = []) => [...list, data.user, data.assistant]);
      });
    } catch (err) {
      setError(errorMessage(err, 'The copilot failed. Please try again.'));
      setInput(content);
    } finally {
      setLive(null);
      queryClient.invalidateQueries({ queryKey: ['ai-usage'] });
    }
  };

  const empty = !isPending && messages.length === 0 && !live;

  return (
    <div className="copilot-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Copilot</h1>
          <p className="page-subtitle">Ask about your applications. Changes are only made after you confirm them.</p>
        </div>
        {messages.length > 0 && (
          <button className="btn btn-secondary" onClick={() => clear.mutate()} disabled={clear.isPending || Boolean(live)}>
            <Trash2 size={14} /> Clear chat
          </button>
        )}
      </div>

      <div className="card chat-panel">
        {isPending ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>
        ) : empty ? (
          <div className="empty-state" style={{ padding: '32px 16px' }}>
            <div className="empty-state-icon"><Bot size={36} /></div>
            <div className="empty-state-title">What would you like to know?</div>
            <div className="empty-state-text">It reads your applications, follow-ups, requirement checks and mock interviews, and can prepare status changes, follow-ups and new applications for you to confirm.</div>
            <div className="suggestions">
              {SUGGESTIONS.map(s => <button key={s} className="suggestion" onClick={() => ask(s)}>{s}</button>)}
            </div>
          </div>
        ) : (
          <div className="chat-list" aria-live="polite">
            {messages.map(m => <Message key={m.id} message={m} />)}
            {live && (
              <>
                <Message message={{ role: 'user', content: live.question }} />
                <div className="chat-row">
                  <div className="chat-bubble">
                    {live.text ? <Reply text={live.text} /> : <span className="chat-status">{TOOL_LABELS[live.tool] ?? 'Thinking'}…</span>}
                    {live.actions.map(a => <ActionCard key={a.id} action={a} />)}
                  </div>
                </div>
              </>
            )}
            <div ref={bottom} />
          </div>
        )}

        {error && <div className="chat-error" role="alert">{error}</div>}

        <form className="chat-input" onSubmit={e => { e.preventDefault(); ask(input); }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={live ? 'Answering…' : 'Ask about your applications, or ask for a change'}
            aria-label="Message the copilot"
            maxLength={2000}
            disabled={Boolean(live)}
          />
          <button className="btn btn-primary" type="submit" disabled={!input.trim() || Boolean(live)} aria-label="Send">
            <Send size={16} />
          </button>
        </form>
      </div>
      <p className="chat-footnote">
        <ShieldCheck size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
        Text in job descriptions and notes is treated as data, never as instructions. Each message uses one or more of your daily AI requests.
      </p>
    </div>
  );
}
