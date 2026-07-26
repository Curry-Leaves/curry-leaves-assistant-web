import { useCallback, useEffect, useRef, useState } from 'react';
import { startAudio, speak, type AudioStream, type SpeakHandle } from '../api/socket';
import { acquireMic, releaseMic, createPcmTap, type PcmTap } from './audioCapture';
import { TtsPlayer } from './audioPlayback';

/**
 * Hands-free Voice mode for the chat: a single toggle that runs the loop
 *   listen → (silence) → send the transcript → speak the reply → listen again.
 *
 * It reuses the existing dictation plumbing (mic tap → PCM over the shared WS → live
 * whisper transcript) to hear, and the new `speak()` TTS stream + TtsPlayer to talk. The
 * *sending* of the transcript and the *reply text* both live in AskAiScreen, so this hook
 * is driven by it: the screen supplies `onUtterance(text)` (sends a turn) and feeds reply
 * tokens back via `feedReplyToken` / `endReply`.
 *
 * Turn-taking:
 *  - LISTENING: mic open, accumulating transcript. A ~1.2s gap after speech (VAD on the PCM
 *    RMS) finalizes the utterance → onUtterance(text) → stop listening, enter SPEAKING.
 *  - SPEAKING: reply tokens are buffered to sentence boundaries and each completed sentence
 *    is synthesized + played. When the reply ends and playback drains, re-open the mic.
 *  - Barge-in: if the user starts talking while we're speaking, playback is cancelled and we
 *    return to LISTENING immediately.
 */

// Silence (below this RMS) for this long after speech → the utterance is complete.
const SILENCE_MS = 1200;
// Speech must exceed this RMS to count as "the user is talking" (VAD threshold on 16k PCM).
const SPEECH_RMS = 0.015;
// Ignore utterances shorter than this many chars (stray noise / a cough transcribed as "you").
const MIN_UTTERANCE = 2;

type Phase = 'idle' | 'listening' | 'speaking';

function rms(pcm: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return pcm.length ? Math.sqrt(sum / pcm.length) : 0;
}

export function useVoiceChat(onUtterance: (text: string) => void) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const setPhaseBoth = (p: Phase) => { phaseRef.current = p; setPhase(p); };

  // Capture / STT
  const streamRef = useRef<MediaStream | null>(null);
  const tapRef = useRef<PcmTap | null>(null);
  const audioRef = useRef<AudioStream | null>(null);
  const transcriptRef = useRef('');
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heardSpeech = useRef(false);
  // True while finalizeUtterance is awaiting the backend flush — blocks a re-entrant VAD tick.
  const finalizing = useRef(false);

  // TTS
  const playerRef = useRef<TtsPlayer | null>(null);
  const speakHandles = useRef<Set<SpeakHandle>>(new Set());
  const replyBuf = useRef('');
  const drainTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const onUtteranceRef = useRef(onUtterance);
  useEffect(() => { onUtteranceRef.current = onUtterance; }, [onUtterance]);

  // ─── capture teardown ────────────────────────────────────────────────────────
  /** Drop the mic + tap. Does NOT close the audio stream — see `flushCapture`/`teardownCapture`. */
  const releaseCapture = useCallback(() => {
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    tapRef.current?.close(); tapRef.current = null;
    if (streamRef.current) { releaseMic(streamRef.current); streamRef.current = null; }
  }, []);

  /** Stop capturing and close the stream, resolving with the FINAL transcript.
   *
   * end() is what makes the backend flush its tail: it buffers CURRY_LEAVES_LIVE_CHUNK_SEC (8s)
   * of audio before returning any incremental text, so a normal utterance (a few seconds, then
   * the 1.2s VAD gap) never reaches that threshold and the only text we ever get comes back on
   * this flush. Awaiting it — rather than firing it and dropping the promise — is the difference
   * between hearing the user and silently discarding every turn. Mirrors useDictation.stop(). */
  const flushCapture = useCallback(async (): Promise<string> => {
    releaseCapture();
    const audio = audioRef.current; audioRef.current = null;
    if (!audio) return '';
    try { return await audio.end(); } catch { return ''; }
  }, [releaseCapture]);

  /** Fire-and-forget teardown, for paths with no transcript to collect (errors, stop, unmount). */
  const teardownCapture = useCallback(() => {
    releaseCapture();
    if (audioRef.current) { audioRef.current.end().catch(() => {}); audioRef.current = null; }
  }, [releaseCapture]);

  // Finalize the current utterance and hand it to the screen to send.
  const finalizeUtterance = useCallback(async () => {
    // The flush below is awaited, so a late VAD tick could re-enter and double-send. Guard.
    if (finalizing.current) return;
    finalizing.current = true;
    try {
      heardSpeech.current = false;
      if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
      // Stop capturing while the assistant thinks + speaks (avoids transcribing our own TTS), and
      // take the flushed final transcript — the incremental one is typically still empty here.
      const partial = transcriptRef.current.trim();
      const flushed = (await flushCapture()).trim();
      transcriptRef.current = '';
      // The flush returns the authoritative full text; fall back to any partial we accumulated.
      const text = flushed || partial;
      if (text.length >= MIN_UTTERANCE) {
        setPhaseBoth('speaking');
        onUtteranceRef.current(text);
      } else {
        // Nothing meaningful — just keep listening.
        startListening();
      }
    } finally {
      finalizing.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flushCapture]);

  // ─── listening ────────────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    if (streamRef.current) return;
    transcriptRef.current = '';
    heardSpeech.current = false;
    try {
      const stream = await acquireMic();
      streamRef.current = stream;
      const audio = startAudio('dictation', (append) => {
        if (append) transcriptRef.current = transcriptRef.current ? `${transcriptRef.current} ${append}` : append;
      });
      audioRef.current = audio;
      tapRef.current = await createPcmTap(stream, (buf) => {
        audio.send(buf);
        // VAD: on speech, arm/refresh the silence countdown; the countdown firing = utterance end.
        const level = rms(new Float32Array(buf));
        if (level >= SPEECH_RMS) {
          heardSpeech.current = true;
          if (silenceTimer.current) clearTimeout(silenceTimer.current);
          silenceTimer.current = setTimeout(() => { if (heardSpeech.current) finalizeUtterance(); }, SILENCE_MS);
        }
      });
      setPhaseBoth('listening');
    } catch {
      setPhaseBoth('idle');
      teardownCapture();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalizeUtterance, teardownCapture]);

  // ─── speaking (driven by the screen's reply token stream) ──────────────────────
  const ensurePlayer = () => {
    if (!playerRef.current) playerRef.current = new TtsPlayer();
    return playerRef.current;
  };

  // Markdown must be stripped BEFORE sentence-splitting, not after: a link's URL carries
  // punctuation the splitter would tear on ("[docs](https://ex.com/a. html)" → a fragment
  // starting mid-URL). Strip first and the splitter only ever sees clean prose. The backend
  // strips again at synth (tts.speakable) — this pass exists so the *split* is clean too.
  const stripMarkdown = (s: string): string => s
    .replace(/```[\s\S]*?```/g, ' code block ')          // fenced code: don't read it aloud
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')            // image → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')             // link → label, drop the URL
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')                  // headings
    .replace(/^\s{0,3}>\s?/gm, '')                       // blockquotes
    .replace(/^(\s*)[-*+]\s+/gm, '$1')                   // bullets
    .replace(/\*\*\*(.+?)\*\*\*/gs, '$1')
    .replace(/\*\*(.+?)\*\*/gs, '$1')                    // bold
    .replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/gs, '$1')  // italic (leaves a*b alone)
    .replace(/~~(.+?)~~/gs, '$1')
    .replace(/`([^`]+)`/g, '$1')                         // inline code
    .replace(/https?:\/\/\S+/g, ' link ')                // bare URLs
    .replace(/[ \t]{2,}/g, ' ');

  // A trailing markdown construct that is still streaming in ("**bo", "[lab") — stripping it now
  // would emit the raw delimiter, so hold everything from here back until it closes.
  const openMarkdownAt = (text: string): number => {
    const m = text.match(/\[[^\]]*$|\[[^\]]*\][^(]*$|\[[^\]]*\]\([^)]*$|`[^`]*$|\*\*(?:(?!\*\*)[\s\S])*$|```(?:(?!```)[\s\S])*$/);
    return m?.index ?? -1;
  };

  // Cut at end-punctuation followed by whitespace, keeping each sentence whole from where the
  // last one ended. (The previous `[^.!?]*[.!?]+\s+` form could start a match *mid-token*, so
  // "Edit config.json now. " spoke only "json now." — it silently ate the start of any sentence
  // containing a filename, version, or decimal.) Returns the complete sentences plus the
  // unterminated remainder, which stays buffered until more tokens arrive.
  const splitSentences = (text: string): { sentences: string[]; rest: string } => {
    const re = /[.!?。！？]+["')\]]*\s+/g;
    const sentences: string[] = [];
    let start = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const end = m.index + m[0].length;
      const s = text.slice(start, end).trim();
      if (s) sentences.push(s);
      start = end;
    }
    return { sentences, rest: text.slice(start) };
  };

  const flushSentences = (final: boolean) => {
    // Hold back a half-arrived construct so it isn't stripped mid-flight; on the final flush
    // there's nothing more coming, so take the buffer as-is.
    const open = final ? -1 : openMarkdownAt(replyBuf.current);
    const raw = open === -1 ? replyBuf.current : replyBuf.current.slice(0, open);
    const held = open === -1 ? '' : replyBuf.current.slice(open);
    // Strip BEFORE splitting — the splitter must never see a URL's punctuation.
    const { sentences, rest } = splitSentences(stripMarkdown(raw));
    const player = ensurePlayer();
    const say = (s: string) => {
      const h = speak(s, (pcm, rate) => player.enqueue(pcm, rate), () => { speakHandles.current.delete(h); });
      speakHandles.current.add(h);
    };
    for (const s of sentences) say(s);
    replyBuf.current = rest + held;
    if (final) {
      const tail = stripMarkdown(replyBuf.current).trim();
      replyBuf.current = '';
      if (tail) say(tail);
    }
  };

  /** Feed one reply-text delta (called from AskAiScreen's token handler when voice is active). */
  const feedReplyToken = useCallback((text: string) => {
    if (phaseRef.current !== 'speaking' || !text) return;
    replyBuf.current += text;
    flushSentences(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopSpeakingHandles = () => {
    for (const h of speakHandles.current) { try { h.stop(); } catch { /* ignore */ } }
    speakHandles.current.clear();
    playerRef.current?.stop();
    replyBuf.current = '';
  };

  /** The reply finished (done/error). Flush the tail, then re-open the mic once audio drains. */
  const endReply = useCallback(() => {
    if (phaseRef.current !== 'speaking') return;
    flushSentences(true);
    // Poll until synthesis requests are done AND the player has drained, then listen again.
    if (drainTimer.current) clearInterval(drainTimer.current);
    drainTimer.current = setInterval(() => {
      const busy = speakHandles.current.size > 0 || (playerRef.current?.playing ?? false);
      if (!busy) {
        if (drainTimer.current) { clearInterval(drainTimer.current); drainTimer.current = null; }
        if (phaseRef.current === 'speaking') startListening();
      }
    }, 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startListening]);

  // ─── toggle on/off ─────────────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    if (drainTimer.current) { clearInterval(drainTimer.current); drainTimer.current = null; }
    stopSpeakingHandles();
    playerRef.current?.close(); playerRef.current = null;
    teardownCapture();
    setActive(false);
    setPhaseBoth('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teardownCapture]);

  const toggle = useCallback(() => {
    if (active) { stopAll(); return; }
    setActive(true);
    startListening();
  }, [active, stopAll, startListening]);

  useEffect(() => () => { stopAll(); }, [stopAll]);

  return { active, phase, toggle, feedReplyToken, endReply, stopAll };
}
