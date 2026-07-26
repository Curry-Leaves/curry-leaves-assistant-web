import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import type { SkillVerdict } from '../../api/skills';

/**
 * Review dialog for "Save as skill": shows what the model extracted from the conversation and
 * what it recommends — create a new skill, fold improvements into an existing learned one, or
 * skip (push back) when nothing durable is worth keeping. Nothing is saved until the user
 * confirms here; skip has no confirm at all.
 */
export function SaveSkillModal({ draft, applying, error, onCancel, onApply }: {
  draft: SkillVerdict;
  applying: boolean;
  error: string | null;
  onCancel: () => void;
  onApply: (d: { verdict: 'create' | 'update'; name: string; description: string; body: string }) => void;
}) {
  const [showBody, setShowBody] = useState(false);
  const skip = draft.verdict === 'skip';
  const update = draft.verdict === 'update';
  const title = skip ? 'Nothing worth saving' : update ? 'Improve an existing skill' : 'New skill from this chat';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25" onClick={onCancel}>
      <div className="w-[520px] max-w-[92vw] max-h-[86vh] bg-card border border-border rounded-[12px] shadow-pop flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
          <Icon name={skip ? 'warning' : 'sparkle'} size={14} color={skip ? 'var(--color-ink3)' : 'var(--color-accent)'} />
          <span className="text-[13px] font-550 text-ink">{title}</span>
          <span className="flex-1" />
          <button type="button" onClick={onCancel} title="Close" className="w-6 h-6 grid place-items-center rounded-[6px] text-ink3 hover:text-ink hover:bg-border-soft">
            <Icon name="x" size={13} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          {error && <div className="text-[11.5px] text-rec">{error}</div>}

          {skip ? (
            <>
              <div className="text-[12.5px] text-ink2 leading-relaxed">{draft.reason || 'No repeatable procedure or correction was found in this conversation.'}</div>
              {draft.existing && (
                <div className="text-[12px] text-ink3">
                  Already covered by <span className="font-mono text-ink2">{draft.existing}</span> — see Knowledge → Skills.
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[10.5px] font-600 uppercase tracking-wider text-ink3">{update ? 'Updates skill' : 'Skill name'}</span>
                <span className="text-[12.5px] font-mono text-ink">{update ? draft.existing : draft.name}</span>
              </div>
              {draft.description && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-600 uppercase tracking-wider text-ink3">When it applies</span>
                  <span className="text-[12.5px] text-ink2 leading-relaxed">{draft.description}</span>
                </div>
              )}
              {update && draft.reason && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-600 uppercase tracking-wider text-ink3">What this conversation adds</span>
                  <span className="text-[12.5px] text-ink2 leading-relaxed">{draft.reason}</span>
                </div>
              )}
              {draft.benefits.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-600 uppercase tracking-wider text-ink3">Next time this saves</span>
                  <ul className="flex flex-col gap-0.5">
                    {draft.benefits.map((b, i) => (
                      <li key={i} className="text-[12.5px] text-ink2 leading-relaxed flex gap-1.5">
                        <span className="text-accent flex-none mt-[3px]"><Icon name="check" size={11} /></span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <button type="button" onClick={() => setShowBody((v) => !v)}
                  className="self-start inline-flex items-center gap-1 text-[11.5px] text-ink3 hover:text-ink2">
                  <Icon name={showBody ? 'chevD' : 'chevR'} size={11} />
                  <span>{showBody ? 'Hide' : 'Show'} the {update ? 'revised' : 'extracted'} procedure</span>
                </button>
                {showBody && (
                  <pre className="px-2.5 py-2 rounded-[7px] border border-border bg-bg text-[11.5px] font-mono text-ink2 whitespace-pre-wrap max-h-56 overflow-y-auto">{draft.body}</pre>
                )}
              </div>
              <div className="text-[11px] text-faint">
                {update
                  ? 'Its trial/proven record and provenance are kept; this chat is added as a source.'
                  : 'Starts on trial for this agent — it proves itself (or retires) with use. Manage it in Knowledge → Skills.'}
              </div>
            </>
          )}

          <div className="self-end flex items-center gap-2 pt-1">
            <button type="button" onClick={onCancel}
              className="px-3 py-1.5 rounded-[7px] border border-border text-ink2 text-[12px] hover:border-ink3">
              {skip ? 'Close' : 'Cancel'}
            </button>
            {!skip && (
              <button type="button" disabled={applying}
                onClick={() => onApply({
                  verdict: update ? 'update' : 'create',
                  name: update ? draft.existing : draft.name,
                  description: draft.description,
                  body: draft.body,
                })}
                className="px-3 py-1.5 rounded-[7px] bg-accent text-on-accent text-[12px] font-550 hover:opacity-90 disabled:opacity-50">
                {applying ? 'Saving…' : update ? 'Update skill' : 'Create skill'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
