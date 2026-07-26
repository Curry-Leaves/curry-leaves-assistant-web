/** A collapsible, drag-resizable side panel whose width survives a reload.
 *
 *  Width lives in localStorage (same convention as prefs.ts: `curry-leaves.<area>.<thing>`,
 *  storage is the source of truth, private mode degrades to in-memory). Unlike prefs.ts there
 *  is no shared store — two panels on screen are independent, so each hook instance owns its
 *  own width and nothing needs to stay in lockstep.
 *
 *  Dragging is tracked on `window` rather than the handle: the pointer routinely outruns a
 *  4px strip, and listeners bound to the handle would drop the gesture the moment it does.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type ResizablePanel = {
  /** Rendered width in px — 0 while collapsed, so the caller can size the pane directly. */
  width: number;
  collapsed: boolean;
  toggle: () => void;
  /** True mid-drag: use it to suppress the width transition so the edge tracks the cursor. */
  dragging: boolean;
  /** Spread onto the drag handle sitting between the panel and the content. */
  handleProps: { onPointerDown: (e: React.PointerEvent) => void };
};

export function useResizablePanel({ key, initial, min, max }: {
  /** localStorage key suffix, e.g. 'knowledge.rail' → 'curry-leaves.knowledge.rail.width'. */
  key: string;
  initial: number;
  min: number;
  max: number;
}): ResizablePanel {
  const widthKey = `curry-leaves.${key}.width`;
  const collapsedKey = `curry-leaves.${key}.collapsed`;

  // Clamp on read: a stored width from a wider window (or a changed min/max) must not
  // restore a panel that no longer fits.
  const [width, setWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(widthKey);
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : initial;
    } catch { return initial; }
  });
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(collapsedKey) === '1'; } catch { return false; }
  });
  const [dragging, setDragging] = useState(false);

  // The drag reads width without re-subscribing its window listeners on every pixel.
  const widthRef = useRef(width);
  widthRef.current = width;

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(collapsedKey, next ? '1' : '0'); } catch { /* in-memory only */ }
      return next;
    });
  }, [collapsedKey]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      const next = Math.min(Math.max(startWidth + (ev.clientX - startX), min), max);
      setWidth(next);
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Persist once at the end, not on every move — a drag is hundreds of events.
      try { localStorage.setItem(widthKey, String(widthRef.current)); } catch { /* in-memory only */ }
      // Restore normal cursor/selection behaviour.
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    // Hold the resize cursor for the whole gesture even when the pointer leaves the handle,
    // and stop the drag from selecting text across the panel.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [min, max, widthKey]);

  // A drag interrupted by unmount (tab switch mid-gesture) must not leave the body styled.
  useEffect(() => () => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  return { width: collapsed ? 0 : width, collapsed, toggle, dragging, handleProps: { onPointerDown } };
}
