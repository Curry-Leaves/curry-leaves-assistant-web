import { useEffect, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { FolderPicker } from './FolderPicker';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Move / rename — one dialog for notes and folders. It previews the blast radius (how many
// other notes link in and will be rewritten) before you confirm, so nothing breaks silently.
// A note's target is a folder + filename; a folder's target is a parent folder + new name.
export function MoveDialog({ kind, path, dirs, title, onClose, onDone }: {
  kind: 'note' | 'folder';
  path: string;                 // bundle-relative note path or folder path
  dirs: string[];
  title?: string | null;        // display title for a note (fallback to filename)
  onClose: () => void;
  onDone: (newPath: string) => void;
}) {
  const isNote = kind === 'note';
  const curDir = isNote ? path.split('/').slice(0, -1).join('/') : path.split('/').slice(0, -1).join('/');
  const curName = isNote ? path.split('/').pop()!.replace(/\.md$/, '') : path.split('/').pop()!;

  const [dest, setDest] = useState(curDir);
  const [name, setName] = useState(curName);
  const [inbound, setInbound] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // How many notes link into the thing being moved → "N notes link here; links will update".
  useEffect(() => {
    if (!isNote) { setInbound(null); return; }
    api.getKnowledgeNoteLinks(path).then((r) => setInbound(r.inbound.length)).catch(() => setInbound(null));
  }, [isNote, path]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      let res;
      if (isNote) {
        res = await api.moveKnowledgeNote(path, dest, slug(name) || undefined);
      } else {
        res = await api.moveKnowledgeDir(path, dest, slug(name) || undefined);
      }
      onDone(res.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed.');
    } finally { setBusy(false); }
  };

  const targetPath = isNote
    ? `${dest ? dest + '/' : ''}${slug(name) || curName}.md`
    : `${dest ? dest + '/' : ''}${slug(name) || curName}`;
  const unchanged = targetPath === path;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div className="w-[480px] max-w-[92vw] rounded-[12px] border border-border bg-card shadow-pop overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Icon name={isNote ? 'file' : 'library'} size={15} />
          <span className="text-[14px] font-550 text-ink">Move / rename {isNote ? 'page' : 'folder'}</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} title="Close" className="p-1 rounded-[6px] text-ink3 hover:text-ink hover:bg-border-soft">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="px-4 py-3.5 flex flex-col gap-3">
          <div className="text-[12px] text-ink2">
            Moving <span className="font-mono text-[11px] text-ink">{isNote ? (title || curName) : curName + '/'}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-600 uppercase tracking-wider text-ink3">{isNote ? 'Destination folder' : 'Move inside'}</div>
            {/* a folder can't move into itself or its own descendants */}
            <FolderPicker dirs={dirs} value={dest} onChange={setDest} disabledPaths={isNote ? [] : [path]} />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-600 uppercase tracking-wider text-ink3">{isNote ? 'Filename' : 'Folder name'}</div>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="bg-bg border border-border rounded-[8px] px-3 py-2 text-[12.5px] text-ink outline-none" />
            <div className="text-[10.5px] text-ink3 font-mono">→ /{targetPath}</div>
          </div>

          {isNote && inbound !== null && inbound > 0 && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-ink2 bg-accent-soft/40 border border-accent-soft rounded-[8px] px-3 py-2">
              <Icon name="link" size={13} color="var(--color-accent)" />
              {inbound} note{inbound === 1 ? '' : 's'} link here — their links will be updated automatically.
            </div>
          )}
          {error && <div className="text-[11.5px] text-rec">{error}</div>}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-[8px] border border-border text-[12.5px] text-ink2 hover:bg-border-soft">Cancel</button>
          <button type="button" onClick={submit} disabled={busy || unchanged}
            title={unchanged ? 'Pick a different destination or name' : undefined}
            className="px-3.5 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 disabled:opacity-50">
            {busy ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Confirm archiving a whole folder — lists what goes to _archive/ (restorable) and warns
// that external backlinks into it will go dangling (they surface in Health, fixable).
export function ArchiveFolderDialog({ path, onClose, onDone }: {
  path: string; onClose: () => void; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await api.archiveKnowledgeDir(path);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div className="w-[420px] max-w-[92vw] rounded-[12px] border border-border bg-card shadow-pop overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Icon name="trash" size={14} color="var(--color-rec)" />
          <span className="text-[14px] font-550 text-ink">Archive folder</span>
        </div>
        <div className="px-4 py-4 flex flex-col gap-2.5">
          <div className="text-[12.5px] text-ink2">
            Archive <span className="font-mono text-[11.5px] text-ink">{path}/</span> and everything in it?
          </div>
          <div className="text-[11.5px] text-ink3">
            The whole folder moves to the archive — nothing is deleted and it stays restorable, with full history kept.
            Any notes elsewhere that linked into it will show as broken links in Health so you can re-point them.
          </div>
          {error && <div className="text-[11.5px] text-rec">{error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-[8px] border border-border text-[12.5px] text-ink2 hover:bg-border-soft">Cancel</button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-3.5 py-1.5 rounded-[8px] bg-rec text-white text-[12.5px] font-550 disabled:opacity-50">
            {busy ? 'Archiving…' : 'Archive folder'}
          </button>
        </div>
      </div>
    </div>
  );
}
