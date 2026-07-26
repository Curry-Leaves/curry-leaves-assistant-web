import { useEffect, useState } from 'react';
import { SHeader, SGroup, SField, Value } from './primitives';
import { api } from '../../api/client';
import type { EmbeddingsStatus } from '../../types';

/**
 * Knowledge settings — the semantic-search model. It's downloaded on demand (here or in the
 * first-run wizard's Knowledge step), never at boot, so a fresh install that doesn't want it
 * never pulls the ~90 MB. Until it's downloaded, search runs keyword-only; the KB still works.
 */
export function Knowledge() {
  const [status, setStatus] = useState<EmbeddingsStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.getEmbeddingsStatus().then(setStatus).catch((e) => setErr(String(e))); }, []);

  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const next = await api.downloadEmbeddings();
      setStatus(next);
      if (next.error) setErr(next.error);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  const statusLabel = !status ? '…'
    : !status.available ? 'Unavailable on this install'
    : status.downloaded ? 'Ready — searching by meaning'
    : 'Not downloaded — keyword search only';

  return (
    <>
      <SHeader title="Knowledge" subtitle="How your notes are searched — by keyword, and optionally by meaning." />
      <div className="overflow-y-auto">
        <SGroup title="Search">
          <SField
            label="Semantic search"
            hint="Find notes by meaning, not just exact words — “what did I decide about pricing?” matches even when the note never says “pricing”. Runs entirely on this device. Without it, search still works on keywords."
          >
            <Value>{statusLabel}</Value>
          </SField>

          {status?.available && (
            <SField
              label="Search model"
              hint="About 90 MB, downloaded once and kept on this device. Downloaded only when you ask — never in the background."
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={download}
                  disabled={busy}
                  className="h-[30px] px-3 rounded-[6px] border border-border bg-bg text-ink text-[12.5px] hover:bg-border-soft disabled:opacity-50"
                >
                  {busy ? 'Downloading…' : status.downloaded ? 'Re-download' : 'Download'}
                </button>
                <Value>{status.downloaded ? 'Ready' : 'Not downloaded'}</Value>
              </div>
            </SField>
          )}

          {err && <SField label=""><Value>{err}</Value></SField>}
        </SGroup>
      </div>
    </>
  );
}
