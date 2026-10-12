#!/usr/bin/env node
/**
 * Builds web/public/data/stock-tokens.json, the candidate list the /wallet page scans for holdings.
 *
 *   cd web && npm run tokens                      # default list + RPC
 *   node scripts/build-stock-tokens.mjs --list ./all.json --rpc https://robinhood-rpc.publicnode.com --extra 0x…,0x…
 *
 * Candidate addresses come from a public token list (CoinGecko's Robinhood Chain list by default). Nothing from it
 * is trusted: an address is kept as a Stock Token only if, on chain, uid() returns 32 bytes and either
 * factory.tokenAddress(uid) == address, or CREATE2(factory, uid, initCodeHash) == address while the mapping could not
 * be read (a CREATE2 match the mapping contradicts is excluded). Symbols are read on chain.
 * "lookalikes" are list entries that FAIL that check but reuse a Stock Token symbol (a heuristic way to pick which
 * impostors to scan; the verdict is still the on-chain check). --extra 0xA,0xB adds candidate addresses by hand.
 * The browser re-checks every address it reports on, so this file only decides what gets scanned.
 *
 * Read-only: eth_chainId, eth_blockNumber and eth_call (Multicall3.aggregate3). Paced; no keys.
 */
import { readFile, writeFile } from 'node:fs/promises';
import * as E from '../lib/wallet/evm.ts';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const RPC = arg('--rpc') || process.env.REVERS_RH_RPC || 'https://robinhood-rpc.publicnode.com';
const LIST = arg('--list') || 'https://tokens.coingecko.com/robinhood/all.json';
const EXTRA = (arg('--extra') || '').split(',').map((s) => s.trim()).filter(Boolean);
const OUT = arg('--out') || new URL('../public/data/stock-tokens.json', import.meta.url);
const CHUNK = 150;
const PACE_MS = 500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let rpcId = 0;
async function rpc(method, params) {
  for (let attempt = 0; ; attempt++) {
    await sleep(PACE_MS);
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    if (res.status === 429 && attempt < 4) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
    return body.result;
  }
}

async function aggregate(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i += CHUNK) {
    const part = calls.slice(i, i + CHUNK);
    const ret = await rpc('eth_call', [{ to: E.MULTICALL3, data: E.encodeAggregate3(part) }, 'latest']);
    out.push(...E.decodeAggregate3(ret));
  }
  return out;
}

async function loadList() {
  const raw = /^https?:\/\//.test(LIST) ? await (await fetch(LIST)).text() : await readFile(LIST, 'utf8');
  const json = JSON.parse(raw);
  const seen = new Map();
  for (const t of json.tokens ?? []) {
    if (t?.chainId !== E.ROBINHOOD_CHAIN_ID || typeof t.address !== 'string' || !E.isAddress(t.address)) continue;
    const a = t.address.toLowerCase();
    if (!seen.has(a)) seen.set(a, { address: a, listSymbol: String(t.symbol ?? '') });
  }
  for (const x of EXTRA) {
    if (!E.isAddress(x)) throw new Error(`--extra: not an address: ${x}`);
    if (!seen.has(x.toLowerCase())) seen.set(x.toLowerCase(), { address: x.toLowerCase(), listSymbol: '' });
  }
  return [...seen.values()];
}

const norm = (s) => s.normalize('NFKC').replace(/[^0-9a-z.]/gi, '').toUpperCase();

async function main() {
  const chainId = await rpc('eth_chainId', []);
  if (chainId !== E.ROBINHOOD_CHAIN_HEX) throw new Error(`RPC is on chain ${chainId}, expected ${E.ROBINHOOD_CHAIN_HEX}`);
  const block = Number(BigInt(await rpc('eth_blockNumber', [])));
  const cands = await loadList();
  console.log(`candidates: ${cands.length} from ${LIST}; block ${block}`);

  const uids = await aggregate(cands.map((c) => ({ target: c.address, callData: E.SEL.uid })));
  cands.forEach((c, i) => {
    const r = uids[i];
    c.uid = r.success && E.hexByteLength(r.returnData) === 32 ? r.returnData : null;
  });
  const withUid = cands.filter((c) => c.uid);
  const mapped = await aggregate(withUid.map((c) => ({ target: E.STOCK_TOKEN_FACTORY, callData: E.callWithBytes32(E.SEL.tokenAddress, c.uid) })));
  withUid.forEach((c, i) => {
    const r = mapped[i];
    const to = r.success ? E.decodeAddress(r.returnData) : null;
    c.mapRead = !!to;
    c.mapOk = c.mapRead && E.sameAddress(to, c.address);
    c.c2Ok = E.sameAddress(E.create2Address(E.STOCK_TOKEN_FACTORY, c.uid, E.STOCK_TOKEN_INIT_CODE_HASH), c.address);
  });
  // Same rule as the browser (lib/wallet/stockTokens.ts): CREATE2 alone counts only when the mapping could not be read.
  const isGenuine = (c) => !!(c.mapOk || (c.c2Ok && !c.mapRead));
  const genuine = cands.filter(isGenuine);
  const syms = await aggregate(genuine.map((c) => ({ target: c.address, callData: E.SEL.symbol })));
  genuine.forEach((c, i) => (c.symbol = (syms[i].success && E.decodeString(syms[i].returnData)) || c.listSymbol));

  const genuineSyms = new Set(genuine.map((c) => norm(c.symbol)));
  const look = cands.filter((c) => !isGenuine(c) && c.listSymbol && genuineSyms.has(norm(c.listSymbol)));
  const lsyms = await aggregate(look.map((c) => ({ target: c.address, callData: E.SEL.symbol })));
  look.forEach((c, i) => (c.symbol = (lsyms[i].success && E.decodeString(lsyms[i].returnData)) || c.listSymbol));

  const both = genuine.filter((c) => c.mapOk && c.c2Ok).length;
  const pick = (c) => ({ address: c.address, symbol: c.symbol });
  const bySym = (a, b) => a.symbol.localeCompare(b.symbol) || a.address.localeCompare(b.address);
  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    chainId: E.ROBINHOOD_CHAIN_ID,
    block,
    source: /^https?:\/\//.test(LIST) ? LIST : 'local token list file',
    extraAddresses: EXTRA.length,
    method:
      'Candidate addresses from the public token list in "source". A Stock Token is kept only if uid() returns 32 bytes and factory.tokenAddress(uid) == address, or CREATE2(factory, uid, initCodeHash) == address while the mapping could not be read. Symbols read on chain. Lookalikes fail that check but reuse a Stock Token symbol in the list (heuristic).',
    factory: E.STOCK_TOKEN_FACTORY,
    initCodeHash: E.STOCK_TOKEN_INIT_CODE_HASH,
    candidatesChecked: cands.length,
    tokens: genuine.map(pick).sort(bySym),
    lookalikes: look.map(pick).sort(bySym),
  };
  await writeFile(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(
    `stock tokens: ${genuine.length} (both checks: ${both}, mapping only: ${genuine.filter((c) => c.mapOk && !c.c2Ok).length}, CREATE2 only: ${genuine.filter((c) => !c.mapOk && c.c2Ok).length}); CREATE2 contradicted by the mapping (excluded): ${cands.filter((c) => c.c2Ok && c.mapRead && !c.mapOk).length}; uid() answered: ${withUid.length}; lookalikes: ${look.length}`,
  );
  console.log(`wrote ${OUT instanceof URL ? OUT.pathname : OUT}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
