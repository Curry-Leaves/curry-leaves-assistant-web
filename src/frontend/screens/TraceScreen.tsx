import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/chrome/Icon';
import { BetaTag } from '../components/chrome/BetaTag';
import { api } from '../api/client';
import { useEvents } from '../hooks/useEvents';
import type { TraceSummary, TraceSpan, SpanKind } from '../types';

// ─── helpers ──────────────────────────────────────────────────────────────────
// Token counts: the "tok" total is CUMULATIVE input+output across every LLM call — a cost/
// throughput figure that re-counts the growing prompt each turn (and on Copilot folds cached
// tokens into input), so it reads large on tool-use traces. That's expected; it's labelled as
// cumulative and paired with "ctx" (peak single-call input = context high-water mark) so the
// two aren't conflated. See trace_store._summary for where both are computed.
const SHOW_TOKENS = true;
const ms = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
const fmtDur = (d?: number) => (d == null ? '' : d < 1000 ? `${d}ms` : `${(d / 1000).toFixed(d < 10000 ? 2 : 1)}s`);
const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : String(n));
function ago(iso: string) {
  const m = Math.round((Date.now() - ms(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const KIND: Record<SpanKind, { icon: string; label: string; color: string }> = {
  action: { icon: 'wave', label: 'action', color: 'var(--color-ink2)' },
  session: { icon: 'chat', label: 'session', color: 'var(--color-accent)' },
  event: { icon: 'zap', label: 'event', color: 'var(--color-accent-dark)' },
  agent_run: { icon: 'sparkle', label: 'agent', color: 'var(--color-accent)' },
  subagent_run: { icon: 'sparkle', label: 'sub-agent', color: 'var(--color-accent)' },
  llm_turn: { icon: 'chat', label: 'llm', color: 'var(--color-blue)' },
  tool_call: { icon: 'settings', label: 'tool', color: 'var(--color-ink3)' },
  approval: { icon: 'check', label: 'approval', color: 'var(--color-ok)' },
  ask: { icon: 'chat', label: 'ask', color: 'var(--color-accent-dark)' },
};
const statusDot = (s: string) => (s === 'running' ? 'bg-accent an-pulse' : s === 'error' ? 'bg-rec' : 'bg-ok');

// ─── trace list row ───────────────────────────────────────────────────────────
function TraceRow({ t, active, onClick }: { t: TraceSummary; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-[8px] border transition-colors ${active ? 'bg-card border-border shadow-soft' : 'border-transparent hover:bg-card/50'}`}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className={`w-1.5 h-1.5 rounded-full flex-none ${statusDot(t.status)}`} />
        <span className={`flex-1 truncate text-[12.5px] ${active ? 'text-ink font-500' : 'text-ink2'}`}>{t.rootName || t.rootType}</span>
        <span className="text-[10.5px] text-faint font-mono flex-none">{fmtDur(t.durationMs)}</span>
      </div>
      <div className="flex items-center gap-2 text-[10.5px] text-faint pl-3.5">
        <span>{ago(t.startedAt)}</span>·<span>{t.spanCount} spans</span>
        {SHOW_TOKENS && !!t.tokensOut && <><span>·</span><span className="font-mono">{fmtTok((t.tokensIn ?? 0) + (t.tokensOut ?? 0))} tok</span></>}
      </div>
    </button>
  );
}

// ─── span tree ────────────────────────────────────────────────────────────────
interface Node { span: TraceSpan; children: Node[] }
// Rolled-up totals over a span's whole subtree (incl. all descendants).
export interface Rollup { tokIn: number; tokOut: number; wallMs: number; t0: number; t1: number }
function buildTree(spans: TraceSpan[]): { roots: Node[]; t0: number; span: number; rollups: Map<string, Rollup> } {
  const byId = new Map(spans.map((s) => [s.spanId, { span: s, children: [] as Node[] }]));
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const p = n.span.parentSpanId ? byId.get(n.span.parentSpanId) : null;
    if (p) p.children.push(n); else roots.push(n);
  }
  const sort = (ns: Node[]) => { ns.sort((a, b) => ms(a.span.startedAt) - ms(b.span.startedAt)); ns.forEach((c) => sort(c.children)); };
  sort(roots);

  // Post-order rollup: tokens summed from llm_turn leaves (no double-count); time = the
  // full wall-clock extent of the subtree, so a parent shows the whole and a leaf its own.
  const rollups = new Map<string, Rollup>();
  const roll = (n: Node): Rollup => {
    const a = (n.span.attributes || {}) as Record<string, number>;
    let tokIn = n.span.kind === 'llm_turn' ? (a.tokensIn || 0) : 0;
    let tokOut = n.span.kind === 'llm_turn' ? (a.tokensOut || 0) : 0;
    let t0 = ms(n.span.startedAt);
    let t1 = ms(n.span.endedAt) || t0 + (n.span.durationMs || 0);
    for (const c of n.children) {
      const r = roll(c);
      tokIn += r.tokIn; tokOut += r.tokOut; t0 = Math.min(t0, r.t0); t1 = Math.max(t1, r.t1);
    }
    const r = { tokIn, tokOut, wallMs: Math.max(0, t1 - t0), t0, t1 };
    rollups.set(n.span.spanId, r);
    return r;
  };
  roots.forEach(roll);

  const starts = spans.map((s) => ms(s.startedAt));
  const ends = spans.map((s) => ms(s.endedAt) || ms(s.startedAt) + (s.durationMs || 0));
  const t0 = Math.min(...starts), t1 = Math.max(...ends);
  return { roots, t0, span: Math.max(1, t1 - t0), rollups };
}

function SpanRow({ node, depth, t0, total, rollups, selId, onSelect }: {
  node: Node; depth: number; t0: number; total: number; rollups: Map<string, Rollup>;
  selId: string | null; onSelect: (s: TraceSpan) => void;
}) {
  const s = node.span;
  const k = KIND[s.kind] || KIND.event;
  const r = rollups.get(s.spanId);
  const hasKids = node.children.length > 0;
  const left = Math.max(0, Math.min(100, ((ms(s.startedAt) - t0) / total) * 100));
  const width = Math.max(1.5, Math.min(100 - left, ((s.durationMs || 0) / total) * 100));
  const a = s.attributes || {};
  const hint = s.kind === 'tool_call' ? (a.name as string)
    : s.kind === 'agent_run' || s.kind === 'subagent_run' ? (a.model as string) : '';
  // tokens rolled up over the subtree (parents include all children); time = whole for a
  // node with children, else the step's own duration.
  const tok = SHOW_TOKENS && r && r.tokOut > 0 ? `${fmtTok(r.tokIn)}→${fmtTok(r.tokOut)}` : '';
  const dur = hasKids ? (r?.wallMs ?? s.durationMs) : s.durationMs;
  return (
    <>
      <button type="button" onClick={() => onSelect(s)}
        className={`w-full flex items-center gap-2 py-1 rounded-[6px] text-left ${selId === s.spanId ? 'bg-accent-soft/40' : 'hover:bg-bg/60'}`}>
        {/* fixed-width tree label column → the waterfall track aligns across rows */}
        <span className="flex items-center gap-1.5 flex-none w-[230px] overflow-hidden pr-1" style={{ paddingLeft: depth * 14 + 6 }}>
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${statusDot(s.status)}`} />
          <Icon name={k.icon} size={11} color={k.color} />
          <span className="text-[12px] text-ink truncate">{s.name}</span>
          {hint && <span className="text-[10.5px] text-ink3 font-mono truncate flex-none max-w-[84px]">{hint}</span>}
        </span>
        {/* waterfall track — shared timeline, clipped so the bar never overlaps the columns */}
        <span className="flex-1 min-w-[24px] h-3 relative overflow-hidden rounded">
          <span className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full" style={{ left: `${left}%`, width: `${width}%`, background: k.color, opacity: 0.7 }} />
        </span>
        {SHOW_TOKENS && <span className="text-[10px] text-ink3 font-mono flex-none w-[58px] text-right">{tok && `${tok}`}</span>}
        <span className="text-[10px] text-faint font-mono flex-none w-12 text-right pr-1">{fmtDur(dur)}</span>
      </button>
      {node.children.map((c) => <SpanRow key={c.span.spanId} node={c} depth={depth + 1} t0={t0} total={total} rollups={rollups} selId={selId} onSelect={onSelect} />)}
    </>
  );
}

// ─── inspector ────────────────────────────────────────────────────────────────
const Pre = ({ children }: { children: React.ReactNode }) => (
  <pre className="px-2.5 py-2 rounded-[7px] bg-bg border border-border font-mono text-[10.5px] text-ink2 overflow-x-auto whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto">{children}</pre>
);
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-2 text-[12px]"><span className="text-ink3 w-20 flex-none">{label}</span><span className="text-ink2 break-words min-w-0">{children}</span></div>
);
function Section({ label, body }: { label: string; body: string }) {
  const [open, setOpen] = useState(false);
  if (!body) return null;
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-ink3 font-600 mb-1">
        <Icon name={open ? 'chevD' : 'chevR'} size={11} /> {label}
      </button>
      {open && <Pre>{body}</Pre>}
    </div>
  );
}

interface Roster { tools?: string[]; deferred?: string[]; skills?: string[] }
// The tool/skill catalog advertised to the model — "what we sent" alongside the system
// prompt. Rendered as labelled pill rows so the request surface is visible at a glance.
function RosterView({ roster }: { roster: Roster }) {
  const groups: { label: string; items: string[]; hint?: string }[] = [
    { label: 'Tools', items: roster.tools || [] },
    { label: 'Skills', items: roster.skills || [] },
    { label: 'Deferred', items: roster.deferred || [], hint: 'registered, revealed via tool search' },
  ].filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] uppercase tracking-wider text-ink3 font-600">Sent to model</div>
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] text-ink2 font-500">{g.label}</span>
            <span className="text-[10px] text-faint font-mono">{g.items.length}</span>
            {g.hint && <span className="text-[10px] text-faint">· {g.hint}</span>}
          </div>
          <div className="flex flex-wrap gap-1">
            {g.items.map((it) => (
              <span key={it} className="px-1.5 py-0.5 rounded-[5px] bg-bg border border-border font-mono text-[10px] text-ink2">{it}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface Msg { role: string; text: string; tool?: string }
const ROLE_COLOR: Record<string, string> = {
  user: 'text-accent-dark', assistant: 'text-ink', tool_result: 'text-ok', system: 'text-ink3',
};
function Messages({ messages }: { messages: Msg[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-ink3 font-600 mb-1.5">
        <Icon name={open ? 'chevD' : 'chevR'} size={11} /> Conversation — full content sent to model ({messages.length})
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {messages.map((m, i) => (
            <div key={i} className="rounded-[7px] border border-border bg-bg overflow-hidden">
              <div className="px-2.5 py-1 text-[9.5px] uppercase tracking-wider font-mono text-ink3 border-b border-border bg-card/40">
                <span className={ROLE_COLOR[m.role] || 'text-ink2'}>{m.role}</span>{m.tool ? ` · ${m.tool}` : ''}
              </div>
              <pre className="px-2.5 py-2 font-mono text-[10.5px] text-ink2 whitespace-pre-wrap break-words max-h-[220px] overflow-y-auto">{m.text || '(empty)'}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Inspector({ span, rollup, hasKids, onJump }: {
  span: TraceSpan; rollup?: Rollup; hasKids: boolean; onJump: (spanId: string) => void;
}) {
  const a = (span.attributes || {}) as Record<string, any>;
  const k = KIND[span.kind] || KIND.event;
  return (
    <div className="flex flex-col gap-3 p-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <Icon name={k.icon} size={14} color={k.color} />
        <span className="text-[14px] text-ink font-500">{span.name}</span>
        <span className="text-[10px] font-mono uppercase text-ink3">{k.label}</span>
      </div>
      <div className="flex flex-col gap-1">
        <Row label="status"><span className={span.status === 'error' ? 'text-rec' : span.status === 'running' ? 'text-accent' : 'text-ok'}>{span.status}</span></Row>
        {hasKids && rollup
          ? <Row label="time">{fmtDur(rollup.wallMs)} total{span.durationMs != null ? ` · ${fmtDur(span.durationMs)} self` : ''}</Row>
          : span.durationMs != null && <Row label="time">{fmtDur(span.durationMs)}</Row>}
        {SHOW_TOKENS && rollup && rollup.tokOut > 0 && (
          <Row label="tokens">
            <span title={hasKids ? 'Cumulative across all LLM calls in this subtree — cost, not context size.' : undefined}>
              {rollup.tokIn.toLocaleString()} in · {rollup.tokOut.toLocaleString()} out{hasKids ? ' (cumulative)' : ''}
            </span>
          </Row>
        )}
        {a.model && <Row label="model">{String(a.model)}</Row>}
        {a.surface && <Row label="surface">{String(a.surface)}</Row>}
        {a.agentId && <Row label="agent">{String(a.agentId)}</Row>}
        {a.entityId && <Row label="entity">{String(a.entityId)}</Row>}
        {a.isError != null && <Row label="error?">{String(a.isError)}</Row>}
        {a.approved != null && <Row label="approved">{String(a.approved)}</Row>}
        {span.error && <Row label="error"><span className="text-rec">{span.error}</span></Row>}
        {a.causedBy && <Row label="caused by"><button type="button" onClick={() => onJump(String(a.causedBy))} className="text-accent-dark hover:underline">jump ↑</button></Row>}
      </div>
      {(span.kind === 'agent_run' || span.kind === 'subagent_run') && <>
        {a.roster && <RosterView roster={a.roster as Roster} />}
        <Section label="System prompt" body={String(a.instructions || '')} />
        <Section label="User input" body={String(a.userInput || '')} />
        <Section label="Output" body={String(a.output || '')} />
        {Array.isArray(a.messages) && a.messages.length > 0 && <Messages messages={a.messages as Msg[]} />}
      </>}
      {span.kind === 'llm_turn' && <>
        <Section label="Thinking" body={String(a.thinking || '')} />
        {a.text && <div><div className="text-[11px] uppercase tracking-wider text-ink3 font-600 mb-1">Text</div><Pre>{String(a.text)}</Pre></div>}
      </>}
      {span.kind === 'tool_call' && <>
        {a.args && <div><div className="text-[11px] uppercase tracking-wider text-ink3 font-600 mb-1">Input</div><Pre>{String(a.args)}</Pre></div>}
        {a.result && <div><div className="text-[11px] uppercase tracking-wider text-ink3 font-600 mb-1">Output</div><Pre>{String(a.result)}</Pre></div>}
      </>}
      {(span.kind === 'ask' || span.kind === 'approval') && <>
        {a.question && <Row label="question">{String(a.question)}</Row>}
        {a.answer && <Row label="answer">{String(a.answer)}</Row>}
        {a.tool && <Row label="tool">{String(a.tool)}</Row>}
        {a.args && <Pre>{String(a.args)}</Pre>}
      </>}
      {span.kind === 'event' && a.payload != null && (
        <div><div className="text-[11px] uppercase tracking-wider text-ink3 font-600 mb-1">Payload</div><Pre>{JSON.stringify(a.payload, null, 2)}</Pre></div>
      )}
    </div>
  );
}

// ─── screen ───────────────────────────────────────────────────────────────────
export const TraceScreen = memo(function TraceScreen() {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [selSpan, setSelSpan] = useState<string | null>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;

  const refreshList = useCallback(() => { api.listTraces(100).then(setTraces).catch(() => {}); }, []);
  const loadTrace = useCallback((id: string) => { api.getTrace(id).then((r) => setSpans(r.spans)).catch(() => setSpans([])); }, []);

  useEffect(() => { refreshList(); }, [refreshList]);
  useEvents(() => refreshList());

  // Open a trace; poll it while it (or anything in it) is still running.
  useEffect(() => {
    if (!sel) { setSpans([]); return; }
    loadTrace(sel);
    setSelSpan(null);
  }, [sel, loadTrace]);
  useEffect(() => {
    const running = spans.some((s) => !s.endedAt) || traces.find((t) => t.traceId === sel)?.status === 'running';
    if (!sel || !running) return;
    const iv = setInterval(() => { if (selRef.current) loadTrace(selRef.current); refreshList(); }, 1200);
    return () => clearInterval(iv);
  }, [sel, spans, traces, loadTrace, refreshList]);

  const tree = useMemo(() => buildTree(spans), [spans]);
  const selectedSpan = spans.find((s) => s.spanId === selSpan) || null;
  const selKids = spans.some((s) => s.parentSpanId === selSpan);
  const summary = traces.find((t) => t.traceId === sel);

  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      {/* trace list */}
      <div className="w-[290px] flex-none flex flex-col bg-bg border-r border-border">
        <div className="px-3 h-11 flex items-center justify-between border-b border-border">
          <span className="flex items-center gap-2 text-[13px] font-600 text-ink">Traces <BetaTag /></span>
          <button type="button" onClick={refreshList} title="Refresh" className="w-7 h-7 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3"><Icon name="refresh" size={13} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5 flex flex-col gap-0.5">
          {traces.length === 0
            ? <div className="text-[11.5px] text-faint text-center py-10">No traces yet. Record something or chat with Curry Leaves.</div>
            : traces.map((t) => <TraceRow key={t.traceId} t={t} active={t.traceId === sel} onClick={() => setSel(t.traceId)} />)}
        </div>
      </div>

      {/* selected trace */}
      {!sel || !summary ? (
        <div className="flex-1 grid place-items-center text-ink3 text-[13px]">Select a trace to inspect it.</div>
      ) : (
        <div className="flex-1 flex min-h-0 min-w-0">
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <div className="px-5 h-11 flex items-center gap-3 border-b border-border flex-none">
              <span className={`w-2 h-2 rounded-full ${statusDot(summary.status)}`} />
              <span className="text-[14px] text-ink font-500 truncate flex-1">{summary.rootName}</span>
              <span className="text-[11px] text-ink3 font-mono flex items-center gap-1.5">
                <span>{fmtDur(summary.durationMs)} · {summary.spanCount} spans</span>
                {SHOW_TOKENS && !!summary.tokensOut && (
                  <span title="Cumulative tokens processed across every LLM call this trace (cost, re-counts the growing prompt each turn) — not the context size.">
                    · {fmtTok((summary.tokensIn ?? 0) + (summary.tokensOut ?? 0))} tok
                  </span>
                )}
                {SHOW_TOKENS && !!summary.peakContext && (
                  <span title="Largest single call's input — the context high-water mark (what the model held at its fullest)." className="text-ink2">
                    · {fmtTok(summary.peakContext)} ctx
                  </span>
                )}
              </span>
              <button type="button" onClick={() => api.deleteTrace(sel).then(() => { setSel(null); refreshList(); })} title="Delete trace" className="text-ink3 hover:text-rec"><Icon name="trash" size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {tree.roots.map((n) => <SpanRow key={n.span.spanId} node={n} depth={0} t0={tree.t0} total={tree.span} rollups={tree.rollups} selId={selSpan} onSelect={(s) => setSelSpan(s.spanId)} />)}
            </div>
          </div>
          {selectedSpan && (
            <div className="w-[400px] flex-none border-l border-border bg-card min-h-0 flex flex-col">
              <Inspector span={selectedSpan} rollup={tree.rollups.get(selectedSpan.spanId)} hasKids={selKids} onJump={(id) => setSelSpan(id)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
