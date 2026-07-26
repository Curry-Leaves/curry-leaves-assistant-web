import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Anchor a floating menu to a trigger element with `position: fixed`, so it escapes any
 *  ancestor `overflow` (e.g. a scrolling column) instead of being clipped or pushing layout.
 *  The menu is placed below the trigger, flipped above when it would overflow the viewport,
 *  and left-aligned (nudged in when it would run off the right edge). Reposition happens on
 *  scroll/resize while open. Give the returned `style` to a `position: fixed` menu element. */
export function useAnchoredMenu<T extends HTMLElement = HTMLElement>(open: boolean, menuWidth: number) {
  const anchorRef = useRef<T | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>({});

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = r.left;
    if (left + menuWidth > vw - 8) left = Math.max(8, vw - 8 - menuWidth);
    const below = vh - r.bottom;
    const openUp = below < 260 && r.top > below; // flip up when little room below
    const next: React.CSSProperties = { position: 'fixed', left, width: menuWidth };
    if (openUp) next.bottom = vh - r.top + gap;
    else next.top = r.bottom + gap;
    setStyle(next);
  }, [menuWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  return { anchorRef, style };
}
