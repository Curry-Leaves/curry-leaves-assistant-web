import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';

// brain/cog glyph that slowly rotates while the model is reasoning
function ThinkingIcon({ live }: { live: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className={live ? 'an-spin' : ''} aria-hidden>
      <path d="M12 2a4.5 4.5 0 0 0-4.5 4.5c0 .5.08.98.23 1.43A4 4 0 0 0 6 15.5a4 4 0 0 0 4 4 3.5 3.5 0 0 0 2 .62 3.5 3.5 0 0 0 2-.62 4 4 0 0 0 4-4 4 4 0 0 0-1.73-7.57c.15-.45.23-.93.23-1.43A4.5 4.5 0 0 0 12 2Z"
        stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 2v18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

// ─── thinking block ───────────────────────────────────────────────────────────
// While the model is reasoning (`live`), shows a scrolling tail of the last lines.
// Once thinking is done it auto-collapses to a one-line header; click anywhere on the
// header to expand the full reasoning.
export function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);
  // keep the live tail pinned to the newest text as it streams in
  useEffect(() => { if (live && tailRef.current) tailRef.current.scrollTop = tailRef.current.scrollHeight; }, [text, live]);
  // auto-collapse the moment thinking finishes
  useEffect(() => { if (!live) setExpanded(false); }, [live]);

  const hasText = text.trim().length > 0;
  const showTail = live && !expanded;
  const showFull = expanded;
  // a one-line preview of the reasoning, shown in the collapsed bar
  const preview = text.replace(/\s+/g, ' ').trim();

  return (
    <div className={`mb-1 min-w-0 overflow-hidden ${(showTail || showFull) ? 'rounded-[11px] border border-border bg-card' : ''}`}>
      <button
        type="button"
        onClick={() => hasText && setExpanded((o) => !o)}
        className={`w-full min-w-0 flex items-center gap-1.5 px-1 py-0.5 text-left ${hasText ? 'hover:opacity-70 cursor-pointer' : 'cursor-default'}`}
      >
        <span className="text-ink3 flex-none">{hasText ? <Icon name={showFull ? 'chevD' : 'chevR'} size={10} /> : <span className="inline-block w-2.5" />}</span>
        <span className={`flex-none ${live ? 'text-accent' : 'text-ink3'}`}><ThinkingIcon live={live} /></span>
        {live ? (
          <span className="text-[12px] text-accent an-blink">Thinking…</span>
        ) : showFull ? (
          <span className="text-[12px] text-ink3">Thought process</span>
        ) : (
          <span className="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
            <span className="text-[12px] text-ink3 flex-none">Thought</span>
            <span className="text-[11.5px] text-faint truncate italic">{preview}</span>
          </span>
        )}
      </button>

      {showTail && (
        <div
          ref={tailRef}
          className="px-3 pb-2 max-h-[4.2em] overflow-hidden text-[12px] text-ink3 whitespace-pre-wrap break-all leading-relaxed font-mono [mask-image:linear-gradient(to_bottom,transparent,#000_55%)]"
        >
          {text}
        </div>
      )}
      {showFull && (
        <div className="px-3 pb-2.5 max-h-[300px] overflow-y-auto text-[12.5px] text-ink whitespace-pre-wrap break-all leading-relaxed font-mono opacity-90">
          {text}
        </div>
      )}
    </div>
  );
}
