/** One hit from the global (⌘K) search aggregator. `type` decides how the palette
 *  opens it; `id` is whatever that type's open-handler needs (note path, recording id…). */
export type SearchResultType =
  | 'knowledge' | 'recording' | 'todo' | 'reminder' | 'artifact' | 'agent';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  snippet: string;
  date: string | null;
  score: number;
}
