import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolPre } from './ToolCallCard';
import type { SubStep } from './model';

// ─── subagent activity ────────────────────────────────────────────────────────
// The work a delegated subagent did, rendered INSIDE the tool call that delegated it
// (see ToolCallCard). The caller passes the steps for ONE delegating call; this builds
// the tree under it.
//
// The tree is real, not just indentation: a subagent's own tool call can itself be a
// delegation (agent-as-tool all the way down), so a step whose id is some other step's
// `parent` renders its children nested beneath it, recursively.

/** Group steps by their parent id — the delegating call each one ran inside. */
function childrenOf(subs: SubStep[]): Map<string, SubStep[]> {
  const by = new Map<string, SubStep[]>();
  for (const s of subs) {
    const k = s.parent || '';
    const list = by.get(k);
    if (list) list.push(s); else by.set(k, [s]);
  }
  return by;
}

function SubStepRow({ s, kids }: { s: SubStep; kids: Map<string, SubStep[]> }) {
  const [open, setOpen] = useState(false);
  // This step is itself a delegation when other steps name it as their parent.
  const nested = kids.get(s.id) || [];
  const delegated = nested.length > 0;

  if (s.kind === 'thinking') return <ThinkingBlock text={s.text || ''} live={false} />;

  const has = !!(s.input || s.output);
  return (
    <div>
      <button type="button" onClick={() => has && setOpen((o) => !o)}
        className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-[7px] text-left ${has ? 'hover:bg-border-soft/50 cursor-pointer' : 'cursor-default'}`}>
        <span className="text-ink3 flex-none text-[10px]">{has ? <Icon name={open ? 'chevD' : 'chevR'} size={9} /> : '↳'}</span>
        <span className="text-ink3 flex-none"><Icon name={delegated ? 'sparkle' : 'settings'} size={9} /></span>
        <span className="font-mono text-[11.5px] text-ink2 flex-1 truncate">{s.name}</span>
        {s.status === 'running'
          ? <span className="inline-flex items-center gap-1 font-mono text-[9px] text-ink3"><span className="an-pulse w-1.5 h-1.5 rounded-full bg-accent" />running</span>
          : s.status === 'error'
            ? <span className="font-mono text-[9px] text-rec">✗</span>
            : <span className="font-mono text-[9px] text-ok">✓</span>}
      </button>
      {open && has && (
        <div className="px-2 pb-1.5 flex flex-col gap-1">
          {s.input && <ToolPre label="Input" content={s.input} />}
          {s.output && <ToolPre label="Output" content={s.output} />}
        </div>
      )}
      {/* This step delegated onward — its subagent's work nests under it. */}
      {delegated && <SubagentSteps subs={nested} all={kids} />}
    </div>
  );
}

/** One delegation's activity: a labelled rail of everything its subagent did.
 *  `all` carries the full parent→children map so nested delegations keep resolving. */
export function SubagentSteps({ subs, all }: { subs: SubStep[]; all?: Map<string, SubStep[]> }) {
  if (subs.length === 0) return null;
  const kids = all ?? childrenOf(subs);
  // When called without `all` (the top of a delegation), `subs` is the whole set for this
  // call — render only its roots and let recursion place the rest, or every nested step
  // would also appear at the top level.
  const roots = all ? subs : (kids.get(subs[0]?.parent || '') ?? subs);
  const running = roots.some((s) => s.status === 'running');
  const names = [...new Set(roots.map((s) => s.agent).filter(Boolean))];
  return (
    <div className="ml-3.5 pl-1.5 border-l border-accent/30 flex flex-col gap-0.5 py-1">
      <div className="flex items-center gap-1.5 px-2 py-0.5">
        <span className="text-accent flex-none"><Icon name="sparkle" size={10} /></span>
        <span className="text-[10px] font-600 text-accent-dark truncate">
          {names.length === 1 ? names[0] : `${names.length} subagents`}
        </span>
        {running && <span className="inline-flex items-center gap-1 font-mono text-[9px] text-ink3"><span className="an-pulse w-1.5 h-1.5 rounded-full bg-accent" />working</span>}
      </div>
      {roots.map((s) => <SubStepRow key={s.id} s={s} kids={kids} />)}
    </div>
  );
}
