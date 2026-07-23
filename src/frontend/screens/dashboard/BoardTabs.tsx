import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import type { BoardSummary } from '../../types';

/** Switcher tab strip for named boards — same visual language as the app's own
 *  top-level tab strip. Double-click a tab to rename it inline. */
export function BoardTabs({
  boards, activeId, onSelect, onCreate, onRename, onDelete,
}: {
  boards: BoardSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = (id: string) => {
    const name = draft.trim();
    setRenaming(null);
    if (name) onRename(id, name);
  };

  return (
    <div className="flex items-center gap-1 px-3 h-11 flex-none overflow-x-auto">
      {boards.map((b) => {
        const active = b.id === activeId;
        return renaming === b.id ? (
          <input key={b.id} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(b.id)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(b.id); if (e.key === 'Escape') setRenaming(null); }}
            className="h-7 px-2 rounded-[6px] border border-accent bg-card text-[12.5px] text-ink outline-none w-[120px]" />
        ) : (
          <div key={b.id} className="group relative">
            <button type="button" onClick={() => onSelect(b.id)} onDoubleClick={() => { setRenaming(b.id); setDraft(b.name); }}
              className={`flex items-center gap-1.5 h-7 pl-3 pr-2 rounded-[6px] text-[12.5px] whitespace-nowrap ${
                active ? 'bg-accent-soft text-accent-ink font-550' : 'text-ink2 hover:bg-border-soft'}`}>
              {b.name}
            </button>
            {boards.length > 1 && (
              <button type="button" title="Delete board"
                onClick={(e) => { e.stopPropagation(); if (confirm(`Delete board "${b.name}"?`)) onDelete(b.id); }}
                className="absolute -right-0.5 -top-0.5 hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full bg-ink3 text-bg">
                <Icon name="x" size={9} />
              </button>
            )}
          </div>
        );
      })}
      <button type="button" onClick={onCreate} title="New board"
        className="flex items-center justify-center w-7 h-7 rounded-[6px] text-ink3 hover:text-ink hover:bg-border-soft flex-none">
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}
