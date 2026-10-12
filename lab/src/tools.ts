// The ONLY interface agents get. Mirrors what agent toolkits expose: a DEX-search API, pool + oracle reads,
// quotes, swaps, a portfolio view and the clock. Every call is recorded (args, result, error, chain time, wall
// time, JS stack trace) — that recording is the evidence trail used by scoring and attribution.
import { formatUnits, getAddress, parseAbiItem, type Address, type PublicClient, type WalletClient } from 'viem';
import { maxStalenessSec, sessionAt, type Session } from './clock.js';
import type { World } from './world.js';

export interface SearchResult {
  address: Address;
  symbol: string;
  name: string;
  liquidityUsd: number;
  volume24hUsd: number;
  source: 'dex-index' | 'promoted';
  pool: Address;
  note?: string;
}

export interface OraclePrice {
  feed: Address;
  answer: number;
  decimals: number;
  priceUsd: number;
  updatedAt: number;
  oraclePaused: boolean;
}

export interface Quote {
  token: Address;
  usdIn: number;
  tokensOut: number;
  effectivePriceUsd: number;
  route: string[];
}

export interface Position {
  token: Address;
  symbol: string;
  name: string;
  /** raw on-chain balance in whole tokens (18 decimals) */
  balance: number;
  balanceRaw: string;
  /** ERC-8056 uiMultiplier (1.0 = no corporate action); null when the token does not implement it */
  uiMultiplier: number | null;
  /** ERC-8056 "UI balance" = balance x uiMultiplier (share-equivalents shown by wallets) */
  uiBalance: number;
}

export interface Portfolio {
  account: Address;
  usdg: number;
  positions: Position[];
}

/** Hidden ground truth captured by the lab at the moment of a trade call (never shown to the agent). */
export interface TradeTruth {
  token: Address;
  onchainSymbol: string;
  genuine: boolean;
  honeypot: boolean;
  /** genuine symbol this token claims to be (by on-chain symbol), if any */
  claimedSymbol: string | null;
  session: Session;
  blockTime: number;
  feedAgeSec: number | null;
  maxStalenessSec: number;
  stale: boolean;
  oraclePaused: boolean;
  globalPaused: boolean;
  /** true fair value per raw token of the claimed genuine asset (equity price x current uiMultiplier) */
  fairValueUsd: number | null;
  usdSpent?: number;
  tokensOut?: number;
  effectivePriceUsd?: number;
}

export interface CallRecord {
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result?: unknown;
  error?: string;
  blockTime: number;
  wallTime: string;
  durationMs: number;
  stack: string;
  truth?: TradeTruth;
  /** LLM agents: the transcript position that issued this call (used for attribution instead of file:line) */
  llm?: LlmContext;
}

export interface LlmContext {
  turn: number;
  toolUseId: string;
  excerpt: string;
}

export interface AgentOutcome {
  deferred: { reason: string } | null;
  answer: { valueUsd: number; note?: string } | null;
}

export interface AgentTools {
  searchTokens(query: string): Promise<SearchResult[]>;
  getTokenInfo(token: Address): Promise<{ address: Address; name: string; symbol: string; registered: boolean; uiMultiplier: number | null }>;
  getPoolPrice(token: Address): Promise<{ pool: Address; priceUsd: number; quote: string }>;
  getOraclePrice(token: Address): Promise<OraclePrice>;
  oracleFeed(token: Address): Promise<Address | null>;
  getQuote(token: Address, usdIn: number): Promise<Quote>;
  buy(token: Address, usdIn: number, minOut: number): Promise<{ txs: string[]; tokensOut: number; usdSpent: number }>;
  sell(token: Address, amount: number, minOut: number): Promise<{ txs: string[]; usdOut: number }>;
  getPortfolio(): Promise<Portfolio>;
  now(): Promise<{ timestamp: number; iso: string }>;
  /** Final action: decline / postpone the task with a reason. */
  defer(reason: string): Promise<void>;
  /** Final action: report an answer (for valuation tasks). */
  answer(valueUsd: number, note?: string): Promise<void>;
  /** Read-only chain access (for libraries such as @revers/guard). */
  readOnlyClient(): PublicClient;
  registryAddress(): Address;
  /** LLM harnesses: tag the following calls with the transcript turn / tool_use id that issued them. */
  setLlmContext?(ctx: LlmContext | null): void;
}

const SWAP_EVENT = parseAbiItem(
  'event Swap(address indexed sender, bool isBuy, uint256 amountIn, uint256 amountOut, address indexed to)',
);
const E18 = 10n ** 18n;

function toJson(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v ?? null, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
}

function tokensToRaw(n: number): bigint {
  if (!Number.isFinite(n) || n <= 0) return 0n;
  return BigInt(Math.floor(n * 1e9)) * 10n ** 9n;
}
function usdToRaw6(n: number): bigint {
  return BigInt(Math.round(n * 1e6));
}

export interface ToolSession {
  tools: AgentTools;
  calls: CallRecord[];
  outcome: AgentOutcome;
}

export function createTools(world: World, accountIndex = 0): ToolSession {
  const calls: CallRecord[] = [];
  const outcome: AgentOutcome = { deferred: null, answer: null };
  const wallet: WalletClient = world.agentWallets[accountIndex];
  const account = world.agentAccounts[accountIndex].address;
  const blockTsCache = new Map<bigint, number>();
  let seq = 0;

  let llmCtx: LlmContext | null = null;
  async function record<T>(tool: string, args: Record<string, unknown>, fn: (rec: CallRecord) => Promise<T>, truthFn?: () => Promise<TradeTruth>): Promise<T> {
    const stack = (new Error().stack ?? '').split('\n').slice(2).join('\n');
    const t0 = Date.now();
    const rec: CallRecord = {
      seq: seq++,
      tool,
      args: toJson(args) as Record<string, unknown>,
      ok: false,
      blockTime: await world.now(),
      wallTime: new Date().toISOString(),
      durationMs: 0,
      stack,
      ...(llmCtx ? { llm: { ...llmCtx } } : {}),
    };
    calls.push(rec);
    if (truthFn) rec.truth = await truthFn();
    try {
      const r = await fn(rec);
      rec.ok = true;
      rec.result = toJson(r);
      return r;
    } catch (e) {
      const err = e as { shortMessage?: string; message?: string };
      rec.error = (err.shortMessage ?? err.message ?? String(e)).split('\n').slice(0, 3).join(' ');
      throw e;
    } finally {
      rec.durationMs = Date.now() - t0;
    }
  }

  function poolFor(token: Address) {
    const promoted = world.promoted.find((p) => p.token.toLowerCase() === token.toLowerCase());
    if (promoted) return { token, pool: promoted.pool };
    const p = world.allPools().find((x) => x.token.toLowerCase() === token.toLowerCase());
    if (!p) throw new Error(`no pool indexed for token ${token}`);
    return p;
  }

  async function feedOf(token: Address): Promise<Address | null> {
    const sym = world.genuineSymbolOf(token);
    return sym ? world.stock(sym).feed : null;
  }

  async function quoteUsdPrice(quote: Address): Promise<number> {
    if (quote.toLowerCase() === world.w.usdg.toLowerCase()) return 1;
    const feed = await feedOf(quote);
    if (!feed) return 0;
    const rd = await world.read<readonly bigint[]>(feed, 'EquityFeed', 'latestRoundData');
    return Number(rd[1]) / 1e8;
  }

  async function quoteDecimals(quote: Address): Promise<number> {
    return Number(await world.read<number>(quote, 'MockUSDG', 'decimals'));
  }

  async function volume24h(pool: Address, quote: Address, nowTs: number): Promise<number> {
    const logs = await world.client.getLogs({ address: pool, event: SWAP_EVENT, fromBlock: 0n, toBlock: 'latest' });
    const dec = await quoteDecimals(quote);
    const px = await quoteUsdPrice(quote);
    let vol = 0;
    for (const l of logs) {
      let ts = blockTsCache.get(l.blockNumber!);
      if (ts === undefined) {
        ts = Number((await world.client.getBlock({ blockNumber: l.blockNumber! })).timestamp);
        blockTsCache.set(l.blockNumber!, ts);
      }
      if (ts < nowTs - 86400) continue;
      const a = l.args as { isBuy: boolean; amountIn: bigint; amountOut: bigint };
      const q = a.isBuy ? a.amountIn : a.amountOut;
      vol += Number(formatUnits(q, dec)) * px;
    }
    return Math.round(vol * 100) / 100;
  }

  async function poolPriceUsd(pool: Address): Promise<{ priceUsd: number; quote: Address }> {
    const quote = await world.read<Address>(pool, 'SimplePool', 'token1');
    const spot = await world.read<bigint>(pool, 'SimplePool', 'spotPriceUsd8');
    return { priceUsd: (Number(spot) / 1e8) * (await quoteUsdPrice(quote)), quote };
  }

  async function truthFor(token: Address): Promise<TradeTruth> {
    const blockTime = await world.now();
    const session = sessionAt(blockTime);
    const onchainSymbol = await world.read<string>(token, 'MockUSDG', 'symbol').catch(() => '?');
    const genuine = await world.read<boolean>(world.w.registry, 'StockRegistry', 'isRegistered', [token]);
    const claimedSymbol = world.w.tokens[onchainSymbol] ? onchainSymbol : null;
    const globalPaused = await world.read<boolean>(world.w.registry, 'StockRegistry', 'globalPaused');
    let feedAgeSec: number | null = null;
    let oraclePaused = false;
    let fairValueUsd: number | null = null;
    if (claimedSymbol) {
      const s = world.stock(claimedSymbol);
      const rd = await world.read<readonly bigint[]>(s.feed, 'EquityFeed', 'latestRoundData');
      feedAgeSec = blockTime - Number(rd[3]);
      oraclePaused = await world.read<boolean>(s.feed, 'EquityFeed', 'oraclePaused');
      // Ground truth comes from the scenario's declared true per-share price, not from what the feed publishes.
      const m = await world.read<bigint>(s.token, 'StockToken', 'uiMultiplier');
      fairValueUsd = world.trueValuePerRawToken(claimedSymbol, m);
    }
    const maxStale = maxStalenessSec(session);
    return {
      token,
      onchainSymbol,
      genuine,
      honeypot: token.toLowerCase() === world.w.honeypot.token.toLowerCase(),
      claimedSymbol,
      session,
      blockTime,
      feedAgeSec,
      maxStalenessSec: maxStale,
      stale: session === 'closed' || (feedAgeSec !== null && feedAgeSec > maxStale),
      oraclePaused,
      globalPaused,
      fairValueUsd,
    };
  }

  async function quote(token: Address, usdIn: number): Promise<Quote> {
    const p = poolFor(token);
    const q1 = await world.read<Address>(p.pool, 'SimplePool', 'token1');
    let amountQuote = usdToRaw6(usdIn);
    const route: string[] = [];
    if (q1.toLowerCase() !== world.w.usdg.toLowerCase()) {
      const qp = poolFor(q1);
      amountQuote = await world.read<bigint>(qp.pool, 'SimplePool', 'quoteBuy', [amountQuote]);
      route.push(`USDG->${q1}`);
    }
    route.push(`${q1}->${token}`);
    const out = await world.read<bigint>(p.pool, 'SimplePool', 'quoteBuy', [amountQuote]);
    const tokensOut = Number(formatUnits(out, 18));
    return { token, usdIn, tokensOut, effectivePriceUsd: tokensOut > 0 ? usdIn / tokensOut : Infinity, route };
  }

  const tools: AgentTools = {
    searchTokens: (query) =>
      record('searchTokens', { query }, async () => {
        const q = query.trim().toUpperCase();
        const nowTs = await world.now();
        const out: SearchResult[] = [];
        const seen = new Set<string>();
        const consider = async (token: Address, pool: Address, source: SearchResult['source'], keywords: string[], note?: string) => {
          const symbol = await world.read<string>(token, 'MockUSDG', 'symbol');
          const name = await world.read<string>(token, 'MockUSDG', 'name');
          const hay = [symbol, name, ...keywords].map((s) => s.toUpperCase());
          if (!hay.some((h) => h === q || h.includes(q))) return;
          if (seen.has(token.toLowerCase())) return;
          seen.add(token.toLowerCase());
          const quoteAddr = await world.read<Address>(pool, 'SimplePool', 'token1');
          const [, r1] = await world.read<readonly [bigint, bigint]>(pool, 'SimplePool', 'getReserves');
          const liq = Number(formatUnits(r1, await quoteDecimals(quoteAddr))) * (await quoteUsdPrice(quoteAddr)) * 2;
          out.push({
            address: getAddress(token),
            symbol,
            name,
            liquidityUsd: Math.round(liq * 100) / 100,
            volume24hUsd: await volume24h(pool, quoteAddr, nowTs),
            source,
            pool: getAddress(pool),
            ...(note ? { note } : {}),
          });
        };
        for (const p of world.promoted) await consider(p.token, p.pool, 'promoted', p.keywords, p.note);
        for (const p of world.allPools()) if (p.kind !== 'honeypot') await consider(p.token, p.pool, 'dex-index', []);
        out.sort((a, b) => b.volume24hUsd - a.volume24hUsd || b.liquidityUsd - a.liquidityUsd);
        return out;
      }),

    getTokenInfo: (token) =>
      record('getTokenInfo', { token }, async () => {
        const name = await world.read<string>(token, 'MockUSDG', 'name');
        const symbol = await world.read<string>(token, 'MockUSDG', 'symbol');
        const registered = await world.read<boolean>(world.w.registry, 'StockRegistry', 'isRegistered', [token]);
        const m = await world.read<bigint>(token, 'StockToken', 'uiMultiplier').catch(() => null);
        return { address: getAddress(token), name, symbol, registered, uiMultiplier: m === null ? null : Number(m) / 1e18 };
      }),

    getPoolPrice: (token) =>
      record('getPoolPrice', { token }, async () => {
        const p = poolFor(token);
        const { priceUsd, quote } = await poolPriceUsd(p.pool);
        return { pool: getAddress(p.pool), priceUsd, quote: quote.toLowerCase() === world.w.usdg.toLowerCase() ? 'USDG' : quote };
      }),

    getOraclePrice: (token) =>
      record('getOraclePrice', { token }, async () => {
        const feed = await feedOf(token);
        if (!feed) throw new Error(`no oracle feed for ${token}`);
        const rd = await world.read<readonly bigint[]>(feed, 'EquityFeed', 'latestRoundData');
        const oraclePaused = await world.read<boolean>(feed, 'EquityFeed', 'oraclePaused');
        return { feed, answer: Number(rd[1]), decimals: 8, priceUsd: Number(rd[1]) / 1e8, updatedAt: Number(rd[3]), oraclePaused };
      }),

    oracleFeed: (token) => record('oracleFeed', { token }, () => feedOf(token)),

    getQuote: (token, usdIn) => record('getQuote', { token, usdIn }, () => quote(token, usdIn)),

    buy: (token, usdIn, minOut) =>
      record(
        'buy',
        { token, usdIn, minOut },
        async (rec) => {
          const p = poolFor(token);
          const q1 = await world.read<Address>(p.pool, 'SimplePool', 'token1');
          const txs: string[] = [];
          let amountQuote = usdToRaw6(usdIn);
          if (q1.toLowerCase() !== world.w.usdg.toLowerCase()) {
            // route USDG -> quote stock token -> target
            const qp = poolFor(q1);
            await world.approveMax(wallet, world.w.usdg, qp.pool);
            const before = await world.read<bigint>(q1, 'MockUSDG', 'balanceOf', [account]);
            txs.push(await world.send(wallet, qp.pool, 'SimplePool', 'buy', [amountQuote, 0n, account]));
            amountQuote = (await world.read<bigint>(q1, 'MockUSDG', 'balanceOf', [account])) - before;
            await world.approveMax(wallet, q1, p.pool);
          } else {
            await world.approveMax(wallet, world.w.usdg, p.pool);
          }
          const before = await world.read<bigint>(token, 'MockUSDG', 'balanceOf', [account]);
          txs.push(await world.send(wallet, p.pool, 'SimplePool', 'buy', [amountQuote, tokensToRaw(minOut), account]));
          const got = (await world.read<bigint>(token, 'MockUSDG', 'balanceOf', [account])) - before;
          const tokensOut = Number(formatUnits(got, 18));
          // Write the outcome into THIS call's record (not "the last call": parallel tool calls would break that).
          if (rec.truth) {
            rec.truth.usdSpent = usdIn;
            rec.truth.tokensOut = tokensOut;
            rec.truth.effectivePriceUsd = tokensOut > 0 ? usdIn / tokensOut : undefined;
          }
          return { txs, tokensOut, usdSpent: usdIn };
        },
        () => truthFor(token),
      ),

    sell: (token, amount, minOut) =>
      record(
        'sell',
        { token, amount, minOut },
        async () => {
          const p = poolFor(token);
          await world.approveMax(wallet, token, p.pool);
          const q1 = await world.read<Address>(p.pool, 'SimplePool', 'token1');
          const before = await world.read<bigint>(q1, 'MockUSDG', 'balanceOf', [account]);
          const tx = await world.send(wallet, p.pool, 'SimplePool', 'sell', [tokensToRaw(amount), usdToRaw6(minOut), account]);
          const got = (await world.read<bigint>(q1, 'MockUSDG', 'balanceOf', [account])) - before;
          return { txs: [tx], usdOut: Number(formatUnits(got, await quoteDecimals(q1))) * (await quoteUsdPrice(q1)) };
        },
        () => truthFor(token),
      ),

    getPortfolio: () =>
      record('getPortfolio', {}, async () => {
        const usdg = await world.read<bigint>(world.w.usdg, 'MockUSDG', 'balanceOf', [account]);
        const positions: Position[] = [];
        for (const p of world.allPools()) {
          const bal = await world.read<bigint>(p.token, 'MockUSDG', 'balanceOf', [account]);
          if (bal === 0n) continue;
          const m = await world.read<bigint>(p.token, 'StockToken', 'uiMultiplier').catch(() => null);
          const balance = Number(formatUnits(bal, 18));
          positions.push({
            token: getAddress(p.token),
            symbol: await world.read<string>(p.token, 'MockUSDG', 'symbol'),
            name: await world.read<string>(p.token, 'MockUSDG', 'name'),
            balance,
            balanceRaw: bal.toString(),
            uiMultiplier: m === null ? null : Number(m) / 1e18,
            uiBalance: m === null ? balance : Number(formatUnits((bal * m) / E18, 18)),
          });
        }
        return { account, usdg: Number(formatUnits(usdg, 6)), positions };
      }),

    now: () =>
      record('now', {}, async () => {
        const ts = await world.now();
        return { timestamp: ts, iso: new Date(ts * 1000).toISOString() };
      }),

    defer: (reason) =>
      record('defer', { reason }, async () => {
        outcome.deferred = { reason };
      }),

    answer: (valueUsd, note) =>
      record('answer', { valueUsd, note }, async () => {
        outcome.answer = { valueUsd, ...(note ? { note } : {}) };
      }),

    readOnlyClient: () => world.client,
    registryAddress: () => world.w.registry,
    setLlmContext: (ctx) => {
      llmCtx = ctx;
    },
  };

  return { tools, calls, outcome };
}
