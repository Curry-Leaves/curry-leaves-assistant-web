/** Apply persisted table column widths / row heights in the READ view.
 *
 * The note editor stores sizes in an HTML comment above the table (markdown itself has no slot
 * for a width — see screens/knowledge/editor/tableSizes.ts). We render without rehype-raw, so
 * that comment parses to an mdast `html` node which react-markdown then drops: invisible, but
 * the sizes are ignored too, and a table the user carefully resized would reopen at auto width.
 *
 * This plugin reads the marker and moves it onto the table as `hProperties`, which is the
 * documented remark→rehype channel for element attributes. The comment node is removed so it
 * can never surface as text.
 *
 * Only OUR marker is touched: any other HTML comment in the note keeps its existing behavior.
 * Sizes are matched to tables by adjacency (the comment sits immediately above its table),
 * mirroring how the editor writes them.
 */
import type { Plugin } from 'unified';
import type { Root, Table } from 'mdast';

const MARKER = /^<!--\s*cl-table:([^>]*?)-->$/;

function parseList(spec: string, key: string): number[] {
  const m = new RegExp(`\\b${key}=([-0-9.,]+)`).exec(spec);
  if (!m) return [];
  return m[1].split(',').map((n) => Math.round(parseFloat(n)))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** `data`/`hProperties` is how mdast passes element attributes down to the HTML layer. */
type WithData = Table & { data?: { hProperties?: Record<string, unknown> } };

export const remarkTableSizes: Plugin<[], Root> = () => (tree) => {
  const kids = tree.children;
  for (let i = kids.length - 1; i >= 0; i--) {
    const node = kids[i];
    if (node.type !== 'html') continue;
    const m = MARKER.exec(node.value.trim());
    if (!m) continue;

    // The table is the next non-blank sibling. (mdast has no blank-line nodes, so that is
    // simply the next child — but guard the type so a stray marker is just dropped.)
    const next = kids[i + 1];
    if (next && next.type === 'table') {
      const cols = parseList(m[1], 'cols');
      const rows = parseList(m[1], 'rows');
      if (cols.length || rows.length) {
        const table = next as WithData;
        table.data = table.data ?? {};
        table.data.hProperties = {
          ...table.data.hProperties,
          // Consumed by Markdown.tsx's `table` component, which turns these into a <colgroup>
          // and row heights. Passing them as data-* keeps the mdast → rehype hop plain.
          'data-cl-cols': cols.join(','),
          'data-cl-rows': rows.join(','),
        };
      }
    }
    kids.splice(i, 1);   // the marker itself never reaches the output
  }
};
