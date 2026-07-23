import { useState, useCallback, useRef, useLayoutEffect, useId } from 'react';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from '@mdxeditor/editor';
import { useTheme } from './theme';
import { SourceTextarea } from './SourceTextarea';

// ── Types ─────────────────────────────────────────────────────────────────────

type TLStatus = 'done' | 'active' | 'pending' | 'blocked' | 'review' | 'milestone';

interface TLRow {
  task:        string;
  start:       Date;
  end:         Date;
  status:      TLStatus;
  isMilestone: boolean;
}

// ── Parse ─────────────────────────────────────────────────────────────────────

const VALID_STATUSES: TLStatus[] = ['done','active','pending','blocked','review','milestone'];

const parseDate = (s: string): Date | null => {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
};

export function parseTimelineData(code: string): TLRow[] | null {
  const lines = code.split('\n').map(l => l.trim()).filter(Boolean);
  const rows: TLRow[] = [];

  for (const line of lines) {
    // skip header/separator rows
    if (line.startsWith('#') || line.match(/^[|\s-]+$/)) continue;
    const cols = line.startsWith('|')
      ? line.split('|').map(c => c.trim()).filter(Boolean)
      : line.split(',').map(c => c.trim());

    if (cols.length < 3) continue;
    const task  = cols[0];
    const start = parseDate(cols[1]);
    if (!task || !start) continue;
    const end  = parseDate(cols[2]) ?? new Date(start);
    const raw  = cols[3]?.toLowerCase() ?? '';
    const status: TLStatus = (VALID_STATUSES.includes(raw as TLStatus) ? raw : 'pending') as TLStatus;
    const isMilestone = status === 'milestone' || start.getTime() === end.getTime();
    rows.push({ task, start, end: end < start ? start : end, status, isMilestone });
  }

  return rows.length ? rows : null;
}

// ── Status colours ────────────────────────────────────────────────────────────

const STATUS_FILL: Record<TLStatus, string> = {
  done:      'oklch(0.68 0.07 240)',
  active:    '',   // → t.accent
  pending:   'oklch(0.82 0.04 220)',
  blocked:   'oklch(0.52 0.18 15)',
  review:    'oklch(0.72 0.14 58)',
  milestone: '',   // → t.accent (diamond)
};

const STATUS_LABEL: Record<TLStatus, string> = {
  done: 'Done', active: 'Active', pending: 'Pending',
  blocked: 'Blocked', review: 'Review', milestone: 'Milestone',
};

// ── Date helpers ──────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const diffDays = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

// ── TimelineChart SVG ─────────────────────────────────────────────────────────

const LABEL_W  = 160;
const ROW_H    = 44;
const BAR_H    = 22;
const HEADER_H = 54;
const MS_R     = 10;
const PAD_L    = 3;
const PAD_R    = 7;
const TODAY_C  = 'oklch(0.58 0.16 25)';

function TimelineSvg({ rows, width }: { rows: TLRow[]; width: number }) {
  const t = useTheme();
  const uid = useId();
  const [hov, setHov] = useState<number | null>(null);
  const isDark = t.name === 'dark';

  const chartW  = Math.max(0, width - LABEL_W - 2);
  const svgH    = HEADER_H + rows.length * ROW_H + 4;
  const gradId  = `tl-grad-${uid}`;
  const clipId  = `tl-clip-${uid}`;

  const today   = new Date(); today.setHours(0, 0, 0, 0);
  const minDate = addDays(new Date(Math.min(...rows.map(r => r.start.getTime()))), -PAD_L);
  const maxDate = addDays(new Date(Math.max(...rows.map(r => r.end.getTime()))),   PAD_R);
  const totalDays = Math.max(1, diffDays(minDate, maxDate));

  const scaleX = (d: Date) => LABEL_W + Math.max(0, (diffDays(minDate, d) / totalDays) * chartW);
  const todayX = scaleX(today);
  const showToday = todayX >= LABEL_W && todayX <= width;

  // Month boundaries
  const months: { x: number; label: string; short: string }[] = [];
  const mc = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (mc <= maxDate) {
    const x = scaleX(mc);
    if (x >= LABEL_W - 1) {
      months.push({
        x,
        label: `${MONTHS[mc.getMonth()]} ${mc.getFullYear()}`,
        short: MONTHS[mc.getMonth()],
      });
    }
    mc.setMonth(mc.getMonth() + 1);
  }

  // Week ticks (range ≤ 70 days)
  const weekTicks: { x: number; label: string }[] = [];
  if (totalDays <= 70) {
    const wc = new Date(minDate);
    wc.setDate(wc.getDate() + (8 - wc.getDay()) % 7); // next Monday
    while (wc <= maxDate) {
      const x = scaleX(wc);
      if (x >= LABEL_W) weekTicks.push({ x, label: String(wc.getDate()) });
      wc.setDate(wc.getDate() + 7);
    }
  }

  return (
    <svg width={width} height={svgH} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        {/* Gradient for active bars */}
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={t.accent} stopOpacity="1" />
          <stop offset="100%" stopColor={t.accent} stopOpacity="0.65" />
        </linearGradient>
        {/* Clip chart area */}
        <clipPath id={clipId}>
          <rect x={LABEL_W} y={0} width={chartW} height={svgH} />
        </clipPath>
      </defs>

      {/* ── Header background ── */}
      <rect x={0} y={0} width={width} height={HEADER_H}
        fill={isDark ? 'oklch(0.22 0.01 60)' : 'oklch(0.97 0.008 80)'} />

      {/* ── Label column separator ── */}
      <line x1={LABEL_W} y1={0} x2={LABEL_W} y2={svgH}
        stroke={t.hair} strokeWidth={1} />

      {/* ── Month columns (alternating tint) ── */}
      {months.map((m, i) => {
        const nextX = months[i + 1]?.x ?? (LABEL_W + chartW);
        return i % 2 === 0 ? null : (
          <rect key={i} x={m.x} y={HEADER_H} width={nextX - m.x} height={svgH - HEADER_H}
            fill={isDark ? 'oklch(0.18 0.01 60 / 0.4)' : 'oklch(0.96 0.008 80 / 0.5)'} />
        );
      })}

      {/* ── Month separator lines ── */}
      {months.map((m, i) => (
        <line key={i} x1={m.x} y1={0} x2={m.x} y2={svgH}
          stroke={t.hair} strokeWidth={i === 0 ? 0 : 0.75} />
      ))}

      {/* ── Week tick marks on header ── */}
      {weekTicks.map((wt, i) => (
        <g key={i}>
          <line x1={wt.x} y1={HEADER_H - 8} x2={wt.x} y2={HEADER_H}
            stroke={t.hairSoft} strokeWidth={0.75} />
          <text x={wt.x} y={HEADER_H - 11} textAnchor="middle"
            fontFamily="'JetBrains Mono', monospace" fontSize={8}
            fill={t.faint}>{wt.label}</text>
        </g>
      ))}

      {/* ── Month labels ── */}
      {months.map((m, i) => {
        const nextX   = months[i + 1]?.x ?? (LABEL_W + chartW);
        const colW    = nextX - m.x;
        const labelX  = Math.max(m.x + 6, m.x + 4);
        const fits    = colW > 70;
        return (
          <text key={i} x={labelX} y={22}
            fontFamily="Inter, sans-serif" fontSize={11} fontWeight={600}
            fill={t.ink} opacity={0.75}>
            {fits ? m.label : m.short}
          </text>
        );
      })}

      {/* ── Header bottom border ── */}
      <line x1={0} y1={HEADER_H} x2={width} y2={HEADER_H}
        stroke={t.hair} strokeWidth={1} />

      {/* ── Row separators ── */}
      {rows.map((_, i) => (
        <line key={i}
          x1={0} y1={HEADER_H + (i + 1) * ROW_H}
          x2={width} y2={HEADER_H + (i + 1) * ROW_H}
          stroke={t.hairSoft} strokeWidth={0.5} />
      ))}

      {/* ── Today column (behind bars) ── */}
      {showToday && (
        <rect x={todayX - 1} y={HEADER_H} width={2} height={svgH - HEADER_H}
          fill={TODAY_C} opacity={0.12} />
      )}

      {/* ── Rows ── */}
      {rows.map((row, i) => {
        const rowY  = HEADER_H + i * ROW_H;
        const cy    = rowY + ROW_H / 2;
        const isHov = hov === i;
        const bx    = scaleX(row.start);
        const ex    = scaleX(row.end);
        const bw    = Math.max(BAR_H / 2, ex - bx);

        // Progress for active bars
        let elapsed = 0;
        if (row.status === 'active') {
          elapsed = today <= row.start ? 0
            : today >= row.end ? 1
            : diffDays(row.start, today) / Math.max(1, diffDays(row.start, row.end));
        }

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

            {/* Task label */}
            <text x={LABEL_W - 12} y={cy + 4.5}
              textAnchor="end"
              fontFamily="Inter, sans-serif" fontSize={12}
              fill={isHov ? t.ink : t.inkSoft}
              fontWeight={isHov ? 500 : 400}>
              {row.task.length > 20 ? row.task.slice(0, 18) + '…' : row.task}
            </text>

            {/* Status dot */}
            <circle cx={LABEL_W - 4} cy={cy}
              r={3}
              fill={row.status === 'active' || row.status === 'milestone'
                ? t.accent : STATUS_FILL[row.status]}
              opacity={0.85}
            />

            {row.isMilestone ? (
              // ── Milestone ──
              <>
                {/* Vertical reference line */}
                <line x1={bx} y1={HEADER_H + 2} x2={bx} y2={cy - MS_R - 2}
                  stroke={t.accent} strokeWidth={1} strokeDasharray="2 2" opacity={0.3} />
                {/* Diamond */}
                <polygon
                  points={`${bx},${cy - MS_R} ${bx + MS_R},${cy} ${bx},${cy + MS_R} ${bx - MS_R},${cy}`}
                  fill={t.accent}
                  opacity={isHov ? 1 : 0.88}
                />
                {/* Inner highlight dot */}
                <circle cx={bx} cy={cy} r={3} fill={isDark ? 'oklch(0.22 0.01 60)' : '#fff'} opacity={0.6} />
                {/* Date label */}
                <text x={bx + MS_R + 6} y={cy + 4}
                  fontFamily="Inter, sans-serif" fontSize={10} fontWeight={500}
                  fill={isHov ? t.accent : t.muted}>
                  {row.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </text>
              </>
            ) : row.status === 'pending' ? (
              // ── Pending: dashed outline ──
              <>
                <rect x={bx} y={cy - BAR_H / 2} width={bw} height={BAR_H}
                  fill={isDark ? 'oklch(0.28 0.01 220 / 0.3)' : 'oklch(0.92 0.01 220 / 0.5)'}
                  stroke={isDark ? 'oklch(0.55 0.05 220)' : 'oklch(0.72 0.05 220)'}
                  strokeDasharray="5 3" strokeWidth={1.5} rx={6} />
                {bw > 55 && (
                  <text x={bx + 9} y={cy + 4}
                    fontFamily="Inter, sans-serif" fontSize={9.5}
                    fill={t.muted} opacity={0.8}>Pending</text>
                )}
              </>
            ) : row.status === 'active' ? (
              // ── Active: progress bar ──
              <>
                {/* Background (remaining) */}
                <rect x={bx} y={cy - BAR_H / 2} width={bw} height={BAR_H}
                  fill={t.accent} opacity={0.22} rx={6} />
                {/* Elapsed portion */}
                {elapsed > 0 && (
                  <rect x={bx} y={cy - BAR_H / 2}
                    width={Math.max(BAR_H, elapsed * bw)} height={BAR_H}
                    fill={`url(#${gradId})`}
                    rx={6}
                    clipPath={`url(#${clipId})`}
                  />
                )}
                {/* Border */}
                <rect x={bx} y={cy - BAR_H / 2} width={bw} height={BAR_H}
                  fill="none" stroke={t.accent} strokeWidth={1} rx={6} opacity={0.4} />
                {bw > 55 && (
                  <text x={bx + 9} y={cy + 4}
                    fontFamily="Inter, sans-serif" fontSize={9.5}
                    fill="#fff" opacity={0.9} fontWeight={500}>Active</text>
                )}
              </>
            ) : (
              // ── Done / Review / Blocked ──
              <>
                <rect x={bx} y={cy - BAR_H / 2} width={bw} height={BAR_H}
                  fill={STATUS_FILL[row.status]}
                  rx={6}
                  opacity={isHov ? 0.95 : 0.82}
                />
                {/* Check mark for done */}
                {row.status === 'done' && bw > 30 && (
                  <text x={bx + bw - 14} y={cy + 4.5}
                    fontFamily="Inter, sans-serif" fontSize={11}
                    fill="#fff" opacity={0.7}>✓</text>
                )}
                {bw > 55 && (
                  <text x={bx + 9} y={cy + 4}
                    fontFamily="Inter, sans-serif" fontSize={9.5}
                    fill="#fff" opacity={0.85}>
                    {STATUS_LABEL[row.status]}
                  </text>
                )}
              </>
            )}

            {/* Hover date tooltip */}
            {isHov && !row.isMilestone && (() => {
              const label = `${row.start.toLocaleDateString(undefined,{month:'short',day:'numeric'})} → ${row.end.toLocaleDateString(undefined,{month:'short',day:'numeric'})}  ·  ${diffDays(row.start, row.end) + 1}d`;
              const tx = Math.min(bx, width - label.length * 5.8 - 8);
              return (
                <g>
                  <rect x={tx} y={cy - BAR_H / 2 - 20} width={label.length * 5.8 + 10} height={15}
                    rx={4} fill={t.bgRaised} stroke={t.hair} strokeWidth={0.5}
                    style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.18))' }} />
                  <text x={tx + 5} y={cy - BAR_H / 2 - 9}
                    fontFamily="'JetBrains Mono', monospace" fontSize={8.5}
                    fill={t.muted}>{label}</text>
                </g>
              );
            })()}
          </g>
        );
      })}

      {/* ── Today line (on top) ── */}
      {showToday && (
        <g>
          <line x1={todayX} y1={HEADER_H} x2={todayX} y2={svgH}
            stroke={TODAY_C} strokeWidth={1.5} opacity={0.8} />
          {/* Today badge in header */}
          <rect x={todayX - 16} y={30} width={32} height={15} rx={4} fill={TODAY_C} opacity={0.9} />
          <text x={todayX} y={41} textAnchor="middle"
            fontFamily="'JetBrains Mono', monospace" fontSize={7.5}
            fontWeight={700} fill="#fff" letterSpacing={0.4}>TODAY</text>
        </g>
      )}
    </svg>
  );
}

// ── ResponsiveTimeline ────────────────────────────────────────────────────────

export function ResponsiveTimeline({ rows }: { rows: TLRow[] }) {
  const [width, setWidth] = useState(640);
  const ref = useRef<HTMLDivElement>(null);

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
    <div ref={ref} style={{ width: '100%' }}>
      <TimelineSvg rows={rows} width={width} />
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  const t = useTheme();
  const items: { status: TLStatus; label: string; color: string }[] = [
    { status: 'done',      label: 'Done',      color: STATUS_FILL.done },
    { status: 'active',    label: 'Active',    color: t.accent },
    { status: 'pending',   label: 'Pending',   color: STATUS_FILL.pending },
    { status: 'review',    label: 'Review',    color: STATUS_FILL.review },
    { status: 'blocked',   label: 'Blocked',   color: STATUS_FILL.blocked },
    { status: 'milestone', label: 'Milestone', color: t.accent },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '6px 0 2px', borderTop: `0.5px solid ${t.hairSoft}`, marginTop: 4 }}>
      {items.map(({ status, label, color }) => (
        <span key={status} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'Inter, sans-serif', fontSize: 10, color: t.muted }}>
          {status === 'milestone' ? (
            <svg width={10} height={10}>
              <polygon points="5,0 10,5 5,10 0,5" fill={color} />
            </svg>
          ) : (
            <span style={{ width: 12, height: 8, borderRadius: 2, background: color, flexShrink: 0, display: 'inline-block' }} />
          )}
          {label}
        </span>
      ))}
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

function ToolBtn({ children, onClick, title, t }: { children: React.ReactNode; onClick: () => void; title?: string; t: ReturnType<typeof useTheme> }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" title={title} onMouseDown={e => { e.preventDefault(); onClick(); }} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, lineHeight: 1.6, border: `0.5px solid ${hov ? t.muted : t.hair}`, background: hov ? t.bgSunken : 'transparent', color: hov ? t.ink : t.inkSoft, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.1s' }}>
      {children}
    </button>
  );
}

// ── Editor component ──────────────────────────────────────────────────────────

function TimelineBlockEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'chart' | 'source'>('chart');
  const deleteBlock = () => parentEditor.update(() => lexicalNode.remove());

  const rows = parseTimelineData(code);

  return (
    <div data-rich-block="true" style={{ margin: '8px 0', borderRadius: 8, border: `0.5px solid ${t.hair}`, background: t.bgSunken, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderBottom: `0.5px solid ${t.hair}`, background: t.bgRaised, userSelect: 'none' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.muted, fontWeight: 600, letterSpacing: 0.3, flex: 1 }}>timeline</span>
        <ToolBtn title={viewMode === 'chart' ? 'Edit source' : 'Show chart'} onClick={() => setViewMode(v => v === 'chart' ? 'source' : 'chart')} t={t}>
          {viewMode === 'chart' ? 'Edit' : 'Chart'}
        </ToolBtn>
        <DeleteBtn onClick={deleteBlock} t={t} />
      </div>

      {viewMode === 'chart' && (
        <div style={{ background: t.bg, padding: '12px 16px 10px' }}>
          {rows ? (
            <>
              <ResponsiveTimeline rows={rows} />
              <Legend />
            </>
          ) : (
            <div style={{ padding: '32px 0', textAlign: 'center', color: t.faint, fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter, sans-serif' }}>
              Switch to Edit and add rows: <code style={{ fontFamily: 'monospace' }}>task, YYYY-MM-DD, YYYY-MM-DD, status</code>
            </div>
          )}
        </div>
      )}

      {viewMode === 'source' && (
        <SourceTextarea
          code={code}
          onCodeChange={setCode}
          ariaLabel="Timeline data"
          placeholder={`task, start, end, status\nDesign, 2026-05-01, 2026-05-14, done\nDevelopment, 2026-05-10, 2026-06-06, active\nLaunch, 2026-06-10, 2026-06-10, milestone`}
          minHeight={160}
        />
      )}
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const timelineCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'timeline',
  priority: 100,
  Editor: TimelineBlockEditor,
};
