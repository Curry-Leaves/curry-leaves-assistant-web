import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { useEvents } from '../../hooks/useEvents';
import type { Artifact, ArtifactKind } from '../../types';
import { AssetsPane } from './AssetsPane';

const KIND_LABEL: Record<ArtifactKind, string> = {
  presentation: 'Presentation', report: 'Report', page: 'Page', diagram: 'Diagram', other: 'Other',
};
const KIND_ICON: Record<ArtifactKind, string> = {
  presentation: 'slides', report: 'file', page: 'globe', diagram: 'grid', other: 'sparkle',
};

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · '
    + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

// ── screen — master/detail: artifact list on the left, live viewer on the right ──
export function ArtifactsScreen() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteStep, setDeleteStep] = useState(0);
  const [busy, setBusy] = useState(false);
  // Bumped when the selected artifact is re-saved so the viewer reloads it.
  const [gen, setGen] = useState(0);
  // Edit mode — decks round-trip their markdown source, others their entry file.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftFormat, setDraftFormat] = useState<'deck-markdown' | 'entry'>('entry');
  const [saveErrs, setSaveErrs] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const selected = artifacts.find((a) => a.id === selectedId) ?? null;

  const refresh = useCallback(() => {
    api.listArtifacts().then((list) => {
      setArtifacts(list);
      setLoading(false);
      // Keep the current selection when it still exists; otherwise fall back to newest.
      setSelectedId((cur) => (cur && list.some((a) => a.id === cur) ? cur : list[0]?.id ?? null));
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEvents((raw) => {
    const e = raw as { type: string; entityId?: string };
    if (e.type === 'artifact.saved' || e.type === 'artifact.deleted') refresh();
    if (e.type === 'artifact.saved' && e.entityId === selectedId) setGen((g) => g + 1);
  });

  // The share URL is async (server base resolves lazily), so resolve it per selection.
  useEffect(() => {
    setViewUrl(null);
    setDeleteStep(0);
    setEditing(false);
    setSaveErrs([]);
    if (!selected) return;
    let stale = false;
    api.artifactShareUrl(selected).then((u) => { if (!stale) setViewUrl(u); });
    return () => { stale = true; };
    // shareToken in deps: revoking mints a new token and the viewer must follow it.
  }, [selectedId, selected?.shareToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyLink = async () => {
    if (!selected) return;
    const url = await api.artifactShareUrl(selected);
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };
  const download = async () => {
    if (!selected) return;
    window.open(await api.artifactDownloadUrl(selected), '_blank');
  };
  const openExternal = async () => {
    if (!selected) return;
    window.open(await api.artifactShareUrl(selected), '_blank');
  };
  const revoke = async () => {
    if (!selected) return;
    setBusy(true);
    try { await api.regenerateArtifactToken(selected.id); refresh(); } finally { setBusy(false); }
  };
  const handleDelete = async () => {
    if (!selected) return;
    if (deleteStep === 0) { setDeleteStep(1); setTimeout(() => setDeleteStep((s) => (s === 1 ? 0 : s)), 3000); return; }
    setBusy(true);
    try { await api.deleteArtifact(selected.id); refresh(); } finally { setBusy(false); setDeleteStep(0); }
  };
  const startEdit = async () => {
    if (!selected) return;
    setSaveErrs([]);
    try {
      const c = await api.getArtifactContent(selected.id);
      setDraft(c.content);
      setDraftFormat(c.format);
      setEditing(true);
    } catch (e) {
      setSaveErrs([e instanceof Error && e.message.includes('binary') ? 'This artifact is binary — not editable as text.' : 'Could not load content.']);
    }
  };
  const saveEdit = async () => {
    if (!selected) return;
    setSaving(true);
    setSaveErrs([]);
    try {
      await api.updateArtifactContent(selected.id, draft);
      setEditing(false); // artifact.saved event refreshes the list and reloads the viewer
    } catch (e) {
      // A deck that fails validation comes back as 422 {"errors": [...]} — show each line.
      let msgs = ['Save failed.'];
      if (e instanceof Error) {
        try { msgs = (JSON.parse(e.message) as { errors: string[] }).errors; } catch { msgs = [e.message]; }
      }
      setSaveErrs(msgs);
    } finally {
      setSaving(false);
    }
  };

  const q = search.trim().toLowerCase();
  const filtered = q
    ? artifacts.filter((a) => a.title.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q))
    : artifacts;

  return (
    <div className="flex-1 flex min-h-0 min-w-0 overflow-hidden">
      {/* ── left rail: artifact list ── */}
      <div className="w-[280px] flex-none border-r border-border flex flex-col min-h-0">
        <div className="px-4 pt-5 pb-3">
          <h2 className="font-serif italic text-[19px] text-ink">Artifacts</h2>
          <p className="text-[11px] text-ink3 mt-0.5 leading-snug">
            Deliverables your agents generated — each has a public share link.
          </p>
        </div>
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] border border-border bg-card">
            <Icon name="search" size={12} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search artifacts…"
              className="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-ink placeholder:text-ink3" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <div className="text-[11.5px] text-faint text-center py-10">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-[11.5px] text-faint text-center py-10 px-3">
              {search ? 'No results' : 'No artifacts yet — ask the assistant to build a presentation or report.'}
            </div>
          ) : (
            filtered.map((a) => (
              <button key={a.id} type="button" onClick={() => setSelectedId(a.id)}
                className={`w-full text-left px-2.5 py-2 rounded-[9px] flex items-start gap-2.5 ${
                  a.id === selectedId ? 'bg-accent-soft/50' : 'hover:bg-border-soft'}`}>
                <span className={`flex-none mt-0.5 ${a.id === selectedId ? 'text-accent' : 'text-ink3'}`}>
                  <Icon name={KIND_ICON[a.kind]} size={14} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className={`block text-[12.5px] truncate ${a.id === selectedId ? 'text-ink font-550' : 'text-ink2'}`}>{a.title}</span>
                  <span className="block text-[10.5px] text-ink3 mt-0.5">{KIND_LABEL[a.kind]} · {fmtDate(a.updatedAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── right pane: viewer ── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {!selected ? (
          <div className="flex-1 grid place-items-center text-center">
            <div>
              <div className="w-12 h-12 rounded-[12px] bg-accent-soft/30 grid place-items-center text-accent mx-auto mb-3">
                <Icon name="slides" size={20} />
              </div>
              <div className="text-[13.5px] text-ink2 font-500">{loading ? 'Loading…' : 'No artifact selected'}</div>
              {!loading && (
                <div className="text-[12px] text-ink3 mt-1 max-w-[320px]">
                  Pick an artifact from the list, or ask the assistant to build a presentation or report.
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-none flex items-center gap-2 px-4 py-2.5 border-b border-border min-w-0 overflow-hidden">
              <span className="flex-none w-8 h-8 rounded-[8px] bg-accent-soft/30 grid place-items-center text-accent">
                <Icon name={KIND_ICON[selected.kind]} size={15} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-550 text-ink truncate">{selected.title}</div>
                <div className="text-[10.5px] text-ink3 truncate">
                  {KIND_LABEL[selected.kind]} · {fmtDate(selected.updatedAt)}
                  {selected.agentId && <> · by {selected.agentId}</>}
                  {selected.description && <> — {selected.description}</>}
                </div>
              </div>
              {editing ? (
                <>
                  <button type="button" onClick={saveEdit} disabled={saving}
                    className="h-8 px-3 rounded-[7px] bg-accent text-on-accent text-[12px] font-550 hover:bg-accent-dark disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => { setEditing(false); setSaveErrs([]); }} disabled={saving}
                    className="h-8 px-3 rounded-[7px] border border-border text-ink2 text-[12px] hover:border-ink3 disabled:opacity-60">
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" title="Edit content" onClick={startEdit}
                  className="w-8 h-8 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3">
                  <Icon name="edit" size={14} />
                </button>
              )}
              <button type="button" title="Open in browser" onClick={openExternal}
                className="w-8 h-8 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3">
                <Icon name="arrowR" size={14} />
              </button>
              <button type="button" title="Copy link" onClick={copyLink}
                className="w-8 h-8 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3">
                <Icon name={copied ? 'check' : 'link'} size={14} />
              </button>
              <button type="button" title="Download" onClick={download}
                className="w-8 h-8 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3">
                <Icon name="download" size={14} />
              </button>
              <button type="button" title="Revoke link (mint a new one)" onClick={revoke} disabled={busy}
                className="w-8 h-8 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3 disabled:opacity-60">
                <Icon name="refresh" size={14} />
              </button>
              <button type="button" onClick={handleDelete} disabled={busy}
                title={deleteStep === 1 ? 'Click again to confirm' : 'Delete'}
                className={`w-8 h-8 grid place-items-center rounded-[7px] border disabled:opacity-60 ${
                  deleteStep === 1 ? 'border-rec/50 bg-rec/10' : 'border-border text-ink3 hover:border-ink3'}`}>
                <Icon name="trash" size={14} color={deleteStep === 1 ? 'var(--color-rec)' : undefined} />
              </button>
            </div>
            {saveErrs.length > 0 && (
              <div className="flex-none px-4 py-2 border-b border-rec/30 bg-rec/5 text-[12px] text-rec">
                {saveErrs.map((m, i) => <div key={i}>{m}</div>)}
              </div>
            )}
            {editing ? (
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex-none px-4 py-1.5 text-[10.5px] text-ink3 border-b border-border bg-border-soft/40">
                  {draftFormat === 'deck-markdown'
                    ? 'Editing the deck’s markdown source — saving re-renders the slides.'
                    : 'Editing the entry file (usually HTML) — saved as-is.'}
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  aria-label="Artifact content"
                  className="flex-1 w-full px-4 py-3 bg-bg outline-none resize-none font-mono text-[12px] text-ink leading-relaxed"
                />
              </div>
            ) : viewUrl ? (
              <iframe
                key={`${viewUrl}#${gen}`}
                src={gen ? `${viewUrl}?v=${gen}` : viewUrl}
                title={selected.title}
                sandbox="allow-scripts"
                className="flex-1 w-full border-0 bg-white"
              />
            ) : (
              <div className="flex-1 grid place-items-center text-[12.5px] text-ink3">Loading…</div>
            )}
            {!editing && <AssetsPane key={selected.id} artifact={selected} />}
          </>
        )}
      </div>
    </div>
  );
}
