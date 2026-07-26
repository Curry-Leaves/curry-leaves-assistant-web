/** Theme adapter for the ported rich blocks.
 *
 * The block editors under this folder came from the buddy app, where `useTheme()` is a React
 * context returning hardcoded oklch colors for one of two themes (paper/dark). Curry Leaves
 * instead drives theming through CSS custom properties on `document.documentElement`, which is
 * why it can ship six themes rather than two.
 *
 * So this shim keeps buddy's *shape* — a `useTheme()` hook returning `t.bg`, `t.hair`, … — while
 * every value resolves to a curry-leaves token. The blocks therefore restyle themselves for
 * whichever theme is active, including the four buddy never had, with no per-file changes.
 *
 * The one value that can't be a CSS variable is `name`: some blocks branch on `t.name === 'dark'`
 * in JS (to pick a mermaid theme, or an SVG fill that CSS can't reach). That's read from the live
 * `data-theme` attribute and re-read on change.
 */
import { useEffect, useState } from 'react';

/** Themes whose backgrounds are dark — blocks that branch in JS need to know. */
const DARK_THEMES = new Set(['dark', 'midnight', 'noir']);

export interface BlockTheme {
  name: string;
  bg: string;
  bgRaised: string;
  bgSunken: string;
  ink: string;
  inkSoft: string;
  muted: string;
  faint: string;
  hair: string;
  hairSoft: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  green: string;
  blue: string;
  rec: string;
  shadow: string;
  shadowLg: string;
}

const TOKENS: Omit<BlockTheme, 'name'> = {
  bg: 'var(--color-bg)',
  bgRaised: 'var(--color-card)',
  bgSunken: 'var(--color-sidebar)',
  ink: 'var(--color-ink)',
  inkSoft: 'var(--color-ink2)',
  muted: 'var(--color-ink3)',
  faint: 'var(--color-faint)',
  hair: 'var(--color-border)',
  hairSoft: 'var(--color-border-soft)',
  accent: 'var(--color-accent)',
  accentSoft: 'var(--color-accent-soft)',
  accentInk: 'var(--color-accent-ink)',
  green: 'var(--color-ok)',
  blue: 'var(--color-blue)',
  rec: 'var(--color-rec)',
  shadow: 'var(--shadow-soft)',
  shadowLg: 'var(--shadow-pop)',
};

function currentThemeName(): string {
  if (typeof document === 'undefined') return 'default';
  return document.documentElement.getAttribute('data-theme') || 'default';
}

/** Buddy's `useTheme()`, backed by curry-leaves tokens. */
export function useTheme(): BlockTheme {
  // Only `name` is stateful — the colors are CSS variables the browser re-resolves on its own.
  const [name, setName] = useState(currentThemeName);

  useEffect(() => {
    const obs = new MutationObserver(() => setName(currentThemeName()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // Blocks compare `t.name === 'dark'` to mean "is this a dark surface?" — report the literal
  // 'dark' for every dark theme so midnight/noir get the dark treatment too.
  return { ...TOKENS, name: DARK_THEMES.has(name) ? 'dark' : name };
}
