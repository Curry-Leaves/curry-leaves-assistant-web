import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { avatarColor } from './OfficeView';
import type { Agent } from '../../types';

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'assistant';
const initials = (n: string) => (n.trim() ? n.split(/[\s(]/)[0].slice(0, 2).toUpperCase() : '·');

// What generateAgent returns, plus the emphasis we seeded it with.
type Draft = {
  name: string; description: string; instructions: string; tools: string[]; triggers: string[];
  emphasis: string;
};

// Role templates — a tap pre-fills the prompt. Replaces the old GenerateBox freeform-only entry.
const TEMPLATES: { label: string; prompt: string }[] = [
  { label: 'News Scout', prompt: 'Watch the web for topics I care about and post a short morning digest of what changed.' },
  { label: 'Inbox Watcher', prompt: 'Keep an eye on my recordings and notes for action items I said I would do, and remind me.' },
  { label: 'Note Gardener', prompt: 'Keep my knowledge base tidy — fix broken links, merge duplicates, and flag stale notes.' },
  { label: 'Meeting Sidekick', prompt: 'Join my meetings, take live notes, and summarize decisions and action items afterwards.' },
  { label: 'Daily Planner', prompt: 'Each morning, look at my todos and reminders and lay out a focused plan for the day.' },
  { label: 'Research Analyst', prompt: 'Dig deep into a question I give you — gather sources, cross-link my notes, and write up findings.' },
];

// Three emphases so the drafts genuinely differ, not just in name.
const EMPHASES = [
  { key: 'Focused', hint: 'Keep it minimal: the fewest tools, terse output, and only run when clearly needed.' },
  { key: 'Thorough', hint: 'Be comprehensive: use more tools, cross-reference sources, and give detailed, well-organized output.' },
  { key: 'On-call', hint: 'Prefer running automatically from event triggers and schedules rather than on manual request; stay quiet until something matters.' },
];

/** The two-step hire flow: describe a role → pick one of three drafted candidates.
 *  "Hire" saves the draft immediately; "Tweak first" hands it to the full form.
 *  `onHired` fires with the saved agent (AgentsScreen shows it + plays the office entrance).
 *  `onTweak` hands an unsaved draft to AgentForm. */
export function HireWizard({ existingIds, onHired, onTweak, onCancel }: {
  existingIds: string[];
  onHired: (a: Agent) => void;
  onTweak: (draft: Partial<Agent>) => void;
  onCancel: () => void;
}) {
  const [role, setRole] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [hiringId, setHiringId] = useState<string | null>(null);  // which draft's Hire is in-flight

  const draftCandidates = async () => {
    if (!role.trim() || loading) return;
    setLoading(true); setError(null); setDrafts([]);
    try {
      const results = await Promise.allSettled(
        EMPHASES.map((e) => api.generateAgent(`${role.trim()}\n\nApproach — ${e.hint}`)),
      );
      const ok: Draft[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') ok.push({ ...r.value, emphasis: EMPHASES[i].key });
      });
      if (ok.length === 0) {
        setError('Drafting failed — check the active provider/model in Settings.');
      } else {
        setDrafts(ok);
        setStep(2);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Drafting failed.');
    }
    setLoading(false);
  };

  // A slug that doesn't collide with an existing agent — the LLM can hand back near-
  // identical names across the three drafts ("web-digest" / "web_watch_digest"), and two
  // colliding ids would silently overwrite one another on save.
  const uniqueId = (name: string): string => {
    const base = slug(name);
    if (!existingIds.includes(base)) return base;
    for (let i = 2; i < 99; i++) if (!existingIds.includes(`${base}-${i}`)) return `${base}-${i}`;
    return `${base}-${Date.now().toString(36)}`;
  };

  // Build the same full agent body AgentForm.save() builds, then persist directly.
  const bodyFromDraft = (d: Draft): Partial<Agent> & { id: string } => ({
    id: uniqueId(d.name),
    name: d.name.trim(),
    description: d.description,
    provider: null, model: null,
    instructions: d.instructions,
    tools: d.tools, deferredTools: [],
    permissions: Object.fromEntries(d.tools.map((t) => [t, 'allow'])),
    maxSteps: 20, enabled: true,
    surfaces: [], triggers: d.triggers, subagents: [], skills: [],
    schedule: { kind: 'none' },
  });

  const hire = async (d: Draft) => {
    setHiringId(d.emphasis); setError(null);
    try {
      const saved = await api.saveAgent(bodyFromDraft(d));
      onHired(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hire — try again.');
      setHiringId(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* wizard rail */}
      <div className="flex items-center gap-2 px-7 h-12 flex-none border-b border-border">
        <Step n={1} label="Describe the role" state={step === 1 ? 'on' : 'done'} />
        <div className={`h-[2px] w-10 rounded ${step === 2 ? 'bg-ok' : 'bg-border'}`} />
        <Step n={2} label="Pick a draft" state={step === 2 ? 'on' : 'todo'} />
        <button type="button" onClick={onCancel} className="ml-auto text-[12px] text-ink3 hover:text-ink2 flex items-center gap-1">
          <Icon name="x" size={13} /> Cancel
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-6">
        {step === 1 && (
          <div className="max-w-[620px] mx-auto flex flex-col gap-5 pt-4">
            <div>
              <h2 className="font-serif text-[22px] text-ink mb-1">What do you need help with?</h2>
              <p className="text-[13px] text-ink3">Describe the job in your own words. Curry Leaves drafts a few assistants for you to choose from.</p>
            </div>
            <textarea value={role} onChange={(e) => setRole(e.target.value)} rows={4} autoFocus
              placeholder="e.g. Watch Hacker News for topics I care about and post a morning digest…"
              className="w-full px-3 py-2.5 rounded-[10px] border border-border bg-card text-ink text-[13.5px] leading-relaxed outline-none resize-none focus:border-accent" />
            <div>
              <div className="text-[11px] uppercase tracking-wider text-ink3 font-600 mb-2">Or start from a role</div>
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((t) => (
                  <button key={t.label} type="button" onClick={() => setRole(t.prompt)}
                    className={`px-3 py-1.5 rounded-full text-[12px] border transition-colors ${role === t.prompt ? 'bg-accent-soft border-accent-soft text-accent-ink' : 'border-border text-ink2 hover:border-ink3'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {error && <div className="text-[12.5px] text-rec">{error}</div>}
            <div className="flex items-center gap-3">
              <button type="button" onClick={draftCandidates} disabled={!role.trim() || loading}
                className="px-4 py-2 rounded-[9px] bg-accent text-white text-[13px] font-550 inline-flex items-center gap-2 disabled:opacity-50">
                <Icon name="sparkle" size={14} /> {loading ? 'Drafting three…' : 'Draft candidates'}
              </button>
              <button type="button" onClick={() => onTweak({})} className="text-[12.5px] text-ink3 hover:text-ink2">
                Skip — configure manually
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="font-serif text-[16px] text-ink">
                Hiring for: <span className="italic text-ink2">“{role.length > 90 ? role.slice(0, 90) + '…' : role}”</span>
              </div>
              <button type="button" onClick={() => setStep(1)} className="text-[11.5px] text-ink3 border border-border rounded-[6px] px-2 py-0.5 hover:border-ink3">
                edit role
              </button>
            </div>
            {error && <div className="text-[12.5px] text-rec">{error}</div>}
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {drafts.map((d) => (
                <CandidateCard key={d.emphasis} d={d} busy={hiringId === d.emphasis} anyBusy={hiringId !== null}
                  onHire={() => hire(d)} onTweak={() => onTweak(draftToPartial(d))} />
              ))}
            </div>
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={draftCandidates} disabled={loading || hiringId !== null}
                className="text-[12.5px] text-ink2 border border-border rounded-[7px] px-3 py-1.5 hover:border-accent hover:text-accent inline-flex items-center gap-1.5 disabled:opacity-50">
                <Icon name="refresh" size={13} /> {loading ? 'Drafting…' : 'Draft three more'}
              </button>
              <button type="button" onClick={() => onTweak({})} className="text-[12.5px] text-ink3 hover:text-ink2">
                Configure one manually instead
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// A draft handed to AgentForm as an unsaved prefill (same keys generateAgent returns).
function draftToPartial(d: Draft): Partial<Agent> {
  return { name: d.name, description: d.description, instructions: d.instructions, tools: d.tools, triggers: d.triggers };
}

function CandidateCard({ d, busy, anyBusy, onHire, onTweak }: {
  d: Draft; busy: boolean; anyBusy: boolean; onHire: () => void; onTweak: () => void;
}) {
  const id = slug(d.name);
  return (
    <div className="rounded-[13px] border border-border bg-card p-3.5 flex flex-col">
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="w-9 h-9 rounded-full grid place-items-center text-white text-[12px] font-650 flex-none"
          style={{ background: avatarColor(id) }}>
          {initials(d.name)}
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-650 text-ink truncate">{d.name}</div>
          <div className="text-[10.5px] text-ink3">{d.emphasis}</div>
        </div>
      </div>
      <p className="text-[11.5px] text-ink2 leading-snug mb-3 line-clamp-3 min-h-[46px]">{d.description || d.instructions.slice(0, 120)}</p>
      <div className="flex flex-col gap-1.5 text-[10.5px] border-t border-border-soft pt-2.5 mb-3">
        <Row label="Tools">
          {d.tools.length
            ? <span className="font-mono text-[9.5px] text-ink2">{d.tools.slice(0, 4).join(' · ')}{d.tools.length > 4 ? ` +${d.tools.length - 4}` : ''}</span>
            : <span className="text-ink3">none</span>}
        </Row>
        <Row label="Wakes on">
          {d.triggers.length
            ? <span className="font-mono text-[9.5px] text-ink2">{d.triggers.slice(0, 2).join(' · ')}{d.triggers.length > 2 ? ` +${d.triggers.length - 2}` : ''}</span>
            : <span className="text-ink3">manual runs</span>}
        </Row>
      </div>
      <div className="flex gap-2 mt-auto">
        <button type="button" onClick={onHire} disabled={anyBusy}
          className="flex-1 h-[30px] rounded-[8px] bg-accent text-white text-[12px] font-550 inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
          {busy ? 'Hiring…' : <>Hire {d.name.split(/[\s(]/)[0]}</>}
        </button>
        <button type="button" onClick={onTweak} disabled={anyBusy}
          className="flex-1 h-[30px] rounded-[8px] border border-border text-ink2 text-[12px] hover:border-ink3 disabled:opacity-50">
          Tweak first
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-ink3 w-[58px] flex-none">{label}</span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function Step({ n, label, state }: { n: number; label: string; state: 'todo' | 'on' | 'done' }) {
  return (
    <div className={`flex items-center gap-2 text-[12px] ${state === 'on' ? 'text-ink font-600' : 'text-ink3'}`}>
      <span className={`w-5 h-5 rounded-full grid place-items-center text-[10px] font-650 border ${
        state === 'done' ? 'bg-ok border-ok text-white'
          : state === 'on' ? 'border-accent text-accent-dark bg-card'
            : 'border-border text-ink3 bg-card'}`}>
        {state === 'done' ? '✓' : n}
      </span>
      {label}
    </div>
  );
}
