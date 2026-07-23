import { useState, useRef, useLayoutEffect, useId } from 'react';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from '@mdxeditor/editor';
import { useTheme } from './theme';
import { SourceTextarea } from './SourceTextarea';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SankeyLink { source: string; target: string; value: number }
export interface SankeyData { nodes: string[]; links: SankeyLink[] }

// ── Parse ─────────────────────────────────────────────────────────────────────

// Format (one link per line):  Source -> Target: value
// or pipe-table:  | Source | Target | Value |
export function parseSankeyData(code: string): SankeyData | null {
  const links: SankeyLink[] = [];
  const nodeSet = new Set<string>();

  for (const raw of code.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;

    // Pipe-table row (skip header/separator)
    if (line.startsWith('|')) {
      if (line.match(/^\|[-:\s|]+\|$/)) continue;
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length < 3) continue;
      const v = parseFloat(cols[2].replace(/[^0-9.]/g, ''));
      if (!cols[0] || !cols[1] || isNaN(v)) continue;
      links.push({ source: cols[0], target: cols[1], value: v });
      nodeSet.add(cols[0]); nodeSet.add(cols[1]);
      continue;
    }

    // Arrow format:  Source -> Target: value
    const m = line.match(/^(.+?)\s*-+>\s*(.+?)\s*:\s*([\d.,]+)/);
    if (!m) continue;
    const v = parseFloat(m[3].replace(/,/g, ''));
    if (isNaN(v)) continue;
    links.push({ source: m[1].trim(), target: m[2].trim(), value: v });
    nodeSet.add(m[1].trim()); nodeSet.add(m[2].trim());
  }

  if (!links.length) return null;

  // Topological ordering: sources before targets
  const inNodes  = new Set(links.map(l => l.target));
  const outNodes = new Set(links.map(l => l.source));
  const roots    = [...outNodes].filter(n => !inNodes.has(n));
  const ordered: string[] = [];
  const visited  = new Set<string>();
  const visit    = (n: string) => {
    if (visited.has(n)) return;
    visited.add(n); ordered.push(n);
    links.filter(l => l.source === n).forEach(l => visit(l.target));
  };
  roots.forEach(visit);
  nodeSet.forEach(n => visit(n));

  return { nodes: ordered, links };
}

// ── Layout ────────────────────────────────────────────────────────────────────

interface LayedOutNode {
  name:   string;
  x:      number;
  y:      number;
  width:  number;
  height: number;
  col:    number;
  color:  string;
}

interface LayedOutLink {
  source: LayedOutNode;
  target: LayedOutNode;
  value:  number;
  sy:     number;   // source exit y (top of this link's slice on source)
  ty:     number;   // target entry y
  d:      string;   // SVG path
  color:  string;
  opacity: number;
}

const NODE_COLORS = [
  'oklch(0.55 0.18 250)','oklch(0.52 0.17 160)','oklch(0.62 0.18 45)',
  'oklch(0.54 0.17 310)','oklch(0.52 0.18 15)','oklch(0.56 0.18 200)',
  'oklch(0.58 0.14 58)', 'oklch(0.54 0.16 280)',
];

function layoutSankey(data: SankeyData, width: number, height: number): {
  nodes: LayedOutNode[]; links: LayedOutLink[];
} {
  const NODE_W  = 18;
  const PAD_V   = 12;   // vertical padding between node rects
  const PAD_H   = 20;   // horizontal padding from edges

  // Assign columns (topological BFS from sources)
  const colMap = new Map<string, number>();
  const inNodes = new Set(data.links.map(l => l.target));
  const queue   = data.nodes.filter(n => !inNodes.has(n));
  queue.forEach(n => colMap.set(n, 0));

  let changed = true;
  while (changed) {
    changed = false;
    for (const lk of data.links) {
      const sc = colMap.get(lk.source) ?? 0;
      const tc = colMap.get(lk.target) ?? 0;
      if (tc <= sc) { colMap.set(lk.target, sc + 1); changed = true; }
    }
  }

  const numCols = Math.max(...[...colMap.values()]) + 1;

  // Group nodes per column
  const colGroups = new Map<number, string[]>();
  data.nodes.forEach(n => {
    const c = colMap.get(n) ?? 0;
    if (!colGroups.has(c)) colGroups.set(c, []);
    colGroups.get(c)!.push(n);
  });

  // Node total value (max of inflow / outflow)
  const nodeValue = new Map<string, number>();
  data.nodes.forEach(n => {
    const out = data.links.filter(l => l.source === n).reduce((s, l) => s + l.value, 0);
    const inn = data.links.filter(l => l.target === n).reduce((s, l) => s + l.value, 0);
    nodeValue.set(n, Math.max(out, inn, 1));
  });

  // Scale: map max value column to fill available height
  const chartH    = height - PAD_V * 2;
  const chartW    = width  - PAD_H * 2 - NODE_W;
  const colX      = (c: number) => PAD_H + (c / Math.max(numCols - 1, 1)) * chartW;

  // Scale factor: sum of values in tallest column
  const colSum    = (c: number) =>
    (colGroups.get(c) ?? []).reduce((s, n) => s + (nodeValue.get(n) ?? 0), 0);
  const maxSum    = Math.max(...[...colGroups.keys()].map(c => colSum(c)), 1);
  const scale     = (v: number) => (v / maxSum) * chartH;

  // Position nodes per column
  const nodeMap   = new Map<string, LayedOutNode>();
  colGroups.forEach((names, col) => {
    const totalH  = names.reduce((s, n) => s + scale(nodeValue.get(n) ?? 0), 0)
                  + PAD_V * (names.length - 1);
    let y         = PAD_V + (chartH - totalH) / 2;
    names.forEach((name, i) => {
      const h  = Math.max(6, scale(nodeValue.get(name) ?? 0));
      const ci = data.nodes.indexOf(name) % NODE_COLORS.length;
      nodeMap.set(name, {
        name, col,
        x: colX(col),
        y,
        width:  NODE_W,
        height: h,
        color:  NODE_COLORS[ci],
      });
      y += h + PAD_V;
    });
  });

  // Build link paths
  // Track running offsets on each node side
  const srcOffset = new Map<string, number>();
  const tgtOffset = new Map<string, number>();

  const links: LayedOutLink[] = data.links.map(lk => {
    const sn = nodeMap.get(lk.source)!;
    const tn = nodeMap.get(lk.target)!;
    if (!sn || !tn) return null!;

    const lh = Math.max(1, scale(lk.value));
    const sy = sn.y + (srcOffset.get(lk.source) ?? 0);
    const ty = tn.y + (tgtOffset.get(lk.target) ?? 0);
    srcOffset.set(lk.source, (srcOffset.get(lk.source) ?? 0) + lh);
    tgtOffset.set(lk.target, (tgtOffset.get(lk.target) ?? 0) + lh);

    const x1 = sn.x + NODE_W;
    const x2 = tn.x;
    const cx = (x1 + x2) / 2;

    // Cubic bezier ribbon (top + bottom path, filled)
    const d = [
      `M ${x1},${sy}`,
      `C ${cx},${sy} ${cx},${ty} ${x2},${ty}`,
      `L ${x2},${ty + lh}`,
      `C ${cx},${ty + lh} ${cx},${sy + lh} ${x1},${sy + lh}`,
      'Z',
    ].join(' ');

    return { source: sn, target: tn, value: lk.value, sy, ty, d, color: sn.color, opacity: 0.35 };
  }).filter(Boolean);

  return { nodes: [...nodeMap.values()], links };
}

// ── SankeySvg ─────────────────────────────────────────────────────────────────

function SankeySvg({ data, width, height = 320 }: { data: SankeyData; width: number; height?: number }) {
  const t     = useTheme();
  const uid   = useId();
  const [hovNode, setHovNode] = useState<string | null>(null);
  const [hovLink, setHovLink] = useState<number | null>(null);

  const { nodes, links } = layoutSankey(data, width, height);

  const fmtVal = (v: number) =>
    v >= 1_000_000 ? `${(v/1e6).toFixed(1)}M` :
    v >= 1_000     ? `${(v/1e3).toFixed(1)}k` : String(v);

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <clipPath id={`sk-clip-${uid}`}>
          <rect x={0} y={0} width={width} height={height} />
        </clipPath>
      </defs>

      {/* Links */}
      <g clipPath={`url(#sk-clip-${uid})`}>
        {links.map((lk, i) => (
          <path
            key={i}
            d={lk.d}
            fill={lk.color}
            opacity={hovLink === i ? 0.65 : hovNode ? (hovNode === lk.source.name || hovNode === lk.target.name ? 0.55 : 0.12) : lk.opacity}
            style={{ cursor: 'default', transition: 'opacity 0.15s' }}
            onMouseEnter={() => setHovLink(i)}
            onMouseLeave={() => setHovLink(null)}
          />
        ))}
      </g>

      {/* Nodes */}
      {nodes.map((nd) => {
        const isHov = hovNode === nd.name;
        return (
          <g key={nd.name}
            onMouseEnter={() => setHovNode(nd.name)}
            onMouseLeave={() => setHovNode(null)}
            style={{ cursor: 'default' }}
          >
            <rect
              x={nd.x} y={nd.y}
              width={nd.width} height={nd.height}
              fill={nd.color} rx={3}
              opacity={isHov ? 1 : 0.88}
            />
            {/* Label to the left for first column, right for last, inside otherwise */}
            {(() => {
              const isFirst = nd.col === 0;
              const isLast  = nd.col === Math.max(...nodes.map(n => n.col));
              const tx = isFirst  ? nd.x - 6
                       : isLast   ? nd.x + nd.width + 6
                       : nd.x + nd.width + 6;
              const anchor = isFirst ? 'end' : 'start';
              const label = nd.name.length > 18 ? nd.name.slice(0, 16) + '…' : nd.name;
              return (
                <text x={tx} y={nd.y + nd.height / 2 + 4}
                  textAnchor={anchor}
                  fontFamily="Inter, sans-serif" fontSize={11}
                  fontWeight={isHov ? 600 : 400}
                  fill={isHov ? t.ink : t.inkSoft}>
                  {label}
                </text>
              );
            })()}
          </g>
        );
      })}

      {/* Hover tooltip for links */}
      {hovLink !== null && (() => {
        const lk = links[hovLink];
        const mx = (lk.source.x + lk.source.width + lk.target.x) / 2;
        const my = (lk.sy + lk.ty) / 2 + 8;
        const label = `${lk.source.name} → ${lk.target.name}: ${fmtVal(lk.value)}`;
        const tw = label.length * 6.2 + 12;
        return (
          <g>
            <rect x={mx - tw/2} y={my - 13} width={tw} height={18}
              rx={4} fill={t.bgRaised} stroke={t.hair} strokeWidth={0.5}
              style={{ filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.18))' }} />
            <text x={mx} y={my} textAnchor="middle"
              fontFamily="Inter, sans-serif" fontSize={10} fill={t.ink}>{label}</text>
          </g>
        );
      })()}
    </svg>
  );
}

// ── ResponsiveSankey ──────────────────────────────────────────────────────────

export function ResponsiveSankey({ data, height }: { data: SankeyData; height?: number }) {
  const [width, setWidth] = useState(600);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.floor(w));
    });
    ro.observe(ref.current);
    setWidth(ref.current.clientWidth || 600);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <SankeySvg data={data} width={width} height={height ?? 320} />
    </div>
  );
}

// ── DeleteBtn ─────────────────────────────────────────────────────────────────

function DeleteBtn({ onClick, t }: { onClick: () => void; t: ReturnType<typeof useTheme> }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm   = (e: React.MouseEvent) => { e.preventDefault(); if (timer.current) clearTimeout(timer.current); setConfirming(true); timer.current = setTimeout(() => setConfirming(false), 2500); };
  const disarm = (e: React.MouseEvent) => { e.preventDefault(); if (timer.current) clearTimeout(timer.current); setConfirming(false); };
  const confirm = (e: React.MouseEvent) => { e.preventDefault(); onClick(); };
  const btn: React.CSSProperties = { fontSize: 10.5, padding: '2px 8px', borderRadius: 4, lineHeight: 1.6, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.1s' };
  if (confirming) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <button type="button" onMouseDown={confirm} style={{ ...btn, border: '0.5px solid oklch(0.55 0.18 15)', background: 'oklch(0.55 0.18 15)', color: '#fff', fontWeight: 600 }}>Delete</button>
      <button type="button" onMouseDown={disarm}  style={{ ...btn, border: `0.5px solid ${t.hair}`, background: 'transparent', color: t.muted }}>Cancel</button>
    </div>
  );
  return <button type="button" title="Delete block" onMouseDown={arm} style={{ ...btn, border: `0.5px solid ${t.hair}`, background: 'transparent', color: t.faint }}>✕</button>;
}

function ToolBtn({ children, onClick, t }: { children: React.ReactNode; onClick: () => void; t: ReturnType<typeof useTheme> }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" onMouseDown={e => { e.preventDefault(); onClick(); }} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, lineHeight: 1.6, border: `0.5px solid ${hov ? t.muted : t.hair}`, background: hov ? t.bgSunken : 'transparent', color: hov ? t.ink : t.inkSoft, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.1s' }}>
      {children}
    </button>
  );
}

// ── Editor component ──────────────────────────────────────────────────────────

const SANKEY_STARTER = `Source A -> Target X: 40
Source A -> Target Y: 25
Source B -> Target X: 20
Source B -> Target Z: 35
Target X -> Output 1: 45
Target X -> Output 2: 15
Target Y -> Output 2: 25
Target Z -> Output 3: 35`;

function SankeyBlockEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'chart' | 'source'>('chart');
  const deleteBlock = () => parentEditor.update(() => lexicalNode.remove());

  const data = parseSankeyData(code);

  return (
    <div data-rich-block="true" style={{ margin: '8px 0', borderRadius: 8, border: `0.5px solid ${t.hair}`, background: t.bgSunken, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: `0.5px solid ${t.hair}`, background: t.bgRaised, userSelect: 'none' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.muted, fontWeight: 600, letterSpacing: 0.3, flex: 1 }}>sankey</span>
        <ToolBtn onClick={() => setViewMode(v => v === 'chart' ? 'source' : 'chart')} t={t}>
          {viewMode === 'chart' ? 'Edit' : 'Chart'}
        </ToolBtn>
        <DeleteBtn onClick={deleteBlock} t={t} />
      </div>

      {viewMode === 'chart' && (
        <div style={{ background: t.bg, padding: '12px 16px' }}>
          {data ? (
            <ResponsiveSankey data={data} />
          ) : (
            <div style={{ padding: '28px 0', textAlign: 'center', color: t.faint, fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter, sans-serif' }}>
              Format: <code style={{ fontFamily: 'monospace' }}>Source -{'>'} Target: value</code>
            </div>
          )}
        </div>
      )}

      {viewMode === 'source' && (
        <SourceTextarea
          code={code}
          onCodeChange={setCode}
          ariaLabel="Sankey data"
          minHeight={140}
        />
      )}
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const sankeyCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'sankey',
  priority: 100,
  Editor: SankeyBlockEditor,
};
