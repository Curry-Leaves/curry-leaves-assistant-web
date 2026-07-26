import { useCallback, useState } from 'react';
import { api } from '../../../api/client';
import { setToken } from '../../../auth';
import { ensureNotificationPermission } from '../../../notify';
import { PinPad, PIN_LEN } from '../../../components/PinPad';
import { StepHead, StepNav } from '../SetupWizard';

/**
 * Step 6 — the PIN, and the only required step.
 *
 * Creating it is what ends setup permanently: `/auth/login` sets the PIN when none exists,
 * which flips `/auth/status.configured` to true, which is exactly the flag the boot gate
 * reads to decide between this wizard and the lock screen. It also closes the backend's
 * open "setup mode" window and mints the token the app runs on.
 */
export function PinStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (pin: string) => {
    setBusy(true); setError('');
    try {
      const { token } = await api.login(pin);
      setToken(token);
      // Setting the PIN is a user gesture — the one reliable moment to ask the browser
      // for notification permission (Chrome ignores non-gesture requestPermission calls).
      void ensureNotificationPermission();
      onDone();
    } catch {
      setError('Could not set your PIN. Try again.');
      setBusy(false);
    }
  }, [onDone]);

  return (
    <div className="flex flex-col items-center text-center">
      <StepHead
        title={stage === 'enter' ? 'Create a PIN' : 'Confirm your PIN'}
        hint={stage === 'enter'
          ? `Choose a ${PIN_LEN}-digit passcode to lock Curry Leaves. You'll enter it each time you open the app.`
          : 'Enter the same PIN once more.'}
      />
      <PinPad
        confirm
        onSubmit={submit}
        onStage={setStage}
        busy={busy}
        error={error}
        onError={setError}
      />
      <div className="w-full">
        <StepNav onBack={onBack} />
      </div>
    </div>
  );
}
