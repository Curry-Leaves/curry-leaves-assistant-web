import { useEffect, useState } from 'react';
import { Check, Download, BookOpen } from 'lucide-react';
import { api } from '../../../api/client';
import type { EmbeddingsStatus } from '../../../types';
import { StepHead, StepNav } from '../SetupWizard';

/**
 * Knowledge step — only shown when the user picked "knowledge" in the usage step (SetupWizard
 * gates it), so nobody who isn't building a knowledge base is asked to pull the ~90 MB embedding
 * model. Without it the KB still works on keyword search; the model adds semantic ("by meaning")
 * recall.
 *
 * Like the transcription and voice steps, the download does NOT block Continue: it lands in the
 * background and the vector tier comes up once it's ready. Continue kicks off the download if it
 * hasn't happened; Skip leaves search keyword-only (still enable-able later in Settings →
 * Knowledge, which offers the same download).
 */
export function KnowledgeStep({ onNext, onSkip, onBack }: {
  onNext: () => void; onSkip: () => void; onBack: () => void;
}) {
  const [status, setStatus] = useState<EmbeddingsStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.getEmbeddingsStatus().then(setStatus).catch(() => setStatus(null)); }, []);

  // Semantic search can't run on this install (torch/transformers missing) — nothing to set up.
  const unavailable = status != null && !status.available;
  const downloaded = !!status?.downloaded;

  const download = async () => {
    setDownloading(true); setErr(null);
    try {
      const next = await api.downloadEmbeddings();
      setStatus(next);
      if (next.error) setErr(next.error);
    } catch (e) { setErr(String(e)); } finally { setDownloading(false); }
  };

  // Continue only advances once the model is genuinely ready (downloaded now or on a prior run),
  // or when there's nothing to download on this install. It never starts the download itself —
  // the user taps Download and waits, or taps Skip to move on without semantic search. While the
  // fetch is in flight, both Continue and Skip are held so the choice is settled before leaving.
  const canContinue = unavailable || downloaded;

  return (
    <>
      <StepHead
        title="Set up knowledge search"
        hint={unavailable
          ? 'Semantic search isn’t available on this install, so your notes are searched by keyword. You can carry on.'
          : 'Your notes are always searchable by keyword. Download the search model to also find them by meaning — “what did I decide about pricing?” matches even without the exact words. It runs on your machine.'}
      />

      {!unavailable && (
        <div className="mt-6">
          <button
            type="button"
            onClick={download}
            disabled={downloading || downloaded}
            className={`w-full flex items-center justify-between text-left p-3.5 rounded-[10px] border transition-colors ${
              downloaded ? 'border-accent bg-accent-soft/40' : 'border-border bg-bg hover:border-ink3'} disabled:cursor-default`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <BookOpen size={17} className={downloaded ? 'text-accent' : 'text-ink3'} />
              <div className="min-w-0">
                <div className={`text-[13px] ${downloaded ? 'font-600 text-accent-ink' : 'font-550 text-ink'}`}>
                  Semantic search model
                </div>
                <div className="text-[11.5px] text-ink3 font-mono mt-0.5">
                  ~90 MB{downloaded ? ' · ready' : downloading ? ' · downloading…' : ''}
                </div>
              </div>
            </div>
            <span className="flex-none ml-3 text-ink3">
              {downloading ? <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-accent/30 border-t-accent an-spin" />
                : downloaded ? <Check size={16} className="text-accent" />
                : <Download size={15} />}
            </span>
          </button>
          {downloading && (
            <p className="text-[11.5px] text-ink3 mt-3">
              Downloading… this finishes before you continue.
            </p>
          )}
          {err && <p className="text-[11.5px] text-ink3 mt-3">{err}</p>}
        </div>
      )}

      <StepNav
        onNext={onNext}
        onSkip={onSkip}
        onBack={onBack}
        nextLabel="Continue"
        disabled={!canContinue}
        skipDisabled={downloading}
      />
    </>
  );
}
