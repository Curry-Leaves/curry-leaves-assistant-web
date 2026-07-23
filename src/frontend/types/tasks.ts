export interface Todo {
  id: string;
  text: string;
  done: boolean;
  priority: string | null;
  dueDate: string | null;
  source: { type: string; id: string; label?: string | null } | null;
  createdAt: string;
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
  status: 'waiting' | 'assigned' | 'done';
  assignedAgent: string | null;
  result: string | null;
  createdAt: string;
}
