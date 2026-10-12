// Replica world: spawns anvil, deploys contracts/script/DeployWorld.s.sol with forge, loads world.json + ABIs,
// and exposes snapshot/revert, a market clock and small typed helpers used by scenarios, tools and the drill.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { REPLICA_GENESIS_SEC, referenceWeek } from './clock.js';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');
export const LAB_ROOT = resolve(here, '..');
export const CONTRACTS_ROOT = join(REPO_ROOT, 'contracts');

/** Public, well-known anvil dev mnemonic and account #0 key (local test chain only). */
export const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';
export const ANVIL_KEY_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

export interface StockAddrs {
  token: Address;
  feed: Address;
  pool: Address;
}
export interface WorldJson {
  version: string;
  mode: string;
  chainId: number;
  replicaOf: number;
  deployer: Address;
  deployTimestamp: number;
  maxStalenessSec: number;
  usdg: Address;
  registry: Address;
  attestation: Address;
  tokens: Record<string, StockAddrs>;
  counterfeits: Record<string, { token: Address; pool: Address }>;
  honeypot: { token: Address; pool: Address; quote: Address };
  lending: Record<'CORRECT' | 'DOUBLE_MULTIPLIER' | 'RAW_BALANCE_SPOT_FEED', Address>;
  agents: Address[];
}

const CONTRACT_NAMES = [
  'MockUSDG',
  'StockRegistry',
  'StockToken',
  'CounterfeitStockToken',
  'EquityFeed',
  'SimplePool',
  'HoneypotMeme',
  'LendingMarket',
  'ReversAttestation',
] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];

/** A "promoted" listing injected into the simulated DEX search index (used by the honeypot scenario). */
export interface PromotedListing {
  token: Address;
  pool: Address;
  keywords: string[];
  note: string;
}

export interface StartOptions {
  forkUrl?: string;
  log?: (msg: string) => void;
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.unref();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => res(port));
    });
  });
}

function loadAbis(): Record<ContractName, Abi> & { errors: Abi } {
  const out: Record<string, Abi> = {};
  const errs = new Map<string, unknown>();
  for (const n of CONTRACT_NAMES) {
    const p = join(CONTRACTS_ROOT, 'out', `${n}.sol`, `${n}.json`);
    if (!existsSync(p)) throw new Error(`ABI not found: ${p} (run \`forge build\` in contracts/)`);
    const abi = JSON.parse(readFileSync(p, 'utf8')).abi as Abi;
    out[n] = abi;
    for (const f of abi) if (f.type === 'error') errs.set(`${f.name}(${f.inputs.map((i) => i.type).join(',')})`, f);
  }
  const errors = [...errs.values()] as Abi;
  // Every ABI gets all custom errors so reverts bubbling up from other contracts decode by name.
  for (const n of CONTRACT_NAMES) {
    const own = new Set(out[n].filter((f) => f.type === 'error').map((f) => (f as { name: string }).name));
    out[n] = [...out[n], ...errors.filter((e) => !own.has((e as { name: string }).name))] as Abi;
  }
  return { ...(out as Record<ContractName, Abi>), errors };
}

class DeployTimeout extends Error {}

export class World {
  rpcUrl: string;
  port: number;
  proc: ChildProcess | null;
  w: WorldJson;
  abis: ReturnType<typeof loadAbis>;
  client: PublicClient;
  deployer: Account;
  deployerWallet: WalletClient;
  agentAccounts: Account[];
  agentWallets: WalletClient[];
  forkUrl: string | null;
  /** reference-week time mapper (Tuesday-relative ET wall clock -> unix seconds) */
  week: ReturnType<typeof referenceWeek>;
  promoted: PromotedListing[] = [];
  /** Scenario-declared true per-share equity price (8 decimals); ground truth for fair value. Reset per run. */
  trueEquityPrice8: Record<string, bigint>;
  private baseSnapshot: string | null = null;
  log: (m: string) => void;

  private constructor(args: {
    rpcUrl: string;
    port: number;
    proc: ChildProcess | null;
    w: WorldJson;
    forkUrl: string | null;
    log: (m: string) => void;
  }) {
    this.rpcUrl = args.rpcUrl;
    this.port = args.port;
    this.proc = args.proc;
    this.w = args.w;
    this.forkUrl = args.forkUrl;
    this.log = args.log;
    this.abis = loadAbis();
    const transport = http(args.rpcUrl, { retryCount: 0 });
    const chain = {
      id: args.w.chainId,
      name: 'revers-replica',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [args.rpcUrl] } },
    } as const;
    this.client = createPublicClient({ chain, transport, pollingInterval: 50 }) as PublicClient;
    this.deployer = privateKeyToAccount(ANVIL_KEY_0);
    this.deployerWallet = createWalletClient({ account: this.deployer, chain, transport });
    this.agentAccounts = [1, 2, 3, 4, 5].map((i) => mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: i }));
    this.agentWallets = this.agentAccounts.map((a) => createWalletClient({ account: a, chain, transport }));
    this.week = referenceWeek(args.w.deployTimestamp);
    this.trueEquityPrice8 = { ...World.SEED_PRICE8 };
  }

  /** Start anvil + deploy; a hung `forge script` (seen intermittently) is killed after 90s and retried once from scratch. */
  static async start(opts: StartOptions = {}): Promise<World> {
    try {
      return await World.startOnce(opts);
    } catch (e) {
      if (!(e instanceof DeployTimeout)) throw e;
      (opts.log ?? (() => {}))(`${e.message}; retrying with a fresh anvil`);
      return World.startOnce(opts);
    }
  }

  private static async startOnce(opts: StartOptions = {}): Promise<World> {
    const log = opts.log ?? (() => {});
    const port = await freePort();
    const rpcUrl = `http://127.0.0.1:${port}`;
    const args = ['--port', String(port), '--silent'];
    // Replica mode pins genesis and a fixed 1s block interval so block times (and evidence ids) never depend on
    // when the lab is started. Fork mode keeps the fork's own clock.
    if (opts.forkUrl) args.push('--fork-url', opts.forkUrl);
    else args.push('--timestamp', String(REPLICA_GENESIS_SEC));
    log(`starting anvil on ${rpcUrl}${opts.forkUrl ? ` (fork of ${opts.forkUrl})` : ''}`);
    const proc = spawn('anvil', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => (stderr += String(d)));
    const killOnExit = () => proc.kill('SIGTERM');
    process.once('exit', killOnExit);
    try {
      await waitForRpc(rpcUrl, proc, () => stderr);
      if (!opts.forkUrl) await rpcRaw(rpcUrl, 'anvil_setBlockTimestampInterval', [1]);
      log('deploying replica world (forge script contracts/script/DeployWorld.s.sol)');
      const worldPath = join(CONTRACTS_ROOT, 'deployments', 'world.json');
      const r = spawnSync(
        'forge',
        ['script', 'script/DeployWorld.s.sol', '--rpc-url', rpcUrl, '--broadcast', '--private-key', ANVIL_KEY_0],
        { cwd: CONTRACTS_ROOT, encoding: 'utf8', env: { ...process.env, WORLD_JSON: worldPath }, maxBuffer: 64 << 20, timeout: 90_000, killSignal: 'SIGKILL' },
      );
      if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') throw new DeployTimeout('forge script timed out after 90s');
      if (r.status !== 0) throw new Error(`forge script failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`);
      const w = JSON.parse(readFileSync(worldPath, 'utf8')) as WorldJson;
      const world = new World({ rpcUrl, port, proc, w, forkUrl: opts.forkUrl ?? null, log });
      world.baseSnapshot = await world.snapshot();
      return world;
    } catch (e) {
      proc.kill('SIGTERM');
      throw e;
    }
  }

  async stop(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 50));
    }
    this.proc = null;
  }

  // ---- RPC / snapshots / clock -------------------------------------------------------------------------
  rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    return this.client.request({ method: method as never, params: params as never }) as Promise<T>;
  }
  snapshot(): Promise<string> {
    return this.rpc<string>('evm_snapshot');
  }
  async revert(id: string): Promise<void> {
    const ok = await this.rpc<boolean>('evm_revert', [id]);
    if (!ok) throw new Error(`evm_revert(${id}) failed`);
  }
  /** Revert to the freshly deployed world and take a new base snapshot (anvil consumes snapshots on revert). */
  async resetToBase(): Promise<void> {
    if (!this.baseSnapshot) throw new Error('no base snapshot');
    await this.revert(this.baseSnapshot);
    this.baseSnapshot = await this.snapshot();
    this.promoted = [];
    this.trueEquityPrice8 = { ...World.SEED_PRICE8 };
  }

  /** True USD value of one raw token: declared per-share equity price x the token's current uiMultiplier. */
  trueValuePerRawToken(symbol: string, uiMultiplier: bigint): number {
    const p = this.trueEquityPrice8[symbol];
    if (p === undefined) throw new Error(`no true price declared for ${symbol}`);
    return Number((p * uiMultiplier) / 10n ** 18n) / 1e8;
  }
  async now(): Promise<number> {
    const b = await this.client.getBlock({ blockTag: 'latest' });
    return Number(b.timestamp);
  }
  /** Set the chain clock to `ts` (unix seconds) and mine a block there. */
  async setTime(ts: number): Promise<void> {
    await this.rpc('evm_setNextBlockTimestamp', [ts]);
    await this.rpc('evm_mine');
  }
  async advance(seconds: number): Promise<void> {
    await this.rpc('evm_increaseTime', [seconds]);
    await this.rpc('evm_mine');
  }

  // ---- contract helpers --------------------------------------------------------------------------------
  read<T = unknown>(address: Address, name: ContractName, functionName: string, args: unknown[] = []): Promise<T> {
    return this.client.readContract({ address, abi: this.abis[name], functionName, args } as never) as Promise<T>;
  }

  async send(
    wallet: WalletClient,
    address: Address,
    name: ContractName,
    functionName: string,
    args: unknown[] = [],
  ): Promise<`0x${string}`> {
    const hash = await wallet.writeContract({
      address,
      abi: this.abis[name],
      functionName,
      args,
      account: wallet.account!,
      chain: wallet.chain,
    } as never);
    const rcpt = await this.client.waitForTransactionReceipt({ hash, pollingInterval: 20 });
    if (rcpt.status !== 'success') throw new Error(`${name}.${functionName} reverted (tx ${hash})`);
    return hash;
  }
  /** Deployer/issuer/owner transaction. */
  admin(address: Address, name: ContractName, functionName: string, args: unknown[] = []) {
    return this.send(this.deployerWallet, address, name, functionName, args);
  }

  stock(symbol: string): StockAddrs {
    const s = this.w.tokens[symbol];
    if (!s) throw new Error(`unknown stock ${symbol}`);
    return s;
  }
  /** Seed equity prices (8 decimals) used by the replica. */
  static readonly SEED_PRICE8: Record<string, bigint> = {
    GME: 25_00000000n,
    TSLA: 250_00000000n,
    NVDA: 180_00000000n,
    HIMS: 40_00000000n,
  };

  /** Publish a fresh round on every genuine feed at the current block time (equity price unchanged). */
  async refreshFeeds(symbols = Object.keys(this.w.tokens)): Promise<void> {
    for (const sym of symbols) {
      const s = this.stock(sym);
      const price = await this.read<bigint>(s.feed, 'EquityFeed', 'equityPrice');
      await this.admin(s.feed, 'EquityFeed', 'setEquityPrice', [price]);
    }
  }

  /**
   * Simulated organic trading in the last 24h on genuine pools (deployer round trips). This is seeded replica
   * activity so the simulated DEX search has 24h volume to rank by; it is never presented as real market data.
   */
  async seedOrganicVolume(usdPerSide = 5_000, symbols = ['GME', 'TSLA', 'NVDA', 'HIMS']): Promise<void> {
    for (const sym of symbols) await this.roundTrip(this.stock(sym).pool, BigInt(usdPerSide) * 10n ** 6n, 1);
  }

  /** Deployer buys with `amount1` of the pool's quote token and sells everything back, `times` times. */
  async roundTrip(pool: Address, amount1: bigint, times: number): Promise<void> {
    const token0 = await this.read<Address>(pool, 'SimplePool', 'token0');
    const token1 = await this.read<Address>(pool, 'SimplePool', 'token1');
    await this.fundDeployer(token1, amount1);
    await this.approveMax(this.deployerWallet, token1, pool);
    await this.approveMax(this.deployerWallet, token0, pool);
    for (let i = 0; i < times; i++) {
      const out = await this.read<bigint>(pool, 'SimplePool', 'quoteBuy', [amount1]);
      await this.admin(pool, 'SimplePool', 'buy', [amount1, 0n, this.deployer.address]);
      await this.admin(pool, 'SimplePool', 'sell', [out, 0n, this.deployer.address]);
    }
  }

  /** Mint quote tokens to the deployer (USDG is public-mint; stock tokens are issuer-minted). */
  async fundDeployer(token: Address, amount: bigint): Promise<void> {
    if (token.toLowerCase() === this.w.usdg.toLowerCase()) {
      await this.admin(token, 'MockUSDG', 'mint', [this.deployer.address, amount]);
    } else {
      await this.admin(token, 'StockToken', 'mint', [this.deployer.address, amount]);
    }
  }

  private approved = new Set<string>();
  async approveMax(wallet: WalletClient, token: Address, spender: Address): Promise<void> {
    const owner = wallet.account!.address;
    const cur = await this.read<bigint>(token, 'MockUSDG', 'allowance', [owner, spender]);
    if (cur > 10n ** 60n) return;
    await this.send(wallet, token, 'MockUSDG', 'approve', [spender, 2n ** 256n - 1n]);
  }

  /** All pools the simulated DEX index knows about (genuine, counterfeit, honeypot). */
  allPools(): { token: Address; pool: Address; kind: 'genuine' | 'counterfeit' | 'honeypot'; symbol: string }[] {
    const out: { token: Address; pool: Address; kind: 'genuine' | 'counterfeit' | 'honeypot'; symbol: string }[] = [];
    for (const [sym, s] of Object.entries(this.w.tokens)) out.push({ token: s.token, pool: s.pool, kind: 'genuine', symbol: sym });
    for (const [sym, c] of Object.entries(this.w.counterfeits)) out.push({ token: c.token, pool: c.pool, kind: 'counterfeit', symbol: sym });
    out.push({ token: this.w.honeypot.token, pool: this.w.honeypot.pool, kind: 'honeypot', symbol: 'BONER' });
    return out;
  }

  /** Genuine symbol whose token address equals `token`, if any. */
  genuineSymbolOf(token: Address): string | null {
    for (const [sym, s] of Object.entries(this.w.tokens)) if (s.token.toLowerCase() === token.toLowerCase()) return sym;
    return null;
  }
}

async function rpcRaw(url: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (j.error) throw new Error(`${method} failed: ${j.error.message}`);
  return j.result;
}

async function waitForRpc(url: string, proc: ChildProcess, stderr: () => string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`anvil exited early (code ${proc.exitCode}): ${stderr()}`);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil did not become ready at ${url}: ${stderr()}`);
}
