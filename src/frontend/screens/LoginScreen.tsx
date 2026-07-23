import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { setToken } from '../auth';
import { ensureNotificationPermission } from '../notify';
import { BrandPane } from '../components/BrandPane';
import { PinPad } from '../components/PinPad';

/**
 * Two-pane lock screen: the shared branding pane on the left, the PIN keypad on the right.
 *
 * Unlock ONLY. Creating the first PIN belongs to the first-run setup wizard (screens/setup),
 * which the boot gate in frontend.tsx routes to whenever `/auth/status` reports the install
 * unconfigured — so by the time this screen renders, a PIN always exists.
 *
 * On success it stores the bearer token, which flips the app into the authed UI.
 */
export function LoginScreen({ onAuthed }: { onAuthed: () => void }) {
  const [identityName, setIdentityName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.authStatus().then((s) => setIdentityName(s.identityName || '')).catch(() => {});
  }, []);

  const submit = useCallback(async (value: string) => {
    setBusy(true); setError('');
    try {
      const { token } = await api.login(value);
      setToken(token);
      // Unlocking is a user gesture — the one reliable moment to ask the browser for
      // notification permission (Chrome ignores non-gesture requestPermission calls).
      void ensureNotificationPermission();
      onAuthed();
    } catch {
      setError('Incorrect PIN');
    } finally {
      setBusy(false);
    }
  }, [onAuthed]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-bg text-ink select-none grid grid-cols-[1.05fr_1fr]">
      <BrandPane />

      {/* Right — keypad pane, on a faint dotted texture + soft top-down vignette
          so it doesn't read as bare background next to the branding pane. */}
      <div className="relative flex flex-col items-center justify-center px-10 overflow-hidden">
        <div className="lp-dots pointer-events-none absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute inset-0"
             style={{ background: 'radial-gradient(120% 70% at 50% 0%, color-mix(in oklch, var(--color-accent) 6%, transparent) 0%, transparent 60%)' }} />

        {/* Glass card frames the keypad so the pane has a clear focal shape. */}
        <div className="an-rise relative z-10 flex flex-col items-center rounded-[24px] border border-border bg-card/70 backdrop-blur-xl shadow-pop px-10 py-9">
          <h1 className="text-[19px] font-semibold tracking-tight">
            Welcome back{identityName ? `, ${identityName}` : ''}
          </h1>
          <p className="text-[12.5px] text-ink3 mt-1">Enter your PIN to unlock Curry Leaves</p>
          <PinPad onSubmit={submit} busy={busy} error={error} onError={setError} />
        </div>
      </div>
    </div>
  );
}
