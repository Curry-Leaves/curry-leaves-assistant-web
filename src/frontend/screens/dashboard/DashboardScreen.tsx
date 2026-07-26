import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { openCommandPalette } from '../../components/CommandPalette';
import { InboxView } from './InboxView';
import { BoardsView } from './BoardsView';
import type { Agent } from '../../types';

/** The Dashboard — the app's home page, styled as an agent desk. The header: desk nav
 *  (Inbox | Boards) on the left, a centered search launcher that opens the global ⌘K
 *  command palette. Below it: the Inbox desk (default) or the classic tile boards. */
export function DashboardScreen({ agents, onOpenAssistants }: { agents: Agent[]; onOpenAssistants?: () => void }) {
  const [view, setView] = useState<'inbox' | 'boards'>('inbox');
  // Set when an Inbox card deep-links into a specific board.
  const [focusBoardId, setFocusBoardId] = useState<string | null>(null);

  const openBoards = (boardId?: string) => {
    setFocusBoardId(boardId ?? null);
    setView('boards');
  };

  const NavLink = ({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick}
      className={`h-[28px] px-2.5 rounded-[7px] text-[12.5px] ${
        active ? 'font-600 text-ink bg-bg border border-border-soft' : 'font-500 text-ink3 hover:text-ink hover:bg-bg/70'}`}>
      {label}
    </button>
  );

  const shortcut = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* desk nav — nav on the left, a centered search launcher (opens ⌘K). No avatar/brand:
          the app name already lives in the window chrome. */}
      <div className="flex items-center gap-5 px-4 h-[52px] flex-none border-b border-border bg-sidebar">
        <nav className="flex items-center gap-1 flex-none">
          <NavLink label="Inbox" active={view === 'inbox'} onClick={() => setView('inbox')} />
          <NavLink label="Boards" active={view === 'boards'} onClick={() => setView('boards')} />
        </nav>
        <div className="flex-1 flex justify-center">
          {/* Not a text field — a launcher. Clicking (or ⌘K anywhere) opens the global
              command palette, which searches asks, notes, recordings, agents, and runs
              actions. Kept centered in the bar as the desk's primary search affordance. */}
          <button type="button" onClick={openCommandPalette} title={`Search & commands (${shortcut})`}
            className="flex items-center gap-2 h-8 pl-2.5 pr-2 rounded-[8px] border border-border bg-bg w-full max-w-[420px] text-ink3 hover:border-ink3 hover:text-ink2 transition-colors">
            <Icon name="search" size={13} color="currentColor" />
            <span className="flex-1 min-w-0 text-left text-[13px] truncate">Search or run a command…</span>
            <span className="flex-none flex items-center gap-0.5 font-mono text-[10px] font-600 text-faint border border-border rounded px-1.5 py-0.5">{shortcut}</span>
          </button>
        </div>
        <div className="flex-none w-[1px]" />
      </div>

      {view === 'inbox'
        ? <InboxView agents={agents} onOpenBoards={openBoards} onOpenAssistants={onOpenAssistants} search="" onSearch={() => {}} />
        : <BoardsView agents={agents} focusBoardId={focusBoardId} />}
    </div>
  );
}
