import { Icon } from '../../components/chrome/Icon';
import type { LearnedSkill } from '../../api/skills';
import { api } from '../../api/client';

/**
 * The trust surface for autonomously-learned skills. When the selected skill was written by
 * the Skill Learner, this strip shows WHERE it came from (provenance), how it's PERFORMING
 * (metrics), its lifecycle STATUS, and gives the human the controls the loop can't have:
 * approve (proven), pause (trial), or kill (retired). A hand-made/seeded skill carries no
 * learned metadata, so nothing renders — this only appears for learned ones.
 */
export function LearnedSkillBar({ meta, onChanged }: { meta: LearnedSkill; onChanged: () => void }) {
  const status = meta.status ?? 'trial';
  const m = meta.metrics ?? {};
  const scope = meta.appliesTo === 'all' || !meta.appliesTo
    ? 'all assistants'
    : (meta.appliesTo as string[]).join(', ');

  const set = async (s: 'proven' | 'trial' | 'retired') => {
    await api.setSkillLifecycle(meta.name, s).catch(() => {});
    onChanged();
  };

  const badge = {
    trial: { label: 'Trial', cls: 'text-amber-600 bg-amber-500/12' },
    proven: { label: 'Proven', cls: 'text-emerald-600 bg-emerald-500/12' },
    retired: { label: 'Retired', cls: 'text-ink3 bg-border-soft line-through' },
  }[status];

  return (
    <div className="px-4 py-2 border-b border-border bg-bg-soft flex items-center gap-3 flex-wrap text-[11.5px]">
      <span className="flex items-center gap-1.5 text-accent font-550">
        <Icon name="brain" size={13} /> Learned
      </span>
      <span className={`px-1.5 py-0.5 rounded font-600 uppercase tracking-wider text-[9.5px] ${badge.cls}`}>
        {badge.label}
      </span>

      <span className="text-ink3">scope: <span className="text-ink2">{scope}</span></span>

      {(m.loads ?? 0) > 0 && (
        <span className="text-ink3">
          used <span className="text-ink2">{m.loads}×</span>
          {(m.successes ?? 0) + (m.failures ?? 0) > 0 && (
            <span className="text-ink2"> · {m.successes ?? 0}✓ {m.failures ?? 0}✗</span>
          )}
        </span>
      )}

      {meta.learnedFrom && meta.learnedFrom.length > 0 && (
        <span className="text-ink3 font-mono truncate max-w-[220px]" title={meta.learnedFrom.join(', ')}>
          from {meta.learnedFrom[0].slice(0, 12)}{meta.learnedFrom.length > 1 ? ` +${meta.learnedFrom.length - 1}` : ''}
        </span>
      )}

      <span className="flex-1" />

      {/* lifecycle controls — the human's override over what the learner produced */}
      <div className="flex items-center gap-1">
        {status !== 'proven' && (
          <button type="button" onClick={() => set('proven')} title="Approve — trust this everywhere"
            className="px-2 py-0.5 rounded-[6px] border border-border text-emerald-600 hover:bg-emerald-500/10">
            Approve
          </button>
        )}
        {status !== 'retired' ? (
          <button type="button" onClick={() => set('retired')} title="Retire — stop injecting this skill"
            className="px-2 py-0.5 rounded-[6px] border border-border text-ink2 hover:text-rec hover:border-rec/40">
            Retire
          </button>
        ) : (
          <button type="button" onClick={() => set('trial')} title="Reinstate on trial"
            className="px-2 py-0.5 rounded-[6px] border border-border text-ink2 hover:border-ink3">
            Reinstate
          </button>
        )}
      </div>
    </div>
  );
}
