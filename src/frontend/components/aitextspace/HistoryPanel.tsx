import { Icon } from '../chrome/Icon';
import { t } from './theme';
import type { HistoryEntry } from './types';

export function HistoryPanel({ entries, onClear, onClose }: { entries: HistoryEntry[]; onClear: () => void; onClose: () => void }) {
  return (
    <div style={{ width: 280, flexShrink: 0, borderLeft: `0.5px solid ${t.hair}`, background: t.bgRaised, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: `0.5px solid ${t.hair}`, flexShrink: 0 }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600, color: t.muted, textTransform: 'uppercase', letterSpacing: 1, flex: 1 }}>History (this session)</span>
        <button type="button" onClick={onClear} title="Clear history" style={{ width: 22, height: 22, borderRadius: 4, border: `0.5px solid ${t.hair}`, background: t.bg, color: t.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="trash" size={11} color={t.muted} /></button>
        <button type="button" onClick={onClose} title="Close" style={{ width: 22, height: 22, borderRadius: 4, border: `0.5px solid ${t.hair}`, background: t.bg, color: t.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={11} color={t.muted} /></button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        {entries.length === 0 && <div style={{ padding: 20, textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: t.muted }}>No edits yet.</div>}
        {entries.map((e) => (
          <div key={e.id} style={{ marginBottom: 6, padding: '7px 9px', borderRadius: 6, background: e.role === 'user' ? t.bg : `color-mix(in oklch, ${t.accent} 6%, ${t.bg})`, border: `0.5px solid ${t.hair}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontFamily: 'Inter, sans-serif', fontSize: 9.5, fontWeight: 600, color: t.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              <span>{e.role === 'user' ? 'You' : 'AI'}</span>
              {e.outcome && <span style={{ padding: '0 5px', borderRadius: 3, background: e.outcome === 'applied' ? `color-mix(in oklch, ${t.green} 18%, transparent)` : e.outcome === 'partial' ? `color-mix(in oklch, ${t.accent} 18%, transparent)` : 'oklch(0.55 0.18 25 / 0.18)', color: e.outcome === 'applied' ? t.green : e.outcome === 'partial' ? t.accent : 'oklch(0.55 0.18 25)' }}>{e.outcome}</span>}
            </div>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: t.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'auto' }}>{e.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
