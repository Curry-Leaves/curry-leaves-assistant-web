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
export function useLiveTranscript(active: boolean, paused: boolean, deviceId?: string, recordingId?: string) {
  const [transcript, setTranscript] = useState('');
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

    if (!active) { teardown(); setTranscript(''); return; }

    (async () => {
      try {
        const stream = await acquireMic(deviceId);
        if (cancelled) { releaseMic(stream); return; }
        streamRef.current = stream;
        const audio = startAudio('live', (append) => {
          if (append) setTranscript((prev) => (prev ? `${prev} ${append}` : append));
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

  return { transcript, streamId };
}
