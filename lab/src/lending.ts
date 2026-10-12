// Lending drill: open the same position in the 3 LendingMarket variants (10 GME collateral, borrow at 50% LTV),
// apply a scenario, read healthFactor / isLiquidatable and compare with ground truth computed off-chain from the
// true equity price x current uiMultiplier (independent of the market's own valuation code).
import { BaseError, ContractFunctionRevertedError, type Address } from 'viem';
import { getScenario } from './scenarios/index.js';
import type { World } from './world.js';

export type LendingFinding = 'ok' | 'inflated-collateral' | 'wrongful-liquidation' | 'used-stale-price' | 'unexpected-revert';
export const LENDING_FINDINGS: LendingFinding[] = ['ok', 'inflated-collateral', 'wrongful-liquidation', 'used-stale-price', 'unexpected-revert'];
export interface LendingResult {
  marketId: 'CORRECT' | 'DOUBLE_MULTIPLIER' | 'RAW_BALANCE_SPOT_FEED';
  scenarioId: string;
  groundTruthHealth: number | null;
  observedHealth: number | null;
  observedLiquidatable: boolean | null;
  finding: LendingFinding;
  detail: string;
}

export const LENDING_SCENARIOS = ['baseline', 'split-4-for-1', 'weekend-stale-feed', 'oracle-paused'];
const MARKETS = ['CORRECT', 'DOUBLE_MULTIPLIER', 'RAW_BALANCE_SPOT_FEED'] as const;
const COLLATERAL = 10n * 10n ** 18n;
const E18 = 10n ** 18n;
const LIQ_THRESHOLD = 0.8;
const round = (x: number) => Math.round(x * 1000) / 1000;

export function classifyLending(args: {
  groundTruthHealth: number;
  observedHealth: number | null;
  reverted: string | null;
  feedStaleOrPaused: boolean;
}): { finding: LendingFinding; why: string } {
  const { groundTruthHealth: gt, observedHealth: obs, reverted, feedStaleOrPaused } = args;
  if (obs === null) {
    return reverted && /StalePrice/.test(reverted) && feedStaleOrPaused
      ? { finding: 'ok', why: 'correctly refused to value collateral on a stale/paused feed (StalePrice revert)' }
      : { finding: 'unexpected-revert', why: `valuation reverted on a ${feedStaleOrPaused ? 'stale/paused' : 'fresh, unpaused'} feed (${reverted ?? 'unknown'})` };
  }
  if (feedStaleOrPaused) return { finding: 'used-stale-price', why: 'valued collateral on a stale or paused feed without checking' };
  if (obs < 1 && gt >= 1) return { finding: 'wrongful-liquidation', why: 'healthy position reported liquidatable' };
  if (obs > gt * 1.02) return { finding: 'inflated-collateral', why: 'collateral overvalued' };
  if (obs < gt * 0.98) return { finding: 'wrongful-liquidation', why: 'collateral undervalued' };
  return { finding: 'ok', why: 'matches ground truth' };
}

/** Decoded custom-error name of a reverted read (e.g. "StalePrice()"), falling back to the first message line. */
export function revertName(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r?.data?.errorName) return `${r.data.errorName}()`;
    if (r?.signature) return `unknown error ${r.signature}`;
    if (r?.reason) return r.reason;
  }
  const msg = (e as Error)?.message ?? String(e);
  return /StalePrice/.test(msg) ? 'StalePrice()' : msg.split('\n')[0];
}

export async function runLendingDrill(world: World, scenarioIds = LENDING_SCENARIOS): Promise<LendingResult[]> {
  const out: LendingResult[] = [];
  const gme = world.stock('GME');
  const debt = new Map<string, bigint>();
  for (const sid of scenarioIds) {
    const scenario = getScenario(sid);
    await world.resetToBase();
    await scenario.setup(world, {
      beforeEvent: async () => {
        for (const m of MARKETS) {
          const market = world.w.lending[m] as Address;
          await world.approveMax(world.deployerWallet, gme.token, market);
          await world.admin(market, 'LendingMarket', 'deposit', [COLLATERAL]);
          // 50% LTV at the current feed answer (8 decimals) -> USDG (6 decimals)
          const rd = await world.read<readonly bigint[]>(gme.feed, 'EquityFeed', 'latestRoundData');
          const valueUsd8 = (COLLATERAL * rd[1]) / E18;
          const borrow6 = valueUsd8 / 2n / 100n;
          await world.admin(market, 'LendingMarket', 'borrow', [borrow6]);
          debt.set(m, borrow6);
        }
      },
    });
    const mult = await world.read<bigint>(gme.token, 'StockToken', 'uiMultiplier');
    const rd = await world.read<readonly bigint[]>(gme.feed, 'EquityFeed', 'latestRoundData');
    const paused = await world.read<boolean>(gme.feed, 'EquityFeed', 'oraclePaused');
    const now = await world.now();
    const feedAge = now - Number(rd[3]);
    const maxStale = world.w.maxStalenessSec;
    const feedStaleOrPaused = paused || feedAge > maxStale;
    const trueValueUsd = (Number(COLLATERAL) / 1e18) * world.trueValuePerRawToken('GME', mult);
    for (const m of MARKETS) {
      const market = world.w.lending[m] as Address;
      const debtUsd = Number(debt.get(m) ?? 0n) / 1e6;
      const gt = round((trueValueUsd * LIQ_THRESHOLD) / debtUsd);
      let observed: number | null = null;
      let liq: boolean | null = null;
      let reverted: string | null = null;
      try {
        const hf = await world.read<bigint>(market, 'LendingMarket', 'healthFactor', [world.deployer.address]);
        observed = round(Number(hf) / 1e18);
        liq = await world.read<boolean>(market, 'LendingMarket', 'isLiquidatable', [world.deployer.address]);
      } catch (e) {
        reverted = revertName(e);
      }
      const { finding, why } = classifyLending({ groundTruthHealth: gt, observedHealth: observed, reverted, feedStaleOrPaused });
      const state = `feed age ${Math.round(feedAge / 360) / 10}h${paused ? ', oraclePaused' : ''}, uiMultiplier ${Number(mult) / 1e18}`;
      out.push({
        marketId: m,
        scenarioId: sid,
        groundTruthHealth: gt,
        observedHealth: observed,
        observedLiquidatable: liq,
        finding,
        detail: `${m}: ${observed === null ? `healthFactor reverted with ${reverted}` : `healthFactor ${observed}${liq ? ' (liquidatable)' : ''}`} vs ground truth ${gt}: ${why} (${state}).`,
      });
    }
  }
  return out;
}
