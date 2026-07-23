import { Icon } from '../../components/chrome/Icon';

// ─── slash commands (quick actions from the composer) ─────────────────────────
export const SLASH_CMDS = [
  { cmd: 'clear', label: 'Clear chat', desc: 'Start a new conversation', icon: 'x' },
] as const;
export type SlashCmd = (typeof SLASH_CMDS)[number]['cmd'];

export function SlashMenu({ matches, idx, onPick }: {
  matches: typeof SLASH_CMDS[number][]; idx: number; onPick: (c: SlashCmd) => void;
}) {
  return (
    <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 min-w-[260px] bg-card border border-border rounded-[12px] shadow-pop p-1 an-rise">
      <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-600 uppercase tracking-wider text-ink3">Quick actions</div>
      {matches.map((c, i) => (
        <button key={c.cmd} type="button"
          onMouseDown={(e) => { e.preventDefault(); onPick(c.cmd); }}
          className={`w-full text-left px-2 py-1.5 rounded-[8px] flex items-center gap-2.5 ${i === idx ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-border-soft'}`}>
          <span className={i === idx ? 'text-accent' : 'text-ink3'}><Icon name={c.icon} size={13} /></span>
          <span className="flex-1 min-w-0">
            <span className="text-[12.5px] font-550">/{c.cmd}</span>
            <span className="text-[11px] text-ink3 ml-1.5">{c.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
