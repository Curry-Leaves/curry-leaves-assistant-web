/** Dictation and transcription model management. */
import type { WhisperModelInfo, LearnedTerm } from '../types';
import { authHeader } from '../auth';
import { base, j } from './http';

export const transcriptionApi = {
  transcribeAudio: async (buf: ArrayBuffer): Promise<string> => {
    const res = await fetch((await base()) + '/transcribe', {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeader() }, body: buf,
    });
    if (!res.ok) throw new Error(`/transcribe → ${res.status}`);
    return (await res.json()).text as string;
  },

  // Transcription models
  listModels: () => j<{
    models: WhisperModelInfo[]; language: string; languages: { code: string; label: string }[];
    vocabulary: string; learnedVocabulary: LearnedTerm[]; learnedMinCount: number;
  }>('/models'),
  selectModel: (patch: { backend?: string; model?: string; language?: string; vocabulary?: string }) =>
    j<{ models: WhisperModelInfo[]; language: string; vocabulary: string }>('/models/select', { method: 'POST', body: JSON.stringify(patch) }),
  downloadModel: (name: string, backend?: string) =>
    j<{ ok: boolean; models: WhisperModelInfo[] }>(`/models/${name}/download`, { method: 'POST', body: JSON.stringify({ backend }) }),

  // Vocabulary learned from meeting notes
  blockLearnedTerm: (term: string, blocked: boolean) =>
    j<{ ok: boolean; learnedVocabulary: LearnedTerm[] }>('/vocabulary/block', { method: 'POST', body: JSON.stringify({ term, blocked }) }),
  clearLearnedVocabulary: () =>
    j<{ ok: boolean; learnedVocabulary: LearnedTerm[] }>('/vocabulary/clear', { method: 'POST' }),
};
