/** Locate the markdown SOURCE of one non-prose element in a note.
 *
 * Prose already edits well with AI: you select rendered text, and the model finds that same text
 * in the markdown. Tables, the fenced rich blocks (kanban, chart, calendar, …) and images do not
 * work that way, for two different reasons:
 *
 *   - A table's rendered selection is `'\t\t\nTask\n\nOwner\n\n…'` while the source is
 *     `| Task | Owner |`. The model is asked to find the selection in the note; that string
 *     does not appear there, so the edit cannot land.
 *   - Each rich block is an isolated nested editor, so its content never enters the page
 *     selection at all — select-all over a note skips the block entirely.
 *
 * So instead of widening the selection (which cannot work — a browser selection cannot span
 * nested editors), we identify WHICH element the user means and hand the model that element's
 * markdown source. The existing whole-note edit path then applies the change and shows a diff,
 * exactly as it already does for prose.
 *
 * Everything here is plain text scanning over the note's markdown. It deliberately does not go
 * through mdast: the editor hands us the live markdown string, and we need character offsets in
 * THAT string to splice a replacement back in.
 */

export type NoteElementKind = 'table' | 'block' | 'image';

export interface NoteElement {
  kind: NoteElementKind;
  /** The element's markdown, exactly as it appears in the note. */
  source: string;
  /** Character range of `source` within the note, for splicing the edit back in. */
  start: number;
  end: number;
  /** For a block, its fence language (`kanban`); for an image, its alt text. Labels the UI. */
  label: string;
  /** Index among elements of this kind, in document order — how the DOM is matched to source. */
  ordinal: number;
  /** Images only: the path, fragment stripped. Preferred over `ordinal` for matching, since it
   *  identifies the image outright rather than relying on both sides counting alike. */
  src?: string;
}

/** Split a note into lines, keeping each line's absolute start offset. */
function lineOffsets(md: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let pos = 0;
  for (const line of md.split('\n')) {
    out.push({ text: line, start: pos });
    pos += line.length + 1;   // +1 for the newline that split() removed
  }
  return out;
}

const FENCE_OPEN = /^[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]*)/;
const TABLE_LINE = /^[ \t]*\|/;
// Any image, inline or on its own line: `![alt](src)`, or the `<img …>` form a resized image is
// stored as. Scanned anywhere in a line rather than whole-line only, because MDXEditor renders
// EVERY image inside a paragraph — so a standalone-only rule would find fewer images in the
// markdown than exist in the DOM, and the two would number differently.
const IMAGE_ANY = /!\[([^\]]*)\]\(([^)\s]*)[^)]*\)|<img\b[^>]*?\bsrc=["']([^"']*)["'][^>]*>/g;

/** Every table, fenced block and standalone image in `md`, in document order.
 *
 * Fenced blocks are scanned first-class rather than skipped, because a ```kanban block IS one of
 * the editable elements — but a table or image INSIDE a fence is just sample text and must not
 * be picked up as its own element. */
export function findNoteElements(md: string): NoteElement[] {
  const lines = lineOffsets(md);
  const out: NoteElement[] = [];
  const counts: Record<NoteElementKind, number> = { table: 0, block: 0, image: 0 };

  const push = (kind: NoteElementKind, start: number, end: number, label: string) => {
    out.push({ kind, source: md.slice(start, end), start, end, label, ordinal: counts[kind]++ });
  };

  for (let i = 0; i < lines.length; i++) {
    const { text, start } = lines[i];

    // ── fenced block ────────────────────────────────────────────────────────
    const fence = FENCE_OPEN.exec(text);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2] || '';
      let j = i + 1;
      for (; j < lines.length; j++) {
        const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(lines[j].text);
        if (close && close[1][0] === marker[0] && close[1].length >= marker.length) break;
      }
      // An unterminated fence runs to the end of the note; treat it as closing there so a
      // half-typed block is still addressable rather than swallowing everything after it.
      const endLine = Math.min(j, lines.length - 1);
      const end = lines[endLine].start + lines[endLine].text.length;
      push('block', start, end, lang);
      i = endLine;                     // resume AFTER the fence — never scan inside it
      continue;
    }

    // ── table ───────────────────────────────────────────────────────────────
    if (TABLE_LINE.test(text)) {
      let j = i;
      while (j + 1 < lines.length && TABLE_LINE.test(lines[j + 1].text)) j++;
      const end = lines[j].start + lines[j].text.length;
      push('table', start, end, '');
      i = j;
      continue;
    }

    // ── images (may be several in one line of prose) ────────────────────────
    IMAGE_ANY.lastIndex = 0;
    for (let m = IMAGE_ANY.exec(text); m; m = IMAGE_ANY.exec(text)) {
      const el: NoteElement = {
        kind: 'image',
        source: m[0],
        start: start + m.index,
        end: start + m.index + m[0].length,
        label: m[1] ?? '',
        ordinal: counts.image++,
      };
      // The src is what pairs this with a DOM node — position alone is not enough, since an
      // inline image and a standalone one look identical to the editor but not to a line scan.
      el.src = (m[2] ?? m[3] ?? '').split('#')[0];
      out.push(el);
    }
  }

  return out;
}

/** The Nth element of `kind`, or null. The DOM knows "this is the 2nd table on the page"; this
 *  turns that into the matching span of markdown. */
export function nthElement(md: string, kind: NoteElementKind, ordinal: number): NoteElement | null {
  return findNoteElements(md).find((e) => e.kind === kind && e.ordinal === ordinal) ?? null;
}

/** Find an image by its path — see `NoteElement.src` for why this beats ordinal matching.
 *  Falls back to the ordinal when the same path appears more than once in the note. */
export function imageElement(md: string, src: string, ordinal: number): NoteElement | null {
  const images = findNoteElements(md).filter((e) => e.kind === 'image');
  const bare = src.split('#')[0];
  const matches = images.filter((e) => e.src && (e.src === bare || bare.endsWith(e.src)));
  if (matches.length === 1) return matches[0];
  return matches[ordinal] ?? images[ordinal] ?? null;
}

/** Splice `replacement` over `el`'s span, returning the new note. */
export function replaceElement(md: string, el: NoteElement, replacement: string): string {
  return md.slice(0, el.start) + replacement.replace(/\s+$/, '') + md.slice(el.end);
}

/** Human label for the AI bar ("this table", "this kanban block", "this image"). */
export function describeElement(el: NoteElement): string {
  if (el.kind === 'table') return 'this table';
  if (el.kind === 'image') return 'this image';
  return el.label ? `this ${el.label} block` : 'this block';
}
