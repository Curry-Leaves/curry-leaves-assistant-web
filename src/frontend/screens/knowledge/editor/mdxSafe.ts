/** Make plain markdown safe for the MDX parser behind the rich editor.
 *
 * Notes are written by agents and by hand as ordinary CommonMark, but MDXEditor parses them as
 * MDX — where `<` starts a JSX tag and `{` starts an expression. Several constructs that are
 * perfectly valid markdown therefore fail to parse, and the editor refuses to open the note:
 *
 *   <https://example.com>   autolink      -> "Unexpected character `/` before local name"
 *   <a@b.com>               email link    -> "Unexpected character `@` in name"
 *   <!-- note -->           HTML comment  -> "Unexpected character `!` before name"
 *   <br>, <img src=…>       void tags     -> "Expected a closing tag"
 *   List<T>                 bare `<`+name -> parsed as an unclosed JSX tag
 *   {a: 1}                  braces        -> "Could not parse expression with acorn"
 *
 * We rewrite those into equivalent forms MDX accepts, so the note opens and reads the same. This
 * runs on the way INTO the editor only — what's on disk is untouched unless the user actually
 * edits and saves, in which case the sanitized (still equivalent) text is what gets written.
 *
 * Code spans and fenced blocks are left exactly alone: MDX already skips them, and rewriting
 * inside them would corrupt real code samples.
 */

/** Split into segments, flagging the ones MDX treats as literal (code) so we never touch them.
 *
 * Scanned line-by-line rather than by one regex: a fence's closer must match the fence that
 * OPENED it (same char, at least as long), and expressing that with a backreference inside an
 * alternation makes the engine match the closer against the opening run and cut the block in
 * half — quietly rewriting the code inside it, which is the one thing this must never do.
 */
function splitProtected(md: string): { text: string; code: boolean }[] {
  const out: { text: string; code: boolean }[] = [];
  // Keep each line's trailing newline with it (see `flush`), so nothing is lost on rejoin.
  const lines = md.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let buf: string[] = [];
  let fence: string | null = null;   // the exact opening run, e.g. "```" or "~~~~"

  // Each buffered line keeps the newline that followed it, so concatenating the segments
  // reproduces the input exactly — joining on '\n' instead would drop the separator at every
  // segment boundary and silently reflow the note (a blank line after a fence vanishing).
  const flush = (code: boolean) => {
    if (buf.length) out.push({ text: buf.join(''), code });
    buf = [];
  };

  for (const line of lines) {
    const open = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence === null && open) {
      flush(false);
      fence = open[1];
      buf.push(line);
      continue;
    }
    if (fence !== null) {
      buf.push(line);
      const close = /^[ \t]*(`{3,}|~{3,})[ \t]*\n?$/.exec(line);
      // Closes only on the same fence character, at least as long as the opener.
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        flush(true);
        fence = null;
      }
      continue;
    }
    buf.push(line);
  }
  flush(fence !== null);   // unterminated fence: treat the rest as code, don't rewrite it

  // Within the non-code segments, inline code spans are protected too.
  const spans = /(`+)[^\n]*?\1/g;
  return out.flatMap((seg) => {
    if (seg.code) return [seg];
    const parts: { text: string; code: boolean }[] = [];
    let last = 0;
    for (let m = spans.exec(seg.text); m; m = spans.exec(seg.text)) {
      if (m.index > last) parts.push({ text: seg.text.slice(last, m.index), code: false });
      parts.push({ text: m[0], code: true });
      last = m.index + m[0].length;
    }
    spans.lastIndex = 0;
    if (last < seg.text.length) parts.push({ text: seg.text.slice(last), code: false });
    return parts;
  });
}

// A tag name MDX would accept, so we can tell real JSX/HTML from a stray `<`.
const TAG = '[A-Za-z][A-Za-z0-9._-]*';
// Void/self-closing HTML that MDX rejects for lacking a closing tag.
const VOID_TAGS = 'br|hr|img|input|meta|link|col|area|base|embed|source|track|wbr';

function sanitizeSegment(s: string): string {
  return s
    // <https://x> and <mailto:x> -> a normal markdown link (identical rendering, MDX-safe).
    .replace(/<((?:https?|mailto|ftp):\/*[^\s<>]+)>/g, (_m, url) => `[${url}](${url})`)
    // <a@b.com> -> the same link, spelled explicitly.
    .replace(/<([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/g, (_m, mail) => `[${mail}](mailto:${mail})`)
    // <!-- comment --> has no MDX equivalent that survives a round-trip; drop it.
    .replace(/<!--[\s\S]*?-->/g, '')
    // <br> / <img …> -> self-closing, which MDX accepts.
    .replace(new RegExp(`<(${VOID_TAGS})((?:\\s[^<>]*?)?)\\s*/?>`, 'gi'),
             (_m, tag, attrs) => `<${tag}${attrs} />`)
    // `{…}` would be read as a JS expression; escape the brace so it stays literal text.
    .replace(/(?<!\\)\{/g, '\\{')
    // A `<` that starts something tag-shaped but is really prose (List<T>, a<b) -> escape it.
    // Anything that looks like a real, closable element is left for MDX to parse.
    .replace(new RegExp(`<(?=${TAG})(?![^<>]*>[\\s\\S]*</)`, 'g'), '&lt;');
}

/** Rewrite `md` so the MDX parser accepts it, leaving code spans/blocks untouched. */
export function toMdxSafe(md: string): string {
  if (!md) return md;
  return splitProtected(md).map((p) => (p.code ? p.text : sanitizeSegment(p.text))).join('');
}
