import { useEffect, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import type { MeetingTemplate } from '../../types';
import { SHeader } from './primitives';

/** Manage meeting templates: describe-to-create, per-card conversational refine, set default,
 *  delete, and an Advanced raw editor. Users never have to write template markdown. */
export function MeetingTemplates() {
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [desc, setDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = () => api.listTemplates()
    .then((r) => { setTemplates(r.templates); setDefaultId(r.defaultTemplateId); })
    .catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    const d = desc.trim();
    if (!d || creating) return;
    setCreating(true); setErr(null);
    try {
      await api.generateTemplate(d);
      setDesc('');
      load();
    } catch {
      setErr('Could not create that template — check the AI provider in Settings → AI providers.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <SHeader title="Meeting templates" subtitle="Describe what you want from a kind of meeting — the copilot writes the template. Pick one when you record; it decides the outputs you get back." />
      <div className="overflow-y-auto px-8 py-5">
        {/* describe-to-create */}
        <div className="rounded-[14px] border border-border bg-card p-4 mb-5">
          <div className="text-[13px] font-550 text-ink mb-1.5">Describe a new meeting type</div>
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(); }}
            rows={2}
            placeholder="e.g. “Sales discovery calls — capture pain points, budget, timeline, and draft next-step email.”"
            className="w-full rounded-[10px] border border-border bg-bg px-3 py-2 text-[13px] text-ink outline-none focus:border-accent resize-none"
          />
          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={create} disabled={creating || !desc.trim()}
              className="px-3.5 py-1.5 rounded-[8px] bg-accent text-white text-[12.5px] font-550 disabled:opacity-50 hover:bg-accent-dark">
              {creating ? 'Creating…' : 'Create template'}
            </button>
            {err && <span className="text-[11.5px] text-rec">{err}</span>}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              isDefault={t.id === defaultId}
              onChanged={load}
            />
          ))}
          {templates.length === 0 && <div className="text-[12.5px] text-ink3">No templates yet — describe one above.</div>}
        </div>
      </div>
    </>
  );
}

function TemplateCard({ template, isDefault, onChanged }: {
  template: MeetingTemplate;
  isDefault: boolean;
  onChanged: () => void;
}) {
  const [refine, setRefine] = useState('');
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [full, setFull] = useState<MeetingTemplate | null>(null);
  const [body, setBody] = useState('');

  const doRefine = async () => {
    const instr = refine.trim();
    if (!instr || busy) return;
    setBusy(true);
    try { await api.reviseTemplate(template.id, instr); setRefine(''); onChanged(); }
    finally { setBusy(false); }
  };

  const openAdvanced = async () => {
    if (!advanced && !full) {
      const t = await api.getTemplate(template.id).catch(() => null);
      if (t) { setFull(t); setBody(t.body || ''); }
    }
    setAdvanced((v) => !v);
  };

  const saveAdvanced = async () => {
    await api.saveTemplate(template.id, { body }).catch(() => {});
    onChanged();
    setAdvanced(false);
  };

  return (
    <div className="rounded-[14px] border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-600 text-ink">{template.name}</span>
            {isDefault && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-soft text-accent-ink font-600">Default</span>}
          </div>
          <div className="text-[12px] text-ink3 mt-0.5">{template.description}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-none">
          {!isDefault && (
            <button type="button" onClick={() => api.setDefaultTemplate(template.id).then(onChanged)}
              className="text-[11.5px] px-2 py-1 rounded-[7px] border border-border text-ink3 hover:border-accent hover:text-accent">
              Make default
            </button>
          )}
          <button type="button" title="Delete template"
            onClick={() => { if (confirm(`Delete the “${template.name}” template?`)) api.deleteTemplate(template.id).then(onChanged); }}
            className="p-1.5 rounded-[7px] text-ink3 hover:text-rec hover:bg-hover">
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>

      {/* produces chips */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
        {template.sections.map((s) => (
          <span key={s.id} className="text-[11px] px-2 py-0.5 rounded-full bg-hover text-ink2">{s.title}</span>
        ))}
        {template.extract.todos && <span className="text-[11px] px-2 py-0.5 rounded-full border border-border-soft text-ink3">todos</span>}
        {template.extract.reminders && <span className="text-[11px] px-2 py-0.5 rounded-full border border-border-soft text-ink3">reminders</span>}
        {template.live.watch.length > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full border border-border-soft text-ink3" title="In-meeting live cues">
            live: {template.live.watch.length}
          </span>
        )}
      </div>

      {/* conversational refine */}
      <div className="flex items-center gap-2 mt-3">
        <input
          value={refine}
          onChange={(e) => setRefine(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') doRefine(); }}
          placeholder="Refine — e.g. “also capture budget discussions”"
          className="flex-1 rounded-[8px] border border-border bg-bg px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
        />
        <button type="button" onClick={doRefine} disabled={busy || !refine.trim()}
          className="px-2.5 py-1.5 rounded-[8px] text-[12px] text-accent disabled:opacity-40 hover:bg-accent-soft">
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>

      <button type="button" onClick={openAdvanced}
        className="mt-2 text-[11px] text-ink3 hover:text-ink2 flex items-center gap-1">
        <Icon name={advanced ? 'chevD' : 'chevR'} size={11} /> Advanced (edit instructions)
      </button>
      {advanced && (
        <div className="mt-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            className="w-full rounded-[10px] border border-border bg-bg px-3 py-2 text-[12px] font-mono text-ink outline-none focus:border-accent resize-y"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button type="button" onClick={saveAdvanced}
              className="px-3 py-1.5 rounded-[8px] bg-accent text-white text-[12px] font-550 hover:bg-accent-dark">Save</button>
            <button type="button" onClick={() => setAdvanced(false)} className="text-[12px] text-ink3 hover:text-ink2">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
