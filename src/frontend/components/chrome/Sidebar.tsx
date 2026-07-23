import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { THEMES, useTheme } from '../../theme';
import { api } from '../../api/client';
import { setToken } from '../../auth';
import type { Screen } from '../../App';

type NavItem = { id: Screen; label: string; icon: string };

// Memory is one rail entry (the brain) that lands directly on the Knowledge Hub —
// Skills live in its rail; facts/notes/events live in its Memory tab.
const NAV_GROUPS: NavItem[][] = [
  [
    { id: 'capture', label: 'Capture', icon: 'mic' },
    { id: 'board', label: 'Dashboard', icon: 'grid' },
    { id: 'recordings', label: 'Recordings', icon: 'history' },
  ],
  [
    { id: 'ask', label: 'Ask AI', icon: 'chat' },
    { id: 'tasks', label: 'Tasks', icon: 'check' },
    { id: 'artifacts', label: 'Artifacts', icon: 'artifact' },
    { id: 'knowledge', label: 'Memory', icon: 'brain' },
    { id: 'agents', label: 'Assistants', icon: 'bot' },
  ],
  [
    { id: 'trace', label: 'Trace', icon: 'zap' },
    { id: 'usage', label: 'Usage', icon: 'chart' },
  ],
];

/** The rail is icon-only, which is unreadable until you already know it. Wrapping a
 *  button in this gives it a hover label that pops out to the right with an arrow
 *  poking back at the icon. `rail-tip-host` is the CSS hover/focus target, so the
 *  tip shows on keyboard focus too — it replaces `title=`, whose ~1s OS delay and
 *  detached placement made it useless as a first-run affordance. */
function RailTip({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="rail-tip-host relative flex">
      {children}
      {/* `wide` is for the sentence-length labels — they'd otherwise run off the window
          on one unbroken line. */}
      <span role="tooltip" className={`rail-tip${wide ? ' rail-tip-wide' : ''}`}>{label}</span>
    </div>
  );
}

function RailButton({
  label, active, onClick, badge, children,
}: {
  label: string; active: boolean; onClick: () => void; badge?: boolean;
  children: React.ReactNode;
}) {
  return (
    <RailTip label={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={`no-drag relative w-9 h-9 rounded-[9px] flex items-center justify-center transition-colors ${
          active ? 'bg-sidebar-border text-sidebar-active-ink' : 'text-sidebar-ink3 hover:bg-sidebar-border-soft hover:text-sidebar-ink'
        }`}
      >
        {children}
        {badge && <span className="an-blink absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />}
      </button>
    </RailTip>
  );
}

/** Bottom-of-rail theme switcher: a contrast icon that opens a compact popover
 *  for one-click theme changes (the full picker lives in Settings → General). */
function ThemeQuickPick() {
  const [theme, setTheme] = useTheme();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const openNow = () => { cancelClose(); setOpen(true); };
  // Small grace delay so the cursor can cross the gap from the icon to the menu.
  const closeSoon = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 140); };

  useEffect(() => {
    if (!open) return cancelClose;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); cancelClose(); };
  }, [open]);

  return (
    <div className="relative" onMouseEnter={openNow} onMouseLeave={closeSoon}>
      {/* No RailTip here: hovering this already opens the theme popover, which names
          itself. A label bubble would just fight the menu for the same space. */}
      <button
        type="button"
        aria-label="Theme"
        onClick={() => setOpen((o) => !o)}
        className={`no-drag relative w-9 h-9 rounded-[9px] flex items-center justify-center transition-colors ${
          open ? 'bg-sidebar-border text-accent' : 'text-sidebar-ink3 hover:bg-sidebar-border-soft hover:text-sidebar-ink'
        }`}
      >
        <Icon name="theme" size={16} />
      </button>

      {open && (
        <div className="no-drag absolute left-[44px] bottom-0 z-50 w-[210px] rounded-[12px] border border-border bg-card shadow-pop p-1.5">
          <div className="px-2 pt-1 pb-1.5 text-[10px] font-600 tracking-wider uppercase text-ink3">Theme</div>
          {THEMES.map((t) => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTheme(t.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[8px] text-left transition-colors ${
                  active ? 'bg-accent-soft/30' : 'hover:bg-border-soft'
                }`}
              >
                <span className="flex-none w-6 h-6 rounded-[6px] border border-border relative overflow-hidden" style={{ background: t.swatch.bg }}>
                  <span className="absolute left-0.5 top-0.5 right-0.5 h-1.5 rounded-[2px]" style={{ background: t.swatch.card }} />
                  <span className="absolute right-0.5 bottom-0.5 w-2 h-2 rounded-full" style={{ background: t.swatch.accent }} />
                </span>
                <span className="flex-1 text-[12.5px] text-ink font-450 truncate">{t.label}</span>
                {active && <span className="text-accent flex-none"><Icon name="check" size={14} /></span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  screen, setScreen, needsYou, wakeArmed = false,
  wakeEnabled = false, wakeAvailable = false, onToggleWake, onTalk,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
  needsYou: number;
  /** Wake word listening RIGHT NOW. Surfaced here because it holds the mic open app-wide —
   *  an unexplained lit system mic indicator is exactly what this dot answers. */
  wakeArmed?: boolean;
  /** The setting, as opposed to whether it happens to be listening this instant. */
  wakeEnabled?: boolean;
  /** Models on disk. Without them the toggle can't do anything, so it's disabled. */
  wakeAvailable?: boolean;
  /** Flip the wake word on/off — same setting as Settings → Wake word, one click away
   *  because the thing you want most after a false trigger is an off switch. */
  onToggleWake?: () => void;
  /** Start an exchange now, without saying the wake word. */
  onTalk?: () => void;
}) {
  return (
    <aside className="app-sidebar w-12 flex-none bg-sidebar flex flex-col items-center py-3 gap-1">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi} className="flex flex-col items-center gap-1">
          {gi > 0 && <div className="w-5 h-px bg-sidebar-border my-1" />}
          {group.map((item) => (
            <RailButton
              key={item.id}
              label={item.label}
              active={screen === item.id}
              onClick={() => setScreen(item.id)}
              badge={item.id === 'agents' && needsYou > 0}
            >
              <Icon name={item.icon} size={16} />
            </RailButton>
          ))}
        </div>
      ))}

      <div className="flex-1" />

      {/* Talk now — skips the wake word entirely. Works even with the wake word off, which
          is the point: you can leave the always-on listener disabled and still ask by click
          (or ⌘⇧V). Hidden only when the models aren't on disk at all. */}
      {wakeAvailable && (
        <RailTip label="Talk to your assistant (⌘⇧V)">
          <button
            type="button"
            aria-label="Talk to your assistant"
            onClick={() => onTalk?.()}
            className="no-drag w-9 h-9 rounded-[9px] flex items-center justify-center transition-colors text-sidebar-ink3 hover:bg-sidebar-border-soft hover:text-sidebar-ink"
          >
            <Icon name="wave" size={16} />
          </button>
        </RailTip>
      )}

      {/* Wake-word on/off. The dot that used to live here was read-only; a false trigger
          left you with no way to shut it up short of opening Settings. */}
      {wakeAvailable && (
        <RailTip
          wide
          label={wakeEnabled
            ? 'Wake word is on — click to stop listening. Audio stays on this device.'
            : 'Wake word is off — click to start listening for it.'}
        >
        <button
          type="button"
          aria-label={wakeEnabled ? 'Wake word is on' : 'Wake word is off'}
          onClick={() => onToggleWake?.()}
          className={`no-drag relative w-9 h-9 rounded-[9px] flex items-center justify-center transition-colors ${
            wakeEnabled
              ? 'text-sidebar-active-ink hover:bg-sidebar-border-soft'
              : 'text-sidebar-ink3 hover:bg-sidebar-border-soft hover:text-sidebar-ink'
          }`}
        >
          <Icon name="ear" size={16} />
          {/* Pulses only while actually armed and listening — off, or mid-exchange, it rests. */}
          {wakeArmed && (
            <span className="an-pulse absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-rec" />
          )}
          {!wakeEnabled && (
            // Struck through when off, so the state reads at a glance without hovering.
            <span className="absolute w-[18px] h-px bg-current rotate-45 opacity-70" />
          )}
        </button>
        </RailTip>
      )}
      <ThemeQuickPick />
      <RailButton
        label="Lock"
        active={false}
        onClick={() => { api.logout().catch(() => {}).finally(() => setToken(null)); }}
      >
        <Icon name="lock" size={16} />
      </RailButton>
      <RailButton label="Settings" active={screen === 'settings'} onClick={() => setScreen('settings')}>
        <Icon name="settings" size={16} />
      </RailButton>
    </aside>
  );
}
