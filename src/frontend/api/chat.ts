/**
 * Interactive chat. Session CRUD + file attach + compaction are lightweight HTTP; the
 * live chat itself (start a turn, deltas, approvals, steer/stop) is fully over the shared
 * WebSocket (see api/socket.ts) so a client needs only one connection. `startChat` returns
 * {sessionId, runId} and auto-subscribes; the caller then reads frames via socket.subChat.
 */
import type { ChatSessionMeta, ChatServerMsg, ChatAttachment, ChatReference, SessionTask } from '../types';
import { authHeader } from '../auth';
import { base, j } from './http';
import { request } from './socket';

export type ChatStartBody = {
  agentId: string;
  message: string;
  sessionId?: string | null;
  model?: string;
  history?: { role: string; content: string }[];
  ephemeral?: boolean;
  attachments?: string[];
  references?: ChatReference[];
  thinkingEffort?: string | null;
  autonomous?: boolean;
  elide?: boolean;
  /** Where the turn came from. 'voice' keeps a real session but hides it from the chat list. */
  surface?: 'chat' | 'voice';
};

export const chatApi = {
  listSessions: () => j<ChatSessionMeta[]>('/sessions'),
  // {sessionId: runId} for runs streaming right now — how the client rediscovers a live run
  // it has no local handle on (after a switch away, a reload, or in a second tab).
  liveRuns: () => j<Record<string, string>>('/sessions/live-runs'),
  sessionMessages: (id: string) => j<ChatServerMsg[]>(`/sessions/${id}/messages`),
  sessionTasks: (id: string) => j<SessionTask[]>(`/sessions/${id}/tasks`),
  deleteSession: (id: string) => j(`/sessions/${id}`, { method: 'DELETE' }),
  forkSession: (id: string, uptoTurn: number | null) =>
    j<{ sessionId: string }>(`/sessions/${id}/fork`, { method: 'POST', body: JSON.stringify({ uptoTurn }) }),
  attachFile: async (
    file: File,
    opts: { agentId: string; sessionId?: string | null; model?: string },
  ): Promise<{ sessionId: string; file: ChatAttachment }> => {
    const q = new URLSearchParams({ agentId: opts.agentId, filename: file.name });
    if (opts.sessionId) q.set('sessionId', opts.sessionId);
    if (opts.model) q.set('model', opts.model);
    const res = await fetch((await base()) + `/sessions/attach?${q.toString()}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeader() }, body: await file.arrayBuffer(),
    });
    if (!res.ok) throw new Error(`/sessions/attach → ${res.status}`);
    return res.json();
  },
  compact: (sessionId: string, agentId: string) =>
    j<{ summary: string; tokensSaved: number }>('/compact', { method: 'POST', body: JSON.stringify({ sessionId, agentId }) }),

  // ─── live chat over WS ───────────────────────────────────────────────────────
  startChat: (body: ChatStartBody) =>
    request<{ sessionId: string | null; runId: string }>('chat.start', body as Record<string, unknown>),
  respondChat: (body: { runId: string; requestId: string; approved?: boolean; answer?: string; tool?: string; scope?: 'once' | 'session' | 'always' }) =>
    request<{ resolved: boolean }>('chat.respond', body),
  stopChat: (runId: string) => request('chat.stop', { runId }),
  steerChat: (runId: string, message: string, mode: 'steer' | 'follow_up', queueId: string,
              references: ChatReference[] = []) =>
    request('chat.steer', { runId, message, mode, queueId, references }),
  cancelPending: (runId: string, queueId: string) =>
    request<{ cancelled: boolean }>('chat.cancelPending', { runId, queueId }),

  // ─── control a BACKGROUND run (tile / trigger / workflow) by its jobId ─────────
  // Same shapes as the chat.* controls; the id is a jobId (= the run's channel).
  respondRun: (body: { jobId: string; requestId: string; approved?: boolean; answer?: string; scope?: 'once' | 'session' | 'always' }) =>
    request<{ resolved: boolean }>('run.respond', body),
  stopRun: (jobId: string) => request('run.stop', { jobId }),
  steerRun: (jobId: string, message: string, mode: 'steer' | 'follow_up', queueId: string) =>
    request('run.steer', { jobId, message, mode, queueId }),
  cancelRunPending: (jobId: string, queueId: string) =>
    request<{ cancelled: boolean }>('run.cancelPending', { jobId, queueId }),
};
