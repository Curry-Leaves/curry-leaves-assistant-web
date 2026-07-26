import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import { useEvents } from '../../hooks/useEvents';
import { subChat } from '../../api/socket';
import { Icon } from '../../components/chrome/Icon';
import { FallingLeaves } from '../../components/FallingLeaves';
import { Markdown } from '../../components/Markdown';
import dashBg from '../../assets/icons/dash_bg.png';
import dashBg1 from '../../assets/icons/dash_bg_1.png';
import type { PendingInput as PendingInputRec } from '../../api/agents';
import type { Agent, AppEvent, PoolItem, Reminder, Tile, Todo } from '../../types';

/** The Agent Desk: the dashboard's default view and the page the user lands on every
 *  launch. A dark hero banner (greeting, live clock, clickable pipeline stats, review
 *  nudge) with an expanding composer straddling its lower edge; beneath it three working
 *  cards — your asks, to-dos, reminders — that swap for a full split (list + detail) or
 *  board view of every ask, and a Dashboards card of the freshest board tiles.
 *  All colors come from theme tokens (the hero is a fixed dark surface by design). */

// Desk statuses: the pool's waiting/assigned/done, with two overlays — an assigned ask
// whose assistant suspended with agent.run.needs_input shows as "Needs input", and done
// splits by whether the user has reviewed the result ("seen"; explicit, not implicit).
type DeskStatus = 'waiting' | 'assigned' | 'input' | 'review' | 'delivered';
const DESK: Record<DeskStatus, { label: string; dot: string; text: string; rail: string }> = {
  waiting: { label: 'Queued', dot: 'bg-faint', text: 'text-ink3', rail: 'bg-faint' },
  assigned: { label: 'In progress', dot: 'an-pulse bg-accent', text: 'text-accent-dark', rail: 'bg-accent' },
  input: { label: 'Needs input', dot: 'an-pulse bg-orange', text: 'text-orange', rail: 'bg-orange' },
  review: { label: 'Needs review', dot: 'bg-blue', text: 'text-blue', rail: 'bg-blue' },
  delivered: { label: 'Delivered', dot: 'bg-ok', text: 'text-ok', rail: 'bg-border' },
};
const PRI_LABEL: Record<string, string> = { P1: 'HIGH', P2: 'NORMAL', P3: 'LOW' };
const PRI_TEXT: Record<string, string> = { P1: 'text-rec', P2: 'text-ink3', P3: 'text-faint' };
const ASK_TYPES = ['Task', 'Analysis', 'Monitor', 'Dashboard'];
const STARTERS = [
  'Summarize this week’s meetings',
  'What did I promise people this week?',
  'Alert me when something needs my attention',
];

function ago(iso?: string | null) {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// ─── My Day: reading the raw event feed into a human timeline ──────────────────
// The activity log (/events/recent) is a typed, timestamped stream — the spine of "what
// happened". Here we turn each event into one plain-language line with an icon and an
// accent, filtered to a single day. Noise (pure-UI mirror signals, run lifecycle chatter
// that would drown the feed) is dropped so the timeline reads like a diary, not a log.
type DayKind = 'ask' | 'done' | 'todo' | 'reminder' | 'capture' | 'knowledge' | 'agent' | 'alert';
const DAY_STYLE: Record<DayKind, { icon: string; dot: string }> = {
  ask: { icon: 'send', dot: 'bg-accent' },
  done: { icon: 'check', dot: 'bg-ok' },
  todo: { icon: 'steps', dot: 'bg-blue' },
  reminder: { icon: 'bell', dot: 'bg-orange' },
  capture: { icon: 'mic', dot: 'bg-rec' },
  knowledge: { icon: 'brain', dot: 'bg-accent' },
  agent: { icon: 'bot', dot: 'bg-orange' },
  alert: { icon: 'warning', dot: 'bg-rec' },
};

type DayEntry = { id: string; at: string; kind: DayKind; text: string };

// My Day is a diary of what *you* did and what came back for you — not a system log. So this
// is a strict allowlist of the handful of event types that are meaningful to a person:
// the asks you posted and their results, captures, to-dos, reminders, knowledge you added,
// and the moments an assistant needs you. EVERYTHING else — agent-run lifecycle churn (every
// sub-agent starting/finishing), learn signals, job refusals/dead-lettering, routing, tile
// refreshes, pure-UI mirror signals — is internal plumbing and is dropped. A person reading
// this should see their day, not the engine's.
//
// Each mapping either shows a fixed phrase, or a phrase + the event's label as a quoted
// detail (title of the ask, the reminder text, …). We never mash the label onto the verb.
const DAY_MAP: Record<string, { kind: DayKind; verb: string; detail: boolean }> = {
  'pool.item.created':   { kind: 'ask',       verb: 'Asked the team',            detail: true },
  'pool.item.done':      { kind: 'done',      verb: 'Got a result back',         detail: true },
  'todo.created':        { kind: 'todo',      verb: 'Added a to-do',             detail: true },
  'todo.completed':      { kind: 'done',      verb: 'Checked off a to-do',       detail: true },
  'reminder.created':    { kind: 'reminder',  verb: 'Set a reminder',            detail: true },
  'reminder.due':        { kind: 'reminder',  verb: 'Reminder came due',         detail: true },
  'recording.finalized': { kind: 'capture',   verb: 'Captured a recording',      detail: true },
  'recording.summarized':{ kind: 'capture',   verb: 'Summarised a capture',      detail: true },
  'knowledge.ingested':  { kind: 'knowledge', verb: 'Saved to your knowledge',   detail: true },
  'agent.run.needs_input': { kind: 'agent',   verb: 'An assistant needs you',    detail: true },
  'tile.alert.raised':   { kind: 'alert',     verb: 'A board raised an alert',   detail: true },
};

// Map one raw event → a timeline line, or null to drop it. Only allowlisted types survive.
function toDayEntry(e: AppEvent): DayEntry | null {
  const m = DAY_MAP[e.type];
  if (!m) return null;
  const label = (e.label || '').trim();
  // "Verb — detail" when the event carries a readable label; just the verb otherwise.
  const text = m.detail && label ? `${m.verb} — ${label}` : m.verb;
  return { id: e.id, at: e.occurredAt, kind: m.kind, text };
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayHhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

// "Seen" — which finished asks the user has explicitly reviewed. localStorage so
// "Needs review" survives a reload; pruned to live ids so it can't grow forever.
const SEEN_KEY = 'cl.desk.seenAsks';
function loadSeen(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}
function saveSeen(seen: Set<string>, liveIds: Set<string>) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].filter((id) => liveIds.has(id)))); } catch { /* private mode */ }
}

type RecentTile = { tile: Tile; boardId: string; boardName: string };
type Filter = 'all' | DeskStatus;

export function InboxView({ agents, onOpenBoards, onOpenAssistants, search, onSearch }: {
  agents: Agent[];
  /** Jump to the Boards view, optionally landing on a specific board. */
  onOpenBoards: (boardId?: string) => void;
  /** Jump to the Assistants screen — where a needs-input run is answered. */
  onOpenAssistants?: () => void;
  /** The header search (owned by DashboardScreen's nav bar) filters the ask list. */
  search: string;
  onSearch: (s: string) => void;
}) {
  const [pool, setPool] = useState<PoolItem[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [recent, setRecent] = useState<RecentTile[]>([]);
  const [seen, setSeen] = useState<Set<string>>(loadSeen);
  // Split view (list + detail) replaces the three cards while open.
  const [splitOpen, setSplitOpen] = useState(false);
  // On narrow layouts My Day collapses to an icon; clicking it expands over the
  // to-dos/reminders/dashboards trio. On wide (xl) layouts there's room for its own row,
  // so it's always shown there and this flag is ignored.
  const [dayOpen, setDayOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Typing in the header search jumps straight into the filtered list.
  useEffect(() => { if (search.trim()) { setSplitOpen(true); setView('list'); } }, [search]);
  // Composer — state lives here so "Ask a follow-up" can prefill it from the detail pane.
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [askType, setAskType] = useState('Task');
  const [askPri, setAskPri] = useState('P2');
  // How the assigned run handles approvals: 'auto' runs headless (today's default), 'ask'
  // pauses for your go-ahead on risky steps. Remembered per device so your preference sticks.
  const [askMode, setAskMode] = useState<'auto' | 'ask'>(() => {
    try { return localStorage.getItem('cl.desk.askMode') === 'ask' ? 'ask' : 'auto'; } catch { return 'auto'; }
  });
  const setAskModePersist = (m: 'auto' | 'ask') => { setAskMode(m); try { localStorage.setItem('cl.desk.askMode', m); } catch { /* private */ } };
  const [posting, setPosting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // For the greeting — same identity the lock screen welcomes you by.
  const [who, setWho] = useState('');
  useEffect(() => { api.authStatus().then((s) => setWho(s.identityName || '')).catch(() => {}); }, []);

  // Unanswered questions from suspended runs, fetched from the durable /pending-inputs
  // records (not derived from the activity feed), so they survive reloads and outlive the
  // feed. Each record carries the jobId, the question frame, and — when known — the pool
  // item it concerns, so the question pins to the right ask row (including the Lead's
  // triage clarifications about a still-queued ask).
  const [pendingInputs, setPendingInputs] = useState<PendingInputRec[]>([]);
  const refreshPending = useCallback(() => {
    api.listPendingInputs().then(setPendingInputs).catch(() => {});
  }, []);
  const pendingFor = useCallback((it: PoolItem): PendingInputRec | undefined =>
    pendingInputs.find((r) => r.poolItemId === it.id)
      ?? (it.assignedAgent ? pendingInputs.find((r) => r.agentId === it.assignedAgent) : undefined),
    [pendingInputs]);

  const refreshPool = useCallback(() => { api.listPool().then(setPool).catch(() => {}); }, []);
  const refreshTodos = useCallback(() => { api.listTodos().then(setTodos).catch(() => {}); }, []);
  const refreshReminders = useCallback(() => { api.listReminders().then(setReminders).catch(() => {}); }, []);

  // The raw activity feed behind the "My Day" tile. Pulled once (newest-first, capped) and
  // then kept live by the same event stream that drives the cards — every incoming event is
  // prepended, so the timeline updates in place without a refetch.
  const [activity, setActivity] = useState<AppEvent[]>([]);
  const refreshActivity = useCallback(() => { api.recentEvents(300).then(setActivity).catch(() => {}); }, []);

  // The freshest board tiles, across every board. Tiles don't carry a createdAt, so
  // "recent" is by last run — a tile that has never produced anything sorts last.
  const refreshTiles = useCallback(async () => {
    const boards = await api.listBoards().catch(() => []);
    const full = await Promise.all(boards.map((b) => api.getBoard(b.id).catch(() => null)));
    const all: RecentTile[] = [];
    for (const b of full) if (b) for (const t of b.tiles) all.push({ tile: t, boardId: b.id, boardName: b.name });
    all.sort((a, b) => (Date.parse(b.tile.state.lastRunAt ?? '') || 0) - (Date.parse(a.tile.state.lastRunAt ?? '') || 0));
    setRecent(all.slice(0, 8));  // the card scrolls, so it can hold a few more than the old rail
  }, []);

  useEffect(() => { refreshPool(); refreshTodos(); refreshReminders(); refreshTiles(); refreshPending(); refreshActivity(); },
    [refreshPool, refreshTodos, refreshReminders, refreshTiles, refreshPending, refreshActivity]);

  // Primarily event-driven: each live event refetches only the collections it touches.
  useEvents((raw) => {
    const e = raw as AppEvent;
    if (e.type === '__reconnect__') { refreshPool(); refreshTodos(); refreshReminders(); refreshTiles(); refreshPending(); refreshActivity(); return; }
    if (e.type.startsWith('agent.run.')) refreshPending();
    if (e.type.startsWith('pool.') || e.type.startsWith('agent.run.')) refreshPool();
    if (e.type.startsWith('todo.')) refreshTodos();
    if (e.type.startsWith('reminder.')) refreshReminders();
    if (e.type === 'tile.run.completed' || e.type === 'tile.run.failed') refreshTiles();
    // Feed the "My Day" timeline live: prepend the event (deduped), keeping it newest-first
    // and capped so it can't grow unbounded across a long session.
    if (e.id && e.occurredAt) setActivity((a) => (a.some((x) => x.id === e.id) ? a : [e, ...a].slice(0, 500)));
  });

  // Self-healing safety net for the pool. The Lead assigns an ask headlessly and the desk
  // relies on the pool.item.assigned event to flip it from Queued → In progress; if that
  // event is ever missed (socket reconnect, listener mounted a beat late, event fired
  // before we subscribed), the ask would sit on a stale "waiting" with the Assign dropdown
  // even though a worker is already on it. So while ANY ask is still open (not done), poll
  // the pool every few seconds to converge. Stops entirely once everything is delivered, so
  // an idle desk does no polling.
  const hasOpen = pool.some((p) => p.status !== 'done');
  useEffect(() => {
    if (!hasOpen) return;
    const t = setInterval(() => { refreshPool(); refreshPending(); }, 4000);
    return () => clearInterval(t);
  }, [hasOpen, refreshPool, refreshPending]);

  const statusOf = useCallback((it: PoolItem): DeskStatus =>
    it.status === 'done' ? (seen.has(it.id) ? 'delivered' : 'review')
      : pendingFor(it) ? 'input'
        : it.status, [seen, pendingFor]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: pool.length, waiting: 0, assigned: 0, input: 0, review: 0, delivered: 0 };
    for (const it of pool) c[statusOf(it)]++;
    return c;
  }, [pool, statusOf]);

  const q = search.trim().toLowerCase();
  const visible = useMemo(() => pool
    .filter((it) => !q || `${it.title} ${it.description}`.toLowerCase().includes(q))
    .filter((it) => filter === 'all' || statusOf(it) === filter), [pool, q, filter, statusOf]);

  const firstReview = pool.find((it) => statusOf(it) === 'review');
  const selected = (selectedId ? pool.find((p) => p.id === selectedId) : null) ?? visible[0] ?? null;

  const markReviewed = (id: string) => {
    setSeen((s) => {
      const next = new Set(s).add(id);
      saveSeen(next, new Set(pool.map((p) => p.id)));
      return next;
    });
  };

  const openComposerWith = (text: string) => {
    setComposerOpen(true);
    setDraft(text);
    setTimeout(() => taRef.current?.focus(), 50);
  };

  const post = async () => {
    if (!draft.trim() || posting) return;
    setPosting(true);
    const created = await api.createPoolItem({
      description: draft.trim(), tags: [askType.toLowerCase()], priority: askPri, autonomy: askMode,
    }).catch(() => null);
    setPosting(false);
    setDraft('');
    setComposerOpen(false);
    // Optimistically prepend before refetching so selection can't race the refetch.
    if (created) { setPool((p) => [created, ...p]); setSelectedId(created.id); setSplitOpen(true); setFilter('all'); setView('list'); }
    refreshPool();
  };

  const openAsk = (id: string) => { setSelectedId(id); setSplitOpen(true); setView('list'); };

  // Escape backs out of the split view (unless typing).
  useEffect(() => {
    if (!splitOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
      if (e.key === 'Escape' && !typing) setSplitOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [splitOpen]);

  return (
    <div className="flex-1 flex min-h-0">
      {/* main column — a flex stack so the cards fill whatever height remains */}
      <div className="flex-1 min-w-0 overflow-y-auto flex flex-col">
        <Hero who={who} counts={counts} activeFilter={filter}
          onPickStat={(k) => { setFilter((f) => (f === k ? 'all' : k)); setSplitOpen(true); setView('list'); }}
          reviewCount={counts.review}
          onReview={() => { setFilter('review'); setSplitOpen(true); setView('list'); if (firstReview) setSelectedId(firstReview.id); }}
          onRespond={() => {
            setFilter('input'); setSplitOpen(true); setView('list');
            const first = pool.find((it) => statusOf(it) === 'input');
            if (first) setSelectedId(first.id);
          }} />

        {/* the desk surface below the hero — the login pane's dotted paper texture plus a
            soft accent glow bleeding down from the hero, purely decorative */}
        <div className="page-leaf-corner flex-1 min-h-0 flex flex-col relative">
          <div className="lp-dots pointer-events-none absolute inset-0 opacity-45" />
          <div className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(75% 55% at 50% 0%, color-mix(in oklch, var(--color-accent) 7%, transparent) 0%, transparent 62%)' }} />

        {/* the composer straddles the hero's bottom edge — kept at a comfortable reading width */}
        <div className="w-full max-w-[1100px] mx-auto px-6 -mt-[30px] relative z-10 flex-none">
          <Composer open={composerOpen} draft={draft} askType={askType} askPri={askPri} askMode={askMode} posting={posting}
            agents={agents} taRef={taRef}
            onOpen={() => openComposerWith(draft)} onDraft={setDraft} onType={setAskType} onPri={setAskPri} onMode={setAskModePersist} onPost={post}
            onCollapse={() => setComposerOpen(false)} />
        </div>

        <div className="w-full max-w-[1600px] mx-auto px-6 py-4 flex-1 min-h-[380px] flex flex-col relative">
          {splitOpen ? (
            <SplitView pool={pool} visible={visible} selected={selected} agents={agents} counts={counts}
              filter={filter} view={view} statusOf={statusOf}
              onFilter={setFilter} onView={setView} onSelect={setSelectedId}
              onClose={() => { setSplitOpen(false); onSearch(''); }} onChange={refreshPool}
              onReviewed={markReviewed} onFollowUp={(it) => openComposerWith(`Follow-up on "${it.title}": `)}
              onOpenAssistants={onOpenAssistants}
              pendingInput={selected ? pendingFor(selected) : undefined} />
          ) : (
            // Your asks is the primary card — two units of width; the three secondary cards
            // share the rest, one unit each. Responsive:
            //  · xl → one full-height row (2fr·1fr·1fr·1fr).
            //  · md → 2-col grid, asks spanning both columns above the trio; rows auto-size
            //         to their content and the whole column scrolls (no fixed height, or the
            //         stacked rows would collapse and overlap).
            //  · below md → a single stacked column.
            // The My Day icon lives in the Asks header and is always available: clicking it
            // swaps the to-dos/reminders/dashboards trio out for the timeline in their space
            // (all three columns), and clicking again — or its close — brings the trio back.
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-[2fr_1fr_1fr_1fr]
              xl:flex-1 xl:min-h-0 xl:items-stretch xl:[&>*]:min-h-0
              [&>*]:min-h-[280px] xl:[&>*]:min-h-0">
              <div className="md:col-span-2 xl:col-span-1 min-w-0 flex">
                <AsksCard pool={pool} statusOf={statusOf} onOpen={(id) => openAsk(id)} onViewAll={() => { setFilter('all'); setSplitOpen(true); }} onReviewed={markReviewed}
                  dayOpen={dayOpen} onToggleDay={() => setDayOpen((o) => !o)} />
              </div>
              {dayOpen ? (
                <div className="md:col-span-2 xl:col-span-3 min-w-0 flex">
                  <MyDayCard activity={activity} who={who} onClose={() => setDayOpen(false)} />
                </div>
              ) : (
                <>
                  <TodosCard todos={todos} onChange={refreshTodos} />
                  <RemindersCard reminders={reminders} onChange={refreshReminders} />
                  <DashboardsCard recent={recent} onOpen={onOpenBoards} />
                </>
              )}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hero backdrop: user-selectable, remembered per browser ───────────────────
// All variants sit on the same fixed dark base (not theme ink, which inverts on dark
// themes); tints are mixed from the theme accent so every choice tracks the theme. `photo`
// is the shipped dash_bg image with a legibility scrim + accent wash layered over it.
type HeroBg = 'photo' | 'photo2' | 'leaves' | 'ember' | 'aurora' | 'plain';
// v2: bumped so an earlier saved choice (from before Photo existed) resets to the new
// default once — the picker still overrides it from there.
const HERO_BG_KEY = 'cl.desk.heroBg.v2';
const HERO_BGS: { id: HeroBg; label: string }[] = [
  { id: 'photo', label: 'Photo' },
  { id: 'photo2', label: 'Photo 2' },
  { id: 'leaves', label: 'Falling leaves' },
  { id: 'ember', label: 'Ember glow' },
  { id: 'aurora', label: 'Aurora' },
  { id: 'plain', label: 'Plain dark' },
];
// Bottom→top: base ink · the photo · a left-heavy dark scrim so the greeting/stats stay
// legible over any part of the image · a faint accent wash to tie it to the theme.
const photoLayers = (url: string) =>
  `linear-gradient(105deg, rgba(20,16,12,0.55) 0%, rgba(20,16,12,0.28) 50%, rgba(20,16,12,0.12) 100%), ` +
  `radial-gradient(circle at 88% 8%, color-mix(in oklch, var(--color-accent) 20%, transparent) 0%, transparent 48%), ` +
  `url(${url}) center/cover no-repeat, #1c1a17`;
// The non-photo backdrops sit on the theme-aware --color-hero base with accent/blue washes
// mixed from the theme tokens, so every one harmonizes with the active theme (emerald on
// default, near-black on light themes, deep blues on midnight, etc.). Photo backdrops
// ignore --color-hero — they carry their own dark scrim for legibility over the image.
const HERO_BG_CSS: Record<HeroBg, string> = {
  photo: photoLayers(dashBg),
  photo2: photoLayers(dashBg1),
  leaves: 'radial-gradient(80% 70% at 50% 0%, color-mix(in oklch, var(--color-accent) 22%, transparent) 0%, transparent 60%), var(--color-hero)',
  ember: 'radial-gradient(circle at 88% 8%, color-mix(in oklch, var(--color-accent) 32%, transparent) 0%, transparent 46%), var(--color-hero)',
  aurora: 'radial-gradient(55% 70% at 10% 0%, color-mix(in oklch, var(--color-accent) 30%, transparent) 0%, transparent 62%), radial-gradient(55% 70% at 90% 0%, color-mix(in oklch, var(--color-blue) 28%, transparent) 0%, transparent 62%), var(--color-hero)',
  plain: 'var(--color-hero)',
};
function loadHeroBg(): HeroBg {
  const v = localStorage.getItem(HERO_BG_KEY) as HeroBg | null;
  return v && HERO_BGS.some((b) => b.id === v) ? v : 'photo';
}

// ─── Hero: dark banner with live clock + clickable pipeline stats ─────────────
function Hero({ who, counts, activeFilter, onPickStat, reviewCount, onReview, onRespond }: {
  who: string;
  counts: Record<Filter, number>;
  activeFilter: Filter;
  onPickStat: (k: DeskStatus) => void;
  reviewCount: number;
  onReview: () => void;
  onRespond: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const [bg, setBg] = useState<HeroBg>(loadHeroBg);
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  // The menu is portaled to <body> (so the hero's overflow-clip + the composer that
  // straddles the hero's bottom edge can't hide it); this anchors it under the button.
  const bgBtnRef = useRef<HTMLButtonElement>(null);
  const [bgMenuPos, setBgMenuPos] = useState<{ top: number; right: number } | null>(null);
  const pickBg = (id: HeroBg) => {
    setBg(id);
    setBgPickerOpen(false);
    try { localStorage.setItem(HERO_BG_KEY, id); } catch { /* private mode */ }
  };
  const toggleBgPicker = () => {
    setBgPickerOpen((o) => {
      const next = !o;
      if (next && bgBtnRef.current) {
        const r = bgBtnRef.current.getBoundingClientRect();
        setBgMenuPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
      }
      return next;
    });
  };
  useEffect(() => {
    if (!bgPickerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBgPickerOpen(false); };
    // Reposition/close on scroll or resize so the portaled menu tracks the button.
    const onReflow = () => setBgPickerOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [bgPickerOpen]);
  const h = now.getHours();
  const hello = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const clock = now.toLocaleTimeString('en-GB', { hour12: false });
  const date = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

  const cells: { key: DeskStatus; dot: string }[] = [
    { key: 'waiting', dot: 'bg-current opacity-40' },  // current = hero-ink, so it reads on any hero
    { key: 'assigned', dot: 'an-pulse bg-accent' },
    { key: 'review', dot: 'bg-blue' },
    { key: 'delivered', dot: 'bg-ok' },
  ];

  // Photo backdrops always want light text (over their dark scrim); the non-photo backdrops
  // sit on the theme-aware --color-hero, so their text uses the matching hero-ink token —
  // white on the dark hero themes, but still light enough on the light themes' rich banner.
  // Over the photos the text is pure white + bold + shadowed (see heroTextShadow / the
  // font-weight bumps below) because both shipped photos are bright/busy on the left where
  // this text sits, and a plain scrim alone doesn't fully carry it.
  const isPhoto = bg === 'photo' || bg === 'photo2';
  const heroInk = isPhoto ? '#ffffff' : 'var(--color-hero-ink)';
  const heroDim = isPhoto ? 'rgba(255,255,255,0.90)' : 'var(--color-hero-ink-dim)';
  // A dark halo so white text stays crisp over the bright flowers / signage in the
  // photos; empty on the non-photo heroes (their flat --color-hero base needs no help).
  const heroTextShadow = isPhoto
    ? '0 1px 3px rgba(0,0,0,0.9), 0 0 14px rgba(0,0,0,0.55), 0 0 4px rgba(0,0,0,0.7)'
    : undefined;

  return (
    // Responsive height: scales with the viewport (28vh) but clamped so it never gets too
    // short or eats the desk — so the photo shows a proportional slice at any window size,
    // not a fixed thin band. Content is a flex column that fills that height. Extra bottom
    // room leaves space for the composer, which straddles the lower edge (-mt below).
    <div className="relative flex flex-col justify-center pt-8 pb-20"
      style={{ color: heroInk, textShadow: heroTextShadow, minHeight: 'clamp(190px, 28vh, 300px)' }}>
      {/* Background + decorative bleed live on their own clipped layer so the hero's
          content (esp. the backdrop-picker dropdown) can overflow the bottom edge.
          Previously overflow-hidden sat on the root and swallowed the open menu, and
          the composer (a later, z-10 sibling) painted over what wasn't clipped. */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true"
        style={{ background: HERO_BG_CSS[bg] }}>
        {bg === 'leaves' && <FallingLeaves />}
      </div>
      <div className="w-full max-w-[1100px] mx-auto px-6 relative">
        <div className="flex items-start gap-5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-[9px] font-mono text-[9.5px] font-600 uppercase tracking-wider" style={{ color: heroDim }}>
              <span className="an-pulse w-[6px] h-[6px] rounded-full bg-accent" /> Agent desk · Live
            </div>
            <h1 className={`m-0 font-serif text-[26px] leading-[1.15] ${isPhoto ? 'font-bold' : ''}`}>{hello}{who ? `, ${who}` : ''}</h1>
          </div>
          {/* backdrop picker — the choice is remembered on this device */}
          <div className="relative flex-none mt-0.5">
            {/* Sits over a bright photo, so it carries its own dark glass chip + ring +
                drop-shadow to stay visible regardless of the backdrop behind it. */}
            <button ref={bgBtnRef} type="button" title="Change the banner backdrop" onClick={toggleBgPicker}
              style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.45)' }}
              className={`w-7 h-7 grid place-items-center rounded-[8px] backdrop-blur-sm transition-colors ${
                bgPickerOpen
                  ? 'bg-white/25 ring-1 ring-white/60 text-white'
                  : 'bg-black/35 ring-1 ring-white/40 text-white/90 hover:bg-white/25 hover:text-white hover:ring-white/60'}`}>
              <Icon name="leaf" size={13} />
            </button>
            {/* Portaled to <body> at fixed coords: escapes the hero's overflow-clip and
                the composer straddling the hero's bottom edge, so it always sits on top. */}
            {bgPickerOpen && bgMenuPos && createPortal(
              <>
                <div className="fixed inset-0 z-[80]" onMouseDown={() => setBgPickerOpen(false)} />
                <div className="fixed z-[81] w-[170px] rounded-[11px] border border-white/12 bg-[#26201b] shadow-pop p-1.5"
                  style={{ top: bgMenuPos.top, right: bgMenuPos.right }}>
                  <div className="px-2 pt-1 pb-1.5 font-mono text-[9px] font-600 uppercase tracking-wider text-white/45">Backdrop</div>
                  {HERO_BGS.map((b) => (
                    <button key={b.id} type="button" onClick={() => pickBg(b.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-[7px] text-left text-[12.5px] ${
                        bg === b.id ? 'text-white bg-white/10' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'}`}>
                      <span className="flex-1">{b.label}</span>
                      {bg === b.id && <Icon name="check" size={13} />}
                    </button>
                  ))}
                </div>
              </>,
              document.body,
            )}
          </div>
          <div className="text-right flex-none hidden sm:block">
            <div className={`font-mono text-[26px] tracking-tight leading-none tabular-nums ${isPhoto ? 'font-700' : ''}`}>{clock}</div>
            <div className="mt-2 font-mono text-[10px] tracking-wider uppercase whitespace-nowrap" style={{ color: heroDim }}>{date}</div>
          </div>
        </div>

        {/* the stat strip doubles as a filter: click a cell to see just those asks. Cells
            sit on a translucent dark wash over the hero so they read on any backdrop —
            a photo, or a light/dark theme hero — without a hardcoded base color. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px mt-3.5 rounded-[10px] overflow-hidden bg-black/20">
          {cells.map((c) => (
            <button key={c.key} type="button" onClick={() => onPickStat(c.key)}
              className={`min-w-0 text-left px-[11px] pt-2 pb-[9px] cursor-pointer ${
                activeFilter === c.key ? 'bg-black/30' : 'bg-black/25 hover:bg-black/15'}`}>
              <div className="flex items-baseline gap-[7px]">
                {/* a needs-input ask is still in flight, so it counts as In progress here */}
                <span className={`font-mono text-[19px] tabular-nums ${isPhoto ? 'font-700' : 'font-500'}`} style={{ color: heroInk }}>
                  {c.key === 'assigned' ? counts.assigned + counts.input : counts[c.key]}
                </span>
                <span className={`w-[5px] h-[5px] rounded-full ${c.dot}`} />
              </div>
              <div className="mt-1 font-mono text-[9.5px] font-600 uppercase tracking-wider truncate" style={{ color: heroDim }}>{DESK[c.key].label}</div>
            </button>
          ))}
        </div>

        {counts.input > 0 && (
          <div className="mt-3 flex items-center gap-[11px] text-[13px]" style={{ color: heroDim }}>
            <span className="an-pulse w-[6px] h-[6px] rounded-full bg-orange flex-none" />
            {counts.input === 1 ? 'An assistant is waiting on your input.' : `${counts.input} assistants are waiting on your input.`}
            <button type="button" onClick={onRespond} style={{ color: heroInk }}
              className="flex-none flex items-center gap-1.5 h-[25px] px-2.5 rounded-full border border-orange/60 text-[12px] font-600 hover:bg-orange hover:border-orange hover:text-white whitespace-nowrap">
              Respond <Icon name="arrowR" size={12} />
            </button>
          </div>
        )}
        {reviewCount > 0 && (
          <div className="mt-3 flex items-center gap-[11px] text-[13px]" style={{ color: heroDim }}>
            {reviewCount === 1 ? '1 ask is finished and waiting on your review.' : `${reviewCount} asks are finished and waiting on your review.`}
            <button type="button" onClick={onReview} style={{ color: heroInk, borderColor: heroDim }}
              className="flex-none flex items-center gap-1.5 h-[25px] px-2.5 rounded-full border text-[12px] font-600 hover:bg-accent hover:border-accent hover:text-white whitespace-nowrap">
              Review now <Icon name="arrowR" size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Composer: collapsed bar → expanding ask form ─────────────────────────────
// Same contract as ⌘K → "New task": the description is the ask; type rides along as a
// tag and priority as P1/P2/P3, both of which the Lead and the pool understand.
function Composer({ open, draft, askType, askPri, askMode, posting, agents, taRef, onOpen, onDraft, onType, onPri, onMode, onPost, onCollapse }: {
  open: boolean; draft: string; askType: string; askPri: string; askMode: 'auto' | 'ask'; posting: boolean; agents: Agent[];
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  onOpen: () => void; onDraft: (v: string) => void; onType: (v: string) => void; onPri: (v: string) => void; onMode: (m: 'auto' | 'ask') => void; onPost: () => void;
  /** Collapse back to the one-line bar (click-outside / Escape) — only when nothing's typed. */
  onCollapse: () => void;
}) {
  const ready = `${agents.length} assistant${agents.length === 1 ? '' : 's'} ready`;
  const boxRef = useRef<HTMLDivElement | null>(null);
  // While expanded and empty, a click anywhere outside the composer — or Escape — collapses it
  // back to the bar. We never auto-collapse with a draft in progress: that would throw away
  // what the user typed. (A non-empty draft still collapses via Escape below, but only after
  // an explicit keypress, not a stray outside click.)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (draft.trim()) return;                       // keep unsaved text safe
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onCollapse();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCollapse(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, draft, onCollapse]);
  return (
    <div ref={boxRef} className="rounded-[13px] border border-border bg-card shadow-soft overflow-hidden">
      {!open ? (
        <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
          className="flex items-center gap-3 pl-4 pr-3 py-2.5 cursor-text">
          <span className="flex-1 min-w-0 text-[13.5px] text-ink3 truncate">Ask the team to do, analyse, or monitor something…</span>
          <span className="flex-none font-mono text-[9.5px] uppercase tracking-wider text-ink3">{ready}</span>
          <span className="flex-none h-[30px] px-3.5 rounded-[8px] bg-accent text-white text-[12.5px] font-550 grid place-items-center">New ask</span>
        </div>
      ) : (
        <>
          <textarea ref={taRef} rows={2} value={draft} onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onPost(); }}
            placeholder="Ask the team to do, analyse, or monitor something…"
            className="w-full block px-4 pt-3.5 pb-1.5 bg-transparent text-ink text-[14px] leading-relaxed outline-none resize-none placeholder:text-ink3" />
          {!draft.trim() && (
            <div className="flex items-center gap-1.5 px-4 pb-3 flex-wrap">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink3 mr-0.5">try</span>
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => { onDraft(s); taRef.current?.focus(); }}
                  className="h-[25px] px-2.5 rounded-full border border-border-soft bg-bg text-[12px] font-500 text-ink2 hover:border-accent hover:text-accent">
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-border-soft flex-wrap">
            <select value={askType} onChange={(e) => onType(e.target.value)}
              className="h-[28px] px-2 rounded-[7px] border border-border bg-bg text-[12px] font-500 text-ink2 outline-none cursor-pointer">
              {ASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="flex gap-0.5 p-0.5 rounded-[8px] border border-border bg-bg">
              {(['P3', 'P2', 'P1'] as const).map((p) => (
                <button key={p} type="button" onClick={() => onPri(p)}
                  className={`h-[24px] px-2.5 rounded-[6px] text-[11.5px] font-600 capitalize ${
                    askPri === p ? 'bg-accent text-white' : 'text-ink3'}`}>
                  {PRI_LABEL[p].charAt(0) + PRI_LABEL[p].slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            {/* Autonomy: Auto runs headless; Ask pauses the assigned run for your go-ahead on
                risky steps (it lands on the desk as "Needs input"). */}
            <div className="flex gap-0.5 p-0.5 rounded-[8px] border border-border bg-bg"
              title={askMode === 'auto' ? 'Auto: the team runs it without stopping for approvals' : 'Ask: pauses for your go-ahead before risky steps'}>
              {(['auto', 'ask'] as const).map((m) => (
                <button key={m} type="button" onClick={() => onMode(m)}
                  className={`h-[24px] px-2.5 rounded-[6px] text-[11.5px] font-600 capitalize flex items-center gap-1 ${
                    askMode === m ? 'bg-accent text-white' : 'text-ink3'}`}>
                  <Icon name={m === 'auto' ? 'zap' : 'bell'} size={11} /> {m === 'auto' ? 'Auto' : 'Ask'}
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <span className="font-mono text-[10px] text-ink3">{ready}</span>
            <button type="button" onClick={onPost} disabled={!draft.trim() || posting}
              className="h-[30px] px-3.5 rounded-[8px] bg-accent text-white text-[12.5px] font-550 disabled:opacity-40 flex items-center gap-1.5">
              {posting ? 'Posting…' : 'Post to team'} <span className="font-mono opacity-70">⌘↵</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Card scaffold ────────────────────────────────────────────────────────────
function CardShell({ title, meta, action, children, footer }: {
  title: string; meta?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-[13px] border border-border bg-card shadow-soft flex flex-col flex-1 h-full min-h-[260px] min-w-0">
      {/* Header reads as its own bar on every card: a tinted strip + bottom hairline,
          matching the "Your asks" card so To-dos / Reminders / Dashboards line up. */}
      <div className="flex items-center gap-2 px-3.5 h-10 flex-none rounded-t-[13px] border-b border-border-soft bg-bg/40">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink font-600">{title}</span>
        {meta}
        <span className="flex-1" />
        {action}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
      {footer && <div className="flex-none border-t border-border-soft p-2.5">{footer}</div>}
    </div>
  );
}

// ─── Your asks card (top of the pool, compact) ────────────────────────────────
function AsksCard({ pool, statusOf, onOpen, onViewAll, onReviewed, dayOpen, onToggleDay }: {
  pool: PoolItem[]; statusOf: (it: PoolItem) => DeskStatus;
  onOpen: (id: string) => void; onViewAll: () => void; onReviewed: (id: string) => void;
  // My Day toggle — only rendered below xl (where My Day has no row of its own).
  dayOpen: boolean; onToggleDay: () => void;
}) {
  const open = pool.filter((p) => p.status !== 'done').length;
  return (
    <CardShell title="Your asks"
      meta={<span className="font-mono text-[10px] text-ink3">{open} open · {pool.length} total</span>}
      action={
        <div className="flex items-center gap-1.5">
          {/* My Day trigger — always available; swaps the trio for the timeline */}
          <button type="button" onClick={onToggleDay} title={dayOpen ? 'Hide My day' : 'Show My day'}
            className={`h-[26px] w-[28px] grid place-items-center rounded-[7px] border ${
              dayOpen ? 'border-accent bg-accent text-white' : 'border-border bg-bg text-ink2 hover:border-accent hover:text-accent'}`}>
            <Icon name="history" size={13} color="currentColor" />
          </button>
          <button type="button" onClick={onViewAll}
            className="h-[26px] px-2.5 rounded-[7px] border border-border bg-bg text-[12px] font-550 text-ink2 hover:border-accent hover:text-accent flex items-center gap-1 whitespace-nowrap">
            All asks <Icon name="arrowR" size={11} />
          </button>
        </div>
      }>
      {pool.length === 0 && (
        <p className="text-[12px] text-ink3 text-center px-6 py-10">Nothing here yet — ask for something above and watch it move through the pipeline.</p>
      )}
      {pool.slice(0, 6).map((it) => {
        const st = statusOf(it);
        return (
          <button key={it.id} type="button" onClick={() => onOpen(it.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 border-t border-border-soft text-left hover:bg-bg/60 ${
              st === 'review' ? 'bg-accent-soft/15' : st === 'input' ? 'bg-orange/10' : ''}`}>
            <span className={`flex-none w-[3px] h-[26px] rounded-full ${DESK[st].rail}`} />
            <span className="flex-1 min-w-0">
              <span className={`block text-[13px] font-550 truncate ${st === 'delivered' ? 'text-ink3 line-through' : 'text-ink'}`}>{it.title}</span>
              <span className="block font-mono text-[9.5px] uppercase tracking-wider text-ink3 mt-0.5 truncate">
                {DESK[st].label} · {ago(it.createdAt)}
              </span>
            </span>
            {st === 'review' && (
              <span role="button" onClick={(e) => { e.stopPropagation(); onReviewed(it.id); }}
                className="flex-none h-[24px] px-2.5 rounded-[7px] bg-accent text-white text-[11.5px] font-550 grid place-items-center">
                Review
              </span>
            )}
            {st === 'input' && (
              <span className="flex-none h-[24px] px-2.5 rounded-[7px] bg-orange text-white text-[11.5px] font-550 grid place-items-center">
                Respond
              </span>
            )}
          </button>
        );
      })}
    </CardShell>
  );
}

// ─── To-dos card ──────────────────────────────────────────────────────────────
function TodosCard({ todos, onChange }: { todos: Todo[]; onChange: () => void }) {
  const [text, setText] = useState('');
  const doneCount = todos.filter((t) => t.done).length;
  const add = async () => {
    if (!text.trim()) return;
    await api.createTodo(text.trim()).catch(() => {});
    setText('');
    onChange();
  };
  const sorted = [...todos].sort((a, b) => Number(a.done) - Number(b.done));
  return (
    <CardShell title="Your to-dos"
      meta={<span className="font-mono text-[10px] text-ink3">{doneCount}/{todos.length}</span>}
      footer={
        <div className="flex items-center gap-2">
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Add a to-do…" className="flex-1 min-w-0 h-[26px] px-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink3" />
          <button type="button" onClick={add} disabled={!text.trim()}
            className="flex-none h-[24px] px-2.5 rounded-[6px] border border-border bg-bg text-[11.5px] font-550 text-ink2 hover:border-accent hover:text-accent disabled:opacity-50">Add</button>
        </div>
      }>
      {todos.length === 0 && <p className="text-[12px] text-ink3 text-center px-6 py-10">No to-dos. Meeting captures and asks can drop them here.</p>}
      {sorted.map((t) => (
        <label key={t.id} className="flex items-center gap-2.5 px-3.5 py-2 cursor-pointer hover:bg-bg/60">
          <input type="checkbox" checked={t.done} onChange={() => api.setTodoDone(t.id, !t.done).then(onChange).catch(() => {})}
            className="accent-accent flex-none" />
          <span className={`flex-1 min-w-0 text-[12.5px] truncate ${t.done ? 'text-ink3 line-through' : 'text-ink2'}`}>{t.text}</span>
          <span className="flex-none font-mono text-[9.5px] text-ink3">{t.done ? 'done' : t.dueDate ?? ''}</span>
        </label>
      ))}
    </CardShell>
  );
}

// ─── Reminders card ───────────────────────────────────────────────────────────
function RemindersCard({ reminders, onChange }: { reminders: Reminder[]; onChange: () => void }) {
  const live = reminders.filter((r) => !r.done).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const todayCount = live.filter((r) => new Date(r.dueAt).toDateString() === new Date().toDateString()).length;
  const next = live.find((r) => Date.parse(r.dueAt) > Date.now());
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <CardShell title="Reminders"
      meta={<span className="font-mono text-[10px] text-ink3">{todayCount} today</span>}
      footer={<p className="font-mono text-[10px] text-ink3 px-1">{next ? `Next up at ${hhmm(next.dueAt)}` : 'Nothing scheduled'}</p>}>
      {live.length === 0 && <p className="text-[12px] text-ink3 text-center px-6 py-10">Nothing scheduled. Reminders from Tasks and captures show up here.</p>}
      {live.map((r) => {
        const dueMin = (Date.parse(r.dueAt) - Date.now()) / 60000;
        const soon = dueMin > 0 && dueMin <= 60;
        return (
          <div key={r.id} className="flex items-center gap-2.5 px-3.5 py-2 group hover:bg-bg/60">
            <span className={`flex-none w-[42px] font-mono text-[11px] tabular-nums font-550 ${
              dueMin <= 0 ? 'text-ink3' : soon ? 'text-accent-dark' : 'text-ink2'}`}>{hhmm(r.dueAt)}</span>
            <span className={`flex-none w-[5px] h-[5px] rounded-full ${dueMin <= 0 ? 'bg-border' : soon ? 'bg-accent' : 'bg-orange'}`} />
            <span className="flex-1 min-w-0 text-[12.5px] text-ink2 truncate">{r.title}</span>
            <button type="button" title="Dismiss" onClick={() => api.updateReminder(r.id, { done: true }).then(onChange).catch(() => {})}
              className="flex-none text-ink3 opacity-0 group-hover:opacity-100 hover:text-rec"><Icon name="x" size={12} /></button>
          </div>
        );
      })}
    </CardShell>
  );
}

// ─── Dashboards card — the freshest board tiles, one glance from their boards ─
function DashboardsCard({ recent, onOpen }: { recent: RecentTile[]; onOpen: (boardId?: string) => void }) {
  return (
    <CardShell title="Dashboards"
      meta={<span className="font-mono text-[10px] text-ink3">{recent.length}</span>}
      action={
        <button type="button" onClick={() => onOpen()}
          className="h-[26px] px-2.5 rounded-[7px] border border-border bg-bg text-[12px] font-550 text-ink2 hover:border-accent hover:text-accent flex items-center gap-1 whitespace-nowrap">
          All boards <Icon name="arrowR" size={11} />
        </button>
      }>
      {recent.length === 0 ? (
        <div className="px-4 py-8 text-center flex flex-col items-center gap-2.5">
          <p className="text-[12px] text-ink3">No board tiles yet. Ask the team to build one, or set it up yourself.</p>
          <button type="button" onClick={() => onOpen()}
            className="h-[26px] px-3 rounded-[7px] border border-border bg-bg text-[11.5px] font-550 text-ink2 hover:border-accent hover:text-accent">Set up a board</button>
        </div>
      ) : recent.map((r) => <TileRow key={r.tile.id} entry={r} onOpen={() => onOpen(r.boardId)} />)}
    </CardShell>
  );
}

// One board tile as a compact row: a decorative sparkline (seeded off the tile id, one
// accent bar — says "dashboard" without pretending to plot real data), title, freshness.
function TileRow({ entry, onOpen }: { entry: RecentTile; onOpen: () => void }) {
  const { tile } = entry;
  const seed = [...tile.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const bars = Array.from({ length: 7 }, (_, i) => 10 + ((seed * 31 + i * 17) % 24));
  const hot = seed % 7;
  return (
    <button type="button" onClick={onOpen}
      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-bg/60">
      <svg viewBox="0 0 60 26" className="flex-none w-[46px] h-[24px] rounded-[5px] border border-border-soft bg-bg/60 p-[3px]">
        {bars.map((b, i) => (
          <rect key={i} x={2 + i * 8.2} y={22 - b * 0.8} width={5.5} height={b * 0.8} rx={1}
            fill={i === hot ? 'var(--color-accent)' : 'var(--color-border)'} />
        ))}
      </svg>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-550 text-ink truncate">{tile.title}</span>
        <span className="block font-mono text-[9px] text-ink3 truncate">{entry.boardName} · {ago(tile.state.lastRunAt) || 'not run'}</span>
      </span>
    </button>
  );
}

// ─── My Day: a scannable timeline of what happened in the app, per day ────────
// Reads the same live activity feed the cards run on, folds it into human lines, and lets
// you step through days and copy a day out as plain text. Empty days say so plainly.
function MyDayCard({ activity, who, onClose }: { activity: AppEvent[]; who: string; onClose?: () => void }) {
  // Which day we're looking at, as an offset from today (0 = today, -1 = yesterday, …).
  // Only ever backwards or back to today — there's no future activity to show.
  const [offset, setOffset] = useState(0);
  const [copied, setCopied] = useState(false);

  const dayDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d;
  }, [offset]);
  const dayKey = ymd(dayDate);

  // Fold the raw feed into this day's timeline, newest first. The feed is already capped;
  // if the oldest event we hold is still newer than the day's end, we may not have the whole
  // day — but for "today" and recent days that's the full picture.
  const entries = useMemo(() => {
    const out: DayEntry[] = [];
    for (const e of activity) {
      if (!e.occurredAt) continue;
      if (ymd(new Date(e.occurredAt)) !== dayKey) continue;
      const de = toDayEntry(e);
      if (de) out.push(de);
    }
    return out;  // activity is already newest-first
  }, [activity, dayKey]);

  const oldestHeld = activity.length ? activity[activity.length - 1].occurredAt : null;
  // We only hold a bounded feed; if this whole day is older than the oldest event we have,
  // we genuinely have no record for it (vs. "an empty day within our window").
  const beyondWindow = !!oldestHeld && ymd(new Date(oldestHeld)) > dayKey;

  const today = ymd(new Date());
  const yday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); })();
  const dayLabel = dayKey === today ? 'Today' : dayKey === yday ? 'Yesterday'
    : dayDate.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const copyDay = () => {
    const header = `My day — ${dayDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}${who ? ` · ${who}` : ''}`;
    // Copy in chronological order (oldest first) — reads like a diary of the day.
    const lines = [...entries].reverse().map((e) => `${dayHhmm(e.at)}  ${e.text}`);
    const body = lines.length ? lines.join('\n') : 'Nothing recorded.';
    navigator.clipboard?.writeText(`${header}\n${'─'.repeat(header.length)}\n${body}\n`).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1600); },
      () => {},
    );
  };

  return (
    <CardShell title="My day"
      meta={<span className="font-mono text-[10px] text-ink3">{entries.length} {entries.length === 1 ? 'moment' : 'moments'}</span>}
      action={
        <div className="flex items-center gap-1.5">
          {/* day stepper: ‹ label › — back always, forward only until today */}
          <div className="flex items-center gap-0.5 rounded-[8px] border border-border bg-bg px-0.5 h-[26px]">
            <button type="button" title="Previous day" onClick={() => setOffset((o) => o - 1)}
              className="h-[22px] w-[20px] grid place-items-center rounded-[6px] text-ink3 hover:text-ink hover:bg-card rotate-180">
              <Icon name="chevR" size={13} color="currentColor" />
            </button>
            <span className="px-1.5 text-[11.5px] font-550 text-ink2 tabular-nums whitespace-nowrap min-w-[64px] text-center">{dayLabel}</span>
            <button type="button" title="Next day" disabled={offset >= 0} onClick={() => setOffset((o) => Math.min(0, o + 1))}
              className="h-[22px] w-[20px] grid place-items-center rounded-[6px] text-ink3 hover:text-ink hover:bg-card disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink3">
              <Icon name="chevR" size={13} color="currentColor" />
            </button>
          </div>
          {offset !== 0 && (
            <button type="button" onClick={() => setOffset(0)}
              className="h-[26px] px-2.5 rounded-[7px] border border-border bg-bg text-[11.5px] font-550 text-ink2 hover:border-accent hover:text-accent whitespace-nowrap">
              Today
            </button>
          )}
          <button type="button" onClick={copyDay} disabled={!entries.length} title="Copy this day as text"
            className="h-[26px] px-2.5 rounded-[7px] border border-border bg-bg text-[11.5px] font-550 text-ink2 hover:border-accent hover:text-accent disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap">
            <Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? 'Copied' : 'Copy'}
          </button>
          {/* Close — only in the collapsed overlay; brings the trio back */}
          {onClose && (
            <button type="button" onClick={onClose} title="Close My day"
              className="h-[26px] w-[28px] grid place-items-center rounded-[7px] text-ink3 hover:text-ink hover:bg-bg">
              <Icon name="x" size={14} color="currentColor" />
            </button>
          )}
        </div>
      }>
      {entries.length === 0 ? (
        <p className="text-[12px] text-ink3 text-center px-6 py-10">
          {beyondWindow
            ? 'That day is beyond what the desk still remembers.'
            : dayKey === today
              ? 'Nothing yet today. As you ask, capture, and check things off, they’ll appear here.'
              : 'Quiet day — nothing was recorded.'}
        </p>
      ) : (
        <ol className="px-3.5 py-2.5 relative">
          {/* the spine */}
          <span className="pointer-events-none absolute left-[19px] top-3 bottom-3 w-px bg-border-soft" />
          {entries.map((e) => {
            const s = DAY_STYLE[e.kind];
            return (
              <li key={e.id} className="relative flex items-start gap-2.5 py-[5px]">
                <span className={`relative z-10 flex-none mt-[1px] w-[15px] h-[15px] rounded-full grid place-items-center ${s.dot}`}>
                  <Icon name={s.icon} size={9} color="#fff" />
                </span>
                <span className="flex-1 min-w-0 text-[12.5px] text-ink2 leading-snug">{e.text}</span>
                <span className="flex-none font-mono text-[10px] tabular-nums text-ink3 mt-[1px]">{dayHhmm(e.at)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </CardShell>
  );
}

// ─── Split view: every ask — list + detail, or a board ────────────────────────
function SplitView({ pool, visible, selected, agents, counts, filter, view, statusOf, onFilter, onView, onSelect, onClose, onChange, onReviewed, onFollowUp, onOpenAssistants, pendingInput }: {
  pool: PoolItem[]; visible: PoolItem[]; selected: PoolItem | null; agents: Agent[];
  counts: Record<Filter, number>; filter: Filter; view: 'list' | 'board';
  statusOf: (it: PoolItem) => DeskStatus;
  onFilter: (f: Filter) => void; onView: (v: 'list' | 'board') => void;
  onSelect: (id: string) => void; onClose: () => void; onChange: () => void;
  onReviewed: (id: string) => void; onFollowUp: (it: PoolItem) => void;
  onOpenAssistants?: () => void;
  pendingInput?: PendingInputRec;
}) {
  const FILTERS: [Filter, string][] = [['all', 'All'], ['waiting', 'Queued'], ['assigned', 'In progress'], ['input', 'Needs input'], ['review', 'Needs review'], ['delivered', 'Delivered']];
  return (
    <div className="rounded-[13px] border border-border bg-card shadow-soft flex flex-col overflow-hidden flex-1 min-h-[420px]">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border-soft flex-none flex-wrap">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink font-600">All asks</span>
        <div className={`flex items-center gap-1 flex-wrap ${view === 'board' ? 'opacity-40 pointer-events-none' : ''}`}>
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => onFilter(k)}
              className={`h-[25px] px-2.5 rounded-full border text-[11.5px] font-550 flex items-center gap-1.5 ${
                filter === k ? 'border-accent bg-accent text-white' : 'border-border bg-bg text-ink2 hover:border-ink3'}`}>
              {label} <span className="font-mono text-[10px] opacity-70">{counts[k]}</span>
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <div className="flex gap-0.5 p-0.5 rounded-[8px] border border-border bg-bg">
          {(['list', 'board'] as const).map((v) => (
            <button key={v} type="button" onClick={() => onView(v)}
              className={`h-[22px] px-2.5 rounded-[6px] text-[11.5px] font-600 capitalize ${
                view === v ? 'bg-accent text-white' : 'text-ink3'}`}>
              {v === 'list' ? 'Split' : 'Board'}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} title="Back to the desk" className="text-ink3 hover:text-ink px-1"><Icon name="x" size={14} /></button>
      </div>

      {view === 'list' ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(200px,0.8fr)_minmax(0,1.4fr)]">
          {/* list pane — on narrow windows it stacks above the detail with its own scroll */}
          <div className="border-b md:border-b-0 md:border-r border-border-soft overflow-y-auto bg-bg/60 max-h-[220px] md:max-h-none">
            {visible.map((it) => {
              const st = statusOf(it);
              const sel = selected?.id === it.id;
              return (
                <button key={it.id} type="button" onClick={() => onSelect(it.id)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 border-b border-border-soft text-left ${sel ? 'bg-card' : 'hover:bg-card/60'}`}>
                  <span className={`flex-none w-[3px] self-stretch min-h-[28px] rounded-full ${DESK[st].rail}`} />
                  <span className="flex-1 min-w-0">
                    <span className={`block text-[12.5px] font-550 leading-snug line-clamp-2 ${st === 'delivered' ? 'text-ink3 line-through' : 'text-ink'}`}>{it.title}</span>
                    <span className="flex items-center gap-1.5 mt-1 min-w-0">
                      <span className={`font-mono text-[9.5px] font-600 uppercase tracking-wider ${DESK[st].text}`}>{DESK[st].label}</span>
                      <span className="w-px h-[9px] bg-border" />
                      <span className="font-mono text-[9.5px] text-ink3 truncate">{ago(it.createdAt)}</span>
                    </span>
                  </span>
                  {st === 'review' && <span title="Needs your review" className="flex-none w-[6px] h-[6px] mt-1.5 rounded-full bg-accent" />}
                </button>
              );
            })}
            {visible.length === 0 && <p className="text-[12px] text-ink3 text-center px-4 py-10">Nothing in this filter.</p>}
          </div>

          {/* detail pane */}
          <div className="min-w-0 overflow-y-auto p-4">
            {selected
              ? <AskDetail item={selected} st={statusOf(selected)} agents={agents} onChange={onChange}
                  onReviewed={() => onReviewed(selected.id)} onFollowUp={() => onFollowUp(selected)}
                  onOpenAssistants={onOpenAssistants} pendingInput={pendingInput} />
              : <p className="text-[13px] text-ink3 text-center py-16">Pick an ask on the left to see its journey.</p>}
          </div>
        </div>
      ) : (
        /* board view */
        <div className="flex-1 min-h-0 overflow-y-auto p-3.5 grid grid-cols-2 lg:grid-cols-4 gap-3 items-start">
          {(['waiting', 'assigned', 'review', 'delivered'] as DeskStatus[]).map((k) => {
            // Needs-input asks are still in flight — they live in the In-progress column,
            // flagged by their orange status chip on the card.
            const items = pool.filter((it) => statusOf(it) === k || (k === 'assigned' && statusOf(it) === 'input'));
            return (
              <div key={k} className="min-w-0 flex flex-col gap-2">
                <div className="flex items-center gap-1.5 px-0.5">
                  <span className={`w-[6px] h-[6px] rounded-full ${DESK[k].dot}`} />
                  <span className="font-mono text-[10px] font-600 uppercase tracking-wider text-ink2 truncate">{DESK[k].label}</span>
                  <span className="font-mono text-[10px] text-ink3">{items.length}</span>
                </div>
                {items.map((it) => (
                  <button key={it.id} type="button" onClick={() => { onSelect(it.id); onView('list'); }}
                    className="rounded-[10px] border border-border bg-bg p-2.5 text-left hover:border-ink3 flex flex-col gap-1.5">
                    <span className={`text-[12.5px] font-550 leading-snug line-clamp-3 ${k === 'delivered' ? 'text-ink3 line-through' : 'text-ink'}`}>{it.title}</span>
                    <span className="flex items-center gap-1.5">
                      <span className={`font-mono text-[9.5px] font-600 ${PRI_TEXT[it.priority] ?? 'text-ink3'}`}>{PRI_LABEL[it.priority] ?? it.priority}</span>
                      {statusOf(it) === 'input' && (
                        <span className="font-mono text-[9px] font-600 uppercase tracking-wider text-white bg-orange rounded px-1.5 py-0.5">Needs input</span>
                      )}
                      <span className="flex-1" />
                      <span className="font-mono text-[9.5px] text-ink3">{ago(it.createdAt)}</span>
                    </span>
                  </button>
                ))}
                {items.length === 0 && (
                  <div className="rounded-[10px] border border-dashed border-border py-4 text-center text-[11.5px] text-ink3/70">Empty</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── The detail pane: journey plan + result + actions ─────────────────────────
function AskDetail({ item, st, agents, onChange, onReviewed, onFollowUp, onOpenAssistants, pendingInput }: {
  item: PoolItem; st: DeskStatus; agents: Agent[]; onChange: () => void;
  onReviewed: () => void; onFollowUp: () => void; onOpenAssistants?: () => void;
  pendingInput?: PendingInputRec;
}) {
  const agentName = agents.find((a) => a.id === item.assignedAgent)?.name ?? item.assignedAgent ?? undefined;
  const askerName = pendingInput?.agentName ?? agentName;
  const assign = (agentId: string) => agentId && api.assignPoolItem(item.id, agentId).then(onChange).catch(() => {});

  // The ask's journey as a plan checklist: ✓ behind it, → where it is, · ahead of it.
  // A question about a still-queued ask (the Lead clarifying before routing) pauses the
  // ROUTING step; a question from the assigned assistant pauses the WORKING step.
  const triage = st === 'input' && item.status === 'waiting';
  const stepIdx = st === 'waiting' || triage ? 1 : st === 'assigned' || st === 'input' ? 2 : 4;
  const steps = [
    { label: 'Posted to the queue', by: 'you' },
    { label: triage
        ? `${askerName ?? 'The Lead'} needs a detail before routing`
        : 'The Lead routes it to an assistant', by: '' },
    { label: st === 'input' && !triage
        ? `${askerName ?? 'The assistant'} paused — waiting on your input`
        : agentName ? `${agentName} works the ask` : 'An assistant works the ask', by: agentName ?? '' },
    { label: 'Result delivered for your review', by: agentName ?? '' },
  ];

  return (
    <div className="an-rise flex flex-col gap-3 max-w-[560px]">
      {st === 'input' && (
        <div className="rounded-[10px] border border-orange/50 bg-orange/10 overflow-hidden">
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 flex-wrap">
            <span className="an-pulse w-[7px] h-[7px] rounded-full bg-orange flex-none" />
            <span className="flex-1 min-w-[140px] text-[12.5px] font-550 text-orange">
              {askerName ?? 'The assistant'} needs your input to continue
            </span>
            {onOpenAssistants && (
              <button type="button" onClick={onOpenAssistants}
                className="flex-none h-[24px] px-2.5 rounded-[7px] border border-orange/50 text-orange text-[11.5px] font-550 hover:bg-orange hover:text-white">
                Open in Assistants
              </button>
            )}
          </div>
          {pendingInput && <PendingInput key={pendingInput.jobId} jobId={pendingInput.jobId} initialFrame={pendingInput.frame} />}
        </div>
      )}
      {st === 'review' && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] border border-accent/40 bg-accent-soft/20 flex-wrap">
          <span className="an-pulse w-[7px] h-[7px] rounded-full bg-accent flex-none" />
          <span className="flex-1 min-w-[120px] text-[12.5px] font-550 text-accent-dark">Finished — waiting on your review</span>
          <button type="button" onClick={onReviewed}
            className="flex-none h-[27px] px-3 rounded-[7px] bg-accent text-white text-[12px] font-550">Mark reviewed</button>
        </div>
      )}

      <div className="flex items-baseline gap-2.5">
        <span className={`font-mono text-[10px] font-600 uppercase tracking-wider px-2 py-0.5 rounded-[5px] bg-bg border border-border-soft ${DESK[st].text}`}>{DESK[st].label}</span>
        <span className={`font-mono text-[10px] font-600 ${PRI_TEXT[item.priority] ?? 'text-ink3'}`}>{PRI_LABEL[item.priority] ?? item.priority}</span>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-ink3">asked {ago(item.createdAt)}</span>
      </div>

      <h3 className={`font-serif text-[19px] leading-snug ${st === 'delivered' ? 'text-ink2' : 'text-ink'}`}>{item.title}</h3>

      {/* A one-line ask IS its title (the backend derives the title from it) — repeating
          it as the description reads like a glitch, so only show a longer description. */}
      {item.description && item.description !== item.title && (
        <p className="text-[13px] text-ink2 leading-relaxed whitespace-pre-wrap">{item.description}</p>
      )}

      <div className="flex items-center gap-4 py-2.5 border-y border-border-soft flex-wrap">
        {item.tags.length > 0 && (
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-ink3">type</span>
            <span className="text-[12.5px] font-550 text-ink2 capitalize">{item.tags.join(', ')}</span>
          </span>
        )}
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink3">on it</span>
          <span className="text-[12.5px] font-550 text-ink2">{agentName ?? 'unassigned'}</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-ink3">mode</span>
          <span className="text-[12.5px] font-550 text-ink2 flex items-center gap-1">
            <Icon name={item.autonomy === 'ask' ? 'bell' : 'zap'} size={11} />
            {item.autonomy === 'ask' ? 'Ask first' : 'Auto'}
          </span>
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[10px] text-ink3">{st === 'waiting' ? 'not started' : agentName ? `1 assistant · ${agentName}` : ''}</span>
      </div>

      <div>
        <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink3 mb-2">journey</div>
        <div className="flex flex-col gap-1.5">
          {steps.map((s, i) => (
            <Fragment key={s.label}>
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`flex-none w-[14px] text-center font-mono text-[11px] ${
                  i < stepIdx ? 'text-ok' : i === stepIdx ? 'text-accent' : 'text-faint'}`}>
                  {i < stepIdx ? '✓' : i === stepIdx ? '→' : '·'}
                </span>
                <span className={`min-w-0 text-[13px] ${i <= stepIdx ? 'text-ink2' : 'text-ink3'}`}>{s.label}</span>
                <span className="flex-1" />
                {i < stepIdx && s.by && <span className="flex-none font-mono text-[9.5px] text-ink3/70">{s.by}</span>}
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      {item.status === 'done' && (
        <div className="rounded-[10px] border border-border bg-bg/60 p-3.5">
          <div className="font-mono text-[9.5px] uppercase tracking-wider text-ink3 mb-2">result</div>
          {item.result?.trim()
            ? <Markdown text={item.result} textSize="text-[13px]" />
            : <p className="text-[12.5px] text-ink3 italic">Marked done without a written result.</p>}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {st === 'waiting' && (
          <select defaultValue="" onChange={(e) => assign(e.target.value)} title="Skip the Lead — hand it to an assistant yourself"
            className="h-[29px] px-2 rounded-[7px] border border-border bg-bg text-ink2 text-[12px] font-550 outline-none cursor-pointer">
            <option value="" disabled>Assign to…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {item.status !== 'done' && (
          <button type="button" onClick={() => api.completePoolItem(item.id).then(onChange).catch(() => {})}
            className="h-[29px] px-3 rounded-[7px] border border-border bg-bg text-[12.5px] font-550 text-ink2 hover:border-ok hover:text-ok">
            Mark done
          </button>
        )}
        {item.status === 'done' && (
          <button type="button" onClick={onFollowUp}
            className="h-[29px] px-3 rounded-[7px] border border-border bg-bg text-[12.5px] font-550 text-ink2 hover:border-accent hover:text-accent">
            Ask a follow-up
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => api.deletePoolItem(item.id).then(onChange).catch(() => {})}
          className="h-[29px] px-3 rounded-[7px] border border-border bg-bg text-[12.5px] font-550 text-ink3 hover:border-rec hover:text-rec">
          Discard
        </button>
      </div>
    </div>
  );
}

// ─── The suspended run's actual question, answered inline ─────────────────────
// Seeded from the durable pending record (so the question shows even when the frame
// buffer or activity feed has moved on), then kept honest by the job's frame stream:
// an `ask`/`approve` frame refreshes it, and any later content frame means the request
// was answered elsewhere. Answers go through the same run.respond the office uses.
type Pending =
  | { kind: 'ask'; id: string; question: string; options?: string[] }
  | { kind: 'approve'; id: string; tool?: string };

function fromFrame(f?: PendingInputRec['frame']): Pending | null {
  if (!f) return null;
  if (f.type === 'ask') return { kind: 'ask', id: f.id, question: f.question ?? '', options: f.options };
  if (f.type === 'approve') return { kind: 'approve', id: f.id, tool: f.tool };
  return null;
}

function PendingInput({ jobId, initialFrame }: { jobId: string; initialFrame?: PendingInputRec['frame'] }) {
  const [pending, setPending] = useState<Pending | null>(() => fromFrame(initialFrame));
  const [answer, setAnswer] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const stop = subChat(jobId, (raw) => {
      const e = raw as { type: string; id?: string; question?: string; options?: string[]; tool?: string };
      if (e.type === 'ask') setPending({ kind: 'ask', id: e.id ?? '', question: e.question ?? '', options: e.options });
      else if (e.type === 'approve') setPending({ kind: 'approve', id: e.id ?? '', tool: e.tool });
      else if (e.type === 'token' || e.type === 'thinking' || e.type === 'tool_start' || e.type === 'done' || e.type === 'error' || e.type === 'picked_up') {
        setPending(null);
      }
    }, { attach: true });
    return stop;
  }, [jobId]);

  const respond = (body: { answer?: string; approved?: boolean }) => {
    if (!pending || sent) return;
    api.respondRun({ jobId, requestId: pending.id, scope: 'once', ...body }).catch(() => {});
    setSent(true);
  };

  if (sent) {
    return <p className="px-3.5 py-2.5 border-t border-orange/25 text-[12px] text-ink2">Answer sent — {`the assistant is picking it up.`}</p>;
  }
  if (!pending) {
    return <p className="px-3.5 py-2.5 border-t border-orange/25 font-mono text-[10px] text-ink3">fetching the question…</p>;
  }
  return (
    <div className="px-3.5 py-3 border-t border-orange/25 flex flex-col gap-2.5 bg-card/50">
      {pending.kind === 'approve' ? (
        <>
          <p className="text-[13px] text-ink leading-relaxed">
            Wants permission to use {pending.tool ? <span className="font-mono text-[12px]">{pending.tool}</span> : 'a tool'}.
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => respond({ approved: true })}
              className="h-[28px] px-3.5 rounded-[7px] bg-accent text-white text-[12.5px] font-550">Allow</button>
            <button type="button" onClick={() => respond({ approved: false })}
              className="h-[28px] px-3 rounded-[7px] border border-border bg-bg text-[12.5px] font-550 text-ink2 hover:border-rec hover:text-rec">Deny</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{pending.question}</p>
          {(pending.options ?? []).length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {pending.options!.map((opt) => (
                <button key={opt} type="button" onClick={() => respond({ answer: opt })}
                  className="h-[26px] px-2.5 rounded-full border border-border bg-bg text-[12px] font-500 text-ink2 hover:border-accent hover:text-accent">
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && answer.trim()) respond({ answer: answer.trim() }); }}
              placeholder="Type your answer…"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-[8px] border border-border bg-bg text-[12.5px] text-ink outline-none resize-none focus:border-accent placeholder:text-ink3" />
            <button type="button" onClick={() => respond({ answer: answer.trim() })} disabled={!answer.trim()}
              className="flex-none h-[28px] px-3.5 rounded-[7px] bg-accent text-white text-[12.5px] font-550 disabled:opacity-40">Send</button>
          </div>
        </>
      )}
    </div>
  );
}

