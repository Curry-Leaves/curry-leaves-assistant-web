/**
 * Always-on wake-word listening ("hey curry" → open voice chat).
 *
 * Detection runs entirely in a Worker (see workers/wakeword.worker.ts); this hook owns
 * the mic ref, the PCM subscription, the worker lifecycle, and the coordination with
 * voice chat. Audio never leaves the machine.
 *
 * Two lifecycle rules matter here:
 *  - `enabled` going false must fully release the mic. An unbalanced acquireMic() leaves
 *    the OS mic indicator lit with nothing driving it — the most visible way this feature
 *    can fail.
 *  - `suppressed` does NOT tear down. Voice chat acquires the same shared mic, and
 *    oscillating the ref count against it would thrash the stream. Suppression is a flag
 *    posted to the worker instead.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWakeModel, getWakeWord, type WakeWordConfig } from '../api/wakeword';
import { acquireMic, createPcmTap, releaseMic, type PcmTap } from './audioCapture';

// The fused .onnx is a few MB; cache it for the session so toggling the feature off
// and on doesn't refetch.
let _model: { key: string; bytes: ArrayBuffer } | null = null;

async function loadModel(cfg: WakeWordConfig) {
  const head = cfg.activeHead;
  if (!head) throw new Error('no wake-word model available');
  if (_model?.key === head.file) return _model;
  _model = { key: head.file, bytes: await fetchWakeModel(head.file) };
  return _model;
}

export type WakeWordState = {
  listening: boolean;
  score: number;
  error: string | null;
};

export function useWakeWord(opts: {
  enabled: boolean;
  suppressed: boolean;
  onWake: () => void;
}): WakeWordState {
  const { enabled, suppressed, onWake } = opts;
  const [listening, setListening] = useState(false);
  const [score, setScore] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const tapRef = useRef<PcmTap | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Keep the callback in a ref so a re-render with a new closure doesn't restart the mic.
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  const teardown = useCallback(() => {
    tapRef.current?.close();
    tapRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
    if (streamRef.current) { releaseMic(streamRef.current); streamRef.current = null; }
    setListening(false);
    setScore(0);
  }, []);

  useEffect(() => {
    if (!enabled) { teardown(); return; }

    let cancelled = false;
    (async () => {
      try {
        const cfg = await getWakeWord();
        if (cancelled) return;
        if (!cfg.available) throw new Error('wake-word models not downloaded');

        const model = await loadModel(cfg);
        if (cancelled) return;

        const worker = new Worker(new URL('../workers/wakeword.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent) => {
          const m = e.data;
          if (m.type === 'wake') onWakeRef.current();
          else if (m.type === 'score') setScore(m.score);
          else if (m.type === 'ready') setListening(true);
          else if (m.type === 'error') setError(m.message);
        };
        // Copy the cached buffer: init transfers it into the worker, which detaches the
        // original and would leave the session cache holding an empty view.
        worker.postMessage(
          {
            type: 'init',
            model: model.bytes.slice(0),
            threshold: cfg.threshold,
            // The fused model emits per-class logits with per-class thresholds; without
            // this the worker would compare a logit against cfg.threshold and fire constantly.
            meta: cfg.activeHead?.meta ?? null,
          },
          [],
        );
        workerRef.current = worker;

        const stream = await acquireMic();
        if (cancelled) { releaseMic(stream); worker.terminate(); return; }
        streamRef.current = stream;

        tapRef.current = await createPcmTap(stream, (buf) => {
          workerRef.current?.postMessage({ type: 'pcm', buf }, [buf]);
        });
        setError(null);
      } catch (e) {
        if (!cancelled) { setError(String(e)); teardown(); }
      }
    })();

    return () => { cancelled = true; teardown(); };
  }, [enabled, teardown]);

  // Suppression: flag-only, so the mic ref stays stable across a voice-chat session.
  useEffect(() => {
    workerRef.current?.postMessage({ type: 'suppress', on: suppressed });
  }, [suppressed]);

  return { listening: listening && !suppressed, score, error };
}
