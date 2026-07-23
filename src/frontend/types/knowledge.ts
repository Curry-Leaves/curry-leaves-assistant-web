export interface KnowledgeNote {
  path: string;
  type: string | null;
  title: string | null;
  description?: string | null;
  tags?: string[];
  aliases?: string[];
  id?: string | null;
}

export interface KnowledgeNoteDetail {
  path: string;
  text: string;
  type: string | null;
  title: string | null;
  id?: string | null;
}

export interface KnowledgeHit extends KnowledgeNote {
  snippet?: string;
  score?: number;
}

export interface KnowledgeGraphNode {
  path: string;
  title: string;
  type: string | null;
  degree: number;
}
export interface KnowledgeGraphLink { source: string; target: string; rel?: string }
export interface KnowledgeGraph { nodes: KnowledgeGraphNode[]; links: KnowledgeGraphLink[] }

export interface KnowledgeHistoryEntry {
  ts: string;
  action: string;            // created | updated | edited | appended
  source: { type?: string; id?: string; label?: string } | null;
  bytes: number;
  text: string;              // full snapshot at this version
}

// Provenance chain (Feature 1): a note section → transcript span.
export interface KnowledgeProvenanceSpan {
  meeting_id: string;
  rec_id: string | null;
  title: string | null;
  turn_range?: [number, number];
  t0: number | null;
  t1: number | null;
  speaker: string | null;
  text: string;
}
export interface KnowledgeProvenanceEntry {
  meeting_id: string;
  section: string | null;
  turn_range: [number, number] | null;
  speaker: string | null;
  ts: string;
  span: KnowledgeProvenanceSpan | null;
}
export interface KnowledgeProvenance { note: string; entries: KnowledgeProvenanceEntry[] }

// Conflict queue (Feature 2).
export interface KnowledgeConflict {
  path: string;
  title: string | null;
  type: string | null;
  description?: string | null;
  updated?: string | null;
}

// Result of feeding a document into the knowledge base.
export interface KnowledgeIngestResult {
  ok: boolean;
  docId: string;
  title: string | null;
  chars: number;
  chunkCount: number;
  duplicate: boolean;
  status?: string;   // 'converting' for uploaded files (rendered in the background)
}

// Ingest activity — what the Keeper is filing now + recently.
export interface KnowledgeIngestEntry {
  jobId: string;
  kind: 'document' | 'meeting' | 'other';
  title: string;
  state: 'converting' | 'queued' | 'running' | 'filed' | 'failed' | 'empty';
  at: string | null;
  error?: string | null;
  summary?: string | null;
}
export interface KnowledgeIngestStatus {
  active: KnowledgeIngestEntry[];
  recent: KnowledgeIngestEntry[];
}

// Procedural memory — manageable skill:// directories ("how we do things"),
// distinct from the Knowledge Base's factual notes. Each skill is a folder
// (SKILL.md + optional references/scripts/assets), not a single flat body.
export interface SkillSummary {
  name: string;
  description: string;
  hide: boolean;
}

export interface SkillTreeEntry {
  path: string;
  isDir: boolean;
  size: number | null;
}

// Gardener report (Feature 4).
export interface KnowledgeGardenerReport {
  ran_at: string;
  notes: number;
  graph_edges: number;
  repairs: number;
  dangling: { from: string; target: string }[];
  compaction: { path: string; lines: number; title: string | null }[];
  stale_conflicts: { path: string; title: string | null; since: string }[];
  old_notes: { path: string; title: string | null; since: string }[];
}

// Read-only KB health sweep (broken links, orphans, missing frontmatter, tag drift).
export interface KnowledgeHealthReport {
  counts: { notes: number; tags: number };
  broken_links: { from: string; target: string }[];
  orphans: string[];
  missing_type: string[];
  missing_description: string[];
  missing_tags: string[];
  singleton_tags: string[];
}
