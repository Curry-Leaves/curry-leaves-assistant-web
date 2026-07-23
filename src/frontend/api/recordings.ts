/** Recordings: capture lifecycle, audio, attachments, and outputs. */
import type { Recording, RecordingAttachment, RecordingOutput } from '../types';
import { authHeader, withToken } from '../auth';
import { base, j } from './http';

export const recordingsApi = {
  listRecordings: () => j<Recording[]>('/recordings'),
  // Drafts orphaned mid-capture (crash / closed tab) awaiting a Save/Discard decision.
  listInterruptedRecordings: () => j<Recording[]>('/recordings/interrupted'),
  getRecording: (id: string) => j<Recording>(`/recordings/${id}`),
  createRecording: (name?: string, templateId?: string, language?: string) =>
    j<Recording>('/recordings', { method: 'POST', body: JSON.stringify({ name, templateId, language }) }),
  suggestAttendees: () => j<{ names: string[] }>('/recordings/attendees/suggest'),
  appendChunk: async (id: string, buf: ArrayBuffer) =>
    fetch((await base()) + `/recordings/${id}/chunk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeader() },
      body: buf,
    }),
  finalizeRecording: (id: string, name: string, duration: number) =>
    j<Recording>(`/recordings/${id}/finalize`, {
      method: 'POST',
      body: JSON.stringify({ name, duration }),
    }),
  resubmitRecording: (id: string) => j<Recording>(`/recordings/${id}/resubmit`, { method: 'POST' }),
  // Save an interrupted (crash-orphaned) draft → finalize + transcribe. Discard is deleteRecording.
  recoverRecording: (id: string) => j<Recording>(`/recordings/${id}/recover`, { method: 'POST' }),
  deleteRecording: (id: string) => j<{ ok: boolean }>(`/recordings/${id}`, { method: 'DELETE' }),
  updateRecording: (id: string, patch: Partial<Pick<Recording, 'name' | 'notes' | 'links' | 'tags' | 'saveToKnowledge' | 'language' | 'attendees' | 'templateId' | 'templateIds'>>) =>
    j<Recording>(`/recordings/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  attachToRecording: async (id: string, file: File): Promise<RecordingAttachment> => {
    const res = await fetch((await base()) + `/recordings/${id}/attach?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeader() }, body: await file.arrayBuffer(),
    });
    if (!res.ok) throw new Error(`/attach → ${res.status}`);
    return res.json();
  },
  removeRecordingAttachment: (id: string, name: string) =>
    j<Recording>(`/recordings/${id}/attachments/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  listRecordingOutputs: (id: string) => j<RecordingOutput[]>(`/recordings/${id}/outputs`),
  deleteRecordingOutput: (id: string, key: string) =>
    j<{ ok: boolean }>(`/recordings/${id}/outputs/${encodeURIComponent(key)}`, { method: 'DELETE' }),
  rerunRecordingAgent: (id: string, agentId: string) =>
    j<{ jobId: string }>(`/recordings/${id}/rerun/${encodeURIComponent(agentId)}`, { method: 'POST' }),
  deleteAudio: (id: string) => j<Recording>(`/recordings/${id}/audio`, { method: 'DELETE' }),
  saveAudio: async (id: string, wav: ArrayBuffer, duration: number): Promise<Recording> => {
    const res = await fetch((await base()) + `/recordings/${id}/save-audio?duration=${duration}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeader() }, body: wav,
    });
    if (!res.ok) throw new Error(`/save-audio → ${res.status}`);
    return res.json();
  },
  // <audio>/<img>-style elements can't set an Authorization header, so the token
  // rides along as a query param (same trick SSE/WebSocket already use). `v` is a
  // cache-busting param callers pass (duration changes → new edited audio).
  audioUrl: async (id: string, v?: number) =>
    withToken((await base()) + `/recordings/${id}/audio?v=${v ?? 0}`),
};
