import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import mermaid from 'mermaid';
import { useCodeBlockEditorContext, type CodeBlockEditorDescriptor, type CodeBlockEditorProps } from '@mdxeditor/editor';
import { useTheme } from './theme';
import { SourceTextarea } from './SourceTextarea';
import { BlockNameInput } from './BlockNameInput';
import { readTitle, stripTitle, withTitle } from './blockTitle';

mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose', fontFamily: 'Inter, sans-serif' });

const genId = () => `mermaid-${Math.random().toString(36).slice(2, 9)}`;
const ZOOM_STEP = 0.15;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;
const DEFAULT_H = 260;

// Per-diagram display settings ride in a leading mermaid comment, so they persist in the note
// without affecting the rendered diagram. Read either prefix — `buddy:` is what the blocks were
// originally written for and appears in notes authored there — but always WRITE `cl:`, so this
// app doesn't stamp another product's name into the user's files.
const DIRECTIVE_RE = /^%% (?:cl|buddy):([^\n]*)\n?/;
const H_KV = /height=(\d+)/;
const W_KV = /width=(\d+)/;
const A_KV = /align=(left|center|right)/;
const L_KV = /look=(\w+)/;
const T_KV = /theme=(\w+)/;

type Align      = 'left' | 'center' | 'right';
type DiagramLook  = 'classic' | 'handDrawn';
type DiagramTheme = 'default' | 'neutral' | 'dark' | 'forest' | 'base';

const LOOKS: { value: DiagramLook; label: string }[] = [
  { value: 'classic',   label: 'Classic'    },
  { value: 'handDrawn', label: 'Hand-drawn' },
];

const THEMES: { value: DiagramTheme; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'forest',  label: 'Forest'  },
  { value: 'base',    label: 'Base'    },
  { value: 'dark',    label: 'Dark'    },
];

const readDirective  = (code: string) => code.match(DIRECTIVE_RE)?.[1] ?? '';
const readHeight = (code: string) => { const m = readDirective(code).match(H_KV); return m ? parseInt(m[1]) : DEFAULT_H; };
const readWidth  = (code: string) => { const m = readDirective(code).match(W_KV); return m ? parseInt(m[1]) : null; };
const readAlign  = (code: string): Align       => (readDirective(code).match(A_KV)?.[1] as Align)       ?? 'left';
const readLook   = (code: string): DiagramLook  => (readDirective(code).match(L_KV)?.[1] as DiagramLook)  ?? 'classic';
const readTheme  = (code: string): DiagramTheme => (readDirective(code).match(T_KV)?.[1] as DiagramTheme) ?? 'neutral';
const stripDirective = (code: string) => code.replace(DIRECTIVE_RE, '');
const withDirective  = (code: string, h: number, w: number | null, a: Align, look: DiagramLook, theme: DiagramTheme) => {
  const parts = [
    `height=${h}`,
    ...(w !== null ? [`width=${w}`] : []),
    ...(a !== 'left' ? [`align=${a}`] : []),
    ...(look !== 'classic'  ? [`look=${look}`]   : []),
    ...(theme !== 'neutral' ? [`theme=${theme}`] : []),
  ];
  return `%% cl:${parts.join(' ')}\n${stripDirective(code)}`;
};

// ── usePanZoom ────────────────────────────────────────────────────────────────

function usePanZoom(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0 });
  const offsetRef = useRef(offset); offsetRef.current = offset;
  const scaleRef = useRef(scale); scaleRef.current = scale;

  const zoomIn  = useCallback(() => setScale(s => Math.min(ZOOM_MAX, +(s + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setScale(s => Math.max(ZOOM_MIN, +(s - ZOOM_STEP).toFixed(2))), []);
  const reset   = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

  const fit = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth, ch = container.clientHeight;
    if (!cw || !ch) return;

    let sw = 0, sh = 0;

    // For data URI SVG: parse viewBox directly — img.naturalWidth returns the
    // browser default (300×150) for SVGs without explicit width/height attributes,
    // which gives a wrong scale. The viewBox always has the real diagram dimensions.
    const imgEl = container.querySelector('img');
    if (imgEl?.src?.startsWith('data:image/svg+xml')) {
      try {
        const svgStr = decodeURIComponent(imgEl.src.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
        const m = svgStr.match(/viewBox="[^"]*?([\d.]+)\s+([\d.]+)"/);
        if (m) { sw = parseFloat(m[1]); sh = parseFloat(m[2]); }
      } catch { /* ignore */ }
    }

    // Fallback: raw SVG injected in DOM
    if (!sw || !sh) {
      const svgEl = container.querySelector('svg');
      if (!svgEl) { reset(); return; }
      const vb = svgEl.viewBox?.baseVal;
      const r  = svgEl.getBoundingClientRect();
      sw = (vb?.width  && vb.width  > 0) ? vb.width  : r.width  / scaleRef.current;
      sh = (vb?.height && vb.height > 0) ? vb.height : r.height / scaleRef.current;
    }

    if (!sw || !sh) return;
    setScale(Math.min((cw / sw) * 0.92, (ch / sh) * 0.92, ZOOM_MAX));
    setOffset({ x: 0, y: 0 });
  }, [containerRef, reset]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    dragStart.current = { mx: e.clientX, my: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      setOffset({ x: dragStart.current.ox + ev.clientX - dragStart.current.mx, y: dragStart.current.oy + ev.clientY - dragStart.current.my });
    };
    const onUp = () => { draggingRef.current = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale(s => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s - e.deltaY * 0.001)));
  }, []);

  return { scale, offset, draggingRef, zoomIn, zoomOut, reset, fit, onMouseDown, onWheel };
}

// ── DiagramCanvas ─────────────────────────────────────────────────────────────

function DiagramCanvas({ svg, renderError, t, containerRef, scale, offset, draggingRef, onMouseDown, onWheel, onContentLoad }: {
  svg: string; renderError: string | null; t: ReturnType<typeof useTheme>;
  containerRef: React.RefObject<HTMLDivElement | null>; scale: number;
  offset: { x: number; y: number }; draggingRef: React.RefObject<boolean>;
  onMouseDown: (e: React.MouseEvent) => void; onWheel: (e: React.WheelEvent) => void;
  onContentLoad?: () => void;
}) {
  const transformStyle: React.CSSProperties = {
    flexShrink: 0,
    transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
    transformOrigin: 'center center',
    transition: draggingRef.current ? 'none' : 'transform 0.12s ease-out',
    pointerEvents: 'none',
  };

  return (
    <div ref={containerRef} onMouseDown={onMouseDown} onWheel={onWheel}
      style={{ flex: 1, overflow: 'hidden', background: t.bg, cursor: 'grab', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {renderError ? (
        <pre style={{ color: 'oklch(0.52 0.18 25)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, margin: 12, whiteSpace: 'pre-wrap' }}>{renderError}</pre>
      ) : svg ? (
        svg.startsWith('data:') ? (
          <img src={svg} alt="Mermaid diagram" onLoad={onContentLoad}
            style={{ display: 'block', ...transformStyle }}
          />
        ) : (
          <div dangerouslySetInnerHTML={{ __html: svg }} style={transformStyle} />
        )
      ) : (
        <div style={{ color: t.faint, fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter, sans-serif' }}>Rendering…</div>
      )}
    </div>
  );
}

// ── ZoomBar ───────────────────────────────────────────────────────────────────

function ZoomBar({ scale, onZoomIn, onZoomOut, onFit, onReset, t }: {
  scale: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void; onReset: () => void; t: ReturnType<typeof useTheme>;
}) {
  return (
    <>
      <ToolBtn title="Zoom out" onClick={onZoomOut} t={t}>−</ToolBtn>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.muted, minWidth: 34, textAlign: 'center' }}>{Math.round(scale * 100)}%</span>
      <ToolBtn title="Zoom in" onClick={onZoomIn} t={t}>+</ToolBtn>
      <ToolBtn title="Fit to view" onClick={onFit} t={t}>⊡</ToolBtn>
      <ToolBtn title="Reset view" onClick={onReset} t={t}>↺</ToolBtn>
    </>
  );
}

// ── ExpandedOverlay ───────────────────────────────────────────────────────────

function ExpandedOverlay({ svg, renderError, onClose, t }: { svg: string; renderError: string | null; onClose: () => void; t: ReturnType<typeof useTheme> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pz = usePanZoom(containerRef);


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 9990, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={onClose}>
      <div style={{ width: 'min(92vw, 1100px)', height: 'min(88vh, 800px)', borderRadius: 12, overflow: 'hidden', border: `0.5px solid ${t.hair}`, boxShadow: t.shadowLg, display: 'flex', flexDirection: 'column', background: t.bgRaised }}
        onMouseDown={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: `0.5px solid ${t.hair}`, background: t.bgRaised, flexShrink: 0, userSelect: 'none' }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.muted, fontWeight: 600, letterSpacing: 0.3, flex: 1 }}>mermaid</span>
          <ZoomBar scale={pz.scale} onZoomIn={pz.zoomIn} onZoomOut={pz.zoomOut} onFit={pz.fit} onReset={pz.reset} t={t} />
          <div style={{ width: 8 }} />
          <ToolBtn title="Close (Esc)" onClick={onClose} t={t}>×</ToolBtn>
        </div>
        <DiagramCanvas svg={svg} renderError={renderError} t={t} containerRef={containerRef} scale={pz.scale} offset={pz.offset} draggingRef={pz.draggingRef} onMouseDown={pz.onMouseDown} onWheel={pz.onWheel} onContentLoad={pz.fit} />
      </div>
    </div>,
    document.body
  );
}

// ── ToolBtn ───────────────────────────────────────────────────────────────────

function ToolBtn({ children, onClick, title, t }: { children: React.ReactNode; onClick: () => void; title?: string; t: ReturnType<typeof useTheme> }) {
  const [hov, setHov] = useState(false);
  return (
    <button type="button" title={title}
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ fontSize: 11, padding: '2px 7px', borderRadius: 4, lineHeight: 1.6, border: `0.5px solid ${hov ? t.muted : t.hair}`, background: hov ? t.bgSunken : 'transparent', color: hov ? t.ink : t.inkSoft, cursor: 'pointer', fontFamily: 'Inter, sans-serif', transition: 'all 0.1s' }}>
      {children}
    </button>
  );
}

// ── DeleteBtn ─────────────────────────────────────────────────────────────────

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

// ── MermaidCodeBlockEditorComponent ──────────────────────────────────────────

function MermaidCodeBlockEditorComponent({ code, language }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const deleteBlock = () => parentEditor.update(() => lexicalNode.remove());
  const t = useTheme();
  const [viewMode, setViewMode] = useState<'diagram' | 'code'>('diagram');
  const [svg, setSvg] = useState('');        // stripped SVG for expand modal (portal, no CSS bleed)
  const [imgSrc, setImgSrc] = useState(''); // data URI for inline <img> (fully isolated)
  const [renderError, setRenderError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [title,      setTitle]      = useState(() => readTitle(code));
  const [containerH, setContainerH] = useState(() => readHeight(code));
  const [containerW, setContainerW] = useState<number | null>(() => readWidth(code));
  const [align,      setAlign]      = useState<Align>(() => readAlign(code));
  const [look,       setLook]       = useState<DiagramLook>(() => readLook(code));
  const [dTheme,     setDTheme]     = useState<DiagramTheme>(() => readTheme(code));
  const titleRef = useRef(title); titleRef.current = title;
  const idRef      = useRef(genId());
  const appThemeRef = useRef(t.name);    appThemeRef.current = t.name;
  const lookRef     = useRef(look);      lookRef.current     = look;
  const dThemeRef   = useRef(dTheme);    dThemeRef.current   = dTheme;

  if (language !== 'mermaid') return null;

  // Strip both the @title directive (managed by BlockNameInput) and the
  // %% cl: config (managed by the toolbar selectors) so the rest of the
  // editor only sees the user's actual diagram source.
  const cleanCode = stripDirective(stripTitle(code));

  // handDrawn look only renders for flowchart/graph diagrams in mermaid v11
  const supportsHandDrawn = /^\s*(graph|flowchart|block|kanban)\b/i.test(cleanCode);

  const saveSize = useCallback((h: number, w: number | null, a: Align) => {
    setCode(withTitle(
      withDirective(cleanCode, h, w, a, lookRef.current, dThemeRef.current),
      titleRef.current, '%%',
    ));
  }, [setCode, cleanCode]);

  const saveStyle = useCallback((newLook: DiagramLook, newTheme: DiagramTheme) => {
    setLook(newLook);   lookRef.current   = newLook;
    setDTheme(newTheme); dThemeRef.current = newTheme;
    setCode(withTitle(
      withDirective(cleanCode, containerH, containerW, align, newLook, newTheme),
      titleRef.current, '%%',
    ));
  }, [setCode, cleanCode, containerH, containerW, align]);

  const saveTitle = useCallback((next: string) => {
    setTitle(next);
    titleRef.current = next;
    setCode(withTitle(
      withDirective(cleanCode, containerH, containerW, align, lookRef.current, dThemeRef.current),
      next, '%%',
    ));
  }, [setCode, cleanCode, containerH, containerW, align]);

  const renderDiagram = useCallback(async (src: string) => {
    if (!src.trim()) { setSvg(''); setImgSrc(''); return; }
    idRef.current = genId();
    const mTheme = appThemeRef.current === 'dark' ? 'dark' : dThemeRef.current;
    const mLook  = lookRef.current;
    // %%{init}%% is processed at parse time and reliably overrides global config —
    // mermaid.initialize() alone can have stale-config issues across re-renders.
    const directive = `%%{init: {"theme": "${mTheme}", "look": "${mLook}", "fontFamily": "Inter, sans-serif"}}%%\n`;
    const srcWithInit = src.trimStart().startsWith('%%{init') ? src : directive + src;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    try {
      const { svg: rendered } = await mermaid.render(idRef.current, srcWithInit);
      // Expand modal (portal, no CSS bleed): keep original SVG with mermaid's
      // explicit width/height so fit() can calculate the correct scale.
      setSvg(rendered);
      // Inline editor view: data URI <img> fully isolates the SVG from MDXEditor CSS.
      setImgSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered)}`);
      setRenderError(null);
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : String(e));
      setSvg(''); setImgSrc('');
    }
  }, []);

  useEffect(() => {
    renderDiagram(cleanCode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanCode, t.name, dTheme, look]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startH = containerH, startY = e.clientY;
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => setContainerH(Math.max(80, startH + ev.clientY - startY));
    const onUp = (ev: MouseEvent) => {
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      saveSize(Math.max(80, startH + ev.clientY - startY), containerW, align);
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  }, [containerH, containerW, align, saveSize]);

  const onWidthResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startW = containerW ?? (e.currentTarget.parentElement?.getBoundingClientRect().width ?? 400), startX = e.clientX;
    document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => setContainerW(Math.max(120, Math.round(startW + ev.clientX - startX)));
    const onUp = (ev: MouseEvent) => {
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
      saveSize(containerH, Math.max(120, Math.round(startW + ev.clientX - startX)), align);
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  }, [containerW, containerH, align, saveSize]);

  const justifyMap: Record<Align, string> = { left: 'flex-start', center: 'center', right: 'flex-end' };

  return (
    <div data-rich-block="true" style={{ margin: '8px 0', display: 'block' }}>
      <div style={{ display: 'flex', justifyContent: justifyMap[align] }}>
        <div style={{ position: 'relative', width: containerW ? `${containerW}px` : '100%', maxWidth: '100%' }}>
          <div style={{ borderRadius: 8, overflow: 'hidden', border: `0.5px solid ${t.hair}`, background: t.bgSunken }}>
            {/* Block name (optional; shown in view-mode header in place of "mermaid") */}
            <BlockNameInput
              value={title}
              onCommit={saveTitle}
              kind="mermaid"
              placeholder="Name this diagram…"
            />
            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', borderBottom: `0.5px solid ${t.hair}`, background: t.bgRaised, userSelect: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* Look picker — only flowchart/graph supports handDrawn in mermaid v11 */}
                {supportsHandDrawn && (
                  <select
                    value={look}
                    onChange={e => saveStyle(e.target.value as DiagramLook, dTheme)}
                    title="Diagram look (flowchart only)"
                    style={{
                      height: 20, fontSize: 10.5, borderRadius: 4,
                      border: `0.5px solid ${t.hair}`,
                      background: t.bg, color: t.muted,
                      cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                      padding: '0 2px', outline: 'none',
                    }}
                  >
                    {LOOKS.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                )}
                {/* Theme picker */}
                <select
                  value={dTheme}
                  onChange={e => saveStyle(look, e.target.value as DiagramTheme)}
                  title="Diagram theme"
                  style={{
                    height: 20, fontSize: 10.5, borderRadius: 4,
                    border: `0.5px solid ${t.hair}`,
                    background: t.bg, color: t.muted,
                    cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                    padding: '0 2px', outline: 'none',
                  }}
                >
                  {THEMES.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {containerW !== null && (['left', 'center', 'right'] as Align[]).map(a => (
                  <ToolBtn key={a} t={t} title={`Align ${a}`} onClick={() => { setAlign(a); saveSize(containerH, containerW, a); }}>
                    <span style={{ opacity: align === a ? 1 : 0.4 }}>{a === 'left' ? '⬱' : a === 'center' ? '☰' : '⬰'}</span>
                  </ToolBtn>
                ))}
                {viewMode === 'diagram' && svg && (
                  <ToolBtn title="Expand" onClick={() => setExpanded(true)} t={t}>⛶</ToolBtn>
                )}
                <ToolBtn title={viewMode === 'diagram' ? 'Edit source' : 'Show diagram'}
                  onClick={() => setViewMode(v => v === 'diagram' ? 'code' : 'diagram')} t={t}>
                  {viewMode === 'diagram' ? 'Edit' : 'Diagram'}
                </ToolBtn>
                <DeleteBtn onClick={deleteBlock} t={t} />
              </div>
            </div>

            {/* Diagram view */}
            {viewMode === 'diagram' && (
              <>
                <div style={{ background: t.bg, padding: '12px 16px' }}>
                  {renderError ? (
                    <pre style={{ color: 'oklch(0.52 0.18 25)', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, margin: 0, whiteSpace: 'pre-wrap' }}>{renderError}</pre>
                  ) : imgSrc ? (
                    /* Render as isolated <img> so MDXEditor CSS cannot bleed into
                       mermaid's foreignObject node labels and corrupt the layout. */
                    <img
                      src={imgSrc}
                      alt="Mermaid diagram"
                      style={{
                        display: 'block',
                        width: '100%',
                        height: `${containerH - 24}px`,
                        objectFit: 'contain',
                        objectPosition: 'left center',
                        boxShadow: 'none',
                        borderRadius: 0,
                        margin: 0,
                      }}
                    />
                  ) : (
                    <div style={{ height: containerH - 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.faint, fontSize: 12, fontStyle: 'italic', fontFamily: 'Inter, sans-serif' }}>Rendering…</div>
                  )}
                </div>
                <div onMouseDown={onResizeStart} title="Drag to resize height"
                  style={{ height: 8, cursor: 'row-resize', borderTop: `0.5px solid ${t.hair}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 28, height: 2, borderRadius: 1, background: t.hair }} />
                </div>
              </>
            )}

            {/* Code edit view */}
            {viewMode === 'code' && (
              <SourceTextarea
                ariaLabel="Mermaid diagram source"
                code={cleanCode}
                onCodeChange={(next) => setCode(withDirective(next, containerH, containerW, align, lookRef.current, dThemeRef.current))}
                minHeight={120}
                style={{ lineHeight: 1.5 }}
              />
            )}
          </div>

          {/* Right width handle */}
          {viewMode === 'diagram' && (
            <div onMouseDown={onWidthResizeStart} title="Drag to resize width"
              style={{ position: 'absolute', top: 0, right: -10, width: 14, height: '100%', cursor: 'ew-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
              <div style={{ width: 3, height: 28, borderRadius: 2, background: t.hair }} />
            </div>
          )}
        </div>
      </div>
      {expanded && <ExpandedOverlay svg={imgSrc} renderError={renderError} onClose={() => setExpanded(false)} t={t} />}
    </div>
  );
}

export const mermaidCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'mermaid',
  priority: 100,
  Editor: MermaidCodeBlockEditorComponent,
};
