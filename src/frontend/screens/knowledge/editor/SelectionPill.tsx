/**
 * SelectionPill — the floating "✦ Enhance" affordance that appears over a text
 * selection in the rich editor. Clicking it opens a quick-actions menu (fix grammar,
 * shorten, expand, change tone, …) plus a "Custom instruction" bar. Each action
 * resolves to an instruction string handed up to the editor's AI engine.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../../components/chrome/Icon';
import { t } from '../../../components/aitextspace/theme';

export interface QuickAction { icon: string; label: string; instruction: string }

export const QUICK_ACTIONS: QuickAction[] = [
  { icon: '✎', label: 'Fix spelling & grammar', instruction: 'Fix all spelling and grammar errors. Change nothing else.' },
  { icon: '◎', label: 'Simplify',               instruction: 'Simplify this so it is easy to understand.' },
  { icon: '↓', label: 'Make shorter',           instruction: 'Make this more concise while keeping the meaning.' },
  { icon: '↑', label: 'Expand with detail',     instruction: 'Expand this with more detail and specifics.' },
  { icon: '✦', label: 'Improve writing',        instruction: 'Improve the writing quality and clarity.' },
];

export const TONE_ACTIONS: QuickAction[] = [
  { icon: '', label: 'Professional', instruction: 'Rewrite in a professional, formal tone.' },
  { icon: '', label: 'Casual',       instruction: 'Rewrite in a casual, conversational tone.' },
  { icon: '', label: 'Confident',    instruction: 'Rewrite in a confident, assertive tone.' },
  { icon: '', label: 'Friendly',     instruction: 'Rewrite in a warm, friendly tone.' },
];

export function SelectionPill({
  left, top, onInstruction, onOpenChange,
}: {
  left: number; top: number;
  onInstruction: (instruction: string) => void;
  /** Fires when the menu opens/closes so the host can freeze selection tracking —
   *  otherwise focus leaving the editor collapses the DOM selection and dismisses us. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (customOpen) inputRef.current?.focus(); }, [customOpen]);
  // Any menu/input open → the host must freeze selection tracking.
  useEffect(() => { onOpenChange?.(open || customOpen); }, [open, customOpen, onOpenChange]);

  // Close the menu on outside mousedown (but keep the selection alive — we only
  // preventDefault on our own controls).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) { setOpen(false); setToneOpen(false); setCustomOpen(false); }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (instruction: string) => { setOpen(false); setToneOpen(false); setCustomOpen(false); onInstruction(instruction); };

  const menuItem = (a: QuickAction, hot = false, onClick?: () => void) => (
    <button
      key={a.label}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick ?? (() => pick(a.instruction))}
      style={{
        display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
        padding: '7px 10px', borderRadius: 6, border: 'none',
        background: hot ? t.bgSunken : 'transparent', color: t.inkSoft,
        fontFamily: 'Inter, sans-serif', fontSize: 12.5, cursor: 'pointer',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = t.bgSunken; (e.currentTarget as HTMLButtonElement).style.color = t.ink; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = hot ? t.bgSunken : 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = t.inkSoft; }}
    >
      {a.icon && <span style={{ width: 14, textAlign: 'center', color: t.accent }}>{a.icon}</span>}
      <span style={{ flex: 1 }}>{a.label}</span>
    </button>
  );

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: 'fixed', left, top, zIndex: 50 }}
    >
      {!open ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen(true)}
          style={{
            height: 26, padding: '0 12px', borderRadius: 13, background: t.ink, color: t.bg,
            border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 11.5,
            fontWeight: 550, display: 'flex', alignItems: 'center', gap: 6,
            boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
          }}
        >
          <Icon name="sparkle" size={11} color={t.bg} /> Enhance
        </button>
      ) : (
        <div style={{
          minWidth: 236, background: t.bgRaised, border: `0.5px solid ${t.hair}`,
          borderRadius: 10, boxShadow: '0 6px 28px rgba(0,0,0,0.2)', padding: 4,
        }}>
          <div style={{
            padding: '4px 10px 6px', fontFamily: 'Inter, sans-serif', fontSize: 10,
            color: t.muted, letterSpacing: '0.06em', textTransform: 'uppercase',
            borderBottom: `0.5px solid ${t.hair}`, marginBottom: 4,
          }}>Enhance selection</div>

          {QUICK_ACTIONS.map((a, i) => menuItem(a, i === 0))}

          {/* Tone submenu */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setToneOpen((o) => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
              padding: '7px 10px', borderRadius: 6, border: 'none', background: 'transparent',
              color: t.inkSoft, fontFamily: 'Inter, sans-serif', fontSize: 12.5, cursor: 'pointer',
            }}
          >
            <span style={{ width: 14, textAlign: 'center', color: t.accent }}>♪</span>
            <span style={{ flex: 1 }}>Change tone</span>
            <Icon name={toneOpen ? 'chevD' : 'chevR'} size={11} color={t.muted} />
          </button>
          {toneOpen && (
            <div style={{ paddingLeft: 10 }}>
              {TONE_ACTIONS.map((a) => menuItem(a))}
            </div>
          )}

          <div style={{ height: 1, background: t.hair, margin: '4px 6px' }} />

          {!customOpen ? (
            menuItem({ icon: '✦', label: 'Custom instruction…', instruction: '' }, false, () => setCustomOpen(true))
          ) : (
            <div style={{ padding: '4px 6px 6px', display: 'flex', gap: 6 }}>
              <input
                ref={inputRef}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && custom.trim()) { e.preventDefault(); pick(custom.trim()); }
                  if (e.key === 'Escape') { setCustomOpen(false); setCustom(''); }
                }}
                placeholder="How should this change?"
                style={{
                  flex: 1, height: 28, padding: '0 10px', borderRadius: 6,
                  border: `0.5px solid ${t.hair}`, background: t.bg,
                  fontFamily: 'Inter, sans-serif', fontSize: 12, color: t.ink, outline: 'none',
                }}
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => custom.trim() && pick(custom.trim())}
                style={{
                  height: 28, padding: '0 10px', borderRadius: 6, border: 'none',
                  background: t.accent, color: 'white', fontFamily: 'Inter, sans-serif',
                  fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
                }}
              >Run</button>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
