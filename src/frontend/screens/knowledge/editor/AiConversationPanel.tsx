/**
 * AiConversationPanel — the note editor's AI as an ongoing conversation in the right rail,
 * instead of a one-shot bar that appears at the bottom and vanishes when the edit lands.
 *
 * The panel owns the TALKING; it deliberately does not own the REVIEWING. When a turn
 * produces changes they still open in the full-width DiffOverlay, because that diff is
 * two columns of source and cannot be read in a 300px rail. Each assistant turn instead
 * leaves a compact receipt here ("3 changes · applied"), so scrolling the thread tells you
 * what the AI actually did to the note — which the transient bar never could.
 *
 * A turn carries `scope` because the same thread mixes kinds of edit: a whole-note rewrite,
 * a selection enhance, and a table edit all land in one conversation, and the receipt is
 * only readable if it says which was which.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../../components/chrome/Icon';
import { t } from '../../../components/aitextspace/theme';
import { useDictation } from '../../../hooks/useDictation';
import type { AiScope } from './useAiEdit';

/** What a turn did to the note, once it is no longer pending. */
export type TurnOutcome = 'applied' | 'discarded' | 'no-change' | 'error' | 'cancelled';

export interface ConversationTurn {
  id: string;
  role: 'user' | 'assistant';
  /** For a user turn, the instruction. For an assistant turn, a short receipt line. */
  text: string;
  scope?: AiScope;
  /** Assistant turns only: how many hunks the proposal contained. */
  changeCount?: number;
  outcome?: TurnOutcome;
  /** Set while this proposal is still awaiting a decision (open in the diff, or closed
   *  without deciding — either way it can be reopened from the thread). */
  pending?: boolean;
  /** Assistant turns only: the proposed note text, kept so a pending proposal can be
   *  reopened and re-diffed after the user closes the overlay to look at the note. */
  candidate?: string;
  /** What the user was editing — "the whole note", "this table". Labels the user turn. */
  target?: string;
}

const OUTCOME_STYLE: Record<TurnOutcome, { label: string; color: string }> = {
  applied: { label: 'applied', color: 'oklch(0.50 0.15 145)' },
  discarded: { label: 'discarded', color: 'oklch(0.55 0.18 25)' },
  'no-change': { label: 'no change', color: t.muted },
  error: { label: 'failed', color: 'oklch(0.55 0.18 25)' },
  cancelled: { label: 'stopped', color: t.muted },
};

const SCOPE_LABEL: Record<AiScope, string> = {
  whole: 'whole note',
  selection: 'selection',
  insert: 'insert',
  element: 'element',
};

export function AiConversationPanel({
  turns, streaming, streamPreview, hasAgent, error,
  onSend, onCancel, onReopen, onClear, onClose, onDismissError,
}: {
  turns: ConversationTurn[];
  streaming: boolean;
  streamPreview: string;
  hasAgent: boolean;
  error: string | null;
  /** Ask for a change. `scope` is always 'whole' from here — the panel edits the note. */
  onSend: (instruction: string) => void;
  onCancel: () => void;
  /** Re-open a still-pending proposal's diff (the user closed it without deciding). */
  onReopen: (turnId: string) => void;
  onClear: () => void;
  onClose: () => void;
  onDismissError: () => void;
}) {
  const [input, setInput] = useState('');
  const dictation = useDictation();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-grow the composer, bounded — a dictated instruction can run long.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [input]);

  // Follow the thread as turns land. Scroll the panel's own container rather than using
  // scrollIntoView, which walks up to the document and shifts the whole fixed-height app
  // (the exact bug fixed in 1.0.3 on the chat screen).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming, streamPreview]);

  const canSend = !!input.trim() && !streaming && hasAgent;

  const send = () => {
    if (!canSend) return;
    if (dictation.recording) dictation.stop().catch(() => {});
    onSend(input.trim());
    setInput('');
  };

  const toggleMic = async () => {
    if (dictation.recording) {
      const text = await dictation.stop();
      if (text) setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
    } else {
      dictation.start();
    }
  };

  const userTurns = useMemo(() => turns.filter((x) => x.role === 'user').length, [turns]);

  return (
    <aside
      aria-label="AI conversation"
      style={{
        width: 300, flex: 'none', borderLeft: `0.5px solid ${t.hair}`, background: t.bgRaised,
        display: 'flex', flexDirection: 'column', minHeight: 0,
      }}
    >
      {/* header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7, padding: '9px 10px 9px 12px',
        borderBottom: `0.5px solid ${t.hair}`, flexShrink: 0,
      }}>
        <Icon name="sparkle" size={12} color={t.accent} />
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: t.ink }}>
          AI
        </span>
        {userTurns > 0 && (
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10.5, color: t.muted }}>
            {userTurns} turn{userTurns === 1 ? '' : 's'}
          </span>
        )}
        <div style={{ flex: 1 }} />
        {turns.length > 0 && (
          <button
            type="button" onClick={onClear} title="Clear this conversation"
            style={{
              padding: '2px 7px', borderRadius: 5, border: `0.5px solid ${t.hair}`,
              background: 'transparent', color: t.muted, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif', fontSize: 10.5,
            }}
          >
            Clear
          </button>
        )}
        <button
          type="button" onClick={onClose} title="Hide the AI panel" aria-label="Hide the AI panel"
          style={{
            display: 'grid', placeItems: 'center', width: 22, height: 22, borderRadius: 5,
            border: 'none', background: 'transparent', color: t.muted, cursor: 'pointer',
          }}
        >
          <Icon name="x" size={12} color={t.muted} />
        </button>
      </div>

      {/* thread */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px' }}>
        {turns.length === 0 && !streaming && (
          <div style={{
            fontFamily: 'Inter, sans-serif', fontSize: 11.5, lineHeight: 1.6, color: t.muted,
          }}>
            {hasAgent ? (
              <>
                Ask for a change to this note and keep the conversation going — follow-ups
                remember what you already asked for.
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {[
                    'Tighten the writing, keep every fact',
                    'Add a summary at the top',
                    'Turn the second section into a table',
                  ].map((s) => (
                    <button
                      key={s} type="button" onClick={() => setInput(s)}
                      style={{
                        textAlign: 'left', padding: '5px 8px', borderRadius: 6,
                        border: `0.5px solid ${t.hair}`, background: t.bg, color: t.inkSoft,
                        fontFamily: 'Inter, sans-serif', fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              'No AI provider is connected, so note editing with AI is unavailable. Connect one in Settings → AI providers.'
            )}
          </div>
        )}

        {turns.map((turn) => (
          <TurnRow key={turn.id} turn={turn} onReopen={onReopen} />
        ))}

        {streaming && (
          <div style={{ marginBottom: 10 }}>
            <Label text="AI" />
            <div style={{
              padding: '7px 9px', borderRadius: 7, border: `0.5px solid ${t.hair}`, background: t.bg,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, lineHeight: 1.5,
              color: t.muted, maxHeight: 120, overflow: 'hidden', wordBreak: 'break-word',
            }}>
              {streamPreview ? streamPreview.slice(-260) : 'Thinking…'}
            </div>
            <button
              type="button" onClick={onCancel}
              style={{
                marginTop: 6, height: 24, padding: '0 10px', borderRadius: 5, border: 'none',
                background: 'oklch(0.55 0.18 25)', color: 'white', cursor: 'pointer',
                fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
              }}
            >
              Stop
            </button>
          </div>
        )}
      </div>

      {/* error */}
      {error && (
        <div style={{
          flexShrink: 0, margin: '0 10px 8px', padding: '7px 9px', borderRadius: 7,
          border: '0.5px solid oklch(0.55 0.18 25)',
          background: 'color-mix(in oklch, oklch(0.55 0.18 25) 10%, transparent)',
          display: 'flex', gap: 8, alignItems: 'flex-start',
        }}>
          <span style={{
            flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 11, lineHeight: 1.5,
            color: 'oklch(0.55 0.18 25)', wordBreak: 'break-word',
          }}>
            {error}
          </span>
          <button
            type="button" onClick={onDismissError} title="Dismiss" aria-label="Dismiss error"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <Icon name="x" size={11} color="oklch(0.55 0.18 25)" />
          </button>
        </div>
      )}

      {/* composer */}
      <div style={{
        flexShrink: 0, borderTop: `0.5px solid ${t.hair}`, padding: '8px 10px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {dictation.recording && (
          <div style={{
            display: 'flex', gap: 6, alignItems: 'flex-start', padding: '5px 8px', borderRadius: 6,
            background: 'color-mix(in oklch, oklch(0.55 0.18 25) 8%, transparent)',
            border: '0.5px solid color-mix(in oklch, oklch(0.55 0.18 25) 30%, transparent)',
          }}>
            <span className="an-pulse" style={{
              width: 6, height: 6, borderRadius: 999, background: 'oklch(0.55 0.18 25)',
              flex: 'none', marginTop: 4,
            }} />
            <span style={{
              flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 11, lineHeight: 1.45,
              color: dictation.transcript ? t.inkSoft : t.muted,
              fontStyle: dictation.transcript ? 'normal' : 'italic',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 72, overflowY: 'auto',
            }}>
              {dictation.transcript || 'Listening…'}
            </span>
          </div>
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={hasAgent ? 'Ask for a change to this note…' : 'No AI provider connected'}
          disabled={!hasAgent}
          aria-label="Ask AI for a change to this note"
          style={{
            width: '100%', minHeight: 32, maxHeight: 140, padding: '7px 10px', borderRadius: 7,
            border: `0.5px solid ${dictation.recording ? t.accent : t.hair}`, background: t.bg,
            fontFamily: 'Inter, sans-serif', fontSize: 12, lineHeight: 1.45, color: t.ink,
            outline: 'none', resize: 'none', overflowY: 'auto',
          }}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button" onClick={toggleMic} disabled={!hasAgent}
            title={dictation.recording ? 'Stop dictation' : 'Dictate the instruction'}
            aria-label={dictation.recording ? 'Stop dictation' : 'Dictate the instruction'}
            style={{
              height: 28, width: 28, flex: 'none', display: 'grid', placeItems: 'center',
              borderRadius: 6, border: `0.5px solid ${dictation.recording ? 'transparent' : t.hair}`,
              background: dictation.recording ? 'oklch(0.55 0.18 25)' : 'transparent',
              cursor: hasAgent ? 'pointer' : 'not-allowed', opacity: hasAgent ? 1 : 0.5,
            }}
          >
            <Icon name="mic" size={13} color={dictation.recording ? 'white' : t.inkSoft} />
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button" onClick={send} disabled={!canSend}
            style={{
              height: 28, padding: '0 14px', borderRadius: 6, border: 'none',
              background: t.accent, color: 'white', fontFamily: 'Inter, sans-serif',
              fontSize: 11.5, fontWeight: 600,
              cursor: canSend ? 'pointer' : 'not-allowed', opacity: canSend ? 1 : 0.5,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  );
}

function Label({ text }: { text: string }) {
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 0.5,
      textTransform: 'uppercase', color: t.muted, marginBottom: 3,
    }}>
      {text}
    </div>
  );
}

function TurnRow({ turn, onReopen }: { turn: ConversationTurn; onReopen: (id: string) => void }) {
  if (turn.role === 'user') {
    return (
      <div style={{ marginBottom: 10 }}>
        <Label text={turn.target ? `you · ${turn.target}` : 'you'} />
        <div style={{
          padding: '7px 9px', borderRadius: 7,
          border: `0.5px solid ${t.hair}`,
          background: `color-mix(in oklch, ${t.accent} 7%, ${t.bg})`,
          fontFamily: 'Inter, sans-serif', fontSize: 11.5, lineHeight: 1.5, color: t.ink,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {turn.text}
        </div>
      </div>
    );
  }

  const outcome = turn.outcome ? OUTCOME_STYLE[turn.outcome] : null;
  // A pending proposal is reopenable: the user can close the diff to look at the note and
  // come back to it, so the receipt doubles as the way back in.
  const reopenable = turn.pending;

  return (
    <div style={{ marginBottom: 10 }}>
      <Label text={turn.scope ? `ai · ${SCOPE_LABEL[turn.scope]}` : 'ai'} />
      <div
        onClick={reopenable ? () => onReopen(turn.id) : undefined}
        role={reopenable ? 'button' : undefined}
        tabIndex={reopenable ? 0 : undefined}
        onKeyDown={reopenable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onReopen(turn.id); } } : undefined}
        title={reopenable ? 'Reopen this proposal to review it' : undefined}
        style={{
          padding: '7px 9px', borderRadius: 7,
          border: `0.5px solid ${reopenable ? t.accent : t.hair}`,
          background: t.bg,
          fontFamily: 'Inter, sans-serif', fontSize: 11.5, lineHeight: 1.5, color: t.ink,
          cursor: reopenable ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap',
        }}
      >
        <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{turn.text}</span>
        {outcome && (
          <span style={{
            flex: 'none', padding: '1px 6px', borderRadius: 4, fontSize: 9.5, fontWeight: 700,
            fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: 0.3,
            color: outcome.color, border: `0.5px solid ${outcome.color}`,
            background: `color-mix(in oklch, ${outcome.color} 12%, transparent)`,
          }}>
            {outcome.label}
          </span>
        )}
        {reopenable && (
          <span style={{
            flex: 'none', padding: '1px 6px', borderRadius: 4, fontSize: 9.5, fontWeight: 700,
            fontFamily: 'Inter, sans-serif', textTransform: 'uppercase', letterSpacing: 0.3,
            color: t.accentInk, border: `0.5px solid ${t.accent}`,
            background: `color-mix(in oklch, ${t.accent} 12%, transparent)`,
          }}>
            review
          </span>
        )}
      </div>
    </div>
  );
}
