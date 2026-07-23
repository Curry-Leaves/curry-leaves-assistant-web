export interface AppEvent {
  id: string;
  type: string;
  occurredAt: string;
  entityId: string | null;
  label: string | null;
  payload: Record<string, unknown>;
}

// ─── Work Kernel live view (the dashboard Work panel) ───────────────────────
export interface KernelJob {
  id: string;
  kind: string;                 // "agent" | "tile"
  agentId: string | null;
  lane: string;                 // scheduler lane (kb / tiles / general)
  band: number;                 // priority band: 0 interactive · 1 event · 2 background
  state: 'running' | 'queued' | 'dead';
  attempts: number;
  autonomy: string;             // "auto" | "ask"
  correlationId: string | null;
  traceId: string | null;
  triggerType: string | null;
  createdAt: string | null;
  startedAt: string | null;
  deadReason: string | null;
}
export interface KernelSnapshot {
  running: KernelJob[];
  queued: KernelJob[];
  dead: KernelJob[];
  counts: { running: number; queued: number; dead: number };
  at: string;
}

export type SpanKind = 'action' | 'session' | 'event' | 'agent_run' | 'subagent_run' | 'llm_turn' | 'tool_call' | 'approval' | 'ask';
export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  kind: SpanKind;
  name: string;
  status: 'running' | 'ok' | 'error';
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  attributes?: Record<string, unknown>;
  error?: string;
}
export interface TraceSummary {
  traceId: string;
  rootName: string;
  rootKind: SpanKind;
  rootType?: string;
  agentId?: string;
  startedAt: string;
  durationMs?: number;
  tokensIn?: number;   // cumulative prompt tokens across every LLM call (cost, not context size)
  tokensOut?: number;
  peakContext?: number; // largest single call's input = context high-water mark
  status: 'running' | 'ok' | 'error';
  spanCount: number;
}

export interface UsageRow { key: string; calls: number; tokensIn: number; tokensOut: number; cacheRead?: number; cacheWrite?: number; costUsd: number }
export interface UsageSummary {
  total: { calls: number; tokensIn: number; tokensOut: number; cacheRead?: number; cacheWrite?: number; costUsd: number };
  byModel: UsageRow[];
  byAgent: UsageRow[];
  bySurface: UsageRow[];
  byDay: UsageRow[];
}
