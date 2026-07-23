// Dashboard (tile boards)
import type { ScheduleSpec } from './schedule';
export type TileOutputFormat = 'summary' | 'list' | 'metric' | 'table' | 'markdown' | 'diff';
export interface TileDiffLine { kind: 'add' | 'remove' | 'context'; text: string }
// Card chrome, independent of output format — purely how the tile's frame looks.
// Each variant is built only from theme-registered tokens (bg/card/border/accent),
// so it stays correct across every theme without per-theme special-casing.
export type TileStyle = 'card' | 'flat' | 'outlined' | 'accent-bar' | 'glass' | 'glow' | 'gradient-edge';
export type TileRefresh =
  | { mode: 'manual' }
  | { mode: 'schedule'; schedule: ScheduleSpec }
  | { mode: 'event'; eventType: string };

export interface TileShapedOutput {
  format: TileOutputFormat;
  value: string | string[] | { value: string; label: string | null; delta?: string | null } | { header: string[]; rows: string[][] } | TileDiffLine[];
  empty?: boolean;
}

export interface Tile {
  id: string;
  agentId: string;
  title: string;
  layout: { x: number; y: number; w: number; h: number };
  config: { focus: string; rules: string; outputFormat: TileOutputFormat; emptyMessage: string; markdownTemplate: string; style: TileStyle; alert: string; refresh: TileRefresh };
  state: {
    lastOutput: TileShapedOutput | null;
    lastRunAt: string | null;
    lastRunStatus: 'idle' | 'running' | 'success' | 'error';
    lastJobId: string | null;
  };
}

export interface Board {
  id: string;
  name: string;
  tiles: Tile[];
  order: number;
  updatedAt: string;
}

export interface BoardSummary { id: string; name: string; order: number }
