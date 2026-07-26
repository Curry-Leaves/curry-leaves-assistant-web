/**
 * NoteLinkButton — a toolbar control that opens a searchable picker over every note
 * in the knowledge base and inserts a cross-link as plain markdown `[Title](path.md)`.
 *
 * Internal note links are just `.md` markdown links here (see Markdown.tsx `isInternal`
 * / the note viewer's onNavigate) — no custom [[wikilink]] syntax — so the standard
 * link plugin and the note viewer both understand what we insert.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../../components/chrome/Icon';
import { t } from '../../../components/aitextspace/theme';
import { api } from '../../../api/client';
import type { KnowledgeNote } from '../../../types';

export function NoteLinkButton({
  onInsert, selectedText,
}: {
  onInsert: (markdown: string) => void;
  selectedText: () => string;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [hov, setHov] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // The selection captured when the picker opened — becomes the link label.
  const labelRef = useRef('');

  const openPicker = () => {
    labelRef.current = selectedText().trim();
    setOpen(true);
    setFilter('');
    if (notes.length) return;
    setLoading(true);
    api.listKnowledge()
      .then((list) => setNotes(list))
      .catch(() => setNotes([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const titleOf = (n: KnowledgeNote) => n.title || n.path.split('/').pop()?.replace(/\.md$/, '') || n.path;

  const insert = (n: KnowledgeNote) => {
    const label = labelRef.current || titleOf(n);
    setOpen(false);
    setFilter('');
    labelRef.current = '';
    // Insert a ROOT-relative link (leading '/'). The backend link resolver treats a
    // target without a leading slash as relative to the LINKING note's directory, so a
    // bare bundle path (`topics/x.md`) breaks for any note in a subfolder — the graph
    // and backlinks would never see the edge. `/topics/x.md` resolves unambiguously,
    // and the view-mode renderer already strips the leading slash when navigating.
    onInsert(`[${label}](/${n.path})`);
  };

  const filtered = filter.trim()
    ? notes.filter((n) => titleOf(n).toLowerCase().includes(filter.toLowerCase()) || n.path.toLowerCase().includes(filter.toLowerCase()))
    : notes;

  return (
    <>
      <button
        type="button"
        title="Insert a link to another note"
        data-toolbar-item="true"
        onMouseDown={(e) => { e.preventDefault(); openPicker(); }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 5,
          background: hov ? 'var(--color-border-soft)' : 'transparent',
          border: '0.5px solid transparent', color: hov ? t.ink : t.inkSoft,
          cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 11.5,
        }}
      >
        <Icon name="link" size={13} color={hov ? t.accent : t.inkSoft} /> Note
      </button>

      {open && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 70, display: 'flex',
          alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)',
        }}
          onMouseDown={() => setOpen(false)}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: 400, maxHeight: 480, display: 'flex', flexDirection: 'column',
              background: t.bgRaised, border: `0.5px solid ${t.hair}`, borderRadius: 12,
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '11px 14px 9px', borderBottom: `0.5px solid ${t.hair}`, display: 'flex', alignItems: 'center', gap: 9 }}>
              <Icon name="search" size={13} color={t.muted} />
              <input
                ref={inputRef}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered.length) { e.preventDefault(); insert(filtered[0]); }
                  if (e.key === 'Escape') setOpen(false);
                }}
                placeholder="Search notes…"
                style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontFamily: 'Inter, sans-serif', fontSize: 13, color: t.ink }}
              />
            </div>

            {labelRef.current && (
              <div style={{ padding: '6px 14px', borderBottom: `0.5px solid ${t.hairSoft}`, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10.5, color: t.muted }}>Link text:</span>
                <span style={{
                  fontFamily: 'Inter, sans-serif', fontSize: 10.5, fontWeight: 500, color: t.ink,
                  background: `color-mix(in oklch, ${t.accent} 10%, ${t.bgRaised})`,
                  border: `0.5px solid ${t.accent}`, borderRadius: 4, padding: '1px 6px',
                }}>{labelRef.current}</span>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 80 }}>
              {loading && <div style={{ padding: 20, textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 12, color: t.muted }}>Loading…</div>}
              {!loading && filtered.length === 0 && <div style={{ padding: 20, textAlign: 'center', fontFamily: 'Inter, sans-serif', fontSize: 12, color: t.muted, fontStyle: 'italic' }}>No notes found</div>}
              {!loading && filtered.map((n) => (
                <button
                  key={n.path}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insert(n); }}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 2, width: '100%', textAlign: 'left',
                    padding: '9px 14px', border: 'none', background: 'transparent', cursor: 'pointer',
                    borderBottom: `0.5px solid ${t.hairSoft}`,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = t.bgSunken; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500, color: t.ink }}>{titleOf(n)}</span>
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, color: t.muted }}>{n.path}</span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
