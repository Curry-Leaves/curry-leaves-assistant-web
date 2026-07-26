import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { subChat } from '../../api/socket';
import { Bubble } from '../askai/Bubble';
import { PendingCard } from '../askai/PendingCard';
import type { ChatMsg, PendingReq, QueuedMsg, SubStep, ToolCall } from '../askai/model';
import type { Agent, AgentRun, TraceSpan } from '../../types';

// ─── span tree → chat bubbles ──────────────────────────────────────────────────
// Turns a run's trace spans into the same ChatMsg shape the live chat page renders,
// so a run's history reads exactly like a conversation (thinking blocks, tool cards,
// subagent activity, markdown output) instead of a flat output/error string.
function spansToMsgs(spans: TraceSpan[], userInput: string): ChatMsg[] {
  const root = spans.find((s) => s.kind === 'agent_run' || s.kind === 'subagent_run') || spans[0];
  if (!root) return [];
  const byParent = new Map<string, TraceSpan[]>();
  for (const s of spans) {
    if (!s.parentSpanId) continue;
    byParent.set(s.parentSpanId, [...(byParent.get(s.parentSpanId) ?? []), s]);
  }
  const sortByStart = (a: TraceSpan, b: TraceSpan) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  const kids = (byParent.get(root.spanId) ?? []).slice().sort(sortByStart);

  let thinking = '';
  let content = '';
  const tools: ToolCall[] = [];
  const subs: SubStep[] = [];

  // Replayed from the span tree, whose parentage is explicit (parentSpanId) — no need for
  // the live stream's parent_tool_call_id. `parent` is threaded down so these hang under
  // the delegating call the same way live steps do; `agent` labels the rail.
  const walkSub = (s: TraceSpan, depth: number, parent: string, agent: string) => {
    const a = s.attributes || {};
    const who = s.kind === 'subagent_run' ? s.name : agent;
    subs.push({
      id: s.spanId, depth, parent, agent: who, kind: 'tool', name: s.name,
      input: s.kind === 'tool_call' ? String(a.args ?? '') : undefined,
      output: s.kind === 'tool_call' ? String(a.result ?? '') : (s.kind === 'subagent_run' ? String(a.output ?? '') : undefined),
      status: s.status === 'running' ? 'running' : s.status === 'error' ? 'error' : 'done',
    });
    for (const c of (byParent.get(s.spanId) ?? []).slice().sort(sortByStart)) walkSub(c, depth + 1, parent, who);
  };

  for (const s of kids) {
    const a = s.attributes || {};
    if (s.kind === 'llm_turn') {
      if (a.thinking) thinking += String(a.thinking);
      if (a.text) content += (content ? '\n\n' : '') + String(a.text);
    } else if (s.kind === 'tool_call') {
      tools.push({
        id: s.spanId, name: s.name, input: String(a.args ?? ''), output: String(a.result ?? ''),
        status: s.status === 'running' ? 'running' : s.status === 'error' ? 'error' : 'done',
      });
    } else if (s.kind === 'subagent_run') {
      // A subagent_run span is parented to the RUN root, not to the tool_call that
      // delegated it, so a replayed trace has no delegating call id to nest under —
      // these render as their own rail (the orphan path) rather than inside a card.
      walkSub(s, 1, '', s.name);
    }
  }

  const msgs: ChatMsg[] = [];
  if (userInput.trim()) msgs.push({ role: 'user', content: userInput });
  msgs.push({ role: 'assistant', content, thinking: thinking || undefined, tools, subs });
  return msgs;
}

/** Run history for an agent — col 1 lists runs, col 2 shows the selected run as a chat-like
 *  conversation (thinking blocks, tool cards, subagent activity, markdown), inline in place
 *  of the dashboard's live-events/common-pool columns. */
export function AgentRunsPanel({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [runs, setRuns] = useState<AgentRun[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  useEffect(() => {
    setRuns(null); setSelId(null);
    api.agentRuns(agent.id).then((rs) => { setRuns(rs); setSelId(rs[0]?.id ?? null); }).catch(() => setRuns([]));
  }, [agent.id]);

  const selected = runs?.find((r) => r.id === selId) ?? null;

  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      {/* col: run list */}
      <div className="w-[300px] flex-none border-r border-border bg-bg flex flex-col min-h-0">
        <div className="flex items-center justify-between px-4 h-9 flex-none border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            <button type="button" onClick={onClose} title="Back" className="text-ink3 hover:text-ink flex-none rotate-180"><Icon name="chevR" size={13} /></button>
            <span className="text-[10px] uppercase tracking-wider text-ink3 font-600 truncate">{agent.name}</span>
          </div>
          <button type="button" onClick={() => api.runAgent(agent.id)} title="Run now"
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-[7px] bg-accent-soft text-accent-dark text-[11px] flex-none">
            <Icon name="play" size={10} /> Run
          </button>
        </div>
        <div className="px-4 pt-2.5 pb-1 text-[11px] text-ink3 flex-none truncate">{agent.triggers.join(', ') || 'on demand'}</div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {runs === null && <div className="text-[12.5px] text-ink3 text-center py-10">Loading…</div>}
          {runs && runs.length === 0 && <div className="text-[13px] text-ink3 text-center py-10">No runs yet.</div>}
          {runs?.map((r) => <RunListItem key={r.id} run={r} active={r.id === selId} onClick={() => setSelId(r.id)} />)}
        </div>
      </div>

      {/* col: selected run, chat-like view */}
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto">
        {!selected ? (
          <div className="h-full grid place-items-center text-[12.5px] text-ink3">Select a run to view its conversation.</div>
        ) : (
          <RunConversation key={selected.id} run={selected} />
        )}
      </div>
    </div>
  );
}

function RunListItem({ run, active, onClick }: { run: AgentRun; active: boolean; onClick: () => void }) {
  const tone = run.status === 'done' ? 'text-ok' : run.status === 'failed' ? 'text-rec' : 'text-accent-dark';
  const when = run.finishedAt || run.startedAt;
  return (
    <button type="button" onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-[9px] border ${active ? 'bg-card border-border shadow-soft' : 'border-transparent hover:bg-card/60'}`}>
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full flex-none ${run.status === 'running' ? 'an-pulse bg-accent' : run.status === 'failed' ? 'bg-rec' : 'bg-ok'}`} />
        <span className="font-mono text-[11.5px] text-ink2 flex-1 truncate">{run.trigger?.type || 'run'}</span>
      </div>
      <div className="flex items-center justify-between mt-0.5 pl-3.5">
        <span className={`font-mono text-[10px] ${tone}`}>{run.status}</span>
        <span className="font-mono text-[10px] text-ink3">{when ? new Date(when).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}</span>
      </div>
    </button>
  );
}

// A LIVE, STEERABLE view of one run — the same conversation UI as the chat page, driven
// by the run's WebSocket frame stream (keyed by jobId = run.id) instead of a chat session.
//
// - Finished run  → render its trace spans via spansToMsgs (authoritative history), and
//   still expose the composer so the user can keep talking (continue-as-chat).
// - Live run      → maintain a local msgs[] and translate each frame into edits of the
//   trailing assistant bubble (mirroring AskAiScreen.attachRun), plus approve/ask prompts,
//   steer/follow-up queueing, and Stop.
//
// The steering handler is shared between the live run, a new continue-as-chat turn, and a
// steer that starts a fresh turn — all stream the same frame shapes.
function RunConversation({ run }: { run: AgentRun }) {
  // Finished-run history rendered from trace spans (unchanged authoritative view).
  const [spans, setSpans] = useState<TraceSpan[] | null>(null);
  // Live/continued turn state — a self-contained chat thread for THIS run's session.
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [pending, setPending] = useState<PendingReq | null>(null);
  const [queue, setQueue] = useState<QueuedMsg[]>([]);
  const [input, setInput] = useState('');
  const [queueMode, setQueueMode] = useState<'steer' | 'follow_up'>('steer');

  // The run id whose frames we're currently applying to msgs[]. Starts at the run's own id
  // for a live run; a continue-as-chat turn swaps in the new run id it gets back.
  const activeRunId = useRef<string | null>(null);
  const queueSeq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the thread should follow new content. True while the user sits at the bottom;
  // cleared as soon as they scroll up to read, so incoming frames don't yank them back.
  const stick = useRef(true);

  const loadSpans = () => {
    if (!run.traceId) { setSpans([]); return; }
    api.getTrace(run.traceId).then((r) => setSpans(r.spans)).catch(() => setSpans([]));
  };

  useEffect(() => { setSpans(null); stick.current = true; loadSpans(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [run.traceId]);

  // Keyed on msgs/spans, never bare: a dependency-less effect here re-scrolled on every
  // unrelated re-render, which is what made the thread flicker and jump to the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => { if (stick.current) endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs, spans]);

  const editLast = (fn: (m: ChatMsg) => ChatMsg) =>
    setMsgs((ms) => { if (ms.length === 0) return ms; const next = [...ms]; next[next.length - 1] = fn(next[next.length - 1]); return next; });

  // Backend confirmed a queued steer/follow-up was folded in — move it from the chip into
  // the thread as a user bubble spliced BEFORE the trailing assistant bubble (editLast()
  // must keep targeting the assistant bubble).
  const promoteFromQueue = (queueId: string, text: string) => {
    setMsgs((ms) => { const next = [...ms]; next.splice(Math.max(0, next.length - 1), 0, { role: 'user', content: text }); return next; });
    setQueue((q) => q.filter((it) => it.queueId !== queueId));
  };

  // Translate one run frame into edits of the local thread. Mirrors AskAiScreen.attachRun's
  // per-frame switch; `stop` detaches the subscription on a terminal/gone frame.
  const applyFrame = (raw: unknown, stop: () => void) => {
    const e = raw as any;
    if (e.type === 'gone') { setStreaming(false); loadSpans(); stop(); return; }
    if (e.type === 'approve') setPending({ id: e.id, kind: 'approve', tool: e.tool, args: e.args, risk: e.risk });
    else if (e.type === 'ask') setPending({ id: e.id, kind: 'ask', question: e.question, options: e.options });
    else if (e.type === 'thinking') editLast((m) => {
      const trail = [...(m.trail || [])];
      const last = trail[trail.length - 1];
      if (last?.kind === 'thinking') trail[trail.length - 1] = { kind: 'thinking', text: last.text + e.text };
      else trail.push({ kind: 'thinking', text: e.text });
      return { ...m, thinking: (m.thinking || '') + e.text, trail };
    });
    else if (e.type === 'token') editLast((m) => ({ ...m, content: m.content + e.text }));
    else if (e.type === 'tool_start') editLast((m) => ({ ...m, tools: [...(m.tools || []), { id: e.id, name: e.name, input: e.input, status: 'running' }], trail: [...(m.trail || []), { kind: 'tool', id: e.id }] }));
    else if (e.type === 'tool_end') editLast((m) => ({ ...m, tools: (m.tools || []).map((t) => (t.id === e.id ? { ...t, output: e.output, status: e.isError ? 'error' : 'done', tokensIn: e.tokensIn, tokensOut: e.tokensOut } : t)) }));
    else if (e.type === 'sub' && e.kind === 'tool_start') editLast((m) => ({ ...m, subs: [...(m.subs || []), { id: e.id, depth: e.depth, parent: e.parent, agent: e.agent, kind: 'tool', name: e.name, input: e.input, status: 'running' }] }));
    else if (e.type === 'sub' && e.kind === 'tool_end') editLast((m) => ({ ...m, subs: (m.subs || []).map((s) => (s.id === e.id ? { ...s, output: e.output, status: e.isError ? 'error' : 'done' } : s)) }));
    else if (e.type === 'sub' && e.kind === 'thinking') editLast((m) => {
      // Coalesce thinking deltas into the subagent's trailing thought block (see AskAiScreen).
      const subs = [...(m.subs || [])];
      for (let i = subs.length - 1; i >= 0; i--) {
        if (subs[i].parent !== e.parent || subs[i].agent !== e.agent) continue;
        if (subs[i].kind === 'thinking') { subs[i] = { ...subs[i], text: (subs[i].text || '') + e.text }; return { ...m, subs }; }
        break;
      }
      subs.push({ id: `${e.parent}:think:${subs.length}`, depth: e.depth, parent: e.parent, agent: e.agent, kind: 'thinking', name: 'Thinking', text: e.text, status: 'done' });
      return { ...m, subs };
    });
    else if (e.type === 'usage') editLast((m) => ({ ...m, usage: { input: e.input, output: e.output, context: e.context, limit: e.limit, model: e.model || m.usage?.model, elapsedMs: e.elapsedMs } }));
    else if (e.type === 'elision') setMsgs((ms) => [...ms.slice(0, -1), { role: 'assistant', content: '', elision: { resultsElided: e.resultsElided, tokensReclaimed: e.tokensReclaimed } }, ms[ms.length - 1]]);
    else if (e.type === 'picked_up') promoteFromQueue(e.queueId, e.text);
    else if (e.type === 'done' || e.type === 'error') {
      if (e.type === 'error') editLast((m) => ({ ...m, content: m.content || `⚠ ${e.error}` }));
      setStreaming(false);
      // Reload spans so the finished view (authoritative) replaces the live thread.
      loadSpans();
      stop();
    }
    // `tasks` frames are ignored: this panel has no task-panel surface (see report).
    // Scrolling is handled by the msgs-keyed effect, which respects the user's scroll position.
  };

  // Wire a run's frame stream into the local thread. `runId` is what we sub to; `attach`
  // replays from seq 0 for a run this client didn't originate (the live/background run).
  const attachRun = (runId: string, attach: boolean) => {
    activeRunId.current = runId;
    const isActive = () => activeRunId.current === runId;
    let stop = () => {};
    stop = subChat(runId, (raw) => {
      if (!isActive()) { stop(); return; }
      applyFrame(raw, stop);
    }, { attach });
    return stop;
  };

  // Attach to a run that's already running when this panel opens (background/live run).
  useEffect(() => {
    if (run.status !== 'running') return;
    setMsgs([{ role: 'assistant', content: '', tools: [] }]);
    setStreaming(true);
    setPending(null);
    setQueue([]);
    const stop = attachRun(run.id, true);
    return () => { activeRunId.current = null; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, run.status]);

  const respond = (body: { approved?: boolean; answer?: string; scope?: 'once' | 'session' | 'always' }) => {
    if (!pending) return;
    const runId = activeRunId.current ?? run.id;
    const replyLabel =
      pending.kind === 'ask'
        ? (body.answer ?? '')
        : !body.approved ? 'Deny'
        : body.scope === 'always' ? 'Always allow'
        : body.scope === 'session' ? 'Allow for this chat'
        : 'Allow';
    // Splice the reply BEFORE the trailing assistant bubble so editLast() keeps landing on
    // the assistant bubble as the run continues the same turn.
    if (msgs.length > 0) setMsgs((ms) => { const next = [...ms]; next.splice(Math.max(0, next.length - 1), 0, { role: 'user', content: replyLabel }); return next; });
    api.respondRun({ jobId: runId, requestId: pending.id, ...body }).catch(() => {});
    setPending(null);
  };

  // Queue a steer/follow-up against the CURRENTLY streaming run — sits in a chip until the
  // backend's picked_up frame folds it into the thread (see promoteFromQueue).
  const queueMessage = async (text: string, mode: 'steer' | 'follow_up') => {
    const runId = activeRunId.current;
    if (!runId) return;
    queueSeq.current += 1;
    const queueId = `q-${Date.now()}-${queueSeq.current}`;
    setInput('');
    setQueue((q) => [...q, { queueId, text, mode }]);
    await api.steerRun(runId, text, mode, queueId).catch(() => {});
  };

  const removeFromQueue = async (queueId: string) => {
    const runId = activeRunId.current;
    setQueue((q) => q.filter((it) => it.queueId !== queueId));
    if (runId) await api.cancelRunPending(runId, queueId).catch(() => {});
  };

  const stop = async () => {
    const runId = activeRunId.current;
    if (!runId) return;
    const queued = queue;
    await Promise.all(queued.map((q) => api.cancelRunPending(runId, q.queueId).catch(() => {})));
    await api.stopRun(runId).catch(() => {});
    setStreaming(false);
    // Keep the most recent queued message in the box (don't silently resurrect it as a turn).
    if (queued.length) setInput((cur) => cur || queued[queued.length - 1].text);
    setQueue([]);
  };

  // Continue-as-chat: the run is finished, so a send starts a BRAND-NEW turn on the run's
  // session (run_<jobId>) — background runs launch with that session id, so the transcript
  // continues. Seed the user + empty assistant bubbles, start the turn, then stream it.
  const startNewTurn = async (text: string) => {
    // Seed the continued thread starting from the finished history (so the new turn reads in
    // context) plus the new user turn and an empty assistant bubble.
    const base = spans ? spansToMsgs(spans, String(spans.find((s) => s.kind === 'agent_run' || s.kind === 'subagent_run')?.attributes?.userInput ?? '')) : [];
    setMsgs([...(msgs.length ? msgs : base), { role: 'user', content: text }, { role: 'assistant', content: '', tools: [] }]);
    setStreaming(true);
    setPending(null);
    setQueue([]);
    setQueueMode('steer');
    activeRunId.current = `local-${Date.now()}`;
    let start: { sessionId: string | null; runId: string };
    try {
      start = await api.startChat({ agentId: run.agentId, sessionId: `run_${run.id}`, message: text });
    } catch {
      editLast((m) => ({ ...m, content: m.content || '⚠ Could not continue the conversation.' }));
      setStreaming(false);
      return;
    }
    attachRun(start.runId, true);
  };

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (streaming) { await queueMessage(text, queueMode); return; }
    setInput('');
    await startNewTurn(text);
  };

  // What to render in the thread: the live/continued msgs[] while we have any, otherwise the
  // finished run's trace-span history.
  const rootAttrs = spans?.find((s) => s.kind === 'agent_run' || s.kind === 'subagent_run')?.attributes || {};
  const userInput = String(rootAttrs.userInput ?? '');
  const historyMsgs = spans ? spansToMsgs(spans, userInput) : null;
  const showLive = msgs.length > 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Same layout as the chat page: a centered 720px column, gap-4, generous padding. */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 min-h-0">
        <div className="relative z-10 max-w-[720px] mx-auto flex flex-col gap-4">
          {showLive ? (
            msgs.map((m, i) => (
              <Bubble key={i} m={m} streaming={streaming && !pending && i === msgs.length - 1} live={streaming && i === msgs.length - 1} />
            ))
          ) : !run.traceId ? (
            <>
              {run.output && <div className="text-[13.5px] text-ink leading-relaxed whitespace-pre-wrap break-words">{run.output}</div>}
              {run.error && <div className="text-[12.5px] text-rec font-mono whitespace-pre-wrap break-all">{run.error}</div>}
              {!run.output && !run.error && <div className="text-[12.5px] text-ink3">No output.</div>}
            </>
          ) : spans === null ? (
            <div className="text-[12.5px] text-ink3">Loading…</div>
          ) : historyMsgs && historyMsgs.length > 0 ? (
            historyMsgs.map((m, i) => <Bubble key={i} m={m} streaming={false} />)
          ) : (
            <div className="text-[12.5px] text-ink3">No conversation recorded.</div>
          )}
          {pending && <PendingCard req={pending} onRespond={respond} />}
          {!showLive && run.error && run.traceId && <div className="text-[12.5px] text-rec font-mono whitespace-pre-wrap break-all">{run.error}</div>}
          <div ref={endRef} />
        </div>
      </div>

      <RunComposer
        input={input}
        setInput={setInput}
        streaming={streaming}
        queue={queue}
        queueMode={queueMode}
        onToggleMode={() => setQueueMode((m) => (m === 'steer' ? 'follow_up' : 'steer'))}
        onSend={send}
        onStop={stop}
        onRemoveQueued={removeFromQueue}
      />
    </div>
  );
}

// Composer at the bottom of a run conversation — mirrors the chat composer's steer/follow-up
// toggle, Stop button, queue chips, and send. When idle, send starts a new turn (continue-
// as-chat); while streaming, send queues a steer/follow-up.
function RunComposer({
  input, setInput, streaming, queue, queueMode, onToggleMode, onSend, onStop, onRemoveQueued,
}: {
  input: string;
  setInput: (v: string) => void;
  streaming: boolean;
  queue: QueuedMsg[];
  queueMode: 'steer' | 'follow_up';
  onToggleMode: () => void;
  onSend: () => void;
  onStop: () => void;
  onRemoveQueued: (queueId: string) => void;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = taRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } }, [input]);

  return (
    <div className="flex-none px-6 pb-5 pt-2">
      <div className="max-w-[720px] mx-auto rounded-[16px] border border-border bg-card shadow-soft overflow-hidden">
        {queue.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
            {queue.map((q) => (
              <span key={q.queueId} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-[8px] bg-bg border border-border text-[11.5px] text-ink2 max-w-[280px]">
                <span className="an-pulse w-1.5 h-1.5 rounded-full bg-accent flex-none" />
                <span className="text-ink3 flex-none">{q.mode === 'follow_up' ? 'Follow-up:' : 'Steering:'}</span>
                <span className="truncate">{q.text}</span>
                <button type="button" title="Remove from queue" onClick={() => onRemoveQueued(q.queueId)} className="text-ink3 hover:text-rec flex flex-none">
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
          placeholder={streaming ? 'Add something while it works…' : 'Continue the conversation…'}
          rows={1}
          className="w-full px-4 pt-2.5 pb-1.5 bg-transparent outline-none resize-none text-[14px] text-ink placeholder:text-ink3 leading-relaxed min-h-[34px] max-h-[160px]"
        />
        <div className="flex items-center gap-1.5 px-3 pb-2 pt-0.5">
          <div className="flex-1" />
          {streaming && (
            <button
              type="button"
              title={queueMode === 'follow_up' ? 'Follow-up: send after this turn finishes (click to switch to Steer)' : 'Steer: fold into this turn now (click to switch to Follow-up)'}
              onClick={onToggleMode}
              className="h-7 px-2 rounded-[8px] flex items-center gap-1 text-[11px] font-500 text-ink3 hover:bg-border-soft border border-border"
            >
              <Icon name={queueMode === 'follow_up' ? 'history' : 'zap'} size={11} />
              <span>{queueMode === 'follow_up' ? 'Follow-up' : 'Steer'}</span>
            </button>
          )}
          {streaming && (
            <button type="button" title="Stop" onClick={onStop}
              className="w-8 h-8 rounded-[9px] flex items-center justify-center bg-rec text-white hover:opacity-90">
              <Icon name="stop" size={12} />
            </button>
          )}
          {streaming ? (
            input.trim() && (
              <button type="button" title={queueMode === 'follow_up' ? 'Queue for after this turn (Enter)' : 'Steer into this turn (Enter)'} onClick={onSend}
                className="w-8 h-8 rounded-[9px] flex items-center justify-center bg-accent text-white hover:opacity-90">
                <Icon name="send" size={13} />
              </button>
            )
          ) : (
            <button type="button" title="Send (Enter)" onClick={onSend} disabled={!input.trim()}
              className={`w-8 h-8 rounded-[9px] flex items-center justify-center transition-colors ${input.trim() ? 'bg-accent text-white' : 'bg-border text-ink3'}`}>
              <Icon name="send" size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
