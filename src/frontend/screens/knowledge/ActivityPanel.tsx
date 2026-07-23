import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { useEvents } from '../../hooks/useEvents';
import type { KnowledgeIngestEntry, KnowledgeIngestStatus } from '../../types';

const STATE_STYLE: Record<string, string> = {
  converting: 'border-blue-500/40 bg-blue-500/10 text-blue-600',
  queued: 'border-sidebar-border bg-sidebar text-sidebar-ink3',
  running: 'border-accent-soft bg-accent-soft/30 text-accent-dark',
  filed: 'border-green-600/40 bg-green-600/10 text-green-700',
  failed: 'border-rec/40 bg-rec/10 text-rec',
  empty: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
};
const STATE_LABEL: Record<string, string> = {
  converting: 'Converting…', queued: 'Queued', running: 'Filing…', filed: 'Filed', failed: 'Failed', empty: 'No notes',
};

const fmt = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' +
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

function Row({ e }: { e: KnowledgeIngestEntry }) {
  return (
    <div className="flex items-start gap-2.5 px-3 py-2 rounded-[9px] border border-border bg-card">
      <span className={`flex-none mt-0.5 text-[10px] px-1.5 py-0.5 rounded border ${STATE_STYLE[e.state] || STATE_STYLE.queued}`}>
        {(e.state === 'running' || e.state === 'converting') && <span className="inline-block animate-spin mr-0.5">◜</span>}
        {STATE_LABEL[e.state] || e.state}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-ink truncate">{e.title}</div>
        <div className="text-[10.5px] text-ink3 flex items-center gap-1.5">
          <span>{e.kind}</span>{e.at && <><span>·</span><span>{fmt(e.at)}</span></>}
        </div>
        {e.error && <div className="mt-1 text-[11px] text-rec">{e.error}</div>}
        {e.state === 'empty' && <div className="mt-1 text-[11px] text-amber-700">Finished without creating notes — the document may hold no durable facts, or the model returned nothing.</div>}
        {e.summary && <div className="mt-1 text-[11px] text-ink2 line-clamp-2">{e.summary}</div>}
      </div>
    </div>
  );
}

// Ingest activity: what the Keeper is filing now (queued/running) and recently
// (filed/failed). Polls while anything is active; refreshes on run/knowledge events.
// Live ingest status + polling, with no chrome — embeds in the right-rail tab group.
// `onRefreshReady` hands the parent a refresh fn so the rail header can drive a reload.
export function ActivityContent({ onRefreshReady }: { onRefreshReady?: (fn: () => void) => void }) {
  const [status, setStatus] = useState<KnowledgeIngestStatus>({ active: [], recent: [] });
  const load = useCallback(() => { api.getKnowledgeIngestStatus().then(setStatus).catch(() => {}); }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { onRefreshReady?.(load); }, [onRefreshReady, load]);
  useEvents((raw) => {
    const t = (raw as { type?: string }).type || '';
    if (t.startsWith('agent.run.') || t.startsWith('knowledge.')) load();
  });
  // Keep polling while work is in flight (events cover most of it; this is the safety net).
  useEffect(() => {
    if (status.active.length === 0) return;
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [status.active.length, load]);

  const empty = status.active.length === 0 && status.recent.length === 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-3">
      {empty && <div className="text-center text-[12px] text-ink3 py-16">Nothing fed yet. Use “Feed docs” to add a document — it shows up here as it’s filed.</div>}
      {status.active.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-600 uppercase tracking-wider text-ink3 px-1">In progress · {status.active.length}</div>
          {status.active.map((e) => <Row key={e.jobId} e={e} />)}
        </div>
      )}
      {status.recent.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-600 uppercase tracking-wider text-ink3 px-1">Recent</div>
          {status.recent.map((e) => <Row key={e.jobId} e={e} />)}
        </div>
      )}
    </div>
  );
}

// Legacy slide-over modal — kept for any caller that still opens Activity as an overlay.
export function ActivityPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onClick={onClose}>
      <div className="w-[420px] max-w-[92vw] h-full bg-card border-l border-border shadow-pop flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Icon name="chart" size={15} />
          <span className="text-[14px] font-550 text-ink">Ingest activity</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} title="Close" className="w-7 h-7 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3"><Icon name="x" size={14} /></button>
        </div>
        <ActivityContent />
      </div>
    </div>
  );
}
