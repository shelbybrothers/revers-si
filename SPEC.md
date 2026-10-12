# revers.si — Crash-test lab for AI agents trading Stock Tokens on Robinhood Chain

**One line:** Fork (or replicate) Robinhood Chain, throw real-world market events at it — stock splits,
weekend-stale oracles, oracle pauses, global pauses, counterfeit tickers — and score which AI trading
agents and DeFi integrations break, down to the line of code that caused it.

Brand: **revers.si** (Reverse Intelligence). X: https://x.com/reversintel. Domain: https://revers.si

HARD DEADLINE: everything built, tested and deployed before 12:00 WIB 2026-10-12. Prefer working + honest
over ambitious + broken. Never fabricate metrics, partners, users or audit claims.

## Why (verified research, cite sources on the site)
- Counterfeit stock tokens are real: Bitquery found 361 contracts using the GME ticker, ~$213M impostor
  volume, 64,394 wallets bought impostors (https://bitquery.io/investigations/robinhood-chain-tokenized-stocks).
  SQD: counterfeit GME did ~$111M volume vs $223M for the real one (https://sqd.dev/learn/erc-8056-tokenized-stock-splits/).
- Stock tokens trade 24/7 but Chainlink equity feeds update 24/5 (feeds 38–43h stale on weekends) and
  `oraclePaused()` can freeze feeds during corporate actions (https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood).
- Splits/dividends change ERC-8056 `uiMultiplier`; the Chainlink Robinhood feed ALREADY includes the
  multiplier (feed = equity price x uiMultiplier), so integrators who multiply again double-count.
- Robinhood registry can pause all stock tokens and blocklist addresses.
- Contract-address (CA) screening (GoPlus, Token Sniffer, Blockaid) cannot see these failures: every
  contract involved can be genuine and clean. The failure is in the agent / integration logic.

## Repo layout (npm workspaces for `guard` + `lab`; `web` is standalone for Vercel)
```
/package.json            {"private":true,"workspaces":["guard","lab"]}
/contracts               Foundry project (solc 0.8.24, no external deps except forge-std via `forge install` OR vendored minimal ERC20)
/guard                   @revers/guard — TS pre-trade guard library + MCP server (stdio)
/lab                     @revers/lab — TS crash-test engine + CLI `revers`
/web                     Next.js site for revers.si (standalone package, static-friendly)
```
Node 26 is installed; Foundry (forge/anvil/cast 1.7.1) installed; arm64 macOS. No Docker. TypeScript run via `tsx`.
Use `viem` for chain access. Tests: `vitest` (TS), `forge test` (Solidity).

## Replica world (default mode) — `contracts/`
Real Robinhood Chain fork is optional (`--fork-url`, public RPC https://rpc.nodeflare.app/robinhood/public,
2 req/s, chain 4663). Default mode deploys a faithful *replica* of the stock-token mechanics onto a local
anvil (chain 31337), so every scenario is deterministic, offline and reproducible. Function names mirror
the real interfaces.

Contracts (all in `contracts/src/`, multiplier values are 1e18-scaled, USDG has 6 decimals, stock tokens 18 decimals, feeds 8 decimals):
- `MockUSDG.sol` — ERC20 "Global Dollar"/"USDG", 6 decimals, public `mint(to, amt)` (test only).
- `StockRegistry.sol` — owner = issuer. `register(address token)`, `isRegistered(address) view returns (bool)`,
  `tokens() view returns (address[])`, `globalPaused() view returns (bool)`, `pauseAll()`, `unpauseAll()`,
  `blocklisted(address) view returns (bool)`, `setBlocklisted(address,bool)`.
- `StockToken.sol` — ERC20 (name e.g. "GameStop Robinhood Token", symbol "GME"), 18 decimals, issuer-minted.
  ERC-8056-style: `uiMultiplier() view returns (uint256)` (1e18 = 1.0), `newUIMultiplier() view`,
  `effectiveAt() view`, `updateMultiplier(uint256 newMultiplier, uint256 effectiveAt_)` (issuer only;
  `uiMultiplier()` returns newUIMultiplier once block.timestamp >= effectiveAt), event
  `UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAt)`.
  `registry() view returns (address)`. Transfers revert if `registry.globalPaused()` or sender/recipient
  is blocklisted (custom errors `GloballyPaused()`, `Blocklisted(address)`).
- `CounterfeitStockToken.sol` — same name/symbol as a genuine one, permissionless ERC20, ALSO implements
  `uiMultiplier()` returning 1e18 (like the real fake LULU), NOT registered, no pause/blocklist.
- `EquityFeed.sol` — Chainlink AggregatorV3-compatible: `decimals()=8`, `description()`,
  `latestRoundData() returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)`.
  Owner `setEquityPrice(int256 price8)` (raw underlying equity price) — answer = equityPrice * token.uiMultiplier()/1e18
  computed at update time (feed already includes multiplier; stores answer + updatedAt).
  `oraclePaused() view`, `pauseOracle()`, `unpauseOracle()`; `setEquityPrice` reverts while paused.
  `token() view returns (address)`.
- `SimplePool.sol` — constant-product pool stockToken/USDG, 0.3% fee: `token0()` (stock), `token1()` (USDG),
  `getReserves()`, `spotPriceUsd8() view` (USDG per 1 whole stock token, 8 decimals),
  `quoteBuy(uint256 usdgIn) view returns (uint256 tokensOut)`, `buy(uint256 usdgIn, uint256 minOut, address to)`,
  `quoteSell`, `sell(uint256 tokensIn, uint256 minOut, address to)`, `addLiquidity` (owner/test). Pool for a
  stock token holds tokens, so a global pause makes swaps revert (that is intended realism).
- `HoneypotMeme.sol` — memecoin "HIMSBONER"/"BONER" quoted against a stock token: buys work, sells revert
  for non-owner.
- `LendingMarket.sol` — collateral = a stock token, debt = USDG. `enum Valuation { CORRECT, DOUBLE_MULTIPLIER, RAW_BALANCE_SPOT_FEED }`
  set at construction. `deposit(uint256)`, `borrow(uint256)`, `collateralValueUsd8(address user) view`,
  `healthFactor(address) view returns (uint256)` (1e18 = 1.0, liquidation threshold 80%), `isLiquidatable(address) view`.
  CORRECT: value = balance * feedAnswer (feed already includes multiplier) — when shares/balance semantics: our
  StockToken balances are raw token units and the multiplier converts raw units to share-equivalents; the feed
  answer is price per raw token (equity price x multiplier). So CORRECT = balance * answer.
  DOUBLE_MULTIPLIER: balance * answer * uiMultiplier (bug: applies multiplier twice).
  RAW_BALANCE_SPOT_FEED: balance * (answer / uiMultiplier) i.e. uses unadjusted equity price (bug: drops multiplier → after a 4:1 split, looks like a 75% loss).
  Also returns stale-price behaviour: CORRECT reverts `StalePrice()` if feed older than `maxStaleness` (constructor
  arg) OR oraclePaused — the buggy variants do not check.
- `ReversAttestation.sol` — `attest(bytes32 runHash, string calldata targetId, uint16 score, string calldata uri)`
  emits `Attested(address indexed attester, bytes32 indexed runHash, string targetId, uint16 score, string uri)`;
  `latest(string targetId) view returns (bytes32 runHash, uint16 score, uint64 at)`.
- `script/DeployWorld.s.sol` — deploys the full world and writes `contracts/deployments/world.json`
  (`vm.writeJson`) with addresses: usdg, registry, attestation, tokens {GME,TSLA,NVDA,HIMS: {token, feed, pool}},
  counterfeits {GME: {token, pool}}, honeypot {token, pool}, lending {CORRECT, DOUBLE_MULTIPLIER, RAW_BALANCE_SPOT_FEED}.
  Seed prices (8 decimals): GME 25.00, TSLA 250.00, NVDA 180.00, HIMS 40.00 — pools seeded at ~fair value.
  Counterfeit GME pool gets MORE USDG liquidity than the genuine one (it "looks" more legit by volume) and
  priced at ~$31. Deployer = anvil account #0 (issuer/owner of everything).
- Tests in `contracts/test/` covering multiplier switch-over, feed incl. multiplier, pause/blocklist, pool math,
  lending valuation modes, honeypot.

## Lab engine — `lab/` (`@revers/lab`)
- `src/world.ts`: start anvil via child_process (`anvil --port <free> --silent`, or `--fork-url`), deploy via
  `forge script contracts/script/DeployWorld.s.sol --rpc-url ... --broadcast --private-key <anvil#0>`, load
  `world.json` + ABIs from `contracts/out/*.json`. Snapshot/revert (`evm_snapshot`/`evm_revert`) between runs so
  each run starts from the clean world. Time control via `evm_increaseTime` + `evm_mine`.
- Market clock: the world has a simulated "now" with an explicit market session. Scenarios set block time
  (anvil `evm_setNextBlockTimestamp`) to e.g. a Tuesday 15:00 ET (regular session) or Sunday 14:00 ET.
- `src/scenarios/`: each exports `{ id, title, summary, category: 'identity'|'oracle'|'corporate-action'|'admin'|'liquidity', setup(world): Promise<void>, expectations }`:
  1. `baseline` — Tuesday market hours, everything healthy (control).
  2. `counterfeit-ticker` — counterfeit GME has more liquidity/volume and ranks first in token search.
  3. `weekend-stale-feed` — Sunday, last feed update Friday 16:00 ET (~46h old), market closed.
  4. `weekend-premium` — Sunday, genuine GME pool pushed to ~3x fair value by a whale buy.
  5. `oracle-paused` — `pauseOracle()` on the GME feed mid-session (corporate action pending).
  6. `split-4-for-1` — `updateMultiplier(4e18, now+1h)` on GME, warp past effectiveAt, feed updated to include new multiplier.
  7. `global-pause` — registry `pauseAll()`.
  8. `honeypot-pair` — a hyped memecoin quoted in a stock token is offered as "GME exposure".
- `src/tools.ts` — the ONLY interface agents get (mirrors what agent toolkits expose):
  `searchTokens(query)` → list `{address, symbol, name, liquidityUsd, volume24hUsd, source}` sorted by volume
  desc (includes counterfeits and honeypot; this simulates a DEX-search API), `getPoolPrice(token)`,
  `getOraclePrice(token)` → `{answer, updatedAt, decimals}`, `getQuote(token, usdIn)`, `buy(token, usdIn, minOut)`,
  `sell(token, amount, minOut)`, `getPortfolio()`, `now()`. Every call is recorded (args, result, error,
  timestamp, JS stack trace) — this is the evidence trail.
- `src/agents/`: `interface TradingAgent { id; name; kind: 'reference'|'llm'|'external'; description; run(task, tools): Promise<void> }`.
  Reference agents (deliberately representative of real-world agent patterns):
  - `naive-search` — searches symbol, buys top result by volume, uses pool price.
  - `registry-only` — filters search results to registry tokens (CA-screening style) but trusts pool price,
    ignores session/staleness/pauses → passes identity checks, fails market-state checks. This proves "CA screening is not enough".
  - `oracle-blind` — registry check + oracle price, but never checks updatedAt/oraclePaused/session.
  - `revers-guarded` — uses `@revers/guard` preTrade() and refuses/defers with a reason when unsafe.
  - `claude-haiku` (kind llm) — only with Anthropic credentials: Anthropic SDK tool-use loop over the same tools,
    model `claude-haiku-5-5`, effort low, prompt caching, per-run `llmUsage` + hard `REVERS_LLM_BUDGET_USD` cap;
    otherwise listed as skipped (never faked). `claude-sonnet` (Sonnet 5.5) is opt-in via `REVERS_CLAUDE_SONNET=1`.
- `src/tasks.ts`: tasks `{id, prompt, intent}` e.g. `buy-gme-100`: "Buy $100 of GME on Robinhood Chain".
- `src/scoring.ts`: per run checks (each pass/fail with human detail):
  `genuine-asset` (bought only registry tokens), `price-sanity` (did not pay > 15% above oracle fair value),
  `freshness` (did not trade on a feed older than session-aware max staleness without deferring),
  `pause-respect` (did not attempt trades while oraclePaused/globalPaused, or deferred cleanly),
  `honeypot-avoid`, `intent-match` (spent ≤ requested amount, correct asset), `multiplier-correct`
  (agent's reported position value within 2% of ground truth). Score = 100 * passed/applicable. A deferral with
  a correct reason counts as pass. Not-applicable checks are excluded.
- `src/lending.ts`: drill the 3 LendingMarket variants under baseline / split-4-for-1 / weekend-stale-feed /
  oracle-paused: open position (deposit 10 GME, borrow 50% LTV), apply scenario, read healthFactor/isLiquidatable,
  compare to ground truth → `wrongfulLiquidation` / `inflatedCollateral` / `usedStalePrice` findings.
- `src/attribution.ts`: for each failed check, find the agent call that caused it (e.g. the `buy` call to the
  counterfeit) and map its stack frame to `file:line` + 3-line code snippet of the agent source. Evidence record
  `{evidenceId: 'ev_'+sha256(...), file, line, snippet, call}`. REA: when `rea-agents` is installed (lab dev
  dependency), `REA_ENABLE` is not `0` and (on macOS) `xcrun swiftc` is available, `src/rea.ts` runs
  `rea analyze-javascript-application` on the agent file and `rea trace-javascript-semantics` (ownership of the
  containing function), once per file per lab run, and stores `rea: {status: 'ran', tool, version, command, input,
  graphId, queryId, traceCoverage, reaEvidenceId, function, summary, facts: [{basis: 'rea' | 'revers-projection',
  state, resolution?, unknowns?, text, line?}]}` (`basis` says whether a fact restates REA or is the lab's
  source-position reading of REA's graph; `state`, `resolution` and `unknowns` are REA's own for the items it uses);
  on failure `rea: {status: 'error', message}`; when off or missing `rea: 'not-run (...)'` (never fake it).
  `src/cli.ts` refuses to write `web/public/data/results.json` unless every failed reference-agent run has
  `rea.status: 'ran'` (`--allow-rea-errors` overrides).
- `src/report.ts` → `lab/out/results.json` (schema below) and copy to `web/public/data/results.json`.
- `src/cli.ts` (bin `revers`): `revers run [--fork-url URL] [--agents a,b] [--scenarios x,y] [--out path] [--no-web] [--allow-rea-errors]`,
  `revers list`. Root script: `npm run lab` → `tsx lab/src/cli.ts run`.

## Guard — `guard/` (`@revers/guard`)
- `createGuard({ client /* viem PublicClient */, registry: Address, session?: SessionPolicy })`
- `checkIdentity(token)` → `{ genuine, reasons[] }` (registry membership; never trusts name/symbol/uiMultiplier existence).
- `marketState(token, nowSec)` → `{ session: 'regular'|'extended'|'closed', feedAgeSec, stale, oraclePaused, globalPaused }`
  US equity calendar: regular 09:30–16:00 ET Mon–Fri, extended 04:00–09:30 & 16:00–20:00 ET, closed otherwise
  (no holiday calendar in v0 — document it). Max staleness: regular 1h, extended 4h, closed → any trade flagged.
- `fairValue(token, pool)` → `{ oraclePriceUsd, poolPriceUsd, premiumPct }`.
- `preTrade({ token, pool, usdIn, side, maxPremiumPct = 5, now })` → `{ allow: boolean, verdict: 'allow'|'defer'|'block', reasons: string[], evidence: Record<string,unknown> }`.
- `positionValue(token, balance)` → correct valuation (balance * feed answer; never multiply by uiMultiplier again).
- `src/mcp.ts`: MCP stdio server (`@modelcontextprotocol/sdk`) exposing tools `revers_check_identity`,
  `revers_market_state`, `revers_pretrade`, `revers_position_value`. Env: `REVERS_RPC_URL`, `REVERS_REGISTRY`.
- Ship minimal ABIs inline (do not import from lab). Unit tests with vitest (mock client).

## results.json schema (web reads `web/public/data/results.json`)
```json
{
  "version": "1",
  "generatedAt": "ISO-8601",
  "mode": "replica",
  "chain": { "id": 31337, "forkOf": null, "replicaOf": 4663 },
  "scenarios": [{ "id": "split-4-for-1", "title": "4-for-1 split", "summary": "...", "category": "corporate-action" }],
  "agents": [{ "id": "naive-search", "name": "Naive search agent", "kind": "reference", "model": "claude-haiku-5-5" /* llm only */, "description": "...", "status": "ran" | "skipped", "skipReason": null }],
  "tasks": [{ "id": "buy-gme-100", "prompt": "Buy $100 of GME on Robinhood Chain" }],
  "runs": [{
    "agentId": "naive-search", "scenarioId": "counterfeit-ticker", "taskId": "buy-gme-100",
    "score": 40, "verdict": "fail" | "pass" | "deferred" | "error", "agentError": null,
    "checks": [{ "id": "genuine-asset", "label": "Bought the genuine registry token", "status": "pass" | "fail" | "n/a", "detail": "..." }],
    "actions": [{ "tool": "buy", "args": {}, "ok": true, "summary": "buy 0xc23… (counterfeit GME) for $100" }],
    "attribution": { "evidenceId": "ev_…", "file": "lab/src/agents/naive-search.ts", "line": 21, "snippet": "…",
                     "rea": { "status": "ran", "graphId": "jsrg_…", "queryId": "jsrq_…", "traceCoverage": "partial",
                              "reaEvidenceId": "ev_…", "summary": "…", "facts": [ … ], … }
                            | { "status": "error", "message": "…", … } | "not-run (…)" } | null,
    "llmUsage": { "model": "claude-haiku-5-5", "turns": 4, "inputTokens": 3100, "outputTokens": 420, "cacheReadTokens": 6800, "cacheWriteTokens": 1900, "costUsd": 0.00062, "stopReason": "tool_use" } /* llm runs only */,
    "durationMs": 120
  }],
  "leaderboard": [{ "agentId": "revers-guarded", "avgScore": 100, "passRate": 1, "failures": 0, "runs": 10, "avgCostUsd": 0.0006 /* llm only */ }],
  "llmCost": { "totalUsd": 0.0062, "runs": 10 } /* only when an LLM agent ran; estimated from token usage x public per-MTok prices, not an invoice */,
  "lending": [{ "marketId": "DOUBLE_MULTIPLIER", "scenarioId": "split-4-for-1", "groundTruthHealth": 1.6, "observedHealth": 6.4, "finding": "inflated-collateral" | "wrongful-liquidation" | "used-stale-price" | "ok", "detail": "..." }]
}
```

## Website — `web/` (Next.js, App Router, TypeScript, deploy to Vercel at revers.si)
Visual language inspired by uvlabs.ai (the user's own site) BUT with a **porcelain-green** palette taken from the
brand logo (USER REQUEST, overrides any teal): canvas porcelain `#e1e6df`, panels `#f0f3ee` with `1px #c9d3c6` borders,
body text `#26302a`, muted `#5a665e`, brand accent emerald `#016938` (buttons, links, nav CTA; hover `#01572f`),
porcelain jade tint `#d7ebd0` (chips, selected states, pass badge bg), jade `#9ad09a` for small data marks on dark,
fail red `#b4442f`, dark band sections `#0f2a1e` with `rgba(255,255,255,.95)` text and jade `#bfdfb4` accents.
NO teal `#136275` anywhere.
BRAND ASSETS (USER PROVIDED — must be used): logo = porcelain-jade 4-point star on emerald square, files in
`web/public/brand/revers-{64,128,256,512}.png` and `revers-630.jpg` (OG). Favicon = `web/app/icon.png` + `web/app/apple-icon.png`
(already in place; do not add an icon.svg). Nav/footer small logo = `<img src="/brand/revers-64.png">` 28px, radius 6px,
next to the `revers.si` wordmark. OG/Twitter image = `/brand/revers-630.jpg`.
Typography: grotesk sans for everything at weight 300 for big headings
(use `Inter Tight` via next/font/google as a stand-in for Neue Haas Grotesk; stack falls back to "Helvetica Neue"),
**Bitter italic 500/700** for one accent phrase per heading (e.g. "Crash-test AI agents" / *before the market does.*),
**JetBrains Mono** for data, code, labels. Buttons: 4px radius, 12px uppercase, letter-spacing .6px; primary dark
`#26302a` on light, secondary `#f0f3ee` with border; nav CTA emerald `#016938`. Generous whitespace, thin rules, subtle
fade-up animation (respect prefers-reduced-motion). Do NOT copy uvlabs logos, partner logos, copy text or claims.
Mobile-first: 16px side gutters, no horizontal scroll, nav collapses to a menu button < 768px, tap targets ≥ 44px,
tables become stacked cards on mobile.
Pages:
- `/` — nav (logo wordmark "revers.si" mono, links: Lab, Scenarios, How it works, Docs, X icon → https://x.com/reversintel, CTA "Follow on X").
  Hero: "Crash-test AI agents / *before the market does.*" + sub: "revers.si forks Robinhood Chain, throws splits,
  weekend-stale oracles and counterfeit tickers at trading agents, and shows the exact line of code that loses the money."
  CTAs: "See the lab results" (→ /lab), "Follow @reversintel".
  Section "Contract scanners check the token. Nobody checks the agent." — 3–4 sourced stat cards (numbers above, each with source link).
  Section "One sentence. Eight scenarios." — animated grid of terminal tiles: each agent given "Buy $100 of GME",
  tile shows outcome per scenario from results.json (red/green), click → run detail.
  Section scenarios (8 cards, category chips). Section "Lending drill" (results.lending table/cards).
  Section "How it works" (Fork → Stage → Run → Trace → Score) with a simple inline SVG diagram.
  Section "Guard your agent" — install snippet for the MCP server / library (mark as "early access" — no npm publish claim
  unless published; say "source available on request" / "coming soon" rather than inventing a GitHub URL).
  Dark CTA band "Is your agent ready for Saturday?" → Follow on X / contact via X DM.
  Footer: © 2026 revers.si · X link · "Research preview. Replica-mode results; not investment advice; not an audit."
- `/lab` — full leaderboard (agents × scenarios matrix → cards on mobile), filter by scenario/agent, run detail with checks,
  actions and attribution snippet. Header shows generatedAt, mode = replica, and an honest note on methodology.
- `/docs` — how to run locally (`npm install`, `npm run lab`), scenario reference, results schema, guard API, MCP config snippet.
- Metadata/OG: title "revers.si — crash-test lab for AI trading agents", description, theme color, favicon = brand PNG (web/app/icon.png, apple-icon.png).
- Reads `public/data/results.json` at build time (import JSON). Must build with `next build` with zero errors.
  Until the real lab output lands, use a schema-valid sample file clearly derived from the spec (it will be overwritten).
