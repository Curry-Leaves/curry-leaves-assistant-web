/**
 * HTTP plumbing shared by every domain client — base-URL resolution, the JSON
 * fetch helper, and the POST-SSE reader. The base URL is resolved once from the
 * Electron preload bridge, then cached. Outside Electron (plain browser tab),
 * `window.curryLeaves` doesn't exist: in dev (`npm run web`) the page comes from
 * Vite while the backend sits on the fixed web-mode port, but in a production
 * build the FastAPI server serves the page itself — possibly on a random port
 * (see app.py `_free_port`) — so the API lives at our own origin.
 */
import { authHeader, setToken } from '../auth';

const WEB_BACKEND_URL = import.meta.env.CL_BACKEND_URL
  || (import.meta.env.DEV ? 'http://127.0.0.1:5177' : window.location.origin);

let _base: string | null = null;
let _basePromise: Promise<string> | null = null;

/**
 * A backend URL the user typed on the connection gate (see screens/boot/ConnectGate).
 * It wins over every other source: if someone had to point the app at a backend by hand,
 * auto-detection had already failed them. Cleared by saving an empty value.
 */
const OVERRIDE_KEY = 'curry-leaves.backendUrl';

export function backendOverride(): string {
  try { return localStorage.getItem(OVERRIDE_KEY) || ''; } catch { return ''; }
}

export function setBackendOverride(url: string): void {
  const clean = url.trim().replace(/\/+$/, '');
  try {
    if (clean) localStorage.setItem(OVERRIDE_KEY, clean);
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch { /* private mode — the override just won't persist */ }
  resetBase();
}

/** The URL `base()` would resolve to right now, for prefilling the gate's input. */
export async function currentBackendUrl(): Promise<string> {
  return backendOverride()
    || (await window.curryLeaves?.getBackendUrl?.().catch(() => null))
    || WEB_BACKEND_URL;
}

/**
 * A 401 means our bearer token is gone (backend restarted or PIN changed):
 * clear it so the app drops back to the login screen. Public endpoints
 * (`/auth/*`) opt out — a wrong-PIN 401 there shouldn't nuke a valid session.
 */
function on401(path: string): void {
  if (!path.startsWith('/auth/')) setToken(null);
}

/**
 * Forget the cached backend URL so the next `base()` re-resolves it. The backend can
 * restart on a new random port (see app.py `_free_port`); when the socket manager sees
 * repeated connect failures it calls this so we stop hammering a dead port.
 */
export function resetBase(): void {
  _base = null;
  _basePromise = null;
}

/**
 * Resolution order: saved override → Electron preload bridge → dev/web default (or, in a
 * production web build, our own origin). The Electron bridge is polled because the shell
 * spawns the backend on a random port and only knows the URL once it's up.
 */
export async function base(): Promise<string> {
  if (_base) return _base;
  const override = backendOverride();
  if (override) return (_base = override);
  if (!window.curryLeaves?.getBackendUrl) return (_base = WEB_BACKEND_URL);
  if (!_basePromise) {
    _basePromise = (async () => {
      for (let i = 0; i < 200; i++) {
        const url = await window.curryLeaves?.getBackendUrl?.().catch(() => null);
        if (url) return (_base = url);
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error('Backend never became ready');
    })();
  }
  return _basePromise;
}

export async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch((await base()) + path, {
    headers: { 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers || {}) },
    ...init,
  });
  if (res.status === 401) { on401(path); throw new Error(`${path} → 401`); }
  if (!res.ok) throw new Error(await errorMessage(res, path));
  return res.status === 204 ? (undefined as T) : res.json();
}

// FastAPI errors are JSON `{"detail": "..."}`; surface that clean message rather than the raw
// body (or an opaque status) so callers like the provider Connect flow can show it verbatim.
async function errorMessage(res: Response, path: string): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const d = JSON.parse(body)?.detail;
    if (typeof d === 'string' && d) return d;
  } catch { /* not JSON — fall through */ }
  return body || `${path} → ${res.status}`;
}
