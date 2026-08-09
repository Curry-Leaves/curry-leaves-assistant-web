/**
 * The single WebSocket to the backend — one connection carrying every live stream
 * (the app event feed today; chat and audio in later commits). Replaces the per-surface
 * EventSource/WebSocket connections.
 *
 * Responsibilities the old EventSource never had:
 * - **Auth in the first frame** (`hello`), so the token never rides in the URL.
 * - **Reconnection with backoff.** A drop (sleep/wake, backend restart) reconnects
 *   automatically; after repeated failures it re-resolves the backend URL (the backend
 *   can come back on a new random port).
 * - **Gap-free events.** We track the last event id and resubscribe with `since`, so the
 *   backend replays what we missed. If it can't (cursor too old), it sends `replay.reset`
 *   and we surface a synthetic event so the app refetches its lists.
 * - **Liveness watchdog.** The server pings every ~20s; if we go silent too long we treat
 *   the socket as dead and reconnect.
 * - **Connection status**, so the UI can show a "reconnecting" banner.
 */
import { getToken, onAuthChange } from '../auth';
import { base, resetBase } from './http';

export type SocketStatus = 'connecting' | 'connected' | 'down';

type Frame = { type: string; [k: string]: unknown };

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 15_000;
const SILENCE_TIMEOUT_MS = 45_000; // server pings every 20s; 45s of silence → dead
const RESET_BASE_AFTER = 4; // consecutive failed connects before re-resolving the URL

const _eventListeners = new Set<(e: unknown) => void>();
const _statusListeners = new Set<(s: SocketStatus) => void>();
// Work Kernel live snapshots (the dashboard Work panel). Each frame is a full snapshot.
const _kernelListeners = new Set<(snap: unknown) => void>();
// The most recent kernel snapshot, cached so a component that subscribes AFTER the initial
// `sub` (e.g. the OfficeView mounting while the KernelPanel already holds the subscription,
// or a remount on tab switch) gets the current state immediately instead of a blank/zeroed
// board until the next state change. The backend only pushes a snapshot on subscribe or on
// change, so without this a late subscriber can sit at "0 running · 0 queued" indefinitely.
let _lastKernelSnapshot: unknown = null;
// Raw WS frame tap (the dashboard Frames panel / debug console). Fires for EVERY inbound
// frame, before per-type handling — a passive observer, never affects routing.
const _frameTaps = new Set<(frame: unknown) => void>();
// runId -> Set of subscribers. Multiple surfaces can attach to the SAME run at once (e.g. the
// Ask-AI mirror AND the runs panel), so this is a set, not a single slot — otherwise a second
// subscribe would clobber the first, and either unsubscribe would `unsub` the run out from
// under the other. Each subscriber tracks its OWN lastSeq (a late-attaching mirror replays
// from 0 while the originator is already caught up). Kept across reconnects so we re-attach
// (re-subscribe with the lowest seq any subscriber still needs) and replay what we missed.
type ChatSub = { handler: (ev: unknown) => void; lastSeq: number };
const _chatSubs = new Map<string, Set<ChatSub>>();
// Pending request() calls, keyed by req id.
const _pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let _reqSeq = 0;

// streamId -> live audio stream state. `slot` is assigned by the server (audio.ready) and
// stamped as the first byte of every binary frame so one socket can carry several streams.
type AudioState = {
  slot: number | null;
  onTranscript: (append: string, isFinal: boolean) => void;
  onReady?: () => void;
  finalResolve?: (text: string) => void;
  finalText: string;
  kind: 'live' | 'dictation';
  recordingId?: string;  // meeting streams carry this so the backend live engine can run
  // Per-recording override of the app's live-copilot setting (the Capture toggle). Remembered
  // so a socket reconnect re-sends it — otherwise the recording silently reverts to the app
  // setting mid-meeting, which reads as the toggle spontaneously flipping.
  liveEnabled?: boolean;
  // PCM captured before the server assigned our slot (audio.ready). Buffered, then flushed in
  // order the instant the slot arrives — otherwise the opening moment of speech is dropped (the
  // slot byte can't be stamped yet). Capped so a stuck handshake can't grow it without bound.
  preready: ArrayBuffer[];
};

// live.context cards, keyed by recordingId → listeners for the in-meeting card rail.
export type LiveCard = { kind: string; text: string; source?: string | null; refId?: string | null };
const _liveContextListeners = new Set<(recordingId: string, cards: LiveCard[]) => void>();

// ~10s of 16kHz float32 mono PCM (16000 * 4 * 10 ≈ 640KB) is plenty of runway for a handshake
// that normally takes a few ms; past this we drop rather than buffer unbounded.
const _PREREADY_MAX_BYTES = 640_000;
const _audioStreams = new Map<string, AudioState>();
let _audioSeq = 0;

// ─── outbound TTS (Kokoro speech playback) ────────────────────────────────────
// A `speak()` call opens a stream; the backend replies `tts.start` with a slot, then binary
// PCM frames tagged with that slot byte, then `tts.end`. State is keyed BOTH by streamId (for
// the JSON frames) and by slot (for the binary PCM frames — the slot arrives in tts.start).
type TtsState = {
  streamId: string;
  slot: number | null;
  sampleRate: number;
  onPcm: (pcm: Float32Array, sampleRate: number) => void;
  onEnd: () => void;
  ended: boolean;
};
const _ttsByStream = new Map<string, TtsState>();
const _ttsBySlot = new Map<number, TtsState>();
let _ttsSeq = 0;

let _ws: WebSocket | null = null;
let _status: SocketStatus = 'down';
let _lastEventId: string | null = null;
let _wantOpen = false; // becomes true once anyone subscribes; drives auto-reconnect
// The token the current/in-flight socket sent in its `hello`. A token change (rotation/relogin)
// while connected must reconnect — the token is captured per-connect and closed over in onopen,
// so an open socket never re-authenticates on its own.
let _authedToken: string | null = null;
let _attempts = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _silenceTimer: ReturnType<typeof setTimeout> | null = null;

function _setStatus(s: SocketStatus): void {
  if (s === _status) return;
  _status = s;
  for (const fn of _statusListeners) { try { fn(s); } catch { /* ignore */ } }
}

function _armSilenceTimer(): void {
  if (_silenceTimer) clearTimeout(_silenceTimer);
  _silenceTimer = setTimeout(() => {
    // Nothing (not even a ping) for too long → assume dead and force a reconnect.
    try { _ws?.close(); } catch { /* ignore */ }
  }, SILENCE_TIMEOUT_MS);
}

function _emitEvent(ev: unknown): void {
  for (const fn of _eventListeners) { try { fn(ev); } catch { /* ignore */ } }
}

function _handleFrame(frame: Frame): void {
  // Passive tap: every inbound frame is offered to observers (the Frames debug panel)
  // before normal routing. Never throws into the switch below.
  if (_frameTaps.size) for (const fn of _frameTaps) { try { fn(frame); } catch { /* ignore */ } }
  switch (frame.type) {
    case 'kernel':
      _lastKernelSnapshot = frame.snapshot;
      for (const fn of _kernelListeners) { try { fn(frame.snapshot); } catch { /* ignore */ } }
      break;
    case 'event': {
      const ev = frame.event as { id?: string } | undefined;
      if (ev?.id) _lastEventId = ev.id;
      _emitEvent(ev);
      break;
    }
    case 'replay.reset':
      // The backend couldn't replay from our cursor — tell the app to refetch its state.
      // Drop the stale cursor so we don't ask for the same impossible replay again.
      _lastEventId = null;
      _emitEvent({ type: '__reconnect__' });
      break;
    case 'chat': {
      const runId = frame.runId as string;
      const seq = frame.seq as number;
      const subs = _chatSubs.get(runId);
      if (subs) {
        // Fan out to every subscriber; each dedups by its OWN lastSeq (replay-on-reattach can
        // resend a frame one subscriber already applied while another still needs it).
        for (const sub of subs) {
          if (seq > sub.lastSeq) {
            sub.lastSeq = seq;
            try { sub.handler(frame.ev); } catch { /* ignore */ }
          }
        }
      }
      break;
    }
    case 'chat.gone': {
      // Subscribed to a run whose buffer is gone (ended + expired). Tell each handler so
      // it can finalize (refetch the session's messages) instead of hanging.
      const subs = _chatSubs.get(frame.runId as string);
      if (subs) for (const sub of subs) { try { sub.handler({ type: 'gone' }); } catch { /* ignore */ } }
      break;
    }
    case 'res': {
      const p = _pending.get(frame.id as string);
      if (p) {
        _pending.delete(frame.id as string);
        if (frame.ok) p.resolve(frame);
        else p.reject(new Error((frame.error as { message?: string })?.message || 'request failed'));
      }
      break;
    }
    case 'audio.ready': {
      const st = _audioStreams.get(frame.streamId as string);
      if (st) {
        st.slot = frame.slot as number;
        // Flush anything captured before the slot arrived, in order, now that we can stamp it.
        const buffered = st.preready;
        st.preready = [];
        for (const pcm of buffered) _sendFramedPcm(st.slot, pcm);
        st.onReady?.(); st.onReady = undefined;
      }
      break;
    }
    case 'transcript': {
      const st = _audioStreams.get(frame.streamId as string);
      if (st) {
        const append = (frame.append as string) || '';
        const isFinal = Boolean(frame.isFinal);
        if (append) st.finalText += (st.finalText ? ' ' : '') + append;
        try { st.onTranscript(append, isFinal); } catch { /* ignore */ }
        if (isFinal) {
          _audioStreams.delete(frame.streamId as string);
          st.finalResolve?.(st.finalText);
        }
      }
      break;
    }
    case 'transcript.error': {
      const st = _audioStreams.get(frame.streamId as string);
      if (st) { _audioStreams.delete(frame.streamId as string); st.finalResolve?.(st.finalText); }
      break;
    }
    case 'tts.start': {
      const st = _ttsByStream.get(frame.streamId as string);
      if (st) {
        st.slot = frame.slot as number;
        st.sampleRate = (frame.sampleRate as number) || st.sampleRate;
        _ttsBySlot.set(st.slot, st);
      }
      break;
    }
    case 'tts.end':
    case 'tts.error': {
      const st = _ttsByStream.get(frame.streamId as string);
      if (st) _finishTts(st);
      break;
    }
    case 'live.context': {
      const recId = frame.recordingId as string;
      const cards = (frame.cards as LiveCard[]) || [];
      if (recId && cards.length) for (const fn of _liveContextListeners) { try { fn(recId, cards); } catch { /* ignore */ } }
      break;
    }
    case 'ping':
      // Liveness only; the silence timer is already re-armed on every message.
      break;
    default:
      break;
  }
}

/** Subscribe to in-meeting live-context cards (from the backend live engine). */
export function subscribeLiveContext(fn: (recordingId: string, cards: LiveCard[]) => void): () => void {
  _liveContextListeners.add(fn);
  return () => { _liveContextListeners.delete(fn); };
}

/** Attach the in-meeting live engine to an already-open audio stream. Sent once the recording
 *  id is known (which can arrive AFTER the stream opens), so the engine engages regardless of
 *  ordering. Idempotent on the backend.
 *
 *  `enabled` overrides the app-level live-copilot setting for THIS recording only (the Capture
 *  toggle); undefined leaves the recording following the setting. Re-sending attach with a new
 *  value is how the toggle flips mid-recording — the backend updates the existing session in
 *  place, so the copilot keeps the conversation history it has built up. */
export function attachLive(streamId: string, recordingId: string, enabled?: boolean): void {
  const st = _audioStreams.get(streamId);
  if (st) { st.recordingId = recordingId; st.liveEnabled = enabled; }  // remembered so a reconnect re-attaches
  _send({ type: 'live.attach', streamId, recordingId, ...(enabled === undefined ? {} : { enabled }) });
}

/** Nudge the live engine with a high-signal cue (attendee added / note typed) for a stream. */
export function sendLiveSignal(streamId: string, hint: string): void {
  _send({ type: 'live.signal', streamId, hint });
}

/** Force the live copilot to run a fresh pass now (the user clicked refresh). */
export function sendLiveRefresh(streamId: string): void {
  _send({ type: 'live.refresh', streamId });
}

function _send(obj: unknown): boolean {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(obj));
    return true;
  }
  return false;
}

function _sendBinary(buf: ArrayBuffer): boolean {
  if (_ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(buf);
    return true;
  }
  return false;
}

/** Prefix a PCM buffer with its 1-byte stream slot and send it. */
function _sendFramedPcm(slot: number, pcm: ArrayBuffer): void {
  const framed = new Uint8Array(pcm.byteLength + 1);
  framed[0] = slot;
  framed.set(new Uint8Array(pcm), 1);
  _sendBinary(framed.buffer);
}

/** A binary TTS frame: [1-byte slot][float32 LE PCM]. Decode to Float32 and hand to the
 *  stream's player. The leading byte is the slot the backend assigned in tts.start. */
function _handleTtsBinary(buf: ArrayBuffer): void {
  if (buf.byteLength < 1) return;
  const slot = new Uint8Array(buf, 0, 1)[0];
  const st = _ttsBySlot.get(slot);
  if (!st) return;
  // Copy the PCM out (offset 1) into a fresh, byte-aligned Float32Array — the source is offset
  // by 1 byte so it isn't 4-byte aligned for a direct Float32 view.
  const bytes = new Uint8Array(buf, 1);
  const aligned = new Uint8Array(bytes.byteLength);
  aligned.set(bytes);
  const pcm = new Float32Array(aligned.buffer);
  try { st.onPcm(pcm, st.sampleRate); } catch { /* ignore */ }
}

/** Tear down a finished/cancelled TTS stream and fire its onEnd once. */
function _finishTts(st: TtsState): void {
  if (st.ended) return;
  st.ended = true;
  _ttsByStream.delete(st.streamId);
  if (st.slot != null) _ttsBySlot.delete(st.slot);
  try { st.onEnd(); } catch { /* ignore */ }
}

async function _connect(): Promise<void> {
  if (_ws || !_wantOpen) return;
  const token = getToken();
  if (!token) return; // logged out; (re)connect happens on next login via onAuthChange

  _setStatus(_attempts === 0 ? 'connecting' : 'down');
  let url: string;
  try {
    url = (await base()).replace(/^http/, 'ws') + '/ws';
  } catch {
    _scheduleReconnect();
    return;
  }

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    _scheduleReconnect();
    return;
  }
  _ws = ws;
  // Inbound TTS PCM arrives as binary frames — receive them as ArrayBuffer, not Blob.
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    // Authenticate as the first frame, then (re)subscribe to the event feed. Passing the
    // last event id lets the server replay anything we missed while disconnected.
    _authedToken = token;   // remember what this socket authenticated with (see onAuthChange)
    ws.send(JSON.stringify({ type: 'hello', token }));
    ws.send(JSON.stringify({ type: 'sub', channel: 'events', since: _lastEventId ?? undefined }));
    // Re-attach the kernel feed if anything is watching it (a fresh snapshot arrives at once).
    if (_kernelListeners.size) ws.send(JSON.stringify({ type: 'sub', channel: 'kernel' }));
    // Re-attach any live chat runs, replaying frames after the last seq we applied. One `sub`
    // per run, from the LOWEST seq any subscriber still needs, so the furthest-behind mirror
    // catches up (each subscriber re-dedups by its own lastSeq). A run that ended while we were
    // away comes back as `chat.gone` so the handlers can finalize.
    for (const [runId, subs] of _chatSubs) {
      let since = Infinity;
      for (const sub of subs) since = Math.min(since, sub.lastSeq);
      ws.send(JSON.stringify({ type: 'sub', channel: 'chat', runId, since: since === Infinity ? 0 : since }));
    }
    // Re-open any active audio streams (the server-side stream + slot died with the socket);
    // capture keeps flowing to the new slot. A gap in the transcript beats a dead one.
    for (const [streamId, st] of _audioStreams) {
      st.slot = null;
      ws.send(JSON.stringify({ type: 'audio.start', streamId, kind: st.kind, recordingId: st.recordingId }));
      // The server-side live session died with the socket, so re-assert the copilot override
      // for this recording — audio.start alone would rebuild it following the app setting.
      if (st.recordingId && st.liveEnabled !== undefined) {
        ws.send(JSON.stringify({ type: 'live.attach', streamId, recordingId: st.recordingId, enabled: st.liveEnabled }));
      }
    }
    _attempts = 0;
    _setStatus('connected');
    _armSilenceTimer();
  };

  ws.onmessage = (m) => {
    _armSilenceTimer();
    // Binary frame = TTS PCM: [1-byte slot][float32 LE PCM]. Route by slot to its player.
    if (m.data instanceof ArrayBuffer) { _handleTtsBinary(m.data); return; }
    let frame: Frame;
    try { frame = JSON.parse(m.data); } catch { return; }
    _handleFrame(frame);
  };

  ws.onclose = () => {
    if (_ws === ws) { _ws = null; _authedToken = null; }
    if (_silenceTimer) { clearTimeout(_silenceTimer); _silenceTimer = null; }
    // Fail any in-flight requests — the caller retries after reconnect if it wants.
    for (const [, p] of _pending) p.reject(new Error('socket closed'));
    _pending.clear();
    _scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose fires right after; let it handle the reconnect so we don't double-schedule.
    try { ws.close(); } catch { /* ignore */ }
  };
}

function _scheduleReconnect(): void {
  if (!_wantOpen || _reconnectTimer) return;
  _setStatus('down');
  _attempts += 1;
  // After a few failures the backend may have moved (new port) — forget the cached URL.
  if (_attempts % RESET_BASE_AFTER === 0) resetBase();
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** (_attempts - 1), RECONNECT_MAX_MS);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    void _connect();
  }, delay);
}

function _ensureOpen(): void {
  _wantOpen = true;
  if (!_ws && !_reconnectTimer) void _connect();
}

// A login (token change) should (re)connect; a logout should tear the socket down.
onAuthChange(() => {
  const token = getToken();
  if (token) {
    _attempts = 0;
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    // If a socket is already open/in-flight with a DIFFERENT token, its `hello` is closed over
    // the old token and won't re-authenticate — close it so the reconnect path opens a fresh
    // one with the new token. onclose schedules the reconnect; _authedToken is cleared there.
    if (_ws && _authedToken !== token) {
      try { _ws.close(); } catch { /* ignore */ }
      // onclose (_ws===ws) nulls _ws and calls _scheduleReconnect(); the new connect reads the
      // fresh token. Don't also call _connect() here — that would early-return on the truthy _ws.
    } else if (_wantOpen) {
      void _connect();
    }
  } else {
    try { _ws?.close(); } catch { /* ignore */ }
    _ws = null;
    _authedToken = null;
  }
});

/** Subscribe to the live app event feed. Opens the socket on first subscriber. */
export function onEvents(fn: (e: unknown) => void): () => void {
  _eventListeners.add(fn);
  _ensureOpen();
  return () => { _eventListeners.delete(fn); };
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Send a request over the socket and await its response. Rejects on `ok:false`, timeout,
 * or disconnect. Opens the socket if needed (e.g. the first chat.start of the session).
 */
export function request<T = Record<string, unknown>>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  _ensureOpen();
  const id = `r-${++_reqSeq}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (_pending.delete(id)) reject(new Error(`${method} timed out`));
    }, REQUEST_TIMEOUT_MS);
    _pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v as T); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    // If the socket isn't open yet, retry the send briefly until it is (the handshake is
    // fast; a missed send would otherwise hang until timeout).
    if (!_send({ type: 'req', id, method, params })) {
      const t0 = Date.now();
      const tick = setInterval(() => {
        if (!_pending.has(id)) { clearInterval(tick); return; }
        if (_send({ type: 'req', id, method, params }) || Date.now() - t0 > 5_000) clearInterval(tick);
      }, 100);
    }
  });
}

/**
 * Attach to a chat run's frame stream. `handler` receives each run frame (`ev` shapes:
 * token, tool_start, approve, done, …) plus a synthetic `{type:'gone'}` if the run's
 * buffer expires. Returns an unsubscribe fn. Survives reconnects (re-attaches with the
 * last seq seen). `chat.start` auto-subscribes server-side, so a fresh run needs no `sub`.
 */
export function subChat(runId: string, handler: (ev: unknown) => void, opts?: { attach?: boolean }): () => void {
  const sub: ChatSub = { handler, lastSeq: 0 };
  let subs = _chatSubs.get(runId);
  if (!subs) { subs = new Set(); _chatSubs.set(runId, subs); }
  subs.add(sub);
  _ensureOpen();
  // `chat.start` auto-subscribes the ORIGINATOR server-side, so it needs no `sub` frame.
  // A MIRROR (a second client attaching to someone else's run) must send one explicitly;
  // `since: 0` also replays frames buffered before it attached, so it catches up. Passing
  // attach:true is what makes the mirror actually receive the stream. (onopen re-sends the
  // sub for every _chatSubs run after a reconnect, so both cases survive drops.)
  if (opts?.attach) _send({ type: 'sub', channel: 'chat', runId, since: 0 });
  return () => {
    const set = _chatSubs.get(runId);
    if (!set) return;
    set.delete(sub);
    // Only tear the run's wire subscription down when the LAST local subscriber leaves — else
    // we'd unsub the stream out from under any sibling still watching the same run.
    if (set.size === 0) {
      _chatSubs.delete(runId);
      _send({ type: 'unsub', channel: 'chat', runId });
    }
  };
}

export type AudioStream = {
  /** This stream's id — used to target live.signal cues at the backend engine. */
  streamId: string;
  /** Send one float32 mono 16kHz PCM buffer. Dropped if the socket is mid-reconnect. */
  send: (pcm: ArrayBuffer) => void;
  /** Signal end-of-audio; resolves with the final transcript text. */
  end: () => Promise<string>;
};

/**
 * Open a live audio stream over the shared socket. `onTranscript(append, isFinal)` fires as
 * chunks are recognized. The returned `send` prefixes each PCM buffer with the server-
 * assigned slot byte; `end` flushes and resolves the final text. Survives reconnects (the
 * stream is re-opened with a fresh slot — capture keeps flowing).
 */
export function startAudio(
  kind: 'live' | 'dictation',
  onTranscript: (append: string, isFinal: boolean) => void,
  recordingId?: string,
): AudioStream {
  _ensureOpen();
  const streamId = `a-${++_audioSeq}-${kind}`;
  const st: AudioState = { slot: null, onTranscript, finalText: '', kind, recordingId, preready: [] };
  _audioStreams.set(streamId, st);
  _send({ type: 'audio.start', streamId, kind, recordingId });

  return {
    streamId,
    send: (pcm: ArrayBuffer) => {
      const s = _audioStreams.get(streamId);
      if (!s) return;
      if (s.slot == null) {
        // Slot not assigned yet (audio.ready not back) — buffer instead of dropping, so the
        // opening moment of speech survives the handshake. Bounded: past the cap we drop.
        const buffered = s.preready.reduce((n, b) => n + b.byteLength, 0);
        if (buffered < _PREREADY_MAX_BYTES) s.preready.push(pcm);
        return;
      }
      _sendFramedPcm(s.slot, pcm);
    },
    end: () =>
      new Promise<string>((resolve) => {
        const s = _audioStreams.get(streamId);
        if (!s) { resolve(''); return; }
        s.finalResolve = resolve;
        if (!_send({ type: 'audio.end', streamId })) {
          // Socket is down; we won't get a final transcript. Resolve with what we have.
          _audioStreams.delete(streamId);
          resolve(s.finalText);
        }
      }),
  };
}

export type SpeakHandle = {
  /** This TTS stream's id. */
  streamId: string;
  /** Cancel synthesis + playback (also tells the backend to stop synthesizing). */
  stop: () => void;
};

/**
 * Synthesize `text` on the backend (Kokoro) and stream the audio back. `onPcm(chunk, rate)`
 * fires for each float32 PCM chunk as it arrives; `onEnd` fires once when playback completes
 * or is cancelled. The caller (a TtsPlayer) schedules the chunks for gapless playback.
 */
export function speak(
  text: string,
  onPcm: (pcm: Float32Array, sampleRate: number) => void,
  onEnd: () => void,
  opts?: { voice?: string; lang?: string },
): SpeakHandle {
  _ensureOpen();
  const streamId = `t-${++_ttsSeq}`;
  const st: TtsState = { streamId, slot: null, sampleRate: 24000, onPcm, onEnd, ended: false };
  _ttsByStream.set(streamId, st);
  const sent = _send({ type: 'tts.speak', streamId, text, voice: opts?.voice, lang: opts?.lang });
  if (!sent) { _finishTts(st); }
  return {
    streamId,
    stop: () => {
      _send({ type: 'tts.stop', streamId });
      _finishTts(st);
    },
  };
}

/**
 * Subscribe to the Work Kernel live feed. `handler` receives a full snapshot
 * ({running, queued, dead, counts, at}) on subscribe and on every queue change. Opens the
 * socket and sends the `sub` if this is the first kernel listener; survives reconnects.
 */
export function onKernel(handler: (snapshot: unknown) => void): () => void {
  const first = _kernelListeners.size === 0;
  _kernelListeners.add(handler);
  _ensureOpen();
  if (first) _send({ type: 'sub', channel: 'kernel' });
  // A late subscriber (someone else already holds the channel, so no fresh `sub` is sent) would
  // otherwise wait for the next state change to see anything — replay the last snapshot now.
  else if (_lastKernelSnapshot !== null) { try { handler(_lastKernelSnapshot); } catch { /* ignore */ } }
  return () => {
    _kernelListeners.delete(handler);
    if (_kernelListeners.size === 0) _send({ type: 'unsub', channel: 'kernel' });
  };
}

/**
 * Passively observe every inbound WS frame (the Frames debug panel). Returns an unsubscribe
 * fn. This is a read-only tap — it never affects how frames are routed or handled.
 */
export function onFrame(handler: (frame: unknown) => void): () => void {
  _frameTaps.add(handler);
  _ensureOpen();
  return () => { _frameTaps.delete(handler); };
}

/** Subscribe to connection-status changes (for a reconnecting banner). Fires immediately. */
export function onStatus(fn: (s: SocketStatus) => void): () => void {
  _statusListeners.add(fn);
  try { fn(_status); } catch { /* ignore */ }
  return () => { _statusListeners.delete(fn); };
}

export function socketStatus(): SocketStatus {
  return _status;
}
