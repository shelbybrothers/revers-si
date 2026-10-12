import type { Address } from 'viem';
import type { GuardClient } from '../src/index.js';

// Hand-written mock of the viem PublicClient surface the guard uses (readContract + getBlock).
// It models the replica world from SPEC.md: StockRegistry, StockToken, CounterfeitStockToken, EquityFeed, SimplePool.

export const A = {
  registry: '0x1000000000000000000000000000000000000001',
  gme: '0x2000000000000000000000000000000000000002',
  gmeFeed: '0x3000000000000000000000000000000000000003',
  gmePool: '0x4000000000000000000000000000000000000004',
  fakeGme: '0x5000000000000000000000000000000000000005',
  fakeGmePool: '0x6000000000000000000000000000000000000006',
  tsla: '0x7000000000000000000000000000000000000007',
  tslaPool: '0x8000000000000000000000000000000000000008',
  trader: '0x9000000000000000000000000000000000000009',
} as const satisfies Record<string, Address>;

export interface MockState {
  registered: Set<string>;
  globalPaused: boolean;
  blocklisted: Set<string>;
  tokens: Record<string, { uiMultiplier: bigint; effectiveAt?: bigint; registry?: Address }>;
  feeds: Record<string, { answer: bigint; updatedAt: bigint; paused: boolean; decimals: number; token: Address }>;
  pools: Record<string, { spot: bigint; token0: Address }>;
  blockTimestamp: bigint;
}

/** Healthy baseline: genuine GME $25 (feed + pool), counterfeit GME pool at ~$31. */
export function baselineState(nowSec: number): MockState {
  const lc = (a: string) => a.toLowerCase();
  return {
    registered: new Set([lc(A.gme), lc(A.tsla)]),
    globalPaused: false,
    blocklisted: new Set(),
    tokens: {
      [lc(A.gme)]: { uiMultiplier: 10n ** 18n, effectiveAt: 0n, registry: A.registry },
      [lc(A.tsla)]: { uiMultiplier: 10n ** 18n, effectiveAt: 0n, registry: A.registry },
      // counterfeit implements uiMultiplier() = 1e18 just like the real fake LULU, but no registry()
      [lc(A.fakeGme)]: { uiMultiplier: 10n ** 18n },
    },
    feeds: {
      [lc(A.gmeFeed)]: {
        answer: 25_00000000n,
        updatedAt: BigInt(nowSec - 60),
        paused: false,
        decimals: 8,
        token: A.gme,
      },
    },
    pools: {
      [lc(A.gmePool)]: { spot: 25_10000000n, token0: A.gme },
      [lc(A.fakeGmePool)]: { spot: 31_00000000n, token0: A.fakeGme },
      [lc(A.tslaPool)]: { spot: 250_00000000n, token0: A.tsla },
    },
    blockTimestamp: BigInt(nowSec),
  };
}

export class RevertError extends Error {}

export function mockClient(state: MockState): GuardClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getBlock() {
      return { timestamp: state.blockTimestamp };
    },
    async readContract({ address, functionName, args }) {
      const a = address.toLowerCase();
      calls.push(`${a}.${functionName}`);
      if (a === A.registry.toLowerCase()) {
        switch (functionName) {
          case 'isRegistered':
            return state.registered.has(String(args?.[0]).toLowerCase());
          case 'globalPaused':
            return state.globalPaused;
          case 'blocklisted':
            return state.blocklisted.has(String(args?.[0]).toLowerCase());
        }
      }
      const tok = state.tokens[a];
      if (tok) {
        if (functionName === 'uiMultiplier') return tok.uiMultiplier;
        if (functionName === 'effectiveAt' && tok.effectiveAt !== undefined) return tok.effectiveAt;
        if (functionName === 'registry' && tok.registry) return tok.registry;
      }
      const feed = state.feeds[a];
      if (feed) {
        switch (functionName) {
          case 'latestRoundData':
            return [1n, feed.answer, feed.updatedAt, feed.updatedAt, 1n] as const;
          case 'oraclePaused':
            return feed.paused;
          case 'decimals':
            return feed.decimals;
          case 'token':
            return feed.token;
        }
      }
      const pool = state.pools[a];
      if (pool) {
        if (functionName === 'spotPriceUsd8') return pool.spot;
        if (functionName === 'token0') return pool.token0;
      }
      throw new RevertError(`execution reverted: ${address}.${functionName}`);
    },
  };
}

/** unix seconds for a wall-clock time in America/New_York, given the UTC offset in hours (EDT = -4, EST = -5). */
export function et(y: number, m: number, d: number, hh: number, mm: number, offsetHours: number): number {
  return Math.floor(Date.UTC(y, m - 1, d, hh - offsetHours, mm) / 1000);
}

// Reference times (October 2026 is EDT, UTC-4). 2026-10-12 is a Monday.
export const T = {
  tue1000: et(2026, 10, 13, 10, 0, -4),
  tue1700: et(2026, 10, 13, 17, 0, -4),
  sat1200: et(2026, 10, 17, 12, 0, -4),
  fri1600: et(2026, 10, 16, 16, 0, -4),
  sun1400: et(2026, 10, 18, 14, 0, -4),
};
