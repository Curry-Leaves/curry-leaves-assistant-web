import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { insertCodeBlock$ } from '@mdxeditor/editor';
import { usePublisher } from '@mdxeditor/gurx';
import { ChevronDown } from 'lucide-react';
import { useTheme } from './theme';

// ── Starters ──────────────────────────────────────────────────────────────────

export const STARTERS: Record<string, string> = {
  tabs:      '=== Tab 1\nContent for the first tab.\n\n=== Tab 2\nContent for the second tab.\n',
  mermaid:   '%% cl:height=260 align=center\ngraph LR\n  A[Start] --> B[End]\n',
  calendar:  '',
  chart:     'label, Before, After\nThroughput (rps), 1200, 3400\nMemory (MB), 256, 128\nLatency (ms), 45, 12\nError Rate (%), 2.1, 0.3',
  diffchart: 'label, Before, After\nThroughput (rps), 1200, 3400\nMemory (MB), 256, 128\nLatency (ms), 45, 12\nError Rate (%), 2.1, 0.3',
  timeline:  'task, start, end, status\nDiscovery, 2026-05-01, 2026-05-08, done\nDesign, 2026-05-05, 2026-05-16, done\nDevelopment, 2026-05-14, 2026-06-06, active\nTesting, 2026-05-28, 2026-06-13, pending\nLaunch, 2026-06-16, 2026-06-16, milestone',
  mindmap:   'Central Topic\n  Branch A\n    Sub A1\n    Sub A2\n  Branch B\n    Sub B1\n  Branch C',
  waterfall: 'name, start, duration, type\nGET /page, 0, 1250, navigation\n  DNS, 0, 12, dns\n  Connect, 12, 45, connect\n  Request, 57, 180, request\n  Transfer, 237, 620, transfer\nGET /api/data, 300, 280, api\n  Auth, 305, 18, auth\n  DB query, 323, 220, db\n  Serialize, 543, 40, process\nRender, 1100, 150, render',
  sankey:    'Source A -> Target X: 40\nSource A -> Target Y: 25\nSource B -> Target X: 20\nSource B -> Target Z: 35\nTarget X -> Output 1: 45\nTarget X -> Output 2: 15\nTarget Y -> Output 2: 25\nTarget Z -> Output 3: 35',
  kanban:    '=== To Do\n- Design database schema\n- Write API tests\n\n=== In Progress\n- Build authentication flow\n\n=== Done\n- Project kickoff\n',
  // An empty scene: you insert a drawing to draw in it, so anything prefilled would just be
  // something to delete first.
  // No height directive: the block falls back to its own DEFAULT_H, so the default lives in ONE
  // place (ExcalidrawCodeBlockEditor) instead of being pinned here too.
  excalidraw: '{\n  "type": "excalidraw",\n  "version": 2,\n  "source": "curry-leaves",\n  "elements": [],\n  "appState": {}\n}',
  api:       'POST /v1/users  "Create a new user"\ndomain: api.example.com\nenv: production  https://api.example.com\nenv: staging     https://staging.api.example.com\nauth: Bearer\nscopes: users:read users:write\n\n# Query\nnotify   boolean   optional   Send welcome email (default true)\n\n# Headers\nX-Trace-Id   string   optional   For request tracing\n\n# Scenarios\n\n## Happy path\n> request schema\nname   string   required   User\'s display name\nemail  string   required   Primary email address\nrole   string   optional   admin or user (default: user)\n\n> request\n{ "name": "Alice", "email": "alice@example.com" }\n\n> response 201 schema\nid         string   required   Unique user UUID\nname       string   required   Display name\nemail      string   required   Primary email\ncreatedAt  string   required   ISO 8601 timestamp\n\n> response 201\n{ "id": "u_123", "name": "Alice", "email": "alice@example.com", "createdAt": "2026-05-13T00:00:00Z" }\n\n## Validation error\n> request schema\nemail  string   required   Must be a valid email address\n\n> request\n{ "email": "not-an-email" }\n\n> response 400 schema\nerror  string   required   Machine-readable error code\nfield  string   optional   Which field failed validation\n\n> response 400\n{ "error": "invalid_email", "field": "email" }\n',
};

const ITEMS = [
  {
    language: 'tabs',
    label: 'Tabs',
    desc: 'Switchable tab group',
    icon: (accent: string, hair: string) => (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1.5, flexShrink: 0 }}>
        <span style={{ display: 'flex', gap: 1.5 }}>
          <span style={{ width: 11, height: 3.5, borderRadius: '1.5px 1.5px 0 0', background: accent }} />
          <span style={{ width: 8, height: 3.5, borderRadius: '1.5px 1.5px 0 0', background: hair }} />
        </span>
        <span style={{ width: 21, height: 8, borderRadius: '0 2px 2px 2px', border: `1.5px solid ${hair}` }} />
      </span>
    ),
  },
  {
    language: 'mermaid',
    label: 'Diagram',
    desc: 'Mermaid flowchart / sequence / etc.',
    icon: (accent: string) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, border: `1.5px solid ${accent}` }} />
        <span style={{ width: 10, height: 1.5, background: accent, borderRadius: 1 }} />
        <span style={{ width: 7, height: 7, borderRadius: 2, border: `1.5px solid ${accent}` }} />
      </span>
    ),
  },
  {
    language: 'calendar',
    label: 'Calendar',
    desc: 'Month grid with events',
    icon: (accent: string, hair: string) => (
      <span style={{
        width: 14, height: 14, border: `1.5px solid ${hair}`, borderRadius: 2.5,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
      }}>
        <span style={{ height: 4, background: accent, flexShrink: 0 }} />
        <span style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '1px', padding: '1px' }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} style={{ background: hair, borderRadius: 0.5 }} />
          ))}
        </span>
      </span>
    ),
  },
  {
    language: 'chart',
    label: 'Chart',
    desc: 'Grouped bar chart from grid data',
    icon: () => (
      <span style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 14, flexShrink: 0 }}>
        <span style={{ width: 3.5, height: 6,  background: 'oklch(0.58 0.18 250)', borderRadius: '1px 1px 0 0' }} />
        <span style={{ width: 3.5, height: 10, background: 'oklch(0.56 0.18 160)', borderRadius: '1px 1px 0 0' }} />
        <span style={{ width: 3.5, height: 4,  background: 'oklch(0.58 0.18 250)', borderRadius: '1px 1px 0 0', opacity: 0.65 }} />
        <span style={{ width: 3.5, height: 8,  background: 'oklch(0.56 0.18 160)', borderRadius: '1px 1px 0 0', opacity: 0.65 }} />
      </span>
    ),
  },
  {
    language: 'diffchart',
    label: 'Diff Chart',
    desc: 'Before → After dumbbell comparison',
    icon: (_a: string, h: string) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 3, height: 14, flexShrink: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', border: `1.5px solid ${h}`, background: 'transparent' }} />
        <span style={{ flex: 1, height: 1.5, background: 'oklch(0.50 0.17 160)', borderRadius: 1 }} />
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'oklch(0.58 0.18 250)' }} />
      </span>
    ),
  },
  {
    language: 'timeline',
    label: 'Timeline',
    desc: 'Gantt chart for project tracking',
    icon: (accent: string, hair: string) => (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2.5, flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 4, height: 5, borderRadius: 1, background: 'oklch(0.68 0.07 240)' }} />
          <span style={{ width: 10, height: 5, borderRadius: 1, background: 'oklch(0.68 0.07 240)' }} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 4, height: 5, borderRadius: 1, background: hair }} />
          <span style={{ width: 16, height: 5, borderRadius: 1, background: accent }} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 4, height: 5, borderRadius: 1, background: hair }} />
          <span style={{ width: 6, height: 5, borderRadius: 1, background: hair, marginLeft: 6 }} />
        </span>
      </span>
    ),
  },
  {
    language: 'mindmap',
    label: 'Mind Map',
    desc: 'Hierarchical radial tree diagram',
    icon: (accent: string, hair: string) => (
      <span style={{ position: 'relative', width: 22, height: 14, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: accent, position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)' }} />
        <span style={{ width: 8, height: 1, background: hair, position: 'absolute', left: 6, top: 4 }} />
        <span style={{ width: 8, height: 1, background: hair, position: 'absolute', left: 6, top: 9 }} />
        <span style={{ width: 4, height: 4, borderRadius: 1, background: 'oklch(0.55 0.18 250)', position: 'absolute', left: 14, top: 2 }} />
        <span style={{ width: 4, height: 4, borderRadius: 1, background: 'oklch(0.52 0.17 160)', position: 'absolute', left: 14, top: 8 }} />
      </span>
    ),
  },
  {
    language: 'waterfall',
    label: 'Waterfall',
    desc: 'Performance drill-down with timings',
    icon: (_a: string, hair: string) => (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 2, height: 4 }} />
          <span style={{ width: 14, height: 4, borderRadius: 1, background: 'oklch(0.52 0.18 250)' }} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 4, height: 4 }} />
          <span style={{ width: 10, height: 4, borderRadius: 1, background: 'oklch(0.50 0.17 160)' }} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 8, height: 4 }} />
          <span style={{ width: 12, height: 4, borderRadius: 1, background: hair }} />
        </span>
      </span>
    ),
  },
  {
    language: 'sankey',
    label: 'Sankey',
    desc: 'Flow / allocation diagram',
    icon: (accent: string) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 1.5, height: 14, flexShrink: 0 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ width: 4, height: 5, borderRadius: 1, background: accent }} />
          <span style={{ width: 4, height: 7, borderRadius: 1, background: 'oklch(0.52 0.17 160)' }} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, transform: 'scaleX(1.5)', marginLeft: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: 1, background: 'oklch(0.60 0.15 250)' }} />
          <span style={{ width: 6, height: 6, borderRadius: 1, background: 'oklch(0.56 0.15 160)' }} />
        </span>
      </span>
    ),
  },
  {
    language: 'api',
    label: 'API Spec',
    desc: 'REST / GraphQL endpoint documentation',
    icon: (accent: string, hair: string) => (
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 8, height: 4, borderRadius: 1.5, background: accent }} />
          <span style={{ width: 12, height: 4, borderRadius: 1.5, background: hair }} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 5, height: 3, borderRadius: 1, background: 'oklch(0.60 0.14 150)' }} />
          <span style={{ width: 14, height: 3, borderRadius: 1, background: hair, opacity: 0.5 }} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <span style={{ width: 5, height: 3, borderRadius: 1, background: 'oklch(0.65 0.15 65)' }} />
          <span style={{ width: 14, height: 3, borderRadius: 1, background: hair, opacity: 0.5 }} />
        </span>
      </span>
    ),
  },
  {
    language: 'excalidraw',
    label: 'Drawing',
    desc: 'Freehand sketch, boxes and arrows',
    icon: (accent: string, hair: string) => (
      <span style={{ display: 'flex', alignItems: 'center', gap: 2.5, flexShrink: 0 }}>
        <span style={{ width: 9, height: 9, borderRadius: 1.5, border: `1.5px solid ${accent}`, transform: 'rotate(-6deg)' }} />
        <span style={{ width: 8, height: 1.5, background: hair, borderRadius: 1 }} />
        <span style={{ width: 9, height: 9, borderRadius: '50%', border: `1.5px solid ${hair}` }} />
      </span>
    ),
  },
  {
    language: 'kanban',
    label: 'Kanban',
    desc: 'Task board with columns and cards',
    icon: (_a: string, h: string) => (
      <span style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14, flexShrink: 0 }}>
        <span style={{ width: 5, height: 12, borderRadius: 1, border: `1.5px solid ${h}`, display: 'flex', flexDirection: 'column', gap: 1, padding: '1px' }}>
          <span style={{ flex: 1, borderRadius: 0.5, background: 'oklch(0.58 0.18 250)' }} />
          <span style={{ flex: 1, borderRadius: 0.5, background: 'oklch(0.58 0.18 250)', opacity: 0.5 }} />
        </span>
        <span style={{ width: 5, height: 10, borderRadius: 1, border: `1.5px solid ${h}`, display: 'flex', flexDirection: 'column', gap: 1, padding: '1px' }}>
          <span style={{ flex: 1, borderRadius: 0.5, background: 'oklch(0.56 0.18 160)' }} />
        </span>
        <span style={{ width: 5, height: 8, borderRadius: 1, border: `1.5px solid ${h}`, display: 'flex', flexDirection: 'column', gap: 1, padding: '1px' }}>
          <span style={{ flex: 1, borderRadius: 0.5, background: h, opacity: 0.7 }} />
          <span style={{ flex: 1, borderRadius: 0.5, background: h, opacity: 0.7 }} />
        </span>
      </span>
    ),
  },
];

// ── InsertMoreButton ──────────────────────────────────────────────────────────

export function InsertMoreButton() {
  const insertCodeBlock = usePublisher(insertCodeBlock$);
  const t = useTheme();
  const [open, setOpen]     = useState(false);
  const [pos, setPos]       = useState({ top: 0, left: 0 });
  const [hovIdx, setHovIdx] = useState<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
    setOpen(v => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const insert = (language: string) => {
    insertCodeBlock({ language, code: STARTERS[language] ?? '' });
    setOpen(false);
    setHovIdx(null);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-toolbar-item="true"
        onMouseDown={openMenu}
        style={{
          display: 'flex', alignItems: 'center', gap: 3,
          fontFamily: 'Inter, sans-serif', fontSize: 11.5,
          padding: '2px 6px', borderRadius: 5,
          background: open ? t.bgSunken : 'transparent',
          border: `0.5px solid ${open ? t.hair : 'transparent'}`,
          color: open ? t.ink : t.inkSoft,
          cursor: 'pointer', transition: 'all 0.1s',
        }}
      >
        Insert
        <ChevronDown size={11} style={{ transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && createPortal(
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            zIndex: 9999,
            background: t.bgRaised,
            border: `0.5px solid ${t.hair}`,
            borderRadius: 10,
            boxShadow: t.shadowLg,
            padding: 4,
            minWidth: 220,
          }}
        >
          {ITEMS.map((item, i) => (
            <button
              key={item.language}
              type="button"
              onMouseDown={e => { e.preventDefault(); insert(item.language); }}
              onMouseEnter={() => setHovIdx(i)}
              onMouseLeave={() => setHovIdx(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', textAlign: 'left',
                padding: '7px 10px', borderRadius: 6,
                border: 'none',
                background: hovIdx === i ? t.bgSunken : 'transparent',
                cursor: 'pointer', transition: 'background 0.1s',
              }}
            >
              <span style={{ width: 24, display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                {item.icon(t.accent, t.hair)}
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 500, color: t.ink, lineHeight: 1.2 }}>
                  {item.label}
                </span>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: t.muted, lineHeight: 1.3 }}>
                  {item.desc}
                </span>
              </span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
