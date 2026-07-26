import { useEffect, useRef } from 'react';
import { subscribeEvents } from '../api/client';

/** Subscribe to the backend's live SSE event stream for this component's lifetime.
 *  The handler is ref-forwarded so it always sees the latest closure — callers
 *  don't need to memoize it or resubscribe when dependencies change. */
export function useEvents(onEvent: (e: unknown) => void) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    let stop = () => {};
    let gone = false; // unmounted before the subscription resolved → close it on arrival
    subscribeEvents((e) => cb.current(e))
      .then((fn) => { if (gone) fn(); else stop = fn; })
      .catch(() => {});
    return () => { gone = true; stop(); };
  }, []);
}
