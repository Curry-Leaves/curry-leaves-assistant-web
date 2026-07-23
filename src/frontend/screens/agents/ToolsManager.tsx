import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import type { ToolInfo } from '../../types';
import { DetailHeader, Field, Stat, BODY_CLS, MONO_CLS, SECTION_CLS } from './formKit';

const RISK: Record<string, string> = { read: 'text-ink3', write: 'text-accent-dark', exec: 'text-rec', query: 'text-blue' };
// A tool's risk, said plainly — the bare word ("exec") means little on its own.
const RISK_HINT: Record<string, string> = {
  read: 'Reads data only',
  write: 'Can change your data',
  exec: 'Can run commands',
  query: 'Queries an external service',
};

/** Tools tab: list every agent tool, show its details + config (saved to
 *  ~/.curry-leaves/agents/tools/tools.json). */
export function ToolsManager() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = () => api.listTools().then((ts) => { setTools(ts); setSel((s) => s ?? ts[0]?.name ?? null); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => (search ? tools.filter((t) => t.name.includes(search.toLowerCase())) : tools), [tools, search]);
  const selected = tools.find((t) => t.name === sel) ?? null;

  const toggle = (t: ToolInfo) => api.patchTool(t.name, { enabled: !t.enabled }).then(load).catch(() => {});

  return (
    <div className="flex-1 flex min-h-0">
      {/* list */}
      <div className="w-[248px] flex-none border-r border-border bg-bg flex flex-col min-h-0">
        <div className="p-3 flex-none">
          <div className="flex items-center gap-1.5 px-2 rounded-[6px] bg-card border border-border h-[30px] focus-within:border-accent-soft">
            <Icon name="search" size={12} color="var(--color-ink3)" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tools…"
              className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] text-ink placeholder:text-ink3" />
          </div>
        </div>
        <div className="px-3 pb-1.5 flex-none flex items-center justify-between">
          <span className={SECTION_CLS}>Tools</span>
          <span className={SECTION_CLS}>{filtered.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
          {filtered.length === 0 && <div className={`${BODY_CLS} text-center py-8`}>No tools match.</div>}
          {filtered.map((t) => (
            <button key={t.name} type="button" onClick={() => setSel(t.name)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-[7px] text-left ${sel === t.name ? 'bg-accent-soft/50' : 'hover:bg-card'}`}>
              {/* A dot carries enabled/disabled — clearer than dimming the whole row and
                  tucking an 8.5px "off" beside it. */}
              <span className={`w-1.5 h-1.5 rounded-full flex-none ${t.enabled ? 'bg-ok' : 'bg-faint'}`}
                title={t.enabled ? 'Enabled' : 'Disabled'} />
              <span className={`flex-1 truncate ${MONO_CLS} ${sel === t.name ? 'text-ink' : t.enabled ? 'text-ink2' : 'text-ink3'}`}>{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* detail */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {selected ? <ToolDetail key={selected.name} tool={selected} onToggle={() => toggle(selected)} onSaved={load} /> : (
          <div className={`flex-1 grid place-items-center ${BODY_CLS}`}>Select a tool.</div>
        )}
      </div>
    </div>
  );
}

function ToolDetail({ tool, onToggle, onSaved }: { tool: ToolInfo; onToggle: () => void; onSaved: () => void }) {
  const [cfg, setCfg] = useState(JSON.stringify(tool.config ?? {}, null, 2));
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setCfg(JSON.stringify(tool.config ?? {}, null, 2)); setErr(''); }, [tool.name, tool.config]);

  const props = tool.schema?.properties ?? {};
  const required = tool.schema?.required ?? [];

  const save = async () => {
    let parsed: Record<string, unknown>;
    try { parsed = cfg.trim() ? JSON.parse(cfg) : {}; } catch { setErr('Invalid JSON'); return; }
    setErr('');
    await api.patchTool(tool.name, { config: parsed }).catch(() => {});
    setSaved(true); setTimeout(() => setSaved(false), 1600); onSaved();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <DetailHeader
        badge={<span className="w-11 h-11 rounded-[10px] bg-border-soft text-ink3 grid place-items-center flex-none"><Icon name="settings" size={18} /></span>}
        title={tool.name}
        facts={<>
          <Stat tone={tool.risk === 'exec' ? 'danger' : undefined} title={`risk: ${tool.risk}`}>
            {RISK_HINT[tool.risk] ?? tool.risk}
          </Stat>
          {!tool.enabled && <Stat tone="warn">Disabled</Stat>}
          <Stat>{Object.keys(props).length} input{Object.keys(props).length === 1 ? '' : 's'}</Stat>
        </>}
        actions={
          <button type="button" onClick={onToggle} title={tool.enabled ? 'Enabled — agents can use it' : 'Disabled — hidden from agents'}
            className={`relative w-[38px] h-[22px] rounded-full transition-colors flex-none ${tool.enabled ? 'bg-accent' : 'bg-border'}`}>
            <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${tool.enabled ? 'left-[18px]' : 'left-0.5'}`} />
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto px-8 py-4">
        <Field label="What it does">
          <p className={`${BODY_CLS} leading-relaxed`}>{tool.description || 'No description.'}</p>
        </Field>

        <Field label="Inputs" wide hint="The parameters an agent passes when it calls this tool.">
          {Object.keys(props).length === 0 ? (
            <div className={BODY_CLS}>This tool takes no inputs.</div>
          ) : (
            /* A real two-column table: name+type in a fixed column, description beside it.
               Previously these were baseline-aligned inline spans at three different sizes,
               so nothing lined up once a description wrapped. */
            <div className="rounded-[8px] border border-border bg-card overflow-hidden">
              {Object.entries(props).map(([k, v], i) => (
                <div key={k} className={`grid grid-cols-[200px_minmax(0,1fr)] gap-4 px-3 py-2 items-baseline ${i > 0 ? 'border-t border-border-soft' : ''}`}>
                  <div className="min-w-0">
                    <span className={`${MONO_CLS} text-ink`}>{k}</span>
                    {required.includes(k) && <span className="ml-1.5 text-[11px] text-rec">required</span>}
                    <div className={`${MONO_CLS} text-ink3`}>{v.type ?? 'any'}</div>
                  </div>
                  <span className={BODY_CLS}>{v.description || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </Field>

        <Field label="Config" wide hint="Saved to ~/.curry-leaves/agents/tools/tools.json and read by agents at run time.">
          <textarea value={cfg} onChange={(e) => setCfg(e.target.value)} rows={8} spellCheck={false}
            className={`w-full px-2.5 py-2 rounded-[6px] border bg-card text-ink ${MONO_CLS} leading-relaxed outline-none resize-y ${err ? 'border-rec' : 'border-border focus:border-accent-soft'}`} />
          <div className="flex items-center gap-3 mt-2">
            <button type="button" onClick={save}
              className="h-[30px] px-3 rounded-[8px] bg-accent text-white text-[12.5px] font-550 inline-flex items-center gap-1.5">
              <Icon name="check" size={13} /> {saved ? 'Saved' : 'Save config'}
            </button>
            {err && <span className="text-[12.5px] text-rec">{err}</span>}
          </div>
        </Field>
      </div>
    </div>
  );
}
