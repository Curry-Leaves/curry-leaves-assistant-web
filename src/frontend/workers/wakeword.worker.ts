/**
 * Wake-word detection: the fused openWakeWord model running off the main thread.
 *
 *   16 kHz f32 PCM [1, 31840] → wakeword_allinone.onnx → logits [1, n]
 *
 * The melspectrogram, the embedding, and the classifier are fused into one graph, so
 * this worker loads and runs a single ONNX session. Standardization is folded into the
 * graph — do NOT apply it here (the old 3-stage chain applied `x/10 + 2` by hand; the
 * fused model does it internally, and doing it twice destroys the score).
 *
 * The graph consumes a fixed ~1.99 s window (31840 samples @ 16 kHz). We keep a rolling
 * PCM ring of that length and re-run the graph every CHUNK (80 ms) of new audio — a
 * sliding window, so a phrase spoken anywhere in earshot lands inside some window.
 *
 * Runs in a Worker rather than an AudioWorklet on purpose: an allocation or GC stall on
 * the audio render thread would glitch all audio on that context — including TTS
 * playback. onnxruntime's WASM backend also wants threads/SharedArrayBuffer, which an
 * AudioWorklet scope doesn't provide.
 *
 * State (the PCM ring, the input accumulator) is deliberately module-level and persists
 * across messages: restarting per utterance would drop the tail of a phrase spanning a
 * message boundary.
 */
// The /wasm entry point, not the package root: the default build bundles the JSEP
// (WebGPU) runtime, which is ~26 MB of .wasm shipped in every wheel and Docker image
// for a feature that is off by default and only ever uses the WASM backend.
import * as ort from 'onnxruntime-web/wasm';
// Let Vite resolve and serve the .wasm binary. Left to itself, ORT fetches this path
// relative to the page, which the SPA fallback answers with index.html — the runtime
// then aborts on `expected magic word 00 61 73 6d, found 3c 21 64 6f` ("<!do"). The
// ?url import makes Vite emit the file and hand back a URL that works in dev and build.
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

// Multi-threaded ORT needs cross-origin isolation (COOP/COEP), which this app doesn't
// set and which would break the font <link>s in index.html. Single-threaded is ample —
// the whole graph is single-digit ms per 80 ms chunk.
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;
// Point the runtime at the Vite-emitted binary rather than letting it guess a path.
ort.env.wasm.wasmPaths = { wasm: wasmUrl };

const SR = 16000;
const WINDOW = 31840;     // samples the graph consumes — ~1.99 s @ 16 kHz, fixed
const CHUNK = 1280;       // 80 ms @ 16 kHz — stride between inferences

let sess: ort.InferenceSession | null = null;
let inputName = '';
let outputName = '';
let threshold = 0.5;      // fallback when a model ships no per-class thresholds

// The fused model emits raw LOGITS (unbounded, seen up to ~38), one per phrase, each
// with its own threshold from the sidecar .json. Feeding a 0.5 cutoff to logits fires
// on essentially every chunk, so per-class thresholds are load-bearing.
let thresholds: number[] | null = null;   // per-class, from the sidecar metadata
let labels: string[] = [];

// Persistent stream state.
let pending: Float32Array<ArrayBufferLike> = new Float32Array(0);  // input accumulator
let ring: Float32Array = new Float32Array(WINDOW);                  // rolling PCM window
let filled = 0;                                                     // valid samples in `ring`
let suppressed = false;
let refractoryUntil = 0;                     // chunk index; set after a fire
let chunkIx = 0;

const REFRACTORY_CHUNKS = 25;                // ~2 s — one utterance fires several chunks

function reset(): void {
  pending = new Float32Array(0);
  ring = new Float32Array(WINDOW);
  filled = 0;
}

async function init(
  model: ArrayBuffer,
  thr: number,
  meta?: { thresholds?: number[]; words?: string[] } | null,
): Promise<void> {
  // WASM explicitly: the WebGL backend fails on the melspectrogram stage inside the graph.
  const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'] };
  sess = await ort.InferenceSession.create(new Uint8Array(model), opts);
  inputName = sess.inputNames[0];
  outputName = sess.outputNames[0];
  threshold = thr;
  thresholds = meta?.thresholds?.length ? meta.thresholds : null;
  labels = meta?.words ?? [];

  reset();
  chunkIx = 0;
  refractoryUntil = 0;
  postMessage({ type: 'ready' });
}

/** Slide `add` into the fixed-length ring, dropping the oldest samples. */
function pushRing(add: Float32Array): void {
  if (add.length >= WINDOW) {
    ring.set(add.subarray(add.length - WINDOW));
    filled = WINDOW;
    return;
  }
  ring.copyWithin(0, add.length);           // shift older samples left
  ring.set(add, WINDOW - add.length);       // append the new ones at the end
  filled = Math.min(WINDOW, filled + add.length);
}

async function feed(pcm: Float32Array): Promise<void> {
  if (!sess) return;

  // The PCM tap posts ~4096 native-rate frames per callback, which after downsampling
  // to 16 kHz is a rate-dependent count (~1365 @ 48 kHz, ~1486 @ 44.1 kHz) — never a
  // multiple of 1280. Accumulate and drain in exact chunks, carrying the remainder.
  const merged = new Float32Array(pending.length + pcm.length);
  merged.set(pending);
  merged.set(pcm, pending.length);
  pending = merged;

  while (pending.length >= CHUNK) {
    const chunk = pending.slice(0, CHUNK);
    pending = pending.slice(CHUNK);
    chunkIx++;

    pushRing(chunk);
    if (filled < WINDOW) continue;   // not enough audio for a full window yet

    const out = (await sess.run({
      [inputName]: new ort.Tensor('float32', ring, [1, WINDOW]),
    }))[outputName].data as Float32Array;

    // The graph is multi-class LOGITS: each output is a class, compared against its own
    // threshold. With no sidecar (a bare user .onnx) fall back to a single 0..1 cutoff.
    let hit = -1;
    let score = out[0];
    if (thresholds) {
      for (let c = 0; c < out.length; c++) {
        if (out[c] >= (thresholds[c] ?? threshold)) { hit = c; score = out[c]; break; }
      }
    } else if (out[0] >= threshold) {
      hit = 0;
    }
    postMessage({ type: 'score', score, index: hit });

    // Suppression is re-checked here, not only at the send site: chunks queued before
    // suppression began are still in flight when it starts.
    if (!suppressed && hit >= 0 && chunkIx >= refractoryUntil) {
      refractoryUntil = chunkIx + REFRACTORY_CHUNKS;
      reset();   // the sliding window would otherwise re-fire on the next few chunks
      postMessage({ type: 'wake', score, index: hit, word: labels[hit] ?? null });
    }
  }
}

let queue: Promise<void> = Promise.resolve();

onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === 'init') {
    queue = queue.then(() => init(m.model, m.threshold ?? 0.5, m.meta))
      .catch((err) => postMessage({ type: 'error', message: String(err) }));
  } else if (m.type === 'pcm') {
    // Serialize: ORT sessions aren't reentrant and chunks must stay in order.
    queue = queue.then(() => feed(new Float32Array(m.buf)))
      .catch((err) => postMessage({ type: 'error', message: String(err) }));
  } else if (m.type === 'suppress') {
    suppressed = !!m.on;
    // Clear on suppress: the ~2 s of audio already buffered from before TTS started
    // would otherwise produce a stale detection the moment suppression lifts.
    if (suppressed) reset();
  } else if (m.type === 'threshold') {
    threshold = m.value;
  } else if (m.type === 'reset') {
    reset();
  }
};
