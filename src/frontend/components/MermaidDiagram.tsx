import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import mermaid from 'mermaid';
import { formatHex, parse } from 'culori';
import { Icon } from './chrome/Icon';

// Mermaid's internal color math (d3-color) can't parse the app's oklch() tokens
// ("Unsupported color format") — the browser itself won't reliably normalize
// oklch to rgb via computed style either (behavior varies by Chromium version),
// so convert with culori instead of depending on either.
function toHex(oklch: string): string {
  const parsed = parse(oklch);
  return (parsed && formatHex(parsed)) || oklch;
}

// Lazily (re)configured on each render with the app's live theme tokens, since
// any of the 8 themes (or the OS-following `system` choice) can be active and
// mermaid has no way to consume our CSS variables directly.
function themeVariables() {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string) => toHex(style.getPropertyValue(name).trim());
  return {
    background: v('--color-card'),
    primaryColor: v('--color-card'),
    primaryTextColor: v('--color-ink'),
    primaryBorderColor: v('--color-border'),
    lineColor: v('--color-ink3'),
    secondaryColor: v('--color-bg'),
    tertiaryColor: v('--color-border-soft'),
    textColor: v('--color-ink'),
    mainBkg: v('--color-card'),
    nodeBorder: v('--color-accent'),
    clusterBkg: v('--color-bg'),
    clusterBorder: v('--color-border'),
    edgeLabelBackground: v('--color-bg'),
    fontFamily: v('--font-sans'),
  };
}

let renderCount = 0;

// Tallest a diagram may render inline in a chat bubble; past this it scales down (click
// to open full size). Not a clip — the whole diagram stays visible, just smaller.
const MAX_H = 320;

// Renders a ```mermaid fenced block as an inline SVG diagram, styled to match
// the app's active theme. Capped to a modest height inline (chat bubbles have no
// business hosting a full-page flowchart) with a hover affordance to expand into
// a full-size modal. Falls back to the raw source in a code block if the diagram
// source doesn't parse, so a malformed block never blanks the message.
export function MermaidDiagram({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++renderCount}`;

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: themeVariables(),
      securityLevel: 'strict',
      // Without this, render() swallows parse errors and resolves with mermaid's
      // own "Syntax error in text" placeholder SVG instead of rejecting — this
      // makes it throw instead, so the catch below can show our own fallback.
      suppressErrorRendering: true,
    });

    document.fonts.ready
      .then(() => mermaid.render(id, source))
      .then(({ svg: rendered }) => {
        if (!cancelled) { setSvg(rendered); setError(null); }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    if (!containerRef.current || !svg) return;
    containerRef.current.innerHTML = svg;
    const el = containerRef.current.querySelector('svg');
    if (!el) return;

    // Mermaid sizes each label's <foreignObject> from its own text measurement, which comes
    // out 1-2px narrower than the span the browser actually lays out — enough to clip the
    // final glyph ("Reconciliatio", "Two"). The node rect around it is drawn with padding
    // and has room to spare, so widening the foreignObject to the span's real width fixes
    // the clipping without touching layout. Centered via the same delta on x.
    for (const fo of el.querySelectorAll('foreignObject')) {
      const span = fo.firstElementChild as HTMLElement | null;
      if (!span) continue;
      const need = Math.ceil(span.getBoundingClientRect().width) + 2;
      const have = fo.width.baseVal.value;
      if (need > have) {
        fo.setAttribute('width', String(need));
        fo.setAttribute('x', String(fo.x.baseVal.value - (need - have) / 2));
      }
    }
    // Mermaid stamps an absolute width/height sized to the diagram's own layout, so a tall
    // flowchart overflows the inline box and gets clipped. Convert those to an intrinsic
    // aspect-ratio box: keep the natural size as the ceiling (never upscale a 2-node
    // diagram to fill the frame) and let max-width/max-height shrink it to fit.
    const vb = el.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
    const w = vb?.[2] ?? el.getBoundingClientRect().width;
    const h = vb?.[3] ?? el.getBoundingClientRect().height;
    if (!w || !h) return;
    el.removeAttribute('width');
    el.removeAttribute('height');
    // When the diagram is taller than the cap, height is the binding constraint — shrink
    // width by the same ratio so the aspect stays true (inline SVG ignores object-fit, and
    // a bare max-height with a fixed width would squash it). Otherwise keep natural width,
    // capped at 100% of the bubble.
    const scale = h > MAX_H ? MAX_H / h : 1;
    el.style.width = `${Math.round(w * scale)}px`;
    el.style.height = 'auto';
    el.style.maxWidth = '100%';
  }, [svg]);

  if (error) {
    return (
      <div className="my-1.5">
        <pre className="px-2.5 py-2 rounded-[8px] bg-bg border border-border overflow-x-auto text-[12px] leading-relaxed">
          <code className="font-mono">{source}</code>
        </pre>
        <p className="mt-1 text-[11.5px] text-ink3">Couldn't render diagram: {error}</p>
      </div>
    );
  }

  return (
    <>
      <div
        className="group relative my-1.5 overflow-hidden rounded-[8px] border border-border bg-card cursor-zoom-in"
        onClick={() => svg && setExpanded(true)}
      >
        {/* The SVG scales down to fit this box (width AND height) rather than being
            clipped by it — a tall `graph TD` shrinks to fit instead of losing its
            bottom nodes. Click still opens the full-size modal for detail. */}
        <div ref={containerRef} className="flex justify-center p-2" />
        <div className="pointer-events-none absolute top-1.5 right-1.5 flex items-center gap-1 rounded-[6px] bg-card/90 border border-border px-1.5 py-1 text-ink3 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
        </div>
      </div>
      {expanded && svg && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-[1px]" onClick={() => setExpanded(false)}>
          <div className="an-rise w-[92vw] h-[88vh] rounded-[12px] border border-border bg-card shadow-pop overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
              <span className="text-[14px] font-550 text-ink">Diagram</span>
              <span className="flex-1" />
              <button type="button" onClick={() => setExpanded(false)} title="Close" className="p-1 rounded-[6px] text-ink3 hover:text-ink hover:bg-border-soft">
                <Icon name="x" size={15} />
              </button>
            </div>
            {/* `[&_svg]:!w-auto !h-auto` overrides mermaid's stamped width/height (this
                copy goes in raw, so it hasn't been through the strip above) — the viewBox
                then scales it to fill the modal. */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-6">
              <div className="w-full h-full flex items-center justify-center [&_svg]:!w-auto [&_svg]:!h-auto [&_svg]:max-w-full [&_svg]:max-h-full" dangerouslySetInnerHTML={{ __html: svg }} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
