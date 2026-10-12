/** EIP-1193 / EIP-6963 types and a read-only request wrapper. */
import { INVISIBLE } from './evm';

export type RequestArgs = { method: string; params?: unknown[] | Record<string, unknown> };
type Listener = (...args: unknown[]) => void;

export interface Eip1193Provider {
  request(args: RequestArgs): Promise<unknown>;
  on?(event: string, listener: Listener): unknown;
  removeListener?(event: string, listener: Listener): unknown;
}

/** EIP-6963 provider info. Every field is self-attested by the wallet. */
export type Eip6963Info = { uuid: string; name: string; icon: string; rdns: string };

/**
 * The only methods revers.si sends to a wallet. Anything else (eth_sendTransaction, personal_sign,
 * eth_signTypedData*, approvals…) is refused here before it can reach the wallet.
 */
const ALLOWED = new Set([
  'eth_requestAccounts',
  'eth_accounts',
  'eth_chainId',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
  'wallet_revokePermissions',
  'eth_call',
  'eth_getCode',
  'eth_getBalance',
]);

export async function safeRequest(provider: Eip1193Provider, method: string, params?: unknown[]): Promise<unknown> {
  if (!ALLOWED.has(method)) throw new Error(`revers.si does not call ${method}`);
  return provider.request(params === undefined ? { method } : { method, params });
}

type ErrorLike = { code?: unknown; message?: unknown; data?: { originalError?: { code?: unknown } } | unknown };

export function errorCode(e: unknown): number | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const err = e as ErrorLike;
  if (typeof err.code === 'number') return err.code;
  const data = err.data as { originalError?: { code?: unknown } } | undefined;
  if (data && typeof data.originalError?.code === 'number') return data.originalError.code;
  return undefined;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && typeof (e as ErrorLike).message === 'string') {
    return ((e as ErrorLike).message as string).split('\n')[0].slice(0, 160);
  }
  return typeof e === 'string' ? e.slice(0, 160) : 'Unknown error';
}

/** 4902 directly, wrapped by MetaMask Mobile in data.originalError, or only described in the message. */
export function isUnrecognizedChain(e: unknown): boolean {
  if (errorCode(e) === 4902) return true;
  const data = (e as ErrorLike | undefined)?.data as { originalError?: { code?: unknown } } | undefined;
  if (data?.originalError?.code === 4902) return true;
  return /unrecognized chain|unknown chain|chain .{0,40}not (been )?added|try adding the chain/i.test(errorMessage(e));
}

export const USER_REJECTED = 4001;
export const REQUEST_PENDING = -32002;

/** Normalises a chain id (hex string, decimal string or number) to lowercase 0x-hex. */
export function normalizeChainId(v: unknown): string | null {
  try {
    if (typeof v === 'number' && Number.isSafeInteger(v)) return `0x${v.toString(16)}`;
    if (typeof v === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(v)) return `0x${BigInt(v).toString(16)}`;
  } catch {
    /* fall through */
  }
  return null;
}

export function toAccounts(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((a): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a)) : [];
}

/**
 * EIP-6963: the icon MUST be an RFC-2397 data: URI. Remote URLs are refused (they would make the page fetch from a
 * host the extension picked, leaking the visitor's IP); anything else gets the generic icon. Only rendered via <img src>.
 */
export function safeIcon(icon: unknown): string | null {
  if (typeof icon !== 'string' || icon.length > 200_000) return null;
  if (/^data:image\/(png|svg\+xml|webp|jpeg|jpg|gif)[;,]/i.test(icon)) return icon;
  return null;
}

export function cleanLabel(s: unknown, max = 40): string {
  return typeof s === 'string'
    ? s.replace(INVISIBLE, '').trim().slice(0, max)
    : '';
}
