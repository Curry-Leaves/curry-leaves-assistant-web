import { Icon } from '../../components/chrome/Icon';
import { THEMES, useTheme, type ThemeMeta } from '../../theme';

// ─── theme picker ──────────────────────────────────────────────────────────────
function ThemeSwatch({ s }: { s: ThemeMeta['swatch'] }) {
  return (
    <span className="flex-none w-10 h-10 rounded-[7px] border border-border relative overflow-hidden" style={{ background: s.bg }}>
      <span className="absolute left-1 top-1 right-1 h-2.5 rounded-[3px]" style={{ background: s.card }} />
      <span className="absolute left-1 bottom-1 w-4 h-2 rounded-[3px]" style={{ background: s.ink }} />
      <span className="absolute right-1 bottom-1 w-2.5 h-2.5 rounded-full" style={{ background: s.accent }} />
    </span>
  );
}

export function ThemePicker() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-w-[580px] mt-2">
      {THEMES.map((t) => {
        const active = theme === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => setTheme(t.id)}
            className={`text-left rounded-[10px] border p-2.5 transition-colors ${
              active ? 'border-accent bg-accent-soft/25' : 'border-border bg-card hover:border-ink3'
            }`}
          >
            <div className="flex items-center gap-2.5 mb-1.5">
              <ThemeSwatch s={t.swatch} />
              <span className="text-[12.5px] font-550 text-ink flex-1 truncate">{t.label}</span>
              {active && <span className="text-accent flex-none"><Icon name="check" size={15} /></span>}
            </div>
            <div className="text-[11px] text-ink3 leading-snug">{t.blurb}</div>
          </button>
        );
      })}
    </div>
  );
}
