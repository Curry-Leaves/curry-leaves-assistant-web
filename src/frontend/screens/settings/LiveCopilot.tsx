import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { SHeader, SGroup, SField, SToggle, SSelect, Value } from './primitives';
import type { LiveCfg } from '../../types';

/** Settings → Capture → Live Copilot.
 *
 *  The copilot runs a real agent pass against the user's provider every time the transcript
 *  grows past a threshold, so it costs tokens on every recording it watches. That's why it is
 *  off by default and why the tuning here is framed as how *often* it speaks up rather than as
 *  raw thresholds — the user is really choosing a cost/attentiveness trade-off.
 *
 *  Everything here is the app-level default. Capture's own toggle overrides `enabled` for a
 *  single recording without changing any of this. */
export function LiveCopilot() {
  const [cfg, setCfg] = useState<LiveCfg | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then((s) => setCfg(s.live)).catch((e) => setErr(String(e)));
  }, []);

  // The PATCH response is the new state — same no-optimistic-update pattern as WakeWord, so a
  // clamped value (the backend floors these) shows the value that was actually saved.
  const save = async (patch: Partial<LiveCfg>) => {
    setErr(null);
    try { setCfg((await api.patchLive(patch)).live); } catch (e) { setErr(String(e)); }
  };

  if (!cfg) return <SGroup><Value>{err ?? 'Loading…'}</Value></SGroup>;

  return (
    <>
      <SHeader
        title="Live Copilot"
        subtitle="During a recording, an assistant follows the conversation and surfaces open loops, questions to ask, and answers from your knowledge base."
      />
      <div className="overflow-y-auto">
        <SGroup title="Live Copilot">
          <SField
            label="Watch meetings live"
            hint="Off by default: each suggestion is a real assistant run against your AI provider, so leaving it on spends tokens on every recording. You can also turn it on for a single meeting from the recording screen, without changing this."
          >
            <SToggle value={cfg.enabled} onChange={(v) => save({ enabled: v })} />
          </SField>

          <SField
            label="Meeting templates"
            hint="The copilot only watches for what a meeting's template asks for. A template with nothing under “live watch” stays quiet even with this on — set that up under Meeting templates."
          >
            <Value>Configured per template</Value>
          </SField>
        </SGroup>

        <SGroup title="How often it speaks up">
          <SField
            label="Suggest after"
            hint="How much new speech to hear before looking for something to surface. Longer means fewer, better-informed suggestions and less spend; shorter makes it more reactive."
          >
            <SSelect
              value={String(cfg.minNewChars)}
              onChange={(v) => save({ minNewChars: Number(v) })}
              title="Suggest after"
              options={[
                { value: '60', label: 'A sentence or two (60 chars)' },
                { value: '120', label: 'A short exchange (120 chars)' },
                { value: '300', label: 'A full point (300 chars)' },
                { value: '600', label: 'A long stretch (600 chars)' },
              ]}
              minWidth={230}
            />
          </SField>

          <SField
            label="Wait between suggestions"
            hint="The minimum gap between passes. Adding an attendee, typing a note, or pressing refresh always runs immediately regardless of this."
          >
            <SSelect
              value={String(cfg.cooldownSeconds)}
              onChange={(v) => save({ cooldownSeconds: Number(v) })}
              title="Wait between suggestions"
              options={[
                { value: '10', label: 'Frequent (10 seconds)' },
                { value: '20', label: 'Balanced (20 seconds)' },
                { value: '45', label: 'Relaxed (45 seconds)' },
                { value: '120', label: 'Sparse (2 minutes)' },
              ]}
              minWidth={230}
            />
          </SField>

          <SField
            label="Suggestions at a time"
            hint="How many cards one pass may surface. Two keeps the rail readable during a fast conversation."
          >
            <SSelect
              value={String(cfg.maxCardsPerPass)}
              onChange={(v) => save({ maxCardsPerPass: Number(v) })}
              title="Suggestions at a time"
              options={[
                { value: '1', label: '1 card' },
                { value: '2', label: '2 cards' },
                { value: '3', label: '3 cards' },
              ]}
              minWidth={140}
            />
          </SField>

          <SField
            label="Stop after"
            hint="A safety cap on how many times the copilot runs in a single recording, so one very long meeting can't run up an unbounded bill."
          >
            <SSelect
              value={String(cfg.maxPasses)}
              onChange={(v) => save({ maxPasses: Number(v) })}
              title="Stop after"
              options={[
                { value: '20', label: '20 suggestions' },
                { value: '50', label: '50 suggestions' },
                { value: '100', label: '100 suggestions' },
                { value: '500', label: '500 suggestions' },
              ]}
              minWidth={180}
            />
          </SField>

          {err && <SField label=""><Value>{err}</Value></SField>}
        </SGroup>
      </div>
    </>
  );
}
