import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from '@mdxeditor/editor';
import { useTheme } from './theme';
import { SourceTextarea } from './SourceTextarea';
import { parseChartData } from './ChartCodeBlockEditor';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DiffRow {
  label:  string;
  before: number;
  after:  number;
  delta:  number;
  pct:    number;
}

export interface DiffChartResult {
  rows:        DiffRow[];
  beforeLabel: string;
  afterLabel:  string;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

export function parseDiffData(code: string): DiffChartResult | null {
  const base = parseChartData(code);
  if (!base || base.series.length < 2) return null;
  const [s0, s1] = base.series;
  return {
    beforeLabel: s0.name,
    afterLabel:  s1.name,
    rows: base.labels.map((label, i) => {
      const before = s0.values[i];
      const after  = s1.values[i];
      const delta  = after - before;
      const pct    = before !== 0 ? (delta / Math.abs(before)) * 100 : 0;
      return { label, before, after, delta, pct };
    }),
  };
}

// ── Format helper ─────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  if (!Number.isInteger(n))     return n.toFixed(Math.abs(n) < 10 ? 2 : 1);
  return String(n);
};

// ── DiffChart SVG ─────────────────────────────────────────────────────────────

const ROW_H   = 52;
const LABEL_W = 162;
const CHART_PAD = 18;  // side padding inside chart area
const DELTA_W = 88;
const DOT_R   = 7;
const HDR_H   = 50;
const UP_C    = 'oklch(0.48 0.17 160)';
const DN_C    = 'oklch(0.50 0.18 15)';
const UP_BG   = 'oklch(0.94 0.06 160)';
const DN_BG   = 'oklch(0.96 0.04 15)';

function DiffChartSvg({ rows, width, beforeLabel, afterLabel }: {
  rows: DiffRow[]; width: number; beforeLabel: string; afterLabel: string;
}) {
  const t      = useTheme();
  const isDark = t.name === 'dark';
  const [hov, setHov] = useState<number | null>(null);

  const chartW = Math.max(0, width - LABEL_W - DELTA_W - CHART_PAD * 2 - 8);
  const svgH   = HDR_H + rows.length * ROW_H + 4;

  const allVals = rows.flatMap(r => [r.before, r.after]);
  const minV    = Math.min(0, ...allVals);
  const maxV    = Math.max(...allVals);
  const range   = maxV - minV || 1;
  const cx0     = LABEL_W + CHART_PAD;
  const scaleX  = (v: number) => cx0 + ((v - minV) / range) * chartW;

  // Axis tick values (min, mid, max)
  const axisTicks = [minV, minV + range / 2, maxV];

  return (
    <svg width={width} height={svgH} style={{ display: 'block', overflow: 'visible' }}>

      {/* ── Header background ── */}
      <rect x={0} y={0} width={width} height={HDR_H}
        fill={isDark ? 'oklch(0.22 0.01 60)' : 'oklch(0.97 0.008 80)'} />

      {/* ── Label column separator ── */}
      <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={svgH}
        stroke={t.hair} strokeWidth={1} />

      {/* ── Delta column separator ── */}
      <line x1={width - DELTA_W} y1={HDR_H} x2={width - DELTA_W} y2={svgH}
        stroke={t.hairSoft} strokeWidth={0.5} />

      {/* ── Header: axis ticks ── */}
      {axisTicks.map((v, i) => (
        <g key={i}>
          <line x1={scaleX(v)} y1={HDR_H - 6} x2={scaleX(v)} y2={HDR_H}
            stroke={t.hair} strokeWidth={0.75} />
          <text x={scaleX(v)} y={HDR_H - 10} textAnchor="middle"
            fontFamily="'JetBrains Mono', monospace" fontSize={8.5}
            fill={t.faint}>{fmt(v)}</text>
        </g>
      ))}

      {/* ── Header: series labels at extremes ── */}
      <g>
        <circle cx={scaleX(minV)} cy={20} r={5}
          fill={t.bgRaised} stroke={t.muted} strokeWidth={1.8} />
        <text x={scaleX(minV) + 8} y={24}
          fontFamily="Inter, sans-serif" fontSize={10.5} fontWeight={500}
          fill={t.muted}>{beforeLabel}</text>
      </g>
      <g>
        <circle cx={scaleX(maxV)} cy={20} r={5} fill={t.accent} />
        <text x={scaleX(maxV) - 8} y={24} textAnchor="end"
          fontFamily="Inter, sans-serif" fontSize={10.5} fontWeight={500}
          fill={t.accent}>{afterLabel}</text>
      </g>

      {/* ── Header bottom border ── */}
      <line x1={0} y1={HDR_H} x2={width} y2={HDR_H}
        stroke={t.hair} strokeWidth={1} />

      {/* ── Row separators ── */}
      {rows.map((_, i) => (
        <line key={i}
          x1={0} y1={HDR_H + (i + 1) * ROW_H}
          x2={width} y2={HDR_H + (i + 1) * ROW_H}
          stroke={t.hairSoft} strokeWidth={0.5} />
      ))}

      {/* ── Axis grid lines (faint) ── */}
      {axisTicks.map((v, i) => (
        i === 0 ? null : (
          <line key={i} x1={scaleX(v)} y1={HDR_H} x2={scaleX(v)} y2={svgH}
            stroke={t.hairSoft} strokeWidth={0.5} strokeDasharray="3 3" />
        )
      ))}

      {/* ── Rows ── */}
      {rows.map((row, i) => {
        const rowY   = HDR_H + i * ROW_H;
        const cy     = rowY + ROW_H / 2;
        const bx     = scaleX(row.before);
        const ax     = scaleX(row.after);
        const up     = row.delta >= 0;
        const lineC  = up ? UP_C : DN_C;
        const badgeBg = isDark
          ? (up ? 'oklch(0.28 0.06 160)' : 'oklch(0.28 0.06 15)')
          : (up ? UP_BG : DN_BG);
        const isHov  = hov === i;
        const pct    = `${up ? '+' : ''}${row.pct.toFixed(0)}%`;
        const delta  = `${up ? '+' : ''}${fmt(row.delta)}`;

        return (
          <g key={i}
            onMouseEnter={() => setHov(i)}
            onMouseLeave={() => setHov(null)}
            style={{ cursor: 'default' }}
          >
            {/* Row hover */}
            {isHov && (
              <rect x={0} y={rowY} width={width} height={ROW_H}
                fill={isDark ? 'oklch(0.26 0.01 60 / 0.8)' : 'oklch(0.95 0.01 80 / 0.8)'} />
            )}

            {/* Label */}
            <text x={LABEL_W - 12} y={cy + 4.5} textAnchor="end"
              fontFamily="Inter, sans-serif" fontSize={12}
              fill={isHov ? t.ink : t.inkSoft}
              fontWeight={isHov ? 500 : 400}>
              {row.label.length > 20 ? row.label.slice(0, 18) + '…' : row.label}
            </text>

            {/* Direction dot in label gutter */}
            <circle cx={LABEL_W - 4} cy={cy} r={3} fill={lineC} opacity={0.8} />

            {/* Track line (full range, faint) */}
            <line x1={cx0} y1={cy} x2={cx0 + chartW} y2={cy}
              stroke={t.hairSoft} strokeWidth={1} />

            {/* Connector (before → after) */}
            <line x1={bx} y1={cy} x2={ax} y2={cy}
              stroke={lineC} strokeWidth={isHov ? 3 : 2}
              strokeLinecap="round"
            />

            {/* Before dot (hollow ring) */}
            <circle cx={bx} cy={cy} r={DOT_R}
              fill={isDark ? 'oklch(0.22 0.01 60)' : '#fff'}
              stroke={t.muted} strokeWidth={2}
            />
            {/* Before value */}
            <text x={bx} y={cy - DOT_R - 6} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace" fontSize={8.5}
              fill={isHov ? t.inkSoft : t.faint}>{fmt(row.before)}</text>

            {/* After dot (filled) */}
            <circle cx={ax} cy={cy} r={DOT_R}
              fill={t.accent}
            />
            {/* Inner highlight */}
            <circle cx={ax} cy={cy} r={3}
              fill={isDark ? 'oklch(0.22 0.01 60)' : '#fff'} opacity={0.5}
            />
            {/* After value */}
            <text x={ax} y={cy + DOT_R + 14} textAnchor="middle"
              fontFamily="'JetBrains Mono', monospace" fontSize={8.5}
              fill={isHov ? t.accent : `${t.accent}99`}>{fmt(row.after)}</text>

            {/* Delta badge (pill) */}
            <g transform={`translate(${width - DELTA_W + 8}, ${cy - 14})`}>
              <rect x={0} y={0} width={DELTA_W - 16} height={28} rx={6}
                fill={badgeBg}
                stroke={`${lineC}44`} strokeWidth={1}
              />
              <text x={(DELTA_W - 16) / 2} y={13} textAnchor="middle"
                fontFamily="'JetBrains Mono', monospace" fontSize={11}
                fontWeight={700} fill={lineC}>{pct}</text>
              <text x={(DELTA_W - 16) / 2} y={24} textAnchor="middle"
                fontFamily="'JetBrains Mono', monospace" fontSize={8}
                fill={isDark ? `${lineC}cc` : lineC} opacity={0.75}>{delta}</text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

// ── ResponsiveDiffChart ───────────────────────────────────────────────────────

export function ResponsiveDiffChart({ rows, beforeLabel, afterLabel }: {
  rows: DiffRow[]; beforeLabel: string; afterLabel: string;
}) {
  const [width, setWidth] = useState(560);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.floor(w));
    });
    ro.observe(ref.current);
    setWidth(ref.current.clientWidth || 560);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <DiffChartSvg rows={rows} width={width}
        beforeLabel={beforeLabel} afterLabel={afterLabel} />
    </div>
  );
}

// ── DeleteBtn ─────────────────────────────────────────────────────────────────

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

// ── ToolBtn ───────────────────────────────────────────────────────────────────

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

// ── Editor component ──────────────────────────────────────────────────────────

function DiffChartBlockEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'chart' | 'source'>('chart');
  const deleteBlock = () => parentEditor.update(() => lexicalNode.remove());

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);
  void onResizeStart;

  const result = parseDiffData(code);

  return (
    <div data-rich-block="true" style={{ margin: '8px 0', borderRadius: 8, border: `0.5px solid ${t.hair}`, background: t.bgSunken, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px', borderBottom: `0.5px solid ${t.hair}`,
        background: t.bgRaised, userSelect: 'none',
      }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.muted, fontWeight: 600, letterSpacing: 0.3, flex: 1 }}>diff-chart</span>
        <ToolBtn title={viewMode === 'chart' ? 'Edit source' : 'Show chart'}
          onClick={() => setViewMode(v => v === 'chart' ? 'source' : 'chart')} t={t}>
          {viewMode === 'chart' ? 'Edit' : 'Chart'}
        </ToolBtn>
        <DeleteBtn onClick={deleteBlock} t={t} />
      </div>

      {/* Diff view */}
      {viewMode === 'chart' && (
        <div style={{ background: t.bg, padding: '0 0 4px' }}>
          {result && result.rows.length > 0 ? (
            <ResponsiveDiffChart rows={result.rows}
              beforeLabel={result.beforeLabel} afterLabel={result.afterLabel} />
          ) : (
            <div style={{
              padding: '32px 0', textAlign: 'center',
              color: t.faint, fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter, sans-serif',
            }}>
              Add two columns (Before + After) — switch to Edit to define your data
            </div>
          )}
        </div>
      )}

      {/* Source edit */}
      {viewMode === 'source' && (
        <SourceTextarea
          code={code}
          onCodeChange={setCode}
          ariaLabel="Diff chart data"
          placeholder={`label, Before, After\nThroughput (rps), 1200, 3400\nMemory (MB), 256, 128\nLatency (ms), 45, 12`}
          minHeight={140}
        />
      )}
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const diffChartCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'diffchart',
  priority: 100,
  Editor: DiffChartBlockEditor,
};
