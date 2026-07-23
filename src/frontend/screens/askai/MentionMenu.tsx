import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { FileEntry } from '../../api/files';
import { Icon } from '../../components/chrome/Icon';
import type { ChatReference, SearchResult } from '../../types';

const errText = (e: unknown) =>
  (e instanceof Error && e.message) || 'Could not open that folder.';

const fmtSize = (n: number) =>
  n < 1000 ? `${n} B` : n < 1_000_000 ? `${Math.round(n / 1000)} kB` : `${(n / 1_000_000).toFixed(1)} MB`;

// ─── @-mention reference kinds ────────────────────────────────────────────────
// `silo` is the /search `types=` value; `kind` is what rides the wire to the backend
// (chat_runs.Reference.type). They differ for notes — the search silo is "knowledge",
// the reference type is "note".
// `silo` is the /search types= value; a null silo means this kind isn't search-backed at all
// (files are browsed, not searched — see the FileBrowser branch).
export const REF_KINDS = [
  { kind: 'recording', silo: 'recording', label: 'Recording', hint: 'meetings & voice notes', icon: 'mic' },
  { kind: 'note', silo: 'knowledge', label: 'Doc', hint: 'knowledge hub notes', icon: 'file' },
  { kind: 'todo', silo: 'todo', label: 'Todo', hint: 'your task list', icon: 'check' },
  { kind: 'reminder', silo: 'reminder', label: 'Reminder', hint: 'scheduled nudges', icon: 'bell' },
  { kind: 'file', silo: null, label: 'File', hint: 'browse your folders', icon: 'paperclip' },
] as const;

export type RefKind = (typeof REF_KINDS)[number]['kind'];
export type { ChatReference };
/** One selectable row: a kind to drill into, a directory to enter, or an item to reference.
 *  `enterDir: undefined` with `isUp` means "back to the roots". */
export type MentionRow = { pickKind?: RefKind; pick?: ChatReference; enterDir?: string; isUp?: boolean };

const SILO_TO_KIND: Record<string, RefKind> = {
  recording: 'recording', knowledge: 'note', todo: 'todo', reminder: 'reminder',
};

/** The @-menu: pick a kind, then pick one of that kind's items. Two levels, because a bare
 *  `@` can't usefully search everything at once — "recent recordings" and "notes matching
 *  'auth'" are different questions. `kind === null` shows the kind list. */
export function MentionMenu({ kind, query, idx, setIdx, onRows, onPickKind, onPick,
                              dirNonce, canBrowseFiles = true }: {
  kind: RefKind | null;
  query: string;
  idx: number;                      // selection lives in the parent: the textarea keeps focus
  setIdx: (n: number) => void;      // and drives arrows/Enter from its own onKeyDown
  onRows: (rows: MentionRow[]) => void;  // parent needs the rows to commit the active one
  onPickKind: (k: RefKind | null) => void;
  onPick: (r: ChatReference) => void;
  dirNonce?: { path?: string; n: number };  // parent asks for a directory change (keyboard nav)
  canBrowseFiles?: boolean;         // /capabilities.fileBrowse — hides @file on hosted deploys
}) {
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  // ─── file-browser state (kind === 'file' only) ───────────────────────────────
  const [dir, setDir] = useState<string | undefined>(undefined);   // undefined = the roots
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);

  const kinds = kind ? [] : REF_KINDS.filter(
    (k) => (!query || k.kind.startsWith(query.toLowerCase()) || k.label.toLowerCase().startsWith(query.toLowerCase()))
        && (k.kind !== 'file' || canBrowseFiles));

  // Files are browsed, not searched: load whatever directory we're standing in. Typing
  // filters the current listing client-side rather than issuing a query.
  useEffect(() => {
    if (kind !== 'file') return;
    const mine = ++seq.current;
    setLoading(true); setFileErr(null);
    (async () => {
      try {
        const res = await api.browseFiles(dir);
        if (mine !== seq.current) return;
        setEntries(res.entries); setParent(res.parent);
      } catch (e) {
        if (mine === seq.current) { setEntries([]); setParent(null); setFileErr(errText(e)); }
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    })();
  }, [kind, dir]);

  // Debounced lookup with a sequence guard — an earlier slow response must never overwrite a
  // later fast one, or the list shows results for a query the user has already typed past.
  useEffect(() => {
    if (!kind || kind === 'file') { setItems([]); return; }
    const silo = REF_KINDS.find((k) => k.kind === kind)!.silo!;
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.globalSearch(query, 12, silo);
        if (mine === seq.current) setItems(res);
      } catch {
        if (mine === seq.current) setItems([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, query ? 150 : 0);   // recents (empty query) shouldn't feel laggy
    return () => clearTimeout(t);
  }, [kind, query]);

  // Typing narrows the folder you're in — a local filter, since browse has no query param.
  const shownFiles = query
    ? entries.filter((e) => e.name.toLowerCase().includes(query.toLowerCase()))
    : entries;

  // Publish the current rows upward so the parent's Enter handler can commit the active one.
  // Kind rows and item rows are the same shape here, so the parent stays agnostic of level.
  useEffect(() => {
    if (kind === 'file') {
      // A directory row navigates instead of picking; the parent row walks back up.
      const up: MentionRow[] = parent !== null || dir ? [{ enterDir: parent ?? undefined, isUp: true }] : [];
      onRows([...up, ...shownFiles.map((e) => (e.isDir
        ? { enterDir: e.path }
        : { pick: { type: 'file' as const, id: e.path, title: e.name } }))]);
      return;
    }
    onRows(kind
      ? items.map((it) => ({ pick: { type: SILO_TO_KIND[it.type] ?? 'note', id: it.id, title: it.title } }))
      : kinds.map((k) => ({ pickKind: k.kind })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, items, query, entries, parent, dir]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  // The parent commits Enter on a directory row; the nonce lets it ask us to navigate there
  // (a plain prop wouldn't re-fire when entering the same path twice).
  useEffect(() => {
    if (dirNonce) setDir(dirNonce.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirNonce?.n]);

  // Leaving the file kind resets the browser to the roots, so reopening @file doesn't
  // silently resume in whatever folder was last visited.
  useEffect(() => { if (kind !== 'file') setDir(undefined); }, [kind]);

  return (
    <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[min(420px,calc(100vw-40px))] bg-card border border-border rounded-[12px] shadow-pop p-1 an-rise">
      <div className="px-2.5 pt-1 pb-1.5 text-[10px] font-600 uppercase tracking-wider text-ink3 flex items-center gap-1.5">
        {kind ? (
          <>
            <button type="button" title="Back to all kinds"
              onMouseDown={(e) => { e.preventDefault(); onPickKind(null); }}
              className="hover:text-ink2 text-[11px] leading-none">←</button>
            {REF_KINDS.find((k) => k.kind === kind)?.label}
            <span className="normal-case tracking-normal font-400 text-ink3 truncate">
              {kind === 'file'
                ? (dir ? `· ${dir.split('/').filter(Boolean).slice(-2).join('/')}` : '· pick a folder')
                : query ? `matching “${query}”` : '· recent'}
            </span>
          </>
        ) : 'Reference something'}
      </div>

      <div ref={listRef} className="max-h-[280px] overflow-y-auto">
        {!kind && kinds.map((k, i) => (
          <button key={k.kind} type="button" data-active={i === idx}
            onMouseDown={(e) => { e.preventDefault(); onPickKind(k.kind); }}
            className={`w-full text-left px-2 py-1.5 rounded-[8px] flex items-center gap-2.5 ${i === idx ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-border-soft'}`}>
            <span className={i === idx ? 'text-accent' : 'text-ink3'}><Icon name={k.icon} size={13} /></span>
            <span className="flex-1 min-w-0">
              <span className="text-[12.5px] font-550">{k.label}</span>
              <span className="text-[11px] text-ink3 ml-1.5">{k.hint}</span>
            </span>
          </button>
        ))}

        {/* ── files: browse, don't search ── */}
        {kind === 'file' && fileErr && (
          <div className="px-2.5 py-3 text-[12px] text-rec">{fileErr}</div>
        )}
        {kind === 'file' && loading && shownFiles.length === 0 && !fileErr && (
          <div className="px-2.5 py-3 text-[12px] text-ink3">Loading…</div>
        )}
        {kind === 'file' && !fileErr && (parent !== null || dir) && (
          <button type="button" data-active={idx === 0}
            onMouseDown={(e) => { e.preventDefault(); setDir(parent ?? undefined); }}
            className={`w-full text-left px-2 py-1.5 rounded-[8px] flex items-center gap-2.5 ${idx === 0 ? 'bg-accent-soft text-accent-ink' : 'text-ink2 hover:bg-border-soft'}`}>
            <span className="text-ink3 text-[11px] w-[13px] text-center">←</span>
            <span className="text-[12.5px]">{parent ? 'Up a folder' : 'All folders'}</span>
          </button>
        )}
        {kind === 'file' && !fileErr && !loading && shownFiles.length === 0 && (
          <div className="px-2.5 py-3 text-[12px] text-ink3">
            {query ? 'Nothing matches here.' : 'This folder is empty.'}
          </div>
        )}
        {kind === 'file' && !fileErr && shownFiles.map((e, i) => {
          const rowIdx = i + (parent !== null || dir ? 1 : 0);  // offset by the up-row
          return (
            <button key={e.path} type="button" data-active={rowIdx === idx}
              onMouseDown={(ev) => {
                ev.preventDefault();
                if (e.isDir) setDir(e.path);
                else onPick({ type: 'file', id: e.path, title: e.name });
              }}
              className={`w-full text-left px-2 py-1.5 rounded-[8px] flex items-center gap-2.5 ${rowIdx === idx ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-border-soft'}`}>
              <span className={rowIdx === idx ? 'text-accent' : 'text-ink3'}>
                <Icon name={e.isDir ? 'grid' : 'file'} size={13} />
              </span>
              <span className="flex-1 min-w-0 truncate text-[12.5px]">{e.name}</span>
              {e.isDir
                ? <span className="text-ink3 text-[11px]">›</span>
                : e.size != null && <span className="text-ink3 text-[11px]">{fmtSize(e.size)}</span>}
            </button>
          );
        })}

        {kind && kind !== 'file' && loading && items.length === 0 && (
          <div className="px-2.5 py-3 text-[12px] text-ink3">Searching…</div>
        )}
        {kind && kind !== 'file' && !loading && items.length === 0 && (
          <div className="px-2.5 py-3 text-[12px] text-ink3">
            {query ? 'Nothing matches.' : 'Nothing here yet.'}
          </div>
        )}
        {kind && kind !== 'file' && items.map((it, i) => (
          <button key={`${it.type}:${it.id}`} type="button" data-active={i === idx}
            onMouseDown={(e) => { e.preventDefault(); onPick({ type: SILO_TO_KIND[it.type] ?? 'note', id: it.id, title: it.title }); }}
            className={`w-full text-left px-2 py-1.5 rounded-[8px] flex items-start gap-2.5 ${i === idx ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-border-soft'}`}>
            <span className={`mt-0.5 ${i === idx ? 'text-accent' : 'text-ink3'}`}>
              <Icon name={REF_KINDS.find((k) => k.kind === SILO_TO_KIND[it.type])?.icon ?? 'file'} size={13} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-550 truncate">{it.title}</span>
              {(it.subtitle || it.snippet) && (
                <span className="block text-[11px] text-ink3 truncate">{it.snippet || it.subtitle}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
