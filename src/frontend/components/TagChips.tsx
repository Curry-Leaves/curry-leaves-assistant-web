import { useEffect, useRef, useState } from 'react';
import { Icon } from './chrome/Icon';
import { useAnchoredMenu } from './useAnchoredMenu';
import { api } from '../api/client';

/** Tag chips for a recording. Suggestions come from tags already used on other recordings,
 *  so the vocabulary converges instead of forking into near-duplicates.
 *
 *  The FIRST tag is special: the Recordings rail groups each recording under tags[0], so a
 *  recording with several tags still lands in exactly one group. That makes order meaningful
 *  in a way attendee order isn't — hence the "grouped under" marker on the lead chip and the
 *  click-to-promote on the others. Dedupe is case-insensitive here and again on the backend. */
export function TagChips({ value, onChange, compact }: {
  value: string[];
  onChange: (tags: string[]) => void;
  compact?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const { anchorRef, style } = useAnchoredMenu<HTMLDivElement>(adding, 180);

  // Refetch whenever the picker opens: a tag invented on another recording this session
  // should be offerable here without a reload.
  useEffect(() => {
    if (adding) api.listRecordingTags().then((r) => setSuggestions(r.tags.map((t) => t.tag))).catch(() => {});
  }, [adding]);
  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const add = (tag: string) => {
    const t = tag.trim().replace(/^#+/, '');  // let people type "#standup" — the # is display-only
    if (t && !value.some((v) => v.toLowerCase() === t.toLowerCase())) onChange([...value, t]);
    setText('');
    setAdding(false);
  };
  const remove = (tag: string) => onChange(value.filter((v) => v !== tag));
  const promote = (tag: string) => onChange([tag, ...value.filter((v) => v !== tag)]);

  const pool = suggestions.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())
      && (!text || s.toLowerCase().includes(text.toLowerCase())),
  ).slice(0, 6);

  const chip = compact ? 'text-[11px] px-2 py-0.5' : 'text-[12px] px-2.5 py-1';

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {value.map((tag, i) => (
        <span key={tag}
          className={`inline-flex items-center gap-1 rounded-full ${chip} ${
            i === 0 ? 'bg-accent-soft text-accent-ink' : 'bg-border-soft text-ink2'}`}
          title={i === 0 ? `Grouped under #${tag}` : undefined}>
          {i === 0
            ? <>#{tag}</>
            : (
              <button type="button" onClick={() => promote(tag)} className="hover:underline"
                title={`Group this recording under #${tag} instead`}>
                #{tag}
              </button>
            )}
          <button type="button" onClick={() => remove(tag)} className="opacity-60 hover:opacity-100" title={`Remove ${tag}`}>
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
            placeholder="Tag…"
            className={`rounded-full border border-border bg-card text-ink outline-none focus:border-accent ${chip}`}
          />
          {pool.length > 0 && (
            <div style={style} className="z-50 rounded-[10px] border border-border bg-card shadow-pop py-1">
              {pool.map((s) => (
                <button key={s} type="button" onMouseDown={() => add(s)}
                  className="block w-full text-left px-3 py-1.5 text-[12px] text-ink2 hover:bg-accent-soft hover:text-accent-ink">
                  #{s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1 rounded-full border border-dashed border-border text-ink3 hover:border-accent hover:text-accent ${chip}`}>
          <Icon name="plus" size={11} /> {compact ? 'tag' : 'Add tag'}
        </button>
      )}
    </div>
  );
}
