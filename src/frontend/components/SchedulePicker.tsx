// One schedule-authoring control, shared by assistant Hours and dashboard tiles. Presents a
// small set of human presets (Never / Daily / Weekdays / Weekly / Every N / Cron) and emits a
// ScheduleSpec (types/schedule.ts) — the same shape the backend scheduler consumes.
import { useState } from 'react';
import {
  type ScheduleSpec, type SchedulePreset,
  cronDaily, cronWeekdays, cronWeekly, everyInterval,
  presetOf, timeOf, dowOf, describe, WEEKDAY_LABELS, NO_SCHEDULE,
} from '../types/schedule';

const INPUT = 'h-[30px] px-2 rounded-[6px] border border-border bg-card text-ink text-[12.5px] outline-none';
const PRESETS: { key: SchedulePreset; label: string }[] = [
  { key: 'none', label: 'Never' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekdays', label: 'Weekdays' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'every', label: 'Every…' },
  { key: 'custom', label: 'Cron' },
];

export function SchedulePicker({ value, onChange }: { value: ScheduleSpec; onChange: (s: ScheduleSpec) => void }) {
  const preset = presetOf(value);
  // Local scratch for the sub-controls so switching presets keeps the last time/day/interval.
  const [time, setTime] = useState(() => timeOf(value));
  const [dow, setDow] = useState(() => dowOf(value));
  const [everyCount, setEveryCount] = useState(() => (value.kind === 'every' ? intervalCount(value) : 6));
  const [everyUnit, setEveryUnit] = useState<'minutes' | 'hours' | 'days'>(() => (value.kind === 'every' ? intervalUnit(value) : 'hours'));
  const [cronExpr, setCronExpr] = useState(() => (value.kind === 'cron' && preset === 'custom' ? value.expr : '0 9 * * *'));

  function pick(p: SchedulePreset) {
    if (p === 'none') onChange(NO_SCHEDULE);
    else if (p === 'daily') onChange(cronDaily(time));
    else if (p === 'weekdays') onChange(cronWeekdays(time));
    else if (p === 'weekly') onChange(cronWeekly(time, dow));
    else if (p === 'every') onChange(everyInterval(everyCount, everyUnit));
    else onChange({ kind: 'cron', expr: cronExpr });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => pick(p.key)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] border ${preset === p.key ? 'bg-accent-soft border-accent-soft text-accent-ink' : 'border-border text-ink2 hover:border-ink3'}`}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(preset === 'daily' || preset === 'weekdays' || preset === 'weekly') && (
          <input type="time" value={time} title="Time of day" className={INPUT}
            onChange={(e) => { setTime(e.target.value); onChange(rebuildAtTime(preset, e.target.value, dow)); }} />
        )}
        {preset === 'weekly' && (
          <select value={dow} title="Day of week" className={`${INPUT} cursor-pointer`}
            onChange={(e) => { const d = Number(e.target.value); setDow(d); onChange(cronWeekly(time, d)); }}>
            {WEEKDAY_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        )}
        {preset === 'every' && (
          <>
            <span className="text-[12px] text-ink3">every</span>
            <input type="number" min={1} value={everyCount} title="Interval count" className={`${INPUT} w-[64px]`}
              onChange={(e) => { const n = Math.max(1, Number(e.target.value) || 1); setEveryCount(n); onChange(everyInterval(n, everyUnit)); }} />
            <select value={everyUnit} title="Interval unit" className={`${INPUT} cursor-pointer`}
              onChange={(e) => { const u = e.target.value as 'minutes' | 'hours' | 'days'; setEveryUnit(u); onChange(everyInterval(everyCount, u)); }}>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </>
        )}
        {preset === 'custom' && (
          <input type="text" value={cronExpr} title="5-field cron expression (min hour dom month dow)" placeholder="0 9 * * 1-5"
            className={`${INPUT} font-mono w-[160px]`}
            onChange={(e) => { setCronExpr(e.target.value); onChange({ kind: 'cron', expr: e.target.value }); }} />
        )}
      </div>

      <div className="text-[11px] text-ink3">{describe(value)}</div>
    </div>
  );
}

function rebuildAtTime(preset: SchedulePreset, time: string, dow: number): ScheduleSpec {
  if (preset === 'daily') return cronDaily(time);
  if (preset === 'weekdays') return cronWeekdays(time);
  return cronWeekly(time, dow);
}

function intervalCount(spec: Extract<ScheduleSpec, { kind: 'every' }>): number {
  const ms = spec.every_ms;
  if (ms % 86_400_000 === 0) return ms / 86_400_000;
  if (ms % 3_600_000 === 0) return ms / 3_600_000;
  return Math.round(ms / 60_000);
}

function intervalUnit(spec: Extract<ScheduleSpec, { kind: 'every' }>): 'minutes' | 'hours' | 'days' {
  const ms = spec.every_ms;
  if (ms % 86_400_000 === 0) return 'days';
  if (ms % 3_600_000 === 0) return 'hours';
  return 'minutes';
}
