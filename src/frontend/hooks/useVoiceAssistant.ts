/**
 * App-wide voice assistant: say the wake word anywhere, ask a question, hear the answer.
 *
 * This is deliberately NOT the chat's voice mode. `useVoiceChat` is driven by AskAiScreen —
 * it needs that screen's session, attachments, references and run bookkeeping, so it only
 * exists while the Ask AI tab is mounted. Screens here are tab-scoped (App.tsx renders a
 * screen only once its tab is opened), so a wake word living in AskAiScreen is silent until
 * the user has visited it. This hook owns the whole loop itself and lives in App.tsx, so it
 * is armed for the life of the app.
 *
 * The loop, one question at a time:
 *   armed → (wake word) → listening → (silence) → thinking → speaking → armed
 *
 * ...with a detour when the agent wants to hand work to a background teammate and the user
 * asked to be consulted first (Settings → "Confirm before queueing work"):
 *   thinking → (approve frame) → confirming → (spoken yes/no) → thinking → …
 *
 * Runs are NOT ephemeral. They go through the same `launch_stream_run` engine as chat, which
 * is what gives a spoken turn a real permission host — the ephemeral path had none, so any
 * gated tool hung until a watchdog killed the exchange with no explanation. Voice sessions
 * are tagged `surface: 'voice'` so they stay out of chat history and the Memory Keeper's
 * sweep, which is the only thing `ephemeral` was ever buying here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { speak, startAudio, subChat, type AudioStream, type SpeakHandle } from '../api/socket';
import { acquireMic, createPcmTap, releaseMic, type PcmTap } from './audioCapture';
import { TtsPlayer } from './audioPlayback';

// Matches useVoiceChat's tuning — same mic, same VAD problem. Overridable in Settings.
const SILENCE_MS = 1200;
const SPEECH_RMS = 0.015;
const MIN_UTTERANCE = 2;
// Give up if the user says nothing after the wake word, rather than holding a live
// transcription stream open forever.
const NO_SPEECH_TIMEOUT_MS = 8000;
// A yes/no is shorter than a question, but not by as much as it seems: "yes" is ~300ms of
// audio, and cutting the tail too eagerly truncates it to nothing. 1s is short enough to feel
// responsive and long enough that a one-word answer survives the VAD.
const CONFIRM_SILENCE_MS = 1000;
const CONFIRM_NO_SPEECH_MS = 8000;

// 'answered' = the reply is on screen and finished; it stays until auto-dismiss fires or
// the user closes it. Distinct from 'speaking' so the panel can drop the pulsing dot.
// 'confirming' = the agent asked to queue work and we're listening for a spoken yes/no.
export type AssistantPhase =
  | 'off' | 'armed' | 'listening' | 'thinking' | 'confirming' | 'speaking' | 'answered';

// Spoken yes/no. Deliberately a closed list rather than "anything that isn't no": an
// unrecognised answer re-asks once and then declines, because mishearing a stray word as
// consent queues work the user never asked for.
//
// NOT anchored with ^: Whisper prepends fillers ("Um, yes", "Well, sure") and always adds
// punctuation ("Yes."), so anchoring rejected the most common real answers. `no` is checked
// FIRST and with a word boundary, so "no, don't" can never be read as the "on" in "go on".
const YES = /\b(yes|yeah|yep|yup|sure|ok|okay|please|do it|go ahead|go for it|sounds good|affirmative|correct|right)\b/i;
const NO = /\b(no|nope|nah|don'?t|do not|stop|cancel|skip|never ?mind|negative|forget it)\b/i;

/**
 * Turn an approval request into a question worth hearing out loud.
 *
 * The generic form ("run the orchestrate tool?") is meaningless spoken aloud, so the case
 * that actually happens — handing work to a background teammate — gets the title read back
 * instead. That title is the agent's own summary of the work, which is exactly what someone
 * needs in order to say yes or no.
 */
function describeApproval(tool?: string, args?: Record<string, unknown>): string {
  const title = typeof args?.title === 'string' ? args.title.trim() : '';
  if (tool === 'orchestrate' && title) return `I'll put this on the queue: ${title}. Shall I?`;
  if (tool === 'orchestrate') return 'Shall I hand that to the team to work on?';
  return `Shall I run ${tool || 'that'}?`;
}

function rms(pcm: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return pcm.length ? Math.sqrt(sum / pcm.length) : 0;
}

export type VoiceAssistant = {
  phase: AssistantPhase;
  heard: string;      // what the user just said (shown while thinking/speaking)
  reply: string;      // the answer text as it streams
  cancel: () => void; // abandon this exchange and go back to armed
};

/** User-configurable behaviour (Settings → Wake word). */
export type VoiceAssistantPrefs = {
  speak: boolean;
  autoDismiss: boolean;
  dismissAfterMs: number;
  voice: string;
  silenceMs: number;
  /** 'confirm' = ask out loud before queueing background work; 'auto' = queue silently. */
  workApproval: 'confirm' | 'auto';
};

export function useVoiceAssistant(opts: {
  enabled: boolean;
  agentId: string | undefined;
  /** Fires when a wake word is detected — the caller re-arms after the exchange. */
  onWake: () => void;
  /** True while the wake listener should stand down (a chat voice session owns the mic). */
  suspended: boolean;
  prefs?: Partial<VoiceAssistantPrefs>;
}): VoiceAssistant & { startExchange: () => void } {
  const { enabled, agentId, suspended } = opts;
  // Read through a ref: these change from Settings mid-session, and a stale closure would
  // keep speaking after the user turned speech off.
  const prefsRef = useRef<VoiceAssistantPrefs>({
    speak: true, autoDismiss: true, dismissAfterMs: 6000, voice: '', silenceMs: SILENCE_MS,
    workApproval: 'confirm',
  });
  prefsRef.current = {
    speak: opts.prefs?.speak ?? true,
    autoDismiss: opts.prefs?.autoDismiss ?? true,
    dismissAfterMs: opts.prefs?.dismissAfterMs ?? 6000,
    voice: opts.prefs?.voice ?? '',
    silenceMs: opts.prefs?.silenceMs ?? SILENCE_MS,
    workApproval: opts.prefs?.workApproval ?? 'confirm',
  };
  const [phase, setPhase] = useState<AssistantPhase>('off');
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');

  const phaseRef = useRef<AssistantPhase>('off');
  const setPhaseBoth = useCallback((p: AssistantPhase) => { phaseRef.current = p; setPhase(p); }, []);

  const streamRef = useRef<MediaStream | null>(null);
  const tapRef = useRef<PcmTap | null>(null);
  const audioRef = useRef<AudioStream | null>(null);
  const playerRef = useRef<TtsPlayer | null>(null);
  const speakHandles = useRef<Set<SpeakHandle>>(new Set());
  const unsubRef = useRef<(() => void) | null>(null);

  const transcriptRef = useRef('');
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noSpeechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped by cancel(); an in-flight speakAnswer compares against it to know it was
  // superseded, so stopping mid-answer doesn't leave a playback loop spinning.
  const turnRef = useRef(0);
  const heardSpeech = useRef(false);
  const finalizing = useRef(false);
  // What the last confirmation capture transcribed — lets the re-ask distinguish
  // "I didn't hear you" from "that wasn't a yes or a no".
  const lastHeardRef = useRef('');
  const replyBuf = useRef('');
  const agentRef = useRef(agentId);
  agentRef.current = agentId;

  const clearTimers = () => {
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    if (noSpeechTimer.current) { clearTimeout(noSpeechTimer.current); noSpeechTimer.current = null; }
    if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
  };

  const teardownCapture = useCallback(() => {
    clearTimers();
    tapRef.current?.close(); tapRef.current = null;
    if (streamRef.current) { releaseMic(streamRef.current); streamRef.current = null; }
  }, []);

  const stopSpeaking = useCallback(() => {
    speakHandles.current.forEach((h) => { try { h.stop(); } catch { /* already done */ } });
    speakHandles.current.clear();
    playerRef.current?.close(); playerRef.current = null;
  }, []);

  /** Abandon whatever is in flight and return to armed (or off). */
  const cancel = useCallback(() => {
    turnRef.current++;   // invalidate any answer still speaking
    unsubRef.current?.(); unsubRef.current = null;
    teardownCapture();
    stopSpeaking();
    const a = audioRef.current; audioRef.current = null;
    a?.end().catch(() => {});
    transcriptRef.current = ''; replyBuf.current = '';
    finalizing.current = false;
    setHeard(''); setReply('');
    setPhaseBoth(enabled ? 'armed' : 'off');
  }, [enabled, setPhaseBoth, stopSpeaking, teardownCapture]);

  /**
   * Speak one utterance and return only once the audio has actually finished playing.
   *
   * Two things make this fiddly, and both matter for the confirmation prompt that reopens
   * the mic straight afterwards:
   *  - `speak()`'s callback fires when SYNTHESIS ends, not playback. The drain loop below is
   *    what waits for the buffered audio. Skip it and we'd open the mic mid-sentence — and
   *    with AEC off on this mic (see App.tsx) the assistant transcribes its own question and
   *    cheerfully approves itself.
   *  - `TtsPlayer.stop()` is permanent (`stopped` latches, `enqueue` early-returns forever),
   *    so a player that has been stopped can't be reused for a second utterance.
   *
   * Returns false if this exchange was superseded while speaking, so callers can bail.
   */
  const say = useCallback(async (text: string, myTurn: number): Promise<boolean> => {
    const clean = text.trim();
    if (!clean) return turnRef.current === myTurn;
    const { voice } = prefsRef.current;
    if (!playerRef.current) playerRef.current = new TtsPlayer();
    const player = playerRef.current;
    await new Promise<void>((resolve) => {
      const h = speak(
        clean,
        (pcm, sampleRate) => player.enqueue(pcm, sampleRate),
        () => resolve(),   // synthesis finished (or was stopped)
        voice ? { voice } : undefined,
      );
      speakHandles.current.add(h);
    });
    while (turnRef.current === myTurn && player.playing) {
      await new Promise((r) => setTimeout(r, 120));
    }
    return turnRef.current === myTurn;
  }, []);

  // ─── speak the answer, then re-arm ────────────────────────────────────────────
  const speakAnswer = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) { cancel(); return; }
    const { speak: doSpeak, autoDismiss, dismissAfterMs } = prefsRef.current;

    // Claim this exchange. cancel() bumps the token, so an answer that is stopped
    // mid-sentence (the user disabled speech, or closed the panel) can tell that it is no
    // longer the current one and bail instead of finishing its playback wait.
    const myTurn = ++turnRef.current;

    if (doSpeak) {
      setPhaseBoth('speaking');
      if (!(await say(clean, myTurn))) return;   // cancelled while speaking
    }
    if (turnRef.current !== myTurn) return;

    // The answer is on screen and finished. Auto-dismiss hides it after a beat; otherwise
    // it stays until the user closes it (and the wake word stays suppressed until then, so
    // the panel can't be talked over while it's still being read).
    setPhaseBoth('answered');
    if (autoDismiss) {
      dismissTimer.current = setTimeout(() => cancel(), Math.max(0, dismissAfterMs));
    }
  }, [cancel, say, setPhaseBoth]);

  // ─── capture one utterance ────────────────────────────────────────────────────
  /**
   * Open the mic, transcribe until the speaker stops, resolve with what they said.
   * Resolves '' if they said nothing (or the mic failed) — callers decide what that means:
   * for a question it ends the exchange, for a confirmation it counts as "no".
   *
   * Shared by the question and the yes/no confirmation; they differ only in timing, so the
   * VAD windows are parameters rather than two near-identical copies of this.
   */
  const captureUtterance = useCallback((
    { silenceMs, noSpeechMs }: { silenceMs: number; noSpeechMs: number },
  ): Promise<string> => new Promise((resolve) => {
    const myTurn = turnRef.current;
    transcriptRef.current = '';
    heardSpeech.current = false;
    finalizing.current = false;
    let settled = false;

    const finish = async () => {
      if (settled || finalizing.current) return;
      finalizing.current = true;
      settled = true;
      clearTimers();
      tapRef.current?.close(); tapRef.current = null;
      if (streamRef.current) { releaseMic(streamRef.current); streamRef.current = null; }
      const a = audioRef.current; audioRef.current = null;
      let text = transcriptRef.current;
      try {
        // end() flushes the tail server-side and resolves with the final transcript, which is
        // usually the only text there is — an utterance rarely reaches the live chunk size.
        const flushed = a ? await a.end() : '';
        if (flushed && flushed.trim().length >= text.trim().length) text = flushed;
      } catch { /* keep the partial */ }
      finalizing.current = false;
      transcriptRef.current = '';
      // Superseded while we were flushing (user closed the panel, wake word disabled).
      resolve(turnRef.current === myTurn ? text.trim() : '');
    };

    (async () => {
      try {
        const stream = await acquireMic();
        streamRef.current = stream;
        const audio = startAudio('dictation', (append) => {
          if (append) transcriptRef.current = transcriptRef.current ? `${transcriptRef.current} ${append}` : append;
        });
        audioRef.current = audio;
        tapRef.current = await createPcmTap(stream, (buf) => {
          audio.send(buf);
          // VAD: speech, then a quiet gap, ends the utterance.
          const level = rms(new Float32Array(buf));
          if (level > SPEECH_RMS) {
            heardSpeech.current = true;
            if (noSpeechTimer.current) { clearTimeout(noSpeechTimer.current); noSpeechTimer.current = null; }
            if (silenceTimer.current) clearTimeout(silenceTimer.current);
            silenceTimer.current = setTimeout(() => { finish(); }, silenceMs);
          }
        });
        // Nothing said at all → give up rather than hold the stream open.
        noSpeechTimer.current = setTimeout(() => { if (!heardSpeech.current) finish(); }, noSpeechMs);
      } catch {
        settled = true;
        resolve('');
      }
    })();
  }), []);

  /**
   * Speak a question and listen for a spoken yes/no. Anything unrecognised gets ONE re-ask,
   * then declines: consent has to be affirmative, and a mis-transcribed word must never
   * read as approval for work the user didn't ask for.
   */
  const confirmAloud = useCallback(async (question: string): Promise<boolean> => {
    const myTurn = turnRef.current;
    for (let attempt = 0; attempt < 2; attempt++) {
      setPhaseBoth('speaking');
      // Re-ask differently depending on WHY we're here: nothing heard is a different
      // problem from something heard that wasn't a yes or a no.
      const prompt = attempt === 0 ? question : lastHeardRef.current
        ? 'Sorry — was that a yes or a no?'
        : "Sorry, I didn't catch that. Yes or no?";
      if (!(await say(prompt, myTurn))) return false;
      if (turnRef.current !== myTurn) return false;
      setPhaseBoth('confirming');
      const answer = (await captureUtterance({
        silenceMs: CONFIRM_SILENCE_MS, noSpeechMs: CONFIRM_NO_SPEECH_MS,
      })).trim();
      if (turnRef.current !== myTurn) return false;
      lastHeardRef.current = answer;
      setHeard(answer || '(nothing heard)');
      // NO first: "no, don't do that" contains no yes-word, but a stray "ok" in
      // "ok but no" must not outvote the refusal.
      if (NO.test(answer)) return false;
      if (YES.test(answer)) return true;
      // Neither recognised (including silence) → one more go, then decline. Silence is
      // NOT taken as an answer on the first pass: a one-word "yes" that the VAD clipped
      // is far more likely than someone walking away mid-question.
    }
    return false;
  }, [captureUtterance, say, setPhaseBoth]);

  // ─── send the question, stream the reply ──────────────────────────────────────
  const ask = useCallback(async (question: string) => {
    const agent = agentRef.current;
    if (!agent) { cancel(); return; }
    setPhaseBoth('thinking');
    setHeard(question);
    replyBuf.current = '';
    setReply('');
    const myTurn = turnRef.current;
    try {
      // NOT ephemeral: this takes the same launch_stream_run engine as chat, so the run gets
      // a real permission host and a gated tool can actually be answered. `autonomous` when
      // the user has opted out of confirmations — otherwise the one gate that matters (a
      // handoff to a background agent) is confirmed out loud below.
      // surface:'voice' keeps the session out of chat history and the Memory Keeper's sweep.
      const auto = prefsRef.current.workApproval === 'auto';
      const start = await api.startChat({
        agentId: agent, message: question, autonomous: auto, surface: 'voice',
      });
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        unsubRef.current?.(); unsubRef.current = null;
        if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
        speakAnswer(replyBuf.current);
      };
      unsubRef.current = subChat(start.runId, (raw) => {
        const e = raw as {
          type?: string; text?: string; id?: string; tool?: string;
          args?: Record<string, unknown>; question?: string;
        };
        if (e.type === 'token' && e.text) {
          replyBuf.current += e.text;
          setReply(replyBuf.current);
        } else if (e.type === 'approve' && e.id) {
          // The agent wants to run a gated tool. In practice that's `orchestrate` handing
          // work to a teammate — the one decision worth interrupting a spoken turn for.
          void (async () => {
            if (turnRef.current !== myTurn) return;
            const ok = await confirmAloud(describeApproval(e.tool, e.args));
            if (turnRef.current !== myTurn) return;
            setPhaseBoth('thinking');
            try {
              await api.respondChat({
                runId: start.runId, requestId: e.id!, tool: e.tool,
                approved: ok, scope: 'once',
              });
            } catch { cancel(); }
          })();
        } else if (e.type === 'done' || e.type === 'error' || e.type === 'gone') {
          finish();
        }
      });
    } catch {
      cancel();
    }
  }, [cancel, confirmAloud, setPhaseBoth, speakAnswer]);

  /** Called on wake: open the mic and start transcribing the question. */
  const startExchange = useCallback(async () => {
    if (phaseRef.current === 'listening' || phaseRef.current === 'thinking'
      || phaseRef.current === 'confirming' || phaseRef.current === 'speaking') return;
    setPhaseBoth('listening');
    setHeard(''); setReply('');
    const myTurn = turnRef.current;
    const q = await captureUtterance({
      silenceMs: prefsRef.current.silenceMs, noSpeechMs: NO_SPEECH_TIMEOUT_MS,
    });
    if (turnRef.current !== myTurn) return;   // cancelled while listening
    if (q.length < MIN_UTTERANCE) { cancel(); return; }
    ask(q);
  }, [ask, cancel, captureUtterance, setPhaseBoth]);

  // Reflect enabled/suspended into the resting phase.
  useEffect(() => {
    if (!enabled) { cancel(); setPhaseBoth('off'); return; }
    if (phaseRef.current === 'off') setPhaseBoth('armed');
  }, [enabled, cancel, setPhaseBoth]);

  useEffect(() => {
    if (suspended && phaseRef.current !== 'off') cancel();
  }, [suspended, cancel]);

  useEffect(() => () => { teardownCapture(); stopSpeaking(); unsubRef.current?.(); }, [teardownCapture, stopSpeaking]);

  return { phase, heard, reply, cancel, startExchange };
}
