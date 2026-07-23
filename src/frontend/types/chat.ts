export interface ChatSessionMeta {
  id: string;
  title: string;
  agentId: string | null;
  model: string;
  messageCount: number;
  updatedAt: number; // epoch seconds
}

export interface ChatAttachment {
  name: string;
  mdPath?: string;  // server-side id, present on staged uploads (not on reload)
  size?: number;
}

// An @-mention: a HANDLE to something the user owns (recording, note, todo, …), not its
// content. The backend puts `type · id · title` plus the tool that opens it in the prompt,
// so a two-hour transcript and a three-word todo cost the same at build time.
export interface ChatReference {
  type: 'recording' | 'todo' | 'reminder' | 'note' | 'file';
  id: string;
  title: string;
}

// One item of the agent's run-scoped plan (the task_create/task_update tools). Rendered
// as the live Tasks panel beside the composer, not as per-call tool cards.
export interface SessionTask {
  id: string;
  subject: string;
  activeForm?: string | null; // present-tense label shown while in_progress
  status: 'pending' | 'in_progress' | 'completed';
}

export interface ChatServerMsg {
  role: 'user' | 'assistant';
  content: string;
  tools?: { id: string; name: string; input?: string; output?: string; status: 'running' | 'done' | 'error' }[];
  attachments?: ChatAttachment[];
  references?: ChatReference[];
}
