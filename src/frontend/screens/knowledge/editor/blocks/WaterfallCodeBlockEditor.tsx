import { useState, useRef, useLayoutEffect, useCallback, useId } from 'react';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from '@mdxeditor/editor';
import { useTheme } from './theme';
import { SourceTextarea } from './SourceTextarea';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WFNode {
  id:       number;
  name:     string;
  start:    number;   // ms
  duration: number;   // ms
  type:     string;
  level:    number;
  children: WFNode[];
  parent:   WFNode | null;
}

export interface WFResult {
  root:   WFNode;
  maxEnd: number;
}

// ── Colors ────────────────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, string> = {
  navigation: 'oklch(0.52 0.18 250)',
  resource:   'oklch(0.56 0.16 210)',
  script:     'oklch(0.60 0.18 45)',
  api:        'oklch(0.50 0.17 160)',
  db:         'oklch(0.52 0.17 310)',
  cache:      'oklch(0.65 0.14 58)',
  render:     'oklch(0.54 0.18 200)',
  paint:      'oklch(0.55 0.16 150)',
  process:    'oklch(0.64 0.08 240)',
  dns:        'oklch(0.58 0.12 280)',
  connect:    'oklch(0.58 0.13 260)',
  auth:       'oklch(0.60 0.12 330)',
  request:    'oklch(0.58 0.14 240)',
  transfer:   'oklch(0.58 0.18 220)',
};
const DEFAULT_COLOR = 'oklch(0.65 0.08 240)';

const getColor = (type: string) => TYPE_COLOR[type] ?? DEFAULT_COLOR;

// ── Parse ─────────────────────────────────────────────────────────────────────

let _wfId = 0;

const makeWFNode = (name: string, start: number, duration: number, type: string, level: number, parent: WFNode | null): WFNode => ({
  id: _wfId++, name, start, duration, type, level, children: [], parent,
});

export function parseWaterfallData(code: string): WFResult | null {
  _wfId = 0;
  const lines = code.split('\n');

  // Virtual root
  const root = makeWFNode('__root__', 0, 0, '', -1, null);
  const stack: WFNode[] = [root];
  let maxEnd = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    // Skip header line (if "name, start, duration, type" header exists)
    if (/^name\s*,/i.test(trimmed)) continue;

    const indent = rawLine.length - rawLine.trimStart().length;
    const level  = Math.round(indent / 2);

    const parts = trimmed.split(',').map(p => p.trim());
    if (parts.length < 4) continue;

    const name     = parts[0];
    const start    = parseFloat(parts[1]);
    const duration = parseFloat(parts[2]);
    const type     = parts[3] ?? '';

    if (!name || isNaN(start) || isNaN(duration)) continue;

    // Determine parent: pop stack until parent level = level - 1
    while (stack.length > 1 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    const node   = makeWFNode(name, start, duration, type, level, parent);
    parent.children.push(node);
    stack.push(node);

    const end = start + duration;
    if (end > maxEnd) maxEnd = end;
  }

  if (!root.children.length) return null;

  // Also scan full tree for real maxEnd
  const scanMax = (n: WFNode) => {
    const end = n.start + n.duration;
    if (end > maxEnd) maxEnd = end;
    n.children.forEach(scanMax);
  };
  root.children.forEach(scanMax);

  return { root, maxEnd: maxEnd || 1 };
}

// ── Layout constants ──────────────────────────────────────────────────────────

const LABEL_W  = 240;
const ROW_H    = 34;
const BAR_H    = 18;
const HEADER_H = 40;

// ── WaterfallView ─────────────────────────────────────────────────────────────

export function WaterfallView({ data, width }: { data: WFResult; width: number }) {
  const t     = useTheme();
  const uid   = useId();
  const isDark = t.name === 'dark';

  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => {
    // Top-level nodes (direct children of root = level 0) start expanded
    const ids = new Set<number>();
    data.root.children.forEach(n => ids.add(n.id));
    return ids;
  });

  const [hovered, setHovered] = useState<number | null>(null);

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Flatten visible rows (BFS style, skip root itself)
  const visibleRows: WFNode[] = [];
  const flatten = (nodes: WFNode[]) => {
    for (const n of nodes) {
      visibleRows.push(n);
      if (n.children.length && expandedIds.has(n.id)) {
        flatten(n.children);
      }
    }
  };
  flatten(data.root.children);

  const chartW  = Math.max(0, width - LABEL_W);
  const svgH    = HEADER_H + visibleRows.length * ROW_H + 1;
  const maxEnd  = data.maxEnd || 1;

  const toX = (ms: number) => LABEL_W + (ms / maxEnd) * chartW;
  const toW = (ms: number) => Math.max(3, (ms / maxEnd) * chartW);

  // Adaptive time axis intervals
  const tickInterval = (() => {
    const candidates = [1, 2, 5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const target = chartW / 80;
    for (const c of candidates) {
      if (maxEnd / c <= target) return c;
    }
    return candidates[candidates.length - 1];
  })();

  const ticks: number[] = [];
  for (let v = 0; v <= maxEnd; v += tickInterval) ticks.push(v);
  if (ticks[ticks.length - 1] < maxEnd) ticks.push(maxEnd);

  // Format ms
  const fmtMs = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

  const clipId = `wf-clip-${uid}`;

  return (
    <div style={{ overflowX: 'auto', width: '100%' }}>
      <svg
        width={width}
        height={svgH}
        style={{ display: 'block', fontFamily: 'Inter, sans-serif', overflow: 'visible' }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={LABEL_W} y={0} width={chartW} height={svgH} />
          </clipPath>
        </defs>

        {/* ── Header background ── */}
        <rect x={0} y={0} width={width} height={HEADER_H}
          fill={isDark ? 'oklch(0.22 0.01 60)' : 'oklch(0.97 0.008 80)'} />

        {/* ── Vertical grid lines + tick labels ── */}
        {ticks.map((ms, i) => {
          const x = toX(ms);
          return (
            <g key={i}>
              <line
                x1={x} y1={HEADER_H - 6} x2={x} y2={svgH}
                stroke={t.hair} strokeWidth={0.5}
              />
              <text
                x={x} y={HEADER_H - 10}
                textAnchor="middle"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={8.5}
                fill={t.faint}
              >
                {fmtMs(ms)}
              </text>
            </g>
          );
        })}

        {/* ── Header bottom border ── */}
        <line x1={0} y1={HEADER_H} x2={width} y2={HEADER_H}
          stroke={t.hair} strokeWidth={1} />

        {/* ── Label column separator ── */}
        <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={svgH}
          stroke={t.hair} strokeWidth={0.75} />

        {/* ── Rows ── */}
        {visibleRows.map((node, rowIdx) => {
          const rowY   = HEADER_H + rowIdx * ROW_H;
          const cy     = rowY + ROW_H / 2;
          const bx     = toX(node.start);
          const bw     = toW(node.duration);
          const color  = getColor(node.type);
          const isHov  = hovered === node.id;
          const indent = node.level * 16;
          const hasKids = node.children.length > 0;
          const isExpanded = expandedIds.has(node.id);

          return (
            <g key={node.id}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'default' }}
            >
              {/* Row hover highlight */}
              {isHov && (
                <rect x={0} y={rowY} width={width} height={ROW_H}
                  fill={isDark ? 'oklch(0.28 0.01 60 / 0.7)' : 'oklch(0.94 0.01 80 / 0.7)'}
                />
              )}

              {/* Row separator */}
              <line x1={0} y1={rowY + ROW_H} x2={width} y2={rowY + ROW_H}
                stroke={t.hairSoft} strokeWidth={0.5} />

              {/* ── Label column ── */}
              {/* Expand/collapse triangle */}
              {hasKids && (
                <text
                  x={indent + 6}
                  y={cy + 4}
                  fontFamily="Inter, sans-serif"
                  fontSize={9}
                  fill={t.muted}
                  style={{ cursor: 'pointer' }}
                  onMouseDown={e => { e.preventDefault(); toggleExpand(node.id); }}
                >
                  {isExpanded ? '▼' : '▶'}
                </text>
              )}

              {/* Node name (clickable to toggle) */}
              <text
                x={indent + (hasKids ? 20 : 14)}
                y={cy + 4}
                fontFamily="Inter, sans-serif"
                fontSize={11.5}
                fontWeight={isHov ? 500 : 400}
                fill={isHov ? t.ink : t.inkSoft}
                style={{ cursor: hasKids ? 'pointer' : 'default' }}
                onMouseDown={hasKids ? (e => { e.preventDefault(); toggleExpand(node.id); }) : undefined}
              >
                {node.name.length > 26 ? node.name.slice(0, 24) + '…' : node.name}
              </text>

              {/* Duration label at right of label column */}
              <text
                x={LABEL_W - 8}
                y={cy + 4}
                textAnchor="end"
                fontFamily="'JetBrains Mono', monospace"
                fontSize={9}
                fill={t.faint}
              >
                {fmtMs(node.duration)}
              </text>

              {/* ── Bar ── */}
              <g clipPath={`url(#${clipId})`}>
                <rect
                  x={bx}
                  y={cy - BAR_H / 2}
                  width={bw}
                  height={BAR_H}
                  rx={3}
                  fill={color}
                  opacity={isHov ? 0.95 : 0.82}
                />
                {/* Duration label inside bar (if wide enough) or after */}
                {bw > 40 ? (
                  <text
                    x={bx + bw / 2}
                    y={cy + 4}
                    textAnchor="middle"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={8.5}
                    fill="#fff"
                    opacity={0.9}
                  >
                    {fmtMs(node.duration)}
                  </text>
                ) : (
                  <text
                    x={bx + bw + 4}
                    y={cy + 4}
                    textAnchor="start"
                    fontFamily="'JetBrains Mono', monospace"
                    fontSize={8}
                    fill={t.muted}
                  >
                    {fmtMs(node.duration)}
                  </text>
                )}
              </g>

              {/* ── Tooltip on hover ── */}
              {isHov && (() => {
                const tip  = `${node.name}  ·  start: ${fmtMs(node.start)}  ·  dur: ${fmtMs(node.duration)}`;
                const tipW = Math.min(tip.length * 5.8 + 16, chartW - 8);
                const tipX = Math.min(bx, LABEL_W + chartW - tipW - 4);
                const tipY = rowY - 1;
                return (
                  <g style={{ pointerEvents: 'none' }}>
                    <rect
                      x={tipX} y={tipY - 18} width={tipW} height={16}
                      rx={4}
                      fill={t.bgRaised} stroke={t.hair} strokeWidth={0.5}
                      style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.18))' }}
                    />
                    <text
                      x={tipX + 6} y={tipY - 6}
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize={8.5}
                      fill={t.muted}
                    >
                      {tip.length > Math.floor(tipW / 5.8) ? tip.slice(0, Math.floor(tipW / 5.8) - 1) + '…' : tip}
                    </text>
                  </g>
                );
              })()}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── ResponsiveWaterfall ───────────────────────────────────────────────────────

export function ResponsiveWaterfall({ data }: { data: WFResult }) {
  const [width, setWidth] = useState(720);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.floor(w));
    });
    ro.observe(ref.current);
    setWidth(ref.current.clientWidth || 720);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <WaterfallView data={data} width={width} />
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

function WaterfallBlockEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const deleteBlock = useCallback(() => parentEditor.update(() => lexicalNode.remove()), [parentEditor, lexicalNode]);
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'chart' | 'source'>('chart');

  const data = parseWaterfallData(code);

  return (
    <div data-rich-block="true" style={{ margin: '8px 0', borderRadius: 8, border: `0.5px solid ${t.hair}`, background: t.bgSunken, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px', borderBottom: `0.5px solid ${t.hair}`,
        background: t.bgRaised, userSelect: 'none',
      }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.muted, fontWeight: 600, letterSpacing: 0.3, flex: 1 }}>waterfall</span>
        <ToolBtn
          title={viewMode === 'chart' ? 'Edit source' : 'Show chart'}
          onClick={() => setViewMode(v => v === 'chart' ? 'source' : 'chart')}
          t={t}
        >
          {viewMode === 'chart' ? 'Edit' : 'Chart'}
        </ToolBtn>
        <DeleteBtn onClick={deleteBlock} t={t} />
      </div>

      {/* Chart view */}
      {viewMode === 'chart' && (
        <div style={{ background: t.bg, padding: '12px 16px 14px', minHeight: 80 }}>
          {data ? (
            <ResponsiveWaterfall data={data} />
          ) : (
            <div style={{
              padding: '32px 0', textAlign: 'center',
              color: t.faint, fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter, sans-serif',
            }}>
              Switch to Edit and add rows: <code style={{ fontFamily: 'monospace' }}>name, start_ms, duration_ms, type</code>
            </div>
          )}
        </div>
      )}

      {/* Source edit */}
      {viewMode === 'source' && (
        <SourceTextarea
          code={code}
          onCodeChange={setCode}
          ariaLabel="Waterfall chart data"
          placeholder={`name, start, duration, type\nGET /page, 0, 1250, navigation\n  DNS lookup, 0, 12, dns\n  TCP connect, 12, 28, connect`}
          minHeight={200}
        />
      )}
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const waterfallCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'waterfall',
  priority: 100,
  Editor: WaterfallBlockEditor,
};
