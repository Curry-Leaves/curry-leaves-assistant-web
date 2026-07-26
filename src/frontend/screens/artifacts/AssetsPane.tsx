/** Reference assets for one artifact — the images the user supplies for it to use.
 *
 *  The agent reads these back with `artifacts_read(action='assets')`, sees them, and
 *  refers to them by relative path in the HTML it writes. Uploading a photo here is what
 *  gets a real photo into a deck instead of a hand-drawn SVG approximation.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import type { Artifact, ArtifactAsset } from '../../types';

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

export function AssetsPane({ artifact }: { artifact: Artifact }) {
  const [assets, setAssets] = useState<ArtifactAsset[]>([]);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    api.listArtifactAssets(artifact.id).then(setAssets).catch(() => setAssets([]));
  }, [artifact.id]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    let stale = false;
    api.artifactShareUrl(artifact).then((u) => { if (!stale) setBaseUrl(u); });
    return () => { stale = true; };
  }, [artifact.id, artifact.shareToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    const failed: string[] = [];
    // Sequential: a multi-file drop shouldn't open N concurrent multi-MB POSTs.
    for (const f of files) {
      try {
        await api.uploadArtifactAsset(artifact.id, f);
      } catch (e) {
        failed.push(`${f.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      }
    }
    setErrs(failed);
    setUploading(false);
    refresh();
  }, [artifact.id, refresh]);

  const remove = useCallback(async (path: string) => {
    try { await api.deleteArtifactAsset(artifact.id, path); } finally { refresh(); }
  }, [artifact.id, refresh]);

  const copyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path);
    setCopied(path);
    setTimeout(() => setCopied((c) => (c === path ? null : c)), 1200);
  }, []);

  return (
    <div className="flex-none border-t border-border bg-border-soft/20">
      <div className="px-4 py-2 flex items-center gap-2">
        <span className="text-[11px] font-550 text-ink2 uppercase tracking-wide">Reference images</span>
        <span className="text-[10.5px] text-ink3">
          {assets.length ? `${assets.length} file${assets.length > 1 ? 's' : ''}` : 'none yet'}
          {' — the assistant can see these and use them in this artifact'}
        </span>
      </div>

      {assets.length > 0 && (
        <div className="px-4 pb-2 flex flex-wrap gap-2">
          {assets.map((a) => (
            <div key={a.path} className="group relative w-[104px] rounded-[8px] border border-border bg-bg overflow-hidden">
              <div className="h-[64px] bg-border-soft/40 grid place-items-center overflow-hidden">
                {baseUrl && a.kind === 'image' ? (
                  <img src={`${baseUrl}${a.path}`} alt={a.name} className="max-w-full max-h-full object-contain" />
                ) : (
                  <Icon name="file" size={18} color="var(--color-ink3)" />
                )}
              </div>
              <div className="px-1.5 py-1">
                <div className="text-[10px] text-ink truncate" title={a.path}>{a.name}</div>
                <div className="text-[9.5px] text-ink3">
                  {a.width && a.height ? `${a.width}×${a.height} · ` : ''}{fmtSize(a.size)}
                </div>
              </div>
              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" title={`Copy path (${a.path})`} onClick={() => copyPath(a.path)}
                  className="w-6 h-6 grid place-items-center rounded-[6px] bg-bg/90 border border-border text-ink3 hover:border-ink3">
                  <Icon name={copied === a.path ? 'check' : 'link'} size={11} />
                </button>
                <button type="button" title="Remove" onClick={() => remove(a.path)}
                  className="w-6 h-6 grid place-items-center rounded-[6px] bg-bg/90 border border-border text-ink3 hover:border-rec/50">
                  <Icon name="trash" size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-4 pb-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); upload(Array.from(e.dataTransfer.files)); }}
          onClick={() => inputRef.current?.click()}
          className={`border border-dashed rounded-[8px] px-3 py-3 text-center cursor-pointer transition-colors ${
            dragging ? 'border-accent bg-accent-soft/20' : 'border-border hover:border-accent-soft hover:bg-accent-soft/10'}`}
        >
          <input ref={inputRef} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
            className="hidden" title="Choose images" aria-label="Choose images"
            onChange={(e) => { upload(Array.from(e.target.files || [])); e.target.value = ''; }} />
          <div className="text-[11.5px] text-ink3">
            {uploading ? 'Uploading…' : 'Drop images here, or click to choose — PNG, JPEG, GIF, WebP, SVG (max 10 MB)'}
          </div>
        </div>
        {errs.length > 0 && (
          <div className="mt-1.5 text-[11px] text-rec">{errs.map((m, i) => <div key={i}>{m}</div>)}</div>
        )}
      </div>
    </div>
  );
}
