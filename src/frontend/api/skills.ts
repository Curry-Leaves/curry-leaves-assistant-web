/** Skills (procedural memory): full directory management per skill. */
import type { SkillSummary, SkillTreeEntry } from '../types';
import { j } from './http';

export const skillsApi = {
  listSkills: () => j<{ skills: SkillSummary[] }>('/skills').then((r) => r.skills),
  getSkillTree: (name: string) => j<{ tree: SkillTreeEntry[] }>(`/skills/${encodeURIComponent(name)}/tree`).then((r) => r.tree),
  getSkillFile: (name: string, path: string) =>
    j<{ content: string }>(`/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`).then((r) => r.content),
  saveSkillFile: (name: string, path: string, content: string) =>
    j<{ ok: boolean }>(`/skills/${encodeURIComponent(name)}/file`, { method: 'PUT', body: JSON.stringify({ path, content }) }),
  makeSkillDir: (name: string, path: string) =>
    j<{ ok: boolean }>(`/skills/${encodeURIComponent(name)}/dir`, { method: 'POST', body: JSON.stringify({ path }) }),
  deleteSkillPath: (name: string, path: string) =>
    j<{ ok: boolean }>(`/skills/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  createSkill: (name: string, description: string, body: string) =>
    j<{ ok: boolean }>('/skills', { method: 'POST', body: JSON.stringify({ name, description, body }) }),
  deleteSkill: (name: string) => j<{ ok: boolean }>(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  // Chat header "Save as skill", two steps with the human in the loop:
  // 1. sessionToSkill ANALYZES the conversation against the existing skill catalog — no side
  //    effects. The model may draft a new skill, propose improving an existing learned one, or
  //    push back (skip) when nothing durable is worth keeping / a skill already covers it.
  // 2. applySessionSkill persists whichever draft the user confirmed in the review dialog.
  sessionToSkill: (sid: string) =>
    j<SkillVerdict>(`/sessions/${encodeURIComponent(sid)}/to-skill`, { method: 'POST' }),
  applySessionSkill: (sid: string, draft: { verdict: 'create' | 'update'; name: string; description: string; body: string }) =>
    j<{ name: string; description: string; status: string; updated: boolean }>(
      `/sessions/${encodeURIComponent(sid)}/to-skill/apply`, { method: 'POST', body: JSON.stringify(draft) }),

  // Learned skills — the self-improvement loop's output (lifecycle + provenance + metrics).
  learnedSkills: () => j<{ skills: LearnedSkill[] }>('/skills/learned').then((r) => r.skills),
  setSkillLifecycle: (name: string, status: 'proven' | 'trial' | 'retired') =>
    j<{ ok: boolean; status: string }>(`/skills/${encodeURIComponent(name)}/lifecycle`, {
      method: 'POST', body: JSON.stringify({ status }),
    }),
};

/** The analyze step's verdict: what the model extracted and what it recommends doing with it. */
export interface SkillVerdict {
  verdict: 'create' | 'update' | 'skip';
  name: string;
  description: string;
  body: string;
  /** update: the learned skill to revise; skip: the skill that already covers this (if any). */
  existing: string;
  /** What future runs concretely gain — shown to the user before they confirm. */
  benefits: string[];
  /** update: what changed and why; skip: the push-back explanation. */
  reason: string;
}

export interface LearnedSkill {
  name: string;
  description: string;
  status?: 'trial' | 'proven' | 'retired';
  appliesTo?: string[] | 'all';
  learnedFrom?: string[];
  learnedAt?: string;
  metrics?: { loads?: number; successes?: number; failures?: number };
}
