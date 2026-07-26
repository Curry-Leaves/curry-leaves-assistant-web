import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';

export interface MenuItem {
  label: string;
  icon: string;
  onClick: () => void;
  danger?: boolean;
}

// A compact hover-triggered "⋯" menu used on tree rows. Kept visually quiet — the trigger
// only appears on row hover (opacity handled by the parent's `group-hover`), and the popover
// closes on outside-click or Escape. Positioned to the right of its trigger.
export function RowMenu({ items, label = 'Actions', alwaysVisible = false }: {
  items: MenuItem[]; label?: string; alwaysVisible?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative flex-none">
      <button type="button" title={label}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`w-5 h-5 grid place-items-center rounded-[5px] text-ink3 hover:bg-border hover:text-ink ${
          open ? 'bg-border text-ink' : alwaysVisible ? '' : 'opacity-0 group-hover:opacity-100'}`}>
        <Icon name="more" size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-30 min-w-[168px] py-1 bg-card border border-border rounded-[9px] shadow-pop"
          onClick={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <button key={it.label} type="button"
              onClick={() => { setOpen(false); it.onClick(); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-border-soft ${
                it.danger ? 'text-rec' : 'text-ink2'}`}>
              <Icon name={it.icon} size={13} color={it.danger ? 'var(--color-rec)' : 'var(--color-ink3)'} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
