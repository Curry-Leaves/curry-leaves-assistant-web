import { authHeader } from '../auth';
import { base, j } from './http';

/** Sidecar metadata for a fused model (`<file>.json`): the phrase labels and the
 *  per-class thresholds its logits are compared against. */
export type WakeHeadMeta = {
  words: string[];
  thresholds: number[];
  nClasses: number | null;
  window: number | null;
};

export type WakeHead = {
  id: string;
  label: string;
  file: string;
  /** Sidecar filename (`<file>.json`), or null when the model ships no metadata. */
  sidecar: string | null;
  builtin: boolean;
  downloaded: boolean;
  meta: WakeHeadMeta | null;
};

/** The settable half of the wake-word config. */
export type WakeWordPatch = {
  enabled: boolean;
  active: string;
  threshold: number;
  /** Read the answer aloud. Off = the panel shows it silently. */
  speak: boolean;
  /** Hide the answer panel on its own once the exchange ends. */
  autoDismiss: boolean;
  dismissAfterMs: number;
  /** Kokoro voice id; '' means the model's default. */
  voice: string;
  /** Quiet gap that marks the end of your question. */
  silenceMs: number;
  /**
   * Whether handing work to a background agent needs a spoken "yes" first.
   * 'confirm' speaks the handoff back and waits; 'auto' queues it silently. Gates the
   * handoff only — the background job itself always runs headlessly.
   */
  workApproval: 'confirm' | 'auto';
};

export type WakeWordConfig = WakeWordPatch & {
  available: boolean;
  heads: WakeHead[];
  activeHead: WakeHead | null;
  voices: string[];
  defaultVoice: string;
  ttsAvailable: boolean;
};

export const getWakeWord = () => j<WakeWordConfig>('/wakeword');

/**
 * Listeners for a config change. The live listener runs in App.tsx while the editor is in
 * Settings — both are mounted at once (screens are keep-alive tabs), so waiting for a tab
 * switch to re-read left the running assistant on stale settings: turning speech or the
 * wake word off appeared to do nothing until a reload.
 */
const _watchers = new Set<(cfg: WakeWordConfig) => void>();

export function onWakeWordChange(fn: (cfg: WakeWordConfig) => void): () => void {
  _watchers.add(fn);
  return () => { _watchers.delete(fn); };
}

export const patchWakeWord = async (patch: Partial<WakeWordPatch>) => {
  const cfg = await j<WakeWordConfig>('/wakeword', { method: 'PATCH', body: JSON.stringify(patch) });
  _watchers.forEach((fn) => fn(cfg));
  return cfg;
};

export const downloadWakeWord = (head?: string) =>
  j<WakeWordConfig & { error?: string }>('/wakeword/download', {
    method: 'POST',
    body: JSON.stringify({ head: head ?? null }),
  });

/**
 * Fetch one .onnx as raw bytes for the detection worker.
 *
 * Deliberately not left to onnxruntime's own URL loading: the models route is
 * authenticated, ORT can't attach an Authorization header, and the alternative
 * (a `?token=` query param) would put a bearer token in fetch logs.
 */
export async function fetchWakeModel(file: string): Promise<ArrayBuffer> {
  const r = await fetch(`${await base()}/wakeword/models/${encodeURIComponent(file)}`, {
    headers: { ...authHeader() },
  });
  if (!r.ok) throw new Error(`wake model ${file}: HTTP ${r.status}`);
  return r.arrayBuffer();
}
