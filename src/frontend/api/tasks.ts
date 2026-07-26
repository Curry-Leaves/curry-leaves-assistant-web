/** The common pool, todos, and reminders. */
import type { PoolItem, Todo, Reminder } from '../types';
import { j } from './http';

export const tasksApi = {
  // Common pool
  listPool: () => j<PoolItem[]>('/pool'),
  // `description` is what the user types in the describe box; `title` is optional (the backend
  // derives one from the first line) so the Lead-era front door can post description-only.
  createPoolItem: (item: { title?: string; description?: string; tags?: string[]; priority?: string; autonomy?: 'auto' | 'ask' }) =>
    j<PoolItem>('/pool', { method: 'POST', body: JSON.stringify(item) }),
  assignPoolItem: (id: string, agentId: string) =>
    j<PoolItem>(`/pool/${id}/assign`, { method: 'POST', body: JSON.stringify({ agentId }) }),
  // Manual close from the Inbox — normally an agent completes an item, but the user can
  // resolve one themselves (asked out of band, no longer needed, etc.).
  completePoolItem: (id: string, result = '') =>
    j<PoolItem>(`/pool/${id}/done`, { method: 'POST', body: JSON.stringify({ result, by: 'user' }) }),
  deletePoolItem: (id: string) => j<{ ok: boolean }>(`/pool/${id}`, { method: 'DELETE' }),

  // Todos / reminders
  listTodos: () => j<Todo[]>('/todos'),
  createTodo: (text: string, patch: { priority?: string | null; dueDate?: string | null } = {}) =>
    j<Todo>('/todos', { method: 'POST', body: JSON.stringify({ text, ...patch }) }),
  setTodoDone: (id: string, done: boolean) =>
    j<Todo>(`/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
  updateTodo: (id: string, patch: Partial<Pick<Todo, 'text' | 'priority' | 'dueDate' | 'done'>>) =>
    j<Todo>(`/todos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTodo: (id: string) => j<{ ok: boolean }>(`/todos/${id}`, { method: 'DELETE' }),
  listReminders: () => j<Reminder[]>('/reminders'),
  createReminder: (r: { title: string; dueAt: string; notes?: string | null }) =>
    j<Reminder>('/reminders', { method: 'POST', body: JSON.stringify(r) }),
  updateReminder: (id: string, patch: Partial<Pick<Reminder, 'title' | 'notes' | 'dueAt' | 'done'>>) =>
    j<Reminder>(`/reminders/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteReminder: (id: string) => j<{ ok: boolean }>(`/reminders/${id}`, { method: 'DELETE' }),
};
