import type { ChatMsg } from './model';

// ─── context breakdown (ported from Savior's estimate-then-reconcile) ───────────────
// The model reports one true number: how many tokens the last turn's prompt held. We can't
// know its internal split, so we estimate each category by chars/4, then RECONCILE against
// that real total: if the estimate is under, the remainder is "other" (system prompt, tool
// schemas, tokenizer overhead a char count can't see); if over, scale every category down to
// fit. The bar is therefore always anchored to ground truth — chars/4 only apportions it.

export type BreakdownKey = 'user' | 'assistant' | 'tool' | 'other';
export interface BreakdownSegment { key: BreakdownKey; tokens: number; percent: number }

export const BREAKDOWN_COLOR: Record<BreakdownKey, string> = {
  user: 'oklch(0.62 0.15 145)',      // green
  assistant: 'oklch(0.62 0.15 285)', // violet
  tool: 'oklch(0.68 0.15 75)',       // amber
  other: 'var(--color-ink3)',        // grey — system prompt + schemas + overhead
};
export const BREAKDOWN_LABEL: Record<BreakdownKey, string> = {
  user: 'You', assistant: 'Assistant', tool: 'Tools', other: 'System + tools',
};

const est = (chars: number) => Math.ceil(chars / 4);

const chars = (msgs: ChatMsg[]) => {
  let user = 0, assistant = 0, tool = 0;
  for (const m of msgs) {
    if (m.role === 'user') { user += m.content?.length ?? 0; continue; }
    assistant += (m.content?.length ?? 0) + (m.thinking?.length ?? 0);
    for (const t of m.tools ?? []) tool += (t.input?.length ?? 0) + (t.output?.length ?? 0);
  }
  return { user, assistant, tool };
};

/** Break `total` reported context tokens down across categories. `total` is the ground-truth
 * number the meter shows; `msgs` supply the per-category char estimates used only to split it. */
export function contextBreakdown(msgs: ChatMsg[], total: number): BreakdownSegment[] {
  if (total <= 0) return [];
  const c = chars(msgs);
  const t = { user: est(c.user), assistant: est(c.assistant), tool: est(c.tool) };
  const estimated = t.user + t.assistant + t.tool;

  let seg: Record<BreakdownKey, number>;
  if (estimated <= total) {
    seg = { ...t, other: total - estimated };
  } else {
    const scale = total / estimated;
    const s = { user: Math.floor(t.user * scale), assistant: Math.floor(t.assistant * scale), tool: Math.floor(t.tool * scale) };
    seg = { ...s, other: Math.max(0, total - (s.user + s.assistant + s.tool)) };
  }

  return (Object.keys(seg) as BreakdownKey[])
    .map((key) => ({ key, tokens: seg[key], percent: Math.round((seg[key] / total) * 1000) / 10 }))
    .filter((x) => x.tokens > 0);
}
