import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ExternalLink } from 'lucide-react';
import { api } from '../../../api/client';
import type { ProviderSpecDto } from '../../../api/providers';
import { StepHead, StepNav } from '../SetupWizard';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Provider ids whose model the user confirmed during this wizard run — see `confirmed`. */
const CONFIRMED_MODELS = new Set<string>();

/**
 * Step 5 — connect one AI provider, the thing that actually makes chat and agents work.
 *
 * Deliberately NOT the Settings cards: those carry per-provider effort tiers, model
 * dropdowns, custom endpoints and disconnect flows, which is the right surface for
 * managing providers but far too much for "pick one to get started". This is a compact
 * picker over the same catalog and the same connect endpoints — anything richer lives
 * one click away in Settings → AI providers.
 */
export function ProviderStep({ onNext, onSkip, onBack }: {
  onNext: () => void; onSkip: () => void; onBack: () => void;
}) {
  const [catalog, setCatalog] = useState<ProviderSpecDto[]>([]);
  const [chosen, setChosen] = useState<ProviderSpecDto | null>(null);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  // Connected but with no model confirmed yet — clicking it must go to the model picker,
  // not straight to "done": a provider without a usable model can't serve a request.
  const [needsModel, setNeedsModel] = useState<Record<string, boolean>>({});
  // Providers whose model the user has confirmed in THIS wizard run. Module-scoped rather
  // than component state because stepping forward to the PIN and back unmounts this step —
  // a per-instance ref would forget the confirmation and re-prompt for a model.
  const confirmed = useRef(CONFIRMED_MODELS);

  const refreshStatus = useCallback(async () => {
    const [cat, status] = await Promise.all([
      api.providerCatalog().catch(() => null),
      api.providerStatus().catch(() => null),
    ]);
    // "Connected" here means connected AND switched on — the wizard's job is to leave the user
    // with a provider that actually runs, and a disabled one doesn't. Taken from the catalog
    // DTO rather than re-derived from raw settings, so this agrees with Settings and the backend.
    const next: Record<string, boolean> = {};
    for (const spec of cat?.providers || []) {
      if (spec.connected && spec.enabled) next[spec.id] = true;
    }
    if (status?.copilot?.connected && status.copilot.enabled !== false) next.copilot = true;
    if (status?.codex?.connected && status.codex.enabled !== false) next.codex = true;
    if (status?.ollama?.connected) next.ollama = true;
    setConnected(next);
    // A saved model only counts if the USER picked it. Several providers ship a default in
    // DEFAULTS (Ollama's is "llama3.1", which may not even be pulled on this machine), so
    // trusting `cfg.model` would skip the choice on exactly the providers that need it.
    // `confirmed` is populated by the picker, so first-run always confirms once.
    setNeedsModel(Object.fromEntries(
      Object.keys(next).map((id) => [id, !confirmed.current.has(id)]),
    ));
  }, []);

  useEffect(() => {
    api.providerCatalog().then((c) => setCatalog(c.providers)).catch(() => {});
    void refreshStatus();
  }, [refreshStatus]);

  // Connecting anything makes it the default provider, so the app is usable immediately.
  const finish = async (id: string) => {
    // Also switch it on: picking a provider here is an explicit "use this", and a default that
    // was left disabled would fail on the very first run.
    try { await api.patchAiSettings({ active: id, providers: { [id]: { enabled: true } } }); }
    catch { /* setup should never dead-end */ }
    onNext();
  };

  if (chosen) {
    return (
      <ConnectPane
        spec={chosen}
        // Already authenticated, just missing a model → jump straight to the picker
        // rather than making them sign in / re-enter a key they've already given.
        skipToModel={!!connected[chosen.id] && !!needsModel[chosen.id]}
        onBack={() => { setChosen(null); void refreshStatus(); }}
        onConnected={() => { confirmed.current.add(chosen.id); finish(chosen.id); }}
      />
    );
  }

  return (
    <>
      <StepHead
        title="Connect an AI provider"
        hint="Curry Leaves needs a model to think with. Connect one now — you can add more, and change the default, in Settings later."
      />
      <div className="mt-6 max-h-[250px] overflow-y-auto grid grid-cols-2 gap-2 pr-1">
        {catalog.map((spec) => {
          const on = !!connected[spec.id];
          return (
            <button
              key={spec.id}
              type="button"
              onClick={() => (on && !needsModel[spec.id] ? finish(spec.id) : setChosen(spec))}
              className={`flex items-center justify-between gap-2 text-left px-3 py-2.5 rounded-[10px] border text-[12.5px] transition-colors ${
                on ? 'border-accent bg-accent-soft/40 text-accent-ink font-600'
                   : 'border-border bg-bg text-ink hover:border-ink3'}`}>
              <span className="truncate">{spec.name}</span>
              {on
                ? (needsModel[spec.id]
                    ? <span className="text-[10px] font-sans text-ink3 flex-none">pick a model</span>
                    : <Check size={14} className="text-accent flex-none" />)
                : !spec.keyed && <span className="text-[10px] text-ink3 flex-none">sign in</span>}
            </button>
          );
        })}
      </div>
      {Object.keys(connected).length > 0 && (
        <p className="text-[11.5px] text-ink3 mt-3">Pick a connected provider to make it your default.</p>
      )}
      <StepNav onSkip={onSkip} onBack={onBack} />
    </>
  );
}

// ─── connect one provider ─────────────────────────────────────────────────────

/**
 * Connecting is two stages, not one: authenticate/reach the provider, THEN pick the model
 * it will actually run on. Auto-taking `models[0]` looked like fewer clicks but silently
 * decided something that matters — on Ollama it's whichever model sorts first, on keyed
 * providers it's whatever the catalog happens to list first. The user picks, explicitly.
 */
function ConnectPane({ spec, skipToModel, onBack, onConnected }: {
  spec: ProviderSpecDto; skipToModel?: boolean; onBack: () => void; onConnected: () => void;
}) {
  // Stage 2 state: set once the provider is reachable and we know its model list.
  const [models, setModels] = useState<{ id: string }[] | null>(null);
  const [suggested, setSuggested] = useState('');

  const reached = useCallback((list: { id: string }[], preferred = '') => {
    setModels(list);
    setSuggested(preferred || spec.defaultModel || '');
  }, [spec.defaultModel]);

  // Re-entering an already-connected provider: fetch its model list directly so we can
  // open on the picker. `providerModels` reads the SAVED credential, so no re-auth.
  useEffect(() => {
    if (!skipToModel) return;
    api.providerModels(spec.id)
      .then((r) => reached(r.models, r.default_model))
      .catch(() => reached([], spec.defaultModel));
  }, [skipToModel, spec.id, spec.defaultModel, reached]);

  if (models) {
    return (
      <ModelPick
        spec={spec}
        models={models}
        suggested={suggested}
        // Re-entered providers have no connect stage to go back to — return to the list.
        onBack={skipToModel ? onBack : () => setModels(null)}
        onDone={onConnected}
      />
    );
  }
  // Fetching the saved provider's models — don't flash the connect form on the way.
  if (skipToModel) {
    return (
      <>
        <StepHead title={`Connect ${spec.name}`} hint="Loading available models…" />
        <div className="mt-6 flex items-center gap-2 text-[11.5px] text-ink3">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-accent/30 border-t-accent an-spin" />
          One moment…
        </div>
        <StepNav onBack={onBack} />
      </>
    );
  }
  if (spec.id === 'copilot') return <CopilotConnect spec={spec} onBack={onBack} onReached={reached} />;
  if (spec.id === 'codex') return <CodexConnect spec={spec} onBack={onBack} onReached={reached} />;
  if (spec.id === 'ollama') return <OllamaConnect spec={spec} onBack={onBack} onReached={reached} />;
  return <KeyConnect spec={spec} onBack={onBack} onReached={reached} />;
}

/**
 * Stage 2 — choose the model. Saving it is what finishes the step: a connected provider
 * with no model can't actually run anything (the app's own readiness check treats that as
 * `no_model`), so we don't let setup call it done.
 */
function ModelPick({ spec, models, suggested, onBack, onDone }: {
  spec: ProviderSpecDto; models: { id: string }[]; suggested: string;
  onBack: () => void; onDone: () => void;
}) {
  const [picked, setPicked] = useState(suggested && models.some((m) => m.id === suggested) ? suggested : '');
  const [typed, setTyped] = useState(suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Ollama can name a model that isn't pulled yet, so it also accepts free text.
  const freeText = models.length === 0;
  const value = freeText ? typed.trim() : picked;

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.patchAiSettings({ providers: { [spec.id]: { model: value } } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that model.');
      setBusy(false);
    }
  };

  return (
    <>
      <StepHead
        title="Choose a model"
        hint={freeText
          ? `${spec.name} is connected, but has no models installed yet. Name the one you'll pull — e.g. "llama3.1".`
          : `${spec.name} is connected. Pick the model to run chat and agents on — you can change it any time in Settings.`}
      />
      {freeText ? (
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value && !busy) void save(); }}
          placeholder={spec.defaultModel || 'llama3.1'}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          className="w-full h-[36px] mt-6 px-3 rounded-[8px] border border-border bg-bg text-ink text-[12.5px] font-mono outline-none focus:border-accent"
        />
      ) : (
        <div className="mt-6 max-h-[250px] overflow-y-auto flex flex-col gap-1.5 pr-1">
          {models.map((m) => {
            const on = m.id === picked;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(m.id)}
                className={`flex items-center justify-between gap-2 text-left px-3 py-2 rounded-[8px] border text-[12px] font-mono transition-colors ${
                  on ? 'border-accent bg-accent-soft/40 text-accent-ink font-600'
                     : 'border-border bg-bg text-ink hover:border-ink3'}`}>
                <span className="truncate">{m.id}</span>
                {m.id === suggested && !on && (
                  <span className="flex-none text-[10px] font-sans text-ink3">suggested</span>
                )}
                {on && <Check size={13} className="flex-none text-accent" />}
              </button>
            );
          })}
        </div>
      )}
      {error && <div className="text-[11.5px] text-rec mt-2">{error}</div>}
      <StepNav
        onNext={save}
        onBack={onBack}
        nextLabel="Use this model"
        busy={busy}
        disabled={!value}
      />
    </>
  );
}

/** Reports a reachable provider + the models it offers, handing off to the model picker. */
type Reached = (models: { id: string }[], preferred?: string) => void;

/** API-key providers. The key is validated against the provider's live model list before we
 *  save it, so a typo fails here rather than silently on the user's first message. */
function KeyConnect({ spec, onBack, onReached }: {
  spec: ProviderSpecDto; onBack: () => void; onReached: Reached;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    setBusy(true); setError('');
    try {
      // Preview doubles as validation: it 400s on a bad key, so we never save one.
      const r = await api.previewModels(spec.id, key.trim(), spec.baseUrl);
      // Save the key (not the model — that's the next stage's job). `enabled` goes with it so a
      // provider the user had previously switched off comes back on when they reconnect it.
      await api.patchAiSettings({ providers: { [spec.id]: { apiKey: key.trim(), enabled: true } } });
      onReached(r.models, r.default_model);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect.');
      setBusy(false);
    }
  };

  return (
    <>
      <StepHead title={`Connect ${spec.name}`} hint="Paste an API key. It's stored on this machine only." />
      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && key.trim() && !busy) void connect(); }}
        placeholder={spec.keyPlaceholder || 'sk-…'}
        type="password"
        spellCheck={false}
        autoComplete="off"
        autoFocus
        className="w-full h-[36px] mt-6 px-3 rounded-[8px] border border-border bg-bg text-ink text-[12.5px] font-mono outline-none focus:border-accent"
      />
      {error && <div className="text-[11.5px] text-rec mt-2">{error}</div>}
      <StepNav onNext={connect} onBack={onBack} nextLabel="Connect" busy={busy} disabled={!key.trim()} />
    </>
  );
}

/**
 * Ollama is a local server, so "connecting" is a reachability probe rather than a
 * credential check. Saving `{baseUrl, enabled}` is what makes the backend probe that host;
 * we then re-read `/providers/status` to find out whether it answered and what it has
 * installed. An unreachable host must fail HERE — otherwise setup completes "successfully"
 * against a provider that can't serve a single request.
 */
function OllamaConnect({ spec, onBack, onReached }: {
  spec: ProviderSpecDto; onBack: () => void; onReached: Reached;
}) {
  const [baseUrl, setBaseUrl] = useState('');
  const [host, setHost] = useState('http://localhost:11434');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Show the host the backend will actually probe, so the hint names a real address.
  useEffect(() => {
    api.providerStatus().then((s) => { if (s.ollama?.host) setHost(s.ollama.host); }).catch(() => {});
  }, []);

  const connect = async () => {
    setBusy(true); setError('');
    try {
      const url = baseUrl.trim().replace(/\/+$/, '');
      await api.patchAiSettings({ providers: { ollama: { enabled: true, baseUrl: url } } });
      const status = await api.providerStatus();
      if (!status.ollama?.connected) {
        throw new Error(`No Ollama server answered at ${url || host}. Start Ollama (ollama.com), then try again.`);
      }
      // Reachable — hand the installed models to the picker. An empty list is fine: the
      // picker falls back to free text so you can name a model you haven't pulled yet.
      onReached(status.ollama.models, spec.defaultModel);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Ollama.');
      setBusy(false);
    }
  };

  return (
    <>
      <StepHead
        title="Connect Ollama"
        hint="Runs models locally on this machine — nothing leaves your computer. Make sure Ollama is running, then connect."
      />
      <label htmlFor="ollama-url" className="block text-[11px] font-600 tracking-wider uppercase text-ink3 mt-6 mb-1.5">
        Server address
      </label>
      <input
        id="ollama-url"
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void connect(); }}
        placeholder={host}
        spellCheck={false}
        autoComplete="off"
        className="w-full h-[36px] px-3 rounded-[8px] border border-border bg-bg text-ink text-[12.5px] font-mono outline-none focus:border-accent"
      />
      <p className="text-[11px] text-ink3 mt-1.5">Leave blank to use {host}.</p>
      {error && <div className="text-[11.5px] text-rec mt-2">{error}</div>}
      <StepNav onNext={connect} onBack={onBack} nextLabel="Connect" busy={busy} />
    </>
  );
}

/** GitHub Copilot — device-code flow: show the code, open the browser, poll until it lands. */
function CopilotConnect({ spec, onBack, onReached }: {
  spec: ProviderSpecDto; onBack: () => void; onReached: Reached;
}) {
  const [device, setDevice] = useState<{ user_code: string; verification_uri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const polling = useRef(false);
  useEffect(() => () => { polling.current = false; }, []);

  const connect = async () => {
    setError(''); setBusy(true); setDevice(null);
    try {
      const flow = await api.copilotStart();
      setDevice({ user_code: flow.user_code, verification_uri: flow.verification_uri });
      try { window.open(flow.verification_uri, '_blank', 'noopener'); } catch { /* noop */ }
      polling.current = true;
      let interval = flow.interval || 5;
      const deadline = Date.now() + (flow.expires_in || 900) * 1000;
      while (polling.current && Date.now() < deadline) {
        await sleep((interval + 1) * 1000);
        if (!polling.current) break;
        const res = await api.copilotPoll(flow.device_code);
        if (res.status === 'connected') {
          // Copilot has NO implicit default model, and its list is alphabetical — taking
          // the first would silently pick whatever sorts to the top. Let the user choose.
          onReached(res.models || [], spec.defaultModel);
          return;
        }
        if (res.status === 'error') { setError(res.error || 'Authorization failed.'); break; }
        if (res.status === 'slow_down') interval = res.interval || interval + 5;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect failed.');
    }
    setBusy(false);
    polling.current = false;
  };

  return (
    <>
      <StepHead
        title="Sign in to GitHub Copilot"
        hint={device
          ? 'Enter this code in the browser window we opened, then come back here.'
          : 'Uses your existing Copilot subscription — no API key needed.'}
      />
      {device ? (
        <div className="mt-6 flex flex-col items-center gap-3">
          <div className="font-mono text-[24px] font-700 tracking-[3px] text-ink">{device.user_code}</div>
          <a href={device.verification_uri} target="_blank" rel="noopener noreferrer"
             className="inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline">
            Open sign-in page <ExternalLink size={12} />
          </a>
          <div className="flex items-center gap-2 text-[11.5px] text-ink3">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-accent/30 border-t-accent an-spin" />
            Waiting for you to finish…
          </div>
        </div>
      ) : <div className="mt-4" />}
      {error && <div className="text-[11.5px] text-rec mt-2">{error}</div>}
      <StepNav onNext={device ? undefined : connect} onBack={onBack} nextLabel="Sign in" busy={busy} />
    </>
  );
}

/** Codex / ChatGPT — browser-redirect flow: open the auth URL, poll the state until it lands. */
function CodexConnect({ spec, onBack, onReached }: {
  spec: ProviderSpecDto; onBack: () => void; onReached: Reached;
}) {
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Codex ships no default OAuth client id, so check up front whether one is configured and
  // explain what's needed instead of letting Sign in fail. Undefined = not yet known.
  const [cfg, setCfg] = useState<{ configured: boolean; env?: string } | null>(null);
  const polling = useRef(false);
  useEffect(() => () => { polling.current = false; }, []);
  useEffect(() => {
    let live = true;
    api.providerStatus()
      .then((s) => { if (live) setCfg({ configured: s.codex?.configured !== false, env: s.codex?.clientIdEnv }); })
      .catch(() => { if (live) setCfg({ configured: true }); });
    return () => { live = false; };
  }, []);

  const connect = async () => {
    setError(''); setBusy(true);
    try {
      const flow = await api.codexStart();
      if (flow.status === 'error' || !flow.auth_url || !flow.state) {
        setError(flow.error || 'Could not start sign-in.');
        setBusy(false);
        return;
      }
      try { window.open(flow.auth_url, '_blank', 'noopener'); } catch { /* noop */ }
      setWaiting(true);
      polling.current = true;
      const deadline = Date.now() + (flow.expires_in || 600) * 1000;
      while (polling.current && Date.now() < deadline) {
        await sleep(2000);
        if (!polling.current) break;
        const res = await api.codexPoll(flow.state);
        if (res.status === 'connected') {
          onReached(res.models || [], spec.defaultModel);
          return;
        }
        if (res.status === 'error') { setError(res.error || 'Authorization failed.'); break; }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect failed.');
    }
    setBusy(false); setWaiting(false);
    polling.current = false;
  };

  const blocked = cfg !== null && !cfg.configured;

  return (
    <>
      <StepHead
        title="Sign in to ChatGPT"
        hint={blocked
          ? 'Codex needs an OpenAI OAuth client ID before you can sign in.'
          : waiting
            ? 'Finish signing in in the browser window we opened, then come back here.'
            : "We'll open your browser to sign in. No API key needed."}
      />
      {blocked && (
        <div className="mt-5 rounded-[8px] border border-rec/50 bg-rec/5 px-3.5 py-3 text-[11.5px] text-ink2 leading-relaxed">
          <span className="font-550 text-ink">An OpenAI OAuth client ID is required.</span> Curry Leaves
          doesn't ship one for Codex. Register your own OpenAI OAuth integration, then restart the app
          with <span className="font-mono text-[11px]">{cfg?.env || 'CURRY_LEAVES_CODEX_CLIENT_ID'}</span> set
          to its client ID. Or go back and pick <span className="font-550">OpenAI</span> to use an API key instead.
        </div>
      )}
      {waiting && (
        <div className="mt-6 flex items-center justify-center gap-2 text-[11.5px] text-ink3">
          <span className="inline-block w-3 h-3 rounded-full border-2 border-accent/30 border-t-accent an-spin" />
          Waiting for you to finish…
        </div>
      )}
      {error && <div className="text-[11.5px] text-rec mt-2">{error}</div>}
      <StepNav onNext={waiting || blocked ? undefined : connect} onBack={onBack} nextLabel="Sign in" busy={busy} />
    </>
  );
}
