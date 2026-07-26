/**
 * ReviewCard — compact before/after review for a SCOPED AI edit (selection rewrite
 * or cursor insert). Whole-note edits use the richer DiffOverlay instead; this card
 * is deliberately small because a sentence doesn't warrant hunk-by-hunk review.
 *
 * Shows a streaming preview while the model writes, then original-vs-refined once the
 * candidate lands. Apply / Refine (with a follow-up instruction) / Discard.
 */
import { useMemo, useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import { Icon } from '../../../components/chrome/Icon';
import { t } from '../../../components/aitextspace/theme';
import { primaryBtn } from '../../../components/aitextspace/styles';
import type { AiScope } from './useAiEdit';

const RED = 'oklch(0.55 0.18 25)';
const GREEN = 'oklch(0.50 0.15 145)';

export function ReviewCard({
  scope, original, refined, streaming, streamPreview,
  onApply, onRefine, onDiscard, onCancelStream,
}: {
  scope: AiScope;
  original: string;
  refined: string;
  streaming: boolean;
  streamPreview: string;
  onApply: () => void;
  onRefine: (instruction: string) => void;
  onDiscard: () => void;
  onCancelStream: () => void;
}) {
  const [refineInput, setRefineInput] = useState('');

  // Word-level diff so small in-sentence rewrites read clearly.
  const parts = useMemo(
    () => (scope === 'insert' ? [] : diffWordsWithSpace(original, refined)),
    [scope, original, refined],
  );

  return (
    <div style={{
      borderTop: `0.5px solid ${t.hair}`, background: t.bgRaised, flexShrink: 0,
      display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 14px',
      maxHeight: '46%', overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="sparkle" size={12} color={t.accent} />
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600, color: t.ink }}>
          {streaming ? 'Writing…' : scope === 'insert' ? 'New content' : 'Suggested rewrite'}
        </span>
        <div style={{ flex: 1 }} />
        {streaming && (
          <button type="button" onClick={onCancelStream} style={primaryBtn(t, 'danger')}>Stop</button>
        )}
      </div>

      {streaming ? (
        <div style={{
          padding: '8px 10px', borderRadius: 6, border: `0.5px solid ${t.hair}`, background: t.bg,
          fontFamily: 'Inter, sans-serif', fontSize: 12.5, lineHeight: 1.6, color: t.ink,
          whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto',
        }}>
          {streamPreview || <span style={{ color: t.muted }}>…</span>}
        </div>
      ) : scope === 'insert' ? (
        <div style={{
          padding: '8px 10px', borderRadius: 6, border: `0.5px solid ${GREEN}`,
          background: `color-mix(in oklch, ${GREEN} 8%, ${t.bg})`,
          fontFamily: 'Inter, sans-serif', fontSize: 12.5, lineHeight: 1.6, color: t.ink,
          whiteSpace: 'pre-wrap',
        }}>
          {refined}
        </div>
      ) : (
        <div style={{
          padding: '8px 10px', borderRadius: 6, border: `0.5px solid ${t.hair}`, background: t.bg,
          fontFamily: 'Inter, sans-serif', fontSize: 12.5, lineHeight: 1.7, color: t.ink,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {parts.map((p, i) => (
            <span key={i} style={{
              background: p.added ? `color-mix(in oklch, ${GREEN} 16%, transparent)`
                : p.removed ? `color-mix(in oklch, ${RED} 14%, transparent)` : 'transparent',
              color: p.added ? GREEN : p.removed ? RED : t.ink,
              textDecoration: p.removed ? 'line-through' : 'none',
            }}>{p.value}</span>
          ))}
        </div>
      )}

      {!streaming && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={refineInput}
            onChange={(e) => setRefineInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && refineInput.trim()) { e.preventDefault(); onRefine(refineInput.trim()); setRefineInput(''); }
            }}
            placeholder="Refine — e.g. “make it shorter”"
            style={{
              flex: 1, height: 30, padding: '0 12px', borderRadius: 6,
              border: `0.5px solid ${t.hair}`, background: t.bg,
              fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: t.ink, outline: 'none',
            }}
          />
          <button type="button" onClick={onDiscard} style={primaryBtn(t, 'ghost')}>Discard</button>
          <button type="button" onClick={onApply} style={primaryBtn(t, 'primary')}>
            {scope === 'insert' ? 'Insert' : 'Apply'}
          </button>
        </div>
      )}
    </div>
  );
}
