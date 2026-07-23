import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import type { McpServerConfig } from '../../types';

const RISK: Record<string, string> = { read: 'text-ink3', write: 'text-accent-dark', exec: 'text-rec', network: 'text-blue' };

const blankDraft = (): Partial<McpServerConfig> => ({
  name: '', transport: 'stdio', command: '', args: [], env: {}, url: '', headers: {}, risk: 'exec', enabled: true, pickedTools: [],
});

/** MCP tab: add external MCP servers, test the connection, pick which of the server's
 *  tools to expose, and save. Saved servers' picked tools appear in agent-options
 *  (namespaced mcp__<server>__<tool>) alongside built-in tools, for AgentForm's picker. */
export function McpManager() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');

  const load = () => api.listMcpServers().then((s) => { setServers(s); setSel((cur) => cur ?? s[0]?.name ?? null); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => (search ? servers.filter((s) => s.name.includes(search.toLowerCase())) : servers), [servers, search]);
  const selected = creating ? null : servers.find((s) => s.name === sel) ?? null;

  const startNew = () => { setCreating(true); setSel(null); };

  const del = async (name: string) => {
    if (!confirm(`Remove MCP server "${name}"? Agents using its tools will lose access to them.`)) return;
    await api.deleteMcpServer(name).catch(() => {});
    setSel(null);
    load();
  };

  return (
    <div className="flex-1 flex min-h-0">
      {/* list */}
      <div className="w-[220px] flex-none border-r border-border bg-bg flex flex-col min-h-0">
        <div className="p-2.5 flex-none flex flex-col gap-2">
          <div className="flex items-center gap-1.5 h-7 px-2 rounded-[6px] bg-card border border-border">
            <Icon name="search" size={12} color="var(--color-ink3)" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search servers…" className="flex-1 bg-transparent outline-none text-[12px] text-ink" />
          </div>
          <button type="button" onClick={startNew}
            className="flex items-center justify-center gap-1.5 h-7 rounded-[6px] border border-border text-ink2 text-[12px] hover:border-ink3">
            <Icon name="plus" size={12} /> Add MCP server
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {filtered.length === 0 && <div className="text-[12px] text-ink3 text-center py-6">No MCP servers yet</div>}
          {filtered.map((s) => (
            <button key={s.name} type="button" onClick={() => { setCreating(false); setSel(s.name); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left border-l-2 ${!creating && sel === s.name ? 'bg-accent-soft/40 border-accent' : 'border-transparent hover:bg-card/50'} ${!s.enabled ? 'opacity-50' : ''}`}>
              <span className="text-ink3 flex-none"><Icon name="zap" size={13} /></span>
              <span className={`flex-1 font-mono text-[12px] truncate ${sel === s.name ? 'text-ink' : 'text-ink2'}`}>{s.name}</span>
              {!s.enabled && <span className="text-[8.5px] text-ink3 font-mono">off</span>}
            </button>
          ))}
        </div>
      </div>

      {/* detail */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {creating ? (
          <ServerForm draft={blankDraft()} onSaved={(s) => { setCreating(false); setSel(s.name); load(); }} onCancel={() => setCreating(false)} />
        ) : selected ? (
          <ServerDetail key={selected.name} server={selected} onSaved={load} onDelete={() => del(selected.name)} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-ink3 text-[13px]">Select a server, or add a new one.</div>
        )}
      </div>
    </div>
  );
}

function ServerDetail({ server, onSaved, onDelete }: { server: McpServerConfig; onSaved: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const toggle = () => api.patchMcpServer(server.name, { enabled: !server.enabled }).then(onSaved).catch(() => {});

  if (editing) {
    return <ServerForm draft={server} onSaved={() => { setEditing(false); onSaved(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-7 py-4 border-b border-border bg-bg flex-none">
        <span className="text-ink3"><Icon name="zap" size={18} /></span>
        <div className="flex-1 min-w-0">
          <div className="font-serif text-[16px] text-ink truncate leading-tight">{server.name}</div>
          <div className="text-[11.5px] text-ink3">
            {server.transport === 'stdio' ? `stdio · ${server.command}` : `http · ${server.url}`}
            {' · risk: '}<span className={`font-mono ${RISK[server.risk] ?? 'text-ink3'}`}>{server.risk}</span>
          </div>
        </div>
        <button type="button" onClick={() => setEditing(true)} title="Edit connection"
          className="flex-none w-7 h-7 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3">
          <Icon name="edit" size={13} />
        </button>
        <button type="button" onClick={onDelete} title="Remove server"
          className="flex-none w-7 h-7 grid place-items-center rounded-[7px] border border-border text-ink3 hover:text-rec hover:border-rec">
          <Icon name="trash" size={13} />
        </button>
        <button type="button" onClick={toggle} title={server.enabled ? 'Enabled — picked tools are available to agents' : 'Disabled — hidden from agents'}
          className={`relative w-[38px] h-[22px] rounded-full transition-colors flex-none ${server.enabled ? 'bg-accent' : 'bg-border'}`}>
          <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all ${server.enabled ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        <div className="text-[12.5px] font-550 text-ink mb-2">Picked tools</div>
        <div className="text-[11px] text-ink3 mb-3">
          These appear in agents' tool picker as <span className="font-mono">mcp__{server.name}__&lt;tool&gt;</span>.
          Re-test the connection to add or remove tools.
        </div>
        {server.pickedTools.length === 0 ? (
          <div className="text-[12px] text-ink3">No tools picked yet — edit the server to test the connection and select tools.</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {server.pickedTools.map((t) => (
              <div key={t} className="flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[12.5px]">
                <Icon name="check" size={12} />
                <span className="font-mono text-ink">{t}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ServerForm({ draft, onSaved, onCancel }: {
  draft: Partial<McpServerConfig>;
  onSaved: (s: McpServerConfig) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(draft.name ?? '');
  const [transport, setTransport] = useState<'stdio' | 'http'>(draft.transport ?? 'stdio');
  const [command, setCommand] = useState(draft.command ?? '');
  const [argsText, setArgsText] = useState((draft.args ?? []).join(' '));
  const [envText, setEnvText] = useState(Object.entries(draft.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
  const [url, setUrl] = useState(draft.url ?? '');
  const [headersText, setHeadersText] = useState(Object.entries(draft.headers ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'));
  const [risk, setRisk] = useState<McpServerConfig['risk']>(draft.risk ?? 'exec');

  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState('');
  const [discovered, setDiscovered] = useState<{ name: string; description: string }[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(draft.pickedTools ?? []));
  const [saving, setSaving] = useState(false);

  const parseKv = (text: string) => Object.fromEntries(
    text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const i = l.indexOf('=');
      return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );

  const buildCfg = (): Partial<McpServerConfig> => ({
    name: name.trim(),
    transport,
    risk,
    ...(transport === 'stdio'
      ? { command: command.trim(), args: argsText.split(/\s+/).filter(Boolean), env: parseKv(envText) }
      : { url: url.trim(), headers: parseKv(headersText) }),
  });

  const canTest = name.trim() && (transport === 'stdio' ? command.trim() : url.trim());

  const test = async () => {
    if (!canTest) return;
    setTesting(true); setTestError(''); setDiscovered(null);
    try {
      const res = await api.testMcpServer(buildCfg());
      if (res.ok) {
        setDiscovered(res.tools ?? []);
        setPicked(new Set((res.tools ?? []).map((t) => t.name)));
      } else {
        setTestError(res.error || 'Connection failed.');
      }
    } catch (e) {
      setTestError(e instanceof Error ? e.message : 'Connection failed.');
    }
    setTesting(false);
  };

  const togglePick = (toolName: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(toolName)) n.delete(toolName); else n.add(toolName);
    return n;
  });

  const save = async () => {
    if (!discovered) return;
    setSaving(true);
    try {
      const saved = await api.saveMcpServer({ ...buildCfg(), enabled: draft.enabled ?? true, pickedTools: [...picked] });
      onSaved(saved);
    } catch { /* noop */ }
    setSaving(false);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-3 px-7 py-4 border-b border-border bg-bg flex-none">
        <span className="text-ink3"><Icon name="zap" size={18} /></span>
        <div className="flex-1 font-serif text-[16px] text-ink">{draft.name ? 'Edit MCP server' : 'Add MCP server'}</div>
        <button type="button" onClick={onCancel} className="flex-none w-7 h-7 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3">
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6 flex flex-col gap-4 max-w-[640px]">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-ink2">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. github" disabled={!!draft.name}
            className="h-[32px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12.5px] font-mono outline-none disabled:opacity-60" />
        </label>

        <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[6px] p-0.5 w-fit">
          {(['stdio', 'http'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTransport(t)}
              className={`px-3 py-1 rounded-[4px] text-[12px] uppercase ${transport === t ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
              {t}
            </button>
          ))}
        </div>

        {transport === 'stdio' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink2">Command</span>
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx"
                className="h-[32px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12.5px] font-mono outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink2">Args <span className="text-ink3">(space-separated)</span></span>
              <input value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder="-y @modelcontextprotocol/server-github"
                className="h-[32px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12.5px] font-mono outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink2">Env <span className="text-ink3">(KEY=value, one per line)</span></span>
              <textarea value={envText} onChange={(e) => setEnvText(e.target.value)} rows={3} spellCheck={false} placeholder="GITHUB_TOKEN=ghp_…"
                className="px-2.5 py-2 rounded-[6px] border border-border bg-bg text-ink text-[12px] font-mono outline-none resize-y" />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink2">URL</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp"
                className="h-[32px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12.5px] font-mono outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-ink2">Headers <span className="text-ink3">(Key=value, one per line)</span></span>
              <textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)} rows={3} spellCheck={false} placeholder="Authorization=Bearer …"
                className="px-2.5 py-2 rounded-[6px] border border-border bg-bg text-ink text-[12px] font-mono outline-none resize-y" />
            </label>
          </>
        )}

        <label className="flex items-center gap-3">
          <span className="text-[12px] text-ink2 w-[110px]">Default risk</span>
          <select value={risk} onChange={(e) => setRisk(e.target.value as McpServerConfig['risk'])}
            className="h-[30px] px-2 rounded-[6px] border border-border bg-bg text-ink text-[12px] outline-none">
            <option value="exec">exec (conservative — asks/blocks by default)</option>
            <option value="read">read (trusted read-only server)</option>
            <option value="write">write</option>
            <option value="network">network</option>
          </select>
        </label>

        <div className="pt-2 border-t border-border">
          <button type="button" onClick={test} disabled={!canTest || testing}
            className="h-[32px] px-3.5 rounded-[6px] bg-accent text-white text-[12.5px] font-550 inline-flex items-center gap-1.5 disabled:opacity-50">
            <Icon name="refresh" size={13} /> {testing ? 'Testing connection…' : 'Test connection'}
          </button>
          {testError && <div className="mt-2 text-[12px] text-rec">{testError}</div>}
        </div>

        {discovered && (
          <div>
            <div className="text-[12.5px] font-550 text-ink mb-1">
              {discovered.length} tool{discovered.length === 1 ? '' : 's'} found — pick which to expose
            </div>
            {discovered.length === 0 ? (
              <div className="text-[12px] text-ink3">This server reports no tools.</div>
            ) : (
              <div className="flex flex-col gap-1.5 mt-2">
                {discovered.map((t) => (
                  <label key={t.name} className="flex items-start gap-2 px-2.5 py-1.5 rounded-[6px] border border-border bg-card text-[12.5px] cursor-pointer">
                    <input type="checkbox" checked={picked.has(t.name)} onChange={() => togglePick(t.name)} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-ink">{t.name}</div>
                      {t.description && <div className="text-[11.5px] text-ink3 mt-0.5">{t.description}</div>}
                    </div>
                  </label>
                ))}
              </div>
            )}
            <button type="button" onClick={save} disabled={saving}
              className="mt-3 h-[32px] px-3.5 rounded-[6px] bg-accent text-white text-[12.5px] font-550 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Icon name="check" size={13} /> {saving ? 'Saving…' : `Save (${picked.size} tool${picked.size === 1 ? '' : 's'})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
