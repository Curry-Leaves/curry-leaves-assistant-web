import { Icon } from '../../components/chrome/Icon';
import { countNotes, type TreeNode } from './treeUtils';
import { RowMenu, type MenuItem } from './RowMenu';

// The tree can drive structural actions (create/move/archive). A parent supplies a factory
// that, for a given node, returns its "⋯" menu items — folders and notes get different sets.
// `onNewNoteIn` powers the inline "＋" affordance shown on folder rows.
export interface TreeActions {
  menuFor: (node: TreeNode) => MenuItem[];
  onNewNoteIn?: (folderId: string) => void;
}

// ── tree geometry (mirrors old curry-leaves's HubTree) ──────────────────────────────────
const BASE_PAD = 10;   // left padding of a depth-0 row
const STEP = 15;       // indent per nesting level
const CHEV_MID = 7;    // chevron column centre (where guide lines sit)

// A faint tree connector (vertical guide or horizontal elbow). The only thing that
// must be inline is its computed position — everything visual lives in CSS vars.
function Guide({ left, top, bottom, width }: { left: number; top?: number | string; bottom?: number | string; width?: number }) {
  return (
    <div aria-hidden className="absolute pointer-events-none"
      style={{ left, top: top ?? 0, bottom, width, borderLeft: width ? undefined : '0.5px solid var(--color-border)', borderTop: width ? '0.5px solid var(--color-border)' : undefined }} />
  );
}

// ── recursive row ────────────────────────────────────────────────────────────────
export function TreeRow({ node, depth, lastChain, activeId, expanded, toggle, onPick, actions }: {
  node: TreeNode; depth: number; lastChain: boolean[];
  activeId: string | null; expanded: Record<string, boolean>;
  toggle: (id: string) => void; onPick: (path: string) => void;
  actions?: TreeActions;
}) {
  const isFolder = node.kind === 'folder';
  // Default CLOSED: a folder opens only once it's explicitly expanded (or while a search/filter
  // force-opens the whole tree). Keeps a large hub scannable at a glance instead of dumping
  // every note on load.
  const isOpen = expanded[node.id] === true;
  const isActive = activeId === node.id;
  const indent = BASE_PAD + depth * STEP;

  return (
    <div>
      <div
        onClick={() => (isFolder ? toggle(node.id) : onPick(node.path!))}
        style={{ paddingLeft: indent }}
        className={`group relative flex items-center gap-1 pr-1.5 cursor-pointer select-none transition-colors ${
          isFolder ? 'min-h-[26px]' : 'min-h-[28px]'} ${isActive ? 'bg-border' : 'hover:bg-border-soft'}`}
      >
        {/* per-ancestor vertical guides */}
        {Array.from({ length: depth }).map((_, i) => {
          const continues = !lastChain[i];
          if (!continues && i !== depth - 1) return null;
          return <Guide key={i} left={BASE_PAD + i * STEP + CHEV_MID} bottom={continues ? 0 : '50%'} />;
        })}
        {/* elbow tick from the immediate parent guide across to this row */}
        {depth >= 1 && (
          <Guide left={BASE_PAD + (depth - 1) * STEP + CHEV_MID} top="50%"
            width={isFolder && node.children.length ? STEP - CHEV_MID : STEP} />
        )}

        {/* chevron column (folders only; notes keep the column for alignment) */}
        <span className={`w-3.5 h-3.5 flex-none inline-flex items-center justify-center ${isFolder ? 'text-ink3' : 'text-transparent'}`}>
          {isFolder && node.children.length > 0 && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden
              className={`transition-transform duration-100 ${isOpen ? 'rotate-90' : ''}`}>
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>

        {/* leaf glyph: a small dot tinted by active state */}
        {!isFolder && <span className={`w-[5px] h-[5px] rounded-full flex-none mr-0.5 ${isActive ? 'bg-accent' : 'bg-ink3'}`} />}

        <span className={`flex-1 min-w-0 text-[11.5px] truncate ${
          isFolder ? 'font-500 text-ink2' : isActive ? 'font-500 text-ink' : 'text-ink2'}`}>
          {node.name}
        </span>

        {/* row actions (appear on hover) */}
        {actions && isFolder && actions.onNewNoteIn && (
          <button type="button" title="New note in this folder"
            onClick={(e) => { e.stopPropagation(); actions.onNewNoteIn!(node.id); }}
            className="flex-none w-5 h-5 grid place-items-center rounded-[5px] text-ink3 hover:bg-border hover:text-ink opacity-0 group-hover:opacity-100">
            <Icon name="plus" size={12} />
          </button>
        )}
        {actions && <RowMenu items={actions.menuFor(node)} />}

        {isFolder && <span className="flex-none text-[10px] text-ink3 tabular-nums w-4 text-right group-hover:hidden">{countNotes(node)}</span>}
      </div>

      {isFolder && isOpen && node.children.length > 0 && (
        <div>
          {node.children.map((child, idx) => (
            <TreeRow key={child.id} node={child} depth={depth + 1}
              lastChain={[...lastChain, idx === node.children.length - 1]}
              activeId={activeId} expanded={expanded} toggle={toggle} onPick={onPick} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}
