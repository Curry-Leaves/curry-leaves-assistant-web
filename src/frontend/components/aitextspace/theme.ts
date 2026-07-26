// ─── Theme adapter (curry-leaves CSS tokens) ──────────────────────────────────────
export const t = {
  bg: 'var(--color-bg)', bgRaised: 'var(--color-card)', bgSunken: 'var(--color-sidebar)',
  hair: 'var(--color-border)', hairSoft: 'var(--color-border-soft)',
  ink: 'var(--color-ink)', inkSoft: 'var(--color-ink2)', muted: 'var(--color-ink3)',
  accent: 'var(--color-accent)', accentInk: 'var(--color-accent-ink)', green: 'var(--color-ok)',
};
export type Theme = typeof t;
