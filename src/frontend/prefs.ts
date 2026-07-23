/** Client-only display preferences — pure UI state, no backend round-trip.
 *
 *  Unlike theme (which persists in settings.json so every device agrees), these are
 *  per-browser view toggles: how much of a chat turn to show. localStorage is the whole
 *  source of truth, and a shared in-memory store keeps every consumer in sync (the
 *  Settings toggle and the chat view update together without a reload). */
import { useCallback, useSyncExternalStore } from 'react';

// ── verbose chat: show tool calls + subagent activity, or just the streaming thought ──
// Default OFF: a chat turn shows only the assistant's thinking (streamed live) and its
// reply. Turn it on to also see every tool call and the nested subagent tree.
const VERBOSE_KEY = 'curry-leaves.chat.verbose';

function readVerbose(): boolean {
  try { return localStorage.getItem(VERBOSE_KEY) === '1'; } catch { return false; }
}

let _verbose = readVerbose();
const _listeners = new Set<() => void>();

function setVerbose(on: boolean): void {
  if (_verbose === on) return;
  _verbose = on;
  try { localStorage.setItem(VERBOSE_KEY, on ? '1' : '0'); } catch { /* private mode — in-memory only */ }
  _listeners.forEach((l) => l());
}

/** `[verbose, setVerbose]` — reads the shared store so the Settings toggle and the chat
 *  view stay in lockstep. */
export function useVerboseChat(): [boolean, (on: boolean) => void] {
  const verbose = useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => { _listeners.delete(cb); }; },
    () => _verbose,
  );
  return [verbose, useCallback(setVerbose, [])];
}
