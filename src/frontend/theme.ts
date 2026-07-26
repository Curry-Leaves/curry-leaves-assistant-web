/** Theme registry + runtime switching.
 *
 *  Themes are pure CSS-variable remaps defined in index.css under
 *  `[data-theme="…"]`. Switching a theme = setting `document.documentElement`'s
 *  `data-theme` attribute.
 *
 *  The choice is persisted in the backend `settings.json` (appearance.theme) — the
 *  source of truth. localStorage (`curry-leaves.theme`) is kept only as a fast mirror so
 *  the inline script in index.html can apply the theme before first paint (no
 *  flash) without waiting on the HTTP round-trip. `system` follows the OS.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { api } from './api/client';

export type ThemeId = 'system' | 'paper' | 'sepia' | 'default' | 'dark' | 'midnight' | 'mono' | 'noir';
export type ResolvedTheme = Exclude<ThemeId, 'system'>;

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  blurb: string;
  mode: 'light' | 'dark' | 'auto';
  /** Preview swatch — raw CSS colors mirroring the index.css token values. */
  swatch: { bg: string; card: string; ink: string; accent: string };
}

export const THEMES: ThemeMeta[] = [
  {
    id: 'system', label: 'System', blurb: 'Match your OS appearance', mode: 'auto',
    swatch: { bg: 'oklch(0.6 0.012 80)', card: 'oklch(0.985 0.01 85)', ink: 'oklch(0.22 0.018 60)', accent: 'oklch(0.62 0.15 48)' },
  },
  {
    id: 'paper', label: 'Paper', blurb: 'Warm light — the original', mode: 'light',
    swatch: { bg: 'oklch(0.972 0.012 82)', card: 'oklch(0.985 0.01 85)', ink: 'oklch(0.22 0.018 60)', accent: 'oklch(0.62 0.15 48)' },
  },
  {
    id: 'sepia', label: 'Sepia', blurb: 'Warm cream, easy on the eyes', mode: 'light',
    swatch: { bg: 'oklch(0.955 0.022 75)', card: 'oklch(0.975 0.02 78)', ink: 'oklch(0.28 0.032 48)', accent: 'oklch(0.56 0.13 40)' },
  },
  {
    id: 'default', label: 'Default', blurb: 'Warm cream canvas, emerald nav rail', mode: 'light',
    swatch: { bg: 'oklch(0.962 0.009 84.6)', card: 'oklch(1.000 0 0)', ink: 'oklch(0.261 0.012 84.6)', accent: 'oklch(0.370 0.075 164.5)' },
  },
  {
    id: 'dark', label: 'Dark', blurb: 'Neutral warm dark', mode: 'dark',
    swatch: { bg: 'oklch(0.205 0.012 80)', card: 'oklch(0.245 0.013 82)', ink: 'oklch(0.945 0.01 85)', accent: 'oklch(0.71 0.145 50)' },
  },
  {
    id: 'midnight', label: 'Midnight', blurb: 'Deep blue-black', mode: 'dark',
    swatch: { bg: 'oklch(0.185 0.026 258)', card: 'oklch(0.225 0.028 257)', ink: 'oklch(0.95 0.012 250)', accent: 'oklch(0.72 0.15 265)' },
  },
  {
    id: 'mono', label: 'Mono', blurb: 'Pure black on white', mode: 'light',
    swatch: { bg: 'oklch(1 0 0)', card: 'oklch(1 0 0)', ink: 'oklch(0 0 0)', accent: 'oklch(0 0 0)' },
  },
  {
    id: 'noir', label: 'Noir', blurb: 'Pure white on black', mode: 'dark',
    swatch: { bg: 'oklch(0 0 0)', card: 'oklch(0.14 0 0)', ink: 'oklch(1 0 0)', accent: 'oklch(1 0 0)' },
  },
];

const CACHE_KEY = 'curry-leaves.theme'; // pre-paint mirror only; settings.json is authoritative
const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)');

function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v);
}

export function resolveTheme(id: ThemeId): ResolvedTheme {
  if (id === 'system') return prefersDark().matches ? 'dark' : 'sepia';
  return id;
}

/** Last-applied theme from the localStorage mirror (used pre-backend / for the OS watcher). */
export function getCachedTheme(): ThemeId {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    if (isThemeId(v)) return v;
  } catch { /* ignore */ }
  return 'system';
}

function setCachedTheme(id: ThemeId): void {
  try { localStorage.setItem(CACHE_KEY, id); } catch { /* ignore */ }
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = resolveTheme(id);
}

// ── Shared in-memory store so every useTheme() consumer stays in sync ──────────
let _current: ThemeId = getCachedTheme();
const _listeners = new Set<() => void>();

function setCurrent(id: ThemeId): void {
  if (_current === id) return;
  _current = id;
  _listeners.forEach((l) => l());
}
function subscribe(cb: () => void): () => void {
  _listeners.add(cb);
  return () => { _listeners.delete(cb); };
}

/** Pull the authoritative theme from settings.json and apply it. Call on App mount
 *  so the choice is honored even when the Settings screen never opens. */
export async function syncThemeFromBackend(): Promise<void> {
  try {
    const t = (await api.getSettings()).appearance?.theme;
    if (isThemeId(t)) { setCachedTheme(t); applyTheme(t); setCurrent(t); }
  } catch { /* keep the cached theme already applied pre-paint */ }
}

/** Start a process-lifetime watcher so a `system` choice tracks the OS even when
 *  the Settings screen isn't mounted. Call once (App mount); returns a cleanup. */
export function startSystemThemeSync(): () => void {
  const mql = prefersDark();
  const onChange = () => { if (_current === 'system') applyTheme('system'); };
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

/** Theme hook for the pickers. Reads the shared store (kept in sync across all
 *  consumers); the setter applies the theme, mirrors to cache, and persists to
 *  the backend. Initial load comes from syncThemeFromBackend() on App mount. */
export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const theme = useSyncExternalStore(subscribe, () => _current);

  const setTheme = useCallback((id: ThemeId) => {
    setCurrent(id);
    setCachedTheme(id);
    applyTheme(id);
    api.patchAppearance({ theme: id }).catch(() => { /* applied locally; retry on next change */ });
  }, []);

  return [theme, setTheme];
}
