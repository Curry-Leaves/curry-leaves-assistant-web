import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { Markdown } from '../../components/Markdown';
import { MiniGraph } from './MiniGraph';
import { RichNoteEditor } from './editor/RichNoteEditor';
import { RelatedNotes } from './RelatedNotes';
import { api } from '../../api/client';
import type { KnowledgeNoteDetail, KnowledgeGraph, KnowledgeHistoryEntry, KnowledgeProvenanceEntry } from '../../types';
import { splitFrontmatter, parseTags } from './treeUtils';

// Frontmatter ⇄ form, per-entry. Flat `key: value` lines, block lists
// (`tags:` + `- ai` items → shown/saved as inline `[ai, …]`, which the tag
// parsers accept) and wrapped scalar values (indented continuations fold into
// one line, matching YAML's own folding) become key/value form fields. A nested
// structure (e.g. the `source:` provenance map the Keeper writes) becomes a
// single `raw` entry — edited verbatim in its own YAML box — so one complex key
// doesn't force the whole frontmatter out of the form.
type FmEntry =
  | { kind: 'field'; key: string; value: string }
  | { kind: 'raw'; text: string };
function parseFm(fm: string): FmEntry[] {
  const entries: FmEntry[] = [];
  const lines = fm.split('\n');
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s?(.*)$/);
    if (!kv) { entries.push({ kind: 'raw', text: line }); i++; continue; }  // comment/stray line
    // collect this key's block: indented lines and top-level `- ` list items
    const cont: string[] = [];
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || /^\s/.test(lines[j]) || /^-\s/.test(lines[j]))) {
      cont.push(lines[j]); j++;
    }
    while (cont.length && !cont[cont.length - 1].trim()) cont.pop();  // trailing blanks
    const value = kv[2].trim();
    const items = cont.map((l) => l.match(/^\s*-\s*(.+)$/)).filter(Boolean) as RegExpMatchArray[];
    if (cont.length === 0) {
      entries.push({ kind: 'field', key: kv[1], value });
    } else if (!value && items.length === cont.length && items.every((m) => !/:\s/.test(m[1]))) {
      // block list of scalars → inline list
      const vals = items.map((m) => m[1].trim().replace(/^["']|["']$/g, ''));
      entries.push({ kind: 'field', key: kv[1], value: `[${vals.join(', ')}]` });
    } else if (items.length === 0 && cont.every((l) => !/^\s*[A-Za-z0-9_-]+:(\s|$)/.test(l))) {
      // wrapped scalar → fold to one line
      entries.push({ kind: 'field', key: kv[1], value: [value, ...cont.map((l) => l.trim())].join(' ').trim() });
    } else {
      entries.push({ kind: 'raw', text: [line, ...cont].join('\n') });      // nested — keep verbatim
    }
    i = j;
  }
  return entries;
}
const buildFm = (entries: FmEntry[]) =>
  entries
    .map((e) => (e.kind === 'raw' ? e.text.replace(/\n+$/, '') : e.key.trim() ? `${e.key.trim()}: ${e.value.trim()}`.trimEnd() : ''))
    .filter(Boolean)
    .join('\n');
const joinNote = (fm: string, body: string) => {
  const f = fm.trim();
  return f ? `---\n${f}\n---\n\n${body}` : body;
};

const fmtClock = (s: number | null) => {
  if (s == null) return '';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};

// Shared header for the details-rail sections (Graph / Links to / Linked from /
// Sources): small-caps label + count, content below — every section reads the same.
// `collapsible` turns the header into a disclosure toggle (used by Sources, whose
// quote cards are long enough to crowd the rail).
function RailSection({ label, count, collapsible = false, defaultOpen = true, children }: {
  label: string; count?: number; collapsible?: boolean; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const header = (
    <>
      <span className="text-[10px] font-600 uppercase tracking-wider text-ink3">{label}</span>
      {count != null && <span className="text-[10px] tabular-nums text-faint">{count}</span>}
    </>
  );
  return (
    <section>
      {collapsible ? (
        <button type="button" onClick={() => setOpen((o) => !o)} title={open ? `Collapse ${label}` : `Expand ${label}`}
          className={`w-full flex items-baseline gap-1.5 text-left group ${open ? 'mb-2' : ''}`}>
          {header}
          <span className="flex-1" />
          <span className="self-center text-ink3 group-hover:text-ink">
            <Icon name={open ? 'chevD' : 'chevR'} size={11} />
          </span>
        </button>
      ) : (
        <div className="flex items-baseline gap-1.5 mb-2">{header}</div>
      )}
      {(!collapsible || open) && children}
    </section>
  );
}

// Provenance: where a note's facts came from (transcript spans). Read-only trace.
function ProvenanceSection({ entries }: { entries: KnowledgeProvenanceEntry[] }) {
  return (
    <RailSection label="Sources" count={entries.length} collapsible defaultOpen={false}>
      <div className="flex flex-col gap-2">
        {entries.map((e, i) => (
          <div key={i} className="rounded-[8px] border border-border bg-card px-3 py-2">
            <div className="flex items-center gap-2 text-[10.5px] text-ink3 mb-1 flex-wrap">
              <span className="font-mono">{e.meeting_id}</span>
              {e.section && <span className="px-1.5 py-0.5 rounded border border-border bg-border-soft/50">{e.section}</span>}
              {e.span?.speaker && <span>· {e.span.speaker}</span>}
              {e.span && (e.span.t0 != null) && <span>· {fmtClock(e.span.t0)}–{fmtClock(e.span.t1)}</span>}
              {e.turn_range && <span className="font-mono">· turns {e.turn_range[0]}–{e.turn_range[1]}</span>}
            </div>
            {e.span?.text && <div className="text-[12px] text-ink2 italic leading-snug">“{e.span.text}”</div>}
          </div>
        ))}
      </div>
    </RailSection>
  );
}

// "Jun 25, 2:30 PM" — compact absolute timestamp for history rows.
const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' +
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
const ACTION_TINT: Record<string, string> = {
  created: 'border-green-600/40 text-green-700 bg-green-600/10',
  updated: 'border-accent-soft text-accent-dark bg-accent-soft/30',
  edited: 'border-accent-soft text-accent-dark bg-accent-soft/30',
  appended: 'border-blue-500/40 text-blue-600 bg-blue-500/10',
};

// ── note viewer / editor ────────────────────────────────────────────────────────
// Default is a rendered markdown VIEW with the YAML frontmatter hidden; the raw
// editor (frontmatter included, so metadata stays editable) is one click away.
// "Linked from" / "Links to" — clickable backlinks + outbound links on a note page.
// Full-width rows (not wrapped pills) so long titles truncate cleanly in the rail.
function LinkSection({ label, items, onNavigate }: {
  label: string; items: { path: string; title: string }[]; onNavigate: (path: string) => void;
}) {
  return (
    <RailSection label={label} count={items.length}>
      {items.length === 0 ? (
        <div className="text-[11.5px] text-faint">None yet.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {items.map((it) => (
            <button key={it.path} type="button" onClick={() => onNavigate(it.path)} title={it.path}
              className="w-full text-left truncate text-[12px] px-2.5 py-1.5 rounded-[7px] border border-border bg-card text-ink2 hover:text-ink hover:border-accent-soft hover:bg-accent-soft/20">
              {it.title}
            </button>
          ))}
        </div>
      )}
    </RailSection>
  );
}

export function NoteEditor({ path, graph, onChanged, onClosed, onNavigate }: {
  path: string; graph: KnowledgeGraph; onChanged: () => void; onClosed: () => void; onNavigate: (path: string) => void;
}) {
  const [note, setNote] = useState<KnowledgeNoteDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'view' | 'edit' | 'history'>('view');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const [propsOpen, setPropsOpen] = useState(true);
  // The AI conversation rail. Starts closed: it is a deliberate mode, and opening it by
  // default would narrow the writing surface for everyone who just wants to type.
  const [aiOpen, setAiOpen] = useState(false);
  const [history, setHistory] = useState<KnowledgeHistoryEntry[]>([]);
  const [links, setLinks] = useState<{ outbound: { path: string; title: string }[]; inbound: { path: string; title: string }[] }>({ outbound: [], inbound: [] });
  const [prov, setProv] = useState<KnowledgeProvenanceEntry[]>([]);
  const loadedText = useRef('');

  const loadHistory = useCallback(() => { api.getKnowledgeHistory(path).then(setHistory).catch(() => setHistory([])); }, [path]);

  useEffect(() => {
    setNote(null); setError(null); setMode('view');
    api.getKnowledgeNote(path).then((n) => { setNote(n); setDraft(n.text); loadedText.current = n.text; })
      .catch(() => setError('Could not load this note.'));
    loadHistory();
    api.getKnowledgeNoteLinks(path).then(setLinks).catch(() => setLinks({ outbound: [], inbound: [] }));
    api.getKnowledgeProvenance(path).then((p) => setProv(p.entries)).catch(() => setProv([]));
  }, [path, loadHistory]);

  const dirty = note != null && draft !== loadedText.current;
  const { fm, body } = useMemo(() => splitFrontmatter(draft), [draft]);
  const tags = useMemo(() => parseTags(fm), [fm]);
  const conflicted = useMemo(() => /^status:\s*conflicted/m.test(fm) || /\*\*Conflict:\*\*/.test(body), [fm, body]);

  // Edit-mode frontmatter form. Entries are local state seeded when edit mode
  // opens (not derived from draft, so a half-typed key/value row survives even
  // while it round-trips to nothing); every change is folded back into `draft`,
  // which stays the single source of truth for dirty/save.
  const [fmEntries, setFmEntries] = useState<FmEntry[]>([]);
  useEffect(() => {
    if (mode !== 'edit') return;
    setFmEntries(parseFm(splitFrontmatter(draft).fm));
    // Seed only when edit mode opens — draft changes must not reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, path]);

  const setEntry = (i: number, patch: Partial<FmEntry>) => {
    const next = fmEntries.map((e, j) => (j === i ? { ...e, ...patch } as FmEntry : e));
    setFmEntries(next); setDraft(joinNote(buildFm(next), body));
  };
  const addField = () => setFmEntries([...fmEntries, { kind: 'field', key: '', value: '' }]);
  const removeEntry = (i: number) => {
    const next = fmEntries.filter((_, j) => j !== i);
    setFmEntries(next); setDraft(joinNote(buildFm(next), body));
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      await api.saveKnowledgeNote(path, draft);
      loadedText.current = draft;
      onChanged(); loadHistory();
      setMode('view');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally { setSaving(false); }
  };

  const restore = async (text: string) => {
    if (!confirm('Restore this version? The current content is saved to history first.')) return;
    try {
      await api.saveKnowledgeNote(path, text);
      setDraft(text); loadedText.current = text;
      onChanged(); loadHistory(); setMode('view');
    } catch (e) { setError(e instanceof Error ? e.message : 'Restore failed.'); }
  };

  // Drop unsaved edits and return to the rendered view. Confirms only when there's
  // something to lose. Resets the draft to the last-saved text (and reseeds the
  // frontmatter form via the mode/path effect that runs when edit mode reopens).
  const discard = () => {
    if (dirty && !confirm('Discard unsaved changes to this note?')) return;
    setDraft(loadedText.current);
    setError(null);
    setMode('view');
  };

  const remove = async () => {
    if (!confirm(`Archive “${note?.title || path}”? It moves to _archive (not deleted).`)) return;
    await api.deleteKnowledgeNote(path).catch(() => {});
    onChanged(); onClosed();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty && !saving) save(); }
  };

  if (error && !note) return <div className="h-full grid place-items-center text-[12.5px] text-rec">{error}</div>;
  if (!note) return <div className="h-full grid place-items-center text-[12.5px] text-ink3">Loading…</div>;

  return (
    <div className="h-full flex flex-col min-h-0 relative">
      {/* header: title, path, type/tag chips, view·edit toggle, actions */}
      <div className="px-5 pt-3 pb-2.5 border-b border-border flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-serif text-[18px] leading-tight text-ink truncate">{note.title || note.path.split('/').pop()}</div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {note.type && <span className="text-[10px] px-1.5 py-0.5 rounded border border-accent-soft bg-accent-soft/30 text-accent-dark">{note.type}</span>}
            {conflicted && <span className="text-[10px] px-1.5 py-0.5 rounded border border-rec/40 bg-rec/10 text-rec">⚠️ conflict</span>}
            {links.outbound.length === 0 && links.inbound.length === 0 && (
              <span title="This note isn't linked to any other — connect it from the details panel or the editor's link picker."
                className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-700">unlinked</span>
            )}
            {tags.map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-border-soft/50 text-ink3">#{t}</span>)}
            <span className="text-[10px] text-ink3 font-mono truncate">{note.path}</span>
          </div>
        </div>

        <div className="flex-none flex items-center gap-1.5">
          <div className="flex gap-0.5 bg-sidebar border border-sidebar-border rounded-[6px] p-0.5">
            {(['view', 'edit', 'history'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`px-2.5 py-1 rounded-[4px] text-[11px] capitalize ${mode === m ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
                {m === 'history' ? `History${history.length ? ` ${history.length}` : ''}` : m}
              </button>
            ))}
          </div>
          {mode === 'edit' && (
            <button type="button" onClick={() => setAiOpen((o) => !o)}
              title={aiOpen ? 'Hide the AI conversation' : 'Ask AI to change this note'}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-[7px] border text-[12px] font-550 ${aiOpen
                ? 'border-accent-soft bg-accent-soft/30 text-accent-dark'
                : 'border-transparent text-ink3 hover:text-ink hover:bg-border-soft'}`}>
              <Icon name="sparkle" size={13} />AI
            </button>
          )}
          {mode === 'edit' && (
            <button type="button" onClick={() => setPropsOpen((o) => !o)} title={propsOpen ? 'Hide properties' : 'Show properties'}
              className={`p-1.5 rounded-[7px] border ${propsOpen
                ? 'border-accent-soft bg-accent-soft/30 text-accent-dark'
                : 'border-transparent text-ink3 hover:text-ink hover:bg-border-soft'}`}>
              <Icon name="library" size={14} />
            </button>
          )}
          {mode === 'edit' && (
            <button type="button" onClick={discard} disabled={saving}
              className="px-3 py-1.5 rounded-[8px] border border-border text-ink2 text-[12.5px] font-550 hover:bg-border-soft disabled:opacity-40">
              Discard
            </button>
          )}
          {mode === 'edit' && (
            <button type="button" onClick={save} disabled={!dirty || saving}
              className="px-3 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {mode === 'view' && (
            <button type="button" onClick={() => setRailOpen((o) => !o)} title={railOpen ? 'Hide details panel' : 'Show details panel'}
              className={`p-1.5 rounded-[7px] border ${railOpen
                ? 'border-accent-soft bg-accent-soft/30 text-accent-dark'
                : 'border-transparent text-ink3 hover:text-ink hover:bg-border-soft'}`}>
              <Icon name="library" size={14} />
            </button>
          )}
          <button type="button" onClick={remove} title="Archive note"
            className="p-1.5 rounded-[7px] border border-border text-ink3 hover:text-rec hover:border-rec/40 hover:bg-border-soft"><Icon name="trash" size={13} /></button>
        </div>
      </div>

      {error && <div className="px-5 py-1.5 text-[11.5px] text-rec border-b border-border bg-rec/5">{error}</div>}

      {mode === 'view' && (
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0 overflow-y-auto px-8 py-5">
            {/* No max-width: the body fills the pane. A fixed reading measure here
                (previously 720px) wrapped mid-pane and left the rest of a wide
                window empty, which reads as a rendering bug rather than typography. */}
            <div className="w-full">
              {conflicted && (
                <div className="mb-4 rounded-[9px] border border-rec/40 bg-rec/5 px-3.5 py-2.5 text-[12px] text-ink2">
                  <span className="font-600 text-rec">⚠️ Unresolved conflict.</span> This note holds
                  contradictory claims. Edit it to resolve — your edit becomes the ground truth and
                  clears the flag.
                </div>
              )}
              <Markdown text={body || '*(empty note)*'} onNavigate={onNavigate} variant="doc" />
            </div>
          </div>

          {/* details rail — local graph, links, backlinks, provenance. Collapsible
              from the header so full-width reading is one click away. */}
          {railOpen && (
            <aside className="w-[272px] flex-none border-l border-border overflow-y-auto px-4 py-4 flex flex-col gap-5">
              <RailSection label="Graph">
                <div className="h-[168px] rounded-[9px] border border-border bg-bg/40 overflow-hidden">
                  <MiniGraph data={graph} focus={path} onOpen={onNavigate} />
                </div>
              </RailSection>
              <LinkSection label="Links to" items={links.outbound} onNavigate={onNavigate} />
              <LinkSection label="Linked from" items={links.inbound} onNavigate={onNavigate} />
              <RailSection label="Related notes">
                <RelatedNotes path={note.path} title={note.title} tags={tags}
                  linkedPaths={new Set([...links.outbound, ...links.inbound].map((l) => l.path))}
                  onNavigate={onNavigate} />
              </RailSection>
              {prov.length > 0 && <ProvenanceSection entries={prov} />}
            </aside>
          )}
        </div>
      )}
      {mode === 'edit' && (
        // `data-cl-edit-area` marks the editor+rails row: the AI diff overlay measures it so
        // a review can span the Properties rail too, which is a sibling of the editor and
        // therefore outside the editor's own box.
        <div data-cl-edit-area="" className="flex-1 min-h-0 flex bg-card" onKeyDown={onKeyDown}>
          {/* main column — WYSIWYG body editor with AI editing. Frontmatter lives in
              the Properties rail on the right, not inline, so the writing surface is
              clean and reads like a document. `min-h-0` + `overflow-hidden` are load-
              bearing: without them this flex column grows past its height when the AI
              ReviewCard mounts as a sibling, so the card overlays the note instead of
              the editor shrinking to make room. */}
          <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
            <RichNoteEditor
              key={path}
              body={body}
              autoFocus
              aiPanelOpen={aiOpen}
              onAiPanelOpenChange={setAiOpen}
              onChange={(nextBody) => setDraft(joinNote(buildFm(fmEntries), nextBody))}
            />
          </div>

          {/* properties rail (raw YAML fallback for complex fm) — collapsible so the
              body can go full-width. Mirrors the view-mode details rail. */}
          {propsOpen && (
            <aside className="w-[288px] flex-none border-l border-border overflow-y-auto px-4 py-4 flex flex-col gap-2">
              <div className="flex items-center mb-1">
                <span className="text-[10px] font-600 uppercase tracking-wider text-ink3">Properties</span>
                <span className="flex-1" />
                <button type="button" onClick={addField}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] text-[11px] text-ink3 hover:text-ink hover:bg-border-soft">
                  <Icon name="plus" size={11} />Add field
                </button>
              </div>
              {fmEntries.length === 0 ? (
                <div className="text-[11.5px] text-faint">No properties yet — add one to set type, title, tags…</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {fmEntries.map((f, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      {f.kind === 'field' ? (
                        <div className="flex items-center gap-1.5">
                          <input value={f.key} onChange={(e) => setEntry(i, { key: e.target.value })} placeholder="key" spellCheck={false}
                            className="w-[96px] flex-none bg-bg border border-border rounded-[6px] px-2 py-1 font-mono text-[11px] text-ink2 outline-none focus:border-accent-soft placeholder:text-faint" />
                          <input value={f.value} onChange={(e) => setEntry(i, { value: e.target.value })} placeholder="value" spellCheck={false}
                            className="flex-1 min-w-0 bg-bg border border-border rounded-[6px] px-2 py-1 text-[12px] text-ink outline-none focus:border-accent-soft placeholder:text-faint" />
                          <button type="button" onClick={() => removeEntry(i)} title="Remove field"
                            className="flex-none p-1 rounded-[5px] text-faint hover:text-rec hover:bg-border-soft"><Icon name="x" size={11} /></button>
                        </div>
                      ) : (
                        // nested YAML block (e.g. `source:` provenance) — edited verbatim
                        <div className="flex items-start gap-1.5">
                          <textarea value={f.text} onChange={(e) => setEntry(i, { text: e.target.value })} spellCheck={false}
                            aria-label="Nested YAML block" title="Nested YAML — edited verbatim" rows={f.text.split('\n').length}
                            className="flex-1 min-w-0 resize-none bg-bg border border-border rounded-[6px] px-2 py-1 font-mono text-[11px] leading-relaxed text-ink2 outline-none focus:border-accent-soft" />
                          <button type="button" onClick={() => removeEntry(i)} title="Remove block"
                            className="flex-none p-1 rounded-[5px] text-faint hover:text-rec hover:bg-border-soft"><Icon name="x" size={11} /></button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </aside>
          )}
        </div>
      )}
      {mode === 'history' && <HistoryPanel entries={history} onRestore={restore} />}
    </div>
  );
}

// ── per-note edit history ─────────────────────────────────────────────────────
// Newest first; the top entry is the current version. Each row expands to the
// rendered snapshot and offers a one-click restore.
function HistoryPanel({ entries, onRestore }: {
  entries: KnowledgeHistoryEntry[]; onRestore: (text: string) => void;
}) {
  const [openTs, setOpenTs] = useState<string | null>(null);
  if (entries.length === 0) {
    return <div className="flex-1 grid place-items-center text-[12.5px] text-ink3">No edit history yet.</div>;
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
      <div className="max-w-[720px] flex flex-col gap-1.5">
        {entries.map((h, i) => {
          const open = openTs === h.ts;
          const src = h.source?.type;
          return (
            <div key={h.ts + i} className="border border-border rounded-[9px] bg-card overflow-hidden">
              <button type="button" onClick={() => setOpenTs(open ? null : h.ts)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-border-soft/40">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border capitalize ${ACTION_TINT[h.action] || 'border-sidebar-border text-sidebar-ink3 bg-sidebar'}`}>{h.action}</span>
                <span className="text-[12.5px] text-ink">{fmtTime(h.ts)}</span>
                {i === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded border border-sidebar-border text-sidebar-ink3 bg-sidebar">current</span>}
                {src && <span className="text-[10px] text-ink3">via {src}</span>}
                <span className="flex-1" />
                <span className="text-[10.5px] text-ink3 font-mono">{h.bytes} B</span>
                <span className="text-ink3 text-[11px]">{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div className="border-t border-border">
                  <div className="flex justify-end px-3 py-1.5 border-b border-sidebar-border bg-sidebar/40">
                    {i === 0
                      ? <span className="text-[10.5px] text-sidebar-ink3">This is the current version</span>
                      : <button type="button" onClick={() => onRestore(h.text)}
                          className="text-[11px] px-2.5 py-1 rounded-[6px] border border-sidebar-border text-sidebar-ink hover:bg-border-soft">Restore this version</button>}
                  </div>
                  <div className="px-5 py-4 max-h-[360px] overflow-y-auto">
                    <Markdown text={splitFrontmatter(h.text).body || '*(empty)*'} variant="doc" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
