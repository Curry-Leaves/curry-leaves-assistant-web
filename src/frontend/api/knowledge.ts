/** Knowledge base (OKF bundle): notes, graph, health, the Gardener, and ingest. */
import type {
  KnowledgeNote, KnowledgeNoteDetail, KnowledgeHit, KnowledgeGraph, KnowledgeHistoryEntry,
  KnowledgeProvenance, KnowledgeConflict, KnowledgeGardenerReport, KnowledgeHealthReport,
  KnowledgeIngestResult, KnowledgeIngestStatus, EmbeddingsStatus, KnowledgeAsset,
} from '../types';
import { authHeader, getToken } from '../auth';
import { base, j } from './http';

export const knowledgeApi = {
  listKnowledge: () => j<{ notes: KnowledgeNote[] }>('/knowledge').then((r) => r.notes),
  // Notes + every folder (incl. empty user-created ones) so the tree can show folders
  // that hold no notes yet.
  listKnowledgeTree: () => j<{ notes: KnowledgeNote[]; dirs: string[] }>('/knowledge'),
  createKnowledgeDir: (path: string) =>
    j<{ path: string; created: boolean }>('/knowledge/dir',
      { method: 'POST', body: JSON.stringify({ path }) }),
  moveKnowledgeNote: (path: string, destDir: string, newName?: string) =>
    j<{ path: string; moved: boolean }>('/knowledge/note/move',
      { method: 'POST', body: JSON.stringify({ path, dest_dir: destDir, new_name: newName ?? null }) }),
  moveKnowledgeDir: (path: string, destParent: string, newName?: string) =>
    j<{ path: string; moved: boolean; count: number }>('/knowledge/dir/move',
      { method: 'POST', body: JSON.stringify({ path, dest_parent: destParent, new_name: newName ?? null }) }),
  archiveKnowledgeDir: (path: string, reason?: string) =>
    j<{ path: string; archived: boolean; count: number }>(
      `/knowledge/dir?path=${encodeURIComponent(path)}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`,
      { method: 'DELETE' }),
  searchKnowledge: (q: string, limit = 12) =>
    j<{ hits: KnowledgeHit[] }>(`/knowledge/search?q=${encodeURIComponent(q)}&limit=${limit}`).then((r) => r.hits),
  getKnowledgeNote: (path: string) => j<KnowledgeNoteDetail>(`/knowledge/note?path=${encodeURIComponent(path)}`),
  getKnowledgeNoteLinks: (path: string) =>
    j<{ outbound: { path: string; title: string }[]; inbound: { path: string; title: string }[] }>(
      `/knowledge/note/links?path=${encodeURIComponent(path)}`),
  getKnowledgeHistory: (path: string) =>
    j<{ history: KnowledgeHistoryEntry[] }>(`/knowledge/note/history?path=${encodeURIComponent(path)}`).then((r) => r.history),
  getKnowledgeProvenance: (path: string) =>
    j<KnowledgeProvenance>(`/knowledge/note/provenance?path=${encodeURIComponent(path)}`),
  getKnowledgeConflicts: () =>
    j<{ conflicts: KnowledgeConflict[] }>('/knowledge/conflicts').then((r) => r.conflicts),
  getKnowledgeHealth: () => j<KnowledgeHealthReport>('/knowledge/health'),
  runGardener: () => j<KnowledgeGardenerReport>('/knowledge/gardener', { method: 'POST' }),
  getKnowledgeGraph: () => j<KnowledgeGraph>('/knowledge/graph'),
  saveKnowledgeNote: async (path: string, text: string): Promise<KnowledgeNote> => {
    const res = await fetch((await base()) + '/knowledge/note', {
      method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeader() }, body: JSON.stringify({ path, text }),
    });
    if (!res.ok) throw new Error(res.status === 400 ? await res.text() : `/knowledge/note → ${res.status}`);
    return res.json();
  },
  deleteKnowledgeNote: (path: string) =>
    j<{ ok: boolean }>(`/knowledge/note?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  getKnowledgeIngestStatus: () => j<KnowledgeIngestStatus>('/knowledge/ingest/status'),
  /** Semantic-search model status. Weights are never fetched at boot — this says whether to
   *  offer the download in setup/settings. */
  getEmbeddingsStatus: () => j<EmbeddingsStatus>('/knowledge/embeddings'),
  /** Download (~90 MB) + warm the embedding model on explicit request. */
  downloadEmbeddings: () =>
    j<EmbeddingsStatus & { ok: boolean; error?: string }>('/knowledge/embeddings/download', { method: 'POST' }),
  ingestKnowledgeText: (text: string, title?: string) =>
    j<KnowledgeIngestResult>('/knowledge/ingest', { method: 'POST', body: JSON.stringify({ text, title: title || null }) }),
  ingestKnowledgeFile: async (filename: string, data: ArrayBuffer): Promise<KnowledgeIngestResult> => {
    const res = await fetch((await base()) + `/knowledge/ingest/file?filename=${encodeURIComponent(filename)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeader() }, body: data,
    });
    if (!res.ok) throw new Error(res.status === 400 ? await res.text() : `/knowledge/ingest/file → ${res.status}`);
    return res.json();
  },

  /** Store an image (paste/drop/picker) in the bundle. Returns the bundle-relative path
   *  to write into the note as `![alt](assets/…)`. Raw body — the editor already holds
   *  a Blob, so multipart would only add encoding on both ends. */
  uploadKnowledgeAsset: async (filename: string, data: ArrayBuffer): Promise<KnowledgeAsset> => {
    const res = await fetch((await base()) + `/knowledge/asset?filename=${encodeURIComponent(filename)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...authHeader() }, body: data,
    });
    // 400 carries the reason (unsupported type, too large) as plain text — surface it verbatim
    // so the editor can tell the user WHY the paste didn't stick.
    if (!res.ok) throw new Error(res.status === 400 ? await res.text() : `/knowledge/asset → ${res.status}`);
    return res.json();
  },

  /** Absolute URL for a stored asset, for `<img src>`.
   *
   * The token rides as a query param because a browser image request cannot carry an
   * Authorization header — the same reason SSE and the WebSocket do it (see
   * `core/auth.token_from_request`). Async because the backend base is resolved at runtime
   * (the desktop shell hands it over on boot). */
  knowledgeAssetUrl: async (path: string): Promise<string> => {
    const token = getToken();
    const q = `path=${encodeURIComponent(path)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
    return (await base()) + `/knowledge/asset?${q}`;
  },
};
