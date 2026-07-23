import { useMemo, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';

// A compact folder tree the user picks a destination from. Built from the flat `dirs`
// list (plus the implicit root). Used by the New-note and Move dialogs. Selecting a row
// sets `value`; a small "＋ new folder" affordance lets a nested folder be typed inline so
// the user doesn't have to leave the flow to create one.
interface DirNode { path: string; name: string; children: DirNode[] }

function buildDirTree(dirs: string[]): DirNode {
  const root: DirNode = { path: '', name: 'Knowledge', children: [] };
  const at = new Map<string, DirNode>([['', root]]);
  for (const d of [...dirs].sort()) {
    let parent = root, prefix = '';
    for (const seg of d.split('/')) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
      let node = at.get(prefix);
      if (!node) { node = { path: prefix, name: seg, children: [] }; at.set(prefix, node); parent.children.push(node); }
      parent = node;
    }
  }
  return root;
}

function DirRow({ node, depth, value, onPick }: {
  node: DirNode; depth: number; value: string; onPick: (p: string) => void;
}) {
  const selected = value === node.path;
  return (
    <>
      <button type="button" onClick={() => onPick(node.path)}
        style={{ paddingLeft: 8 + depth * 16 }}
        className={`w-full flex items-center gap-1.5 pr-2 py-1.5 text-left text-[12px] rounded-[6px] ${
          selected ? 'bg-accent-soft text-accent-dark font-500' : 'text-ink2 hover:bg-border-soft'}`}>
        <Icon name={node.path === '' ? 'library' : 'chevR'} size={12}
          color={selected ? 'var(--color-accent)' : 'var(--color-ink3)'} />
        <span className="truncate">{node.name || 'Knowledge (root)'}</span>
      </button>
      {node.children.map((c) => <DirRow key={c.path} node={c} depth={depth + 1} value={value} onPick={onPick} />)}
    </>
  );
}

export function FolderPicker({ dirs, value, onChange, disabledPaths = [] }: {
  dirs: string[]; value: string; onChange: (p: string) => void; disabledPaths?: string[];
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const tree = useMemo(() => buildDirTree((dirs ?? []).filter((d) => !disabledPaths.some((x) => d === x || d.startsWith(x + '/')))), [dirs, disabledPaths]);

  const commitNew = () => {
    const n = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (!n) return;
    const full = value ? `${value}/${n}` : n;
    onChange(full);         // the create call happens on submit; the path is provisional here
    setAdding(false); setNewName('');
  };

  return (
    <div className="border border-border rounded-[9px] bg-bg/40 overflow-hidden">
      <div className="max-h-[190px] overflow-y-auto p-1">
        <DirRow node={tree} depth={0} value={value} onPick={onChange} />
      </div>
      <div className="border-t border-border-soft px-1.5 py-1">
        {adding ? (
          <div className="flex items-center gap-1.5">
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitNew(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
              placeholder={`New folder in ${value ? '/' + value : 'root'}…`}
              className="flex-1 min-w-0 bg-card border border-border rounded-[6px] px-2 py-1 text-[11.5px] text-ink outline-none placeholder:text-ink3" />
            <button type="button" onClick={commitNew} className="text-[11px] px-2 py-1 rounded-[6px] bg-accent text-on-accent">Add</button>
          </div>
        ) : (
          <button type="button" onClick={() => setAdding(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1 text-left text-[11.5px] text-ink3 hover:text-ink">
            <Icon name="plus" size={12} />New folder{value ? ` in /${value}` : ''}
          </button>
        )}
      </div>
    </div>
  );
}
