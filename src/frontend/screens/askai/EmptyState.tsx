import { Icon } from '../../components/chrome/Icon';

// ─── new-chat welcome ──────────────────────────────────────────────────────────
// Shown in the thread panel until the first message. Three layers: starter
// prompts (click to fill the composer), what the assistant can reach, and how
// to drive the chat itself (steer, fork, compact). Everything listed maps to a
// real capability of the seeded Assistant agent or the composer UI — update
// this when tools/surfaces change rather than letting it drift into fiction.

const STARTERS = [
  'Summarize my last recording',
  "What's on my todo list?",
  'Remind me to follow up on the demo tomorrow at 9',
  'Search my notes for anything about pricing',
];

const CAPABILITIES: { icon: string; title: string; desc: string }[] = [
  { icon: 'ear', title: 'Recordings', desc: 'Summarize meetings, pull decisions and action items from transcripts.' },
  { icon: 'check', title: 'Todos & reminders', desc: 'Add, update, and schedule them in plain language.' },
  { icon: 'library', title: 'Knowledge base', desc: 'Search your saved notes and file new things away.' },
  { icon: 'globe', title: 'Web research', desc: 'Search the web and read pages when your notes aren’t enough.' },
  { icon: 'slides', title: 'Docs & decks', desc: 'Turn a conversation into a document or presentation.' },
  { icon: 'chart', title: 'Dashboard tiles', desc: 'Pin a chart or stat from chat onto your dashboard.' },
];

const TIPS: { icon: string; text: string }[] = [
  { icon: 'paperclip', text: 'Attach files or dictate with the mic — both live in the composer.' },
  { icon: 'zap', text: 'Keep typing while it works: Steer folds in now, Follow-up waits its turn.' },
  { icon: 'fork', text: 'Hover any of your messages to fork a new chat from that point.' },
  { icon: 'brain', text: 'Pick the agent, model, and thinking effort in the chips below the composer.' },
];

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center text-center mt-12 an-rise">
      <Icon name="sparkle" size={26} />
      <div className="font-serif italic text-[18px] text-ink3 mt-3 max-w-[320px]">
        Ask Curry Leaves about your recordings, todos, or anything else.
      </div>

      <div className="flex flex-wrap justify-center gap-1.5 mt-5 max-w-[560px]">
        {STARTERS.map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)}
            className="px-3 py-1.5 rounded-full border border-border bg-card text-[12px] text-ink2 hover:border-accent hover:text-accent transition-colors">
            {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-7 w-full max-w-[560px] text-left">
        {CAPABILITIES.map((c) => (
          <div key={c.title} className="flex items-start gap-2.5 px-3 py-2.5 rounded-[12px] border border-border bg-card/60">
            <span className="text-accent flex-none mt-0.5"><Icon name={c.icon} size={14} /></span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-550 text-ink">{c.title}</div>
              <div className="text-[11.5px] text-ink3 leading-snug mt-0.5">{c.desc}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5 mt-6 max-w-[560px] text-left">
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
