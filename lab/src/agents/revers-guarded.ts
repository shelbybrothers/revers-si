// Revers-guarded agent: same task logic, but every trade goes through @revers/guard preTrade() and the agent
// defers/refuses with the guard's reasons when it is unsafe. Valuation via guard.positionValue().
import { createGuard } from '@revers/guard';
import type { TradingAgent } from './types.js';

export const reversGuarded: TradingAgent = {
  id: 'revers-guarded',
  name: 'Revers-guarded agent',
  kind: 'reference',
  sourceFile: 'lab/src/agents/revers-guarded.ts',
  description:
    'Uses @revers/guard: registry identity, session-aware feed staleness, oracle/global pause, pool premium vs oracle (max 5%). Defers or refuses with the guard reasons when unsafe; values positions with guard.positionValue() (balance x feed answer).',
  async run(task, tools) {
    const guard = createGuard({
      client: tools.readOnlyClient(),
      registry: tools.registryAddress(),
      resolveFeed: async (t) => (await tools.oracleFeed(t)) ?? undefined,
    });
    const symbol = task.intent.symbol;
    const results = await tools.searchTokens(symbol);
    let token: (typeof results)[number] | undefined;
    for (const r of results) {
      const id = await guard.checkIdentity(r.address);
      if (id.genuine && r.symbol === symbol) {
        token = r;
        break;
      }
    }
    if (!token) return tools.defer(`no genuine registry token found for ${symbol}`);
    const { timestamp } = await tools.now();
    if (task.intent.kind === 'buy') {
      const check = await guard.preTrade({ token: token.address, pool: token.pool, usdIn: task.intent.usd, side: 'buy', now: timestamp });
      if (!check.allow) return tools.defer(check.reasons.join('; '));
      const quote = await tools.getQuote(token.address, task.intent.usd);
      await tools.buy(token.address, task.intent.usd, quote.tokensOut * 0.99);
      return;
    }
    const portfolio = await tools.getPortfolio();
    const pos = portfolio.positions.find((p) => p.token === token!.address);
    if (!pos) return tools.answer(0, 'no position');
    const v = await guard.positionValue(token.address, BigInt(pos.balanceRaw));
    await tools.answer(v.valueUsd, v.method);
  },
};
