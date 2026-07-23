/**
 * Client-side auth state for the PIN lock.
 *
 * Holds the bearer token minted by `/auth/login`, persisted to localStorage so a
 * window reload stays logged in. The backend keeps tokens in memory only, so a
 * backend restart invalidates the token → the next request 401s → we clear it and
 * the app falls back to the login screen.
 */
const KEY = 'curry-leaves.authToken';

let _token: string | null = localStorage.getItem(KEY);
const _listeners = new Set<() => void>();

export function getToken(): string | null {
  return _token;
}

export function setToken(token: string | null): void {
  _token = token;
  if (token) localStorage.setItem(KEY, token);
  else localStorage.removeItem(KEY);
  for (const fn of _listeners) {
    try { fn(); } catch { /* ignore */ }
  }
}

/** Subscribe to login/logout transitions. Returns an unsubscribe fn. */
export function onAuthChange(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}

/** Authorization header to spread into fetch init (empty when logged out). */
export function authHeader(): Record<string, string> {
  return _token ? { Authorization: `Bearer ${_token}` } : {};
}

/**
 * Append the token as a query param — for transports that can't set headers
 * (EventSource for SSE, WebSocket).
 */
export function withToken(url: string): string {
  if (!_token) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(_token);
}
