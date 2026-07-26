/**
 * AiTextSpace — controlled text editor with inline AI rewrite, diff review,
 * and ephemeral conversation history. Drop-in replacement for <textarea>.
 *
 * Ported from curry-leaves. Streams via curry-leaves's /chat SSE (ephemeral, no session)
 * using any agent enabled for the given surface (default: the `text-editor` agent
 * tuned to return only the rewritten text).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { diffLines, type Change } from 'diff';
import { Icon } from './chrome/Icon';
import { api } from '../api/client';
import { t } from './aitextspace/theme';
import type { HistoryEntry, Hunk } from './aitextspace/types';
import { buildHunks, mergeHunks } from './aitextspace/diff';
import { pillBtn, primaryBtn, ghostMiniBtn } from './aitextspace/styles';
import { DiffOverlay } from './aitextspace/DiffOverlay';
import { HistoryPanel } from './aitextspace/HistoryPanel';

interface AiTextSpaceProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minHeight?: number;
  fontFamily?: string;
  fontSize?: number;
  surface?: string;
  defaultAgentId?: string;
  label?: string;
}

interface AgentLite { id: string; name: string }

// ─── Main component ───────────────────────────────────────────────────────────
export function AiTextSpace({
  value, onChange, placeholder,
  minHeight = 240,
  fontFamily = "'JetBrains Mono', ui-monospace, monospace",
  fontSize = 12.5,
  surface = 'textspace',
  defaultAgentId = 'text-editor',
  label,
}: AiTextSpaceProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lineCount = useMemo(() => (value ? value.split('\n').length : 1), [value]);
  const gutterWidth = `${Math.max(28, String(lineCount).length * 8 + 14)}px`;

  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [agentId, setAgentId] = useState<string>(defaultAgentId);

  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [floatPos, setFloatPos] = useState<{ left: number; top: number } | null>(null);

  const [barOpen, setBarOpen] = useState(false);
  const [barMode, setBarMode] = useState<'whole' | 'selection'>('whole');
  const [instruction, setInstruction] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamPreview, setStreamPreview] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const [diff, setDiff] = useState<{
    before: string; after: string; parts: Change[]; hunks: Hunk[];
    scope?: { start: number; end: number };
  } | null>(null);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCase, setFindCase] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo<number[]>(() => {
    if (!findQuery || !value) return [];
    const hay = findCase ? value : value.toLowerCase();
    const needle = findCase ? findQuery : findQuery.toLowerCase();
    if (!needle) return [];
    const out: number[] = [];
    let from = 0;
    while (from <= hay.length) {
      const i = hay.indexOf(needle, from);
      if (i < 0) break;
      out.push(i);
      from = i + Math.max(1, needle.length);
    }
    return out;
  }, [value, findQuery, findCase]);

  const focusMatch = (idx: number) => {
    if (!matches.length || !taRef.current) return;
    const safe = ((idx % matches.length) + matches.length) % matches.length;
    const start = matches[safe];
    const end = start + findQuery.length;
    setMatchIdx(safe);
    const ta = taRef.current;
    ta.focus();
    ta.setSelectionRange(start, end);
  };

  useEffect(() => { setMatchIdx(0); }, [findQuery, findCase]);
  useEffect(() => { if (findOpen) findInputRef.current?.focus(); }, [findOpen]);

  useEffect(() => {
    api.listAgents()
      .then((list) => {
        const lite: AgentLite[] = list
          .filter((a) => a.enabled !== false && (a.surfaces || []).includes(surface))
          .map((a) => ({ id: a.id, name: a.name || a.id }));
        setAgents(lite);
        if (!lite.find((a) => a.id === agentId) && lite.length) {
          setAgentId(lite.find((a) => a.id === defaultAgentId)?.id ?? lite[0].id);
        }
      })
      .catch(() => { /* offline — keep default */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);

  const refreshSelection = () => {
    const ta = taRef.current; if (!ta) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    if (start === end) { setSelection(null); setFloatPos(null); return; }
    setSelection({ start, end });
    const r = ta.getBoundingClientRect();
    const wrap = wrapRef.current?.getBoundingClientRect();
    if (wrap) setFloatPos({ left: r.right - wrap.left - 130, top: r.top - wrap.top + 6 });
  };

  const sendToAgent = async (instr: string, mode: 'whole' | 'selection') => {
    const base = await api.baseUrl();
    if (!base) return;

    const isSelection = mode === 'selection' && selection && selection.end > selection.start;
    const scope = isSelection ? { start: selection!.start, end: selection!.end } : undefined;
    const sourceText = isSelection ? value.slice(selection!.start, selection!.end) : value;
    const userBlock = `<instruction>\n${instr.trim()}\n</instruction>\n<text>\n${sourceText}\n</text>`;

    const chatHistory = history.map((h) => ({
      role: h.role, content: h.role === 'user' ? h.content : (h.candidateText ?? h.content),
    }));

    const userTurn: HistoryEntry = {
      id: crypto.randomUUID(), role: 'user', content: instr.trim(), beforeText: sourceText, timestamp: Date.now(),
    };
    setHistory((h) => [...h, userTurn]);

    setStreaming(true);
    setStreamPreview('');
    const abort = new AbortController();
    abortRef.current = abort;

    let fullText = '';
    try {
      const resp = await fetch(`${base}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ agentId, message: userBlock, history: chatHistory, ephemeral: true }),
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let reading = true;
      while (reading) {
        const { done, value: chunk } = await reader.read();
        if (done) { reading = false; break; }
        buf += decoder.decode(chunk, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          let evt: any;
          try { evt = JSON.parse(trimmed.slice(6)); } catch { continue; }
          if (evt.type === 'token') { fullText += String(evt.text ?? ''); setStreamPreview(fullText); }
          else if (evt.type === 'error') { throw new Error(String(evt.error ?? 'agent error')); }
          else if (evt.type === 'done') { reading = false; break; }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${msg}`, timestamp: Date.now(), outcome: 'rejected' }]);
      setStreaming(false);
      setBarOpen(false);
      return;
    }
    setStreaming(false);

    const candidate = stripFenceWrap(fullText.trim());
    const newValue = isSelection ? value.slice(0, scope!.start) + candidate + value.slice(scope!.end) : candidate;
    const parts = diffLines(value, newValue);
    const hunks = buildHunks(parts);

    setHistory((h) => [...h, { id: crypto.randomUUID(), role: 'assistant', content: candidate, candidateText: candidate, timestamp: Date.now() }]);

    if (hunks.length === 0) {
      setBarOpen(false);
      setInstruction('');
      setHistory((h) => h.map((entry, i) => (i === h.length - 1 ? { ...entry, outcome: 'applied' } : entry)));
      return;
    }
    setDiff({ before: value, after: newValue, parts, hunks, scope });
    setBarOpen(false);
    setInstruction('');
  };

  const setHunkState = (id: string, state: Hunk['state']) =>
    setDiff((d) => (d ? { ...d, hunks: d.hunks.map((h) => (h.id === id ? { ...h, state } : h)) } : d));
  const acceptAll = () => setDiff((d) => (d ? { ...d, hunks: d.hunks.map((h) => ({ ...h, state: 'accepted' as const })) } : d));
  const rejectAll = () => setDiff((d) => (d ? { ...d, hunks: d.hunks.map((h) => ({ ...h, state: 'rejected' as const })) } : d));

  const applyDiff = () => {
    if (!diff) return;
    const merged = mergeHunks(diff.parts, diff.hunks);
    const allAccepted = diff.hunks.every((h) => h.state === 'accepted');
    const noneAccepted = diff.hunks.every((h) => h.state !== 'accepted');
    onChange(merged);
    setHistory((h) => h.map((entry, i) => (i === h.length - 1 ? { ...entry, outcome: noneAccepted ? 'rejected' : allAccepted ? 'applied' : 'partial' } : entry)));
    setDiff(null);
  };
  const discardDiff = () => {
    setHistory((h) => h.map((entry, i) => (i === h.length - 1 ? { ...entry, outcome: 'rejected' } : entry)));
    setDiff(null);
  };
  const cancelStream = () => { abortRef.current?.abort(); setStreaming(false); setStreamPreview(''); };

  const pendingCount = diff?.hunks.filter((h) => h.state === 'pending').length ?? 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', border: `0.5px solid ${t.hair}`, borderRadius: 8, background: t.bg, overflow: 'hidden', minHeight, height: '100%' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 10px', borderBottom: `0.5px solid ${t.hair}`, background: t.bgRaised, flexShrink: 0 }}>
        {label && <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 600, color: t.muted, textTransform: 'uppercase', letterSpacing: 1.2, marginRight: 4 }}>{label}</span>}
        <button type="button" disabled={streaming} onClick={() => { setBarMode('whole'); setBarOpen(true); setInstruction(''); }} style={pillBtn(t, barOpen)}>
          <Icon name="sparkle" size={11} color={t.accent} /> Improve
        </button>
        {agents.length <= 1 ? (
          <span title={agents.length === 0 ? `No agents enabled for "${surface}" — enable one in Agents.` : 'Active agent'}
            style={{ height: 24, padding: '0 8px', borderRadius: 5, border: `0.5px solid ${t.hair}`, background: t.bg, fontFamily: 'Inter, sans-serif', fontSize: 11, color: t.inkSoft, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Icon name="zap" size={9} color={agents.length ? t.accent : t.muted} /> {agents[0]?.name ?? agentId}
          </span>
        ) : (
          <select title="Agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}
            style={{ height: 24, padding: '0 6px', borderRadius: 5, border: `0.5px solid ${t.hair}`, background: t.bg, fontFamily: 'Inter, sans-serif', fontSize: 11, color: t.inkSoft, outline: 'none', cursor: 'pointer' }}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setFindOpen((o) => !o)} title="Find (⌘F)" style={pillBtn(t, findOpen)}>
          <Icon name="search" size={10} color={findOpen ? t.accent : t.muted} /> Find
        </button>
        {history.length > 0 && (
          <button type="button" onClick={() => setHistoryOpen((o) => !o)} style={pillBtn(t, historyOpen)}>
            <Icon name="edit" size={10} color={historyOpen ? t.accent : t.muted} /> History ({history.filter((h) => h.role === 'user').length})
          </button>
        )}
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: t.muted }}>{value.length} chars</span>
      </div>

      {/* Editor + history panel */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, position: 'relative', minWidth: 0, minHeight: 0, display: 'flex' }}>
          <div ref={gutterRef} aria-hidden style={{ flexShrink: 0, width: gutterWidth, padding: '12px 6px 12px 0', borderRight: `0.5px solid ${t.hair}`, background: t.bgRaised, fontFamily, fontSize: Math.max(10, fontSize - 2), lineHeight: 1.6, color: t.muted, textAlign: 'right', overflow: 'hidden', userSelect: 'none', boxSizing: 'border-box' }}>
            {Array.from({ length: lineCount }, (_, i) => <div key={i} style={{ whiteSpace: 'pre' }}>{i + 1}</div>)}
          </div>
          <textarea ref={taRef} value={value} onChange={(e) => onChange(e.target.value)}
            onSelect={refreshSelection} onKeyUp={refreshSelection} onMouseUp={refreshSelection}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setFindOpen(true); } }}
            onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
            placeholder={placeholder}
            style={{ flex: 1, minWidth: 0, height: '100%', minHeight: 0, padding: '12px 14px', border: 'none', outline: 'none', background: 'transparent', resize: 'none', fontFamily, fontSize, lineHeight: 1.6, color: t.ink, boxSizing: 'border-box' }} />

          {findOpen && (
            <div style={{ position: 'absolute', top: 8, right: 12, zIndex: 6, display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 6, background: t.bgRaised, border: `0.5px solid ${t.hair}`, boxShadow: '0 2px 10px rgba(0,0,0,0.12)' }}>
              <Icon name="search" size={11} color={t.muted} />
              <input ref={findInputRef} value={findQuery} onChange={(e) => setFindQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); if (matches.length) focusMatch(matchIdx + (e.shiftKey ? -1 : 1)); }
                  else if (e.key === 'Escape') { e.preventDefault(); setFindOpen(false); setFindQuery(''); taRef.current?.focus(); }
                }}
                placeholder="Find" style={{ width: 160, height: 22, padding: '0 6px', borderRadius: 4, border: `0.5px solid ${t.hair}`, background: t.bg, fontFamily: 'Inter, sans-serif', fontSize: 11.5, color: t.ink, outline: 'none' }} />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: t.muted, minWidth: 44, textAlign: 'center' }}>
                {findQuery ? (matches.length ? `${matchIdx + 1}/${matches.length}` : '0/0') : ''}
              </span>
              <button type="button" onClick={() => setFindCase((c) => !c)} title="Match case"
                style={{ width: 22, height: 22, borderRadius: 4, border: `0.5px solid ${findCase ? t.accent : t.hair}`, background: findCase ? `color-mix(in oklch, ${t.accent} 14%, ${t.bg})` : t.bg, color: findCase ? t.accent : t.muted, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Aa</button>
              <button type="button" disabled={!matches.length} onClick={() => focusMatch(matchIdx - 1)} title="Previous (⇧⏎)" style={{ ...ghostMiniBtn(t, false, t.muted), transform: 'rotate(180deg)' }}><Icon name="chevD" size={10} color={t.muted} /></button>
              <button type="button" disabled={!matches.length} onClick={() => focusMatch(matchIdx + 1)} title="Next (⏎)" style={ghostMiniBtn(t, false, t.muted)}><Icon name="chevD" size={10} color={t.muted} /></button>
              <button type="button" onClick={() => { setFindOpen(false); setFindQuery(''); taRef.current?.focus(); }} title="Close (Esc)" style={ghostMiniBtn(t, false, t.muted)}><Icon name="x" size={10} color={t.muted} /></button>
            </div>
          )}

          {selection && floatPos && !streaming && !diff && !barOpen && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setBarMode('selection'); setBarOpen(true); setInstruction(''); }}
              style={{ position: 'absolute', left: floatPos.left, top: floatPos.top, height: 24, padding: '0 10px', borderRadius: 12, background: t.ink, color: t.bg, border: 'none', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 550, display: 'flex', alignItems: 'center', gap: 5, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', zIndex: 5 }}>
              <Icon name="sparkle" size={10} color={t.bg} /> Edit selection ({selection.end - selection.start})
            </button>
          )}
        </div>

        {historyOpen && <HistoryPanel entries={history} onClear={() => setHistory([])} onClose={() => setHistoryOpen(false)} />}
      </div>

      {barOpen && (
        <div style={{ padding: '10px 12px', borderTop: `0.5px solid ${t.hair}`, background: t.bgRaised, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'Inter, sans-serif', fontSize: 11, color: t.muted }}>
            <Icon name="sparkle" size={11} color={t.accent} />
            <span>{barMode === 'selection' ? `Editing selection (${selection ? selection.end - selection.start : 0} chars)` : 'Editing whole document'}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input autoFocus value={instruction} onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && instruction.trim() && !streaming) { e.preventDefault(); sendToAgent(instruction, barMode); } if (e.key === 'Escape') { setBarOpen(false); setInstruction(''); } }}
              placeholder={barMode === 'selection' ? 'How should this section change?' : 'How should the text be improved?'} disabled={streaming}
              style={{ flex: 1, height: 30, padding: '0 12px', borderRadius: 6, border: `0.5px solid ${t.hair}`, background: t.bg, fontFamily: 'Inter, sans-serif', fontSize: 12.5, color: t.ink, outline: 'none' }} />
            {streaming ? (
              <button type="button" onClick={cancelStream} style={primaryBtn(t, 'danger')}>Cancel</button>
            ) : (
              <>
                <button type="button" disabled={!instruction.trim()} onClick={() => sendToAgent(instruction, barMode)} style={primaryBtn(t, 'primary', !instruction.trim())}>Run</button>
                <button type="button" onClick={() => { setBarOpen(false); setInstruction(''); }} style={primaryBtn(t, 'ghost')}>Cancel</button>
              </>
            )}
          </div>
          {streaming && streamPreview && (
            <div style={{ maxHeight: 80, overflow: 'auto', padding: '6px 8px', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: t.muted, background: t.bg, borderRadius: 5, border: `0.5px solid ${t.hair}`, whiteSpace: 'pre-wrap' }}>{streamPreview}</div>
          )}
        </div>
      )}

      {diff && (
        <DiffOverlay hunks={diff.hunks} parts={diff.parts} pendingCount={pendingCount} history={history} streaming={streaming} streamPreview={streamPreview}
          onAccept={(id) => setHunkState(id, 'accepted')} onReject={(id) => setHunkState(id, 'rejected')}
          onAcceptAll={acceptAll} onRejectAll={rejectAll} onApply={applyDiff} onDiscard={discardDiff}
          onRefine={(instr) => sendToAgent(instr, diff.scope ? 'selection' : 'whole')} onCancelStream={cancelStream} />
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function stripFenceWrap(s: string): string {
  const m = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(s.trim());
  return m ? m[1] : s;
}
