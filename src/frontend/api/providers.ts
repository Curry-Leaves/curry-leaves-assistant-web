/** AI provider connections: status, model catalogs, and OAuth flows (Copilot, Codex). */
import { j } from './http';

/** Readiness snapshot — mirrors the backend's readiness.ai_status(). `ready` is false when
 *  no provider is connected (`reason: 'no_provider'`) or none is chosen (`reason: 'no_model'`). */
export type AiStatus = { ready: boolean; provider: string; model: string; reason: '' | 'no_provider' | 'provider_disabled' | 'no_model'; detail: string };

/** A provider card's metadata, served by /providers/catalog (built-in registry + custom).
 *  `connected` (has a key / live connection) and `enabled` (the user's on-off switch) are
 *  independent: a connected provider can be switched off, and only connected AND enabled
 *  providers can actually run. Both are computed server-side — don't re-derive them. */
export type ProviderSpecDto = {
  id: string; name: string; wire: 'openai' | 'anthropic' | 'special'; keyed: boolean;
  custom: boolean; tiers: boolean; hint: string; keyPlaceholder: string; defaultModel: string; baseUrl: string;
  connected: boolean; enabled: boolean;
};

export const providersApi = {
  providerStatus: () => j<{ copilot: { connected: boolean; enabled?: boolean; models: { id: string }[] }; codex?: { connected: boolean; enabled?: boolean; configured?: boolean; clientIdEnv?: string; models: { id: string }[] }; ollama?: { connected: boolean; models: { id: string }[]; host: string; enabled?: boolean } }>('/providers/status'),
  providerModels: (provider?: string) =>
    j<{ active: string; default_model: string; models: { id: string }[] }>(`/providers/models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`),
  // Live catalog for a candidate (unsaved) API key — lets the model dropdown populate
  // as soon as a key is typed, before Connect. baseUrl is for custom OpenAI-compatible endpoints.
  previewModels: (provider: string, apiKey: string, baseUrl?: string) =>
    j<{ active: string; default_model: string; models: { id: string }[] }>(
      '/providers/models/preview', { method: 'POST', body: JSON.stringify({ provider, api_key: apiKey, base_url: baseUrl || '' }) }),
  // The provider cards to render — built-in registry + user-defined custom providers.
  // `usable` narrows it to connected AND enabled providers: what a model picker may offer.
  // Settings omits it, since a disabled provider must stay visible to be switched back on.
  providerCatalog: (usable?: boolean) =>
    j<{ providers: ProviderSpecDto[] }>(`/providers/catalog${usable ? '?usable=true' : ''}`),
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
