import { SHeader, SGroup } from './primitives';
import { isDesktop, isMac, modKey } from '../../platform';

// ─── shortcut registry ────────────────────────────────────────────────────────
// Documents what the code *does today*, not what it's named. Handlers all accept
// (metaKey || ctrlKey), so `mod` renders as ⌘ or Ctrl per platform.
//
// Keep this in sync when you add a binding — this page is hand-maintained, since
// the handlers are spread across the Electron shell and a dozen renderer files
// with no central registry to derive it from.
type Shortcut = {
  keys: string[];        // 'mod' expands to ⌘/Ctrl; everything else renders verbatim
  label: string;
  hint?: string;
  desktopOnly?: boolean; // hidden in web mode, where the binding doesn't exist
};

const GROUPS: { title: string; note?: string; items: Shortcut[] }[] = [
  {
    title: 'Global',
    note: 'Work from anywhere in the app.',
    items: [
      { keys: ['mod', 'K'], label: 'Command palette', hint: 'Search notes, recordings and tasks, or type > for commands.' },
      {
        keys: ['mod', 'R'], label: 'Go to Capture', desktopOnly: true,
        hint: 'Opens the Capture screen. It does not start or stop a recording — use the button on Capture for that.',
      },
      { keys: ['Esc'], label: 'Close', hint: 'Dismisses the palette, menus, popovers and the mermaid zoom view.' },
    ],
  },
  {
    title: 'Command palette',
    note: 'While the palette is open.',
    items: [
      { keys: ['↑', '↓'], label: 'Move through results' },
      { keys: ['↵'], label: 'Open the selected result' },
      { keys: ['>'], label: 'Switch to commands', hint: 'Type > as the first character to list actions instead of content.' },
    ],
  },
  {
    title: 'Writing',
    note: 'While a note, chat box or field has focus.',
    items: [
      { keys: ['mod', 'S'], label: 'Save', hint: 'Notes and skills. Only writes when there are unsaved changes.' },
      { keys: ['↵'], label: 'Send or commit', hint: 'Sends a chat message, or commits an inline edit.' },
      { keys: ['⇧', '↵'], label: 'New line', hint: 'Adds a line break in the chat composer instead of sending.' },
      { keys: ['mod', '↵'], label: 'Submit', hint: 'New task, assistant instructions and meeting templates.' },
    ],
  },
  {
    title: 'Sign in',
    note: 'On the PIN screen.',
    items: [
      { keys: ['0', '–', '9'], label: 'Enter a digit' },
      { keys: ['⌫'], label: 'Delete the last digit' },
    ],
  },
];

// Supplied by the OS/Electron rather than the app — worth listing so the page
// answers "what does ⌘W do here?", which is otherwise a surprising one to learn.
const SYSTEM: Shortcut[] = [
  { keys: ['mod', 'W'], label: 'Close the window', hint: 'Closes the whole app window, not the current tab.' },
  { keys: ['mod', 'Q'], label: 'Quit' },
  { keys: ['mod', 'M'], label: 'Minimise' },
  { keys: ['mod', ','], label: 'Preferences', hint: 'Reserved by the system menu; this app does not use it.' },
  { keys: ['mod', '+'], label: 'Zoom in' },
  { keys: ['mod', '−'], label: 'Zoom out' },
  { keys: ['mod', '0'], label: 'Reset zoom' },
];

// ─── key cap ──────────────────────────────────────────────────────────────────
// Mirrors the <kbd> styling CommandPalette established (its esc / ↑↓ / ↵ caps).
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 font-mono text-[11px] text-ink2 border border-border rounded-[5px] bg-bg">
      {children}
    </kbd>
  );
}

function Keys({ keys }: { keys: string[] }) {
  const mod = modKey();
  return (
    <span className="flex items-center gap-1 flex-none">
      {keys.map((k, i) => (
        <Kbd key={i}>{k === 'mod' ? mod : k}</Kbd>
      ))}
    </span>
  );
}

function Row({ item }: { item: Shortcut }) {
  return (
    <div className="flex items-start gap-4 px-3.5 py-2.5 border-b border-border-soft last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-ink">{item.label}</div>
        {item.hint && <div className="text-[11.5px] text-ink3 leading-relaxed mt-0.5">{item.hint}</div>}
      </div>
      <div className="pt-0.5"><Keys keys={item.keys} /></div>
    </div>
  );
}

function Table({ items }: { items: Shortcut[] }) {
  return (
    <div className="rounded-[10px] border border-border bg-card overflow-hidden max-w-[560px]">
      {items.map((s) => <Row key={s.label} item={s} />)}
    </div>
  );
}

// ─── screen ───────────────────────────────────────────────────────────────────
export function KeyboardShortcuts() {
  const desktop = isDesktop();
  const mod = modKey();

  return (
    <>
      <SHeader
        title="Keyboard shortcuts"
        subtitle={`Every shortcut this app responds to. ${isMac() ? '⌘ and Ctrl both work' : 'Ctrl and ⌘ both work'} — this page shows the one your keyboard uses.`}
      />
      <div className="overflow-y-auto pb-8">
        {GROUPS.map((g) => {
          const items = g.items.filter((s) => desktop || !s.desktopOnly);
          if (!items.length) return null;
          return (
            <SGroup key={g.title} title={g.title}>
              {g.note && <div className="text-[11.5px] text-ink3 leading-relaxed mb-2 max-w-[560px]">{g.note}</div>}
              <Table items={items} />
            </SGroup>
          );
        })}

        {!desktop && (
          <SGroup title="In this browser">
            <div className="text-[11.5px] text-ink3 leading-relaxed max-w-[560px]">
              {mod}R reloads the page here, so it isn’t available as an app shortcut — that
              binding only exists in the desktop app. Your browser also keeps {mod}T, {mod}L,
              {' '}{mod}W and {mod}N for itself.
            </div>
          </SGroup>
        )}

        <SGroup title="System">
          <div className="text-[11.5px] text-ink3 leading-relaxed mb-2 max-w-[560px]">
            Handled by {desktop ? 'the operating system' : 'your browser'} rather than the app,
            and listed here because they work while you’re using it.
          </div>
          <Table items={SYSTEM} />
        </SGroup>
      </div>
    </>
  );
}
