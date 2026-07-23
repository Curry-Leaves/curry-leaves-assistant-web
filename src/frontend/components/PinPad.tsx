import { useCallback, useEffect, useRef, useState } from 'react';

export const PIN_LEN = 4; // fixed-length PIN → submits automatically on the last digit

/**
 * The numeric PIN keypad: popping dots, a shake on error, physical-keyboard support,
 * and auto-submit the instant the last digit lands (so there's no submit button).
 *
 * Shared by the lock screen (verify an existing PIN) and the first-run wizard's final
 * step (choose one, then confirm it) — `confirm` drives the two-stage flow. The caller
 * owns what "submit" means; this component only collects digits.
 */
export function PinPad({ onSubmit, confirm, busy, error, onError, onStage }: {
  onSubmit: (pin: string) => void;
  /** Two-stage capture: enter a PIN, then re-enter it. Rejects a mismatch itself. */
  confirm?: boolean;
  busy?: boolean;
  /** Error text to show (e.g. "Incorrect PIN" from a failed submit). */
  error?: string;
  /** Called with a message when this component itself rejects (PIN mismatch), and
   *  with '' whenever the user starts a fresh entry — lets the caller clear its own error. */
  onError?: (msg: string) => void;
  /** Reports which half of the two-stage flow we're on, so the caller can retitle. */
  onStage?: (stage: 'enter' | 'confirm') => void;
}) {
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const [firstPin, setFirstPin] = useState('');
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(0);
  const submitting = useRef(false); // guards the auto-submit effect from double-firing

  const reset = useCallback(() => { setPin(''); setFirstPin(''); setStage('enter'); }, []);

  useEffect(() => { onStage?.(stage); }, [stage, onStage]);

  // A failed submit (wrong PIN) leaves the caller's `error` set and `busy` false —
  // clear the dots so the next attempt starts from scratch.
  useEffect(() => {
    if (error && !busy) { setPin(''); submitting.current = false; }
  }, [error, busy]);

  const press = useCallback((d: string) => {
    if (busy || submitting.current) return;
    onError?.('');
    setPin((p) => (p.length >= PIN_LEN ? p : p + d));
  }, [busy, onError]);
  const back = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  // Auto-advance / auto-submit the instant the PIN is complete.
  useEffect(() => {
    if (pin.length !== PIN_LEN || busy || submitting.current) return;
    if (!confirm) { submitting.current = true; onSubmit(pin); return; }
    if (stage === 'enter') { setFirstPin(pin); setPin(''); setStage('confirm'); onError?.(''); return; }
    if (pin !== firstPin) {
      onError?.('PINs do not match');
      setShake((n) => n + 1);
      reset();
      return;
    }
    submitting.current = true;
    onSubmit(pin);
  }, [pin, confirm, stage, firstPin, busy, onSubmit, onError, reset]);

  // Physical keyboard support.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back]);

  return (
    <>
      {/* PIN dots + a spinner overlay while submitting. */}
      <div key={shake} className={`relative flex gap-4 h-4 items-center mt-7 ${shake ? 'lp-shake' : ''}`}>
        {Array.from({ length: PIN_LEN }).map((_, i) => (
          <span
            key={i}
            className={`w-3 h-3 rounded-full transition-colors duration-150 ${i < pin.length ? 'bg-accent lp-pop shadow-[0_0_0_4px_color-mix(in_oklch,var(--color-accent)_20%,transparent)]' : 'bg-border'}`}
          />
        ))}
        {busy && (
          <span className="absolute -right-7 inline-block w-4 h-4 rounded-full border-2 border-accent/30 border-t-accent an-spin" />
        )}
      </div>

      <div className="h-4 mt-3 text-[12px] font-medium text-red-500">{error}</div>

      <div className="grid grid-cols-3 gap-3 mt-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} label={d} onClick={() => press(d)} disabled={busy} />
        ))}
        <button
          type="button"
          onClick={reset}
          disabled={busy || (!pin && stage === 'enter')}
          className="w-[58px] h-[58px] rounded-full text-[11px] text-ink3 hover:bg-border-soft disabled:opacity-25 transition-colors">
          Clear
        </button>
        <Key label="0" onClick={() => press('0')} disabled={busy} />
        <button
          type="button"
          onClick={back}
          disabled={busy || !pin}
          className="w-[58px] h-[58px] rounded-full text-[19px] text-ink3 hover:bg-border-soft disabled:opacity-25 transition-colors">
          ⌫
        </button>
      </div>
    </>
  );
}

function Key({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="lp-key w-[58px] h-[58px] rounded-full text-[22px] font-light grid place-items-center text-ink hover:border-accent hover:text-accent-dark disabled:opacity-40 active:scale-90 transition-all duration-100">
      {label}
    </button>
  );
}
