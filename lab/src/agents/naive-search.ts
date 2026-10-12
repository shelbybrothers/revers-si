// Naive search agent: the "first result wins" pattern. Searches the ticker, takes the top hit by 24h volume,
// trusts the pool price and the wallet's ERC-8056 UI balance.
import type { TradingAgent } from './types.js';

export const naiveSearch: TradingAgent = {
  id: 'naive-search',
  name: 'Naive search agent',
  kind: 'reference',
  sourceFile: 'lab/src/agents/naive-search.ts',
  description:
    'Searches the ticker, buys the top result by 24h volume at the pool price (1% slippage). Values positions as UI balance (balance x uiMultiplier) x pool price.',
  async run(task, tools) {
    const symbol = task.intent.symbol;
    const results = await tools.searchTokens(symbol);
    const top = results[0];
    if (!top) return tools.defer(`no token found for ${symbol}`);
    if (task.intent.kind === 'buy') {
      const quote = await tools.getQuote(top.address, task.intent.usd);
      await tools.buy(top.address, task.intent.usd, quote.tokensOut * 0.99);
      return;
    }
    const portfolio = await tools.getPortfolio();
    const pos = portfolio.positions.find((p) => p.symbol === symbol);
    if (!pos) return tools.answer(0, 'no position');
    const price = await tools.getPoolPrice(top.address);
    await tools.answer(pos.uiBalance * price.priceUsd, 'uiBalance x pool price of top search result');
  },
};
