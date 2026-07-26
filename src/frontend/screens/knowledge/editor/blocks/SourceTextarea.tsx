/** The source-editing textarea shared by every rich block.
 *
 * Why this isn't just `<textarea value={code} onChange={…} />`:
 *
 * MDXEditor's `setCode` writes through `parentEditor.update()`, which Lexical batches and applies
 * asynchronously. So the `code` prop does NOT come back on the same tick as the keystroke that
 * caused it. A controlled textarea therefore sees its DOM value diverge from its prop, React
 * rewrites the element's value, and the caret jumps to the end — after which every further
 * character lands at the end of the document instead of where you were typing.
 *
 * The fix is to let the DOM own the text while the field has focus (uncontrolled), and only sync
 * from the prop when the value genuinely changed from the outside — a different note loaded, a
 * diff applied, an AI edit accepted. `defaultValue` seeds the initial render; the effect below
 * handles later external changes.
 */
import { useEffect, useRef } from 'react';

export function SourceTextarea({
  code, onCodeChange, ariaLabel, placeholder, minHeight = 140, style,
}: {
  code: string;
  onCodeChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  minHeight?: number;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Every value this field has produced. `setCode` is async, so props echo back LATE and out of
  // order — a keystroke or two behind what's on screen. Checking only the most recent value
  // isn't enough: an older echo would still look "external" and would revert the text under the
  // cursor. Anything we've ever typed is, by definition, not an external change.
  const sentRef = useRef<Set<string>>(new Set([code]));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (sentRef.current.has(code)) return;      // our own edit echoing back — DOM already correct
    if (code === el.value) return;              // nothing to do
    // A genuine external change (note swapped, diff applied, AI edit accepted). Keep the caret
    // where it was rather than snapping to the end.
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const wasFocused = document.activeElement === el;
    el.value = code;
    sentRef.current = new Set([code]);          // fresh baseline; old echoes are now irrelevant
    if (wasFocused) {
      el.setSelectionRange(Math.min(start, code.length), Math.min(end, code.length));
    }
  }, [code]);

  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      defaultValue={code}
      onChange={(e) => {
        sentRef.current.add(e.target.value);
        onCodeChange(e.target.value);
      }}
      spellCheck={false}
      placeholder={placeholder}
      style={{
        display: 'block', width: '100%', minHeight, margin: 0,
        padding: '14px 16px',
        fontFamily: "'JetBrains Mono', monospace", fontSize: '0.85em',
        background: 'transparent', color: 'var(--color-ink)',
        border: 'none', outline: 'none', resize: 'vertical',
        lineHeight: 1.6, boxSizing: 'border-box',
        ...style,
      }}
    />
  );
}
