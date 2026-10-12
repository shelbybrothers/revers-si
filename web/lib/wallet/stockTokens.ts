/**
 * Read-only Stock Token checks through the connected wallet's provider (eth_call, eth_getCode, eth_getBalance).
 *
 * Verdict rule, keyed by address only:
 *   1. the wallet must be on Robinhood Chain (0x1237);
 *   2. uid() must return 32 bytes;
 *   3. genuine if factory.tokenAddress(uid) == address, OR CREATE2(factory, uid, initCodeHash) == address while the
 *      mapping could not be read (the second check is local math and does not trust the RPC; the mapping alone is
 *      accepted because the factory is upgradeable and a future version could use new creation code). A CREATE2 match
 *      that the factory's own mapping contradicts is "unknown", never genuine.
 *   4. the network is checked again after the reads, so a mid-check network switch fails instead of mislabelling.
 * Code hash and pause flags are shown as extra information, never used for the verdict: a clone can copy them.
 */
import { safeRequest, errorMessage, normalizeChainId, type Eip1193Provider } from './eip1193';
import {
  callWithAddress,
  callWithBytes32,
  create2Address,
  decodeAddress,
  decodeAggregate3,
  decodeBool,
  decodeString,
  decodeUint,
  encodeAggregate3,
  hexByteLength,
  isHex,
  keccakHex,
  MULTICALL3,
  ROBINHOOD_CHAIN_HEX,
  sameAddress,
  SEL,
  STOCK_TOKEN_FACTORY,
  STOCK_TOKEN_INIT_CODE_HASH,
  STOCK_TOKEN_REGISTRY,
  STOCK_TOKEN_RUNTIME_CODE_HASH,
  type Call3,
  type Call3Result,
} from './evm';

export type Verdict = 'genuine' | 'not-stock-token' | 'unknown';
export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'n/a' | 'info';
export type Check = { id: string; label: string; status: CheckStatus; detail: string };

export type TokenReport = {
  address: string;
  verdict: Verdict;
  reason: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  uid: string | null;
  checks: Check[];
  uiMultiplier: bigint | null;
  balance: bigint | null;
  balanceUI: bigint | null;
  shareEquivalent: bigint | null;
};

export type CandidateList = {
  generatedAt: string;
  block: number;
  source: string;
  candidatesChecked: number;
  tokens: { address: string; symbol: string }[];
  lookalikes: { address: string; symbol: string }[];
};

export class WrongNetworkError extends Error {
  constructor() {
    super('Switch your wallet to Robinhood Chain first.');
  }
}

const ZERO = '0x0000000000000000000000000000000000000000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

export async function assertRobinhoodChain(provider: Eip1193Provider) {
  const id = normalizeChainId(await safeRequest(provider, 'eth_chainId'));
  if (id !== ROBINHOOD_CHAIN_HEX) throw new WrongNetworkError();
}

async function aggregate3(provider: Eip1193Provider, calls: Call3[]): Promise<Call3Result[]> {
  const ret = await safeRequest(provider, 'eth_call', [{ to: MULTICALL3, data: encodeAggregate3(calls) }, 'latest']);
  if (!isHex(ret) || ret === '0x') throw new Error('Multicall3 returned no data');
  const out = decodeAggregate3(ret);
  if (out.length !== calls.length) throw new Error('Multicall3 result length mismatch');
  return out;
}

export async function getEthBalance(provider: Eip1193Provider, holder: string): Promise<bigint> {
  const v = await safeRequest(provider, 'eth_getBalance', [holder, 'latest']);
  if (!isHex(v)) throw new Error('Unexpected eth_getBalance result');
  return BigInt(v);
}

// Per-token subcalls, in order.
const TOKEN_CALLS = ['uid', 'uiMultiplier', 'symbol', 'name', 'decimals', 'tokenPaused', 'oraclePaused'] as const;

/**
 * Verifies each address on chain. With `holder`, also reads balanceOf / balanceOfUI for that address.
 * Never throws for a single bad token: RPC failures become verdict "unknown" with the reason.
 */
export async function verifyTokens(
  provider: Eip1193Provider,
  addresses: string[],
  holder?: string,
  signal?: AbortSignal,
): Promise<TokenReport[]> {
  await assertRobinhoodChain(provider);
  const list = addresses.map((a) => a.toLowerCase());
  const reports: TokenReport[] = [];
  const CHUNK = 20;
  let registryPaused: boolean | null = null;

  for (let i = 0; i < list.length; i += CHUNK) {
    checkAbort(signal);
    const part = list.slice(i, i + CHUNK);

    // Contract code (existence + informational code hash).
    const codes: (string | null)[] = [];
    for (const a of part) {
      try {
        const c = await safeRequest(provider, 'eth_getCode', [a, 'latest']);
        codes.push(isHex(c) ? c : null);
      } catch {
        codes.push(null);
      }
    }
    checkAbort(signal);

    // Token-side reads (+ registry pause once).
    const calls: Call3[] = [];
    for (const a of part) {
      for (const k of TOKEN_CALLS) calls.push({ target: a, callData: SEL[k] });
      if (holder) {
        calls.push({ target: a, callData: callWithAddress(SEL.balanceOf, holder) });
        calls.push({ target: a, callData: callWithAddress(SEL.balanceOfUI, holder) });
      }
    }
    if (registryPaused === null) calls.push({ target: STOCK_TOKEN_REGISTRY, callData: SEL.paused });
    let res: Call3Result[] | null = null;
    let rpcError = '';
    try {
      res = await aggregate3(provider, calls);
    } catch (e) {
      rpcError = errorMessage(e);
    }
    if (res && registryPaused === null) {
      const r = res[res.length - 1];
      registryPaused = r.success ? decodeBool(r.returnData) : null;
    }
    checkAbort(signal);

    const per = TOKEN_CALLS.length + (holder ? 2 : 0);
    const rows = part.map((address, j) => {
      const slice = res ? res.slice(j * per, j * per + per) : null;
      const get = (idx: number) => (slice && slice[idx]?.success ? slice[idx].returnData : null);
      const uidRaw = slice ? slice[0] : null;
      const uid = uidRaw && uidRaw.success && hexByteLength(uidRaw.returnData) === 32 ? uidRaw.returnData : null;
      return {
        address,
        code: codes[j],
        uidRaw,
        uid,
        uiMultiplier: decodeUint(get(1)),
        symbol: decodeString(get(2)),
        name: decodeString(get(3)),
        decimals: (() => {
          const d = decodeUint(get(4));
          return d !== null && d <= 36n ? Number(d) : null;
        })(),
        tokenPaused: decodeBool(get(5)),
        oraclePaused: decodeBool(get(6)),
        balance: holder ? decodeUint(get(7)) : null,
        balanceUI: holder ? decodeUint(get(8)) : null,
      };
    });

    // Factory mapping for every token that answered uid().
    const withUid = rows.filter((r) => r.uid);
    let mapRes: Call3Result[] | null = null;
    let mapError = '';
    if (withUid.length) {
      try {
        mapRes = await aggregate3(
          provider,
          withUid.map((r) => ({ target: STOCK_TOKEN_FACTORY, callData: callWithBytes32(SEL.tokenAddress, r.uid as string) })),
        );
      } catch (e) {
        mapError = errorMessage(e);
      }
    }

    for (const r of rows) {
      const k = withUid.indexOf(r);
      const m = k > -1 && mapRes ? mapRes[k] : null;
      const mappedTo = m && m.success ? decodeAddress(m.returnData) : null;
      reports.push(
        buildReport({ ...r, res: !!res, rpcError, mappedTo, mapRead: !!(m && m.success && mappedTo), mapError, registryPaused }),
      );
    }
    if (i + CHUNK < list.length) await sleep(150);
  }
  // The reads above went to whatever chain the wallet was on at the time: re-check before reporting.
  checkAbort(signal);
  await assertRobinhoodChain(provider);
  return reports;
}

type Row = {
  address: string;
  code: string | null;
  uidRaw: Call3Result | null;
  uid: string | null;
  uiMultiplier: bigint | null;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  tokenPaused: boolean | null;
  oraclePaused: boolean | null;
  balance: bigint | null;
  balanceUI: bigint | null;
  res: boolean;
  rpcError: string;
  mappedTo: string | null;
  mapRead: boolean;
  mapError: string;
  registryPaused: boolean | null;
};

function buildReport(r: Row): TokenReport {
  const checks: Check[] = [];
  const codeLen = r.code ? hexByteLength(r.code) : null;
  checks.push({
    id: 'code',
    label: 'Contract code',
    status: codeLen === null ? 'unknown' : codeLen > 0 ? 'info' : 'fail',
    detail: codeLen === null ? 'eth_getCode failed.' : codeLen > 0 ? `${codeLen} bytes of contract code at this address.` : 'No contract at this address on Robinhood Chain.',
  });

  const base = {
    address: r.address,
    symbol: r.symbol,
    name: r.name,
    decimals: r.decimals,
    uid: r.uid,
    uiMultiplier: r.uiMultiplier,
    balance: r.balance,
    balanceUI: r.balanceUI,
    shareEquivalent: r.balance !== null && r.uiMultiplier !== null ? (r.balance * r.uiMultiplier) / 10n ** 18n : null,
  };

  if (codeLen === 0) {
    return { ...base, verdict: 'not-stock-token', reason: 'There is no contract at this address on Robinhood Chain.', checks };
  }
  if (!r.res) {
    checks.push({ id: 'uid', label: 'uid()', status: 'unknown', detail: `Read failed: ${r.rpcError || 'RPC error'}.` });
    return { ...base, verdict: 'unknown', reason: 'The wallet’s RPC did not answer the read, so nothing was verified.', checks };
  }

  if (!r.uid) {
    const len = r.uidRaw && r.uidRaw.success ? hexByteLength(r.uidRaw.returnData) : null;
    checks.push({
      id: 'uid',
      label: 'uid()',
      status: 'fail',
      detail: len === null ? 'Reverted. Every Stock Token answers uid() with a 32-byte id.' : `Returned ${len} bytes, not 32.`,
    });
    checks.push({ id: 'factory', label: 'factory.tokenAddress(uid)', status: 'n/a', detail: 'Skipped: no uid.' });
    checks.push({ id: 'create2', label: 'CREATE2 address', status: 'n/a', detail: 'Skipped: no uid.' });
    return { ...base, verdict: 'not-stock-token', reason: 'It does not implement the Stock Token uid().', checks };
  }
  checks.push({ id: 'uid', label: 'uid()', status: 'pass', detail: r.uid });

  const mapOk = r.mapRead && sameAddress(r.mappedTo, r.address);
  const predicted = create2Address(STOCK_TOKEN_FACTORY, r.uid, STOCK_TOKEN_INIT_CODE_HASH);
  const c2Ok = sameAddress(predicted, r.address);
  checks.push({
    id: 'factory',
    label: 'factory.tokenAddress(uid)',
    status: !r.mapRead ? 'unknown' : mapOk ? 'pass' : 'fail',
    detail: !r.mapRead
      ? `Could not read the factory mapping${r.mapError ? `: ${r.mapError}` : ''}.`
      : mapOk
        ? 'The Stock Token factory maps this uid to this address.'
        : sameAddress(r.mappedTo, ZERO)
          ? 'The factory has no token for this uid.'
          : c2Ok
            ? `The factory maps this uid to ${r.mappedTo}, a different contract.`
            : `The factory maps this uid to ${r.mappedTo}, a different contract: this one reuses another token’s uid.`,
  });

  checks.push({
    id: 'create2',
    label: 'CREATE2(factory, uid, init code hash)',
    status: c2Ok ? 'pass' : 'fail',
    detail: c2Ok
      ? 'Computed in your browser: this address is the factory’s deterministic deploy address for this uid.'
      : `Computed in your browser: the factory would deploy this uid at ${predicted}.`,
  });

  if (r.code && codeLen) {
    const same = keccakHex(r.code) === STOCK_TOKEN_RUNTIME_CODE_HASH;
    checks.push({
      id: 'codehash',
      label: 'Runtime code hash',
      status: 'info',
      detail: same
        ? 'Matches the Stock Token BeaconProxy. Informational only: anyone can deploy identical code.'
        : 'Differs from the current Stock Token BeaconProxy. Informational only.',
    });
  }

  // CREATE2 alone counts only when the mapping could not be read. When the factory's own record for this uid points
  // somewhere else (or nowhere), it overrides the CREATE2 match: superseded/re-pointed token, or an address collision.
  const genuine = mapOk || (c2Ok && !r.mapRead);
  if (c2Ok && r.mapRead && !mapOk) {
    const where = sameAddress(r.mappedTo, ZERO) ? 'nothing' : r.mappedTo;
    return {
      ...base,
      verdict: 'unknown',
      reason: `Deployed by the factory, but the factory’s record for this uid now points to ${where}.`,
      checks,
    };
  }
  if (genuine) {
    const flags = [
      r.tokenPaused === null ? null : `tokenPaused ${r.tokenPaused}`,
      r.oraclePaused === null ? null : `oraclePaused ${r.oraclePaused}`,
      r.registryPaused === null ? null : `registry paused ${r.registryPaused}`,
    ].filter(Boolean);
    if (flags.length) checks.push({ id: 'pause', label: 'Pause flags', status: 'info', detail: `${flags.join(' · ')}.` });
    return {
      ...base,
      verdict: 'genuine',
      reason:
        mapOk && c2Ok
          ? 'Both issuance checks pass.'
          : mapOk
            ? 'The factory mapping passes (read through your wallet’s RPC); the CREATE2 check does not match.'
            : 'The CREATE2 check passes; the factory mapping could not be read.',
      checks,
    };
  }
  if (r.mapRead) {
    return { ...base, verdict: 'not-stock-token', reason: 'The Stock Token factory did not issue this contract.', checks };
  }
  return { ...base, verdict: 'unknown', reason: 'The factory mapping could not be read and the CREATE2 check does not match.', checks };
}

export type ScanProgress = { phase: 'balances' | 'verify'; done: number; total: number };

/**
 * Reads balanceOf(holder) for every candidate in paced Multicall3 batches, then fully verifies only the
 * addresses with a non-zero balance. Returns the reports plus how many candidates could not be read.
 */
export async function scanHoldings(
  provider: Eip1193Provider,
  holder: string,
  list: CandidateList,
  onProgress: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<{ reports: TokenReport[]; unread: number; total: number }> {
  await assertRobinhoodChain(provider);
  const cands = [...list.tokens, ...list.lookalikes].map((t) => t.address.toLowerCase());
  const total = cands.length;
  const held: string[] = [];
  let unread = 0;
  let done = 0;
  onProgress({ phase: 'balances', done, total });

  const readChunk = async (part: string[], attempt: number): Promise<void> => {
    checkAbort(signal);
    try {
      const res = await aggregate3(
        provider,
        part.map((a) => ({ target: a, callData: callWithAddress(SEL.balanceOf, holder) })),
      );
      res.forEach((r, k) => {
        const v = r.success ? decodeUint(r.returnData) : null;
        if (v === null) unread++;
        else if (v > 0n) held.push(part[k]);
      });
      done += part.length;
      onProgress({ phase: 'balances', done, total });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') throw e;
      if (attempt === 0) {
        await sleep(1000);
        return readChunk(part, 1);
      }
      if (part.length > 10) {
        const mid = Math.ceil(part.length / 2);
        await readChunk(part.slice(0, mid), 1);
        await sleep(250);
        return readChunk(part.slice(mid), 1);
      }
      unread += part.length;
      done += part.length;
      onProgress({ phase: 'balances', done, total });
    }
  };

  const CHUNK = 40;
  for (let i = 0; i < cands.length; i += CHUNK) {
    await readChunk(cands.slice(i, i + CHUNK), 0);
    if (i + CHUNK < cands.length) await sleep(200);
  }
  checkAbort(signal);
  // A network switch during the balance reads would make them come from another chain.
  await assertRobinhoodChain(provider);
  checkAbort(signal);
  onProgress({ phase: 'verify', done: 0, total: held.length });
  const reports = held.length ? await verifyTokens(provider, held, holder, signal) : [];
  onProgress({ phase: 'verify', done: held.length, total: held.length });
  return { reports, unread, total };
}
