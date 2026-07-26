/** Artifact registry — LLM-generated deliverables (presentations, reports, pages…). */
import { authHeader } from '../auth';
import type { Artifact, ArtifactAsset } from '../types';
import { base, j } from './http';

export const artifactsApi = {
  listArtifacts: () => j<Artifact[]>('/artifacts'),
  getArtifact: (id: string) => j<Artifact>(`/artifacts/${id}`),
  deleteArtifact: (id: string) => j<{ ok: boolean }>(`/artifacts/${id}`, { method: 'DELETE' }),
  regenerateArtifactToken: (id: string) => j<Artifact>(`/artifacts/${id}/regenerate-token`, { method: 'POST' }),
  // Content editing — decks (built from markdown) round-trip their source.md;
  // everything else edits the entry file (usually HTML) directly.
  getArtifactContent: (id: string) =>
    j<{ format: 'deck-markdown' | 'entry'; content: string }>(`/artifacts/${id}/content`),
  updateArtifactContent: (id: string, content: string) =>
    j<Artifact>(`/artifacts/${id}/content`, { method: 'PUT', body: JSON.stringify({ content }) }),
  // Reference assets — images the user supplies for an artifact to use. The agent reads
  // them back with artifacts_read(action='assets') and refers to them by relative path.
  listArtifactAssets: (id: string) => j<ArtifactAsset[]>(`/artifacts/${id}/assets`),
  deleteArtifactAsset: (id: string, path: string) =>
    j<{ ok: boolean }>(`/artifacts/${id}/assets/${path.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'DELETE' }),
  // Raw body + filename in the query, like every other binary upload here (chat attach,
  // KB ingest): `j` hardcodes a JSON content-type, so this goes through fetch directly.
  uploadArtifactAsset: async (id: string, file: File): Promise<ArtifactAsset> => {
    const q = new URLSearchParams({ filename: file.name });
    const res = await fetch((await base()) + `/artifacts/${id}/assets?${q.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', ...authHeader() },
      body: await file.arrayBuffer(),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => null);
      throw new Error(detail?.error || `upload failed (${res.status})`);
    }
    return res.json();
  },
  // The public capability URL — no auth token needed, works from any browser.
  artifactShareUrl: async (a: Pick<Artifact, 'id' | 'shareToken'>) =>
    `${await base()}/a/${a.id}/${a.shareToken}/`,
  artifactDownloadUrl: async (a: Pick<Artifact, 'id' | 'shareToken'>) =>
    `${await base()}/a/${a.id}/${a.shareToken}/download`,
};
