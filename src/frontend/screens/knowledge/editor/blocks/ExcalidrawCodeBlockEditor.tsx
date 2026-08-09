/** Hand-drawn diagrams (Excalidraw) as a fenced ```excalidraw block.
 *
 * Why a fence and not an attachment: the scene is JSON, so it round-trips through the markdown
 * file as readable text like every other rich block here — greppable, diffable, and portable with
 * the note. Storing it as an opaque binary under assets/ would make a diagram the one part of a
 * note that git can't show you a change to.
 *
 * Everything runs locally. The npm package bundles its own fonts (dist/prod/fonts/), so the
 * canvas makes no network request; the library browser and other CDN-backed side doors are turned
 * off explicitly in UIOptions below rather than left to default.
 *
 * ── The two things that are load-bearing ─────────────────────────────────────────────────────
 *
 * 1. `files` is stripped on save. Excalidraw stores pasted images INSIDE the scene as base64 data
 *    URIs. Letting those through would inline megabytes of binary into a markdown file — exactly
 *    what domain/knowledge_assets.py refuses to do, and it would blow past the note-size the
 *    editor can reopen. We drop them and tell the user, so the note stays text.
 *
 * 2. The read-only view renders EXPORTED SVG through the shared SvgBlock → DOMPurify path, not a
 *    live canvas. A note is rendered in chat answers and dashboard tiles too; mounting a 1 MB
 *    editable canvas in each of those is both slow and more surface than a viewer needs.
 */
import { useState, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from '@mdxeditor/editor';
import { useTheme } from './theme';
import { SourceTextarea } from './SourceTextarea';
import { BlockNameInput } from './BlockNameInput';
import { readTitle, stripTitle } from './blockTitle';
import { SvgBlock } from '../../../../components/SvgBlock';

// The canvas is ~1 MB gzipped. Loading it eagerly would put that on every Knowledge screen visit
// even for notes with no diagram, so the editor half is code-split and only fetched when a block
// actually mounts. The read-only path (exportToSvg) is likewise imported dynamically.
// The stylesheet is imported HERE rather than at module top level so it rides the same async
// chunk as the canvas — the package does not inject its own styles, and a static import would
// pull the whole sheet into the main bundle for every note that has no drawing in it.
const Excalidraw = lazy(async () => {
  const [mod] = await Promise.all([
    import('@excalidraw/excalidraw'),
    import('@excalidraw/excalidraw/index.css'),
  ]);
  return { default: mod.Excalidraw };
});

// ── Types ─────────────────────────────────────────────────────────────────────

/** The subset of an Excalidraw scene we persist. `files` is deliberately absent — see header. */
export interface ExcalidrawScene {
  type: 'excalidraw';
  version: number;
  source: string;
  elements: readonly unknown[];
  appState: Record<string, unknown>;
}

// A drawing canvas needs real room to be usable — the toolbar alone eats ~60px, so the old 420
// default left barely half a screen of drawable area.
const DEFAULT_H = 620;
const MIN_H = 180;
const MAX_H = 2000;
// Drag steps in whole pixels but commits on release; this is the grab strip's thickness.
const RESIZE_GRIP = 10;

// Display settings ride in a leading `#` comment, matching how the mermaid block stores its own
// (see MermaidCodeBlockEditor). JSON has no comment syntax, so this lives OUTSIDE the JSON and is
// stripped before parsing rather than being a field inside the scene.
//
// `m` is load-bearing: withTitle() prepends its own `# @title:` line, so on a NAMED drawing the
// directive is the SECOND line. Anchoring to the start of the string alone would read the height
// and alignment back as defaults the moment the user names the block.
const DIRECTIVE_RE = /^# cl:([^\n]*)\n?/m;
const H_KV = /height=(\d+)/;
const A_KV = /align=(left|center|right)/;

type Align = 'left' | 'center' | 'right';

const readDirective = (code: string) => code.match(DIRECTIVE_RE)?.[1] ?? '';
const readHeight = (code: string) => {
  const m = readDirective(code).match(H_KV);
  const n = m ? parseInt(m[1], 10) : DEFAULT_H;
  return Number.isFinite(n) ? Math.min(MAX_H, Math.max(MIN_H, n)) : DEFAULT_H;
};
const readAlign = (code: string): Align => (readDirective(code).match(A_KV)?.[1] as Align) ?? 'left';
const stripDirective = (code: string) => code.replace(DIRECTIVE_RE, '');

/** Rewrite the whole block: header lines in ONE canonical order, then the JSON.
 *
 * This is deliberately a single writer rather than composing `withTitle(withDirective(…))` the way
 * the other blocks do. Those two helpers each strip-and-PREPEND their own line, so nesting them
 * flips the order on every call — the directive would leapfrog the title line, and `withTitle`'s
 * `^`-anchored regex (no `m` flag) would then fail to see the existing title and prepend a SECOND
 * one. A few renames later the block accumulates stacked `# @title:` lines and stops parsing.
 * Composing from parsed values instead makes the output identical no matter what order the user
 * changes the name, height and alignment in. */
function writeBlock(json: string, title: string, h: number, a: Align): string {
  const parts = [`height=${h}`, ...(a !== 'left' ? [`align=${a}`] : [])];
  const name = title.trim().replace(/[\r\n]+/g, ' ');
  return [
    ...(name ? [`# @title: ${name}`] : []),
    `# cl:${parts.join(' ')}`,
    stripDirective(stripTitle(json)).trim(),
  ].join('\n');
}

// ── Parse / serialize ─────────────────────────────────────────────────────────

/** The scene, or null when the block is empty or the JSON doesn't parse.
 *
 * Returning null (rather than throwing or substituting an empty scene) is what lets every caller
 * fall back to showing the raw text: a half-typed or hand-mangled block stays readable and
 * recoverable instead of silently rendering as blank canvas that would overwrite it on save. */
export function parseExcalidrawScene(code: string): ExcalidrawScene | null {
  const body = stripDirective(stripTitle(code)).trim();
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.elements)) return null;
    return {
      type: 'excalidraw',
      version: typeof parsed.version === 'number' ? parsed.version : 2,
      source: typeof parsed.source === 'string' ? parsed.source : 'curry-leaves',
      elements: parsed.elements,
      appState: (parsed.appState && typeof parsed.appState === 'object') ? parsed.appState : {},
    };
  } catch {
    return null;
  }
}

/** Only the appState keys that describe the DRAWING. The live appState carries ~100 keys of
 * transient UI state (cursor position, open panels, current tool, selection, collaborators) that
 * would otherwise churn the note's diff on every click without changing what's rendered. */
function persistableAppState(appState: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof appState.viewBackgroundColor === 'string') out.viewBackgroundColor = appState.viewBackgroundColor;
  if (typeof appState.gridSize === 'number' || appState.gridSize === null) out.gridSize = appState.gridSize;
  return out;
}

/** Scene → the text stored in the fence. Pretty-printed because the whole point of keeping this
 * as JSON in the file is that a human (and `git diff`) can read it. */
export function serializeExcalidrawScene(
  elements: readonly unknown[],
  appState: Record<string, unknown>,
): string {
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'curry-leaves',
      elements,
      appState: persistableAppState(appState),
    },
    null,
    2,
  );
}

// ── Read-only rendering ───────────────────────────────────────────────────────

/** Render a scene as sanitized SVG.
 *
 * `exportToSvg` is async and pulls in the canvas bundle, so this renders nothing until it
 * resolves. Failure leaves `svg` null and the caller shows its fallback — a broken export must not
 * take the surrounding note down with it. */
export function ExcalidrawView({ scene, height, align }: {
  scene: ExcalidrawScene;
  height: number;
  align: Align;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const t = useTheme();

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const { exportToSvg } = await import('@excalidraw/excalidraw');
        const el = await exportToSvg({
          elements: scene.elements as never,
          appState: { ...scene.appState, exportBackground: false, exportWithDarkMode: t.name === 'dark' } as never,
          files: null,
          exportPadding: 8,
        });
        if (cancelled) return;
        // Scale the export to the block's height while keeping its aspect ratio.
        //
        // Removing width/height outright collapses the image to 0×0: an <svg> has no intrinsic
        // size, so with `height:auto` and no width there is nothing for the browser to resolve
        // against — inside a flex row it lays out at zero and the drawing silently disappears.
        // Derive a concrete width from the viewBox instead, and cap it so a wide drawing still
        // fits the column.
        const vb = (el.getAttribute('viewBox') || '').split(/\s+/).map(Number);
        const vw = vb.length === 4 && vb[2] > 0 ? vb[2] : 0;
        const vh = vb.length === 4 && vb[3] > 0 ? vb[3] : 0;
        el.removeAttribute('width');
        el.removeAttribute('height');
        el.setAttribute(
          'style',
          vw && vh
            ? `width:${Math.round(height * (vw / vh))}px;max-width:100%;height:auto;display:block`
            : `width:100%;height:${height}px;display:block`,
        );
        setSvg(el.outerHTML);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [scene, t.name, height]);

  // Readers get a lightbox too: a drawing sized to fit a note column is often too small to read,
  // and the viewer has no editor chrome to expand from. Escape or a click on the backdrop closes.
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(false); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [zoomed]);

  if (failed) return null;
  if (svg === null) {
    return <div style={{ height, background: t.bgSunken, borderRadius: 8 }} aria-label="Loading diagram" />;
  }

  // The lightbox copy, sized to the viewport instead of to the note column. Swapping the style
  // attribute we wrote above keeps ONE source of markup (already sanitized the same way).
  //
  // `width` must be a CONCRETE length, not `auto`: an <svg> carries no intrinsic size, so
  // width:auto + height:auto resolves to 0×0 and the drawing disappears. Giving it a vw width and
  // capping the height with `max-height` lets the viewBox's aspect ratio do the scaling — the
  // drawing grows to the screen without distorting.
  const zoomedSvg = svg.replace(
    /style="[^"]*"/,
    'style="width:88vw;height:auto;max-height:86vh;display:block;object-fit:contain"',
  );
  return (
    <>
      <div style={{
        display: 'flex',
        justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
      }}>
        <div
          style={{ maxWidth: '100%', position: 'relative', cursor: 'zoom-in' }}
          onClick={() => setZoomed(true)}
          title="Click to view full screen"
        >
          <SvgBlock source={svg} />
        </div>
      </div>

      {zoomed && createPortal(
        <div
          role="dialog"
          aria-label="Drawing, full screen"
          onMouseDown={() => setZoomed(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 9990,
            background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 32, cursor: 'zoom-out',
          }}
        >
          {/* The same sanitized markup, re-scaled to the viewport.
              The width is written into the markup rather than overridden with `w-auto`/`h-auto`:
              an <svg> has no intrinsic size, so `auto` on both axes resolves to 0×0 and the
              drawing vanishes — the same trap as the inline render above. */}
          <div onMouseDown={(e) => e.stopPropagation()} style={{ cursor: 'default' }}>
            <SvgBlock source={zoomedSvg} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Shared chrome (matches the other block editors) ───────────────────────────

function ToolBtn({ children, onClick, title, active, t }: {
  children: React.ReactNode; onClick: () => void; title?: string; active?: boolean;
  t: ReturnType<typeof useTheme>;
}) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontSize: 11, padding: '2px 7px', borderRadius: 4, lineHeight: 1.6,
        border: `0.5px solid ${hov || active ? t.muted : t.hair}`,
        background: active ? t.bgSunken : hov ? t.bgSunken : 'transparent',
        color: hov || active ? t.ink : t.inkSoft,
        cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.1s',
      }}>
      {children}
    </button>
  );
}

function DeleteBtn({ onClick, t }: { onClick: () => void; t: ReturnType<typeof useTheme> }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = (e: React.MouseEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    setConfirming(true);
    timer.current = setTimeout(() => setConfirming(false), 2500);
  };
  const disarm = (e: React.MouseEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    setConfirming(false);
  };
  const confirm = (e: React.MouseEvent) => { e.preventDefault(); onClick(); };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const btn: React.CSSProperties = {
    fontSize: 10.5, padding: '2px 8px', borderRadius: 4, lineHeight: 1.6,
    cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.1s',
  };

  if (confirming) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <button type="button" onMouseDown={confirm}
        style={{ ...btn, border: '0.5px solid oklch(0.55 0.18 15)', background: 'oklch(0.55 0.18 15)', color: '#fff', fontWeight: 600 }}>
        Delete
      </button>
      <button type="button" onMouseDown={disarm}
        style={{ ...btn, border: `0.5px solid ${t.hair}`, background: 'transparent', color: t.muted }}>
        Cancel
      </button>
    </div>
  );

  return (
    <button type="button" title="Delete block" onMouseDown={arm}
      style={{ ...btn, border: `0.5px solid ${t.hair}`, background: 'transparent', color: t.faint }}>
      ✕
    </button>
  );
}

/** Drag the bottom edge to change the block's height.
 *
 * Two things this deliberately does NOT do:
 *
 * - It doesn't write to the document on every pointermove. `setCode` goes through Lexical and
 *   marks the note dirty, so committing per pixel would queue hundreds of edits and fight the
 *   autosave. The live height is local state during the drag (`onPreview`) and is committed once
 *   on release (`onCommit`) — the same split useTableResize uses.
 * - It doesn't listen on the canvas. Excalidraw swallows pointer events to draw, so the handle is
 *   its own strip below the canvas, and the move/up listeners go on `window` — otherwise the drag
 *   dies the moment the pointer leaves the 10px strip.
 */
function ResizeHandle({ height, onPreview, onCommit, t }: {
  height: number;
  onPreview: (h: number) => void;
  onCommit: (h: number) => void;
  t: ReturnType<typeof useTheme>;
}) {
  const [dragging, setDragging] = useState(false);
  const [hov, setHov] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = height;
    setDragging(true);

    let latest = startH;
    const move = (ev: PointerEvent) => {
      ev.preventDefault();
      latest = Math.min(MAX_H, Math.max(MIN_H, Math.round(startH + (ev.clientY - startY))));
      onPreview(latest);
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      setDragging(false);
      onCommit(latest);            // one document write, on release
      // Growing the block pushes this handle down, often past the fold — leaving no way to drag
      // it back without hunting for it. Bring it back into view once the size is committed.
      ref.current?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
  }, [height, onPreview, onCommit]);

  const active = dragging || hov;
  return (
    <div
      ref={ref}
      role="separator"
      aria-label="Resize drawing"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => { e.preventDefault(); onCommit(DEFAULT_H); }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        height: RESIZE_GRIP,
        cursor: 'ns-resize',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? t.bgSunken : 'transparent',
        borderTop: `0.5px solid ${t.hair}`,
        transition: 'background 0.1s',
        touchAction: 'none',       // let a touch drag resize instead of scrolling the page
      }}
    >
      {/* Grip pips — the only affordance that this edge is draggable. */}
      <div style={{
        width: 28, height: 2.5, borderRadius: 2,
        background: active ? t.muted : t.hair,
        transition: 'background 0.1s',
      }} />
    </div>
  );
}

// ── Editor component ──────────────────────────────────────────────────────────

function ExcalidrawBlockEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const deleteBlock = useCallback(
    () => parentEditor.update(() => lexicalNode.remove()),
    [parentEditor, lexicalNode],
  );
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'draw' | 'source'>('draw');
  const [droppedImages, setDroppedImages] = useState(false);
  // Fullscreen is a STYLE change on the block, not a portal. Moving the live canvas into a
  // portal would unmount and remount Excalidraw — losing the undo stack, the current tool and
  // the scroll/zoom position mid-edit. Fixing the existing wrapper to the viewport keeps the
  // very same canvas element mounted, so expanding is seamless.
  const [fullscreen, setFullscreen] = useState(false);

  const title = readTitle(code);
  const committedHeight = readHeight(code);
  const align = readAlign(code);
  const scene = parseExcalidrawScene(code);

  // While the bottom edge is being dragged the canvas follows the pointer from local state; the
  // document only learns the final value on release. `null` means "not dragging — use the
  // committed height", which keeps the note as the source of truth everywhere else (including
  // undo, and a height changed by the ± buttons).
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const height = dragHeight ?? committedHeight;

  // writeScene closes over `height`, so a scene edit landing mid-drag would otherwise persist a
  // stale one. Read the live value from a ref instead of the captured variable.
  const heightRef = useRef(height);
  heightRef.current = height;

  // The scene we last wrote. Excalidraw's onChange fires on pure UI events too (hover, tool
  // switch, selection), so without comparing the serialized result we'd mark the note dirty
  // constantly and fight the AI-edit/diff machinery over a document nobody changed.
  const lastWritten = useRef<string | null>(null);

  const writeScene = useCallback((elements: readonly unknown[], appState: Record<string, unknown>, files: unknown) => {
    const json = serializeExcalidrawScene(elements, appState);
    if (lastWritten.current === json) return;
    lastWritten.current = json;
    // Surface the dropped-image case rather than failing silently: the user pasted a photo and it
    // will not be in the saved note, so say so (see header note 1).
    setDroppedImages(!!files && Object.keys(files as object).length > 0);
    setCode(writeBlock(json, title, heightRef.current, align));
  }, [setCode, align, title]);

  const setHeight = (h: number) => {
    setDragHeight(null);                 // committed — go back to reading the document
    setCode(writeBlock(code, title, Math.min(MAX_H, Math.max(MIN_H, h)), align));
  };
  const setAlign = (a: Align) => setCode(writeBlock(code, title, height, a));
  const setTitle = (next: string) => setCode(writeBlock(code, next, height, align));

  // Escape leaves fullscreen. Registered in the capture phase because Excalidraw handles Escape
  // itself (to clear the selection / cancel the active tool) and stops it before it bubbles —
  // without capture the key never reaches this listener while the canvas has focus.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFullscreen(false);
    };
    window.addEventListener('keydown', onKey, true);
    // A page behind a fullscreen canvas must not scroll under it.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [fullscreen]);

  return (
    <div data-rich-block="true" style={
      fullscreen
        ? {
            // Fixed to the viewport, above the app chrome. Same element as the inline block —
            // only its box changes — so the canvas inside is never remounted.
            position: 'fixed', inset: 0, zIndex: 9990,
            margin: 0, borderRadius: 0, border: 'none',
            background: t.bgSunken,
            display: 'flex', flexDirection: 'column',
          }
        : {
            margin: '8px 0', borderRadius: 8, border: `0.5px solid ${t.hair}`,
            background: t.bgSunken, overflow: 'hidden',
          }
    }>
      {/* Name row — its own full-width band, as in the other block editors. */}
      <BlockNameInput
        value={title}
        onCommit={setTitle}
        placeholder="Name this drawing…"
        kind="drawing"
      />

      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderBottom: `0.5px solid ${t.hair}`,
        background: t.bgRaised, userSelect: 'none',
      }}>
        {/* Live height readout — the only feedback that a drag is landing on a real number, and
            it doubles as the label for the ± buttons. */}
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          color: dragHeight !== null ? t.ink : t.faint,
          fontVariantNumeric: 'tabular-nums', minWidth: 42,
        }}>{fullscreen ? 'full screen' : `${height}px`}</span>
        <span style={{ flex: 1 }} />
        {/* Sizing controls are meaningless while the canvas owns the whole window. */}
        {!fullscreen && <>
          <ToolBtn title="Align left" active={align === 'left'} onClick={() => setAlign('left')} t={t}>⌐</ToolBtn>
          <ToolBtn title="Align center" active={align === 'center'} onClick={() => setAlign('center')} t={t}>⌷</ToolBtn>
          <ToolBtn title="Align right" active={align === 'right'} onClick={() => setAlign('right')} t={t}>¬</ToolBtn>
          <ToolBtn title="Shorter" onClick={() => setHeight(Math.max(MIN_H, height - 60))} t={t}>−</ToolBtn>
          <ToolBtn title="Taller" onClick={() => setHeight(Math.min(MAX_H, height + 60))} t={t}>+</ToolBtn>
        </>}
        {/* Expand / restore. Only meaningful on the canvas, so it's hidden in Source view. */}
        {viewMode === 'draw' && (
          <ToolBtn
            title={fullscreen ? 'Exit full screen (Esc)' : 'Edit full screen'}
            active={fullscreen}
            onClick={() => setFullscreen(f => !f)}
            t={t}
          >
            {fullscreen ? '⛶ Exit' : '⛶'}
          </ToolBtn>
        )}
        {!fullscreen && (
          <ToolBtn
            title={viewMode === 'draw' ? 'Edit JSON source' : 'Back to canvas'}
            onClick={() => setViewMode(v => v === 'draw' ? 'source' : 'draw')}
            t={t}
          >
            {viewMode === 'draw' ? 'Source' : 'Draw'}
          </ToolBtn>
        )}
        {!fullscreen && <DeleteBtn onClick={deleteBlock} t={t} />}
      </div>

      {droppedImages && (
        <div style={{
          padding: '5px 10px', fontSize: 11, fontFamily: 'Inter, sans-serif',
          color: t.ink, background: 'oklch(0.62 0.18 45 / 0.14)',
          borderBottom: `0.5px solid ${t.hair}`,
        }}>
          Embedded images aren’t saved in a drawing — add the picture to the note itself instead.
        </div>
      )}

      {viewMode === 'draw' && (
        // contentEditable={false} stops Lexical from treating canvas clicks as text selection —
        // without it, dragging a shape also drags a selection through the surrounding document.
        <div
          contentEditable={false}
          // In fullscreen the canvas takes the leftover column space (flex:1) instead of the
          // stored height, so the drawing gets the whole window regardless of its block size.
          style={fullscreen
            ? { flex: 1, minHeight: 0, background: t.bg }
            : { height, background: t.bg }}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <Suspense fallback={<div style={{ height: fullscreen ? '100%' : height, background: t.bgSunken }} aria-label="Loading canvas" />}>
            <Excalidraw
              initialData={scene
                ? { elements: scene.elements as never, appState: { ...scene.appState, isLoading: false } as never, scrollToContent: true }
                : undefined}
              onChange={(elements, appState, files) =>
                writeScene(elements as never, appState as never, files)}
              theme={t.name === 'dark' ? 'dark' : 'light'}
              // Everything that would reach the network or hand work to another app is off:
              // no library CDN, no export-to-link, no live collaboration.
              UIOptions={{
                canvasActions: {
                  loadScene: false,
                  saveToActiveFile: false,
                  export: false,
                  saveAsImage: false,
                  toggleTheme: false,
                },
              }}
              libraryReturnUrl={undefined}
            />
          </Suspense>
        </div>
      )}

      {/* No resize handle in fullscreen — the canvas already owns the window. */}
      {viewMode === 'draw' && !fullscreen && (
        <ResizeHandle
          height={height}
          onPreview={setDragHeight}
          onCommit={setHeight}
          t={t}
        />
      )}

      {viewMode === 'source' && (
        <SourceTextarea
          code={code}
          onCodeChange={setCode}
          ariaLabel="Drawing source"
          placeholder='{"type":"excalidraw","elements":[],"appState":{}}'
          minHeight={200}
        />
      )}
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const excalidrawCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'excalidraw',
  priority: 100,
  Editor: ExcalidrawBlockEditor,
};

/** Read-only entry point used by BlockView (and therefore by chat, tiles and the note viewer). */
export function ExcalidrawReadOnly({ code }: { code: string }) {
  const scene = parseExcalidrawScene(code);
  if (!scene) return null;
  return <ExcalidrawView scene={scene} height={readHeight(code)} align={readAlign(code)} />;
}

export { readHeight as readExcalidrawHeight, readAlign as readExcalidrawAlign };
