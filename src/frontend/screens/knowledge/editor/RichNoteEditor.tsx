/**
 * RichNoteEditor — WYSIWYG markdown editor for Knowledge Hub notes, built on
 * @mdxeditor/editor, with AI editing layered on top (enhance a selection, insert at
 * the cursor via right-click, improve the whole note with hunk-level review).
 *
 * Scope: this edits the note BODY only. Frontmatter is owned by NoteEditor's Properties
 * form and never enters this component — so no `---` ever appears in the rich surface.
 *
 * AI streams over the shared WebSocket (see useAiEdit). Nothing the model produces is
 * applied without review: a cursor insert goes through a compact ReviewCard, while
 * selection and whole-note edits go through the DiffOverlay.
 *
 * Selection edits return the WHOLE note rather than just the replacement prose. The user
 * selects *rendered* text, so splicing a snippet back in required mapping that selection
 * onto the markdown source — guesswork that broke on headings, list markers and links.
 * Handing back the full document removes the mapping; the diff then shows what moved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MDXEditor, type MDXEditorMethods,
  headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin, markdownShortcutPlugin,
  codeBlockPlugin, codeMirrorPlugin, tablePlugin, linkPlugin, linkDialogPlugin, imagePlugin,
  diffSourcePlugin, toolbarPlugin,
  BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle, CreateLink, InsertTable,
  InsertCodeBlock, InsertThematicBreak, Separator, UndoRedo,
  ConditionalContents, ChangeCodeMirrorLanguage, DiffSourceToggleWrapper,
} from '@mdxeditor/editor';
import { diffLines, type Change } from 'diff';
import { buildHunks, mergeHunks } from '../../../components/aitextspace/diff';
import { DiffOverlay } from '../../../components/aitextspace/DiffOverlay';
import type { Hunk, HistoryEntry } from '../../../components/aitextspace/types';
import { Icon } from '../../../components/chrome/Icon';
import { t } from '../../../components/aitextspace/theme';
import { toMdxSafe } from './mdxSafe';
import { mermaidCodeBlockDescriptor } from './blocks/MermaidCodeBlockEditor';
import { tabViewCodeBlockDescriptor } from './blocks/TabViewCodeBlockEditor';
import { calendarCodeBlockDescriptor } from './blocks/CalendarCodeBlockEditor';
import { chartCodeBlockDescriptor } from './blocks/ChartCodeBlockEditor';
import { diffChartCodeBlockDescriptor } from './blocks/DiffChartCodeBlockEditor';
import { timelineCodeBlockDescriptor } from './blocks/TimelineCodeBlockEditor';
import { mindMapCodeBlockDescriptor } from './blocks/MindMapCodeBlockEditor';
import { waterfallCodeBlockDescriptor } from './blocks/WaterfallCodeBlockEditor';
import { sankeyCodeBlockDescriptor } from './blocks/SankeyCodeBlockEditor';
import { kanbanCodeBlockDescriptor } from './blocks/KanbanCodeBlockEditor';
import { apiSpecCodeBlockDescriptor } from './blocks/ApiSpecCodeBlockEditor';
import { excalidrawCodeBlockDescriptor } from './blocks/ExcalidrawCodeBlockEditor';
import { InsertMoreButton } from './blocks/InsertMoreButton';
import { tableCellBreakPlugin } from './tableCellBreakPlugin';
import { extractTableSizes, injectTableSizes, type TableSizes } from './tableSizes';
import { useTableResize } from './useTableResize';
import {
  describeElement, imageElement, nthElement, replaceElement, type NoteElementKind,
} from './noteElements';
import { useElementHover } from './useElementHover';
import { ElementAiButton } from './ElementAiButton';

// Each claims one fenced-code language and renders it as a live block.
const RICH_BLOCK_DESCRIPTORS = [
  mermaidCodeBlockDescriptor, tabViewCodeBlockDescriptor, calendarCodeBlockDescriptor,
  chartCodeBlockDescriptor, diffChartCodeBlockDescriptor, timelineCodeBlockDescriptor,
  mindMapCodeBlockDescriptor, waterfallCodeBlockDescriptor, sankeyCodeBlockDescriptor,
  kanbanCodeBlockDescriptor, apiSpecCodeBlockDescriptor, excalidrawCodeBlockDescriptor,
];
import { useDictation } from '../../../hooks/useDictation';
import { useAiEdit, type AiScope } from './useAiEdit';
import { AiConversationPanel, type ConversationTurn, type TurnOutcome } from './AiConversationPanel';
import { SelectionPill } from './SelectionPill';
import { EditorContextMenu, type AiMenuRequest } from './EditorContextMenu';
import { ReviewCard } from './ReviewCard';
import { NoteLinkButton } from './NoteLinkButton';
import { InsertImageButton } from './InsertImageButton';
import { useImageInsert, normalizeImageBlocks } from './useImageInsert';
import { htmlImagesToMarkdown, markdownImagesToHtml } from '../../../components/noteImages';
import { ImageAlignToolbar } from './ImageAlignToolbar';
import { api } from '../../../api/client';
import '@mdxeditor/editor/style.css';
import './mdxeditor-theme.css';

// A scoped edit in flight: which selection it targets (a saved DOM Range so we can
// restore focus after menus steal it) and the streamed candidate.
interface ScopedEdit {
  scope: Exclude<AiScope, 'whole'>;
  original: string;
  range: Range | null;
  instruction: string;
  candidate: string | null;
}

interface WholeEdit {
  before: string;
  after: string;
  parts: Change[];
  hunks: Hunk[];
}

export function RichNoteEditor({
  body, onChange, autoFocus, aiPanelOpen = false, onAiPanelOpenChange,
}: {
  body: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
  /** The AI conversation rail. Controlled by the parent so its toggle can live in the
   *  note header next to Properties, where the other rail toggles already are. */
  aiPanelOpen?: boolean;
  onAiPanelOpenChange?: (open: boolean) => void;
}) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const ai = useAiEdit();

  // Notes are plain CommonMark (written by agents and by hand) but MDXEditor parses MDX, where
  // `<` opens a JSX tag and `{` an expression. An autolink like <https://x.com> — valid markdown —
  // otherwise fails to parse and the editor shows a red error instead of the note. Rewrite those
  // few constructs into MDX-safe equivalents; code blocks are left byte-for-byte alone.
  // Normalize a note's images to the ONE form this editor can size correctly.
  //
  // MDXEditor only reads width/height from a real `<img>` tag (its MdastHtmlImageVisitor);
  // the plain-markdown path creates the node with `width: "inherit"`. So a resized image must
  // reach it as HTML or it reopens at full size, looking like the resize was lost. We first fold
  // any existing tag to markdown (canonicalizing whatever form the note happens to be in, and
  // capturing its size into the `#w=…&h=…` fragment), then expand ONLY the sized ones back to
  // `<img>`. Plain images stay plain markdown.
  //
  // toMdxSafe runs last and deliberately leaves `<img …/>` alone — it self-closes void tags
  // rather than escaping them, which is exactly the form MDX accepts.
  //
  // Table column/row sizes come out FIRST, and that order is load-bearing: they are stored in
  // an HTML comment above the table, and toMdxSafe strips every comment (MDX cannot parse one).
  // Extracting first captures the sizes instead of losing them — see tableSizes.ts.
  const { safeBody, initialTableSizes } = useMemo(() => {
    const { text, sizes } = extractTableSizes(body);
    return {
      safeBody: toMdxSafe(markdownImagesToHtml(htmlImagesToMarkdown(text))),
      initialTableSizes: sizes,
    };
  }, [body]);

  // MDXEditor re-serializes the parsed AST on its first onChange after mount, which
  // can differ from `body` (list markers, spacing) even with no user edit. Adopt that
  // as the baseline WITHOUT marking dirty, so opening+closing a note doesn't rewrite it.
  const firstChangeRef = useRef(true);
  const latestRef = useRef(safeBody);
  // Set when an edit originated in THIS editor, so the `safeBody` effect below can tell our own
  // round-tripped keystrokes from a genuine external swap. See that effect for why it matters.
  const ownEditRef = useRef(false);

  // Selection pill state.
  const [pill, setPill] = useState<{ left: number; top: number } | null>(null);
  const selectionRef = useRef<{ text: string; range: Range | null }>({ text: '', range: null });
  // While the pill's menu/custom-input is open, the DOM selection collapses (focus
  // moves into our controls) — freeze so `selectionchange` doesn't dismiss the pill
  // mid-interaction, and so `selectionRef` keeps the captured selection.
  const pillFrozenRef = useRef(false);

  // Right-click menu state.
  const [menu, setMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);

  // Review state — one of these is active at a time.
  const [scoped, setScoped] = useState<ScopedEdit | null>(null);
  const [whole, setWhole] = useState<WholeEdit | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // ── the AI conversation (right rail) ─────────────────────────────────────────
  // `turns` is what the user reads; `convoRef` is what the MODEL is sent. They differ on
  // purpose: an assistant turn's real content is an entire rewritten note, and replaying
  // those verbatim would put one full copy of the note in the prompt per turn. The model
  // gets a one-line summary of what it proposed instead, which is enough for "make it
  // shorter" to resolve while keeping the prompt from growing without bound.
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const convoRef = useRef<{ role: string; content: string }[]>([]);
  // The turn awaiting a decision in the diff overlay, so applying/discarding can stamp the
  // right receipt — and so closing the overlay leaves a way back to it.
  const pendingTurnRef = useRef<string | null>(null);
  // Bumped by Clear. A run that resolves after its generation is stale must not write to the
  // thread: cancelling resolves the in-flight promise, and without this check the abandoned
  // run would append its outcome to the conversation the user just emptied.
  const convoGenRef = useRef(0);

  // Where the diff overlay is anchored. It must be WIDER than the editor column — two
  // columns of source don't fit in what's left once the rails are open (583px of 1500px) —
  // but it must NOT cover the AI panel, because the whole point of the conversation is that
  // you can keep talking while a proposal is on screen. So it spans from the editor's left
  // edge to the panel's left edge, taking back the Properties rail but never the AI rail.
  // Measured rather than styled, since either rail can open and close independently.
  const shellRef = useRef<HTMLDivElement>(null);
  const [reviewRect, setReviewRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => {
      const row = el.getBoundingClientRect();
      const panel = el.querySelector('aside[aria-label="AI conversation"]')?.getBoundingClientRect();
      // Reach past our own row to the edge of the editing area (the Properties rail is
      // NoteEditor's sibling, outside this row) — reviewing a diff is worth borrowing that
      // width. Stop short only of the AI panel, so the composer stays usable.
      const area = el.closest('[data-cl-edit-area]')?.getBoundingClientRect();
      const right = panel ? panel.left : (area ? area.right : row.right);
      setReviewRect({ top: row.top, left: row.left, width: Math.max(0, right - row.left), height: row.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The row's OFFSET can change without its size changing (something above it collapsing),
    // which a ResizeObserver alone won't report.
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [aiPanelOpen]);

  const reviewBox: React.CSSProperties = reviewRect
    ? { position: 'fixed', zIndex: 20, ...reviewRect }
    : { position: 'absolute', inset: 0, zIndex: 20 };

  const addTurn = useCallback((turn: Omit<ConversationTurn, 'id'>): string => {
    const id = crypto.randomUUID();
    setTurns((list) => [...list, { ...turn, id }]);
    return id;
  }, []);

  const stampTurn = useCallback((id: string | null, patch: Partial<ConversationTurn>) => {
    if (!id) return;
    setTurns((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  // Close out whichever proposal was awaiting review. Called from apply/discard and from
  // every path that abandons a run, so a turn can never be left stuck on "review".
  const settlePending = useCallback((outcome: TurnOutcome) => {
    stampTurn(pendingTurnRef.current, { outcome, pending: false });
    pendingTurnRef.current = null;
  }, [stampTurn]);

  // Live table column/row sizes, by table index. A ref because a drag updates them on every
  // pointermove and syncMarkdown must read the latest without re-creating its callback.
  const tableSizesRef = useRef<Map<number, TableSizes>>(initialTableSizes);

  // ── change handling ──────────────────────────────────────────────────────────
  // Pull the editor's live markdown and propagate if it differs from what we last
  // saw. The `firstChangeRef` guard skips MDXEditor's post-mount normalization pass
  // (it re-serializes the AST once, which can differ harmlessly from `body`).
  const syncMarkdown = useCallback((raw: string) => {
    // Lexical serializes images as INLINE nodes, so a pasted image welds itself onto the
    // preceding text or the previous image (`![a](x)![b](y)` on one line). Break them apart
    // before anything else sees the markdown — see normalizeImageBlocks for why that matters.
    // Also drop the zero-width spaces the table-cell Shift+Enter handler parks after a
    // `<br />` to hold the caret (see tableCellBreakPlugin) — they are a caret scaffold,
    // never content, and must not reach the saved file.
    // Table sizes go back in LAST, so the comment lands in the text that gets saved (and is
    // part of the `latestRef` comparison below \u2014 a resize must read as a real change, and a
    // note whose tables were never resized must stay byte-identical to plain markdown).
    const md = injectTableSizes(
      normalizeImageBlocks(raw).replace(/\u200B/g, ''),
      tableSizesRef.current,
    );
    if (firstChangeRef.current) {
      firstChangeRef.current = false;
      latestRef.current = md;
      return; // normalization pass — not a user edit
    }
    if (md === latestRef.current) return;
    latestRef.current = md;
    // Mark this as OUR edit so the `safeBody` effect below adopts it instead of re-setting the
    // document (which would rebuild the DOM under the caret — see that effect's comment).
    ownEditRef.current = true;
    onChange(md);
  }, [onChange]);

  const handleChange = syncMarkdown;

  // The `.cl-mdx` root, as STATE rather than only a ref, so effects can key on it and re-run
  // once it actually mounts. It also portals MDXEditor's popovers (link dialog, block-type
  // menu) INTO the root instead of document.body — otherwise they escape our scoped styling
  // and render with MDXEditor's default (oversized) icons and chrome.
  const [overlayEl, setOverlayEl] = useState<HTMLElement | null>(null);
  const setRoot = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    setOverlayEl(el);
  }, []);

  // Which table / rich block / image the pointer is over — the target for the floating AI
  // button. Frozen while its menu is open so moving into the menu doesn't retarget it.
  const [elementMenuOpen, setElementMenuOpen] = useState(false);
  const hoveredElement = useElementHover(overlayEl, elementMenuOpen);

  // Drag-to-resize table columns/rows. Sizes are DOM-only (markdown has no slot for them), so
  // the drag writes inline styles and then re-serializes by hand: the MutationObserver below
  // watches childList/characterData and deliberately NOT attributes, so a style change raises
  // no mutation of its own — which also means no resize/serialize feedback loop.
  const handleTableSizes = useCallback((next: Map<number, TableSizes>) => {
    tableSizesRef.current = next;
    const md = editorRef.current?.getMarkdown();
    if (md != null) syncMarkdown(md);
  }, [syncMarkdown]);

  const { setSizes: setTableSizes, reapply: reapplyTableSizes } =
    useTableResize(overlayEl, handleTableSizes);

  // Re-assert saved sizes whenever the document is (re)loaded: MDXEditor rebuilds the table
  // DOM from the model, which drops our inline widths.
  useEffect(() => {
    tableSizesRef.current = initialTableSizes;
    setTableSizes(initialTableSizes);
  }, [initialTableSizes, setTableSizes]);

  // Some MDXEditor commands mutate the document WITHOUT firing onChange — notably the
  // link popover's "Remove link", and a few other toolbar actions. Their DOM change
  // still lands in the editor, so a MutationObserver on the stable `.cl-mdx` root
  // (which never remounts, unlike the inner contenteditable that a source-view toggle
  // swaps) catches them: on any mutation, re-read the serialized markdown and sync.
  // Debounced so a burst of mutations (or a command that ALSO fires onChange) only
  // serializes once.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const obs = new MutationObserver((records) => {
      // Ignore anything happening INSIDE a rich block's own editor. Those blocks render a plain
      // <textarea>/<input> that owns its caret; re-serializing the document on their keystrokes
      // pushed the Lexical node's (one keystroke stale) code back through the controlled value
      // and snapped the cursor to the end of the field on every character.
      // `setCode` already syncs the block's content through Lexical, so nothing is lost here.
      const fromBlock = records.every((r) => {
        const node = r.target instanceof Element ? r.target : r.target.parentElement;
        return !!node?.closest('[data-rich-block="true"]');
      });
      if (fromBlock) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const md = editorRef.current?.getMarkdown();
        if (md != null) syncMarkdown(md);
        // MDXEditor rebuilds a table's DOM from the model on any edit inside it (adding a row,
        // typing in a cell), which discards the inline col widths — put them back.
        reapplyTableSizes();
      }, 200);
    });
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { if (timer) clearTimeout(timer); obs.disconnect(); };
  }, [syncMarkdown, reapplyTableSizes]);

  // If the note being edited changes underneath us (parent swaps `body` for a different note,
  // or a restore), reset the editor and the baseline guard.
  //
  // The `ownEditRef` check is what keeps this from firing on our OWN keystrokes. Every edit
  // round-trips: onChange → parent setDraft → new `body` → new `safeBody` → this effect. Acting
  // on that would call setMarkdown() mid-keystroke, rebuilding the whole Lexical document — and
  // with it the block's <textarea>, so the caret jumped somewhere else on every character.
  // Comparing strings alone isn't enough: `safeBody` is the SANITIZED text while `latestRef`
  // holds what the editor serialized, and those legitimately differ (an escaped `\{`, a
  // normalized list marker), so the guard would never settle.
  useEffect(() => {
    if (ownEditRef.current) {
      // Our own edit coming back around — adopt it as the baseline, don't re-set the document.
      ownEditRef.current = false;
      latestRef.current = safeBody;
      return;
    }
    if (safeBody !== latestRef.current) {
      firstChangeRef.current = true;
      latestRef.current = safeBody;
      editorRef.current?.setMarkdown(safeBody);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeBody]);

  // ── images: paste, drop, toolbar ─────────────────────────────────────────────
  // All three funnel through one hook so an image added any way lands identically. The upload
  // is async, so the markdown is inserted on resolve — MDXEditor's insertMarkdown puts it at the
  // current caret, which is still where the user pasted/dropped.
  const insertMarkdown = useCallback((md: string) => {
    editorRef.current?.insertMarkdown(md);
    // insertMarkdown mutates Lexical without necessarily firing onChange (same gap the
    // MutationObserver above covers), so sync explicitly — otherwise an image added as the
    // only edit never marks the note dirty and the Save button stays disabled.
    const next = editorRef.current?.getMarkdown();
    if (next != null) syncMarkdown(next);
  }, [syncMarkdown]);

  const images = useImageInsert(insertMarkdown);
  const [dragOver, setDragOver] = useState(false);

  // The `plugins` array is memoized with [] deps on purpose — rebuilding it remounts MDXEditor
  // and loses the caret — so the toolbar can't close over `images` directly (it would freeze at
  // its first-render value and never show the busy state). Bounce through a ref that each render
  // refreshes, and re-render the toolbar on `busy` via the state below.
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Paste and drop are handled by imagePlugin's own Lexical listeners (which call our
  // imageUploadHandler), so nothing is intercepted here — doing both would upload twice and
  // insert the image twice. These handlers only drive the drop-target affordance.
  const onDrop = useCallback(() => setDragOver(false), []);

  // dragover must be cancelled for a drop to fire at all; only claim the event when the drag
  // actually carries files, so dragging TEXT within the note still works normally.
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    setDragOver(true);
  }, []);

  // ── selection tracking → floating pill ───────────────────────────────────────
  const editorContains = (node: Node | null) =>
    !!node && !!rootRef.current?.querySelector('[contenteditable="true"]')?.contains(node);

  const refreshSelection = useCallback(() => {
    if (scoped || whole || pillFrozenRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setPill(null); return; }
    const range = sel.getRangeAt(0);
    if (!editorContains(range.commonAncestorContainer)) { setPill(null); return; }
    const text = sel.toString();
    if (!text.trim()) { setPill(null); return; }
    selectionRef.current = { text, range: range.cloneRange() };
    const rect = range.getBoundingClientRect();
    setPill({ left: Math.max(8, rect.right - 84), top: rect.top - 34 });
  }, [scoped, whole]);

  useEffect(() => {
    document.addEventListener('selectionchange', refreshSelection);
    return () => document.removeEventListener('selectionchange', refreshSelection);
  }, [refreshSelection]);

  const restoreRange = (range: Range | null) => {
    const ce = rootRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
    ce?.focus();
    if (range) {
      const sel = window.getSelection();
      try { sel?.removeAllRanges(); sel?.addRange(range); } catch { /* stale range */ }
    }
  };

  // ── run a scoped AI edit (selection or insert) ───────────────────────────────
  // A `selection` run returns the WHOLE rewritten note (see buildMessage) and lands in the diff
  // overlay, so the user sees precisely which lines moved. `insert` still returns just the new
  // snippet and keeps the compact ReviewCard.
  const runScoped = useCallback(async (scope: Exclude<AiScope, 'whole'>, instruction: string, original: string, range: Range | null) => {
    setPill(null);
    const current = editorRef.current?.getMarkdown() ?? safeBody;
    if (scope !== 'selection') setScoped({ scope, original, range, instruction, candidate: null });
    setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'user', content: instruction, timestamp: Date.now() }]);
    const res = await ai.run({ scope, instruction, sourceText: original, noteContext: current });
    if (!res) { setScoped(null); return; }
    setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'assistant', content: res.candidate, candidateText: res.candidate, timestamp: Date.now() }]);
    if (scope === 'selection') {
      const parts = diffLines(current, res.candidate);
      const hunks = buildHunks(parts);
      if (hunks.length === 0) { ai.setError('The model returned the note unchanged.'); return; }
      setWhole({ before: current, after: res.candidate, parts, hunks });
      return;
    }
    setScoped((s) => (s ? { ...s, candidate: res.candidate } : null));
  }, [ai, safeBody]);

  // ── element edits (table / rich block / image) ───────────────────────────────
  // These cannot go through the selection route: a table's rendered selection doesn't match its
  // markdown, and a rich block's content never enters the page selection at all. Instead we look
  // the element up by ordinal, hand the model just that element's SOURCE, and splice the reply
  // back over the same character range — so the rest of the note is untouched by construction.
  // Review still happens in the normal diff overlay.
  const runElement = useCallback(async (
    kind: NoteElementKind, ordinal: number, instruction: string, src?: string,
  ) => {
    // Images resolve by src; everything else by ordinal. See imageElement for why.
    const locate = (md: string) => (kind === 'image' && src
      ? imageElement(md, src, ordinal)
      : nthElement(md, kind, ordinal));
    const current = editorRef.current?.getMarkdown() ?? safeBody;
    const el = locate(current);
    if (!el) { ai.setError('Could not find that element in the note — try again.'); return; }

    setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'user', content: instruction, timestamp: Date.now() }]);
    const res = await ai.run({
      scope: 'element', instruction, sourceText: el.source, noteContext: current,
    });
    if (!res) return;

    // Re-locate before splicing: the note may have been edited while the model was streaming,
    // which would make the offsets captured above stale.
    const latest = editorRef.current?.getMarkdown() ?? current;
    const target = locate(latest);
    if (!target) { ai.setError('That element changed while the edit was running — try again.'); return; }

    // Models habitually wrap a reply in a ``` fence even when told not to (useAiEdit strips this
    // for the other scopes too). For a table or an image that fence would turn the element into
    // a code block; for a fenced BLOCK the fence is the element, so it must be left alone.
    let replacement = res.candidate.trim();
    if (kind === 'block') {
      // The reverse hazard: a block reply that came back as bare content would delete the fence
      // and dissolve the block into prose. Re-wrap it in the element's own fence + language.
      if (!/^(`{3,}|~{3,})/.test(replacement)) {
        const lang = /^[ \t]*(?:`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]*)/.exec(target.source)?.[1] ?? '';
        replacement = `\`\`\`${lang}\n${replacement}\n\`\`\``;
      }
    } else {
      const unwrapped = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(replacement);
      if (unwrapped) replacement = unwrapped[1];
    }

    const after = replaceElement(latest, target, replacement);
    setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'assistant', content: res.candidate, candidateText: res.candidate, timestamp: Date.now() }]);
    const parts = diffLines(latest, after);
    const hunks = buildHunks(parts);
    if (hunks.length === 0) { ai.setError('The model returned it unchanged.'); return; }
    setWhole({ before: latest, after, parts, hunks });
  }, [ai, safeBody]);

  // Only `insert` reaches here now — selection edits go through the diff overlay.
  const applyScoped = useCallback(() => {
    if (!scoped?.candidate) return;
    const current = editorRef.current?.getMarkdown() ?? safeBody;
    // Append at the end of the note: the cursor position isn't reliably tracked across the
    // review round-trip, so a deterministic spot beats guessing at one.
    const next = current.replace(/\s*$/, '') + '\n\n' + scoped.candidate + '\n';
    editorRef.current?.setMarkdown(next);
    latestRef.current = next;
    onChange(next);
    setHistory((h) => h.map((e, i) => (i === h.length - 1 ? { ...e, outcome: 'applied' } : e)));
    setScoped(null);
  }, [scoped, safeBody, onChange]);

  const refineScoped = useCallback((instruction: string) => {
    if (!scoped) return;
    // Refine the ALREADY-refined text so the user's follow-up compounds.
    runScoped(scoped.scope, instruction, scoped.candidate ?? scoped.original, scoped.range);
  }, [scoped, runScoped]);

  // ── whole-note improve ───────────────────────────────────────────────────────
  const [wholeBarOpen, setWholeBarOpen] = useState(false);
  const [wholeInstruction, setWholeInstruction] = useState('');

  // ── custom scoped prompt ("Write with AI here…" / "Enhance selection…") ───────
  // The instruction is typed OR dictated into an inline bar (Electron has no
  // window.prompt). `verb` labels the run button; `defaultInstruction` fills in when
  // the user submits an empty bar (so "Continue writing" works by voice or one Enter).
  const [custom, setCustom] = useState<{
    scope: Exclude<AiScope, 'whole'>; text: string; range: Range | null;
    placeholder: string; verb: string; defaultInstruction?: string;
  } | null>(null);
  const [customInstruction, setCustomInstruction] = useState('');
  const dictation = useDictation();
  const customTaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the instruction textarea to fit its content (bounded), so a long typed or
  // dictated instruction is fully visible instead of scrolling in a one-line field.
  const autosizeCustom = useCallback(() => {
    const ta = customTaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, []);
  useEffect(() => { autosizeCustom(); }, [customInstruction, custom, autosizeCustom]);

  // Live dictation → the instruction field. The partial shows in a row ABOVE the input as
  // it streams; on stop, the final transcript is appended to whatever was already typed.
  const toggleMic = useCallback(async () => {
    if (dictation.recording) {
      const text = await dictation.stop();
      if (text) setCustomInstruction((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
    } else {
      dictation.start();
    }
  }, [dictation]);

  const submitCustom = useCallback(() => {
    if (!custom) return;
    const instr = customInstruction.trim() || custom.defaultInstruction;
    if (!instr) return;
    pillFrozenRef.current = false;
    if (dictation.recording) dictation.stop().catch(() => {});
    const c = custom;
    setCustom(null); setCustomInstruction('');
    runScoped(c.scope, instr, c.text, c.range);
  }, [custom, customInstruction, runScoped, dictation]);
  const cancelCustom = useCallback(() => {
    pillFrozenRef.current = false;
    if (dictation.recording) dictation.stop().catch(() => {});
    setCustom(null); setCustomInstruction('');
  }, [dictation]);

  const runWhole = useCallback(async (instruction: string) => {
    const current = editorRef.current?.getMarkdown() ?? safeBody;
    setWholeBarOpen(false);
    setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'user', content: instruction, timestamp: Date.now() }]);
    const res = await ai.run({ scope: 'whole', instruction, sourceText: current, noteContext: current });
    if (!res) return;
    const parts = diffLines(current, res.candidate);
    const hunks = buildHunks(parts);
    setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'assistant', content: res.candidate, candidateText: res.candidate, timestamp: Date.now() }]);
    if (hunks.length === 0) return; // no change
    setWhole({ before: current, after: res.candidate, parts, hunks });
  }, [ai, safeBody]);

  const setHunkState = (id: string, state: Hunk['state']) =>
    setWhole((w) => (w ? { ...w, hunks: w.hunks.map((h) => (h.id === id ? { ...h, state } : h)) } : w));

  const applyWhole = useCallback(() => {
    if (!whole) return;
    const merged = mergeHunks(whole.parts, whole.hunks);
    editorRef.current?.setMarkdown(merged);
    latestRef.current = merged;
    onChange(merged);
    setHistory((h) => h.map((e, i) => (i === h.length - 1 ? { ...e, outcome: 'applied' } : e)));
    // Only the ACCEPTED hunks landed — say so, rather than implying the whole proposal did.
    // The model is told the same thing, so a follow-up doesn't assume rejected edits are in.
    const accepted = whole.hunks.filter((h) => h.state === 'accepted').length;
    const total = whole.hunks.length;
    const partial = accepted > 0 && accepted < total;
    stampTurn(pendingTurnRef.current, {
      outcome: accepted === 0 ? 'discarded' : 'applied',
      pending: false,
      candidate: undefined,
      text: accepted === 0
        ? `Proposed ${total} change${total === 1 ? '' : 's'} — none kept.`
        : partial
          ? `Kept ${accepted} of ${total} changes.`
          : `Applied ${total} change${total === 1 ? '' : 's'}.`,
    });
    if (pendingTurnRef.current) {
      convoRef.current = [...convoRef.current, {
        role: 'user',
        content: accepted === 0
          ? 'I rejected all of those changes.'
          : partial
            ? `I kept ${accepted} of those ${total} changes and rejected the rest.`
            : 'I applied those changes.',
      }];
    }
    pendingTurnRef.current = null;
    setWhole(null);
  }, [whole, onChange, stampTurn]);

  // ── the conversation panel's own run ─────────────────────────────────────────
  // Always whole-note scope: the panel is about the note as a whole, and the model gets the
  // running conversation so a follow-up compounds instead of starting over.
  const runConversation = useCallback(async (instruction: string) => {
    const current = editorRef.current?.getMarkdown() ?? safeBody;
    const gen = convoGenRef.current;
    addTurn({ role: 'user', text: instruction, target: 'whole note' });
    const priorHistory = convoRef.current.slice();
    convoRef.current = [...priorHistory, { role: 'user', content: instruction }];

    setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'user', content: instruction, timestamp: Date.now() }]);
    const res = await ai.run({
      scope: 'whole', instruction, sourceText: current, noteContext: current,
      history: priorHistory,
    });
    // Cleared while this was in flight — the thread it belonged to is gone.
    if (gen !== convoGenRef.current) return;
    if (!res) {
      // ai.run already surfaced the reason (error or user cancel) — record the outcome so
      // the thread doesn't just stop mid-sentence.
      addTurn({ role: 'assistant', text: 'No changes were produced.', scope: 'whole', outcome: ai.error ? 'error' : 'cancelled' });
      return;
    }

    const parts = diffLines(current, res.candidate);
    const hunks = buildHunks(parts);
    setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'assistant', content: res.candidate, candidateText: res.candidate, timestamp: Date.now() }]);

    if (hunks.length === 0) {
      convoRef.current = [...convoRef.current, { role: 'assistant', content: 'I returned the note unchanged.' }];
      addTurn({ role: 'assistant', text: 'Returned the note unchanged.', scope: 'whole', outcome: 'no-change' });
      return;
    }

    convoRef.current = [...convoRef.current, {
      role: 'assistant',
      content: `I proposed ${hunks.length} change${hunks.length === 1 ? '' : 's'} to the note for that request.`,
    }];
    const turnId = addTurn({
      role: 'assistant', scope: 'whole', changeCount: hunks.length, pending: true,
      candidate: res.candidate,
      text: `Proposed ${hunks.length} change${hunks.length === 1 ? '' : 's'}.`,
    });
    pendingTurnRef.current = turnId;
    setWhole({ before: current, after: res.candidate, parts, hunks });
  }, [ai, safeBody, addTurn]);

  // Reopen a proposal the user closed without deciding. The candidate is re-diffed against
  // the note as it is NOW, not as it was: the user may have typed in between, and showing a
  // stale diff would offer to apply changes against text that no longer exists.
  const reopenTurn = useCallback((turnId: string) => {
    const turn = turns.find((x) => x.id === turnId);
    if (!turn?.candidate) return;
    const current = editorRef.current?.getMarkdown() ?? safeBody;
    const parts = diffLines(current, turn.candidate);
    const hunks = buildHunks(parts);
    if (hunks.length === 0) {
      stampTurn(turnId, { outcome: 'no-change', pending: false });
      if (pendingTurnRef.current === turnId) pendingTurnRef.current = null;
      return;
    }
    pendingTurnRef.current = turnId;
    setWhole({ before: current, after: turn.candidate, parts, hunks });
  }, [turns, safeBody, stampTurn]);

  const clearConversation = useCallback(() => {
    // Stop any run still streaming, and drop the proposal it was heading for. Without this
    // the in-flight turn lands moments later and repopulates the thread the user just
    // emptied — and its diff would review a conversation that no longer exists.
    convoGenRef.current += 1;
    if (ai.streaming) ai.cancel();
    setWhole(null);
    setTurns([]);
    convoRef.current = [];
    pendingTurnRef.current = null;
  }, [ai]);

  // ── right-click menu ─────────────────────────────────────────────────────────
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    const ce = rootRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!ce || !ce.contains(e.target as Node)) return; // let the toolbar / chrome use native menu
    e.preventDefault();
    const sel = window.getSelection();
    const hasSelection = !!sel && !sel.isCollapsed && !!sel.toString().trim();
    if (hasSelection && sel) selectionRef.current = { text: sel.toString(), range: sel.getRangeAt(0).cloneRange() };
    setPill(null);
    setMenu({ x: e.clientX, y: e.clientY, hasSelection });
  }, []);

  const onMenuPick = useCallback((req: AiMenuRequest) => {
    const { text, range } = selectionRef.current;
    // Free-form ("Write with AI here…", "Enhance selection…") and voice-friendly items
    // ("Continue writing") open the inline instruction bar so you can type OR dictate.
    // (Electron's BrowserWindow has no window.prompt(), so a bar is required regardless.)
    // Freeze the captured selection/range so it survives while the bar holds focus.
    if (req.openCustom || req.dictatable) {
      pillFrozenRef.current = true;
      setCustom({
        scope: req.scope,
        text: req.scope === 'insert' ? '' : text,
        range,
        placeholder: req.scope === 'insert' ? 'What should I write here? (type or dictate)' : 'How should this change? (type or dictate)',
        verb: req.scope === 'insert' ? 'Write' : 'Enhance',
        // A preset like "Continue writing" runs even if the bar is left empty.
        defaultInstruction: req.openCustom ? undefined : req.instruction,
      });
      setCustomInstruction('');
      return;
    }
    runScoped(req.scope, req.instruction, req.scope === 'insert' ? '' : text, range);
  }, [runScoped]);

  const onClipboard = useCallback((cmd: 'cut' | 'copy' | 'paste') => {
    restoreRange(selectionRef.current.range);
    document.execCommand(cmd);
  }, []);

  // ── ⌘S save is handled by the parent; here we only stop it reaching the browser
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        // Let it bubble to NoteEditor's onKeyDown (which saves); just prevent the
        // browser's Save dialog.
        e.preventDefault();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  }, []);

  const plugins = useMemo(() => [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    markdownShortcutPlugin(),
    // The rich blocks (diagram, timeline, kanban, …) are ordinary fenced code blocks with a
    // custom language, claimed here by a descriptor that renders them live. Anything not matched
    // falls through to CodeMirror as plain source — so a note stays plain markdown on disk and
    // still opens in an editor that has never heard of these languages.
    codeBlockPlugin({
      defaultCodeBlockLanguage: '',
      codeBlockEditorDescriptors: RICH_BLOCK_DESCRIPTORS,
    }),
    codeMirrorPlugin({
      codeBlockLanguages: {
        // `mermaid` is deliberately absent: the diagram descriptor claims it, and listing it
        // here too would offer a second, conflicting editor for the same language.
        '': 'Plain text', js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript (React)',
        python: 'Python', bash: 'Bash', sh: 'Shell', json: 'JSON', yaml: 'YAML',
        css: 'CSS', html: 'HTML', sql: 'SQL', md: 'Markdown',
      },
    }),
    // Without this, MDXEditor has no node for `![alt](path)` and refuses to parse the note
    // ("Parsing of the following markdown structure failed: image"), dropping it into source
    // mode. The two handlers keep images working under our storage + auth model:
    //  • upload — paste/drop/picker inside Lexical routes here, storing the file in the bundle
    //    and returning the RELATIVE path, so what lands in the markdown stays portable;
    //  • preview — the editor is showing that relative path, which the browser would resolve
    //    against the page origin, so map it to the backend asset URL (with the token, since an
    //    <img> can't carry an Authorization header) purely for display.
    imagePlugin({
      imageUploadHandler: async (file: File) => {
        const saved = await api.uploadKnowledgeAsset(file.name || 'image', await file.arrayBuffer());
        return saved.path;
      },
      // Drop any `#w=…&h=…` fragment before resolving: it encodes the display size for the
      // viewer (see htmlImagesToMarkdown), and is not part of the stored filename.
      imagePreviewHandler: async (src: string) => {
        const path = src.split('#')[0];
        return /^(https?:|data:|blob:)/i.test(path)
          ? path
          : api.knowledgeAssetUrl(path.replace(/^\.?\//, ''));
      },
      disableImageSettingsButton: true,
      // Our own floating toolbar: MDXEditor's default offers only delete once the settings
      // dialog is disabled, and alignment belongs right there on the selected image.
      EditImageToolbar: ImageAlignToolbar,
    }),
    tablePlugin(),
    // Must come AFTER tablePlugin: both bind Enter in a cell at CRITICAL priority, and
    // the later registration is consulted first (see tableCellBreakPlugin).
    tableCellBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin(),
    diffSourcePlugin({ viewMode: 'rich-text' }),
    toolbarPlugin({
      toolbarContents: () => (
        <>
          <UndoRedo />
          <Separator />
          <BlockTypeSelect />
          <Separator />
          <BoldItalicUnderlineToggles />
          <Separator />
          <ListsToggle />
          <Separator />
          <CreateLink />
          <NoteLinkButton
            onInsert={(md) => editorRef.current?.insertMarkdown(md)}
            selectedText={() => window.getSelection()?.toString() ?? ''}
          />
          {/* Reads `busy` from the shared store rather than a prop: this toolbar is built once
              (see the plugins memo) and would otherwise never re-render to show progress. */}
          <InsertImageButton
            onFiles={(files) => void imagesRef.current.uploadFiles(files)}
            onUrl={(url, alt) => imagesRef.current.insertUrl(url, alt)}
          />
          <InsertTable />
          <InsertCodeBlock />
          <InsertThematicBreak />
          <InsertMoreButton />
          <Separator />
          <button
            type="button"
            title="Improve the whole note with AI"
            data-toolbar-item="true"
            onMouseDown={(e) => { e.preventDefault(); setWholeInstruction(''); setWholeBarOpen(true); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 5,
              background: `color-mix(in oklch, ${t.accent} 12%, transparent)`,
              border: `0.5px solid ${t.accent}`, color: t.accentInk,
              cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 600,
            }}
          >
            <Icon name="sparkle" size={12} color={t.accent} /> Improve note
          </button>
          <Separator />
          <ConditionalContents
            options={[
              { when: (e) => e?.editorType === 'codeblock', contents: () => <ChangeCodeMirrorLanguage /> },
              { fallback: () => <DiffSourceToggleWrapper><span /></DiffSourceToggleWrapper> },
            ]}
          />
        </>
      ),
    }),
  ], []);

  // The bottom "Improving note…" strip is for runs started from the TOOLBAR. A run driven by
  // the conversation panel streams in the panel instead, so it must not also claim the strip.
  const wholeStreaming = ai.streaming && !scoped && !whole && !aiPanelOpen;

  const editorSurface = (
    <div ref={setRoot} className="cl-mdx" style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      onContextMenu={onContextMenu}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
    >
      <MDXEditor
        ref={editorRef}
        markdown={safeBody}
        onChange={handleChange}
        plugins={plugins}
        autoFocus={autoFocus}
        overlayContainer={overlayEl}
        contentEditableClassName="cl-mdx-content"
      />

      {/* Drop affordance — only while a file drag is actually over the editor. */}
      {dragOver && (
        <div style={{
          position: 'absolute', inset: 8, zIndex: 54, borderRadius: 10, pointerEvents: 'none',
          border: `1.5px dashed ${t.accent}`,
          background: `color-mix(in oklch, ${t.accent} 7%, transparent)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: t.accentInk,
        }}>
          Drop image to add it to this note
        </div>
      )}

      {/* Image upload error — a rejected paste is otherwise silent, and the user would
          reasonably think the app just lost their screenshot. */}
      {images.error && (
        <div style={{
          position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 56,
          padding: '8px 14px', borderRadius: 8, background: 'oklch(0.55 0.18 25)', color: 'white',
          fontFamily: 'Inter, sans-serif', fontSize: 12, display: 'flex', gap: 10, alignItems: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        }}>
          {images.error}
          <button type="button" title="Dismiss" aria-label="Dismiss error" onClick={images.clearError}
            style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>
            <Icon name="x" size={12} color="white" />
          </button>
        </div>
      )}

      {/* AI error toast */}
      {ai.error && (
        <div style={{
          position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 55,
          padding: '8px 14px', borderRadius: 8, background: 'oklch(0.55 0.18 25)', color: 'white',
          fontFamily: 'Inter, sans-serif', fontSize: 12, display: 'flex', gap: 10, alignItems: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        }}>
          {ai.error}
          <button type="button" title="Dismiss" aria-label="Dismiss error" onClick={ai.clearError} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>
            <Icon name="x" size={12} color="white" />
          </button>
        </div>
      )}

      {/* whole-note instruction bar */}
      {wholeBarOpen && (
        <div style={{ padding: '10px 14px', borderTop: `0.5px solid ${t.hair}`, background: t.bgRaised, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon name="sparkle" size={12} color={t.accent} />
          <input
            autoFocus
            value={wholeInstruction}
            onChange={(e) => setWholeInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && wholeInstruction.trim()) { e.preventDefault(); runWhole(wholeInstruction.trim()); }
              if (e.key === 'Escape') { setWholeBarOpen(false); setWholeInstruction(''); }
            }}
            placeholder="How should the whole note be improved? (default: tighten writing, fix structure, keep all facts & links)"
            style={{ flex: 1, height: 30, padding: '0 12px', borderRadius: 6, border: `0.5px solid ${t.hair}`, background: t.bg, fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: t.ink, outline: 'none' }}
          />
          <button type="button" onClick={() => runWhole(wholeInstruction.trim() || 'Tighten the writing and fix the structure. Keep every fact and every link exactly as-is.')}
            style={{ height: 30, padding: '0 14px', borderRadius: 6, border: 'none', background: t.accent, color: 'white', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Run</button>
          <button type="button" onClick={() => { setWholeBarOpen(false); setWholeInstruction(''); }}
            style={{ height: 30, padding: '0 12px', borderRadius: 6, border: `0.5px solid ${t.hair}`, background: 'transparent', color: t.inkSoft, fontFamily: 'Inter, sans-serif', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
        </div>
      )}

      {/* custom scoped prompt bar — type or dictate the instruction. Used by
          "Write with AI here…", "Enhance selection…", and "Continue writing (or dictate)…". */}
      {custom && (() => {
        // The field shows what's committed; while recording, the live partial is appended
        // read-only after it so you see words land as you speak (committed on stop).
        const canRun = !!(customInstruction.trim() || custom.defaultInstruction);
        return (
          <div style={{ padding: '10px 14px', borderTop: `0.5px solid ${t.hair}`, background: t.bgRaised, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* live transcription — full-width, above the input; wraps instead of overflowing */}
            {dictation.recording && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '6px 10px', borderRadius: 6, background: 'color-mix(in oklch, oklch(0.55 0.18 25) 8%, transparent)', border: '0.5px solid color-mix(in oklch, oklch(0.55 0.18 25) 30%, transparent)' }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: 'oklch(0.55 0.18 25)', flex: 'none', marginTop: 5 }} className="an-pulse" />
                <span style={{ flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 11.5, lineHeight: 1.5, color: dictation.transcript ? t.inkSoft : t.muted, fontStyle: dictation.transcript ? 'normal' : 'italic', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflowY: 'auto' }}>
                  {dictation.transcript || 'Listening…'}
                </span>
              </div>
            )}
            {/* input row */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Icon name="sparkle" size={12} color={t.accent} />
              <textarea
                ref={customTaRef}
                autoFocus
                rows={1}
                value={customInstruction}
                onChange={(e) => setCustomInstruction(e.target.value)}
                onInput={autosizeCustom}
                onKeyDown={(e) => {
                  // Enter submits; Shift+Enter inserts a newline (multi-line instructions).
                  if (e.key === 'Enter' && !e.shiftKey && canRun) { e.preventDefault(); submitCustom(); }
                  if (e.key === 'Escape') { e.preventDefault(); cancelCustom(); }
                }}
                placeholder={custom.placeholder}
                style={{ flex: 1, minHeight: 30, maxHeight: 160, padding: '6px 12px', borderRadius: 6, border: `0.5px solid ${dictation.recording ? t.accent : t.hair}`, background: t.bg, fontFamily: 'Inter, sans-serif', fontSize: 12.5, lineHeight: 1.4, color: t.ink, outline: 'none', resize: 'none', overflowY: 'auto' }}
              />
              <button
                type="button" onMouseDown={(e) => e.preventDefault()} onClick={toggleMic}
                title={dictation.recording ? 'Stop dictation' : 'Dictate the instruction'}
                style={{ height: 30, width: 30, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 6, border: `0.5px solid ${dictation.recording ? 'transparent' : t.hair}`, background: dictation.recording ? 'oklch(0.55 0.18 25)' : 'transparent', color: dictation.recording ? 'white' : t.inkSoft, cursor: 'pointer' }}
              >
                <Icon name="mic" size={14} color={dictation.recording ? 'white' : t.inkSoft} />
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={submitCustom} disabled={!canRun}
                style={{ height: 30, flex: 'none', padding: '0 14px', borderRadius: 6, border: 'none', background: t.accent, color: 'white', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, cursor: canRun ? 'pointer' : 'default', opacity: canRun ? 1 : 0.5 }}>
                {custom.verb}
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={cancelCustom}
                style={{ height: 30, flex: 'none', padding: '0 12px', borderRadius: 6, border: `0.5px solid ${t.hair}`, background: 'transparent', color: t.inkSoft, fontFamily: 'Inter, sans-serif', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* whole-note streaming indicator (before the diff is ready) */}
      {wholeStreaming && (
        <div style={{ padding: '10px 14px', borderTop: `0.5px solid ${t.hair}`, background: t.bgRaised, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: t.muted }}>✦ Improving note…</span>
          <div style={{ flex: 1, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ai.preview.slice(-120)}</div>
          <button type="button" onClick={ai.cancel} style={{ height: 26, padding: '0 12px', borderRadius: 5, border: 'none', background: 'oklch(0.55 0.18 25)', color: 'white', fontFamily: 'Inter, sans-serif', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>Stop</button>
        </div>
      )}

      {/* selection pill */}
      {pill && !scoped && !whole && !menu && !ai.streaming && (
        <SelectionPill
          left={pill.left}
          top={pill.top}
          onOpenChange={(open) => { pillFrozenRef.current = open; }}
          onInstruction={(instr) => {
            pillFrozenRef.current = false;
            const { text, range } = selectionRef.current;
            if (text.trim()) runScoped('selection', instr, text, range);
          }}
        />
      )}

      {/* AI handle for a hovered table / rich block / image. Hidden while a text selection is
          active so it can't compete with the selection pill for the same click. */}
      {hoveredElement && !pill && !scoped && !whole && !menu && !ai.streaming && (
        <ElementAiButton
          left={hoveredElement.left}
          top={hoveredElement.top}
          kind={hoveredElement.kind}
          label={(() => {
            const md = editorRef.current?.getMarkdown() ?? safeBody;
            const el = hoveredElement.kind === 'image' && hoveredElement.src
              ? imageElement(md, hoveredElement.src, hoveredElement.ordinal)
              : nthElement(md, hoveredElement.kind, hoveredElement.ordinal);
            return el ? describeElement(el) : 'this element';
          })()}
          onOpenChange={setElementMenuOpen}
          onInstruction={(instr) => {
            setElementMenuOpen(false);
            runElement(hoveredElement.kind, hoveredElement.ordinal, instr, hoveredElement.src);
          }}
        />
      )}

      {/* right-click menu */}
      {menu && (
        <EditorContextMenu
          x={menu.x} y={menu.y} hasSelection={menu.hasSelection}
          onPick={onMenuPick}
          onClose={() => setMenu(null)}
          onClipboard={onClipboard}
        />
      )}

      {/* scoped review (selection / insert) */}
      {scoped && (scoped.candidate !== null || ai.streaming) && (
        <ReviewCard
          scope={scoped.scope}
          original={scoped.original}
          refined={scoped.candidate ?? ''}
          streaming={ai.streaming}
          streamPreview={ai.preview}
          onApply={applyScoped}
          onRefine={refineScoped}
          onDiscard={() => { setScoped(null); ai.cancel(); }}
          onCancelStream={() => { ai.cancel(); setScoped(null); }}
        />
      )}

      {/* whole-note review.
          Anchored to the whole EDITING AREA (editor + rails), not to this column: the diff
          is two side-by-side columns of source, and with the AI and Properties rails open
          the column left here is far too narrow to read one (583px in a 1500px window).
          Measured rather than styled, because the rails open and close independently. */}
      {whole && (
        <div style={reviewBox}>
          <DiffOverlay
            hunks={whole.hunks}
            parts={whole.parts}
            pendingCount={whole.hunks.filter((h) => h.state === 'pending').length}
            history={history}
            streaming={false}
            streamPreview=""
            onAccept={(id) => setHunkState(id, 'accepted')}
            onReject={(id) => setHunkState(id, 'rejected')}
            onAcceptAll={() => setWhole((w) => (w ? { ...w, hunks: w.hunks.map((h) => ({ ...h, state: 'accepted' as const })) } : w))}
            onRejectAll={() => setWhole((w) => (w ? { ...w, hunks: w.hunks.map((h) => ({ ...h, state: 'rejected' as const })) } : w))}
            onApply={applyWhole}
            onDiscard={() => {
              // Discarding from the overlay is a decision, so the receipt settles here.
              // (Closing the panel or navigating away is NOT — that leaves it reopenable.)
              if (pendingTurnRef.current) {
                convoRef.current = [...convoRef.current, { role: 'user', content: 'I discarded those changes.' }];
              }
              settlePending('discarded');
              setWhole(null);
            }}
            onRefine={(instr) => {
              setWhole(null);
              // A refine from the diff continues the SAME conversation when the panel is
              // driving it, so the thread stays the single record of what was asked.
              if (pendingTurnRef.current) {
                stampTurn(pendingTurnRef.current, { outcome: 'discarded', pending: false, candidate: undefined });
                pendingTurnRef.current = null;
                convoRef.current = [...convoRef.current, { role: 'user', content: 'Not quite — let me refine that.' }];
                runConversation(instr);
                return;
              }
              runWhole(instr);
            }}
            onCancelStream={ai.cancel}
          />
        </div>
      )}
    </div>
  );

  // The editor and its AI rail sit side by side; the rail is a sibling, not an overlay, so
  // the writing surface simply narrows instead of being covered while you converse.
  if (!aiPanelOpen) {
    return <div ref={shellRef} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex' }}>{editorSurface}</div>;
  }
  return (
    <div ref={shellRef} style={{ flex: 1, minHeight: 0, display: 'flex', minWidth: 0 }}>
      {editorSurface}
      <AiConversationPanel
        turns={turns}
        streaming={ai.streaming && !scoped}
        streamPreview={ai.preview}
        hasAgent={ai.hasAgent}
        error={ai.error}
        onSend={runConversation}
        onCancel={ai.cancel}
        onReopen={reopenTurn}
        onClear={clearConversation}
        onClose={() => onAiPanelOpenChange?.(false)}
        onDismissError={ai.clearError}
      />
    </div>
  );
}
