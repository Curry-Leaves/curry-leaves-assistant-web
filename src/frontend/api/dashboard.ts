/** Dashboard tile boards: board/tile CRUD, layout, refresh, AI-drafted tile config. */
import type { Board, BoardSummary, Tile, TileOutputFormat, TileStyle, TileRefresh, TileShapedOutput } from '../types';
import { j } from './http';

export const dashboardApi = {
  listBoards: () => j<BoardSummary[]>('/dashboard/boards'),
  createBoard: (name: string) => j<Board>('/dashboard/boards', { method: 'POST', body: JSON.stringify({ name }) }),
  renameBoard: (id: string, name: string) => j<Board>(`/dashboard/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  reorderBoard: (id: string, order: number) => j<Board>(`/dashboard/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ order }) }),
  deleteBoard: (id: string) => j<{ ok: boolean }>(`/dashboard/boards/${id}`, { method: 'DELETE' }),
  getBoard: (id: string) => j<Board>(`/dashboard/boards/${id}`),
  addTile: (boardId: string, agentId: string, title?: string) =>
    j<Tile>(`/dashboard/boards/${boardId}/tiles`, { method: 'POST', body: JSON.stringify({ agentId, title }) }),
  patchTile: (boardId: string, tileId: string, patch: { title?: string; layout?: Partial<Tile['layout']>; config?: Partial<{ focus: string; rules: string; outputFormat: TileOutputFormat; emptyMessage: string; markdownTemplate: string; style: TileStyle; alert: string; refresh: TileRefresh }> }) =>
    j<Tile>(`/dashboard/boards/${boardId}/tiles/${tileId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTile: (boardId: string, tileId: string) =>
    j<{ ok: boolean }>(`/dashboard/boards/${boardId}/tiles/${tileId}`, { method: 'DELETE' }),
  patchBoardLayout: (boardId: string, layouts: { id: string; x: number; y: number; w: number; h: number }[]) =>
    j<Board>(`/dashboard/boards/${boardId}/layout`, { method: 'PATCH', body: JSON.stringify({ layouts }) }),
  // Fire-and-forget: submits a tile WorkItem, returns its jobId. The tile updates itself via
  // tile.run.* events over the WebSocket — the response is not the output.
  refreshTile: (boardId: string, tileId: string) =>
    j<{ jobId: string }>(`/dashboard/boards/${boardId}/tiles/${tileId}/refresh`, { method: 'POST' }),
  generateTileConfig: (boardId: string, tileId: string, need: string) =>
    j<{ title: string; focus: string; rules: string; outputFormat: TileOutputFormat; markdownTemplate: string; emptyMessage: string; alert: string; refresh: TileRefresh | null }>(
      `/dashboard/boards/${boardId}/tiles/${tileId}/generate-config`, { method: 'POST', body: JSON.stringify({ need }) }),
};
