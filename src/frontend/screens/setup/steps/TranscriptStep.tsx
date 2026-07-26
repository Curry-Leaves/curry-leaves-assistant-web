import { useEffect, useMemo, useState } from 'react';
import { Check, Download } from 'lucide-react';
import { api } from '../../../api/client';
import type { WhisperModelInfo } from '../../../types';
import { StepHead, StepNav } from '../SetupWizard';

/** Meetings are long-form and worth the bigger model; everything else does fine on `small`. */
const recommendedFor = (usage: string[]) => (usage.includes('meetings') ? 'medium' : 'small');

/**
 * Step 4 — the transcription model. The backend (MLX on Apple Silicon, faster-whisper
 * elsewhere) is already auto-picked in settings, so this only offers models for the active
 * one and marks a recommendation based on the step-2 usage picks.
 *
 * The download deliberately does NOT block Continue: these are hundreds of megabytes, and
 * holding a first-run wizard hostage to a slow network is worse than letting it finish and
 * having Capture's existing "model not ready" banner pick up the slack. We kick the download
 * off, poll for completion, and let the user move on whenever they like.
 */
export function TranscriptStep({ usage, onNext, onSkip, onBack }: {
  usage: string[]; onNext: () => void; onSkip: () => void; onBack: () => void;
}) {
  const [models, setModels] = useState<WhisperModelInfo[]>([]);
  const [backend, setBackend] = useState('');
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = () => api.listModels()
    .then((r) => {
      setModels(r.models);
      setBackend((b) => b || r.models.find((m) => m.active)?.backend || r.models[0]?.backend || '');
    })
    .catch(() => {});
  useEffect(() => { load(); }, []);

  // While a download runs, poll so the row flips to "downloaded" on its own.
  useEffect(() => {
    if (!downloading) return;
    const id = setInterval(() => {
      api.listModels().then((r) => {
        setModels(r.models);
        if (r.models.some((m) => `${m.backend}/${m.name}` === downloading && m.downloaded)) {
          setDownloading(null);
        }
      }).catch(() => {});
    }, 1500);
    return () => clearInterval(id);
  }, [downloading]);

  const recommended = recommendedFor(usage);
  const list = useMemo(() => models.filter((m) => m.backend === backend), [models, backend]);
  // Continue only advances once a model is genuinely ON DISK — a download still in flight doesn't
  // count. No models available at all (unusual) also lets Continue through, since there's nothing
  // to download. While a download runs, both Continue and Skip are held so the choice is settled
  // before leaving. `pick()` starts the download on tap; Continue never triggers one itself.
  const canContinue = !list.length || list.some((m) => m.downloaded);

  const pick = async (m: WhisperModelInfo) => {
    const key = `${m.backend}/${m.name}`;
    // Make it the active model right away — even mid-download, so the choice sticks.
    api.selectModel({ backend: m.backend, model: m.name }).then((r) => setModels(r.models)).catch(() => {});
    if (m.downloaded) return;
    setDownloading(key);
    try { const r = await api.downloadModel(m.name, m.backend); setModels(r.models); } catch { /* keep going */ }
    setDownloading((d) => (d === key ? null : d));
  };

  return (
    <>
      <StepHead
        title="Set up transcription"
        hint="Recordings are transcribed on your machine — nothing is uploaded. Pick a model to download; bigger is more accurate but slower. Skip to set this up later."
      />
      <div className="mt-6 flex flex-col gap-2 max-h-[250px] overflow-y-auto pr-1">
        {list.map((m) => {
          const key = `${m.backend}/${m.name}`;
          const busy = downloading === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => pick(m)}
              disabled={busy}
              className={`flex items-center justify-between text-left p-3 rounded-[10px] border transition-colors ${
                m.active ? 'border-accent bg-accent-soft/40' : 'border-border bg-bg hover:border-ink3'}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[13px] ${m.active ? 'font-600 text-accent-ink' : 'font-550 text-ink'}`}>{m.name}</span>
                  {m.name === recommended && (
                    <span className="text-[10px] font-600 text-accent-ink bg-accent-soft px-1.5 py-0.5 rounded-full">recommended</span>
                  )}
                </div>
                <div className="text-[11.5px] text-ink3 font-mono mt-0.5">
                  {m.sizeLabel}{m.downloaded ? ' · ready' : busy ? ' · downloading…' : ''}
                </div>
              </div>
              <span className="flex-none ml-3 text-ink3">
                {busy ? <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-accent/30 border-t-accent an-spin" />
                  : m.downloaded ? <Check size={15} className={m.active ? 'text-accent' : 'text-ink3'} />
                  : <Download size={14} />}
              </span>
            </button>
          );
        })}
        {!list.length && <div className="text-[12.5px] text-ink3">No transcription models available.</div>}
      </div>
      {downloading && (
        <p className="text-[11.5px] text-ink3 mt-3">
          Downloading… this finishes before you continue.
        </p>
      )}
      <StepNav
        onNext={onNext}
        onSkip={onSkip}
        onBack={onBack}
        nextLabel="Continue"
        disabled={!canContinue}
        skipDisabled={!!downloading}
      />
    </>
  );
}
