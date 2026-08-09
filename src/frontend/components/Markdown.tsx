import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidDiagram } from './MermaidDiagram';
import { CodeBlock } from './CodeBlock';
import { SvgBlock, splitSvg } from './SvgBlock';
import { DiagramSkeleton } from './DiagramSkeleton';
import { healMarkdown } from './healMarkdown';
import { NoteImage } from './NoteImage';
import { htmlImagesToMarkdown } from './noteImages';
import { remarkTableCellBreaks } from './tableCellBreaks';
import { remarkTableSizes } from './tableSizeStyles';
import { RichBlockView, RICH_BLOCK_LANGUAGES } from '../screens/knowledge/editor/blocks/BlockView';

/** Stamp persisted heights onto a table's body rows.
 *
 * Applied by cloning rather than by CSS because a height has to land on the specific Nth
 * <tr>, and the rows arrive as already-built elements from react-markdown. Only <tbody>
 * rows are numbered — the header is not resizable — and a row with no recorded height keeps
 * its natural grow-to-fit behavior, which is what in-cell line breaks depend on. */
function withRowHeights(children: ReactNode, rows: number[]): ReactNode {
  let row = 0;
  return Children.map(children, (section) => {
    if (!isValidElement(section) || section.type !== 'tbody') return section;
    const body = section as React.ReactElement<{ children?: ReactNode }>;
    return cloneElement(body, {
      children: Children.map(body.props.children, (tr) => {
        if (!isValidElement(tr)) return tr;
        const h = rows[row++];
        if (!h) return tr;
        const el = tr as React.ReactElement<{ style?: React.CSSProperties }>;
        return cloneElement(el, { style: { ...el.props.style, height: `${h}px` } });
      }),
    });
  });
}

// GitHub-flavored markdown, styled to match the app surface. Shared by chat, the
// knowledge viewer, and dashboard tiles so rendered markdown looks identical
// everywhere (screens/askai/Markdown.tsx re-exports this — don't fork a copy).
const MD_COMPONENTS = {
  p: (p: any) => <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed break-words" {...p} />,
  a: (p: any) => <a className="text-accent underline underline-offset-2 hover:text-accent-dark" target="_blank" rel="noreferrer" {...p} />,
  ul: (p: any) => <ul className="my-1.5 pl-5 list-disc space-y-0.5" {...p} />,
  ol: (p: any) => <ol className="my-1.5 pl-5 list-decimal space-y-0.5" {...p} />,
  li: ({ className = '', ...p }: any) =>
    <li className={`leading-relaxed ${className.includes('task-list-item') ? 'list-none -ml-4' : ''} ${className}`} {...p} />,
  h1: (p: any) => <h1 className="text-[16px] font-650 mt-3 mb-1.5 first:mt-0 pb-1 border-b border-border" {...p} />,
  h2: (p: any) => <h2 className="text-[15px] font-650 mt-3 mb-1.5 first:mt-0" {...p} />,
  h3: (p: any) => <h3 className="text-[14px] font-600 mt-2 mb-1 first:mt-0" {...p} />,
  h4: (p: any) => <h4 className="text-[13.5px] font-600 mt-2 mb-1 first:mt-0 text-ink2" {...p} />,
  blockquote: (p: any) => <blockquote className="border-l-2 border-accent/50 bg-border-soft/30 rounded-r-[8px] pl-3 pr-2 py-1 my-2 text-ink2" {...p} />,
  hr: () => <hr className="my-3 border-border" />,
  strong: (p: any) => <strong className="font-650" {...p} />,
  del: (p: any) => <del className="line-through text-ink3" {...p} />,
  // Attachments are stored bundle-relative (`assets/x.png`); NoteImage resolves those against
  // the backend, since this page's origin generally isn't the backend's.
  img: (p: any) => <NoteImage {...p} />,
  // GFM task lists: render the checkbox in the app accent, hide the list bullet
  input: (p: any) => p.type === 'checkbox'
    ? <input className="accent-accent mr-1.5 align-middle" disabled {...p} />
    : <input {...p} />,
  // react-markdown v10 dropped the `inline` prop: fenced blocks carry a `language-*`
  // class (or live inside <pre>), bare inline code carries neither.
  code: ({ className, children, ...rest }: any) =>
    className?.includes('language-')
      ? <code className={`font-mono text-[12px] ${className}`} {...rest}>{children}</code>
      : <code className="font-mono text-[12.5px] bg-bg border border-border rounded px-1 py-0.5 break-all" {...rest}>{children}</code>,
  // A ```mermaid fenced block arrives as <pre><code class="language-mermaid">.
  // Intercept at the <pre> level (code's className isn't visible on <pre>'s own
  // props) and render the diagram in place of the code box.
  pre: ({ children, ...p }: any) => {
    const cls: string = children?.props?.className ?? '';
    if (cls.includes('language-mermaid')) {
      const source = String(children.props.children ?? '').replace(/\n$/, '');
      return <MermaidDiagram source={source} />;
    }
    // A ```svg fenced block renders as the (sanitized) image rather than as its markup.
    if (cls.includes('language-svg')) {
      const source = String(children.props.children ?? '').replace(/\n$/, '');
      return <SvgBlock source={source} />;
    }
    const lang = /language-(\w+)/.exec(cls)?.[1];
    // The rich blocks (calendar, timeline, kanban, …) are fenced code by design, so they'd
    // otherwise show here as raw CSV. Render them the way the editor does, with the plain code
    // box as the fallback for a block that doesn't parse — a half-written one stays readable as
    // text instead of blanking out. (The fallback has to be passed IN: the JSX element is always
    // truthy, so it can't be tested for null out here.)
    //
    // Checked BEFORE the `children != null` guard below: an EMPTY fenced block has no children
    // at all, and an empty calendar is the normal starting state — you insert one and then add
    // events. Guarding first made it fall through to a bare <pre> and render as nothing.
    if (lang && RICH_BLOCK_LANGUAGES.has(lang)) {
      const code = String(children?.props?.children ?? '');
      return (
        <RichBlockView
          language={lang}
          code={code.replace(/\n$/, '')}
          renderMarkdown={(md) => <Markdown text={md} variant="doc" />}
          fallback={<CodeBlock code={code} language={lang} />}
        />
      );
    }
    // A fenced ```lang block arrives as <pre><code class="language-lang">. Render it
    // with a line-number gutter (and pretty-print + highlight JSON) via CodeBlock.
    if (children?.props?.children != null) {
      const code = String(children.props.children ?? '');
      return <CodeBlock code={code} language={lang} />;
    }
    return <pre className="my-1.5 px-2.5 py-2 rounded-[8px] bg-bg border border-border overflow-x-auto text-[12px] leading-relaxed [&_code]:bg-transparent [&_code]:border-0 [&_code]:p-0" {...p}>{children}</pre>;
  },
  // Tables render as a rounded card: header band, hairline row dividers, zebra rows,
  // horizontal scroll when the grid outgrows its container.
  // Column widths / row heights the editor persisted (see tableSizeStyles.ts) arrive as
  // data-cl-cols / data-cl-rows. Widths need a real <colgroup> plus `table-layout: fixed`
  // to take effect; without a marker the table keeps its natural auto layout.
  table: ({ 'data-cl-cols': dataCols, 'data-cl-rows': dataRows, children, ...p }: any) => {
    const nums = (v: unknown) => String(v ?? '').split(',').filter(Boolean).map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
    const cols = nums(dataCols);
    const rows = nums(dataRows);
    // The card hugs a sized table (`w-fit`) instead of spanning the pane: with explicit widths
    // the columns no longer fill the container, and a full-width border would frame a large
    // empty area to the right of the last column. `max-w-full` keeps the scroll behavior for a
    // table wider than the pane.
    return (
      <div className={`my-2 overflow-x-auto rounded-[10px] border border-border${
        cols.length ? ' w-fit max-w-full' : ''}`}>
        {/* `w-full` has to go when there are explicit widths: at width:100% the fixed layout
            stretches the columns proportionally to fill the container and the saved pixel
            widths are ignored (measured: 260px renders as 687px). `width:auto` + fixed layout
            makes the <col> widths literal. Deliberately NO min-width:100% — that reintroduces
            the same stretching; a narrow table simply stays narrow, as the user sized it. */}
        <table
          className={`border-collapse text-[13px] ${cols.length ? '' : 'w-full'}`}
          style={cols.length ? { tableLayout: 'fixed', width: 'auto' } : undefined}
          {...p}
        >
          {cols.length > 0 && (
            <colgroup>{cols.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}</colgroup>
          )}
          {rows.length ? withRowHeights(children, rows) : children}
        </table>
      </div>
    );
  },
  thead: (p: any) => <thead className="bg-border-soft" {...p} />,
  tr: (p: any) => <tr className="even:bg-border-soft/30 [&:last-child>td]:border-b-0" {...p} />,
  th: (p: any) => <th className="px-3 py-1.5 text-left font-600 text-ink border-b border-border whitespace-nowrap" {...p} />,
  td: (p: any) => <td className="px-3 py-1.5 align-top border-b border-border/60" {...p} />,
};

// Document variant — used by the knowledge note viewer, where content reads as a
// page rather than a chat bubble: headings follow the app's serif display face
// (Fraunces, like every screen title) with a real size ladder and roomier rhythm.
const DOC_COMPONENTS = {
  ...MD_COMPONENTS,
  p: (p: any) => <p className="my-2 first:mt-0 last:mb-0 leading-relaxed" {...p} />,
  ul: (p: any) => <ul className="my-2 pl-5 list-disc space-y-1" {...p} />,
  ol: (p: any) => <ol className="my-2 pl-5 list-decimal space-y-1" {...p} />,
  h1: (p: any) => <h1 className="font-serif text-[23px] font-500 tracking-tight text-ink mt-6 mb-2.5 first:mt-0" {...p} />,
  h2: (p: any) => <h2 className="font-serif text-[19px] font-500 tracking-tight text-ink mt-5 mb-2 first:mt-0" {...p} />,
  h3: (p: any) => <h3 className="text-[15px] font-600 text-ink mt-4 mb-1.5 first:mt-0" {...p} />,
  blockquote: (p: any) => <blockquote className="border-l-2 border-accent-soft pl-3 my-2.5 text-ink2 italic" {...p} />,
  hr: () => <hr className="my-4 border-border" />,
};

// Source variant — reads like `doc`, but every fenced block stays highlighted SOURCE rather
// than becoming a live widget. Used for prose that documents the block formats themselves
// (a skill file's ```calendar example must show its syntax, not render a calendar).
const SOURCE_COMPONENTS = {
  ...DOC_COMPONENTS,
  pre: ({ children, ...p }: any) => {
    const lang = String(children?.props?.className ?? '').match(/language-(\w+)/)?.[1] ?? '';
    const code = String(children?.props?.children ?? '');
    if (children?.props?.children != null) return <CodeBlock code={code} language={lang} />;
    return <pre className="my-1.5 px-2.5 py-2 rounded-[8px] bg-bg border border-border overflow-x-auto text-[12px] leading-relaxed [&_code]:bg-transparent [&_code]:border-0 [&_code]:p-0" {...p}>{children}</pre>;
  },
};

// True for OKF cross-links — same-bundle markdown paths like "/topics/ml/adam.md".
const isInternal = (href?: string) => !!href && !/^[a-z]+:\/\//i.test(href) && /\.md(#.*)?$/i.test(href);

// A bundle-relative KB note path (e.g. "apps/focusmate/integrations/jira.md",
// "CONVENTIONS.md") — no protocol, no spaces, ends in .md. Assistant answers cite
// their source as inline code (`…md`); when a navigator is supplied we turn those
// into clickable links that open the note in the Knowledge Hub.
const KB_PATH = /^[\w.-]+(?:\/[\w.-]+)*\.md$/i;
const isNotePath = (s: string) => KB_PATH.test(s.trim()) && !/^https?:/i.test(s);

// While a fence is still open mid-stream, its block is by construction the LAST one, and
// its body is whatever has arrived so far. Rendering that through mermaid/DOMPurify on
// every token flickers between parse errors ("No diagram type detected matching: grap"),
// so a `pre` whose content is a *prefix* of the still-open block is held as a skeleton
// and drawn once, when the real closing fence lands.
const heldPre = (base: any, openSource: string) => ({
  ...base,
  pre: ({ children, ...p }: any) => {
    const cls: string = children?.props?.className ?? '';
    const body = String(children?.props?.children ?? '').replace(/\n$/, '');
    const isOpenBlock = !!body && openSource.startsWith(body);
    if (isOpenBlock && (cls.includes('language-mermaid') || /^\s*(graph|flowchart|sequenceDiagram|gantt|classDiagram|stateDiagram|erDiagram|journey|pie|mindmap)\b/.test(body)))
      return <DiagramSkeleton />;
    if (isOpenBlock && (cls.includes('language-svg') || /^\s*<svg\b/i.test(body)))
      return <DiagramSkeleton label="Drawing image" />;
    // Same for the rich blocks: their parsers accept partial input, so a streaming timeline
    // would redraw with one row, then two, then three as tokens land — and flip through the
    // plain code box first, while too little has arrived to parse. Hold it until the fence
    // closes and draw the finished block once.
    if (isOpenBlock) {
      const lang = /language-(\w+)/.exec(cls)?.[1];
      if (lang && RICH_BLOCK_LANGUAGES.has(lang)) return <DiagramSkeleton label="Building block" />;
    }
    return base.pre({ children, ...p });
  },
});

export function Markdown({ text, onNavigate, textSize = 'text-[14px]', variant = 'chat', streaming = false }: {
  text: string; onNavigate?: (path: string) => void; textSize?: string;
  /** `doc` renders rich fences (```calendar, ```timeline…) as live blocks — right for a note,
   *  wrong for text that DOCUMENTS those formats. `source` is `doc` with every fence left as
   *  highlighted code, which is what a skill file needs: it teaches the format it contains. */
  variant?: 'chat' | 'doc' | 'source';
  /** Mid-stream: repair half-written syntax so partial markdown renders formatted rather
   *  than as raw `**`/```` ``` ```` markers, and hold diagrams until their source closes. */
  streaming?: boolean;
}) {
  const base = variant === 'chat' ? MD_COMPONENTS
    : variant === 'source' ? SOURCE_COMPONENTS
    : DOC_COMPONENTS;
  // When a navigator is supplied, intercept internal note links so clicking a
  // cross-link opens that note instead of trying to load a file:// URL. We also
  // turn bare inline-code note paths (how answers cite their `Source:`) into the
  // same clickable link, so a citation navigates straight to the Knowledge Hub.
  // Mid-stream, close whatever the tail left open first — otherwise the unterminated
  // fence/emphasis renders as literal syntax for as long as the model takes to finish the
  // construct. A finished message is passed through verbatim.
  const healed = streaming ? healMarkdown(text) : null;
  const withHold = healed?.openFence ? heldPre(base, healed.openBody) : base;
  const components = onNavigate
    ? {
        ...withHold,
        a: ({ href, children, ...rest }: any) =>
          isInternal(href)
            ? <a className="text-accent underline underline-offset-2 hover:text-accent-dark cursor-pointer"
                onClick={(e) => { e.preventDefault(); onNavigate(href.replace(/^\//, '').replace(/#.*$/, '')); }} {...rest}>{children}</a>
            : <a className="text-accent underline underline-offset-2 hover:text-accent-dark" href={href} target="_blank" rel="noreferrer" {...rest}>{children}</a>,
        code: ({ className, children, ...rest }: any) => {
          const raw = String(children ?? '');
          // Only bare inline code (no language-* class = not a fenced block) that
          // looks like a KB note path becomes a link; everything else stays a code chip.
          if (!className?.includes('language-') && isNotePath(raw)) {
            return (
              <button type="button" title={`Open ${raw.trim()} in Knowledge`}
                onClick={() => onNavigate(raw.trim())}
                className="inline-flex items-baseline gap-1 font-mono text-[12px] text-accent bg-accent-soft/40 border border-accent/30 rounded px-1 py-0.5 align-baseline hover:bg-accent-soft/70 hover:border-accent/50 cursor-pointer break-all">
                {raw.trim()}
              </button>
            );
          }
          return (base as any).code({ className, children, ...rest });
        },
      }
    : withHold;

  // Pull top-level <svg>…</svg> blocks out of the text and render them as sanitized
  // inline images (react-markdown strips raw HTML), routing everything else through the
  // normal markdown pipeline. Most messages have no SVG → a single md chunk, no extra work.
  // Fold raw `<img …>` tags into markdown images before rendering. Resizing an image in the
  // note editor makes MDXEditor serialize it as HTML (markdown has nowhere to put width and
  // height), and we render without rehype-raw on purpose — so without this the reader sees the
  // literal tag as escaped text instead of a picture. Dimensions survive as a `#w=…&h=…`
  // fragment that NoteImage applies. Notes already on disk in the HTML form are fixed on read,
  // so this repairs existing notes, not just newly-saved ones.
  const chunks = splitSvg(htmlImagesToMarkdown(healed ? healed.text : text));

  return (
    <div className={`min-w-0 ${textSize} text-ink leading-relaxed [&>:first-child]:mt-0 [&>:last-child]:mb-0`}>
      {chunks.map((c, i) =>
        c.kind === 'svg' ? (
          <SvgBlock key={i} source={c.source} />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm, remarkTableCellBreaks, remarkTableSizes]} components={components}>{c.text}</ReactMarkdown>
        ),
      )}
    </div>
  );
}

// Inline-only rendering (bold/italic/links/code, no block wrapping) for markdown
// dropped inside an existing block element — a <li>, a table <td>, a metric label —
// where the full Markdown component's <p> margins would break up a tight layout.
const INLINE_COMPONENTS = { ...MD_COMPONENTS, p: (p: any) => <span {...p} /> };

export function InlineMarkdown({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm, remarkTableCellBreaks, remarkTableSizes]} components={INLINE_COMPONENTS}>{text}</ReactMarkdown>;
}
