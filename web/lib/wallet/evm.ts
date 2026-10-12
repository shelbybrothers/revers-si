/**
 * Minimal, dependency-free EVM helpers for the read-only wallet check:
 * keccak-256, hex/ABI encoding for the handful of calls we make, CREATE2 and Multicall3 aggregate3.
 *
 * Self-contained on purpose (no imports, erasable TypeScript only) so the same file runs in the browser
 * bundle and under Node's type stripping in scripts/build-stock-tokens.mjs.
 */

export type Hex = `0x${string}`;

// ---------- Robinhood Chain constants ----------

/** Official wallet parameters (Robinhood Chain docs, "Add network to your wallet"). */
export const ROBINHOOD_CHAIN = {
  chainId: '0x1237',
  chainName: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
  blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
} as const;
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_HEX = '0x1237';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';

/**
 * Stock Token factory (ERC1967 proxy). Not named in Robinhood's docs: identified on chain. Every Stock Token in
 * Robinhood's published asset list (snapshot 2026-10-08, 194 tokens) was CREATE2-deployed by it with salt = uid()
 * and is registered in its tokenAddress(uid) mapping.
 */
export const STOCK_TOKEN_FACTORY = '0x4783c67b63de2b358ac5951a7d41f47a38f3c046';
/** keccak256(BeaconProxy creation code ++ abi.encode(beacon, "")) used by the factory's CREATE2 deploys. */
export const STOCK_TOKEN_INIT_CODE_HASH = '0xe26032e03bb0b6eab360db727b0016d4295906ecc240155c9d093d9312855839';
/** Beacon shared by every Stock Token; it is also their ACCESS_CONTROLLED_REGISTRY (roles, pause, blocklist). */
export const STOCK_TOKEN_REGISTRY = '0xe10b6f6b275de231345c20d14ab812db62151b00';
/** keccak256 of the genuine BeaconProxy runtime code. Informational only: a clone can reproduce it. */
export const STOCK_TOKEN_RUNTIME_CODE_HASH = '0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630';
export const MULTICALL3 = '0xca11bde05977b3631167028862be2a173976ca11';

export const SEL = {
  uid: '0xf514ce36',
  tokenAddress: '0x97bb3ce9',
  uiMultiplier: '0xa60bf13d',
  balanceOfUI: '0x437a9958',
  tokenPaused: '0x86c75e74',
  oraclePaused: '0x7706ba52',
  paused: '0x5c975abb',
  balanceOf: '0x70a08231',
  decimals: '0x313ce567',
  symbol: '0x95d89b41',
  name: '0x06fdde03',
  aggregate3: '0x82ad56cb',
} as const;

// ---------- keccak-256 (Keccak-f[1600], original padding 0x01) ----------

const MASK64 = (1n << 64n) - 1n;
const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn,
  0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n,
  0x0000000080008009n, 0x000000008000000an, 0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// Rotation offsets indexed by lane x + 5y.
const ROT: bigint[] = [0n, 1n, 62n, 28n, 27n, 36n, 44n, 6n, 55n, 20n, 3n, 10n, 43n, 25n, 39n, 41n, 45n, 15n, 21n, 8n, 18n, 2n, 61n, 56n, 14n];

function rotl(v: bigint, n: bigint): bigint {
  return n === 0n ? v : ((v << n) | (v >> (64n - n))) & MASK64;
}

function keccakF(a: bigint[]): void {
  const c = new Array<bigint>(5);
  const b = new Array<bigint>(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1n);
      for (let y = 0; y < 25; y += 5) a[x + y] ^= d;
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y], ROT[x + 5 * y]);
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) a[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK64 & b[((x + 2) % 5) + y]);
    }
    a[0] ^= RC[round];
  }
}

export function keccak256(data: Uint8Array): Uint8Array {
  const rate = 136;
  const padded = new Uint8Array(Math.floor(data.length / rate) * rate + rate);
  padded.set(data);
  padded[data.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const s = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let k = 7; k >= 0; k--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + k]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    let lane = s[i];
    for (let k = 0; k < 8; k++) {
      out[i * 8 + k] = Number(lane & 0xffn);
      lane >>= 8n;
    }
  }
  return out;
}

// ---------- hex ----------

export function isHex(v: unknown): v is Hex {
  return typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v);
}

export function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error('invalid hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): Hex {
  let s = '0x';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s as Hex;
}

export function keccakHex(h: string): Hex {
  return bytesToHex(keccak256(hexToBytes(h)));
}

/** Byte length of a 0x hex string. */
export function hexByteLength(h: string): number {
  return Math.floor((h.length - 2) / 2);
}

// ---------- addresses ----------

export function isAddress(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v);
}

/** EIP-55 mixed-case checksum. */
export function toChecksumAddress(addr: string): string {
  const lower = addr.toLowerCase().replace(/^0x/, '');
  const hash = bytesToHex(keccak256(new TextEncoder().encode(lower))).slice(2);
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  return out;
}

/** True when the input is all-lowercase, all-uppercase, or a correct EIP-55 checksum. */
export function hasValidChecksum(addr: string): boolean {
  const body = addr.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return toChecksumAddress(addr) === addr;
}

export function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function sameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

/** CREATE2 address: keccak256(0xff ++ deployer ++ salt ++ initCodeHash)[12:]. */
export function create2Address(deployer: string, salt: string, initCodeHash: string): string {
  const buf = new Uint8Array(85);
  buf[0] = 0xff;
  buf.set(hexToBytes(deployer), 1);
  buf.set(hexToBytes(salt), 21);
  buf.set(hexToBytes(initCodeHash), 53);
  return bytesToHex(keccak256(buf).slice(12));
}

// ---------- ABI ----------

export function encAddress(a: string): string {
  return a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
}

export function encUint(n: bigint | number): string {
  return BigInt(n).toString(16).padStart(64, '0');
}

/** Calldata for selector(address). */
export function callWithAddress(selector: string, addr: string): Hex {
  return `${selector}${encAddress(addr)}` as Hex;
}

/** Calldata for selector(bytes32). */
export function callWithBytes32(selector: string, word: string): Hex {
  return `${selector}${word.replace(/^0x/, '').padStart(64, '0')}` as Hex;
}

export function decodeUint(ret: string | null | undefined): bigint | null {
  if (!ret || !isHex(ret) || hexByteLength(ret) < 32) return null;
  return BigInt(`0x${ret.slice(2, 66)}`);
}

export function decodeBool(ret: string | null | undefined): boolean | null {
  const v = decodeUint(ret);
  return v === null ? null : v !== 0n;
}

export function decodeAddress(ret: string | null | undefined): string | null {
  if (!ret || !isHex(ret) || hexByteLength(ret) < 32) return null;
  return `0x${ret.slice(26, 66)}`.toLowerCase();
}

/**
 * Control characters plus invisible / bidirectional formatting characters (ZWSP..RLM, LS, PS, LRE..RLO, LRI..PDI,
 * BOM, ALM). Stripped from wallet names and on-chain strings before display (Trojan Source-style spoofing).
 * Written as escapes so the class is visible in review.
 */
export const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

/** Decodes an ABI `string` return (or a legacy bytes32 string). Strips control characters; display only. */
export function decodeString(ret: string | null | undefined): string | null {
  if (!ret || !isHex(ret)) return null;
  try {
    const b = hexToBytes(ret);
    let raw: Uint8Array | null = null;
    if (b.length >= 64) {
      const off = Number(BigInt(bytesToHex(b.slice(0, 32))));
      if (off + 32 <= b.length) {
        const len = Number(BigInt(bytesToHex(b.slice(off, off + 32))));
        if (len <= 256 && off + 32 + len <= b.length) raw = b.slice(off + 32, off + 32 + len);
      }
    }
    if (!raw && b.length === 32) {
      const end = b.indexOf(0);
      raw = b.slice(0, end === -1 ? 32 : end);
    }
    if (!raw) return null;
    const s = new TextDecoder('utf-8', { fatal: false }).decode(raw).replace(INVISIBLE, '');
    return s.slice(0, 80);
  } catch {
    return null;
  }
}

export type Call3 = { target: string; callData: string; allowFailure?: boolean };
export type Call3Result = { success: boolean; returnData: Hex };

/** Calldata for Multicall3.aggregate3((address,bool,bytes)[]). */
export function encodeAggregate3(calls: Call3[]): Hex {
  const n = calls.length;
  const heads: string[] = [];
  const tails: string[] = [];
  let offset = n * 32;
  for (const c of calls) {
    const data = c.callData.replace(/^0x/, '');
    const len = data.length / 2;
    const padded = data.padEnd(Math.ceil(len / 32) * 64, '0');
    const tuple = encAddress(c.target) + encUint(c.allowFailure === false ? 0 : 1) + encUint(96) + encUint(len) + padded;
    heads.push(encUint(offset));
    tails.push(tuple);
    offset += tuple.length / 2;
  }
  return `${SEL.aggregate3}${encUint(32)}${encUint(n)}${heads.join('')}${tails.join('')}` as Hex;
}

/** Decodes the (bool success, bytes returnData)[] returned by aggregate3. */
export function decodeAggregate3(ret: string): Call3Result[] {
  const b = ret.replace(/^0x/, '');
  const word = (byteOff: number) => BigInt(`0x${b.slice(byteOff * 2, byteOff * 2 + 64) || '0'}`);
  const arr = Number(word(0));
  const n = Number(word(arr));
  if (n > 10000) throw new Error('aggregate3: implausible result length');
  const base = arr + 32;
  const out: Call3Result[] = [];
  for (let i = 0; i < n; i++) {
    const t = base + Number(word(base + i * 32));
    const success = word(t) !== 0n;
    const dOff = t + Number(word(t + 32));
    const len = Number(word(dOff));
    const start = (dOff + 32) * 2;
    if (start + len * 2 > b.length) throw new Error('aggregate3: truncated result');
    out.push({ success, returnData: `0x${b.slice(start, start + len * 2)}` as Hex });
  }
  return out;
}

// ---------- formatting ----------

/** Formats a fixed-point integer with `decimals`, trimming trailing zeros and capping fraction digits. */
export function formatUnits(v: bigint, decimals: number, maxFraction = 6): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = decimals > 0 ? (abs % base).toString().padStart(decimals, '0') : '';
  frac = frac.slice(0, maxFraction).replace(/0+$/, '');
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const s = frac ? `${wholeStr}.${frac}` : wholeStr;
  if (s === '0' && abs > 0n) return `<0.${'0'.repeat(Math.max(0, maxFraction - 1))}1`;
  return neg ? `-${s}` : s;
}
