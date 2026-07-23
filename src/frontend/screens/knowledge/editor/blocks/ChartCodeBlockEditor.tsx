import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
  insertCodeBlock$,
} from '@mdxeditor/editor';
import { usePublisher } from '@mdxeditor/gurx';
import { useTheme } from './theme';
import { SourceTextarea } from './SourceTextarea';

// ── Parse ─────────────────────────────────────────────────────────────────────

export interface ChartData {
  labels: string[];
  series: { name: string; values: number[] }[];
}

const SERIES_COLORS = [
  'oklch(0.58 0.18 250)',  // blue
  'oklch(0.56 0.18 160)',  // green
  'oklch(0.62 0.19 45)',   // orange
  'oklch(0.56 0.18 310)',  // purple
  'oklch(0.56 0.19 15)',   // red
  'oklch(0.56 0.18 200)',  // teal
];

export function parseChartData(code: string): ChartData | null {
  const lines = code.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//') && !l.match(/^\|[-:\s|]+\|$/));

  if (!lines.length) return null;

  const rows: string[][] = [];

  for (const line of lines) {
    if (line.startsWith('|')) {
      // Markdown table row
      rows.push(line.split('|').map(c => c.trim()).filter(Boolean));
    } else {
      // CSV row
      rows.push(line.split(',').map(c => c.trim()));
    }
  }

  if (rows.length < 2) return null;
  const [header, ...body] = rows;
  if (header.length < 2) return null;

  return {
    labels: body.map(r => r[0] ?? ''),
    series: header.slice(1).map((name, si) => ({
      name,
      values: body.map(r => parseFloat(r[si + 1]?.replace(/[^0-9.-]/g, '') ?? '') || 0),
    })),
  };
}

// ── Format helpers ────────────────────────────────────────────────────────────

const fmt = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
  if (!Number.isInteger(n))     return n.toFixed(n < 10 ? 2 : 1);
  return String(n);
};

// ── BarChart (SVG) ────────────────────────────────────────────────────────────

function BarChart({ data, width, height = 260 }: { data: ChartData; width: number; height?: number }) {
  const t = useTheme();
  const [hov, setHov] = useState<{ si: number; li: number } | null>(null);

  const ML = 48, MR = 16, MT = 36, MB = 52;
  const cW = Math.max(0, width - ML - MR);
  const cH = height - MT - MB;

  const allValues = data.series.flatMap(s => s.values);
  const minVal = Math.min(0, ...allValues);
  const maxVal = Math.max(0, ...allValues);
  const range  = maxVal - minVal || 1;

  const numLabels = data.labels.length;
  const numSeries = data.series.length;
  const groupW    = cW / Math.max(numLabels, 1);
  const barW      = Math.max(6, Math.min(36, (groupW / numSeries) * 0.72));
  const groupPad  = (groupW - barW * numSeries) / 2;

  const yScale = (v: number) => cH - ((v - minVal) / range) * cH;
  const zeroY  = yScale(0);

  // Y-axis ticks
  const nTicks = 5;
  const rawStep = range / nTicks;
  const mag  = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = Math.ceil(rawStep / mag) * mag;
  const tickFirst = Math.ceil(minVal / step) * step;
  const ticks: number[] = [];
  for (let v = tickFirst; v <= maxVal + step * 0.01; v += step) ticks.push(parseFloat(v.toFixed(10)));

  const showDiff = numSeries === 2;

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {/* Legend */}
      <g transform={`translate(${ML}, 10)`}>
        {data.series.map((s, si) => (
          <g key={si} transform={`translate(${si * 110}, 0)`}>
            <rect x={0} y={0} width={10} height={10} rx={2} fill={SERIES_COLORS[si % SERIES_COLORS.length]} />
            <text x={14} y={9} fontFamily="Inter, sans-serif" fontSize={10.5} fill={t.inkSoft}>{s.name}</text>
          </g>
        ))}
      </g>

      <g transform={`translate(${ML}, ${MT})`}>
        {/* Y-axis grid + labels */}
        {ticks.map(tick => (
          <g key={tick}>
            <line x1={0} y1={yScale(tick)} x2={cW} y2={yScale(tick)}
              stroke={tick === 0 ? t.hair : t.hairSoft} strokeWidth={tick === 0 ? 1 : 0.5} />
            <text x={-6} y={yScale(tick) + 4} textAnchor="end"
              fontFamily="'JetBrains Mono', monospace" fontSize={8.5} fill={t.faint}>{fmt(tick)}</text>
          </g>
        ))}

        {/* Bars per group */}
        {data.labels.map((label, li) => {
          const gx = li * groupW + groupPad;
          return (
            <g key={li} transform={`translate(${gx}, 0)`}>
              {data.series.map((series, si) => {
                const val = series.values[li];
                const barTop  = val >= 0 ? yScale(val) : zeroY;
                const barHgt  = Math.abs(yScale(val) - zeroY);
                const color   = SERIES_COLORS[si % SERIES_COLORS.length];
                const isHov   = hov?.si === si && hov?.li === li;
                const bx      = si * barW;

                return (
                  <g key={si}
                    onMouseEnter={() => setHov({ si, li })}
                    onMouseLeave={() => setHov(null)}
                    style={{ cursor: 'default' }}
                  >
                    <rect x={bx} y={barTop} width={barW - 1.5} height={Math.max(1, barHgt)}
                      fill={color} rx={2.5}
                      opacity={isHov ? 1 : 0.82}
                      style={{ transition: 'opacity 0.1s' }}
                    />
                    {/* Value label */}
                    <text
                      x={bx + (barW - 1.5) / 2}
                      y={val >= 0 ? barTop - 5 : barTop + barHgt + 13}
                      textAnchor="middle"
                      fontFamily="'JetBrains Mono', monospace"
                      fontSize={8}
                      fill={isHov ? t.ink : t.muted}
                    >{fmt(val)}</text>

                    {/* Hover tooltip */}
                    {isHov && (
                      <g transform={`translate(${bx + (barW - 1.5) / 2}, ${val >= 0 ? barTop - 24 : barTop + barHgt + 28})`}>
                        <rect x={-30} y={-12} width={60} height={16} rx={4}
                          fill={t.bgRaised} stroke={t.hair} strokeWidth={0.5}
                          style={{ filter: `drop-shadow(0 1px 3px rgba(0,0,0,0.15))` }}
                        />
                        <text textAnchor="middle" y={0}
                          fontFamily="Inter, sans-serif" fontSize={9.5} fill={t.ink}>
                          {series.name}: {fmt(val)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Diff annotation (2-series only) */}
              {showDiff && (() => {
                const v1 = data.series[0].values[li];
                const v2 = data.series[1].values[li];
                if (v1 === 0) return null;
                const pct = ((v2 - v1) / Math.abs(v1)) * 100;
                const up  = v2 >= v1;
                const cx  = barW;
                const cy  = Math.min(yScale(v1), yScale(v2)) - 14;
                return (
                  <text key="diff" x={cx} y={cy} textAnchor="middle"
                    fontFamily="'JetBrains Mono', monospace" fontSize={8.5} fontWeight={700}
                    fill={up ? 'oklch(0.52 0.16 160)' : 'oklch(0.52 0.18 15)'}>
                    {up ? '↑' : '↓'}{Math.abs(pct).toFixed(0)}%
                  </text>
                );
              })()}

              {/* X-axis label */}
              <text
                x={numSeries * barW / 2}
                y={cH + 16}
                textAnchor="middle"
                fontFamily="Inter, sans-serif"
                fontSize={10}
                fill={t.inkSoft}
              >{label}</text>
            </g>
          );
        })}

        {/* Zero line (prominent) */}
        <line x1={0} y1={zeroY} x2={cW} y2={zeroY} stroke={t.hair} strokeWidth={1} />
      </g>
    </svg>
  );
}

// ── ResponsiveChart ───────────────────────────────────────────────────────────

export function ResponsiveChart({ data, height }: { data: ChartData; height: number }) {
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
      <BarChart data={data} width={width} height={height} />
    </div>
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

// ── Toolbar button ────────────────────────────────────────────────────────────

const CHART_STARTER = `label, Before, After
Throughput (rps), 1200, 3400
Memory (MB), 256, 128
Latency (ms), 45, 12
Error Rate (%), 2.1, 0.3`;

export function InsertChartButton() {
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const t = useTheme();
  return (
    <button
      type="button"
      title="Insert chart"
      data-toolbar-item="true"
      onClick={() => insertCodeBlock({ language: 'chart', code: CHART_STARTER })}
      style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'Inter, sans-serif', fontSize: 11.5 }}
    >
      {/* Mini bar chart icon */}
      <span style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 12, flexShrink: 0 }}>
        <span style={{ width: 3.5, height: 6,  background: SERIES_COLORS[0], borderRadius: '1px 1px 0 0' }} />
        <span style={{ width: 3.5, height: 10, background: SERIES_COLORS[1], borderRadius: '1px 1px 0 0' }} />
        <span style={{ width: 3.5, height: 4,  background: SERIES_COLORS[0], borderRadius: '1px 1px 0 0', opacity: 0.7 }} />
        <span style={{ width: 3.5, height: 8,  background: SERIES_COLORS[1], borderRadius: '1px 1px 0 0', opacity: 0.7 }} />
        <span style={{ width: 3.5, height: 7,  background: SERIES_COLORS[0], borderRadius: '1px 1px 0 0', opacity: 0.5 }} />
        <span style={{ width: 3.5, height: 12, background: SERIES_COLORS[1], borderRadius: '1px 1px 0 0', opacity: 0.5 }} />
      </span>
      Chart
    </button>
  );
}

// ── Editor component ──────────────────────────────────────────────────────────

const DEFAULT_H = 260;

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

function ChartBlockEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const deleteBlock = () => parentEditor.update(() => lexicalNode.remove());
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'chart' | 'source'>('chart');
  const [containerH, setContainerH] = useState(DEFAULT_H);

  const data = parseChartData(code);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startH = containerH, startY = e.clientY;
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => setContainerH(Math.max(120, startH + ev.clientY - startY));
    const onUp   = (ev: MouseEvent) => {
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      setContainerH(Math.max(120, startH + ev.clientY - startY));
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  }, [containerH]);

  return (
    <div data-rich-block="true" style={{ margin: '8px 0', borderRadius: 8, border: `0.5px solid ${t.hair}`, background: t.bgSunken, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 8px', borderBottom: `0.5px solid ${t.hair}`,
        background: t.bgRaised, userSelect: 'none',
      }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.muted, fontWeight: 600, letterSpacing: 0.3, flex: 1 }}>chart</span>
        <ToolBtn title={viewMode === 'chart' ? 'Edit source' : 'Show chart'}
          onClick={() => setViewMode(v => v === 'chart' ? 'source' : 'chart')} t={t}>
          {viewMode === 'chart' ? 'Edit' : 'Chart'}
        </ToolBtn>
        <DeleteBtn onClick={deleteBlock} t={t} />
      </div>

      {/* Chart view */}
      {viewMode === 'chart' && (
        <>
          <div style={{ background: t.bg, padding: '12px 16px', minHeight: containerH }}>
            {data ? (
              <ResponsiveChart data={data} height={containerH - 24} />
            ) : (
              <div style={{
                height: containerH - 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: t.faint, fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter, sans-serif',
              }}>
                No data — switch to Edit and add rows
              </div>
            )}
          </div>
          <div onMouseDown={onResizeStart} title="Drag to resize"
            style={{ height: 8, cursor: 'row-resize', borderTop: `0.5px solid ${t.hair}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 28, height: 2, borderRadius: 1, background: t.hair }} />
          </div>
        </>
      )}

      {/* Source edit */}
      {viewMode === 'source' && (
        <SourceTextarea
          code={code}
          onCodeChange={setCode}
          ariaLabel="Chart data"
          placeholder={`label, Series A, Series B\nRow 1, 100, 200\nRow 2, 150, 80`}
          minHeight={140}
        />
      )}
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const chartCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'chart',
  priority: 100,
  Editor: ChartBlockEditor,
};
