/**
 * Shared mic-capture plumbing for the recorder, live transcript, and dictation.
 *
 * - acquireMic()/releaseMic(): one ref-counted getUserMedia stream per device, so the
 *   recorder and the live transcript (which run simultaneously during a meeting) share
 *   a single capture instead of opening two — one permission hit, one mic indicator,
 *   and no device contention on platforms that dislike double-open.
 * - createPcmTap(): taps a stream as 16 kHz mono Float32 PCM via an AudioWorkletNode
 *   (ScriptProcessorNode is deprecated), falling back to ScriptProcessor where
 *   worklets are unavailable. The worklet ships inline as a Blob module so no extra
 *   asset needs to be served.
 */

// ─── shared mic stream (ref-counted per device) ─────────────────────────────────

// Chrome's call-oriented defaults (echo cancellation + noise suppression) attenuate
// soft speech and cancel meeting audio playing through speakers — wrong trade-off for
// recording/transcription. AGC stays on to normalize the level.
const CAPTURE_CONSTRAINTS = { echoCancellation: false, noiseSuppression: false, autoGainControl: true };

type SharedMic = { stream: MediaStream; key: string; refs: number };
let _mic: SharedMic | null = null;

const micKey = (deviceId?: string) => deviceId || 'default';

/** Get (or share) the capture stream for a device. Pair every call with releaseMic(). */
export async function acquireMic(deviceId?: string): Promise<MediaStream> {
  const key = micKey(deviceId);
  if (_mic && _mic.key === key && _mic.stream.getTracks().some((t) => t.readyState === 'live')) {
    _mic.refs++;
    return _mic.stream;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), ...CAPTURE_CONSTRAINTS },
  });
  _mic = { stream, key, refs: 1 };
  return stream;
}

/** Drop a reference; the tracks stop only when the last user releases. */
export function releaseMic(stream: MediaStream): void {
  if (_mic && _mic.stream === stream) {
    _mic.refs--;
    if (_mic.refs > 0) return;
    _mic = null;
  }
  stream.getTracks().forEach((t) => t.stop());
}

// ─── 16 kHz PCM tap (AudioWorklet, ScriptProcessor fallback) ────────────────────

// Accumulates the engine's 128-frame blocks to ~4096 frames per post — the same
// cadence the old ScriptProcessor delivered, so the WS framing downstream is unchanged.
const WORKLET_SRC = `
class PcmTapProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._bufs = []; this._len = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      this._bufs.push(new Float32Array(ch));
      this._len += ch.length;
      if (this._len >= 4096) {
        const out = new Float32Array(this._len);
        let o = 0;
        for (const b of this._bufs) { out.set(b, o); o += b.length; }
        this.port.postMessage(out, [out.buffer]);
        this._bufs = []; this._len = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTapProcessor);
`;

export type PcmTap = { close: () => void };

/** Tap `stream` and deliver 16 kHz mono Float32 PCM buffers to `onPcm16k`. */
export async function createPcmTap(stream: MediaStream, onPcm16k: (buf: ArrayBuffer) => void): Promise<PcmTap> {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx: AudioContext = new AudioCtx();
  ctx.resume().catch(() => {});
  const rate = ctx.sampleRate;
  const src = ctx.createMediaStreamSource(stream);

  // Linear-interpolation downsample to the 16 kHz the transcription backend expects.
  const downsample = (pcm: Float32Array) => {
    const ratio = rate / 16000;
    const outLen = Math.floor(pcm.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio, lo = Math.floor(pos), hi = Math.min(lo + 1, pcm.length - 1);
      out[i] = pcm[lo] * (1 - (pos - lo)) + pcm[hi] * (pos - lo);
    }
    onPcm16k(out.buffer);
  };

  let node: AudioNode;
  if (ctx.audioWorklet) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const worklet = new AudioWorkletNode(ctx, 'pcm-tap', {
      numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit',
    });
    worklet.port.onmessage = (e) => downsample(e.data as Float32Array);
    src.connect(worklet);
    node = worklet;
  } else {
    // Deprecated path, kept only for browsers without AudioWorklet.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => downsample(e.inputBuffer.getChannelData(0));
    src.connect(proc);
    proc.connect(ctx.destination); // SPN needs an output to fire in Chrome
    node = proc;
  }

  return {
    close: () => {
      try { node.disconnect(); } catch { /* already gone */ }
      try { src.disconnect(); } catch { /* already gone */ }
      ctx.close().catch(() => {});
    },
  };
}
