import { useState, useRef, useCallback } from 'react';
import {
  useCodeBlockEditorContext,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
} from '@mdxeditor/editor';
import { Trash2, Plus, X } from 'lucide-react';
import { useTheme } from './theme';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KanbanColumn {
  title: string;
  cards: string[];
}

// ── Parse / serialize ─────────────────────────────────────────────────────────

export function parseKanbanData(code: string): KanbanColumn[] | null {
  const lines = code.split('\n');
  const columns: KanbanColumn[] = [];
  let current: KanbanColumn | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    const colMatch = line.match(/^===\s+(.+)$/);
    if (colMatch) {
      current = { title: colMatch[1].trim(), cards: [] };
      columns.push(current);
      continue;
    }

    const cardMatch = line.match(/^-\s+(.+)$/);
    if (cardMatch && current) {
      current.cards.push(cardMatch[1].trim());
    }
  }

  return columns.length > 0 ? columns : null;
}

export function serializeKanban(columns: KanbanColumn[]): string {
  return columns
    .map(col => {
      const header = `=== ${col.title}`;
      const cards = col.cards.map(c => `- ${c}`);
      return [header, ...cards].join('\n');
    })
    .join('\n\n');
}

// ── DeleteBtn (two-stage) ─────────────────────────────────────────────────────

function DeleteBtn({ onClick, t }: { onClick: () => void; t: ReturnType<typeof useTheme> }) {
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = (e: React.MouseEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    setConfirming(true);
    timer.current = setTimeout(() => setConfirming(false), 2500);
  };
  const disarm = (e: React.MouseEvent) => {
    e.preventDefault();
    if (timer.current) clearTimeout(timer.current);
    setConfirming(false);
  };
  const confirm = (e: React.MouseEvent) => {
    e.preventDefault();
    onClick();
  };

  const btn: React.CSSProperties = {
    fontSize: 10.5,
    padding: '2px 8px',
    borderRadius: 4,
    lineHeight: 1.6,
    cursor: 'pointer',
    fontFamily: 'Inter, sans-serif',
    transition: 'all 0.1s',
  };

  if (confirming) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <button
          type="button"
          onMouseDown={confirm}
          style={{
            ...btn,
            border: '0.5px solid oklch(0.55 0.18 15)',
            background: 'oklch(0.55 0.18 15)',
            color: '#fff',
            fontWeight: 600,
          }}
        >
          Delete
        </button>
        <button
          type="button"
          onMouseDown={disarm}
          style={{
            ...btn,
            border: `0.5px solid ${t.hair}`,
            background: 'transparent',
            color: t.muted,
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      title="Delete block"
      onMouseDown={arm}
      style={{
        ...btn,
        border: `0.5px solid ${t.hair}`,
        background: 'transparent',
        color: t.faint,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
      }}
    >
      <Trash2 size={11} />
    </button>
  );
}

// ── DragState ─────────────────────────────────────────────────────────────────

interface DragSrc {
  colIdx: number;
  cardIdx: number;
}

// ── KanbanBoard ───────────────────────────────────────────────────────────────

export interface KanbanBoardProps {
  columns: KanbanColumn[];
  onChange?: (columns: KanbanColumn[]) => void;
  t: ReturnType<typeof useTheme>;
}

export function KanbanBoard({ columns, onChange, t }: KanbanBoardProps) {
  const isEditMode = onChange !== undefined;

  // Per-column "add card" draft text
  const [drafts, setDrafts] = useState<Record<number, string>>(() => ({}));
  // Inline column title editing
  const [editingColIdx, setEditingColIdx] = useState<number | null>(null);
  const [colTitleDraft, setColTitleDraft] = useState('');
  // New column title draft
  const [addingCol, setAddingCol] = useState(false);
  const [newColDraft, setNewColDraft] = useState('');
  // Drag state
  const [dragSrc, setDragSrc] = useState<DragSrc | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const [dragOverCard, setDragOverCard] = useState<number | null>(null);
  // Card hover
  const [hovCard, setHovCard] = useState<{ colIdx: number; cardIdx: number } | null>(null);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const update = useCallback(
    (next: KanbanColumn[]) => {
      onChange?.(next);
    },
    [onChange]
  );

  const addCard = (colIdx: number) => {
    const text = (drafts[colIdx] ?? '').trim();
    if (!text) return;
    const next = columns.map((col, i) =>
      i === colIdx ? { ...col, cards: [...col.cards, text] } : col
    );
    update(next);
    setDrafts(d => ({ ...d, [colIdx]: '' }));
  };

  const deleteCard = (colIdx: number, cardIdx: number) => {
    const next = columns.map((col, i) =>
      i === colIdx
        ? { ...col, cards: col.cards.filter((_, ci) => ci !== cardIdx) }
        : col
    );
    update(next);
  };

  const deleteColumn = (colIdx: number) => {
    update(columns.filter((_, i) => i !== colIdx));
  };

  const commitColTitle = (colIdx: number) => {
    const title = colTitleDraft.trim();
    if (title) {
      update(columns.map((col, i) => (i === colIdx ? { ...col, title } : col)));
    }
    setEditingColIdx(null);
    setColTitleDraft('');
  };

  const addColumn = () => {
    const title = newColDraft.trim();
    if (title) {
      update([...columns, { title, cards: [] }]);
    }
    setAddingCol(false);
    setNewColDraft('');
  };

  // ── Drag handlers ─────────────────────────────────────────────────────────

  const onDragStart = (e: React.DragEvent, colIdx: number, cardIdx: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragSrc({ colIdx, cardIdx });
  };

  const onDragOver = (e: React.DragEvent, colIdx: number, cardIdx?: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(colIdx);
    setDragOverCard(cardIdx ?? null);
  };

  const onDragLeave = () => {
    // keep col highlight; clear card indicator
    setDragOverCard(null);
  };

  const onDrop = (e: React.DragEvent, targetColIdx: number, targetCardIdx?: number) => {
    e.preventDefault();
    if (!dragSrc) return;

    const { colIdx: srcCol, cardIdx: srcCard } = dragSrc;

    // Build mutable copy
    const next = columns.map(col => ({ ...col, cards: [...col.cards] }));

    // Remove from source
    const [removed] = next[srcCol].cards.splice(srcCard, 1);

    // Determine insert position
    let insertAt: number;
    if (targetCardIdx !== undefined) {
      // Dropping onto a specific card — insert before it, adjusting for removal in same column
      const adjusted =
        srcCol === targetColIdx && srcCard < targetCardIdx
          ? targetCardIdx - 1
          : targetCardIdx;
      insertAt = Math.max(0, adjusted);
    } else {
      // Dropping onto column body (below all cards)
      insertAt = next[targetColIdx].cards.length;
    }

    next[targetColIdx].cards.splice(insertAt, 0, removed);
    update(next);

    setDragSrc(null);
    setDragOverCol(null);
    setDragOverCard(null);
  };

  const onDragEnd = () => {
    setDragSrc(null);
    setDragOverCol(null);
    setDragOverCard(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        overflowX: 'auto',
        padding: '10px 12px 12px',
        fontFamily: 'Inter, sans-serif',
      }}
    >
      {columns.map((col, colIdx) => {
        const isDropTarget = dragOverCol === colIdx;

        return (
          <div
            key={colIdx}
            style={{
              width: 200,
              minWidth: 200,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 8,
              border: `0.5px solid ${isDropTarget ? t.accent + '66' : t.hair}`,
              background: isDropTarget
                ? `color-mix(in oklch, ${t.accent} 5%, ${t.bgSunken})`
                : t.bgSunken,
              overflow: 'hidden',
              transition: 'border-color 0.1s, background 0.1s',
            }}
            onDragOver={e => onDragOver(e, colIdx)}
            onDragLeave={onDragLeave}
            onDrop={e => onDrop(e, colIdx)}
          >
            {/* Column header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 8px 5px',
                borderBottom: `0.5px solid ${t.hair}`,
                background: t.bgRaised,
                userSelect: 'none',
              }}
            >
              {isEditMode && editingColIdx === colIdx ? (
                <input
                  autoFocus
                  value={colTitleDraft}
                  onChange={e => setColTitleDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.stopPropagation(); commitColTitle(colIdx); }
                    if (e.key === 'Escape') { setEditingColIdx(null); setColTitleDraft(''); }
                  }}
                  onBlur={() => commitColTitle(colIdx)}
                  style={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: 700,
                    color: t.ink,
                    background: t.bgSunken,
                    border: `0.5px solid ${t.accent}`,
                    borderRadius: 3,
                    padding: '1px 5px',
                    outline: 'none',
                    minWidth: 0,
                  }}
                />
              ) : (
                <span
                  onDoubleClick={() => {
                    if (!isEditMode) return;
                    setEditingColIdx(colIdx);
                    setColTitleDraft(col.title);
                  }}
                  title={isEditMode ? 'Double-click to rename' : undefined}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: 700,
                    color: t.ink,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    cursor: isEditMode ? 'text' : 'default',
                  }}
                >
                  {col.title}
                </span>
              )}

              {/* Card count badge */}
              <span
                style={{
                  fontSize: 9.5,
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  color: t.muted,
                  background: t.bgSunken,
                  border: `0.5px solid ${t.hair}`,
                  borderRadius: 10,
                  padding: '0px 5px',
                  lineHeight: 1.7,
                  flexShrink: 0,
                }}
              >
                {col.cards.length}
              </span>

              {/* Delete column button */}
              {isEditMode && (
                <button
                  type="button"
                  title="Delete column"
                  onClick={() => deleteColumn(colIdx)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: t.faint,
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: 3,
                    transition: 'color 0.1s',
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = 'oklch(0.55 0.18 15)')}
                  onMouseLeave={e => (e.currentTarget.style.color = t.faint)}
                >
                  <X size={11} />
                </button>
              )}
            </div>

            {/* Card list */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                padding: '7px 7px 5px',
                minHeight: 40,
              }}
            >
              {col.cards.map((card, cardIdx) => {
                const isBeingDragged =
                  dragSrc?.colIdx === colIdx && dragSrc?.cardIdx === cardIdx;
                const isHovered =
                  hovCard?.colIdx === colIdx && hovCard?.cardIdx === cardIdx;
                const isDropIndicator =
                  isDropTarget && dragOverCard === cardIdx && !isBeingDragged;

                return (
                  <div
                    key={cardIdx}
                    draggable={isEditMode}
                    onDragStart={e => onDragStart(e, colIdx, cardIdx)}
                    onDragEnd={onDragEnd}
                    onDragOver={e => { e.stopPropagation(); onDragOver(e, colIdx, cardIdx); }}
                    onDrop={e => { e.stopPropagation(); onDrop(e, colIdx, cardIdx); }}
                    onMouseEnter={() => setHovCard({ colIdx, cardIdx })}
                    onMouseLeave={() => setHovCard(null)}
                    style={{
                      position: 'relative',
                      background: isHovered ? t.bgSunken : t.bgRaised,
                      border: `0.5px solid ${isDropIndicator ? t.accent : t.hair}`,
                      borderRadius: 6,
                      padding: '5px 7px',
                      fontSize: 11.5,
                      fontFamily: 'Inter, sans-serif',
                      color: t.ink,
                      lineHeight: 1.5,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 5,
                      opacity: isBeingDragged ? 0.35 : 1,
                      cursor: isEditMode ? 'grab' : 'default',
                      transition: 'background 0.1s, border-color 0.1s, opacity 0.1s',
                      boxShadow: isDropIndicator
                        ? `0 0 0 1.5px ${t.accent}33`
                        : 'none',
                    }}
                  >
                    <span style={{ flex: 1, wordBreak: 'break-word' }}>{card}</span>

                    {/* Delete card button (edit mode) */}
                    {isEditMode && (
                      <button
                        type="button"
                        title="Remove card"
                        onClick={() => deleteCard(colIdx, cardIdx)}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          color: t.faint,
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          borderRadius: 3,
                          flexShrink: 0,
                          marginTop: 1,
                          transition: 'color 0.1s',
                          opacity: isHovered ? 1 : 0,
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.color = 'oklch(0.55 0.18 15)';
                          e.currentTarget.style.opacity = '1';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.color = t.faint;
                          e.currentTarget.style.opacity = isHovered ? '1' : '0';
                        }}
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Drop zone when column is empty and is target */}
              {col.cards.length === 0 && isDropTarget && (
                <div
                  style={{
                    height: 36,
                    borderRadius: 6,
                    border: `1px dashed ${t.accent}66`,
                    background: `color-mix(in oklch, ${t.accent} 8%, ${t.bgSunken})`,
                  }}
                />
              )}
            </div>

            {/* Add card input (edit mode) */}
            {isEditMode && (
              <div style={{ padding: '3px 7px 7px' }}>
                <input
                  value={drafts[colIdx] ?? ''}
                  onChange={e =>
                    setDrafts(d => ({ ...d, [colIdx]: e.target.value }))
                  }
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      addCard(colIdx);
                    }
                    if (e.key === 'Escape') {
                      setDrafts(d => ({ ...d, [colIdx]: '' }));
                    }
                  }}
                  placeholder="Add card…"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    fontSize: 11,
                    fontFamily: 'Inter, sans-serif',
                    background: t.bgRaised,
                    border: `0.5px solid ${t.hair}`,
                    borderRadius: 5,
                    padding: '4px 7px',
                    color: t.ink,
                    outline: 'none',
                    transition: 'border-color 0.1s',
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = t.accent)}
                  onBlur={e => (e.currentTarget.style.borderColor = t.hair)}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Add column button / input (edit mode) */}
      {isEditMode && (
        <div style={{ width: 200, minWidth: 200, flexShrink: 0 }}>
          {addingCol ? (
            <div
              style={{
                borderRadius: 8,
                border: `0.5px solid ${t.accent}`,
                background: t.bgSunken,
                overflow: 'hidden',
              }}
            >
              <div style={{ padding: '6px 8px 5px', borderBottom: `0.5px solid ${t.hair}`, background: t.bgRaised }}>
                <input
                  autoFocus
                  value={newColDraft}
                  onChange={e => setNewColDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.stopPropagation(); addColumn(); }
                    if (e.key === 'Escape') { setAddingCol(false); setNewColDraft(''); }
                  }}
                  onBlur={addColumn}
                  placeholder="Column name…"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: 700,
                    color: t.ink,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                  }}
                />
              </div>
              <div style={{ padding: '4px 7px 7px', display: 'flex', gap: 5 }}>
                <button
                  type="button"
                  onMouseDown={e => { e.preventDefault(); addColumn(); }}
                  style={{
                    flex: 1,
                    fontSize: 11,
                    fontFamily: 'Inter, sans-serif',
                    background: t.accent,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 5,
                    padding: '4px 0',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => { setAddingCol(false); setNewColDraft(''); }}
                  style={{
                    fontSize: 11,
                    fontFamily: 'Inter, sans-serif',
                    background: 'transparent',
                    color: t.muted,
                    border: `0.5px solid ${t.hair}`,
                    borderRadius: 5,
                    padding: '4px 9px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingCol(true)}
              style={{
                width: '100%',
                borderRadius: 8,
                border: `1px dashed ${t.hair}`,
                background: 'transparent',
                color: t.muted,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                padding: '9px 0',
                cursor: 'pointer',
                fontSize: 11.5,
                fontFamily: 'Inter, sans-serif',
                transition: 'border-color 0.1s, color 0.1s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = t.inkSoft;
                e.currentTarget.style.color = t.inkSoft;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = t.hair;
                e.currentTarget.style.color = t.muted;
              }}
            >
              <Plus size={13} />
              Add column
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── KanbanEditor (code block editor component) ────────────────────────────────

function KanbanEditor({ code }: CodeBlockEditorProps) {
  const { setCode, parentEditor, lexicalNode } = useCodeBlockEditorContext();
  const deleteBlock = () => parentEditor.update(() => lexicalNode.remove());
  const t = useTheme();

  const [columns, setColumns] = useState<KanbanColumn[]>(
    () => parseKanbanData(code) ?? []
  );

  const handleChange = useCallback(
    (next: KanbanColumn[]) => {
      setColumns(next);
      setCode(serializeKanban(next));
    },
    [setCode]
  );

  return (
    <div data-rich-block="true"
      style={{
        margin: '8px 0',
        borderRadius: 8,
        border: `0.5px solid ${t.hair}`,
        background: t.bgSunken,
        overflow: 'hidden',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 10px',
          borderBottom: `0.5px solid ${t.hair}`,
          background: t.bgRaised,
          userSelect: 'none',
        }}
      >
        {/* Kanban grid icon */}
        <span
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1.5,
            width: 14,
            height: 12,
            flexShrink: 0,
          }}
        >
          {[7, 10, 5, 4, 8, 3, 9, 6, 11].map((h, i) => (
            <span
              key={i}
              style={{
                width: '100%',
                height: Math.min(12, h),
                background: t.muted,
                borderRadius: 1,
                alignSelf: 'end',
              }}
            />
          ))}
        </span>

        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: t.muted,
            fontWeight: 600,
            letterSpacing: 0.3,
            flex: 1,
          }}
        >
          kanban
        </span>

        <span
          style={{
            fontSize: 9.5,
            fontFamily: 'Inter, sans-serif',
            color: t.faint,
          }}
        >
          {columns.reduce((n, c) => n + c.cards.length, 0)} cards · {columns.length} columns
        </span>

        <DeleteBtn onClick={deleteBlock} t={t} />
      </div>

      {/* Board */}
      {columns.length > 0 ? (
        <KanbanBoard columns={columns} onChange={handleChange} t={t} />
      ) : (
        <div
          style={{
            padding: '28px 16px',
            textAlign: 'center',
            color: t.faint,
            fontSize: 12,
            fontStyle: 'italic',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          No columns yet — click "Add column" or edit the source block.
        </div>
      )}

      {/* Footer hint */}
      <div
        style={{
          padding: '3px 12px 5px',
          borderTop: `0.5px solid ${t.hairSoft}`,
        }}
      >
        <span
          style={{
            fontSize: 9.5,
            color: t.faint,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          Drag cards between columns · double-click column title to rename
        </span>
      </div>
    </div>
  );
}

// ── Descriptor ────────────────────────────────────────────────────────────────

export const kanbanCodeBlockDescriptor: CodeBlockEditorDescriptor = {
  match: (language) => language === 'kanban',
  priority: 10,
  Editor: KanbanEditor,
};
