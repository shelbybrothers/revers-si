// Oracle-blind agent: registry check + oracle price sanity, but never checks updatedAt, oraclePaused or the
// market session. Values positions the common ERC-8056 way: UI balance (balance x uiMultiplier) x feed answer.
import type { TradingAgent } from './types.js';

const MAX_PREMIUM = 0.05;

export const oracleBlind: TradingAgent = {
  id: 'oracle-blind',
  name: 'Oracle-blind agent',
  kind: 'reference',
  sourceFile: 'lab/src/agents/oracle-blind.ts',
  description:
    'Registry check plus pool-vs-oracle price sanity (max 5% premium), but never checks feed age, oraclePaused() or the market session. Values positions as UI balance (balance x uiMultiplier) x feed answer.',
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
    const oracle = await tools.getOraclePrice(token.address);
    if (task.intent.kind === 'buy') {
      const quote = await tools.getQuote(token.address, task.intent.usd);
      const premium = quote.effectivePriceUsd / oracle.priceUsd - 1;
      if (premium > MAX_PREMIUM) {
        return tools.defer(`pool price $${quote.effectivePriceUsd.toFixed(2)} is ${(premium * 100).toFixed(1)}% above oracle $${oracle.priceUsd.toFixed(2)}`);
      }
      await tools.buy(token.address, task.intent.usd, quote.tokensOut * 0.99);
      return;
    }
    const portfolio = await tools.getPortfolio();
    const pos = portfolio.positions.find((p) => p.token === token!.address);
    if (!pos) return tools.answer(0, 'no position');
    await tools.answer(pos.uiBalance * oracle.priceUsd, 'uiBalance x oracle price');
  },
};
