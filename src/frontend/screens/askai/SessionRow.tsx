import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import type { ChatSessionMeta } from '../../types';

const relTime = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
};

// ─── session row ──────────────────────────────────────────────────────────────
export function SessionRow({ s, agentName, active, busy, onOpen, onDelete }: {
  s: ChatSessionMeta; agentName?: string; active: boolean; busy: boolean; onOpen: () => void; onDelete: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`w-full flex items-center gap-2 px-2.5 py-2 text-left border-l-2 cursor-pointer ${
        active ? 'bg-accent-soft/40 border-accent' : hover ? 'border-border bg-card/60' : 'border-transparent'
      }`}
    >
      <span className={`w-[7px] h-[7px] rounded-full flex-none ${busy ? 'an-pulse bg-accent' : active ? 'bg-accent' : 'bg-ink3'}`} />
      <span className={`flex-1 min-w-0 text-[12.5px] truncate ${active ? 'text-ink font-500' : 'text-ink2'}`}>{s.title || 'New chat'}</span>
      {agentName && <span className="font-mono text-[8px] text-accent border border-accent rounded px-1 flex-none uppercase max-w-[88px] truncate">{agentName}</span>}
      {hover ? (
        <button type="button" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(); }} className="w-4 h-4 flex items-center justify-center text-ink3 hover:text-rec flex-none">
          <Icon name="trash" size={11} />
        </button>
      ) : (
        <span className="font-mono text-[9.5px] text-ink3 flex-none">{relTime(s.updatedAt * 1000)}</span>
      )}
    </div>
  );
}
