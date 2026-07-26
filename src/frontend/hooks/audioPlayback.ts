/**
 * Gapless streaming playback of TTS PCM chunks (the chat Voice button's speech).
 *
 * `speak()` (api/socket) streams float32 PCM chunks from the backend Kokoro synth as they're
 * generated. A TtsPlayer schedules each chunk back-to-back on a single AudioContext timeline so
 * they play without gaps or overlap, even though they arrive irregularly. Kokoro emits 24 kHz;
 * the AudioContext resamples on playback, so we honor whatever sampleRate the backend reports.
 */

type AudioCtxCtor = typeof AudioContext;

export class TtsPlayer {
  private ctx: AudioContext | null = null;
  private nextStart = 0; // absolute ctx time where the next chunk should begin
  private sources = new Set<AudioBufferSourceNode>();
  private stopped = false;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor: AudioCtxCtor =
        window.AudioContext || (window as unknown as { webkitAudioContext: AudioCtxCtor }).webkitAudioContext;
      this.ctx = new Ctor();
    }
    this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Queue one PCM chunk (mono float32 at `sampleRate`) for gapless playback. */
  enqueue(pcm: Float32Array, sampleRate: number): void {
    if (this.stopped || pcm.length === 0) return;
    const ctx = this.ensureCtx();
    const buf = ctx.createBuffer(1, pcm.length, sampleRate);
    buf.getChannelData(0).set(pcm);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    // Schedule right after whatever's already queued; if we've fallen behind (queue drained),
    // start slightly in the future so the source doesn't get clipped by scheduling in the past.
    const now = ctx.currentTime;
    const start = Math.max(this.nextStart, now + 0.02);
    src.start(start);
    this.nextStart = start + buf.duration;
    this.sources.add(src);
    src.onended = () => { this.sources.delete(src); };
  }

  /** True while audio is still scheduled to play. */
  get playing(): boolean {
    return this.sources.size > 0;
  }

  /** Stop everything immediately (barge-in / cancel) and reset the timeline. */
  stop(): void {
    this.stopped = true;
    for (const src of this.sources) { try { src.stop(); } catch { /* already stopped */ } }
    this.sources.clear();
    this.nextStart = 0;
  }

  /** Release the AudioContext. */
  close(): void {
    this.stop();
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
  }
}
