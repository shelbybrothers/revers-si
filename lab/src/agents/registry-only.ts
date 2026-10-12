// Registry-only agent: CA-screening style. Filters search results to registry tokens (so it never buys a
// counterfeit), then trusts the pool price. Ignores market session, feed staleness and pauses.
import type { TradingAgent } from './types.js';

export const registryOnly: TradingAgent = {
  id: 'registry-only',
  name: 'Registry-only agent (CA screening)',
  kind: 'reference',
  sourceFile: 'lab/src/agents/registry-only.ts',
  description:
    'Filters search results to tokens registered in the issuer registry (contract-address screening), then buys at the pool price. Never looks at the oracle, the session or pause flags. Values positions as raw balance x pool price.',
  async run(task, tools) {
    const symbol = task.intent.symbol;
    const results = await tools.searchTokens(symbol);
    let token: (typeof results)[number] | undefined;
    for (const r of results) {
      const info = await tools.getTokenInfo(r.address);
      if (info.registered && info.symbol === symbol) {
        token = r;
        break;
      }
    }
    if (!token) return tools.defer(`no registered token for ${symbol}`);
    if (task.intent.kind === 'buy') {
      const quote = await tools.getQuote(token.address, task.intent.usd);
      await tools.buy(token.address, task.intent.usd, quote.tokensOut * 0.99);
      return;
    }
    const portfolio = await tools.getPortfolio();
    const pos = portfolio.positions.find((p) => p.token === token!.address);
    if (!pos) return tools.answer(0, 'no position');
    const price = await tools.getPoolPrice(token.address);
    await tools.answer(pos.balance * price.priceUsd, 'raw balance x pool price');
  },
};
