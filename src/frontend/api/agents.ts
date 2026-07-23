/** Agent definitions: CRUD, AI-drafted configs, run history, and manual runs. */
import type { Agent, AgentRun } from '../types';
import { j } from './http';

export const agentsApi = {
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
