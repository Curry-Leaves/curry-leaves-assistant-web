import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { FallingLeaves } from '../../components/FallingLeaves';
import { api } from '../../api/client';
import { subChat } from '../../api/socket';
import { useEvents } from '../../hooks/useEvents';
import { useDictation } from '../../hooks/useDictation';
import { useVoiceChat } from '../../hooks/useVoiceChat';
import type { Agent, ChatSessionMeta, ChatAttachment } from '../../types';
import type { Active, ChatMsg, LiveRun, ThinkingEffort } from './model';
import { SessionRow } from './SessionRow';
import { ContextBar } from './ContextBar';
import { Chip } from './Chip';
import { Bubble } from './Bubble';
import { EmptyState } from './EmptyState';
import { PendingCard } from './PendingCard';
import { TaskPanel } from './TaskPanel';
import { SLASH_CMDS, SlashMenu, type SlashCmd } from './SlashMenu';
import { MentionMenu, REF_KINDS, type ChatReference, type MentionRow, type RefKind } from './MentionMenu';

// ─── screen ───────────────────────────────────────────────────────────────────
export const AskAiScreen = memo(function AskAiScreen({ agents, active: tabActive = true, onOpenNote }: { agents: Agent[]; active?: boolean; onOpenNote?: (path: string) => void }) {
  const chatAgents = useMemo(() => agents.filter((a) => a.surfaces.includes('chat')), [agents]);
  const pool = chatAgents.length ? chatAgents : agents;

  const [sessions, setSessions] = useState<ChatSessionMeta[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  // Latest known model ids, in a ref so openSession can validate a session's pinned model
  // against the *current* provider without re-subscribing to state.
  const modelIds = useRef<Set<string>>(new Set());
  // ─── live runs, per session ─────────────────────────────────────────────────
  // Runs are tracked per sessionId and OUTLIVE switching away from them: the backend keeps
  // streaming (nothing cancels on disconnect), so we keep the subscription open and keep
  // folding frames into that session's entry even while another chat is on screen. Switching
  // back re-renders from the entry — no refetch, no lost tokens, no orphaned run.
  //
  // A ref (not state) because frame handlers fire many times per second and must see the
  // latest map synchronously without re-subscribing; `runsTick` re-renders the parts that
  // display it (busy dots, and the open session's own bubbles).
  const runs = useRef<Map<string, LiveRun>>(new Map());
  const [, setRunsTick] = useState(0);
  const bumpRuns = () => setRunsTick((n) => n + 1);
  // Run ids this client has already attached a frame stream to. Keyed by RUN, not session:
  // the sender only learns its session id after `chat.start` resolves, but `chat.run.started`
  // (which the sender also receives) can land during that await — so a session-keyed guard
  // has nothing to match yet and the mirror path attaches a SECOND subscriber to the same run.
  // Two subscribers each dedup by their own lastSeq, so both pass and every token is appended
  // twice ("Nambi" -> "NNambiambi"). attachRun claims the id here synchronously to prevent it.
  const attached = useRef<Set<string>>(new Set());
  // The session currently on screen; null for an unsaved draft. Runs are keyed by session id,
  // so this is what decides which live run (if any) the view is showing.
  const openSessionId = useRef<string | null>(null);
  const liveRun = active?.id ? runs.current.get(active.id) : undefined;
  const streaming = Boolean(liveRun);
  // True while this client only MIRRORS a run it didn't start (a second tab/device on the
  // same session). The composer is read-only in this mode — the owner drives the turn.
  const mirroring = Boolean(liveRun?.mirror);
  // Whether Enter/send during an active run steers (folds in now) or follow-ups (queues
  // for after the current turn). Resets to 'steer' at the start of every new run.
  const [queueMode, setQueueMode] = useState<'steer' | 'follow_up'>('steer');
  const queueSeq = useRef(0);
  const [compacting, setCompacting] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  // @-references staged for the next turn. These — not the `@Title` text in the composer —
  // are what actually ships, so editing the prose can't corrupt a handle.
  const [refs, setRefs] = useState<ChatReference[]>([]);
  const [refKind, setRefKind] = useState<RefKind | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionRows, setMentionRows] = useState<MentionRow[]>([]);
  const [caret, setCaret] = useState(0);
  const [dirNonce, setDirNonce] = useState<{ path?: string; n: number }>({ n: 0 });
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>('medium');
  const [autonomous, setAutonomous] = useState(false);
  const [elide, setElide] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dictation = useDictation();
  const toggleMic = async () => {
    if (dictation.recording) {
      const text = await dictation.stop();
      if (text) setInput((prev) => (prev ? `${prev} ${text}` : text));
    } else {
      dictation.start();
    }
  };

  // Hands-free Voice mode (Kokoro TTS + whisper STT): hear → send → speak → repeat. The hook
  // hands us a finalized utterance to send as a turn; we feed reply tokens back to it (below,
  // in attachRun) so it can synthesize speech as the answer streams. Gated on the backend
  // reporting TTS is available (heavy dep — hidden entirely when it isn't).
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [canBrowseFiles, setCanBrowseFiles] = useState(false);
  useEffect(() => {
    api.capabilities().then((c) => {
      setTtsAvailable(Boolean(c.tts));
      setCanBrowseFiles(Boolean(c.fileBrowse));
    }).catch(() => {});
  }, []);
  // sendNewTurn is defined below; a ref lets the voice hook (created here) call the latest one.
  const sendTurnRef = useRef<(text: string) => void>(() => {});
  const voice = useVoiceChat((text) => sendTurnRef.current(text));


  const refreshSessions = () => api.listSessions().then(setSessions).catch(() => {});

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const agentId = active?.agentId || pool[0]?.id;
    if (!agentId) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const r = await api.attachFile(file, { agentId, sessionId: active?.id, model: active?.model });
        setActive((a) => (a ? { ...a, id: a.id ?? r.sessionId } : a));
        setAttachments((prev) => [...prev, r.file]);
      } catch { /* skip failed upload */ }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    refreshSessions();
  };
  const refreshCatalog = () => api.providerModels().then((r) => {
    setModels(r.models); setDefaultModel(r.default_model);
    modelIds.current = new Set(r.models.map((m) => m.id));
  }).catch(() => {});
  useEffect(() => { refreshSessions(); }, []);
  // On load, adopt every run the backend still has streaming. A run outlives the page that
  // started it, so after a reload (or in a second tab) this is the only way to find it again
  // — without it the session list shows no activity and the chat looks abandoned.
  useEffect(() => {
    api.liveRuns().then((live) => {
      for (const [sessionId, runId] of Object.entries(live)) {
        if (runs.current.has(sessionId)) continue;
        runs.current.set(sessionId, {
          runId, sessionId, mirror: true,
          messages: [], pending: null, queue: [], detach: () => {},
        });
        const detach = attachRun(runId, sessionId, true);
        const entry = runs.current.get(sessionId);
        if (entry && entry.runId === runId) entry.detach = detach;
      }
      bumpRuns();
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Re-pull the model catalog + default label every time this tab regains focus. The tabs are
  // keep-alive (never unmounted), so a one-shot mount fetch would go stale the moment the user
  // switches the provider/default in Settings and comes back — the picker would keep listing the
  // old provider's models. Refetching on focus keeps the dropdown honest.
  useEffect(() => { if (tabActive) refreshCatalog(); }, [tabActive]);
  // composer is always available — ensure there's a draft session to type into
  useEffect(() => { setActive((a) => a ?? { id: null, agentId: pool[0]?.id ?? '', model: '', messages: [] }); }, [pool]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); });
  useEffect(() => { const el = taRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } }, [input]);

  const agentName = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name : undefined);
  const filteredSessions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => `${s.title} ${agentName(s.agentId) ?? ''}`.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, search]);

  const editLast = (fn: (m: ChatMsg) => ChatMsg) =>
    setActive((a) => {
      if (!a || a.messages.length === 0) return a;  // no bubble yet (frame raced session-open) — nothing to edit
      const ms = [...a.messages];
      ms[ms.length - 1] = fn(ms[ms.length - 1]);
      return { ...a, messages: ms };
    });

  // ─── slash quick-actions ──────────────────────────────────────────────────
  const slashMatch = /^\/(\w*)$/.exec(input);
  const slashQuery = slashMatch ? slashMatch[1].toLowerCase() : null;
  const slashMatches = slashQuery !== null ? SLASH_CMDS.filter((c) => c.cmd.startsWith(slashQuery)) : [];
  const showSlash = slashQuery !== null && slashMatches.length > 0;
  useEffect(() => { setSlashIdx(0); }, [slashQuery]);

  // ─── @-references ─────────────────────────────────────────────────────────
  // Unlike the slash menu (anchored at position 0), a mention happens mid-sentence — so the
  // trigger matches the text BEFORE THE CARET. The leading (?:^|\s) keeps email addresses
  // from opening the menu. `caret` is tracked on every key/click so the match stays live.
  const atMatch = /(?:^|\s)@([\w-]*)$/.exec(input.slice(0, caret));
  const atQuery = atMatch ? atMatch[1] : null;
  const showAt = atQuery !== null && !showSlash;
  useEffect(() => { if (!showAt) { setRefKind(null); setMentionIdx(0); } }, [showAt]);
  useEffect(() => { setMentionIdx(0); }, [atQuery, refKind]);
  useEffect(() => {
    if (mentionIdx >= mentionRows.length) setMentionIdx(Math.max(0, mentionRows.length - 1));
  }, [mentionRows.length, mentionIdx]);

  /** Replace the half-typed `@foo` before the caret with a readable token, and stage the
   *  handle. The chip array is the source of truth — the text is only for the user to read. */
  const pickReference = (r: ChatReference) => {
    if (!refs.some((x) => x.type === r.type && x.id === r.id)) setRefs((prev) => [...prev, r]);
    const before = input.slice(0, caret).replace(/(^|\s)@[\w-]*$/, `$1@${r.title} `);
    const next = before + input.slice(caret);
    setInput(next);
    setRefKind(null);
    requestAnimationFrame(() => {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(before.length, before.length);
      setCaret(before.length);
    });
  };

  const commitMention = (): boolean => {
    const row = mentionRows[mentionIdx];
    if (!row) return false;
    if (row.pickKind) { setRefKind(row.pickKind); return true; }
    // A directory row navigates rather than picking. The nonce makes re-entering the same
    // path a distinct event, so the menu reloads even when the path is unchanged.
    if (row.enterDir !== undefined || row.isUp) {
      setDirNonce((d) => ({ path: row.enterDir, n: d.n + 1 }));
      setMentionIdx(0);
      return true;
    }
    if (row.pick) { pickReference(row.pick); return true; }
    return false;
  };

  const newChat = () => {
    // Leaves any live run streaming in the background — it belongs to its own session.
    openSessionId.current = null;
    setActive({ id: null, agentId: pool[0]?.id ?? '', model: '', messages: [], pending: null });
    setAttachments([]);
    taRef.current?.focus();
  };

  const pickSlash = (cmd: SlashCmd) => {
    setInput('');
    setSlashIdx(0);
    if (cmd === 'clear') newChat();
  };

  const openSession = async (s: ChatSessionMeta) => {
    openSessionId.current = s.id;
    // A session stores the model it was created under. If the user has since switched providers,
    // that id isn't offered anymore — pinning it would send a dead model_override that the backend
    // honors verbatim (bypassing the new provider's default) and the turn would 400 or run the wrong
    // model. Drop it to '' (= Default) unless the current provider still lists it.
    const pinned = s.model && modelIds.current.has(s.model) ? s.model : '';
    setAttachments([]);

    // Is a run for this session still streaming into its entry? Then render from that copy —
    // it holds the in-flight turn's partial text, which the transcript on disk does NOT (the
    // kernel only records an assistant message at MessageEnd). Refetching here would blank
    // the very tokens the user came back to see.
    const live = runs.current.get(s.id);
    if (live) {
      setActive({
        id: s.id, agentId: s.agentId || pool[0]?.id || '', model: pinned,
        messages: [...live.messages], runId: live.runId,
        pending: live.pending ?? null, queue: live.queue, tasks: live.tasks,
      });
      return;
    }

    setActive({ id: s.id, agentId: s.agentId || pool[0]?.id || '', model: pinned, messages: [], pending: null });
    try {
      const msgs = await api.sessionMessages(s.id);
      setActive((a) => (a && a.id === s.id ? { ...a, messages: msgs as ChatMsg[] } : a));
    } catch { /* noop */ }
    try {
      const tasks = await api.sessionTasks(s.id);
      if (tasks.length) setActive((a) => (a && a.id === s.id ? { ...a, tasks } : a));
    } catch { /* noop */ }
    // No local entry, but the backend may still be running this session from a previous page
    // load (or another device). Adopt that run and stream it live rather than showing a
    // frozen transcript that never completes.
    if (openSessionId.current === s.id && !runs.current.has(s.id)) adoptLiveRun(s.id);
  };

  // Attach to a run this client didn't start (or lost the handle to across a reload). Frames
  // replay from seq 0, so the in-flight turn's text is rebuilt; the transcript we just
  // fetched is the base, and the trailing assistant bubble is seeded empty for tokens to
  // fill. Read-only (mirror) — the run's owner drives it.
  const adoptLiveRun = async (sessionId: string) => {
    let runId: string | undefined;
    try { runId = (await api.liveRuns())[sessionId]; } catch { return; }
    if (!runId || runs.current.has(sessionId)) return;
    const base = openSessionId.current === sessionId ? (active?.messages ?? []) : [];
    runs.current.set(sessionId, {
      runId, sessionId, mirror: true,
      messages: [...base, { role: 'assistant', content: '', tools: [] }],
      pending: null, queue: [], detach: () => {},
    });
    const detach = attachRun(runId, sessionId, true);
    const entry = runs.current.get(sessionId);
    if (entry && entry.runId === runId) entry.detach = detach;
    bumpRuns();
  };

  // Branch a new session off the current one, up through the given user turn (0-indexed),
  // then switch to it — mirrors openSession but the id comes back from the fork call
  // instead of a session the user picked from history.
  const fork = async (uptoTurn: number) => {
    if (!active?.id) return;
    try {
      const { sessionId } = await api.forkSession(active.id, uptoTurn);
      // The fork is a fresh session with no run of its own; any run on the session we forked
      // FROM keeps streaming in the background under its own id.
      openSessionId.current = sessionId;
      setActive({ id: sessionId, agentId: active.agentId, model: active.model, messages: [], pending: null });
      setAttachments([]);
      const msgs = await api.sessionMessages(sessionId);
      setActive((a) => (a && a.id === sessionId ? { ...a, messages: msgs as ChatMsg[] } : a));
      refreshSessions();
    } catch { /* noop */ }
  };

  const del = async (id: string) => {
    await api.deleteSession(id).catch(() => {});
    setActive((a) => (a?.id === id ? { id: null, agentId: pool[0]?.id ?? '', model: '', messages: [] } : a));
    refreshSessions();
  };

  // Fire-and-forget a queued (steer/follow_up) message as a brand-new turn. Used both by
  // the normal composer send and to auto-resend anything abandoned when a run ends before
  // the backend picked it up (see the 'done'/'error' branch below).
  const sendNewTurn = async (text: string, atts: ChatAttachment[] = [], rs: ChatReference[] = []) => {
    const cur = active ?? { id: null, agentId: pool[0]?.id ?? '', model: '', messages: [] };
    if (!cur.agentId) return;
    // The two new bubbles (user + the empty assistant one frames will fill) — seeded here so
    // they show instantly, then handed to the run entry once the backend gives us its ids.
    const seeded: ChatMsg[] = [...cur.messages,
      { role: 'user', content: text, attachments: atts.length ? atts : undefined, references: rs.length ? rs : undefined },
      { role: 'assistant', content: '', tools: [] }];
    setActive((a) => (a ? { ...a, messages: seeded } : a));
    setQueueMode('steer');
    // The session this turn belongs to, as known when it was sent. For a brand-new chat there
    // is no id yet — the backend mints one — so the run can only be registered after start.
    const startedFrom = cur.id;

    // Start the turn over the WS (returns the session + run ids), then attach to its frame
    // stream. `chat.start` auto-subscribes server-side; subChat wires the local handler and
    // survives reconnects (re-attaches + replays). Ephemeral edits pass no session id.
    let start: { sessionId: string | null; runId: string };
    try {
      start = await api.startChat({
        agentId: cur.agentId, message: text, model: cur.model || undefined, sessionId: cur.id || undefined,
        attachments: atts.map((a) => a.mdPath).filter((p): p is string => Boolean(p)),
        references: rs,
        thinkingEffort: thinkingEffort === 'off' ? null : thinkingEffort,
        autonomous,
        elide,
      });
    } catch {
      // Write the failure into whichever session sent it, even if the user has moved on.
      if (openSessionId.current === startedFrom) {
        editLast((m) => ({ ...m, content: m.content || '⚠ Could not start the chat.' }));
      }
      return;
    }
    const sid = start.sessionId ?? startedFrom;
    if (!sid) return;  // ephemeral turn — no session to track a run against
    // Register the run BEFORE attaching so the first frame has an entry to land in. It keeps
    // its own copy of the thread; that copy is what a switch-back renders from.
    runs.current.set(sid, {
      runId: start.runId, sessionId: sid, mirror: false,
      messages: seeded, pending: null, queue: [], detach: () => {},
    });
    // A fresh chat only gets its id here — adopt it so the open view is bound to the session
    // the run belongs to (otherwise the run would be invisible to the very tab that started it).
    if (openSessionId.current === startedFrom) {
      openSessionId.current = sid;
      setActive((a) => (a ? { ...a, id: sid, runId: start.runId } : a));
    }
    const detach = attachRun(start.runId, sid, false);
    const entry = runs.current.get(sid);
    if (entry && entry.runId === start.runId) entry.detach = detach;
    bumpRuns();
    refreshSessions();
  };
  // Keep the voice hook pointed at the latest sendNewTurn (closes over current agent/model/etc).
  sendTurnRef.current = (text: string) => { sendNewTurn(text); };

  // Wire a run's frame stream into ITS SESSION's entry in `runs` — not into whatever is on
  // screen. The subscription is kept open when the user switches away (the backend is still
  // streaming either way), so the run keeps accumulating and switching back shows it live.
  // `mirror` = this client didn't start the run (a second tab/device on the same session);
  // in that mode the local steer queue isn't ours, so picked_up/flushAbandonedQueue are skipped.
  //
  // Every frame is applied to the run entry first; `syncActive` then mirrors that entry into
  // `active` only while that session is the one being viewed. That ordering is what keeps a
  // background run's tokens out of the foreground chat.
  const attachRun = (runId: string, sessionId: string, mirror: boolean) => {
    // Already streaming this run (the sender and the chat.run.started mirror path raced) —
    // a second subscriber would double every token, so hand back a no-op detach.
    if (attached.current.has(runId)) return () => {};
    attached.current.add(runId);
    // Frames for a run whose entry is gone (superseded/stopped) are dropped, not applied.
    const entry = () => runs.current.get(sessionId);
    const alive = () => entry()?.runId === runId;
    // Apply a change to the run's message list, then reflect it if that session is on screen.
    const patch = (fn: (r: LiveRun) => void) => {
      const r = entry();
      if (!r || r.runId !== runId) return;
      fn(r);
      if (openSessionId.current === sessionId) {
        setActive((a) => (a && a.id === sessionId
          ? { ...a, messages: [...r.messages], pending: r.pending ?? null, queue: r.queue, tasks: r.tasks }
          : a));
      }
      bumpRuns();
    };
    // editLast, scoped to this run rather than to `active`.
    const edit = (fn: (m: ChatMsg) => ChatMsg) => patch((r) => {
      if (r.messages.length === 0) return;  // no bubble yet (frame raced session-open)
      r.messages[r.messages.length - 1] = fn(r.messages[r.messages.length - 1]);
    });
    let stop = () => {};
    stop = subChat(runId, (raw) => {
      const e = raw as any;
      if (!alive()) { stop(); return; }  // run superseded or cleared — detach this stream
      if (e.type === 'gone') { endRun(sessionId, runId); refreshSessions(); stop(); return; }
      if (e.type === 'approve') patch((r) => { r.pending = { id: e.id, kind: 'approve', tool: e.tool, args: e.args, risk: e.risk }; });
      else if (e.type === 'ask') patch((r) => { r.pending = { id: e.id, kind: 'ask', question: e.question, options: e.options }; });
      else if (e.type === 'thinking') edit((m) => {
        // Extend the trail's last thinking part, or start a new one after a tool call —
        // preserving the thought → tool → thought interleaving for the collapsed ToolGroup.
        const trail = [...(m.trail || [])];
        const last = trail[trail.length - 1];
        if (last?.kind === 'thinking') trail[trail.length - 1] = { kind: 'thinking', text: last.text + e.text };
        else trail.push({ kind: 'thinking', text: e.text });
        return { ...m, thinking: (m.thinking || '') + e.text, trail };
      });
      // Voice only speaks the chat the user is actually looking at — a background run's
      // tokens must not be read aloud over the foreground one.
      else if (e.type === 'token') { edit((m) => ({ ...m, content: m.content + e.text })); if (voice.active && openSessionId.current === sessionId) voice.feedReplyToken(e.text); }
      else if (e.type === 'tool_start') edit((m) => ({ ...m, tools: [...(m.tools || []), { id: e.id, name: e.name, input: e.input, status: 'running' }], trail: [...(m.trail || []), { kind: 'tool', id: e.id }] }));
      else if (e.type === 'tool_end') edit((m) => ({ ...m, tools: (m.tools || []).map((t) => (t.id === e.id ? { ...t, output: e.output, status: e.isError ? 'error' : 'done', tokensIn: e.tokensIn, tokensOut: e.tokensOut } : t)) }));
      else if (e.type === 'sub' && e.kind === 'tool_start') edit((m) => ({ ...m, subs: [...(m.subs || []), { id: e.id, depth: e.depth, parent: e.parent, agent: e.agent, kind: 'tool', name: e.name, input: e.input, status: 'running' }] }));
      else if (e.type === 'sub' && e.kind === 'tool_end') edit((m) => ({ ...m, subs: (m.subs || []).map((s) => (s.id === e.id ? { ...s, output: e.output, status: e.isError ? 'error' : 'done' } : s)) }));
      else if (e.type === 'sub' && e.kind === 'thinking') edit((m) => {
        // Thinking arrives as deltas. Append to the subagent's trailing thought block
        // rather than pushing a row per token — but only if it's still the last step for
        // THIS subagent; once it runs a tool, the next thought starts a fresh block.
        const subs = [...(m.subs || [])];
        for (let i = subs.length - 1; i >= 0; i--) {
          if (subs[i].parent !== e.parent || subs[i].agent !== e.agent) continue;
          if (subs[i].kind === 'thinking') { subs[i] = { ...subs[i], text: (subs[i].text || '') + e.text }; return { ...m, subs }; }
          break;  // its most recent step is a tool call — fall through to a new block
        }
        subs.push({ id: `${e.parent}:think:${subs.length}`, depth: e.depth, parent: e.parent, agent: e.agent, kind: 'thinking', name: 'Thinking', text: e.text, status: 'done' });
        return { ...m, subs };
      });
      else if (e.type === 'usage') edit((m) => ({ ...m, usage: { input: e.input, output: e.output, context: e.context, limit: e.limit, model: e.model || m.usage?.model, elapsedMs: e.elapsedMs } }));
      else if (e.type === 'elision') patch((r) => {
        r.messages.splice(r.messages.length - 1, 0, { role: 'assistant', content: '', elision: { resultsElided: e.resultsElided, tokensReclaimed: e.tokensReclaimed } });
      });
      else if (e.type === 'tasks') patch((r) => { r.tasks = e.tasks; });
      else if (e.type === 'picked_up') { if (!mirror) promoteFromQueue(sessionId, e.queueId, e.text); }
      else if (e.type === 'done' || e.type === 'error') {
        // Surface the failure reason. Write it into the in-flight assistant bubble; if the error
        // raced ahead of any bubble (empty messages — e.g. a fast auth failure), append one so
        // the reason is still shown rather than silently dropped by edit's empty-guard.
        if (e.type === 'error') patch((r) => {
          if (r.messages.length === 0) { r.messages.push({ role: 'assistant', content: `⚠ ${e.error}` }); return; }
          const last = r.messages[r.messages.length - 1];
          r.messages[r.messages.length - 1] = { ...last, content: last.content || `⚠ ${e.error}` };
        });
        if (voice.active && openSessionId.current === sessionId) voice.endReply();  // speak the tail, then re-open the mic
        if (!mirror) flushAbandonedQueue(sessionId);
        // A mirror reloads the authoritative transcript once the turn settles, so any frames
        // it missed before attaching are reconciled. Also the backstop for a long run that
        // overflowed the server's 1000-frame replay buffer while this client was detached.
        if (mirror) api.sessionMessages(sessionId).then((msgs) => {
          if (openSessionId.current === sessionId)
            setActive((a) => (a && a.id === sessionId ? { ...a, messages: msgs as ChatMsg[] } : a));
        }).catch(() => {});
        endRun(sessionId, runId);   // clears the entry → streaming/busy flip off
        refreshSessions();
        stop();  // terminal frame — detach from the run
      }
      if (openSessionId.current === sessionId) endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, { attach: mirror });  // a mirror must explicitly subscribe to the run; the originator is already subscribed
    // Release the claim when this stream is torn down, so a later re-attach to the same run
    // (reconnect, switch-back) can subscribe again rather than being silently refused.
    const stopOnce = stop;
    stop = () => { attached.current.delete(runId); stopOnce(); };
    return stop;
  };

  // Tear a finished run's entry down (id-guarded so a late frame from a superseded run can't
  // evict a newer one). The composer unlocks purely as a consequence of the entry going away.
  const endRun = (sessionId: string, runId: string) => {
    const r = runs.current.get(sessionId);
    if (!r || r.runId !== runId) return;
    runs.current.delete(sessionId);
    bumpRuns();
  };

  // A second tab/device viewing this same session sees the run start (chat.run.started on
  // the shared event feed) and mirrors it live: seed the user + empty assistant bubbles it
  // didn't type, then attach the run stream read-only. subChat replays from seq 0, so it
  // catches up on anything emitted before this handler ran.
  const mirrorRun = (runId: string, sessionId: string, message: string) => {
    if (runs.current.has(sessionId)) return;  // already tracking a run for this session
    const base = openSessionId.current === sessionId ? (active?.messages ?? []) : [];
    runs.current.set(sessionId, {
      runId, sessionId, mirror: true,
      messages: [...base, { role: 'user', content: message }, { role: 'assistant', content: '', tools: [] }],
      pending: null, queue: [], detach: () => {},
    });
    if (openSessionId.current === sessionId) setActive((a) => (a ? { ...a, runId } : a));
    const detach = attachRun(runId, sessionId, true);
    const entry = runs.current.get(sessionId);
    if (entry && entry.runId === runId) entry.detach = detach;
    bumpRuns();
  };

  // Watch the shared event feed for runs starting on ANY session — not just the one on
  // screen. Tracking them all is what lets the session list show which chats are working,
  // and means switching to one of them attaches to a stream that's already accumulating.
  useEvents((raw) => {
    const e = raw as { type?: string; payload?: { sessionId?: string; runId?: string; message?: string } };
    if (e.type !== 'chat.run.started' || !e.payload) return;
    const { sessionId, runId, message } = e.payload;
    if (!runId || !sessionId) return;
    const existing = runs.current.get(sessionId);
    if (existing) return;  // ours (chat.start registered it) or already mirrored
    mirrorRun(runId, sessionId, message || '');
  });

  // Backend confirmed a queued item was folded into the running turn (picked_up SSE
  // event) — move it from the queue chip into the real thread, as a user bubble spliced
  // BEFORE the trailing in-progress assistant bubble (editLast() always targets
  // messages[length-1], so the assistant bubble must stay last).
  const promoteFromQueue = (sessionId: string, queueId: string, text: string) => {
    const r = runs.current.get(sessionId);
    if (r) {
      r.messages.splice(r.messages.length - 1, 0, { role: 'user', content: text });
      r.queue = (r.queue || []).filter((q) => q.queueId !== queueId);
      if (openSessionId.current === sessionId) {
        setActive((a) => (a && a.id === sessionId ? { ...a, messages: [...r.messages], queue: r.queue } : a));
      }
      bumpRuns();
    }
  };

  // A run ended NATURALLY (done/error) with items still sitting in the queue chip,
  // never picked up. Don't drop them silently — fire each as a fresh new turn once the
  // run is over, in the order they were queued. NOT used for an explicit user Stop —
  // see discardQueue below; stopping is cancelling, not "send it anyway".
  // Only auto-resends into the session the user is actually looking at: sendNewTurn starts a
  // turn against the OPEN chat, so firing leftovers from a background session would post them
  // into the wrong conversation. For a background run they're dropped rather than misfiled.
  const flushAbandonedQueue = (sessionId: string) => {
    const r = runs.current.get(sessionId);
    if (!r || !r.queue || r.queue.length === 0) return;
    const leftover = r.queue;
    r.queue = [];
    if (openSessionId.current !== sessionId) return;
    queueMicrotask(async () => {
      for (const item of leftover) await sendNewTurn(item.text);
    });
  };

  // The user explicitly stopped the run: queued steer/follow-up items must NOT be
  // auto-posted as a new turn — that would silently resurrect a message the user meant
  // to cancel along with everything else. Restore the most recent one to the input box
  // (so nothing is lost outright) and drop the rest.
  const discardQueue = (sessionId: string) => {
    const r = runs.current.get(sessionId);
    if (!r || !r.queue || r.queue.length === 0) return;
    const last = r.queue[r.queue.length - 1];
    setInput((cur) => cur || last.text);
    r.queue = [];
    setActive((a) => (a && a.id === sessionId ? { ...a, queue: [] } : a));
  };

  // Queue a message against the CURRENT run instead of starting a new one. 'steer' folds
  // it in before the model's next step; 'follow_up' waits until the turn settles. It sits
  // in the queue chip (not the thread) until the backend's picked_up event confirms the
  // runner actually folded it in (see promoteFromQueue).
  const queueMessage = async (text: string, mode: 'steer' | 'follow_up', rs: ChatReference[] = []) => {
    const sid = active?.id;
    const r = sid ? runs.current.get(sid) : undefined;
    if (!sid || !r) return;
    queueSeq.current += 1;
    const queueId = `q-${Date.now()}-${queueSeq.current}`;
    setInput('');
    r.queue = [...(r.queue || []), { queueId, text, mode }];
    setActive((a) => (a && a.id === sid ? { ...a, queue: r.queue } : a));
    bumpRuns();
    await api.steerChat(r.runId, text, mode, queueId, rs).catch(() => {});
  };

  const removeFromQueue = async (queueId: string) => {
    const sid = active?.id;
    const r = sid ? runs.current.get(sid) : undefined;
    if (!sid || !r) return;
    r.queue = (r.queue || []).filter((q) => q.queueId !== queueId);
    setActive((a) => (a && a.id === sid ? { ...a, queue: r.queue } : a));
    bumpRuns();
    await api.cancelPending(r.runId, queueId).catch(() => {});
  };

  // Cancels the in-flight run outright (backend cancels its driving task). The stream's
  // 'done'/'error' event never arrives for a hard stop, so flip `streaming` off here too
  // instead of waiting for an event that won't come. Queued steer/follow-up items are
  // discarded (not auto-sent) — the user stopped the run, they didn't ask to send those
  // messages as a new turn. Cancel each on the backend first so a picked_up event can't
  // race in after stop and fold one in anyway.
  const stop = async () => {
    const sid = active?.id;
    const r = sid ? runs.current.get(sid) : undefined;
    if (!sid || !r) return;
    const runId = r.runId;
    const queued = r.queue || [];
    await Promise.all(queued.map((q) => api.cancelPending(runId, q.queueId).catch(() => {})));
    await api.stopChat(runId).catch(() => {});
    discardQueue(sid);
    // A hard stop produces no terminal frame, so tear the subscription and entry down here
    // rather than waiting for a 'done' that will never arrive.
    r.detach();
    endRun(sid, runId);
  };

  const send = async () => {
    if (mirroring || compacting) return;  // read-only while mirroring, or compaction is rewriting the transcript
    const text = input.trim();
    const atts = attachments;
    const rs = refs;
    if ((!text && atts.length === 0) || uploading) return;
    // Mid-run: the turn rides chat.steer, which carries references too — otherwise a mention
    // typed while the assistant is working would vanish with no error.
    if (streaming) { if (text) { setRefs([]); await queueMessage(text, queueMode, rs); } return; }
    setInput('');
    setAttachments([]);
    setRefs([]);
    await sendNewTurn(text, atts, rs);
  };

  const setAgent = (aid: string) => setActive((a) => (a ? { ...a, agentId: aid } : a));
  const setModel = (m: string) => setActive((a) => (a ? { ...a, model: m } : a));

  // Answer a mid-run approve/ask prompt; the SSE stream resumes once the backend gets it.
  const respond = async (body: { approved?: boolean; answer?: string; scope?: 'once' | 'session' | 'always' }) => {
    const runId = active?.runId; const pending = active?.pending;
    if (!runId || !pending) return;
    // Build a human-readable label for the user reply bubble.
    const replyLabel =
      pending.kind === 'ask'
        ? (body.answer ?? '')
        : !body.approved
          ? 'Deny'
          : body.scope === 'always' ? 'Always allow'
          : body.scope === 'session' ? 'Allow for this chat'
          : 'Allow';
    // Show the reply as its own small bubble, spliced BEFORE the trailing in-progress
    // assistant bubble (not appended after) — do NOT start a new assistant bubble, the
    // run is CONTINUING the same turn. editLast() always targets messages[length-1]; if
    // the reply bubble became last, later tool_start/tool_end/token events would land on
    // it (a user-role bubble) instead of the assistant bubble, and any tool still in
    // flight when this approval fired would appear stuck at "running" forever.
    setActive((a) => {
      if (!a) return a;
      const ms = [...a.messages];
      ms.splice(ms.length - 1, 0, { role: 'user' as const, content: replyLabel });
      return { ...a, pending: null, messages: ms };
    });
    await api.respondChat({ runId, requestId: pending.id, tool: pending.tool, ...body }).catch(() => {});
  };

  const doCompact = async (): Promise<number> => {
    if (!active || !active.id || compacting || streaming) return 0;
    setCompacting(true);
    let saved = 0;
    try {
      const r = await api.compact(active.id, active.agentId);
      saved = r.tokensSaved;
      setActive((a) => (a ? { ...a, messages: [{ role: 'assistant', content: r.summary, compacted: true }] } : a));
      refreshSessions();
    } catch { /* noop */ }
    setCompacting(false);
    return saved;
  };

  const activeTitle = sessions.find((s) => s.id === active?.id)?.title;

  return (
    <div className="flex-1 flex min-h-0 min-w-0">
      {/* history panel (inline, collapsible) */}
      <div className={`flex-none flex flex-col min-h-0 border-r border-border bg-card/20 overflow-hidden transition-[width] duration-200 ${showHistory ? 'w-[300px]' : 'w-0 border-r-0'}`}>
        <div className="w-[300px] flex flex-col min-h-0 flex-1">
          <div className="flex-none flex items-center gap-1.5 px-2 py-2 min-h-12 border-b border-border">
            <div className="flex-1 flex items-center gap-1.5 h-7 px-2 rounded-[6px] bg-card border border-border">
              <Icon name="search" size={12} color="var(--color-ink3)" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats…" className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-ink" />
              {search && <button type="button" title="Clear search" onClick={() => setSearch('')} className="text-ink3 flex"><Icon name="x" size={11} /></button>}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5 flex flex-col">
            {filteredSessions.length === 0 && (
              <div className="text-[11.5px] text-faint text-center py-12">{search ? 'No results' : 'No chats yet'}</div>
            )}
            {filteredSessions.map((s) => (
              <SessionRow key={s.id} s={s} agentName={agentName(s.agentId)} active={s.id === active?.id} busy={runs.current.has(s.id)} onOpen={() => openSession(s)} onDelete={() => del(s.id)} />
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 min-w-0 relative">
      {/* header */}
      <div className="flex-none flex items-center gap-2 px-4 py-2 min-h-12 border-b border-border bg-card/40">
        <button type="button" onClick={() => setShowHistory((v) => !v)} title={showHistory ? 'Hide chat history' : 'Show chat history'}
          className={`inline-flex items-center gap-1.5 h-8 pl-2 pr-2.5 rounded-[8px] text-[12.5px] border hover:bg-border-soft ${showHistory ? 'border-accent text-accent bg-accent-soft/40' : 'border-border text-ink2'}`}>
          <Icon name="library" size={13} />
          <span>History</span>
        </button>
        <div className="flex-1 min-w-0 flex flex-col items-center px-2">
          <div className="text-[13px] font-500 text-ink2 truncate max-w-full">
            {active?.id ? (activeTitle || 'Chat') : 'New chat'}
          </div>
          {active?.id && (
            <button
              type="button"
              title="Click to copy session id"
              onClick={() => navigator.clipboard.writeText(active.id!).catch(() => {})}
              className="text-[10px] font-mono text-ink3 hover:text-ink2 truncate max-w-full"
            >
              {active.id}
            </button>
          )}
        </div>
        <button type="button" onClick={newChat} title="New chat"
          className="inline-flex items-center gap-1.5 h-8 pl-2 pr-2.5 rounded-[8px] text-[12.5px] text-white bg-accent hover:opacity-90">
          <Icon name="plus" size={13} />
          <span>New chat</span>
        </button>
      </div>

      {/* thread */}
      <div className="relative flex-1 overflow-y-auto px-6 py-6 min-h-0">
        {(!active || active.messages.length === 0) && <FallingLeaves />}
        <div className="relative z-10 max-w-[720px] mx-auto flex flex-col gap-4">
          {(!active || active.messages.length === 0) ? (
            <EmptyState onPick={(t) => { setInput(t); taRef.current?.focus(); }} />
          ) : (
            (() => {
              let userTurn = -1;
              return active.messages.map((m, i) => {
                if (m.role === 'user' && !m.action) userTurn += 1;
                const turn = userTurn;
                return (
                  <Bubble key={i} m={m} streaming={streaming && !active.pending && i === active.messages.length - 1}
                    live={streaming && i === active.messages.length - 1}
                    onOpenNote={onOpenNote}
                    onFork={active.id && m.role === 'user' && !m.action ? () => fork(turn) : undefined} />
                );
              });
            })()
          )}
          {active?.pending && <PendingCard req={active.pending} onRespond={respond} />}
          <div ref={endRef} />
        </div>
      </div>

      {/* composer — always available */}
      <div className="flex-none px-6 pb-5">
        <div className="max-w-[720px] mx-auto">
          <div className="relative">
          {showSlash && <SlashMenu matches={slashMatches} idx={Math.min(slashIdx, slashMatches.length - 1)} onPick={pickSlash} />}
          {showAt && (
            <MentionMenu
              kind={refKind}
              query={atQuery ?? ''}
              idx={mentionIdx}
              setIdx={setMentionIdx}
              onRows={setMentionRows}
              onPickKind={setRefKind}
              onPick={pickReference}
              dirNonce={dirNonce}
              canBrowseFiles={canBrowseFiles}
            />
          )}
          <div className="rounded-[16px] border border-border bg-card shadow-soft overflow-hidden">
            {/* agent task list — docked to the top of the input box, collapsible; removes itself when all tasks are done */}
            {active?.tasks && active.tasks.length > 0 && (
              <TaskPanel tasks={active.tasks} onDismiss={() => setActive((a) => (a ? { ...a, tasks: undefined } : a))} />
            )}
            {active?.queue && active.queue.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
                {active.queue.map((q) => (
                  <span key={q.queueId} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-[8px] bg-bg border border-border text-[11.5px] text-ink2 max-w-[280px]">
                    <span className="an-pulse w-1.5 h-1.5 rounded-full bg-accent flex-none" />
                    <span className="text-ink3 flex-none">{q.mode === 'follow_up' ? 'Follow-up:' : 'Steering:'}</span>
                    <span className="truncate">{q.text}</span>
                    <button type="button" title="Remove from queue" onClick={() => removeFromQueue(q.queueId)} className="text-ink3 hover:text-rec flex flex-none">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {dictation.recording && (
              <div className="flex items-center gap-2 px-4 pt-2.5 text-[12px]">
                <span className="an-pulse w-1.5 h-1.5 rounded-full bg-rec flex-none" />
                <span className={`flex-1 truncate ${dictation.transcript ? 'text-ink2' : 'text-ink3 italic'}`}>
                  {dictation.transcript || 'Listening…'}
                </span>
              </div>
            )}
            {refs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
                {refs.map((r) => (
                  <span key={`${r.type}:${r.id}`} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-[8px] bg-accent-soft border border-accent/25 text-[11.5px] text-accent-ink max-w-[220px]">
                    <Icon name={REF_KINDS.find((k) => k.kind === r.type)?.icon ?? 'file'} size={11} />
                    <span className="truncate">{r.title}</span>
                    <button type="button" title="Remove reference"
                      onClick={() => setRefs((prev) => prev.filter((x) => !(x.type === r.type && x.id === r.id)))}
                      className="text-accent/60 hover:text-rec flex">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {(attachments.length > 0 || uploading) && (
              <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2.5">
                {attachments.map((a, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-[8px] bg-bg border border-border text-[11.5px] text-ink2 max-w-[200px]">
                    <Icon name="file" size={11} />
                    <span className="truncate">{a.name}</span>
                    <button type="button" title="Remove" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} className="text-ink3 hover:text-rec flex">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
                {uploading && <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink3"><span className="an-pulse w-1.5 h-1.5 rounded-full bg-accent" />Uploading…</span>}
              </div>
            )}
            <textarea
              ref={taRef}
              value={input}
              onChange={(e) => { setInput(e.target.value); setCaret(e.target.selectionStart ?? 0); }}
              onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onKeyDown={(e) => {
                if (showSlash) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx((i) => Math.min(i + 1, slashMatches.length - 1)); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx((i) => Math.max(i - 1, 0)); return; }
                  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickSlash(slashMatches[Math.min(slashIdx, slashMatches.length - 1)].cmd); return; }
                  if (e.key === 'Escape') { e.preventDefault(); setInput(''); return; }
                }
                if (showAt) {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => Math.min(i + 1, mentionRows.length - 1)); return; }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => Math.max(i - 1, 0)); return; }
                  if (e.key === 'Enter' || e.key === 'Tab') { if (commitMention()) { e.preventDefault(); return; } }
                  // Escape backs out one level (item list → kind list) before closing, so a
                  // wrong kind doesn't cost you the whole mention.
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    if (refKind) setRefKind(null);
                    else setInput(input.slice(0, caret).replace(/(^|\s)@[\w-]*$/, '$1') + input.slice(caret));
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              placeholder={mirroring ? 'Watching this chat live from another device…' : compacting ? 'Compacting conversation…' : uploading ? 'Uploading attachment…' : streaming ? 'Add something while it works…' : 'Ask anything…  (/ for quick actions)'}
              rows={1}
              disabled={uploading || mirroring || compacting}
              className="w-full px-4 pt-2.5 pb-1.5 bg-transparent outline-none resize-none text-[14px] text-ink placeholder:text-ink3 leading-relaxed min-h-[34px] max-h-[160px] disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <div className="flex items-center gap-1.5 px-3 pb-2 pt-0.5">
              <input ref={fileRef} type="file" multiple aria-label="Attach file" title="Attach file" className="hidden" onChange={(e) => onPickFiles(e.target.files)} />
              <button
                type="button"
                title="Attach file"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="w-7 h-7 rounded-[8px] flex items-center justify-center text-ink3 hover:bg-border-soft disabled:opacity-50"
              >
                <Icon name="paperclip" size={14} />
              </button>
              <div className="flex-1" />
              {active?.id && active.messages.length >= 2 && (
                <ContextBar messages={active.messages} max={128000} compacting={compacting} onCompact={doCompact} />
              )}
              <button
                type="button"
                title={dictation.recording ? 'Stop dictation' : 'Dictate'}
                onClick={toggleMic}
                disabled={uploading}
                className={`w-7 h-7 rounded-[8px] flex items-center justify-center transition-colors disabled:opacity-50 ${
                  dictation.recording ? 'bg-rec text-white an-pulse' : 'text-ink3 hover:bg-border-soft'
                }`}
              >
                <Icon name="mic" size={14} />
              </button>
              {ttsAvailable && (
                <button
                  type="button"
                  title={voice.active
                    ? (voice.phase === 'listening' ? 'Voice: listening… (click to stop)'
                       : voice.phase === 'speaking' ? 'Voice: speaking… (click to stop)'
                       : 'Stop voice chat')
                    : 'Voice chat (hands-free: speak, it replies aloud)'}
                  onClick={voice.toggle}
                  disabled={uploading || mirroring}
                  className={`w-7 h-7 rounded-[8px] flex items-center justify-center transition-colors disabled:opacity-50 ${
                    voice.active
                      ? (voice.phase === 'speaking' ? 'bg-accent text-white an-pulse' : 'bg-rec text-white an-pulse')
                      : 'text-ink3 hover:bg-border-soft'
                  }`}
                >
                  <Icon name={voice.active ? 'speaker' : 'headphones'} size={14} />
                </button>
              )}
              <div className="w-px h-4 bg-border" />
              {mirroring ? (
                // Read-only: this run is driven by another device on the same session.
                <span className="h-7 px-2.5 rounded-[8px] flex items-center gap-1.5 text-[11px] font-500 text-accent border border-accent/30 bg-accent/10">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent an-pulse" />
                  Live
                </span>
              ) : (
                <>
                  {streaming && (
                    <button
                      type="button"
                      title={queueMode === 'follow_up' ? 'Follow-up: send after this turn finishes (click to switch to Steer)' : 'Steer: fold into this turn now (click to switch to Follow-up)'}
                      onClick={() => setQueueMode((m) => (m === 'steer' ? 'follow_up' : 'steer'))}
                      className="h-7 px-2 rounded-[8px] flex items-center gap-1 text-[11px] font-500 text-ink3 hover:bg-border-soft border border-border"
                    >
                      <Icon name={queueMode === 'follow_up' ? 'history' : 'zap'} size={11} />
                      <span>{queueMode === 'follow_up' ? 'Follow-up' : 'Steer'}</span>
                    </button>
                  )}
                  {streaming && (
                    <button type="button" title="Stop" onClick={stop}
                      className="w-8 h-8 rounded-[9px] flex items-center justify-center bg-rec text-white hover:opacity-90">
                      <Icon name="stop" size={12} />
                    </button>
                  )}
                  {streaming ? (
                    input.trim() && (
                      <button type="button" title={queueMode === 'follow_up' ? 'Queue for after this turn (Enter)' : 'Steer into this turn (Enter)'} onClick={send}
                        className="w-8 h-8 rounded-[9px] flex items-center justify-center bg-accent text-white hover:opacity-90">
                        <Icon name="send" size={13} />
                      </button>
                    )
                  ) : (
                    <button type="button" title="Send (Enter)" onClick={send} disabled={(!input.trim() && attachments.length === 0) || uploading || compacting}
                      className={`w-8 h-8 rounded-[9px] flex items-center justify-center transition-colors ${(input.trim() || attachments.length > 0) && !uploading && !compacting ? 'bg-accent text-white' : 'bg-border text-ink3'}`}>
                      <Icon name="send" size={13} />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          </div>
          <div className="flex items-center gap-2 pt-1.5">
            <Chip icon="sparkle" label="Agent" value={active?.agentId ?? ''} onChange={setAgent}
              options={pool.map((a) => ({ v: a.id, label: a.name }))} />
            <Chip icon="settings" label="Model" value={active?.model || ''} onChange={setModel}
              options={[{ v: '', label: defaultModel ? `Default (${defaultModel})` : 'Default model' }, ...models.map((m) => ({ v: m.id, label: m.id }))]} />
            <Chip icon="brain" label="Thinking" value={thinkingEffort} onChange={(v) => setThinkingEffort(v as ThinkingEffort)}
              options={[
                { v: 'off', label: 'Off' },
                { v: 'minimal', label: 'Minimal' },
                { v: 'low', label: 'Low' },
                { v: 'medium', label: 'Medium' },
                { v: 'high', label: 'High' },
              ]} />
            <button type="button" title={autonomous ? 'Autonomous — skips approval prompts this turn' : 'Ask first — prompts before write actions'}
              onClick={() => setAutonomous((a) => !a)}
              className={`inline-flex items-center gap-1.5 pl-2.5 pr-2.5 py-1 rounded-full text-[11.5px] border transition-colors ${
                autonomous ? 'border-accent text-accent bg-accent-soft/40' : 'border-transparent text-ink2 hover:border-border hover:bg-border-soft'
              }`}>
              <Icon name="zap" size={10} />
              <span>{autonomous ? 'Autonomous' : 'Ask first'}</span>
            </button>
            <button type="button" title={elide ? 'Smart context — auto-reclaims space from stale tool results' : 'Enable smart context (elision)'}
              onClick={() => setElide((v) => !v)}
              className={`inline-flex items-center gap-1.5 pl-2.5 pr-2.5 py-1 rounded-full text-[11.5px] border transition-colors ${
                elide ? 'border-accent text-accent bg-accent-soft/40' : 'border-transparent text-ink2 hover:border-border hover:bg-border-soft'
              }`}>
              <Icon name="wave" size={10} />
              <span>Smart context</span>
            </button>
          </div>
        </div>
      </div>

      </div>
    </div>
  );
});
