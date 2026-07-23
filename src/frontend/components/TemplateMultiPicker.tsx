import { useEffect, useRef, useState } from 'react';
import { Icon } from './chrome/Icon';
import { useAnchoredMenu } from './useAnchoredMenu';
import { api } from '../api/client';
import type { MeetingTemplate } from '../types';

/** Pick one OR MORE meeting templates for a recording. Selected templates show as removable
 *  chips; an "add" control opens a menu to toggle more or describe a brand-new one on the spot.
 *  Used in the live recording header and on the Recordings page (add templates after the fact). */
export function TemplateMultiPicker({
  templates, value, onChange, onTemplatesChanged, compact,
}: {
  templates: MeetingTemplate[];
  value: string[];
  onChange: (ids: string[]) => void;
  onTemplatesChanged: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { anchorRef, style } = useAnchoredMenu<HTMLButtonElement>(open, 280);
  useEffect(() => { if (describing) inputRef.current?.focus(); }, [describing]);

  const byId = new Map(templates.map((t) => [t.id, t]));
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  const remove = (id: string) => onChange(value.filter((v) => v !== id));

  const create = async () => {
    const desc = text.trim();
    if (!desc || busy) return;
    setBusy(true); setErr(null);
    try {
      const t = await api.generateTemplate(desc);
      onTemplatesChanged();
      if (!value.includes(t.id)) onChange([...value, t.id]);
      setText(''); setDescribing(false); setOpen(false);
    } catch {
      setErr('Could not create that template — check the AI provider in Settings.');
    } finally { setBusy(false); }
  };

  const chip = compact ? 'text-[11px] px-2 py-0.5' : 'text-[12px] px-2.5 py-1';

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {value.map((id) => (
        <span key={id} className={`inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-ink font-550 ${chip}`}>
          <Icon name="sparkle" size={compact ? 10 : 11} />
          {byId.get(id)?.name || id}
          <button type="button" onClick={() => remove(id)} className="opacity-60 hover:opacity-100" title="Remove template">
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <div className="relative">
        <button ref={anchorRef} type="button" onClick={() => setOpen((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-full border border-dashed border-border text-ink3 hover:border-accent hover:text-accent ${chip}`}>
          <Icon name="plus" size={compact ? 10 : 11} /> Template
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setDescribing(false); }} />
            <div style={style} className="z-50 rounded-[12px] border border-border bg-card shadow-pop p-1.5">
              {!describing ? (
                <>
                  <div className="max-h-[240px] overflow-y-auto">
                    {templates.map((t) => {
                      const on = value.includes(t.id);
                      return (
                        <button key={t.id} type="button" onClick={() => toggle(t.id)}
                          className={`flex items-start gap-2 w-full text-left px-2.5 py-1.5 rounded-[8px] text-[12.5px] ${
                            on ? 'bg-accent-soft text-accent-ink' : 'text-ink2 hover:bg-hover'}`}>
                          <span className={`mt-[2px] w-3.5 h-3.5 rounded-[4px] border flex-none grid place-items-center ${
                            on ? 'bg-accent border-accent' : 'border-ink3'}`}>
                            {on && <Icon name="check" size={9} color="var(--color-on-accent)" />}
                          </span>
                          <span className="min-w-0">
                            <span className="font-550 block">{t.name}</span>
                            <span className="text-[11px] text-ink3 block truncate">{t.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" onClick={() => setDescribing(true)}
                    className="mt-1 flex items-center gap-1.5 w-full px-2.5 py-1.5 rounded-[8px] text-[12px] text-accent hover:bg-accent-soft border-t border-border-soft">
                    <Icon name="plus" size={12} /> Describe a new template…
                  </button>
                </>
              ) : (
                <div className="p-1.5 flex flex-col gap-1.5">
                  <textarea ref={inputRef} value={text} onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(); }}
                    placeholder="Describe a meeting type — e.g. “interviews ending with a hire/no-hire call”"
                    rows={3}
                    className="w-full rounded-[8px] border border-border bg-bg px-2.5 py-2 text-[12px] text-ink outline-none focus:border-accent resize-none" />
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={create} disabled={busy || !text.trim()}
                      className="px-3 py-1.5 rounded-[8px] bg-accent text-white text-[12px] font-550 disabled:opacity-50 hover:bg-accent-dark">
                      {busy ? 'Creating…' : 'Create & add'}
                    </button>
                    <button type="button" onClick={() => { setDescribing(false); setText(''); setErr(null); }}
                      className="text-[12px] text-ink3 hover:text-ink2">Cancel</button>
                  </div>
                  {err && <span className="text-[11px] text-rec">{err}</span>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
