import { memo } from 'react';
import { Icon } from './Icon';
import type { Screen } from '../../App';

export const SCREEN_LABELS: Record<Screen, string> = {
  capture: 'Capture', ask: 'Ask AI', recordings: 'Recordings', tasks: 'Tasks', knowledge: 'Knowledge', agents: 'Assistants', board: 'Dashboard', artifacts: 'Artifacts', trace: 'Trace', usage: 'Usage', settings: 'Settings',
};

const SCREEN_ICONS: Record<Screen, string> = {
  board: 'grid', capture: 'mic', ask: 'chat', recordings: 'history', tasks: 'check',
  knowledge: 'brain', agents: 'sparkle', artifacts: 'slides', trace: 'zap', usage: 'chart', settings: 'settings',
};

// No `active` prop: the active tab's `.is-active` class is toggled imperatively (see
// App), so flipping tabs never re-renders these components — only adding/removing does.
// The Dashboard (inbox) is the permanent home tab: no close button, ever (App.closeTab
// also no-ops for it as a second line of defense).
const PERMANENT_TABS = new Set<Screen>(['board']);

const Tab = memo(function Tab({ screen, label, onSelect, onClose }: {
  screen: Screen; label: string; onSelect: (s: Screen) => void; onClose: (s: Screen) => void;
}) {
  const closable = !PERMANENT_TABS.has(screen);
  return (
    <div className="ttab" data-screen={screen} onClick={() => onSelect(screen)} title={label}>
      <div className="ttab-inner">
        <span className="ttab-icon"><Icon name={SCREEN_ICONS[screen]} size={13} /></span>
        <span className="ttab-label">{label}</span>
        {closable && (
          <div className="ttab-close" title="Close tab" onClick={(e) => { e.stopPropagation(); onClose(screen); }}>
            <Icon name="x" size={9} />
          </div>
        )}
      </div>
    </div>
  );
});

/** Dynamic tab strip: one tab per OPEN page, each closable.
 *  Styling + active highlight live in CSS (.ttab*); memoized so it re-renders only when
 *  the open-tab list changes — not on tab switches or unrelated app updates. */
export const TopTabs = memo(function TopTabs({ tabs, onSelect, onClose }: {
  tabs: Screen[]; onSelect: (s: Screen) => void; onClose: (s: Screen) => void;
}) {
  if (tabs.length === 0) return null;
  return (
    <div className="ttab-group-outer">
      <div className="ttab-group-inner">
        {tabs.map((s) => (
          <Tab key={s} screen={s} label={SCREEN_LABELS[s]} onSelect={onSelect} onClose={onClose} />
        ))}
      </div>
    </div>
  );
});
