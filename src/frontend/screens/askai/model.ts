import type { ChatAttachment, ChatReference, SessionTask } from '../../types';

// ─── model ────────────────────────────────────────────────────────────────────
export interface ToolCall { id: string; name: string; input?: string; output?: string; status: 'running' | 'done' | 'error'; tokensIn?: number; tokensOut?: number }
// One step of a delegated subagent's work, nested under the tool call that spawned it.
// `parent` is that delegating tool_call_id; `agent` names the subagent doing the work.
// A 'thinking' step carries `text` instead of tool I/O — the subagent's reasoning between
// its calls, so a delegation reads as a real timeline rather than a bare list of tools.
export interface SubStep {
  id: string; depth: number; parent?: string; agent?: string;
  kind: 'tool' | 'thinking';
  name: string; text?: string; input?: string; output?: string;
  status: 'running' | 'done' | 'error';
}
// The order a turn's work actually happened in: thinking segments interleaved with tool
// calls (thought → tool → thought → tool…). Tool parts reference m.tools entries by id so
// later tool_end updates show through; m.thinking stays as the concatenated whole.
export type TrailPart = { kind: 'thinking'; text: string } | { kind: 'tool'; id: string };
export interface ActionCard { kind: 'todo' | 'reminder'; title: string; meta?: string }
export interface ElisionNote { resultsElided: number; tokensReclaimed: number }
export interface ChatMsg { role: 'user' | 'assistant'; content: string; thinking?: string; tools?: ToolCall[]; trail?: TrailPart[]; subs?: SubStep[]; usage?: { input: number; output: number; context?: number; limit?: number; model?: string; elapsedMs?: number }; compacted?: boolean; attachments?: ChatAttachment[]; references?: ChatReference[]; action?: ActionCard; elision?: ElisionNote }
export interface PendingReq { id: string; kind: 'ask' | 'approve'; tool?: string; args?: unknown; risk?: string; question?: string; options?: string[] }
// A steer/follow-up message sent mid-run, sitting in the queue chip until the backend's
// picked_up event confirms the runner actually folded it into the conversation.
export interface QueuedMsg { queueId: string; text: string; mode: 'steer' | 'follow_up' }
export type ThinkingEffort = 'off' | 'minimal' | 'low' | 'medium' | 'high';
export interface Active { id: string | null; agentId: string; model: string; messages: ChatMsg[]; runId?: string; pending?: PendingReq | null; queue?: QueuedMsg[]; tasks?: SessionTask[] }

// ─── live runs, per session ───────────────────────────────────────────────────
// A chat run outlives the view of it: the backend never cancels on disconnect, so switching
// sessions, reloading, or opening a second tab all leave it streaming. This is the client's
// record of those runs, keyed by sessionId and held OUTSIDE the on-screen `Active` — the
// screen renders one session, but every live run keeps accumulating into its own entry.
//
// `messages` is the run's own copy of the thread. On switching back we render from here
// rather than refetching, so an in-flight turn shows its partial text; the transcript on
// disk only gains the assistant message when the turn ends (the kernel records at
// MessageEnd — token deltas are never persisted), so a refetch mid-run would show a gap.
export interface LiveRun {
  runId: string;
  sessionId: string;
  // (Frame de-dup / replay cursors live in socket.ts, which tracks lastSeq per subscriber.)
  /** Detach from the frame stream (does NOT stop the run on the backend). */
  detach: () => void;
  /** True while this client only watches a run it didn't start (composer stays read-only). */
  mirror: boolean;
  messages: ChatMsg[];
  pending?: PendingReq | null;
  queue?: QueuedMsg[];
  tasks?: SessionTask[];
}
