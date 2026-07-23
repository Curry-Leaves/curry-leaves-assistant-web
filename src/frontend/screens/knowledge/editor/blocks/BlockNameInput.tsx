import { useTheme } from './theme';

// A subtle inline "Name" input rendered as the first row inside a block's
// editor card. Empty value means "no title" — the block falls back to its
// language label in view mode.
//
// Commits on every keystroke (not just blur) so the title is in the markdown
// the moment the user types, before any ⌘S or Save click serialises the page.
export function BlockNameInput({
  value, onCommit, placeholder, kind,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  kind?: string;  // e.g. "mermaid", "chart" — shown as a dim language chip
}) {
  const t = useTheme();

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '6px 12px',
      borderBottom: `0.5px solid ${t.hair}`,
      background: t.bgRaised,
    }}>
      {kind && (
        <span style={{
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10,
          color: t.muted, fontWeight: 600, letterSpacing: 0.3,
          textTransform: 'lowercase',
        }}>{kind}</span>
      )}
      <input
        type="text"
        value={value}
        onChange={e => onCommit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { (e.target as HTMLInputElement).blur(); }
        }}
        placeholder={placeholder ?? 'Name this block…'}
        style={{
          flex: 1, minWidth: 0,
          border: 'none', outline: 'none', background: 'transparent',
          fontFamily: 'Inter, sans-serif', fontSize: 12.5,
          color: t.ink, padding: 0,
        }}
      />
    </div>
  );
}
