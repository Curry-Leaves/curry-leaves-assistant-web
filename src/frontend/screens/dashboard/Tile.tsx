import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { TileBody } from './TileBody';
import type { Agent, Tile as TileT, TileStyle } from '../../types';
import { describe } from '../../types/schedule';

const STATUS_DOT: Record<TileT['state']['lastRunStatus'], string> = {
  running: 'an-pulse bg-accent', success: 'bg-ok', error: 'bg-rec', idle: 'bg-ink3',
};

// Card chrome per style — every class here resolves against theme-registered
// tokens (bg/card/sidebar/border/accent), so each variant is correct on all
// seven themes with no per-theme special-casing.
const STYLE_FRAME: Record<TileStyle, string> = {
  card: 'bg-card border border-border rounded-[12px] shadow-soft hover:shadow-pop hover:border-border-soft transition-shadow duration-150',
  flat: 'bg-sidebar border border-transparent rounded-[12px]',
  outlined: 'bg-bg border-2 border-border rounded-[12px]',
  'accent-bar': 'bg-card border border-border rounded-[12px] shadow-soft hover:shadow-pop transition-shadow duration-150 border-l-[3px] border-l-accent',
  // Fancy trio — chrome lives in index.css (color-mix/backdrop-filter/conic-gradient
  // aren't expressible as plain Tailwind utilities against arbitrary theme tokens).
  glass: 'tile-glass rounded-[12px]',
  glow: 'tile-glow rounded-[12px]',
  'gradient-edge': 'tile-gradient-edge rounded-[12px]',
};

// Header divider + fill per style — the header gets a faint sunken tint so it
// reads as a title bar distinct from the body, not just a line under it.
// Glass keeps things translucent (an opaque fill would break the frosted
// look); outlined echoes its bolder outer border weight. Only `flat` uses the
// bold sidebar-colored chrome — every other style stays light/neutral so a
// grid of tiles doesn't read as a wall of repeated dark-green banners.
const STYLE_HEADER: Record<TileStyle, string> = {
  card: 'border-border-soft bg-border-soft/50',
  flat: 'tile-header-sidebar border-sidebar-border bg-sidebar',
  outlined: 'border-border border-b-2 bg-transparent',
  'accent-bar': 'border-border-soft bg-border-soft/50',
  glass: 'tile-glass-strip bg-transparent',
  glow: 'border-border-soft bg-border-soft/50',
  'gradient-edge': 'border-border-soft bg-border-soft/50',
};

// Whether a style's header sits on the dark sidebar surface (needs
// sidebar-scoped text/icon tokens) vs. a light surface (needs plain ones).
const STYLE_HEADER_DARK: Record<TileStyle, boolean> = {
  card: false, flat: true, outlined: false, 'accent-bar': false, glass: false, glow: false, 'gradient-edge': false,
};

// Footer divider per style — kept as a plain, quieter strip (no fill) so it
// reads as a lightweight metadata line, not a second header.
const STYLE_FOOTER: Record<TileStyle, string> = {
  card: 'border-border',
  flat: 'border-border-soft',
  outlined: 'border-border border-t-2',
  'accent-bar': 'border-border',
  glass: 'tile-glass-strip',
  glow: 'border-border',
  'gradient-edge': 'border-border-soft',
};

function refreshLabel(tile: TileT): string {
  const r = tile.config.refresh;
  if (r.mode === 'manual') return 'manual refresh';
  if (r.mode === 'event') return `on ${r.eventType}`;
  return describe(r.schedule).toLowerCase();
}

function ago(iso: string | null): string {
  if (!iso) return 'never run';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** One tile's chrome: title, status, menu (refresh/edit/remove) + delegates body
 *  render to TileBody. The drag handle is the header (react-grid-layout targets
 *  `.tile-drag-handle`); the resize handle is supplied by the grid itself. */
export function Tile({
  tile, agent, onRefresh, onConfigure, onRemove,
}: {
  tile: TileT;
  agent: Agent | undefined;
  onRefresh: () => void;
  onConfigure: () => void;
  onRemove: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const running = tile.state.lastRunStatus === 'running';
  const style = tile.config.style;
  const frame = STYLE_FRAME[style] ?? STYLE_FRAME.card;
  const header = STYLE_HEADER[style] ?? STYLE_HEADER.card;
  const footer = STYLE_FOOTER[style] ?? STYLE_FOOTER.card;
  const headerDark = STYLE_HEADER_DARK[style] ?? false;
  const headerInk = headerDark ? 'text-sidebar-ink' : 'text-ink';
  const headerInk3 = headerDark ? 'text-sidebar-ink3' : 'text-ink3';
  const headerHover = headerDark ? 'hover:text-sidebar-ink hover:bg-sidebar-border-soft' : 'hover:text-ink hover:bg-border-soft';

  return (
    <div className={`w-full h-full flex flex-col overflow-visible relative ${frame} ${running ? 'ring-2 ring-accent/60 shadow-[0_0_0_4px_var(--accent-soft)]' : ''} transition-shadow duration-200`}>
      {/* Working: an indeterminate accent bar sweeps across the top edge so a tile
          with a live agent run reads at a glance across the whole dashboard grid. */}
      {running && (
        <div className="absolute top-0 left-0 right-0 h-[3px] overflow-hidden rounded-t-[12px] z-10 pointer-events-none">
          <div className="tile-progress absolute inset-y-0 w-1/3 bg-accent rounded-full" />
        </div>
      )}
      <div className={`tile-drag-handle flex items-center gap-2.5 px-3.5 py-2.5 border-b cursor-move flex-none rounded-t-[12px] ${header} ${running ? 'bg-accent-soft/50' : ''}`}>
        <span className={`w-[6px] h-[6px] rounded-full flex-none ring-2 ${headerDark ? 'ring-sidebar' : 'ring-card'} ${STATUS_DOT[tile.state.lastRunStatus]}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-[12.5px] font-650 tracking-[-0.005em] truncate ${headerInk}`}>{tile.title}</div>
          <div className={`text-[10px] truncate ${headerInk3}`}>{agent?.name ?? tile.agentId}</div>
        </div>
        {tile.config.alert?.trim() && (
          <span title={`Alert: ${tile.config.alert}`} className="flex-none text-accent"><Icon name="bell" size={13} /></span>
        )}
        <button type="button" title="Refresh now" onClick={(e) => { e.stopPropagation(); onRefresh(); }} disabled={running}
          className={`rgl-cancel flex items-center justify-center w-6 h-6 rounded-[7px] active:scale-95 transition-colors flex-none ${headerInk3} ${headerHover}`}>
          <span className={running ? 'animate-spin' : ''}><Icon name="refresh" size={12} /></span>
        </button>
        <div className="relative flex-none">
          <button type="button" title="Tile options" onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
            className={`rgl-cancel flex items-center justify-center w-6 h-6 rounded-[7px] transition-colors ${headerInk3} ${headerHover}`}>
            <Icon name="more" size={13} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onMouseDown={() => setMenuOpen(false)} />
              <div className="rgl-cancel absolute right-0 top-7 z-50 w-[150px] rounded-[10px] border border-border bg-card shadow-pop p-1 an-rise">
                <button type="button" onClick={() => { setMenuOpen(false); onConfigure(); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] text-[12px] text-ink2 hover:bg-sidebar text-left">
                  <Icon name="edit" size={13} /> Configure
                </button>
                <button type="button" onClick={() => { setMenuOpen(false); onRemove(); }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] text-[12px] text-ink2 hover:bg-sidebar hover:text-rec text-left">
                  <Icon name="trash" size={13} /> Remove
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col">
        {tile.state.lastRunStatus === 'error' && !tile.state.lastOutput
          ? <div className="text-[12px] text-rec">Last run failed. Try refreshing.</div>
          : <TileBody output={tile.state.lastOutput} emptyMessage={tile.config.emptyMessage} />}
      </div>

      <div className={`px-3.5 pr-6 py-1.5 border-t rounded-b-[12px] flex-none flex items-center justify-between ${footer}`}>
        <span className="font-mono text-[9.5px] text-ink3">{ago(tile.state.lastRunAt)}</span>
        <span className="font-mono text-[9.5px] text-ink3">{refreshLabel(tile)}</span>
      </div>
    </div>
  );
}
