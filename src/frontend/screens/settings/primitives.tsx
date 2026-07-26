// ─── primitives (curry-leaves's SHeader / SGroup / SField / SToggle) ──────────────────
export function SHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-8 pt-6 pb-4 border-b border-border bg-bg">
      <h2 className="font-serif text-[22px] text-ink tracking-tight">{title}</h2>
      {subtitle && <p className="text-[12.5px] text-ink3 mt-1 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

export function SGroup({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="px-8 pb-4">
      {title && <div className="mt-5 mb-1 text-[10px] font-600 tracking-wider uppercase text-ink3">{title}</div>}
      {children}
    </section>
  );
}

export function SField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-6 py-3.5 border-b border-border-soft items-start">
      <div>
        <div className="text-[13px] font-550 text-ink mb-0.5">{label}</div>
        {hint && <div className="text-[11.5px] text-ink3 leading-relaxed max-w-[360px]">{hint}</div>}
      </div>
      <div className="flex items-center min-h-[30px]">{children}</div>
    </div>
  );
}

export function Value({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <span className={`text-[12.5px] text-ink2 ${mono ? 'font-mono' : ''}`}>{children}</span>;
}

// ─── shared form controls ─────────────────────────────────────────────────────
// Identity, Recording and Providers had each copy-pasted these exact class strings;
// they live here so a field looks the same wherever it's used.
const FIELD_CLS = 'px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12.5px] outline-none';

export function SInput({ value, onChange, onBlur, placeholder, mono }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className={`w-full max-w-[360px] h-[30px] ${FIELD_CLS} ${mono ? 'font-mono' : ''}`}
    />
  );
}

/** A textarea that autosaves on blur, with the "Saved / Saving on blur…" note beneath —
 *  the pattern Identity and Recording both hand-rolled. */
export function STextarea({ value, onChange, onBlur, placeholder, rows = 4, saved, minHeight = 80 }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void;
  placeholder?: string; rows?: number; saved?: boolean; minHeight?: number;
}) {
  return (
    <div className="w-full">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        rows={rows}
        className={`w-full py-2 ${FIELD_CLS} resize-y`}
        style={{ minHeight }}
      />
      {saved !== undefined && (
        <div className="text-[11px] text-ink3 mt-1">{saved ? 'Saved' : 'Saving on blur…'}</div>
      )}
    </div>
  );
}

export function SSelect({ value, onChange, title, options, minWidth = 180 }: {
  value: string; onChange: (v: string) => void; title: string;
  options: { value: string; label: string }[]; minWidth?: number;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title={title}
      className={`h-[30px] ${FIELD_CLS} cursor-pointer`} style={{ minWidth }}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function SToggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={value ? 'Enabled' : 'Disabled'}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative w-[38px] h-[22px] rounded-full transition-colors flex-none disabled:opacity-50 disabled:cursor-not-allowed ${value ? 'bg-accent' : 'bg-border'}`}
    >
      <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}
