import { useCallback, useEffect, useState } from 'react';
import { Icon } from './chrome/Icon';
import { Markdown } from './Markdown';
import { api } from '../api/client';
import type { Recording, Todo, Reminder } from '../types';

function fmtDue(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((d.getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  const day =
    days === 0 ? 'Today' :
    days === 1 ? 'Tomorrow' :
    days > 1 && days < 7 ? d.toLocaleDateString([], { weekday: 'long' }) :
    d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const hasTime = d.getHours() || d.getMinutes();
  const time = hasTime ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return time ? `${day} · ${time}` : day;
}

/** The summary + Tasks + Reminders panels of the "Here's what I caught" card.
 *  Tasks/reminders are auto-created by the summarizer agent; this displays them
 *  (tasks toggle done inline). Self-fetches linked items for the recording. */
export function CaughtPanels({ rec, live, onOpen, hideSummary }: {
  rec: Recording;
  live?: boolean;         // poll while the copilot is still working (Capture review)
  onOpen?: () => void;
  hideSummary?: boolean;  // the caller renders Summary itself (avoids a duplicate card)
}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);

  const load = useCallback(() => {
    api.listTodos().then((all) => setTodos(all.filter((t) => t.source?.id === rec.id))).catch(() => {});
    api.listReminders().then((all) => setReminders(all.filter((r) => r.source?.id === rec.id))).catch(() => {});
  }, [rec.id]);

  useEffect(() => { load(); }, [load, rec.summary]);
  useEffect(() => {
    if (!live || rec.summary) return;          // stop polling once the summary lands
    const iv = setInterval(load, 2500);
    return () => clearInterval(iv);
  }, [live, rec.summary, load]);

  const toggle = (t: Todo) => api.setTodoDone(t.id, !t.done).then(load).catch(() => {});
  const incomplete = todos.filter((t) => !t.done).length;
  const markAllDone = () => Promise.all(todos.filter((t) => !t.done).map((t) => api.setTodoDone(t.id, true))).then(load).catch(() => {});

  return (
    <div className="flex flex-col gap-5">
      {!hideSummary && (
        <div className="rounded-[14px] border border-border bg-card px-5 py-4">
          <div className="flex items-center gap-1.5 mb-2.5 text-ink3">
            <Icon name="sparkle" size={13} color="var(--color-accent)" />
            <span className="text-[10.5px] uppercase tracking-wider font-600">Summary</span>
          </div>
          {rec.summary ? (
            <Markdown text={rec.summary} textSize="text-[13px]" />
          ) : (
            <div className="text-[13px] text-ink3 italic an-pulse">
              {rec.transcript ? 'Summarizing…' : 'Transcribing…'}
            </div>
          )}
        </div>
      )}

      {/* tasks + reminders */}
      <div className="grid grid-cols-2 gap-4 max-[760px]:grid-cols-1">
        {/* tasks */}
        <div className="rounded-[14px] border border-border bg-card flex flex-col">
          <div className="flex items-center gap-1.5 px-5 pt-4 pb-2.5 text-ink3">
            <Icon name="check" size={13} color="var(--color-accent)" />
            <span className="text-[10.5px] uppercase tracking-wider font-600 flex-1">Tasks</span>
            <span className="text-[11px] text-ink3 normal-case tracking-normal">{todos.length ? `${todos.length}` : ''}</span>
          </div>
          <div className="px-5 pb-3 flex flex-col gap-2 min-h-[40px]">
            {todos.length === 0 ? (
              <div className="text-[12.5px] text-ink3 italic py-1">{rec.summary ? 'No action items.' : 'Looking for action items…'}</div>
            ) : todos.map((t) => (
              <button key={t.id} type="button" onClick={() => toggle(t)} className="flex items-start gap-2.5 text-left group">
                <span className={`mt-[1px] w-4 h-4 rounded-[5px] border flex-none grid place-items-center ${
                  t.done ? 'bg-accent border-accent text-on-accent' : 'border-ink3 group-hover:border-ink2'}`}>
                  {t.done && <Icon name="check" size={11} color="var(--color-accent-ink)" />}
                </span>
                <span className={`text-[13px] leading-snug ${t.done ? 'line-through text-ink3' : 'text-ink'}`}>{t.text}</span>
              </button>
            ))}
          </div>
          {todos.length > 0 && (
            <button type="button" onClick={markAllDone} disabled={incomplete === 0}
              className={`mx-3 mb-3 mt-auto h-9 rounded-[9px] text-[13px] font-550 ${
                incomplete === 0 ? 'bg-sidebar text-sidebar-ink3 cursor-default' : 'bg-accent text-on-accent hover:bg-accent-dark'}`}>
              {incomplete === 0 ? 'All done ✓' : `Mark ${incomplete} done`}
            </button>
          )}
        </div>

        {/* reminders */}
        <div className="rounded-[14px] border border-border bg-card flex flex-col">
          <div className="flex items-center gap-1.5 px-5 pt-4 pb-2.5 text-ink3">
            <Icon name="bell" size={13} color="var(--color-accent)" />
            <span className="text-[10.5px] uppercase tracking-wider font-600 flex-1">Reminders</span>
            <span className="text-[11px] text-ink3 normal-case tracking-normal">{reminders.length ? `${reminders.length}` : ''}</span>
          </div>
          <div className="px-5 pb-3 flex flex-col gap-2 min-h-[40px]">
            {reminders.length === 0 ? (
              <div className="text-[12.5px] text-ink3 italic py-1">{rec.summary ? 'No reminders.' : 'Looking for follow-ups…'}</div>
            ) : reminders.map((r) => (
              <div key={r.id} className="flex items-start gap-2.5">
                <span className="mt-[1px] w-6 h-6 rounded-[7px] bg-sidebar flex-none grid place-items-center text-sidebar-ink3">
                  <Icon name="bell" size={13} color="currentColor" />
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] text-ink leading-snug truncate">{r.title}</div>
                  <div className="text-[11.5px] text-ink3">{fmtDue(r.dueAt)}</div>
                </div>
              </div>
            ))}
          </div>
          {onOpen && reminders.length > 0 && (
            <button type="button" onClick={onOpen}
              className="mx-3 mb-3 mt-auto h-9 rounded-[9px] border border-border text-ink2 text-[13px] hover:border-ink3">
              View in Recordings
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
