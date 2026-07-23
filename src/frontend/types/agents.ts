import type { ScheduleSpec } from './schedule';

export interface Agent {
  id: string;
  name: string;
  description: string;
  provider: string | null;  // null -> use the default (active) provider
  model: string | null;
  tools: string[];
  // Registered but hidden from the model's tool list until it calls the built-in
  // search_tools and finds one by keyword — keeps a big roster's schema tokens off
  // every turn for tools that aren't needed most turns. Omit/empty = none deferred
  // (today's behavior for every existing agent).
  deferredTools: string[];
  permissions: Record<string, string>;
  maxSteps: number;
  instructions: string;
  enabled: boolean;
  internal: boolean;
  surfaces: string[];
  triggers: string[];
  subagents: string[];
  skills: string[];
  schedule: ScheduleSpec;
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'error' | null;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: 'running' | 'done' | 'failed';
  trigger: { type: string; payload?: Record<string, unknown> };
  output?: string;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  traceId?: string;
}

export interface ToolInfo {
  name: string;
  description: string;
  risk: string;
  schema: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] };
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  httpTransport?: 'http' | 'sse';
  risk: 'read' | 'write' | 'exec' | 'network';
  enabled: boolean;
  pickedTools: string[];
}

export interface McpTestResult {
  ok: boolean;
  tools?: { name: string; description: string }[];
  error?: string;
}
