import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { createGuard, createGuardFromWorld, sessionAt, etClock } from '../src/index.js';
import { A, T, baselineState, et, mockClient, type MockState } from './mockClient.js';

const lc = (a: string) => a.toLowerCase();

function guardFor(state: MockState) {
  const client = mockClient(state);
  const guard = createGuard({ client, registry: A.registry, feeds: { [A.gme]: A.gmeFeed } });
  return { guard, client };
}

describe('session calendar (America/New_York, DST-aware)', () => {
  it('Saturday is closed', () => {
    expect(sessionAt(T.sat1200)).toBe('closed');
    expect(etClock(T.sat1200).label).toBe('Sat 12:00 ET');
  });
  it('Tuesday 10:00 ET is the regular session', () => {
    expect(sessionAt(T.tue1000)).toBe('regular');
    expect(etClock(T.tue1000).label).toBe('Tue 10:00 ET');
  });
  it('Tuesday 17:00 ET is extended hours', () => {
    expect(sessionAt(T.tue1700)).toBe('extended');
  });
  it('Sunday is closed', () => {
    expect(sessionAt(T.sun1400)).toBe('closed');
  });
  it('handles exact boundaries 04:00 / 09:30 / 16:00 / 20:00', () => {
    const d = (h: number, m: number) => et(2026, 10, 13, h, m, -4);
    expect(sessionAt(d(3, 59))).toBe('closed');
    expect(sessionAt(d(4, 0))).toBe('extended');
    expect(sessionAt(d(9, 29))).toBe('extended');
    expect(sessionAt(d(9, 30))).toBe('regular');
    expect(sessionAt(d(15, 59))).toBe('regular');
    expect(sessionAt(d(16, 0))).toBe('extended');
    expect(sessionAt(d(19, 59))).toBe('extended');
    expect(sessionAt(d(20, 0))).toBe('closed');
    expect(sessionAt(d(0, 0))).toBe('closed');
  });
  it('is DST-correct (EST in January, EDT right after the March switch)', () => {
    // 2026-01-13 (Tue) 09:30 EST = 14:30Z
    expect(sessionAt(et(2026, 1, 13, 9, 30, -5))).toBe('regular');
    expect(sessionAt(et(2026, 1, 13, 9, 29, -5))).toBe('extended');
    // DST starts 2026-03-08. Tue 2026-03-10 09:30 EDT = 13:30Z. A fixed UTC-5 offset would call this 08:30 (extended).
    const t = Math.floor(Date.UTC(2026, 2, 10, 13, 30) / 1000);
    expect(sessionAt(t)).toBe('regular');
    expect(etClock(t).label).toBe('Tue 09:30 ET');
  });
  it('Friday 20:00 ET to Monday 04:00 ET is closed', () => {
    expect(sessionAt(et(2026, 10, 16, 20, 0, -4))).toBe('closed');
    expect(sessionAt(et(2026, 10, 19, 3, 59, -4))).toBe('closed');
    expect(sessionAt(et(2026, 10, 19, 4, 0, -4))).toBe('extended');
  });
});

describe('checkIdentity', () => {
  it('rejects a counterfeit even though it implements uiMultiplier() and copies the ticker', async () => {
    const { guard } = guardFor(baselineState(T.tue1000));
    const r = await guard.checkIdentity(A.fakeGme);
    expect(r.genuine).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/NOT registered/);
  });
  it('accepts the registry token', async () => {
    const { guard } = guardFor(baselineState(T.tue1000));
    const r = await guard.checkIdentity(A.gme);
    expect(r.genuine).toBe(true);
  });
  it('rejects a registered token whose registry() points elsewhere', async () => {
    const s = baselineState(T.tue1000);
    s.tokens[lc(A.gme)]!.registry = '0x00000000000000000000000000000000000000ff';
    const { guard } = guardFor(s);
    expect((await guard.checkIdentity(A.gme)).genuine).toBe(false);
  });
});

describe('preTrade', () => {
  it('baseline: Tuesday 10:00 ET, fresh feed, pool at fair value -> allow', async () => {
    const { guard } = guardFor(baselineState(T.tue1000));
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('allow');
    expect(r.allow).toBe(true);
  });

  it('counterfeit ticker -> block (without touching its pool or feed)', async () => {
    const { guard, client } = guardFor(baselineState(T.tue1000));
    const r = await guard.preTrade({ token: A.fakeGme, pool: A.fakeGmePool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('block');
    expect(r.allow).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/NOT registered/);
    expect(client.calls.some((c) => c.startsWith(lc(A.fakeGmePool)))).toBe(false);
  });

  it('weekend: Sunday 14:00 ET with the feed last updated Friday 16:00 ET -> defer', async () => {
    const s = baselineState(T.sun1400);
    s.feeds[lc(A.gmeFeed)]!.updatedAt = BigInt(T.fri1600);
    const { guard } = guardFor(s);
    const ms = await guard.marketState(A.gme, T.sun1400);
    expect(ms.session).toBe('closed');
    expect(ms.feedAgeSec).toBe(46 * 3600);
    expect(ms.stale).toBe(true);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.sun1400 });
    expect(r.verdict).toBe('defer');
    expect(r.allow).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/market closed/i);
  });

  it('uses the chain clock when `now` is omitted', async () => {
    const s = baselineState(T.sun1400);
    s.feeds[lc(A.gmeFeed)]!.updatedAt = BigInt(T.fri1600);
    const { guard } = guardFor(s);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy' });
    expect(r.verdict).toBe('defer');
  });

  it('stale feed during the regular session (2h old, max 1h) -> defer', async () => {
    const s = baselineState(T.tue1000);
    s.feeds[lc(A.gmeFeed)]!.updatedAt = BigInt(T.tue1000 - 2 * 3600);
    const { guard } = guardFor(s);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('defer');
    expect(r.reasons.join(' ')).toMatch(/stale/);
  });

  it('extended hours allow a 3h-old feed (max 4h)', async () => {
    const s = baselineState(T.tue1700);
    s.feeds[lc(A.gmeFeed)]!.updatedAt = BigInt(T.tue1700 - 3 * 3600);
    const { guard } = guardFor(s);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.tue1700 });
    expect(r.verdict).toBe('allow');
  });

  it('oraclePaused -> defer', async () => {
    const s = baselineState(T.tue1000);
    s.feeds[lc(A.gmeFeed)]!.paused = true;
    const { guard } = guardFor(s);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('defer');
    expect(r.reasons.join(' ')).toMatch(/oraclePaused/);
  });

  it('globalPaused -> block', async () => {
    const s = baselineState(T.tue1000);
    s.globalPaused = true;
    const { guard } = guardFor(s);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('block');
    expect(r.reasons.join(' ')).toMatch(/globalPaused/);
  });

  it('blocklisted account -> block', async () => {
    const s = baselineState(T.tue1000);
    s.blocklisted.add(lc(A.trader));
    const { guard } = guardFor(s);
    const r = await guard.preTrade({
      token: A.gme,
      pool: A.gmePool,
      usdIn: 100,
      side: 'buy',
      now: T.tue1000,
      account: A.trader,
    });
    expect(r.verdict).toBe('block');
  });

  it('pool premium above maxPremiumPct -> block (whale pushed pool to ~3x)', async () => {
    const s = baselineState(T.tue1000);
    s.pools[lc(A.gmePool)]!.spot = 75_00000000n;
    const { guard } = guardFor(s);
    const fv = await guard.fairValue(A.gme, A.gmePool);
    expect(fv.oraclePriceUsd).toBe(25);
    expect(fv.poolPriceUsd).toBe(75);
    expect(fv.premiumPct).toBe(200);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('block');
    expect(r.reasons.join(' ')).toMatch(/above oracle fair value/);
  });

  it('premium just inside a custom max -> allow; just outside -> block', async () => {
    const s = baselineState(T.tue1000);
    s.pools[lc(A.gmePool)]!.spot = 26_00000000n; // +4%
    const { guard } = guardFor(s);
    const base = { token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy' as const, now: T.tue1000 };
    expect((await guard.preTrade({ ...base, maxPremiumPct: 5 })).verdict).toBe('allow');
    expect((await guard.preTrade({ ...base, maxPremiumPct: 3 })).verdict).toBe('block');
  });

  it('sell into a pool trading far below oracle -> block', async () => {
    const s = baselineState(T.tue1000);
    s.pools[lc(A.gmePool)]!.spot = 20_00000000n; // -20%
    const { guard } = guardFor(s);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'sell', now: T.tue1000 });
    expect(r.verdict).toBe('block');
    expect(r.reasons.join(' ')).toMatch(/below oracle/);
  });

  it('empty pool (spot 0) -> block', async () => {
    const s = baselineState(T.tue1000);
    s.pools[lc(A.gmePool)]!.spot = 0n;
    const { guard } = guardFor(s);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('block');
    expect(r.reasons.join(' ')).toMatch(/no liquidity/);
  });

  it('pool that trades a different token -> block', async () => {
    const { guard } = guardFor(baselineState(T.tue1000));
    const r = await guard.preTrade({ token: A.gme, pool: A.fakeGmePool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('block');
    expect(r.reasons.join(' ')).toMatch(/trades/);
  });

  it('genuine token with no feed configured -> defer', async () => {
    const { guard } = guardFor(baselineState(T.tue1000));
    const r = await guard.preTrade({ token: A.tsla, pool: A.tslaPool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('defer');
    expect(r.reasons.join(' ')).toMatch(/no EquityFeed/);
  });

  it('multiplier switched over after the last feed update -> defer', async () => {
    const s = baselineState(T.tue1000);
    s.feeds[lc(A.gmeFeed)]!.updatedAt = BigInt(T.tue1000 - 1800);
    s.tokens[lc(A.gme)]!.uiMultiplier = 4n * 10n ** 18n;
    s.tokens[lc(A.gme)]!.effectiveAt = BigInt(T.tue1000 - 600);
    const { guard } = guardFor(s);
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('defer');
    expect(r.reasons.join(' ')).toMatch(/uiMultiplier changed/);
  });

  it('invalid size -> block', async () => {
    const { guard } = guardFor(baselineState(T.tue1000));
    const r = await guard.preTrade({ token: A.gme, pool: A.gmePool, usdIn: -5, side: 'buy', now: T.tue1000 });
    expect(r.verdict).toBe('block');
  });
});

describe('positionValue (4-for-1 split)', () => {
  it('values balance x feed answer and does NOT apply uiMultiplier twice', async () => {
    const s = baselineState(T.tue1000);
    // After a 4-for-1 split: equity $25 -> $6.25, uiMultiplier 4.0, feed answer = 6.25 x 4 = $25 (feed includes it).
    s.tokens[lc(A.gme)]!.uiMultiplier = 4n * 10n ** 18n;
    s.tokens[lc(A.gme)]!.effectiveAt = BigInt(T.tue1000 - 7200);
    s.feeds[lc(A.gmeFeed)]!.answer = 25_00000000n;
    const { guard } = guardFor(s);
    const balance = 10n * 10n ** 18n; // 10 GME
    const v = await guard.positionValue(A.gme, balance);
    expect(v.valueUsdScaled).toBe(250_00000000n);
    expect(v.valueUsd).toBe(250);
    expect(v.valueUsd).not.toBe(1000); // DOUBLE_MULTIPLIER bug
    expect(v.valueUsd).not.toBe(62.5); // RAW_BALANCE_SPOT_FEED bug (drops multiplier)
    expect(v.uiMultiplier).toBe(4n * 10n ** 18n);
    expect(v.shareEquivalents).toBe(40);
  });

  it('pre-split baseline values 10 GME at $250', async () => {
    const { guard } = guardFor(baselineState(T.tue1000));
    const v = await guard.positionValue(A.gme, 10n * 10n ** 18n);
    expect(v.valueUsd).toBe(250);
  });
});

describe('construction', () => {
  it('accepts a real viem PublicClient (type-level) and builds from world.json', () => {
    const client = createPublicClient({ transport: http('http://127.0.0.1:1') });
    const g = createGuard({ client, registry: A.registry });
    expect(typeof g.preTrade).toBe('function');
    const g2 = createGuardFromWorld(client, {
      registry: A.registry,
      tokens: { GME: { token: A.gme, feed: A.gmeFeed, pool: A.gmePool } },
    });
    expect(g2.registry.toLowerCase()).toBe(lc(A.registry));
  });
  it('rejects an invalid registry address', () => {
    expect(() => createGuard({ client: mockClient(baselineState(T.tue1000)), registry: '0x123' as `0x${string}` })).toThrow();
  });
});
