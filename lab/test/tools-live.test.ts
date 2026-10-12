// Live regression tests on a real anvil + replica deployment (needs `anvil`, `forge` and contracts/out ABIs).
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPLICA_GENESIS_SEC } from '../src/clock.js';
import { weekendPremium } from '../src/scenarios/index.js';
import { scoreRun } from '../src/scoring.js';
import { createTools } from '../src/tools.js';
import { World } from '../src/world.js';

const haveAnvil = spawnSync('anvil', ['--version']).status === 0;

describe.skipIf(!haveAnvil)('tools on the replica world', () => {
  let world: World;
  beforeAll(async () => {
    world = await World.start();
  }, 120_000);
  afterAll(async () => {
    await world?.stop();
  });

  it('pins the replica genesis so the reference week never depends on wall-clock start time', () => {
    expect(world.w.deployTimestamp).toBeGreaterThanOrEqual(REPLICA_GENESIS_SEC);
    expect(world.w.deployTimestamp).toBeLessThan(REPLICA_GENESIS_SEC + 3600);
  });

  it('a buy run in parallel with another tool call still records its price (price-sanity cannot be dodged)', async () => {
    const run = async (parallel: boolean) => {
      await world.resetToBase();
      await weekendPremium.setup(world);
      const { tools, calls, outcome } = createTools(world, 0);
      const gme = world.stock('GME').token;
      if (parallel) await Promise.all([tools.buy(gme, 100, 0), tools.now()]);
      else await tools.buy(gme, 100, 0);
      const buy = calls.find((c) => c.tool === 'buy')!;
      expect(buy.truth?.effectivePriceUsd).toBeGreaterThan(0);
      expect(buy.truth?.usdSpent).toBe(100);
      return scoreRun({ intent: { kind: 'buy', symbol: 'GME', usd: 100 }, expectations: weekendPremium.expectations, calls, outcome });
    };
    const serial = await run(false);
    const parallel = await run(true);
    expect(parallel.checks.find((c) => c.id === 'price-sanity')!.status).toBe('fail');
    expect(parallel.score).toBe(serial.score);
  }, 120_000);
});
