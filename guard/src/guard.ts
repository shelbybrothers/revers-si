import { getAddress, isAddress, type Address, type PublicClient } from 'viem';
import { equityFeedAbi, simplePoolAbi, stockRegistryAbi, stockTokenAbi } from './abis.js';
import {
  DEFAULT_SESSION_POLICY,
  etClock,
  maxStalenessFor,
  sessionAt,
  type Session,
  type SessionPolicy,
} from './session.js';

/**
 * The subset of a viem PublicClient the guard needs. A real `PublicClient` is accepted directly; tests pass a
 * hand-written mock implementing just these two methods.
 */
export interface GuardClient {
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
  getBlock?(args?: unknown): Promise<{ timestamp: bigint }>;
}

export interface GuardOptions {
  /** viem PublicClient (or any object implementing GuardClient) */
  client: PublicClient | GuardClient;
  /** StockRegistry address — the ONLY source of truth for "is this the genuine stock token" */
  registry: Address;
  session?: Partial<SessionPolicy>;
  /** token -> EquityFeed map (keys compared case-insensitively) */
  feeds?: Record<string, Address>;
  /** fallback feed resolver, used when `feeds` has no entry */
  resolveFeed?: (token: Address) => Promise<Address | undefined> | Address | undefined;
}

export interface IdentityResult {
  token: Address;
  genuine: boolean;
  reasons: string[];
}

export interface MarketState {
  token: Address;
  feed: Address | null;
  session: Session;
  etTime: string;
  nowSec: number;
  feedUpdatedAt: number | null;
  feedAgeSec: number | null;
  maxStalenessSec: number;
  stale: boolean;
  oraclePaused: boolean;
  globalPaused: boolean;
  /** true when the token's uiMultiplier switched over after the last feed update (feed may not include it yet) */
  multiplierChangedSinceFeedUpdate: boolean;
  reasons: string[];
}

export interface FairValue {
  token: Address;
  pool: Address;
  feed: Address;
  poolToken0: Address;
  poolMatchesToken: boolean;
  oracleAnswer: bigint;
  oracleDecimals: number;
  oraclePriceUsd: number;
  poolPriceUsd8: bigint;
  poolPriceUsd: number;
  /** (pool - oracle) / oracle * 100. Positive = pool trades at a premium to the oracle. */
  premiumPct: number;
}

export type Side = 'buy' | 'sell';
export type Verdict = 'allow' | 'defer' | 'block';

export interface PreTradeParams {
  token: Address;
  pool: Address;
  usdIn: number;
  side: Side;
  /** max tolerated premium (buy) or discount (sell) of pool vs oracle, in percent. Default 5. */
  maxPremiumPct?: number;
  /** unix seconds; defaults to the latest block timestamp (simulated world time), else wall clock */
  now?: number;
  /** optional trader address: checked against registry.blocklisted */
  account?: Address;
  /** optional explicit feed (overrides feeds map / resolver) */
  feed?: Address;
}

export interface PreTradeResult {
  allow: boolean;
  verdict: Verdict;
  reasons: string[];
  evidence: Record<string, unknown>;
}

export interface PositionValue {
  token: Address;
  feed: Address;
  balance: bigint;
  /** feed answer = equity price x uiMultiplier (Chainlink Robinhood feeds already include the multiplier) */
  oracleAnswer: bigint;
  oracleDecimals: number;
  uiMultiplier: bigint;
  /** balance (18 decimals) x answer, in feed decimals */
  valueUsdScaled: bigint;
  valueUsd: number;
  /** informational only: balance x uiMultiplier (share-equivalents). NEVER multiply this by the feed answer. */
  shareEquivalents: number;
  feedUpdatedAt: number;
  oraclePaused: boolean;
  method: string;
}

const TOKEN_DECIMALS = 18n;
const ONE_E18 = 10n ** 18n;

type RoundData = readonly [bigint, bigint, bigint, bigint, bigint];

function addr(a: string, label: string): Address {
  if (!isAddress(a, { strict: false })) throw new Error(`invalid ${label} address: ${a}`);
  return getAddress(a);
}

function scaledToNumber(v: bigint, decimals: number): number {
  return Number(v) / 10 ** decimals;
}

function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function createGuard(opts: GuardOptions) {
  const client = opts.client as unknown as GuardClient;
  const registry = addr(opts.registry, 'registry');
  const policy: SessionPolicy = { ...DEFAULT_SESSION_POLICY, ...(opts.session ?? {}) };
  const feedMap = new Map<string, Address>();
  for (const [k, v] of Object.entries(opts.feeds ?? {})) feedMap.set(k.toLowerCase(), addr(v, 'feed'));

  const read = <T>(address: Address, abi: readonly unknown[], functionName: string, args?: readonly unknown[]) =>
    client.readContract({ address, abi, functionName, ...(args ? { args } : {}) }) as Promise<T>;

  async function resolveNow(now?: number): Promise<number> {
    if (typeof now === 'number' && Number.isFinite(now)) return Math.floor(now);
    if (client.getBlock) {
      try {
        const b = await client.getBlock();
        return Number(b.timestamp);
      } catch {
        /* fall through to wall clock */
      }
    }
    return Math.floor(Date.now() / 1000);
  }

  async function feedFor(token: Address, explicit?: Address): Promise<Address | null> {
    if (explicit) return addr(explicit, 'feed');
    const mapped = feedMap.get(token.toLowerCase());
    if (mapped) return mapped;
    if (opts.resolveFeed) {
      const r = await opts.resolveFeed(token);
      if (r) return addr(r, 'feed');
    }
    return null;
  }

  async function checkIdentity(tokenIn: Address): Promise<IdentityResult> {
    const token = addr(tokenIn, 'token');
    const reasons: string[] = [];
    // Registry membership is the only identity signal. Name, symbol and the existence of uiMultiplier()
    // are trivially copied by counterfeits (the real fake LULU implements uiMultiplier()).
    let registered = false;
    try {
      registered = await read<boolean>(registry, stockRegistryAbi, 'isRegistered', [token]);
    } catch (e) {
      reasons.push(`registry lookup failed: ${(e as Error).message}`);
      return { token, genuine: false, reasons };
    }
    if (!registered) {
      reasons.push(
        `token ${token} is NOT registered in StockRegistry ${registry}: counterfeit or unrelated token (name/symbol/uiMultiplier are not trusted)`,
      );
      return { token, genuine: false, reasons };
    }
    reasons.push(`token ${token} is registered in StockRegistry ${registry}`);
    // Defence in depth: the token should point back at the same registry.
    try {
      const back = await read<Address>(token, stockTokenAbi, 'registry');
      if (back.toLowerCase() !== registry.toLowerCase()) {
        reasons.push(`token.registry() = ${back} does not match configured registry ${registry}`);
        return { token, genuine: false, reasons };
      }
    } catch {
      reasons.push('token.registry() not readable (relying on registry membership only)');
    }
    return { token, genuine: true, reasons };
  }

  async function marketState(tokenIn: Address, nowSec?: number, feedOverride?: Address): Promise<MarketState> {
    const token = addr(tokenIn, 'token');
    const now = await resolveNow(nowSec);
    const session = sessionAt(now);
    const clock = etClock(now);
    const maxStalenessSec = maxStalenessFor(session, policy);
    const reasons: string[] = [];
    const globalPaused = await read<boolean>(registry, stockRegistryAbi, 'globalPaused');
    const feed = await feedFor(token, feedOverride);

    if (!feed) {
      reasons.push(`no EquityFeed configured for ${token}: cannot verify price freshness`);
      return {
        token,
        feed: null,
        session,
        etTime: clock.label,
        nowSec: now,
        feedUpdatedAt: null,
        feedAgeSec: null,
        maxStalenessSec,
        stale: true,
        oraclePaused: false,
        globalPaused,
        multiplierChangedSinceFeedUpdate: false,
        reasons,
      };
    }

    const [round_, oraclePaused] = await Promise.all([
      read<RoundData>(feed, equityFeedAbi, 'latestRoundData'),
      read<boolean>(feed, equityFeedAbi, 'oraclePaused'),
    ]);
    const updatedAt = Number(round_[3]);
    const feedAgeSec = Math.max(0, now - updatedAt);

    let stale: boolean;
    if (session === 'closed' && !policy.allowClosedSession) {
      stale = true;
      reasons.push(
        `market closed (${clock.label}): equity feed is not updating (last update ${feedAgeSec}s ago); any trade is flagged`,
      );
    } else {
      stale = feedAgeSec > maxStalenessSec;
      if (stale) reasons.push(`feed is ${feedAgeSec}s old, max ${maxStalenessSec}s during ${session} session`);
    }
    if (oraclePaused) reasons.push('oraclePaused() = true: feed frozen (corporate action pending)');
    if (globalPaused) reasons.push('registry.globalPaused() = true: all stock token transfers halted');

    let multiplierChangedSinceFeedUpdate = false;
    try {
      const effectiveAt = Number(await read<bigint>(token, stockTokenAbi, 'effectiveAt'));
      if (effectiveAt > 0 && effectiveAt <= now && effectiveAt > updatedAt) {
        multiplierChangedSinceFeedUpdate = true;
        reasons.push(
          `uiMultiplier switched at ${effectiveAt}, after the last feed update at ${updatedAt}: feed may not include the new multiplier yet`,
        );
      }
    } catch {
      /* token without ERC-8056 effectiveAt(): nothing to compare */
    }

    return {
      token,
      feed,
      session,
      etTime: clock.label,
      nowSec: now,
      feedUpdatedAt: updatedAt,
      feedAgeSec,
      maxStalenessSec,
      stale,
      oraclePaused,
      globalPaused,
      multiplierChangedSinceFeedUpdate,
      reasons,
    };
  }

  async function fairValue(tokenIn: Address, poolIn: Address, feedOverride?: Address): Promise<FairValue> {
    const token = addr(tokenIn, 'token');
    const pool = addr(poolIn, 'pool');
    const feed = await feedFor(token, feedOverride);
    if (!feed) throw new Error(`no EquityFeed configured for ${token}`);
    const [round_, decimals, spot, token0] = await Promise.all([
      read<RoundData>(feed, equityFeedAbi, 'latestRoundData'),
      read<number | bigint>(feed, equityFeedAbi, 'decimals'),
      read<bigint>(pool, simplePoolAbi, 'spotPriceUsd8'),
      read<Address>(pool, simplePoolAbi, 'token0'),
    ]);
    const oracleDecimals = Number(decimals);
    const answer = round_[1];
    const oraclePriceUsd = scaledToNumber(answer, oracleDecimals);
    const poolPriceUsd = scaledToNumber(spot, 8);
    const premiumPct = oraclePriceUsd > 0 ? ((poolPriceUsd - oraclePriceUsd) / oraclePriceUsd) * 100 : Number.POSITIVE_INFINITY;
    return {
      token,
      pool,
      feed,
      poolToken0: getAddress(token0),
      poolMatchesToken: token0.toLowerCase() === token.toLowerCase(),
      oracleAnswer: answer,
      oracleDecimals,
      oraclePriceUsd,
      poolPriceUsd8: spot,
      poolPriceUsd,
      premiumPct: round(premiumPct),
    };
  }

  async function preTrade(p: PreTradeParams): Promise<PreTradeResult> {
    const maxPremiumPct = p.maxPremiumPct ?? 5;
    const block: string[] = [];
    const defer: string[] = [];
    const info: string[] = [];
    const evidence: Record<string, unknown> = {
      token: p.token,
      pool: p.pool,
      side: p.side,
      usdIn: p.usdIn,
      maxPremiumPct,
      registry,
    };
    const finish = (): PreTradeResult => {
      const verdict: Verdict = block.length ? 'block' : defer.length ? 'defer' : 'allow';
      const reasons =
        verdict === 'allow'
          ? info.length
            ? info
            : ['all checks passed']
          : [...block.map((r) => `BLOCK: ${r}`), ...defer.map((r) => `DEFER: ${r}`)];
      evidence.verdict = verdict;
      return { allow: verdict === 'allow', verdict, reasons, evidence };
    };

    if (!(typeof p.usdIn === 'number' && Number.isFinite(p.usdIn) && p.usdIn > 0)) {
      block.push(`invalid trade size usdIn=${String(p.usdIn)}`);
    }
    if (p.side !== 'buy' && p.side !== 'sell') block.push(`invalid side ${String(p.side)}`);

    // 1. Identity — short-circuit: nothing else about a counterfeit is meaningful.
    const identity = await checkIdentity(p.token);
    evidence.identity = identity;
    if (!identity.genuine) {
      block.push(...identity.reasons);
      return finish();
    }

    // 2. Market state (session, staleness, pauses)
    const now = await resolveNow(p.now);
    const ms = await marketState(p.token, now, p.feed);
    evidence.marketState = ms;
    if (ms.globalPaused) block.push('registry.globalPaused() = true: stock token transfers are halted, the trade would revert');
    if (p.account) {
      const listed = await read<boolean>(registry, stockRegistryAbi, 'blocklisted', [addr(p.account, 'account')]);
      evidence.accountBlocklisted = listed;
      if (listed) block.push(`account ${p.account} is blocklisted by the registry`);
    }
    if (!ms.feed) {
      defer.push(`no EquityFeed configured for ${p.token}: cannot establish fair value`);
      return finish();
    }
    if (ms.oraclePaused) defer.push('oraclePaused() = true: feed frozen for a corporate action; wait until it resumes');
    if (ms.session === 'closed' && !policy.allowClosedSession) {
      defer.push(
        `US equity market closed (${ms.etTime}); feed last updated ${ms.feedAgeSec}s ago; the token trades 24/7 but its oracle anchor does not`,
      );
    } else if (ms.stale) {
      defer.push(`feed is stale: ${ms.feedAgeSec}s old, max ${ms.maxStalenessSec}s during the ${ms.session} session`);
    }
    if (ms.multiplierChangedSinceFeedUpdate) {
      defer.push('uiMultiplier changed after the last feed update: oracle price may not reflect the split/dividend yet');
    }

    // 3. Fair value: pool vs oracle
    const fv = await fairValue(p.token, p.pool, ms.feed);
    evidence.fairValue = fv;
    if (!fv.poolMatchesToken) {
      block.push(`pool ${fv.pool} trades ${fv.poolToken0}, not ${fv.token}`);
    } else if (fv.oraclePriceUsd <= 0) {
      block.push(`oracle answer is non-positive (${fv.oracleAnswer})`);
    } else if (fv.poolPriceUsd <= 0) {
      block.push(`pool ${fv.pool} has no liquidity (spot price 0)`);
    } else if (p.side === 'buy' && fv.premiumPct > maxPremiumPct) {
      block.push(
        `pool price $${fv.poolPriceUsd.toFixed(4)} is ${fv.premiumPct.toFixed(2)}% above oracle fair value $${fv.oraclePriceUsd.toFixed(4)} (max ${maxPremiumPct}%)`,
      );
    } else if (p.side === 'sell' && -fv.premiumPct > maxPremiumPct) {
      block.push(
        `pool price $${fv.poolPriceUsd.toFixed(4)} is ${(-fv.premiumPct).toFixed(2)}% below oracle fair value $${fv.oraclePriceUsd.toFixed(4)} (max ${maxPremiumPct}%)`,
      );
    } else {
      info.push(
        `genuine token; ${ms.session} session; feed ${ms.feedAgeSec}s old; pool $${fv.poolPriceUsd.toFixed(4)} vs oracle $${fv.oraclePriceUsd.toFixed(4)} (${fv.premiumPct.toFixed(2)}%)`,
      );
    }
    return finish();
  }

  async function positionValue(tokenIn: Address, balance: bigint, feedOverride?: Address): Promise<PositionValue> {
    const token = addr(tokenIn, 'token');
    const feed = await feedFor(token, feedOverride);
    if (!feed) throw new Error(`no EquityFeed configured for ${token}`);
    const [round_, decimals, oraclePaused, uiMultiplier] = await Promise.all([
      read<RoundData>(feed, equityFeedAbi, 'latestRoundData'),
      read<number | bigint>(feed, equityFeedAbi, 'decimals'),
      read<boolean>(feed, equityFeedAbi, 'oraclePaused'),
      read<bigint>(token, stockTokenAbi, 'uiMultiplier').catch(() => ONE_E18),
    ]);
    const oracleDecimals = Number(decimals);
    const answer = round_[1];
    // Feed answer already = equity price x uiMultiplier. value = balance x answer. Do NOT multiply again.
    const valueUsdScaled = (balance * answer) / 10n ** TOKEN_DECIMALS;
    return {
      token,
      feed,
      balance,
      oracleAnswer: answer,
      oracleDecimals,
      uiMultiplier,
      valueUsdScaled,
      valueUsd: scaledToNumber(valueUsdScaled, oracleDecimals),
      shareEquivalents: Number((balance * uiMultiplier) / ONE_E18) / 1e18,
      feedUpdatedAt: Number(round_[3]),
      oraclePaused,
      method: 'balance x feedAnswer (feed already includes uiMultiplier; not multiplied again)',
    };
  }

  return { registry, policy, checkIdentity, marketState, fairValue, preTrade, positionValue };
}

export type Guard = ReturnType<typeof createGuard>;

/** Shape of contracts/deployments/world.json (subset used here). */
export interface WorldJson {
  registry: Address;
  tokens?: Record<string, { token: Address; feed: Address; pool: Address }>;
  [k: string]: unknown;
}

/** Convenience: build a guard from the lab's world.json (token -> feed map taken from `tokens`). */
export function createGuardFromWorld(client: PublicClient | GuardClient, world: WorldJson, session?: Partial<SessionPolicy>) {
  const feeds: Record<string, Address> = {};
  for (const t of Object.values(world.tokens ?? {})) feeds[t.token] = t.feed;
  return createGuard({ client, registry: world.registry, feeds, session });
}
