import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import type { Agent, Tile, TileOutputFormat, TileStyle, TileRefresh } from '../../types';
import { SchedulePicker } from '../../components/SchedulePicker';
import { cronDaily } from '../../types/schedule';

const FORMATS: { id: TileOutputFormat; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'list', label: 'Assistants' },
  { id: 'metric', label: 'Metric' },
  { id: 'table', label: 'Table' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'diff', label: 'Diff' },
];
const FORMAT_LABEL: Record<TileOutputFormat, string> = Object.fromEntries(FORMATS.map((f) => [f.id, f.label])) as Record<TileOutputFormat, string>;

// Card chrome, independent of output format — same 4 variants as Tile.tsx's
// STYLE_FRAME map, previewed here as a tiny swatch built from the same tokens.
const STYLES: { id: TileStyle; label: string; description: string; fancy?: boolean }[] = [
  { id: 'card', label: 'Card', description: 'Soft shadow, filled surface (default)' },
  { id: 'flat', label: 'Flat', description: 'No border or shadow — sits flush with the board' },
  { id: 'outlined', label: 'Outlined', description: 'Thicker border, no shadow' },
  { id: 'accent-bar', label: 'Accent bar', description: 'Card with a colored left edge' },
  { id: 'glass', label: 'Glass', description: 'Frosted, translucent — blurs whatever is behind it', fancy: true },
  { id: 'glow', label: 'Glow', description: 'Soft ambient accent-colored halo', fancy: true },
  { id: 'gradient-edge', label: 'Gradient edge', description: 'Slow-spinning gradient ring around the border', fancy: true },
];
// Swatches reuse the real chrome classes (defined in index.css for the fancy
// trio) so the picker preview matches the actual tile pixel-for-pixel.
const STYLE_SWATCH: Record<TileStyle, string> = {
  card: 'bg-card border border-border shadow-soft',
  flat: 'bg-sidebar border border-transparent',
  outlined: 'bg-bg border-2 border-border',
  'accent-bar': 'bg-card border border-border shadow-soft border-l-[3px] border-l-accent',
  glass: 'tile-glass',
  glow: 'tile-glow',
  'gradient-edge': 'tile-gradient-edge',
};

// Predefined output shapes: picking one sets ONLY format + empty-message (+ a
// markdown skeleton for the markdown shapes) — Focus/Rules are left untouched,
// so switching templates never overwrites what the user has typed. Distinct
// entries exist per shape, not per "kind of tile" — e.g. there's one List
// template, not a separate one per use case, since nothing else varies.
type Template = {
  id: string;
  label: string;
  description: string;
  outputFormat: TileOutputFormat;
  emptyMessage: string;
  // Only meaningful for outputFormat: 'markdown' — a concrete heading/section
  // skeleton the agent is told to fill in verbatim, so repeated runs come back
  // with the same structure instead of the agent inventing new headings each time.
  markdownTemplate?: string;
};
const TEMPLATES: Template[] = [
  {
    id: 'summary', label: 'Summary', description: 'A few sentences of prose',
    outputFormat: 'summary', emptyMessage: 'Nothing to report.',
  },
  {
    id: 'list', label: 'List', description: 'A bulleted list, one item per line',
    outputFormat: 'list', emptyMessage: 'Nothing to report.',
  },
  {
    id: 'metric', label: 'Metric', description: 'One headline number with a short label',
    outputFormat: 'metric', emptyMessage: '0',
  },
  {
    id: 'table', label: 'Table', description: 'Rows of related items as a markdown table',
    outputFormat: 'table', emptyMessage: 'No rows to show.',
  },
  {
    id: 'briefing', label: 'Briefing doc', description: 'Fixed headings: Summary, Key facts, Open questions',
    outputFormat: 'markdown', emptyMessage: 'Nothing to brief on right now.',
    markdownTemplate: '## Summary\n(one or two sentences)\n\n## Key facts\n- \n\n## Open questions\n- ',
  },
  {
    id: 'meeting-brief', label: 'Meeting brief', description: 'Fixed headings: Decisions, Action items, Follow-ups',
    outputFormat: 'markdown', emptyMessage: 'Nothing to report.',
    markdownTemplate: '## Decisions\n- \n\n## Action items\n- \n\n## Follow-ups\n- ',
  },
  {
    id: 'markdown-free', label: 'Free-form markdown', description: 'No fixed structure — the agent chooses headings',
    outputFormat: 'markdown', emptyMessage: 'Nothing to report.',
  },
  {
    id: 'diff', label: 'Diff', description: 'What changed since last time — additions and removals',
    outputFormat: 'diff', emptyMessage: 'No changes since last run.',
  },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12.5px] font-550 text-ink mb-1">{label}</div>
      {hint && <div className="text-[11px] text-ink3 mb-1.5">{hint}</div>}
      {children}
    </div>
  );
}

/** One ordered form: agent (fixed once created) → Focus → Rules → output format →
 *  refresh. No canvas, no nodes — Focus/Rules are the plain-language brief the
 *  agent uses its own tools to satisfy, same as a chat message.
 *
 *  Renders as an inline panel inside DashboardScreen's content area (swapped in
 *  place of the tile grid), not a floating modal — a generate call can run for a
 *  few seconds, and the app's tabs are keep-alive-mounted (see App.tsx), so the
 *  user can switch to another page and back without losing progress or getting
 *  blocked from the rest of the app while it's in flight.
 *
 *  Setup mode: AI or Manual. AI asks one plain-language question ("what do you
 *  need?"), sends it to the tile's own agent via /generate-config, and fills in
 *  Title/Focus/Rules/format/empty-message from the result — then drops into
 *  Manual so the user reviews/edits before saving, same as /agents/generate's
 *  draft-then-edit shape. Refresh is drafted only when the need itself states a
 *  cadence or trigger ("every morning at 8", "when a recording is transcribed");
 *  tile style is never AI-guessed — nothing about "what to show" implies a look. */
export function TileConfigPanel({
  tile, agent, triggerTypes, boardId, onClose, onSave,
}: {
  tile: Tile;
  agent: Agent | undefined;
  triggerTypes: string[];
  boardId: string;
  onClose: () => void;
  onSave: (patch: { title: string; config: Tile['config'] }) => Promise<void>;
}) {
  // A brand-new tile (never configured) opens straight into AI mode — that's
  // the fast path this feature exists for. A tile with an existing brief opens
  // in Manual so editing it doesn't get ambushed by the AI question first.
  const isFreshTile = !tile.config.focus.trim() && !tile.config.rules.trim();
  const [mode, setMode] = useState<'ai' | 'manual'>(isFreshTile ? 'ai' : 'manual');
  const [need, setNeed] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [title, setTitle] = useState(tile.title);
  const [focus, setFocus] = useState(tile.config.focus);
  const [rules, setRules] = useState(tile.config.rules);
  const [format, setFormat] = useState<TileOutputFormat>(tile.config.outputFormat);
  const [emptyMessage, setEmptyMessage] = useState(tile.config.emptyMessage ?? '');
  const [markdownTemplate, setMarkdownTemplate] = useState(tile.config.markdownTemplate ?? '');
  const [style, setStyle] = useState<TileStyle>(tile.config.style ?? 'card');
  const [alert, setAlert] = useState(tile.config.alert ?? '');
  const [refresh, setRefresh] = useState<TileRefresh>(tile.config.refresh);
  const [saving, setSaving] = useState(false);
  const [templateId, setTemplateId] = useState<string | null>(null);

  const applyTemplate = (t: Template) => {
    // Templates only ever set format + empty-message (+ markdown skeleton) —
    // Focus/Rules are the user's own words and are never touched here.
    setTemplateId(t.id);
    setFormat(t.outputFormat);
    setEmptyMessage(t.emptyMessage);
    setMarkdownTemplate(t.markdownTemplate ?? '');
  };

  const generate = async () => {
    if (!need.trim() || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const cfg = await api.generateTileConfig(boardId, tile.id, need.trim());
      setTitle(cfg.title);
      setFocus(cfg.focus);
      setRules(cfg.rules);
      setFormat(cfg.outputFormat);
      // Drafted skeleton when the AI picked markdown; '' otherwise — always applied,
      // so a stale skeleton from a previous markdown setup can't outlive a format switch.
      setMarkdownTemplate(cfg.markdownTemplate);
      setEmptyMessage(cfg.emptyMessage);
      // alert / refresh are only drafted when the need itself asked for them ("notify
      // me if…", "every morning at 8") — otherwise the tile's existing values stay.
      if (cfg.alert) setAlert(cfg.alert);
      if (cfg.refresh) setRefresh(cfg.refresh);
      setTemplateId(null);
      setMode('manual');
    } catch {
      setGenerateError("Couldn't generate a setup — check the active AI provider in Settings, or switch to Manual.");
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ title: title.trim() || tile.title, config: { focus, rules, outputFormat: format, emptyMessage, markdownTemplate, style, alert, refresh } });
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-bg">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card flex-none">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} title="Back to board"
            className="flex items-center justify-center w-8 h-8 rounded-[8px] text-ink3 hover:text-ink hover:bg-bg">
            <span className="rotate-180 inline-flex"><Icon name="arrowR" size={16} /></span>
          </button>
          <div>
            <h2 className="font-serif text-[18px] text-ink">Configure tile</h2>
            <div className="text-[11.5px] text-ink3">{agent?.name ?? tile.agentId}</div>
          </div>
        </div>
      </div>

        <div className="flex items-center gap-1 bg-sidebar border-b border-sidebar-border px-6 py-2.5 flex-none">
          <div className="flex gap-1 bg-card border border-border rounded-[7px] p-0.5">
            <button type="button" onClick={() => setMode('ai')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[12px] font-550 ${mode === 'ai' ? 'bg-accent text-white' : 'text-ink3'}`}>
              <Icon name="sparkle" size={12} /> AI
            </button>
            <button type="button" onClick={() => setMode('manual')}
              className={`px-3 py-1 rounded-[5px] text-[12px] font-550 ${mode === 'manual' ? 'bg-card text-ink shadow-soft' : 'text-ink3'}`}>
              Manual
            </button>
          </div>
          <span className="text-[11px] text-ink3 ml-1">
            {mode === 'ai' ? 'Describe what you need — the agent drafts the setup for you.' : 'Fill in the tile\'s setup yourself.'}
          </span>
        </div>

        {mode === 'ai' ? (
          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-3">
            <Field label="What do you need on this tile?" hint={`${agent?.name ?? tile.agentId} will use this to draft a title, focus, rules, output shape — and a schedule, if you say when to run — you can review and tweak everything before saving.`}>
              <textarea value={need} onChange={(e) => setNeed(e.target.value)} rows={4} autoFocus
                placeholder="e.g. Every morning at 8, show urgent unread emails from the last day as a short list. Or: track how many todos are overdue as a single number."
                className="w-full px-2.5 py-2 rounded-[6px] border border-border bg-card text-ink text-[13px] outline-none resize-none" />
            </Field>
            {generateError && <div className="text-[12px] text-rec">{generateError}</div>}
            <div className="flex items-center gap-2">
              <button type="button" onClick={generate} disabled={!need.trim() || generating}
                className="px-4 py-1.5 rounded-[8px] bg-accent text-white text-[12.5px] font-550 inline-flex items-center gap-1.5 disabled:opacity-50">
                <span className={generating ? 'animate-spin' : ''}><Icon name={generating ? 'refresh' : 'sparkle'} size={13} /></span>
                {generating ? 'Generating…' : 'Generate setup'}
              </button>
              {(focus.trim() || rules.trim()) && !generating && (
                <span className="text-[11px] text-ink3">Already has a setup — generating will replace Title/Focus/Rules/Output format (and Alert/Schedule if your ask mentions them).</span>
              )}
            </div>
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
          <Field label="Title">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={agent?.name}
              className="w-full h-[32px] px-2.5 rounded-[6px] border border-border bg-card text-ink text-[13px] outline-none" />
          </Field>

          <Field label="Focus" hint="Plain language: what should this tile watch or report on? The agent uses its own tools to go get it.">
            <textarea value={focus} onChange={(e) => setFocus(e.target.value)} rows={3}
              placeholder="e.g. Unread emails tagged urgent, or todos due this week for Project Atlas"
              className="w-full px-2.5 py-2 rounded-[6px] border border-border bg-card text-ink text-[13px] outline-none resize-none" />
          </Field>

          <Field label="Rules" hint="Optional constraints layered on top of Focus (length, filters, tone).">
            <textarea value={rules} onChange={(e) => setRules(e.target.value)} rows={2}
              placeholder="e.g. Only flag items over $100. Limit to 5 bullets."
              className="w-full px-2.5 py-2 rounded-[6px] border border-border bg-card text-ink text-[13px] outline-none resize-none" />
          </Field>

          <Field label="Output format" hint="Sets how the reply is shaped and shown. Doesn't touch Focus or Rules.">
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => {
                const active = templateId
                  ? templateId === t.id
                  : format === t.outputFormat && (markdownTemplate || '') === (t.markdownTemplate || '');
                return (
                  <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                    className={`flex flex-col items-start gap-1 px-3 py-2 rounded-[8px] border text-left ${
                      active ? 'border-accent bg-accent-soft/30' : 'border-border bg-card hover:border-ink3'}`}>
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span className="text-[12.5px] text-ink font-550">{t.label}</span>
                      {/* Only show the badge when it says something the title doesn't
                          (e.g. multiple markdown shapes) — a "List" card badged LIST
                          is just noise. */}
                      {t.label !== FORMAT_LABEL[t.outputFormat] && (
                        <span className="flex-none px-1.5 py-0.5 rounded-full text-[9.5px] font-600 uppercase tracking-wide bg-accent-soft text-accent-ink">
                          {FORMAT_LABEL[t.outputFormat]}
                        </span>
                      )}
                    </div>
                    <span className="text-[10.5px] text-ink3">{t.description}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          {format === 'markdown' && (
            <Field label="Markdown structure" hint="The exact headings the agent fills in each run, so this tile's shape stays consistent. Leave blank to let the agent structure it freely.">
              <textarea value={markdownTemplate} onChange={(e) => setMarkdownTemplate(e.target.value)} rows={5}
                placeholder={'## Summary\n(one or two sentences)\n\n## Key facts\n- '}
                className="w-full px-2.5 py-2 rounded-[6px] border border-border bg-card text-ink text-[12.5px] font-mono outline-none resize-none" />
            </Field>
          )}

          <Field label="When there's nothing to show" hint="Shown instead of a blank tile when nothing is found.">
            <input value={emptyMessage} onChange={(e) => setEmptyMessage(e.target.value)} placeholder="Nothing to report."
              className="w-full h-[32px] px-2.5 rounded-[6px] border border-border bg-card text-ink text-[13px] outline-none" />
          </Field>

          <Field label="Alert" hint="Optional. When set, the agent gets a notify tool for this run — it decides whether this run's result actually meets the condition, and only then sends you a desktop notification.">
            <div className="flex items-start gap-2">
              <span className="flex-none mt-2 text-ink3"><Icon name="bell" size={14} /></span>
              <textarea value={alert} onChange={(e) => setAlert(e.target.value)} rows={2}
                placeholder="e.g. Notify me if there are more than 3 urgent unread emails"
                className="w-full px-2.5 py-2 rounded-[6px] border border-border bg-card text-ink text-[13px] outline-none resize-none" />
            </div>
          </Field>

          <Field label="Tile style" hint="How the tile's card looks on the board. Works with whichever theme you're using.">
            <div className="grid grid-cols-5 gap-2">
              {STYLES.map((s) => (
                <button key={s.id} type="button" onClick={() => setStyle(s.id)}
                  className={`relative flex flex-col items-center gap-1.5 px-2 py-2 rounded-[8px] border text-center ${
                    style === s.id ? 'border-accent bg-accent-soft/30' : 'border-border bg-card hover:border-ink3'}`}>
                  {s.fancy && (
                    <span className="absolute top-1 right-1 text-accent" title="Fancy">
                      <Icon name="sparkle" size={10} />
                    </span>
                  )}
                  <span className={`w-full h-[26px] rounded-[5px] ${STYLE_SWATCH[s.id]}`} />
                  <span className="text-[11px] text-ink font-550">{s.label}</span>
                </button>
              ))}
            </div>
            <div className="text-[10.5px] text-ink3 mt-1.5">{STYLES.find((s) => s.id === style)?.description}</div>
          </Field>

          <Field label="Refresh" hint="When this tile re-runs its agent.">
            <RefreshPicker value={refresh} onChange={setRefresh} triggerTypes={triggerTypes} />
          </Field>
        </div>
        )}

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-card flex-none">
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 rounded-[8px] text-[12.5px] text-ink2 hover:bg-bg">Cancel</button>
          {mode === 'manual' && (
            <button type="button" onClick={save} disabled={saving}
              className="px-4 py-1.5 rounded-[8px] bg-accent text-white text-[12.5px] font-550 inline-flex items-center gap-1.5 disabled:opacity-50">
              <Icon name="check" size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
    </div>
  );
}


function RefreshPicker({ value, onChange, triggerTypes }: {
  value: TileRefresh; onChange: (r: TileRefresh) => void; triggerTypes: string[];
}) {
  const mode = value.mode;
  const setMode = (m: TileRefresh['mode']) => {
    if (m === 'manual') onChange({ mode: 'manual' });
    else if (m === 'schedule') onChange({ mode: 'schedule', schedule: cronDaily('09:00') });
    else onChange({ mode: 'event', eventType: triggerTypes[0] ?? '' });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[7px] p-0.5 w-fit">
        {(['manual', 'schedule', 'event'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`px-2.5 py-1 rounded-[5px] text-[12px] capitalize ${mode === m ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
            {m === 'manual' ? 'Manual' : m === 'schedule' ? 'Schedule' : 'On event'}
          </button>
        ))}
      </div>
      {value.mode === 'schedule' && (
        <SchedulePicker value={value.schedule} onChange={(s) => onChange({ mode: 'schedule', schedule: s })} />
      )}
      {value.mode === 'event' && (
        <select value={value.eventType} title="Trigger event" onChange={(e) => onChange({ mode: 'event', eventType: e.target.value })}
          className="h-[30px] px-2 rounded-[6px] border border-border bg-card text-ink text-[12.5px] font-mono outline-none cursor-pointer w-fit">
          {triggerTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}
    </div>
  );
}
