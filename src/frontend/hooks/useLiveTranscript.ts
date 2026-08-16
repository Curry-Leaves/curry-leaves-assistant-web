import { useEffect, useRef, useState } from 'react';
import { startAudio, type AudioStream } from '../api/socket';
import { acquireMic, releaseMic, createPcmTap, type PcmTap } from './audioCapture';

/**
 * Live meeting transcript: while `active`, taps the mic and streams 16kHz PCM over the
 * shared WebSocket (see api/socket.startAudio), surfacing rolling partial transcripts.
 * Audio is gated by `paused` so it tracks the recorder's pause/resume without dropping the
 * stream. Shares the recorder's getUserMedia stream via acquireMic (preview only — the
 * stored recording gets its own full transcription on finalize). The socket owns
 * reconnection; a blip re-opens the audio stream automatically, so a network hiccup no
 * longer kills the live transcript.
 */
/** One settled chunk of live transcript, with when it landed. `at` is seconds since capture
 *  started — taken from the caller's own clock, since the live stream carries no timings. */
export interface TranscriptSegment { at: number; text: string }

export function useLiveTranscript(
  active: boolean,
  paused: boolean,
  deviceId?: string,
  recordingId?: string,
  /** Reads the recorder's elapsed seconds when a chunk lands. A ref, not a value, so the
   *  socket callback isn't re-created (and the stream torn down) on every tick. */
  elapsedRef?: { current: number },
) {
  const [transcript, setTranscript] = useState('');
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [streamId, setStreamId] = useState<string | null>(null);
  const audioRef = useRef<AudioStream | null>(null);
  const tapRef = useRef<PcmTap | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    let cancelled = false;

    const teardown = () => {
      audioRef.current?.end().catch(() => {}); audioRef.current = null;
      tapRef.current?.close(); tapRef.current = null;
      if (streamRef.current) { releaseMic(streamRef.current); streamRef.current = null; }
    };

    if (!active) { teardown(); setTranscript(''); setSegments([]); return; }

    (async () => {
      try {
        const stream = await acquireMic(deviceId);
        if (cancelled) { releaseMic(stream); return; }
        streamRef.current = stream;
        const audio = startAudio('live', (append) => {
          if (!append) return;
          setTranscript((prev) => (prev ? `${prev} ${append}` : append));
          // Every append is already a completed chunk of speech, not a partial that gets
          // revised (api/ws.py sends one frame per transcribed chunk; `isFinal` marks only the
          // end-of-stream flush, which is one more chunk). So each becomes a timeline entry.
          setSegments((prev) => [...prev, { at: elapsedRef?.current ?? 0, text: append }]);
        }, recordingId);
        audioRef.current = audio;
        setStreamId(audio.streamId);
        const tap = await createPcmTap(stream, (buf) => {
          if (!pausedRef.current) audio.send(buf);
        });
        if (cancelled) { tap.close(); return; }
        tapRef.current = tap;
      } catch { /* mic denied — leave transcript empty */ }
    })();

    return () => { cancelled = true; teardown(); setStreamId(null); };
  }, [active]);

  return { transcript, segments, streamId };
}
