import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../api/client';
import { backendOverride, currentBackendUrl, setBackendOverride } from '../../api/http';
import { BrandPane } from '../../components/BrandPane';

/** How long to look like we're just starting up before admitting we can't connect. In
 *  Electron the shell is usually spawning the backend during this window (<2s typical). */
const PATIENCE_MS = 4000;
/** Once the "can't connect" screen is up, keep probing — if the user starts the backend
 *  by hand we should advance on our own rather than make them click Retry. */
const POLL_MS = 2000;

/**
 * Boot stage 0: don't render anything against a backend we can't reach.
 *
 * Probes `/health` (public — answers before a PIN exists). While probing it shows the
 * branded preloader; if the backend stays unreachable past PATIENCE_MS it offers an
 * editable backend URL, which persists as an override that outranks auto-detection
 * (see api/http.ts). That's also how a browser tab points at a remote/Docker backend.
 */
export function ConnectGate({ onConnected }: { onConnected: () => void }) {
  const [failed, setFailed] = useState(false);
  const [url, setUrl] = useState('');
  const [checking, setChecking] = useState(false);
  const done = useRef(false);

  // One probe. Resolves true on a live backend; the caller decides what a miss means.
  const probe = useCallback(async () => {
    try {
      await api.health();
      if (!done.current) { done.current = true; onConnected(); }
      return true;
    } catch {
      return false;
    }
  }, [onConnected]);

  // Initial attempt: probe immediately, and only surface the failure screen once the
  // patience window has also elapsed — so a backend that takes 1.5s never flashes an
  // alarming error at the user.
  useEffect(() => {
    let patient = true;
    const timer = setTimeout(() => { patient = false; }, PATIENCE_MS);
    let stop = false;

    (async () => {
      while (!stop && !done.current) {
        if (await probe()) break;
        if (!patient) { setFailed(true); break; }
        await new Promise((r) => setTimeout(r, 400));
      }
    })();

    currentBackendUrl().then((u) => setUrl((prev) => prev || u)).catch(() => {});
    return () => { stop = true; clearTimeout(timer); };
  }, [probe]);

  // Background retry while the failure screen is up.
  useEffect(() => {
    if (!failed) return;
    const id = setInterval(() => { void probe(); }, POLL_MS);
    return () => clearInterval(id);
  }, [failed, probe]);

  const retry = async () => {
    setChecking(true);
    // Saving resets the cached base URL, so the probe below resolves against the new value.
    if (url.trim() !== backendOverride()) setBackendOverride(url);
    await probe();
    setChecking(false);
  };

  if (!failed) {
    return (
      <div className="w-full h-full bg-bg text-ink grid grid-cols-[1.05fr_1fr]">
        <BrandPane />
        <div className="relative flex flex-col items-center justify-center px-10 overflow-hidden">
          <div className="lp-dots pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative z-10 flex flex-col items-center gap-3">
            <span className="inline-block w-5 h-5 rounded-full border-2 border-accent/30 border-t-accent an-spin" />
            <p className="text-[12.5px] text-ink3">Starting up…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-bg text-ink grid grid-cols-[1.05fr_1fr]">
      <BrandPane />
      <div className="relative flex flex-col items-center justify-center px-10 overflow-hidden">
        <div className="lp-dots pointer-events-none absolute inset-0 opacity-60" />
        <div className="an-rise relative z-10 w-full max-w-[380px] rounded-[24px] border border-border bg-card/70 backdrop-blur-xl shadow-pop px-8 py-8">
          <div className="flex items-center gap-2 text-amber-500">
            <AlertTriangle size={16} />
            <h1 className="text-[16px] font-semibold tracking-tight text-ink">Can't reach the backend</h1>
          </div>
          <p className="text-[12.5px] text-ink3 mt-2 leading-relaxed">
            Curry Leaves couldn't connect to its server. If it's running somewhere else — another
            port, a machine on your network, or Docker — point the app at it here.
          </p>

          <label htmlFor="backend-url" className="block text-[11px] font-600 tracking-wider uppercase text-ink3 mt-6 mb-1.5">
            Backend URL
          </label>
          <input
            id="backend-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void retry(); }}
            placeholder="http://127.0.0.1:5177"
            spellCheck={false}
            autoComplete="off"
            className="w-full h-[34px] px-2.5 rounded-[6px] border border-border bg-bg text-ink text-[12.5px] font-mono outline-none focus:border-accent"
          />

          <div className="flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={retry}
              disabled={checking}
              className="h-[32px] px-4 rounded-[8px] bg-accent text-white text-[12.5px] font-600 hover:opacity-90 disabled:opacity-50 transition-opacity">
              {checking ? 'Connecting…' : 'Connect'}
            </button>
            <span className="text-[11.5px] text-ink3">Retrying automatically…</span>
          </div>
        </div>
      </div>
    </div>
  );
}
