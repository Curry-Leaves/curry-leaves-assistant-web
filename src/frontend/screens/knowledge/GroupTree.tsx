import { useState, type ReactNode } from 'react';

/**
 * A two-level collapsible tree — groups (folder rows with a rotating chevron + count) whose
 * items are leaf rows (dot glyph) beneath them. Same geometry and visuals as the Knowledge
 * Hub's TreeView (BASE_PAD/STEP/CHEV_MID, guide lines, chevron, leaf dot) so Skills and
 * Semantic read as the same tree, without forcing their data through the note-only TreeNode.
 */
const BASE_PAD = 10;
const STEP = 15;
const CHEV_MID = 7;

export interface TreeGroup<T> {
  key: string;
  label: string;
  items: T[];
}

function Guide({ left, bottom }: { left: number; bottom?: number | string }) {
  return (
    <div aria-hidden className="absolute pointer-events-none"
      style={{ left, top: 0, bottom: bottom ?? 0, borderLeft: '0.5px solid var(--color-border)' }} />
  );
}

export function GroupTree<T>({ groups, activeId, idOf, labelOf, badgeOf, onPick, onDelete, forceOpen }: {
  groups: TreeGroup<T>[];
  activeId: string | null;
  idOf: (item: T) => string;
  labelOf: (item: T) => string;
  badgeOf?: (item: T) => ReactNode;   // trailing chip (e.g. subject / type)
  onPick: (item: T) => void;
  onDelete?: (item: T) => void;
  /** While filtering, show every group open so matches aren't hidden behind a closed row. */
  forceOpen?: boolean;
}) {
  // Which groups the user has expanded. Empty = all closed on load, matching the note tree —
  // the rail opens as a short scannable list rather than dumping every item.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <div>
      {groups.map((g, gi) => {
        // Default the group holding the current selection to open — otherwise creating a skill
        // (which selects it) would highlight a row hidden inside a closed group. It's only a
        // DEFAULT: once the user clicks the row, their explicit choice wins, so a group can
        // still be collapsed while something inside it is selected.
        const holdsActive = activeId != null && g.items.some((i) => idOf(i) === activeId);
        const isOpen = forceOpen || (open[g.key] ?? holdsActive);
        const lastGroup = gi === groups.length - 1;
        return (
          <div key={g.key}>
            {/* group row (folder) */}
            <div
              onClick={() => { if (!forceOpen) setOpen((o) => ({ ...o, [g.key]: !isOpen })); }}
              style={{ paddingLeft: BASE_PAD }}
              className="group relative flex items-center gap-1 pr-1.5 min-h-[26px] cursor-pointer select-none hover:bg-border-soft transition-colors"
            >
              <span className="w-3.5 h-3.5 flex-none inline-flex items-center justify-center text-ink3">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden
                  className={`transition-transform duration-100 ${isOpen ? 'rotate-90' : ''}`}>
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="flex-1 min-w-0 text-[11.5px] font-500 text-ink2 uppercase tracking-wide truncate">{g.label}</span>
              <span className="flex-none text-[10px] text-ink3 tabular-nums w-4 text-right">{g.items.length}</span>
            </div>

            {/* leaf rows */}
            {isOpen && g.items.map((item, idx) => {
              const id = idOf(item);
              const isActive = activeId === id;
              const lastLeaf = idx === g.items.length - 1;
              return (
                <div key={id}
                  onClick={() => onPick(item)}
                  style={{ paddingLeft: BASE_PAD + STEP }}
                  className={`group/row relative flex items-center gap-1 pr-1.5 min-h-[28px] cursor-pointer select-none transition-colors ${
                    isActive ? 'bg-border' : 'hover:bg-border-soft'}`}
                >
                  {/* vertical guide from the group chevron down through its children */}
                  <Guide left={BASE_PAD + CHEV_MID} bottom={lastLeaf ? '50%' : 0} />
                  {/* elbow into this row */}
                  <div aria-hidden className="absolute pointer-events-none"
                    style={{ left: BASE_PAD + CHEV_MID, top: '50%', width: STEP - CHEV_MID, borderTop: '0.5px solid var(--color-border)' }} />

                  <span className={`w-[5px] h-[5px] rounded-full flex-none mr-0.5 ml-3.5 ${isActive ? 'bg-accent' : 'bg-ink3'}`} />
                  <span className={`flex-1 min-w-0 text-[11.5px] truncate ${isActive ? 'font-500 text-ink' : 'text-ink2'}`}>
                    {labelOf(item)}
                  </span>
                  {badgeOf?.(item)}
                  {onDelete && (
                    <button type="button" title="Forget this"
                      onClick={(e) => { e.stopPropagation(); onDelete(item); }}
                      className="flex-none w-5 h-5 grid place-items-center rounded-[5px] text-ink3 hover:bg-rec/10 hover:text-rec opacity-0 group-hover/row:opacity-100">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
            {!lastGroup && <div className="h-px" />}
          </div>
        );
      })}
    </div>
  );
}
