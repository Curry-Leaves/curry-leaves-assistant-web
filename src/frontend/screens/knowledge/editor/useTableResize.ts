/** Drag-to-resize table columns and rows in the note editor.
 *
 * MDXEditor has no resize feature and its cells are nested editors, so this works on the DOM
 * of the rendered table rather than through Lexical: a pointerdown on a cell's trailing edge
 * starts a drag, and we write the result to the table's `<colgroup><col>` widths (columns) or
 * the row's height (rows). MDXEditor already renders a `<colgroup>` and sets
 * `table-layout: fixed`, so a `<col>` width is authoritative and one write resizes the whole
 * column — no need to touch every cell.
 *
 * WHY the DOM and not the model: a width is not part of the markdown table at all (see
 * tableSizes.ts), so there is no Lexical node to put it on. Sizes live in a side map keyed by
 * table index, get written into a comment above the table on save, and are re-applied on open.
 *
 * Handles are drawn as CSS pseudo-elements on the cells (see mdxeditor-theme.css) rather than
 * as real elements, so nothing is inserted into the editable tree — an extra DOM node inside a
 * cell would end up in the serialized markdown.
 */
import { useCallback, useEffect, useRef } from 'react';
import type { TableSizes } from './tableSizes';

// Below this a column is too small to click, leaving no way to drag it back.
const MIN_COL = 48;
const MIN_ROW = 28;
// How close to the border counts as grabbing the handle.
const GRAB = 6;

/** The tables MDXEditor renders, in document order — the same order tableSizes keys by. */
function editorTables(root: HTMLElement): HTMLTableElement[] {
  return [...root.querySelectorAll<HTMLTableElement>('[class*="tableEditor"]')];
}

/** How many leading `<col>`s belong to MDXEditor's own tool column rather than user data.
 *
 * MDXEditor brackets the real columns with a tool column on each side (row handles left,
 * delete-table right) and drops both in readOnly mode — so the `<col>` list is offset from
 * the data columns by one in the editable case. Detected from the row's leading cell rather
 * than by counting: the col and cell counts happen to MATCH (both bracket columns are
 * present), so a count comparison silently returns the wrong offset. */
function dataColOffset(table: HTMLTableElement): number {
  const first = table.querySelector('tbody > tr')?.firstElementChild;
  return first?.matches('[class*="toolCell"], [data-tool-cell="true"]') ? 1 : 0;
}

/** The table's DATA rows, i.e. the ones a markdown table actually has.
 *
 * MDXEditor renders the header row INSIDE `<tbody>` (its `<thead>` holds the column tool
 * buttons, not the header text), so a plain `tbody > tr` query returns one row more than the
 * markdown has and every row index lands one row too low. The first tbody row is the header;
 * data starts at index 1. */
function dataRows(table: HTMLTableElement): HTMLTableRowElement[] {
  return [...table.querySelectorAll<HTMLTableRowElement>('tbody > tr')].slice(1);
}

/** @param root the editor's stable `.cl-mdx` element. Pass the resolved ELEMENT (state), not a
 *  ref: a ref object is referentially stable, so an effect keyed on it runs once at mount when
 *  `.current` is still null, bails, and never re-runs — the listeners silently never attach. */
export function useTableResize(
  root: HTMLElement | null,
  onSizesChange: (sizes: Map<number, TableSizes>) => void,
) {
  // Current sizes, kept here so a drag can read the previous value without a re-render.
  const sizesRef = useRef<Map<number, TableSizes>>(new Map());

  /** Push `sizes` onto the DOM. Also used to re-apply after MDXEditor re-renders a table. */
  const apply = useCallback(() => {
    if (!root) return;
    editorTables(root).forEach((table, tableIndex) => {
      const s = sizesRef.current.get(tableIndex);
      if (!s) return;
      const offset = dataColOffset(table);
      const cols = [...table.querySelectorAll<HTMLTableColElement>('colgroup > col')];
      s.cols.forEach((w, i) => {
        const col = cols[i + offset];
        if (col) col.style.width = `${w}px`;
      });
      const rows = dataRows(table);
      s.rows.forEach((h, i) => {
        if (rows[i]) rows[i].style.height = `${h}px`;
      });
    });
  }, [root]);

  /** Replace the whole map (used when a note loads with saved sizes). */
  const setSizes = useCallback((next: Map<number, TableSizes>) => {
    sizesRef.current = new Map(next);
    apply();
  }, [apply]);

  useEffect(() => {
    if (!root) return;

    let drag: {
      kind: 'col' | 'row';
      table: HTMLTableElement;
      tableIndex: number;
      index: number;
      startPos: number;
      startSize: number;
    } | null = null;

    /** Which resize (if any) a pointer at this position would start. */
    const hitTest = (e: PointerEvent) => {
      const cell = (e.target as HTMLElement | null)?.closest?.('td, th') as HTMLTableCellElement | null;
      if (!cell) return null;
      const table = cell.closest<HTMLTableElement>('[class*="tableEditor"]');
      if (!table) return null;
      // Tool cells are MDXEditor's own row/column controls — not user data, never resizable.
      if (cell.matches('[class*="toolCell"], [data-tool-cell="true"]')) return null;

      const r = cell.getBoundingClientRect();
      const tableIndex = editorTables(root).indexOf(table);
      if (tableIndex < 0) return null;

      // Column drag. A border is shared by two cells, and which one the pointer "is in"
      // flips at the exact boundary — at x >= right the hit lands in the NEXT cell, whose
      // own right edge is a whole column away. So test both edges: near this cell's right
      // border resize this column, near its left border resize the PREVIOUS one. Without
      // the left case the grab zone is only the inner few pixels and the handle feels dead
      // exactly where the user aims.
      const rowCells = [...(cell.parentElement?.children ?? [])];
      const lead = rowCells.findIndex((c) => !(c as HTMLElement).matches('[class*="toolCell"], [data-tool-cell="true"]'));
      const dataIndex = rowCells.indexOf(cell) - Math.max(lead, 0);

      if (Math.abs(e.clientX - r.right) <= GRAB && dataIndex >= 0) {
        return { kind: 'col' as const, table, tableIndex, index: dataIndex,
                 startPos: e.clientX, startSize: r.width };
      }
      if (Math.abs(e.clientX - r.left) <= GRAB && dataIndex > 0) {
        const prev = cell.previousElementSibling as HTMLElement | null;
        if (prev) {
          return { kind: 'col' as const, table, tableIndex, index: dataIndex - 1,
                   startPos: e.clientX, startSize: prev.getBoundingClientRect().width };
        }
      }
      // Row drag — same both-edges reasoning as columns, one axis over.
      const tr = cell.closest('tr') as HTMLTableRowElement | null;
      const bodyRows = dataRows(table);
      const rowIndex = tr ? bodyRows.indexOf(tr) : -1;
      if (tr && rowIndex >= 0) {
        if (Math.abs(e.clientY - r.bottom) <= GRAB) {
          return { kind: 'row' as const, table, tableIndex, index: rowIndex,
                   startPos: e.clientY, startSize: tr.getBoundingClientRect().height };
        }
        if (Math.abs(e.clientY - r.top) <= GRAB && rowIndex > 0) {
          const prev = bodyRows[rowIndex - 1];
          return { kind: 'row' as const, table, tableIndex, index: rowIndex - 1,
                   startPos: e.clientY, startSize: prev.getBoundingClientRect().height };
        }
      }
      return null;
    };

    // Cursor feedback: only while not dragging, and cheap enough for pointermove.
    const onHover = (e: PointerEvent) => {
      if (drag) return;
      const hit = hitTest(e);
      root.dataset.clResize = hit ? hit.kind : '';
    };

    const onDown = (e: PointerEvent) => {
      const hit = hitTest(e);
      if (!hit) return;
      // Stop the cell's nested editor taking focus / starting a text selection mid-drag.
      e.preventDefault();
      e.stopPropagation();
      drag = hit;

      // Seed this table's entry from what is on screen, so dragging one column does not
      // wipe the sizes of columns the user set earlier.
      //
      // Measured from the first row's DATA CELLS, not from the `<col>` list: MDXEditor
      // brackets the table with a tool column on EACH side, so the colgroup carries two
      // extra entries and seeding from it recorded a phantom trailing column (a stray 34px
      // for the delete-table button) into the saved marker.
      const existing = sizesRef.current.get(hit.tableIndex);
      const dataCells = [...(dataRows(hit.table)[0]?.children ?? [])]
        .filter((c) => !(c as HTMLElement).matches('[class*="toolCell"], [data-tool-cell="true"]'));
      const rowEls = dataRows(hit.table);
      sizesRef.current.set(hit.tableIndex, {
        cols: existing?.cols.length
          ? [...existing.cols]
          : dataCells.map((c) => Math.round(c.getBoundingClientRect().width) || MIN_COL),
        rows: existing?.rows.length ? [...existing.rows]
                                    : rowEls.map((r) => Math.round(r.getBoundingClientRect().height)),
      });
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) { onHover(e); return; }
      e.preventDefault();
      const s = sizesRef.current.get(drag.tableIndex);
      if (!s) return;
      if (drag.kind === 'col') {
        const next = Math.max(MIN_COL, Math.round(drag.startSize + (e.clientX - drag.startPos)));
        s.cols[drag.index] = next;
      } else {
        const next = Math.max(MIN_ROW, Math.round(drag.startSize + (e.clientY - drag.startPos)));
        s.rows[drag.index] = next;
      }
      apply();
    };

    const onUp = () => {
      if (!drag) return;
      drag = null;
      root.dataset.clResize = '';
      // Commit once, on release — not on every pointermove, which would spam the note's
      // dirty state and the autosave with one entry per pixel.
      onSizesChange(new Map(sizesRef.current));
    };

    root.addEventListener('pointerdown', onDown, true);
    root.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    root.addEventListener('pointerleave', () => { root.dataset.clResize = ''; });

    return () => {
      root.removeEventListener('pointerdown', onDown, true);
      root.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
    };
  }, [root, apply, onSizesChange]);

  return { setSizes, reapply: apply };
}
