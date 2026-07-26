// ─── one type scale + field layout for the Assistants screens ─────────────────
// AgentForm and ToolsManager had each grown their own set of font sizes (nine apiece,
// including one-off 8.5 / 9 / 9.5 / 10.5px steps that appear nowhere else in the app),
// so no two labels matched and nothing lined up down the page. These are the same steps
// the Settings screen's primitives use. Both screens import from here, so they can't
// drift apart again — change a step once and every field follows.

export const LABEL_CLS = 'text-[13px] font-550 text-ink mb-0.5';        // field label
export const HINT_CLS = 'text-[11.5px] text-ink3 leading-relaxed';      // helper text under a label
export const SECTION_CLS = 'text-[10px] font-600 tracking-wider uppercase text-ink3'; // column headers
export const BODY_CLS = 'text-[12.5px] text-ink2';                      // list rows, empty states
export const CHIP_CLS = 'px-2.5 py-1 rounded-full text-[12px] border';  // selectable pills
export const MONO_CLS = 'font-mono text-[12.5px]';                      // tool names, ids, types
// Inputs/selects/buttons: one height and one text size for everything interactive, so
// controls on the same row sit on a common baseline.
export const FIELD_CLS = 'h-[30px] px-2.5 rounded-[6px] border border-border bg-card text-ink text-[12.5px] outline-none focus:border-accent-soft';
export const BTN_CLS = 'h-[30px] px-3 rounded-[8px] text-[12.5px] inline-flex items-center gap-1.5';

/** A labelled row: a fixed label column beside the control, so labels line up down the
 *  page instead of each field inventing its own rhythm. `wide` drops the column for
 *  controls that need full width (a code editor, a multi-column picker). */
export function Field({ label, hint, wide, children }: {
  label: string; hint?: string; wide?: boolean; children: React.ReactNode;
}) {
  if (wide) {
    return (
      <div className="py-3.5 border-b border-border-soft last:border-0">
        <div className={LABEL_CLS}>{label}</div>
        {hint && <div className={`${HINT_CLS} mb-2 max-w-[680px]`}>{hint}</div>}
        {children}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6 py-3.5 border-b border-border-soft last:border-0 items-start">
      <div>
        <div className={LABEL_CLS}>{label}</div>
        {hint && <div className={`${HINT_CLS} max-w-[360px]`}>{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** One fact in a detail header's metadata row — a discrete chip, so facts stay legible
 *  instead of running together in a single "·"-joined sentence. */
export function Stat({ children, tone, title }: {
  children: React.ReactNode; tone?: 'warn' | 'danger'; title?: string;
}) {
  const cls = tone === 'warn' ? 'bg-orange/15 text-orange'
    : tone === 'danger' ? 'bg-rec/15 text-rec'
    : 'bg-border-soft text-ink3';
  return <span title={title} className={`px-1.5 py-0.5 rounded-[5px] text-[11.5px] ${cls}`}>{children}</span>;
}

/** Detail-page header: serif title at the same 22px the Settings/Usage/Recordings
 *  headers use, an optional leading badge, a chip row of facts, and trailing actions. */
export function DetailHeader({ badge, title, facts, actions }: {
  badge?: React.ReactNode; title: string; facts?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3.5 px-8 pt-5 pb-4 border-b border-border bg-bg flex-none">
      {badge}
      <div className="flex-1 min-w-0">
        <h2 className="font-serif text-[22px] text-ink tracking-tight truncate leading-tight">{title}</h2>
        {facts && <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">{facts}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-none">{actions}</div>}
    </div>
  );
}
