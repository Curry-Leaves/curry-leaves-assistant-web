/** Agent tool configuration and external MCP servers. */
import type { ToolInfo, McpServerConfig, McpTestResult } from '../types';
import { j } from './http';

export const toolsApi = {
  listTools: () => j<ToolInfo[]>('/tools'),
  patchTool: (name: string, patch: { enabled?: boolean; config?: Record<string, unknown> }) =>
    j<{ enabled?: boolean; config?: Record<string, unknown> }>(`/tools/${name}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // MCP servers
  listMcpServers: () => j<McpServerConfig[]>('/mcp/servers'),
  testMcpServer: (cfg: Partial<McpServerConfig>) => j<McpTestResult>('/mcp/servers/test', { method: 'POST', body: JSON.stringify(cfg) }),
  saveMcpServer: (cfg: Partial<McpServerConfig>) => j<McpServerConfig>('/mcp/servers', { method: 'POST', body: JSON.stringify(cfg) }),
  patchMcpServer: (name: string, patch: { pickedTools?: string[]; enabled?: boolean }) =>
    j<McpServerConfig>(`/mcp/servers/${encodeURIComponent(name)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteMcpServer: (name: string) => j<{ ok: boolean }>(`/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' }),
};
