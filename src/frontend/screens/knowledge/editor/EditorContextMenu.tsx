/**
 * EditorContextMenu — right-click AI menu for the rich note editor. Two variants:
 * with a selection (enhance / explain / turn into list) and at the bare cursor
 * (write here / continue / summarize). Native clipboard ops are offered too so the
 * custom menu doesn't strip expected right-click behavior.
 *
 * Each AI item resolves to an { scope, instruction } request handed up to the editor.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../../components/chrome/Icon';
import { t } from '../../../components/aitextspace/theme';
import type { AiScope } from './useAiEdit';

// `openCustom` opens an empty instruction bar (free-form); `dictatable` opens the bar
// PREFILLED with `instruction` as the default, so the user can hit Run, edit it, or
// dictate extra guidance by voice. Both routes support live audio transcription.
export interface AiMenuRequest { scope: Exclude<AiScope, 'whole'>; instruction: string; openCustom?: boolean; dictatable?: boolean }

const SELECTION_ITEMS: { icon: string; label: string; req: AiMenuRequest }[] = [
  { icon: '✦', label: 'Enhance selection…', req: { scope: 'selection', instruction: '', openCustom: true } },
  { icon: '?', label: 'Explain / expand this', req: { scope: 'selection', instruction: 'Rewrite this to explain it more fully, adding a sentence or two of clarifying detail.' } },
  { icon: '▦', label: 'Turn into a list', req: { scope: 'selection', instruction: 'Rewrite this as a well-structured markdown bullet list.' } },
];

const CURSOR_ITEMS: { icon: string; label: string; req: AiMenuRequest }[] = [
  { icon: '✦', label: 'Write with AI here…', req: { scope: 'insert', instruction: '', openCustom: true } },
  { icon: '→', label: 'Continue writing (or dictate)…', req: { scope: 'insert', instruction: 'Continue writing from where the note leaves off, matching its voice and topic. Write one to three short paragraphs.', dictatable: true } },
  { icon: 'Σ', label: 'Add a summary section', req: { scope: 'insert', instruction: 'Write a concise "## Summary" section that captures the key points of this note.' } },
];

export function EditorContextMenu({
  x, y, hasSelection, onPick, onClose, onClipboard,
}: {
  x: number; y: number; hasSelection: boolean;
  onPick: (req: AiMenuRequest) => void;
  onClose: () => void;
  onClipboard: (cmd: 'cut' | 'copy' | 'paste') => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  // Keep the menu on-screen if the click lands near an edge.
  const left = Math.min(x, window.innerWidth - 232);
  const top = Math.min(y, window.innerHeight - 240);

  const items = hasSelection ? SELECTION_ITEMS : CURSOR_ITEMS;

  const row = (icon: string, label: string, onClick: () => void, hot = false, muted = false) => (
    <button
      key={label}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: 6, border: 'none',
        background: hot ? t.bgSunken : 'transparent',
        color: muted ? t.muted : t.inkSoft, fontFamily: 'Inter, sans-serif', fontSize: 12.5, cursor: 'pointer',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = t.bgSunken; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = hot ? t.bgSunken : 'transparent'; }}
    >
      <span style={{ width: 14, textAlign: 'center', color: muted ? t.muted : t.accent }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      style={{
        position: 'fixed', left, top, zIndex: 60, minWidth: 220,
        background: t.bgRaised, border: `0.5px solid ${t.hair}`, borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.24)', padding: 4,
      }}
    >
      <div style={{
        padding: '4px 10px 6px', fontFamily: 'Inter, sans-serif', fontSize: 10, color: t.muted,
        letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: `0.5px solid ${t.hair}`, marginBottom: 4,
      }}>{hasSelection ? 'AI · selection' : 'AI · at cursor'}</div>

      {items.map((it, i) => row(it.icon, it.label, () => { onClose(); onPick(it.req); }, i === 0))}

      <div style={{ height: 1, background: t.hair, margin: '4px 6px' }} />

      {hasSelection && row('✂', 'Cut', () => { onClose(); onClipboard('cut'); }, false, true)}
      {hasSelection && row('⧉', 'Copy', () => { onClose(); onClipboard('copy'); }, false, true)}
      {row('⎘', 'Paste', () => { onClose(); onClipboard('paste'); }, false, true)}
    </div>,
    document.body,
  );
}
