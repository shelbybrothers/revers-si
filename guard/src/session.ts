// US equity session calendar (v0).
// regular  09:30-16:00 ET Mon-Fri
// extended 04:00-09:30 and 16:00-20:00 ET Mon-Fri
// closed   otherwise (weekends, overnight)
// Time zone math uses Intl.DateTimeFormat with 'America/New_York', so EST/EDT (DST) is handled by the
// platform's tz database. KNOWN GAP: no exchange holiday / early-close calendar in v0 — a weekday holiday
// (e.g. Thanksgiving) is reported as a normal trading day.

export type Session = 'regular' | 'extended' | 'closed';

export interface EtClock {
  /** 0 = Sunday ... 6 = Saturday, in America/New_York */
  weekday: number;
  /** minutes since local midnight in America/New_York */
  minutes: number;
  /** e.g. "Tue 10:00 ET" */
  label: string;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function etClock(nowSec: number): EtClock {
  const parts = fmt.formatToParts(new Date(nowSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = get('weekday');
  const weekday = WEEKDAYS[wd];
  if (weekday === undefined) throw new Error(`unexpected weekday from Intl: ${wd}`);
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    weekday,
    minutes: hour * 60 + minute,
    label: `${wd} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`,
  };
}

const PRE_OPEN = 4 * 60; // 04:00
const OPEN = 9 * 60 + 30; // 09:30
const CLOSE = 16 * 60; // 16:00
const POST_CLOSE = 20 * 60; // 20:00

export function sessionAt(nowSec: number): Session {
  const { weekday, minutes } = etClock(nowSec);
  if (weekday === 0 || weekday === 6) return 'closed';
  if (minutes >= OPEN && minutes < CLOSE) return 'regular';
  if ((minutes >= PRE_OPEN && minutes < OPEN) || (minutes >= CLOSE && minutes < POST_CLOSE)) return 'extended';
  return 'closed';
}

export interface SessionPolicy {
  /** max feed age during the regular session (default 3600s = 1h) */
  regularMaxStalenessSec: number;
  /** max feed age during extended hours (default 14400s = 4h) */
  extendedMaxStalenessSec: number;
  /**
   * When false (default) every trade while the market is closed is flagged (defer), regardless of feed age:
   * the equity feed is not updating, so the stock token's on-chain price is unanchored.
   */
  allowClosedSession: boolean;
  /** max feed age when allowClosedSession = true (default 0 -> still stale) */
  closedMaxStalenessSec: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  regularMaxStalenessSec: 3600,
  extendedMaxStalenessSec: 4 * 3600,
  allowClosedSession: false,
  closedMaxStalenessSec: 0,
};

export function maxStalenessFor(session: Session, policy: SessionPolicy): number {
  switch (session) {
    case 'regular':
      return policy.regularMaxStalenessSec;
    case 'extended':
      return policy.extendedMaxStalenessSec;
    default:
      return policy.closedMaxStalenessSec;
  }
}
