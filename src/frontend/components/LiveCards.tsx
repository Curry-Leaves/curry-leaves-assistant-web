import { useState } from 'react';
import { Icon } from './chrome/Icon';
import { api } from '../api/client';
import type { LiveCard } from '../api/socket';

const KIND_META: Record<string, { label: string; tone: string }> = {
  'open-loop': { label: 'Open loop', tone: 'text-accent-ink' },
  'reminder': { label: 'Reminder', tone: 'text-amber-600' },
  'answer': { label: 'Answer', tone: 'text-accent-ink' },
  'ask-this': { label: 'Ask this', tone: 'text-amber-600' },
  'decided-before': { label: 'Decided before', tone: 'text-accent-ink' },
  'conflict': { label: 'Conflict', tone: 'text-rec' },
  'close-proposal': { label: 'Close proposal', tone: 'text-accent-ink' },
  'suggestion': { label: 'Suggestion', tone: 'text-accent-ink' },
  'clarify': { label: 'Clarify', tone: 'text-amber-600' },
  'talking-point': { label: 'Talking point', tone: 'text-accent-ink' },
};

/** The in-meeting live context rail: quiet cards from the backend engine. Dismiss removes a
 *  card; a close-proposal / open-loop carrying a todo refId can resolve it inline. */
export function LiveCards({ cards, onDismiss }: {
  cards: LiveCard[];
  onDismiss: (idx: number) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] uppercase tracking-wider text-ink3 font-600 px-0.5">Context</div>
      {cards.map((c, i) => (
        <Card key={`${c.text}-${i}`} card={c} onDismiss={() => onDismiss(i)} />
      ))}
    </div>
  );
}

function Card({ card, onDismiss }: { card: LiveCard; onDismiss: () => void }) {
  const meta = KIND_META[card.kind] || { label: card.kind, tone: 'text-ink2' };
  const [resolved, setResolved] = useState(false);
  const canResolve = !!card.refId && (card.kind === 'close-proposal' || card.kind === 'open-loop');

  const resolve = async () => {
    if (!card.refId) return;
    try { await api.updateTodo(card.refId, { done: true }); setResolved(true); }
    catch { /* noop */ }
    setTimeout(onDismiss, 900);
  };

  return (
    <div className="rounded-[10px] border border-border bg-card px-3 py-2.5 shadow-soft">
      <div className={`text-[10px] font-700 uppercase tracking-wider ${meta.tone}`}>{meta.label}</div>
      <div className="text-[12.5px] text-ink2 leading-snug mt-1">{card.text}</div>
      {card.source && <div className="text-[10.5px] text-ink3 mt-1">{card.source}</div>}
      <div className="flex items-center gap-2 mt-2">
        {canResolve && (
          <button type="button" onClick={resolve} disabled={resolved}
            className="text-[11px] px-2 py-0.5 rounded-[6px] bg-accent-soft text-accent-ink font-550 disabled:opacity-60">
            {resolved ? 'Done ✓' : 'Mark done'}
          </button>
        )}
        <button type="button" onClick={onDismiss} className="text-[11px] px-2 py-0.5 rounded-[6px] text-ink3 hover:bg-hover inline-flex items-center gap-1">
          <Icon name="x" size={10} /> Dismiss
        </button>
      </div>
    </div>
  );
}
