/** Shared image-markdown helpers, used by BOTH the note renderer and the note editor.
 *
 * The central problem: markdown's `![alt](src)` has nowhere to put a width or a height. So the
 * moment a user resizes an image in the editor, MDXEditor stops emitting markdown and serializes
 * the node as a raw `<img …>` HTML tag instead (see its LexicalImageVisitor — it switches on
 * `shouldBeSerializedAsElement()`). Our viewer renders through react-markdown *without*
 * rehype-raw, deliberately, so that a note can never inject arbitrary markup into the app. The
 * consequence is that the raw tag is escaped and the reader sees the literal `<img …>` text.
 *
 * Rather than enable raw HTML for every note, we normalize the tag back into a markdown image and
 * carry the size in the URL fragment: `assets/x.png#w=120&h=60`. That keeps notes as plain
 * portable markdown (another markdown tool ignores the fragment and shows the image full-size),
 * keeps the renderer free of raw HTML, and still honours the size the user chose.
 *
 * This lives in `components/` rather than under the editor because the renderer must apply it on
 * READ — that repairs notes already saved in the HTML form, not only newly-saved ones.
 */

const HTML_IMG = /<img\b[^>]*?\/?>/gi;

const attrOf = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"|\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? null) : null;
};

/** How an image sits in the column. `left` is the natural flow, so it is never written out. */
export type ImageAlign = 'left' | 'center' | 'right';

const ALIGNS: readonly string[] = ['left', 'center', 'right'];
const isAlign = (s: string | null | undefined): s is ImageAlign => !!s && ALIGNS.includes(s);

/** Rewrite every raw `<img>` tag in `md` as a markdown image; size and alignment move into the
 *  fragment. Alignment travels as `data-align` on the tag, because MDXEditor keeps unknown
 *  attributes on the node (`getRest()`) and writes them back out — so the user's choice survives
 *  a trip through the editor without needing a custom Lexical node. */
export function htmlImagesToMarkdown(md: string): string {
  if (!md || !md.includes('<img')) return md;   // cheap bail-out: most notes have none
  return md.replace(HTML_IMG, (tag) => {
    const src = attrOf(tag, 'src');
    if (!src) return tag;                        // nothing usable — leave it alone
    const alt = attrOf(tag, 'alt') ?? '';
    const w = attrOf(tag, 'width');
    const h = attrOf(tag, 'height');
    // `data-align` is the canonical carrier; the `cl-img-<align>` class is what the editor
    // needs in the DOM (see ImageAlignToolbar), and a stray inline style can come from an
    // older note — accept any of them so no note loses its alignment on the way through.
    const cls = attrOf(tag, 'class') ?? attrOf(tag, 'className') ?? '';
    const classAlign = /\bcl-img-(left|center|right)\b/.exec(cls)?.[1] ?? null;
    const styleAlign = /margin(?:-inline)?\s*:\s*0\s+auto/i.test(attrOf(tag, 'style') ?? '')
      ? 'center' : null;
    const align = attrOf(tag, 'data-align') ?? classAlign ?? styleAlign;
    const parts = [
      w ? `w=${w}` : '',
      h ? `h=${h}` : '',
      isAlign(align) && align !== 'left' ? `align=${align}` : '',
    ].filter(Boolean);
    // Drop any fragment already on the src so repeated round-trips don't stack them.
    const base = src.split('#')[0];
    return `![${alt}](${base}${parts.length ? `#${parts.join('&')}` : ''})`;
  });
}

/** The inverse: expand `![alt](src#w=120&h=60)` back into an `<img>` tag.
 *
 * Needed because MDXEditor takes image dimensions from ONE place only — its
 * `MdastHtmlImageVisitor`, which reads a real `<img>` tag. The plain-markdown visitor
 * (`MdastImageVisitor`) ignores size entirely and creates the node with `width: "inherit"`, so an
 * image handed to the editor as `![](x.png#w=120)` reopens at full size and the user's resize
 * looks lost. Feeding the editor the HTML form on load is what makes the handle come back at the
 * right size; the viewer still gets markdown, and disk still stores whichever form the editor
 * last serialized. Only images that actually carry a size are expanded — a plain image stays
 * plain markdown, so notes don't sprout HTML they never needed.
 */
export function markdownImagesToHtml(md: string): string {
  if (!md || !md.includes('](')) return md;
  return md.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt: string, url: string) => {
    const { path, width, height, align } = splitDimensions(url);
    // Nothing to express in HTML → leave it as markdown, so plain images stay plain.
    if (!width && !height && !align) return whole;
    const attrs = [
      width ? ` width="${width}"` : '',
      height ? ` height="${height}"` : '',
      align ? ` data-align="${align}"` : '',
      // The class travels alongside because it is the ONLY extra attribute MDXEditor puts on
      // the rendered <img> — without it the editor couldn't show the alignment (see the
      // `cl-img-*` rules in mdxeditor-theme.css).
      align ? ` class="cl-img-${align}"` : '',
      alt ? ` alt="${alt.replace(/"/g, '&quot;')}"` : '',
    ].join('');
    return `<img${attrs} src="${path}" />`;
  });
}

/** Split a note image's src into its stored path and the display options from the fragment. */
export function splitDimensions(src: string): {
  path: string; width?: number; height?: number; align?: ImageAlign;
} {
  const [path, frag = ''] = src.split('#');
  const num = (k: string) => {
    const m = new RegExp(`(?:^|&)${k}=(\\d+)`).exec(frag);
    return m ? Number(m[1]) : undefined;
  };
  const a = /(?:^|&)align=([a-z]+)/i.exec(frag)?.[1]?.toLowerCase();
  // `left` is the default flow, so it carries no meaning in the fragment and is dropped here
  // too — that keeps `align === undefined` the single "no special alignment" state.
  return {
    path,
    width: num('w'),
    height: num('h'),
    align: isAlign(a) && a !== 'left' ? a : undefined,
  };
}

/** Set (or clear) the alignment on one image URL, preserving whatever else the fragment holds. */
export function withAlign(url: string, align: ImageAlign): string {
  const { path, width, height } = splitDimensions(url);
  const parts = [
    width ? `w=${width}` : '',
    height ? `h=${height}` : '',
    align !== 'left' ? `align=${align}` : '',
  ].filter(Boolean);
  return `${path}${parts.length ? `#${parts.join('&')}` : ''}`;
}
