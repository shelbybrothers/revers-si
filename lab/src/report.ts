// Builds results.json (schema in SPEC.md) and writes it to lab/out/results.json and web/public/data/results.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TradingAgent } from './agents/types.js';
import { LENDING_FINDINGS, type LendingResult } from './lending.js';
import type { RunResult } from './runner.js';
import type { Scenario } from './scenarios/index.js';
import type { Task } from './tasks.js';
import { LAB_ROOT, REPO_ROOT } from './world.js';

export interface ResultsJson {
  version: '1';
  generatedAt: string;
  /** 'replica-on-fork': the replica contracts were deployed on top of a fork; agents never touched real chain tokens/feeds. */
  mode: 'replica' | 'replica-on-fork';
  chain: { id: number; forkOf: number | null; replicaOf: number };
  methodology: string;
  scenarios: { id: string; title: string; summary: string; category: string }[];
  agents: { id: string; name: string; kind: string; model?: string; description: string; status: 'ran' | 'skipped'; skipReason: string | null }[];
  tasks: { id: string; prompt: string }[];
  runs: RunResult[];
  leaderboard: { agentId: string; avgScore: number; passRate: number; failures: number; runs: number; avgCostUsd?: number }[];
  /** present when any LLM agent ran: estimated spend from token usage and public per-MTok prices */
  llmCost?: { totalUsd: number; runs: number };
  lending: LendingResult[];
}

/** Average estimated LLM cost per run over ALL of an agent's runs (errored runs spent tokens too). */
function avgCost(all: RunResult[]): { avgCostUsd?: number } {
  if (!all.some((r) => r.llmUsage)) return {};
  return { avgCostUsd: Math.round((all.reduce((s, r) => s + (r.llmUsage?.costUsd ?? 0), 0) / all.length) * 1e8) / 1e8 };
}

export function leaderboard(runs: RunResult[]): ResultsJson['leaderboard'] {
  const by = new Map<string, RunResult[]>();
  // Runs where the agent crashed before its first tool call are harness/agent errors, not scores.
  for (const r of runs.filter((x) => x.verdict !== 'error')) by.set(r.agentId, [...(by.get(r.agentId) ?? []), r]);
  return [...by.entries()]
    .map(([agentId, rs]) => ({
      agentId,
      avgScore: Math.round((rs.reduce((s, r) => s + r.score, 0) / rs.length) * 10) / 10,
      passRate: Math.round((rs.filter((r) => r.verdict !== 'fail').length / rs.length) * 1000) / 1000,
      failures: rs.filter((r) => r.verdict === 'fail').length,
      runs: rs.length,
      ...avgCost(runs.filter((r) => r.agentId === agentId)),
    }))
    .sort((a, b) => b.avgScore - a.avgScore || a.failures - b.failures);
}

function llmCost(runs: RunResult[]): Pick<ResultsJson, 'llmCost'> {
  const llm = runs.filter((r) => r.llmUsage);
  if (!llm.length) return {};
  return { llmCost: { totalUsd: Math.round(llm.reduce((s, r) => s + r.llmUsage!.costUsd, 0) * 1e8) / 1e8, runs: llm.length } };
}

export function buildResults(args: {
  chainId: number;
  forkOf: number | null;
  scenarios: Scenario[];
  agents: { agent: TradingAgent; skipReason: string | null }[];
  tasks: Task[];
  runs: RunResult[];
  lending: LendingResult[];
}): ResultsJson {
  return {
    version: '1',
    generatedAt: new Date().toISOString(),
    mode: args.forkOf ? 'replica-on-fork' : 'replica',
    chain: { id: args.chainId, forkOf: args.forkOf, replicaOf: 4663 },
    methodology:
      (args.forkOf ? 'Replica-on-fork mode: the replica contracts below were deployed on top of a fork; agents traded the replica, not the real chain tokens or feeds. ' : '') +
      'Replica mode: contracts mirroring Robinhood Chain stock-token mechanics (registry, ERC-8056 uiMultiplier, Chainlink-style equity feeds, pools) are deployed on a local anvil chain. Each run starts from the same snapshot; scenarios set the chain clock and stage the event. Pool volume and liquidity are seeded replica activity, not real market data. Reference agents are implementations of common patterns written for this lab; LLM agents are real model calls over the same tools, with cost estimated from token usage. Scores are computed from recorded tool calls.',
    scenarios: args.scenarios.map(({ id, title, summary, category }) => ({ id, title, summary, category })),
    agents: args.agents.map(({ agent, skipReason }) => ({
      id: agent.id,
      name: agent.name,
      kind: agent.kind,
      ...(agent.model ? { model: agent.model } : {}),
      description: agent.description,
      status: skipReason ? 'skipped' : 'ran',
      skipReason,
    })),
    tasks: args.tasks.map(({ id, prompt }) => ({ id, prompt })),
    runs: args.runs,
    leaderboard: leaderboard(args.runs),
    ...llmCost(args.runs),
    lending: args.lending,
  };
}

export const DEFAULT_OUT = join(LAB_ROOT, 'out', 'results.json');
export const WEB_OUT = join(REPO_ROOT, 'web', 'public', 'data', 'results.json');

export function writeResults(results: ResultsJson, outPath = DEFAULT_OUT, copyToWeb = true): string[] {
  const json = JSON.stringify(results, null, 2) + '\n';
  const written: string[] = [];
  for (const p of copyToWeb ? [outPath, WEB_OUT] : [outPath]) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, json);
    written.push(p);
  }
  return written;
}

/** Structural validation against the SPEC results.json schema. Returns a list of problems (empty = valid). */
export function validateResults(r: unknown): string[] {
  const errs: string[] = [];
  const o = r as Record<string, unknown>;
  const isArr = (k: string) => Array.isArray(o[k]) || (errs.push(`${k} must be an array`), false);
  if (o?.version !== '1') errs.push('version must be "1"');
  if (typeof o?.generatedAt !== 'string' || Number.isNaN(Date.parse(o.generatedAt as string))) errs.push('generatedAt must be ISO-8601');
  if (o?.mode !== 'replica' && o?.mode !== 'replica-on-fork') errs.push('mode must be replica|replica-on-fork');
  const chain = o?.chain as Record<string, unknown> | undefined;
  if (!chain || typeof chain.id !== 'number' || chain.replicaOf !== 4663) errs.push('chain {id, forkOf, replicaOf: 4663} invalid');
  const cats = ['identity', 'oracle', 'corporate-action', 'admin', 'liquidity'];
  if (isArr('scenarios'))
    for (const s of o.scenarios as Record<string, unknown>[])
      if (typeof s.id !== 'string' || typeof s.title !== 'string' || typeof s.summary !== 'string' || !cats.includes(s.category as string)) errs.push(`scenario ${String(s.id)} invalid`);
  if (isArr('agents'))
    for (const a of o.agents as Record<string, unknown>[]) {
      if (!['ran', 'skipped'].includes(a.status as string)) errs.push(`agent ${String(a.id)} status invalid`);
      if (a.status === 'skipped' && typeof a.skipReason !== 'string') errs.push(`agent ${String(a.id)} skipped without skipReason`);
      if (!['reference', 'llm', 'external'].includes(a.kind as string)) errs.push(`agent ${String(a.id)} kind invalid`);
    }
  if (isArr('tasks')) for (const t of o.tasks as Record<string, unknown>[]) if (typeof t.id !== 'string' || typeof t.prompt !== 'string') errs.push('task invalid');
  if (isArr('runs'))
    for (const run of o.runs as Record<string, unknown>[]) {
      const id = `${String(run.agentId)}/${String(run.scenarioId)}/${String(run.taskId)}`;
      if (typeof run.score !== 'number' || run.score < 0 || run.score > 100) errs.push(`run ${id} score invalid`);
      if (!['pass', 'fail', 'deferred', 'error'].includes(run.verdict as string)) errs.push(`run ${id} verdict invalid`);
      if (run.verdict === 'error' && typeof run.agentError !== 'string') errs.push(`run ${id} error verdict without agentError`);
      if (!Array.isArray(run.checks) || !(run.checks as Record<string, unknown>[]).every((c) => ['pass', 'fail', 'n/a'].includes(c.status as string) && typeof c.label === 'string'))
        errs.push(`run ${id} checks invalid`);
      if (!Array.isArray(run.actions) || !(run.actions as Record<string, unknown>[]).every((a) => typeof a.tool === 'string' && typeof a.ok === 'boolean' && typeof a.summary === 'string'))
        errs.push(`run ${id} actions invalid`);
      const at = run.attribution as Record<string, unknown> | null;
      if (at !== null && (typeof at !== 'object' || !/^ev_[0-9a-f]+$/.test(String(at.evidenceId)) || typeof at.file !== 'string' || typeof at.line !== 'number' || typeof at.snippet !== 'string'))
        errs.push(`run ${id} attribution invalid`);
      if (run.verdict === 'fail' && at === null) errs.push(`run ${id} failed without attribution`);
      const u = run.llmUsage as Record<string, unknown> | null | undefined;
      if (
        u != null &&
        (typeof u !== 'object' ||
          typeof u.model !== 'string' ||
          !['turns', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd'].every((k) => typeof u[k] === 'number' && (u[k] as number) >= 0))
      )
        errs.push(`run ${id} llmUsage invalid`);
    }
  if (isArr('leaderboard'))
    for (const l of o.leaderboard as Record<string, unknown>[]) if (typeof l.avgScore !== 'number' || typeof l.passRate !== 'number' || typeof l.failures !== 'number') errs.push(`leaderboard ${String(l.agentId)} invalid`);
  if (isArr('lending'))
    for (const l of o.lending as Record<string, unknown>[])
      if (!(LENDING_FINDINGS as string[]).includes(l.finding as string) || typeof l.marketId !== 'string') errs.push(`lending ${String(l.marketId)}/${String(l.scenarioId)} invalid`);
  return errs;
}
