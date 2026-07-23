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
  codeBlockPlugin, codeMirrorPlugin, tablePlugin, linkPlugin, linkDialogPlugin,
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
import { InsertMoreButton } from './blocks/InsertMoreButton';

// Each claims one fenced-code language and renders it as a live block.
const RICH_BLOCK_DESCRIPTORS = [
  mermaidCodeBlockDescriptor, tabViewCodeBlockDescriptor, calendarCodeBlockDescriptor,
  chartCodeBlockDescriptor, diffChartCodeBlockDescriptor, timelineCodeBlockDescriptor,
  mindMapCodeBlockDescriptor, waterfallCodeBlockDescriptor, sankeyCodeBlockDescriptor,
  kanbanCodeBlockDescriptor, apiSpecCodeBlockDescriptor,
];
import { useDictation } from '../../../hooks/useDictation';
import { useAiEdit, type AiScope } from './useAiEdit';
import { SelectionPill } from './SelectionPill';
import { EditorContextMenu, type AiMenuRequest } from './EditorContextMenu';
import { ReviewCard } from './ReviewCard';
import { NoteLinkButton } from './NoteLinkButton';
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
  body, onChange, autoFocus,
}: {
  body: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  const editorRef = useRef<MDXEditorMethods>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const ai = useAiEdit();

  // Notes are plain CommonMark (written by agents and by hand) but MDXEditor parses MDX, where
  // `<` opens a JSX tag and `{` an expression. An autolink like <https://x.com> — valid markdown —
  // otherwise fails to parse and the editor shows a red error instead of the note. Rewrite those
  // few constructs into MDX-safe equivalents; code blocks are left byte-for-byte alone.
  const safeBody = useMemo(() => toMdxSafe(body), [body]);

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

  // ── change handling ──────────────────────────────────────────────────────────
  // Pull the editor's live markdown and propagate if it differs from what we last
  // saw. The `firstChangeRef` guard skips MDXEditor's post-mount normalization pass
  // (it re-serializes the AST once, which can differ harmlessly from `body`).
  const syncMarkdown = useCallback((md: string) => {
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
      }, 200);
    });
    obs.observe(el, { childList: true, subtree: true, characterData: true });
    return () => { if (timer) clearTimeout(timer); obs.disconnect(); };
  }, [syncMarkdown]);

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
    setWhole(null);
  }, [whole, onChange]);

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
    tablePlugin(),
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

  const wholeStreaming = ai.streaming && !scoped && !whole;

  // Portal MDXEditor's popovers (link dialog, block-type menu) INTO the `.cl-mdx`
  // root instead of document.body — otherwise they escape our scoped styling and
  // render with MDXEditor's default (oversized) icons and chrome.
  const [overlayEl, setOverlayEl] = useState<HTMLElement | null>(null);
  const setRoot = useCallback((el: HTMLDivElement | null) => {
    rootRef.current = el;
    setOverlayEl(el);
  }, []);

  return (
    <div ref={setRoot} className="cl-mdx" style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      onContextMenu={onContextMenu}
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

      {/* whole-note review */}
      {whole && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
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
            onDiscard={() => setWhole(null)}
            onRefine={(instr) => { setWhole(null); runWhole(instr); }}
            onCancelStream={ai.cancel}
          />
        </div>
      )}
    </div>
  );
}
