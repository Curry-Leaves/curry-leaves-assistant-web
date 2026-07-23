import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { BackupInfo } from '../../api/backup';
import { SHeader, SGroup, SField, Value } from './primitives';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Settings → Backup: export the whole data dir as a zip; restore one wholesale.
 *  Restore keeps a safety copy of the replaced data and advises a backend restart. */
export function Backup() {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null); // chosen, awaiting confirm
  const [result, setResult] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => api.backupInfo().then(setInfo).catch(() => setInfo(null));
  useEffect(() => { refresh(); }, []);

  const doExport = async () => {
    setExporting(true); setResult(null);
    try { await api.exportBackup(); }
    catch (e) { setResult({ tone: 'err', text: e instanceof Error ? e.message : 'Export failed.' }); }
    setExporting(false);
  };

  const doRestore = async () => {
    if (!pendingFile) return;
    setRestoring(true); setResult(null);
    try {
      const r = await api.restoreBackup(pendingFile);
      setResult({ tone: 'ok', text: `${r.note} Safety copy: ${r.safetyCopy}` });
      refresh();
    } catch (e) {
      setResult({ tone: 'err', text: e instanceof Error ? e.message : 'Restore failed.' });
    }
    setPendingFile(null);
    setRestoring(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <>
      <SHeader title="Backup" subtitle="Everything — recordings, notes, tasks, assistants, settings — lives in the data directory as plain files. Export it as a zip; restore one wholesale." />
      <div className="overflow-y-auto">
        <SGroup>
          <SField label="Data directory"><Value mono>{info?.dataDir ?? '…'}</Value></SField>
          <SField label="Backup size" hint={info ? `Excludes re-downloadable model weights and in-flight queue files (${info.excluded.join(', ')}).` : undefined}>
            <Value>{info ? fmtBytes(info.totalBytes) : '…'}</Value>
          </SField>
        </SGroup>

        {info && info.categories.length > 0 && (
          <SGroup title="What's inside">
            <div className="rounded-[10px] border border-border bg-card overflow-hidden max-w-[480px]">
              {info.categories.map((c) => (
                <div key={c.name} className="flex items-center gap-3 px-3.5 py-2 border-b border-border-soft last:border-0">
                  <span className="font-mono text-[12px] text-ink flex-1 truncate">{c.name}</span>
                  <span className="text-[11px] text-ink3">{c.files} {c.files === 1 ? 'file' : 'files'}</span>
                  <span className="font-mono text-[11.5px] text-ink2 w-[72px] text-right">{fmtBytes(c.bytes)}</span>
                </div>
              ))}
            </div>
          </SGroup>
        )}

        <SGroup title="Export">
          <SField label="Download a backup" hint="A dated zip of the data directory. Keep it somewhere safe — it contains everything, including your PIN hash.">
            <button type="button" onClick={doExport} disabled={exporting}
              className="px-4 py-1.5 rounded-[8px] bg-accent text-white text-[12.5px] font-550 disabled:opacity-50">
              {exporting ? 'Preparing zip…' : 'Export backup'}
            </button>
          </SField>
        </SGroup>

        <SGroup title="Restore">
          <SField label="Restore from a backup" hint="Replaces the current data with the backup's contents. The replaced data is kept as a safety copy on disk, and model files are carried over. Restart the backend afterwards.">
            <div className="flex items-center gap-2 flex-wrap">
              <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" aria-label="Choose a backup zip"
                onChange={(e) => { setPendingFile(e.target.files?.[0] ?? null); setResult(null); }} />
              {!pendingFile ? (
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="px-3.5 py-1.5 rounded-[8px] border border-border bg-card text-ink2 text-[12.5px] hover:border-ink3">
                  Choose backup zip…
                </button>
              ) : (
                <>
                  <span className="font-mono text-[12px] text-ink2 truncate max-w-[220px]">{pendingFile.name}</span>
                  <button type="button" onClick={doRestore} disabled={restoring}
                    className="px-3.5 py-1.5 rounded-[8px] bg-rec text-white text-[12.5px] font-550 disabled:opacity-50">
                    {restoring ? 'Restoring…' : 'Replace my data with this'}
                  </button>
                  <button type="button" disabled={restoring}
                    onClick={() => { setPendingFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                    className="px-3 py-1.5 rounded-[8px] border border-border text-ink3 text-[12.5px] hover:text-ink2">
                    Cancel
                  </button>
                </>
              )}
            </div>
          </SField>
          {result && (
            <div className={`mt-3 text-[12.5px] leading-relaxed rounded-[8px] border px-3 py-2 max-w-[560px] ${
              result.tone === 'ok' ? 'border-ok/50 text-ink2 bg-card' : 'border-rec/50 text-rec bg-card'}`}>
              {result.text}
            </div>
          )}
        </SGroup>
      </div>
    </>
  );
}
