import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { AiTextSpace } from '../../components/AiTextSpace';
import { api } from '../../api/client';
import { fmtCost } from './TeamRoster';
import type { Agent, AgentRun, ScheduleSpec } from '../../types';
import { NO_SCHEDULE } from '../../types/schedule';
import { SchedulePicker } from '../../components/SchedulePicker';
import { Field, Stat, BODY_CLS, CHIP_CLS, FIELD_CLS, HINT_CLS, LABEL_CLS, SECTION_CLS } from './formKit';

// The profile's config sub-tabs — warm-but-literal names over the same fields.
type ProfileTab = 'briefing' | 'toolkit' | 'triggers' | 'hours' | 'skills' | 'brain';
const TABS: { id: ProfileTab; label: string }[] = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'toolkit', label: 'Toolkit' },
  { id: 'triggers', label: 'When it works' },
  { id: 'hours', label: 'Hours & team' },
  { id: 'skills', label: 'Skills' },
  { id: 'brain', label: 'Brain' },
];

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'agent';
// The "use the app-wide default (active) provider" option, always first. The rest of the list
// is built from the live /providers/catalog so it matches Settings — including newer built-ins
// (groq, together, openrouter, …) and any user-added custom endpoints — instead of a stale
// hardcoded set that omits half the providers.
const DEFAULT_PROVIDER_OPT = { id: '', name: 'Default (active provider)' };

const COLORS = ['oklch(0.62 0.15 48)', 'oklch(0.55 0.13 270)', 'oklch(0.62 0.14 150)', 'oklch(0.55 0.13 350)', 'oklch(0.58 0.13 200)'];
const colorFor = (id: string) => COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const initials = (n: string) => (n.trim() ? n.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : '·');

/** Inline agent editor panel. `agent` may be an existing agent or a prefilled draft;
 *  `isNew` forces create mode (draft from "Generate with AI" or a blank new agent). */
export function AgentForm({ agent, isNew, onSaved, onDeleted }: {
  agent: Agent | null;
  isNew?: boolean;
  onSaved: (a: Agent) => void;
  onDeleted: () => void;
}) {
  const editing = !!agent && !isNew;
  const [opts, setOpts] = useState<{ tools: { name: string; description: string }[]; triggers: string[]; skills: { name: string; description: string }[] }>({ tools: [], triggers: [], skills: [] });
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [providerOpts, setProviderOpts] = useState<{ id: string; name: string }[]>([DEFAULT_PROVIDER_OPT]);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [instructions, setInstructions] = useState('');
  const [tools, setTools] = useState<string[]>([]);
  const [deferredTools, setDeferredTools] = useState<string[]>([]);
  const [perms, setPerms] = useState<Record<string, string>>({});
  const [triggers, setTriggers] = useState<string[]>([]);
  const [subagents, setSubagents] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [chatSurface, setChatSurface] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [schedule, setSchedule] = useState<ScheduleSpec>(NO_SCHEDULE);
  const [saving, setSaving] = useState(false);
  const [customModel, setCustomModel] = useState(false);  // free-type a model id not in the list
  const [tab, setTab] = useState<ProfileTab>('briefing');
  const [runs, setRuns] = useState<AgentRun[] | null>(null);

  // Header performance snapshot — only for saved agents (a draft has no history yet).
  const [weekCost, setWeekCost] = useState(0);
  useEffect(() => {
    if (editing && agent) {
      api.agentRuns(agent.id).then(setRuns).catch(() => setRuns([]));
      api.getUsage(7)
        .then((u) => setWeekCost(u.byAgent.find((r) => r.key === agent.id)?.costUsd ?? 0))
        .catch(() => setWeekCost(0));
    } else { setRuns(null); setWeekCost(0); }
  }, [editing, agent]);
  const stats = useMemo(() => {
    if (!runs) return null;
    const weekAgo = Date.now() - 7 * 864e5;
    const week = runs.filter((r) => r.finishedAt && new Date(r.finishedAt).getTime() >= weekAgo);
    return {
      total: runs.length,
      weekRuns: week.length,
      weekOk: week.filter((r) => r.status === 'done').length,
      weekFail: week.filter((r) => r.status === 'failed').length,
      recent: runs.slice(0, 3),
    };
  }, [runs]);

  // Reset the form whenever the selected agent changes.
  useEffect(() => {
    setName(agent?.name ?? '');
    setDescription(agent?.description ?? '');
    setProvider(agent?.provider ?? '');
    setModel(agent?.model ?? '');
    setCustomModel(false);
    setInstructions(agent?.instructions ?? '');
    setTools(agent?.tools ?? []);
    setDeferredTools(agent?.deferredTools ?? []);
    setPerms(agent?.permissions ?? {});
    setTriggers(agent?.triggers ?? []);
    setSubagents(agent?.subagents ?? []);
    setSkills(agent?.skills ?? []);
    setChatSurface((agent?.surfaces ?? []).includes('chat'));
    setEnabled(agent?.enabled ?? true);
    setSchedule(agent?.schedule ?? NO_SCHEDULE);
  }, [agent]);

  useEffect(() => {
    api.agentOptions().then(setOpts).catch(() => {});
    api.listAgents().then(setAllAgents).catch(() => {});
    // Provider dropdown from the live catalog, narrowed to providers that are connected AND
    // switched on — pinning an assistant to anything else just makes its runs fail. An existing
    // pin that has since been disabled is still rendered (see the fallback <option> below), so
    // opening the form doesn't silently drop it. "Default" stays pinned first.
    api.providerCatalog(true)
      .then((c) => setProviderOpts([DEFAULT_PROVIDER_OPT, ...c.providers.map((p) => ({ id: p.id, name: p.name }))]))
      .catch(() => {});
  }, []);

  // Model suggestions follow the pinned provider (or the active provider when unpinned).
  const refreshModels = () =>
    api.providerModels(provider || undefined).then((r) => setModels(r.models)).catch(() => setModels([]));
  useEffect(() => { refreshModels(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [provider]);

  const toggle = (arr: string[], v: string, set: (a: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // Three-bucket tool picker: Available → Allowed (always-on) or Deferred (hidden from
  // the model until it calls search_tools and finds the name by keyword — see
  // agent_engine._build_agent). Either bucket carries an allow / ask / deny permission
  // (the chat permission engine honors it once the tool is actually callable).
  const addTool = (name: string) => {
    setTools((t) => (t.includes(name) ? t : [...t, name]));
    setDeferredTools((d) => d.filter((x) => x !== name));
    setPerms((p) => ({ ...p, [name]: p[name] ?? 'allow' }));
  };
  const deferTool = (name: string) => {
    setDeferredTools((d) => (d.includes(name) ? d : [...d, name]));
    setTools((t) => t.filter((x) => x !== name));
    setPerms((p) => ({ ...p, [name]: p[name] ?? 'allow' }));
  };
  const removeTool = (name: string) => {
    setTools((t) => t.filter((x) => x !== name));
    setDeferredTools((d) => d.filter((x) => x !== name));
    setPerms((p) => { const n = { ...p }; delete n[name]; return n; });
  };
  const setPerm = (name: string, level: string) => setPerms((p) => ({ ...p, [name]: level }));
  const toolDesc = (name: string) => opts.tools.find((t) => t.name === name)?.description ?? '';
  const available = opts.tools.filter((t) => !tools.includes(t.name) && !deferredTools.includes(t.name));

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const id = editing ? agent!.id : slug(name);
    const surfaces = chatSurface ? ['chat'] : (agent?.surfaces?.filter((s) => s !== 'chat') ?? []);
    const allCallable = [...tools, ...deferredTools];
    const body: Partial<Agent> & { id: string } = {
      id, name: name.trim(), description, provider: provider || null, model: model || null, instructions,
      tools, deferredTools, permissions: Object.fromEntries(allCallable.map((t) => [t, perms[t] ?? 'allow'])),
      maxSteps: agent?.maxSteps ?? 20, enabled,
      surfaces, triggers, subagents, skills, schedule,
    };
    try { const saved = await api.saveAgent(body); onSaved(saved); }
    catch { /* noop */ }
    setSaving(false);
  };

  const del = async () => {
    if (!agent || !confirm(`Delete agent “${agent.name}”?`)) return;
    await api.deleteAgent(agent.id).catch(() => {});
    onDeleted();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Detail header — identity on the left, actions on the right. The name is serif at
          the same 22px the Settings/Usage/Recordings headers use, so this page reads as a
          peer of those rather than a denser one-off. */}
      <div className="flex items-center gap-3.5 px-8 pt-5 pb-4 border-b border-border bg-bg flex-none">
        <div className="w-11 h-11 rounded-full flex items-center justify-center text-white text-[15px] font-600 flex-none" style={{ background: colorFor(editing ? agent!.id : 'new') }}>
          {initials(name)}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-serif text-[22px] text-ink tracking-tight truncate leading-tight">{name || (editing ? agent!.name : 'New agent')}</h2>
          {/* Facts as discrete chips rather than one run-on "·"-joined line. */}
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
            {description && <span className={`${HINT_CLS} truncate max-w-[280px]`}>{description}</span>}
            {!editing ? <Stat>unsaved draft</Stat>
              : !enabled ? <Stat tone="warn">Paused</Stat>
                : (
                  <>
                    <Stat>{agent!.lastRunAt ? `last run ${new Date(agent!.lastRunAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : 'never run'}</Stat>
                    {stats && stats.total > 0 && (
                      <Stat>{stats.total} runs · {Math.round((100 * (stats.total - stats.weekFail)) / stats.total)}% ok</Stat>
                    )}
                    {weekCost > 0 && <Stat title="Estimated spend, last 7 days">{fmtCost(weekCost)} this week</Stat>}
                  </>
                )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {editing && (
            <button type="button" title={enabled ? 'Enabled — click to pause (save to apply)' : 'Paused — click to enable (save to apply)'}
              onClick={() => setEnabled((v) => !v)}
              className={`relative w-[38px] h-[22px] rounded-full transition-colors flex-none mr-1 ${enabled ? 'bg-accent' : 'bg-border'}`}>
              <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          )}
          {editing && (
            <button type="button" onClick={() => api.runAgent(agent!.id)} title="Run now"
              className="flex items-center gap-1.5 h-[30px] px-3 rounded-[8px] border border-border bg-card text-ink2 text-[12.5px] hover:border-ink3">
              <Icon name="play" size={13} /> Run now
            </button>
          )}
          {/* Delete is destructive: icon-only and muted until hover, so it stops competing
              with Save for attention the way a full-size bordered button did. */}
          {editing && (
            <button type="button" onClick={del} title="Delete assistant"
              className="w-[30px] h-[30px] grid place-items-center rounded-[8px] border border-border bg-card text-ink3 hover:text-rec hover:border-rec">
              <Icon name="trash" size={13} />
            </button>
          )}
          <button type="button" onClick={save} disabled={saving || !name.trim()}
            className="h-[30px] px-4 rounded-[8px] bg-accent text-white text-[12.5px] font-550 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Icon name="check" size={13} /> {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>

      {/* Config sub-tabs, directly under the header. Name/Role used to sit in their own
          bordered block here, which split the page into two competing form areas; they're
          now the first rows of the Briefing tab where they belong. */}
      <div className="px-8 pt-4 flex-none">
        <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[7px] p-0.5 w-fit">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-3 h-[26px] rounded-[5px] text-[12.5px] inline-flex items-center gap-1.5 ${tab === t.id ? 'bg-card text-ink shadow-soft font-550' : 'text-sidebar-ink3 hover:text-sidebar-ink'}`}>
              {t.label}
              {t.id === 'toolkit' && (tools.length + deferredTools.length) > 0 && (
                <span className="px-1 rounded-[4px] bg-border-soft text-ink3 text-[10px] font-mono">{tools.length + deferredTools.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        {tab === 'briefing' && (
        <>
          <Field label="Name" hint="What this assistant is called across the app.">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meeting Summarizer"
              className={`w-full max-w-[360px] ${FIELD_CLS}`} />
          </Field>
          <Field label="Role" hint="A short subtitle, shown under the name on the team roster.">
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Dashboard Watcher"
              className={`w-full max-w-[360px] ${FIELD_CLS}`} />
          </Field>
          <Field label="Instructions" wide hint="The standing brief this assistant works from — its job, its style, anything it should always do or never do.">
            <div className="h-[440px] flex flex-col">
              <AiTextSpace value={instructions} onChange={setInstructions} placeholder="You are a helpful assistant that…" minHeight={400} />
            </div>
          </Field>
        </>
        )}

        {tab === 'brain' && (
        <>
          <Field label="Provider" hint="Which provider runs this assistant. Default follows Settings. Only providers that are connected and switched on are listed.">
            <div className="relative w-full max-w-[360px]">
              <select value={provider} onChange={(e) => setProvider(e.target.value)} title="Provider"
                onMouseDown={() => api.providerCatalog(true)
                  .then((c) => setProviderOpts([DEFAULT_PROVIDER_OPT, ...c.providers.map((p) => ({ id: p.id, name: p.name }))]))
                  .catch(() => {})}
                className={`w-full appearance-none pr-8 cursor-pointer ${FIELD_CLS}`}>
                {/* A pin that's no longer usable (provider disconnected or switched off) stays
                    selectable so opening this form doesn't silently reset the assistant. */}
                {provider && !providerOpts.some((p) => p.id === provider) && <option value={provider}>{provider} (unavailable)</option>}
                {providerOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 rotate-90"><Icon name="chevR" size={13} /></span>
            </div>
          </Field>
          <Field label="Model" hint="Pick from the provider's models, or leave as Default.">
            {customModel ? (
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" autoFocus
                onBlur={() => { if (!model) setCustomModel(false); }}
                className={`w-full max-w-[360px] font-mono ${FIELD_CLS}`} />
            ) : (
              <div className="relative w-full max-w-[360px]">
                <select value={model} title="Model"
                  onMouseDown={refreshModels}
                  onChange={(e) => { if (e.target.value === '__custom__') { setCustomModel(true); setModel(''); } else setModel(e.target.value); }}
                  className={`w-full appearance-none pr-8 font-mono cursor-pointer ${FIELD_CLS}`}>
                  <option value="">Default (provider's default)</option>
                  {model && !models.some((m) => m.id === model) && <option value={model}>{model}</option>}
                  {models.map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                  <option value="__custom__">Custom…</option>
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink3 rotate-90"><Icon name="chevR" size={13} /></span>
              </div>
            )}
          </Field>
        </>
        )}

        {tab === 'toolkit' && (
        <Field label="Toolkit" wide hint="What this assistant can do. Allowed tools are sent to the model every turn — always available, but they cost prompt tokens on every turn. Deferred tools stay callable while staying out of the prompt until the model searches for one by name. Each tool's chip sets how it's gated: allow runs it silently, ask prompts you first, deny blocks it.">
          <div className="grid grid-cols-3 gap-2">
            {/* Available */}
            <div className="rounded-[8px] border border-border bg-card flex flex-col">
              <div className={`px-2.5 py-2 border-b border-border flex items-center justify-between ${SECTION_CLS}`}>
                <span>Available</span><span>{available.length}</span>
              </div>
              <div className="p-1.5 flex flex-col gap-1 max-h-[260px] overflow-y-auto">
                {available.length === 0 && <div className="text-[12.5px] text-ink3 text-center py-6">All tools added</div>}
                {available.map((t) => (
                  <div key={t.name} title={t.description}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-[6px] border border-transparent hover:bg-bg hover:border-border">
                    <span className="font-mono text-[12.5px] text-ink2 flex-1 truncate">{t.name}</span>
                    <button type="button" title="Add to Allowed — always sent to the model" onClick={() => addTool(t.name)}
                      className="flex-none px-1.5 py-0.5 rounded-[4px] text-[11px] font-600 border border-border text-ink2 hover:border-accent hover:text-accent">
                      + Allow
                    </button>
                    <button type="button" title="Add to Deferred — hidden until the model searches for it" onClick={() => deferTool(t.name)}
                      className="flex-none px-1.5 py-0.5 rounded-[4px] text-[11px] font-600 border border-border text-ink2 hover:border-accent hover:text-accent">
                      + Defer
                    </button>
                  </div>
                ))}
              </div>
            </div>
            {/* Allowed (always-on) */}
            <div className="rounded-[8px] border border-border bg-card flex flex-col">
              <div className={`px-2.5 py-2 border-b border-border flex items-center justify-between ${SECTION_CLS}`}>
                <span>Allowed</span><span>{tools.length}</span>
              </div>
              <div className="p-1.5 flex flex-col gap-1 max-h-[260px] overflow-y-auto">
                {tools.length === 0 && <div className="text-[12.5px] text-ink3 text-center py-6">No tools yet — add from the left</div>}
                {tools.map((name) => (
                  <div key={name} className="flex items-center gap-1.5 px-2 py-1.5 rounded-[6px] bg-bg border border-border">
                    <span className="font-mono text-[12.5px] text-ink flex-1 truncate" title={toolDesc(name)}>{name}</span>
                    <PermSeg value={perms[name] ?? 'allow'} onChange={(v) => setPerm(name, v)} />
                    <button type="button" title="Move to Deferred — hide its schema until the model searches for it" onClick={() => deferTool(name)}
                      className="flex-none px-1.5 py-0.5 rounded-[4px] text-[11px] font-600 border border-border text-ink2 hover:border-accent hover:text-accent">
                      Defer
                    </button>
                    <button type="button" title="Remove" onClick={() => removeTool(name)} className="text-ink3 hover:text-rec flex-none"><Icon name="x" size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
            {/* Deferred (found on demand via search_tools) */}
            <div className="rounded-[8px] border border-border bg-card flex flex-col">
              <div className={`px-2.5 py-2 border-b border-border flex items-center justify-between ${SECTION_CLS}`}>
                <span>Deferred</span><span>{deferredTools.length}</span>
              </div>
              <div className="p-1.5 flex flex-col gap-1 max-h-[260px] overflow-y-auto">
                {deferredTools.length === 0 && (
                  <div className="text-[12.5px] text-ink3 text-center py-6 px-2 leading-relaxed">
                    None yet. Move a tool here to drop its schema from every turn's
                    prompt — it stays callable, just not billed as context, until the
                    model searches for it by name mid-run and it's added back in.
                  </div>
                )}
                {deferredTools.map((name) => (
                  <div key={name} className="flex items-center gap-1.5 px-2 py-1.5 rounded-[6px] bg-bg border border-border">
                    <span className="font-mono text-[12.5px] text-ink flex-1 truncate" title={toolDesc(name)}>{name}</span>
                    <PermSeg value={perms[name] ?? 'allow'} onChange={(v) => setPerm(name, v)} />
                    <button type="button" title="Move to Allowed — always send its schema to the model" onClick={() => addTool(name)}
                      className="flex-none px-1.5 py-0.5 rounded-[4px] text-[11px] font-600 border border-border text-ink2 hover:border-accent hover:text-accent">
                      Un-defer
                    </button>
                    <button type="button" title="Remove" onClick={() => removeTool(name)} className="text-ink3 hover:text-rec flex-none"><Icon name="x" size={12} /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Field>
        )}

        {tab === 'triggers' && (
        <Field label="When it works" hint="Events that automatically wake this assistant up — a meeting ends, maintenance completes, and so on.">
          {opts.triggers.length === 0
            ? <div className={BODY_CLS}>No triggers available.</div>
            : (
          <div className="flex flex-wrap gap-1.5">
            {opts.triggers.map((t) => (
              <button key={t} type="button" onClick={() => toggle(triggers, t, setTriggers)}
                className={`${CHIP_CLS} font-mono ${triggers.includes(t) ? 'bg-accent-soft border-accent-soft text-accent-ink' : 'border-border text-ink2 hover:border-ink3'}`}>
                {t}
              </button>
            ))}
          </div>
            )}
        </Field>
        )}

        {tab === 'skills' && (
        <Field label="Skills" hint="Operating procedures this assistant can load on demand via skill://. Only the selected skills are offered to it; pick none to expose all discovered skills.">
          {opts.skills.length === 0
            ? <div className={BODY_CLS}>No skills discovered.</div>
            : (
              <div className="flex flex-wrap gap-1.5">
                {opts.skills.map((s) => (
                  <button key={s.name} type="button" title={s.description || s.name} onClick={() => toggle(skills, s.name, setSkills)}
                    className={`${CHIP_CLS} font-mono ${skills.includes(s.name) ? 'bg-accent-soft border-accent-soft text-accent-ink' : 'border-border text-ink2 hover:border-ink3'}`}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
        </Field>
        )}

        {tab === 'triggers' && (
        <Field label="Ask AI" hint="Let people pick this assistant directly in the Ask AI chat, in addition to its triggers.">
          <label className={`flex items-center gap-2 ${BODY_CLS} cursor-pointer`}>
            <input type="checkbox" checked={chatSurface} onChange={(e) => setChatSurface(e.target.checked)} />
            Available in Ask AI chat
          </label>
        </Field>
        )}

        {tab === 'hours' && (
        <>
        <Field label="Hours" hint="Run autonomously on a cadence (independent of triggers). Scheduled assistants rest in the office break room between shifts.">
          <SchedulePicker value={schedule} onChange={setSchedule} />
        </Field>

        <Field label="Team" hint="Other assistants this one can delegate to as tools. Each runs in its own fresh context with its own tools and returns a result.">
          {(() => {
            const candidates = allAgents.filter((a) => !(editing && a.id === agent!.id));
            if (candidates.length === 0) return <div className={BODY_CLS}>No other assistants to delegate to yet.</div>;
            return (
              <div className="flex flex-wrap gap-1.5">
                {candidates.map((a) => (
                  <button key={a.id} type="button" title={a.description || a.id} onClick={() => toggle(subagents, a.id, setSubagents)}
                    className={`${CHIP_CLS} ${subagents.includes(a.id) ? 'bg-accent-soft border-accent-soft text-accent-ink' : 'border-border text-ink2 hover:border-ink3'}`}>
                    {a.name}
                  </button>
                ))}
              </div>
            );
          })()}
        </Field>
        </>
        )}
      </div>
    </div>
  );
}

const PERM_OPTS: { v: string; label: string; cls: string }[] = [
  { v: 'allow', label: 'Allow', cls: 'text-ok' },
  { v: 'ask', label: 'Ask', cls: 'text-accent-dark' },
  { v: 'deny', label: 'Deny', cls: 'text-rec' },
];

function PermSeg({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-0.5 bg-sidebar border border-sidebar-border rounded-[5px] p-0.5 flex-none">
      {PERM_OPTS.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)} title={o.label}
          className={`px-1.5 py-0.5 rounded-[3px] text-[11px] font-600 ${value === o.v ? `bg-card shadow-soft ${o.cls}` : 'text-sidebar-ink3'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
