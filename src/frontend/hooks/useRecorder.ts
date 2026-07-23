import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import { acquireMic, releaseMic } from './audioCapture';

/**
 * Audio recorder ported from curry-leaves: MediaRecorder + Web Audio waveform with
 * pause/resume/stop. Chunks stream to the backend over HTTP (POST
 * /recordings/{id}/chunk) for crash-safe storage; finalize is left to the caller.
 */
const WAVEFORM_SAMPLES = 512;
const barsForWidth = (w: number) => Math.max(Math.round(w / 5), 40);

async function extractWaveformData(audioBlob: Blob): Promise<Float32Array> {
  const buf = await audioBlob.arrayBuffer();
  const tmpCtx = new AudioContext();
  let decoded: AudioBuffer;
  try { decoded = await tmpCtx.decodeAudioData(buf); }
  catch { tmpCtx.close(); return new Float32Array(WAVEFORM_SAMPLES).fill(0.05); }
  tmpCtx.close();
  const ch = decoded.getChannelData(0);
  const blockSize = Math.max(Math.floor(ch.length / WAVEFORM_SAMPLES), 1);
  const out = new Float32Array(WAVEFORM_SAMPLES);
  for (let i = 0; i < WAVEFORM_SAMPLES; i++) {
    let sum = 0;
    for (let j = 0; j < blockSize; j++) sum += Math.abs(ch[i * blockSize + j] || 0);
    out[i] = sum / blockSize;
  }
  const max = Math.max(...Array.from(out), 0.001);
  for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

export interface StoppedData {
  blob: Blob;
  duration: number;
  recordingId: string;
}

export function useRecorder() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef(0);
  const pausedAtRef = useRef(0);
  const waveformRef = useRef<Float32Array | null>(null);
  const frozenRef = useRef<number[]>([]);
  const recIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  // Chunk uploads are chained so they hit the backend strictly in order — the server
  // appends each body to audio.webm, so a fire-and-forget POST that overtakes an
  // earlier one would interleave bytes and corrupt the file on slow networks.
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve());

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [stoppedData, setStoppedData] = useState<StoppedData | null>(null);
  const [recordingId, setRecordingId] = useState<string | null>(null);  // active draft id

  const drawBars = useCallback((getHeight: (i: number, n: number) => number, alpha: number) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.clearRect(0, 0, w, h);
    const n = barsForWidth(w);
    const bw = w / n;
    const thin = Math.max(bw * 0.4, 1.5);
    for (let i = 0; i < n; i++) {
      const hue = (i / n) * 360;
      const bh = Math.max(getHeight(i, n) * h, 2);
      ctx.fillStyle = `hsla(${hue}, 70%, 50%, ${alpha})`;
      ctx.beginPath();
      ctx.roundRect(i * bw + (bw - thin) / 2, h / 2 - bh / 2, thin, bh, 1);
      ctx.fill();
    }
  }, []);

  const drawIdle = useCallback(() => drawBars(() => Math.random() * 0.33 + 0.02, 0.55), [drawBars]);
  const drawPaused = useCallback(() => {
    const frozen = frozenRef.current;
    drawBars((i, n) => frozen.length ? (frozen[Math.round(i * (frozen.length - 1) / Math.max(n - 1, 1))] ?? 0.1) : 0.1, 0.5);
  }, [drawBars]);
  const drawWaveform = useCallback(() => {
    const data = waveformRef.current;
    if (!data) { drawIdle(); return; }
    drawBars((i, n) => data[Math.round(i * (data.length - 1) / Math.max(n - 1, 1))] * 0.85, 1);
  }, [drawBars, drawIdle]);

  const visualize = useCallback(() => {
    const canvas = canvasRef.current; const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    if (animRef.current) cancelAnimationFrame(animRef.current);  // never run two RAF loops
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    // Read live so a theme switch mid-recording (or just picking up the current
    // theme's accent — e.g. Default's green, which matches the outer chrome) is
    // reflected without restarting the RAF loop.
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || 'oklch(0.62 0.15 48)';
    const draw = () => {
      analyser.getByteFrequencyData(freqData);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.clearRect(0, 0, w, h);
      const n = barsForWidth(w);
      const bw = w / n, thin = Math.max(bw * 0.4, 1.5);
      const usableBins = Math.floor(freqData.length * 0.6);
      const logMax = Math.log2(usableBins);
      const frozen: number[] = [];
      for (let i = 0; i < n; i++) {
        const binIdx = Math.min(Math.round(Math.pow(2, (i / n) * logMax)), usableBins - 1);
        const val = freqData[binIdx] / 255;
        const bh = Math.max(val * h * 0.85, 2);
        frozen.push(bh / h);
        ctx.fillStyle = `color-mix(in oklch, ${accent} ${Math.round((0.3 + val * 0.7) * 100)}%, transparent)`;
        ctx.beginPath();
        ctx.roundRect(i * bw + (bw - thin) / 2, h / 2 - bh / 2, thin, bh, 1);
        ctx.fill();
      }
      frozenRef.current = frozen;
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
  }, []);

  const start = useCallback(async (deviceId?: string, templateId?: string, language?: string) => {
    try {
      setError(null);
      setStoppedData(null);
      cancelledRef.current = false;
      const rec = await api.createRecording(undefined, templateId, language);
      recIdRef.current = rec.id;
      setRecordingId(rec.id);
      // Shared, ref-counted capture (see audioCapture.ts) — the live transcript taps
      // the same stream instead of opening a second getUserMedia. The capture profile
      // (no echo cancellation / noise suppression, AGC on) lives there too.
      const stream = await acquireMic(deviceId);
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      ctxRef.current = audioCtx;
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      uploadChainRef.current = Promise.resolve();
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          const id = recIdRef.current;
          if (id && !cancelledRef.current) {
            const data = e.data;
            uploadChainRef.current = uploadChainRef.current.then(async () => {
              const buf = await data.arrayBuffer();
              try { await api.appendChunk(id, buf); }
              catch {
                // one retry, then accept the gap — better a hole than a stalled chain
                await new Promise((r) => setTimeout(r, 600));
                try { await api.appendChunk(id, buf); } catch { /* give up on this chunk */ }
              }
            });
          }
        }
      };
      recorder.onpause = () => {
        setIsPaused(true);
        if (animRef.current) cancelAnimationFrame(animRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        pausedAtRef.current = (Date.now() - startRef.current) / 1000;
        drawPaused();
      };
      recorder.onresume = () => {
        setIsPaused(false);
        startRef.current = Date.now() - pausedAtRef.current * 1000;
        timerRef.current = setInterval(() => setRecordingTime((Date.now() - startRef.current) / 1000), 100);
        visualize();
      };
      recorder.onstop = () => {
        const elapsed = (Date.now() - startRef.current) / 1000;
        const newBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setIsRecording(false);
        setIsPaused(false);
        setRecordingTime(0);
        pausedAtRef.current = 0;
        if (timerRef.current) clearInterval(timerRef.current);
        if (animRef.current) cancelAnimationFrame(animRef.current);
        audioCtx.close();
        releaseMic(stream);
        if (cancelledRef.current) {
          const id = recIdRef.current;
          recIdRef.current = null;
          if (id) api.deleteRecording(id).catch(() => {});
          drawIdle();
          return;
        }
        if (recIdRef.current) {
          const id = recIdRef.current;
          // The final ondataavailable fires before onstop, so it's already queued on the
          // chain — wait for every chunk to land before announcing the stop (the caller
          // finalizes on stoppedData, and finalize must see the complete audio.webm).
          uploadChainRef.current.then(() => {
            setStoppedData({ blob: newBlob, duration: elapsed, recordingId: id });
          });
        }
        extractWaveformData(newBlob).then((data) => { waveformRef.current = data; drawWaveform(); }).catch(() => drawIdle());
      };
      // 1s timeslice: fewer, larger chunks — less HTTP overhead and less exposure to
      // ordering issues than the old 250ms firehose, still crash-safe to the last second.
      recorder.start(1000);
      startRef.current = Date.now();
      setIsRecording(true);
      timerRef.current = setInterval(() => setRecordingTime((Date.now() - startRef.current) / 1000), 100);
      visualize();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone error');
    }
  }, [visualize, drawIdle, drawPaused, drawWaveform]);

  const pause = useCallback(() => recorderRef.current?.pause(), []);
  const resume = useCallback(() => recorderRef.current?.resume(), []);
  const stop = useCallback(() => recorderRef.current?.stop(), []);
  // Stop like `stop()`, but discard the audio and delete the draft instead of finalizing it.
  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  }, []);
  const clear = useCallback(() => {
    waveformRef.current = null;
    recIdRef.current = null;
    setStoppedData(null);
    drawIdle();
  }, [drawIdle]);

  useEffect(() => {
    drawIdle();
    const canvas = canvasRef.current;
    const ro = new ResizeObserver(() => { waveformRef.current ? drawWaveform() : (!animRef.current && drawIdle()); });
    if (canvas) ro.observe(canvas);
    return () => {
      ro.disconnect();
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [drawIdle, drawWaveform]);

  // The waveform canvas only mounts inside the recording view — start (or restart)
  // the visualizer once it's actually in the DOM, not during start() when it's null.
  useEffect(() => {
    if (isRecording && !isPaused) visualize();
  }, [isRecording, isPaused, visualize]);

  return { canvasRef, isRecording, isPaused, recordingTime, error, stoppedData, recordingId, start, pause, resume, stop, cancel, clear };
}
