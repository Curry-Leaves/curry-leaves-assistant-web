import { useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';

// "Feed docs" — paste text or drop a file into the knowledge base. Both routes render
// to markdown server-side and hand off to the Knowledge Keeper, which files + links it.
export function IngestModal({ onClose, onQueued }: { onClose: () => void; onQueued: () => void }) {
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setBusy(true); setError(null); setDone(null);
    try {
      let dup = false, n = 0, converting = false;
      if (mode === 'paste') {
        if (!text.trim()) throw new Error('Paste some text first.');
        const r = await api.ingestKnowledgeText(text.trim(), title.trim() || undefined);
        dup = r.duplicate; n = 1;
      } else {
        if (files.length === 0) throw new Error('Choose at least one file.');
        for (const f of files) {
          const r = await api.ingestKnowledgeFile(f.name, await f.arrayBuffer());
          dup = dup || r.duplicate; n++; if (r.status === 'converting') converting = true;
        }
      }
      onQueued();
      setDone(
        `Added ${n} document${n === 1 ? '' : 's'}${dup ? ' (duplicate detected — will merge, not duplicate)' : ''}. ` +
        (converting
          ? 'Files are being converted to text (PDFs are OCR’d — this can take a few minutes for big files), then filed automatically. Watch the Activity panel.'
          : 'The agent reads it and files notes — watch the Activity panel.'));
      setText(''); setTitle(''); setFiles([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ingest failed.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div className="w-[560px] max-w-[92vw] rounded-[12px] border border-border bg-card shadow-pop overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Icon name="file" size={15} />
          <span className="text-[14px] font-550 text-ink">Feed documents to the knowledge base</span>
          <span className="flex-1" />
          <button type="button" onClick={onClose} title="Close" className="p-1 rounded-[6px] text-ink3 hover:text-ink hover:bg-border-soft">
            <Icon name="x" size={15} />
          </button>
        </div>

        {/* mode toggle */}
        <div className="px-4 pt-3">
          <div className="flex gap-0.5 bg-sidebar border border-sidebar-border rounded-[7px] p-0.5 w-fit">
            {(['paste', 'file'] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setMode(m); setError(null); setDone(null); }}
                className={`px-3 py-1 rounded-[5px] text-[12px] capitalize ${mode === m ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>
                {m === 'paste' ? 'Paste text' : 'Upload file'}
              </button>
            ))}
          </div>
        </div>

        {/* body */}
        <div className="px-4 py-3 flex flex-col gap-2.5">
          {mode === 'paste' ? (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)"
                className="bg-sidebar border border-sidebar-border rounded-[8px] px-3 py-2 text-[12.5px] text-sidebar-ink outline-none placeholder:text-sidebar-ink3" />
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} autoFocus
                placeholder="Paste notes, a doc, a spec, an email thread… anything to remember. Curry Leaves extracts the durable facts and files them."
                className="bg-bg border border-border rounded-[8px] px-3 py-2 text-[12.5px] text-ink leading-relaxed outline-none resize-none placeholder:text-ink3" />
            </>
          ) : (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); setFiles(Array.from(e.dataTransfer.files)); }}
              onClick={() => inputRef.current?.click()}
              className="border border-dashed border-border rounded-[10px] px-4 py-8 text-center cursor-pointer hover:border-accent-soft hover:bg-accent-soft/10">
              <input ref={inputRef} type="file" multiple className="hidden" title="Choose files" aria-label="Choose files"
                onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              <Icon name="file" size={20} color="var(--color-ink3)" />
              <div className="mt-2 text-[12.5px] text-ink2">
                {files.length ? files.map((f) => f.name).join(', ') : 'Drop files here, or click to choose'}
              </div>
              <div className="mt-1 text-[11px] text-ink3">PDF, DOCX, TXT, MD, audio… — rendered to text, then filed.</div>
            </div>
          )}

          {error && <div className="text-[11.5px] text-rec">{error}</div>}
          {done && <div className="text-[11.5px] text-green-700">{done}</div>}
        </div>

        {/* footer */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-3 py-1.5 rounded-[8px] border border-border text-[12.5px] text-ink2 hover:bg-border-soft">Close</button>
          <button type="button" onClick={submit} disabled={busy}
            className="px-3.5 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 disabled:opacity-50">
            {busy ? 'Feeding…' : 'Feed to knowledge base'}
          </button>
        </div>
      </div>
    </div>
  );
}
