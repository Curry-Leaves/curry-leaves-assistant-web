/** Event history (HTTP), traces, and the usage ledger. The LIVE event feed now rides the
 *  shared WebSocket in api/socket.ts — subscribeEvents just delegates to it. */
import type { AppEvent, TraceSummary, TraceSpan, UsageSummary } from '../types';
import { j } from './http';
import { onEvents } from './socket';

export const systemApi = {
  /** Liveness probe for the boot connection gate. Public (no token), so it also answers
   *  before a PIN exists. Rejects — with no retry — if the backend can't be reached. */
  health: () => j<{ ok: boolean }>('/health'),

  recentEvents: (limit = 50) => j<AppEvent[]>(`/events/recent?limit=${limit}`),

  // Optional runtime features the UI gates on (e.g. `tts` = Kokoro voice available).
  capabilities: () => j<{ tts: boolean; wakeWord: boolean; fileBrowse: boolean }>(`/capabilities`),

  // Traces
  listTraces: (limit = 50) => j<TraceSummary[]>(`/traces?limit=${limit}`),
  getTrace: (id: string) => j<{ traceId: string; spans: TraceSpan[] }>(`/traces/${id}`),
  deleteTrace: (id: string) => j<{ ok: boolean }>(`/traces/${id}`, { method: 'DELETE' }),

  // Token usage
  getUsage: (days?: number) => j<UsageSummary>(`/usage${days ? `?days=${days}` : ''}`),
};

/**
 * Subscribe to the live event feed. Returns an unsubscribe fn. Kept as an async-returning
 * signature so existing callers (useEvents) don't change; the shared WebSocket in
 * api/socket.ts owns the one connection, reconnection, and gap replay.
 */
export async function subscribeEvents(onEvent: (e: unknown) => void): Promise<() => void> {
  return onEvents(onEvent);
}
