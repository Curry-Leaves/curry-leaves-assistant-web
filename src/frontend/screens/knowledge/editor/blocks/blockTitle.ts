// Read / write an optional user-provided "title" for a single fenced block
// (mermaid, calendar, chart, …). The title is stored as a directive line
// inside the block's content so it round-trips through the markdown file:
//
//   ```mermaid
//   %% @title: User auth sequence
//   sequenceDiagram
//     …
//   ```
//
//   ```chart
//   # @title: Quarterly revenue
//   <tsv body>
//   ```
//
// `%%` is mermaid's comment syntax; `#` is the safe default for the other
// custom blocks (each block's parser already ignores lines it doesn't
// recognise, so the directive is invisible at render time).

const TITLE_RE = /^[ \t]*(?:%%|#)\s*@title:\s*(.*?)\s*(?:\r?\n|$)/;

export type TitlePrefix = '%%' | '#';

export function readTitle(code: string): string {
  const m = code.match(TITLE_RE);
  return m ? m[1].trim() : '';
}

export function stripTitle(code: string): string {
  return code.replace(TITLE_RE, '');
}

export function withTitle(code: string, title: string, prefix: TitlePrefix = '#'): string {
  const body = stripTitle(code);
  const t = title.trim();
  if (!t) return body;
  // Keep titles on a single line — newlines would break the directive parser.
  const safe = t.replace(/[\r\n]+/g, ' ');
  const sep = body && !body.startsWith('\n') ? '\n' : '';
  return `${prefix} @title: ${safe}${sep}${body}`;
}
