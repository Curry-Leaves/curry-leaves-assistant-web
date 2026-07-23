// The unified schedule spec — one shape for agents, tiles, and (backend) reminders.
// Mirrors orchestration/schedule.py's ScheduleSpec tagged union. `kind` selects the shape:
//   none  — never fires.
//   at    — one-shot at an ISO-8601 instant (carried as epoch-ms `at_ms` on the wire).
//   every — recurring fixed interval `every_ms`, optionally phase-anchored at `anchor_ms`.
//   cron  — recurring 5-field cron `expr`, interpreted in the server's local time.
export type ScheduleSpec =
  | { kind: 'none' }
  | { kind: 'at'; at_ms: number }
  | { kind: 'every'; every_ms: number; anchor_ms?: number }
  | { kind: 'cron'; expr: string };

export const NO_SCHEDULE: ScheduleSpec = { kind: 'none' };

// ─── the presets the UI authors ──────────────────────────────────────────────
// Full cron is powerful but not what most people want to type. The forms offer a small set of
// human presets and translate them to a ScheduleSpec; `describe()` turns any spec back into a
// sentence so a hand-written cron still reads clearly.

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Build a daily cron at HH:MM.
export function cronDaily(time: string): ScheduleSpec {
  const [h, m] = splitTime(time);
  return { kind: 'cron', expr: `${m} ${h} * * *` };
}

// Build a weekdays-only (Mon–Fri) cron at HH:MM.
export function cronWeekdays(time: string): ScheduleSpec {
  const [h, m] = splitTime(time);
  return { kind: 'cron', expr: `${m} ${h} * * 1-5` };
}

// Build a weekly cron at HH:MM on `dow` (0=Sun .. 6=Sat — cron's own convention).
export function cronWeekly(time: string, dow: number): ScheduleSpec {
  const [h, m] = splitTime(time);
  return { kind: 'cron', expr: `${m} ${h} * * ${dow}` };
}

// Build an interval spec from a count + unit.
export function everyInterval(count: number, unit: 'minutes' | 'hours' | 'days'): ScheduleSpec {
  const ms = count * (unit === 'minutes' ? 60_000 : unit === 'hours' ? 3_600_000 : 86_400_000);
  return { kind: 'every', every_ms: Math.max(60_000, ms) };  // floor 1 min — sub-minute is a footgun
}

function splitTime(time: string): [number, number] {
  const [h, m] = (time || '09:00').split(':').map((n) => parseInt(n, 10) || 0);
  return [h, m];
}

// ─── reading a spec back ──────────────────────────────────────────────────────
// Which preset a spec matches (so a form can re-open on the right controls), or 'custom'.
export type SchedulePreset = 'none' | 'daily' | 'weekdays' | 'weekly' | 'every' | 'custom';

const CRON_DAILY = /^(\d{1,2}) (\d{1,2}) \* \* \*$/;
const CRON_WEEKDAYS = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/;
const CRON_WEEKLY = /^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/;

export function presetOf(spec: ScheduleSpec | undefined): SchedulePreset {
  if (!spec || spec.kind === 'none') return 'none';
  if (spec.kind === 'every') return 'every';
  if (spec.kind === 'at') return 'custom';
  if (spec.kind === 'cron') {
    if (CRON_WEEKDAYS.test(spec.expr)) return 'weekdays';
    if (CRON_WEEKLY.test(spec.expr)) return 'weekly';
    if (CRON_DAILY.test(spec.expr)) return 'daily';
    return 'custom';
  }
  return 'custom';
}

// Pull HH:MM back out of a daily/weekly/weekdays cron (for re-populating the time input).
export function timeOf(spec: ScheduleSpec | undefined): string {
  if (spec?.kind === 'cron') {
    const m = spec.expr.match(/^(\d{1,2}) (\d{1,2}) /);
    if (m) return `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
  }
  return '09:00';
}

// Pull the day-of-week (0–6) out of a weekly cron.
export function dowOf(spec: ScheduleSpec | undefined): number {
  const m = spec?.kind === 'cron' ? spec.expr.match(CRON_WEEKLY) : null;
  return m ? parseInt(m[3], 10) : 1;  // default Monday
}

// A human sentence for any spec — shown as a summary and for custom/cron specs.
export function describe(spec: ScheduleSpec | undefined): string {
  if (!spec || spec.kind === 'none') return 'Never';
  if (spec.kind === 'at') {
    const d = new Date(spec.at_ms);
    return `Once, at ${d.toLocaleString()}`;
  }
  if (spec.kind === 'every') {
    const ms = spec.every_ms;
    if (ms % 86_400_000 === 0) return `Every ${plural(ms / 86_400_000, 'day')}`;
    if (ms % 3_600_000 === 0) return `Every ${plural(ms / 3_600_000, 'hour')}`;
    return `Every ${plural(Math.round(ms / 60_000), 'minute')}`;
  }
  // cron
  const t = timeOf(spec);
  switch (presetOf(spec)) {
    case 'daily': return `Every day at ${t}`;
    case 'weekdays': return `Weekdays at ${t}`;
    case 'weekly': return `Every ${WEEKDAY_LABELS[dowOf(spec)]} at ${t}`;
    default: return `Cron: ${spec.expr}`;
  }
}

function plural(n: number, unit: string): string {
  return n === 1 ? `${unit}` : `${n} ${unit}s`;
}
