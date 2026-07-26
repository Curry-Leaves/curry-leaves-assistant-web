import { Icon } from './chrome/Icon';
import { Markdown } from './Markdown';
import type { AssistantPhase } from '../hooks/useVoiceAssistant';

/**
 * The floating panel for an app-wide voice exchange. Appears over whatever screen is open
 * — the point of the feature is that asking a question doesn't drag you to the chat tab.
 *
 * Hidden while merely armed: a permanent overlay for a background listener would be noise.
 * The armed state is shown as a small dot in the sidebar instead.
 */
export function VoicePanel({ phase, heard, reply, onCancel, onNavigate }: {
  phase: AssistantPhase;
  heard: string;
  reply: string;
  onCancel: () => void;
  /** Opens a note when an answer cites one, same as clicking a citation in chat. */
  onNavigate?: (path: string) => void;
}) {
  if (phase === 'off' || phase === 'armed') return null;

  const label = phase === 'listening' ? 'Listening…'
    : phase === 'thinking' ? 'Thinking…'
    : phase === 'confirming' ? 'Say yes or no…'
    : phase === 'speaking' ? 'Speaking'
    : 'Answer';
  // The pulsing dot means "something is happening"; a finished answer just sits there.
  const busy = phase !== 'answered';

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[min(420px,calc(100vw-3rem))] rounded-[12px] border border-border bg-bg shadow-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border-soft">
        <span className={`w-2 h-2 rounded-full ${phase === 'speaking' || phase === 'confirming' ? 'bg-accent' : busy ? 'bg-rec' : 'bg-border'} ${busy ? 'an-pulse' : ''}`} />
        <span className="text-[12.5px] font-550 text-ink">{label}</span>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
          className="ml-auto w-6 h-6 rounded-[6px] flex items-center justify-center text-ink3 hover:bg-border-soft"
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      {/* min-w-0 + overflow-x-auto: markdown can contain a wide table or a long code line,
          which would otherwise stretch this fixed-width panel off the edge of the screen. */}
      <div className="px-3.5 py-3 max-h-[40vh] overflow-y-auto overflow-x-auto min-w-0">
        {heard && (
          <div className="text-[12.5px] text-ink2 mb-2">
            <span className="text-ink3">You asked: </span>{heard}
          </div>
        )}
        {phase === 'listening' && !heard && (
          <div className="text-[12.5px] text-ink3">Ask your question…</div>
        )}
        {reply && (
          // Same renderer as chat/notes/tiles, so a spoken answer's tables, lists and code
          // look identical to everywhere else. `streaming` while tokens are still arriving
          // repairs half-written syntax — otherwise the tail shows raw ** and ``` markers
          // until the model closes the construct.
          <Markdown
            text={reply}
            textSize="text-[13px]"
            streaming={phase === 'thinking'}
            onNavigate={onNavigate}
          />
        )}
        {phase === 'thinking' && !reply && (
          <div className="text-[12.5px] text-ink3">Working on it…</div>
        )}
      </div>
    </div>
  );
}
