// revers CLI: `revers run [--fork-url URL] [--agents a,b] [--scenarios x,y] [--tasks t] [--out path] [--no-web] [--no-lending]`, `revers list`.
import { resolve } from 'node:path';
import { AGENTS } from './agents/index.js';
import { runLendingDrill, type LendingResult } from './lending.js';
import { buildResults, DEFAULT_OUT, validateResults, writeResults } from './report.js';
import { plan, runOne, type RunResult } from './runner.js';
import { SCENARIOS } from './scenarios/index.js';
import { TASKS } from './tasks.js';
import { World } from './world.js';

function parseArgs(argv: string[]) {
  const [cmd = 'run', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=', 2);
    if (v !== undefined) flags[k] = v;
    else if (rest[i + 1] && !rest[i + 1].startsWith('--')) flags[k] = rest[++i];
    else flags[k] = true;
  }
  return { cmd, flags };
}

const list = (v: string | boolean | undefined) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : null);

function pick<T extends { id: string }>(all: T[], ids: string[] | null, what: string): T[] {
  if (!ids) return all;
  return ids.map((id) => {
    const x = all.find((a) => a.id === id);
    if (!x) throw new Error(`unknown ${what} "${id}"; known: ${all.map((a) => a.id).join(', ')}`);
    return x;
  });
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  if (cmd === 'list') {
    console.log('Scenarios:');
    for (const s of SCENARIOS) console.log(`  ${s.id.padEnd(20)} [${s.category}] ${s.title}`);
    console.log('Agents:');
    for (const a of AGENTS) {
      const why = a.unavailable?.() ?? null;
      console.log(`  ${a.id.padEnd(20)} [${a.kind}] ${a.name}${why ? ` (skipped: ${why})` : ''}`);
    }
    console.log('Tasks:');
    for (const t of TASKS) console.log(`  ${t.id.padEnd(20)} "${t.prompt}" (scenarios: ${t.scenarios === '*' ? 'all' : t.scenarios.join(', ')})`);
    return;
  }
  if (cmd !== 'run') throw new Error(`unknown command ${cmd}; use "run" or "list"`);

  const agents = pick(AGENTS, list(flags.agents), 'agent');
  const scenarios = pick(SCENARIOS, list(flags.scenarios), 'scenario');
  const tasks = pick(TASKS, list(flags.tasks), 'task');
  const forkUrl = typeof flags['fork-url'] === 'string' ? flags['fork-url'] : undefined;
  const out = typeof flags.out === 'string' ? resolve(process.cwd(), flags.out) : DEFAULT_OUT;

  const t0 = Date.now();
  const world = await World.start({ forkUrl, log: (m) => console.log(`[world] ${m}`) });
  try {
    const status = agents.map((agent) => ({ agent, skipReason: agent.unavailable?.() ?? null }));
    for (const s of status) if (s.skipReason) console.log(`[skip] ${s.agent.id}: ${s.skipReason}`);
    const runnable = status.filter((s) => !s.skipReason).map((s) => s.agent);

    const runs: RunResult[] = [];
    for (const { agent, scenario, task } of plan(runnable, scenarios, tasks)) {
      const r = await runOne(world, agent, scenario, task);
      runs.push(r);
      const failed = r.checks.filter((c) => c.status === 'fail').map((c) => c.id);
      console.log(
        `[run] ${task.id.padEnd(15)} ${scenario.id.padEnd(19)} ${agent.id.padEnd(15)} ${r.verdict.padEnd(8)} ${String(r.score).padStart(3)}${failed.length ? `  fail: ${failed.join(',')}` : ''}${r.attribution ? `  @ ${r.attribution.file}:${r.attribution.line}` : ''}`,
      );
    }

    let lending: LendingResult[] = [];
    if (!flags['no-lending']) {
      lending = await runLendingDrill(world, ['baseline', 'split-4-for-1', 'weekend-stale-feed', 'oracle-paused'].filter((id) => !list(flags.scenarios) || scenarios.some((s) => s.id === id)));
      for (const l of lending) console.log(`[lending] ${l.scenarioId.padEnd(19)} ${l.marketId.padEnd(22)} ${l.finding.padEnd(21)} gt=${l.groundTruthHealth} obs=${l.observedHealth}`);
    }

    const results = buildResults({
      chainId: world.w.chainId,
      forkOf: forkUrl ? world.w.chainId : null,
      scenarios,
      agents: status,
      tasks,
      runs,
      lending,
    });
    const problems = validateResults(results);
    if (problems.length) throw new Error(`results.json failed schema validation:\n  ${problems.join('\n  ')}`);
    const written = writeResults(results, out, !flags['no-web']);
    console.log('\nLeaderboard:');
    for (const l of results.leaderboard) console.log(`  ${l.agentId.padEnd(16)} avg ${String(l.avgScore).padStart(5)}  passRate ${l.passRate}  failures ${l.failures}/${l.runs}`);
    console.log(`\nwrote ${written.join(' and ')} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } finally {
    await world.stop();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
