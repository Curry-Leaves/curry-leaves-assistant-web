import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/chrome/Sidebar';
import { TopBar } from './components/chrome/TopBar';
import { CommandPalette, type Command, type ResultHandlers } from './components/CommandPalette';
import { AiStatusToast } from './components/AiStatusToast';
import { VoicePanel } from './components/VoicePanel';
import { useWakeWord } from './hooks/useWakeWord';
import { useVoiceAssistant } from './hooks/useVoiceAssistant';
import { getWakeWord, onWakeWordChange, patchWakeWord, type WakeWordConfig } from './api/wakeword';
import { CaptureScreen } from './screens/CaptureScreen';
import { RecordingsScreen } from './screens/RecordingsScreen';
import { TasksScreen } from './screens/TasksScreen';
import { AgentsScreen } from './screens/agents/AgentsScreen';
import { DashboardScreen } from './screens/dashboard/DashboardScreen';
import { AskAiScreen } from './screens/askai/AskAiScreen';
import { KnowledgeScreen } from './screens/knowledge/KnowledgeScreen';
import { ArtifactsScreen } from './screens/artifacts/ArtifactsScreen';
import { TraceScreen } from './screens/TraceScreen';
import { UsageScreen } from './screens/UsageScreen';
import { SettingsScreen } from './screens/settings/SettingsScreen';
import { api } from './api/client';
import { onStatus, type SocketStatus } from './api/socket';
import { useEvents } from './hooks/useEvents';
import { startSystemThemeSync, syncThemeFromBackend, useTheme, THEMES } from './theme';
import { primeNotificationPermission, notifyNeedsYou, notifyReminderDue, notifyTileAlert } from './notify';
import type { Agent, AppEvent, Recording, Todo } from './types';

export type Screen = 'capture' | 'ask' | 'recordings' | 'tasks' | 'knowledge' | 'agents' | 'board' | 'artifacts' | 'trace' | 'usage' | 'settings';

export function App() {
  const [screen, setScreen] = useState<Screen>('board');
  const [openTabs, setOpenTabs] = useState<Screen[]>(['board']);
  const [focusRecording, setFocusRecording] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const [focusSession, setFocusSession] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [activity, setActivity] = useState<AppEvent[]>([]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [connStatus, setConnStatus] = useState<SocketStatus>('connecting');
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [theme, setTheme] = useTheme();

  const refreshRecordings = useCallback(() => { api.listRecordings().then(setRecordings).catch(() => {}); }, []);
  // Keep the full list (incl. engine-plumbing helpers like the Prompt Editor). Those
  // helpers are surfaced only in the Agents management tab; `visibleAgents` hides them
  // everywhere else (chat picker, ⌘K, dashboard, settings).
  const refreshAgents = useCallback(() => { api.listAgents().then(setAgents).catch(() => {}); }, []);
  const refreshTodos = useCallback(() => { api.listTodos().then(setTodos).catch(() => {}); }, []);
  const refreshActivity = useCallback(() => { api.recentEvents(100).then(setActivity).catch(() => {}); }, []);

  // Initial load; persisted activity history loads first, live events stream on top.
  useEffect(() => {
    refreshRecordings(); refreshAgents(); refreshTodos(); refreshActivity();
  }, [refreshRecordings, refreshAgents, refreshTodos, refreshActivity]);

  useEvents((raw) => {
    const e = raw as AppEvent;
    // On reconnect the socket couldn't replay every missed event (cursor too old), so it
    // asks us to reconcile: refetch all live collections to heal any drift, then carry on.
    if (e.type === '__reconnect__') {
      refreshRecordings(); refreshAgents(); refreshTodos(); refreshActivity();
      return;
    }
    setActivity((a) => [e, ...a].slice(0, 100));
    if (e.type.startsWith('recording.')) refreshRecordings();
    if (e.type.startsWith('todo.')) refreshTodos();
    if (e.type === 'reminder.due') {
      const r = e.payload as { title?: string; notes?: string | null } | undefined;
      if (r?.title) notifyReminderDue(r.title, r.notes);
    }
    if (e.type === 'tile.alert.raised') {
      const a = e.payload as { message?: string } | undefined;
      if (a?.message) notifyTileAlert(e.label || 'Dashboard', a.message);
    }
    if (e.type === 'agent.run.needs_input') {
      // A background run suspended awaiting a human — native "waiting on you" notification,
      // click → the Assistants office. Skipped when the user is already looking right at it
      // (window focused + Assistants screen open); the office's orange "Needs you" state
      // covers that case.
      const p = e.payload as { jobId?: string; agentId?: string } | undefined;
      const name = (e.label || '').replace(/ needs input$/, '') || 'An assistant';
      if (!(document.hasFocus() && screen === 'agents')) {
        notifyNeedsYou(name, p?.jobId || p?.agentId || 'run', () => openScreen('agents'));
      }
    }
    if (e.type.startsWith('agent.run.') && e.type !== 'agent.run.needs_input') {
      refreshAgents();
      const id = (e.payload?.agentId as string) || e.entityId || '';
      setRunning((s) => {
        const next = new Set(s);
        if (e.type === 'agent.run.started') next.add(id);
        else next.delete(id);  // needs_input excluded above — the run is still active, just waiting
        return next;
      });
    }
  });

  // Internal helper agents (Prompt Editor, etc.) are hidden from chat & settings.
  // Memoized so its identity is stable across App's frequent re-renders (activity feed,
  // recordings, etc.) — lets memoized screens skip re-rendering.
  // Engine-plumbing helpers to hide outside the Agents tab. NOT gated on `a.internal`:
  // every seed now carries `internal: true` for the "Default" roster grouping, so filtering
  // on it would hide the real assistants (chat, meeting, dashboard) too. Mirrors the
  // backend's non-routable set in assign_tools.py — keep the two in sync.
  const PLUMBING_IDS = useMemo(() => new Set(['kb-maintainer', 'note-editor', 'text-editor', 'skill-learner', 'meeting-live', 'voice']), []);
  const visibleAgents = useMemo(() => agents.filter((a) => !PLUMBING_IDS.has(a.id)), [agents, PLUMBING_IDS]);

  // ─── app-wide voice assistant ───────────────────────────────────────────────
  // Lives here, not in AskAiScreen: screens are tab-scoped (a screen only exists once its
  // tab has been opened), so a wake word owned by the chat is deaf until the user visits
  // that tab. Here it is armed for the life of the app and answers over any screen.
  const [wakeCfg, setWakeCfg] = useState<WakeWordConfig | null>(null);
  const refreshWake = useCallback(() => { getWakeWord().then(setWakeCfg).catch(() => {}); }, []);
  useEffect(() => { refreshWake(); }, [refreshWake]);
  // Apply a Settings edit immediately. Settings is a keep-alive tab mounted alongside this,
  // so re-reading only on tab change meant toggling the wake word (or speech) off did
  // nothing until a reload — the running assistant kept its mounted-at-boot config.
  useEffect(() => onWakeWordChange(setWakeCfg), []);

  // The assistant that answers a spoken question, wherever you are. Prefers a dedicated
  // `voice` agent (terse spoken answers, hands real work to the queue) and falls back to
  // the chat assistant on an install that predates it.
  // Searches `agents`, NOT `visibleAgents`: the voice agent is plumbing everywhere else
  // (it has no chat surface and its answers are wrong for a typed conversation), so it is
  // in PLUMBING_IDS — selecting from the filtered list would hide it from its own picker.
  const voiceAgent = useMemo(
    () => agents.find((a) => a.surfaces?.includes('voice'))?.id
      ?? visibleAgents.find((a) => a.surfaces?.includes('chat'))?.id
      ?? visibleAgents[0]?.id,
    [agents, visibleAgents],
  );
  // The models have to be on disk; TTS only matters when the answer is meant to be spoken,
  // so a silent-answer setup still works on an install without Kokoro.
  const wakeReady = Boolean(wakeCfg?.enabled && wakeCfg.available);
  // The ASSISTANT is armed whenever the feature is installed — not only when the wake word
  // is on. Talk-now (the sidebar button / ⌘⇧V) has to work with the always-on listener
  // switched off; that combination is the whole point of having an off switch.
  const assistantReady = Boolean(wakeCfg?.available);
  const assistant = useVoiceAssistant({
    enabled: assistantReady,
    agentId: voiceAgent,
    onWake: () => {},
    suspended: false,
    prefs: wakeCfg ? {
      speak: wakeCfg.speak && wakeCfg.ttsAvailable,
      continuous: wakeCfg.continuous,
      autoDismiss: wakeCfg.autoDismiss,
      dismissAfterMs: wakeCfg.dismissAfterMs,
      voice: wakeCfg.voice,
      silenceMs: wakeCfg.silenceMs,
      workApproval: wakeCfg.workApproval,
    } : undefined,
  });
  // Listening for the wake word pauses during an exchange — otherwise the assistant's own
  // reply (AEC is off on this mic) can re-trigger it mid-sentence.
  const wake = useWakeWord({
    enabled: wakeReady,
    suppressed: assistant.phase !== 'armed',
    onWake: () => { if (assistant.phase === 'armed') assistant.startExchange(); },
  });

  // ─── quick controls (sidebar + keyboard) ────────────────────────────────────
  // Flip the always-on listener. Writes the same setting Settings does, and patchWakeWord
  // notifies watchers, so this component re-renders from the server's response — no local
  // optimistic state to drift out of sync.
  const toggleWake = useCallback(() => {
    const next = !wakeCfg?.enabled;
    patchWakeWord({ enabled: next }).catch(() => {});
    // Turning it off mid-exchange should also shut up whatever is speaking right now.
    if (!next) assistant.cancel();
  }, [wakeCfg?.enabled, assistant]);

  // Talk without the wake word. Also the escape hatch from a false trigger: pressing it
  // while an exchange is live cancels instead of stacking a second one.
  const talkNow = useCallback(() => {
    if (!assistantReady) return;
    if (assistant.phase === 'armed' || assistant.phase === 'off') assistant.startExchange();
    else assistant.cancel();
  }, [assistantReady, assistant]);

  // ⌘⇧V / Ctrl+Shift+V. Shift+V rather than plain ⌘V so it can't eat a paste, and the
  // handler bails while a text field has focus — a global key that steals typing is worse
  // than no shortcut. Escape cancels a live exchange from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        talkNow();
        return;
      }
      if (e.key === 'Escape' && !typing && assistant.phase !== 'armed' && assistant.phase !== 'off') {
        assistant.cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [talkNow, assistant]);

  // Tabs: navigating opens a tab (one per page); closing one falls back to a neighbour.
  const openScreen = useCallback((s: Screen) => {
    setScreen(s);
    setOpenTabs((t) => (t.includes(s) ? t : [...t, s]));
  }, []);
  // The Dashboard (inbox) is the permanent home tab — always open, never closable (also
  // enforced in the UI by TopTabs hiding its close button, see PERMANENT_TABS).
  const closeTab = useCallback((s: Screen) => {
    if (s === 'board') return;
    setOpenTabs((prev) => {
      const idx = prev.indexOf(s);
      const next = prev.filter((x) => x !== s);
      if (next.length === 0) { setScreen('board'); return ['board']; }
      setScreen((cur) => (cur === s ? next[Math.min(idx, next.length - 1)] : cur));
      return next;
    });
  }, []);

  // Move the active-tab highlight by toggling a class on the DOM, so switching tabs
  // never re-renders the (memoized) tab strip — it re-renders only when tabs change.
  useLayoutEffect(() => {
    document.querySelectorAll<HTMLElement>('.ttab').forEach((el) => {
      el.classList.toggle('is-active', el.dataset.screen === screen);
    });
  }, [screen, openTabs]);

  // Deep-link from a task/reminder backlink → open its parent recording in Recordings.
  const openRecording = useCallback((id: string) => { setFocusRecording(id); openScreen('recordings'); }, [openScreen]);

  // Deep-link into a specific Settings section (e.g. Capture's "model not ready" banner).
  const openSettingsSection = useCallback((sectionId: string) => { setSettingsSection(sectionId); openScreen('settings'); }, [openScreen]);

  // Deep-link from a chat answer's cited source → open that note in the Knowledge Hub.
  const openKnowledgeNote = useCallback((path: string) => {
    setFocusNote(path); openScreen('knowledge');
  }, [openScreen]);

  // Deep-link from a reviewed todo → open its assistant conversation (run_<jobId>) in Ask AI.
  const openConversation = useCallback((sessionId: string) => {
    setFocusSession(sessionId); openScreen('ask');
  }, [openScreen]);

  // ⌘R global toggle from the Electron shell → jump to Capture.
  useEffect(() => { window.curryLeaves?.onToggleRecording?.(() => openScreen('capture')); }, [openScreen]);

  // ── ⌘K command palette: navigation + actions, plus per-type open handlers ──────
  const NAV: { s: Screen; label: string; icon: string }[] = useMemo(() => [
    { s: 'capture', label: 'Capture', icon: 'mic' },
    { s: 'ask', label: 'Ask AI', icon: 'chat' },
    { s: 'recordings', label: 'Recordings', icon: 'library' },
    { s: 'tasks', label: 'Tasks', icon: 'check' },
    { s: 'knowledge', label: 'Memory', icon: 'brain' },
    { s: 'agents', label: 'Assistants', icon: 'bot' },
    { s: 'board', label: 'Dashboard', icon: 'grid' },
    { s: 'artifacts', label: 'Artifacts', icon: 'artifact' },
    { s: 'usage', label: 'Usage', icon: 'chart' },
    { s: 'settings', label: 'Settings', icon: 'settings' },
  ], []);
  const paletteCommands: Command[] = useMemo(() => {
    const nav: Command[] = NAV.map((n) => ({
      id: `go-${n.s}`, label: `Go to ${n.label}`, hint: 'Page', keywords: `navigate open ${n.label}`,
      icon: n.icon, run: () => openScreen(n.s),
    }));
    const actions: Command[] = [
      { id: 'act-newtask', label: 'New task', hint: 'Action', keywords: 'pool assign lead do delegate need post work', icon: 'play', run: () => setNewTaskOpen(true) },
      { id: 'act-record', label: 'Start a recording', hint: 'Action', keywords: 'new capture meeting listen', icon: 'mic', run: () => openScreen('capture') },
      { id: 'act-ask', label: 'Ask AI a question', hint: 'Action', keywords: 'chat assistant', icon: 'chat', run: () => openScreen('ask') },
      { id: 'act-note', label: 'Open Memory', hint: 'Action', keywords: 'new note wiki knowledge skills facts profile', icon: 'brain', run: () => openScreen('knowledge') },
      { id: 'act-theme', label: 'Next theme', hint: 'Action', keywords: 'dark light mode appearance color', icon: 'theme',
        run: () => { const i = THEMES.findIndex((t) => t.id === theme); setTheme(THEMES[(i + 1) % THEMES.length].id); } },
      // Run any assistant by name.
      ...visibleAgents.map((a): Command => ({
        id: `run-${a.id}`, label: `Run ${a.name}`, hint: 'Assistant', keywords: `agent ${a.description ?? ''}`,
        icon: 'play', run: () => { api.runAgent(a.id).catch(() => {}); openScreen('agents'); },
      })),
    ];
    return [...actions, ...nav];
  }, [NAV, openScreen, visibleAgents, theme, setTheme]);

  const paletteHandlers: ResultHandlers = useMemo(() => ({
    knowledge: (r) => openKnowledgeNote(r.id),
    recording: (r) => openRecording(r.id),
    agent: () => openScreen('agents'),
    todo: () => openScreen('tasks'),
    reminder: () => openScreen('tasks'),
    artifact: () => openScreen('artifacts'),
  }), [openKnowledgeNote, openRecording, openScreen]);

  // Theme: the inline script in index.html applies the cached choice pre-paint;
  // reconcile with the authoritative value in settings.json, then track the OS
  // for the whole app lifetime in case the choice is `system`.
  useEffect(() => { syncThemeFromBackend(); return startSystemThemeSync(); }, []);

  // The real permission request happens on the login gesture (LoginScreen) / the
  // Settings toggle — Chrome ignores a non-gesture request. This only re-checks in
  // case a gesture already primed it (e.g. Electron native path).
  useEffect(() => { primeNotificationPermission(); }, []);

  // Track the shared WebSocket's health so we can surface a "reconnecting" strip.
  useEffect(() => onStatus(setConnStatus), []);

  return (
    <div className="w-full h-full flex flex-col bg-bg text-ink">
      <CommandPalette commands={paletteCommands} onOpenResult={paletteHandlers} />
      <AiStatusToast onOpenSettings={openSettingsSection} />
      <VoicePanel
        phase={assistant.phase}
        heard={assistant.heard}
        reply={assistant.reply}
        onCancel={assistant.cancel}
        onNavigate={openKnowledgeNote}
      />
      {newTaskOpen && <NewTaskModal onClose={() => setNewTaskOpen(false)} onPosted={() => openScreen('board')} />}
      <TopBar tabs={openTabs} onSelectTab={openScreen} onCloseTab={closeTab} />
      {/* Sunken strip holds the icon rail; the content is an inset panel with a
          rounded top-left corner + hairline top/left border (curry-leaves's layout). */}
      <div className="flex-1 flex min-h-0 bg-sidebar">
        <Sidebar
          screen={screen}
          setScreen={openScreen}
          needsYou={running.size}
          wakeArmed={wake.listening}
          wakeEnabled={Boolean(wakeCfg?.enabled)}
          wakeAvailable={assistantReady}
          onToggleWake={toggleWake}
          onTalk={talkNow}
        />
        {/* Content column: the tab panel plus a connection-status footer that spans only the
            main area (not the sidebar rail). */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Keep-alive tabs: every OPEN page stays mounted (state preserved); only the
              active one is shown. Switching tabs no longer resets a page (e.g. the chat). */}
          <main className="flex-1 flex min-h-0 min-w-0 bg-bg rounded-tl-[10px] border-t border-l border-border overflow-hidden">
            {openTabs.map((s) => (
              <div key={s} className={s === screen ? 'flex-1 flex min-h-0 min-w-0' : 'hidden'}>
                {s === 'capture' && <CaptureScreen active={s === screen} onSaved={refreshRecordings} onNavigate={openScreen} onOpenSettings={openSettingsSection} />}
                {s === 'ask' && <AskAiScreen agents={visibleAgents} active={s === screen} onOpenNote={openKnowledgeNote} focusSessionId={focusSession} onFocusHandled={() => setFocusSession(null)} />}
                {s === 'recordings' && <RecordingsScreen recordings={recordings} todos={todos} refresh={refreshRecordings} focusId={focusRecording} onFocusHandled={() => setFocusRecording(null)} />}
                {s === 'tasks' && <TasksScreen recordings={recordings} onOpenRecording={openRecording} onOpenConversation={openConversation} />}
                {s === 'knowledge' && <KnowledgeScreen focusNote={focusNote} onFocusHandled={() => setFocusNote(null)} />}
                {s === 'agents' && <AgentsScreen agents={agents} activity={activity} running={running} onRefreshActivity={refreshActivity} onRefreshAgents={refreshAgents} />}
                {s === 'board' && <DashboardScreen agents={visibleAgents} onOpenAssistants={() => openScreen('agents')} />}
                {s === 'artifacts' && <ArtifactsScreen />}
                {s === 'trace' && <TraceScreen />}
                {s === 'usage' && <UsageScreen />}
                {s === 'settings' && <SettingsScreen initialSection={settingsSection} onSectionHandled={() => setSettingsSection(null)} />}
              </div>
            ))}
          </main>
          {/* Connection status footer — a thin, unobtrusive strip that only appears while the
              socket is not connected, so the user knows why the UI has gone quiet. Scoped to
              the content column (excludes the sidebar); uses the app's own muted/rec tokens. */}
          {connStatus !== 'connected' && (
            <div className={`shrink-0 flex items-center justify-center gap-1.5 px-3 py-[3px] text-[11px] bg-bg border-t border-l border-border ${connStatus === 'connecting' ? 'text-ink3' : 'text-rec'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-rec an-pulse" />
              {connStatus === 'connecting' ? 'Connecting to backend…' : 'Connection lost — reconnecting…'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── New-task modal (⌘K → "New task") ─────────────────────────────────────────
// The describe front door, reachable from anywhere. The user says what they need; it becomes a
// user-posted pool item and the Lead routes it. Mirrors the Dashboard inbox's quick-ask box so
// the entry points behave identically; posting lands you on the inbox to watch it move.
function NewTaskModal({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [need, setNeed] = useState('');
  const [busy, setBusy] = useState(false);

  const post = async () => {
    if (!need.trim() || busy) return;
    setBusy(true);
    await api.createPoolItem({ description: need.trim() }).catch(() => {});
    setBusy(false);
    onClose();
    onPosted();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[18vh] bg-black/40" onClick={onClose}>
      <div className="w-[520px] max-w-[90vw] rounded-[14px] border border-border bg-bg shadow-2xl p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="font-serif text-[16px] text-ink">New task</span>
          <span className="text-[11px] text-ink3">The Lead will assign it</span>
        </div>
        <textarea value={need} onChange={(e) => setNeed(e.target.value)} autoFocus rows={4}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') post();
          }}
          placeholder="What do you need? Describe it — the Lead picks the right assistant and gets it done."
          className="px-3 py-2 rounded-[8px] border border-border bg-card text-ink text-[13px] outline-none resize-none focus:border-accent" />
        <div className="flex items-center justify-between">
          <span className="text-[10.5px] text-ink3">⌘↵ to post · esc to cancel</span>
          <button type="button" onClick={post} disabled={!need.trim() || busy}
            className="h-[30px] px-4 rounded-[8px] bg-accent text-white text-[12.5px] font-550 disabled:opacity-50">
            {busy ? 'Posting…' : 'Post to pool'}
          </button>
        </div>
      </div>
    </div>
  );
}
