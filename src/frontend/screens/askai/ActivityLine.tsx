import { Icon } from '../../components/chrome/Icon';
import type { ChatMsg, SubStep, ToolCall } from './model';

// ─── activity line ────────────────────────────────────────────────────────────
// A one-liner under the thought saying what's running RIGHT NOW — and, where we can
// tell, what it's working ON ("Reading a page · docs.python.org", not just "web_fetch").
//
// Why it exists: with verbose off there are no tool cards, and a turn that isn't
// currently emitting thinking looks frozen — the model can spend a long time inside a
// single tool with nothing on screen. This is the "still working" signal.
//
// It reports the DEEPEST running step: if `filer` delegated to a subagent that's running
// `kb_read`, the useful answer is "kb_read", with the agent that's doing it named
// alongside. Falls back to the parent's own running tool, then to a bare "Working…" so
// there is always something moving while the turn is live.

/** Args arrive as the JSON text the backend rendered (`_arg_text`). Best-effort parse —
 *  while a call is streaming this can be partial, so a failure just means "no gist". */
function parseArgs(input?: string): Record<string, unknown> {
  if (!input) return {};
  try {
    const v = JSON.parse(input);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** A URL's recognisable part: host + a short path tail, no scheme/query noise. */
function prettyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const tail = u.pathname.replace(/\/$/, '');
    const last = tail.split('/').filter(Boolean).pop() || '';
    return last ? `${u.hostname}/${last}` : u.hostname;
  } catch { return raw.replace(/^https?:\/\//, '').split('?')[0]; }
}

/** A bundle path's leaf: `topics/deep-work.md` → `deep-work`. */
function prettyPath(raw: string): string {
  const leaf = raw.split('/').filter(Boolean).pop() || raw;
  return leaf.replace(/\.md$/i, '');
}

/** Verb + gist for a running tool call. `null` gist = nothing worth adding. */
function describe(name: string, args: Record<string, unknown>): { verb: string; gist: string } {
  const action = str(args.action);
  const query = str(args.query);
  const path = str(args.path);
  const url = str(args.url);
  const subject = str(args.subject);
  const text = str(args.text);

  switch (name) {
    case 'web_fetch':
      return { verb: 'Reading a page', gist: url ? prettyUrl(url) : '' };
    case 'browser':
      return { verb: action === 'goto' ? 'Opening a page' : `Browser · ${action || 'working'}`,
               gist: url ? prettyUrl(url) : '' };
    case 'kb_read':
      // One tool, several operations — the action is the meaningful part.
      if (action === 'search') return { verb: 'Searching notes', gist: query };
      if (action === 'read') return { verb: 'Reading a note', gist: path ? prettyPath(path) : '' };
      if (action === 'list') return { verb: 'Listing notes', gist: path ? prettyPath(path) : '' };
      return { verb: 'Reading notes', gist: query || (path ? prettyPath(path) : '') };
    case 'kb_write':
      if (action === 'edit') return { verb: 'Editing a note', gist: path ? prettyPath(path) : '' };
      if (action === 'delete') return { verb: 'Deleting a note', gist: path ? prettyPath(path) : '' };
      return { verb: 'Writing a note', gist: path ? prettyPath(path) : '' };
    case 'update_profile':
      return { verb: action === 'forget' ? 'Forgetting a fact' : 'Updating your profile',
               gist: subject || text };
    case 'remember':
      if (action === 'recall') return { verb: 'Recalling from memory', gist: query };
      if (action === 'forget') return { verb: 'Forgetting a note', gist: subject };
      return { verb: 'Saving to memory', gist: subject || text };
    case 'profile_read':
      return { verb: action === 'recall' ? 'Recalling about you' : 'Reading your profile', gist: query };
    case 'recall_events':
      return { verb: 'Recalling past events', gist: query };
    case 'remember_event':
      return { verb: 'Recording an event', gist: subject || text };
    case 'assign':
      return { verb: 'Delegating a task', gist: str(args.agent) || str(args.agentId) };
    case 'notify_user':
      return { verb: 'Notifying you', gist: str(args.title) || text };
    default: {
      // Unknown tool: show its own name, plus whichever common field it carries. New
      // tools degrade to something useful instead of nothing.
      const gist = query || (path ? prettyPath(path) : '') || (url ? prettyUrl(url) : '') || subject
        || (action ? action : '') || str(args.input);
      return { verb: name, gist };
    }
  }
}

/** The deepest running subagent step, else the parent's running tool. */
function current(m: ChatMsg): { name: string; input?: string; agent?: string } | null {
  const runningSubs = (m.subs || []).filter((s: SubStep) => s.kind === 'tool' && s.status === 'running');
  if (runningSubs.length > 0) {
    // Deepest = the innermost delegation currently doing work.
    const deepest = runningSubs.reduce((a, b) => (b.depth > a.depth ? b : a));
    return { name: deepest.name, input: deepest.input, agent: deepest.agent };
  }
  const tool = (m.tools || []).find((t: ToolCall) => t.status === 'running');
  return tool ? { name: tool.name, input: tool.input } : null;
}

const MAX_GIST = 48;

export function ActivityLine({ m }: { m: ChatMsg }) {
  const now = current(m);
  // No named tool yet (between calls, or the model is composing) — still say something,
  // because silence is exactly what reads as "stuck".
  if (!now) {
    return (
      <div className="flex items-center gap-1.5 px-1 min-w-0 text-[11.5px] text-ink3">
        <span className="an-pulse w-1.5 h-1.5 rounded-full bg-accent flex-none" />
        <span className="font-mono truncate">Working…</span>
      </div>
    );
  }
  const { verb, gist } = describe(now.name, parseArgs(now.input));
  const clipped = gist.replace(/\s+/g, ' ').trim();
  const shown = clipped.length > MAX_GIST ? `${clipped.slice(0, MAX_GIST - 1)}…` : clipped;
  return (
    <div className="flex items-center gap-1.5 px-1 min-w-0 text-[11.5px] text-ink3">
      <span className="an-pulse w-1.5 h-1.5 rounded-full bg-accent flex-none" />
      {now.agent && (
        <span className="inline-flex items-center gap-1 text-accent-dark flex-none">
          <Icon name="sparkle" size={9} />
          <span className="truncate max-w-[90px]">{now.agent}</span>
          <span className="text-ink3">·</span>
        </span>
      )}
      <span className="flex-none">{verb}</span>
      {shown && (
        <>
          <span className="text-faint flex-none">·</span>
          <span className="font-mono text-faint truncate min-w-0">{shown}</span>
        </>
      )}
    </div>
  );
}
