import { Icon } from './Icon';

// ─── empty-surface placeholder ────────────────────────────────────────────────
// Shared richer empty state, modelled on the chat new-session EmptyState: an
// icon, a serif heading, an optional sub-line, and a short tips list of what the
// surface will hold and how it fills in. Used for recording detail tabs and the
// knowledge-base note pane before content exists. `pending` swaps the icon for a
// pulse so a still-processing surface reads as "on the way" rather than empty.
// `preview` appends an early-access disclaimer: these surfaces aren't final, and
// efficiency + reliable-sourcing work is still landing.
export function TabPlaceholder({ icon, heading, sub, tips, pending, preview }: {
  icon: string;
  heading: string;
  sub?: string;
  tips?: { icon: string; text: string }[];
  pending?: boolean;
  preview?: boolean;
}) {
  return (
    <div className="flex flex-col items-center text-center mt-10 an-rise">
      <span className={pending ? 'an-pulse text-accent' : 'text-ink3'}><Icon name={icon} size={24} /></span>
      <div className="font-serif italic text-[17px] text-ink2 mt-3 max-w-[340px]">{heading}</div>
      {sub && <div className="text-[12px] text-ink3 mt-1.5 max-w-[360px] leading-snug">{sub}</div>}
      {tips && tips.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-5 max-w-[420px] text-left">
          {tips.map((t) => (
            <div key={t.text} className="flex items-center gap-2 text-[11.5px] text-ink3">
              <span className="flex-none text-accent"><Icon name={t.icon} size={12} /></span>
              <span>{t.text}</span>
            </div>
          ))}
        </div>
      )}
      {preview && (
        <div className="flex items-center gap-1.5 mt-6 px-2.5 py-1 rounded-full border border-border bg-card/60 text-[10.5px] text-faint">
          <span className="flex-none text-accent"><Icon name="sparkle" size={11} /></span>
          <span>Early preview — not final. Faster processing and more reliable sourcing are on the way.</span>
        </div>
      )}
    </div>
  );
}
