import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { attachRea, attribute, type Attribution } from '../src/attribution.js';
import { reaCoverageProblems, reaProblem } from '../src/report.js';
import {
  explainLine,
  findReaInstall,
  initializerEnd,
  nodeExec,
  parseAnalysis,
  reaEnv,
  reaFailureMessage,
  reaMode,
  reaNotRunReason,
  reaToolchainProblem,
  ReaAnalyzer,
  traceFacts,
  type ExecResult,
  type ReaExec,
  type ReaExecOptions,
  type ReaFact,
  type ReaRan,
} from '../src/rea.js';
import type { Check } from '../src/scoring.js';
import type { CallRecord } from '../src/tools.js';

// Real rea-agents 6.4.0 output (fields the lab does not read removed; unknowns, resolutions and states kept).
const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIX = JSON.parse(readFileSync(join(HERE, 'fixtures', 'rea-naive-search.json'), 'utf8'));
const MULTI = JSON.parse(readFileSync(join(HERE, 'fixtures', 'rea-multi-declarator.json'), 'utf8'));
const AGENT = 'lab/src/agents/naive-search.ts';

// Every temp directory a test creates is removed at the end.
const temps: string[] = [];
const tempDir = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  temps.push(d);
  return d;
};
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

/** A throwaway repo root holding the fixture's agent source, so the test does not depend on the live agent file. */
function fakeRepo(source: string = FIX.source): string {
  const root = tempDir('revers-rea-test-');
  mkdirSync(join(root, 'lab', 'src', 'agents'), { recursive: true });
  writeFileSync(join(root, AGENT), source);
  return root;
}

/** Mocked REA process: answers analyze/trace with the fixture and records every invocation (and the trace input). */
function mockExec(over: Partial<Record<'analyze' | 'trace', ExecResult>> = {}, fixture = FIX) {
  const calls: { args: string[]; opts: ReaExecOptions; input?: string; tmpExists?: boolean }[] = [];
  const exec: ReaExec = async (_bin, args, opts) => {
    const cmd = args[0] === 'analyze-javascript-application' ? 'analyze' : 'trace';
    calls.push({ args, opts, input: cmd === 'trace' ? readFileSync(args[1], 'utf8') : undefined, tmpExists: !!opts.tmpDir && existsSync(opts.tmpDir) });
    if (over[cmd]) return over[cmd]!;
    return { code: 0, stdout: JSON.stringify(cmd === 'analyze' ? fixture.analysis : fixture.trace), stderr: '', timedOut: false };
  };
  return { exec, calls };
}

const INSTALL = { bin: '/nonexistent/rea.mjs', version: '6.4.0' };
const analyzer = (exec: ReaExec, root = fakeRepo(), install: typeof INSTALL | null = INSTALL) =>
  new ReaAnalyzer({ install, exec, repoRoot: root, workDir: join(root, '.rea-work'), timeoutMs: 60_000 });
const show = (f: ReaFact) => `${f.basis} ${f.state}${f.resolution ? ` ${f.resolution}` : ''} ${f.text}`;

describe('REA output parsing', () => {
  it('accepts an analyze_javascript_application Evidence record and rejects anything else', () => {
    expect(parseAnalysis(JSON.stringify(FIX.analysis)).evidence_id).toMatch(/^ev_[0-9a-f]{64}$/);
    expect(() => parseAnalysis('not json')).toThrow(/not JSON/);
    expect(() => parseAnalysis(JSON.stringify({ ...FIX.analysis, operation: 'analyze' }))).toThrow(/unexpected REA operation/);
    expect(() => parseAnalysis(JSON.stringify({ ...FIX.analysis, evidence_id: 'ev_x' }))).toThrow(/evidence_id/);
  });

  it('turns REA failures into one-line reasons, including the cause REA puts in details.diagnostics', () => {
    const stderr =
      '{"rea_progress":{"phase":"analyze_javascript_application"}}\n{"error":"JavaScript application analysis failed","code":"unsupported_target","message":"accepts only a directory or an .asar file"}\n';
    expect(reaFailureMessage({ code: 1, stdout: '', stderr, timedOut: false }, 60_000)).toBe('unsupported_target: accepts only a directory or an .asar file');
    expect(reaFailureMessage({ code: null, stdout: '', stderr: '', timedOut: true }, 60_000)).toBe('timed out after 60s');
    expect(reaFailureMessage({ code: null, stdout: '', stderr: '', timedOut: true }, 400)).toBe('timed out after 0.4s');
    expect(reaFailureMessage({ code: 1, stdout: '', stderr: 'Error: Cannot find module x\n', timedOut: false }, 60_000)).toBe('exit 1: Error: Cannot find module x');
    const xcrun = JSON.stringify({
      error: 'JavaScript application analysis failed',
      code: 'execution_failure',
      message: 'Analysis could not complete. Retry once; if it continues, run `rea doctor`.',
      details: { diagnostics: { message: 'macOS process ownership helper compilation failed via xcrun (compiler result: 1): Command failed\nxcrun: error: missing DEVELOPER_DIR path\n' } },
    });
    expect(reaFailureMessage({ code: 1, stdout: '', stderr: `${xcrun}\n`, timedOut: false }, 60_000)).toBe(
      'execution_failure: Analysis could not complete. Retry once; if it continues, run `rea doctor`. (cause: macOS process ownership helper compilation failed via xcrun (compiler result: 1): xcrun: error: missing DEVELOPER_DIR path)',
    );
  });

  it('projects the semantic graph at the attributed line, saying which facts are REA relations and which are the lab’s', () => {
    const g = FIX.analysis.normalized_result.semantic_graph;
    const buy = explainLine(g, 'naive-search.ts', 19, { source: FIX.source });
    expect(buy.function).toMatchObject({ name: 'naiveSearch.run', startLine: 12, endLine: 27 });
    expect(buy.summary).toBe('naiveSearch.run: tools.searchTokens → results[0] → tools.getQuote → tools.buy');
    expect(buy.facts.map(show)).toEqual([
      'revers-projection inferred candidate tools.buy(…) reads top.address, task.intent.usd, quote.tokensOut',
      'rea inferred candidate results ← tools.searchTokens(symbol)',
      'revers-projection inferred candidate top ← results[0]',
      'rea inferred candidate quote ← tools.getQuote(top.address, task.intent.usd)',
      'revers-projection inferred candidate naiveSearch.run calls tools.searchTokens, tools.defer, tools.getQuote, tools.buy, tools.getPortfolio, tools.answer, tools.getPoolPrice',
      'rea unknown REA lists 46 unknowns in naiveSearch.run: 21 object-flow ambiguous-target, 10 data-flow unknown-value, 9 call-flow dynamic-call, 6 promise-ownership ambiguous-target',
    ]);
    // REA's own unknowns on what each fact uses: REA has no value for `top` and an ambiguous target for results[0].
    expect(buy.facts[2].unknowns).toEqual(['data-flow unknown-value: results, top', 'object-flow ambiguous-target: results[0]']);
    expect(buy.facts[0].unknowns).toEqual([
      'call-flow dynamic-call: tools.buy',
      'data-flow unknown-value: task, tools, top, quote',
      'object-flow ambiguous-target: top.address, task.intent.usd, tools.buy, quote.tokensOut',
    ]);
    const answer = explainLine(g, 'naive-search.ts', 26, { source: FIX.source });
    expect(answer.summary).toBe('naiveSearch.run: tools.searchTokens → results[0] → tools.getPortfolio → portfolio.positions.find → tools.getPoolPrice → tools.answer');
    expect(answer.facts[0]).toMatchObject({ basis: 'revers-projection', state: 'inferred', resolution: 'candidate', text: 'tools.answer(…) reads pos.uiBalance, price.priceUsd', line: 26 });
    expect(explainLine(g, 'naive-search.ts', 2).function).toBeNull();
  });

  it('bounds same-line provenance to the declarator’s own initializer (no `top ← symbol` from `top = results[0], label = symbol`)', () => {
    const g = MULTI.analysis.normalized_result.semantic_graph;
    const ex = explainLine(g, 'multi.ts', 11, { source: MULTI.source });
    const texts = ex.facts.map((f) => f.text);
    expect(texts).toEqual(expect.arrayContaining(['top ← results[0]', 'label ← symbol', 'addr ← top.address']));
    for (const wrong of ['top ← symbol', 'label ← results[0]', 'usd ← top.address', 'addr ← task.intent.usd']) expect(texts).not.toContain(wrong);
    for (const f of ex.facts.filter((x) => / ← (results\[0\]|symbol|top\.address)$/.test(x.text))) expect(f.basis).toBe('revers-projection');
    // Without the source text the lab cannot bound an initializer, so it makes no position-based claim.
    expect(explainLine(g, 'multi.ts', 11).facts.filter((f) => f.basis === 'revers-projection' && f.text.includes(' ← '))).toEqual([]);
  });

  it('finds where a declarator’s initializer ends', () => {
    const at = (s: string, from: string) => initializerEnd(s, s.indexOf(from));
    expect(at('    const top = results[0], label = symbol;', 'top')).toBe('    const top = results[0]'.length);
    expect(at('    let usd = task.intent.usd; let addr = top.address;', 'usd')).toBe('    let usd = task.intent.usd'.length);
    expect(at('    for (const p of xs) {', 'p of')).toBe('    for (const p of xs'.length);
    expect(at("    const s = 'a,b', t = 1;", 's =')).toBe("    const s = 'a,b'".length);
    expect(at('    const x = f(a, [b, c]); // y, z', 'x =')).toBe('    const x = f(a, [b, c])'.length);
    expect(at('    const x = y // comment, z', 'x =')).toBe('    const x = y '.length);
  });

  it('reads the ownership trace with REA’s coverage and promise-ownership unknowns', () => {
    expect(traceFacts(FIX.trace.normalized_result, 'naiveSearch.run')).toEqual([
      {
        basis: 'rea',
        state: 'inferred',
        resolution: 'resolved',
        unknowns: ['promise-ownership ambiguous-target: awaits on lines 14, 18, 19, 22, 25, 26'],
        text: 'naiveSearch.run awaits 6 expressions (REA ownership trace)',
      },
      { basis: 'rea', state: 'unknown', text: 'REA rates the ownership trace of naiveSearch.run as partial coverage (15 relevant unknowns)' },
      { basis: 'rea', state: 'unknown', text: 'REA leaves 9 member-call targets in naiveSearch.run unresolved (dynamic-call); the tools implementation is not part of this analysis' },
    ]);
  });
});

describe('ReaAnalyzer', () => {
  it('records REA ids, version, coverage, summary and labelled facts, with no machine paths', async () => {
    const root = fakeRepo();
    const { exec, calls } = mockExec();
    const r = (await analyzer(exec, root).explain(AGENT, 19)) as ReaRan;
    expect(r).toMatchObject({
      status: 'ran',
      tool: 'rea-agents',
      version: '6.4.0',
      input: AGENT,
      graphId: FIX.analysis.normalized_result.semantic_graph.graph_id,
      queryId: FIX.trace.normalized_result.query_id,
      traceCoverage: 'partial',
      reaEvidenceId: FIX.analysis.evidence_id,
      function: { name: 'naiveSearch.run', startLine: 12, endLine: 27 },
      summary: 'naiveSearch.run: tools.searchTokens → results[0] → tools.getQuote → tools.buy',
    });
    expect(Object.keys(r).indexOf('graphId')).toBeLessThan(Object.keys(r).indexOf('reaEvidenceId'));
    expect(r.facts.map((f) => f.text)).toContain('naiveSearch.run awaits 6 expressions (REA ownership trace)');
    expect(r.facts.some((f) => f.state === 'unknown' && f.text.includes('9 member-call targets'))).toBe(true);
    expect(r.facts.at(-1)).toEqual({ basis: 'rea', state: 'inferred', text: 'imports ./types.js' });
    // REA was given a directory holding only the agent file, then the ownership query seeded at run(), built from the
    // analysis output in memory and written to a private scratch directory that is gone afterwards.
    expect(calls[0].args[0]).toBe('analyze-javascript-application');
    expect(readdirSync(calls[0].args[1])).toEqual(['naive-search.ts']);
    expect(calls[0].args.at(-1)).toBe('--json');
    expect(calls[1].args[0]).toBe('trace-javascript-semantics');
    const traceInput = JSON.parse(calls[1].input!);
    expect(traceInput.application.evidence_id).toBe(FIX.analysis.evidence_id);
    expect(traceInput.query).toEqual({ seed: { kind: 'semantic-node', node_id: expect.stringMatching(/^jsrg_node_/) }, direction: 'ownership' });
    for (const c of calls) {
      expect(c.tmpExists).toBe(true);
      expect(c.opts.tmpDir!.startsWith(join(root, '.rea-work', 'tmp'))).toBe(true);
      expect(existsSync(c.opts.tmpDir!)).toBe(false);
    }
    expect(readdirSync(join(root, '.rea-work', 'tmp'))).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(root);
    expect(reaProblem(r)).toBeNull();
  });

  it('runs REA once per file (and one ownership trace per function), shared by concurrent callers', async () => {
    const { exec, calls } = mockExec();
    const a = analyzer(exec);
    const [x, y, z] = await Promise.all([a.explain(AGENT, 19), a.explain(AGENT, 19), a.explain(AGENT, 26)]);
    await a.explain(AGENT, 19);
    expect(calls.map((c) => c.args[0])).toEqual(['analyze-javascript-application', 'trace-javascript-semantics']);
    expect(a.processes).toBe(2);
    expect(x).toEqual(y);
    expect((z as ReaRan).summary).toContain('tools.answer');
  });

  it('stages by content hash: concurrent runs never delete each other’s copy, an edited file gets a new one', async () => {
    const root = fakeRepo();
    const workDir = join(root, '.rea-work');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const seen: boolean[] = [];
    const slow: ReaExec = async (bin, args, opts) => {
      if (args[0] === 'analyze-javascript-application') {
        await gate;
        seen.push(existsSync(join(args[1], 'naive-search.ts')));
      }
      return mockExec().exec(bin, args, opts);
    };
    const one = new ReaAnalyzer({ install: INSTALL, exec: slow, repoRoot: root, workDir }).explain(AGENT, 19);
    const two = new ReaAnalyzer({ install: INSTALL, exec: mockExec().exec, repoRoot: root, workDir }).explain(AGENT, 19);
    expect((await two).status).toBe('ran');
    release();
    expect((await one).status).toBe('ran');
    expect(seen).toEqual([true]);
    const before = readdirSync(join(workDir, 'src'));
    expect(before).toHaveLength(1);
    writeFileSync(join(root, AGENT), FIX.source + '\n// edited\n');
    await new ReaAnalyzer({ install: INSTALL, exec: mockExec().exec, repoRoot: root, workDir }).explain(AGENT, 19);
    expect(readdirSync(join(workDir, 'src')).sort()).toEqual([...before, expect.stringMatching(/^naive-search-[0-9a-f]{12}$/)].sort());
  });

  it('records an error, never a fake result, when rea-agents is missing', async () => {
    const { exec, calls } = mockExec();
    const r = await analyzer(exec, fakeRepo(), null).explain(AGENT, 19);
    expect(r).toEqual({ status: 'error', tool: 'rea-agents', version: null, input: AGENT, message: 'rea-agents is not installed (npm install -w @revers/lab)' });
    expect(calls).toHaveLength(0);
  });

  it('records a timeout as an error and does not retry it within the run', async () => {
    const { exec, calls } = mockExec({ analyze: { code: null, stdout: '', stderr: '', timedOut: true } });
    const a = analyzer(exec);
    const r = await a.explain(AGENT, 19);
    expect(r).toMatchObject({ status: 'error', version: '6.4.0', message: 'analyze-javascript-application failed: timed out after 60s' });
    await a.explain(AGENT, 26);
    expect(calls).toHaveLength(1);
    expect(reaProblem(r)).toBeNull();
  });

  it('reports REA error output (with its cause, paths removed) and unparsable output as errors', async () => {
    const stderr = '{"error":"failed","code":"unsupported_target","message":"bad target"}\n';
    expect(await analyzer(mockExec({ analyze: { code: 1, stdout: '', stderr, timedOut: false } }).exec).explain(AGENT, 19)).toMatchObject({
      status: 'error',
      message: 'analyze-javascript-application failed: unsupported_target: bad target',
    });
    expect(await analyzer(mockExec({ analyze: { code: 0, stdout: '{"oops":1}', stderr: '', timedOut: false } }).exec).explain(AGENT, 19)).toMatchObject({
      status: 'error',
      message: 'analyze-javascript-application: unexpected REA operation undefined',
    });
    const root = fakeRepo();
    const cause =
      `macOS process ownership helper compilation failed via xcrun (compiler result: 1): Command failed: /usr/bin/xcrun swiftc ${root}/node_modules/rea-agents/bridge/process/ProcessRunTokenReader.swift -o ${join(root, '.rea-work', 'tmp', '123-AbC', 'reader')}\n` +
      `error: cannot write ${root}/node_modules/rea-agents/x.o; ${join(tmpdir(), 'rea-process-token-Ab12', 'reader')}; /private/var/folders/zz/T/y\n`;
    const xcrun = JSON.stringify({ error: 'failed', code: 'execution_failure', message: 'Analysis could not complete.', details: { diagnostics: { message: cause } } });
    const r = await analyzer(mockExec({ analyze: { code: 1, stdout: '', stderr: xcrun, timedOut: false } }).exec, root).explain(AGENT, 19);
    expect(r.status).toBe('error');
    const msg = (r as { message: string }).message;
    expect(msg).toBe(
      'analyze-javascript-application failed: execution_failure: Analysis could not complete. (cause: macOS process ownership helper compilation failed via xcrun (compiler result: 1): error: cannot write <repo>/node_modules/rea-agents/x.o; <tmp>/rea-process-token-Ab12/reader; <path>)',
    );
    expect(msg).not.toMatch(/\/(Users|private|var)\//);
    expect(reaProblem(r)).toBeNull();
  });

  it('keeps the analysis when only the ownership trace fails, and says so', async () => {
    const r = (await analyzer(mockExec({ trace: { code: null, stdout: '', stderr: '', timedOut: true } }).exec).explain(AGENT, 19)) as ReaRan;
    expect(r.status).toBe('ran');
    expect(r.queryId).toBeNull();
    expect(r.traceCoverage).toBeNull();
    expect(r.facts).toContainEqual({ basis: 'rea', state: 'unknown', text: 'ownership trace not available: trace-javascript-semantics failed: timed out after 60s' });
    expect(reaProblem(r)).toBeNull();
  });

  it('hands REA an allowlisted environment: no credentials, URLs with keys, proxies or loader flags', () => {
    const env = reaEnv({
      PATH: '/bin',
      HOME: '/h',
      TMPDIR: '/t',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'C',
      DEVELOPER_DIR: '/d',
      SDKROOT: '/s',
      ANTHROPIC_API_KEY: 'k',
      GITHUB_TOKEN: 't',
      NODE_OPTIONS: '--import tsx',
      FORK_URL: 'https://rpc.example/v2/secret',
      DATABASE_URL: 'postgres://u:p@h/db',
      HTTPS_PROXY: 'http://u:p@proxy:8080',
      npm_config_registry: 'x',
    });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', TMPDIR: '/t', LANG: 'en_US.UTF-8', LC_ALL: 'C', DEVELOPER_DIR: '/d', SDKROOT: '/s', NO_COLOR: '1' });
  });

  it('nodeExec: SIGTERM at the timeout, SIGKILL after the grace period, TMPDIR passed, missing binary reported', async () => {
    const dir = tempDir('revers-rea-exec-');
    const hang = join(dir, 'hang.mjs');
    writeFileSync(hang, 'setInterval(() => {}, 1000);\n');
    const stubborn = join(dir, 'stubborn.mjs');
    writeFileSync(stubborn, "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n");
    const printTmp = join(dir, 'tmp.mjs');
    writeFileSync(printTmp, 'console.log(process.env.TMPDIR, process.env.ANTHROPIC_API_KEY ?? "none");\n');
    let t0 = Date.now();
    const r = await nodeExec(hang, [], { timeoutMs: 300, cwd: dir });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
    t0 = Date.now();
    const s = await nodeExec(stubborn, [], { timeoutMs: 300, cwd: dir, killGraceMs: 300 });
    expect(s.timedOut).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(550);
    expect(Date.now() - t0).toBeLessThan(5000);
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    try {
      expect((await nodeExec(printTmp, [], { timeoutMs: 10_000, cwd: dir, tmpDir: join(dir, 'x') })).stdout.trim()).toBe(`${join(dir, 'x')} none`);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
    const missing = await nodeExec(join(dir, 'missing.mjs'), [], { timeoutMs: 10_000, cwd: dir });
    expect(missing.code).not.toBe(0);
    const root = fakeRepo();
    const a = new ReaAnalyzer({ install: { bin: join(dir, 'missing.mjs'), version: '6.4.0' }, repoRoot: root, workDir: join(root, '.rea-work'), timeoutMs: 10_000 });
    const e = await a.explain(AGENT, 19);
    expect(e.status).toBe('error');
    expect(JSON.stringify(e)).not.toContain(dir);
    expect(readdirSync(join(root, '.rea-work', 'tmp'))).toEqual([]);
  });

  it('checks for xcrun swiftc only on macOS', () => {
    expect(reaToolchainProblem('linux')).toBeNull();
    const p = reaToolchainProblem();
    expect(p === null || ['Xcode Command Line Tools not found', 'xcrun swiftc unavailable'].includes(p)).toBe(true);
  });
});

describe('attachRea', () => {
  const call = (stack: string): CallRecord => ({ seq: 1, tool: 'buy', args: { token: '0x1' }, ok: true, blockTime: 1, wallTime: '', durationMs: 1, stack });
  const check: Check = { id: 'genuine-asset', label: '', status: 'fail', detail: '', callSeq: 1 };
  const base: Attribution = {
    evidenceId: 'ev_0',
    checkId: 'genuine-asset',
    file: AGENT,
    line: 19,
    column: 12,
    snippet: '',
    call: { seq: 1, tool: 'buy', args: {}, ok: true, error: null, blockTime: 1 },
    rea: 'not-run',
  };

  it('adds REA evidence to agent-source attributions only, and says why the others have none', async () => {
    const a = analyzer(mockExec().exec);
    expect(((await attachRea(base, a))!.rea as ReaRan).status).toBe('ran');
    expect(await attachRea({ ...base, file: 'lab/src/tools.ts' }, a)).toMatchObject({ rea: 'not-run (not an agent source file)' });
    expect(await attachRea(null, a)).toBeNull();
    expect(await attachRea(base, null)).toBe(base);
    const llm = attribute({ agentId: 'claude', scenarioId: 's', taskId: 't', agentKind: 'llm' }, check, [
      { ...call('at dispatch (/x/lab/src/agents/claude.ts:34:20)'), llm: { turn: 3, toolUseId: 'toolu_01', excerpt: 'x' } },
    ]);
    expect((await attachRea(llm, a))!.rea).toBe('not-run (LLM transcript attribution)');
  });

  it('REA_ENABLE=0 disables it; a missing install or toolchain is reported, not simulated', () => {
    const ok = () => null;
    const noSwift = () => 'xcrun swiftc unavailable';
    expect(reaMode({ REA_ENABLE: '0' }, INSTALL, ok)).toBe('disabled');
    expect(reaMode({}, INSTALL, ok)).toBe('on');
    expect(reaMode({}, null, ok)).toBe('missing');
    expect(reaMode({}, INSTALL, noSwift)).toBe('no-toolchain');
    expect(reaNotRunReason('disabled')).toBe('not-run (REA_ENABLE=0)');
    expect(reaNotRunReason('missing')).toBe('not-run (rea-agents not installed)');
    expect(reaNotRunReason('no-toolchain', noSwift)).toBe('not-run (xcrun swiftc unavailable)');
  });
});

describe('results.json rea field', () => {
  it('accepts not-run strings and well-formed REA records, rejects paths and bad ids', async () => {
    expect(reaProblem('not-run (REA_ENABLE=0)')).toBeNull();
    expect(reaProblem('attached')).toMatch(/not-run/);
    expect(reaProblem({ status: 'error', tool: 'rea-agents', version: '6.4.0', input: AGENT, message: 'timed out after 60s' })).toBeNull();
    expect(reaProblem({ status: 'error', tool: 'rea-agents', version: null, input: '/abs/x.ts', message: 'x' })).toMatch(/repo-relative/);
    const good = (await analyzer(mockExec().exec).explain(AGENT, 19)) as ReaRan;
    expect(reaProblem(good)).toBeNull();
    expect(reaProblem({ ...good, reaEvidenceId: 'ev_1' })).toMatch(/reaEvidenceId/);
    expect(reaProblem({ ...good, graphId: 'jsrg_1' })).toMatch(/graphId/);
    expect(reaProblem({ ...good, facts: [{ state: 'inferred', text: 'x' }] })).toMatch(/basis/);
    expect(reaProblem({ ...good, facts: [{ basis: 'rea', state: 'inferred', text: 'x', unknowns: [] }] })).toMatch(/facts/);
    expect(reaProblem(undefined)).toMatch(/string or an object/);
  });

  it('lists failed reference-agent runs without REA evidence (the publish check)', async () => {
    const ran = (await analyzer(mockExec().exec).explain(AGENT, 19)) as ReaRan;
    const at = (rea: Attribution['rea']) => ({ evidenceId: 'ev_1', file: AGENT, line: 19, snippet: '', rea });
    const run = (agentId: string, verdict: string, attribution: unknown) => ({ agentId, scenarioId: 's', taskId: 't', verdict, attribution });
    const results = {
      agents: [
        { id: 'ref', kind: 'reference' },
        { id: 'llm', kind: 'llm' },
      ],
      runs: [
        run('ref', 'fail', at(ran)),
        run('ref', 'pass', null),
        run('ref', 'fail', at({ status: 'error', tool: 'rea-agents', version: '6.4.0', input: AGENT, message: 'timed out after 60s' })),
        run('ref', 'fail', at('not-run (REA_ENABLE=0)')),
        run('llm', 'fail', at('not-run (LLM transcript attribution)')),
      ],
    } as unknown as Parameters<typeof reaCoverageProblems>[0];
    expect(reaCoverageProblems(results)).toEqual(['ref/s/t: error: timed out after 60s', 'ref/s/t: not-run (REA_ENABLE=0)']);
  });
});

// Real REA, when installed and usable here: the integration the lab runs by default.
const realReaProblem = !findReaInstall() ? 'rea-agents not installed' : reaToolchainProblem();
describe.skipIf(realReaProblem !== null)('rea-agents (installed)', () => {
  /** One lab-like process: a separate Node process that analyses the real agent file and prints the record. */
  const labProcess = (script: string, workDir: string) =>
    new Promise<string>((done, fail) => {
      const c = spawn(process.execPath, ['--import', 'tsx', script, workDir], { cwd: join(HERE, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      c.stdout.on('data', (d) => (out += d));
      c.stderr.on('data', (d) => (err += d));
      c.on('close', (code) => (code === 0 ? done(out) : fail(new Error(`exit ${code}: ${err}`))));
    });

  it('two separate lab processes write identical records; graphId and queryId do not depend on the directory', async () => {
    const dir = tempDir('revers-rea-real-');
    const script = join(dir, 'explain.mts');
    const rea = join(HERE, '..', 'src', 'rea.ts');
    writeFileSync(
      script,
      `import { ReaAnalyzer } from ${JSON.stringify(rea)};\n` +
        `const r = await new ReaAnalyzer({ repoRoot: ${JSON.stringify(join(HERE, '..', '..'))}, workDir: process.argv[2] }).explain(${JSON.stringify(AGENT)}, 19);\n` +
        'console.log(JSON.stringify(r));\n',
    );
    const reaTemps = () => readdirSync(tmpdir()).filter((n) => /^rea-(process-token|javascript-analysis)-/.test(n));
    const tempsBefore = new Set(reaTemps());
    // Two runs at once on one work dir (they share the staged copy), one on another directory.
    const [a, b, c] = await Promise.all([labProcess(script, join(dir, 'work')), labProcess(script, join(dir, 'work')), labProcess(script, join(dir, 'elsewhere'))]);
    const one = JSON.parse(a) as ReaRan;
    expect(one.status, a).toBe('ran');
    expect(one.version).toBe(findReaInstall()!.version);
    expect(one.function?.name).toBe('naiveSearch.run');
    expect(one.summary).toMatch(/^naiveSearch\.run: tools\.searchTokens → .*tools\.buy$/);
    expect(one.traceCoverage).toBe('partial');
    expect(reaProblem(one)).toBeNull();
    expect(b).toBe(a);
    const other = JSON.parse(c) as ReaRan;
    expect({ graphId: other.graphId, queryId: other.queryId, facts: other.facts }).toEqual({ graphId: one.graphId, queryId: one.queryId, facts: one.facts });
    expect(other.reaEvidenceId).not.toBe(one.reaEvidenceId); // REA's ev_ hashes its absolute input path
    expect(readdirSync(join(dir, 'work', 'tmp'))).toEqual([]);
    // REA's own temp files went to the scratch TMPDIR, not the system one
    expect(reaTemps().filter((n) => !tempsBefore.has(n))).toEqual([]);
  }, 120_000);
});
