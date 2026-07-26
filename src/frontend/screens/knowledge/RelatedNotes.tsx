import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { KnowledgeHit } from '../../types';

// "Related notes" — a cheap (search-index, no AI) suggestion of notes near this one, so a
// freshly created note doesn't stay an orphan. The query is the note's own title + tags;
// the current note and anything already linked are filtered out. Each hit navigates on
// click (to link it into the body, use the editor's link picker in edit mode).
export function RelatedNotes({ path, title, tags, linkedPaths, onNavigate }: {
  path: string;
  title: string | null;
  tags: string[];
  linkedPaths: Set<string>;
  onNavigate: (p: string) => void;
}) {
  const [hits, setHits] = useState<KnowledgeHit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = [title || '', ...tags].join(' ').trim();
    if (!q) { setHits([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api.searchKnowledge(q, 8)
      .then((r) => { if (alive) setHits(r.filter((h) => h.path !== path && !linkedPaths.has(h.path)).slice(0, 5)); })
      .catch(() => { if (alive) setHits([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // linkedPaths is a fresh Set each render; key on its serialized contents instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, title, tags.join(','), [...linkedPaths].join(',')]);

  if (loading) return <div className="text-[11.5px] text-faint">Finding related notes…</div>;
  if (hits.length === 0) return <div className="text-[11.5px] text-faint">No related notes found.</div>;

  return (
    <div className="flex flex-col gap-1">
      {hits.map((h) => (
        <button key={h.path} type="button" onClick={() => onNavigate(h.path)} title={h.path}
          className="w-full text-left px-2.5 py-1.5 rounded-[7px] border border-border bg-card hover:border-accent-soft hover:bg-accent-soft/20">
          <div className="text-[12px] text-ink2 truncate">{h.title || h.path.split('/').pop()}</div>
          {h.snippet && <div className="text-[10.5px] text-ink3 truncate mt-0.5">{h.snippet}</div>}
        </button>
      ))}
    </div>
  );
}
