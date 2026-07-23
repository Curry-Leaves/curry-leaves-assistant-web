import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './chrome/Icon';
import { api } from '../api/client';
import type { SearchResult, SearchResultType } from '../types';

// A static action the palette can run (navigate somewhere, start a recording, etc.).
export type Command = {
  id: string;
  label: string;
  hint?: string;          // right-aligned context ("Go to page", assistant role…)
  keywords?: string;      // extra match text not shown
  icon: string;           // Icon name
  run: () => void;
};

// How each search-result type is opened + how it looks in the list.
export type ResultHandlers = Record<SearchResultType, (r: SearchResult) => void>;

const TYPE_ICON: Record<SearchResultType, string> = {
  knowledge: 'file', recording: 'mic', todo: 'check', reminder: 'bell', artifact: 'artifact', agent: 'bot',
};
const TYPE_LABEL: Record<SearchResultType, string> = {
  knowledge: 'Knowledge', recording: 'Recordings', todo: 'Todos', reminder: 'Reminders', artifact: 'Artifacts', agent: 'Assistants',
};
// Group display order.
const GROUP_ORDER: SearchResultType[] = ['knowledge', 'recording', 'todo', 'reminder', 'artifact', 'agent'];

// A flat, keyboard-navigable row is either a command or a search result.
type Row =
  | { kind: 'command'; cmd: Command }
  | { kind: 'result'; res: SearchResult };

/** The ⌘K global search + command palette. Owns its own open/close (⌘K toggles, Esc
 *  closes) and search fetching; the host supplies the command list and per-type open
 *  handlers. Mount once, near the app root. */
export function CommandPalette({ commands, onOpenResult }: {
  commands: Command[];
  onOpenResult: ResultHandlers;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reqSeq = useRef(0);

  // ⌘K / Ctrl-K toggles from anywhere; Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Reset + focus on open.
  useEffect(() => {
    if (open) {
      setQ(''); setResults([]); setActive(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced search. Command-mode (query starts with '>') skips the network call.
  useEffect(() => {
    const query = q.trim();
    const commandMode = query.startsWith('>');
    if (commandMode || query.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const seq = ++reqSeq.current;
    const t = setTimeout(() => {
      api.globalSearch(query).then((rs) => {
        if (seq === reqSeq.current) { setResults(rs); setLoading(false); }
      }).catch(() => { if (seq === reqSeq.current) { setResults([]); setLoading(false); } });
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  // Filter commands by the query (or the text after '>').
  const matchedCommands = useMemo(() => {
    const raw = q.trim();
    const term = (raw.startsWith('>') ? raw.slice(1) : raw).trim().toLowerCase();
    if (!term) return raw.startsWith('>') ? commands : commands.slice(0, 6); // '>' alone → all; empty → top few
    return commands.filter((c) => (c.label + ' ' + (c.keywords ?? '') + ' ' + (c.hint ?? '')).toLowerCase().includes(term));
  }, [q, commands]);

  const commandMode = q.trim().startsWith('>');

  // The flat ordered row list for keyboard nav: commands first, then grouped results.
  const rows: Row[] = useMemo(() => {
    const cmdRows: Row[] = matchedCommands.map((cmd) => ({ kind: 'command' as const, cmd }));
    if (commandMode) return cmdRows;
    const byType = new Map<SearchResultType, SearchResult[]>();
    for (const r of results) { const l = byType.get(r.type) ?? []; l.push(r); byType.set(r.type, l); }
    const resRows: Row[] = [];
    for (const t of GROUP_ORDER) for (const r of byType.get(t) ?? []) resRows.push({ kind: 'result', res: r });
    return [...cmdRows, ...resRows];
  }, [matchedCommands, results, commandMode]);

  // Clamp active index whenever the row set changes.
  useEffect(() => { setActive((a) => Math.min(a, Math.max(0, rows.length - 1))); }, [rows.length]);

  const runRow = useCallback((row: Row) => {
    setOpen(false);
    if (row.kind === 'command') row.cmd.run();
    else onOpenResult[row.res.type]?.(row.res);
  }, [onOpenResult]);

  // Keyboard nav within the list.
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; if (r) runRow(r); }
  };

  // Keep the active row scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  // Precompute where each group's header should appear (index of the first result of a
  // new type, offset by the command rows).
  const firstOfType = new Map<SearchResultType, number>();
  rows.forEach((row, i) => {
    if (row.kind === 'result' && !firstOfType.has(row.res.type)) firstOfType.set(row.res.type, i);
  });
  const cmdCount = rows.filter((r) => r.kind === 'command').length;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-black/30 backdrop-blur-[1px]"
      onMouseDown={() => setOpen(false)}>
      <div className="w-full max-w-[620px] rounded-[14px] border border-border bg-card shadow-pop overflow-hidden flex flex-col max-h-[70vh]"
        onMouseDown={(e) => e.stopPropagation()}>
        {/* input */}
        <div className="flex items-center gap-2.5 px-4 h-[52px] border-b border-border-soft flex-none">
          <Icon name="search" size={17} color="var(--color-ink3)" />
          <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onInputKey}
            placeholder="Search notes, recordings, tasks…  or type > for commands"
            className="flex-1 bg-transparent outline-none text-[15px] text-ink placeholder:text-ink3" />
          {loading && <span className="text-ink3"><Icon name="refresh" size={14} /></span>}
          <kbd className="text-[10px] font-mono text-ink3 border border-border rounded px-1.5 py-0.5">esc</kbd>
        </div>

        {/* results / commands */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-[13px] text-ink3">
              {q.trim().length < 2 && !commandMode ? 'Type to search, or > for commands.'
                : loading ? 'Searching…'
                  : 'No matches.'}
            </div>
          )}

          {cmdCount > 0 && (
            <div className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-wider text-ink3 font-600">
              {commandMode ? 'Commands' : 'Actions'}
            </div>
          )}

          {rows.map((row, i) => {
            const header = row.kind === 'result' && firstOfType.get(row.res.type) === i
              ? <div key={`h-${row.res.type}`} className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-ink3 font-600">{TYPE_LABEL[row.res.type]}</div>
              : null;
            return (
              <div key={row.kind === 'command' ? `c-${row.cmd.id}` : `r-${row.res.type}-${row.res.id}`}>
                {header}
                <button type="button" data-row={i}
                  onMouseEnter={() => setActive(i)} onClick={() => runRow(row)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left ${i === active ? 'bg-accent-soft/40' : ''}`}>
                  <span className={`flex-none ${i === active ? 'text-accent-dark' : 'text-ink3'}`}>
                    <Icon name={row.kind === 'command' ? row.cmd.icon : TYPE_ICON[row.res.type]} size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] text-ink truncate">{row.kind === 'command' ? row.cmd.label : row.res.title}</span>
                    {row.kind === 'result' && row.res.snippet && (
                      <span className="block text-[11px] text-ink3 truncate">{row.res.snippet}</span>
                    )}
                  </span>
                  <span className="flex-none text-[10.5px] text-ink3">
                    {row.kind === 'command' ? row.cmd.hint : row.res.subtitle}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* footer hint */}
        <div className="flex items-center gap-3 px-4 h-8 border-t border-border-soft flex-none text-[10.5px] text-ink3">
          <span className="flex items-center gap-1"><kbd className="font-mono border border-border rounded px-1">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="font-mono border border-border rounded px-1">↵</kbd> open</span>
          <span className="flex items-center gap-1"><kbd className="font-mono border border-border rounded px-1">&gt;</kbd> commands</span>
        </div>
      </div>
    </div>
  );
}
