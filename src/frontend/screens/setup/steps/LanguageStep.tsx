import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { StepHead, StepNav } from '../SetupWizard';

/**
 * Step 3 — spoken language. Writes `recording.language`, which locks Whisper to one
 * language (auto-detect can drift on silence). The list comes from the backend so it
 * stays in step with what transcription actually supports.
 */
export function LanguageStep({ onNext, onSkip, onBack }: {
  onNext: () => void; onSkip: () => void; onBack: () => void;
}) {
  const [languages, setLanguages] = useState<{ code: string; label: string }[]>([]);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listModels()
      .then((r) => { setLanguages(r.languages); setPicked(r.language || 'en'); })
      .catch(() => {});
  }, []);

  const save = async () => {
    setBusy(true);
    try { await api.selectModel({ language: picked }); } catch { /* setup should never dead-end */ }
    setBusy(false);
    onNext();
  };

  return (
    <>
      <StepHead
        title="What language do you speak?"
        hint="Used for transcribing your recordings and voice. Locking to one language is more accurate than auto-detect — you can change it any time in Settings."
      />
      <div className="mt-6 max-h-[240px] overflow-y-auto grid grid-cols-2 gap-1.5 pr-1">
        {languages.map((l) => {
          const on = l.code === picked;
          return (
            <button
              key={l.code}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked(l.code)}
              className={`text-left px-3 py-2 rounded-[8px] border text-[12.5px] transition-colors ${
                on ? 'border-accent bg-accent-soft/40 text-accent-ink font-600'
                   : 'border-border bg-bg text-ink hover:border-ink3'}`}>
              {l.label}
            </button>
          );
        })}
      </div>
      <StepNav onNext={save} onSkip={onSkip} onBack={onBack} busy={busy} disabled={!picked} />
    </>
  );
}
