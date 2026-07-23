import type { Agent } from '../../types';

// A one-shot "someone was just hired" signal, decoupled from React state so the
// Team tab (where hiring happens) can tell the Office tab (which owns the floor and
// the walk-in animation) about a new arrival without threading props across screens.
type HireListener = (agent: Agent) => void;
const _listeners = new Set<HireListener>();

/** Fire after a successful hire (direct or via "tweak first" save). */
export function announceHire(agent: Agent): void {
  for (const fn of _listeners) { try { fn(agent); } catch { /* ignore */ } }
}

/** Subscribe to hires; returns an unsubscribe. The Office floor uses this to walk the
 *  new arrival in from the front desk and show a welcome toast. */
export function onHire(fn: HireListener): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}
