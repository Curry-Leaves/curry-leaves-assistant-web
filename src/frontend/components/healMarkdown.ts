// Mid-stream markdown repair. While a reply streams in token by token, the tail of the
// text is almost always a half-written construct: `**bol`, `[label](htt`, an unclosed
// ``` fence. react-markdown correctly refuses to interpret those, so the raw syntax
// flashes on screen until the closing marker arrives. We heal the tail — close what's
// open — so each frame renders as formatted text instead.
//
// Only ever applied while streaming; the final content renders untouched.

// Characters that are safe to leave dangling — a lone `*` in prose ("2 * 3") is far more
// common than a half-typed emphasis marker, so we only heal markers we saw *open* a span.
const INLINE = ['***', '**', '~~', '`', '*', '_'] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strip fenced-code regions, so inline-marker counting never sees code content
 *  (a `**` inside a python block isn't emphasis). Returns prose only. */
function proseOnly(text: string): string {
  return text
    .replace(/^```[\s\S]*?^```/gm, '')   // closed fenced blocks
    // A fence that is still open mid-stream has no closer to match above, so its body would
    // otherwise be scanned as prose — a lone `*` or `_` in code then counts as unbalanced
    // emphasis and gets a stray marker appended.
    .replace(/^```[\s\S]*$/m, '')
    .replace(/`[^`\n]*`/g, '');
}

export type Healed = {
  /** Text safe to hand to react-markdown this frame. */
  text: string;
  /** True when we had to close a fence — i.e. the final block is still being written.
   *  Callers use this to hold diagram/SVG rendering until the source is complete. */
  openFence: boolean;
  /** Body of that still-open block (empty when no fence is open). The renderer matches a
   *  `<pre>`'s content against this to know which block to hold behind a skeleton. */
  openBody: string;
};

export function healMarkdown(raw: string): Healed {
  let t = raw;

  // 1. Unterminated fenced block. Count line-start fences; an odd count means the last
  //    one is still open. Close it so the content renders as code rather than as literal
  //    "```mermaid graph TD" prose.
  const fences = t.match(/^[ \t]*(?:`{3,}|~{3,})/gm)?.length ?? 0;
  const openFence = fences % 2 === 1;
  // Everything after the last opening fence's info line is the block body so far — the
  // renderer matches it to decide which <pre> is still being written.
  let openBody = '';
  // Offset where the still-open fence starts. Emphasis left dangling in the prose ABOVE it
  // has to be closed there rather than at the end of the string — appending would drop the
  // marker inside the code block (rendering a literal "```**" or a stray "**" after the
  // code), healing neither construct.
  let fenceAt = -1;
  if (openFence) {
    const open = t.lastIndexOf('\n```') === -1 ? t.indexOf('```') : t.lastIndexOf('\n```') + 1;
    const nl = t.indexOf('\n', open);
    openBody = nl === -1 ? '' : t.slice(nl + 1);
    fenceAt = open;
  }

  // 2. A partial raw <svg> tail would otherwise dump its markup on screen as text
  //    (splitSvg only matches complete pairs). Drop it until the closing tag lands.
  const lastSvg = t.lastIndexOf('<svg');
  if (lastSvg !== -1 && !/<\/svg>/i.test(t.slice(lastSvg))) t = t.slice(0, lastSvg);

  // 3. Dangling link/image: "[label](http://par" or a bare "[lab". Unwrap to the label
  //    text so the words stay readable and the URL doesn't flash.
  t = t.replace(/!?\[([^\]\n]*)\]\([^)\n]*$/, '$1');
  t = t.replace(/!?\[[^\]\n]*$/, '');

  // 4. Unbalanced inline emphasis. Longest markers first so `***` is consumed before it
  //    is seen as `**` + `*`; each marker's occurrences are removed from the working
  //    copy once counted, so shorter markers don't re-count the same characters.
  let scan = proseOnly(t);
  const close: string[] = [];
  for (const tok of INLINE) {
    const re = new RegExp(escapeRe(tok), 'g');
    const n = scan.match(re)?.length ?? 0;
    if (n % 2 === 1) close.push(tok);
    scan = scan.replace(re, '');
  }
  // Close in reverse order — innermost span first — so `**bold _ital` heals to
  // `**bold _ital_**`, not `**bold _ital**_`.
  const closers = close.reverse().join('');
  if (fenceAt >= 0) {
    // Close the emphasis just before the fence opens, then close the fence at the end, so
    // the prose above renders bold/italic and the code block stays clean.
    t = t.slice(0, fenceAt).replace(/\s*$/, '') + closers + '\n' + t.slice(fenceAt) + '\n```';
  } else {
    t += closers;
  }

  return { text: t, openFence, openBody };
}
