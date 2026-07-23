import { useEffect, useMemo, useRef, useState } from 'react';
import type { KnowledgeGraph } from '../../types';

// A dependency-free, Obsidian-style force-directed graph rendered to canvas:
// repulsion between all nodes, springs along links, gentle centering. Supports
// pan (drag background), zoom (wheel), node drag, hover labels, click-to-open.

type Sim = {
  id: string; title: string; type: string | null; r: number;
  x: number; y: number; vx: number; vy: number; fx?: number; fy?: number;
};

// Stable per-type colour: a fixed hue wheel keyed by type name.
const TYPE_HUES: Record<string, number> = {
  decision: 18, technique: 265, concept: 210, person: 140, meeting: 45,
  app: 200, component: 230, integration: 300, incident: 0, convention: 95,
  architecture: 250, metric: 330, term: 175, paper: 285, fact: 60, preference: 120, note: 220,
};
export const hueFor = (type: string | null) => {
  if (type && type in TYPE_HUES) return TYPE_HUES[type];
  let h = 0; for (const c of type || 'note') h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

// Untyped notes need a stable key in the filter set; '∅' can't collide with a
// real type name (types are word-ish slugs).
const typeKey = (t: string | null) => t ?? '∅';

export function GraphView({ data, selected, onOpen }: {
  data: KnowledgeGraph; selected: string | null; onOpen: (path: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());  // type keys filtered out
  const stateRef = useRef<{
    nodes: Sim[]; links: { s: Sim; t: Sim; rel: string }[]; adj: Map<string, Set<string>>;
    scale: number; ox: number; oy: number;
    drag: Sim | null; panning: boolean; hover: Sim | null;
    lastX: number; lastY: number; downX: number; downY: number; alpha: number;
    hidden: Set<string>;
  }>({ nodes: [], links: [], adj: new Map(), scale: 1, ox: 0, oy: 0, drag: null, panning: false, hover: null, lastX: 0, lastY: 0, downX: 0, downY: 0, alpha: 1, hidden: new Set() });

  // Types present in the graph, biggest first — drives the legend/filter panel.
  const types = useMemo(() => {
    const m = new Map<string, { label: string; hue: number; count: number }>();
    for (const n of data.nodes) {
      const k = typeKey(n.type);
      const e = m.get(k);
      if (e) e.count++;
      else m.set(k, { label: n.type ?? 'untyped', hue: hueFor(n.type), count: 1 });
    }
    return [...m.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [data]);

  // Sync the filter into the sim state and reheat so the layout re-settles
  // around the remaining nodes (hover cleared: it may point at a hidden node).
  useEffect(() => {
    const st = stateRef.current;
    st.hidden = hidden; st.hover = null; st.alpha = Math.max(st.alpha, 0.4);
  }, [hidden]);

  // (Re)build the simulation when the graph data changes.
  useEffect(() => {
    const byId = new Map<string, Sim>();
    const N = data.nodes.length || 1;
    const R = 140 + N * 7;                        // ring scales with node count → roomy start
    const nodes: Sim[] = data.nodes.map((n, i) => {
      const a = (i / N) * Math.PI * 2;           // deterministic ring start (no Math.random needed)
      const s: Sim = { id: n.path, title: n.title, type: n.type, r: 4 + Math.sqrt(n.degree) * 2.4,
        x: Math.cos(a) * R, y: Math.sin(a) * R, vx: 0, vy: 0 };
      byId.set(n.path, s); return s;
    });
    const links = data.links.map((l) => ({ s: byId.get(l.source)!, t: byId.get(l.target)!, rel: l.rel || 'link' }))
      .filter((l) => l.s && l.t);
    // adjacency: node id → set of neighbour ids (drives hover spotlight)
    const adj = new Map<string, Set<string>>();
    data.nodes.forEach((n) => adj.set(n.path, new Set()));
    data.links.forEach((l) => { adj.get(l.source)?.add(l.target); adj.get(l.target)?.add(l.source); });
    const st = stateRef.current;
    st.nodes = nodes; st.links = links; st.adj = adj; st.alpha = 1;
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const col = (v: string, fb: string) => css.getPropertyValue(v).trim() || fb;
    const C = {
      bg: col('--color-bg', '#fff'), ink: col('--color-ink', '#222'),
      ink3: col('--color-ink3', '#999'), border: col('--color-border', '#ddd'),
      accent: col('--color-accent', '#c2410c'),
    };
    let raf = 0, w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const st = stateRef.current;
      if (!st.ox && !st.oy) { st.ox = w / 2; st.oy = h / 2; }  // centre on first layout
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

    const toWorld = (px: number, py: number) => {
      const st = stateRef.current; return { x: (px - st.ox) / st.scale, y: (py - st.oy) / st.scale };
    };
    // Type filter: hidden nodes drop out of physics, drawing and hit-testing
    // alike, so the visible subgraph behaves as if it were the whole graph.
    const shown = (n: Sim) => !stateRef.current.hidden.has(typeKey(n.type));
    const pick = (px: number, py: number): Sim | null => {
      const { x, y } = toWorld(px, py); const st = stateRef.current;
      for (let i = st.nodes.length - 1; i >= 0; i--) {
        const n = st.nodes[i];
        if (!shown(n)) continue;
        const dx = n.x - x, dy = n.y - y;
        if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
      }
      return null;
    };

    const step = () => {
      const st = stateRef.current;
      const nodes = st.hidden.size ? st.nodes.filter(shown) : st.nodes;
      const links = st.hidden.size ? st.links.filter((l) => shown(l.s) && shown(l.t)) : st.links;
      if (st.alpha > 0.005 && !st.drag) {
        // repulsion (O(n^2) — fine for typical bundle sizes); strong + far-reaching
        // so the graph breathes instead of clumping.
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy || 0.01;
            const f = 2800 / d2; const d = Math.sqrt(d2);
            const ux = dx / d, uy = dy / d;
            a.vx += ux * f; a.vy += uy * f; b.vx -= ux * f; b.vy -= uy * f;
          }
        }
        // springs along links — longer rest length keeps neighbours readable
        for (const l of links) {
          const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          const f = (d - 115) * 0.02; const ux = dx / d, uy = dy / d;
          l.s.vx += ux * f; l.s.vy += uy * f; l.t.vx -= ux * f; l.t.vy -= uy * f;
        }
        // gentle centering + integrate + damping
        for (const n of nodes) {
          n.vx += (-n.x) * 0.0009; n.vy += (-n.y) * 0.0009;
          n.vx *= 0.86; n.vy *= 0.86;
          n.x += n.vx; n.y += n.vy;
        }
        // collision pass: hard-separate overlapping circles so labels stay legible
        for (let i = 0; i < nodes.length; i++) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            const dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
            const min = a.r + b.r + 14;
            if (d < min) {
              const push = (min - d) / 2; const ux = dx / d, uy = dy / d;
              a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push;
            }
          }
        }
        st.alpha *= 0.99;
      }

      // ── draw ──
      const st2 = stateRef.current;
      ctx.save(); ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(st2.ox, st2.oy); ctx.scale(st2.scale, st2.scale);

      // Hover spotlight (Obsidian-style): the hovered node, its edges, and its
      // neighbours stay lit; everything else fades back.
      const hov = st2.hover;
      const nbr = hov ? st2.adj.get(hov.id) : null;
      const lit = (n: Sim) => !hov || n === hov || !!nbr?.has(n.id);

      for (const l of links) {
        const on = !hov || l.s === hov || l.t === hov;
        const typed = l.rel !== 'link';
        ctx.globalAlpha = on ? 1 : 0.07;
        ctx.lineWidth = (on && hov ? 1.6 : 1) / st2.scale;
        ctx.strokeStyle = on && hov ? C.accent : (typed ? C.ink3 : C.border);
        // directed edge: line stops at the target's rim, then a small arrowhead
        const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y; const d = Math.hypot(dx, dy) || 1;
        const ux = dx / d, uy = dy / d;
        const ex = l.t.x - ux * (l.t.r + 1.5), ey = l.t.y - uy * (l.t.r + 1.5);
        ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(ex, ey); ctx.stroke();
        const ah = 5 / st2.scale;                               // arrowhead size
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - ux * ah - uy * ah * 0.6, ey - uy * ah + ux * ah * 0.6);
        ctx.lineTo(ex - ux * ah + uy * ah * 0.6, ey - uy * ah - ux * ah * 0.6);
        ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        // relation label at the edge midpoint when this edge is spotlighted
        if (on && hov && typed) {
          ctx.font = `${9 / st2.scale}px Inter, sans-serif`;
          ctx.fillStyle = C.ink3; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(l.rel, (l.s.x + l.t.x) / 2, (l.s.y + l.t.y) / 2);
        }
      }
      ctx.globalAlpha = 1;

      const showLabels = st2.scale > 0.7;
      for (const n of nodes) {
        const isSel = n.id === selected, isHover = n === hov, on = lit(n);
        ctx.globalAlpha = on ? 1 : 0.15;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? C.accent : `hsl(${hueFor(n.type)} 60% 55%)`;
        ctx.fill();
        if (isSel || isHover) { ctx.lineWidth = 2 / st2.scale; ctx.strokeStyle = C.accent; ctx.stroke(); }
        if ((showLabels && on) || isHover || isSel || (hov && on)) {
          ctx.font = `${11 / st2.scale}px Inter, sans-serif`;
          ctx.fillStyle = isSel || isHover ? C.ink : C.ink3;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(n.title.slice(0, 28), n.x, n.y + n.r + 2 / st2.scale);
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    // ── interaction ──
    const onDown = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
      const st = stateRef.current; st.downX = px; st.downY = py; st.lastX = px; st.lastY = py;
      const n = pick(px, py);
      if (n) { st.drag = n; const wld = toWorld(px, py); n.fx = wld.x; n.fy = wld.y; }
      else st.panning = true;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
      const st = stateRef.current;
      if (st.drag) {
        const wld = toWorld(px, py); st.drag.x = wld.x; st.drag.y = wld.y; st.drag.vx = 0; st.drag.vy = 0; st.alpha = Math.max(st.alpha, 0.3);
      } else if (st.panning) {
        st.ox += px - st.lastX; st.oy += py - st.lastY;
      } else {
        st.hover = pick(px, py); canvas.style.cursor = st.hover ? 'pointer' : 'grab';
      }
      st.lastX = px; st.lastY = py;
    };
    const onUp = (e: PointerEvent) => {
      const st = stateRef.current;
      const moved = Math.hypot(st.lastX - st.downX, st.lastY - st.downY) > 4;
      if (st.drag && !moved) onOpen(st.drag.id);     // a click (not a drag) opens the note
      if (st.drag) { st.drag.fx = undefined; st.drag.fy = undefined; }
      st.drag = null; st.panning = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left, py = e.clientY - r.top;
      const st = stateRef.current; const k = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.min(4, Math.max(0.2, st.scale * k));
      st.ox = px - (px - st.ox) * (ns / st.scale); st.oy = py - (py - st.oy) * (ns / st.scale);
      st.scale = ns;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [selected, onOpen]);

  const toggle = (k: string) => setHidden((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full block touch-none cursor-grab" />
      {/* type legend + filter — click a type to hide/show its nodes */}
      {types.length > 1 && (
        <div className="absolute left-3 top-3 z-10 w-[172px] rounded-[10px] border border-border bg-card/90 backdrop-blur-sm shadow-soft overflow-hidden">
          <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border">
            <span className="text-[9.5px] font-600 uppercase tracking-wider text-ink3">Types</span>
            {hidden.size > 0 && (
              <button type="button" onClick={() => setHidden(new Set())}
                className="text-[10px] text-accent hover:text-accent-dark">Show all</button>
            )}
          </div>
          <div className="max-h-[280px] overflow-y-auto py-1">
            {types.map(([k, t]) => {
              const off = hidden.has(k);
              return (
                <button key={k} type="button" onClick={() => toggle(k)}
                  title={off ? `Show ${t.label} notes` : `Hide ${t.label} notes`}
                  className="w-full flex items-center gap-2 px-2.5 py-1 text-left hover:bg-border-soft/50">
                  <span className={`w-2.5 h-2.5 rounded-full flex-none ${off ? 'opacity-30' : ''}`}
                    style={{ background: `hsl(${t.hue} 60% 55%)` }} />
                  <span className={`flex-1 min-w-0 truncate text-[11.5px] ${off ? 'text-faint line-through' : 'text-ink2'}`}>{t.label}</span>
                  <span className="text-[10px] tabular-nums text-faint">{t.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
