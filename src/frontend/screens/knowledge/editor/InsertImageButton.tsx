/**
 * InsertImageButton — toolbar control for adding an image to a note.
 *
 * Two ways in, because they serve different intents: "Choose file…" copies an image INTO the
 * bundle (the note owns it, works offline, survives the original being moved), while "From URL"
 * only references a remote one. Both end up as ordinary markdown — `![alt](assets/x.png)` or
 * `![alt](https://…)` — so nothing here invents syntax the renderer would have to special-case.
 *
 * Paste and drag-and-drop are wired separately, in RichNoteEditor, since those are events on the
 * content-editable rather than toolbar actions; all four share `useImageInsert`.
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../../components/chrome/Icon';
import { t } from '../../../components/aitextspace/theme';
import { useUploadBusy } from './useImageInsert';

export function InsertImageButton({
  onFiles, onUrl,
}: {
  onFiles: (files: File[]) => void;
  onUrl: (url: string, alt?: string) => void;
}) {
  // Subscribed, not passed in — see useImageInsert's store comment.
  const busy = useUploadBusy();
  const [hov, setHov] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const submitUrl = () => {
    if (!url.trim()) return;
    onUrl(url, alt);
    setUrl(''); setAlt(''); setUrlOpen(false);
  };

  return (
    <>
      {/* Kept out of the toolbar's flow (`display:none` would make some browsers skip the
          click) so the picker can be opened programmatically from the button below. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          // Reset first: picking the SAME file twice in a row fires no change event otherwise.
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      <button
        type="button"
        title="Insert an image"
        data-toolbar-item="true"
        disabled={busy}
        onMouseDown={(e) => { e.preventDefault(); fileRef.current?.click(); }}
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 5,
          background: hov && !busy ? 'var(--color-border-soft)' : 'transparent',
          border: '0.5px solid transparent', color: hov && !busy ? t.ink : t.inkSoft,
          cursor: busy ? 'progress' : 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 11.5,
          opacity: busy ? 0.6 : 1,
        }}
      >
        <Icon name="paperclip" size={13} color={hov && !busy ? t.accent : t.inkSoft} />
        {busy ? 'Adding…' : 'Image'}
      </button>
      <button
        type="button"
        title="Insert an image from a URL"
        data-toolbar-item="true"
        onMouseDown={(e) => { e.preventDefault(); setUrlOpen(true); }}
        style={{
          display: 'flex', alignItems: 'center', padding: '3px 4px', borderRadius: 5,
          background: 'transparent', border: '0.5px solid transparent', color: t.inkSoft,
          cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 11.5,
        }}
      >
        <Icon name="more" size={11} color={t.inkSoft} />
      </button>

      {urlOpen && createPortal(
        <div style={{
          position: 'fixed', inset: 0, zIndex: 70, display: 'flex',
          alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)',
        }}
          onMouseDown={() => setUrlOpen(false)}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: 420, background: t.bgRaised, border: `0.5px solid ${t.hair}`,
              borderRadius: 12, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden',
            }}
          >
            <div style={{ padding: '11px 14px 9px', borderBottom: `0.5px solid ${t.hair}`, fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 600, color: t.ink }}>
              Image from URL
            </div>
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitUrl(); }
                  if (e.key === 'Escape') setUrlOpen(false);
                }}
                placeholder="https://example.com/image.png"
                style={{
                  padding: '7px 9px', borderRadius: 7, border: `0.5px solid ${t.hair}`,
                  background: t.bg, outline: 'none', fontFamily: 'Inter, sans-serif',
                  fontSize: 12.5, color: t.ink,
                }}
              />
              <input
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitUrl(); }
                  if (e.key === 'Escape') setUrlOpen(false);
                }}
                placeholder="Description (alt text)"
                style={{
                  padding: '7px 9px', borderRadius: 7, border: `0.5px solid ${t.hair}`,
                  background: t.bg, outline: 'none', fontFamily: 'Inter, sans-serif',
                  fontSize: 12.5, color: t.ink,
                }}
              />
              <div style={{ fontSize: 11, color: t.muted, fontFamily: 'Inter, sans-serif' }}>
                Linked, not copied — the note breaks if the remote image goes away.
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 7, marginTop: 2 }}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); setUrlOpen(false); }}
                  style={{ padding: '5px 11px', borderRadius: 7, border: `0.5px solid ${t.hair}`, background: 'transparent', color: t.inkSoft, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
                  Cancel
                </button>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); submitUrl(); }}
                  style={{ padding: '5px 11px', borderRadius: 7, border: 'none', background: t.accent, color: 'white', cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600 }}>
                  Insert
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
