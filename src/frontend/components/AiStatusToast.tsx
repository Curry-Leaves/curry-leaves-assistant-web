/**
 * Global "AI not ready" banner.
 *
 * The backend can't run anything without a connected provider AND a resolvable default
 * model — but nothing in the app blocked (or warned) a fresh user before they sent a
 * message and hit the failure inline. This surfaces that condition app-wide, proactively:
 * a dismissible toast pinned bottom-center, driven by the backend's readiness signal.
 *
 * State comes from two sources that agree on shape ({ready, reason, detail}):
 *   - an initial fetch on mount (so the banner shows even before any event fires), and
 *   - the `system.ai.status` event, re-broadcast by the backend at startup and whenever
 *     provider settings change — so connecting a provider clears the banner live, and
 *     disconnecting the last one re-raises it.
 *
 * Dismiss hides it until readiness CHANGES again (tracked by a signature of reason+provider),
 * so clearing then re-breaking shows a fresh toast rather than staying suppressed forever.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { AiStatus } from '../api/providers';
import { useEvents } from '../hooks/useEvents';
import { Icon } from './chrome/Icon';

export function AiStatusToast({ onOpenSettings }: { onOpenSettings: (sectionId: string) => void }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  // Signature of the last status the user dismissed — while it matches the current one the
  // banner stays hidden; any change (different reason, provider, or back-to-ready-then-broken)
  // makes it show again.
  const dismissed = useRef<string | null>(null);
  const [, force] = useState(0);

  useEffect(() => { api.aiStatus().then(setStatus).catch(() => {}); }, []);
  useEvents((raw) => {
    const e = raw as { type?: string; payload?: AiStatus };
    if (e.type === 'system.ai.status' && e.payload) setStatus(e.payload);
  });

  if (!status || status.ready) return null;
  const sig = `${status.reason}:${status.provider}`;
  if (dismissed.current === sig) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-[440px] w-[calc(100vw-2rem)] sm:w-[440px]">
      <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-[12px] border border-rec/40 bg-card shadow-pop">
        <span className="w-5 h-5 rounded-full grid place-items-center flex-none mt-0.5 bg-rec/15">
          <Icon name="warning" size={12} color="var(--color-rec)" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-600 text-ink">
            {status.reason === 'no_model' ? 'No default model selected'
              : status.reason === 'provider_disabled' ? 'Your AI provider is turned off'
              : 'No AI provider connected'}
          </div>
          <div className="text-[11.5px] text-ink2 leading-snug mt-0.5">
            {status.detail || 'Agents and chat can’t run until this is set up.'}
          </div>
          <button
            type="button"
            onClick={() => onOpenSettings('ai')}
            className="mt-1.5 inline-flex items-center gap-1 h-6 px-2 rounded-[7px] text-[11px] font-500 text-white bg-accent hover:opacity-90"
          >
            <Icon name="settings" size={11} />
            <span>Open AI providers</span>
          </button>
        </div>
        <button
          type="button"
          title="Dismiss"
          onClick={() => { dismissed.current = sig; force((n) => n + 1); }}
          className="w-6 h-6 flex-none flex items-center justify-center rounded-[6px] text-ink3 hover:bg-border-soft"
        >
          <Icon name="x" size={12} />
        </button>
      </div>
    </div>
  );
}
