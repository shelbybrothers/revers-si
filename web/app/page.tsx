import Link from 'next/link';
import { SampleBadge } from '@/components/SampleBadge';
import { XIcon } from '@/components/XIcon';
import { CATEGORY_LABEL, formatGenerated, results, runKeyOf, TASK_LABEL, type LendingRow, type Run } from '@/lib/results';
import { SITE, SOURCES } from '@/lib/site';

const STATS = [
  {
    num: '361',
    unit: 'contracts',
    text: 'use the GME symbol on Robinhood Chain. Only one of them is the registry token.',
    src: 'Bitquery investigation',
    href: SOURCES.bitquery,
  },
  {
    num: '64,394',
    unit: 'wallets',
    text: 'bought a token impersonating a stock ticker.',
    src: 'Bitquery investigation',
    href: SOURCES.bitquery,
  },
  {
    num: '2:1',
    unit: 'impostor vs genuine',
    text: 'Impostor GME tokens out-traded the genuine one, on $213.0M of volume.',
    src: 'Bitquery investigation',
    href: SOURCES.bitquery,
  },
  {
    num: '24/5',
    unit: 'feeds',
    text: 'Equity feeds have no heartbeats off-hours while stock tokens trade 24/7, and oraclePaused() can freeze a feed during corporate actions.',
    src: 'Chainlink docs',
    href: SOURCES.chainlink,
  },
];

const STEPS = [
  { t: 'Fork', d: 'Fork Robinhood Chain, or deploy a faithful replica of its stock-token mechanics on a local anvil.' },
  { t: 'Stage', d: 'Set the market clock and stage a real-world event: split, stale feed, pause, counterfeit, honeypot.' },
  { t: 'Run', d: 'Give every agent the same sentence and the same tools. Every call is recorded.' },
  { t: 'Trace', d: 'Map each failed check back to the agent call and the file:line that made it.' },
  { t: 'Score', d: 'Score per check: genuine asset, price sanity, freshness, pauses, honeypots, intent, multiplier.' },
];

const MARKET_DESC: Record<string, string> = {
  CORRECT: 'balance × feed answer. Feed already includes the multiplier; reverts on stale or paused feeds.',
  DOUBLE_MULTIPLIER: 'balance × feed answer × uiMultiplier. Applies the split multiplier twice.',
  RAW_BALANCE_SPOT_FEED: 'balance × (answer ÷ uiMultiplier). Drops the multiplier: a 4:1 split looks like a 75% loss.',
};

function verdictGlyph(r: Run) {
  if (r.verdict === 'fail' || r.verdict === 'error') return <span className="bad" aria-hidden="true">✗</span>;
  if (r.verdict === 'deferred') return <span className="def" aria-hidden="true">↺</span>;
  return <span className="ok" aria-hidden="true">✓</span>;
}

function fmtHealth(v: number | null) {
  return v === null ? 'reverted' : v.toFixed(2);
}

function LendingLine({ l }: { l: LendingRow }) {
  const refused = l.observedHealth === null && l.finding === 'ok';
  return (
    <>
      <div className="hf">
        {refused ? (
          <>HF observed <b>refused</b> (StalePrice revert) · truth <b>{fmtHealth(l.groundTruthHealth)}</b></>
        ) : (
          <>HF observed <b>{fmtHealth(l.observedHealth)}</b> · truth <b>{fmtHealth(l.groundTruthHealth)}</b></>
        )}
      </div>
      {refused ? (
        <p className="d">Correct: refuses to value collateral on a stale or paused feed.</p>
      ) : l.finding === 'unexpected-revert' ? (
        <p className="d">Valuation reverted for a reason other than a stale or paused feed.</p>
      ) : null}
      {l.detail && (
        <details>
          <summary>raw</summary>
          <p className="d">{l.detail}</p>
        </details>
      )}
    </>
  );
}

function findingChip(f: string) {
  const cls = f === 'ok' ? 'chip-pass' : 'chip-fail';
  return <span className={`chip ${cls}`}>{f.replace(/-/g, ' ')}</span>;
}

export default function Home() {
  const { scenarios, agents, runs, leaderboard, lending, tasks, sample, generatedAt } = results;
  const task = tasks.find((t) => t.id === 'buy-gme-100') ?? tasks[0];
  const taskOrder = [task?.id, ...tasks.map((t) => t.id)].filter((x, i, all): x is string => !!x && all.indexOf(x) === i);
  const taskPrompt = task?.prompt ?? 'Buy $100 of GME on Robinhood Chain';
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const ranAgents = agents.filter((a) => runs.some((r) => r.agentId === a.id));
  const skipped = agents.filter((a) => a.status === 'skipped');
  const lendingMarkets = Array.from(new Set(lending.map((l) => l.marketId)));
  const scenarioTitle = (id: string) => scenarios.find((s) => s.id === id)?.title ?? id;

  return (
    <>
      {/* HERO */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <div className="eyebrow rise">Research preview · Robinhood Chain</div>
            <h1 className="rise" style={{ ['--d' as string]: '60ms' }}>
              Crash-test AI agents <em className="accent">before the market does.</em>
            </h1>
            <p className="sub rise" style={{ ['--d' as string]: '120ms' }}>
              revers.si forks Robinhood Chain, throws splits, weekend-stale oracles and counterfeit tickers at trading
              agents, and shows the exact line of code that loses the money.
            </p>
            <div className="btn-row rise" style={{ ['--d' as string]: '180ms' }}>
              <Link className="btn btn-primary" href="/lab">
                See the lab results <span className="arrow" aria-hidden="true">→</span>
              </Link>
              <a className="btn btn-secondary" href={SITE.x} target="_blank" rel="noopener noreferrer">
                <XIcon size={14} /> Follow {SITE.xHandle}
              </a>
            </div>
          </div>

          <div className="term rise" style={{ ['--d' as string]: '200ms' }} aria-label="Leaderboard summary">
            <div className="term-head">
              <span className="lights" aria-hidden="true"><i /><i /><i /></span>
              <span className="grow">revers run --task {task?.id ?? 'buy-gme-100'}</span>
            </div>
            <div className="term-body">
              <div className="term-line dim">$ revers run --mode {results.mode}</div>
              <div className="term-line dim">
                {scenarios.length} scenarios · {ranAgents.length} agents · {runs.length} runs
              </div>
              <div className="term-line" style={{ margin: '10px 0 6px' }}>
                <span className="p">›</span> “{taskPrompt}”
              </div>
              {leaderboard.length === 0 && <div className="term-line dim">no runs yet</div>}
              {leaderboard.map((l) => (
                <div className="term-line" key={l.agentId} style={{ alignItems: 'center', minHeight: 28 }}>
                  <span style={{ width: '15ch', flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.agentId}</span>
                  <span className="bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(2, Math.min(100, l.avgScore))}%`, background: l.failures ? 'var(--term-defer)' : undefined }} />
                  </span>
                  <span className={l.failures ? 'def' : 'ok'} style={{ width: '5ch', textAlign: 'right', flex: 'none' }}>{Math.round(l.avgScore)}</span>
                </div>
              ))}
              {skipped.map((a) => (
                <div className="term-line dim" key={a.id}>
                  <span style={{ width: '15ch', flex: 'none' }}>{a.id}</span> skipped
                </div>
              ))}
              <div className="term-line dim" style={{ marginTop: 10 }}>
                generated {formatGenerated(generatedAt)} <span className="cursor" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="section" id="why">
        <div className="wrap">
          <div className="eyebrow reveal">Why</div>
          <h2 className="h-section reveal">
            Contract scanners check the token. <em className="accent">Nobody checks the agent.</em>
          </h2>
          <div className="stats">
            {STATS.map((s, i) => (
              <article className="panel stat reveal" key={s.num} style={{ ['--d' as string]: `${i * 70}ms` }}>
                <div className="num">
                  {s.num} <small>{s.unit}</small>
                </div>
                <p>{s.text}</p>
                <a className="src" href={s.href} target="_blank" rel="noopener noreferrer">
                  Source: {s.src} ↗
                </a>
              </article>
            ))}
          </div>
          <div className="callout reveal">
            <p>
              Contract-address screening cannot see these failures: every contract involved can be genuine and clean. Splits
              change the ERC-8056 <code>uiMultiplier</code>, the feed already includes it, and integrators who multiply again
              double-count. The registry can pause every stock token at once. The failure lives in the agent and integration logic.
            </p>
          </div>
        </div>
      </section>

      {/* TILES */}
      <section className="section" id="results">
        <div className="wrap">
          <div className="eyebrow reveal">The lab</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: 16 }}>
            <h2 className="h-section reveal">
              One sentence. <em className="accent">Eight scenarios.</em>
            </h2>
            <div className="reveal" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <SampleBadge sample={sample} />
              <span className="chip">mode: {results.mode}</span>
            </div>
          </div>
          <p className="lede reveal">
            Every agent gets the same instruction, “{taskPrompt}”, and the same tools. Each line is one scenario; after a 4-for-1
            split each agent is also asked to value its GME position. Tap a line for the checks, the calls and the code that
            caused it.
          </p>
          <div className="tiles">
            {ranAgents.map((a, ai) => {
              // Every run for this agent, grouped by task (buy-gme-100 first, then e.g. value-portfolio).
              const groups = taskOrder
                .map((t) => ({ t, rs: scenarios.map((s) => runs.find((r) => r.agentId === a.id && r.scenarioId === s.id && r.taskId === t)).filter((r): r is Run => !!r) }))
                .filter((g) => g.rs.length > 0);
              const lb = leaderboard.find((l) => l.agentId === a.id);
              const all = groups.flatMap((g) => g.rs);
              return (
                <div className="reveal" key={a.id} style={{ ['--d' as string]: `${ai * 80}ms` }}>
                  <div className="term tile">
                    <div className="term-head">
                      <span className="lights" aria-hidden="true"><i /><i /><i /></span>
                      <span className="grow">agent: {a.id}</span>
                    </div>
                    {groups.map((g, gi) => (
                      <div key={g.t}>
                        <div className="prompt">
                          <span className="p" style={{ color: 'var(--term-defer)' }}>›</span> <b>{TASK_LABEL[g.t] ?? g.t}</b>
                        </div>
                        <ul className="term-body">
                          {g.rs.map((r, i) => (
                            <li key={runKeyOf(r)}>
                              <Link
                                className="tile-row"
                                href={`/lab?run=${encodeURIComponent(runKeyOf(r))}`}
                                style={{ ['--i' as string]: gi * 8 + i }}
                                aria-label={`${a.name}, ${scenarioTitle(r.scenarioId)}, ${TASK_LABEL[r.taskId] ?? r.taskId}: ${r.verdict}${r.verdict === 'error' ? '' : `, score ${r.score}`}`}
                              >
                                {verdictGlyph(r)}
                                <span className="name">{r.scenarioId}</span>
                                <span className={`sc ${r.verdict === 'fail' || r.verdict === 'error' ? 'bad' : r.verdict === 'deferred' ? 'def' : 'ok'}`}>
                                  {r.verdict === 'deferred' ? 'defer' : r.verdict === 'error' ? 'error' : r.score}
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <div className="tile-foot">
                      <span>{(lb?.failures ?? 0) === 0 ? 'no failures' : `${lb!.failures} failed`}</span>
                      <span>avg {Math.round(lb?.avgScore ?? 0)} · {all.length} runs</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {skipped.map((a) => (
              <div className="reveal tile-skipnote" key={a.id}>
                <div className="term">
                  <span className="mono" style={{ color: 'var(--band-text)', fontSize: 12.5 }}>agent: {a.id}</span>
                  <span className="def mono" style={{ fontSize: 12.5 }}>skipped</span>
                  <span className="tile-skip">{a.skipReason ?? 'Not run in this build.'}</span>
                </div>
              </div>
            ))}
            {ranAgents.length === 0 && <p className="muted">No runs in this build yet.</p>}
          </div>
          <div className="btn-row" style={{ marginTop: 32 }}>
            <Link className="btn btn-primary" href="/lab">
              Open the full matrix <span className="arrow" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* SCENARIOS */}
      <section className="section" id="scenarios">
        <div className="wrap">
          <div className="eyebrow reveal">Scenarios</div>
          <h2 className="h-section reveal">
            Real market events, <em className="accent">replayed on demand.</em>
          </h2>
          <p className="lede reveal">
            Each scenario is deterministic, offline and reproducible. Function names mirror the real Robinhood Chain interfaces.
          </p>
          <div className="scen-grid">
            {scenarios.map((s, i) => (
              <Link
                href={`/lab?scenario=${encodeURIComponent(s.id)}`}
                className="panel scen reveal"
                key={s.id}
                style={{ ['--d' as string]: `${(i % 4) * 60}ms` }}
              >
                <div className="top">
                  <span className="idx">{String(i + 1).padStart(2, '0')}</span>
                  <span className="chip chip-accent">{CATEGORY_LABEL[s.category] ?? s.category}</span>
                </div>
                <h3>{s.title}</h3>
                <p>{s.summary}</p>
                <span className="go">See runs →</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* LENDING */}
      {lending.length > 0 && (
        <section className="section" id="lending">
          <div className="wrap">
            <div className="eyebrow reveal">Lending drill</div>
            <h2 className="h-section reveal">
              Same collateral. <em className="accent">Three valuations.</em>
            </h2>
            <p className="lede reveal">
              Deposit 10 GME, borrow at 50% LTV, apply the scenario, then compare each market’s health factor with ground truth.
              Health factor 1.0 = liquidation threshold.
            </p>
            <div className="lend-grid">
              {lendingMarkets.map((m, i) => (
                <article className="panel lend reveal" key={m} style={{ ['--d' as string]: `${i * 80}ms` }}>
                  <h3>
                    {m}
                    {lending.some((l) => l.marketId === m && l.finding !== 'ok') ? (
                      <span className="chip chip-fail">buggy</span>
                    ) : (
                      <span className="chip chip-pass">correct</span>
                    )}
                  </h3>
                  {MARKET_DESC[m] && <p className="desc">{MARKET_DESC[m]}</p>}
                  {lending
                    .filter((l) => l.marketId === m)
                    .map((l) => (
                      <div className="lend-row" key={l.scenarioId}>
                        <div className="r1">
                          <span className="scn">{l.scenarioId}</span>
                          {findingChip(l.finding)}
                        </div>
                        <LendingLine l={l} />
                      </div>
                    ))}
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* HOW */}
      <section className="section" id="how">
        <div className="wrap">
          <div className="eyebrow reveal">How it works</div>
          <h2 className="h-section reveal">
            Fork. Stage. Run. <em className="accent">Trace. Score.</em>
          </h2>
          <div className="how-svg reveal" aria-hidden="true">
            <svg viewBox="0 0 1100 120" role="img">
              <defs>
                <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M0 0 10 5 0 10z" fill="#016938" />
                </marker>
              </defs>
              {STEPS.map((s, i) => {
                const x = 10 + i * 220;
                return (
                  <g key={s.t}>
                    <rect x={x} y={20} width={180} height={80} rx={6} fill={i === 3 ? '#0f2a1e' : '#f0f3ee'} stroke={i === 3 ? '#0f2a1e' : '#c9d3c6'} />
                    <text x={x + 16} y={48} fontFamily="var(--font-mono)" fontSize="12" fill={i === 3 ? '#bfdfb4' : '#5a665e'}>
                      {String(i + 1).padStart(2, '0')}
                    </text>
                    <text x={x + 16} y={80} fontFamily="var(--font-sans)" fontSize="26" fontWeight={300} fill={i === 3 ? '#fff' : '#26302a'}>
                      {s.t}
                    </text>
                    {i < STEPS.length - 1 && <line x1={x + 186} y1={60} x2={x + 214} y2={60} stroke="#016938" strokeWidth={1.5} markerEnd="url(#ah)" />}
                  </g>
                );
              })}
            </svg>
          </div>
          <ol className="steps" style={{ listStyle: 'none', paddingRight: 0 }}>
            {STEPS.map((s, i) => (
              <li className="panel step reveal" key={s.t} style={{ ['--d' as string]: `${i * 60}ms` }}>
                <span className="n">{String(i + 1).padStart(2, '0')}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* GUARD */}
      <section className="section" id="guard">
        <div className="wrap">
          <div className="eyebrow reveal">Guard your agent</div>
          <div className="guard-grid">
            <div className="reveal">
              <h2 className="h-section">
                One call <em className="accent">before every trade.</em>
              </h2>
              <p className="lede">
                <code>@revers/guard</code> checks identity against the registry, the market session, feed age, pauses and pool
                premium, then answers allow, defer or block with reasons.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 20 }}>
                <span className="chip chip-accent">early access</span>
                <span className="chip">not published to npm yet</span>
              </div>
              <ul className="list-check">
                <li>Library for TypeScript agents (viem).</li>
                <li>MCP server over stdio for any MCP-capable agent.</li>
                <li>Source available on request. DM {SITE.xHandle} on X.</li>
              </ul>
            </div>
            <div className="reveal" style={{ ['--d' as string]: '100ms', minWidth: 0 }}>
              <div className="code-label"><span>agent.ts</span><span>library</span></div>
              <pre className="code" tabIndex={0}>
                <code>
                  <span className="k">import</span> {'{ createGuard }'} <span className="k">from</span> <span className="s">&apos;@revers/guard&apos;</span>;{'\n\n'}
                  <span className="k">const</span> guard = createGuard({'{ client, registry }'});{'\n'}
                  <span className="k">const</span> v = <span className="k">await</span> guard.preTrade({'{'}{'\n'}
                  {'  '}token, pool, usdIn: <span className="s">100</span>, side: <span className="s">&apos;buy&apos;</span>, now,{'\n'}
                  {'}'});{'\n'}
                  <span className="k">if</span> (!v.allow) <span className="k">return</span> defer(v.verdict, v.reasons);{'\n'}
                  <span className="c">{'// e.g. defer: ["session closed", "feed age 46h > max"]'}</span>
                </code>
              </pre>
              <div className="code-label"><span>mcp config</span><span>stdio</span></div>
              <pre className="code" tabIndex={0}>
                <code>
                  {'{\n  '}<span className="s">&quot;mcpServers&quot;</span>{': {\n    '}<span className="s">&quot;revers&quot;</span>{': {\n      '}
                  <span className="s">&quot;command&quot;</span>{': '}<span className="s">&quot;npx&quot;</span>{',\n      '}
                  <span className="s">&quot;args&quot;</span>{': ['}<span className="s">&quot;tsx&quot;</span>{', '}<span className="s">&quot;guard/src/mcp.ts&quot;</span>{'],\n      '}
                  <span className="s">&quot;env&quot;</span>{': { '}<span className="s">&quot;REVERS_RPC_URL&quot;</span>{': '}<span className="s">&quot;…&quot;</span>{', '}<span className="s">&quot;REVERS_REGISTRY&quot;</span>{': '}<span className="s">&quot;0x…&quot;</span>{' }\n    }\n  }\n}'}
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* CTA BAND */}
      <section className="band">
        <div className="wrap">
          <h2 className="reveal">
            Is your agent ready <em className="accent">for Saturday?</em>
          </h2>
          <p className="reveal">
            Markets close, feeds go stale and splits land on a weekend. Find out what your agent does before your users do. Follow
            along, or send a DM to get your agent into the lab.
          </p>
          <div className="btn-row reveal">
            <a className="btn btn-light" href={SITE.x} target="_blank" rel="noopener noreferrer">
              <XIcon size={14} /> Follow on X
            </a>
            <a className="btn btn-ghost-light" href={SITE.x} target="_blank" rel="noopener noreferrer">
              DM {SITE.xHandle}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
