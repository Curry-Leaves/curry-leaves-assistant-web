/** App settings (AI, appearance, identity). */
import type { AppSettings, AiProviderCfg, IdentityCfg } from '../types';
import { j } from './http';

export const settingsApi = {
  getSettings: () => j<AppSettings>('/settings'),
  patchAiSettings: (patch: { active?: string; providers?: Record<string, AiProviderCfg> }) =>
    j<AppSettings>('/settings/ai', { method: 'PATCH', body: JSON.stringify(patch) }),
  patchAppearance: (patch: { theme?: string }) =>
    j<AppSettings>('/settings/appearance', { method: 'PATCH', body: JSON.stringify(patch) }),
  patchIdentity: (patch: Partial<IdentityCfg>) =>
    j<AppSettings>('/settings/identity', { method: 'PATCH', body: JSON.stringify(patch) }),
};
