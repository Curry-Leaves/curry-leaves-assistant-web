import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';

// ─── chip popup menu (agent / model picker under the composer — curry-leaves style) ──
export function Chip({ icon, label, value, onChange, options }: {
  icon: string; label: string; value: string; onChange: (v: string) => void; options: { v: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const current = options.find((o) => o.v === value);
  return (
    <div ref={ref} className="relative">
      <button type="button" title={label} onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1 rounded-full text-[11.5px] border transition-colors ${
          open ? 'border-accent text-accent bg-accent-soft/40' : 'border-transparent text-ink2 hover:border-border hover:bg-border-soft'
        }`}>
        <Icon name={icon} size={10} />
        <span className="truncate max-w-[170px]">{current?.label || label}</span>
        <Icon name="chevD" size={9} />
      </button>
      {open && (
        <div className="absolute bottom-[calc(100%+6px)] left-0 z-50 min-w-[210px] max-h-[300px] overflow-y-auto bg-card border border-border rounded-[10px] shadow-pop p-1">
          <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-600 uppercase tracking-wider text-ink3">{label}</div>
          {options.map((o) => (
            <button key={o.v} type="button" onClick={() => { onChange(o.v); setOpen(false); }}
              className={`w-full text-left px-2 py-1.5 rounded-[6px] text-[12.5px] flex items-center gap-2 ${
                o.v === value ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-border-soft'
              }`}>
              <span className={o.v === value ? 'text-accent' : 'opacity-0'}><Icon name="check" size={12} /></span>
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
