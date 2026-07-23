import { useEffect, useState } from 'react';
import { SGroup, SField, SToggle, SSelect, Value } from './primitives';
import {
  downloadWakeWord, getWakeWord, patchWakeWord,
  type WakeWordConfig, type WakeWordPatch,
} from '../../api/wakeword';

export function WakeWord() {
  const [cfg, setCfg] = useState<WakeWordConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { getWakeWord().then(setCfg).catch((e) => setErr(String(e))); }, []);

  const save = async (patch: Partial<WakeWordPatch>) => {
    setErr(null);
    try { setCfg(await patchWakeWord(patch)); } catch (e) { setErr(String(e)); }
  };

  const download = async () => {
    setBusy(true); setErr(null);
    try {
      const next = await downloadWakeWord(cfg?.active);
      setCfg(next);
      if (next.error) setErr(next.error);
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  if (!cfg) return <SGroup><Value>{err ?? 'Loading…'}</Value></SGroup>;

  const ready = cfg.available;

  return (
    <>
      <SGroup title="Wake word">
        <SField
          label="Listen for a wake word"
          hint="Say the wake word to start a hands-free voice chat. Detection runs entirely on this device — audio is never uploaded. While this is on the microphone stays open, so your system's mic indicator will stay lit."
        >
          <div className="flex items-center gap-3">
            <SToggle value={cfg.enabled} onChange={(v) => save({ enabled: v })} />
            {!ready && <Value>Download the models first</Value>}
          </div>
        </SField>

        <SField label="Wake phrase" hint="Which phrase to listen for.">
          <SSelect
            value={cfg.active}
            onChange={(v) => save({ active: v })}
            title="Wake phrase"
            options={cfg.heads.map((h) => ({
              value: h.id,
              label: h.downloaded ? h.label : `${h.label} (not downloaded)`,
            }))}
          />
        </SField>

        <SField
          label="Sensitivity"
          hint="How confident detection must be before it triggers, for models that don't ship their own thresholds. The built-in model tunes each phrase itself, so this has no effect on it."
        >
          <SSelect
            value={String(cfg.threshold)}
            onChange={(v) => save({ threshold: Number(v) })}
            title="Sensitivity"
            options={[
              { value: '0.3', label: 'Sensitive (0.3)' },
              { value: '0.5', label: 'Balanced (0.5)' },
              { value: '0.7', label: 'Strict (0.7)' },
              { value: '0.9', label: 'Very strict (0.9)' },
            ]}
          />
        </SField>

        <SField label="Model" hint="About 3 MB, downloaded once and kept on this device.">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={download}
              disabled={busy}
              className="h-[30px] px-3 rounded-[6px] border border-border bg-bg text-ink text-[12.5px] hover:bg-border-soft disabled:opacity-50"
            >
              {busy ? 'Downloading…' : ready ? 'Re-download' : 'Download'}
            </button>
            <Value>{ready ? 'Ready' : 'Not downloaded'}</Value>
          </div>
        </SField>

        {err && <SField label=""><Value>{err}</Value></SField>}
      </SGroup>

      <SGroup title="The answer">
        <SField
          label="Speak the answer"
          hint={cfg.ttsAvailable
            ? 'Read the answer out loud. Turn this off to get a silent answer you read in the panel instead.'
            : 'Text-to-speech is unavailable on this install, so answers are shown but not spoken.'}
        >
          <div className="flex items-center gap-3">
            <SToggle
              value={cfg.speak && cfg.ttsAvailable}
              onChange={(v) => save({ speak: v })}
            />
            {!cfg.ttsAvailable && <Value>Unavailable</Value>}
          </div>
        </SField>

        {cfg.speak && cfg.ttsAvailable && cfg.voices.length > 0 && (
          <SField label="Voice" hint="Which voice reads the answer.">
            <SSelect
              value={cfg.voice || cfg.defaultVoice}
              onChange={(v) => save({ voice: v })}
              title="Voice"
              options={cfg.voices.map((v) => ({
                value: v,
                label: v === cfg.defaultVoice ? `${v} (default)` : v,
              }))}
              minWidth={200}
            />
          </SField>
        )}

        <SField
          label="Hide the answer automatically"
          hint="Dismiss the answer panel on its own once it finishes. Turn this off to keep the answer on screen until you close it."
        >
          <SToggle value={cfg.autoDismiss} onChange={(v) => save({ autoDismiss: v })} />
        </SField>

        {cfg.autoDismiss && (
          <SField label="Hide after" hint="How long the finished answer stays on screen.">
            <SSelect
              value={String(cfg.dismissAfterMs)}
              onChange={(v) => save({ dismissAfterMs: Number(v) })}
              title="Hide after"
              options={[
                { value: '0', label: 'Immediately' },
                { value: '3000', label: '3 seconds' },
                { value: '6000', label: '6 seconds' },
                { value: '15000', label: '15 seconds' },
                { value: '60000', label: '1 minute' },
              ]}
            />
          </SField>
        )}

        <SField
          label="Pause before sending"
          hint="How long a silence ends your question. Raise it if it cuts you off mid-sentence; lower it if it feels slow to respond."
        >
          <SSelect
            value={String(cfg.silenceMs)}
            onChange={(v) => save({ silenceMs: Number(v) })}
            title="Pause before sending"
            options={[
              { value: '800', label: 'Short (0.8s)' },
              { value: '1200', label: 'Normal (1.2s)' },
              { value: '2000', label: 'Relaxed (2s)' },
              { value: '3000', label: 'Long (3s)' },
            ]}
          />
        </SField>

        <SField
          label="Before queueing work"
          hint="When a spoken request is a job rather than a question — build a dashboard, research something — it goes to your team to run in the background. This is whether it checks with you out loud first."
        >
          <SSelect
            value={cfg.workApproval}
            onChange={(v) => save({ workApproval: v as 'confirm' | 'auto' })}
            title="Before queueing work"
            options={[
              { value: 'confirm', label: 'Ask me out loud' },
              { value: 'auto', label: 'Just queue it' },
            ]}
            minWidth={160}
          />
        </SField>
      </SGroup>

      <SGroup title="Your own wake word">
        <SField label="Custom model" hint="Drop a fused openWakeWord .onnx (plus its .onnx.json) into the models folder and it appears in the list above — no reinstall needed.">
          <Value mono>~/.curry-leaves/models/wakeword/</Value>
        </SField>
      </SGroup>
    </>
  );
}
