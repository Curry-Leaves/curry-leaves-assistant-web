import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/chrome/Icon';
import { api } from '../api/client';
import { useEvents } from '../hooks/useEvents';
import { Bubble } from './askai/Bubble';
import type { ChatMsg } from './askai/model';
import type { Todo, Reminder, Recording } from '../types';

type Source = { type: string; id: string; label?: string | null } | null;

type Tab = 'todos' | 'reminders';
type Filter = 'all' | 'active' | 'done';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'active', label: 'Active' }, { id: 'done', label: 'Done' },
];

// ─── date helpers ─────────────────────────────────────────────────────────────
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : '');

function fmtDue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((d.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  const day =
    days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : days === -1 ? 'Yesterday' :
    days > 1 && days < 7 ? d.toLocaleDateString([], { weekday: 'long' }) :
    d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = (d.getHours() || d.getMinutes()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return time ? `${day} · ${time}` : day;
}
const isOverdue = (iso: string | null, done: boolean) => !!iso && !done && new Date(iso).getTime() < Date.now();

// ─── inline editable text ─────────────────────────────────────────────────────
function EditableText({ value, done, onSave }: { value: string; done?: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== value) onSave(v); else setDraft(value); };
  if (editing) {
    return (
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false); } }}
        className="flex-1 bg-bg border border-border rounded-[6px] px-2 py-1 text-[13px] text-ink outline-none focus:border-accent" />
    );
  }
  return (
    <button type="button" onDoubleClick={() => setEditing(true)} onClick={() => setEditing(true)} title="Click to edit"
      className={`flex-1 text-left text-[13px] leading-relaxed ${done ? 'line-through text-ink3' : 'text-ink'}`}>
      {value}
    </button>
  );
}

// ─── parent backlink ──────────────────────────────────────────────────────────
function ParentLink({ source, recordings, onOpen }: {
  source: Source; recordings: Recording[]; onOpen?: (id: string) => void;
}) {
  if (!source || source.type !== 'recording') return null;
  const name = recordings.find((r) => r.id === source.id)?.name ?? source.label ?? null;
  const gone = !name;
  return (
    <button type="button" disabled={gone} onClick={() => onOpen?.(source.id)}
      title={gone ? 'Source recording was deleted' : `Open “${name}” in Recordings`}
      className={`flex-none flex items-center gap-1 max-w-[180px] text-[10.5px] rounded px-1.5 py-0.5 border ${
        gone ? 'text-faint border-border' : 'text-accent-dark border-accent-soft bg-accent-soft/30 hover:bg-accent-soft/60'}`}>
      <Icon name="library" size={10} color={gone ? 'var(--color-faint)' : 'var(--color-accent-dark)'} />
      <span className="truncate">{name ?? 'recording (deleted)'}</span>
    </button>
  );
}

// ─── proactive-assistant status badge ─────────────────────────────────────────
// When the Todo Triage agent hands an actionable todo to the team, the todo carries an
// assistantStatus. 'working' → a run is in flight (pulsing accent). 'review' → the team
// finished; clicking opens the conversation, and the result summary is the tooltip.
const ASSISTANT_BADGE = {
  working: { label: 'Working', dot: 'an-pulse bg-accent', text: 'text-accent-dark', border: 'border-accent-soft bg-accent-soft/30' },
  review: { label: 'Needs review', dot: 'bg-blue', text: 'text-blue', border: 'border-blue/40 bg-blue/10 hover:bg-blue/20' },
} as const;

function AssistantBadge({ todo, expanded, onToggle }: { todo: Todo; expanded: boolean; onToggle: () => void }) {
  const status = todo.assistantStatus;
  if (status !== 'working' && status !== 'review') return null;
  const s = ASSISTANT_BADGE[status];
  const canExpand = status === 'review' && !!todo.assistantSessionId;
  const title = canExpand
    ? (expanded ? 'Hide the conversation' : 'Show the conversation below')
    : status === 'working' ? 'An assistant is working on this…' : 'Ready for your review';
  return (
    <button type="button" disabled={!canExpand} title={title} onClick={() => canExpand && onToggle()}
      className={`flex-none flex items-center gap-1.5 text-[10.5px] rounded px-1.5 py-0.5 border ${s.text} ${s.border} ${
        canExpand ? 'cursor-pointer' : 'cursor-default'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      <span>{s.label}</span>
      {canExpand && (
        <span className={`inline-flex transition-transform ${expanded ? 'rotate-180' : ''}`}>
          <Icon name="chevD" size={10} color="currentColor" />
        </span>
      )}
    </button>
  );
}

// The assistant's conversation, rendered inline below the todo with the SAME Bubble component
// the Ask AI chat uses. Fetched lazily on first expand; a "Continue in Ask AI" link hands off
// to the full chat when the user wants to reply.
function AssistantConversation({ sessionId, result, onOpenConversation }: {
  sessionId: string; result?: string | null; onOpenConversation?: (sessionId: string) => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    api.sessionMessages(sessionId)
      .then((m) => { if (live) setMsgs(m as ChatMsg[]); })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, [sessionId]);

  return (
    <div className="ml-7 mr-1 mb-1 rounded-[10px] border border-border bg-bg/40 px-3.5 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] uppercase tracking-wider text-ink3">Assistant conversation</span>
        {onOpenConversation && (
          <button type="button" onClick={() => onOpenConversation(sessionId)}
            className="text-[11px] text-accent-dark hover:underline flex items-center gap-1">
            Continue in Ask AI <Icon name="arrowR" size={11} color="currentColor" />
          </button>
        )}
      </div>
      {msgs === null && !err && <div className="text-[12px] text-ink3 py-2">Loading conversation…</div>}
      {err && (
        <div className="text-[12px] text-ink3 py-2">
          Couldn’t load the conversation.{result ? <> Result: <span className="text-ink2">{result}</span></> : null}
        </div>
      )}
      {msgs !== null && msgs.length === 0 && (
        <div className="text-[12px] text-ink3 py-2">{result || 'No messages yet.'}</div>
      )}
      {msgs && msgs.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {msgs.map((m, i) => <Bubble key={i} m={m} streaming={false} />)}
        </div>
      )}
    </div>
  );
}

// ─── screen ───────────────────────────────────────────────────────────────────
export function TasksScreen({ recordings = [], onOpenRecording, onOpenConversation }: {
  recordings?: Recording[];
  onOpenRecording?: (id: string) => void;
  onOpenConversation?: (sessionId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('todos');
  const [filter, setFilter] = useState<Filter>('all');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);

  const load = useCallback(() => {
    api.listTodos().then(setTodos).catch(() => {});
    api.listReminders().then(setReminders).catch(() => {});
  }, []);

  // Initial load + live refresh when agents create/complete items in the background.
  useEffect(() => { load(); }, [load]);
  useEvents((raw) => {
    const t = (raw as { type?: string }).type || '';
    if (t.startsWith('todo.') || t.startsWith('reminder.')) load();
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* header */}
      <div className="px-3 pt-3 pb-2.5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[7px] p-0.5 w-fit flex-none">
            {(['todos', 'reminders'] as Tab[]).map((id) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[12.5px] capitalize ${
                  tab === id ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
                <Icon name={id === 'todos' ? 'check' : 'bell'} size={13} />
                {id === 'todos' ? `To-dos ${todos.length || ''}` : `Reminders ${reminders.length || ''}`}
              </button>
            ))}
          </div>
          <h1 className="font-serif italic text-[19px] leading-none text-ink flex-1 min-w-0 truncate text-center">Tasks &amp; reminders</h1>
          <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[6px] p-0.5 w-fit flex-none">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)}
                className={`px-2.5 py-1 rounded-[4px] text-[11px] ${filter === f.id ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* body */}
      <div className="flex-1 overflow-y-auto px-8 py-3">
        <div className="max-w-[760px] mx-auto">
          {tab === 'todos'
            ? <TodoList todos={todos} filter={filter} reload={load} recordings={recordings} onOpenRecording={onOpenRecording} onOpenConversation={onOpenConversation} />
            : <ReminderList reminders={reminders} filter={filter} reload={load} recordings={recordings} onOpenRecording={onOpenRecording} />}
        </div>
      </div>
    </div>
  );
}

// ─── todos ────────────────────────────────────────────────────────────────────
function TodoList({ todos, filter, reload, recordings, onOpenRecording, onOpenConversation }: {
  todos: Todo[]; filter: Filter; reload: () => void; recordings: Recording[];
  onOpenRecording?: (id: string) => void; onOpenConversation?: (sessionId: string) => void;
}) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null); // todo id whose conversation is open

  const add = async () => {
    const v = text.trim();
    if (!v) return;
    setText(''); setDue('');
    await api.createTodo(v, { dueDate: due ? fromLocalInput(due) : null }).catch(() => {});
    reload();
  };

  const list = useMemo(() => todos.filter((t) =>
    filter === 'all' ? true : filter === 'done' ? t.done : !t.done), [todos, filter]);

  return (
    <div className="flex flex-col gap-2">
      {/* create row */}
      <div className="flex items-center gap-2 bg-card border border-border rounded-[10px] px-3 py-2 shadow-soft mb-2">
        <Icon name="plus" size={15} color="var(--color-ink3)" />
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add a task…" className="flex-1 bg-transparent outline-none text-[14px] text-ink placeholder:text-ink3 leading-relaxed" />
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} title="Due (optional)" aria-label="Due date (optional)"
          className="bg-bg border border-border rounded-[6px] px-2 py-1 text-[11.5px] text-ink2 outline-none" />
        <button type="button" onClick={add} disabled={!text.trim()}
          className="px-3 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 disabled:opacity-40">Add</button>
      </div>

      {list.length === 0 ? (
        <Empty text={filter === 'done' ? 'No completed tasks.' : 'No tasks yet — add one above.'} />
      ) : list.map((t) => (
        <div key={t.id} className="flex flex-col">
          <div className="group flex items-center gap-2.5 bg-card border border-border rounded-[10px] px-3 py-2.5">
            <button type="button" onClick={() => api.setTodoDone(t.id, !t.done).then(reload)} title={t.done ? 'Mark active' : 'Mark done'}
              className={`w-4.5 h-4.5 rounded-[5px] border flex-none grid place-items-center ${
                t.done ? 'bg-accent border-accent text-on-accent' : 'border-ink3 hover:border-ink2'}`}>
              {t.done && <Icon name="check" size={11} color="var(--color-accent-ink)" />}
            </button>
            <EditableText value={t.text} done={t.done} onSave={(v) => api.updateTodo(t.id, { text: v }).then(reload)} />
            <AssistantBadge todo={t} expanded={expanded === t.id}
              onToggle={() => setExpanded((cur) => (cur === t.id ? null : t.id))} />
            <ParentLink source={t.source} recordings={recordings} onOpen={onOpenRecording} />
            {t.dueDate && (
              <span className={`flex-none text-[11px] font-mono ${isOverdue(t.dueDate, t.done) ? 'text-rec' : 'text-ink3'}`}>{fmtDue(t.dueDate)}</span>
            )}
            <button type="button" onClick={() => api.deleteTodo(t.id).then(reload)} title="Delete"
              className="flex-none p-1 rounded text-ink3 opacity-0 group-hover:opacity-100 hover:text-rec"><Icon name="trash" size={13} /></button>
          </div>
          {expanded === t.id && t.assistantSessionId && (
            <AssistantConversation sessionId={t.assistantSessionId} result={t.assistantResult}
              onOpenConversation={onOpenConversation} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── reminders ────────────────────────────────────────────────────────────────
function ReminderList({ reminders, filter, reload, recordings, onOpenRecording }: {
  reminders: Reminder[]; filter: Filter; reload: () => void; recordings: Recording[]; onOpenRecording?: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  const add = async () => {
    const v = title.trim();
    if (!v || !due) return;
    setTitle(''); setDue('');
    await api.createReminder({ title: v, dueAt: fromLocalInput(due) }).catch(() => {});
    reload();
  };

  const list = useMemo(() => [...reminders]
    .filter((r) => filter === 'all' ? true : filter === 'done' ? r.done : !r.done)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()), [reminders, filter]);

  return (
    <div className="flex flex-col gap-2">
      {/* create row */}
      <div className="flex items-center gap-2 bg-card border border-border rounded-[10px] px-3 py-2 shadow-soft mb-2">
        <Icon name="bell" size={15} color="var(--color-ink3)" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Remind me to…" className="flex-1 bg-transparent outline-none text-[14px] text-ink placeholder:text-ink3 leading-relaxed" />
        <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} title="When" aria-label="When"
          className="bg-bg border border-border rounded-[6px] px-2 py-1 text-[11.5px] text-ink2 outline-none" />
        <button type="button" onClick={add} disabled={!title.trim() || !due}
          className="px-3 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 disabled:opacity-40">Add</button>
      </div>

      {list.length === 0 ? (
        <Empty text={filter === 'done' ? 'No completed reminders.' : 'No reminders yet — add one above.'} />
      ) : list.map((r) => (
        <div key={r.id} className="group flex items-center gap-2.5 bg-card border border-border rounded-[10px] px-3 py-2.5">
          <button type="button" onClick={() => api.updateReminder(r.id, { done: !r.done }).then(reload)} title={r.done ? 'Mark active' : 'Mark done'}
            className={`w-4.5 h-4.5 rounded-[5px] border flex-none grid place-items-center ${
              r.done ? 'bg-accent border-accent text-on-accent' : 'border-ink3 hover:border-ink2'}`}>
            {r.done && <Icon name="check" size={11} color="var(--color-accent-ink)" />}
          </button>
          <span className="w-6 h-6 rounded-[7px] bg-sidebar flex-none grid place-items-center text-sidebar-ink3"><Icon name="bell" size={13} color="currentColor" /></span>
          <EditableText value={r.title} done={r.done} onSave={(v) => api.updateReminder(r.id, { title: v }).then(reload)} />
          <ParentLink source={r.source} recordings={recordings} onOpen={onOpenRecording} />
          <input type="datetime-local" value={toLocalInput(r.dueAt)} title="Due date" aria-label="Due date"
            onChange={(e) => e.target.value && api.updateReminder(r.id, { dueAt: fromLocalInput(e.target.value) }).then(reload)}
            className={`flex-none bg-transparent border border-transparent hover:border-border rounded-[6px] px-1.5 py-0.5 text-[11.5px] outline-none ${
              isOverdue(r.dueAt, r.done) ? 'text-rec' : 'text-ink3'}`} />
          <button type="button" onClick={() => api.deleteReminder(r.id).then(reload)} title="Delete"
            className="flex-none p-1 rounded text-ink3 opacity-0 group-hover:opacity-100 hover:text-rec"><Icon name="trash" size={13} /></button>
        </div>
      ))}
    </div>
  );
}

const Empty = ({ text }: { text: string }) => <div className="text-center text-[12.5px] text-ink3 py-12">{text}</div>;
