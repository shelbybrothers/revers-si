// Market clock helpers (America/New_York). Same session rules as the guard (regular 09:30-16:00 ET Mon-Fri,
// extended 04:00-09:30 & 16:00-20:00, closed otherwise; no holiday calendar in v0), re-implemented here so the
// lab's ground truth does not depend on the library under test.

export type Session = 'regular' | 'extended' | 'closed';

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface EtParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  label: string;
}

export function etParts(sec: number): EtParts {
  const parts = fmt.formatToParts(new Date(sec * 1000));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = WD[g('weekday')] ?? 0;
  const hour = Number(g('hour')) % 24;
  const minute = Number(g('minute'));
  return {
    year: Number(g('year')),
    month: Number(g('month')),
    day: Number(g('day')),
    weekday,
    hour,
    minute,
    label: `${g('weekday')} ${g('year')}-${g('month')}-${g('day')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`,
  };
}

/** Unix seconds for a New York wall-clock time (handles EST/EDT by trying both offsets). */
export function etToUnix(year: number, month: number, day: number, hour: number, minute = 0): number {
  for (const offsetH of [4, 5]) {
    const t = Date.UTC(year, month - 1, day, hour + offsetH, minute) / 1000;
    const p = etParts(t);
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) return t;
  }
  throw new Error(`cannot map ET time ${year}-${month}-${day} ${hour}:${minute}`);
}

export function sessionAt(sec: number): Session {
  const { weekday, hour, minute } = etParts(sec);
  const m = hour * 60 + minute;
  if (weekday === 0 || weekday === 6) return 'closed';
  if (m >= 570 && m < 960) return 'regular';
  if ((m >= 240 && m < 570) || (m >= 960 && m < 1200)) return 'extended';
  return 'closed';
}

/** Session-aware max feed staleness used as ground truth: regular 1h, extended 4h, closed: any trade flagged. */
export function maxStalenessSec(session: Session): number {
  return session === 'regular' ? 3600 : session === 'extended' ? 4 * 3600 : 0;
}

/**
 * The lab's reference week: the first Tuesday (ET) whose 00:00 ET is at least 24h after `afterSec`, so nothing that
 * happened at deploy time (seed trades) can fall inside a scenario's 24h volume window.
 * Returns a function mapping (dayOffsetFromTuesday, hour, minute) -> unix seconds.
 */
export function referenceWeek(afterSec: number) {
  const minMidnight = afterSec + 86400;
  for (let i = 0; i < 10; i++) {
    const p = etParts(afterSec + i * 86400);
    if (p.weekday !== 2) continue;
    if (etToUnix(p.year, p.month, p.day, 0) < minMidnight) continue;
    const tue = { year: p.year, month: p.month, day: p.day };
    return (dayOffset: number, hour: number, minute = 0) => {
      const base = new Date(Date.UTC(tue.year, tue.month - 1, tue.day + dayOffset));
      return etToUnix(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hour, minute);
    };
  }
  throw new Error('no Tuesday found');
}

/** Fixed replica genesis: Sunday 2026-10-04 00:00 ET (EDT, UTC-4). Pinning it makes every run reproducible. */
export const REPLICA_GENESIS_SEC = Date.UTC(2026, 9, 4, 4, 0) / 1000;

/** Offsets from the reference Tuesday. */
export const DAY = { TUE: 0, WED: 1, THU: 2, FRI: 3, SAT: 4, SUN: 5 } as const;
