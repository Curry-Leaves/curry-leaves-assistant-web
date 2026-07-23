import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { useEvents } from '../../hooks/useEvents';
import type { Artifact, ArtifactKind } from '../../types';

// ─── inline artifact preview in chat ───────────────────────────────────────────
// When an assistant turn contains an artifact share link (artifacts(action='save')
// relays one per deliverable), the bubble renders the artifact
// itself below the text, not just the link. Detection is by URL shape — the id
// and token are in the link, so this works across reloads straight from the
// persisted transcript, with no message-model or backend changes. A revoked
// token means the iframe 404s, same as clicking the stale link would.

const KIND_ICON: Record<ArtifactKind, string> = {
  presentation: 'slides', report: 'file', page: 'globe', diagram: 'grid', other: 'sparkle',
};

// {base}/a/<a-8hex>/<32hex>/ — see stores/artifact_store.py (_new_id/_new_token)
// and agents/artifact_tools.py (_share_url).
const ARTIFACT_URL_RE = /https?:\/\/[^\s)"'<>]+\/a\/(a-[0-9a-f]{8})\/([0-9a-f]{32})\/?/g;

/** Unique artifact share links in a message, in order of first appearance. */
export function extractArtifactLinks(text: string): { id: string; url: string }[] {
  const seen = new Map<string, string>();
  for (const m of text.matchAll(ARTIFACT_URL_RE)) {
    if (!seen.has(m[1])) seen.set(m[1], m[0].endsWith('/') ? m[0] : `${m[0]}/`);
  }
  return [...seen.entries()].map(([id, url]) => ({ id, url }));
}

export function ArtifactEmbed({ id, url }: { id: string; url: string }) {
  const [meta, setMeta] = useState<Artifact | null>(null);
  const [open, setOpen] = useState(true);
  // Bumped when this artifact is re-saved so the iframe picks up the new version.
  const [gen, setGen] = useState(0);

  useEffect(() => { api.getArtifact(id).then(setMeta).catch(() => {}); }, [id, gen]);
  useEvents((raw) => {
    const e = raw as { type: string; entityId?: string };
    if (e.type === 'artifact.saved' && e.entityId === id) setGen((g) => g + 1);
  });

  const icon = meta ? KIND_ICON[meta.kind] ?? 'sparkle' : 'sparkle';
  const src = useMemo(() => (gen ? `${url}?v=${gen}` : url), [url, gen]);

  return (
    <div className="rounded-[12px] border border-border overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border bg-border-soft/40">
        <button type="button" onClick={() => setOpen((o) => !o)} title={open ? 'Collapse preview' : 'Expand preview'}
          className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <span className="text-ink3 flex-none"><Icon name={open ? 'chevD' : 'chevR'} size={10} /></span>
          <span className="text-accent flex-none"><Icon name={icon} size={13} /></span>
          <span className="text-[12px] font-550 text-ink truncate">{meta?.title ?? 'Artifact'}</span>
        </button>
        <a href={url} target="_blank" rel="noreferrer" title="Open in browser"
          className="w-6 h-6 grid place-items-center rounded-[6px] text-ink3 hover:bg-border-soft flex-none">
          <Icon name="arrowR" size={12} />
        </a>
        <a href={`${url}download`} target="_blank" rel="noreferrer" title="Download"
          className="w-6 h-6 grid place-items-center rounded-[6px] text-ink3 hover:bg-border-soft flex-none">
          <Icon name="download" size={12} />
        </a>
      </div>
      {open && <ScaledFrame key={src} src={src} title={meta?.title ?? 'Artifact preview'} />}
    </div>
  );
}

// The artifact renders in a fixed 1280×720 virtual viewport scaled down to the
// bubble's width — decks and pages lay out as they would in a real browser tab,
// and nothing overflows or grows scrollbars inside the chat column. The sandbox
// (no allow-same-origin) means we can't measure the document, so a fixed design
// viewport is the only reliable fit. Clicks still land correctly under scale().
const FRAME_W = 1280;
const FRAME_H = 720;

function ScaledFrame({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full max-w-full overflow-hidden bg-white" style={{ height: w ? Math.round(w * (FRAME_H / FRAME_W)) : 0 }}>
      {w > 0 && (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          sandbox="allow-scripts"
          className="border-0 origin-top-left"
          style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${w / FRAME_W})` }}
        />
      )}
    </div>
  );
}
