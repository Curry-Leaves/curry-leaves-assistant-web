/** Audio helpers: decode to AudioBuffer, downmix to mono, and encode 16-bit WAV.
 *  Trim and "add recording" both produce a single mono WAV (avoids webm concat issues). */

export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try { return await ctx.decodeAudioData(data.slice(0)); }
  finally { ctx.close().catch(() => {}); }
}

export async function fetchAudioBuffer(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  return decodeAudio(await res.arrayBuffer());
}

function toMono(ab: AudioBuffer): Float32Array {
  if (ab.numberOfChannels === 1) return ab.getChannelData(0);
  const a = ab.getChannelData(0), b = ab.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
  return out;
}

function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const len = Math.floor(samples.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio, lo = Math.floor(pos), hi = Math.min(lo + 1, samples.length - 1);
    out[i] = samples[lo] * (1 - (pos - lo)) + samples[hi] * (pos - lo);
  }
  return out;
}

function encodeWavMono(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return buf;
}

/** Trim a region [start,end] (seconds) → mono WAV + its duration. */
export function trimToWav(ab: AudioBuffer, start: number, end: number): { wav: ArrayBuffer; duration: number } {
  const sr = ab.sampleRate;
  const mono = toMono(ab);
  const s = Math.max(0, Math.floor(start * sr));
  const e = Math.min(mono.length, Math.floor(end * sr));
  const slice = mono.subarray(s, Math.max(s, e));
  return { wav: encodeWavMono(slice, sr), duration: (slice.length) / sr };
}

/** Keep only the given regions (seconds), concatenated → one mono WAV + its duration. */
export function keepRegionsToWav(ab: AudioBuffer, regions: { start: number; end: number }[]): { wav: ArrayBuffer; duration: number } {
  const sr = ab.sampleRate;
  const mono = toMono(ab);
  const slices = [...regions]
    .sort((a, b) => a.start - b.start)
    .map((r) => mono.subarray(Math.max(0, Math.floor(r.start * sr)), Math.min(mono.length, Math.floor(r.end * sr))));
  const total = slices.reduce((n, s) => n + s.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const s of slices) { out.set(s, off); off += s.length; }
  return { wav: encodeWavMono(out, sr), duration: total / sr };
}

/** Concatenate several buffers into one mono WAV (resampling to the first's rate). */
export function concatToWav(bufs: AudioBuffer[]): { wav: ArrayBuffer; duration: number } {
  const sr = bufs[0].sampleRate;
  const monos = bufs.map((b) => (b.sampleRate === sr ? toMono(b) : resample(toMono(b), b.sampleRate, sr)));
  const total = monos.reduce((a, m) => a + m.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const m of monos) { out.set(m, off); off += m.length; }
  return { wav: encodeWavMono(out, sr), duration: total / sr };
}

/** Peak envelope for drawing a waveform (n buckets of 0..1). */
export function peaks(ab: AudioBuffer, n: number): number[] {
  const mono = toMono(ab);
  const block = Math.max(1, Math.floor(mono.length / n));
  const out: number[] = [];
  let max = 0.0001;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (let j = 0; j < block; j++) p = Math.max(p, Math.abs(mono[i * block + j] || 0));
    out.push(p); max = Math.max(max, p);
  }
  return out.map((p) => p / max);
}
