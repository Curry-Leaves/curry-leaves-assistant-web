export interface HistoryEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  beforeText?: string;
  candidateText?: string;
  outcome?: 'applied' | 'rejected' | 'partial';
  timestamp: number;
}

export interface Hunk {
  id: string;
  partStart: number;
  partEnd: number;
  removed: string;
  added: string;
  state: 'pending' | 'accepted' | 'rejected';
}
