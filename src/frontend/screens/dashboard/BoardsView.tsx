import { useCallback, useEffect, useMemo, useState } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';
import { api, subscribeEvents } from '../../api/client';
import { BoardTabs } from './BoardTabs';
import { AddTileMenu } from './AddTileMenu';
import { Tile } from './Tile';
import { TileConfigPanel } from './TileConfigModal';
import { DashboardEmptyState } from './EmptyState';
import type { Agent, Board, BoardSummary, AppEvent, Tile as TileT } from '../../types';

const ResponsiveGridLayout = WidthProvider(Responsive);

/** Tile-based agent boards (the classic dashboard): switch between named boards, add
 *  agents as tiles, drag/resize freely, configure each tile's brief + output shape +
 *  refresh, and watch tiles repopulate live as their agents run. Rendered as the
 *  "Boards" view inside DashboardScreen; the Inbox is the default view. */
export function BoardsView({ agents, focusBoardId }: { agents: Agent[]; focusBoardId?: string | null }) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [configuring, setConfiguring] = useState<TileT | null>(null);
  const [triggerTypes, setTriggerTypes] = useState<string[]>([]);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  // Tileable = any agent that can back a board tile. We intentionally DON'T exclude
  // `internal` here: the seeded dashboard-watcher is an internal (plumbing) agent yet is
  // exactly the general-purpose tile agent — hiding it left the Add-tile menu empty on a
  // stock install. We only exclude chat-surface agents, which aren't meant to run as tiles.
  const tileableAgents = useMemo(() => agents.filter((a) => !a.surfaces.includes('chat')), [agents]);

  const loadBoards = useCallback(async () => {
    const list = await api.listBoards().catch(() => []);
    setBoards(list);
    if (list.length && !list.some((b) => b.id === activeId)) setActiveId(list[0].id);
  }, [activeId]);

  const loadActiveBoard = useCallback(async () => {
    if (!activeId) return;
    const b = await api.getBoard(activeId).catch(() => null);
    if (b) setBoard(b);
  }, [activeId]);

  useEffect(() => { loadBoards(); }, [loadBoards]);
  useEffect(() => { loadActiveBoard(); }, [loadActiveBoard]);
  useEffect(() => { api.agentOptions().then((o) => setTriggerTypes(o.triggers)).catch(() => {}); }, []);

  // Deep-link from an Inbox "recent tile" card → land on that tile's board.
  useEffect(() => { if (focusBoardId) setActiveId(focusBoardId); }, [focusBoardId]);

  // Live updates: reconcile a single tile's state in place when its run completes,
  // instead of refetching the whole board (keeps drag/resize interactions smooth).
  const onLiveEvent = useCallback((raw: unknown) => {
    const e = raw as AppEvent;
    if (!e.type.startsWith('tile.run.')) return;
    const tileId = e.payload?.tileId as string | undefined;
    const boardId = e.payload?.boardId as string | undefined;
    if (!tileId || boardId !== activeId) return;
    setBoard((b) => {
      if (!b) return b;
      const tiles = b.tiles.map((t) => {
        if (t.id !== tileId) return t;
        if (e.type === 'tile.run.started') return { ...t, state: { ...t.state, lastRunStatus: 'running' as const } };
        if (e.type === 'tile.run.completed') return { ...t, state: { ...t.state, lastOutput: e.payload.output as TileT['state']['lastOutput'], lastRunStatus: 'success' as const, lastRunAt: new Date().toISOString() } };
        if (e.type === 'tile.run.failed') return { ...t, state: { ...t.state, lastRunStatus: 'error' as const, lastRunAt: new Date().toISOString() } };
        return t;
      });
      return { ...b, tiles };
    });
  }, [activeId]);

  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    subscribeEvents(onLiveEvent).then((fn) => { if (gone) fn(); else stop = fn; });
    return () => { gone = true; stop?.(); };
  }, [onLiveEvent]);

  const layouts = useMemo(() => ({
    lg: (board?.tiles ?? []).map((t) => ({ i: t.id, x: t.layout.x, y: t.layout.y, w: t.layout.w, h: t.layout.h, minW: 2, minH: 2 })),
  }), [board]);

  // Persist only when a drag/resize gesture actually ends (onDragStop/onResizeStop
  // hand us the final layout directly) — onLayoutChange fires on every intermediate
  // frame of the gesture too, which would otherwise spam patch calls and race the
  // in-progress drag against a mid-gesture board refetch.
  const commitLayout = (l: Layout[]) => {
    if (!board) return;
    const changed = l.some((li) => {
      const t = board.tiles.find((x) => x.id === li.i);
      return t && (t.layout.x !== li.x || t.layout.y !== li.y || t.layout.w !== li.w || t.layout.h !== li.h);
    });
    if (!changed) return;
    setBoard({ ...board, tiles: board.tiles.map((t) => {
      const li = l.find((x) => x.i === t.id);
      return li ? { ...t, layout: { x: li.x, y: li.y, w: li.w, h: li.h } } : t;
    }) });
    api.patchBoardLayout(board.id, l.map((li) => ({ id: li.i, x: li.x, y: li.y, w: li.w, h: li.h }))).catch(() => {});
  };

  const createBoard = async () => {
    const b = await api.createBoard('New board').catch(() => null);
    if (b) { await loadBoards(); setActiveId(b.id); }
  };
  const renameBoard = async (id: string, name: string) => {
    await api.renameBoard(id, name).catch(() => {});
    loadBoards();
  };
  const deleteBoard = async (id: string) => {
    await api.deleteBoard(id).catch(() => {});
    setActiveId(null);
    loadBoards();
  };

  const addTile = async (agentId: string) => {
    if (!board) return;
    try {
      const tile = await api.addTile(board.id, agentId);
      setBoard({ ...board, tiles: [...board.tiles, tile] });
      setConfiguring(tile);
    } catch {
      alert('Could not add the tile. Please try again.');
    }
  };
  const removeTile = async (tileId: string) => {
    if (!board) return;
    setBoard({ ...board, tiles: board.tiles.filter((t) => t.id !== tileId) });
    api.deleteTile(board.id, tileId).catch(() => {});
  };
  const refreshTile = (tileId: string) => {
    if (!board) return;
    // Fire-and-forget: submit a tile WorkItem (the button returns immediately). Optimistically
    // show 'running'; the tile then updates itself when its run's tile.run.* events arrive over
    // the WebSocket (see onLiveEvent above) — decoupled and scalable, no blocking request.
    setBoard({ ...board, tiles: board.tiles.map((t) => t.id === tileId ? { ...t, state: { ...t.state, lastRunStatus: 'running' } } : t) });
    api.refreshTile(board.id, tileId).catch(() => {});
  };
  const saveTileConfig = async (tileId: string, patch: { title: string; config: TileT['config'] }) => {
    if (!board) return;
    const updated = await api.patchTile(board.id, tileId, patch).catch(() => null);
    if (updated) setBoard({ ...board, tiles: board.tiles.map((t) => t.id === tileId ? updated : t) });
  };

  if (configuring && board) {
    return (
      <TileConfigPanel tile={configuring} agent={agentById.get(configuring.agentId)} triggerTypes={triggerTypes} boardId={board.id}
        onClose={() => setConfiguring(null)}
        onSave={(patch) => saveTileConfig(configuring.id, patch)} />
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Slim board bar — the page title lives in DashboardScreen's header; the active
          board's name reads from its highlighted tab. */}
      <div className="flex items-center px-3 h-10 flex-none border-b border-border-soft">
        <div className="flex-1"><BoardTabs boards={boards} activeId={activeId} onSelect={setActiveId} onCreate={createBoard} onRename={renameBoard} onDelete={deleteBoard} /></div>
        <div className="flex-none"><AddTileMenu agents={tileableAgents} onPick={addTile} /></div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {board && board.tiles.length === 0 && <DashboardEmptyState />}
        {board && board.tiles.length > 0 && (
          <ResponsiveGridLayout
            className="layout"
            layouts={layouts}
            breakpoints={{ lg: 0 }}
            cols={{ lg: 12 }}
            rowHeight={90}
            margin={[12, 12]}
            draggableHandle=".tile-drag-handle"
            draggableCancel=".rgl-cancel"
            isResizable
            isDraggable
            onDragStop={commitLayout}
            onResizeStop={commitLayout}
          >
            {board.tiles.map((t) => (
              <div key={t.id}>
                <Tile tile={t} agent={agentById.get(t.agentId)} onRefresh={() => refreshTile(t.id)}
                  onConfigure={() => setConfiguring(t)} onRemove={() => removeTile(t.id)} />
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  );
}
