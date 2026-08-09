import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import type { AppSettings, AiModelTiers } from '../../types';
import type { ProviderSpecDto } from '../../api/providers';
import { SHeader } from './primitives';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TIERS: { id: keyof AiModelTiers; label: string }[] = [
  { id: 'less', label: 'Less Effort' },
  { id: 'medium', label: 'Medium Effort' },
  { id: 'heavy', label: 'Heavy Effort' },
  { id: 'smart', label: 'Smart' },
];

/** Per-provider "effort tier → model id" pickers. Each tier is independently optional;
 *  an unset tier just means callers resolving that tier fall back to the provider's
 *  default model. Reuses the dropdown-with-custom-text pattern from AgentForm's model picker. */
function TierPicker({ tiers, models, onSave }: {
  tiers: AiModelTiers;
  models: { id: string }[];
  onSave: (next: AiModelTiers) => void;
}) {
  const [custom, setCustom] = useState<Partial<Record<keyof AiModelTiers, boolean>>>({});

  const setTier = (id: keyof AiModelTiers, value: string) => onSave({ ...tiers, [id]: value });

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {TIERS.map((t) => {
        const value = tiers[t.id] || '';
        const isCustom = custom[t.id] || (!!value && !models.some((m) => m.id === value));
        return (
          <label key={t.id} className="flex items-center gap-2">
            <span className="text-[11px] text-ink3 w-[92px] flex-none">{t.label}</span>
            {isCustom ? (
              <input value={value} onChange={(e) => setTier(t.id, e.target.value)} placeholder="model id" autoFocus={custom[t.id]}
                onBlur={() => { if (!value) setCustom((c) => ({ ...c, [t.id]: false })); }}
                className="flex-1 min-w-0 h-[26px] px-2 rounded-[5px] border border-border bg-bg text-ink text-[11.5px] font-mono outline-none" />
            ) : (
              <div className="relative flex-1 min-w-0">
                <select value={value} title={t.label}
                  onChange={(e) => { if (e.target.value === '__custom__') { setCustom((c) => ({ ...c, [t.id]: true })); setTier(t.id, ''); } else setTier(t.id, e.target.value); }}
                  className="w-full appearance-none h-[26px] pl-2 pr-6 rounded-[5px] border border-border bg-bg text-ink text-[11.5px] font-mono outline-none cursor-pointer">
                  <option value="">Not set</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                  <option value="__custom__">Custom…</option>
                </select>
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink3 rotate-90"><Icon name="chevR" size={11} /></span>
              </div>
            )}
          </label>
        );
      })}
    </div>
  );
}

// ─── AI providers ─────────────────────────────────────────────────────────────
// Keyed + custom providers are rendered entirely from the backend /providers/catalog
// (the registry). Only the three special OAuth/local cards keep local display metadata,
// since their connect flows (device-code / local probe) are bespoke.
const SPECIAL_META: Record<string, { name: string; modelPh: string; hint: string }> = {
  copilot: { name: 'GitHub Copilot', modelPh: '', hint: 'Uses your GitHub Copilot subscription. Sign in once via the smart-loop CLI (`sloop`).' },
  codex: { name: 'OpenAI Codex', modelPh: '', hint: 'Uses your ChatGPT (Codex) subscription — sign in with your OpenAI account, no API key.' },
  ollama: { name: 'Ollama (local)', modelPh: 'llama3.1', hint: 'Runs models locally via Ollama — no API key, nothing leaves your machine. Install from ollama.com and `ollama pull` a model.' },
};

/** The per-provider on/off switch, shown on every connected card.
 *
 *  Distinct from Disconnect: disabling parks a provider without touching its credentials, so
 *  switching it back on is one click rather than pasting a key or redoing an OAuth flow. A
 *  disabled provider is excluded from the agent/chat pickers and refused at run time, so this
 *  is the switch that actually stops a provider being used. */
function EnableSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none" title={enabled ? 'Turn this provider off — agents and chat stop using it, but its connection is kept' : 'Turn this provider back on'}>
      <button type="button" role="switch" aria-checked={enabled} aria-label="Provider enabled"
        onClick={() => onChange(!enabled)}
        className={`relative w-[30px] h-[17px] rounded-full transition-colors flex-none ${enabled ? 'bg-accent' : 'bg-border'}`}>
        <span className={`absolute top-0.5 w-[13px] h-[13px] rounded-full bg-white shadow transition-all ${enabled ? 'left-[15px]' : 'left-0.5'}`} />
      </button>
      <span className="text-[11.5px] text-ink3">{enabled ? 'On' : 'Off'}</span>
    </label>
  );
}

/** The "connected but switched off" notice, shown in place of a disabled card's controls. */
function DisabledNote({ name }: { name: string }) {
  return (
    <div className="text-[11.5px] text-ink3 leading-relaxed">
      {name} is connected but turned off — agents and chat won't use it, and it's hidden from the
      model pickers. Switch it back on above to use it again.
    </div>
  );
}

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative flex-1">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-[30px] px-2.5 pr-12 rounded-[6px] border border-border bg-bg text-ink text-[12px] font-mono outline-none"
      />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-1 top-1 h-[22px] px-2 text-[10px] font-mono text-ink3">
        {show ? 'hide' : 'show'}
      </button>
    </div>
  );
}

/** Keyed provider (any registry entry or user-defined custom endpoint). Two states, like
 *  the OAuth cards: NOT connected → key field + "Connect" (saves the key AND pulls the live
 *  model list); connected → Connected badge + Disconnect, model dropdown from the pulled
 *  catalog, and effort tiers. Fully spec-driven — no hardcoded provider knowledge. */
function ProviderCard({ spec, cfg, active, enabled, onSave, onUse, onDisconnect, onRemove, onToggle }: {
  spec: ProviderSpecDto;
  cfg: { apiKey?: string; model?: string; baseUrl?: string; tiers?: AiModelTiers };
  active: boolean;
  enabled: boolean;
  onSave: (next: { apiKey?: string; model?: string; tiers?: AiModelTiers; enabled?: boolean }) => Promise<void>;
  onUse: () => void;
  onDisconnect: () => Promise<void>;
  onRemove?: () => Promise<void>;  // custom providers only — delete the card entirely
  onToggle: (v: boolean) => Promise<void>;
}) {
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState('');

  // A custom endpoint's base URL comes from its saved cfg (built-ins have it baked into the spec).
  const baseUrl = spec.custom ? (cfg.baseUrl || spec.baseUrl) : spec.baseUrl;
  const connected = !!cfg.apiKey;

  // Once connected AND enabled, pull the provider's live catalog (falls back to a curated list
  // server-side). A disabled provider's /providers/models returns an empty catalog, so skip the
  // round trip rather than rendering an empty dropdown behind the disabled notice.
  useEffect(() => {
    if (!connected || !enabled) { setModels([]); setDefaultModel(''); return; }
    let alive = true;
    setLoadingModels(true);
    api.providerModels(spec.id)
      .then((r) => { if (alive) { setModels(r.models); setDefaultModel(r.default_model || ''); } })
      .catch(() => { if (alive) setModels([]); })
      .finally(() => { if (alive) setLoadingModels(false); });
    return () => { alive = false; };
  }, [spec.id, connected, enabled]);

  // Connect = persist the key AND pull models. One click connects.
  const connect = async () => {
    const key = apiKey.trim();
    if (!key) return;
    setError(''); setConnecting(true);
    try {
      // Validate + pull before persisting, so a bad key surfaces here rather than silently
      // saving a dead connection.
      const r = await api.previewModels(spec.id, key, baseUrl);
      // `enabled` rides along: reconnecting a provider the user had switched off means they
      // want it back, and landing on a connected-but-off card would just be confusing.
      await onSave({ apiKey: key, enabled: true });
      setModels(r.models); setDefaultModel(r.default_model || '');
      setApiKey('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setConnecting(false);
    }
  };
  const disconnect = async () => { setModels([]); setDefaultModel(''); await onDisconnect(); };

  const model = cfg.model || '';
  const isCustom = custom || (!!model && models.length > 0 && !models.some((m) => m.id === model));

  return (
    <div className={`rounded-[10px] border p-4 h-full ${active ? 'border-accent bg-accent-soft/30' : 'border-border bg-card'} ${connected && !enabled ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`w-2 h-2 rounded-full ${connected && enabled ? 'bg-ok' : 'bg-ink3'}`} />
        <span className="text-[14px] font-550 text-ink flex-1">{spec.name}{spec.custom && <span className="ml-1.5 text-[10px] font-500 text-ink3">custom</span>}</span>
        {active ? (
          <span className="text-[10px] font-600 text-white bg-accent px-2 py-0.5 rounded-full">default</span>
        ) : (
          <button type="button" onClick={onUse} disabled={!connected || !enabled}
            className="text-[11.5px] px-2.5 py-1 rounded-[6px] border border-border text-ink2 hover:border-ink3 disabled:opacity-40">
            Set as default
          </button>
        )}
      </div>
      <p className="text-[11.5px] text-ink3 mb-3 leading-relaxed">{spec.hint}{spec.custom && baseUrl ? ` · ${baseUrl}` : ''}</p>

      {connected ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 text-[12.5px] text-ink2">
            <span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${enabled ? 'bg-ok' : 'bg-ink3'}`} />
              {enabled ? `Connected · ${models.length} model${models.length === 1 ? '' : 's'}` : 'Connected · off'}</span>
            <EnableSwitch enabled={enabled} onChange={onToggle} />
            <button type="button" onClick={disconnect} className="text-[11.5px] px-2.5 py-1 rounded-[6px] border border-border text-ink2 hover:border-ink3 ml-auto">Disconnect</button>
          </div>
          {!enabled && <DisabledNote name={spec.name} />}
          {enabled && <>
          <label className="flex items-center gap-3">
            <span className="text-[12px] text-ink2 w-[80px]">Model</span>
            {/* Populated from the catalog pulled at connect. Custom… → free-text escape hatch. */}
            {!isCustom ? (
              <div className="relative flex-1 min-w-0">
                <select value={model} title="Model" disabled={loadingModels && models.length === 0}
                  onChange={(e) => { if (e.target.value === '__custom__') { setCustom(true); onSave({ model: '' }); } else onSave({ model: e.target.value }); }}
                  className={`w-full appearance-none h-[30px] pl-2.5 pr-6 rounded-[6px] border bg-bg text-[12px] font-mono outline-none cursor-pointer ${model ? 'border-border text-ink' : 'border-rec text-rec'}`}>
                  <option value="" disabled>{loadingModels && models.length === 0 ? 'Loading models…' : 'Select a model…'}</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.id}{m.id === defaultModel ? ' (default)' : ''}</option>)}
                  <option value="__custom__">Custom…</option>
                </select>
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink3 rotate-90"><Icon name="chevR" size={11} /></span>
              </div>
            ) : (
              <input value={model} onChange={(e) => onSave({ model: e.target.value })} placeholder={spec.defaultModel || 'model id'}
                onBlur={() => { if (!model) setCustom(false); }}
                className="flex-1 min-w-0 h-[30px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12px] font-mono outline-none" />
            )}
          </label>
          {!model && (
            <div className="text-[11.5px] text-rec">Select a default model — agents and chat can't run until you pick one.</div>
          )}
          {spec.tiers && (
            <div className="pt-2 mt-1 border-t border-border">
              <div className="text-[11px] text-ink3 mb-2">Effort tiers <span className="text-ink3/70">— optional model overrides other features can pick from</span></div>
              <TierPicker tiers={cfg.tiers || {}} models={models} onSave={(tiers) => onSave({ tiers })} />
            </div>
          )}
          </>}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-3">
            <span className="text-[12px] text-ink2 w-[80px]">API key</span>
            <SecretInput value={apiKey} onChange={setApiKey} placeholder={spec.keyPlaceholder} />
          </label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={connect} disabled={connecting || !apiKey.trim()}
              className="h-[30px] px-3 rounded-[6px] bg-accent text-white text-[12px] font-550 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Icon name="sparkle" size={13} /> {connecting ? 'Connecting…' : 'Connect'}
            </button>
            {onRemove && (
              <button type="button" onClick={onRemove} className="h-[30px] px-2.5 rounded-[6px] border border-border text-[11.5px] text-ink3 hover:border-rec hover:text-rec">Remove</button>
            )}
          </div>
          {error && <div className="text-[11.5px] text-rec">{error}</div>}
        </div>
      )}
    </div>
  );
}

function CopilotCard({ active, connected, enabled, models, cfg, onUse, onChanged, onSave, onToggle }: {
  active: boolean; connected: boolean; enabled: boolean; models: { id: string }[]; cfg: { model?: string; clientId?: string; headers?: Record<string, string>; tiers?: AiModelTiers };
  onUse: () => void; onChanged: () => void; onSave: (next: { model?: string; clientId?: string; headers?: Record<string, string>; tiers?: AiModelTiers }) => Promise<void>;
  onToggle: (v: boolean) => Promise<void>;
}) {
  const p = SPECIAL_META.copilot;
  const [device, setDevice] = useState<{ user_code: string; verification_uri: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [custom, setCustom] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [clientId, setClientId] = useState(cfg.clientId || '');
  // Headers are edited as "Name: value" lines (one per line) — simplest faithful editor for an
  // arbitrary header map. Parsed back to an object on blur.
  const headersToText = (h?: Record<string, string>) => Object.entries(h || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const [headersText, setHeadersText] = useState(headersToText(cfg.headers));
  useEffect(() => { setClientId(cfg.clientId || ''); }, [cfg.clientId]);
  useEffect(() => { setHeadersText(headersToText(cfg.headers)); }, [cfg.headers]);
  const parseHeaders = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) out[k] = v;
    }
    return out;
  };
  const polling = useRef(false);
  useEffect(() => () => { polling.current = false; }, []);

  const model = cfg.model || '';
  // Free-text if the picked model isn't among the pulled ones (e.g. a preview/beta id typed by hand).
  const isCustom = custom || (!!model && models.length > 0 && !models.some((m) => m.id === model));

  const connect = async () => {
    setError(''); setConnecting(true); setDevice(null);
    try {
      const flow = await api.copilotStart();
      setDevice({ user_code: flow.user_code, verification_uri: flow.verification_uri });
      try { window.open(flow.verification_uri, '_blank'); } catch { /* noop */ }
      polling.current = true;
      let interval = flow.interval || 5;
      const deadline = Date.now() + (flow.expires_in || 900) * 1000;
      while (polling.current && Date.now() < deadline) {
        await sleep((interval + 1) * 1000);
        if (!polling.current) break;
        const res = await api.copilotPoll(flow.device_code);
        if (res.status === 'connected') { setDevice(null); onChanged(); break; }
        if (res.status === 'error') { setError(res.error || 'Authorization failed.'); break; }
        if (res.status === 'slow_down') interval = res.interval || interval + 5;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect failed.');
    } finally {
      setConnecting(false); polling.current = false;
    }
  };

  const disconnect = async () => { polling.current = false; await api.copilotDisconnect().catch(() => {}); onChanged(); };

  return (
    <div className={`rounded-[10px] border p-4 h-full ${active ? 'border-accent bg-accent-soft/30' : 'border-border bg-card'} ${connected && !enabled ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`w-2 h-2 rounded-full ${connected && enabled ? 'bg-ok' : 'bg-ink3'}`} />
        <span className="text-[14px] font-550 text-ink flex-1">{p.name}</span>
        {active ? (
          <span className="text-[10px] font-600 text-white bg-accent px-2 py-0.5 rounded-full">default</span>
        ) : (
          <button type="button" onClick={onUse} disabled={!connected || !enabled}
            className="text-[11.5px] px-2.5 py-1 rounded-[6px] border border-border text-ink2 hover:border-ink3 disabled:opacity-40">
            Set as default
          </button>
        )}
      </div>
      <p className="text-[11.5px] text-ink3 mb-3 leading-relaxed">Uses your GitHub Copilot subscription — no API key, no proxy.</p>

      {connected ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 text-[12.5px] text-ink2">
            <span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${enabled ? 'bg-ok' : 'bg-ink3'}`} />
              {enabled ? `Connected · ${models.length} model${models.length === 1 ? '' : 's'}` : 'Connected · off'}</span>
            <EnableSwitch enabled={enabled} onChange={onToggle} />
            <button type="button" onClick={disconnect} className="text-[11.5px] px-2.5 py-1 rounded-[6px] border border-border text-ink2 hover:border-ink3 ml-auto">Disconnect</button>
          </div>
          {!enabled && <DisabledNote name={p.name} />}
          {enabled && <>
          <label className="flex items-center gap-3">
            <span className="text-[12px] text-ink2 w-[80px]">Model</span>
            {/* Populated from the pulled catalog. Custom… → free-text escape hatch for a model
                id the models endpoint doesn't list yet (preview/beta). */}
            {!isCustom ? (
              <div className="relative flex-1 min-w-0">
                {/* No implicit default: the poll list is alphabetical (claude-fable-5 first),
                    so a silent fallback runs agents on whatever sorts to the top. */}
                <select value={model} onChange={(e) => { if (e.target.value === '__custom__') { setCustom(true); onSave({ model: '' }); } else onSave({ model: e.target.value }); }}
                  className={`w-full appearance-none h-[30px] pl-2.5 pr-6 rounded-[6px] border bg-bg text-[12px] font-mono outline-none cursor-pointer ${model ? 'border-border text-ink' : 'border-rec text-rec'}`}>
                  <option value="" disabled>Select a model…</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                  <option value="__custom__">Custom…</option>
                </select>
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink3 rotate-90"><Icon name="chevR" size={11} /></span>
              </div>
            ) : (
              <input value={model} onChange={(e) => onSave({ model: e.target.value })} placeholder="model id" list="copilot-models"
                onBlur={() => { if (!model) setCustom(false); }}
                className="flex-1 min-w-0 h-[30px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12px] font-mono outline-none" />
            )}
            <datalist id="copilot-models">{models.map((m) => <option key={m.id} value={m.id} />)}</datalist>
          </label>
          {!cfg.model && (
            <div className="text-[11.5px] text-rec">Select a default model — agents and chat can't run on Copilot until you pick one.</div>
          )}
          <div className="pt-2 mt-1 border-t border-border">
            <div className="text-[11px] text-ink3 mb-2">Effort tiers <span className="text-ink3/70">— optional model overrides other features can pick from</span></div>
            <TierPicker tiers={cfg.tiers || {}} models={models} onSave={(tiers) => onSave({ tiers })} />
          </div>
          </>}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div>
            <button type="button" onClick={connect} disabled={connecting}
              className="h-[30px] px-3 rounded-[6px] bg-accent text-white text-[12px] font-550 inline-flex items-center gap-1.5 disabled:opacity-60">
              <Icon name="sparkle" size={13} /> {connecting ? 'Waiting for authorization…' : 'Connect GitHub Copilot'}
            </button>
          </div>
          <div className="text-[11px] text-ink3 leading-relaxed">
            Signs in with the built-in Curry Leaves GitHub app — no client ID needed. To use your own
            registered OAuth app instead, set its client ID under <span className="font-550">Advanced</span> before connecting.
          </div>
          {/* Advanced: override the GitHub OAuth client id used at connect. Default ("") is our own
              registered app, which is granted the GA model set. A user who understands the trade-off
              (and the terms) can supply a different id to try to unlock more models — their choice. */}
          <div>
            <button type="button" onClick={() => setAdvanced((a) => !a)}
              className="inline-flex items-center gap-1 text-[11px] text-ink3 hover:text-ink2">
              <span className={advanced ? 'rotate-90' : ''}><Icon name="chevR" size={10} /></span> Advanced
            </button>
            {advanced && (
              <div className="mt-2 flex flex-col gap-1.5">
                <label className="flex items-center gap-3">
                  <span className="text-[12px] text-ink2 w-[80px] flex-none">Client ID</span>
                  <input value={clientId} onChange={(e) => setClientId(e.target.value)}
                    onBlur={() => { if (clientId !== (cfg.clientId || '')) onSave({ clientId: clientId.trim() }); }}
                    placeholder="(default: Curry Leaves app)"
                    className="flex-1 min-w-0 h-[30px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12px] font-mono outline-none" />
                </label>
                <p className="text-[11px] text-ink3 leading-relaxed">
                  Overrides the GitHub OAuth client id used to sign in. Leave blank to use the Curry
                  Leaves app, which is granted the GA model set — supply your own registered GitHub
                  OAuth app's client ID if you need a different model catalog. Changing it affects what
                  models GitHub grants your account and is your responsibility under GitHub's terms.
                  Takes effect on the next connect.
                </p>
                <label className="flex items-start gap-3 mt-1">
                  <span className="text-[12px] text-ink2 w-[80px] flex-none pt-1.5">Headers</span>
                  <textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)}
                    onBlur={() => { const next = parseHeaders(headersText); if (JSON.stringify(next) !== JSON.stringify(cfg.headers || {})) onSave({ headers: next }); }}
                    rows={3} spellCheck={false}
                    placeholder={'Copilot-Integration-Id: vscode-chat\nEditor-Version: vscode/1.95.0'}
                    className="flex-1 min-w-0 px-2.5 py-1.5 rounded-[6px] border border-border bg-bg text-ink text-[11.5px] font-mono outline-none resize-y leading-snug" />
                </label>
                <p className="text-[11px] text-ink3 leading-relaxed">
                  Custom headers sent on Copilot requests, one <span className="font-mono">Name: value</span> per
                  line. Leave empty to use the default request identity (recommended). Supplying headers
                  can change which models GitHub returns and is your responsibility under GitHub's terms.
                  Takes effect on the next connect.
                </p>
              </div>
            )}
          </div>
          {device && (
            <div className="rounded-[8px] border border-accent bg-accent-soft/40 px-3.5 py-3 text-[12.5px] text-ink">
              Open{' '}
              <a href={device.verification_uri} target="_blank" rel="noreferrer" className="text-accent-dark underline">{device.verification_uri}</a>{' '}
              and enter:
              <div className="font-mono text-[20px] font-700 tracking-[3px] mt-1.5 text-ink">{device.user_code}</div>
            </div>
          )}
          {error && <div className="text-[11.5px] text-rec">{error}</div>}
        </div>
      )}
    </div>
  );
}

function CodexCard({ active, connected, configured, clientIdEnv, enabled, models, cfg, onUse, onChanged, onSave, onToggle }: {
  active: boolean; connected: boolean; configured: boolean; clientIdEnv?: string;
  enabled: boolean; models: { id: string }[]; cfg: { model?: string; tiers?: AiModelTiers };
  onUse: () => void; onChanged: () => void; onSave: (next: { model?: string; tiers?: AiModelTiers }) => Promise<void>;
  onToggle: (v: boolean) => Promise<void>;
}) {
  const p = SPECIAL_META.codex;
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const polling = useRef(false);
  useEffect(() => () => { polling.current = false; }, []);

  const connect = async () => {
    setError(''); setConnecting(true);
    try {
      const flow = await api.codexStart();
      if (flow.status === 'error' || !flow.auth_url || !flow.state) {
        setError(flow.error || 'Could not start Codex sign-in.'); return;
      }
      try { window.open(flow.auth_url, '_blank'); } catch { /* noop */ }
      polling.current = true;
      const deadline = Date.now() + (flow.expires_in || 600) * 1000;
      while (polling.current && Date.now() < deadline) {
        await sleep(2000);
        if (!polling.current) break;
        const res = await api.codexPoll(flow.state);
        if (res.status === 'connected') { onChanged(); break; }
        if (res.status === 'error') { setError(res.error || 'Authorization failed.'); break; }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect failed.');
    } finally {
      setConnecting(false); polling.current = false;
    }
  };

  const disconnect = async () => { polling.current = false; await api.codexDisconnect().catch(() => {}); onChanged(); };

  return (
    <div className={`rounded-[10px] border p-4 h-full ${active ? 'border-accent bg-accent-soft/30' : 'border-border bg-card'} ${connected && !enabled ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`w-2 h-2 rounded-full ${connected && enabled ? 'bg-ok' : 'bg-ink3'}`} />
        <span className="text-[14px] font-550 text-ink flex-1">{p.name}</span>
        {active ? (
          <span className="text-[10px] font-600 text-white bg-accent px-2 py-0.5 rounded-full">default</span>
        ) : (
          <button type="button" onClick={onUse} disabled={!connected || !enabled}
            className="text-[11.5px] px-2.5 py-1 rounded-[6px] border border-border text-ink2 hover:border-ink3 disabled:opacity-40">
            Set as default
          </button>
        )}
      </div>
      <p className="text-[11.5px] text-ink3 mb-3 leading-relaxed">Uses your ChatGPT (Codex) subscription — sign in with your OpenAI account, no API key.</p>

      {connected ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 text-[12.5px] text-ink2">
            <span className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${enabled ? 'bg-ok' : 'bg-ink3'}`} />
              {enabled ? `Connected · ${models.length} model${models.length === 1 ? '' : 's'}` : 'Connected · off'}</span>
            <EnableSwitch enabled={enabled} onChange={onToggle} />
            <button type="button" onClick={disconnect} className="text-[11.5px] px-2.5 py-1 rounded-[6px] border border-border text-ink2 hover:border-ink3 ml-auto">Disconnect</button>
          </div>
          {!enabled && <DisabledNote name={p.name} />}
          {enabled && <>
          <label className="flex items-center gap-3">
            <span className="text-[12px] text-ink2 w-[80px]">Model</span>
            <div className="relative flex-1 min-w-0">
              <select value={cfg.model || ''} onChange={(e) => onSave({ model: e.target.value })}
                className={`w-full appearance-none h-[30px] pl-2.5 pr-6 rounded-[6px] border bg-bg text-[12px] font-mono outline-none cursor-pointer ${cfg.model ? 'border-border text-ink' : 'border-rec text-rec'}`}>
                <option value="" disabled>Select a model…</option>
                {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
              </select>
              <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink3 rotate-90"><Icon name="chevR" size={11} /></span>
            </div>
          </label>
          {!cfg.model && (
            <div className="text-[11.5px] text-rec">Select a default model — agents and chat can't run on Codex until you pick one.</div>
          )}
          <div className="pt-2 mt-1 border-t border-border">
            <div className="text-[11px] text-ink3 mb-2">Effort tiers <span className="text-ink3/70">— optional model overrides other features can pick from</span></div>
            <TierPicker tiers={cfg.tiers || {}} models={models} onSave={(tiers) => onSave({ tiers })} />
          </div>
          </>}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {/* Codex ships no default OAuth client id, so sign-in is impossible until the user
              registers their own OpenAI integration and exports it. Say that here rather than
              letting them click Connect and read a failure. */}
          {!configured && (
            <div className="rounded-[8px] border border-rec/50 bg-rec/5 px-3 py-2.5 text-[11.5px] text-ink2 leading-relaxed">
              <span className="font-550 text-ink">An OpenAI OAuth client ID is required.</span> Curry
              Leaves doesn't ship one for Codex. Register your own OpenAI OAuth integration, then start
              the app with <span className="font-mono text-[11px]">{clientIdEnv || 'CURRY_LEAVES_CODEX_CLIENT_ID'}</span> set
              to its client ID. Prefer no setup? Use the <span className="font-550">OpenAI</span> provider with an API key instead.
            </div>
          )}
          <div>
            <button type="button" onClick={connect} disabled={connecting || !configured}
              className="h-[30px] px-3 rounded-[6px] bg-accent text-white text-[12px] font-550 inline-flex items-center gap-1.5 disabled:opacity-60">
              <Icon name="sparkle" size={13} /> {connecting ? 'Waiting for authorization…' : 'Sign in with ChatGPT'}
            </button>
          </div>
          {connecting && (
            <div className="text-[11.5px] text-ink3">A browser tab opened for OpenAI sign-in. Approve access, then return here.</div>
          )}
          {error && <div className="text-[11.5px] text-rec">{error}</div>}
        </div>
      )}
    </div>
  );
}

/** Ollama (local). "Connected" is the live server probe (`connected`), and its installed
 *  models arrive pre-pulled from /providers/status. NOT connected → base URL + "Connect"
 *  (saves the URL, then re-probes); connected → Disconnect + a model dropdown from the
 *  installed list. Same two-state shape as the other cards. */
function OllamaCard({ cfg, active, connected, models, host, onSave, onUse, onDisconnect }: {
  cfg: { baseUrl?: string; model?: string; tiers?: AiModelTiers; enabled?: boolean };
  active: boolean; connected: boolean; models: { id: string }[]; host: string;
  onSave: (next: { baseUrl?: string; model?: string; tiers?: AiModelTiers; enabled?: boolean }) => Promise<void>;
  onUse: () => void;
  onDisconnect: () => Promise<void>;
}) {
  const p = SPECIAL_META.ollama;
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl || '');
  const [custom, setCustom] = useState(false);
  const [connecting, setConnecting] = useState(false);
  useEffect(() => { setBaseUrl(cfg.baseUrl || ''); }, [cfg.baseUrl]);

  const model = cfg.model || '';
  // Free-text if the picked model isn't among the installed ones (e.g. typed by hand).
  const isCustom = custom || (!!model && models.length > 0 && !models.some((m) => m.id === model));
  // Connect = persist the base URL and (re-)enable Ollama; the parent then re-probes
  // /providers/status, which flips `connected` and delivers the installed-model list.
  const connect = async () => { setConnecting(true); try { await onSave({ baseUrl, enabled: true }); } finally { setConnecting(false); } };
  // "Connected" here is a live probe of the local server, not a stored credential — you can't
  // truly disconnect a running server. Disconnect flips the user `enabled` flag off (the probe
  // then reports it disconnected) and clears the model, returning the card to the Connect state.
  const disconnect = async () => { setCustom(false); await onDisconnect(); };

  return (
    <div className={`rounded-[10px] border p-4 h-full ${active ? 'border-accent bg-accent-soft/30' : 'border-border bg-card'}`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-ok' : 'bg-ink3'}`} />
        <span className="text-[14px] font-550 text-ink flex-1">{p.name}</span>
        {active ? (
          <span className="text-[10px] font-600 text-white bg-accent px-2 py-0.5 rounded-full">default</span>
        ) : (
          <button type="button" onClick={onUse} disabled={!connected || !model}
            className="text-[11.5px] px-2.5 py-1 rounded-[6px] border border-border text-ink2 hover:border-ink3 disabled:opacity-40">
            Set as default
          </button>
        )}
      </div>
      <p className="text-[11.5px] text-ink3 mb-3 leading-relaxed">{p.hint}</p>

      {connected ? (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-3 text-[12.5px] text-ink2">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-ok" />Connected · {host} · {models.length} model{models.length === 1 ? '' : 's'}</span>
            <button type="button" onClick={disconnect} className="text-[11.5px] px-2.5 py-1 rounded-[6px] border border-border text-ink2 hover:border-ink3">Disconnect</button>
          </div>
          <label className="flex items-center gap-3">
            <span className="text-[12px] text-ink2 w-[80px]">Model</span>
            {/* Pick from the installed models. Custom… → free text (e.g. a model not yet pulled). */}
            {models.length > 0 && !isCustom ? (
              <div className="relative flex-1 min-w-0">
                <select value={model} title="Model"
                  onChange={(e) => { if (e.target.value === '__custom__') { setCustom(true); onSave({ model: '' }); } else onSave({ model: e.target.value }); }}
                  className={`w-full appearance-none h-[30px] pl-2.5 pr-6 rounded-[6px] border bg-bg text-[12px] font-mono outline-none cursor-pointer ${model ? 'border-border text-ink' : 'border-rec text-rec'}`}>
                  <option value="" disabled>Select a model…</option>
                  {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                  <option value="__custom__">Custom…</option>
                </select>
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-ink3 rotate-90"><Icon name="chevR" size={11} /></span>
              </div>
            ) : (
              <input value={model} onChange={(e) => onSave({ model: e.target.value })} placeholder={p.modelPh} list="ollama-models"
                onBlur={() => { if (models.length > 0 && !model) setCustom(false); }}
                className="flex-1 min-w-0 h-[30px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12px] font-mono outline-none" />
            )}
            <datalist id="ollama-models">{models.map((m) => <option key={m.id} value={m.id} />)}</datalist>
          </label>
          {!model && (
            <div className="text-[11.5px] text-rec">Select a model — agents and chat can't run on Ollama until you pick one.</div>
          )}
          <div className="pt-2 mt-1 border-t border-border">
            <div className="text-[11px] text-ink3 mb-2">Effort tiers <span className="text-ink3/70">— optional model overrides other features can pick from</span></div>
            <TierPicker tiers={cfg.tiers || {}} models={models} onSave={(tiers) => onSave({ tiers })} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-3">
            <span className="text-[12px] text-ink2 w-[80px]">Base URL</span>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434"
              className="flex-1 min-w-0 h-[30px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12px] font-mono outline-none" />
          </label>
          <div>
            <button type="button" onClick={connect} disabled={connecting}
              className="h-[30px] px-3 rounded-[6px] bg-accent text-white text-[12px] font-550 inline-flex items-center gap-1.5 disabled:opacity-60">
              <Icon name="sparkle" size={13} /> {connecting ? 'Connecting…' : 'Connect'}
            </button>
          </div>
          <div className="text-[11.5px] text-ink3">
            {cfg.enabled === false
              ? 'Ollama is disconnected. Click Connect to use it again.'
              : `No server detected at ${host} — start Ollama (from ollama.com), then Connect.`}
          </div>
        </div>
      )}
    </div>
  );
}

/** Add-a-custom-provider form (any OpenAI-compatible endpoint). Saves name + base URL under a
 *  generated id, then the card takes over for Connect (key) → pull models. */
function AddCustomProvider({ onAdd }: { onAdd: (id: string, name: string, baseUrl: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const nm = name.trim(); const url = baseUrl.trim();
    if (!nm || !url) return;
    setBusy(true);
    try {
      const id = 'custom-' + nm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      await onAdd(id, nm, url);
      setName(''); setBaseUrl(''); setOpen(false);
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-[10px] border border-dashed border-border p-4 h-full flex items-center justify-center gap-2 text-[12.5px] text-ink3 hover:border-ink3 hover:text-ink2">
        <Icon name="plus" size={14} /> Add custom provider (OpenAI-compatible)
      </button>
    );
  }
  return (
    <div className="rounded-[10px] border border-border bg-card p-4 h-full flex flex-col gap-2.5">
      <div className="text-[14px] font-550 text-ink mb-1">Custom provider</div>
      <p className="text-[11.5px] text-ink3 leading-relaxed">Any OpenAI-compatible endpoint — enter a name and its API base URL (…/v1). You'll add the key and pick a model next.</p>
      <label className="flex items-center gap-3">
        <span className="text-[12px] text-ink2 w-[80px]">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fireworks"
          className="flex-1 min-w-0 h-[30px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12px] outline-none" />
      </label>
      <label className="flex items-center gap-3">
        <span className="text-[12px] text-ink2 w-[80px]">Base URL</span>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1"
          className="flex-1 min-w-0 h-[30px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12px] font-mono outline-none" />
      </label>
      <div className="flex items-center gap-2 mt-1">
        <button type="button" onClick={submit} disabled={busy || !name.trim() || !baseUrl.trim()}
          className="h-[30px] px-3 rounded-[6px] bg-accent text-white text-[12px] font-550 inline-flex items-center gap-1.5 disabled:opacity-50">
          <Icon name="plus" size={13} /> Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="h-[30px] px-2.5 rounded-[6px] border border-border text-[11.5px] text-ink3">Cancel</button>
      </div>
    </div>
  );
}

export function AiProviders() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [catalog, setCatalog] = useState<ProviderSpecDto[]>([]);
  const [copilot, setCopilot] = useState<{ connected: boolean; models: { id: string }[] }>({ connected: false, models: [] });
  const [codex, setCodex] = useState<{ connected: boolean; configured?: boolean; clientIdEnv?: string; models: { id: string }[] }>({ connected: false, models: [] });
  const [ollama, setOllama] = useState<{ connected: boolean; models: { id: string }[]; host: string }>({ connected: false, models: [], host: 'http://localhost:11434' });

  const load = () => {
    api.getSettings().then(setSettings).catch(() => {});
    api.providerCatalog().then((c) => setCatalog(c.providers)).catch(() => {});
    api.providerStatus().then((s) => {
      setCopilot(s.copilot);
      setCodex(s.codex || { connected: false, models: [] });
      if (s.ollama) setOllama(s.ollama);
    }).catch(() => {});
  };
  useEffect(load, []);

  const active = settings?.ai.active || '';
  const providers = settings?.ai.providers || {};

  const saveProvider = async (id: string, next: { apiKey?: string; model?: string; clientId?: string; headers?: Record<string, string>; baseUrl?: string; tiers?: AiModelTiers; enabled?: boolean; name?: string; custom?: boolean }) => {
    await api.patchAiSettings({ providers: { [id]: next } });
    load();
  };
  const setActive = async (id: string) => { await api.patchAiSettings({ active: id }); load(); };
  // Disconnect a keyed provider: clear its key + model, and drop it as default if it was one.
  const disconnectProvider = async (id: string) => {
    await api.patchAiSettings({
      providers: { [id]: { apiKey: '', model: '' } },
      ...(active === id ? { active: '' } : {}),
    });
    load();
  };
  // Ollama can't be "disconnected" (the local server is just up or down), so Disconnect
  // flips a user `enabled` flag off — the status probe then reports it disconnected — and
  // clears its model / drops it as default.
  const disconnectOllama = async () => {
    await api.patchAiSettings({
      providers: { ollama: { enabled: false, model: '' } },
      ...(active === 'ollama' ? { active: '' } : {}),
    });
    load();
  };
  const addCustom = async (id: string, name: string, baseUrl: string) => {
    await saveProvider(id, { custom: true, name, baseUrl: baseUrl.replace(/\/+$/, ''), apiKey: '', model: '' });
  };
  // Remove a custom provider entirely: blank its cfg + drop as default. (Built-ins can't be removed.)
  const removeCustom = async (id: string) => {
    await api.patchAiSettings({
      providers: { [id]: { custom: false, apiKey: '', model: '', baseUrl: '', name: '' } },
      ...(active === id ? { active: '' } : {}),
    });
    load();
  };

  // Connectedness for the two live-probe providers comes from /providers/status (it re-probes
  // on every load); everything else is answered by the catalog DTO, which computes it with the
  // same helper a real run uses. `enabled` is always the DTO's — one source of truth.
  const specById = new Map(catalog.map((s) => [s.id, s]));
  const isConnected = (id: string) => {
    if (id === 'copilot') return copilot.connected;
    if (id === 'codex') return codex.connected;
    if (id === 'ollama') return ollama.connected;
    return !!specById.get(id)?.connected;
  };
  const isEnabled = (id: string) => specById.get(id)?.enabled !== false;
  // Usable = connected AND switched on. This is what "Set as default" and the auto-pick below
  // mean by available, and it mirrors the backend's usable-catalog filter.
  const isUsable = (id: string) => isConnected(id) && isEnabled(id);
  // Flip a provider's on/off switch. Turning off the current default also clears `active` —
  // leaving a disabled provider as the default would just make every run fail with
  // "the default provider is turned off" until the user noticed.
  const setEnabled = async (id: string, v: boolean) => {
    await api.patchAiSettings({
      providers: { [id]: { enabled: v } },
      ...(!v && active === id ? { active: '' } : {}),
    });
    load();
  };

  // Auto-pick the default: if the user has connected exactly one provider and hasn't set a
  // default yet, make it the default so they don't have to click "Set as default" for the
  // obvious single-provider case. Only fires when `active` is empty — once anything is the
  // default (including this auto-set one) it never overrides the user's explicit choice, and
  // the `!active` guard also stops the setActive → load → re-render loop from re-firing.
  // Only a USABLE provider can be auto-picked — auto-selecting a disabled one would set a
  // default that can't run.
  const usableIds = catalog.map((s) => s.id).filter(isUsable);
  useEffect(() => {
    if (settings && !active && usableIds.length === 1) setActive(usableIds[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, active, usableIds.join(',')]);
  // Usable providers first (default provider leads), then connected-but-off, then the rest in
  // catalog order. Rank + stable index tiebreaker = a total order, so cards never shuffle
  // ambiguously. Disabled cards sit below the working ones but stay visible to be switched on.
  const rank = (id: string) => (id === active ? 0 : isUsable(id) ? 1 : isConnected(id) ? 2 : 3);
  const sorted = catalog
    .map((spec, i) => ({ spec, i }))
    .sort((a, b) => rank(a.spec.id) - rank(b.spec.id) || a.i - b.i)
    .map(({ spec }) => spec);

  return (
    <>
      <SHeader title="AI providers" subtitle="Connect any providers you use. The default runs agents & chat unless an agent picks its own." />
      <div className="overflow-y-auto px-8 py-5">
        {!settings ? (
          <div className="text-[12.5px] text-ink3">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 items-stretch">
              {sorted.map((spec) =>
                spec.id === 'copilot' ? (
                  <CopilotCard key={spec.id} active={active === 'copilot'} connected={copilot.connected}
                    enabled={isEnabled('copilot')} models={copilot.models}
                    cfg={providers.copilot || {}} onUse={() => setActive('copilot')} onChanged={load}
                    onSave={(next) => saveProvider('copilot', next)}
                    onToggle={(v) => setEnabled('copilot', v)} />
                ) : spec.id === 'codex' ? (
                  <CodexCard key={spec.id} active={active === 'codex'} connected={codex.connected}
                    configured={codex.configured !== false} clientIdEnv={codex.clientIdEnv}
                    enabled={isEnabled('codex')} models={codex.models}
                    cfg={providers.codex || {}} onUse={() => setActive('codex')} onChanged={load}
                    onSave={(next) => saveProvider('codex', next)}
                    onToggle={(v) => setEnabled('codex', v)} />
                ) : spec.id === 'ollama' ? (
                  <OllamaCard key={spec.id} cfg={providers.ollama || {}} active={active === 'ollama'} connected={ollama.connected}
                    models={ollama.models} host={ollama.host}
                    onSave={(next) => saveProvider('ollama', next)} onUse={() => setActive('ollama')}
                    onDisconnect={disconnectOllama} />
                ) : (
                  <ProviderCard key={spec.id} spec={spec} cfg={providers[spec.id] || {}} active={active === spec.id}
                    enabled={isEnabled(spec.id)}
                    onSave={(next) => saveProvider(spec.id, next)} onUse={() => setActive(spec.id)}
                    onDisconnect={() => disconnectProvider(spec.id)}
                    onRemove={spec.custom ? () => removeCustom(spec.id) : undefined}
                    onToggle={(v) => setEnabled(spec.id, v)} />
                ),
              )}
              <AddCustomProvider onAdd={addCustom} />
            </div>

            {!active && (
              <div className="text-[11.5px] text-ink3 mt-3">No default provider selected — connect a provider and click "Set as default" to run agents & chat.</div>
            )}
          </>
        )}
      </div>
    </>
  );
}
