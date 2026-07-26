export interface Todo {
  id: string;
  text: string;
  done: boolean;
  priority: string | null;
  dueDate: string | null;
  source: { type: string; id: string; label?: string | null } | null;
  createdAt: string;
  // Proactive-assistant lifecycle (set when the Todo Triage agent hands an actionable todo to
  // the team). null → untouched; 'working' → a run is in flight; 'review' → done, result +
  // conversation attached below for the user to inspect and continue.
  assistantStatus?: 'working' | 'review' | null;
  assistantResult?: string | null;      // summary of what the team did
  assistantSessionId?: string | null;   // run_<jobId> — open the conversation to continue it
  assistantPoolItemId?: string | null;  // the pool item this todo was posted as
}

export interface Reminder {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string;
  done: boolean;
  alertedAt?: string | null;
  source: { type: string; id: string; label?: string | null } | null;
  createdAt: string;
}

export interface PoolItem {
  id: string;
  title: string;
  description: string;
  tags: string[];
  priority: 'P1' | 'P2' | 'P3';
  /** How the assigned run treats approvals: 'auto' (approve-all) | 'ask' (pause for you). */
  autonomy?: 'auto' | 'ask';
  status: 'waiting' | 'assigned' | 'done';
  assignedAgent: string | null;
  result: string | null;
  createdAt: string;
}
