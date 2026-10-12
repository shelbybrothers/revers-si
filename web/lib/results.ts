import raw from '@/public/data/results.json';

export type Category = 'identity' | 'oracle' | 'corporate-action' | 'admin' | 'liquidity' | string;
export type CheckStatus = 'pass' | 'fail' | 'n/a';
export type Verdict = 'pass' | 'fail' | 'deferred' | 'error';

export interface Scenario { id: string; title: string; summary: string; category: Category }
export interface Agent { id: string; name: string; kind: string; model: string | null; description: string; status: 'ran' | 'skipped'; skipReason: string | null }
export interface Task { id: string; prompt: string }
export interface Check { id: string; label: string; status: CheckStatus; detail: string }
export interface Action { tool: string; args: Record<string, unknown>; ok: boolean; summary: string }
export interface SnippetLine { n: number | null; hit: boolean; code: string }
export interface Attribution { evidenceId: string; file: string; line: number | null; snippet: string; lines: SnippetLine[]; rea: string }
export interface LlmUsage { model: string; turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number }
export interface Run {
  agentId: string; scenarioId: string; taskId: string; score: number; verdict: Verdict;
  checks: Check[]; actions: Action[]; attribution: Attribution | null; durationMs: number | null; agentError: string | null;
  llmUsage: LlmUsage | null;
}
export interface LeaderRow { agentId: string; avgScore: number; passRate: number; failures: number; avgCostUsd: number | null }
export interface LendingRow {
  marketId: string; scenarioId: string; groundTruthHealth: number | null; observedHealth: number | null;
  finding: string; detail: string;
}
export interface Results {
  version: string; generatedAt: string | null; sample: boolean; mode: string; methodology: string | null;
  chain: { id: number | null; forkOf: string | number | null; replicaOf: number | null };
  scenarios: Scenario[]; agents: Agent[]; tasks: Task[]; runs: Run[]; leaderboard: LeaderRow[]; lending: LendingRow[];
  llmCost: { totalUsd: number; runs: number } | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

function normCheck(v: unknown): Check | null {
  if (!isObj(v)) return null;
  const s = str(v.status).toLowerCase();
  const status: CheckStatus = s === 'pass' ? 'pass' : s === 'fail' ? 'fail' : 'n/a';
  return { id: str(v.id, 'check'), label: str(v.label, str(v.id, 'check')), status, detail: str(v.detail) };
}

function normAction(v: unknown): Action | null {
  if (!isObj(v)) return null;
  return {
    tool: str(v.tool, 'call'),
    args: isObj(v.args) ? v.args : {},
    ok: v.ok !== false && !v.error,
    summary: str(v.summary, str(v.error, str(v.tool))),
  };
}

/** The lab's snippet lines look like " 19 >   code": take the number and the culprit marker from the text itself. */
export function parseSnippet(snippet: string, line: number | null): SnippetLine[] {
  if (!snippet) return [];
  const raw = snippet.split('\n');
  const parsed = raw.map((ln) => ln.match(/^\s*(\d+)\s*(>)?\s?(.*)$/));
  if (parsed.every((m) => m)) {
    return parsed.map((m) => ({ n: Number(m![1]), hit: m![2] === '>', code: m![3].replace(/^ /, '') }));
  }
  const start = line !== null ? line - Math.floor(raw.length / 2) : null;
  return raw.map((code, i) => {
    const n = start !== null ? start + i : null;
    return { n, hit: line !== null && n === line, code };
  });
}

function normAttribution(v: unknown): Attribution | null {
  if (!isObj(v)) return null;
  const file = str(v.file);
  if (!file && !str(v.snippet)) return null;
  const line = num(v.line);
  return {
    evidenceId: str(v.evidenceId),
    file,
    line,
    snippet: str(v.snippet),
    lines: parseSnippet(str(v.snippet), line),
    rea: typeof v.rea === 'string' ? v.rea : v.rea ? 'attached' : 'not-run',
  };
}

function normRun(v: unknown): Run | null {
  if (!isObj(v) || !v.agentId || !v.scenarioId) return null;
  const checks = arr(v.checks).map(normCheck).filter((c): c is Check => c !== null);
  const vd = str(v.verdict).toLowerCase();
  const verdict: Verdict = vd === 'pass' || vd === 'deferred' || vd === 'error' ? vd : vd === 'fail' ? 'fail' : checks.some((c) => c.status === 'fail') ? 'fail' : 'pass';
  let score = num(v.score);
  if (score === null) {
    const app = checks.filter((c) => c.status !== 'n/a');
    score = app.length ? Math.round((100 * app.filter((c) => c.status === 'pass').length) / app.length) : 0;
  }
  return {
    agentId: str(v.agentId),
    scenarioId: str(v.scenarioId),
    taskId: str(v.taskId, 'task'),
    score: Math.max(0, Math.min(100, score)),
    verdict,
    checks,
    actions: arr(v.actions).map(normAction).filter((a): a is Action => a !== null),
    attribution: normAttribution(v.attribution),
    durationMs: num(v.durationMs),
    agentError: typeof v.agentError === 'string' ? v.agentError : null,
    llmUsage: normUsage(v.llmUsage),
  };
}

function normUsage(v: unknown): LlmUsage | null {
  if (!isObj(v)) return null;
  const n = (k: string) => num(v[k]) ?? 0;
  return {
    model: str(v.model, 'llm'),
    turns: n('turns'),
    inputTokens: n('inputTokens'),
    outputTokens: n('outputTokens'),
    cacheReadTokens: n('cacheReadTokens'),
    cacheWriteTokens: n('cacheWriteTokens'),
    costUsd: n('costUsd'),
  };
}

const USD_SIG2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 });

/** "$0.00042" style: two significant digits, so sub-cent LLM runs stay meaningful. */
export function formatUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '$0';
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v < 1e-6) return '<$0.000001';
  return USD_SIG2.format(v);
}

export function normalize(input: unknown): Results {
  const r = isObj(input) ? input : {};
  const runs = arr(r.runs).map(normRun).filter((x): x is Run => x !== null);

  const scenarios: Scenario[] = arr(r.scenarios)
    .filter(isObj)
    .map((s) => ({ id: str(s.id), title: str(s.title, str(s.id)), summary: str(s.summary), category: str(s.category, 'other') }))
    .filter((s) => s.id);
  // Scenarios referenced only by runs still get a column.
  for (const run of runs) if (!scenarios.some((s) => s.id === run.scenarioId)) scenarios.push({ id: run.scenarioId, title: run.scenarioId, summary: '', category: 'other' });

  const agents: Agent[] = arr(r.agents)
    .filter(isObj)
    .map((a) => ({
      id: str(a.id),
      name: str(a.name, str(a.id)),
      kind: str(a.kind, 'reference'),
      model: typeof a.model === 'string' && a.model ? a.model : null,
      description: str(a.description),
      status: (str(a.status) === 'skipped' ? 'skipped' : 'ran') as Agent['status'],
      skipReason: typeof a.skipReason === 'string' ? a.skipReason : null,
    }))
    .filter((a) => a.id);
  for (const run of runs) if (!agents.some((a) => a.id === run.agentId)) agents.push({ id: run.agentId, name: run.agentId, kind: 'reference', model: null, description: '', status: 'ran', skipReason: null });

  let leaderboard: LeaderRow[] = arr(r.leaderboard)
    .filter(isObj)
    .map((l) => ({ agentId: str(l.agentId), avgScore: num(l.avgScore) ?? 0, passRate: num(l.passRate) ?? 0, failures: num(l.failures) ?? 0, avgCostUsd: num(l.avgCostUsd) }))
    .filter((l) => l.agentId);
  if (!leaderboard.length && runs.length) {
    leaderboard = agents
      .filter((a) => runs.some((x) => x.agentId === a.id && x.verdict !== 'error'))
      .map((a) => {
        const rs = runs.filter((x) => x.agentId === a.id && x.verdict !== 'error');
        const ok = rs.filter((x) => x.verdict !== 'fail').length;
        return { agentId: a.id, avgScore: Math.round((rs.reduce((s, x) => s + x.score, 0) / rs.length) * 10) / 10, passRate: ok / rs.length, failures: rs.length - ok, avgCostUsd: null };
      });
  }
  leaderboard.sort((a, b) => b.avgScore - a.avgScore);

  const lending: LendingRow[] = arr(r.lending)
    .filter(isObj)
    .map((l) => ({
      marketId: str(l.marketId),
      scenarioId: str(l.scenarioId),
      groundTruthHealth: num(l.groundTruthHealth),
      observedHealth: num(l.observedHealth),
      finding: str(l.finding, 'ok'),
      detail: str(l.detail),
    }))
    .filter((l) => l.marketId);

  const chain = isObj(r.chain) ? r.chain : {};
  return {
    version: str(r.version, '1'),
    generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : null,
    sample: r.sample === true,
    mode: str(r.mode, 'replica'),
    methodology: typeof r.methodology === 'string' && r.methodology.trim() ? r.methodology : null,
    chain: {
      id: num(chain.id),
      forkOf: typeof chain.forkOf === 'string' || typeof chain.forkOf === 'number' ? chain.forkOf : null,
      replicaOf: num(chain.replicaOf),
    },
    scenarios,
    agents,
    tasks: arr(r.tasks).filter(isObj).map((t) => ({ id: str(t.id), prompt: str(t.prompt) })).filter((t) => t.id),
    runs,
    leaderboard,
    lending,
    llmCost:
      isObj(r.llmCost) && num(r.llmCost.totalUsd) !== null
        ? { totalUsd: num(r.llmCost.totalUsd)!, runs: num(r.llmCost.runs) ?? 0 }
        : null,
  };
}

export const results: Results = normalize(raw as unknown);

export function formatGenerated(iso: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export const CATEGORY_LABEL: Record<string, string> = {
  identity: 'Identity',
  oracle: 'Oracle',
  'corporate-action': 'Corporate action',
  admin: 'Admin',
  liquidity: 'Liquidity',
};

export const runKey = (agentId: string, scenarioId: string, taskId: string) => `${agentId}~${scenarioId}~${taskId}`;
export const runKeyOf = (r: Pick<Run, 'agentId' | 'scenarioId' | 'taskId'>) => runKey(r.agentId, r.scenarioId, r.taskId);

/** Short human label for a task id (used where several tasks share a scenario). */
export const TASK_LABEL: Record<string, string> = { 'buy-gme-100': 'Buy $100 of GME', 'value-portfolio': 'Value my GME' };
