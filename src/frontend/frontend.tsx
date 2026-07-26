import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';
import { LoginScreen } from './screens/LoginScreen';
import { ConnectGate } from './screens/boot/ConnectGate';
import { SetupWizard } from './screens/setup/SetupWizard';
import { api } from './api/client';
import { getToken, onAuthChange, setToken } from './auth';

/**
 * Boot state machine. Four stages, in order:
 *
 *  1. `connecting` — probe /health. Nothing renders against a backend we can't reach; the
 *     gate shows a preloader and, on failure, lets the user point the app at another URL.
 *  2. `setup` — /auth/status says no PIN exists, so this install was never set up. The
 *     first-run wizard runs, ending in PIN creation — which is exactly what makes this
 *     stage stop happening, so there's no separate "onboarding done" flag to keep in sync.
 *  3. `login` — a PIN exists; show the lock. A cached token is verified first, because the
 *     backend mints tokens in memory only and every fresh launch invalidates old ones —
 *     without this, App would mount and fire a burst of doomed requests (each 401ing) ahead
 *     of the inevitable bounce back to the lock screen.
 *  4. `app`.
 *
 * A 401 anywhere clears the token (see api/http) which flips us back to the lock.
 */
type Stage = 'connecting' | 'setup' | 'login' | 'app';

function Root() {
  const [stage, setStage] = useState<Stage>('connecting');

  // Once connected, decide where the user lands: unconfigured → setup; otherwise verify
  // any cached token and go straight in, falling back to the lock screen.
  const onConnected = useCallback(async () => {
    let configured = true;
    try { configured = (await api.authStatus()).configured; } catch { /* treat as configured */ }
    if (!configured) { setStage('setup'); return; }
    if (!getToken()) { setStage('login'); return; }
    try { await api.authVerify(); setStage('app'); }
    catch { setToken(null); setStage('login'); }
  }, []);

  // Losing the token mid-session (a 401 anywhere) drops us back to the lock.
  useEffect(() => onAuthChange(() => {
    setStage((s) => (s === 'app' && !getToken() ? 'login' : s));
  }), []);

  if (stage === 'connecting') return <ConnectGate onConnected={onConnected} />;
  if (stage === 'setup') return <SetupWizard onDone={() => setStage('app')} />;
  if (stage === 'login') return <LoginScreen onAuthed={() => setStage('app')} />;
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
