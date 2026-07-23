export interface AiModelTiers { less?: string; medium?: string; heavy?: string; smart?: string }
export interface AiProviderCfg { apiKey?: string; model?: string; baseUrl?: string; tiers?: AiModelTiers; enabled?: boolean; custom?: boolean; name?: string }
/** `usage` is what the user picked in the first-run wizard (see screens/setup/steps/UsageStep):
 *  a subset of 'meetings' | 'voice' | 'knowledge' | 'agents'. */
export interface IdentityCfg { name: string; work: string; behavior: string; workingHours: string; usage: string[] }
export interface AppSettings {
  ai: { active: string; providers: Record<string, AiProviderCfg> };
  appearance: { theme: import('../theme').ThemeId };
  identity: IdentityCfg;
}
