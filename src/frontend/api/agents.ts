/** Agent definitions: CRUD, AI-drafted configs, run history, and manual runs. */
import type { Agent, AgentRun } from '../types';
import { j } from './http';

/** A suspended run's unanswered question/approval, durable on the backend
 *  (queue/<jobId>.pending.json) — answerable whenever via run.respond. */
export interface PendingInput {
  jobId: string;
  requestId: string;
  agentId?: string;
  agentName?: string;
  /** The pool ask this question concerns, when known — an assigned run's item, or the
   *  item whose creation woke the Lead's triage run. Lets the desk pin the question. */
  poolItemId?: string;
  frame: { type: 'ask' | 'approve'; id: string; question?: string; options?: string[]; tool?: string };
  at: string;
}

export const agentsApi = {
  listPendingInputs: () => j<PendingInput[]>('/pending-inputs'),
  listAgents: () => j<Agent[]>('/agents'),
  agentOptions: () => j<{ tools: { name: string; description: string }[]; triggers: string[]; skills: { name: string; description: string }[] }>('/agent-options'),
  generateAgent: (description: string) =>
    j<{ name: string; description: string; instructions: string; tools: string[]; triggers: string[] }>(
      '/agents/generate', { method: 'POST', body: JSON.stringify({ description }) }),
  saveAgent: (agent: Partial<Agent>) =>
    j<Agent>('/agents', { method: 'POST', body: JSON.stringify(agent) }),
  deleteAgent: (id: string) => j<{ ok: boolean }>(`/agents/${id}`, { method: 'DELETE' }),
  patchAgent: (id: string, patch: Partial<Pick<Agent, 'enabled' | 'triggers' | 'schedule' | 'surfaces'>>) =>
    j<Agent>(`/agents/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  runAgent: (id: string) => j<{ jobId: string }>(`/agents/${id}/run`, { method: 'POST' }),
  agentRuns: (id: string) => j<AgentRun[]>(`/agents/${id}/runs`),
};
