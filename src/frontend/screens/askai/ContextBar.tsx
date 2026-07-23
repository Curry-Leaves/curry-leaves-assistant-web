import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMsg } from './model';
import { contextBreakdown, BREAKDOWN_COLOR, BREAKDOWN_LABEL } from './contextBreakdown';

// ─── context / compaction meter (curry-leaves's ContextBar) ─────────────────────────
// chars/4 fallback counting everything a bubble carries (text, thinking, tool I/O) —
// used only for messages the model hasn't reported usage for (e.g. reloaded transcripts).
const estMsg = (m: ChatMsg) => Math.floor(((m.content?.length ?? 0) + (m.thinking?.length ?? 0)
  + (m.tools ?? []).reduce((a, t) => a + (t.input?.length ?? 0) + (t.output?.length ?? 0), 0)) / 4);
// Model-reported context the latest turn actually saw. `context` (last call's in+out) is
// exact; `input` is a good proxy the backend already sends today — the model's prompt-token
// count, which includes the system prompt, tool schemas and KB content a chars/4 guess can't
// see. Either beats estimating; fall back to `input` so the meter is right without a backend
// restart, and only estimate messages sent AFTER that turn (e.g. an unanswered user message).
const reportedCtx = (m: ChatMsg) => m.usage?.context || m.usage?.input || 0;
const estTokens = (msgs: ChatMsg[]) => {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const ctx = reportedCtx(msgs[i]);
    if (ctx) return ctx + msgs.slice(i + 1).reduce((a, m) => a + estMsg(m), 0);
  }
  return msgs.reduce((a, m) => a + estMsg(m), 0);
};
// The context window of the model that actually ran, reported on the latest turn's usage
// frame. Falls back to the `max` prop (a sane default) until the first reply reports one —
// so a 200k Claude / 1M Gemini session isn't pinned to a wrong 128k denominator.
const reportedLimit = (msgs: ChatMsg[]) => {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].usage?.limit) return msgs[i].usage!.limit!;
  return 0;
};
const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const CTX_CIRC = 2 * Math.PI * 7;

export function ContextBar({ messages, max, compacting, onCompact }: {
  messages: ChatMsg[]; max: number; compacting: boolean; onCompact: () => Promise<number>;
}) {
  const [saved, setSaved] = useState<number | null>(null);
  // Popover is portaled to <body> so the composer's overflow-hidden can't clip it; we anchor
  // it to the ring's on-screen rect (captured on hover) and position it ABOVE, right-aligned.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const ringRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (saved === null) return; const tmr = setTimeout(() => setSaved(null), 3000); return () => clearTimeout(tmr); }, [saved]);
  const used = estTokens(messages);
  max = reportedLimit(messages) || max;
  const pct = Math.min(used / max, 1);
  const color = pct >= 0.75 ? 'oklch(0.55 0.18 25)' : pct >= 0.5 ? 'oklch(0.62 0.15 75)' : 'var(--color-ink3)';
  const segments = contextBreakdown(messages, used);
  if (compacting) return (
    <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink3 whitespace-nowrap">
      <span className="w-3 h-3 rounded-full border-[1.5px] border-accent/30 border-t-accent an-spin" />
      Compacting…
    </span>
  );
  if (saved !== null) return <span className="font-mono text-[10.5px] text-ok whitespace-nowrap">saved ~{fmtK(saved)} tokens</span>;
  const POP_W = 224; // w-56
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] text-ink3 whitespace-nowrap">~{fmtK(used)} / {fmtK(max)}</span>
      <button ref={ringRef} type="button" title="Click to compact" onClick={async () => setSaved(await onCompact())} disabled={compacting}
        onMouseEnter={() => segments.length > 0 && setAnchor(ringRef.current!.getBoundingClientRect())}
        onMouseLeave={() => setAnchor(null)}
        className="w-5 h-5 flex-none flex items-center justify-center disabled:opacity-50">
        <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90">
          <circle cx="10" cy="10" r="7" fill="none" stroke="var(--color-border)" strokeWidth="2.2" />
          <circle cx="10" cy="10" r="7" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeDasharray={`${pct * CTX_CIRC} ${CTX_CIRC}`} />
        </svg>
      </button>
      {anchor && createPortal(
        <div className="pointer-events-none fixed z-[100] w-56 rounded-[10px] border border-border bg-card p-2.5 shadow-pop"
          style={{ left: Math.max(8, anchor.right - POP_W), top: anchor.top - 8, transform: 'translateY(-100%)' }}>
          <div className="mb-1.5 flex items-baseline justify-between font-mono text-[10px] text-ink3">
            <span>Context</span><span>~{fmtK(used)} / {fmtK(max)} · {Math.round(pct * 100)}%</span>
          </div>
          <div className="mb-2 flex h-1.5 w-full overflow-hidden rounded-full bg-border">
            {segments.map((s) => (
              <div key={s.key} style={{ width: `${(s.tokens / used) * 100}%`, backgroundColor: BREAKDOWN_COLOR[s.key] }} />
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {segments.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 font-mono text-[10px] text-ink2">
                <span className="size-2 flex-none rounded-sm" style={{ backgroundColor: BREAKDOWN_COLOR[s.key] }} />
                <span className="flex-1">{BREAKDOWN_LABEL[s.key]}</span>
                <span className="text-ink3">{fmtK(s.tokens)}</span>
                <span className="w-9 text-right text-ink3">{s.percent}%</span>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
