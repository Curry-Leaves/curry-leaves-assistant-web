import { useEffect, useMemo, useRef, useState } from 'react';
import { onKernel, subChat } from '../../api/socket';
import { AgentRunsPanel } from './AgentRunsPanel';
import { onHire } from './hireEvent';
import type { Agent, AppEvent, KernelJob, KernelSnapshot } from '../../types';
import { timeOf } from '../../types/schedule';

// ─── The Office ───────────────────────────────────────────────────────────────
// The agents page as an ISOMETRIC 3D floor plan. The whole floor is one CSS-3D
// plane (rotateX + rotateZ — no engine, no canvas); rooms sit on it with extruded
// back walls, furniture is built from 3D blocks (Cuboid: top + two lit side faces),
// and people are upright billboards (counter-rotated so they always face the
// camera) that WALK — legs swing while their floor position transitions.
//
// Idle people wait in THE POOL; when work arrives a person walks to the room whose
// tools they're using, thinks out loud in a balloon, and walks back when done.
// The kernel queue is physical: queued jobs are papers in the FRONT DESK's intake
// tray, dead-lettered jobs land in the red DEAD drawer. Approvals bring a person to
// YOUR DESK with an amber balloon. A wallboard carries the live counts and a ticker
// below the floor narrates the latest event.
//
// Scalable by construction: rooms are fixed zones; people are packed into their
// current zone, so 3 agents or 30 fill the same rooms more densely. Movement is a
// plain CSS transition on left/top (projection is handled by the floor transform).
// Everything is driven by feeds that already exist: kernel snapshots, agent.run.*
// events, and per-run chat:<runId> frames.

export type Presence = 'working' | 'queued' | 'waiting' | 'scheduled' | 'idle' | 'paused';

type ZoneId = 'library' | 'web' | 'studio' | 'board' | 'meeting' | 'workshop' | 'pool' | 'breakroom' | 'frontdesk' | 'yourdesk';
type Zone = { id: ZoneId; label: string; sub: string; x: number; y: number; w: number; h: number; accent: string };

// Layout in floor-plane % — a service row along the back, meeting/workshop flanking
// the pool, front desk + break room + your desk along the front. Under the iso
// projection the back row reads as the far platforms, the front row as the near ones.
const ZONES: Zone[] = [
  { id: 'library',  label: 'Library',    sub: 'kb_read · kb_write · inputs',      x: 3,    y: 8,  w: 22,   h: 31, accent: 'var(--color-ok)' },
  { id: 'web',      label: 'Web desk',   sub: 'web_search · web_fetch · mcp__…',  x: 27.5, y: 8,  w: 20,   h: 31, accent: 'var(--color-blue)' },
  { id: 'studio',   label: 'Studio',     sub: 'artifacts',                        x: 50,   y: 8,  w: 19,   h: 31, accent: '#8A6BB5' },
  { id: 'board',    label: 'Board wall', sub: 'dashboard',                        x: 71.5, y: 8,  w: 25.5, h: 31, accent: '#B0688C' },
  { id: 'meeting',  label: 'Meeting',    sub: 'orchestrate',                      x: 3,    y: 45, w: 20,   h: 29, accent: '#3D96A0' },
  { id: 'workshop', label: 'Workshop',   sub: 'skills · history',                 x: 77,   y: 45, w: 20,   h: 29, accent: '#C08A3E' },
  { id: 'pool',     label: 'The pool',   sub: 'idle — waiting for work',          x: 28,   y: 48, w: 44,   h: 24, accent: 'var(--color-ink3)' },
  { id: 'frontdesk', label: 'Front desk', sub: 'intake · dead letters',           x: 3,    y: 80, w: 28,   h: 17, accent: 'var(--color-ink3)' },
  { id: 'breakroom', label: 'Break room', sub: 'on a schedule — resting',         x: 33,   y: 79, w: 33,   h: 18, accent: 'var(--color-blue)' },
  { id: 'yourdesk', label: 'Your desk',  sub: 'approvals',                        x: 69,   y: 80, w: 28.5, h: 17, accent: 'var(--color-orange)' },
];
const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

// A tool call routes its agent to a room; unknown tools keep them at the Library desk.
// Keyed by the consolidated (action-dispatched) tool names — one entry per tool now.
const TOOL_ZONE: Record<string, ZoneId> = {
  kb_read: 'library', kb_write: 'library', inputs: 'library',
  web_search: 'web', web_fetch: 'web', browser: 'web',
  artifacts: 'studio',
  dashboard: 'board',
  orchestrate: 'meeting',
  skills: 'workshop', history: 'workshop',
  todos: 'frontdesk', reminders: 'frontdesk', recordings: 'frontdesk', recording_output: 'frontdesk',
};

const AVATAR_COLORS = ['#3D8A5F', '#4A7DB5', '#8A6BB5', '#B0688C', '#C08A3E', '#3D96A0', '#B85C4E', '#6B8E3D'];
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
export function firstName(name: string): string { return name.split(/[\s(]/)[0] || name; }
// A small deterministic drift for people idling in the pool — changes every tick so the
// floor never looks frozen, without any randomness at render time (each nudge becomes a
// little stroll via the position transition, complete with a walk cycle).
function drift(id: string, tick: number): { dx: number; dy: number } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = (h ^ (tick * 2654435761)) >>> 0;
  return { dx: ((a % 97) / 97 - 0.5) * 3.6, dy: (((a >> 7) % 89) / 89 - 0.5) * 3.0 };
}
export function roleOf(a: Agent): string {
  const m = a.name.match(/\(([^)]+)\)/);
  if (m) return m[1];
  return a.description?.split(/[.—–-]/)[0]?.trim() || 'Agent';
}

export function presenceOf(a: Agent, running: Set<string>, waiting: Set<string>): Presence {
  if (waiting.has(a.id)) return 'waiting';
  if (running.has(a.id)) return 'working';
  if (!a.enabled) return 'paused';
  if (a.schedule && a.schedule.kind !== 'none') return 'scheduled';
  return 'idle';
}

export const LABEL: Record<Presence, string> = { working: 'Working', queued: 'Picking up work', waiting: 'Needs you', scheduled: 'Scheduled', idle: 'Idle', paused: 'Paused' };
export const DOT: Record<Presence, string> = { working: 'an-pulse bg-accent', queued: 'an-pulse bg-blue', waiting: 'an-pulse bg-orange', scheduled: 'bg-blue', idle: 'bg-ink3', paused: 'bg-faint' };
export const TEXT: Record<Presence, string> = { working: 'text-accent-dark', queued: 'text-blue', waiting: 'text-orange', scheduled: 'text-blue', idle: 'text-ink3', paused: 'text-ink3' };

const mix = (c: string, pct: number, base = 'var(--color-card)') => `color-mix(in srgb, ${c} ${pct}%, ${base})`;
// Shade a face toward the theme's darkest ink — the "unlit side" of every 3D block.
// Using --color-ink rather than a fixed brown keeps the shadow side in the page's own
// hue, so blocks read as lit by the same room in every theme (including dark ones,
// where a hardcoded warm dark was *lighter* than the surface it sat on).
const shade = (c: string, keep: number) => `color-mix(in srgb, ${c} ${keep}%, var(--color-ink))`;

// Wood/furniture tones. Hue comes from the theme accent (so the office picks up the
// page's character), warmed slightly and mixed toward bg so it stays a surface, not a
// highlight. Every furniture face is derived from these two.
const WOOD = `color-mix(in srgb, var(--color-accent) 55%, var(--color-ink3))`;
const WOOD_DARK = `color-mix(in srgb, var(--color-accent) 40%, var(--color-ink))`;
const woodTop = mix(WOOD, 62, 'var(--color-bg)');
const woodEdge = mix(WOOD_DARK, 70, 'var(--color-bg)');

// The isometric camera. The floor plane gets `rotateX(ISO_X) rotateZ(ISO_Z)`;
// anything that must stand upright and face the camera (people, monitors, plants,
// signs) applies the exact inverse, in reverse order.
// The camera is draggable (see useCamera), so the angles are runtime state rather than
// constants. These are the defaults / the starting pose.
const ISO_X = 55;   // tilt: 90 = straight down, 0 = eye level
const ISO_Z_DEFAULT = -45;
// Billboards (people, monitors, signs) counter-rotate the camera to stand upright, and
// must track it as it turns. Rather than thread the angle through every furniture
// component as a prop, the floor publishes the inverse transform as a CSS variable and
// descendants just read it — one write per frame, no re-render cascade.
const UNISO = 'var(--ofc-uniso)';
const isoOf = (z: number) => `rotateX(${ISO_X}deg) rotateZ(${z}deg)`;
const unisoOf = (z: number) => `rotateZ(${-z}deg) rotateX(${-ISO_X}deg)`;
const WALL_H = 30; // px — height of every room's back walls

// The scene's intrinsic size. Everything inside is authored against these dimensions
// (the old fixed 1150×719 card, 16:10) and the whole thing is then scaled to fit the
// window — see the zoom wrapper in OfficeView. Changing these re-authors the layout;
// to make the office bigger on screen, let it scale, don't edit these.
const SCENE_W = 1150;
const SCENE_H = 719;
// Don't scale past 1: blowing the scene up beyond its authored size just makes soft,
// oversized furniture on a big monitor. Shrinking is unbounded-ish (floored) so the
// office still reads as an office in a narrow side pane.
const ZOOM_MAX = 1;
const ZOOM_MIN = 0.35;

// What a working person is saying, and how the balloon should look.
type Line = { kind: 'thought' | 'action'; text: string };
type Placed = { agent: Agent; presence: Presence; zone: ZoneId; line: Line | null };

// Pack N people into a zone as wrapped rows of slots (centres in % of the scene).
function slotIn(zone: Zone, index: number, count: number): { left: number; top: number } {
  // Break room: scheduled folk sit ON the couch. The Sofa3D spans room-local x 10–44 at
  // y≈20 (see Furniture 'breakroom'); seat them in a row along its cushion, wrapping to a
  // second row on the rug in front once the couch is full.
  if (zone.id === 'breakroom') {
    const seats = 4;                       // cushions that fit on the couch
    const seat = index % seats;
    const row = Math.floor(index / seats);
    const sofaX0 = 14, sofaX1 = 44;        // room-local % span of the seating positions
    const t = seat / (seats - 1);
    return {
      left: zone.x + (zone.w * (sofaX0 + (sofaX1 - sofaX0) * t)) / 100,
      top: zone.y + (zone.h * (30 + row * 40)) / 100,   // ~on the couch cushion; 2nd row on the rug
    };
  }
  const padX = 3.5;
  const padTop = zone.h <= 20 ? 6 : 11;
  const padBot = zone.id === 'pool' ? 8 : zone.h <= 20 ? 2.5 : 6;
  const innerW = zone.w - padX * 2;
  const innerH = Math.max(zone.h - padTop - padBot, 4);
  const perRow = Math.max(1, Math.min(count, Math.floor(innerW / 7) || 1));
  const rows = Math.ceil(count / perRow);
  const col = index % perRow;
  const row = Math.floor(index / perRow);
  return {
    left: zone.x + padX + (innerW / perRow) * (col + 0.5),
    top: zone.y + padTop + (innerH / Math.max(rows, 1)) * (row + 0.5),
  };
}

/** Agents suspended awaiting a human — latched on `agent.run.needs_input`, cleared on
 *  `agent.run.input_received` (the answer arrived) or any other `agent.run.*` (run ended).
 *  Exported so the tab bar above the office can share the same live set. */
export function useWaitingSet(activity: AppEvent[]): Set<string> {
  const [waiting, setWaiting] = useState<Set<string>>(new Set());
  useEffect(() => {
    const e = activity[0];
    if (!e) return;
    const id = (e.payload?.agentId as string) || e.entityId || '';
    if (!id) return;
    if (e.type === 'agent.run.needs_input') setWaiting((s) => (s.has(id) ? s : new Set(s).add(id)));
    else if (e.type.startsWith('agent.run.')) setWaiting((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
  }, [activity]);
  return waiting;
}

/** Office-accurate presence per agent id, folding the authoritative kernel snapshot
 *  (running/queued jobs) into the event-fed `running`/`waiting` sets — the exact same
 *  merge the Floor does, so the Team roster's status dots never disagree with the office.
 *  Subscribes to the kernel snapshot itself (replayed to late subscribers). */
export function usePresenceMap(agents: Agent[], running: Set<string>, waiting: Set<string>): Map<string, Presence> {
  const [snap, setSnap] = useState<KernelSnapshot | null>(null);
  useEffect(() => onKernel((s) => setSnap(s as KernelSnapshot)), []);
  return useMemo(() => {
    const workingIds = new Set<string>();
    const queuedIds = new Set<string>();
    for (const j of snap?.running ?? []) if (j.agentId) workingIds.add(j.agentId);
    for (const j of snap?.queued ?? []) if (j.agentId) queuedIds.add(j.agentId);
    const m = new Map<string, Presence>();
    for (const a of agents) {
      let p = presenceOf(a, running, waiting);
      if (p !== 'waiting' && workingIds.has(a.id)) p = 'working';
      else if (p !== 'waiting' && p !== 'working' && queuedIds.has(a.id)) p = 'queued';
      m.set(a.id, p);
    }
    return m;
  }, [agents, running, waiting, snap]);
}

export function OfficeView({ agents, activity, running, waiting, showInternal }: {
  agents: Agent[];
  activity: AppEvent[];
  running: Set<string>;
  waiting: Set<string>;
  showInternal: boolean;
}) {
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);

  // Live kernel snapshot → running job per agent + tray/drawer/wallboard contents.
  const [snap, setSnap] = useState<KernelSnapshot | null>(null);
  useEffect(() => onKernel((s) => setSnap(s as KernelSnapshot)), []);
  const jobByAgent = useMemo(() => {
    const m = new Map<string, KernelJob>();
    for (const j of snap?.running ?? []) if (j.agentId) m.set(j.agentId, j);
    return m;
  }, [snap]);

  const visible = useMemo(() => agents.filter((a) => showInternal || !a.internal), [agents, showInternal]);

  if (openAgent) return <AgentRunsPanel agent={openAgent} onClose={() => setOpenAgent(null)} />;

  return (
    <div className="flex-1 overflow-auto p-4 min-h-0">
      <Floor agents={visible} running={running} waiting={waiting} jobByAgent={jobByAgent}
        snap={snap} activity={activity} onOpen={setOpenAgent} />
    </div>
  );
}

export function PresenceSummary({ agents, running, waiting }: { agents: Agent[]; running: Set<string>; waiting: Set<string> }) {
  const counts = useMemo(() => {
    const c: Record<Presence, number> = { working: 0, queued: 0, waiting: 0, scheduled: 0, idle: 0, paused: 0 };
    for (const a of agents) c[presenceOf(a, running, waiting)]++;
    return c;
  }, [agents, running, waiting]);
  return (
    <div className="flex items-center gap-3 flex-1 min-w-0 overflow-x-auto">
      {(['working', 'queued', 'waiting', 'scheduled', 'idle', 'paused'] as Presence[]).map((p) => counts[p] > 0 && (
        <span key={p} className="flex items-center gap-1.5 flex-none text-[11.5px]">
          <span className={`w-[7px] h-[7px] rounded-full ${DOT[p]}`} />
          <span className={TEXT[p]}>{counts[p]} {LABEL[p].toLowerCase()}</span>
        </span>
      ))}
      {agents.length === 0 && <span className="text-[12px] text-ink3">No one's in yet.</span>}
    </div>
  );
}

// ─── 3D primitives ────────────────────────────────────────────────────────────

/** A solid block on the floor: a lit top face raised `h`px, plus the two camera-
 *  facing side faces (the bottom edge faces lower-right, the left edge lower-left).
 *  Footprint in % of the parent; height in px. */
function Cuboid({ x, y, w, d, h, c, r = 2, topStyle }: {
  x: number; y: number; w: number; d: number; h: number; c: string; r?: number;
  topStyle?: React.CSSProperties;
}) {
  return (
    <>
      <div className="absolute" style={{
        left: `${x}%`, top: `${y + d}%`, width: `${w}%`, height: `${h}px`,
        background: shade(c, 68), transformOrigin: 'top', transform: 'rotateX(90deg)',
      }} />
      <div className="absolute" style={{
        left: `${x}%`, top: `${y}%`, width: `${h}px`, height: `${d}%`,
        background: shade(c, 52), transformOrigin: 'left', transform: 'rotateY(-90deg)',
      }} />
      <div className="absolute" style={{
        left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${d}%`,
        background: c, borderRadius: r, transform: `translateZ(${h}px)`,
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-card) 22%, transparent)',
        ...topStyle,
      }} />
    </>
  );
}

/** A flat contact shadow in the floor plane — grounds every block and person. */
function Ground({ x, y, w, d, o = 0.22 }: { x: number; y: number; w: number; d: number; o?: number }) {
  return (
    <div className="absolute rounded-full" style={{
      left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${d}%`,
      background: `radial-gradient(closest-side, rgba(0,0,0,${o}), transparent)`,
    }} />
  );
}

/** Drag-to-rotate camera. Returns the current spin angle plus the props that make an
 *  element a drag surface. Pointer events (not mouse) so it works with trackpad, touch
 *  and pen alike; pointer capture keeps the drag alive when the cursor leaves the floor.
 *
 *  The angle is deliberately unclamped — the office spins freely all the way round,
 *  which is why every consumer derives from it rather than assuming the ±45° diagonal. */
function useCamera() {
  const [spin, setSpin] = useState(ISO_Z_DEFAULT);
  const drag = useRef<{ id: number; x: number; from: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // primary contact only
    drag.current = { id: e.pointerId, x: e.clientX, from: spin, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    // Ignore sub-3px jitter so a plain click on a person stays a click. Past that we're
    // definitely dragging: latch `moved` and start showing the grabbing cursor.
    if (!d.moved && Math.abs(dx) < 3) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    setSpin(d.from + dx * 0.4); // 0.4°/px — a full turn across roughly the scene width
  };
  // Set on pointerup, read (and cleared) by the click that immediately follows. This is
  // a ref, not state: `dragging` is already false by the time the click fires, so the
  // suppression decision has to survive that transition without a re-render.
  const swallowClick = useRef(false);
  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    swallowClick.current = d.moved;
    drag.current = null;
    setDragging(false);
  };
  // A drag that finishes over a person would otherwise also open them, since the click
  // fires on release. Swallow it in the capture phase when the pointer actually moved.
  const onClickCapture = (e: React.MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  };

  return {
    spin,
    dragging,
    reset: () => setSpin(ISO_Z_DEFAULT),
    handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture },
  };
}

/** An upright billboard at a floor point: counter-rotates the iso camera so its
 *  content stands vertical and faces the viewer (pixel-crisp — no skew). The anchor
 *  point is the content's bottom-centre ("feet"), optionally lifted `z`px. */
function Standee({ x, y, z = 0, children }: { x: number; y: number; z?: number; children: React.ReactNode }) {
  return (
    <div className="absolute w-0 h-0" style={{ left: `${x}%`, top: `${y}%`, transform: `translateZ(${z}px) ${UNISO}`, transformStyle: 'preserve-3d' }}>
      <div className="absolute left-0 bottom-0 -translate-x-1/2 flex flex-col items-center">{children}</div>
    </div>
  );
}

// ─── Furniture (all built from Cuboids + Standees) ───────────────────────────

function Desk3D({ x, y, w, d = 15, h = 13, round = false }: { x: number; y: number; w: number; d?: number; h?: number; round?: boolean }) {
  return (
    <>
      <Ground x={x - 2} y={y - 1} w={w + 4} d={d + 6} />
      <Cuboid x={x} y={y} w={w} d={d} h={h} c={woodTop} r={round ? 999 : 3}
        topStyle={{ background: `linear-gradient(160deg, ${mix(WOOD, 74, 'var(--color-bg)')}, ${woodTop})` }} />
    </>
  );
}
function Chair3D({ x, y, accent }: { x: number; y: number; accent: string }) {
  const seat = mix(accent, 42, 'var(--color-card)');
  return (
    <>
      <Cuboid x={x} y={y} w={5} d={6} h={7} c={seat} />
      <Cuboid x={x} y={y} w={5} d={1.4} h={15} c={mix(accent, 60, 'var(--color-card)')} />
    </>
  );
}
function Monitor3D({ x, y, z = 13 }: { x: number; y: number; z?: number }) {
  return (
    <Standee x={x} y={y} z={z}>
      <span className="block w-[18px] h-[12px] rounded-[2px]" style={{
        background: 'linear-gradient(150deg, color-mix(in srgb, var(--color-blue) 34%, #10151c), #10151c)',
        border: '1px solid color-mix(in srgb, var(--color-ink) 42%, var(--color-bg))',
        boxShadow: 'inset 0 0 4px color-mix(in srgb, var(--color-blue) 50%, transparent)',
      }} />
      <span className="block w-[3px] h-[3px]" style={{ background: mix('var(--color-ink)', 45, 'var(--color-bg)') }} />
      <span className="block w-[9px] h-[2px] rounded-full" style={{ background: mix('var(--color-ink)', 45, 'var(--color-bg)') }} />
    </Standee>
  );
}
function Shelf3D({ x, y, w, d = 9 }: { x: number; y: number; w: number; d?: number }) {
  // A bookcase block whose camera-facing side carries colourful spines.
  return (
    <>
      <Ground x={x - 1} y={y - 1} w={w + 2} d={d + 4} />
      <div className="absolute" style={{
        left: `${x}%`, top: `${y + d}%`, width: `${w}%`, height: '30px',
        transformOrigin: 'top', transform: 'rotateX(90deg)',
        background: `repeating-linear-gradient(90deg,
          ${mix('var(--color-rec)', 55, 'var(--color-bg)')} 0 4px,
          ${mix('var(--color-blue)', 55, 'var(--color-bg)')} 4px 7px,
          ${mix('var(--color-ok)', 55, 'var(--color-bg)')} 7px 10px,
          ${mix('#C08A3E', 60, 'var(--color-bg)')} 10px 13px,
          ${woodEdge} 13px 15px),
          linear-gradient(${woodEdge}, ${woodEdge})`,
        backgroundSize: '100% 9px, 100% 100%', backgroundRepeat: 'repeat, no-repeat',
      }} />
      <div className="absolute" style={{
        left: `${x}%`, top: `${y}%`, width: '30px', height: `${d}%`,
        background: shade(woodEdge, 60), transformOrigin: 'left', transform: 'rotateY(-90deg)',
      }} />
      <div className="absolute" style={{
        left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${d}%`,
        background: woodTop, transform: 'translateZ(30px)', borderRadius: 2,
      }} />
    </>
  );
}
function Sofa3D({ x, y, w, d = 10 }: { x: number; y: number; w: number; d?: number }) {
  const cushion = mix('var(--color-accent)', 36, 'var(--color-bg)');
  const back = mix('var(--color-accent)', 48, 'var(--color-bg)');
  return (
    <>
      <Ground x={x - 1} y={y - 1} w={w + 2} d={d + 5} />
      <Cuboid x={x} y={y} w={w} d={d} h={8} c={cushion} r={4} />
      <Cuboid x={x} y={y} w={w} d={2.4} h={16} c={back} r={4} />
      <Cuboid x={x} y={y} w={2.6} d={d} h={12} c={back} r={3} />
      <Cuboid x={x + w - 2.6} y={y} w={2.6} d={d} h={12} c={back} r={3} />
    </>
  );
}
function Plant3D({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Ground x={x - 1.6} y={y - 1.2} w={3.2} d={2.4} o={0.28} />
      <Standee x={x} y={y}>
        <span className="relative block w-[22px] h-[28px]">
          <span className="absolute bottom-0 left-[5px] w-[12px] h-[9px] rounded-b-[3px] rounded-t-[1px]"
            style={{ background: `linear-gradient(${WOOD}, ${mix(WOOD_DARK, 80, 'var(--color-bg)')})` }} />
          <span className="absolute bottom-[7px] left-0 w-[10px] h-[11px] rounded-full" style={{ background: mix('var(--color-ok)', 52, 'var(--color-bg)') }} />
          <span className="absolute bottom-[7px] right-0 w-[10px] h-[11px] rounded-full" style={{ background: mix('var(--color-ok)', 52, 'var(--color-bg)') }} />
          <span className="absolute bottom-[11px] left-[5.5px] w-[11px] h-[14px] rounded-full" style={{ background: mix('var(--color-ok)', 68, 'var(--color-bg)') }} />
          <span className="absolute bottom-[18px] left-[2px] w-[7px] h-[8px] rounded-full" style={{ background: mix('var(--color-ok)', 60, 'var(--color-bg)') }} />
        </span>
      </Standee>
    </>
  );
}
// A soft flat rug that grounds a seating group (lies in the floor plane).
function Rug({ x, y, w, h, accent }: { x: number; y: number; w: number; h: number; accent: string }) {
  return (
    <div className="absolute rounded-full" style={{
      left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%`,
      background: mix(accent, 14, 'var(--color-bg)'),
      border: `2px solid ${mix(accent, 24, 'var(--color-bg)')}`,
    }} />
  );
}
function CoffeeTable3D({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Ground x={x - 0.6} y={y - 0.6} w={7} d={7} />
      <Cuboid x={x} y={y} w={5.6} d={5.6} h={10} c={woodTop} r={999}
        topStyle={{ background: `radial-gradient(circle at 35% 30%, ${mix(WOOD, 74, 'var(--color-bg)')}, ${woodEdge})` }} />
      <div className="absolute w-[4px] h-[4px] rounded-full bg-white" style={{ left: `${x + 1.2}%`, top: `${y + 1.4}%`, transform: 'translateZ(10px)' }} />
      <div className="absolute w-[4px] h-[4px] rounded-full bg-white" style={{ left: `${x + 3.4}%`, top: `${y + 3}%`, transform: 'translateZ(10px)' }} />
    </>
  );
}
function Easel3D({ x, y, accent }: { x: number; y: number; accent: string }) {
  return (
    <Standee x={x} y={y}>
      <span className="relative block w-[26px] h-[30px]">
        <span className="absolute left-[3px] top-0 w-[20px] h-[15px] rounded-[2px] border-[1.5px] rotate-[3deg]"
          style={{ background: 'var(--color-card)', borderColor: woodEdge }} />
        <span className="absolute left-[7px] top-[3px] w-[12px] h-[9px] rounded-[1px] rotate-[3deg]" style={{ background: mix(accent, 45, 'var(--color-card)') }} />
        <span className="absolute left-[2px] top-[13px] w-[2px] h-[16px] rotate-[9deg]" style={{ background: woodEdge }} />
        <span className="absolute right-[2px] top-[13px] w-[2px] h-[16px] rotate-[-9deg]" style={{ background: woodEdge }} />
      </span>
    </Standee>
  );
}

// Intake tray (kernel queued[]) + DEAD drawer (kernel dead[]) at the Front desk.
// Queued papers are little raised blocks; the labels are billboards so they read.
function TrayAndDrawer({ queued, dead }: { queued: number; dead: number }) {
  return (
    <>
      <div className="absolute rounded-[5px] border-[1.5px] border-dashed"
        style={{ left: '40%', top: '26%', width: '26%', height: '52%', borderColor: mix('var(--color-ink3)', 45, 'transparent') }}
        title={`${queued} queued job${queued === 1 ? '' : 's'} in the intake tray`} />
      {Array.from({ length: Math.min(queued, 3) }).map((_, i) => (
        <Cuboid key={i} x={43 + i * 7.5} y={38} w={6} d={24} h={3} c="var(--color-card)" r={1} />
      ))}
      {queued > 3 && (
        <Standee x={64} y={58}><span className="text-[9px] font-mono text-ink2 bg-card rounded px-1 border border-border">+{queued - 3}</span></Standee>
      )}
      <div className="absolute rounded-[5px] border-[1.5px]"
        style={{
          left: '71%', top: '26%', width: '24%', height: '52%',
          borderColor: mix('var(--color-rec)', dead > 0 ? 60 : 35, 'transparent'),
          background: mix('var(--color-rec)', dead > 0 ? 18 : 8),
        }}
        title={dead > 0 ? `${dead} dead-lettered job${dead === 1 ? '' : 's'}` : 'Dead letters — empty'} />
      <Standee x={83} y={56}>
        <span className="text-[8px] font-mono font-700 tracking-wider whitespace-nowrap" style={{ color: 'var(--color-rec)' }}>
          DEAD{dead > 0 ? ` ${dead}` : ''}
        </span>
      </Standee>
    </>
  );
}

function Furniture({ z, snap }: { z: Zone; snap: KernelSnapshot | null }) {
  switch (z.id) {
    case 'library': return (<>
      <Shelf3D x={8} y={4} w={40} />
      <Desk3D x={30} y={48} w={42} />
      <Monitor3D x={51} y={53} />
      <Chair3D x={48} y={72} accent={z.accent} />
    </>);
    case 'web': return (<>
      <Desk3D x={22} y={46} w={50} />
      <Monitor3D x={34} y={51} /><Monitor3D x={60} y={51} />
      <Chair3D x={44} y={70} accent={z.accent} />
    </>);
    case 'studio': return (<>
      <Desk3D x={16} y={50} w={40} />
      <Chair3D x={32} y={74} accent={z.accent} />
      <Easel3D x={76} y={46} accent={z.accent} />
    </>);
    case 'board': return (<>
      <Desk3D x={30} y={52} w={38} />
      <Monitor3D x={48} y={57} />
      <Chair3D x={46} y={76} accent={z.accent} />
      <Plant3D x={88} y={72} />
    </>);
    case 'meeting': return (<>
      <Rug x={12} y={26} w={76} h={58} accent={z.accent} />
      <Desk3D x={26} y={38} w={48} d={30} round />
      <Chair3D x={14} y={48} accent={z.accent} /><Chair3D x={82} y={48} accent={z.accent} />
      <Chair3D x={46} y={14} accent={z.accent} /><Chair3D x={46} y={78} accent={z.accent} />
    </>);
    case 'workshop': return (<>
      <Shelf3D x={40} y={4} w={44} />
      <Desk3D x={14} y={48} w={46} />
      <Monitor3D x={33} y={53} />
      <Chair3D x={32} y={72} accent={z.accent} />
    </>);
    case 'pool': return (<>
      <Rug x={26} y={20} w={48} h={58} accent="var(--color-accent)" />
      <Sofa3D x={8} y={62} w={20} />
      <Sofa3D x={72} y={62} w={20} />
      <CoffeeTable3D x={46} y={42} />
      <Plant3D x={94} y={30} />
      <Plant3D x={4} y={30} />
    </>);
    case 'breakroom': return (<>
      {/* a resting lounge: a rug and a long couch the scheduled folk sit on, a plant */}
      <Rug x={14} y={24} w={64} h={56} accent={z.accent} />
      <Sofa3D x={8} y={22} w={44} d={16} />
      <Plant3D x={90} y={30} />
    </>);
    case 'frontdesk': return (<>
      {/* reception counter */}
      <Desk3D x={8} y={30} w={26} d={26} h={20} />
      <TrayAndDrawer queued={snap?.counts.queued ?? 0} dead={snap?.counts.dead ?? 0} />
    </>);
    case 'yourdesk': return (<>
      <Desk3D x={28} y={36} w={42} d={24} />
      <Monitor3D x={48} y={44} />
      <Chair3D x={46} y={68} accent={z.accent} />
      <Plant3D x={90} y={40} />
    </>);
    default: return null;
  }
}

// ─── A room ───────────────────────────────────────────────────────────────────
// A carpeted area with two extruded back walls (the floor-plane top and right
// edges — the two upper boundaries under the iso camera), a billboard name sign
// riding the wall corner, and its furniture. The pool is an open lounge instead.
function Room({ z, snap }: { z: Zone; snap: KernelSnapshot | null }) {
  const isPool = z.id === 'pool';
  const wallTop = mix(z.accent, 34, 'var(--color-card)');
  const wallSide = mix(z.accent, 26, 'var(--color-bg)');
  return (
    <div
      className={`absolute rounded-[8px] ${isPool ? 'border-[1.5px] border-dashed' : ''}`}
      style={{
        left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%`,
        transformStyle: 'preserve-3d',
        borderColor: isPool ? mix(z.accent, 30, 'transparent') : undefined,
        background: isPool
          ? 'color-mix(in srgb, var(--color-ink3) 5%, transparent)'
          : `radial-gradient(120% 100% at 20% 0%, ${mix(z.accent, 16, 'var(--color-card)')}, ${mix(z.accent, 8, 'var(--color-bg)')})`,
        boxShadow: isPool ? 'none' : `inset 0 0 0 1px ${mix(z.accent, 24, 'transparent')}`,
      }}
    >
      {!isPool && (<>
        {/* back wall (floor top edge) — visible face is its interior side */}
        <div className="absolute" style={{
          left: 0, top: 0, width: '100%', height: `${WALL_H}px`,
          transformOrigin: 'top', transform: 'rotateX(90deg)',
          background: `linear-gradient(${shade(wallTop, 84)}, ${wallTop})`,
          boxShadow: `inset 0 -2px 0 ${mix(z.accent, 40, 'transparent')}`,
          borderRadius: '0 0 3px 3px',
        }}>
          {/* wall art / pinboards, drawn on the wall plane itself */}
          {z.id === 'board' && [16, 34, 52, 70].map((l) => (
            <span key={l} className="absolute w-[16px] h-[11px] rounded-[1.5px] border"
              style={{ left: `${l}%`, bottom: '9px', background: mix(z.accent, 30, 'var(--color-card)'), borderColor: mix('var(--color-card)', 35, wallSide) }} />
          ))}
          {z.id === 'frontdesk' && (
            <span className="absolute left-[8%] bottom-[7px] w-[22%] h-[15px] rounded-[2px] border-[1.5px]"
              style={{ background: mix(WOOD, 26), borderColor: mix(WOOD, 48) }}>
              <span className="absolute left-[18%] top-[22%] w-[4px] h-[5px] rounded-[1px] bg-card border border-border" />
              <span className="absolute left-[58%] top-[38%] w-[4px] h-[5px] rounded-[1px] bg-card border border-border" />
            </span>
          )}
          {z.id === 'web' && (
            <span className="absolute right-[6%] bottom-[6px] w-[10px] h-[18px] rounded-[2px]"
              style={{ background: mix(z.accent, 55) }} title="MCP door — external connectors" />
          )}
        </div>
        {/* side wall (floor right edge) — the darker of the two */}
        <div className="absolute" style={{
          left: '100%', top: 0, width: `${WALL_H}px`, height: '100%',
          transformOrigin: 'left', transform: 'rotateY(-90deg)',
          background: `linear-gradient(90deg, ${wallSide}, ${shade(wallSide, 78)})`,
          borderRadius: '0 3px 3px 0',
        }} />
      </>)}
      {/* Room name + subtitle, written flat inside the room. Both live directly in the
          room div, which sits in the floor plane, so they lie on the floor like painted
          markings rather than standing up as a sign — no Standee/UNISO here on purpose.
          Every room labels itself the same way, walls or not (the pool has none). */}
      <span className="absolute left-2.5 bottom-[13px] right-2 text-[10px] uppercase tracking-[0.12em] font-700 truncate select-none"
        style={{ color: `color-mix(in srgb, ${z.accent} 62%, var(--color-ink))`, opacity: 0.9 }}>
        {z.label}
      </span>
      <span className="absolute left-2.5 bottom-1 right-2 text-[8.5px] font-mono text-ink3/75 truncate">{z.sub}</span>
      <Furniture z={z} snap={snap} />
    </div>
  );
}

// ─── The floor ────────────────────────────────────────────────────────────────

function Floor({ agents, running, waiting, jobByAgent, snap, activity, onOpen }: {
  agents: Agent[];
  running: Set<string>;
  waiting: Set<string>;
  jobByAgent: Map<string, KernelJob>;
  snap: KernelSnapshot | null;
  activity: AppEvent[];
  onOpen: (a: Agent) => void;
}) {
  // A working agent's live room + speech line, updated by its own stream.
  const cam = useCamera();
  const [liveRoom, setLiveRoom] = useState<Record<string, ZoneId>>({});
  const [liveLine, setLiveLine] = useState<Record<string, Line | null>>({});

  // ── Zoom-to-fit ─────────────────────────────────────────────────────────────
  // Scale the fixed-size scene so it fills the available box. We watch the box with a
  // ResizeObserver rather than a window resize listener because the office also changes
  // size when the sidebar collapses or the ticker wraps — events `window.resize` never
  // fires for. `contain` (min of the two ratios) keeps the whole floor visible; using
  // max would crop rooms off the edges.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return; // tab hidden / not laid out yet — keep the last scale
      const fit = Math.min(width / SCENE_W, height / SCENE_H);
      setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fit)));
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Chat runs never enter the worker pool, so the kernel snapshot and agent.run.*
  // events don't know about them — track chat.run.started here so chat agents (the
  // assistant) walk the floor too. Cleared when the run's own stream ends.
  const [chatRuns, setChatRuns] = useState<Record<string, string>>({});
  useEffect(() => {
    const e = activity[0];
    if (!e || e.type !== 'chat.run.started') return;
    const p = e.payload as { runId?: string; agentId?: string | null } | undefined;
    if (p?.runId) setChatRuns((m) => ({ ...m, [p.agentId || 'assistant']: p.runId! }));
  }, [activity]);

  // Tile refreshes are kernel jobs with NO agentId (kind "tile" — the agent is resolved
  // at run time), and they announce via tile.run.* instead of agent.run.*. Track them
  // here so the tile's agent walks to the Board wall while it refreshes.
  const [tileRuns, setTileRuns] = useState<Record<string, string>>({}); // agentId → tile title
  useEffect(() => {
    const e = activity[0];
    if (!e || !e.type.startsWith('tile.run.')) return;
    const agentId = (e.payload?.agentId as string) || '';
    if (!agentId) return;
    if (e.type === 'tile.run.started') {
      setTileRuns((m) => ({ ...m, [agentId]: e.label || 'a tile' }));
      setLiveRoom((r) => ({ ...r, [agentId]: 'board' }));
      setLiveLine((m) => ({ ...m, [agentId]: { kind: 'action', text: `refreshing “${e.label || 'tile'}”` } }));
    } else { // completed / failed
      setTileRuns((m) => { if (!m[agentId]) return m; const n = { ...m }; delete n[agentId]; return n; });
      setLiveLine((m) => ({ ...m, [agentId]: null }));
    }
  }, [activity]);

  // A tile job's id isn't in the tile.run.* payload, but it IS the kernel snapshot's
  // running kind:"tile" job — when there's exactly one of each, pair them so the tile
  // agent's balloon streams the run's thinking/tool frames.
  const tileRunId = useMemo(() => {
    const jobs = (snap?.running ?? []).filter((j) => j.kind === 'tile');
    const ids = Object.keys(tileRuns);
    return ids.length === 1 && jobs.length === 1 ? { [ids[0]]: jobs[0].id } : {} as Record<string, string>;
  }, [snap, tileRuns]);

  // Ambient life: every few seconds the folk idling in the pool stroll a little, like
  // people milling around while they wait for work.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 8000);
    return () => clearInterval(t);
  }, []);

  // A freshly hired assistant: for a few seconds we start them at the front desk so the
  // position transition walks them into the pool, and float a welcome toast. `atDoor` is
  // true only for the first paint after arrival (their start point); once cleared the
  // normal pool slot takes over and the position transition strolls them in.
  const [newHire, setNewHire] = useState<{ id: string; name: string } | null>(null);
  const [atDoor, setAtDoor] = useState(false);
  useEffect(() => onHire((a) => {
    setNewHire({ id: a.id, name: firstName(a.name) });
    setAtDoor(true);
    const walk = setTimeout(() => setAtDoor(false), 120);          // release → walk to pool
    const clear = setTimeout(() => setNewHire((n) => (n?.id === a.id ? null : n)), 4200);
    return () => { clearTimeout(walk); clearTimeout(clear); };
  }), []);

  // Agents with a job sitting in the kernel's queue (its paper is in the front-desk tray).
  // They walk to the Front desk to "pick up" the work; when it flips to running they head
  // into the room. A tile job has no agentId, so those stay as tray papers only.
  const queuedByAgent = useMemo(() => {
    const s = new Set<string>();
    for (const j of snap?.queued ?? []) if (j.agentId) s.add(j.agentId);
    return s;
  }, [snap]);

  const placed: Placed[] = useMemo(() => agents.map((a) => {
    let presence = presenceOf(a, running, waiting);
    // The App `running` set is built from the fire-and-forget agent.run.* event feed, which
    // can be missed (run started on another screen, dropped frame) — leaving a person idle in
    // the pool while the wallboard, fed by the authoritative kernel snapshot, says "1 running".
    // The snapshot self-heals (re-broadcast on every change), so trust it too: if the kernel
    // has a running job for this agent, they're working. (Internal agents like the KB
    // Maintainer are the common case — their runs are frequent and short.)
    const isWorking = chatRuns[a.id] || tileRuns[a.id] || jobByAgent.has(a.id);
    if (presence !== 'waiting' && isWorking) presence = 'working';
    // A queued (not-yet-running) job → the agent walks to the front desk to pick up the paper.
    // Working always wins (a queued+running agent is mid-run, not still collecting).
    else if (presence !== 'waiting' && !isWorking && queuedByAgent.has(a.id)) presence = 'queued';
    let zone: ZoneId = 'pool';
    if (presence === 'working') zone = liveRoom[a.id] ?? (tileRuns[a.id] ? 'board' : 'library');
    else if (presence === 'queued') zone = 'frontdesk';
    else if (presence === 'waiting') zone = 'yourdesk';
    // Scheduled agents aren't idle — they're off the clock until their next run, so they wait
    // in the Break room (with their clock chip) instead of milling in the general pool.
    else if (presence === 'scheduled') zone = 'breakroom';
    const line: Line | null = presence === 'working' ? (liveLine[a.id] ?? { kind: 'thought', text: 'thinking…' })
      : presence === 'queued' ? { kind: 'action', text: 'picking up work…' }
      : presence === 'waiting' ? { kind: 'action', text: 'Waiting for your approval' }
      : null;
    return { agent: a, presence, zone, line };
  }), [agents, running, waiting, liveRoom, liveLine, chatRuns, tileRuns, jobByAgent, queuedByAgent]);

  const byZone = useMemo(() => {
    const m = new Map<ZoneId, Placed[]>();
    for (const p of placed) { const l = m.get(p.zone) ?? []; l.push(p); m.set(p.zone, l); }
    return m;
  }, [placed]);

  const counts = snap?.counts;
  const lastEvent = activity[0];

  return (
    // No card frame: the office sits directly on the page canvas so the scene's own
    // backdrop (which is --color-bg tinted toward accent) fades edge-to-edge into it.
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Zoom wrapper: fills whatever space the page gives us and scales the fixed-size
          scene to fit. The scene MUST keep its intrinsic pixel size and be scaled by a
          transform rather than stretched — furniture heights, wall depth (WALL_H) and the
          people are all in px while the floor plan is in %, so resizing the box directly
          would pull those two coordinate systems apart and break the isometric illusion.
          One `scale` moves both together, so the geometry is identical at every size. */}
      <div ref={boxRef} className="flex-1 min-h-0 grid place-items-center overflow-hidden">
      <div style={{
        width: SCENE_W, height: SCENE_H, flex: 'none',
        transform: `scale(${zoom})`,
        transformOrigin: 'center',
      }}>
      {/* the stage: a soft backdrop with the iso floor floating in it. Also the drag
          surface for the camera — grabbing anywhere in the empty space spins the office. */}
      <div className="relative w-full h-full" {...cam.handlers} style={{
        cursor: cam.dragging ? 'grabbing' : 'grab',
        touchAction: 'none', // let horizontal drags rotate instead of scrolling the page
        // Backdrop sits in the page's own palette: the canvas colour, lifted toward the
        // theme accent at the top so the scene has depth without introducing a hue the
        // rest of the app never uses. An elliptical falloff (rather than a full-bleed
        // rectangle) means the tint dies out before the edges, so there is no square
        // seam against the page — the glow just ends.
        background: `radial-gradient(75% 70% at 50% 12%, ${mix('var(--color-accent)', 11, 'var(--color-bg)')}, transparent 70%)`,
      }}>
        <style>{`@keyframes ofc-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}
@keyframes ofc-ask{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb, var(--color-orange) 45%, transparent)}50%{box-shadow:0 0 0 5px transparent}}
@keyframes ofc-zz{0%,100%{opacity:.35;transform:translateY(0)}50%{opacity:.9;transform:translateY(-3px)}}
@keyframes ofc-leg-a{0%,100%{transform:rotate(30deg)}50%{transform:rotate(-30deg)}}
@keyframes ofc-leg-b{0%,100%{transform:rotate(-30deg)}50%{transform:rotate(30deg)}}
@keyframes ofc-step{0%,100%{transform:translateY(0)}25%{transform:translateY(-1.6px)}50%{transform:translateY(0)}75%{transform:translateY(-1.6px)}}`}</style>

        {/* reset view — only offered once the office is actually off its default angle */}
        {Math.abs(cam.spin - ISO_Z_DEFAULT) > 1 && (
          <button type="button" onClick={cam.reset}
            className="absolute right-[3%] top-[2.5%] z-20 font-mono text-[10.5px] text-ink3 hover:text-ink px-2.5 py-[3px] rounded-full border border-border bg-card/80 shadow-soft">
            ⟲ reset view
          </button>
        )}

        {/* wallboard — live kernel counts, floating above the scene in screen space */}
        <div className="absolute left-1/2 -translate-x-1/2 top-[2.5%] z-20 font-mono text-[10.5px] text-ink3 tracking-wide whitespace-nowrap px-2.5 py-[3px] rounded-full border border-border bg-card/80 shadow-soft">
          <span className="text-accent-dark">▶ {counts?.running ?? 0} running</span>
          <span className="mx-1.5">·</span>
          <span>⋯ {counts?.queued ?? 0} queued</span>
          <span className="mx-1.5">·</span>
          <span style={{ color: (counts?.dead ?? 0) > 0 ? 'var(--color-rec)' : undefined }}>✕ {counts?.dead ?? 0} dead</span>
        </div>

        {/* welcome toast — a freshly hired assistant just walked in */}
        {newHire && (
          <div className="absolute left-1/2 -translate-x-1/2 top-[10%] z-30 flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-accent/50 bg-card shadow-pop text-[12px] text-ink"
            style={{ animation: 'ofc-bob 1.6s ease-in-out infinite' }}>
            <span className="w-5 h-5 rounded-full grid place-items-center text-white text-[9px] font-650 flex-none" style={{ background: avatarColor(newHire.id) }}>
              {newHire.name.slice(0, 2).toUpperCase()}
            </span>
            <span><span className="font-600">{newHire.name}</span> joined the team 🎉</span>
          </div>
        )}

        {/* the floor slab, tilted into isometric view and spun by the drag camera.
            `--ofc-uniso` is published here so every billboard below (people, monitors,
            room signs) counter-rotates to match without a prop threading through. */}
        <div className="absolute left-1/2 top-1/2" style={{
          width: '86%', aspectRatio: '16 / 9',
          transform: `translate(-50%, -47%) ${isoOf(cam.spin)}`,
          ['--ofc-uniso' as string]: unisoOf(cam.spin),
          transformStyle: 'preserve-3d',
          borderRadius: 14,
          // Wood floor: fine plank grain (thin lines) over wider plank seams, on a warm
          // gradient, with a soft radial "skylight" so the middle of the floor feels lit.
          background: `radial-gradient(120% 90% at 50% 8%, color-mix(in srgb, var(--color-card) 55%, transparent), transparent 60%),
            repeating-linear-gradient(90deg, transparent 0 42px, color-mix(in srgb, ${WOOD_DARK} 8%, transparent) 42px 43px),
            repeating-linear-gradient(90deg, transparent 0 87px, color-mix(in srgb, ${WOOD_DARK} 16%, transparent) 87px 89px),
            linear-gradient(color-mix(in srgb, ${WOOD} 14%, var(--color-bg)), color-mix(in srgb, ${WOOD} 6%, var(--color-bg)))`,
          boxShadow: `0 0 0 1px color-mix(in srgb, ${WOOD_DARK} 30%, transparent)`,
        }}>
          {/* slab sides — the floor reads as a thick platform, like a diorama base */}
          <div className="absolute" style={{
            left: 0, top: '100%', width: '100%', height: '18px',
            transformOrigin: 'top', transform: 'rotateX(-90deg)',
            background: `linear-gradient(${shade(woodEdge, 62)}, ${shade(woodEdge, 40)})`,
            borderRadius: '0 0 6px 6px',
          }} />
          <div className="absolute" style={{
            left: 0, top: 0, width: '18px', height: '100%',
            transformOrigin: 'left', transform: 'rotateY(90deg)',
            background: `linear-gradient(90deg, ${shade(woodEdge, 52)}, ${shade(woodEdge, 34)})`,
            borderRadius: '6px 0 0 6px',
          }} />

          {/* rooms */}
          {ZONES.map((z) => <Room key={z.id} z={z} snap={snap} />)}

          {/* people */}
          {placed.map((p) => {
            const zone = ZONE_BY_ID.get(p.zone)!;
            const occupants = byZone.get(p.zone)!;
            const idx = occupants.indexOf(p);
            let { left, top } = slotIn(zone, idx, occupants.length);
            // Idle folk mill around the pool; scheduled folk sit still on the break-room
            // couch (no drift — they're resting), so only idle pool people drift.
            if (p.zone === 'pool' && p.presence === 'idle') {
              const d = drift(p.agent.id, tick);
              left += d.dx; top += d.dy;
            }
            // A just-hired assistant enters through the front desk, then walks to their spot.
            if (atDoor && p.agent.id === newHire?.id) {
              const fd = ZONE_BY_ID.get('frontdesk')!;
              left = fd.x + fd.w / 2; top = fd.y + fd.h / 2;
            }
            return (
              <Person key={p.agent.id} placed={p} left={left} top={top} onOpen={() => onOpen(p.agent)}
                onLiveRoom={(z) => setLiveRoom((r) => (r[p.agent.id] === z ? r : { ...r, [p.agent.id]: z }))}
                onLiveLine={(l) => setLiveLine((m) => ({ ...m, [p.agent.id]: l }))}
                onRunEnded={() => {
                  setChatRuns((m) => { if (!m[p.agent.id]) return m; const n = { ...m }; delete n[p.agent.id]; return n; });
                  setTileRuns((m) => { if (!m[p.agent.id]) return m; const n = { ...m }; delete n[p.agent.id]; return n; });
                }}
                runId={p.presence === 'working' ? jobByAgent.get(p.agent.id)?.id ?? chatRuns[p.agent.id] ?? tileRunId[p.agent.id] ?? null : null} />
            );
          })}
        </div>
      </div>
      </div>
      </div>

      {/* ticker — the floor narrates itself. Deliberately OUTSIDE the zoom wrapper so
          its text stays at a readable size no matter how far the scene is scaled down. */}
      <div className="flex-none flex items-center gap-2.5 px-4 py-2 border-t border-border font-mono text-[10.5px] text-ink3 bg-sidebar/50">
        <span className="an-pulse w-[7px] h-[7px] rounded-full bg-accent flex-none" />
        <span className="truncate">
          {lastEvent ? `${lastEvent.type}${lastEvent.label ? ' · ' + lastEvent.label : ''}` : 'quiet — no recent events'}
        </span>
      </div>
    </div>
  );
}

// ─── A person ─────────────────────────────────────────────────────────────────
// A little upright figure (hair, face with eyes, body, LEGS) standing on the floor
// as a camera-facing billboard, with a contact shadow in the floor plane. The CSS
// transition on the anchor's left/top makes them glide between rooms — and while
// the position is actually changing, a walk cycle swings the legs so they visibly
// WALK there and back. While working, subscribes to their run stream and reports
// room + speech line upward.
const WALK_MS = 1100;

function Person({ placed, left, top, runId, onOpen, onLiveRoom, onLiveLine, onRunEnded }: {
  placed: Placed;
  left: number;
  top: number;
  runId: string | null;
  onOpen: () => void;
  onLiveRoom: (z: ZoneId) => void;
  onLiveLine: (line: Line | null) => void;
  onRunEnded: () => void;
}) {
  const { agent, presence, line } = placed;
  const color = avatarColor(agent.id);
  const think = useRef('');
  const [hover, setHover] = useState(false);

  // Walk cycle: whenever the target floor position moves, swing the legs for the
  // duration of the transition, and face the direction of travel.
  const prev = useRef<{ left: number; top: number } | null>(null);
  const [walking, setWalking] = useState(false);
  const facing = useRef(1);
  useEffect(() => {
    const p = prev.current;
    prev.current = { left, top };
    if (!p) return;
    const dx = left - p.left, dy = top - p.top;
    if (Math.abs(dx) + Math.abs(dy) < 0.4) return;
    if (Math.abs(dx) > 0.3) facing.current = dx > 0 ? 1 : -1;
    setWalking(true);
    const t = setTimeout(() => setWalking(false), WALK_MS + 80);
    return () => clearTimeout(t);
  }, [left, top]);

  useEffect(() => {
    think.current = '';
    if (!runId) return;
    const stop = subChat(runId, (raw) => {
      const e = raw as { type?: string; text?: string; name?: string };
      if (e.type === 'tool_start' && e.name) {
        const z = TOOL_ZONE[e.name];
        if (z) onLiveRoom(z);
        onLiveLine({ kind: 'action', text: e.name });
        think.current = '';
      } else if (e.type === 'thinking' && e.text) {
        think.current = (think.current + e.text).slice(-120);
        onLiveLine({ kind: 'thought', text: think.current.trim() });
      } else if (e.type === 'token' && !think.current) {
        onLiveLine({ kind: 'action', text: 'writing the answer…' });
      } else if (e.type === 'done' || e.type === 'gone' || e.type === 'error') {
        onLiveLine(null);
        onRunEnded();
      }
    }, { attach: true });
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const showBalloon = Boolean(line) || hover;
  const balloonKind: 'thought' | 'action' | 'ask' | 'tip' =
    presence === 'waiting' ? 'ask' : line ? line.kind : 'tip';
  const balloonText = line ? line.text : `${firstName(agent.name)} · ${roleOf(agent)} · ${LABEL[presence]}`;
  const clock = presence === 'scheduled' && agent.schedule?.kind === 'cron' ? timeOf(agent.schedule) : null;
  // Scheduled agents rest (sit) in the break room until their slot; everyone else stands.
  const sitting = presence === 'scheduled';

  return (
    // The floor anchor: lives in the floor plane, carries the movement transition
    // and the contact shadow. The figure itself is an upright billboard child.
    <div className="absolute w-0 h-0" style={{
      left: `${left}%`, top: `${top}%`,
      transformStyle: 'preserve-3d',
      transition: `left ${WALK_MS}ms cubic-bezier(.45,.05,.55,.95), top ${WALK_MS}ms cubic-bezier(.45,.05,.55,.95)`,
    }}>
      {/* contact shadow, flat on the floor */}
      <div className="absolute rounded-full" style={{
        left: '-13px', top: '-7px', width: '26px', height: '14px',
        background: 'radial-gradient(closest-side, rgba(0,0,0,.3), transparent)',
      }} />

      {/* the billboard: stands upright, always faces the camera */}
      <div className="absolute w-0 h-0" style={{ transform: UNISO, transformStyle: 'preserve-3d' }}>
        <button
          type="button"
          onClick={onOpen}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          title={`${agent.name} — ${LABEL[presence]} · open runs & conversation`}
          className="absolute bottom-0 left-0 -translate-x-1/2 flex flex-col items-center cursor-pointer"
        >
          {/* balloon: thought (italic) / action (mono) / ask (amber, pulsing) / hover tip */}
          {showBalloon && (
            <div
              className={`absolute bottom-full mb-2 w-max max-w-[200px] px-2 py-1 rounded-[9px] text-[10.5px] leading-snug shadow-soft z-20 border ${
                balloonKind === 'ask' ? 'border-orange text-ink'
                : 'bg-card border-border text-ink2'
              } ${balloonKind === 'thought' ? 'italic text-ink3 rounded-[12px]' : ''} ${balloonKind === 'action' ? 'font-mono text-[10px]' : ''}`}
              style={balloonKind === 'ask'
                ? { background: mix('var(--color-orange)', 16), animation: 'ofc-ask 1.6s ease-in-out infinite' }
                : undefined}
            >
              <span className="line-clamp-2 break-words">{balloonText}</span>
              {balloonKind === 'thought' ? (
                <span className="absolute top-full left-[46%] mt-[1px] w-[5px] h-[5px] rounded-full bg-card border border-border" />
              ) : (
                <span className={`absolute top-full left-1/2 -translate-x-1/2 -mt-[4px] w-2 h-2 rotate-45 border-r border-b ${
                  balloonKind === 'ask' ? 'border-orange' : 'bg-card border-border'}`}
                  style={balloonKind === 'ask' ? { background: mix('var(--color-orange)', 16) } : undefined} />
              )}
            </div>
          )}

          {/* scheduled folk are resting in the break room until their slot: a floating sleep
              sign, with the clock chip below it so you can still read the next run time. */}
          {presence === 'scheduled' && !showBalloon && (
            <span className="absolute bottom-full mb-0.5 flex flex-col items-center gap-0.5 whitespace-nowrap">
              <span className="text-[10px] text-ink3 leading-none" style={{ animation: 'ofc-zz 2.6s ease-in-out infinite' }}>💤</span>
              {clock && (
                <span className="font-mono text-[8px] text-ink3 bg-card border border-border rounded-[4px] px-1 shadow-soft">⏰ {clock}</span>
              )}
            </span>
          )}

          {/* zz for napping (paused) folk */}
          {presence === 'paused' && !showBalloon && (
            <span className="absolute bottom-full mb-0.5 text-[8px] text-ink3" style={{ animation: 'ofc-zz 2.6s ease-in-out infinite' }}>z z</span>
          )}

          {/* the figure — head, torso, legs; legs swing while walking, and fold forward when
              a scheduled agent is sitting (resting in the break room). */}
          <span className="relative flex flex-col items-center" style={{
            opacity: presence === 'paused' ? 0.45 : 1,
            transform: facing.current < 0 ? 'scaleX(-1)' : undefined,
            animation: walking ? `ofc-step ${WALK_MS / 2}ms ease-in-out infinite`
              : presence === 'working' ? 'ofc-bob 1.4s ease-in-out infinite' : undefined,
          }}>
            <span className="relative w-[13px] h-[13px]" style={sitting ? { marginBottom: '2px' } : undefined}>
              <span className="absolute inset-0 rounded-full" style={{ background: '#E8C39E' }} />
              <span className="absolute -top-[1px] left-0 w-full h-[7px] rounded-t-full"
                style={{ background: `color-mix(in srgb, ${color} 55%, #33251C)` }} />
              <span className="absolute top-[7px] left-[3px] w-[2px] h-[2px] rounded-full"
                style={{ background: '#33251C', boxShadow: '4px 0 0 #33251C' }} />
            </span>
            <span className="relative -mt-[2px]" style={{
              width: '18px', height: sitting ? '10px' : '13px',
              background: color, borderRadius: '8px 8px 5px 5px',
            }}>
              <span className={`absolute -bottom-1 -right-2 w-[9px] h-[9px] rounded-full ring-2 ring-bg ${DOT[presence]}`} />
            </span>
            {sitting ? (
              // Seated: thighs jut forward (short horizontal bars) so the figure reads as
              // sitting rather than standing — no walk animation.
              <span className="flex gap-[4px] -mt-[1px]">
                <span className="w-[7px] h-[4px] rounded-[2px]" style={{ background: '#2E3440' }} />
                <span className="w-[7px] h-[4px] rounded-[2px]" style={{ background: '#2E3440' }} />
              </span>
            ) : (
              <span className="flex gap-[4px] -mt-[1px]">
                <span className="w-[4px] h-[8px] rounded-b-[2px]"
                  style={{ background: '#2E3440', transformOrigin: 'top center', animation: walking ? `ofc-leg-a ${WALK_MS / 2}ms ease-in-out infinite` : undefined }} />
                <span className="w-[4px] h-[8px] rounded-b-[2px]"
                  style={{ background: '#2E3440', transformOrigin: 'top center', animation: walking ? `ofc-leg-b ${WALK_MS / 2}ms ease-in-out infinite` : undefined }} />
              </span>
            )}
          </span>

          {/* name tag */}
          <span className="mt-1 text-[9.5px] leading-none text-ink2 font-500 max-w-[72px] truncate px-1 py-[1px] rounded-[4px]"
            style={{ background: 'color-mix(in srgb, var(--color-bg) 78%, transparent)' }}>
            {firstName(agent.name)}
          </span>
        </button>
      </div>
    </div>
  );
}
