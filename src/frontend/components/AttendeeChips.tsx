import { useEffect, useRef, useState } from 'react';
import { Icon } from './chrome/Icon';
import { useAnchoredMenu } from './useAnchoredMenu';
import { api } from '../api/client';

/** Attendee name chips for a recording. Add people as you realize who's in the room; each
 *  name sharpens transcription and (in the live engine) pulls that person's open items in.
 *  Suggestions merge past attendees with knowledge-base people notes. */
export function AttendeeChips({ value, onChange, compact }: {
  value: string[];
  onChange: (names: string[]) => void;
  compact?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { anchorRef, style } = useAnchoredMenu<HTMLDivElement>(adding, 180);

  useEffect(() => { api.suggestAttendees().then((r) => setSuggestions(r.names)).catch(() => {}); }, []);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const add = (name: string) => {
    const n = name.trim();
    if (n && !value.some((v) => v.toLowerCase() === n.toLowerCase())) onChange([...value, n]);
    setText('');
    setAdding(false);
  };
  const remove = (name: string) => onChange(value.filter((v) => v !== name));

  const pool = suggestions.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())
      && (!text || s.toLowerCase().includes(text.toLowerCase())),
  ).slice(0, 6);

  const chip = compact ? 'text-[11px] px-2 py-0.5' : 'text-[12px] px-2.5 py-1';

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {value.map((name) => (
        <span key={name} className={`inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-ink ${chip}`}>
          {name}
          <button type="button" onClick={() => remove(name)} className="opacity-60 hover:opacity-100" title={`Remove ${name}`}>
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      {adding ? (
        <div ref={anchorRef} className="relative">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add(text);
              else if (e.key === 'Escape') { setText(''); setAdding(false); }
            }}
            onBlur={() => setTimeout(() => setAdding(false), 150)}
            placeholder="Name…"
            className={`rounded-full border border-border bg-card text-ink outline-none focus:border-accent ${chip}`}
          />
          {pool.length > 0 && (
            <div style={style} className="z-50 rounded-[10px] border border-border bg-card shadow-pop py-1">
              {pool.map((s) => (
                <button key={s} type="button" onMouseDown={() => add(s)}
                  className="block w-full text-left px-3 py-1.5 text-[12px] text-ink2 hover:bg-accent-soft hover:text-accent-ink">
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1 rounded-full border border-dashed border-border text-ink3 hover:border-accent hover:text-accent ${chip}`}>
          <Icon name="plus" size={11} /> {compact ? 'person' : 'Add person'}
        </button>
      )}
    </div>
  );
}
