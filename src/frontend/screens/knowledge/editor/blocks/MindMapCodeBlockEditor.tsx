import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from '@mdxeditor/editor';
import { useTheme } from './theme';
import { SourceTextarea } from './SourceTextarea';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MindMapNode {
  id:       number;
  text:     string;
  level:    number;          // 0 = root
  children: MindMapNode[];
  colorIdx: number;          // index into BRANCH_COLORS (level-1 ancestor)

  // Layout (filled during layout pass)
  x:        number;
  y:        number;
  w:        number;
  h:        number;
  leafCount: number;
}

export interface MindMapData {
  root:        MindMapNode;
  totalHeight: number;
  totalWidth:  number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BRANCH_COLORS = [
  'oklch(0.55 0.18 250)',
  'oklch(0.52 0.17 160)',
  'oklch(0.62 0.18 45)',
  'oklch(0.54 0.17 310)',
  'oklch(0.52 0.18 15)',
  'oklch(0.56 0.18 200)',
];

const ROW_GAP   = 44;
const ROOT_X    = 16;
const LEVEL_X   = [0, 180, 360, 520, 660];   // x per level
const ROOT_W    = 130;
const ROOT_H    = 36;
const NODE_H    = 28;
const L1_W      = 120;
const L2_W      = 100;
const DEEP_W    = 90;

// ── Parse ─────────────────────────────────────────────────────────────────────

let _nextId = 0;
const makeNode = (text: string, level: number, colorIdx: number): MindMapNode => ({
  id: _nextId++, text, level, colorIdx, children: [],
  x: 0, y: 0, w: 0, h: NODE_H, leafCount: 0,
});

export function parseMindMapData(code: string): MindMapData | null {
  _nextId = 0;
  const lines = code.split('\n').filter(l => l.trim().length > 0);
  if (!lines.length) return null;

  // Find root (first non-indented line)
  const rootLine = lines[0];
  const rootText = rootLine.trim();
  if (!rootText) return null;

  const root = makeNode(rootText, 0, -1);
  root.w = ROOT_W;
  root.h = ROOT_H;

  const stack: MindMapNode[] = [root];

  for (let i = 1; i < lines.length; i++) {
    const raw   = lines[i];
    const text  = raw.trimStart();
    if (!text) continue;
    const spaces = raw.length - text.length;
    const level  = Math.round(spaces / 2);

    // Pop stack to correct parent level
    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const parent   = stack[stack.length - 1];
    const colorIdx = level === 1 ? parent.children.length % BRANCH_COLORS.length
                                 : parent.colorIdx;
    const node = makeNode(text, level, colorIdx);
    node.w = level === 1 ? L1_W : level === 2 ? L2_W : DEEP_W;
    parent.children.push(node);
    stack.push(node);
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  // 1. Count leaf nodes
  const countLeaves = (n: MindMapNode): number => {
    if (!n.children.length) { n.leafCount = 1; return 1; }
    n.leafCount = n.children.reduce((s, c) => s + countLeaves(c), 0);
    return n.leafCount;
  };
  countLeaves(root);

  const totalHeight = Math.max(ROOT_H + 16, root.leafCount * ROW_GAP);

  // 2. Assign positions recursively
  // parentTop / parentBottom = allocated y-range for this node's subtree
  const assignPos = (node: MindMapNode, yTop: number, yBot: number) => {
    const cy = (yTop + yBot) / 2;
    node.x = LEVEL_X[Math.min(node.level, LEVEL_X.length - 1)];
    node.y = cy;

    if (!node.children.length) return;

    let cursor = yTop;
    for (const child of node.children) {
      const childShare = (child.leafCount / node.leafCount) * (yBot - yTop);
      assignPos(child, cursor, cursor + childShare);
      cursor += childShare;
    }
  };

  // Root is special: center it vertically
  root.x = ROOT_X;
  root.y = totalHeight / 2;

  // Assign children across full height
  let cursor = 0;
  for (const child of root.children) {
    const share = (child.leafCount / root.leafCount) * totalHeight;
    assignPos(child, cursor, cursor + share);
    cursor += share;
  }

  // Compute total width
  const maxX = root.children.length
    ? Math.max(...collectAll(root).map(n => n.x + n.w)) + 24
    : ROOT_X + ROOT_W + 24;

  return { root, totalHeight, totalWidth: Math.max(maxX, 320) };
}

function collectAll(node: MindMapNode): MindMapNode[] {
  return [node, ...node.children.flatMap(collectAll)];
}

// ── SVG Rendering ─────────────────────────────────────────────────────────────

function MindMapSvg({ data, width, isDark }: { data: MindMapData; width: number; isDark: boolean }) {
  const t = useTheme();
  const PAD_V = 16;
  const svgH  = data.totalHeight + PAD_V * 2;

  const renderNode = (node: MindMapNode): React.ReactNode[] => {
    const nodes: React.ReactNode[] = [];
    const cx = node.x;
    const cy  = node.y + PAD_V;
    const nw  = node.w;
    const nh  = node.h;
    const rx  = node.level === 0 ? 8
              : node.level === 1 ? 7
              : 14;                        // pill for level 2+

    let fill: string;
    let textColor: string;

    if (node.level === 0) {
      fill      = t.accent;
      textColor = '#fff';
    } else {
      const base = BRANCH_COLORS[node.colorIdx % BRANCH_COLORS.length];
      if (node.level === 1) {
        fill      = base;
        textColor = '#fff';
      } else {
        // Lighter version via opacity
        fill      = isDark
          ? base.replace('oklch(', 'oklch(').replace(/oklch\(([^)]+)\)/, (_, inner) => {
              // bump lightness by ~0.18 in dark mode
              const parts = inner.split(' ');
              parts[0] = String(Math.min(0.82, parseFloat(parts[0]) + 0.18));
              return `oklch(${parts.join(' ')})`;
            })
          : base.replace(/oklch\(([^)]+)\)/, (_, inner) => {
              const parts = inner.split(' ');
              parts[0] = String(Math.min(0.88, parseFloat(parts[0]) + 0.22));
              parts[1] = String(Math.max(0.04, parseFloat(parts[1]) - 0.08));
              return `oklch(${parts.join(' ')})`;
            });
        textColor = isDark ? 'oklch(0.92 0.01 80)' : 'oklch(0.22 0.02 60)';
      }
    }

    const textLen   = node.text.length;
    const fontSize  = node.level === 0 ? 12.5
                    : node.level === 1 ? 11.5
                    : 10.5;
    const maxChars  = Math.floor(nw / (fontSize * 0.58));
    const label     = textLen > maxChars ? node.text.slice(0, maxChars - 1) + '…' : node.text;

    // Draw connections to children
    for (const child of node.children) {
      const cx2 = child.x;
      const cy2  = child.y + PAD_V;
      const midX = (cx + nw + cx2) / 2;
      nodes.push(
        <path
          key={`conn-${node.id}-${child.id}`}
          d={`M ${cx + nw},${cy} C ${midX},${cy} ${midX},${cy2} ${cx2},${cy2}`}
          fill="none"
          stroke={BRANCH_COLORS[child.colorIdx % BRANCH_COLORS.length]}
          strokeWidth={node.level === 0 ? 1.75 : 1.25}
          opacity={0.55}
        />
      );
    }

    // Draw node rect
    nodes.push(
      <g key={`node-${node.id}`}>
        <rect
          x={cx}
          y={cy - nh / 2}
          width={nw}
          height={nh}
          rx={rx}
          fill={fill}
          opacity={node.level === 0 ? 1 : node.level === 1 ? 0.92 : 0.82}
        />
        <text
          x={cx + nw / 2}
          y={cy + fontSize * 0.38}
          textAnchor="middle"
          fontFamily="Inter, sans-serif"
          fontSize={fontSize}
          fontWeight={node.level <= 1 ? 600 : 400}
          fill={textColor}
        >
          {label}
        </text>
      </g>
    );

    // Recurse
    for (const child of node.children) {
      nodes.push(...renderNode(child));
    }

    return nodes;
  };

  return (
    <svg
      width={width}
      height={svgH}
      viewBox={`0 0 ${Math.max(width, data.totalWidth)} ${svgH}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {renderNode(data.root)}
    </svg>
  );
}

// ── ResponsiveMindMap ─────────────────────────────────────────────────────────

export function ResponsiveMindMap({ data }: { data: MindMapData }) {
  const [width, setWidth] = useState(640);
  const ref = useRef<HTMLDivElement>(null);
  const t = useTheme();

  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.floor(w));
    });
    ro.observe(ref.current);
    setWidth(ref.current.clientWidth || 640);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%', overflowX: 'auto' }}>
      <MindMapSvg data={data} width={Math.max(width, data.totalWidth)} isDark={t.name === 'dark'} />
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function ToolBtn({ children, onClick, title, t }: { children: React.ReactNode; onClick: () => void; title?: string; t: ReturnType<typeof useTheme> }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontSize: 11, padding: '2px 7px', borderRadius: 4, lineHeight: 1.6,
        border: `0.5px solid ${hov ? t.muted : t.hair}`,
        background: hov ? t.bgSunken : 'transparent',
        color: hov ? t.ink : t.inkSoft,
        cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.1s',
      }}>
      {children}
    </button>
  );
}

function DeleteBtn({ onClick, t }: { onClick: () => void; t: ReturnType<typeof useTheme> }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = (e: React.MouseEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    setConfirming(true);
    timer.current = setTimeout(() => setConfirming(false), 2500);
  };
  const disarm = (e: React.MouseEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    setConfirming(false);
  };
  const confirm = (e: React.MouseEvent) => { e.preventDefault(); onClick(); };

  const btn: React.CSSProperties = {
    fontSize: 10.5, padding: '2px 8px', borderRadius: 4, lineHeight: 1.6,
    cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.1s',
  };

  if (confirming) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <button type="button" onMouseDown={confirm}
        style={{ ...btn, border: '0.5px solid oklch(0.55 0.18 15)', background: 'oklch(0.55 0.18 15)', color: '#fff', fontWeight: 600 }}>
        Delete
      </button>
      <button type="button" onMouseDown={disarm}
        style={{ ...btn, border: `0.5px solid ${t.hair}`, background: 'transparent', color: t.muted }}>
        Cancel
      </button>
    </div>
  );

  return (
    <button type="button" title="Delete block" onMouseDown={arm}
      style={{ ...btn, border: `0.5px solid ${t.hair}`, background: 'transparent', color: t.faint }}>
      ✕
    </button>
  );
}

// ── Editor component ──────────────────────────────────────────────────────────

function MindMapBlockEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const deleteBlock = useCallback(() => parentEditor.update(() => lexicalNode.remove()), [parentEditor, lexicalNode]);
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'map' | 'edit'>('map');

  const data = parseMindMapData(code);

  return (
    <div data-rich-block="true" style={{ margin: '8px 0', borderRadius: 8, border: `0.5px solid ${t.hair}`, background: t.bgSunken, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px', borderBottom: `0.5px solid ${t.hair}`,
        background: t.bgRaised, userSelect: 'none',
      }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.muted, fontWeight: 600, letterSpacing: 0.3, flex: 1 }}>mindmap</span>
        <ToolBtn
          title={viewMode === 'map' ? 'Edit source' : 'Show map'}
          onClick={() => setViewMode(v => v === 'map' ? 'edit' : 'map')}
          t={t}
        >
          {viewMode === 'map' ? 'Edit' : 'Map'}
        </ToolBtn>
        <DeleteBtn onClick={deleteBlock} t={t} />
      </div>

      {/* Map view */}
      {viewMode === 'map' && (
        <div style={{ background: t.bg, padding: '12px 16px 14px', minHeight: 120 }}>
          {data ? (
            <ResponsiveMindMap data={data} />
          ) : (
            <div style={{
              padding: '32px 0', textAlign: 'center',
              color: t.faint, fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter, sans-serif',
            }}>
              Switch to Edit and enter indented text (2 spaces per level)
            </div>
          )}
        </div>
      )}

      {/* Source edit view */}
      {viewMode === 'edit' && (
        <SourceTextarea
          code={code}
          onCodeChange={setCode}
          ariaLabel="Mind map source"
          placeholder={`Central Topic\n  Branch A\n    Sub A1\n    Sub A2\n  Branch B\n    Sub B1`}
          minHeight={160}
        />
      )}
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const mindMapCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'mindmap',
  priority: 100,
  Editor: MindMapBlockEditor,
};
