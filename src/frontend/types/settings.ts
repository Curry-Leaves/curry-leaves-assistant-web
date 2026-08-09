export interface AiModelTiers { less?: string; medium?: string; heavy?: string; smart?: string }
export interface AiProviderCfg { apiKey?: string; model?: string; clientId?: string; headers?: Record<string, string>; baseUrl?: string; tiers?: AiModelTiers; enabled?: boolean; custom?: boolean; name?: string }
/** `usage` is what the user picked in the first-run wizard (see screens/setup/steps/UsageStep):
 *  a subset of 'meetings' | 'voice' | 'knowledge' | 'agents'. */
export interface IdentityCfg { name: string; work: string; behavior: string; workingHours: string; usage: string[] }
/** In-meeting Live Copilot. Off by default — every pass is a real agent run, so it's opt-in.
 *  The Capture screen can override `enabled` for a single recording without touching this. */
export interface LiveCfg {
  enabled: boolean;
  minNewChars: number;
  cooldownSeconds: number;
  maxPasses: number;
  maxCardsPerPass: number;
}
export interface AppSettings {
  ai: { active: string; providers: Record<string, AiProviderCfg> };
  appearance: { theme: import('../theme').ThemeId };
  identity: IdentityCfg;
  live: LiveCfg;
}
