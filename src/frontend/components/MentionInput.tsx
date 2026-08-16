import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';

/** A text field where `@` offers a list of people and inserts the plain name.
 *
 *  Plain text, not a markup token: these notes are read verbatim by the summarizer and shown
 *  back to the user, so "@Priya owns the API" should still read that way everywhere. The `@`
 *  is kept as a visual cue that a person was meant.
 *
 *  Renders either an <input> or a <textarea> — the caller picks via `as`, so the pin composer
 *  and the notes body behave identically without duplicating the trigger logic. */
export function MentionInput({
  as, value, onChange, onEnter, onFocus, onBlur, people, placeholder, className, inputRef, textareaRef,
}: {
  as: 'input' | 'textarea';
  value: string;
  onChange: (next: string) => void;
  onEnter?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  people: string[];
  placeholder?: string;
  className?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(-1);      // index of the '@' being completed
  const [active, setActive] = useState(0);
  const ownInput = useRef<HTMLInputElement>(null);
  const ownArea = useRef<HTMLTextAreaElement>(null);
  const el = () => (as === 'input' ? (inputRef?.current ?? ownInput.current) : (textareaRef?.current ?? ownArea.current));

  const matches = people.filter((p) => p.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  useEffect(() => { setActive(0); }, [query]);

  /** Re-read the caret after every change: an `@` only starts a mention at a word boundary,
   *  and it stops being one as soon as the run of text after it contains a space. */
  const sync = (next: string, caret: number) => {
    const upto = next.slice(0, caret);
    const idx = upto.lastIndexOf('@');
    if (idx === -1 || (idx > 0 && !/[\s(]/.test(upto[idx - 1]))) { setOpen(false); return; }
    const frag = upto.slice(idx + 1);
    if (/\s/.test(frag)) { setOpen(false); return; }
    setAt(idx);
    setQuery(frag);
    setOpen(true);
  };

  const change = (next: string, caret: number) => { onChange(next); sync(next, caret); };

  const pick = (name: string) => {
    const node = el();
    const caret = node ? (node.selectionStart ?? value.length) : value.length;
    if (at < 0) return;
    const next = `${value.slice(0, at)}@${name} ${value.slice(caret)}`;
    onChange(next);
    setOpen(false);
    // Put the caret after the inserted name rather than leaving it where the fragment was.
    const pos = at + name.length + 2;
    requestAnimationFrame(() => { node?.focus(); node?.setSelectionRange(pos, pos); });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (open && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % matches.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + matches.length) % matches.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return; }
      if (e.key === 'Escape') { setOpen(false); return; }
    }
    // Enter pins in the composer; in the notes body it should just insert a newline.
    if (e.key === 'Enter' && onEnter && as === 'input') { e.preventDefault(); onEnter(); }
  };

  const shared = {
    value,
    placeholder,
    className,
    onKeyDown,
    onFocus,
    // Let a click on a suggestion land before the menu unmounts.
    onBlur: () => { setTimeout(() => setOpen(false), 150); onBlur?.(); },
  };

  return (
    <div className={`relative ${as === 'input' ? 'flex-1 min-w-0' : ''}`}>
      {as === 'input' ? (
        // w-full, not the caller's flex-1: the wrapper is the flex child now, so the input has
        // to fill it or the placeholder gets clipped to its intrinsic size.
        <input {...shared} className={`w-full ${className ?? ''}`} ref={inputRef ?? ownInput}
          onChange={(e) => change(e.target.value, e.target.selectionStart ?? e.target.value.length)} />
      ) : (
        <textarea {...shared} ref={textareaRef ?? ownArea}
          onChange={(e) => change(e.target.value, e.target.selectionStart ?? e.target.value.length)} />
      )}
      {open && matches.length > 0 && (
        <div className="absolute left-0 bottom-full mb-1 z-50 min-w-[160px] rounded-[10px] border border-border bg-card shadow-pop py-1">
          {matches.map((p, i) => (
            <button key={p} type="button" onMouseDown={(e) => { e.preventDefault(); pick(p); }}
              className={`block w-full text-left px-3 py-1.5 text-[12px] ${
                i === active ? 'bg-accent-soft text-accent-ink' : 'text-ink2 hover:bg-accent-soft hover:text-accent-ink'}`}>
              {p}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
