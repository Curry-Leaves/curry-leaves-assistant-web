import { useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { FolderPicker } from './FolderPicker';

// The `type` taxonomy from the bundle's CONVENTIONS.md — the single source of truth the filer
// and the knowledge-keeper skill both read. Grouped for the picker; the backend only requires
// a non-empty string, so "Custom…" still allows coining one when nothing here fits.
//
// This list was previously five entries behind a <datalist>, which silently made it useless:
// a datalist FILTERS its options by what's already in the input, and the field is seeded with
// 'note' — so the only option ever shown was the substring match, 'note' itself.
const TYPE_GROUPS: { label: string; types: string[] }[] = [
  { label: 'General', types: ['note', 'fact', 'concept', 'term', 'reference', 'preference'] },
  { label: 'People & work', types: ['person', 'meeting', 'decision'] },
  { label: 'Systems', types: ['app', 'component', 'integration', 'service', 'architecture'] },
  { label: 'Operations', types: ['runbook', 'incident', 'metric', 'convention'] },
  { label: 'Research', types: ['technique', 'paper'] },
];
const CUSTOM = '__custom__';

function Shell({ title, icon, onClose, children, footer }: {
  title: string; icon: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div className="w-[480px] max-w-[92vw] rounded-[12px] border border-border bg-card shadow-pop overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Icon name={icon} size={15} />
          <span className="text-[14px] font-550 text-ink">{title}</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} title="Close" className="p-1 rounded-[6px] text-ink3 hover:text-ink hover:bg-border-soft">
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="px-4 py-3.5 flex flex-col gap-3">{children}</div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">{footer}</div>
      </div>
    </div>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11px] font-600 uppercase tracking-wider text-ink3">{children}</div>
);

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// New page: title + folder + type + optional tags → creates <folder>/<slug>.md with valid
// frontmatter (type is required by the backend), then hands the path back so the caller can
// open it straight in edit mode.
export function NewNoteModal({ dirs, initialFolder = 'notes', onClose, onCreated }: {
  dirs: string[]; initialFolder?: string; onClose: () => void; onCreated: (path: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState(initialFolder);
  const [type, setType] = useState('note');
  // "Custom…" picked: `type` is then whatever the user types, not a taxonomy entry.
  const [custom, setCustom] = useState(false);
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const t = title.trim();
    if (!t) { setError('Give the page a title.'); return; }
    // Picking "Custom…" and leaving it blank would silently fall back to 'note' below —
    // say so instead of filing the page under a type the user didn't choose.
    if (custom && !type.trim()) { setError('Name the custom type, or pick one from the list.'); return; }
    setBusy(true); setError(null);
    try {
      const fname = slug(t) || 'note';
      const path = folder ? `${folder}/${fname}.md` : `${fname}.md`;
      const tagList = tags.split(',').map((x) => x.trim()).filter(Boolean);
      const fm = [
        '---', `type: ${type.trim() || 'note'}`, `title: ${t}`,
        ...(tagList.length ? [`tags: [${tagList.join(', ')}]`] : []),
        '---', '', `# ${t}`, '', '',
      ].join('\n');
      const saved = await api.saveKnowledgeNote(path, fm);
      onCreated(saved.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the page.');
    } finally { setBusy(false); }
  };

  return (
    <Shell title="New page" icon="file" onClose={onClose} footer={
      <>
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-[8px] border border-border text-[12.5px] text-ink2 hover:bg-border-soft">Cancel</button>
        <button type="button" onClick={create} disabled={busy}
          className="px-3.5 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create & edit'}
        </button>
      </>
    }>
      <div className="flex flex-col gap-1.5">
        <Label>Title</Label>
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          placeholder="e.g. Acme Corp — renewal terms"
          className="bg-bg border border-border rounded-[8px] px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3" />
        {title && <div className="text-[10.5px] text-ink3 font-mono">{folder ? folder + '/' : ''}{slug(title) || 'note'}.md</div>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Folder</Label>
        <FolderPicker dirs={dirs} value={folder} onChange={setFolder} />
      </div>
      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <Label>Type</Label>
          <select value={custom ? CUSTOM : type}
            onChange={(e) => {
              if (e.target.value === CUSTOM) { setCustom(true); setType(''); }
              else { setCustom(false); setType(e.target.value); }
            }}
            className="bg-bg border border-border rounded-[8px] px-3 py-2 text-[12.5px] text-ink outline-none">
            {TYPE_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.types.map((t) => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
          {custom && (
            <input value={type} onChange={(e) => setType(e.target.value)} autoFocus
              placeholder="type name" aria-label="Custom type"
              className="bg-bg border border-border rounded-[8px] px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3" />
          )}
        </div>
        <div className="flex-1 flex flex-col gap-1.5">
          <Label>Tags <span className="normal-case font-400 text-ink3">(comma-sep)</span></Label>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="customer, renewal"
            className="bg-bg border border-border rounded-[8px] px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3" />
        </div>
      </div>
      {error && <div className="text-[11.5px] text-rec">{error}</div>}
    </Shell>
  );
}

// New folder: name + parent → creates an empty folder that appears immediately in the tree.
export function NewFolderModal({ dirs, initialParent = '', onClose, onCreated }: {
  dirs: string[]; initialParent?: string; onClose: () => void; onCreated: (path: string) => void;
}) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState(initialParent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const n = slug(name);
    if (!n) { setError('Enter a folder name (letters, numbers, dashes).'); return; }
    setBusy(true); setError(null);
    try {
      const path = parent ? `${parent}/${n}` : n;
      const r = await api.createKnowledgeDir(path);
      onCreated(r.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the folder.');
    } finally { setBusy(false); }
  };

  return (
    <Shell title="New folder" icon="library" onClose={onClose} footer={
      <>
        <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-[8px] border border-border text-[12.5px] text-ink2 hover:bg-border-soft">Cancel</button>
        <button type="button" onClick={create} disabled={busy}
          className="px-3.5 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create folder'}
        </button>
      </>
    }>
      <div className="flex flex-col gap-1.5">
        <Label>Name</Label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          placeholder="e.g. customers"
          className="bg-bg border border-border rounded-[8px] px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3" />
        {name && <div className="text-[10.5px] text-ink3 font-mono">{parent ? parent + '/' : ''}{slug(name)}/</div>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Inside</Label>
        <FolderPicker dirs={dirs} value={parent} onChange={setParent} />
      </div>
      {error && <div className="text-[11.5px] text-rec">{error}</div>}
    </Shell>
  );
}
