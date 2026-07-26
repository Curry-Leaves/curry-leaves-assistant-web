import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { Markdown } from '../../components/Markdown';
import type { SkillTreeEntry } from '../../types';
import type { LearnedSkill } from '../../api/skills';
import { LearnedSkillBar } from './LearnedSkillBar';
import { PromptModal, ConfirmModal } from './SkillModals';
import { splitFrontmatter } from './treeUtils';

// A skill's prose (SKILL.md, references/*.md) is markdown and reads far better rendered —
// same treatment notes get in the Hub. Anything else in a skill (scripts/*.py, .json, .txt)
// has no rendered form, so it stays source-only and never offers the toggle.
const isMarkdown = (path: string) => /\.mdx?$/i.test(path);

// The right two panes of the old Skills manager (file tree + editor), lifted out so the
// unified Knowledge Hub can mount them when a skill node is picked in its tree. Owns only
// the selected skill's files/editor state; the parent owns which skill is selected and
// refreshes the skill list after structural edits.
export function SkillDetail({ skill, learned, onChanged, onLearnedChanged }: {
  skill: string;
  learned?: LearnedSkill;
  onChanged: () => void;               // a file/dir was added or removed
  onLearnedChanged: () => void;
}) {
  const [tree, setTree] = useState<SkillTreeEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [draft, setDraft] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addFileOpen, setAddFileOpen] = useState(false);
  const [addDirOpen, setAddDirOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ label: string; run: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const justCreated = useRef<string | null>(null);
  // Frontmatter is metadata, not prose — render only the body, as the Hub's note view does.
  const { fm, body } = useMemo(() => splitFrontmatter(draft), [draft]);

  // Kept in sync before the fetch starts, so an in-flight response can tell whether the
  // user has since moved to a different skill.
  const skillRef = useRef(skill);
  skillRef.current = skill;

  const loadTree = useCallback((name: string, selectEntry = false) => {
    api.getSkillTree(name).then((t) => {
      // Switching skills fast: a slow earlier response must not overwrite the newer skill's
      // tree or steal its selection.
      if (skillRef.current !== name) return;
      setTree(t);
      // Opening a skill lands on its entry file — SKILL.md IS the skill, so an empty
      // "select a file" pane is a wasted click. Only on skill switch (selectEntry), never
      // on the refreshes that follow an add/delete, which must keep the current selection.
      if (!selectEntry) return;
      const entry = t.find((f) => !f.isDir && f.path.toLowerCase() === 'skill.md');
      setSelectedFile(entry ? entry.path : null);
    }).catch(() => {
      if (skillRef.current !== name) return;
      setTree([]); if (selectEntry) setSelectedFile(null);
    });
  }, []);
  useEffect(() => { loadTree(skill, true); }, [skill, loadTree]);

  useEffect(() => {
    if (!selectedFile) { setContent(''); setDraft(''); setDirty(false); return; }
    // Markdown opens rendered; a script or data file has no rendered form, so it opens in edit.
    const fresh = justCreated.current === selectedFile;
    justCreated.current = null;
    setMode(isMarkdown(selectedFile) && !fresh ? 'view' : 'edit');
    api.getSkillFile(skill, selectedFile).then((c) => { setContent(c); setDraft(c); setDirty(false); }).catch(() => {});
  }, [skill, selectedFile]);

  const save = useCallback(async () => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await api.saveSkillFile(skill, selectedFile, draft);
      setContent(draft); setDirty(false);
    } catch (e) { setError(String(e)); } finally { setSaving(false); }
  }, [skill, selectedFile, draft]);

  const addFile = useCallback(async (name: string) => {
    try {
      await api.saveSkillFile(skill, name, '');
      loadTree(skill);
      // A file created empty is one you're about to write — open it in edit, not on a
      // blank rendered pane. The flag is read by the select effect, which runs after this.
      justCreated.current = name;
      setSelectedFile(name);
    } catch (e) { setError(String(e)); }
  }, [skill, loadTree]);

  const addDir = useCallback(async (name: string) => {
    try {
      await api.makeSkillDir(skill, name);
      loadTree(skill);
    } catch (e) { setError(String(e)); }
  }, [skill, loadTree]);

  const deleteEntry = useCallback((path: string, isDir: boolean) => {
    setConfirmDelete({
      label: `Delete ${isDir ? 'folder' : 'file'} "${path}"?${isDir ? ' Everything inside it is removed too.' : ''}`,
      run: async () => {
        try {
          await api.deleteSkillPath(skill, path);
          if (selectedFile === path || (isDir && selectedFile?.startsWith(`${path}/`))) setSelectedFile(null);
          loadTree(skill);
          onChanged();
        } catch (e) { setError(String(e)); }
      },
    });
  }, [skill, selectedFile, loadTree, onChanged]);

  return (
    <div className="h-full flex min-h-0">
      {/* file tree */}
      <div className="w-[240px] flex-none border-r border-border overflow-y-auto py-2 flex flex-col">
        <div className="px-3 pb-1.5 flex items-center gap-1">
          <span className="flex-1 text-[10px] font-600 uppercase tracking-wider text-ink3 truncate" title={skill}>{skill}</span>
          <button type="button" onClick={() => setAddFileOpen(true)} title="Add file" className="w-5 h-5 grid place-items-center rounded text-ink3 hover:text-ink hover:bg-border-soft">
            <Icon name="plus" size={11} />
          </button>
          <button type="button" onClick={() => setAddDirOpen(true)} title="Add folder" className="w-5 h-5 grid place-items-center rounded text-ink3 hover:text-ink hover:bg-border-soft">
            <Icon name="grid" size={11} />
          </button>
        </div>
        {tree.length === 0 ? (
          <div className="text-center text-[11.5px] text-ink3 py-8 px-3">Empty.</div>
        ) : tree.map((f) => {
          const depth = Math.min(f.path.split('/').length - 1, 4);
          const indent = ['pl-3', 'pl-6', 'pl-9', 'pl-12', 'pl-[60px]'][depth];
          return (
          <div key={f.path}
            className={`group flex items-center gap-1 pr-3 ${indent} ${selectedFile === f.path ? 'bg-accent/5' : 'hover:bg-border-soft'}`}>
            <button type="button" disabled={f.isDir} onClick={() => setSelectedFile(f.path)}
              className={`flex-1 min-w-0 text-left py-1.5 flex items-center gap-1.5 text-[12px] ${
                selectedFile === f.path ? 'text-ink font-550' : f.isDir ? 'text-ink3' : 'text-ink2'}`}>
              <Icon name={f.isDir ? 'grid' : 'file'} size={11} />
              <span className="truncate">{f.path.split('/').pop()}</span>
            </button>
            <button type="button" onClick={() => deleteEntry(f.path, f.isDir)} title="Delete"
              className="flex-none opacity-0 group-hover:opacity-100 w-5 h-5 grid place-items-center rounded text-ink3 hover:text-rec hover:bg-rec/10">
              <Icon name="trash" size={10} />
            </button>
          </div>
          );
        })}
      </div>

      {/* editor */}
      <div className="flex-1 min-w-0 flex flex-col">
        {error && (
          <div className="px-3 py-1.5 bg-rec/10 border-b border-rec/30 text-[11.5px] text-rec flex items-center gap-2 flex-none">
            {error}
            <button type="button" onClick={() => setError(null)} title="Dismiss" className="ml-auto text-rec/70 hover:text-rec"><Icon name="x" size={12} /></button>
          </div>
        )}
        {learned && <LearnedSkillBar meta={learned} onChanged={onLearnedChanged} />}
        {selectedFile ? (
          <>
            <div className="px-4 py-2 border-b border-border flex items-center gap-2 flex-none">
              <span className="text-[12px] font-mono text-ink2 truncate">{selectedFile}</span>
              {dirty && <span className="text-[10px] text-accent-dark">unsaved</span>}
              <span className="flex-1" />
              {isMarkdown(selectedFile) && (
                <div className="flex-none flex gap-0.5 bg-sidebar border border-sidebar-border rounded-[6px] p-0.5">
                  {(['view', 'edit'] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setMode(m)}
                      className={`px-2.5 py-1 rounded-[4px] text-[11px] capitalize ${mode === m ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" onClick={save} disabled={!dirty || saving}
                className="flex-none px-2.5 py-1 rounded-[7px] bg-accent text-on-accent text-[11.5px] font-550 hover:opacity-90 disabled:opacity-40">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            {mode === 'view' ? (
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
                {fm && (
                  <pre className="mb-4 px-3 py-2 rounded-[7px] bg-sidebar border border-sidebar-border text-[11.5px] font-mono text-ink3 whitespace-pre-wrap">{fm}</pre>
                )}
                <Markdown text={body || '*(empty file)*'} variant="source" />
              </div>
            ) : (
              <textarea value={draft} onChange={(e) => { setDraft(e.target.value); setDirty(e.target.value !== content); }}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } }}
                spellCheck={false} autoFocus aria-label={`Edit ${selectedFile}`}
                className="flex-1 min-h-0 w-full resize-none bg-bg text-ink font-mono text-[12.5px] leading-relaxed px-5 py-4 outline-none" />
            )}
          </>
        ) : (
          <div className="h-full grid place-items-center text-[12.5px] text-ink3">Select a file to view or edit.</div>
        )}
      </div>

      {addFileOpen && (
        <PromptModal title="New file" label="File path (relative to the skill)" placeholder="references/notes.md"
          onClose={() => setAddFileOpen(false)} onSubmit={(v) => addFile(v)} />
      )}
      {addDirOpen && (
        <PromptModal title="New folder" label="Folder path (relative to the skill)" placeholder="scripts"
          onClose={() => setAddDirOpen(false)} onSubmit={(v) => addDir(v)} />
      )}
      {confirmDelete && (
        <ConfirmModal title="Delete" message={confirmDelete.label}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { confirmDelete.run(); setConfirmDelete(null); }} />
      )}
    </div>
  );
}
