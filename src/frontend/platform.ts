/** Platform and shell detection.
 *
 *  Every keyboard handler in the app accepts `(e.metaKey || e.ctrlKey)`, so the
 *  shortcuts genuinely work with either modifier everywhere. These helpers exist
 *  so we can *show* the right one rather than hardcoding ⌘ for a Windows user in
 *  web or Docker mode.
 */

/** True on macOS. `userAgentData.platform` is the non-deprecated source; fall back
 *  to `navigator.platform` for Safari/Firefox, which don't implement it yet. */
export function isMac(): boolean {
  const ua = (navigator as { userAgentData?: { platform?: string } }).userAgentData;
  const platform = ua?.platform || navigator.platform || '';
  return /mac/i.test(platform);
}

/** The Cmd/Ctrl key as the user's own keyboard labels it. */
export function modKey(): string {
  return isMac() ? '⌘' : 'Ctrl';
}

/** True inside the Electron shell, false in web/pip/Docker mode.
 *  Feature-detects the preload bridge — the same check `api/http.ts` uses. */
export function isDesktop(): boolean {
  return !!window.curryLeaves;
}
