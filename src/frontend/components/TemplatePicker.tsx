import { useEffect, useRef, useState } from 'react';
import { Icon } from './chrome/Icon';
import { api } from '../api/client';
import type { MeetingTemplate } from '../types';

/** Choose the meeting template for a recording, or describe a brand-new one on the spot
 *  (the describe box calls generate → saves → selects it). Used as chips on the idle
 *  landing and as a compact dropdown in the live recording header. */
export function TemplatePicker({
  templates, value, onChange, onTemplatesChanged, variant = 'chips',
}: {
  templates: MeetingTemplate[];
  value: string;
  onChange: (id: string) => void;
  onTemplatesChanged: () => void;
  variant?: 'chips' | 'menu';
}) {
  const [describing, setDescribing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (describing) inputRef.current?.focus(); }, [describing]);

  const create = async () => {
    const desc = text.trim();
    if (!desc || busy) return;
    setBusy(true); setErr(null);
    try {
      const t = await api.generateTemplate(desc);
      onTemplatesChanged();
      onChange(t.id);
      setText(''); setDescribing(false); setOpen(false);
    } catch {
      setErr('Could not create that template — check the AI provider in Settings.');
    } finally {
      setBusy(false);
    }
  };

  const selected = templates.find((t) => t.id === value);

  const describeBox = (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(); }}
        placeholder="Describe a meeting type — e.g. “interviews ending with a hire/no-hire call and a skills matrix”"
        rows={2}
        className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-[12.5px] text-ink outline-none focus:border-accent resize-none"
      />
      <div className="flex items-center gap-2">
        <button type="button" onClick={create} disabled={busy || !text.trim()}
          className="px-3 py-1.5 rounded-[8px] bg-accent text-white text-[12px] font-550 disabled:opacity-50 hover:bg-accent-dark">
          {busy ? 'Creating…' : 'Create template'}
        </button>
        <button type="button" onClick={() => { setDescribing(false); setText(''); setErr(null); }}
          className="text-[12px] text-ink3 hover:text-ink2">Cancel</button>
        {err && <span className="text-[11.5px] text-rec">{err}</span>}
      </div>
    </div>
  );

  // ── compact dropdown for the live header ──
  if (variant === 'menu') {
    return (
      <div className="relative inline-block">
        <button type="button" onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-soft text-accent-ink text-[12px] font-550 hover:brightness-95">
          <Icon name="sparkle" size={11} /> {selected?.name || 'Template'}
          <Icon name="chevD" size={11} />
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setDescribing(false); }} />
            <div className="absolute z-20 mt-1.5 left-0 w-[280px] rounded-[12px] border border-border bg-card shadow-pop p-1.5">
              {!describing ? (
                <>
                  <div className="max-h-[240px] overflow-y-auto">
                    {templates.map((t) => (
                      <button key={t.id} type="button"
                        onClick={() => { onChange(t.id); setOpen(false); }}
                        className={`block w-full text-left px-2.5 py-1.5 rounded-[8px] text-[12.5px] ${
                          t.id === value ? 'bg-accent-soft text-accent-ink' : 'text-ink2 hover:bg-hover'}`}>
                        <div className="font-550">{t.name}</div>
                        <div className="text-[11px] text-ink3 truncate">{t.description}</div>
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => setDescribing(true)}
                    className="mt-1 flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-[8px] text-[12px] text-accent hover:bg-accent-soft border-t border-border-soft">
                    <Icon name="plus" size={12} /> Describe a new template…
                  </button>
                </>
              ) : (
                <div className="p-1.5">{describeBox}</div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── chips for the idle landing ──
  return (
    <div className="flex flex-col items-center gap-2 w-full">
      <div className="flex items-center gap-1.5 flex-wrap justify-center">
        {templates.map((t) => (
          <button key={t.id} type="button" onClick={() => onChange(t.id)}
            className={`px-3 py-1.5 rounded-full text-[12.5px] border transition-colors ${
              t.id === value ? 'bg-accent-soft border-accent-soft text-accent-ink' : 'border-border text-ink2 hover:border-ink3'}`}>
            {t.name}
          </button>
        ))}
        <button type="button" onClick={() => setDescribing((v) => !v)}
          className="px-3 py-1.5 rounded-full text-[12.5px] border border-dashed border-border text-ink3 hover:border-accent hover:text-accent inline-flex items-center gap-1">
          <Icon name="plus" size={11} /> Describe
        </button>
      </div>
      {selected && (
        <div className="text-[11.5px] text-ink3 text-center">
          Produces: {selected.sections.map((s) => s.title).join(' · ')}
          {selected.extract.todos ? ' — extracts todos' : ''}
          {selected.extract.reminders ? ' & reminders' : ''}
        </div>
      )}
      {describing && <div className="w-full max-w-[440px] mt-1">{describeBox}</div>}
    </div>
  );
}
