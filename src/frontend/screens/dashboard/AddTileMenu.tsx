import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import type { Agent } from '../../types';

/** "+ Add tile" affordance: picks an agent, hands off to the caller which adds the
 *  tile then opens its config modal for the initial Focus/Rules/format/refresh setup. */
export function AddTileMenu({ agents, onPick }: { agents: Agent[]; onPick: (agentId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] hover:bg-accent-dark">
        <Icon name="plus" size={13} color="var(--color-on-accent)" /> Add tile
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div className="absolute right-0 top-9 z-50 w-[240px] max-h-[320px] overflow-y-auto rounded-[10px] border border-border bg-card shadow-pop p-1.5">
            <div className="px-2 pt-1 pb-1.5 text-[10px] font-600 tracking-wider uppercase text-ink3">Pick an agent</div>
            {agents.length === 0 && <div className="px-2 py-4 text-[12px] text-ink3 text-center">No agents yet.</div>}
            {agents.map((a) => (
              <button key={a.id} type="button" onClick={() => { setOpen(false); onPick(a.id); }}
                className="w-full flex flex-col items-start gap-0.5 px-2.5 py-1.5 rounded-[7px] hover:bg-bg text-left">
                <span className="text-[12.5px] text-ink font-500">{a.name}</span>
                {a.description && <span className="text-[10.5px] text-ink3 truncate w-full">{a.description}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
