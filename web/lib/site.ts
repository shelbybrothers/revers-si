export const SITE = {
  name: 'revers.si',
  url: 'https://revers.si',
  title: 'revers.si — crash-test lab for AI trading agents',
  description:
    'revers.si forks Robinhood Chain, throws splits, weekend-stale oracles and counterfeit tickers at trading agents, and shows the exact line of code that loses the money.',
  x: 'https://x.com/reversintel',
  xHandle: '@reversintel',
  reaGithub: 'https://github.com/morluto/rea',
  source: 'https://github.com/shelbybrothers/revers-si',
} as const;

/** $REVERS on Robinhood Chain. Verified on chain 2026-10-12: name "Revers", symbol REVERS, 18 decimals, 1,000,000,000 supply. */
export const TOKEN = {
  symbol: 'REVERS',
  name: 'Revers',
  address: '0x326fcb91685d946529ac68031e95be7dc32e24cc',
  buyUrl: 'https://gmgn.ai/robinhood/token/0x326fcb91685d946529ac68031e95be7dc32e24cc',
  explorerUrl: 'https://robinhoodchain.blockscout.com/token/0x326fcb91685d946529ac68031e95be7dc32e24cc',
} as const;

export const SOURCES = {
  bitquery: 'https://bitquery.io/investigations/robinhood-chain-tokenized-stocks',
  sqd: 'https://sqd.dev/learn/erc-8056-tokenized-stock-splits/',
  chainlink: 'https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood',
} as const;
