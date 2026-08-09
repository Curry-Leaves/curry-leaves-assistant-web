/** Track which table / rich block / image the pointer is over, and where to float its AI button.
 *
 * Pairs a DOM element with its markdown by ORDINAL: the Nth table in the editor DOM is the Nth
 * table in the note's markdown (see noteElements.ts). That holds because MDXEditor renders the
 * document in source order, and it avoids putting an id into the note, which would show up in
 * the saved file.
 *
 * Hover rather than click, because clicking inside a table cell or a rich block is already taken
 * — it puts the caret in that nested editor.
 */
import { useEffect, useRef, useState } from 'react';
import type { NoteElementKind } from './noteElements';

export interface HoveredElement {
  kind: NoteElementKind;
  ordinal: number;
  /** Viewport coords for the floating button (top-right of the element). */
  left: number;
  top: number;
  /** Images only — the `src`, which identifies the image far more reliably than its position. */
  src?: string;
}

/** Selectors for each editable kind, as MDXEditor renders them in the editor surface. */
const SELECTORS: Record<NoteElementKind, string> = {
  // The rich blocks are code blocks too, so a table must not also match them: tables are the
  // `tableEditor` component specifically.
  table: '[class*="tableEditor"]',
  block: '[data-rich-block="true"]',
  // The wrapper ONLY. Also matching the inner `<img>` counted every image twice, which shifted
  // every later ordinal and made an image resolve to the wrong element's markdown.
  image: '[class*="imageWrapper"]',
};

function ordinalOf(root: HTMLElement, kind: NoteElementKind, el: Element): number {
  return [...root.querySelectorAll(SELECTORS[kind])].indexOf(el);
}

export function useElementHover(root: HTMLElement | null, frozen: boolean) {
  const [hovered, setHovered] = useState<HoveredElement | null>(null);
  // A short exit delay keeps the button reachable: it floats OUTSIDE the element's box, so
  // moving the pointer toward it briefly leaves the element and would otherwise dismiss it.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!root) return;

    const clearLeave = () => {
      if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    };

    const onMove = (e: PointerEvent) => {
      if (frozen) return;   // menu is open — keep pointing at the same element
      const target = e.target as HTMLElement | null;
      if (!target?.closest) return;

      for (const kind of ['table', 'block', 'image'] as NoteElementKind[]) {
        const el = target.closest(SELECTORS[kind]);
        if (!el) continue;
        const ordinal = ordinalOf(root, kind, el);
        if (ordinal < 0) continue;
        const r = el.getBoundingClientRect();
        const src = kind === 'image'
          ? (el.querySelector('img')?.getAttribute('src') ?? undefined)
          : undefined;
        clearLeave();
        setHovered((prev) =>
          prev && prev.kind === kind && prev.ordinal === ordinal
            ? prev                                    // same element — don't thrash state
            : { kind, ordinal, left: r.right - 46, top: r.top - 11, src });
        return;
      }

      // Not over any element: dismiss, but only after a beat (see leaveTimer above).
      if (!leaveTimer.current) {
        leaveTimer.current = setTimeout(() => { setHovered(null); leaveTimer.current = null; }, 260);
      }
    };

    root.addEventListener('pointermove', onMove);
    return () => { root.removeEventListener('pointermove', onMove); clearLeave(); };
  }, [root, frozen]);

  return hovered;
}
