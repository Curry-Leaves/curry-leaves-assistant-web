import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { GraphView } from './GraphView';
import { buildTree, type TreeNode } from './treeUtils';
import { TreeRow, type TreeActions } from './TreeView';
import { GroupTree, type TreeGroup } from './GroupTree';
import { NoteEditor } from './NoteEditor';
import { SkillDetail } from './SkillDetail';
import { NewSkillModal } from './SkillModals';
import { IngestModal } from './IngestModal';
import { ActivityContent } from './ActivityPanel';
import { HealthPanel } from './HealthPanel';
import { NewNoteModal, NewFolderModal } from './CreateModals';
import { MoveDialog, ArchiveFolderDialog } from './MoveDialog';
import { RowMenu } from './RowMenu';
import { MemoryWelcome } from './MemoryWelcome';
import { api } from '../../api/client';
import { useEvents } from '../../hooks/useEvents';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import type { LearnedSkill } from '../../api/skills';
import type { KnowledgeNote, KnowledgeGraph, KnowledgeConflict, SkillSummary } from '../../types';

// Which structural dialog is open, and on what. One piece of state so at most one shows.
type Dialog =
  | { kind: 'new-note'; folder?: string }
  | { kind: 'new-folder'; parent?: string }
  | { kind: 'move-note'; path: string; title?: string | null }
  | { kind: 'move-folder'; path: string }
  | { kind: 'archive-folder'; path: string };

// The single thing selected in the rail tree: a Knowledge note or a Skill (its files open in
// the right pane).
type Selection =
  | { kind: 'note'; path: string }
  | { kind: 'skill'; name: string };

const TAB_LABEL: Record<'notes' | 'graph' | 'health' | 'ingest', string> = {
  notes: 'Memory', graph: 'Graph', health: 'Health', ingest: 'Ingest',
};

// ── screen ───────────────────────────────────────────────────────────────────────
// The Memory screen. Tabs: Notes (the browsable rail — Knowledge notes + Skills), Graph, Health,
// Ingest. There is no separate facts pane: a fact/preference/event is an ordinary note filed
// under whatever it's about (people/you/facts/…, apps/cbm/events/…), so it's already in the rail
// beside its parent — a flat by-kind list would only show the same notes twice, stripped of the
// context that makes them readable. `focusNote` deep-links a note into the Notes tab (e.g. from a
// chat answer's cited source). The rail's right pane swaps between a note viewer and a skill viewer.
export function KnowledgeScreen({ focusNote, onFocusHandled }: {
  focusNote?: string | null; onFocusHandled?: () => void;
}) {
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [dirs, setDirs] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Selection | null>(null);
  // The rail: drag its right edge to resize, or collapse it to give a note the full width.
  // Both stick across reloads.
  const rail = useResizablePanel({ key: 'knowledge.rail', initial: 280, min: 200, max: 520 });
  // Which folders the user has expanded. Empty = all closed (the default on load).
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<'notes' | 'graph' | 'health' | 'ingest'>('notes');
  const [graphData, setGraphData] = useState<KnowledgeGraph>({ nodes: [], links: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [conflicts, setConflicts] = useState<KnowledgeConflict[]>([]);
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [activeCount, setActiveCount] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);

  // Skills — the other browsable section that shares this tree.
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [learned, setLearned] = useState<Record<string, LearnedSkill>>({});
  const [newSkillOpen, setNewSkillOpen] = useState(false);

  const load = useCallback(() => {
    api.listKnowledgeTree().then((r) => { setNotes(r.notes); setDirs(r.dirs ?? []); }).catch(() => {});
    api.getKnowledgeGraph().then(setGraphData).catch(() => {});
    api.getKnowledgeConflicts().then(setConflicts).catch(() => {});
    api.getKnowledgeIngestStatus().then((s) => setActiveCount(s.active.length)).catch(() => {});
  }, []);

  const loadSkills = useCallback(() => {
    api.listSkills().then(setSkills).catch(() => {});
    api.learnedSkills().then((ls) => setLearned(Object.fromEntries(ls.map((s) => [s.name, s])))).catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      api.listKnowledgeTree().then((r) => { setNotes(r.notes); setDirs(r.dirs ?? []); }).catch(() => {}),
      api.getKnowledgeGraph().then(setGraphData).catch(() => {}),
      Promise.resolve(loadSkills()),
    ]);
    setTimeout(() => setRefreshing(false), 350); // keep the spin visible briefly
  }, [loadSkills]);

  useEffect(() => { load(); loadSkills(); }, [load, loadSkills]);

  useEvents((raw) => {
    const t = (raw as { type?: string }).type || '';
    if (t.startsWith('knowledge.')) load();
    if (t.startsWith('agent.run.')) load();
  });

  // While the Keeper is working, poll so the activity count stays current even if an
  // event is missed (events are the primary signal; this is the safety net).
  useEffect(() => {
    if (activeCount === 0) return;
    const id = setInterval(() => {
      api.getKnowledgeIngestStatus().then((s) => setActiveCount(s.active.length)).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [activeCount]);

  const openNote = useCallback((p: string) => {
    setSelection({ kind: 'note', path: p });
    setTab('notes');
    // Folders default closed, so reveal the note by expanding every ancestor on its path —
    // otherwise a deep-link (a chat citation, a search hit) selects something still hidden.
    const segs = p.split('/').slice(0, -1);
    if (segs.length) {
      setOpen((o) => {
        const next = { ...o };
        segs.reduce((prefix, seg) => {
          const id = prefix ? `${prefix}/${seg}` : seg;
          next[id] = true;
          return id;
        }, '');
        return next;
      });
    }
  }, []);

  // A deep-link elsewhere may preselect a section. `focusNote` selects a specific note;
  // `mode` (skills/semantic) just makes sure that section is expanded and visible.
  useEffect(() => {
    if (!focusNote) return;
    setQuery(''); setOnlyConflicts(false);
    openNote(focusNote);
    onFocusHandled?.();
  }, [focusNote, openNote, onFocusHandled]);

  const conflictPaths = useMemo(() => new Set(conflicts.map((c) => c.path)), [conflicts]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = notes;
    if (onlyConflicts) out = out.filter((n) => conflictPaths.has(n.path));
    if (q) out = out.filter((n) => `${n.title || ''} ${n.path} ${(n.tags || []).join(' ')} ${n.type || ''}`.toLowerCase().includes(q));
    return out;
  }, [notes, query, onlyConflicts, conflictPaths]);

  const tree = useMemo(() => buildTree(filtered, dirs), [filtered, dirs]);

  // Filter the Skills section by the same rail search box.
  const q = query.trim().toLowerCase();
  const filteredSkills = useMemo(
    () => (q ? skills.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q)) : skills),
    [skills, q]);

  const skillGroups = useMemo<TreeGroup<{ leafId: string; label: string }>[]>(() => (
    [{ key: 'skills', label: 'Skills', items: filteredSkills.map((s) => ({ leafId: `skill:${s.name}`, label: s.name })) }]
  ), [filteredSkills]);

  const activeLeafId = selection?.kind === 'skill' ? `skill:${selection.name}` : null;

  const pickGroupLeaf = useCallback((leafId: string) => {
    const [kind, ...rest] = leafId.split(':');
    const id = rest.join(':');
    if (kind === 'skill') setSelection({ kind: 'skill', name: id });
  }, []);

  // The structural actions offered on each note tree row.
  const selectedNotePath = selection?.kind === 'note' ? selection.path : null;
  const treeActions = useMemo<TreeActions>(() => ({
    onNewNoteIn: (folderId) => setDialog({ kind: 'new-note', folder: folderId }),
    menuFor: (node: TreeNode) => node.kind === 'folder'
      ? [
          { label: 'New page here', icon: 'file', onClick: () => setDialog({ kind: 'new-note', folder: node.id }) },
          { label: 'New subfolder', icon: 'plus', onClick: () => setDialog({ kind: 'new-folder', parent: node.id }) },
          { label: 'Rename / move…', icon: 'edit', onClick: () => setDialog({ kind: 'move-folder', path: node.id }) },
          { label: 'Archive folder', icon: 'trash', danger: true, onClick: () => setDialog({ kind: 'archive-folder', path: node.id }) },
        ]
      : [
          { label: 'Rename / move…', icon: 'edit', onClick: () => setDialog({ kind: 'move-note', path: node.path!, title: node.name }) },
          { label: 'Archive', icon: 'trash', danger: true, onClick: () => {
              api.deleteKnowledgeNote(node.path!).then(() => {
                if (selectedNotePath === node.path) setSelection(null);
                load();
              }).catch(() => {});
            } },
        ],
  }), [selectedNotePath, load]);

  const deleteSkill = useCallback((name: string) => {
    api.deleteSkill(name).then(() => {
      if (selection?.kind === 'skill' && selection.name === name) setSelection(null);
      loadSkills();
    }).catch(() => {});
  }, [selection, loadSkills]);

  // Folders start CLOSED (TreeRow treats a missing key as closed), so the hub opens as a short,
  // scannable list; `open` records the ones the user has expanded.
  const forceOpen = query.trim() !== '' || onlyConflicts;
  // While filtering, every folder reads as open so matches are visible. A Proxy answers `true`
  // for any id, which is what "expand everything" means against a Record lookup.
  const ALL_OPEN = useMemo(() => new Proxy({}, { get: () => true }) as Record<string, boolean>, []);
  const expanded = forceOpen ? ALL_OPEN : open;
  const toggle = useCallback((id: string) => {
    if (forceOpen) return; // tree is force-expanded during search/conflict filter
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  }, [forceOpen]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* header: tabs left · title centre · controls right (matches other screens) */}
      <div className="px-3 pt-3 pb-2.5 border-b border-border flex items-center gap-3">
        <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[7px] p-0.5 w-fit flex-none">
          {(['notes', 'graph', 'health', 'ingest'] as const).map((id) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-[5px] text-[12.5px] ${
                tab === id ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
              <span className={`inline-flex ${id === 'ingest' && activeCount > 0 ? 'animate-spin' : ''}`}>
                <Icon name={id === 'notes' ? 'file' : id === 'graph' ? 'sparkle' : id === 'health' ? 'warning' : 'chart'} size={13} />
              </span>
              {TAB_LABEL[id]}
              {id === 'ingest' && activeCount > 0 && <span className="text-[10.5px] font-550 text-accent-dark">{activeCount}</span>}
            </button>
          ))}
        </div>
        <h1 className="font-serif italic text-[19px] leading-none text-ink flex-1 min-w-0 truncate text-center">Memory</h1>
        <div className="flex-none w-[360px] flex justify-end items-center gap-1.5">
          {tab === 'notes' && (
            <div className="flex-none flex items-center rounded-[7px] border border-border overflow-hidden">
              <button type="button" onClick={() => setDialog({ kind: 'new-note' })} title="Create a new page"
                className="flex items-center gap-1 pl-2.5 pr-2 py-1 text-[12px] font-550 text-ink2 hover:bg-border-soft">
                <Icon name="plus" size={13} />New
              </button>
              <span className="w-px self-stretch bg-border" />
              <div className="px-0.5">
                <RowMenu label="More: new folder / skill" alwaysVisible items={[
                  { label: 'New page', icon: 'file', onClick: () => setDialog({ kind: 'new-note' }) },
                  { label: 'New folder', icon: 'library', onClick: () => setDialog({ kind: 'new-folder' }) },
                  { label: 'New skill', icon: 'steps', onClick: () => setNewSkillOpen(true) },
                ]} />
              </div>
            </div>
          )}
          <button type="button" onClick={() => setIngestOpen(true)} title="Feed documents to the knowledge base"
            className="flex-none flex items-center gap-1 px-2.5 py-1 rounded-[7px] bg-accent text-on-accent text-[12px] font-550 hover:opacity-90">
            <Icon name="download" size={13} />Feed docs
          </button>
          {conflicts.length > 0 && (
            <button type="button" onClick={() => { setTab('notes'); setOnlyConflicts((v) => !v); }}
              title={`${conflicts.length} unresolved conflict${conflicts.length === 1 ? '' : 's'}`}
              className={`flex-none flex items-center gap-1 px-2 py-1 rounded-[7px] border text-[11.5px] ${
                onlyConflicts ? 'border-rec/50 bg-rec/15 text-rec' : 'border-rec/30 bg-rec/5 text-rec hover:bg-rec/10'}`}>
              ⚠️ {conflicts.length}
            </button>
          )}
          <button type="button" onClick={refresh} disabled={refreshing} title="Refresh"
            className="flex-none w-7 h-7 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3 disabled:opacity-60">
            <span className={`inline-flex ${refreshing ? 'animate-spin' : ''}`}><Icon name="refresh" size={13} /></span>
          </button>
          {tab === 'graph' && (
            <span className="text-[11px] text-ink3">{graphData.nodes.length} notes · {graphData.links.length} links</span>
          )}
        </div>
      </div>

      {/* body — one full-height panel per tab */}
      {tab === 'health' ? (
        <HealthPanel onOpen={openNote} />
      ) : tab === 'ingest' ? (
        <div className="flex-1 flex flex-col min-h-0">
          <ActivityContent />
        </div>
      ) : tab === 'graph' ? (
        <div className="flex-1 min-h-0 relative">
          {graphData.nodes.length === 0 ? (
            <div className="h-full grid place-items-center text-[12.5px] text-ink3">No notes to graph yet.</div>
          ) : <GraphView data={graphData} selected={selectedNotePath} onOpen={openNote} />}
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          {/* the rail: Knowledge notes, then Skills */}
          {/* `inert` when collapsed: width:0 + overflow-hidden only CLIPS the rail, it stays in
              the DOM — without this the search box and every tree row are still tab-focusable
              and screen-reader visible while invisible on screen. */}
          <div style={{ width: rail.width }} inert={rail.collapsed || undefined}
            className={`flex-none border-r border-border flex flex-col min-h-0 overflow-hidden ${
              rail.dragging ? '' : 'transition-[width] duration-150'}`}>
            <div className="flex-none px-2 pt-2 pb-1.5 border-b border-border-soft">
              <div className="flex items-center gap-1.5 bg-card border border-border rounded-[7px] px-2 py-1 focus-within:border-accent-soft">
                <Icon name="search" size={13} color="var(--color-ink3)" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter memory…"
                  className="flex-1 min-w-0 bg-transparent outline-none text-[12.5px] text-ink placeholder:text-ink3" />
                {query && (
                  <button type="button" onClick={() => setQuery('')} title="Clear filter"
                    className="flex-none text-ink3 hover:text-ink"><Icon name="x" size={11} /></button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {/* ── Knowledge notes ── */}
              <SectionLabel icon="brain" label="Knowledge" />
              {tree.children.length === 0 ? (
                <div className="text-center text-[12px] text-ink3 py-4 px-4">
                  {notes.length === 0 ? 'Nothing stored yet. Tell Curry Leaves to “remember” something in Ask AI.' : 'No notes match.'}
                </div>
              ) : tree.children.map((child) => (
                <TreeRow key={child.id} node={child} depth={0}
                  lastChain={[]}
                  activeId={selectedNotePath} expanded={expanded} toggle={toggle} onPick={(p) => setSelection({ kind: 'note', path: p })}
                  actions={treeActions} />
              ))}

              {/* ── Skills (procedural) ── */}
              <SectionLabel icon="steps" label="Skills" onAdd={() => setNewSkillOpen(true)} addTitle="New skill" />
              {filteredSkills.length === 0 ? (
                <div className="text-center text-[12px] text-ink3 py-3 px-4">{skills.length === 0 ? 'No skills yet.' : 'No skills match.'}</div>
              ) : (
                <GroupTree groups={skillGroups} activeId={activeLeafId} forceOpen={forceOpen}
                  idOf={(i) => i.leafId} labelOf={(i) => i.label}
                  onPick={(i) => pickGroupLeaf(i.leafId)}
                  onDelete={(i) => deleteSkill(i.leafId.slice('skill:'.length))} />
              )}

            </div>
          </div>

          {/* Drag to resize; the strip is 4px but hit-tests wider via the -mx padding trick.
              Collapsed, it becomes the only way back — so it shows a persistent chevron. */}
          <div className="relative flex-none group/handle">
            {!rail.collapsed && (
              <div {...rail.handleProps} role="separator" aria-orientation="vertical"
                title="Drag to resize"
                className="absolute inset-y-0 -left-1 w-2 z-10 cursor-col-resize hover:bg-accent/20 active:bg-accent/30" />
            )}
            <button type="button" onClick={rail.toggle}
              title={rail.collapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-label={rail.collapsed ? 'Show sidebar' : 'Hide sidebar'}
              className={`absolute top-2 z-20 w-5 h-6 grid place-items-center rounded-[5px] border border-border bg-card text-ink3 shadow-soft hover:text-ink ${
                rail.collapsed ? 'left-1' : '-left-2.5 opacity-0 group-hover/handle:opacity-100 focus-visible:opacity-100'}`}>
              {/* Icon takes no className — rotate via a wrapper rather than widening it. */}
              <span className={`grid place-items-center ${rail.collapsed ? '' : 'rotate-180'}`}>
                <Icon name="chevR" size={11} />
              </span>
            </button>
          </div>

          {/* right pane switches on the selected leaf's kind */}
          <div className="flex-1 min-w-0">
            {selection?.kind === 'note' ? (
              <NoteEditor key={selection.path} path={selection.path} graph={graphData} onChanged={load}
                onClosed={() => setSelection(null)}
                onNavigate={(p) => { if (notes.some((n) => n.path === p)) setSelection({ kind: 'note', path: p }); }} />
            ) : selection?.kind === 'skill' ? (
              <SkillDetail key={selection.name} skill={selection.name} learned={learned[selection.name]}
                onChanged={loadSkills}
                onLearnedChanged={() => api.learnedSkills().then((ls) => setLearned(Object.fromEntries(ls.map((s) => [s.name, s])))).catch(() => {})} />
            ) : (
              <MemoryWelcome
                onNewNote={() => setDialog({ kind: 'new-note' })}
                onIngest={() => setIngestOpen(true)} />
            )}
          </div>
        </div>
      )}

      {ingestOpen && <IngestModal onClose={() => setIngestOpen(false)} onQueued={() => { load(); setTab('ingest'); }} />}
      {newSkillOpen && <NewSkillModal onClose={() => setNewSkillOpen(false)} onCreated={(name) => { loadSkills(); setSelection({ kind: 'skill', name }); }} />}

      {dialog?.kind === 'new-note' && (
        <NewNoteModal dirs={dirs} initialFolder={dialog.folder ?? 'notes'}
          onClose={() => setDialog(null)}
          onCreated={(p) => { setDialog(null); load(); setTab('notes'); setQuery(''); setOnlyConflicts(false); setSelection({ kind: 'note', path: p }); }} />
      )}
      {dialog?.kind === 'new-folder' && (
        <NewFolderModal dirs={dirs} initialParent={dialog.parent ?? ''}
          onClose={() => setDialog(null)}
          onCreated={(p) => { setDialog(null); load(); setOpen((o) => ({ ...o, [p]: true })); }} />
      )}
      {dialog?.kind === 'move-note' && (
        <MoveDialog kind="note" path={dialog.path} title={dialog.title} dirs={dirs}
          onClose={() => setDialog(null)}
          onDone={(p) => { setDialog(null); load(); if (selectedNotePath === dialog.path) setSelection({ kind: 'note', path: p }); }} />
      )}
      {dialog?.kind === 'move-folder' && (
        <MoveDialog kind="folder" path={dialog.path} dirs={dirs}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); load(); }} />
      )}
      {dialog?.kind === 'archive-folder' && (
        <ArchiveFolderDialog path={dialog.path}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); if (selectedNotePath?.startsWith(dialog.path + '/')) setSelection(null); load(); }} />
      )}
    </div>
  );
}

// A section divider in the unified tree, with an optional inline "＋" add affordance.
function SectionLabel({ icon, label, onAdd, addTitle }: { icon: string; label: string; onAdd?: () => void; addTitle?: string }) {
  return (
    <div className="group flex items-center gap-1.5 px-2.5 pt-3 pb-1 first:pt-1">
      <Icon name={icon} size={12} color="var(--color-ink3)" />
      <span className="flex-1 text-[10px] font-600 uppercase tracking-wider text-ink3">{label}</span>
      {onAdd && (
        <button type="button" onClick={onAdd} title={addTitle}
          className="flex-none w-5 h-5 grid place-items-center rounded text-ink3 hover:text-ink hover:bg-border-soft opacity-0 group-hover:opacity-100">
          <Icon name="plus" size={11} />
        </button>
      )}
    </div>
  );
}
