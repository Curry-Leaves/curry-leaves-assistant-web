export type ArtifactKind = 'presentation' | 'report' | 'page' | 'diagram' | 'other';

export interface ArtifactSource { type: string; id: string }

/** A reference file the user uploaded into an artifact (a logo, photo, screenshot).
 *  `path` is artifact-relative and POSIX-style — exactly what goes in the HTML's src. */
export interface ArtifactAsset {
  path: string;
  name: string;
  size: number;
  kind: string;
  width?: number;
  height?: number;
}

export interface Artifact {
  id: string;
  title: string;
  kind: ArtifactKind;
  description: string;
  entry: string;
  agentId: string | null;
  source: ArtifactSource | null;
  shareToken: string;
  createdAt: string;
  updatedAt: string;
}
