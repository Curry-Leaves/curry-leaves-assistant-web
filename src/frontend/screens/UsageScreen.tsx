import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/chrome/Icon';
import { BetaTag } from '../components/chrome/BetaTag';
import { api } from '../api/client';
import type { Agent, UsageSummary, UsageRow } from '../types';

const fmtN = (n: number) => n.toLocaleString();
const fmtK = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const fmtUsd = (n: number) => (n >= 0.01 || n === 0 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

const RANGES: { label: string; days?: number }[] = [
  { label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }, { label: 'All' },
];

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex-1 rounded-[12px] border border-border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-ink3 font-600">{label}</div>
      <div className="text-[22px] text-ink font-serif mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-ink3 mt-0.5">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows, total }: { title: string; rows: UsageRow[]; total: number }) {
  return (
    <div className="rounded-[12px] border border-border bg-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border text-[12.5px] font-600 text-ink">{title}</div>
      <div className="flex flex-col">
        {rows.length === 0 && <div className="px-4 py-6 text-[12px] text-ink3 text-center">No usage.</div>}
        {rows.map((r) => {
          const t = r.tokensIn + r.tokensOut;
          const pct = total > 0 ? (t / total) * 100 : 0;
          return (
            <div key={r.key} className="px-4 py-2 border-b border-border-soft last:border-0">
              <div className="flex items-center gap-2 text-[12.5px]">
                <span className="flex-1 truncate text-ink2 font-mono">{r.key}</span>
                <span className="text-ink3 font-mono text-[11px]">{r.calls} calls</span>
                <span className="text-ink font-mono w-[80px] text-right">{fmtK(t)} tok</span>
                <span className="text-accent-dark font-mono w-[64px] text-right">{fmtUsd(r.costUsd)}</span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1.5 rounded-full bg-bg overflow-hidden">
                  <div className="h-full rounded-full bg-accent/70" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-ink3 font-mono w-[120px] text-right">{fmtK(r.tokensIn)} in · {fmtK(r.tokensOut)} out</span>
              </div>
              {!!((r.cacheRead ?? 0) + (r.cacheWrite ?? 0)) && (
                <div className="text-[10px] text-ink3/70 font-mono text-right mt-0.5">
                  cache: {fmtK(r.cacheRead ?? 0)} read · {fmtK(r.cacheWrite ?? 0)} write
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const UsageScreen = memo(function UsageScreen() {
  const [days, setDays] = useState<number | undefined>(30);
  const [data, setData] = useState<UsageSummary | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const load = useCallback(() => { api.getUsage(days).then(setData).catch(() => setData(null)); }, [days]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.listAgents().then(setAgents).catch(() => {}); }, []);

  // Ledger rows key assistants by id ("kb-maintainer") — show their team names instead.
  const byAssistant = useMemo(() => {
    const name = new Map(agents.map((a) => [a.id, a.name]));
    return (data?.byAgent ?? []).map((r) => ({ ...r, key: name.get(r.key) ?? r.key }));
  }, [data, agents]);

  const t = data?.total;
  const totalTok = (t?.tokensIn ?? 0) + (t?.tokensOut ?? 0);
  const cacheTok = (t?.cacheRead ?? 0) + (t?.cacheWrite ?? 0);
  const maxDay = Math.max(1, ...(data?.byDay ?? []).map((d) => d.tokensIn + d.tokensOut));

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      <div className="w-full px-8 py-6 flex flex-col gap-5">
        {/* header */}
        <div className="flex items-center gap-3">
          <h1 className="font-serif italic text-[24px] text-ink">Token usage</h1>
          <BetaTag />
          <div className="flex-1" />
          <div className="flex gap-1 bg-sidebar border border-sidebar-border rounded-[7px] p-0.5">
            {RANGES.map((r) => (
              <button key={r.label} type="button" onClick={() => setDays(r.days)}
                className={`px-2.5 py-1 rounded-[5px] text-[12px] ${days === r.days ? 'bg-card text-ink shadow-soft' : 'text-sidebar-ink3'}`}>{r.label}</button>
            ))}
          </div>
          <button type="button" onClick={load} title="Refresh" className="w-7 h-7 grid place-items-center rounded-[7px] border border-border text-ink3 hover:border-ink3"><Icon name="refresh" size={13} /></button>
        </div>

        {/* totals */}
        <div className="flex gap-3">
          <Stat label="Total tokens" value={fmtK(totalTok)} sub={`${fmtN(t?.tokensIn ?? 0)} in · ${fmtN(t?.tokensOut ?? 0)} out`} />
          {cacheTok > 0 && (
            <Stat label="Cache tokens" value={fmtK(cacheTok)} sub={`${fmtN(t?.cacheRead ?? 0)} read · ${fmtN(t?.cacheWrite ?? 0)} write`} />
          )}
          <Stat label="Model calls" value={fmtN(t?.calls ?? 0)} />
          <Stat label="Est. cost" value={fmtUsd(t?.costUsd ?? 0)} sub="rough list-price estimate" />
        </div>

        {/* by day */}
        {data && data.byDay.length > 0 && (
          <div className="rounded-[12px] border border-border bg-card p-4">
            <div className="text-[12.5px] font-600 text-ink mb-3">By day</div>
            <div className="flex gap-1.5 h-[220px]">
              {data.byDay.map((d, i) => {
                const tk = d.tokensIn + d.tokensOut;
                const height = tk > 0 ? Math.max(2, (tk / maxDay) * 100) : 0;
                const n = data.byDay.length;
                const showLabel = n <= 14 || i % Math.ceil(n / 14) === 0 || i === n - 1;
                return (
                  <div key={d.key} className="flex-1 h-full flex flex-col gap-1 group min-w-0" title={`${d.key}: ${fmtN(tk)} tok · ${fmtUsd(d.costUsd)}`}>
                    <div className="w-full flex-1 flex items-end">
                      <div className="w-full bg-accent/70 rounded-t group-hover:bg-accent transition-colors" style={{ height: `${height}%`, minHeight: tk > 0 ? 2 : 1 }} />
                    </div>
                    <span className="text-[9px] text-ink3 font-mono truncate w-full text-center">{showLabel ? d.key.slice(5) : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* breakdowns */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          <Breakdown title="By model" rows={data?.byModel ?? []} total={totalTok} />
          <Breakdown title="By assistant" rows={byAssistant} total={totalTok} />
          <Breakdown title="By surface" rows={data?.bySurface ?? []} total={totalTok} />
        </div>

        <div className="text-[11px] text-ink3">
          Recorded from every model call (chat, agent runs, sub-agents, background edits) into a durable ledger — independent of trace pruning, so totals are complete.
        </div>
      </div>
    </div>
  );
});
