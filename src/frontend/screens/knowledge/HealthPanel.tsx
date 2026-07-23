import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/chrome/Icon';
import { api } from '../../api/client';
import { useEvents } from '../../hooks/useEvents';
import { useGardenerRun, GardenerLog } from './GardenerPanel';
import type { KnowledgeHealthReport } from '../../types';

const EMPTY: KnowledgeHealthReport = {
  counts: { notes: 0, tags: 0 },
  broken_links: [], orphans: [], missing_type: [], missing_description: [], missing_tags: [], singleton_tags: [],
};

// One issue group: a titled card with a count pill, a one-line hint, and its rows.
// Hidden entirely when the group is empty so the page only shows real problems.
function Section({ title, hint, count, tone = 'warn', children }: {
  title: string; hint: string; count: number; tone?: 'warn' | 'error'; children: React.ReactNode;
}) {
  if (count === 0) return null;
  const pill = tone === 'error'
    ? 'border-rec/40 bg-rec/10 text-rec'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-700';
  return (
    <section className="rounded-[11px] border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border-soft">
        <span className="text-[12px] font-600 text-ink">{title}</span>
        <span className={`text-[10.5px] tabular-nums px-1.5 py-0.5 rounded-full border ${pill}`}>{count}</span>
        <span className="flex-1" />
        <span className="text-[11px] text-ink3 truncate">{hint}</span>
      </div>
      <div className="flex flex-col gap-1 p-2">{children}</div>
    </section>
  );
}

function PathRow({ path, detail, onOpen }: { path: string; detail?: string; onOpen: (p: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(path)}
      className="group flex items-center gap-2 text-left px-2.5 py-1.5 rounded-[7px] hover:bg-border-soft text-[12px]">
      <Icon name="file" size={12} color="var(--color-ink3)" />
      <span className="font-mono text-[11px] text-ink2 truncate">{path}</span>
      {detail && <span className="text-ink3 text-[11px] flex-none">{detail}</span>}
      <span className="flex-1" />
      <span className="text-ink3 opacity-0 group-hover:opacity-100 flex-none"><Icon name="chevR" size={12} /></span>
    </button>
  );
}

// A single summary stat tile.
function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex-1 rounded-[10px] border border-border bg-card px-3.5 py-2.5">
      <div className="text-[19px] font-600 text-ink tabular-nums leading-none">{value}</div>
      <div className="text-[10.5px] uppercase tracking-wider text-ink3 mt-1">{label}</div>
    </div>
  );
}

// KB health sweep + maintenance. The sweep (broken links, orphans, missing frontmatter,
// tag drift) is read-only and recomputed on every load/refresh. The Gardener — the
// maintenance action that repairs some of these and compacts oversized notes — lives at
// the top of this page and streams its progress inline (no modal).
export function HealthPanel({ onOpen }: { onOpen: (path: string) => void }) {
  const [report, setReport] = useState<KnowledgeHealthReport>(EMPTY);
  const [loading, setLoading] = useState(true);
  const gardener = useGardenerRun(false);

  const load = useCallback(() => {
    api.getKnowledgeHealth().then(setReport).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEvents((raw) => {
    const t = (raw as { type?: string }).type || '';
    if (t.startsWith('knowledge.') || t.startsWith('agent.run.')) load();
  });

  const issueCount = report.broken_links.length + report.orphans.length + report.missing_type.length
    + report.missing_description.length + report.missing_tags.length + report.singleton_tags.length;
  const clean = !loading && issueCount === 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
      <div className="max-w-[760px] mx-auto flex flex-col gap-4">

        {/* summary — stat tiles + overall status */}
        <div className="flex items-stretch gap-2.5">
          <Stat label="Notes" value={report.counts.notes} />
          <Stat label="Tags" value={report.counts.tags} />
          <div className={`flex-1 rounded-[10px] border px-3.5 py-2.5 flex flex-col justify-center ${
            clean ? 'border-green-600/30 bg-green-600/5' : issueCount > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-border bg-card'}`}>
            {loading ? (
              <div className="text-[12px] text-ink3">Checking…</div>
            ) : clean ? (
              <div className="flex items-center gap-1.5 text-[13px] text-green-700 font-550">
                <Icon name="check" size={14} />Healthy
              </div>
            ) : (
              <>
                <div className="text-[19px] font-600 text-amber-700 tabular-nums leading-none">{issueCount}</div>
                <div className="text-[10.5px] uppercase tracking-wider text-ink3 mt-1">Issue{issueCount === 1 ? '' : 's'} to review</div>
              </>
            )}
          </div>
        </div>

        {/* maintenance — Gardener run + inline progress */}
        <section className="rounded-[11px] border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <span className={`grid place-items-center w-8 h-8 rounded-[9px] border border-border bg-bg/40 flex-none ${gardener.running ? 'animate-spin' : ''}`}>
              <Icon name="leaf" size={15} color="var(--color-accent)" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-600 text-ink">Gardener</div>
              <div className="text-[11.5px] text-ink3">Repairs links, backfills frontmatter, and compacts oversized notes.</div>
            </div>
            <button type="button" onClick={gardener.start} disabled={gardener.running}
              className="flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-accent text-on-accent text-[12.5px] font-550 hover:opacity-90 disabled:opacity-50">
              <Icon name="leaf" size={13} />{gardener.running ? 'Running…' : 'Run Gardener'}
            </button>
          </div>
          {gardener.lines.length > 0 && (
            <div className="px-3.5 pb-3 pt-1 border-t border-border-soft">
              <GardenerLog lines={gardener.lines} />
            </div>
          )}
        </section>

        {/* issues */}
        {loading && <div className="text-center text-[12px] text-ink3 py-12">Checking…</div>}

        {clean && (
          <div className="rounded-[11px] border border-border bg-card px-4 py-10 text-center flex flex-col items-center gap-2">
            <Icon name="check" size={22} color="var(--color-ok)" />
            <div className="text-[13px] text-ink font-550">Everything looks clean</div>
            <div className="text-[11.5px] text-ink3 max-w-[42ch]">No broken links, orphans, or missing frontmatter. New issues surface here as the base grows.</div>
          </div>
        )}

        {!loading && issueCount > 0 && (
          <div className="flex flex-col gap-3">
            <Section title="Broken links" hint="the target note doesn't exist" count={report.broken_links.length} tone="error">
              {report.broken_links.map((b, i) => (
                <PathRow key={i} path={b.from} detail={`→ ${b.target}`} onOpen={onOpen} />
              ))}
            </Section>

            <Section title="Orphans" hint="no other note links here" count={report.orphans.length}>
              {report.orphans.map((p) => <PathRow key={p} path={p} onOpen={onOpen} />)}
            </Section>

            <Section title="Missing type" hint="frontmatter needs a type" count={report.missing_type.length}>
              {report.missing_type.map((p) => <PathRow key={p} path={p} onOpen={onOpen} />)}
            </Section>

            <Section title="Missing description" hint="no one-sentence summary" count={report.missing_description.length}>
              {report.missing_description.map((p) => <PathRow key={p} path={p} onOpen={onOpen} />)}
            </Section>

            <Section title="Missing tags" hint="no tags set" count={report.missing_tags.length}>
              {report.missing_tags.map((p) => <PathRow key={p} path={p} onOpen={onOpen} />)}
            </Section>

            <Section title="Singleton tags" hint="used once — possible drift or typo" count={report.singleton_tags.length}>
              <div className="flex flex-wrap gap-1.5 p-1">
                {report.singleton_tags.map((t) => (
                  <span key={t} className="px-2 py-1 rounded-[6px] border border-border bg-bg/40 text-[11.5px] text-ink2 font-mono">{t}</span>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}
