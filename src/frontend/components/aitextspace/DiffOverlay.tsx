import { useMemo, useState } from 'react';
import { diffWordsWithSpace, type Change } from 'diff';
import { Icon } from '../chrome/Icon';
import { t } from './theme';
import type { HistoryEntry, Hunk } from './types';
import { pillBtn, primaryBtn, ghostMiniBtn } from './styles';

// ─── Diff overlay ─────────────────────────────────────────────────────────────
const RED = 'oklch(0.55 0.18 25)';
const GREEN = 'oklch(0.50 0.15 145)';

function toLines(s: string): string[] {
  if (!s) return [];
  const arr = s.split('\n');
  if (arr.length > 0 && arr[arr.length - 1] === '') arr.pop();
  return arr;
}

type Block =
  | { kind: 'context'; key: string; lines: string[]; leftStart: number; rightStart: number }
  | { kind: 'hunk'; key: string; hunk: Hunk; removedLines: string[]; addedLines: string[]; leftStart: number; rightStart: number };

function buildBlocks(parts: Change[], hunks: Hunk[]) {
  const byStart = new Map(hunks.map((h) => [h.partStart, h]));
  const blocks: Block[] = [];
  let leftLine = 1, rightLine = 1, modifiedLeft = 0, modifiedRight = 0;
  let i = 0;
  while (i < parts.length) {
    const h = byStart.get(i);
    if (h) {
      const removedLines = toLines(h.removed); const addedLines = toLines(h.added);
      blocks.push({ kind: 'hunk', key: `h-${i}`, hunk: h, removedLines, addedLines, leftStart: leftLine, rightStart: rightLine });
      leftLine += removedLines.length; rightLine += addedLines.length; modifiedLeft += removedLines.length; modifiedRight += addedLines.length;
      i = h.partEnd + 1;
    } else {
      const lines = toLines(parts[i].value);
      blocks.push({ kind: 'context', key: `c-${i}`, lines, leftStart: leftLine, rightStart: rightLine });
      leftLine += lines.length; rightLine += lines.length; i++;
    }
  }
  return { blocks, totalLeft: leftLine - 1, totalRight: rightLine - 1, modifiedLeft, modifiedRight };
}

export function DiffOverlay({ hunks, parts, pendingCount, history, streaming, streamPreview, onAccept, onReject, onAcceptAll, onRejectAll, onApply, onDiscard, onRefine, onCancelStream }: {
  hunks: Hunk[]; parts: Change[]; pendingCount: number; history: HistoryEntry[]; streaming: boolean; streamPreview: string;
  onAccept: (id: string) => void; onReject: (id: string) => void; onAcceptAll: () => void; onRejectAll: () => void;
  onApply: () => void; onDiscard: () => void; onRefine: (instruction: string) => void; onCancelStream: () => void;
}) {
  const { blocks, totalLeft, totalRight, modifiedLeft, modifiedRight } = useMemo(() => buildBlocks(parts, hunks), [parts, hunks]);
  const acceptedCount = hunks.filter((h) => h.state === 'accepted').length;
  const gutterW = `${Math.max(28, String(Math.max(totalLeft, totalRight, 1)).length * 8 + 14)}px`;
  const [refineInput, setRefineInput] = useState('');
  const [convoOpen, setConvoOpen] = useState(false);
  const userTurns = history.filter((h) => h.role === 'user').length;

  return (
    <div style={{ position: 'absolute', inset: 0, background: t.bg, zIndex: 10, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: `0.5px solid ${t.hair}`, background: t.bgRaised, flexShrink: 0 }}>
        <Icon name="sparkle" size={12} color={t.accent} />
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12.5, fontWeight: 600, color: t.ink }}>Review changes</span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: t.muted }}>{hunks.length} hunk{hunks.length === 1 ? '' : 's'}{pendingCount > 0 && ` · ${pendingCount} pending`}</span>
        <div style={{ flex: 1 }} />
        {userTurns > 0 && <button type="button" onClick={() => setConvoOpen((o) => !o)} style={pillBtn(t, convoOpen)}><Icon name="chat" size={10} color={convoOpen ? t.accent : t.muted} /> Conversation ({userTurns})</button>}
        <button type="button" onClick={onRejectAll} style={pillBtn(t, false)}>Reject all</button>
        <button type="button" onClick={onAcceptAll} style={pillBtn(t, false)}>Accept all</button>
        <button type="button" onClick={onDiscard} style={primaryBtn(t, 'ghost')}>Discard</button>
        <button type="button" onClick={onApply} style={primaryBtn(t, 'primary')}>Apply ({acceptedCount})</button>
      </div>

      {convoOpen && history.length > 0 && (
        <div style={{ maxHeight: 180, overflowY: 'auto', flexShrink: 0, padding: '8px 14px', borderBottom: `0.5px solid ${t.hair}`, background: t.bg }}>
          {history.map((h) => (
            <div key={h.id} style={{ marginBottom: 6, display: 'flex', gap: 8 }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9, color: t.muted, textTransform: 'uppercase', minWidth: 50, paddingTop: 2 }}>{h.role === 'user' ? 'you' : 'agent'}</span>
              <span style={{ flex: 1, fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: t.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                {h.role === 'user' ? h.content : (h.outcome === 'rejected' && h.content.startsWith('Error:') ? h.content : `Proposed ${(h.candidateText ?? '').split('\n').length} line(s)` + (h.outcome ? ` — ${h.outcome}` : ''))}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderBottom: `0.5px solid ${t.hair}`, background: t.bgRaised, flexShrink: 0 }}>
        <CaptionCell label="Original" total={totalLeft} modified={modifiedLeft} color={RED} marker="−" />
        <div style={{ borderLeft: `0.5px solid ${t.hair}` }}><CaptionCell label="Proposed" total={totalRight} modified={modifiedRight} color={GREEN} marker="+" /></div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, lineHeight: 1.55 }}>
        {blocks.map((b) => b.kind === 'context'
          ? <ContextLines key={b.key} lines={b.lines} leftStart={b.leftStart} rightStart={b.rightStart} gutterW={gutterW} />
          : <HunkBlock key={b.key} block={b} gutterW={gutterW} onAccept={onAccept} onReject={onReject} />)}
      </div>

      <div style={{ padding: '8px 12px', borderTop: `0.5px solid ${t.hair}`, background: t.bgRaised, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={refineInput} onChange={(e) => setRefineInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && refineInput.trim() && !streaming) { e.preventDefault(); onRefine(refineInput.trim()); setRefineInput(''); } }}
            placeholder="Ask for more changes — e.g. 'make it shorter', 'add a section about X'" disabled={streaming}
            style={{ flex: 1, height: 30, padding: '0 12px', borderRadius: 6, border: `0.5px solid ${t.hair}`, background: t.bg, fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: t.ink, outline: 'none' }} />
          {streaming ? <button type="button" onClick={onCancelStream} style={primaryBtn(t, 'danger')}>Cancel</button>
            : <button type="button" disabled={!refineInput.trim()} onClick={() => { onRefine(refineInput.trim()); setRefineInput(''); }} style={primaryBtn(t, 'primary', !refineInput.trim())}>Refine</button>}
        </div>
        {streaming && streamPreview && <div style={{ maxHeight: 60, overflow: 'auto', padding: '4px 8px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.muted, background: t.bg, borderRadius: 5, border: `0.5px solid ${t.hair}`, whiteSpace: 'pre-wrap' }}>{streamPreview}</div>}
      </div>
    </div>
  );
}

function CaptionCell({ label, total, modified, color, marker }: { label: string; total: number; modified: number; color: string; marker: string }) {
  const unchanged = total - modified;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px' }}>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color }}>{marker} {label}</span>
      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.muted }}>{total} line{total === 1 ? '' : 's'}</span>
      {modified > 0 && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: `color-mix(in oklch, ${color} 14%, transparent)`, color, border: `0.5px solid ${color}` }}>{modified} changed</span>}
      {unchanged > 0 && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: t.bgSunken, color: t.muted, border: `0.5px solid ${t.hair}` }}>{unchanged} unchanged</span>}
    </div>
  );
}

function LineRow({ n, text, spans, marker, color, bg, dim, strike, gutterW, wrap = true }: {
  n: number | null; text: string | null; spans?: React.ReactNode; marker: string; color: string; bg?: string; dim?: boolean; strike?: boolean; gutterW: string; wrap?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', background: bg, opacity: dim ? 0.45 : 1 }}>
      <div style={{ flexShrink: 0, width: gutterW, padding: '1px 6px 1px 0', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: text === null ? 'transparent' : t.muted, borderRight: `0.5px solid ${t.hair}`, userSelect: 'none' }}>
        <span>{n ?? ''}</span><span style={{ display: 'inline-block', width: 12, color, marginLeft: 4 }}>{text === null ? '' : marker}</span>
      </div>
      <pre style={{ margin: 0, padding: '1px 10px', flex: 1, minWidth: 0, whiteSpace: wrap ? 'pre-wrap' : 'pre', wordBreak: 'break-word', color: text === null ? 'transparent' : color, textDecoration: strike ? 'line-through' : 'none' }}>{text === null ? ' ' : (spans ?? (text === '' ? ' ' : text))}</pre>
    </div>
  );
}

function intraLineSpans(oldLine: string, newLine: string, side: 'left' | 'right'): React.ReactNode {
  const parts = diffWordsWithSpace(oldLine, newLine);
  const HL = side === 'left' ? `color-mix(in oklch, ${RED} 32%, transparent)` : `color-mix(in oklch, ${GREEN} 32%, transparent)`;
  return parts.map((p, i) => {
    if (side === 'left' && p.added) return null;
    if (side === 'right' && p.removed) return null;
    const isChange = (side === 'left' && p.removed) || (side === 'right' && p.added);
    return isChange ? <span key={i} style={{ background: HL, borderRadius: 2, padding: '0 1px' }}>{p.value}</span> : <span key={i}>{p.value}</span>;
  });
}

function ContextLines({ lines, leftStart, rightStart, gutterW }: { lines: string[]; leftStart: number; rightStart: number; gutterW: string }) {
  if (lines.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
      <div>{lines.map((ln, i) => <LineRow key={i} n={leftStart + i} text={ln} marker="·" color={t.inkSoft} gutterW={gutterW} />)}</div>
      <div style={{ borderLeft: `0.5px solid ${t.hair}` }}>{lines.map((ln, i) => <LineRow key={i} n={rightStart + i} text={ln} marker="·" color={t.inkSoft} gutterW={gutterW} />)}</div>
    </div>
  );
}

function HunkBlock({ block, gutterW, onAccept, onReject }: { block: Extract<Block, { kind: 'hunk' }>; gutterW: string; onAccept: (id: string) => void; onReject: (id: string) => void }) {
  const { hunk, removedLines, addedLines, leftStart, rightStart } = block;
  const state = hunk.state;
  const accentColor = state === 'accepted' ? GREEN : state === 'rejected' ? RED : t.muted;
  const leftDim = state === 'accepted'; const rightDim = state === 'rejected';
  const rowCount = Math.max(removedLines.length, addedLines.length);
  const redBg = `color-mix(in oklch, ${RED} 12%, transparent)`;
  const greenBg = `color-mix(in oklch, ${GREEN} 12%, transparent)`;
  const padBg = `color-mix(in oklch, ${t.muted} 4%, transparent)`;

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px', minHeight: 22, background: t.bgRaised, borderTop: `0.5px solid ${t.hair}`, borderBottom: `0.5px solid ${t.hair}` }}>
        <span style={{ width: 3, height: 14, borderRadius: 2, background: accentColor, flexShrink: 0 }} />
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.muted }}>@@ −{leftStart},{removedLines.length} +{rightStart},{addedLines.length} @@</span>
        {state !== 'pending' && <span style={{ padding: '0 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: `color-mix(in oklch, ${accentColor} 14%, transparent)`, color: accentColor, border: `0.5px solid ${accentColor}`, fontFamily: 'Inter, sans-serif' }}>{state.toUpperCase()}</span>}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => onReject(hunk.id)} title="Reject this hunk" style={ghostMiniBtn(t, state === 'rejected', RED)}><Icon name="x" size={10} color={state === 'rejected' ? 'white' : RED} /></button>
        <button type="button" onClick={() => onAccept(hunk.id)} title="Accept this hunk" style={ghostMiniBtn(t, state === 'accepted', GREEN)}><Icon name="check" size={10} color={state === 'accepted' ? 'white' : GREEN} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        <div>
          {Array.from({ length: rowCount }).map((_, i) => {
            const ln = removedLines[i]; const isReal = i < removedLines.length; const paired = isReal && i < addedLines.length;
            return <LineRow key={i} n={isReal ? leftStart + i : null} text={isReal ? ln : null} spans={paired ? intraLineSpans(ln, addedLines[i], 'left') : undefined} marker="−" color={RED} bg={isReal ? redBg : padBg} dim={leftDim} strike={leftDim} gutterW={gutterW} />;
          })}
        </div>
        <div style={{ borderLeft: `0.5px solid ${t.hair}` }}>
          {Array.from({ length: rowCount }).map((_, i) => {
            const ln = addedLines[i]; const isReal = i < addedLines.length; const paired = isReal && i < removedLines.length;
            return <LineRow key={i} n={isReal ? rightStart + i : null} text={isReal ? ln : null} spans={paired ? intraLineSpans(removedLines[i], ln, 'right') : undefined} marker="+" color={GREEN} bg={isReal ? greenBg : padBg} dim={rightDim} gutterW={gutterW} />;
          })}
        </div>
      </div>
    </div>
  );
}
