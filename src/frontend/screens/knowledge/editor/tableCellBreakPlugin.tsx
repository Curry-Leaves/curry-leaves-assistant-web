/** Shift+Enter inserts a line break inside a table cell.
 *
 * MDXEditor binds Enter in a table cell to "save this cell and move to the row below"
 * at COMMAND_PRIORITY_CRITICAL, and it inspects `shiftKey` only to pick a direction
 * (Shift+Enter goes UP a row) — so out of the box no keystroke can put a second line
 * inside a cell. This plugin registers a cell-scoped handler at the same CRITICAL
 * priority; because it is added later it runs first, and it claims Shift+Enter while
 * letting plain Enter fall through to MDXEditor's row navigation (which is genuinely
 * useful for filling a column top-to-bottom).
 *
 * WHY a GenericHTMLNode and not a plain Lexical line break: a GFM table row is a single
 * line of source, so a real newline cannot survive there — the serializer collapses a
 * `break` (which is what MDXEditor's LexicalLinebreakVisitor emits) into a space, and the
 * user's second line silently disappears on save. `GenericHTMLNode('br')` exports as an
 * `mdxJsxTextElement`, which serializes to a literal `<br />` — the conventional carrier
 * for an in-cell break, and one that round-trips back into the editor intact.
 *
 * Reusing MDXEditor's own node type is deliberate: it is already registered and already
 * has import/export visitors, so this needs no custom node and no visitor override. An
 * override would have to be global (cell editors share `exportVisitors$`) and would turn
 * ordinary paragraph soft-breaks into `<br />` everywhere.
 *
 * The read view renders the tag via remarkTableCellBreaks — see components/tableCellBreaks.ts.
 */
import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createTextNode, $getSelection, $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL, KEY_ENTER_COMMAND,
} from 'lexical';
import { $createGenericHTMLNode, addTableCellEditorChild$, realmPlugin } from '@mdxeditor/editor';

// Written as an escape on purpose: a literal zero-width space here would be invisible in
// the source and trivially lost to an editor trimming "empty" strings. RichNoteEditor's
// syncMarkdown strips this same character on the way out.
const ZWSP = '\u200B';

/** Mounted once inside every table cell's nested editor (via addTableCellEditorChild$). */
function TableCellBreakHandler() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      if (!event?.shiftKey) return false;   // plain Enter stays row navigation

      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return false;

      event.preventDefault();
      const br = $createGenericHTMLNode('br', 'mdxJsxTextElement', []);
      // The caret has to end up AFTER the break, in a node that can accept text. Neither
      // `br.selectNext()` nor an EMPTY trailing text node achieves that: the break is an
      // inline element with no text position of its own, and Lexical drops a zero-length
      // text node during reconciliation — either way the caret falls back to the text
      // BEFORE the break, so the next keystroke lands on the wrong side of it
      // (`alphaZZ<br />` instead of `alpha<br />ZZ`).
      //
      // A zero-width space is real content, so it survives reconciliation, holds a caret
      // position, and is invisible to the reader. It is a caret scaffold and never content:
      // RichNoteEditor's syncMarkdown strips every ZWSP before the markdown is propagated,
      // so none of them reach the saved file.
      const after = $createTextNode(ZWSP);
      selection.insertNodes([br, after]);
      after.select(1, 1);
      return true;
    },
    // Matches MDXEditor's own cell handler; registered later, so ours is consulted first
    // and can decline (return false) to hand plain Enter back to it.
    COMMAND_PRIORITY_CRITICAL,
  ), [editor]);

  return null;
}

export const tableCellBreakPlugin = realmPlugin({
  init: (realm) => {
    realm.pubIn({ [addTableCellEditorChild$]: TableCellBreakHandler });
  },
});
