import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { useEvents } from '../../hooks/useEvents';
import type { AppEvent } from '../../types';

interface Line {
  id: string;
  text: string;
  done?: boolean;
  failed?: boolean;
}

// Drives a Gardener run and streams its real progress: the mechanical pass
// (knowledge.maintenance.progress/completed events, one line per pass) followed by the
// kb-maintainer agent's compaction run (agent.run.started/completed/failed for agentId
// "kb-maintainer"). Returns the progress lines + whether a run is in flight, and a
// `start` fn. `active` starts a run automatically on mount (used by the legacy modal).
export function useGardenerRun(active: boolean) {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);

  const append = useCallback((text: string, extra?: Partial<Line>) => {
    setLines((ls) => [...ls, { id: `${Date.now()}-${ls.length}`, text, ...extra }]);
  }, []);

  const start = useCallback(() => {
    setLines([{ id: 'start', text: 'Running maintenance…' }]);
    setRunning(true);
    api.runGardener().catch((err) => { append(`Mechanical pass failed: ${err}`, { failed: true }); setRunning(false); });
  }, [append]);

  const started = useRef(false);
  useEffect(() => {
    if (active && !started.current) { started.current = true; start(); }
  }, [active, start]);

  useEvents((raw) => {
    if (!running) return; // ignore maintenance events from other sources when idle
    const e = raw as AppEvent;
    const t = e.type || '';
    if (t === 'knowledge.maintenance.progress') {
      append(String(e.payload?.message ?? ''));
    } else if (t === 'knowledge.maintenance.completed') {
      const p = e.payload as { repairs?: number; compaction?: number; has_work?: boolean } | undefined;
      append(`Mechanical pass done — ${p?.repairs ?? 0} repair${p?.repairs === 1 ? '' : 's'} `
        + `and ${p?.compaction ?? 0} note${p?.compaction === 1 ? '' : 's'} to compact queued`, { done: true });
      if (p?.has_work) append('Handing the worklist to the Knowledge Maintainer…');
      else setRunning(false);
    } else if (t === 'agent.run.started' && e.entityId === 'kb-maintainer') {
      append('Knowledge Maintainer applying repairs…');
    } else if (t === 'agent.run.completed' && e.entityId === 'kb-maintainer') {
      append((e.payload?.output as string) || 'Repairs finished.', { done: true });
      setRunning(false);
    } else if (t === 'agent.run.failed' && e.entityId === 'kb-maintainer') {
      append(`Repairs failed: ${e.payload?.error ?? 'unknown error'}`, { failed: true });
      setRunning(false);
    }
  });

  return { lines, running, start };
}

// Inline progress log — the streamed Gardener lines, no chrome. Embeds in the Health tab.
export function GardenerLog({ lines }: { lines: Line[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'nearest' }); }, [lines]);
  return (
    <div className="flex flex-col gap-1 font-mono text-[11.5px] max-h-[240px] overflow-y-auto">
      {lines.map((l) => (
        <div key={l.id} className={`flex items-start gap-1.5 ${l.failed ? 'text-rec' : l.done ? 'text-ink' : 'text-ink2'}`}>
          <span className="flex-none text-ink3">{l.failed ? '✕' : l.done ? '✓' : '·'}</span>
          <span className="whitespace-pre-wrap break-words">{l.text}</span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

// Legacy bottom-docked sheet — kept for any caller still opening the Gardener as a modal.
export function GardenerPanel({ onClose }: { onClose: () => void }) {
  const { lines, running } = useGardenerRun(true);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/25" onClick={() => !running && onClose()}>
      <div className="w-[560px] max-w-[92vw] mb-6 max-h-[46vh] bg-card border border-border rounded-[12px] shadow-pop flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 flex-none">
          <span className={running ? 'animate-spin' : ''}><Icon name="leaf" size={14} color="var(--color-accent)" /></span>
          <span className="text-[13px] font-550 text-ink">Gardener</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} title={running ? 'Run continues in the background' : 'Close'}
            className="w-6 h-6 grid place-items-center rounded-[6px] text-ink3 hover:text-ink hover:bg-border-soft">
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
          <GardenerLog lines={lines} />
        </div>
      </div>
    </div>
  );
}
