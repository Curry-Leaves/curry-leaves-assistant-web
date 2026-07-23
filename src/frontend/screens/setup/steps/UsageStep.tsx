import { useEffect, useState } from 'react';
import { Mic, AudioLines, BookOpen, Users } from 'lucide-react';
import { api } from '../../../api/client';
import { StepHead, StepNav } from '../SetupWizard';

/** Ids match agent_engine.USAGE_LABELS on the backend, which turns them into prompt prose. */
export const USAGE_OPTIONS = [
  { id: 'meetings', label: 'Meetings & recordings', hint: 'Record, transcribe, summarise', Icon: Mic },
  { id: 'voice', label: 'Voice assistant', hint: 'Talk to it hands-free', Icon: AudioLines },
  { id: 'knowledge', label: 'Notes & knowledge', hint: 'A second brain that remembers', Icon: BookOpen },
  { id: 'agents', label: 'AI assistant team', hint: 'Agents working in the background', Icon: Users },
];

/**
 * Step 2 — what the user is here for. Multi-select, and genuinely load-bearing rather than
 * a survey: it picks the recommended Whisper model on the next-but-one step, and gets
 * injected into every agent's prompt so assistants know what this install is *for* on day one.
 */
export function UsageStep({ initial, onPicked, onNext, onSkip, onBack }: {
  initial: string[];
  /** Lift the picks to the wizard so later steps (transcription's model recommendation)
   *  see this run's choice, not the value the server had when the wizard mounted. */
  onPicked: (usage: string[]) => void;
  onNext: () => void; onSkip: () => void; onBack: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setPicked(initial); }, [initial]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
      onPicked(next);
      return next;
    });

  const save = async () => {
    if (!picked.length) { onSkip(); return; }
    setBusy(true);
    try { await api.patchIdentity({ usage: picked }); } catch { /* setup should never dead-end */ }
    setBusy(false);
    onNext();
  };

  return (
    <>
      <StepHead
        title="What will you use it for?"
        hint="Pick anything that applies. This tunes what we suggest next, and tells your assistants what they're here to help with."
      />
      <div className="grid grid-cols-2 gap-2.5 mt-6">
        {USAGE_OPTIONS.map(({ id, label, hint, Icon }) => {
          const on = picked.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(id)}
              className={`text-left p-3 rounded-[10px] border transition-colors ${
                on ? 'border-accent bg-accent-soft/40' : 'border-border bg-bg hover:border-ink3'}`}>
              <Icon size={16} className={on ? 'text-accent' : 'text-ink3'} />
              <div className={`text-[12.5px] mt-1.5 ${on ? 'font-600 text-accent-ink' : 'font-550 text-ink'}`}>{label}</div>
              <div className="text-[11px] text-ink3 leading-snug mt-0.5">{hint}</div>
            </button>
          );
        })}
      </div>
      <StepNav onNext={save} onSkip={onSkip} onBack={onBack} busy={busy} />
    </>
  );
}
