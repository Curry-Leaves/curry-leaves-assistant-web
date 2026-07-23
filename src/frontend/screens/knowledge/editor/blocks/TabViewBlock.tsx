import { useState } from 'react';
import { useTheme } from './theme';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TabItem {
  label: string;
  content: string;
}

export type TabLayout = 'horizontal' | 'vertical';

export interface ParsedTabView {
  tabs: TabItem[];
  layout: TabLayout;
}

// ── Parser ────────────────────────────────────────────────────────────────────
// Optional first line: `:layout=vertical` (default is horizontal)
// Tab sections delimited by `=== Tab Label` lines.

export function parseTabs(code: string): ParsedTabView {
  const lines = code.split('\n');
  let layout: TabLayout = 'horizontal';
  let startIdx = 0;

  if (lines[0]?.startsWith(':layout=')) {
    if (lines[0].slice(8).trim() === 'vertical') layout = 'vertical';
    startIdx = 1;
  }

  const tabs: TabItem[] = [];
  let label = '';
  let body: string[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('=== ')) {
      if (label) tabs.push({ label, content: body.join('\n').trim() });
      label = line.slice(4).trim();
      body = [];
    } else {
      body.push(line);
    }
  }
  if (label) tabs.push({ label, content: body.join('\n').trim() });
  return { tabs, layout };
}

export function serializeTabs(tabs: TabItem[], layout: TabLayout = 'horizontal'): string {
  const header = layout === 'vertical' ? ':layout=vertical\n' : '';
  return header + tabs.map(t => `=== ${t.label}\n${t.content}`).join('\n\n');
}

// ── TabViewBlock ──────────────────────────────────────────────────────────────

export function TabViewBlock({
  tabs,
  layout = 'horizontal',
  renderContent,
}: {
  tabs: TabItem[];
  layout?: TabLayout;
  renderContent: (content: string, label: string) => React.ReactNode;
}) {
  const t = useTheme();
  const [activeIdx, setActiveIdx] = useState(0);

  if (tabs.length === 0) return null;

  const active = tabs[Math.min(activeIdx, tabs.length - 1)];

  // ── Vertical layout ──────────────────────────────────────────────────────────
  if (layout === 'vertical') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        border: `0.5px solid ${t.hair}`,
        borderRadius: 8,
        overflow: 'hidden',
        margin: '1em 0',
        background: t.bgRaised,
      }}>
        {/* Left tab list */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          borderRight: `0.5px solid ${t.hair}`,
          background: t.bgSunken,
          minWidth: 120,
          flexShrink: 0,
          overflowY: 'auto',
        }}>
          {tabs.map((tab, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveIdx(i)}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderLeft: `2px solid ${i === activeIdx ? t.accent : 'transparent'}`,
                background: i === activeIdx ? t.bgRaised : 'transparent',
                color: i === activeIdx ? t.ink : t.muted,
                cursor: 'pointer',
                fontSize: 12.5,
                fontFamily: 'Inter, sans-serif',
                fontWeight: i === activeIdx ? 550 : 400,
                textAlign: 'left',
                whiteSpace: 'nowrap',
                transition: 'color 0.1s, border-color 0.1s, background 0.1s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: '14px 18px', flex: 1, minWidth: 0 }}>
          {renderContent(active.content, active.label)}
        </div>
      </div>
    );
  }

  // ── Horizontal layout (default) ──────────────────────────────────────────────
  return (
    <div style={{
      border: `0.5px solid ${t.hair}`,
      borderRadius: 8,
      overflow: 'hidden',
      margin: '1em 0',
      background: t.bgRaised,
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: `0.5px solid ${t.hair}`,
        background: t.bgSunken,
        overflowX: 'auto',
      }}>
        {tabs.map((tab, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActiveIdx(i)}
            style={{
              padding: '8px 16px',
              border: 'none',
              borderBottom: `2px solid ${i === activeIdx ? t.accent : 'transparent'}`,
              background: 'transparent',
              color: i === activeIdx ? t.ink : t.muted,
              cursor: 'pointer',
              fontSize: 12.5,
              fontFamily: 'Inter, sans-serif',
              fontWeight: i === activeIdx ? 550 : 400,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              transition: 'color 0.1s, border-color 0.1s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '14px 18px' }}>
        {renderContent(active.content, active.label)}
      </div>
    </div>
  );
}
