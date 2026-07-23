import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { onKernel, onFrame } from '../../api/socket';
import type { Agent, KernelJob, KernelSnapshot } from '../../types';

// The dashboard's middle column: a live mirror of the Work Kernel over the `kernel` WS
// channel. Two views:
//   • Work   — the queue right now: running / queued / dead work items, updating live.
//   • Frames — a raw tap of every inbound WS frame (a debug console).
// Replaces the old "Live events" feed, which duplicated the pool column and never showed
// the kernel itself.

const BAND_LABEL: Record<number, string> = { 0: 'interactive', 1: 'event', 2: 'background' };
const BAND_TONE: Record<number, string> = {
  0: 'text-accent-dark bg-accent-soft/30 border-accent/30',
  1: 'text-blue bg-blue/10 border-blue/30',
  2: 'text-ink3 bg-border-soft border-border',
};

function ago(iso: string | null): string {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
}

function JobRow({ job, agentName, onOpen }: { job: KernelJob; agentName: string; onOpen?: () => void }) {
  const dot =
    job.state === 'running' ? 'an-pulse bg-accent' : job.state === 'dead' ? 'bg-rec' : 'bg-ink3';
  const when = job.state === 'running' ? job.startedAt : job.createdAt;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      className={`w-full text-left flex items-center gap-2.5 px-3 py-1.5 rounded-[8px] border ${
        job.state === 'dead' ? 'border-rec/30 bg-rec/5' : 'border-border-soft/70 bg-card/40'
      } ${onOpen ? 'hover:border-accent/50 hover:bg-card' : ''} transition-colors`}
    >
      <span className={`w-[7px] h-[7px] rounded-full flex-none ${dot}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[12px] text-ink font-550 truncate">{agentName}</span>
          <span className="font-mono text-[9.5px] text-ink3 truncate">{job.triggerType || job.kind}</span>
        </div>
        {job.state === 'dead' && job.deadReason && (
          <div className="text-[10.5px] text-rec truncate">{job.deadReason}</div>
        )}
      </div>
      <span className={`flex-none font-mono text-[9px] px-1.5 py-0.5 rounded border ${BAND_TONE[job.band] ?? BAND_TONE[2]}`}>
        {job.lane}·{BAND_LABEL[job.band] ?? job.band}
      </span>
      {job.attempts > 1 && (
        <span className="flex-none font-mono text-[9px] text-orange" title={`${job.attempts} attempts`}>×{job.attempts}</span>
      )}
      {when && <span className="flex-none font-mono text-[9.5px] text-ink3 w-[26px] text-right">{ago(when)}</span>}
    </button>
  );
}

function WorkView({ snap, agents, onOpenAgent }: {
  snap: KernelSnapshot | null;
  agents: Agent[];
  onOpenAgent: (a: Agent) => void;
}) {
  const nameOf = (id: string | null) => agents.find((a) => a.id === id)?.name ?? id ?? '—';
  const openFor = (job: KernelJob) => {
    const a = agents.find((x) => x.id === job.agentId);
    return a ? () => onOpenAgent(a) : undefined;
  };

  if (!snap) return <div className="text-[12.5px] text-ink3 text-center py-12">Connecting to the Work Kernel…</div>;
  const empty = snap.counts.running === 0 && snap.counts.queued === 0 && snap.counts.dead === 0;
  if (empty) return <div className="text-[12.5px] text-ink3 text-center py-12">The kernel is idle — no work queued or running.</div>;

  const Section = ({ title, jobs, tone }: { title: string; jobs: KernelJob[]; tone: string }) =>
    jobs.length === 0 ? null : (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 px-1 pt-1">
          <span className={`text-[10px] uppercase tracking-wider font-600 ${tone}`}>{title}</span>
          <span className="font-mono text-[10px] text-ink3">{jobs.length}</span>
        </div>
        {jobs.map((j) => <JobRow key={j.id} job={j} agentName={nameOf(j.agentId)} onOpen={openFor(j)} />)}
      </div>
    );

  return (
    <div className="flex flex-col gap-2.5">
      <Section title="Running" jobs={snap.running} tone="text-accent-dark" />
      <Section title="Queued" jobs={snap.queued} tone="text-ink2" />
      <Section title="Dead-lettered" jobs={snap.dead} tone="text-rec" />
    </div>
  );
}

type FrameLog = { seq: number; at: number; type: string; summary: string; raw: unknown };

// A compact one-line summary per frame type, so the debug log reads at a glance.
function summarize(frame: Record<string, unknown>): string {
  const t = frame.type as string;
  if (t === 'chat') {
    const ev = (frame.ev as Record<string, unknown>) || {};
    const evt = ev.type as string;
    const extra = evt === 'token' ? JSON.stringify(ev.text)?.slice(0, 40)
      : evt === 'tool_start' || evt === 'tool_end' ? String(ev.name ?? ev.id ?? '')
      : evt === 'error' ? String(ev.error ?? '') : '';
    return `${String(frame.runId).slice(0, 10)} · ${evt}${extra ? ' ' + extra : ''}`;
  }
  if (t === 'event') {
    const ev = (frame.event as Record<string, unknown>) || {};
    return `${ev.type} ${ev.label ? '· ' + ev.label : ''}`;
  }
  if (t === 'kernel') {
    const c = ((frame.snapshot as Record<string, unknown>)?.counts as Record<string, number>) || {};
    return `snapshot · ${c.running ?? 0} running · ${c.queued ?? 0} queued · ${c.dead ?? 0} dead`;
  }
  if (t === 'res') return `${frame.ok ? 'ok' : 'err'} ${frame.id ?? ''}`;
  if (t === 'transcript') return String(frame.append ?? '').slice(0, 40);
  return '';
}

const TYPE_TONE: Record<string, string> = {
  chat: 'text-accent-dark', event: 'text-ink2', kernel: 'text-blue',
  res: 'text-ink3', ping: 'text-ink3/60', transcript: 'text-orange',
};

function FramesView() {
  const [frames, setFrames] = useState<FrameLog[]>([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const seqRef = useRef(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => {
    return onFrame((f) => {
      if (pausedRef.current) return;
      const frame = f as Record<string, unknown>;
      const type = String(frame.type ?? 'unknown');
      setFrames((prev) => {
        const next = [{ seq: ++seqRef.current, at: Date.now(), type, summary: summarize(frame), raw: frame }, ...prev];
        return next.length > 300 ? next.slice(0, 300) : next; // bounded ring — newest 300
      });
    });
  }, []);

  const shown = filter ? frames.filter((f) => f.type.includes(filter) || f.summary.includes(filter)) : frames;

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 h-6 px-2 rounded-[6px] bg-card border border-border flex-1">
          <Icon name="search" size={11} color="var(--color-ink3)" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter frames…"
            className="flex-1 bg-transparent outline-none text-[11px] text-ink font-mono" />
        </div>
        <button type="button" onClick={() => setPaused((p) => !p)}
          className={`h-6 px-2 rounded-[6px] border text-[10.5px] flex items-center gap-1 ${paused ? 'border-accent text-accent' : 'border-border text-ink3 hover:text-ink2'}`}>
          <Icon name={paused ? 'play' : 'pause'} size={10} /> {paused ? 'Paused' : 'Live'}
        </button>
        <button type="button" onClick={() => setFrames([])} title="Clear"
          className="h-6 px-2 rounded-[6px] border border-border text-ink3 hover:text-rec text-[10.5px]">Clear</button>
      </div>
      <div className="font-mono text-[10.5px] flex flex-col">
        {shown.length === 0 && <div className="text-ink3 text-center py-10">No frames yet.</div>}
        {shown.map((f) => (
          <div key={f.seq} className="flex items-start gap-2 py-0.5 border-b border-border-soft/40 last:border-0">
            <span className="text-ink3/70 flex-none w-[52px]">{new Date(f.at).toLocaleTimeString([], { hour12: false })}</span>
            <span className={`flex-none w-[64px] ${TYPE_TONE[f.type] ?? 'text-ink2'}`}>{f.type}</span>
            <span className="flex-1 min-w-0 text-ink2 break-all">{f.summary}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KernelPanel({ agents, onOpenAgent }: { agents: Agent[]; onOpenAgent: (a: Agent) => void }) {
  const [view, setView] = useState<'work' | 'frames'>('work');
  const [snap, setSnap] = useState<KernelSnapshot | null>(null);

  useEffect(() => onKernel((s) => setSnap(s as KernelSnapshot)), []);

  const counts = snap?.counts;
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      <div className="flex items-center justify-between px-4 h-9 flex-none border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-ink3 font-600">Work Kernel</span>
          {counts && (
            <span className="flex items-center gap-1.5 font-mono text-[10px]">
              <span className="text-accent-dark">{counts.running}▸</span>
              <span className="text-ink3">{counts.queued}⋯</span>
              {counts.dead > 0 && <span className="text-rec">{counts.dead}✕</span>}
            </span>
          )}
        </div>
        <div className="flex gap-0.5 bg-sidebar border border-sidebar-border rounded-[6px] p-0.5">
          {([['work', 'Work'], ['frames', 'Frames']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={`px-2 py-0.5 rounded-[4px] text-[11px] ${view === v ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2.5 min-h-0">
        {view === 'work'
          ? <WorkView snap={snap} agents={agents} onOpenAgent={onOpenAgent} />
          : <FramesView />}
      </div>
    </div>
  );
}
