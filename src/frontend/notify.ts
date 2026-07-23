/** Desktop alerts (reminders due, dashboard tile alerts, ...).
 *
 * Routed through Electron's main-process `Notification` API (via the `notify` IPC
 * bridge in preload.ts) rather than the renderer's web Notification API: an
 * unsigned/dev Electron build often isn't registered with the OS notification
 * center, so web Notifications silently no-op even when permission reads "granted".
 * Electron's native API works regardless of code-signing/registration state.
 *
 * Falls back to the web Notification API when not running inside Electron (e.g.
 * a plain browser during frontend-only development).
 */

let _permissionAsked = false;

export type NotifyPermission = 'unsupported' | 'native' | 'granted' | 'default' | 'denied';

/** Current notification capability, for surfacing a control in Settings.
 *  'native' = Electron bridge (always works, no browser permission needed). */
export function notificationState(): NotifyPermission {
  if (window.curryLeaves?.notify) return 'native';
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as 'granted' | 'default' | 'denied';
}

/** Request browser notification permission. MUST be reachable from a user gesture —
 *  Chrome silently ignores requestPermission() calls not triggered by a click/keypress,
 *  which is why an on-mount call leaves permission stuck at 'default' forever. Returns
 *  the resulting state. Safe to call repeatedly. */
export async function ensureNotificationPermission(): Promise<NotifyPermission> {
  if (window.curryLeaves?.notify) return 'native';
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  _permissionAsked = true;
  try {
    return (await Notification.requestPermission()) as NotifyPermission;
  } catch {
    return 'default';
  }
}

// Kept for the on-mount call: only fires the request if a gesture already primed it,
// so it never wastes the (gesture-gated) prompt. Real requests come from user clicks.
export function primeNotificationPermission(): void {
  if (_permissionAsked) void ensureNotificationPermission();
}

// Click routing for the Electron path: main can't run renderer callbacks, so we key
// them by tag here and main echoes the clicked tag back over the `notify:click` IPC
// channel (see electron/main.ts). Web Notifications call their onclick directly.
const _clickHandlers = new Map<string, () => void>();
let _bridgeClicksWired = false;

function wireBridgeClicks(): void {
  if (_bridgeClicksWired || !window.curryLeaves?.onNotifyClick) return;
  _bridgeClicksWired = true;
  window.curryLeaves.onNotifyClick((tag) => { if (tag) _clickHandlers.get(tag)?.(); });
}

function showNotification(title: string, body?: string, opts?: { tag?: string; onClick?: () => void }): void {
  if (window.curryLeaves?.notify) {
    if (opts?.tag && opts.onClick) {
      _clickHandlers.set(opts.tag, opts.onClick);
      wireBridgeClicks();
    }
    window.curryLeaves.notify(title, body || undefined, opts?.tag).catch(() => {});
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  // `tag` makes a re-notification for the same subject replace the old one instead of stacking.
  const n = new Notification(title, { body: body || undefined, tag: opts?.tag });
  if (opts?.onClick) {
    n.onclick = () => { window.focus(); opts.onClick?.(); n.close(); };
  }
}

export function notifyReminderDue(title: string, notes?: string | null): void {
  showNotification(`Reminder: ${title}`, notes || undefined);
}

export function notifyTileAlert(tileTitle: string, message: string): void {
  showNotification(`Alert: ${tileTitle}`, message);
}

/** A background run suspended on a human question/approval ("Waiting on you").
 *  One notification per job (tag-keyed); clicking focuses the app and jumps to
 *  the Assistants office, where the agent is standing at Your desk. */
export function notifyNeedsYou(agentName: string, jobId: string, onClick: () => void): void {
  showNotification(
    `${agentName} needs you`,
    'A run is paused waiting for your answer — it continues with the default if left too long. Click to open the office.',
    { tag: `needs-you-${jobId}`, onClick },
  );
}
