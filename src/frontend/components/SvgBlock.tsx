import { useMemo } from 'react';
import DOMPurify from 'dompurify';

// Render an inline SVG from a chat/knowledge markdown message. react-markdown drops
// raw HTML (no rehype-raw, deliberately — that would let model output inject arbitrary
// DOM), so an assistant that emits `<svg>…</svg>` would otherwise show nothing. We
// instead sanitize the SVG with DOMPurify's SVG profile — which strips scripts, event
// handlers, foreignObject, external refs, etc. — and render the safe result inline.
const PURIFY_OPTS = {
  USE_PROFILES: { svg: true, svgFilters: true },
  // Belt-and-suspenders: even inside the SVG profile, forbid the handful of vectors
  // that can still reach out of the document or run script.
  FORBID_TAGS: ['script', 'foreignObject', 'a'],
  FORBID_ATTR: ['xlink:href', 'href'],
};

export function SvgBlock({ source }: { source: string }) {
  const html = useMemo(() => DOMPurify.sanitize(source, PURIFY_OPTS), [source]);
  // Nothing survived sanitizing (e.g. it was all script) — render nothing rather than
  // an empty framed box.
  if (!html.trim()) return null;
  return (
    <span
      className="block my-2 max-w-full overflow-x-auto rounded-[10px] border border-border bg-card p-2 [&>svg]:max-w-full [&>svg]:h-auto"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Split markdown text into alternating plain-markdown and top-level <svg>…</svg> chunks
// so the caller can route each SVG through SvgBlock and everything else through
// react-markdown. Matches complete <svg>…</svg> pairs (case-insensitive, dot-all).
const SVG_RE = /<svg[\s\S]*?<\/svg>/gi;

// Fenced code blocks (``` or ~~~), so we can leave any <svg> inside them alone. An SVG
// in a ```svg (or any ```) fence is deliberate markup the user is showing, not an image
// to render — and the markdown pipeline's `pre` handler already renders ```svg fences as
// images. Pulling the <svg> out here would gut the fence and orphan its ``` markers.
const FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm;

export type MdChunk = { kind: 'md'; text: string } | { kind: 'svg'; source: string };

// True if [start,end) overlaps any [s,e) fence range.
const inRange = (ranges: [number, number][], start: number, end: number) =>
  ranges.some(([s, e]) => start < e && end > s);

export function splitSvg(text: string): MdChunk[] {
  const fences: [number, number][] = [];
  for (const f of text.matchAll(FENCE_RE)) {
    const s = f.index ?? 0;
    fences.push([s, s + f[0].length]);
  }

  const out: MdChunk[] = [];
  let last = 0;
  for (const m of text.matchAll(SVG_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    // Leave SVGs inside code fences in the markdown stream (the `pre` handler renders
    // ```svg fences; other fences stay literal code).
    if (inRange(fences, start, end)) continue;
    if (start > last) out.push({ kind: 'md', text: text.slice(last, start) });
    out.push({ kind: 'svg', source: m[0] });
    last = end;
  }
  if (last < text.length) out.push({ kind: 'md', text: text.slice(last) });
  // No SVG at all → single md chunk (also covers empty input).
  return out.length ? out : [{ kind: 'md', text }];
}
