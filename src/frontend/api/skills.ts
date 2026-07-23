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

  // Learned skills — the self-improvement loop's output (lifecycle + provenance + metrics).
  learnedSkills: () => j<{ skills: LearnedSkill[] }>('/skills/learned').then((r) => r.skills),
  setSkillLifecycle: (name: string, status: 'proven' | 'trial' | 'retired') =>
    j<{ ok: boolean; status: string }>(`/skills/${encodeURIComponent(name)}/lifecycle`, {
      method: 'POST', body: JSON.stringify({ status }),
    }),
};

export interface LearnedSkill {
  name: string;
  description: string;
  status?: 'trial' | 'proven' | 'retired';
  appliesTo?: string[] | 'all';
  learnedFrom?: string[];
  learnedAt?: string;
  metrics?: { loads?: number; successes?: number; failures?: number };
}
