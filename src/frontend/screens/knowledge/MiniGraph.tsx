import { useEffect, useRef } from 'react';
import type { KnowledgeGraph } from '../../types';
import { hueFor } from './GraphView';

// A compact "local graph": the current note pinned at centre, its directly-linked
// neighbours orbiting it, and the edges among them. Clicking a node navigates.

type Mini = { id: string; title: string; type: string | null; r: number; x: number; y: number; vx: number; vy: number; focus: boolean };

export function MiniGraph({ data, focus, onOpen }: {
  data: KnowledgeGraph; focus: string; onOpen: (path: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const st = useRef<{ nodes: Mini[]; links: { s: Mini; t: Mini }[]; hover: Mini | null; alpha: number }>(
    { nodes: [], links: [], hover: null, alpha: 1 });
  // `onOpen` is an inline arrow from KnowledgeScreen, so it changes identity on every
  // parent render. Read it through a ref to keep the canvas effect below mount-only —
  // otherwise resize() reassigns canvas.width and blanks the canvas mid-frame.
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  // Build the 1-hop subgraph around `focus` whenever it (or the data) changes.
  useEffect(() => {
    const adj = new Map<string, Set<string>>();
    data.nodes.forEach((n) => adj.set(n.path, new Set()));
    data.links.forEach((l) => { adj.get(l.source)?.add(l.target); adj.get(l.target)?.add(l.source); });
    const titleOf = (p: string) => data.nodes.find((n) => n.path === p)?.title || p.split('/').pop()?.replace(/\.md$/, '') || p;
    const typeOf = (p: string) => data.nodes.find((n) => n.path === p)?.type ?? null;

    const keep = new Set<string>([focus, ...(adj.get(focus) || [])]);
    const N = keep.size || 1;
    // Reuse the positions we already settled on: the graph is refetched on every
    // knowledge.*/agent.run.* event, and re-ringing every node each time made the
    // layout snap back and never converge.
    const prev = new Map(st.current.nodes.map((n) => [n.id, n]));
    const mk = new Map<string, Mini>();
    let i = 0;
    for (const id of keep) {
      const isFocus = id === focus;
      const a = (i / N) * Math.PI * 2; i++;
      const p = prev.get(id);
      mk.set(id, { id, title: titleOf(id), type: typeOf(id), r: isFocus ? 7 : 4.5,
        x: isFocus ? 0 : p?.x ?? Math.cos(a) * 55, y: isFocus ? 0 : p?.y ?? Math.sin(a) * 55,
        vx: isFocus ? 0 : p?.vx ?? 0, vy: isFocus ? 0 : p?.vy ?? 0, focus: isFocus });
    }
    const links = data.links
      .filter((l) => keep.has(l.source) && keep.has(l.target))
      .map((l) => ({ s: mk.get(l.source)!, t: mk.get(l.target)! }));
    const changed = keep.size !== prev.size || [...keep].some((id) => !prev.has(id));
    st.current.nodes = [...mk.values()]; st.current.links = links;
    if (changed) { st.current.alpha = 1; st.current.hover = null; }   // only re-heat on a real change
  }, [data, focus]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const col = (v: string, fb: string) => css.getPropertyValue(v).trim() || fb;
    const C = { ink: col('--color-ink', '#222'), ink3: col('--color-ink3', '#999'), border: col('--color-border', '#ddd'), accent: col('--color-accent', '#c2410c') };
    let raf = 0, w = 0, h = 0; const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => { const r = canvas.getBoundingClientRect(); w = r.width; h = r.height; canvas.width = w * dpr; canvas.height = h * dpr; };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

    const pick = (px: number, py: number): Mini | null => {
      const wx = px - w / 2, wy = py - h / 2;
      for (let i = st.current.nodes.length - 1; i >= 0; i--) {
        const n = st.current.nodes[i]; const dx = n.x - wx, dy = n.y - wy;
        if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
      }
      return null;
    };

    const step = () => {
      const s = st.current; const { nodes, links } = s;
      if (s.alpha > 0.01) {
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j]; const dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy || 0.01;
            const f = 1400 / d2; const d = Math.sqrt(d2); const ux = dx / d, uy = dy / d;
            a.vx += ux * f; a.vy += uy * f; b.vx -= ux * f; b.vy -= uy * f;
          }
        }
        for (const l of links) {
          const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const f = (d - 52) * 0.04; const ux = dx / d, uy = dy / d;
          l.s.vx += ux * f; l.s.vy += uy * f; l.t.vx -= ux * f; l.t.vy -= uy * f;
        }
        for (const n of nodes) {
          if (n.focus) { n.x = 0; n.y = 0; n.vx = 0; n.vy = 0; continue; }   // pin focus at centre
          n.vx *= 0.8; n.vy *= 0.8; n.x += n.vx; n.y += n.vy;
        }
        s.alpha *= 0.97;
      }

      ctx.save(); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h); ctx.translate(w / 2, h / 2);
      const hov = s.hover;
      ctx.lineWidth = 1;
      for (const l of links) {
        const on = !hov || l.s === hov || l.t === hov;
        ctx.globalAlpha = on ? 1 : 0.12; ctx.strokeStyle = on && hov ? C.accent : C.border;
        ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (const n of nodes) {
        const isHover = n === hov;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.focus ? C.accent : `hsl(${hueFor(n.type)} 60% 55%)`; ctx.fill();
        if (isHover && !n.focus) { ctx.lineWidth = 1.5; ctx.strokeStyle = C.accent; ctx.stroke(); }
        if (n.focus || isHover) {
          ctx.font = '10px Inter, sans-serif'; ctx.fillStyle = n.focus ? C.ink : C.ink3;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(n.title.slice(0, 18), n.x, n.y + n.r + 2);
        }
      }
      ctx.restore();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect(); st.current.hover = pick(e.clientX - r.left, e.clientY - r.top);
      canvas.style.cursor = st.current.hover && !st.current.hover.focus ? 'pointer' : 'default';
    };
    const onClick = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect(); const n = pick(e.clientX - r.left, e.clientY - r.top);
      if (n && !n.focus) openRef.current(n.id);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('click', onClick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('click', onClick); };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
}
