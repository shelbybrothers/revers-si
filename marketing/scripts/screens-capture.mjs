// Feature screenshots of the LIVE revers.si site (desktop 1600x900 @2x, mobile 390x844 @3x).
// Writes raw captures + a jobs file to REVERS_RAW_DIR; scripts/screens-finish.py turns them into
// out/screens/*.png and out/screens/MANIFEST.json.
// Usage: node scripts/screens-capture.mjs
import {
  launch, desktopContext, mobileContext, open, settle, rectOf, navHeight, scrollTo, fitRegion, alignTop, resetDesktop, rawShot, writeJobs, MOBILE,
} from './screens-lib.mjs';

const RUN = 'naive-search~counterfeit-ticker~buy-gme-100';
const jobs = [];
const add = (j) => { jobs.push(j); console.log('captured', j.out); };

const browser = await launch();

// ---------------------------------------------------------------- desktop
{
  const ctx = await desktopContext(browser);
  const page = await ctx.newPage();

  await open(page, '/');
  await resetDesktop(page);
  await scrollTo(page, 0);
  add({
    kind: 'desktop', raw: await rawShot(page, 'd01-hero'), out: 'desktop-01-hero.png',
    what_it_shows: 'Home page hero on desktop: headline, two calls to action and the terminal-style leaderboard summary from the replica lab run (Claude Haiku listed as skipped). The live hero sentence says "forks Robinhood Chain" while every published result is replica mode, so this frame is held from posts until the site copy changes.',
    alt_text: 'The revers.si home page on a desktop browser. A porcelain-green page with the headline "Crash-test AI agents before the market does." with the last phrase in green italic. Below it: "revers.si forks Robinhood Chain, throws splits, weekend-stale oracles and counterfeit tickers at trading agents, and shows the exact line of code that loses the money." Two buttons: "See the lab results" and "Follow @reversintel". On the right, a dark terminal panel titled "revers run --task buy-gme-100" shows "8 scenarios, 4 agents, 40 runs" in replica mode for the task "Buy $100 of GME on Robinhood Chain", with score bars: revers-guarded 100, registry-only 86, oracle-blind 86, naive-search 66, and claude-haiku marked skipped. The top bar has Lab, Scenarios, How it works, Docs, an X icon, Connect wallet and Buy $REVERS.',
  });

  let z = await fitRegion(page, { from: '#why .eyebrow', to: '#why .callout', margin: 24 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd02-why'), out: 'desktop-02-why-stats.png',
    what_it_shows: 'The "Why" section: four sourced stat cards (Bitquery, Chainlink docs) and the callout that contract screening cannot see agent-logic failures.',
    alt_text: 'The "Why" section of revers.si. Headline: "Contract scanners check the token. Nobody checks the agent." Four cards with sources: "361 contracts use the GME symbol on Robinhood Chain. Only one of them is the registry token." (Source: Bitquery investigation); "64,394 wallets bought a token impersonating a stock ticker." (Bitquery); "2:1 impostor vs genuine: impostor GME tokens out-traded the genuine one, on $213.0M of volume." (Bitquery); "24/5 feeds: equity feeds have no heartbeats off-hours while Stock Tokens trade 24/7, and oraclePaused() can freeze a feed during corporate actions." (Chainlink docs). A callout below explains that the failure lives in agent and integration logic, not the token contract.',
  });

  z = await fitRegion(page, { from: '#results .eyebrow', to: '#results .btn-row', margin: 24 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd03-results'), out: 'desktop-03-one-sentence-results.png',
    what_it_shows: '"One sentence. Eight scenarios." results grid: one terminal tile per reference agent with pass/fail/defer per scenario, plus the Claude Haiku agent row marked skipped (not simulated). Mode: replica.',
    alt_text: 'The "One sentence. Eight scenarios." section of revers.si, labelled "mode: replica". Text: every agent gets the same instruction, "Buy $100 of GME on Robinhood Chain", and the same tools. Four dark terminal tiles, one per reference agent (naive-search, registry-only, oracle-blind, revers-guarded), list the eight scenarios (baseline, counterfeit-ticker, weekend-stale-feed, weekend-premium, oracle-paused, split-4-for-1, global-pause, honeypot-pair) with a check, cross or defer mark and a score, then a "Value my GME" task. Tile footers read: naive-search 7 failed, avg 66; registry-only 4 failed, avg 86; oracle-blind 4 failed, avg 86; revers-guarded no failures, avg 100, 10 runs each. A strip below says "agent: claude-haiku skipped: No Anthropic credentials; LLM agent not run (results are never simulated)". Button: "Open the full matrix".',
  });

  z = await fitRegion(page, { from: '#scenarios .eyebrow', to: '#scenarios .scen-grid', margin: 24 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd04-scenarios'), out: 'desktop-04-scenarios.png',
    what_it_shows: 'Scenarios section: the eight staged market events as cards with category chips.',
    alt_text: 'The Scenarios section of revers.si, headline "Real market events, replayed on demand." Subtext: each scenario is deterministic, offline and reproducible; function names mirror the real Robinhood Chain interfaces. Eight numbered cards in two rows: 01 Baseline (control), 02 Counterfeit ticker (identity), 03 Weekend-stale feed (oracle), 04 Weekend premium (liquidity), 05 Oracle paused (oracle), 06 4-for-1 split (corporate action), 07 Global pause (admin), 08 Honeypot pair (liquidity). Each card has a short description, such as "Sunday 14:00 ET. Last feed update Friday 16:00 ET (about 46h old)", and a "See runs" link.',
  });

  z = await fitRegion(page, { from: '#lending .eyebrow', to: '#lending .lend-grid', margin: 24 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd05-lending'), out: 'desktop-05-lending-drill.png',
    what_it_shows: 'Lending drill: the same GME collateral valued by three LendingMarket variants (CORRECT, DOUBLE_MULTIPLIER, RAW_BALANCE_SPOT_FEED) compared with ground-truth health factor, replica results.',
    alt_text: 'The Lending drill section of revers.si, headline "Same collateral. Three valuations." Text: deposit 10 GME, borrow at 50% LTV, apply the scenario, then compare each market\'s health factor with ground truth; health factor 1.0 is the liquidation threshold. Three columns. CORRECT (marked correct): health factor observed 1.60 versus truth 1.60 at baseline and after the 4-for-1 split, and it refuses to value collateral on a stale or paused feed. DOUBLE_MULTIPLIER (marked buggy): after the split it observes 6.40 versus truth 1.60, flagged "inflated collateral", and it uses stale prices in the weekend and oracle-paused scenarios. RAW_BALANCE_SPOT_FEED (marked buggy): after the split it observes 0.40 versus truth 1.60, flagged "wrongful liquidation", and also uses stale prices.',
  });

  z = await fitRegion(page, { from: '#how .eyebrow', to: '#how .steps', margin: 24 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd06-how'), out: 'desktop-06-how-it-works.png',
    what_it_shows: 'How it works: Fork, Stage, Run, Trace, Score diagram and step cards.',
    alt_text: 'The "How it works" section of revers.si, headline "Fork. Stage. Run. Trace. Score." A row of five connected boxes, Fork, Stage, Run, Trace (highlighted dark green) and Score, above five step cards: 01 Fork: fork Robinhood Chain, or deploy a faithful replica of its Stock Token mechanics on a local anvil. 02 Stage: set the market clock and stage a real-world event (split, stale feed, pause, counterfeit, honeypot). 03 Run: give every agent the same sentence and the same tools; every call is recorded. 04 Trace: map each failed check back to the agent call and the file:line that made it. 05 Score: score per check (genuine asset, price sanity, freshness, pauses, honeypots, intent, multiplier).',
  });

  z = await fitRegion(page, { from: '#guard .eyebrow', to: '#guard .guard-grid', margin: 24 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd07-guard'), out: 'desktop-07-home-guard.png',
    what_it_shows: 'Home "Guard your agent" section: @revers/guard preTrade code sample and MCP config, marked early access / not published to npm yet.',
    alt_text: 'The "Guard your agent" section of revers.si, headline "One call before every trade." Text: @revers/guard checks identity against the registry, the market session, feed age, pauses and pool premium, then answers allow, defer or block with reasons. Chips: "early access" and "not published to npm yet". A list: library for TypeScript agents (viem), MCP server over stdio for any MCP-capable agent, open source on GitHub. On the right, two dark code panels: agent.ts calling guard.preTrade({ token, pool, usdIn: 100, side: "buy", now }) and deferring when not allowed, with an example reason "feed age 46h > max"; and an MCP config that runs "npx tsx guard/src/mcp.ts" with REVERS_RPC_URL and REVERS_REGISTRY environment variables.',
  });

  // Zoom in (CSS viewport ~1215x684) so the token section alone fills the 16:9 frame under the nav: the next
  // section's dark band stays out of the shot and the small print is larger.
  z = await fitRegion(page, { from: '#token', margin: -2, maxZoom: 1.4 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd08-token'), out: 'desktop-08-revers-token-panel.png',
    what_it_shows: '$REVERS token panel, zoomed so the section fills the frame: the only contract address linked from revers.si, copy button, GMGN and Blockscout links, and the risk/not-investment-advice note. Nothing from the next section is in the frame.',
    alt_text: 'The $REVERS panel on revers.si: the porcelain-jade star logo on emerald, the eyebrow "On Robinhood Chain" and the title "$REVERS the revers.si coin". Text: "Copycat tokens reuse names and tickers, so check the contract address before you buy. This is the only $REVERS contract linked from revers.si:" followed by the full address 0x326fcb91685d946529ac68031e95be7dc32e24cc in a monospace field with a Copy button. Buttons: "Buy $REVERS on GMGN" and "View on Blockscout". Small print: "$REVERS is a community token, not a Stock Token. Crypto tokens are volatile and you can lose what you put in. Nothing here is investment advice."',
  });

  await resetDesktop(page); // back to 1600x900 after the zoomed token shot
  await scrollTo(page, 1e6);
  add({
    kind: 'desktop', raw: await rawShot(page, 'd09-footer'), out: 'desktop-09-cta-footer-rea-credit.png',
    what_it_shows: 'Bottom of the home page: dark "Is your agent ready for Saturday?" band and the footer with the "Built with Reverse Engineer Anything (REA)" credit and GitHub · REA link (open-source REA, github.com/morluto/rea, @reatools).',
    alt_text: 'The bottom of the revers.si home page. A dark green band with the headline "Is your agent ready for Saturday?" with the last words in light jade italic, a paragraph about markets closing, feeds going stale and splits landing on a weekend, and buttons "Follow on X" and "DM @reversintel". Below, the footer: the revers.si logo, "2026 · Built with Reverse Engineer Anything (REA)" as a link, "Research preview. Replica-mode results; not investment advice; not an audit.", and links Lab, Wallet check, Docs, Buy $REVERS, Source, @reversintel and "GitHub · REA".',
  });

  // ----- lab
  await open(page, '/lab');
  await resetDesktop(page);
  await scrollTo(page, 0);
  add({
    kind: 'desktop', raw: await rawShot(page, 'd10-lab'), out: 'desktop-10-lab-leaderboard.png',
    what_it_shows: '/lab header and leaderboard: replica-mode chips (chain 31337, replica of 4663, 8 scenarios, 40 runs), scoring explanation and the four reference-agent score cards.',
    alt_text: 'The revers.si lab page, headline "Leaderboard and run detail." Chips: generated 2026-10-12 04:18 UTC, mode = replica, chain 31337, replica of 4663, 8 scenarios, 40 runs. Text explains the tasks ("Buy $100 of GME on Robinhood Chain" and "What is my GME position worth in USD right now? Report the value."), that score = 100 x passed / applicable checks, that a deferral naming the hazard counts as a pass, and that doing nothing scores 0. Four leaderboard cards: #1 revers-guarded 100 (pass rate 100%, 0 fails), #2 registry-only 86 (60%, 4 fails), #3 oracle-blind 86 (60%, 4 fails), #4 naive-search 66 (30%, 7 fails), each labelled "reference". Filters for scenario, agent, task and verdict appear below.',
  });

  z = await fitRegion(page, { from: '.lab-sum', to: '.matrix-wrap', margin: 20 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd11-matrix'), out: 'desktop-11-lab-matrix.png',
    what_it_shows: '/lab leaderboard cards, filters and the full agent x scenario matrix with pass/fail/deferred cells and the claude-haiku row marked skipped.',
    alt_text: 'The revers.si lab matrix. Four leaderboard cards on top (revers-guarded 100, registry-only 86, oracle-blind 86, naive-search 66), then filters (scenario, agent, task, verdict). A table with agents as rows and the eight scenarios as columns: each cell shows a score out of 100 and a verdict, coloured green for pass, red for fail and amber for deferred. naive-search fails counterfeit-ticker with 25, weekend-stale-feed 75, weekend-premium 50, oracle-paused 80, global-pause 50 and honeypot-pair 25. revers-guarded scores 100 everywhere, deferring in the stale-feed, weekend, oracle-paused and global-pause scenarios. Separate rows show the value-portfolio task, where naive-search and oracle-blind score 50 after the 4-for-1 split. The last row, claude-haiku, is marked skipped.',
  });

  await open(page, `/lab?run=${RUN}`);
  await page.waitForSelector('article.panel.detail .attr', { timeout: 20_000 });
  await settle(page);
  z = await fitRegion(page, { from: 'article.panel.detail', margin: 16 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd12-run'), out: 'desktop-12-lab-run-detail-failing.png',
    what_it_shows: 'Run detail for naive-search x counterfeit-ticker (buy-gme-100): FAIL 25/100, seven checks (3 fail, 1 pass, 3 n/a), the three agent calls, and the attribution to lab/src/agents/naive-search.ts:19 with the code snippet (rea: not-run). Code lines wrap for the still (the site scrolls them sideways), so line 19 is readable whole.',
    alt_text: 'The revers.si run detail panel for "Naive search agent x Counterfeit ticker", verdict FAIL, score 25/100, task buy-gme-100 ("Buy $100 of GME on Robinhood Chain"), 51 ms. Scenario: a permissionless "GME" token with the same name and symbol, not in the registry, has deeper liquidity and is wash-traded to the top of token search. Checks: FAIL "Bought the genuine registry token" (bought the counterfeit GME, not in the issuer registry); FAIL "Paid at most 15% above oracle fair value" ($31.1810 per token vs fair value $25.0000, +24.7%); PASS "Did not trade on a stale feed"; three checks n/a; FAIL "Did what was asked". Agent calls: searchTokens "GME" (top result the counterfeit), getQuote, buy for $100. Attribution: lab/src/agents/naive-search.ts:19 with an evidence id and "rea: not-run", and a dark code snippet, lines 18 to 20, with line 19 highlighted: await tools.buy(top.address, task.intent.usd, quote.tokensOut * 0.99);',
  });

  // ----- wallet
  await open(page, '/wallet');
  await resetDesktop(page);
  await scrollTo(page, 0);
  add({
    kind: 'desktop', raw: await rawShot(page, 'd13-wallet'), out: 'desktop-13-wallet-check.png',
    what_it_shows: '/wallet in its real disconnected state: "Check your Stock Tokens without signing anything", Connect wallet button, read-only chips, and the top of the Your wallet card (Not connected).',
    alt_text: 'The revers.si Wallet check page, not connected. Headline: "Check your Stock Tokens without signing anything." Text: connect a wallet on Robinhood Chain; revers.si reads, through your own wallet, which Stock Tokens it holds and checks each contract address against the Stock Token factory; counterfeits copy names and symbols, they cannot copy the factory\'s record. A green "Connect wallet" button. Chips: read-only; eth_call, eth_getCode, eth_getBalance; Robinhood Chain 4663; list: 192 Stock Tokens, 2026-10-12. A line says "Read-only, no signatures, transactions or approvals, nothing is sent to revers.si", followed by the top of a "Your wallet" card reading "Not connected."',
  });

  z = await fitRegion(page, { from: '.wc-oneline', to: '.wc-grid', margin: 20, align: 'top' });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd14-wallet-cards'), out: 'desktop-14-wallet-cards.png',
    what_it_shows: '/wallet cards, disconnected: Your wallet (Not connected), Stock Token holdings (scan scope: 192 Stock Tokens and 14 lookalikes) and Check a token address (Check button disabled until a wallet on Robinhood Chain is connected).',
    alt_text: 'Three cards on the revers.si Wallet check page, with no wallet connected. "Your wallet": Not connected, with a Connect wallet button. "Stock Token holdings": connect a wallet on Robinhood Chain to scan it for Stock Tokens; it scans 192 Stock Tokens and 14 lookalikes from a list built on 2026-10-12 from a public token list, keeping only addresses that pass the factory check. "Check a token address": paste a contract address; the verdict is keyed by address only because names and symbols can be copied by anyone. An empty 0x... field and a greyed-out Check button, with the hint "Connect a wallet on Robinhood Chain to run the check."',
  });

  // ----- docs
  await open(page, '/docs');
  z = await fitRegion(page, { from: '#guard', to: '#mcp', margin: 20 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd15-docs-guard'), out: 'desktop-15-docs-guard-api.png',
    what_it_shows: '/docs Guard API and MCP server sections: createGuard, checkIdentity, marketState, fairValue, preTrade, positionValue, session policy, and the MCP stdio tools.',
    alt_text: 'The revers.si docs, Guard API and MCP server sections, with the docs side menu on the left. Text: @revers/guard is in early access, not published to npm yet, source in the revers-si repo under guard/. A dark code block lists createGuard({ client, registry, session? }) and the methods checkIdentity (registry membership only, never trusts name or symbol), marketState (session, feed age, stale, oraclePaused, globalPaused), fairValue, preTrade (allow, defer or block with reasons and evidence) and positionValue (balance x feed answer, never multiplied by uiMultiplier again). A note gives the session policy for US equities in ET. The MCP server section lists the stdio tools revers_check_identity, revers_market_state, revers_pretrade and revers_position_value and shows an mcpServers config running "npx tsx guard/src/mcp.ts".',
  });

  z = await fitRegion(page, { from: '#run', margin: 20, extraTop: 0 });
  add({
    kind: 'desktop', zoom: z.zoom, raw: await rawShot(page, 'd16-docs-run'), out: 'desktop-16-docs-run-locally.png',
    what_it_shows: '/docs "Run locally" section: npm install, forge build/test, npm run lab, subset runs, and the optional flags (fork mode, Anthropic key, spend cap).',
    alt_text: 'The revers.si docs page, "Run locally" section. Requirements: Node 20+ with npm, and Foundry (forge, anvil, cast); no Docker. A dark terminal block: npm install; cd contracts && forge build && forge test; npm run lab to run every agent against every scenario; and npx tsx lab/src/cli.ts run with a subset of agents and scenarios. Text explains that the lab starts anvil, deploys the replica world, snapshots it and reverts between runs, writing lab/out/results.json. An "Optional" list covers --fork-url (experimental), ANTHROPIC_API_KEY for the claude-haiku agent (listed as skipped, never simulated, without credentials), ANTHROPIC_WORKSPACE_ID, REVERS_LLM_BUDGET_USD as a hard spend cap, and REVERS_CLAUDE_SONNET=1.',
  });

  await ctx.close();
}

// ---------------------------------------------------------------- mobile
{
  const ctx = await mobileContext(browser);
  const page = await ctx.newPage();
  const CROP_H = MOBILE.w * 5 / 4; // 487.5 CSS px: 4:5 of the 390 px width

  /** Scroll so `target` sits just under the sticky nav, then capture the viewport and crop a 4:5 window from the top. */
  async function crop(target, name, meta, { pad = 12, cropTop = 0 } = {}) {
    const r = await rectOf(page, target);
    if (!r) throw new Error('mobile target missing ' + JSON.stringify(target));
    const nav = await navHeight(page);
    await scrollTo(page, r.y - nav - pad);
    add({ kind: 'mobile-crop', raw: await rawShot(page, name), cropTop, cropH: CROP_H, ...meta });
  }

  await open(page, '/');
  await scrollTo(page, 0);
  add({
    kind: 'mobile-crop', raw: await rawShot(page, 'm01-hero'), cropTop: 0, cropH: CROP_H, out: 'mobile-01-hero-4x5.png',
    what_it_shows: 'Home hero on a phone (390 px wide, 3x), cropped 4:5. Shows the live hero sentence that says "forks Robinhood Chain"; held from posts until the site copy matches the replica-mode results.',
    alt_text: 'The revers.si home page on a phone. The top bar shows the revers.si logo and a menu button. Below: "Research preview, Robinhood Chain" and the headline "Crash-test AI agents before the market does." with the last phrase in green italic, followed by the start of the description about forking Robinhood Chain and throwing splits, weekend-stale oracles and counterfeit tickers at trading agents.',
  });
  {
    // Scroll just far enough that the terminal's claude-haiku (skipped) row is fully on screen.
    const rowBottom = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('.hero .term *')).filter((e) => e.textContent.includes('claude-haiku'));
      const row = els.filter((e) => !els.some((o) => o !== e && e.contains(o))).pop(); // deepest match
      const box = (row?.closest('div') ?? row)?.getBoundingClientRect();
      return box ? box.bottom + scrollY : null;
    });
    await scrollTo(page, rowBottom ? Math.max(0, Math.ceil(rowBottom + 16 - MOBILE.h)) : 70);
  }
  add({
    kind: 'mobile-phone', raw: await rawShot(page, 'm01b-hero-full'), out: 'mobile-01b-hero-phone.png',
    what_it_shows: 'First screen of the home page on a phone (390x844 @3x, scrolled so the terminal\'s claude-haiku skipped row is fully visible) framed on a 1080x1350 porcelain canvas. Shows the hero sentence that says "forks Robinhood Chain"; held from posts until the site copy matches the replica-mode results.',
    alt_text: 'A phone-sized screenshot of the revers.si home page on a light green-grey background. It shows the logo and menu, "Research preview, Robinhood Chain", the headline "Crash-test AI agents before the market does.", the description of how revers.si throws splits, weekend-stale oracles and counterfeit tickers at trading agents and shows the line of code that loses the money, the buttons "See the lab results" and "Follow @reversintel", and a dark terminal panel: revers run --mode replica, 8 scenarios, 4 agents, 40 runs, the sentence "Buy $100 of GME on Robinhood Chain", score bars revers-guarded 100, registry-only 86, oracle-blind 86, naive-search 66, and claude-haiku skipped.',
  });

  await crop('#results .tiles', 'm02-results', {
    out: 'mobile-02-results-tile-4x5.png',
    what_it_shows: 'First agent tile (naive-search) of the "One sentence" results grid on a phone, cropped 4:5.',
    alt_text: 'A dark terminal tile on the revers.si home page on a phone, titled "agent: naive-search", for the task "Buy $100 of GME". Rows list scenarios with marks and scores: baseline 100 pass, counterfeit-ticker 25 fail, weekend-stale-feed 75 fail, weekend-premium 50 fail, oracle-paused 80 fail, split-4-for-1 100 pass, global-pause 50 fail; the tile continues below the crop. Results are from the replica lab.',
  });
  await crop('#scenarios .eyebrow', 'm03-scenarios', {
    out: 'mobile-03-scenarios-4x5.png',
    what_it_shows: 'Scenarios section heading and first scenario cards on a phone, cropped 4:5.',
    alt_text: 'The Scenarios section of revers.si on a phone: the headline "Real market events, replayed on demand.", a note that each scenario is deterministic, offline and reproducible with function names mirroring the real Robinhood Chain interfaces, and the first scenario card, 01 Baseline (control), Tuesday 15:00 ET regular session.',
  });
  await crop('#lending .lend-grid', 'm04-lending', {
    out: 'mobile-04-lending-4x5.png',
    what_it_shows: 'Lending drill first card (CORRECT market) on a phone, cropped 4:5.',
    alt_text: 'The lending drill on revers.si on a phone. A card for the CORRECT lending market, marked correct: balance x feed answer, the feed already includes the multiplier, it reverts on stale or paused feeds. Rows: baseline OK, health factor observed 1.60, truth 1.60; split-4-for-1 OK, observed 1.60, truth 1.60; weekend-stale-feed OK, refused (StalePrice revert).',
  });
  {
    // The whole panel (title through the risk line) is taller than a 4:5 crop at 390 px, so frame the whole phone
    // screen, scrolled so the token section ends at the bottom of the screen: the image never ends on the Buy button.
    const sec = await rectOf(page, '#token');
    await scrollTo(page, sec.y + sec.h - MOBILE.h);
    add({
      kind: 'mobile-phone', raw: await rawShot(page, 'm05-token'), out: 'mobile-05-revers-token-phone.png',
      what_it_shows: '$REVERS token panel on a phone (390x844 @3x) framed on a 1080x1350 canvas: title, the only contract address linked from revers.si (the site wraps it onto two lines at phone width), Copy, Buy on GMGN, View on Blockscout and the full risk line ending "Nothing here is investment advice."',
      alt_text: 'A phone-sized screenshot of the $REVERS panel on revers.si: the emerald star logo, "On Robinhood Chain", the title "$REVERS the revers.si coin", and a warning that copycat tokens reuse names and tickers, so check the contract address before you buy. The only $REVERS contract linked from revers.si, 0x326fcb91685d946529ac68031e95be7dc32e24cc, sits in a monospace box (wrapped onto two lines at phone width) with a Copy button, then the buttons "Buy $REVERS on GMGN" and "View on Blockscout", and the small print: "$REVERS is a community token, not a Stock Token. Crypto tokens are volatile and you can lose what you put in. Nothing here is investment advice."',
    });
  }

  await open(page, '/lab');
  await crop('.lab-sum', 'm06-lab', {
    out: 'mobile-06-lab-leaderboard-4x5.png',
    what_it_shows: '/lab leaderboard cards on a phone, cropped 4:5.',
    alt_text: 'The revers.si lab leaderboard on a phone: score cards for the reference agents, starting with #1 revers-guarded 100 (pass rate 100%, 0 fails) and #2 registry-only 86 (pass rate 60%, 4 fails), each with a green meter, followed by the filters.',
  }, { pad: 16 });

  await open(page, `/lab?run=${RUN}`);
  await page.waitForSelector('article.panel.detail .attr', { timeout: 20_000 });
  await settle(page);
  await crop('article.panel.detail', 'm07-run', {
    out: 'mobile-07-run-detail-header-4x5.png',
    what_it_shows: 'Run detail header for naive-search x counterfeit-ticker on a phone: FAIL, task chips, scenario note and the 25/100 score, cropped 4:5.',
    alt_text: 'The revers.si run detail on a phone for "Naive search agent x Counterfeit ticker". Chips: FAIL, task: buy-gme-100, "Buy $100 of GME on Robinhood Chain", 51 ms. The scenario note says a permissionless "GME" token with the same name and symbol, implementing uiMultiplier() but not in the registry, has deeper liquidity and is wash-traded to the top of token search by 24h volume. The score reads 25/100, with a close button.',
  }, { pad: 8 });
  await crop({ sel: 'article.panel.detail h3', text: 'Checks' }, 'm07b-checks', {
    out: 'mobile-07b-run-detail-checks-4x5.png',
    what_it_shows: 'Checks list of the failing naive-search x counterfeit-ticker run on a phone (FAIL genuine-asset, FAIL price-sanity, PASS freshness, n/a pauses), cropped 4:5.',
    alt_text: 'The Checks list of a failing revers.si lab run on a phone. FAIL "Bought the genuine registry token": bought 0x0E80...58bF (counterfeit GME), which is not in the issuer registry. FAIL "Paid at most 15% above oracle fair value": paid $31.1810 per token vs fair value $25.0000 for GME (+24.7%). PASS "Did not trade on a stale feed": feed 22s old during the regular session. N/A "Respected oracle and global pauses": no pause in effect. These are replica-lab results.',
  }, { pad: 12 });
  {
    // 4:5 window whose bottom edge sits just below the run panel (the attribution block is its last part), so the
    // crop ends on the code block, not mid-sentence in the Methodology note that follows.
    const panel = await rectOf(page, 'article.panel.detail');
    await scrollTo(page, panel.y + panel.h + 32 - CROP_H);
    add({ kind: 'mobile-crop', raw: await rawShot(page, 'm08-attr'), cropTop: 0, cropH: CROP_H,
    out: 'mobile-08-run-attribution-4x5.png',
    what_it_shows: 'Attribution block of the failing run on a phone: lab/src/agents/naive-search.ts:19, evidence id, rea: not-run, and the highlighted code line, wrapped for the still so every line is whole. The 4:5 crop ends just below the code block.',
    alt_text: 'The end of a failing revers.si lab run on a phone. At the top, the last agent call: buy 0x0E80...58bF (counterfeit GME) for $100. Then the Attribution block: the file and line lab/src/agents/naive-search.ts:19, an evidence id starting ev_35ee5d81, and "rea: not-run". A dark code snippet, wrapped to the phone width, shows lines 18 to 20 with line 19 highlighted: const quote = await tools.getQuote(top.address, task.intent.usd); then await tools.buy(top.address, task.intent.usd, quote.tokensOut * 0.99); then return;. The agent bought the top search result, which was the counterfeit GME. Replica-lab result.',
    });
  }

  await open(page, '/wallet');
  await scrollTo(page, 0);
  add({
    kind: 'mobile-phone', raw: await rawShot(page, 'm09-wallet'), out: 'mobile-09-wallet-disconnected-phone.png',
    what_it_shows: '/wallet on a phone in the disconnected state (390x844 @3x), framed on a 1080x1350 canvas.',
    alt_text: 'A phone-sized screenshot of the revers.si Wallet check page, not connected. Headline "Check your Stock Tokens without signing anything." Text explains that revers.si reads, through your own wallet on Robinhood Chain, which Stock Tokens it holds and checks each contract address against the Stock Token factory. A green "Connect wallet" button and chips: read-only; eth_call, eth_getCode, eth_getBalance; Robinhood Chain 4663; list of 192 Stock Tokens.',
  });

  await page.click('.wc-head-cta .btn');
  await page.waitForSelector('.wdlg .wnone', { timeout: 10_000 });
  await page.waitForTimeout(600);
  add({
    kind: 'mobile-phone', raw: await rawShot(page, 'm10-picker'), out: 'mobile-10-wallet-picker-sheet-phone.png',
    what_it_shows: 'The Connect wallet picker sheet on a phone browser with no injected wallet: read-only notice and "Open revers.si in your wallet\'s browser" deep links (MetaMask, Coinbase Wallet, Trust Wallet) plus Robinhood Wallet instructions.',
    alt_text: 'A phone-sized screenshot of the revers.si Connect wallet sheet sliding up over the dimmed Wallet check page. The sheet says: "Read-only. revers.si asks your wallet for your address and network, then reads Robinhood Chain through it. No signatures, no transactions, no approvals." Under "Open revers.si in your wallet\'s browser" it explains that phone browsers can\'t talk to wallet apps directly and offers buttons for MetaMask, Coinbase Wallet and Trust Wallet. A "Robinhood Wallet" section says to open Robinhood Wallet\'s in-app browser and enter revers.si/wallet, with a "Copy link" button. The footer notes revers.si is an independent project, not affiliated with Robinhood.',
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await open(page, '/docs');
  await crop('#guard', 'm11-docs-guard', {
    out: 'mobile-11-docs-guard-4x5.png',
    what_it_shows: '/docs Guard API section on a phone, cropped 4:5, with the code block wrapped for the still so no line is cut at the right edge (the block continues below the crop). Spare: not used in the X calendar (desktop-15 carries the Guard API).',
    alt_text: 'The Guard API section of the revers.si docs on a phone: a note that @revers/guard is in early access and not published to npm yet, with source in the revers-si repo under guard/, and the start of a dark code block showing createGuard({ client, registry, session? }) and guard.checkIdentity(token), which checks registry membership only and never trusts name or symbol.',
  });

  await ctx.close();
}

await browser.close();
const p = writeJobs('screens', jobs);
console.log('jobs ->', p, jobs.length);
