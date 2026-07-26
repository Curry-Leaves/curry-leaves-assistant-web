/** Global (⌘K) search — one call fans out across every silo on the backend.
 *  `types`: comma-separated silo allowlist ("recording"), used by the chat composer's @-menu
 *  to scope to one kind. Scoped to a single silo, an EMPTY query returns that silo's recents
 *  instead of nothing — which is what an @-menu shows before the user types. */
import type { SearchResult } from '../types';
import { j } from './http';

export const searchApi = {
  globalSearch: (q: string, limit = 24, types?: string) =>
    j<{ results: SearchResult[] }>(
      `/search?q=${encodeURIComponent(q)}&limit=${limit}${types ? `&types=${encodeURIComponent(types)}` : ''}`,
    ).then((r) => r.results),
};
