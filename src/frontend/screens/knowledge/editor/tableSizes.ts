/** Persist table column widths / row heights, which markdown itself cannot hold.
 *
 * A GFM table row is `| a | b |` — there is no slot for a width, and mdast drops any extra
 * property you hang on the table node (verified: a `colWidths` field simply vanishes on
 * serialize). So a resized table has to carry its sizes beside itself, and we use an HTML
 * comment directly above the table:
 *
 *   <!-- cl-table: cols=220,90 rows=40,64 -->
 *   | Steps | Owner |
 *   | ----- | ----- |
 *
 * Other markdown tools ignore a comment, so the table stays a real markdown table that any
 * editor can open — which is the property the whole notes format is built around.
 *
 * WHY a side map instead of leaving the comment in place: MDXEditor parses MDX, where an HTML
 * comment is a parse error, so `toMdxSafe` STRIPS every comment on the way into the editor
 * (see mdxSafe.ts — there is no MDX spelling that survives a round-trip). If we did nothing,
 * opening a note would delete the sizes and the next save would write the table back without
 * them. Instead we lift the comments out BEFORE the editor sees the text, hold them by table
 * index, and write them back on the way out. That is the same trick image sizing uses (a
 * `#w=…&h=…` fragment) for the same underlying reason.
 *
 * Tables are keyed by their ORDER in the document. That is stable for the common edits
 * (typing in a cell, resizing, adding a row) and degrades gracefully: insert a new table
 * above an existing one and the sizes shift to the wrong table, which the user fixes by
 * dragging again. Storing an id in the note would be more robust but would put a visible
 * marker in the file, which is the thing we are trying to avoid.
 */

/** One table's sizes. Empty arrays mean "not set" — auto-layout stays in charge. */
export interface TableSizes {
  cols: number[];
  rows: number[];
}

// Matches our own marker only, so an unrelated comment in the note is left completely alone.
const MARKER = /^[ \t]*<!--[ \t]*cl-table:([^>]*?)-->[ \t]*$/;

function parseList(spec: string, key: string): number[] {
  // The value run accepts `-` so a hand-mangled `cols=0,-4,120` is consumed WHOLE and the
  // valid 120 still survives the filter below. Stopping the match at the `-` instead would
  // silently discard every width after the bad one.
  const m = new RegExp(`\\b${key}=([-0-9.,]+)`).exec(spec);
  if (!m) return [];
  return m[1].split(',')
    .map((n) => Math.round(parseFloat(n)))
    // A zero/NaN/negative width would collapse a column with no way to grab it again.
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** True for a line that opens a GFM table body (`| a | b |`). */
function isTableLine(line: string): boolean {
  return /^[ \t]*\|/.test(line);
}

/** Strip our markers out of `md`, returning the clean text plus sizes by table index.
 *
 * Called BEFORE toMdxSafe so the sizes are captured rather than silently dropped. A marker
 * that is not immediately followed by a table is discarded as stale — that is what a
 * cut-and-pasted table leaves behind, and keeping it would misalign every later index. */
export function extractTableSizes(md: string): { text: string; sizes: Map<number, TableSizes> } {
  if (!md.includes('cl-table:')) return { text: md, sizes: new Map() };

  const lines = md.split('\n');
  const out: string[] = [];
  const sizes = new Map<number, TableSizes>();
  let tableIndex = 0;
  let pending: TableSizes | null = null;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Never interpret anything inside a fenced block — it may be a code sample OF this format.
    if (/^[ \t]*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const marker = MARKER.exec(line);
    if (marker) {
      // Look past blank lines: the serializer puts one between the comment and the table.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && isTableLine(lines[j])) {
        pending = { cols: parseList(marker[1], 'cols'), rows: parseList(marker[1], 'rows') };
      }
      continue;   // the marker itself never reaches the editor
    }

    // First line of a table body — claim the pending marker for this table's index.
    const startsTable = isTableLine(line) && !(i > 0 && isTableLine(lines[i - 1]));
    if (startsTable) {
      if (pending) sizes.set(tableIndex, pending);
      pending = null;
      tableIndex++;
    }
    out.push(line);
  }

  return { text: out.join('\n'), sizes };
}

/** Re-insert markers above each table that has sizes. Called on the way OUT of the editor.
 *
 * Tables with no recorded sizes get no comment at all, so a note whose tables were never
 * resized stays byte-identical to plain markdown. */
export function injectTableSizes(md: string, sizes: Map<number, TableSizes>): string {
  if (sizes.size === 0) return md;

  const lines = md.split('\n');
  const out: string[] = [];
  let tableIndex = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[ \t]*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (!inFence && isTableLine(line) && !(i > 0 && isTableLine(lines[i - 1]))) {
      const s = sizes.get(tableIndex);
      const parts = [
        s?.cols.length ? `cols=${s.cols.join(',')}` : '',
        s?.rows.length ? `rows=${s.rows.join(',')}` : '',
      ].filter(Boolean);
      if (parts.length) out.push(`<!-- cl-table: ${parts.join(' ')} -->`);
      tableIndex++;
    }
    out.push(line);
  }

  return out.join('\n');
}
