import { Icon } from '../../components/chrome/Icon';

// ─── empty-board welcome ────────────────────────────────────────────────────────
// Shown on the board canvas only while it holds no tiles. Mirrors the chat
// EmptyState: a quiet heading, a couple of muted one-line tips on how tiles
// work. Everything listed maps to a real dashboard capability — update this
// when tile behavior changes rather than letting it drift into fiction.

const TIPS: { icon: string; text: string }[] = [
  { icon: 'chart', text: 'Add a tile to put an agent on the board — it runs and keeps its output fresh.' },
  { icon: 'sparkle', text: 'Pin a chart or stat straight from a chat answer onto any board.' },
  { icon: 'zap', text: 'Drag and resize tiles freely; each refreshes on its own schedule.' },
  { icon: 'plus', text: 'Group boards by theme — one per project, client, or morning routine.' },
];

export function DashboardEmptyState() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center an-rise">
      <Icon name="chart" size={26} />
      <div className="font-serif italic text-[18px] text-ink3 mt-3 max-w-[340px]">
        This board is empty — add a tile to bring an agent onto it.
      </div>

      <div className="flex flex-col gap-1.5 mt-6 max-w-[520px] text-left">
        {TIPS.map((t) => (
          <div key={t.text} className="flex items-center gap-2 text-[11.5px] text-ink3">
            <span className="flex-none"><Icon name={t.icon} size={12} /></span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
