// Banner jobs: source page, output file, pixel size and the manifest text (what_it_shows + alt_text).
// whatItShows / altText may be functions of the live results.json so lab figures in the text match the image.
const POST = 'image/png · X post banner 16:9';
const FOOT = 'Footer: the revers.si logo (a pale jade four-pointed star on an emerald square) with "revers.si", a small note, and the X handle @reversintel.';
const AGENTS = ['naive-search', 'registry-only', 'oracle-blind', 'revers-guarded'];

const runsOf = (d, s, t) => AGENTS.map((a) => d.runs.find((r) => r.agentId === a && r.scenarioId === s && r.taskId === t));
function scenarioLine(d, s) {
  const part = (t, label) => {
    const rs = runsOf(d, s.id, t);
    if (rs.some((r) => !r)) return null;
    const failed = rs.filter((r) => r.verdict === 'fail' || r.verdict === 'error').map((r) => r.agentId);
    const deferred = rs.filter((r) => r.verdict === 'deferred').map((r) => r.agentId);
    let txt = failed.length ? `${failed.length} of 4 failed` : 'all 4 passed';
    if (deferred.length) txt += `, ${deferred.join(' and ')} deferred`;
    return `${label}${txt}`;
  };
  const value = part('value-portfolio', 'valuation ');
  return value ? `${part('buy-gme-100', 'buy ')}; ${value}` : part('buy-gme-100', '');
}
const lend = (d, m, s = 'split-4-for-1') => d.lending.find((l) => l.marketId === m && l.scenarioId === s);

export const JOBS = [
  {
    id: '01-master',
    html: '01-master.html',
    file: '01-master-crash-test.png',
    kind: POST,
    width: 1600,
    height: 900,
    whatItShows: (d) =>
      `Master launch banner with the logo: headline "Crash-test AI agents before the market does.", one-line explanation of the replica lab, and live counts from results.json (${d.scenarios.length} scenarios, ${d.agents.filter((a) => a.kind === 'reference' && a.status === 'ran').length} reference agents, ${d.runs.length} scored runs, Claude agent not run yet). Emerald side panel with the star logo.`,
    altText: (d) =>
      `revers.si banner. On a pale grey-green background with a faint grid, a large thin headline reads "Crash-test AI agents", and below it in dark green italic "before the market does." Smaller text: "Splits, weekend-stale oracles, pauses and counterfeit tickers, staged on a replica of Robinhood Chain Stock Token mechanics. See which agent breaks, and the line of code that did it." Four tags: ${d.scenarios.length} scenarios, ${d.agents.filter((a) => a.kind === 'reference' && a.status === 'ran').length} reference agents, ${d.runs.length} scored runs, and "Claude agent: not run yet". The right third is an emerald panel with the revers.si logo, a glossy pale jade four-pointed star, captioned "Replica mode", "Stock Tokens" and "Crash-test lab for AI agents". ${FOOT} The note reads "Replica-mode results · not investment advice".`,
  },
  {
    id: '02-scanners',
    html: '02-scanners.html',
    file: '02-scanners-vs-agents.png',
    kind: POST,
    width: 1600,
    height: 900,
    whatItShows:
      'Problem framing: "Contract scanners check the token. Nobody checks the agent." with three sourced figures: 361 contracts using the GME symbol on Robinhood Chain (Bitquery), $213.0M of impostor GME volume out-trading the genuine token two to one (Bitquery, data 16-28 Jul 2026), and 24/5 equity feeds vs 24/7 Stock Token trading with no off-hours heartbeats and oraclePaused() (Chainlink docs).',
    altText:
      `Banner on a pale grey-green background. Headline: "Contract scanners check the token." and below it in dark green italic "Nobody checks the agent." Three columns of large numbers, each with a small source line. One: "361 contracts use the GME symbol on Robinhood Chain. Only one of them is the registry token." Source: Bitquery, Jul 2026. Two: "$213.0M traded in impostor GME tokens, out-trading the genuine one two to one." Source: Bitquery, Jul 2026. Three: "24/5 feeds for Stock Tokens that trade 24/7. No heartbeats off-hours, and oraclePaused() can freeze a feed." Source: Chainlink docs. ${FOOT} The note reads "Every contract can be genuine and clean · the loss is in the agent logic".`,
  },
  {
    id: '03-scenarios',
    html: '03-scenarios.html',
    file: '03-eight-scenarios.png',
    kind: POST,
    width: 1600,
    height: 900,
    whatItShows: (d) =>
      `The ${d.scenarios.length} lab scenarios as a 4x2 card grid (baseline, counterfeit ticker, weekend-stale feed, weekend premium, oracle paused, 4-for-1 split, global pause, honeypot pair), each with category, a one-line description and the replica lab result for the 4 reference agents as pass/fail/deferred dots for the task "Buy $100 of GME on Robinhood Chain" (plus the valuation task where it was run). Labelled "Replica lab result"; footer notes reference agents were written for the lab and the Claude agent has not run yet.`,
    altText: (d) => {
      const lines = d.scenarios.map((s) => `${s.title.replace(' (control)', '')}: ${scenarioLine(d, s)}`).join('. ');
      return `Banner titled "One sentence. Eight scenarios." with a dark box showing the task "Buy $100 of GME on Robinhood Chain" and a tag "Replica lab result". Eight cards, each with a dot per reference agent (naive-search, registry-only, oracle-blind, revers-guarded): green check pass, red cross fail, amber ring deferred. ${lines}. Footer notes reference agents written for the lab and that the Claude agent has not run yet.`;
    },
  },
  {
    id: '04-lending',
    html: '04-lending.html',
    file: '04-lending-drill.png',
    kind: POST,
    width: 1600,
    height: 900,
    whatItShows: (d) =>
      `Lending drill, replica lab result: after a 4-for-1 split, three lending-market valuation modes against a ground-truth health factor of ${lend(d, 'CORRECT').groundTruthHealth}. CORRECT ${lend(d, 'CORRECT').observedHealth}, DOUBLE_MULTIPLIER ${lend(d, 'DOUBLE_MULTIPLIER').observedHealth} (split counted twice), RAW_BALANCE_SPOT_FEED ${lend(d, 'RAW_BALANCE_SPOT_FEED').observedHealth} (wrongful liquidation). Dot plot on a 0-7 health factor axis with the 1.0 liquidation line, plus a note on the stale/paused feed runs.`,
    altText: (d) => {
      const t = lend(d, 'CORRECT').groundTruthHealth;
      return `Dark green banner tagged "Replica lab result". Headline: "Same collateral. Three answers." Deposit 10 GME, borrow at 50% LTV, apply a 4-for-1 split, compare each market's health factor with ground truth. A dot chart on an axis from 0 to 7 marks liquidation at 1.0 and ground truth at ${t}. CORRECT reads ${lend(d, 'CORRECT').observedHealth}, matching. DOUBLE_MULTIPLIER, which multiplies by uiMultiplier again, reads ${lend(d, 'DOUBLE_MULTIPLIER').observedHealth}: split counted twice, collateral overvalued 4x. RAW_BALANCE_SPOT_FEED, which divides the feed by uiMultiplier, reads ${lend(d, 'RAW_BALANCE_SPOT_FEED').observedHealth}, below 1.0: a wrongful liquidation. A note adds that on a 46h-old weekend feed and on oraclePaused(), both broken markets kept valuing collateral while CORRECT refused with a StalePrice revert. Footer: revers.si logo, @reversintel, and a note that this is a replica of Robinhood Chain Stock Token mechanics on a local chain, not real chain data.`;
    },
  },
  {
    id: '05-wallet',
    html: '05-wallet.html',
    file: '05-wallet-check.png',
    kind: POST,
    width: 1600,
    height: 900,
    whatItShows:
      'The read-only wallet check at revers.si/wallet: "Genuine or counterfeit? Read-only, no signatures." Shows the only RPC reads used (eth_call, eth_getCode, eth_getBalance), the refused methods (eth_sendTransaction, personal_sign, eth_signTypedData, approvals) and a three-step factory check card: uid(), factory.tokenAddress(uid) == token, CREATE2 fallback computed in the browser, with verdicts Genuine / Not a Robinhood Stock Token / Unknown.',
    altText:
      `Banner on a pale grey-green background. Headline: "Genuine or counterfeit?" and in dark green italic "Read-only, no signatures." Text: revers.si reads, through your own wallet on Robinhood Chain, which Stock Tokens it holds and checks each contract address against the Stock Token factory. Tags: READ-ONLY, eth_call, eth_getCode, eth_getBalance. Struck through as refused: eth_sendTransaction, personal_sign, eth_signTypedData, approvals; nothing is sent to a revers.si server. A card, "The factory check, keyed by address, not name": 1, token.uid() returns a 32-byte id; 2, factory 0x4783…c046 tokenAddress(uid) equals this token; 3, if that can't be read, the CREATE2 address is computed in the browser. Verdicts: Genuine, Not a Robinhood Stock Token, Unknown. Italic line: "Counterfeits copy names and symbols. They can't copy the factory's record." Footer: revers.si logo, @reversintel, and "Independent · not affiliated with Robinhood · not investment advice".`,
  },
  {
    id: '06-token',
    html: '06-token.html',
    file: '06-revers-token.png',
    kind: POST,
    width: 1600,
    height: 900,
    whatItShows:
      '$REVERS token card: the ticker, "Check the contract before you buy.", the full contract address 0x326fcb91685d946529ac68031e95be7dc32e24cc on Robinhood Chain (the only one linked from revers.si), a pointer to revers.si/#token for buy and explorer links, and the risk line: community token, not a Stock Token, volatile, not investment advice.',
    altText:
      `Dark green banner. Very large text "$REVERS" with the dollar sign in pale jade, then "Check the contract before you buy." Label: "Contract address · Robinhood Chain, the only one linked from revers.si". In a code box, the full address: 0x326fcb91685d946529ac68031e95be7dc32e24cc. Below: "Copycats reuse names and tickers. Match the whole address. Buy and explorer links: revers.si/#token". On the right, the revers.si star logo floats in pale jade. Warning line: "$REVERS is a community token, not a Stock Token. Crypto tokens are volatile and you can lose what you put in. Nothing here is investment advice." ${FOOT} The note reads "Independent project · not affiliated with Robinhood".`,
  },
  {
    id: '07-rea',
    html: '07-rea.html',
    file: '07-we-used-rea.png',
    kind: POST,
    width: 1600,
    height: 900,
    whatItShows:
      'Open-source credit: "We used REA. Open source." We used REA (Reverse Engineer Anything, MIT, github.com/morluto/rea, @reatools) while building revers.si, with a status line that the lab now runs REA\'s static analysis on the agent file behind every failed reference-agent run. Quotes the project description from GitHub. A repository card lists targets from the REA README (EVM bytecode, native binaries, WASM, JavaScript/Electron, websites, .NET, Android APKs, firmware, process behavior) and the setup command npx rea-agents setup.',
    altText:
      `Pale grey-green banner. Headline: "We used REA." and in dark green italic "Open source." Text: "We used REA, Reverse Engineer Anything, while building revers.si: an MIT-licensed project from @reatools that connects AI agents to reverse-engineering tools through MCP." A status line: "The lab now runs REA's static analysis on the agent file behind every failed reference-agent run." Quote from REA's GitHub description: "Reverse engineer anything with agents, from app behavior down to native binaries." Links: @reatools on X and morluto/rea on GitHub. A dark green card, "Open-source repository, MIT", shows morluto / rea, "Reverse Engineer Anything", target tags from its README such as EVM bytecode, native binaries, WASM, websites and firmware, and the command "npx rea-agents setup". ${FOOT} The note reads "Thank you to the REA maintainers · @reatools".`,
  },
  {
    id: 'x-header',
    html: 'x-header.html',
    file: 'x-header-1500x500.png',
    kind: 'image/png · X profile header 3:1',
    width: 1500,
    height: 500,
    whatItShows:
      'X profile header for @reversintel: "Crash-test AI agents before the market does." with tags revers.si, Splits, Stale oracles, Pauses, Counterfeit tickers, research preview. Type sits right of x=520 so the profile avatar (lower left) never covers it; emerald gradient stripe along the bottom.',
    altText:
      'revers.si profile header. On a pale grey-green background with a faint grid, a small label reads "Crash-test lab for AI agents · Stock Tokens on Robinhood Chain". Headline: "Crash-test AI agents" and in dark green italic "before the market does." Tags: revers.si, Splits, Stale oracles, Pauses, Counterfeit tickers, and "research preview". A thin emerald-to-jade stripe runs along the bottom edge.',
  },
  {
    id: 'avatar',
    html: 'avatar.html',
    file: 'avatar-1080.png',
    kind: 'image/png · X profile avatar 1:1',
    width: 1080,
    height: 1080,
    whatItShows:
      'Square 1080x1080 logo avatar: the revers.si glossy pale-jade four-pointed star centred on an emerald ground with a soft highlight and a faint grid; the star stays inside the circular crop X applies.',
    altText:
      'revers.si logo: a glossy, pale jade four-pointed star with one long arm sweeping to the lower left, centred on a deep emerald background with a soft light glow behind it.',
  },
];
