/** The floating "✦ AI" affordance that appears over a table, rich block or image.
 *
 * Prose is edited by selecting it and right-clicking. That route cannot work for these
 * constructs — a table's rendered selection does not match its markdown source, and a rich
 * block's content never enters the page selection at all (see noteElements.ts). So instead of a
 * selection, the target is whatever element the pointer is over, and this button is its handle.
 *
 * Rendered in a portal at viewport coordinates rather than inside the element: the editable tree
 * is serialized back to markdown, so a real child node here would end up in the saved note.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../../components/chrome/Icon';
import { t } from '../../../components/aitextspace/theme';
import type { NoteElementKind } from './noteElements';

interface Action { label: string; instruction: string }

// Per-kind quick actions. Phrased against the element's SOURCE (the model is handed markdown),
// which is why a table action can talk about columns and a chart action about series.
const ACTIONS: Record<NoteElementKind, Action[]> = {
  table: [
    { label: 'Fill in missing cells', instruction: 'Fill in any empty or placeholder cells with plausible, consistent values. Keep every existing value unchanged.' },
    { label: 'Add a summary row', instruction: 'Add a final summary/total row that fits the columns. Keep all existing rows unchanged.' },
    { label: 'Sort rows', instruction: 'Sort the data rows by the most meaningful column (keep the header first). Change no cell values.' },
    { label: 'Tidy wording', instruction: 'Make the cell wording consistent and concise — capitalisation, tense, units. Do not add or remove rows or columns.' },
  ],
  block: [
    { label: 'Add more items', instruction: 'Extend this block with a few more plausible items that fit the existing pattern. Keep everything already there.' },
    { label: 'Fill in the gaps', instruction: 'Complete anything obviously missing or placeholder in this block, keeping the existing content unchanged.' },
    { label: 'Tidy labels', instruction: 'Make the labels consistent and concise. Do not change the structure or the data values.' },
  ],
  image: [
    { label: 'Write alt text', instruction: 'Write a short, descriptive alt text for this image based on its filename and the surrounding note, and put it in the image\'s alt slot. Keep the same image path.' },
    { label: 'Add a caption', instruction: 'Add a one-line italic caption line directly under this image. Keep the image itself unchanged.' },
  ],
};

export function ElementAiButton({
  left, top, kind, label, onInstruction, onOpenChange,
}: {
  left: number; top: number;
  kind: NoteElementKind;
  /** "this table" / "this kanban block" — names the target in the menu header. */
  label: string;
  onInstruction: (instruction: string) => void;
  /** Lets the host freeze hover tracking while the menu is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const fire = (instruction: string) => {
    setOpen(false);
    setCustom('');
    onInstruction(instruction);
  };

  // Keep the menu on-screen when the element sits near the right/bottom edge.
  const menuLeft = Math.min(left, window.innerWidth - 248);
  const menuTop = Math.min(top + 26, window.innerHeight - 300);

  return createPortal(
    <div ref={ref} style={{ position: 'fixed', left, top, zIndex: 60 }}
      // The editor serializes on DOM mutations; keep our own clicks from stealing the caret.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        title={`Edit ${label} with AI`}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', borderRadius: 6,
          background: t.accent, color: '#fff', border: 'none',
          fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 600,
          cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        }}
      >
        <Icon name="sparkle" size={11} color="#fff" /> AI
      </button>

      {open && (
        <div style={{
          position: 'fixed', left: menuLeft, top: menuTop, width: 240,
          background: t.bgRaised, border: `0.5px solid ${t.hair}`, borderRadius: 9,
          boxShadow: '0 8px 28px rgba(0,0,0,0.16)', padding: 5, zIndex: 61,
        }}>
          <div style={{
            fontFamily: 'Inter, sans-serif', fontSize: 10.5, fontWeight: 700,
            letterSpacing: '0.04em', textTransform: 'uppercase',
            color: t.muted, padding: '5px 8px 6px',
          }}>Edit {label}</div>

          {ACTIONS[kind].map((a) => (
            <button key={a.label} type="button" onClick={() => fire(a.instruction)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '6px 8px', borderRadius: 6, border: 'none', background: 'transparent',
                fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: t.ink, cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.bgSunken; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >{a.label}</button>
          ))}

          <div style={{ borderTop: `0.5px solid ${t.hair}`, margin: '5px 0' }} />
          <form
            onSubmit={(e) => { e.preventDefault(); if (custom.trim()) fire(custom.trim()); }}
            style={{ padding: '0 4px 2px' }}
          >
            <input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Or describe the change…"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '6px 8px',
                borderRadius: 6, border: `0.5px solid ${t.hair}`,
                background: t.bg, color: t.ink,
                fontFamily: 'Inter, sans-serif', fontSize: 12.5, outline: 'none',
              }}
            />
          </form>
        </div>
      )}
    </div>,
    document.body,
  );
}
