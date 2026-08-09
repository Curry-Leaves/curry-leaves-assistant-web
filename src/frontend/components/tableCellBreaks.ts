/** Render `<br />` inside table cells as a real line break — and nothing else.
 *
 * A GFM table row is one line of source, so a cell cannot contain a literal newline;
 * the conventional carrier for an in-cell break is a `<br />` tag, and that is what the
 * note editor writes (see the table-cell Shift+Enter handler in the knowledge editor).
 *
 * We render notes WITHOUT rehype-raw on purpose — a note body can carry model-generated
 * or imported content, and rehype-raw would let it inject arbitrary markup into the app
 * (same reasoning as noteImages.ts and SvgBlock.tsx). So the `<br />` would otherwise
 * surface as visible literal text in the read view.
 *
 * This plugin closes exactly that one gap: inside `tableCell` only, an mdast `html` node
 * that is nothing but a break tag becomes an mdast `break`. Everything else — every other
 * tag, and any `<br>` outside a table cell — is left untouched and keeps rendering as
 * inert text. Widening this to general HTML is the thing we are deliberately not doing.
 */
import type { Plugin } from 'unified';
import type { Root, RootContent, PhrasingContent } from 'mdast';

// The whole node must be the tag: `<br>`, `<br/>`, `<br />`, any case. A node like
// `<br><script>` fails this and stays literal text rather than being partly honored.
const BREAK_ONLY = /^<br\s*\/?>$/i;

/** Replace break-only `html` children with `break`, in place, one cell's children. */
function convertCellChildren(children: PhrasingContent[]): void {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'html' && BREAK_ONLY.test(child.value.trim())) {
      children[i] = { type: 'break', ...(child.position ? { position: child.position } : {}) };
    }
  }
}

/** Walk to `tableCell` nodes and convert only their direct html children. */
function visitCells(node: Root | RootContent): void {
  if (node.type === 'tableCell') {
    convertCellChildren(node.children);
    return;   // a cell holds phrasing content only — no nested cells to find below it
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) visitCells(child as RootContent);
  }
}

export const remarkTableCellBreaks: Plugin<[], Root> = () => (tree) => {
  visitCells(tree);
};
