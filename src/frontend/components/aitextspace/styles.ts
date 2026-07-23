import type { Theme } from './theme';

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function pillBtn(t: Theme, active: boolean): React.CSSProperties {
  return { height: 24, padding: '0 10px', borderRadius: 5, border: `0.5px solid ${active ? t.accent : t.hair}`, background: active ? `color-mix(in oklch, ${t.accent} 10%, ${t.bgRaised})` : t.bgRaised, color: active ? t.accentInk : t.inkSoft, fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 550, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 };
}

export function primaryBtn(t: Theme, kind: 'primary' | 'ghost' | 'danger', disabled = false): React.CSSProperties {
  const base: React.CSSProperties = { height: 30, padding: '0 14px', borderRadius: 6, fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 };
  if (kind === 'primary') return { ...base, background: t.accent, color: 'white', border: 'none' };
  if (kind === 'danger') return { ...base, background: 'oklch(0.55 0.18 25)', color: 'white', border: 'none' };
  return { ...base, background: 'transparent', color: t.inkSoft, border: `0.5px solid ${t.hair}` };
}

export function ghostMiniBtn(t: Theme, active: boolean, accentColor: string): React.CSSProperties {
  return { width: 22, height: 18, padding: 0, borderRadius: 3, border: `0.5px solid ${active ? accentColor : t.hair}`, background: active ? accentColor : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
}
