import { useEffect, useState } from 'react';
import { Check, Download, Volume2 } from 'lucide-react';
import { downloadTts, getWakeWord, patchWakeWord, type WakeWordConfig } from '../../../api/wakeword';
import { StepHead, StepNav } from '../SetupWizard';

/**
 * Voice step — only shown when the user picked "voice" in the usage step (SetupWizard gates
 * it), so nobody who doesn't want spoken replies is asked to pull ~300 MB of TTS weights.
 *
 * Like the transcription step, the download does NOT block Continue: it's hundreds of
 * megabytes, and holding the wizard hostage to a slow network is worse than letting it finish
 * and having the model land in the background. Continue turns "speak the answer" on so the
 * choice actually takes effect; Skip leaves voice off (it can still be enabled later in
 * Settings → Wake Word, which offers the same download).
 */
export function VoiceStep({ onNext, onSkip, onBack }: {
  onNext: () => void; onSkip: () => void; onBack: () => void;
}) {
  const [cfg, setCfg] = useState<WakeWordConfig | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getWakeWord().then(setCfg).catch(() => setCfg(null)); }, []);

  // TTS package missing on this install — nothing to set up, so let the user move straight on.
  const unavailable = cfg != null && !cfg.ttsAvailable;
  const downloaded = !!cfg?.ttsDownloaded;

  const download = async () => {
    setDownloading(true); setErr(null);
    try {
      const next = await downloadTts();
      setCfg(next);
      if (next.error) setErr(next.error);
    } catch (e) { setErr(String(e)); } finally { setDownloading(false); }
  };

  // Continue only advances once the voice model is ready (downloaded now or on a prior run), or
  // when TTS isn't available on this install. It never starts the download itself — the user taps
  // Download and waits, or taps Skip to move on silent. While the fetch is in flight, both
  // Continue and Skip are held so the choice is settled before leaving.
  const canContinue = unavailable || downloaded;

  // Leaving via Continue with a downloaded model means the user wants voice — turn on spoken
  // replies so it's live. (Skip leaves `speak` untouched: no model, no spoken answers.)
  const continueWith = () => {
    if (downloaded) patchWakeWord({ speak: true }).catch(() => {});
    onNext();
  };

  return (
    <>
      <StepHead
        title="Set up voice"
        hint={unavailable
          ? 'Text-to-speech isn’t available on this install, so answers will be shown but not spoken. You can carry on.'
          : 'You said you’d like spoken replies. The voice runs on your machine — nothing is uploaded. Download the voice model to hear answers read aloud. Continue downloads it for you.'}
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
              <Volume2 size={17} className={downloaded ? 'text-accent' : 'text-ink3'} />
              <div className="min-w-0">
                <div className={`text-[13px] ${downloaded ? 'font-600 text-accent-ink' : 'font-550 text-ink'}`}>
                  Natural voice (Kokoro)
                </div>
                <div className="text-[11.5px] text-ink3 font-mono mt-0.5">
                  ~300 MB{downloaded ? ' · ready' : downloading ? ' · downloading…' : ''}
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
        onNext={continueWith}
        onSkip={onSkip}
        onBack={onBack}
        nextLabel="Continue"
        disabled={!canContinue}
        skipDisabled={downloading}
      />
    </>
  );
}
