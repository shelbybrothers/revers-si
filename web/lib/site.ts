export const SITE = {
  name: 'revers.si',
  url: 'https://revers.si',
  title: 'revers.si — crash-test lab for AI trading agents',
  description:
    'revers.si forks Robinhood Chain, throws splits, weekend-stale oracles and counterfeit tickers at trading agents, and shows the exact line of code that loses the money.',
  x: 'https://x.com/reversintel',
  xHandle: '@reversintel',
  reaGithub: 'https://github.com/morluto/rea',
} as const;

export const SOURCES = {
  bitquery: 'https://bitquery.io/investigations/robinhood-chain-tokenized-stocks',
  sqd: 'https://sqd.dev/learn/erc-8056-tokenized-stock-splits/',
  chainlink: 'https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood',
} as const;
