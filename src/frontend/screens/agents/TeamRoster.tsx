import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import {
  avatarColor, firstName, roleOf, usePresenceMap, LABEL, DOT, type Presence,
} from './OfficeView';
import type { Agent } from '../../types';
import { describe } from '../../types/schedule';

// Same initials rule the office/AgentForm use.
function initials(n: string) {
  const t = firstName(n);
  return t ? t.slice(0, 2).toUpperCase() : '·';
}
function ago(iso: string | null) {
  if (!iso) return 'never run';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
// Compact money label for a card chip — cents matter, sub-cent rounds to "<1¢".
export function fmtCost(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `${Math.round(usd * 100)}¢`;
  return '<1¢';
}

// The shift, in plain words ("Every day at 09:00", "Every Mon at 09:00", "Every 6 hours").
function shiftLabel(a: Agent): string | null {
  if (!a.schedule || a.schedule.kind === 'none') return null;
  return describe(a.schedule);
}

type Scope = 'everyone' | 'yours' | 'default';

/** The Team roster — a card grid of every assistant (replaces the Manage sidebar list).
 *  Each card is a staff badge: avatar, name + live status dot (same data as the office),
 *  role, one-line summary, chips, and last run. A dashed "Hire an assistant" card leads
 *  the grid. `running`/`waiting` come from AgentsScreen; the kernel snapshot is folded in
 *  by usePresenceMap so a card's dot always matches the office floor. */
export function TeamRoster({ agents, running, waiting, onOpen, onHire }: {
  agents: Agent[];
  running: Set<string>;
  waiting: Set<string>;
  onOpen: (a: Agent) => void;
  onHire: () => void;
}) {
  const [scope, setScope] = useState<Scope>('everyone');
  const [search, setSearch] = useState('');
  const presence = usePresenceMap(agents, running, waiting);

  // Last-7-days spend per assistant, from the durable usage ledger (see usage_store.py).
  const [costByAgent, setCostByAgent] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    api.getUsage(7)
      .then((u) => setCostByAgent(new Map(u.byAgent.map((r) => [r.key, r.costUsd]))))
      .catch(() => {});
  }, []);

  const counts = useMemo(() => ({
    everyone: agents.length,
    yours: agents.filter((a) => !a.internal).length,
    default: agents.filter((a) => a.internal).length,
  }), [agents]);

  const shown = useMemo(() => {
    let list = agents;
    if (scope === 'yours') list = list.filter((a) => !a.internal);
    else if (scope === 'default') list = list.filter((a) => a.internal);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q));
    }
    // Sort by liveliness first (working → queued → … → paused), then name.
    const ORDER: Record<Presence, number> = { working: 0, queued: 1, waiting: 2, scheduled: 3, idle: 4, paused: 5 };
    return [...list].sort((a, b) => {
      const d = ORDER[presence.get(a.id) ?? 'idle'] - ORDER[presence.get(b.id) ?? 'idle'];
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  }, [agents, scope, search, presence]);

  const big = agents.length > 10;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* controls: scope segment + (when large) a search box */}
      <div className="flex items-center gap-3 px-5 h-11 flex-none border-b border-border-soft">
        <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[7px] p-0.5">
          {(['everyone', 'yours', 'default'] as Scope[]).map((k) => (
            <button key={k} type="button" onClick={() => setScope(k)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[12px] capitalize ${
                scope === k ? 'bg-card text-ink shadow-soft font-550' : 'text-sidebar-ink3'}`}>
              {k}<span className="opacity-60 text-[10px] font-mono">{counts[k]}</span>
            </button>
          ))}
        </div>
        {big && (
          <div className="flex items-center gap-1.5 h-7 px-2 rounded-[6px] bg-card border border-border w-[200px]">
            <Icon name="search" size={12} color="var(--color-ink3)" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team…"
              className="flex-1 bg-transparent outline-none text-[12px] text-ink" />
          </div>
        )}
      </div>

      {/* the roster grid */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(232px,1fr))]">
          <HireCard onClick={onHire} />
          {shown.map((a) => (
            <RosterCard key={a.id} a={a} presence={presence.get(a.id) ?? 'idle'}
              weekCost={costByAgent.get(a.id) ?? 0} onClick={() => onOpen(a)} />
          ))}
          {shown.length === 0 && (
            <div className="col-span-full text-center text-[13px] text-ink3 py-10">
              {search ? 'No one matches that.' : scope === 'default' ? 'No default assistants.' : 'No assistants yet — hire one to get started.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HireCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="min-h-[124px] rounded-[13px] border-[1.5px] border-dashed border-accent/70 bg-accent-soft/25 hover:bg-accent-soft/40 transition-colors flex flex-col items-center justify-center gap-2 text-accent-dark">
      <span className="w-9 h-9 rounded-full bg-accent grid place-items-center text-white">
        <Icon name="plus" size={18} />
      </span>
      <span className="text-[13px] font-650">Hire an assistant</span>
      <span className="text-[10.5px] text-accent-dark/80">Describe a role, pick a draft</span>
    </button>
  );
}

function RosterCard({ a, presence, weekCost, onClick }: { a: Agent; presence: Presence; weekCost: number; onClick: () => void }) {
  const shift = shiftLabel(a);
  const onCall = a.triggers.length > 0;
  const toolCount = a.tools.length + a.deferredTools.length;
  const paused = !a.enabled;
  return (
    <button type="button" onClick={onClick} title={a.description || a.name}
      className={`text-left rounded-[13px] border border-border bg-card p-3 hover:border-ink3 hover:shadow-soft transition-all flex flex-col ${paused ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2.5 mb-2">
        <span className="w-8 h-8 rounded-full grid place-items-center text-white text-[11px] font-650 flex-none"
          style={{ background: avatarColor(a.id) }}>
          {initials(a.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={`text-[13.5px] font-600 text-ink truncate ${paused ? 'italic' : ''}`}>{firstName(a.name)}</span>
            <span className={`w-[7px] h-[7px] rounded-full flex-none ${DOT[presence]}`} title={LABEL[presence]} />
          </div>
          <div className="text-[10.5px] text-ink3 truncate">{roleOf(a)}</div>
        </div>
      </div>
      <p className="text-[11px] text-ink2 leading-snug line-clamp-2 min-h-[30px] mb-2.5">
        {a.description || 'No description yet.'}
      </p>
      <div className="mt-auto flex items-center gap-1.5 flex-wrap">
        {paused
          ? <Chip>Paused</Chip>
          : shift
            ? <Chip tone="blue">shift · {shift}</Chip>
            : onCall
              ? <Chip tone="blue">on call</Chip>
              : null}
        {a.surfaces.includes('chat') && <Chip tone="accent">Chat</Chip>}
        {a.internal && <Chip>Default</Chip>}
        {toolCount > 0 && <Chip>{toolCount} {toolCount === 1 ? 'tool' : 'tools'}</Chip>}
        {weekCost > 0 && <Chip tone="accent" title="Estimated spend, last 7 days">{fmtCost(weekCost)} · 7d</Chip>}
        <span className="ml-auto text-[9px] font-mono text-ink3 flex items-center gap-1">
          {a.lastRunStatus === 'error' ? <span className="text-rec">✕</span> : a.lastRunAt ? <span className="text-ok">✓</span> : null}
          {ago(a.lastRunAt)}
        </span>
      </div>
    </button>
  );
}

function Chip({ children, tone, title }: { children: React.ReactNode; tone?: 'accent' | 'blue'; title?: string }) {
  const cls = tone === 'accent'
    ? 'border-accent text-accent-dark'
    : tone === 'blue'
      ? 'border-blue/60 text-blue'
      : 'border-border text-ink3';
  return (
    <span title={title} className={`font-mono text-[9px] leading-none border rounded px-1.5 py-1 ${cls}`}>
      {children}
    </span>
  );
}
