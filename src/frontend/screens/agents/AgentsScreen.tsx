import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { AgentForm } from './AgentForm';
import { AgentRunsPanel } from './AgentRunsPanel';
import { KernelPanel } from './KernelPanel';
import { OfficeView, PresenceSummary, useWaitingSet } from './OfficeView';
import { TeamRoster } from './TeamRoster';
import { HireWizard } from './HireWizard';
import { announceHire } from './hireEvent';
import { ToolsManager } from './ToolsManager';
import { McpManager } from './McpManager';
import type { Agent, AppEvent, PoolItem } from '../../types';

const PRIO: Record<string, string> = { P1: 'bg-rec text-white', P2: 'bg-accent text-white', P3: 'bg-ink3 text-white' };

// The Office (floor-plan) home view is hidden for now — flip this to re-enable its tab and
// make it the default home again. Everything for it (OfficeTab/OfficeView) stays in place.
const OFFICE_ENABLED = false;

type State = 'working' | 'scheduled' | 'idle' | 'paused';
const STATE_ORDER: Record<State, number> = { working: 0, scheduled: 1, idle: 2, paused: 3 };
function stateOf(a: Agent, running: Set<string>): State {
  if (running.has(a.id)) return 'working';
  if (!a.enabled) return 'paused';
  if (a.schedule && a.schedule.kind !== 'none') return 'scheduled';
  return 'idle';
}
const STATE_LABEL: Record<State, string> = {
  working: 'Working — running now', scheduled: 'Scheduled', idle: 'Idle — waiting for triggers', paused: 'Paused',
};
const STATE_DOT: Record<State, string> = { working: 'an-pulse bg-accent', scheduled: 'bg-blue', idle: 'bg-ink3', paused: 'bg-faint' };

function ago(iso?: string) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function AgentsScreen({ agents, activity, running, onRefreshActivity, onRefreshAgents }: {
  agents: Agent[];
  activity: AppEvent[];
  running: Set<string>;
  onRefreshActivity: () => void;
  onRefreshAgents: () => void;
}) {
  const [tab, setTab] = useState<'office' | 'list' | 'agents' | 'tools' | 'mcp'>(OFFICE_ENABLED ? 'office' : 'list');
  const [newSignal, setNewSignal] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const isHome = tab === 'office' || tab === 'list';

  const refreshAll = () => {
    setRefreshing(true);
    onRefreshAgents();
    onRefreshActivity();
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* header tabs */}
      <div className="flex items-center gap-3 px-3 h-12 flex-none border-b border-border">
        <div className="flex-1 flex">
          <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[7px] p-0.5 w-fit">
            {([['office', 'grid', 'Office'], ['list', 'steps', 'List'], ['agents', 'sparkle', 'Team'], ['tools', 'settings', 'Tools'], ['mcp', 'zap', 'MCP']] as const)
              .filter(([t]) => OFFICE_ENABLED || t !== 'office')
              .map(([t, icon, label]) => (
              <button key={t} type="button" onClick={() => { setTab(t); if (t === 'office' || t === 'list') onRefreshActivity(); }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[12.5px] ${
                  tab === t ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
                <Icon name={icon} size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <h1 className="font-serif italic text-[20px] text-ink flex-none text-center">Assistants</h1>
        <div className="flex-1 flex justify-end items-center gap-2">
          <button type="button" onClick={refreshAll} title="Refresh agents"
            className="flex-none w-7 h-7 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3">
            <span className={refreshing ? 'animate-spin' : ''}><Icon name="refresh" size={13} /></span>
          </button>
          {tab === 'agents' && (
            <button type="button" onClick={() => setNewSignal((n) => n + 1)}
              className="flex-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-border bg-card text-ink2 text-[12px] hover:border-ink3">
              <Icon name="plus" size={13} /> Hire
            </button>
          )}
        </div>
      </div>

      {isHome && <OfficeTab view={tab as 'office' | 'list'} agents={agents} activity={activity} running={running} />}
      {tab === 'agents' && <AgentsManager agents={agents} activity={activity} running={running} onRefreshAgents={onRefreshAgents} onGoOffice={() => setTab(OFFICE_ENABLED ? 'office' : 'list')} newSignal={newSignal} />}
      {tab === 'tools' && <ToolsManager />}
      {tab === 'mcp' && <McpManager />}
    </div>
  );
}

// ─── The dashboard tab: an Office view (default) with the classic List view a toggle away.
// The Office is the calm, scan-at-a-glance home; the List is the power view (agent list +
// live Work Kernel + common pool). Two renderings of the same live data.
// The home view of the Assistants page — Office (the floor plan) or List (the classic
// three-column dashboard). The Office/List choice is now a top-level tab (see the header
// strip), so this component just renders the chosen view. The Office view keeps a slim
// bar with the live presence summary + staff toggle; List has its own controls.
function OfficeTab({ view, agents, activity, running }: { view: 'office' | 'list'; agents: Agent[]; activity: AppEvent[]; running: Set<string> }) {
  const [showInternal, setShowInternal] = useState(true);
  const waiting = useWaitingSet(activity);
  const internalCount = agents.filter((a) => a.internal).length;
  const visible = agents.filter((a) => showInternal || !a.internal);

  if (view === 'list') return <Dashboard agents={agents} activity={activity} running={running} />;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-4 h-8 flex-none border-b border-border-soft">
        <PresenceSummary agents={visible} running={running} waiting={waiting} />
        {internalCount > 0 && (
          <button type="button" onClick={() => setShowInternal((v) => !v)}
            className={`flex-none text-[11px] px-2 py-0.5 rounded-[6px] border ${showInternal ? 'border-accent text-accent' : 'border-border text-ink3 hover:text-ink2'}`}>
            {showInternal ? 'Hide' : 'Show'} default ({internalCount})
          </button>
        )}
      </div>
      <OfficeView agents={agents} activity={activity} running={running} waiting={waiting} showInternal={showInternal} />
    </div>
  );
}

// ─── List view: agents-by-state · live Work Kernel · common pool ──────────────
function Dashboard({ agents, activity, running }: { agents: Agent[]; activity: AppEvent[]; running: Set<string> }) {
  const [pool, setPool] = useState<PoolItem[]>([]);
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);
  const refreshPool = () => api.listPool().then(setPool).catch(() => {});
  useEffect(() => { refreshPool(); }, []);
  // refetch the pool when a pool/agent event lands on the bus
  useEffect(() => {
    const e = activity[0];
    if (e && (e.type.startsWith('pool.') || e.type.startsWith('agent.run.'))) refreshPool();
  }, [activity]);

  const sortedAgents = useMemo(() => [...agents].sort((a, b) => {
    const d = STATE_ORDER[stateOf(a, running)] - STATE_ORDER[stateOf(b, running)];
    return d !== 0 ? d : a.name.localeCompare(b.name);
  }), [agents, running]);

  const [dashSearch, setDashSearch] = useState('');
  const [dashFilter, setDashFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const dashAgents = sortedAgents;
  const bySearch = dashSearch ? dashAgents.filter((a) => a.name.toLowerCase().includes(dashSearch.toLowerCase())) : dashAgents;
  const dashFiltered = bySearch.filter((a) => (dashFilter === 'enabled' ? a.enabled : dashFilter === 'disabled' ? !a.enabled : true));
  const dashCounts = { all: bySearch.length, enabled: bySearch.filter((a) => a.enabled).length, disabled: bySearch.filter((a) => !a.enabled).length };
  const dashRegular = dashFiltered.filter((a) => !a.internal);
  const dashInternal = dashFiltered.filter((a) => a.internal);

  return (
    <div className="flex-1 flex min-h-0">
      {/* col 1: agents, styled like the Agents tab's sidebar */}
      <div className="w-[220px] flex-none border-r border-border bg-bg flex flex-col min-h-0">
        <div className="p-2.5 flex-none flex flex-col gap-2">
          <div className="flex items-center gap-1.5 h-7 px-2 rounded-[6px] bg-card border border-border">
            <Icon name="search" size={12} color="var(--color-ink3)" />
            <input value={dashSearch} onChange={(e) => setDashSearch(e.target.value)} placeholder="Search…" className="flex-1 bg-transparent outline-none text-[12px] text-ink" />
          </div>
          <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[6px] p-0.5">
            {(['all', 'enabled', 'disabled'] as const).map((k) => (
              <button key={k} type="button" onClick={() => setDashFilter(k)}
                className={`flex-1 h-[22px] rounded-[4px] text-[10.5px] capitalize flex items-center justify-center gap-1 ${dashFilter === k ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
                {k}<span className="opacity-70 text-[9px]">{dashCounts[k]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1 min-h-0">
          {dashFiltered.length === 0 && <div className="text-[12px] text-ink3 text-center py-6">{agents.length === 0 ? 'No agents yet' : 'No match'}</div>}
          <div>
            {dashRegular.map((a) => <DashAgentRow key={a.id} a={a} running={running} sel={openAgent?.id === a.id} onClick={() => setOpenAgent(a)} />)}
          </div>
          {dashInternal.length > 0 && (
            <div className="border-t border-border-soft mt-1 pt-1">
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-ink3 font-600">Default</div>
              {dashInternal.map((a) => <DashAgentRow key={a.id} a={a} running={running} sel={openAgent?.id === a.id} onClick={() => setOpenAgent(a)} />)}
            </div>
          )}
        </div>
      </div>

      {openAgent ? (
        <AgentRunsPanel agent={openAgent} onClose={() => setOpenAgent(null)} />
      ) : (
        <>
          {/* col 2: live Work Kernel — running/queued/dead work items + a raw WS frame log */}
          <KernelPanel agents={agents} onOpenAgent={setOpenAgent} />

          {/* col 3: common pool — post a task, assign it to an agent → runs on the Work Kernel */}
          <CommonPool agents={agents} pool={pool} onChange={refreshPool} />
        </>
      )}
    </div>
  );
}

function DashAgentRow({ a, running, sel, onClick }: { a: Agent; running: Set<string>; sel: boolean; onClick: () => void }) {
  const st = stateOf(a, running);
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left border-l-2 ${sel ? 'bg-accent-soft/40 border-accent' : 'border-transparent hover:bg-card/50'} ${!a.enabled ? 'opacity-60' : ''}`}>
      <span className={`w-[7px] h-[7px] rounded-full flex-none ${STATE_DOT[st]}`} />
      <span className={`flex-1 text-[12px] truncate ${sel ? 'text-ink font-500' : 'text-ink2'} ${!a.enabled ? 'italic' : ''}`}>{a.name}</span>
      {a.internal && <span className="font-mono text-[8px] text-ink3 border border-border rounded px-1">DEFAULT</span>}
      {a.surfaces.includes('chat') && <span className="font-mono text-[8px] text-accent border border-accent rounded px-1">CHAT</span>}
    </button>
  );
}

// ─── Common pool column ───────────────────────────────────────────────────────
function CommonPool({ agents, pool, onChange }: { agents: Agent[]; pool: PoolItem[]; onChange: () => void }) {
  const [posting, setPosting] = useState(false);
  const [need, setNeed] = useState('');

  // The describe box: the user says what they need in plain words; the Lead reads it, picks the
  // right teammate, and assigns it. No title/tags/priority — that triage is the Lead's job now.
  const post = async () => {
    if (!need.trim()) return;
    await api.createPoolItem({ description: need.trim() }).catch(() => {});
    setNeed(''); setPosting(false); onChange();
  };

  return (
    <div className="w-[330px] flex-none border-l border-border flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 h-9 flex-none border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-ink3 font-600">Common pool</span>
          <span className="text-[10px] font-mono text-ink3">{pool.filter((p) => p.status !== 'done').length}</span>
        </div>
        <button type="button" onClick={() => setPosting((v) => !v)} title="Describe a task — the Lead assigns it"
          className="flex items-center gap-1 text-[11.5px] text-ink2 border border-border rounded-[6px] px-2 py-0.5 hover:border-accent hover:text-accent">
          <Plus size={12} /> New task
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2.5">
        {posting && (
          <div className="rounded-[10px] border border-accent bg-accent-soft/20 p-3 flex flex-col gap-2">
            <textarea value={need} onChange={(e) => setNeed(e.target.value)} autoFocus
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post(); }}
              placeholder="What do you need? Describe it — the Lead picks the right assistant and gets it done." rows={3}
              className="px-2 py-1.5 rounded-[6px] border border-border bg-card text-ink text-[12.5px] outline-none resize-none" />
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] text-ink3">⌘↵ to post</span>
              <button type="button" onClick={post} disabled={!need.trim()} className="h-[28px] px-3 rounded-[6px] bg-accent text-white text-[12px] font-550 disabled:opacity-50">Post to pool</button>
            </div>
          </div>
        )}
        {pool.length === 0 && !posting && <div className="text-[12px] text-ink3 text-center py-10">Pool is empty.</div>}
        {pool.map((it) => <PoolCard key={it.id} item={it} agents={agents} onChange={onChange} />)}
      </div>
    </div>
  );
}

function PoolCard({ item, agents, onChange }: { item: PoolItem; agents: Agent[]; onChange: () => void }) {
  const assign = (agentId: string) => agentId && api.assignPoolItem(item.id, agentId).then(onChange).catch(() => {});
  const done = item.status === 'done';
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? id;
  return (
    <div className={`rounded-[11px] border p-3 ${done ? 'border-border bg-card/60 opacity-80' : 'border-border bg-card'}`}>
      <div className="flex items-start gap-2 mb-1.5">
        <span className={`text-[10px] font-700 px-1.5 py-0.5 rounded ${PRIO[item.priority]}`}>{item.priority}</span>
        <span className={`text-[13.5px] font-550 flex-1 ${done ? 'text-ink2 line-through' : 'text-ink'}`}>{item.title}</span>
      </div>
      {item.description && <p className="text-[12px] text-ink2 leading-relaxed mb-2 line-clamp-3">{item.description}</p>}
      {item.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {item.tags.map((t) => <span key={t} className="font-mono text-[10px] text-sidebar-ink3 bg-sidebar border border-sidebar-border rounded px-1.5 py-0.5">{t}</span>)}
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink3">{ago(item.createdAt)}</span>
        {item.status === 'waiting' ? (
          <div className="flex items-center gap-1.5">
            <select defaultValue="" onChange={(e) => assign(e.target.value)} title="Assign to agent"
              className="h-[26px] px-1.5 rounded-[6px] border border-border bg-card text-ink2 text-[11.5px] outline-none cursor-pointer">
              <option value="" disabled>Assign…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button type="button" title="Discard" onClick={() => api.deletePoolItem(item.id).then(onChange)} className="text-ink3 hover:text-rec"><Icon name="x" size={13} /></button>
          </div>
        ) : item.status === 'assigned' ? (
          <span className="flex items-center gap-1 text-[11px] text-accent-dark font-mono"><span className="an-pulse w-1.5 h-1.5 rounded-full bg-accent" />{agentName(item.assignedAgent)}</span>
        ) : (
          <span className="text-[11px] text-ok font-mono">✓ done · {agentName(item.assignedAgent)}</span>
        )}
      </div>
    </div>
  );
}

// ─── Team: card roster → hire flow → assistant profile ───────────────────────────────
type ManagerMode =
  | { kind: 'roster' }
  | { kind: 'profile'; agent: Agent }
  | { kind: 'hire' }
  | { kind: 'create'; draft: Partial<Agent> | null };  // blank/prefilled form ("tweak first" / manual)

function AgentsManager({ agents, activity, running, onRefreshAgents, onGoOffice, newSignal }: {
  agents: Agent[];
  activity: AppEvent[];
  running: Set<string>;
  onRefreshAgents: () => void;
  onGoOffice: () => void;
  newSignal: number;
}) {
  const [mode, setMode] = useState<ManagerMode>({ kind: 'roster' });
  const waiting = useWaitingSet(activity);

  // The header "Hire" button pings via this signal → open the wizard.
  useEffect(() => { if (newSignal) setMode({ kind: 'hire' }); }, [newSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep an open profile in sync with refreshed data (e.g. after save).
  const openAgent = mode.kind === 'profile' ? agents.find((a) => a.id === mode.agent.id) ?? mode.agent : null;

  const goRoster = () => setMode({ kind: 'roster' });

  if (mode.kind === 'roster') {
    return (
      <TeamRoster
        agents={agents} running={running} waiting={waiting}
        onOpen={(a) => setMode({ kind: 'profile', agent: a })}
        onHire={() => setMode({ kind: 'hire' })}
      />
    );
  }

  if (mode.kind === 'hire') {
    return (
      <HireWizard
        existingIds={agents.map((a) => a.id)}
        onCancel={goRoster}
        onTweak={(draft) => setMode({ kind: 'create', draft })}
        onHired={(a) => { onRefreshAgents(); announceHire(a); onGoOffice(); }}
      />
    );
  }

  // profile or create — both show a back bar + the form
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-5 h-9 flex-none border-b border-border-soft">
        <button type="button" onClick={goRoster} className="flex items-center gap-1.5 text-[12px] text-ink3 hover:text-ink2">
          <span className="rotate-180"><Icon name="arrowR" size={13} /></span> Team
        </button>
        <span className="text-ink3 text-[12px]">/</span>
        <span className="text-[12px] text-ink2">{mode.kind === 'create' ? 'New assistant' : openAgent?.name}</span>
      </div>
      {mode.kind === 'create' ? (
        <AgentForm
          key={mode.draft ? 'draft' : 'blank'}
          agent={(mode.draft as Agent) ?? null}
          isNew
          onSaved={(a) => { onRefreshAgents(); announceHire(a); onGoOffice(); }}
          onDeleted={goRoster}
        />
      ) : openAgent ? (
        <AgentForm
          key={openAgent.id}
          agent={openAgent}
          onSaved={() => onRefreshAgents()}
          onDeleted={() => { onRefreshAgents(); goRoster(); }}
        />
      ) : null}
    </div>
  );
}

