import { useEffect, useRef, useState } from 'react';
import { startAudio, type AudioStream } from '../api/socket';
import { acquireMic, releaseMic, createPcmTap, type PcmTap } from './audioCapture';

// ─── live dictation (streams PCM over the shared WS; partials as you speak) ─────
export function useDictation() {
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const audioRef = useRef<AudioStream | null>(null);
  const tapRef = useRef<PcmTap | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const latestRef = useRef('');

  const teardownCapture = () => {
    tapRef.current?.close(); tapRef.current = null;
    if (streamRef.current) { releaseMic(streamRef.current); streamRef.current = null; }
  };

  const start = async () => {
    if (audioRef.current || streamRef.current) return;
    setTranscript(''); latestRef.current = '';
    try {
      const stream = await acquireMic();
      streamRef.current = stream;
      const audio = startAudio('dictation', (append) => {
        if (append) { latestRef.current = latestRef.current ? `${latestRef.current} ${append}` : append; setTranscript(latestRef.current); }
      });
      audioRef.current = audio;
      tapRef.current = await createPcmTap(stream, (buf) => audio.send(buf));
      setRecording(true);
    } catch { setRecording(false); teardownCapture(); }
  };

  const stop = async (): Promise<string> => {
    if (!audioRef.current && !streamRef.current) return latestRef.current;
    setRecording(false);
    teardownCapture();
    const audio = audioRef.current; audioRef.current = null;
    // end() flushes the tail on the server and resolves with the final transcript.
    const text = audio ? await audio.end() : latestRef.current;
    setTranscript('');
    return text || latestRef.current;
  };

  useEffect(() => () => { teardownCapture(); audioRef.current?.end().catch(() => {}); audioRef.current = null; }, []);
  return { recording, transcript, start, stop };
}
