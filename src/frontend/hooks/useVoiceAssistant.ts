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
const SPEECH_RMS = 0.02;
const MIN_UTTERANCE = 2;
// A single loud frame is a click, a cough, a lip smack, or the tail of the assistant's own
// audio — not speech. Require this many consecutive over-threshold frames before we believe
// someone is actually talking, so a stray blip can't arm the capture and hand Whisper a near-
// silent clip to hallucinate "okay" / "you" / "thanks" on. Each frame is ~256ms (4096 @ 16kHz),
// so 2 = ~0.5s: enough to reject a click, short enough that a crisp "yes" in the confirmation
// still arms it.
const SPEECH_FRAMES_TO_ARM = 2;

// Whisper hallucinates stock fillers on silence or noise — "you", "thank you", "thanks for
// watching", "bye", "[BLANK_AUDIO]", "(music)". When one of these is the ENTIRE transcript it's
// almost always a hallucination on a near-empty clip, not something the user said. Dropping them
// is what stops the assistant reacting when nobody spoke.
//
// Deliberately does NOT include yes/no/ok/sure/okay: those are the real answers the yes/no
// confirmation listens for, so they must survive. The sustained-speech gate (SPEECH_FRAMES_TO_
// ARM) is what stops a *silent* clip producing a phantom "ok" — this list handles the noisier
// hallucinations that a gate alone won't catch.
const HALLUCINATION_ONLY = new RegExp(
  '^(?:' +
  '(?:um|uh|ah|oh|hmm|mm|mhm|you|bye|goodbye|so long|thanks?|thank you|' +
  'thanks for watching|thank you for watching|please subscribe|subscribe|like and subscribe|' +
  'the end|music|applause|silence|blank_?audio|\\[[^\\]]*\\]|\\([^)]*\\))' +
  '[\\s.,!?-]*)+$', 'i',
);

/** True if `text` is nothing but Whisper filler/hallucination (no real content the user said). */
function isHallucinationOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return HALLUCINATION_ONLY.test(t);
}
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
  /** Reopen the mic for a follow-up after each answer (continuous conversation), ending on
   *  silence or an explicit cancel, instead of one question per wake word. */
  continuous: boolean;
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
    speak: true, continuous: true, autoDismiss: true, dismissAfterMs: 6000, voice: '',
    silenceMs: SILENCE_MS, workApproval: 'confirm',
  });
  prefsRef.current = {
    speak: opts.prefs?.speak ?? true,
    continuous: opts.prefs?.continuous ?? true,
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
  // The session this whole spoken conversation shares. The first question of an exchange starts
  // with none (a fresh session is created server-side and returned); every follow-up reuses it,
  // so the agent sees the prior turns and "no, I meant X" lands with context. cancel() clears it
  // — the NEXT wake word begins a clean conversation rather than inheriting stale history.
  const sessionRef = useRef<string | null>(null);
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
    sessionRef.current = null;   // end of conversation → next wake word starts fresh
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

  // A follow-up listener installed by speakAnswer when continuous mode is on. Held in a ref to
  // break the declaration cycle: speakAnswer needs to start a new turn, and starting a turn
  // needs speakAnswer. Assigned once startFollowUp is defined, below.
  const followUpRef = useRef<(() => void) | null>(null);

  // ─── speak the answer, then re-arm ────────────────────────────────────────────
  const speakAnswer = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) { cancel(); return; }
    const { speak: doSpeak, continuous, autoDismiss, dismissAfterMs } = prefsRef.current;

    // Claim this exchange. cancel() bumps the token, so an answer that is stopped
    // mid-sentence (the user disabled speech, or closed the panel) can tell that it is no
    // longer the current one and bail instead of finishing its playback wait.
    const myTurn = ++turnRef.current;

    if (doSpeak) {
      setPhaseBoth('speaking');
      if (!(await say(clean, myTurn))) return;   // cancelled while speaking
    }
    if (turnRef.current !== myTurn) return;

    // The answer is on screen and finished.
    setPhaseBoth('answered');

    // Continuous conversation: reopen the mic for a follow-up so a back-and-forth doesn't need
    // the wake word each turn. We only get here AFTER `say()` has drained playback, so the mic
    // never opens mid-sentence (AEC is off on this mic — see App.tsx). A silent follow-up ends
    // the loop via the same no-speech path as the first question, settling back to armed.
    // Skipped when speech is off: with no spoken reply there's no natural turn-taking cue, so a
    // silent-answer setup stays one-shot.
    if (continuous && doSpeak) { followUpRef.current?.(); return; }

    // One-shot: auto-dismiss hides the panel after a beat; otherwise it stays until the user
    // closes it (and the wake word stays suppressed until then, so it can't be talked over).
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
    // Consecutive over-threshold frames so far. One blip isn't speech; SPEECH_FRAMES_TO_ARM in
    // a row is. Reset the instant a frame drops back under, so only genuinely sustained sound
    // arms the capture.
    let speechRun = 0;

    // `spoke` = did real, sustained speech actually occur? When false we DON'T transcribe at
    // all — feeding Whisper a silent/near-silent clip is exactly what produces the phantom
    // "okay"/"you"/"thanks" this guards against. So a no-speech finish resolves '' directly.
    const finish = async (spoke: boolean) => {
      if (settled || finalizing.current) return;
      finalizing.current = true;
      settled = true;
      clearTimers();
      tapRef.current?.close(); tapRef.current = null;
      if (streamRef.current) { releaseMic(streamRef.current); streamRef.current = null; }
      const a = audioRef.current; audioRef.current = null;
      // No real speech → discard the audio without transcribing; nothing was said.
      if (!spoke) {
        try { await a?.end(); } catch { /* just draining */ }
        finalizing.current = false;
        transcriptRef.current = '';
        resolve('');
        return;
      }
      let text = transcriptRef.current;
      try {
        // end() flushes the tail server-side and resolves with the final transcript, which is
        // usually the only text there is — an utterance rarely reaches the live chunk size.
        const flushed = a ? await a.end() : '';
        if (flushed && flushed.trim().length >= text.trim().length) text = flushed;
      } catch { /* keep the partial */ }
      finalizing.current = false;
      transcriptRef.current = '';
      text = text.trim();
      // Sustained speech but the transcript is nothing but a Whisper filler → treat as nothing
      // said. Catches hallucinations the no-speech gate can't (real noise that isn't words).
      if (isHallucinationOnly(text)) text = '';
      // Superseded while we were flushing (user closed the panel, wake word disabled).
      resolve(turnRef.current === myTurn ? text : '');
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
          // VAD: SUSTAINED speech, then a quiet gap, ends the utterance. A single loud frame
          // (click, cough, echo tail) no longer counts — only SPEECH_FRAMES_TO_ARM in a row.
          const level = rms(new Float32Array(buf));
          if (level > SPEECH_RMS) {
            speechRun++;
            if (speechRun >= SPEECH_FRAMES_TO_ARM) {
              heardSpeech.current = true;
              if (noSpeechTimer.current) { clearTimeout(noSpeechTimer.current); noSpeechTimer.current = null; }
              if (silenceTimer.current) clearTimeout(silenceTimer.current);
              silenceTimer.current = setTimeout(() => { finish(true); }, silenceMs);
            }
          } else {
            speechRun = 0;   // gap breaks the run; a lone blip never arms
          }
        });
        // Nothing said at all → give up rather than hold the stream open (and DON'T transcribe).
        noSpeechTimer.current = setTimeout(() => { if (!heardSpeech.current) finish(false); }, noSpeechMs);
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
      // sessionId threads the conversation: the first turn passes null (a fresh session is
      // created and returned), every follow-up reuses it, so the agent has the prior turns and
      // a correction like "no, I meant the other one" is understood. cancel() clears it at the
      // end of the exchange, so the next wake word opens a clean conversation.
      const auto = prefsRef.current.workApproval === 'auto';
      const start = await api.startChat({
        agentId: agent, message: question, autonomous: auto, surface: 'voice',
        sessionId: sessionRef.current,
      });
      sessionRef.current = start.sessionId ?? sessionRef.current;
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

  /**
   * Continuous mode: after an answer, reopen the mic for a follow-up WITHOUT the wake word.
   * Speech → ask it (which loops back here after the next answer). Silence → the conversation
   * is over, so settle on the last answer and let auto-dismiss / manual close take it from
   * there. That silence-ends-it rule is what keeps the mic from staying live forever.
   */
  const startFollowUp = useCallback(async () => {
    if (phaseRef.current !== 'answered') return;   // superseded (cancel, disable, close)
    setPhaseBoth('listening');
    setHeard(''); setReply('');
    const myTurn = ++turnRef.current;
    const q = await captureUtterance({
      silenceMs: prefsRef.current.silenceMs, noSpeechMs: NO_SPEECH_TIMEOUT_MS,
    });
    if (turnRef.current !== myTurn) return;   // cancelled while listening
    if (q.length < MIN_UTTERANCE) {
      // No follow-up — end the conversation on the answer that's already up.
      setPhaseBoth('answered');
      const { autoDismiss, dismissAfterMs } = prefsRef.current;
      if (autoDismiss) dismissTimer.current = setTimeout(() => cancel(), Math.max(0, dismissAfterMs));
      return;
    }
    ask(q);
  }, [ask, cancel, captureUtterance, setPhaseBoth]);

  followUpRef.current = startFollowUp;

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
