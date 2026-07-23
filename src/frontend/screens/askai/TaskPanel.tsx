import { useEffect, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import type { SessionTask } from '../../types';

// The agent's live plan (task_create/task_update tools), docked to the TOP of the composer
// input box as a collapsible bar. Updated in place by `tasks` SSE events as the run mutates
// its list; restored from GET /sessions/{sid}/tasks when a session is reopened. Once every
// task is completed the panel briefly shows "done", then removes itself via onDismiss.
export function TaskPanel({ tasks, onDismiss }: { tasks: SessionTask[]; onDismiss: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const done = tasks.filter((t) => t.status === 'completed').length;
  const allDone = tasks.length > 0 && done === tasks.length;

  // When the whole plan is finished, linger a moment so the completion is visible, then
  // clear the panel. Any new/incomplete task arriving cancels the pending removal.
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(onDismiss, 2000);
    return () => clearTimeout(t);
  }, [allDone, onDismiss]);

  return (
    <div className="border-b border-border bg-bg/60">
      <button
        type="button"
        title={collapsed ? 'Expand tasks' : 'Collapse tasks'}
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-border-soft/50 transition-colors"
      >
        {allDone
          ? <Icon name="check" size={12} color="var(--color-accent)" />
          : <span className="an-pulse w-1.5 h-1.5 rounded-full bg-accent flex-none" />}
        <span className="text-[12px] font-500 text-ink2">
          Tasks <span className="text-ink3 font-400">{done}/{tasks.length}</span>
        </span>
        <div className="flex-1" />
        <Icon name={collapsed ? 'chevR' : 'chevD'} size={12} color="var(--color-ink3)" />
      </button>
      {!collapsed && (
        <div className="max-h-[38vh] overflow-y-auto pb-1.5">
          {tasks.map((t) => {
            const running = t.status === 'in_progress';
            const label = running && t.activeForm ? t.activeForm : t.subject;
            return (
              <div key={t.id} className="flex items-start gap-2 px-3 py-1">
                <span className="flex-none w-3.5 h-4 flex items-center justify-center">
                  {t.status === 'completed'
                    ? <Icon name="check" size={12} color="var(--color-accent)" />
                    : running
                      ? <span className="an-pulse w-2 h-2 rounded-full bg-accent" />
                      : <span className="w-2.5 h-2.5 rounded-full border border-ink3/60" />}
                </span>
                <span className={`text-[12px] leading-snug ${
                  t.status === 'completed' ? 'text-ink3 line-through' : running ? 'text-ink' : 'text-ink2'
                }`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
