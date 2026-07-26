import { useEffect, useRef, useState } from 'react';
import { api } from '../../../api/client';
import { StepHead, StepNav } from '../SetupWizard';

/**
 * Step 1 — what to call the user. Writes `identity.name`, which the lock screen greets by
 * ("Welcome back, …") and every agent's prompt carries from then on.
 */
export function NameStep({ initial, onTyped, onNext, onSkip }: {
  initial: string;
  /** Lift the value to the wizard so stepping Back here shows what was already entered —
   *  the wizard's `settings` snapshot is fetched once on mount and never refetched. */
  onTyped: (name: string) => void;
  onNext: () => void; onSkip: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { setName(initial); }, [initial]);
  useEffect(() => { input.current?.focus(); }, []);

  const save = async () => {
    const clean = name.trim();
    if (!clean) { onSkip(); return; }
    setBusy(true);
    try { await api.patchIdentity({ name: clean }); } catch { /* setup should never dead-end */ }
    setBusy(false);
    onNext();
  };

  return (
    <>
      <StepHead
        title="Welcome to Curry Leaves"
        hint="Let's get you set up — it takes about a minute. First, what should we call you?"
      />
      <input
        ref={input}
        value={name}
        onChange={(e) => { setName(e.target.value); onTyped(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
        placeholder="Your name"
        autoComplete="name"
        className="w-full h-[36px] mt-6 px-3 rounded-[8px] border border-border bg-bg text-ink text-[13.5px] outline-none focus:border-accent"
      />
      <StepNav onNext={save} onSkip={onSkip} busy={busy} />
    </>
  );
}
