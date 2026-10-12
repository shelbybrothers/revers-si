'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUsd, runKeyOf, TASK_LABEL, type Results, type Run } from '@/lib/results';

type VerdictFilter = 'all' | 'fail' | 'pass' | 'deferred' | 'error';
const key = runKeyOf;

function Chip({ status }: { status: string }) {
  const cls = status === 'pass' ? 'chip-pass' : status === 'fail' || status === 'error' ? 'chip-fail' : status === 'deferred' ? 'chip-deferred' : 'chip-na';
  return <span className={`chip ${cls}`}>{status}</span>;
}

export function LabClient({ data }: { data: Results }) {
  const { scenarios, agents, runs, leaderboard, tasks } = data;
  const [scenario, setScenario] = useState<string>('all');
  const [task, setTask] = useState<string>('all');
  const [agent, setAgent] = useState<string>('all');
  const [verdict, setVerdict] = useState<VerdictFilter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const scrollOnSelect = useRef(false);

  // Read deep links (?run=agent~scenario~task, ?scenario=, ?agent=, ?task=) once on mount.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const s = q.get('scenario');
      const a = q.get('agent');
      const r = q.get('run');
      const t = q.get('task');
      if (s && scenarios.some((x) => x.id === s)) setScenario(s);
      if (t && runs.some((x) => x.taskId === t)) setTask(t);
      if (a && agents.some((x) => x.id === a)) setAgent(a);
      if (r) {
        const [ra, rs, rt] = r.split('~');
        const hit = runs.find((x) => x.agentId === ra && x.scenarioId === rs && (!rt || x.taskId === rt));
        if (hit) {
          scrollOnSelect.current = true;
          setSelected(key(hit));
        }
      }
    } catch {
      /* ignore malformed query */
    }
  }, [agents, runs, scenarios]);

  // Keep the URL shareable.
  useEffect(() => {
    const q = new URLSearchParams();
    if (scenario !== 'all') q.set('scenario', scenario);
    if (agent !== 'all') q.set('agent', agent);
    if (task !== 'all') q.set('task', task);
    if (selected) q.set('run', selected);
    const qs = q.toString();
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url);
  }, [scenario, agent, task, selected]);

  useEffect(() => {
    if (selected && scrollOnSelect.current && detailRef.current) {
      scrollOnSelect.current = false;
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      detailRef.current.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  }, [selected]);

  const visScenarios = useMemo(() => scenarios.filter((s) => scenario === 'all' || s.id === scenario), [scenarios, scenario]);
  const ranAgents = useMemo(() => agents.filter((a) => runs.some((r) => r.agentId === a.id)), [agents, runs]);
  const visAgents = useMemo(() => ranAgents.filter((a) => agent === 'all' || a.id === agent), [ranAgents, agent]);
  const skipped = agents.filter((a) => a.status === 'skipped' && !runs.some((r) => r.agentId === a.id));

  const runFor = useCallback(
    (a: string, s: string, t: string) => runs.find((r) => r.agentId === a && r.scenarioId === s && r.taskId === t),
    [runs],
  );
  // Every task that has runs (buy-gme-100 and value-portfolio): one matrix row per (agent, task).
  const taskIds = useMemo(() => {
    const ids = tasks.map((t) => t.id).filter((id) => runs.some((r) => r.taskId === id));
    for (const r of runs) if (!ids.includes(r.taskId)) ids.push(r.taskId);
    return ids;
  }, [tasks, runs]);
  const visTasks = taskIds.filter((t) => task === 'all' || t === task);
  const rowsFor = (agentId: string) => visTasks.filter((t) => runs.some((r) => r.agentId === agentId && r.taskId === t));
  const taskLabel = (t: string) => TASK_LABEL[t] ?? t;
  const hasErrors = runs.some((r) => r.verdict === 'error');
  const passesVerdict = (r: Run | undefined) => !!r && (verdict === 'all' || r.verdict === verdict);

  const select = (r: Run) => {
    scrollOnSelect.current = true;
    setSelected((cur) => (cur === key(r) ? null : key(r)));
  };

  const sel = selected ? runs.find((r) => key(r) === selected) : undefined;
  const selAgent = sel ? agents.find((a) => a.id === sel.agentId) : undefined;
  const selScen = sel ? scenarios.find((s) => s.id === sel.scenarioId) : undefined;
  const filtered = scenario !== 'all' || agent !== 'all' || verdict !== 'all' || task !== 'all';

  return (
    <>
      <div className="lab-sum" role="group" aria-label="Leaderboard (tap to filter by agent)">
        {leaderboard.map((l, i) => {
          const a = agents.find((x) => x.id === l.agentId);
          return (
            <button
              type="button"
              className="panel lb-card"
              key={l.agentId}
              aria-pressed={agent === l.agentId}
              onClick={() => setAgent((cur) => (cur === l.agentId ? 'all' : l.agentId))}
            >
              <span className="rank">#{i + 1} · {a?.kind ?? 'agent'}</span>
              <span className="nm">{l.agentId}</span>
              <span className="big">{Math.round(l.avgScore)}</span>
              <span className="meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, l.avgScore))}%` }} /></span>
              <span className="sub">
                pass rate {Math.round(l.passRate * 100)}% · {l.failures} fail{l.failures === 1 ? '' : 's'}
                {l.avgCostUsd !== null && <> · ~{formatUsd(l.avgCostUsd)}/run</>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="filters">
        <div className="field">
          <label htmlFor="f-scen">Scenario</label>
          <select id="f-scen" className="select" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="all">All scenarios ({scenarios.length})</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-agent">Agent</label>
          <select id="f-agent" className="select" value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="all">All agents ({ranAgents.length})</option>
            {ranAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        {taskIds.length > 1 && (
          <div className="field">
            <span className="vh" id="f-task">Task</span>
            <label aria-hidden="true">Task</label>
            <div className="seg" role="group" aria-labelledby="f-task">
              {['all', ...taskIds].map((t) => (
                <button type="button" key={t} aria-pressed={task === t} onClick={() => setTask(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <span className="vh" id="f-verdict">Verdict</span>
          <label aria-hidden="true">Verdict</label>
          <div className="seg" role="group" aria-labelledby="f-verdict">
            {(['all', 'fail', 'pass', 'deferred', ...(hasErrors ? (['error'] as const) : [])] as const).map((v) => (
              <button type="button" key={v} aria-pressed={verdict === v} onClick={() => setVerdict(v)}>
                {v}
              </button>
            ))}
          </div>
        </div>
        {filtered && (
          <button
            type="button"
            className="btn btn-secondary reset"
            onClick={() => {
              setScenario('all');
              setAgent('all');
              setVerdict('all');
              setTask('all');
            }}
          >
            Reset filters
          </button>
        )}
      </div>

      {runs.length === 0 ? (
        <div className="panel empty-state">No runs in this results file yet. Run <code>npm run lab</code> to generate them.</div>
      ) : (
        <>
          {/* Desktop matrix */}
          <div className="matrix-wrap">
            <table className="matrix">
              <caption className="vh">Agents by scenario. Each cell shows the run score; select a cell for details.</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 190, paddingLeft: 14 }}>agent \ scenario</th>
                  {visScenarios.map((s) => (
                    <th scope="col" key={s.id} title={s.title}>{s.id}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visAgents.flatMap((a) => rowsFor(a.id).map((t) => (
                  <tr key={`${a.id}~${t}`}>
                    <th scope="row">
                      {a.id}
                      <span className="k">{a.kind} · {t}</span>
                    </th>
                    {visScenarios.map((s) => {
                      const r = runFor(a.id, s.id, t);
                      if (!r || !passesVerdict(r))
                        return (
                          <td key={s.id}>
                            <span className="cell empty" aria-label={r ? 'filtered out' : 'no run'}>·</span>
                          </td>
                        );
                      return (
                        <td key={s.id}>
                          <button
                            type="button"
                            className={`cell ${r.verdict}`}
                            aria-pressed={selected === key(r)}
                            aria-label={`${a.name} on ${s.title}, task ${taskLabel(t)}: ${r.verdict}${r.verdict === 'error' ? '' : `, score ${r.score}`}`}
                            onClick={() => select(r)}
                          >
                            {r.verdict === 'error' ? '!' : r.score}
                            <small>{r.verdict}</small>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                )))}
                {agent === 'all' &&
                  skipped.map((a) => (
                    <tr key={a.id} className="skiprow">
                      <th scope="row">
                        {a.id}
                        <span className="k">{a.kind}{a.model ? ` · ${a.model}` : ''} · skipped</span>
                      </th>
                      <td colSpan={Math.max(1, visScenarios.length)}>{a.skipReason ?? 'Skipped.'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="mcards">
            {visAgents.map((a) => {
              const rs = rowsFor(a.id).flatMap((t) => visScenarios.map((s) => runFor(a.id, s.id, t))).filter(passesVerdict) as Run[];
              const lb = leaderboard.find((l) => l.agentId === a.id);
              return (
                <section className="panel mcard" key={a.id} aria-label={a.name}>
                  <div className="mcard-h">
                    <div>
                      <div className="nm">{a.id}</div>
                      <div className="muted small">{a.description}</div>
                    </div>
                    {lb && <div className="avg" aria-label={`average score ${Math.round(lb.avgScore)}`}>{Math.round(lb.avgScore)}</div>}
                  </div>
                  {rs.length === 0 && <div className="muted small" style={{ padding: '12px 4px' }}>No runs match the filters.</div>}
                  {rs.map((r) => (
                    <button
                      type="button"
                      key={key(r)}
                      className="mrow"
                      aria-pressed={selected === key(r)}
                      onClick={() => select(r)}
                    >
                      <span className="t">
                        {scenarios.find((s) => s.id === r.scenarioId)?.title ?? r.scenarioId}
                        {taskIds.length > 1 && <small className="tk"> · {taskLabel(r.taskId)}</small>}
                      </span>
                      <Chip status={r.verdict} />
                      <span className="sc">{r.verdict === 'error' ? '–' : r.score}</span>
                    </button>
                  ))}
                </section>
              );
            })}
            {agent === 'all' &&
              skipped.map((a) => (
                <section className="panel mcard" key={a.id}>
                  <div className="mcard-h">
                    <div className="nm">{a.id}</div>
                    <span className="chip chip-deferred">skipped</span>
                  </div>
                  {a.description && <div className="muted small" style={{ marginBottom: 6 }}>{a.description}</div>}
                  <div className="muted small">{a.skipReason ?? 'Skipped.'}</div>
                </section>
              ))}
          </div>
        </>
      )}

      <div ref={detailRef} aria-live="polite">
        {sel ? (
          <article className="panel detail" key={selected ?? ''}>
            <div className="detail-h">
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Run detail</div>
                <h2>
                  {selAgent?.name ?? sel.agentId} <span className="muted">×</span> {selScen?.title ?? sel.scenarioId}
                </h2>
                <div className="meta-row" style={{ marginTop: 12 }}>
                  <Chip status={sel.verdict} />
                  <span className="chip">task: {sel.taskId}</span>
                  {data.tasks.find((t) => t.id === sel.taskId)?.prompt && (
                    <span className="chip">“{data.tasks.find((t) => t.id === sel.taskId)!.prompt}”</span>
                  )}
                  {sel.durationMs !== null && <span className="chip">{sel.durationMs} ms</span>}
                  {sel.llmUsage && (
                    <>
                      <span className="chip chip-accent" title="Estimated from token usage and public per-MTok prices; not an invoice">
                        ~{formatUsd(sel.llmUsage.costUsd)} est.
                      </span>
                      <span className="chip" style={{ textTransform: 'none' }}>{sel.llmUsage.model}</span>
                      <span className="chip">
                        {sel.llmUsage.turns} turn{sel.llmUsage.turns === 1 ? '' : 's'}
                      </span>
                      <span className="chip">
                        {(sel.llmUsage.inputTokens + sel.llmUsage.cacheReadTokens + sel.llmUsage.cacheWriteTokens).toLocaleString('en-US')} in
                        {' / '}
                        {sel.llmUsage.outputTokens.toLocaleString('en-US')} out
                      </span>
                      {sel.llmUsage.cacheReadTokens > 0 && (
                        <span className="chip">{sel.llmUsage.cacheReadTokens.toLocaleString('en-US')} cached</span>
                      )}
                    </>
                  )}
                </div>
                {selScen?.summary && <p className="muted" style={{ marginTop: 14, marginBottom: 0, maxWidth: '62ch' }}>{selScen.summary}</p>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {sel.verdict === 'error' ? (
                  <div className="scoreb">
                    error
                  </div>
                ) : (
                  <div className="scoreb">
                    {sel.score}
                    <small>/100</small>
                  </div>
                )}
                <button type="button" className="icon-btn" aria-label="Close run detail" onClick={() => setSelected(null)} style={{ border: '1px solid var(--border)' }}>
                  ✕
                </button>
              </div>
            </div>

            {sel.verdict === 'error' && (
              <p className="small" style={{ marginTop: 16 }}>
                This run was stopped before it could be scored (the agent crashed before its first tool call, or the harness stopped
                it: LLM spend cap, model refusal, truncated output or API error), so it is left out of the leaderboard.
                {sel.agentError && <><br /><code>{sel.agentError}</code></>}
              </p>
            )}
            <div className="detail-grid">
              <div>
                <h3>Checks</h3>
                {sel.checks.length === 0 ? (
                  <p className="muted small">No checks recorded.</p>
                ) : (
                  <ul className="checks">
                    {sel.checks.map((c) => (
                      <li key={c.id} className={c.status === 'n/a' ? 'na' : undefined}>
                        <span><Chip status={c.status} /></span>
                        <div>
                          <div className="lbl">{c.label}</div>
                          {c.detail && <div className="dt">{c.detail}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <h3>Agent calls</h3>
                {sel.actions.length === 0 ? (
                  <p className="muted small">No tool calls recorded.</p>
                ) : (
                  <ol className="actions">
                    {sel.actions.map((a, i) => (
                      <li key={i}>
                        <span className={a.ok ? 'ok' : 'bad'} aria-label={a.ok ? 'ok' : 'error'}>{a.ok ? '✓' : '✗'}</span>
                        <div style={{ minWidth: 0 }}>
                          <span className="tool">{a.tool}</span>
                          <div className="sum">{a.summary}</div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}

                {sel.attribution && (
                  <div className="attr">
                    <h3>Attribution</h3>
                    <div className="loc">
                      <b>
                        {sel.attribution.file}
                        {sel.attribution.line !== null ? `:${sel.attribution.line}` : ''}
                      </b>
                      {sel.attribution.evidenceId && <span>{sel.attribution.evidenceId}</span>}
                      <span>rea: {sel.attribution.rea}</span>
                    </div>
                    {sel.attribution.snippet && (
                      <pre className="code snippet" tabIndex={0}>
                        <code>
                          {sel.attribution.lines.map((ln, i) => (
                            <span key={i} className={`ln${ln.hit ? ' hit' : ''}`} data-n={ln.n ?? ''}>
                              {ln.code || ' '}
                            </span>
                          ))}
                        </code>
                      </pre>
                    )}
                  </div>
                )}
                {!sel.attribution && sel.verdict === 'fail' && <p className="muted small" style={{ marginTop: 16 }}>No attribution recorded for this run.</p>}
              </div>
            </div>
          </article>
        ) : (
          runs.length > 0 && (
            <p className="muted small" style={{ marginTop: 16 }}>
              Select a cell to see the checks, the agent’s calls and the line of code behind a failure.
            </p>
          )
        )}
      </div>
    </>
  );
}
