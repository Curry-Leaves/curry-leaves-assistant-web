import { useState, useCallback, useMemo, useRef } from 'react';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
  insertCodeBlock$,
} from '@mdxeditor/editor';
import { usePublisher } from '@mdxeditor/gurx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTheme } from './theme';

// ── Parse / serialize ─────────────────────────────────────────────────────────

type EventMap = Map<string, string[]>;

const parseEvents = (code: string): EventMap => {
  const map: EventMap = new Map();
  for (const line of code.split('\n')) {
    const m = line.match(/^(\d{4}-\d{2}-\d{2}):\s*(.+)$/);
    if (!m) continue;
    const existing = map.get(m[1]) ?? [];
    map.set(m[1], [...existing, m[2].trim()]);
  }
  return map;
};

const serializeEvents = (events: EventMap): string =>
  [...events.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, titles]) => titles.map(t => `${date}: ${t}`))
    .join('\n');

// ── Calendar helpers ──────────────────────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const toDateStr = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

// ── CalendarGrid (shared by editor + view) ───────────────────────────────────

export function CalendarGrid({
  year, month, events,
  onAddEvent, onRemoveEvent,
  editable = false,
}: {
  year: number;
  month: number;
  events: EventMap;
  onAddEvent?: (date: string, title: string) => void;
  onRemoveEvent?: (date: string, title: string) => void;
  editable?: boolean;
}) {
  const t = useTheme();
  const [addingDate, setAddingDate] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const now = new Date();
  const todayStr = toDateStr(now.getFullYear(), now.getMonth(), now.getDate());

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow    = new Date(year, month, 1).getDay();

  const cells: (number | null)[] = [
    ...Array<null>(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const commit = (date: string) => {
    if (draft.trim()) onAddEvent?.(date, draft.trim());
    setAddingDate(null);
    setDraft('');
  };

  return (
    <div>
      {/* Weekday headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
        {DAY_ABBR.map(d => (
          <div key={d} style={{
            textAlign: 'center',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 8.5, fontWeight: 700,
            letterSpacing: 0.6, textTransform: 'uppercase',
            color: t.muted, padding: '3px 0',
          }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2.5 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} style={{ minHeight: 54 }} />;

          const dateStr = toDateStr(year, month, day);
          const dayEvents = events.get(dateStr) ?? [];
          const isToday   = dateStr === todayStr;
          const dow       = (firstDow + day - 1) % 7;
          const isWeekend = dow === 0 || dow === 6;

          return (
            <div
              key={dateStr}
              onClick={() => { if (editable && addingDate !== dateStr) { setAddingDate(dateStr); setDraft(''); } }}
              style={{
                minHeight: 54,
                borderRadius: 6,
                padding: '4px 5px',
                background: isToday
                  ? `color-mix(in oklch, ${t.accent} 10%, ${t.bgRaised})`
                  : t.bgRaised,
                border: `0.5px solid ${isToday ? t.accent + '55' : t.hairSoft}`,
                cursor: editable ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', gap: 2,
                transition: 'background 0.1s',
              }}
            >
              {/* Day number */}
              <span style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9.5,
                fontWeight: isToday ? 700 : 500,
                color: isToday ? t.accent : isWeekend ? t.muted : t.inkSoft,
                lineHeight: 1, flexShrink: 0,
              }}>{day}</span>

              {/* Event chips */}
              {dayEvents.map((ev, ei) => (
                <div
                  key={ei}
                  title={editable ? `Remove: ${ev}` : ev}
                  onClick={e => { if (!editable) return; e.stopPropagation(); onRemoveEvent?.(dateStr, ev); }}
                  style={{
                    fontSize: 9, fontFamily: 'Inter, sans-serif',
                    background: `color-mix(in oklch, ${t.accent} 16%, ${t.bgRaised})`,
                    color: t.accent,
                    borderRadius: 3, padding: '1.5px 4px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    cursor: editable ? 'pointer' : 'default',
                    lineHeight: 1.45,
                  }}
                >{ev}</div>
              ))}

              {/* Inline add input */}
              {addingDate === dateStr && (
                <input
                  autoFocus
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { e.stopPropagation(); commit(dateStr); }
                    if (e.key === 'Escape') { setAddingDate(null); setDraft(''); }
                  }}
                  onBlur={() => commit(dateStr)}
                  onClick={e => e.stopPropagation()}
                  placeholder="Event…"
                  style={{
                    fontSize: 9, fontFamily: 'Inter, sans-serif',
                    border: `0.5px solid ${t.accent}`,
                    borderRadius: 3, padding: '1.5px 4px',
                    background: t.bg, color: t.ink,
                    outline: 'none', width: '100%', boxSizing: 'border-box',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── NavBtn ────────────────────────────────────────────────────────────────────

function NavBtn({ onClick, children, t }: { onClick: () => void; children: React.ReactNode; t: ReturnType<typeof useTheme> }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? t.bgSunken : 'none',
        border: 'none', cursor: 'pointer', borderRadius: 4,
        color: hov ? t.ink : t.muted,
        display: 'flex', alignItems: 'center', padding: '2px 4px',
        transition: 'background 0.1s, color 0.1s',
      }}
    >{children}</button>
  );
}

// ── Toolbar button ────────────────────────────────────────────────────────────

export function InsertCalendarButton() {
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const t = useTheme();
  return (
    <button
      type="button"
      title="Insert calendar"
      data-toolbar-item="true"
      onClick={() => insertCodeBlock({ language: 'calendar', code: '' })}
      style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'Inter, sans-serif', fontSize: 11.5 }}
    >
      {/* Mini calendar icon */}
      <span style={{
        width: 15, height: 14, border: `1.5px solid ${t.hair}`, borderRadius: 3,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
      }}>
        <span style={{ height: 4, background: t.accent, flexShrink: 0, display: 'block' }} />
        <span style={{
          flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1px', padding: '1px',
        }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} style={{ background: t.hairSoft, borderRadius: 0.5 }} />
          ))}
        </span>
      </span>
      Cal
    </button>
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

// ── Editor component ──────────────────────────────────────────────────────────

function CalendarBlockEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const deleteBlock = () => parentEditor.update(() => lexicalNode.remove());
  const t = useTheme();

  const now = new Date();
  const [events, setEvents]     = useState<EventMap>(() => parseEvents(code));
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const eventsRef = useRef(events); eventsRef.current = events;

  const commit = useCallback((next: EventMap) => {
    setEvents(new Map(next));
    eventsRef.current = next;
    setCode(serializeEvents(next));
  }, [setCode]);

  const addEvent = useCallback((date: string, title: string) => {
    const next = new Map(eventsRef.current);
    next.set(date, [...(next.get(date) ?? []), title]);
    commit(next);
  }, [commit]);

  const removeEvent = useCallback((date: string, title: string) => {
    const next = new Map(eventsRef.current);
    const titles = (next.get(date) ?? []).filter(ev => ev !== title);
    if (titles.length === 0) next.delete(date); else next.set(date, titles);
    commit(next);
  }, [commit]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  return (
    <div data-rich-block="true" style={{
      margin: '8px 0',
      borderRadius: 8,
      border: `0.5px solid ${t.hair}`,
      background: t.bgSunken,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 10px',
        borderBottom: `0.5px solid ${t.hair}`,
        background: t.bgRaised,
        userSelect: 'none',
      }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          color: t.muted, fontWeight: 600, letterSpacing: 0.3, flex: 1,
        }}>calendar</span>
        <NavBtn onClick={prevMonth} t={t}><ChevronLeft size={12} /></NavBtn>
        <span style={{
          fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 600,
          color: t.ink, minWidth: 110, textAlign: 'center',
        }}>{MONTHS[viewMonth]} {viewYear}</span>
        <NavBtn onClick={nextMonth} t={t}><ChevronRight size={12} /></NavBtn>
        <DeleteBtn onClick={deleteBlock} t={t} />
      </div>

      {/* Grid */}
      <div style={{ padding: '8px 12px 10px' }}>
        <CalendarGrid
          year={viewYear} month={viewMonth}
          events={events}
          onAddEvent={addEvent}
          onRemoveEvent={removeEvent}
          editable
        />
      </div>

      {/* Hint */}
      <div style={{
        padding: '3px 12px 6px',
        borderTop: `0.5px solid ${t.hairSoft}`,
      }}>
        <span style={{
          fontSize: 9.5, color: t.faint, fontFamily: 'Inter, sans-serif',
        }}>Click a day to add · click an event to remove</span>
      </div>
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const calendarCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'calendar',
  priority: 100,
  Editor: CalendarBlockEditor,
};

// ── Read-only view ────────────────────────────────────────────────────────────
// The rendered form for the note VIEW (see components/Markdown.tsx). Same grid as the editor,
// but cells aren't clickable — month navigation is the only interaction.

const MONTHS_V = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function CalendarViewBlock({ code, title }: { code: string; title?: string }) {
  const t = useTheme();
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const events = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const line of code.split('\n')) {
      const m = line.match(/^(\d{4}-\d{2}-\d{2}):\s*(.+)$/);
      if (!m) continue;
      map.set(m[1], [...(map.get(m[1]) ?? []), m[2].trim()]);
    }
    return map;
  }, [code]);

  const prev = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const next = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const [hovBtn, setHovBtn] = useState<'prev' | 'next' | null>(null);
  const navStyle = (which: 'prev' | 'next'): React.CSSProperties => ({
    background: hovBtn === which ? t.bgSunken : 'none',
    border: 'none', cursor: 'pointer', borderRadius: 4,
    color: hovBtn === which ? t.ink : t.muted,
    display: 'flex', alignItems: 'center', padding: '2px 5px',
    transition: 'background 0.1s, color 0.1s',
  });

  return (
    <div style={{ margin: '1em 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0 6px', userSelect: 'none' }}>
        {title
          ? <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13.5, color: t.ink, fontWeight: 600, flex: 1 }}>{title}</span>
          : <span style={{ flex: 1 }} />}
        <button type="button" onClick={prev} style={navStyle('prev')} aria-label="Previous month"
          onMouseEnter={() => setHovBtn('prev')} onMouseLeave={() => setHovBtn(null)}>‹</button>
        <span style={{
          fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 600,
          color: t.ink, minWidth: 110, textAlign: 'center',
        }}>{MONTHS_V[viewMonth]} {viewYear}</span>
        <button type="button" onClick={next} style={navStyle('next')} aria-label="Next month"
          onMouseEnter={() => setHovBtn('next')} onMouseLeave={() => setHovBtn(null)}>›</button>
      </div>
      <CalendarGrid year={viewYear} month={viewMonth} events={events} editable={false} />
    </div>
  );
}
