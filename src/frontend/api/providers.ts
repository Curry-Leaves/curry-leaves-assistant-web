/** AI provider connections: status, model catalogs, and OAuth flows (Copilot, Codex). */
import { j } from './http';

/** Readiness snapshot — mirrors the backend's readiness.ai_status(). `ready` is false when
 *  no provider is connected (`reason: 'no_provider'`) or none is chosen (`reason: 'no_model'`). */
export type AiStatus = { ready: boolean; provider: string; model: string; reason: '' | 'no_provider' | 'no_model'; detail: string };

/** A provider card's metadata, served by /providers/catalog (built-in registry + custom). */
export type ProviderSpecDto = {
  id: string; name: string; wire: 'openai' | 'anthropic' | 'special'; keyed: boolean;
  custom: boolean; tiers: boolean; hint: string; keyPlaceholder: string; defaultModel: string; baseUrl: string;
};

export const providersApi = {
  providerStatus: () => j<{ copilot: { connected: boolean; models: { id: string }[] }; codex?: { connected: boolean; models: { id: string }[] }; ollama?: { connected: boolean; models: { id: string }[]; host: string } }>('/providers/status'),
  providerModels: (provider?: string) =>
    j<{ active: string; default_model: string; models: { id: string }[] }>(`/providers/models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`),
  // Live catalog for a candidate (unsaved) API key — lets the model dropdown populate
  // as soon as a key is typed, before Connect. baseUrl is for custom OpenAI-compatible endpoints.
  previewModels: (provider: string, apiKey: string, baseUrl?: string) =>
    j<{ active: string; default_model: string; models: { id: string }[] }>(
      '/providers/models/preview', { method: 'POST', body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl || '' }) }),
  // The provider cards to render — built-in registry + user-defined custom providers.
  providerCatalog: () =>
    j<{ providers: ProviderSpecDto[] }>('/providers/catalog'),
  // Can a run actually start now? Fetched on mount to seed the warning banner; live
  // updates then arrive via the `system.ai.status` event.
  aiStatus: () => j<AiStatus>('/providers/ai-status'),
  copilotStart: () => j<{ device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number }>('/providers/copilot/start', { method: 'POST' }),
  copilotPoll: (deviceCode: string) =>
    j<{ status: 'pending' | 'slow_down' | 'connected' | 'error'; interval?: number; models?: { id: string }[]; error?: string }>(
      '/providers/copilot/poll', { method: 'POST', body: JSON.stringify({ device_code: deviceCode }) }),
  copilotDisconnect: () => j<{ ok: boolean }>('/providers/copilot/disconnect', { method: 'POST' }),
  codexStart: () => j<{ auth_url?: string; state?: string; expires_in?: number; status?: 'error'; error?: string }>('/providers/codex/start', { method: 'POST' }),
  codexPoll: (state: string) =>
    j<{ status: 'pending' | 'connected' | 'error'; models?: { id: string }[]; error?: string }>(
      '/providers/codex/poll', { method: 'POST', body: JSON.stringify({ state }) }),
  codexDisconnect: () => j<{ ok: boolean }>('/providers/codex/disconnect', { method: 'POST' }),
};
