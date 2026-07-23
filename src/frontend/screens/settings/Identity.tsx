import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { IdentityCfg } from '../../types';
import { SHeader, SGroup, SField, SInput, STextarea } from './primitives';

const EMPTY: IdentityCfg = { name: '', work: '', behavior: '', workingHours: '', usage: [] };

// ─── identity: who's operating the app, so agents & recordings can refer to them ──
export function Identity() {
  const [id, setId] = useState<IdentityCfg>(EMPTY);
  const [saved, setSaved] = useState(true);

  useEffect(() => { api.getSettings().then((s) => setId(s.identity ?? EMPTY)).catch(() => {}); }, []);

  const set = (patch: Partial<IdentityCfg>) => { setId((prev) => ({ ...prev, ...patch })); setSaved(false); };
  const save = () => { api.patchIdentity(id).then(() => setSaved(true)).catch(() => {}); };

  return (
    <>
      <SHeader title="Identity" subtitle="Who's using Curry Leaves. Your name is used in recordings and summaries; the rest helps agents tailor their behavior to you." />
      <div className="overflow-y-auto">
        <SGroup title="About you">
          <SField label="Name" hint="Used in place of “you” in recording transcripts, summaries, and anywhere agents refer to you.">
            <SInput value={id.name} onChange={(v) => set({ name: v })} onBlur={save} placeholder="e.g. Ilayanambi" />
          </SField>
          <SField label="Work" hint="Your role, team, or company — gives agents context when summarizing or drafting on your behalf.">
            <SInput value={id.work} onChange={(v) => set({ work: v })} onBlur={save} placeholder="e.g. Engineering lead at Acme" />
          </SField>
          <SField label="Working hours" hint="When you're typically available. Agents can use this to judge urgency or timing.">
            <SInput value={id.workingHours} onChange={(v) => set({ workingHours: v })} onBlur={save} placeholder="e.g. 9am–6pm IST, Mon–Fri" />
          </SField>
        </SGroup>
        <SGroup title="How Curry Leaves should behave">
          <SField label="Instructions" hint="Free-form notes on tone, priorities, or habits agents should follow when working with you — e.g. “keep summaries terse” or “flag anything mentioning budget.”">
            <STextarea
              value={id.behavior}
              onChange={(v) => set({ behavior: v })}
              onBlur={save}
              placeholder="e.g. Keep summaries short and action-oriented. I prefer bullet points over prose."
              saved={saved}
            />
          </SField>
        </SGroup>
      </div>
    </>
  );
}
