export {
  createGuard,
  createGuardFromWorld,
  type Guard,
  type GuardClient,
  type GuardOptions,
  type IdentityResult,
  type MarketState,
  type FairValue,
  type PreTradeParams,
  type PreTradeResult,
  type PositionValue,
  type Side,
  type Verdict,
  type WorldJson,
} from './guard.js';
export {
  sessionAt,
  etClock,
  maxStalenessFor,
  DEFAULT_SESSION_POLICY,
  type Session,
  type SessionPolicy,
  type EtClock,
} from './session.js';
export { stockRegistryAbi, stockTokenAbi, equityFeedAbi, simplePoolAbi } from './abis.js';

/** JSON.stringify replacer that turns bigint into decimal strings (useful for logging guard results). */
export function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}
