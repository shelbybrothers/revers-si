// Runs agents x scenarios x tasks on the replica world: reset to the base snapshot, stage the scenario, run the
// agent against the recorded tools, score, attribute.
import { formatUnits } from 'viem';
import { attribute, type Attribution } from './attribution.js';
import { AgentHarnessError, type LlmUsage, type TradingAgent } from './agents/types.js';
import { getScenario, type Scenario } from './scenarios/index.js';
import { firstFailure, scoreRun, type Check } from './scoring.js';
import type { Task } from './tasks.js';
import { createTools, type CallRecord } from './tools.js';
import type { World } from './world.js';

export interface RunAction {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  error?: string;
}

export interface RunResult {
  agentId: string;
  scenarioId: string;
  taskId: string;
  score: number;
  /** 'error': the agent crashed before its first tool call, or the harness/provider stopped the run (spend cap, refusal,
   *  truncation, API error); excluded from the leaderboard, shown with its error. */
  verdict: 'pass' | 'fail' | 'deferred' | 'error';
  checks: Omit<Check, 'callSeq'>[];
  actions: RunAction[];
  attribution: Attribution | null;
  agentError: string | null;
  /** kind 'llm' only: tokens and estimated USD cost of this run */
  llmUsage?: LlmUsage;
  durationMs: number;
}

const short = (a: unknown) => (typeof a === 'string' && a.startsWith('0x') ? `${a.slice(0, 6)}…${a.slice(-4)}` : String(a));

function summarize(c: CallRecord): string {
  const a = c.args;
  const t = c.truth;
  const what = t ? `${short(t.token)} (${t.honeypot ? 'honeypot ' : t.genuine ? 'genuine ' : 'counterfeit '}${t.onchainSymbol})` : short(a.token);
  switch (c.tool) {
    case 'searchTokens': {
      const r = (c.result as { symbol: string; address: string; source: string }[] | undefined) ?? [];
      return `search "${a.query}" -> ${r.length} results; top: ${r[0] ? `${r[0].symbol} ${short(r[0].address)} (${r[0].source})` : 'none'}`;
    }
    case 'buy':
      return c.ok ? `buy ${what} for $${a.usdIn} -> ${(c.result as { tokensOut: number }).tokensOut.toFixed(4)} tokens` : `buy ${what} for $${a.usdIn} REVERTED: ${c.error}`;
    case 'sell':
      return `sell ${a.amount} of ${what}${c.ok ? '' : ` REVERTED: ${c.error}`}`;
    case 'getQuote':
      return c.ok ? `quote $${a.usdIn} of ${short(a.token)} -> $${(c.result as { effectivePriceUsd: number }).effectivePriceUsd.toFixed(4)}/token` : `quote failed: ${c.error}`;
    case 'getPoolPrice':
      return c.ok ? `pool price ${short(a.token)} = $${(c.result as { priceUsd: number }).priceUsd.toFixed(4)}` : `pool price failed: ${c.error}`;
    case 'getOraclePrice': {
      const r = c.result as { priceUsd: number; updatedAt: number; oraclePaused: boolean } | undefined;
      return r ? `oracle ${short(a.token)} = $${r.priceUsd.toFixed(4)} (updatedAt ${new Date(r.updatedAt * 1000).toISOString()}${r.oraclePaused ? ', paused' : ''})` : `oracle failed: ${c.error}`;
    }
    case 'getTokenInfo': {
      const r = c.result as { symbol: string; registered: boolean } | undefined;
      return r ? `token info ${short(a.token)}: ${r.symbol}, registered=${r.registered}` : `token info failed: ${c.error}`;
    }
    case 'getPortfolio': {
      const r = c.result as { positions: { symbol: string; balance: number; uiBalance: number }[] } | undefined;
      return `portfolio: ${(r?.positions ?? []).map((p) => `${p.symbol} ${p.balance} (ui ${p.uiBalance})`).join(', ') || 'no positions'}`;
    }
    case 'defer':
      return `DEFER: ${a.reason}`;
    case 'answer':
      return `ANSWER: $${Number(a.valueUsd).toFixed(2)}${a.note ? ` (${a.note})` : ''}`;
    case 'now':
      return `now = ${(c.result as { iso: string } | undefined)?.iso ?? '?'}`;
    case 'oracleFeed':
      return `oracle feed for ${short(a.token)} = ${short(c.result)}`;
    default:
      return c.tool;
  }
}

export async function runOne(world: World, agent: TradingAgent, scenario: Scenario, task: Task): Promise<RunResult> {
  const t0 = Date.now();
  await world.resetToBase();
  const accountIndex = 0;
  const agentAddr = world.agentAccounts[accountIndex].address;
  await scenario.setup(world, { beforeEvent: task.setup ? () => task.setup!(world, agentAddr) : undefined });

  const { tools, calls, outcome } = createTools(world, accountIndex);
  let agentError: string | null = null;
  let harnessStopped = false;
  let llmUsage: LlmUsage | undefined;
  try {
    await agent.run(task, tools, { onLlmUsage: (u) => (llmUsage = u) });
  } catch (e) {
    const err = e as { shortMessage?: string; message?: string };
    agentError = (err.shortMessage ?? err.message ?? String(e)).split('\n')[0];
    harnessStopped = e instanceof AgentHarnessError;
  }

  let groundTruthValueUsd: number | null = null;
  if (task.intent.kind === 'value') {
    const s = world.stock(task.intent.symbol);
    const bal = await world.read<bigint>(s.token, 'StockToken', 'balanceOf', [agentAddr]);
    const m = await world.read<bigint>(s.token, 'StockToken', 'uiMultiplier');
    groundTruthValueUsd = Number(formatUnits(bal, 18)) * world.trueValuePerRawToken(task.intent.symbol, m);
  }

  const { checks, score, verdict } = scoreRun({
    intent: task.intent,
    expectations: scenario.expectations,
    calls,
    outcome,
    groundTruthValueUsd,
    agentError,
  });
  if (agentError && (calls.length === 0 || harnessStopped)) {
    return {
      agentId: agent.id,
      scenarioId: scenario.id,
      taskId: task.id,
      score: 0,
      verdict: 'error',
      checks: [],
      actions: [],
      attribution: null,
      agentError,
      ...(llmUsage ? { llmUsage } : {}),
      durationMs: Date.now() - t0,
    };
  }
  const fail = firstFailure(checks);
  const attribution = fail ? attribute({ agentId: agent.id, scenarioId: scenario.id, taskId: task.id, agentKind: agent.kind }, fail, calls) : null;

  return {
    agentId: agent.id,
    scenarioId: scenario.id,
    taskId: task.id,
    score,
    verdict,
    checks: checks.map(({ callSeq: _c, ...rest }) => rest),
    actions: calls
      .filter((c) => c.tool !== 'now' && c.tool !== 'oracleFeed')
      .map((c) => ({ tool: c.tool, args: c.args, ok: c.ok, summary: summarize(c), ...(c.error ? { error: c.error } : {}) })),
    attribution,
    agentError,
    ...(llmUsage ? { llmUsage } : {}),
    durationMs: Date.now() - t0,
  };
}

export function plan(agents: TradingAgent[], scenarios: Scenario[], tasks: Task[]) {
  const out: { agent: TradingAgent; scenario: Scenario; task: Task }[] = [];
  for (const task of tasks)
    for (const scenario of scenarios) {
      if (task.scenarios !== '*' && !task.scenarios.includes(scenario.id)) continue;
      for (const agent of agents) out.push({ agent, scenario, task });
    }
  return out;
}

export { getScenario };
