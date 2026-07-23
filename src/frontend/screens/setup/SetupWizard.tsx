import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../../api/client';
import type { AppSettings } from '../../types';
import { BrandPane } from '../../components/BrandPane';
import { NameStep } from './steps/NameStep';
import { UsageStep } from './steps/UsageStep';
import { LanguageStep } from './steps/LanguageStep';
import { TranscriptStep } from './steps/TranscriptStep';
import { ProviderStep } from './steps/ProviderStep';
import { PinStep } from './steps/PinStep';

/**
 * First-run setup. Shown by the boot gate whenever `/auth/status` reports no PIN yet —
 * which doubles as the "setup not finished" flag: creating the PIN is the LAST step, so
 * completing setup is exactly what makes this screen stop appearing. Nothing else to
 * persist, and every existing install (PIN already set) skips it automatically.
 *
 * Quitting halfway leaves the install unconfigured, so the wizard reopens — but each step
 * persists on Continue, so it resumes prefilled rather than restarting.
 *
 * Steps 1-5 are skippable and each maps to a Settings section the user can revisit; only
 * the PIN is required. The backend runs in "setup mode" (whole API open) until that PIN
 * exists, which is what lets these steps write real state with no token — see core/auth.py.
 */

export type StepId = 'name' | 'usage' | 'language' | 'transcript' | 'provider' | 'pin';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'name', label: 'Your name' },
  { id: 'usage', label: "How you'll use it" },
  { id: 'language', label: 'Language' },
  { id: 'transcript', label: 'Transcription' },
  { id: 'provider', label: 'AI provider' },
  { id: 'pin', label: 'Create a PIN' },
];

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Load once so every step can prefill from whatever a previous (abandoned) run saved.
  useEffect(() => { api.getSettings().then(setSettings).catch(() => setSettings(null)); }, []);

  const step = STEPS[i];
  const next = useCallback(() => setI((n) => Math.min(n + 1, STEPS.length - 1)), []);
  const back = useCallback(() => setI((n) => Math.max(n - 1, 0)), []);

  const identity = settings?.identity;
  // Seeded from the server (a previous, abandoned run) but then owned locally: `settings` is
  // fetched once on mount, so without lifting the live picks the transcription step would
  // always see the pre-wizard value and never the choice just made two steps earlier.
  const [usage, setUsage] = useState<string[]>([]);
  useEffect(() => { if (identity?.usage?.length) setUsage(identity.usage); }, [identity]);
  // Same for the name — otherwise stepping Back to it shows an empty field despite the
  // value having been saved a moment ago.
  const [name, setName] = useState('');
  useEffect(() => { if (identity?.name) setName(identity.name); }, [identity]);

  return (
    <div className="w-full h-full overflow-hidden bg-bg text-ink grid grid-cols-[1.05fr_1fr]">
      <BrandPane compact>
        <ol className="mt-6 flex flex-col gap-2.5 text-left">
          {STEPS.map((s, n) => {
            const state = n < i ? 'done' : n === i ? 'current' : 'todo';
            return (
              <li key={s.id} className="flex items-center gap-2.5">
                {/* brand-ink/*, not ink/* or sidebar-ink/* — the pane's background flips
                    between light cream and dark emerald by theme. See BrandPane. */}
                <span className={`grid place-items-center w-[18px] h-[18px] rounded-full text-[10px] font-600 flex-none transition-colors
                  ${state === 'done' ? 'bg-brand-accent text-sidebar'
                    : state === 'current' ? 'border-2 border-brand-accent text-brand-accent'
                    : 'border border-brand-ink3/40 text-brand-ink3'}`}>
                  {state === 'done' ? <Check size={11} strokeWidth={3} /> : n + 1}
                </span>
                <span className={`text-[12.5px] transition-colors ${
                  state === 'todo' ? 'text-brand-ink3' : 'text-brand-ink'} ${
                  state === 'current' ? 'font-600' : ''}`}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      </BrandPane>

      <div className="relative flex flex-col items-center justify-center px-10 overflow-hidden">
        <div className="lp-dots pointer-events-none absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute inset-0"
             style={{ background: 'radial-gradient(120% 70% at 50% 0%, color-mix(in oklch, var(--color-accent) 6%, transparent) 0%, transparent 60%)' }} />

        <div key={step.id} className="an-rise relative z-10 w-full max-w-[430px] rounded-[24px] border border-border bg-card/70 backdrop-blur-xl shadow-pop px-8 py-8">
          {step.id === 'name' && (
            <NameStep initial={name} onTyped={setName} onNext={next} onSkip={next} />
          )}
          {step.id === 'usage' && (
            <UsageStep initial={usage} onPicked={setUsage} onNext={next} onSkip={next} onBack={back} />
          )}
          {step.id === 'language' && (
            <LanguageStep onNext={next} onSkip={next} onBack={back} />
          )}
          {step.id === 'transcript' && (
            <TranscriptStep usage={usage} onNext={next} onSkip={next} onBack={back} />
          )}
          {step.id === 'provider' && (
            <ProviderStep onNext={next} onSkip={next} onBack={back} />
          )}
          {step.id === 'pin' && (
            <PinStep onDone={onDone} onBack={back} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── shared step chrome ───────────────────────────────────────────────────────

export function StepHead({ title, hint }: { title: string; hint: string }) {
  return (
    <>
      <h1 className="text-[19px] font-semibold tracking-tight text-ink">{title}</h1>
      <p className="text-[12.5px] text-ink3 mt-1.5 leading-relaxed">{hint}</p>
    </>
  );
}

/**
 * The Back / Continue / Skip row every step ends with. `onSkip` is what makes a step
 * optional — omit it (the PIN step) and there's no way past but forward.
 */
export function StepNav({ onNext, onSkip, onBack, nextLabel = 'Continue', busy, disabled }: {
  onNext?: () => void; onSkip?: () => void; onBack?: () => void;
  nextLabel?: string; busy?: boolean; disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 mt-7">
      {onNext && (
        <button
          type="button"
          onClick={onNext}
          disabled={busy || disabled}
          className="h-[32px] px-4 rounded-[8px] bg-accent text-white text-[12.5px] font-600 hover:opacity-90 disabled:opacity-50 transition-opacity">
          {busy ? 'Saving…' : nextLabel}
        </button>
      )}
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="h-[32px] px-2 text-[12.5px] text-ink3 hover:text-ink transition-colors disabled:opacity-50">
          Skip
        </button>
      )}
      <span className="flex-1" />
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="h-[32px] px-2 text-[12.5px] text-ink3 hover:text-ink transition-colors disabled:opacity-50">
          Back
        </button>
      )}
    </div>
  );
}
