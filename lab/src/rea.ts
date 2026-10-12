// REA (Reverse Engineer Anything, https://github.com/morluto/rea, MIT, npm `rea-agents`) static analysis of the agent
// source behind a failed check. The stack-trace attribution stays the line pointer; REA adds code-structure evidence:
//
//   1. `rea analyze-javascript-application <dir> --json` on a directory holding only the attributed agent file. REA parses
//      the file as inert text (it never runs it) and returns an Evidence record with a content-addressed semantic graph:
//      functions, call sites, bindings, property reads, the relations between them (each with an evidence state and a
//      resolution such as `candidate`) and REA's own list of unknowns.
//   2. `rea trace-javascript-semantics` with an `ownership` query seeded at the function that contains the attributed line.
//
// The record stored in results.json is the lab's deterministic reading of that output (no paths, no timestamps). Each
// fact says whether it restates REA (`basis: 'rea'`) or relates REA items by source position (`basis:
// 'revers-projection'`), and carries REA's evidence state, relation resolution and unknowns for the items it uses.
// Analysis runs once per agent file per lab run with a timeout; any failure is recorded as { status: 'error' }.
//
// On macOS every `analyze-javascript-application` compiles a small Swift helper with `xcrun swiftc` (REA's process
// ownership check), so the Xcode Command Line Tools are required there; reaToolchainProblem() checks for them first.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ReaState = 'observed' | 'inferred' | 'unknown';

/** 'rea': the fact restates REA output. 'revers-projection': the lab relates REA items by source position (REA itself
 *  has no relation for it, e.g. "the call on line 19 reads top.address" or "top ← results[0]"). */
export type ReaBasis = 'rea' | 'revers-projection';

export interface ReaFact {
  basis: ReaBasis;
  /** weakest REA evidence state (observed > inferred > unknown) among the REA nodes and relations the fact uses */
  state: ReaState;
  /** weakest REA relation resolution among the relations the fact uses ('candidate': REA says the relation "does not
   *  prove runtime execution or causal flow"); absent when the fact uses no relation */
  resolution?: string;
  /** REA's own unknowns on the bindings, properties, call sites and awaits the fact uses ("family reason: subjects") */
  unknowns?: string[];
  text: string;
  line?: number;
}

export interface ReaRan {
  status: 'ran';
  tool: 'rea-agents';
  version: string;
  /** the REA CLI commands that produced this record */
  command: string;
  /** repo-relative agent file that REA analysed */
  input: string;
  /** REA's content-addressed semantic relation graph id (jsrg_ + sha256 of the normalized graph). It did not change when
   *  the same file was analysed from another directory on the same machine; other machines are not verified. */
  graphId: string;
  /** REA's ownership trace query id (jsrq_ + sha256), null when the trace could not run */
  queryId: string | null;
  /** REA's own coverage status for the ownership trace (e.g. 'partial'), null when the trace could not run */
  traceCoverage: string | null;
  /** REA's Evidence id for the analysis (ev_ + sha256). Machine-local: it hashes REA's absolute input path, so it differs
   *  between checkouts. Not related to the lab's attribution evidenceId. */
  reaEvidenceId: string;
  function: { name: string; startLine: number; endLine: number } | null;
  /** the lab's projection: the data flow into the attributed call, read from REA's graph */
  summary: string;
  facts: ReaFact[];
}

export interface ReaError {
  status: 'error';
  tool: 'rea-agents';
  version: string | null;
  input: string;
  message: string;
}

export type ReaEvidence = ReaRan | ReaError;

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ReaExecOptions {
  timeoutMs: number;
  cwd: string;
  /** TMPDIR for the REA process (created and removed by the caller) */
  tmpDir?: string;
  /** after a timeout, how long REA gets to clean up after SIGTERM before SIGKILL (default 2000 ms) */
  killGraceMs?: number;
}

/** Runs the REA CLI with `args`. Injected in tests. */
export type ReaExec = (bin: string, args: string[], opts: ReaExecOptions) => Promise<ExecResult>;

export interface ReaInstall {
  bin: string;
  version: string;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(HERE, '..', '..');
export const REA_DEFAULT_TIMEOUT_MS = 60_000;
const REA_KILL_GRACE_MS = 2_000;

/** Finds the locally installed rea-agents package (never downloads anything). */
export function findReaInstall(): ReaInstall | null {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve('rea-agents/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string; bin?: Record<string, string> | string };
    const rel = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.['rea-agents'] ?? pkg.bin?.rea);
    if (!rel || typeof pkg.version !== 'string') return null;
    const bin = join(dirname(pkgPath), rel);
    return existsSync(bin) ? { bin, version: pkg.version } : null;
  } catch {
    return null;
  }
}

/** REA gets only what static analysis (and, on macOS, `xcrun swiftc`) needs: an allowlist, so credentials, RPC URLs,
 *  proxies and loader flags such as tsx's NODE_OPTIONS never reach it. */
export function reaEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env))
    if (v !== undefined && (/^(PATH|HOME|TMPDIR|LANG|DEVELOPER_DIR|SDKROOT)$/.test(k) || /^LC_[A-Z_]+$/.test(k))) out[k] = v;
  out.NO_COLOR = '1';
  return out;
}

let toolchain: string | null | undefined;

/** REA's JavaScript analysis compiles a Swift helper with `/usr/bin/xcrun swiftc` on macOS. Returns why that cannot
 *  work here (checked once per process, without triggering the Command Line Tools installer), or null. */
export function reaToolchainProblem(platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== 'darwin') return null;
  if (toolchain !== undefined) return toolchain;
  const env = reaEnv();
  const sel = spawnSync('/usr/bin/xcode-select', ['-p'], { env, encoding: 'utf8', timeout: 10_000 });
  const devDir = sel.status === 0 ? sel.stdout.trim() : '';
  if (!devDir || !existsSync(devDir)) return (toolchain = 'Xcode Command Line Tools not found');
  const find = spawnSync('/usr/bin/xcrun', ['--find', 'swiftc'], { env, encoding: 'utf8', timeout: 10_000 });
  return (toolchain = find.status === 0 && find.stdout.trim() ? null : 'xcrun swiftc unavailable');
}

// Children still running and scratch directories still in use when the lab exits.
const liveChildren = new Set<ChildProcess>();
const liveDirs = new Set<string>();
let exitHook = false;
function installExitHook() {
  if (exitHook) return;
  exitHook = true;
  process.once('exit', () => {
    // SIGTERM lets REA stop its analysis worker and compiler and remove its own temp files.
    for (const c of liveChildren) c.kill('SIGTERM');
    for (const d of liveDirs) rmSync(d, { recursive: true, force: true });
  });
}

/** Spawns `node <rea bin> ...args` in the lab's process group, so Ctrl-C reaches REA too (REA handles SIGINT/SIGTERM by
 *  aborting and cleaning up its worker and temp files). On timeout: SIGTERM, then SIGKILL after a grace period. */
export const nodeExec: ReaExec = (bin, args, { timeoutMs, cwd, tmpDir, killGraceMs = REA_KILL_GRACE_MS }) =>
  new Promise((done) => {
    installExitHook();
    const env = reaEnv();
    if (tmpDir) env.TMPDIR = tmpDir;
    const child = spawn(process.execPath, [bin, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
    liveChildren.add(child);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    }, timeoutMs);
    let settled = false;
    const finish = (r: ExecResult) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      liveChildren.delete(child);
      if (!settled) done(r);
      settled = true;
    };
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', (e) => finish({ code: null, stdout: '', stderr: e.message, timedOut }));
    child.on('close', (code) => finish({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut }));
  });

// ---------------------------------------------------------------------------------------------------------------------
// REA output shapes (only the fields this projection reads)

interface Pos {
  line: number;
  column: number;
}
interface Range {
  start: Pos;
  end: Pos;
}
interface SemLocation {
  available: boolean;
  value?: { kind?: string; source?: string; start?: Pos; end?: Pos };
}
interface SemNode {
  node_id: string;
  kind: string;
  label: string | null;
  properties: Record<string, unknown>;
  identity?: { module_path?: string };
  evidence: { context_id: string; location: SemLocation };
}
interface SemRelation {
  source_node_id: string;
  target_node_id: string;
  relation: string;
  resolution: string;
  evidence: { context_id: string; location: SemLocation };
}
interface SemUnknown {
  unknown_id?: string;
  node_id: string;
  family: string;
  reason: string;
  detail: string;
  evidence: { context_id: string; location: SemLocation };
}
interface SemContext {
  context_id: string;
  state: string;
}
export interface SemanticGraph {
  graph_id: string;
  nodes: SemNode[];
  relations: SemRelation[];
  unknowns: SemUnknown[];
  evidence_contexts: SemContext[];
}
interface AppGraphNode {
  kind: string;
  observations: { label: string; properties: Record<string, unknown>; evidence?: { state?: string } }[];
}
export interface AnalysisEvidence {
  evidence_id: string;
  operation: string;
  normalized_result: {
    semantic_graph: SemanticGraph;
    graph: { nodes: AppGraphNode[] };
    statistics?: { parse_failures?: number };
  };
}
export interface OwnershipTrace {
  query_id: string;
  status: string;
  coverage?: { status?: string };
  summary?: { relevant_unknowns?: number };
  evidence_contexts?: SemContext[];
  nodes: SemNode[];
  relations: SemRelation[];
  unknowns: SemUnknown[];
}

// ---------------------------------------------------------------------------------------------------------------------
// Parsing

/** REA prints JSON progress lines on stderr and, on failure, a JSON error object whose generic message often hides the
 *  cause in details.diagnostics.message. Returns a one-line reason (paths are removed by the caller). */
export function reaFailureMessage(r: ExecResult, timeoutMs: number): string {
  if (r.timedOut) {
    const s = timeoutMs / 1000;
    return `timed out after ${Number.isInteger(s) ? s : s.toFixed(1)}s`;
  }
  for (const text of [r.stdout, r.stderr]) {
    const lines = text.split('\n').reverse();
    for (const l of lines) {
      const t = l.trim();
      if (!t.startsWith('{')) continue;
      try {
        const o = JSON.parse(t) as { error?: string; code?: string; message?: string; details?: { diagnostics?: { message?: unknown } } };
        if (!o.error && !o.message) continue;
        const head = [o.code, o.message ?? o.error].filter(Boolean).join(': ');
        const cause = typeof o.details?.diagnostics?.message === 'string' ? causeLine(o.details.diagnostics.message) : '';
        return `${head.slice(0, 300)}${cause ? ` (cause: ${cause.slice(0, 400)})` : ''}`;
      } catch {
        /* not JSON */
      }
    }
  }
  const tail = (r.stderr || r.stdout).trim().split('\n').filter(Boolean).pop() ?? '';
  return `exit ${r.code ?? 'null'}${tail ? `: ${tail.slice(0, 240)}` : ''}`;
}

/** REA's diagnostic message in one line: its first line without the failed command line, plus the last line (the tool's
 *  own error, e.g. "xcrun: error: invalid active developer path"). */
function causeLine(message: string): string {
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return '';
  const first = lines[0].replace(/:?\s*Command failed\b.*$/, '');
  const last = lines.length > 1 ? lines[lines.length - 1] : '';
  return last && last !== first ? `${first}: ${last}` : first;
}

export function parseAnalysis(stdout: string): AnalysisEvidence {
  let o: AnalysisEvidence;
  try {
    o = JSON.parse(stdout) as AnalysisEvidence;
  } catch {
    throw new Error('REA output is not JSON');
  }
  if (o?.operation !== 'analyze_javascript_application') throw new Error(`unexpected REA operation ${String(o?.operation)}`);
  if (!/^ev_[0-9a-f]{64}$/.test(String(o.evidence_id))) throw new Error('REA evidence_id missing');
  const g = o.normalized_result?.semantic_graph;
  if (!g || !/^jsrg_[0-9a-f]{64}$/.test(String(g.graph_id)) || !Array.isArray(g.nodes) || !Array.isArray(g.relations) || !Array.isArray(g.unknowns))
    throw new Error('REA semantic graph missing');
  return o;
}

export function parseTrace(stdout: string): OwnershipTrace {
  let o: { operation?: string; normalized_result?: OwnershipTrace };
  try {
    o = JSON.parse(stdout);
  } catch {
    throw new Error('REA trace output is not JSON');
  }
  const r = o.normalized_result;
  if (o.operation !== 'trace_javascript_semantics' || !r || !/^jsrq_[0-9a-f]{64}$/.test(String(r.query_id)) || !Array.isArray(r.relations) || !Array.isArray(r.unknowns))
    throw new Error('unexpected REA trace output');
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------
// Projection: a short, deterministic reading of REA's semantic graph for one source line

const STATE_RANK: Record<ReaState, number> = { unknown: 0, inferred: 1, observed: 2 };
const asState = (s: string | undefined): ReaState => (s === 'observed' ? 'observed' : s === 'inferred' ? 'inferred' : 'unknown');
const weakest = (states: ReaState[]): ReaState => states.reduce<ReaState>((a, b) => (STATE_RANK[b] < STATE_RANK[a] ? b : a), 'observed');
const cmp = (a: Pos, b: Pos) => a.line - b.line || a.column - b.column;
const within = (p: Pos, r: Range) => cmp(p, r.start) >= 0 && cmp(p, r.end) <= 0;
const posKey = (p: Pos) => `${p.line}:${p.column}`;

function rangeOf(loc: SemLocation | undefined): Range | null {
  const v = loc?.available ? loc.value : undefined;
  return v?.start && v.end ? { start: v.start, end: v.end } : null;
}

function bindingName(objectBindingId: unknown): string | null {
  const m = typeof objectBindingId === 'string' ? objectBindingId.match(/:binding:([^:]+)$/) : null;
  return m ? m[1] : null;
}

function memberText(base: string, path: string[]): string {
  return path.reduce((s, p) => (/^\d+$/.test(p) ? `${s}[${p}]` : `${s}.${p}`), base);
}

/** Weakest REA resolution: 'resolved' only when every relation is resolved, else the other values (sorted). */
function resolutionOf(rels: SemRelation[]): string | undefined {
  if (!rels.length) return undefined;
  const weak = [...new Set(rels.map((r) => r.resolution || 'unknown').filter((r) => r !== 'resolved'))].sort();
  return weak.length ? weak.join('+') : 'resolved';
}

/** Where the initializer of a declarator that starts at `fromCol` ends on its line: the next top-level `,` or `;`, an
 *  unmatched closing bracket (`for (const b of xs)`), or a line comment. String and template literals are skipped. */
export function initializerEnd(text: string, fromCol: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = fromCol; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '/' && text[i + 1] === '/') return i;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return i;
      depth--;
    } else if ((ch === ',' || ch === ';') && depth === 0) return i;
  }
  return text.length;
}

export interface LineExplanation {
  function: { name: string; startLine: number; endLine: number; nodeId: string } | null;
  summary: string;
  facts: ReaFact[];
}

/** REA items one fact rests on. */
interface Uses {
  states: ReaState[];
  rels: SemRelation[];
  /** bindings, parameters and property slots whose REA unknowns apply */
  nodeIds: string[];
  /** call-site starts whose REA call-flow unknowns apply */
  calls: Pos[];
}
const noUses = (): Uses => ({ states: [], rels: [], nodeIds: [], calls: [] });
const merge = (...us: Uses[]): Uses => ({
  states: us.flatMap((u) => u.states),
  rels: us.flatMap((u) => u.rels),
  nodeIds: us.flatMap((u) => u.nodeIds),
  calls: us.flatMap((u) => u.calls),
});

/** Reads REA's semantic graph for `modulePath` (REA's path inside the analysed directory) at a 1-based source line.
 *  `source` (the file text) bounds same-line initializers and skips reads inside TypeScript type annotations. */
export function explainLine(g: SemanticGraph, modulePath: string, line: number, opts: { toolsParam?: string; source?: string } = {}): LineExplanation {
  const toolsParam = opts.toolsParam ?? 'tools';
  const srcLines = opts.source?.split('\n') ?? null;
  const ctx = new Map(g.evidence_contexts.map((c) => [c.context_id, asState(c.state)]));
  const stateOf = (x: { evidence: { context_id: string } }) => ctx.get(x.evidence.context_id) ?? 'unknown';
  const inModule = (n: SemNode) => n.identity?.module_path === modulePath || n.evidence.location?.value?.source === modulePath;
  const byId = new Map(g.nodes.map((n) => [n.node_id, n]));
  const ranged = g.nodes
    .filter(inModule)
    .map((n) => ({ n, r: rangeOf(n.evidence.location) }))
    .filter((x): x is { n: SemNode; r: Range } => x.r !== null);
  const rangedById = new Map(ranged.map((x) => [x.n.node_id, x]));

  // Innermost function whose source range covers the line.
  const fns = ranged.filter(({ n }) => n.kind === 'function');
  const fn = fns
    .filter(({ r }) => r.start.line <= line && line <= r.end.line)
    .sort((a, b) => a.r.end.line - a.r.start.line - (b.r.end.line - b.r.start.line) || cmp(b.r.start, a.r.start))[0];
  if (!fn) return { function: null, summary: `REA found no function covering line ${line} of ${modulePath}`, facts: [] };

  // Qualify "run" as "naiveSearch.run" when REA records the method as a property slot of a module-level binding.
  const fnLabel = fn.n.label ?? 'anonymous';
  const ownerSlot = g.nodes.find(
    (n) => inModule(n) && n.kind === 'property-slot' && n.properties.name === fnLabel && String(n.properties.object_binding_id ?? '').startsWith('scope:program:'),
  );
  const owner = ownerSlot ? bindingName(ownerSlot.properties.object_binding_id) : null;
  const fnName = owner ? `${owner}.${fnLabel}` : fnLabel;

  const relsTo = new Map<string, SemRelation[]>();
  for (const rel of g.relations) relsTo.set(rel.target_node_id, [...(relsTo.get(rel.target_node_id) ?? []), rel]);

  // What REA says each expression reads: a property path on a binding (`reads-property`) or a binding (`reads`).
  interface Read {
    pos: Pos;
    text: string;
    base: string;
    path: string[];
    /** the local binding read at this position (null for parameters and module-level names) */
    bindingId: string | null;
    state: ReaState;
    /** every REA read relation at this position (the binding and its property paths) */
    uses: Uses;
  }
  const readsAt = new Map<string, Read[]>();
  for (const { n, r } of ranged) {
    if (n.kind !== 'expression') continue;
    for (const rel of relsTo.get(n.node_id) ?? []) {
      const src = byId.get(rel.source_node_id);
      if (!src) continue;
      const state = weakest([stateOf(rel), stateOf(n)]);
      const uses: Uses = { states: [state], rels: [rel], nodeIds: [src.node_id], calls: [] };
      let read: Read | null = null;
      if (rel.relation === 'reads-property' && src.kind === 'property-slot') {
        const base = bindingName(src.properties.object_binding_id);
        const path = Array.isArray(src.properties.property_path) ? (src.properties.property_path as string[]) : [];
        if (base && path.length) read = { pos: r.start, text: memberText(base, path), base, path, bindingId: null, state, uses };
      } else if (rel.relation === 'reads' && (src.kind === 'binding' || src.kind === 'parameter') && src.label) {
        const local = src.kind === 'binding' && rangedById.has(src.node_id) && within(rangedById.get(src.node_id)!.r.start, fn.r);
        read = { pos: r.start, text: src.label, base: src.label, path: [], bindingId: local ? src.node_id : null, state, uses };
      }
      if (read) readsAt.set(posKey(r.start), [...(readsAt.get(posKey(r.start)) ?? []), read]);
    }
  }
  // `top.address` starts where the read of binding `top` starts: tie member reads to that binding.
  for (const rs of readsAt.values()) {
    const b = rs.find((x) => x.path.length === 0);
    if (b) for (const x of rs) if (x.base === b.base) x.bindingId = b.bindingId;
  }
  // At one position the longest member path is what the code reads (`portfolio.positions.find`, not `portfolio`); it
  // carries every REA relation at that position.
  const best = [...readsAt.values()]
    .map((rs) => {
      const top = rs.slice().sort((a, b) => b.path.length - a.path.length || a.text.localeCompare(b.text))[0];
      return { ...top, state: weakest(rs.map((x) => x.state)), uses: merge(...rs.map((x) => x.uses)) };
    })
    .sort((a, b) => cmp(a.pos, b.pos));
  const bestAt = new Map(best.map((rd) => [posKey(rd.pos), rd]));

  const callSites = ranged.filter(({ n, r }) => n.kind === 'call-site' && within(r.start, fn.r)).sort((a, b) => cmp(a.r.start, b.r.start));
  const calleeRead = (cs: { r: Range }) => bestAt.get(posKey(cs.r.start)) ?? null;
  const calleeOf = (cs: { r: Range }) => calleeRead(cs)?.text ?? 'call';
  /** Reads in a call's source range (callee excluded); reads inside a callback argument are reported separately. */
  const argReads = (cs: { r: Range }) => {
    const callbacks = fns.filter((f) => f.n.node_id !== fn.n.node_id && within(f.r.start, cs.r) && cmp(f.r.start, cs.r.start) > 0);
    const inside = best.filter((rd) => within(rd.pos, cs.r) && cmp(rd.pos, cs.r.start) !== 0);
    const inCb = (rd: Read) => callbacks.some((f) => within(rd.pos, f.r));
    return { direct: inside.filter((rd) => !inCb(rd)), callback: inside.filter(inCb), hasCallback: callbacks.length > 0 };
  };
  const argText = (cs: { r: Range }) => {
    const a = argReads(cs);
    const parts = a.direct.map((x) => x.text);
    if (a.hasCallback) parts.push(`callback reading ${a.callback.map((x) => x.text).join(', ') || 'nothing'}`);
    return parts.join(', ');
  };
  /** The call site node, its callee and every read in its range. */
  const callUses = (cs: { n: SemNode; r: Range }): Uses => {
    const a = argReads(cs);
    const callee = calleeRead(cs);
    return merge({ states: [stateOf(cs.n)], rels: [], nodeIds: [], calls: [cs.r.start] }, ...(callee ? [callee.uses] : []), ...[...a.direct, ...a.callback].map((x) => x.uses));
  };
  /** Skip reads that sit in a type annotation between the declared name and `=` (TypeScript only). */
  const isValueRead = (defPos: Pos, rd: Read) => {
    const text = srcLines?.[defPos.line - 1];
    if (text === undefined) return true;
    const between = text.slice(defPos.column, rd.pos.column);
    const eq = between.search(/=(?!=)/);
    const colon = between.indexOf(':');
    if (colon >= 0 && (eq < 0 || colon < eq)) return false;
    return eq >= 0 || /\s(of|in)\s/.test(between);
  };
  // Start columns of every declarator REA records (`defines`), per line: the next one bounds an initializer.
  const defineCols = new Map<number, number[]>();
  for (const rel of g.relations) {
    if (rel.relation !== 'defines') continue;
    const d = rangedById.get(rel.source_node_id);
    if (d) defineCols.set(d.r.start.line, [...(defineCols.get(d.r.start.line) ?? []), d.r.start.column]);
  }
  /** Reads that belong to the initializer of the declarator at `def` (same line only). Without the source text the lab
   *  cannot bound the initializer, so it makes no claim. */
  const initializerReads = (def: Pos): Read[] => {
    const text = srcLines?.[def.line - 1];
    if (text === undefined) return [];
    const nextDef = Math.min(...(defineCols.get(def.line) ?? []).filter((c) => c > def.column), Infinity);
    const end = Math.min(nextDef, initializerEnd(text, def.column));
    return best.filter((rd) => rd.pos.line === def.line && rd.pos.column > def.column && rd.pos.column < end && isValueRead(def, rd));
  };

  // REA's unknowns, by the node they are about and by source position (call-flow unknowns sit on the function node).
  const unknownsByNode = new Map<string, SemUnknown[]>();
  const unknownsAt = new Map<string, SemUnknown[]>();
  for (const u of g.unknowns ?? []) {
    unknownsByNode.set(u.node_id, [...(unknownsByNode.get(u.node_id) ?? []), u]);
    const r = rangeOf(u.evidence?.location);
    if (r) unknownsAt.set(posKey(r.start), [...(unknownsAt.get(posKey(r.start)) ?? []), u]);
  }
  const subjectOf = (u: SemUnknown): { text: string; pos: Pos | null } => {
    const r = rangeOf(u.evidence?.location);
    const n = byId.get(u.node_id);
    if (u.family === 'call-flow' && r) return { text: bestAt.get(posKey(r.start))?.text ?? `call on line ${r.start.line}`, pos: r.start };
    if (n?.kind === 'property-slot') {
      const base = bindingName(n.properties.object_binding_id);
      const path = Array.isArray(n.properties.property_path) ? (n.properties.property_path as string[]) : [];
      return { text: base && path.length ? memberText(base, path) : (n.label ?? 'property'), pos: r?.start ?? null };
    }
    if (n?.kind === 'task' && r) return { text: `await on line ${r.start.line}`, pos: r.start };
    return { text: n?.label ?? u.node_id.slice(0, 18), pos: r?.start ?? null };
  };
  const unknownLines = (us: SemUnknown[]): string[] | undefined => {
    const seen = new Set<string>();
    const groups = new Map<string, { text: string; pos: Pos | null }[]>();
    for (const u of us) {
      const id = u.unknown_id ?? `${u.node_id}:${u.family}:${u.reason}:${posKey(rangeOf(u.evidence?.location)?.start ?? { line: 0, column: 0 })}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const k = `${u.family} ${u.reason}`;
      groups.set(k, [...(groups.get(k) ?? []), subjectOf(u)]);
    }
    const lines = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, subs]) => {
        const names = [...new Set(subs.sort((a, b) => (a.pos && b.pos ? cmp(a.pos, b.pos) : 0) || a.text.localeCompare(b.text)).map((s) => s.text))];
        return `${k}: ${names.join(', ')}`;
      });
    return lines.length ? lines : undefined;
  };
  const fact = (basis: ReaBasis, text: string, line: number | undefined, u: Uses): ReaFact => {
    const unknowns = unknownLines([
      ...u.nodeIds.flatMap((id) => unknownsByNode.get(id) ?? []),
      ...u.calls.flatMap((p) => (unknownsAt.get(posKey(p)) ?? []).filter((x) => x.family === 'call-flow')),
    ]);
    const resolution = resolutionOf(u.rels);
    return {
      basis,
      state: weakest(u.states),
      ...(resolution ? { resolution } : {}),
      ...(unknowns ? { unknowns } : {}),
      text,
      ...(line !== undefined ? { line } : {}),
    };
  };

  // The attributed call: a call site that starts on the line, preferring a call on the tools object.
  const onLine = callSites.filter(({ r }) => r.start.line === line);
  const attributed = onLine.find((cs) => calleeOf(cs).startsWith(`${toolsParam}.`)) ?? onLine[0] ?? null;

  const facts: ReaFact[] = [];
  const steps: { pos: Pos; text: string }[] = [];
  const provenance: ReaFact[] = [];

  if (attributed) {
    const callee = calleeOf(attributed);
    const text = argText(attributed);
    // Which reads belong to the call is the lab's reading of source ranges, not a REA relation.
    facts.push(fact('revers-projection', text ? `${callee}(…) reads ${text}` : `${callee}(…) is the attributed call`, line, callUses(attributed)));

    // Walk back from the local bindings the call reads to where their values come from.
    const seen = new Set<string>();
    const queue: string[] = [];
    const enqueue = (rd: Read | null) => {
      if (rd?.bindingId && !seen.has(rd.bindingId)) queue.push(rd.bindingId);
    };
    const enqueueCall = (cs: { r: Range }) => {
      enqueue(calleeRead(cs)); // `portfolio` in portfolio.positions.find(…)
      const a = argReads(cs);
      for (const rd of [...a.direct, ...a.callback]) enqueue(rd);
    };
    enqueueCall(attributed);
    while (queue.length && seen.size < 16) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const b = byId.get(id);
      if (!b?.label) continue;
      const bindingUses: Uses = { ...noUses(), nodeIds: [id] };
      // b = await <call>(…): REA relates the call site to the binding with `aliases`.
      const fromCalls = (relsTo.get(id) ?? [])
        .filter((rel) => rel.relation === 'aliases')
        .map((rel) => ({ rel, cs: rangedById.get(rel.source_node_id) }))
        .filter((x): x is { rel: SemRelation; cs: { n: SemNode; r: Range } } => !!x.cs && x.cs.n.kind === 'call-site' && within(x.cs.r.start, fn.r));
      for (const { rel, cs } of fromCalls) {
        const c = calleeOf(cs);
        steps.push({ pos: cs.r.start, text: c });
        provenance.push(fact('rea', `${b.label} ← ${c}(${argText(cs)})`, cs.r.start.line, merge({ ...noUses(), states: [stateOf(rel)], rels: [rel] }, bindingUses, callUses(cs))));
        enqueueCall(cs);
      }
      // b = x / b = x[0] / for (const b of xs): REA records only the declarator (`defines`); the lab takes the reads in
      // that declarator's initializer on the same line.
      const callLines = new Set(fromCalls.map((x) => x.cs.r.start.line));
      for (const rel of relsTo.get(id) ?? []) {
        if (rel.relation !== 'defines') continue;
        const def = rangedById.get(rel.source_node_id);
        if (!def || !within(def.r.start, fn.r) || callLines.has(def.r.start.line)) continue;
        for (const rd of initializerReads(def.r.start)) {
          if (rd.base === b.label || !rd.bindingId) continue; // parameters (task.intent.symbol) are inputs, not provenance steps
          if (rd.path.length) steps.push({ pos: rd.pos, text: rd.text });
          provenance.push(fact('revers-projection', `${b.label} ← ${rd.text}`, rd.pos.line, merge({ ...noUses(), states: [stateOf(rel)], rels: [rel] }, bindingUses, rd.uses)));
          enqueue(rd);
        }
      }
    }
    steps.push({ pos: attributed.r.start, text: callee });
  }

  // Dedupe and order the provenance facts by source position.
  const uniq = new Map<string, ReaFact>();
  for (const f of provenance.sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.text.localeCompare(b.text))) if (!uniq.has(f.text)) uniq.set(f.text, f);
  facts.push(...[...uniq.values()].slice(0, 5));

  // Every member the function calls on the tools parameter, in first-use order (callee read at the call's start).
  const toolCalls = callSites.map((cs) => ({ cs, rd: calleeRead(cs) })).filter((x): x is { cs: (typeof callSites)[number]; rd: Read } => !!x.rd && x.rd.base === toolsParam && x.rd.path.length > 0);
  const toolNames = [...new Set(toolCalls.map((x) => x.rd.path.join('.')))];
  if (toolNames.length)
    facts.push(
      fact(
        'revers-projection',
        `${fnName} calls ${toolsParam}.${toolNames.join(`, ${toolsParam}.`)}`,
        undefined,
        merge(...toolCalls.map((x) => ({ ...x.rd.uses, calls: [x.cs.r.start], states: [...x.rd.uses.states, stateOf(x.cs.n)] }))),
      ),
    );

  // REA's own unknowns inside the function, by family and reason.
  const fnUnknowns = (g.unknowns ?? []).filter((u) => {
    const r = rangeOf(u.evidence?.location);
    const n = byId.get(u.node_id);
    return r !== null && within(r.start, fn.r) && (n ? inModule(n) : u.evidence.location.value?.source === modulePath);
  });
  if (fnUnknowns.length) {
    const counts = new Map<string, number>();
    for (const u of fnUnknowns) counts.set(`${u.family} ${u.reason}`, (counts.get(`${u.family} ${u.reason}`) ?? 0) + 1);
    const parts = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `${n} ${k}`);
    facts.push({ basis: 'rea', state: 'unknown', text: `REA lists ${fnUnknowns.length} unknowns in ${fnName}: ${parts.join(', ')}` });
  }

  const chain = steps
    .sort((a, b) => cmp(a.pos, b.pos))
    .filter((s, i, all) => all.findIndex((o) => posKey(o.pos) === posKey(s.pos)) === i)
    .map((s) => s.text);
  const summary = chain.length ? `${fnName}: ${chain.join(' → ')}` : `${fnName} (lines ${fn.r.start.line}–${fn.r.end.line})`;
  return { function: { name: fnName, startLine: fn.r.start.line, endLine: fn.r.end.line, nodeId: fn.n.node_id }, summary, facts };
}

/** Facts from REA's ownership trace of the function: awaited work, REA's coverage status and unresolved call targets. */
export function traceFacts(t: OwnershipTrace, fnName: string): ReaFact[] {
  const out: ReaFact[] = [];
  const ctx = new Map((t.evidence_contexts ?? []).map((c) => [c.context_id, asState(c.state)]));
  const awaits = t.relations.filter((r) => r.relation === 'awaits');
  if (awaits.length) {
    // REA's promise-ownership unknowns on those awaits, one entry per reason with the lines it applies to.
    const byReason = new Map<string, Set<number>>();
    for (const u of t.unknowns.filter((x) => x.family === 'promise-ownership')) {
      const l = rangeOf(u.evidence?.location)?.start.line;
      const k = `promise-ownership ${u.reason}`;
      if (!byReason.has(k)) byReason.set(k, new Set());
      if (typeof l === 'number') byReason.get(k)!.add(l);
    }
    const unknowns = [...byReason.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, ls]) => {
        const lines = [...ls].sort((a, b) => a - b);
        return lines.length ? `${k}: awaits on line${lines.length === 1 ? '' : 's'} ${lines.join(', ')}` : k;
      });
    const resolution = resolutionOf(awaits);
    out.push({
      basis: 'rea',
      state: weakest(awaits.map((r) => ctx.get(r.evidence.context_id) ?? 'unknown')),
      ...(resolution ? { resolution } : {}),
      ...(unknowns.length ? { unknowns } : {}),
      text: `${fnName} awaits ${awaits.length} expressions (REA ownership trace)`,
    });
  }
  const cov = t.coverage?.status;
  if (cov) {
    const n = t.summary?.relevant_unknowns;
    out.push({
      basis: 'rea',
      state: cov === 'complete' ? 'inferred' : 'unknown',
      text: `REA rates the ownership trace of ${fnName} as ${cov} coverage${typeof n === 'number' ? ` (${n} relevant unknowns)` : ''}`,
    });
  }
  const dyn = t.unknowns.filter((u) => u.reason === 'dynamic-call').length;
  if (dyn)
    out.push({ basis: 'rea', state: 'unknown', text: `REA leaves ${dyn} member-call targets in ${fnName} unresolved (dynamic-call); the tools implementation is not part of this analysis` });
  return out;
}

export function importFacts(a: AnalysisEvidence): ReaFact[] {
  const refs = a.normalized_result.graph.nodes
    .filter((n) => n.kind === 'javascript-module')
    .flatMap((n) => n.observations)
    .filter((o) => o.properties.semantic_role === 'module-reference' && typeof o.properties.declared_specifier === 'string');
  const specs = [...new Set(refs.map((o) => `${o.properties.declared_specifier as string}`))].sort();
  if (!specs.length) return [];
  return [{ basis: 'rea', state: weakest(refs.map((o) => asState(o.evidence?.state ?? 'observed'))), text: `imports ${specs.join(', ')}` }];
}

// ---------------------------------------------------------------------------------------------------------------------
// Runner with per-file cache

export interface ReaAnalyzerOptions {
  install?: ReaInstall | null;
  exec?: ReaExec;
  timeoutMs?: number;
  repoRoot?: string;
  /** where staged copies and per-process scratch directories go (default: <repo>/node_modules/.cache/revers-lab-rea) */
  workDir?: string;
}

interface FileAnalysis {
  rel: string;
  modulePath: string;
  /** the exact bytes REA analysed, as text */
  source: string;
  evidence: AnalysisEvidence;
  /** REA's analysis stdout, reused as the trace input */
  stdout: string;
}

const sameBytes = (path: string, bytes: Buffer) => {
  try {
    return readFileSync(path).equals(bytes);
  } catch {
    return false;
  }
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export class ReaAnalyzer {
  readonly install: ReaInstall | null;
  private readonly exec: ReaExec;
  private readonly timeoutMs: number;
  private readonly repoRoot: string;
  private readonly workDir: string;
  private readonly files = new Map<string, Promise<FileAnalysis | ReaError>>();
  private readonly traces = new Map<string, Promise<OwnershipTrace | string>>();
  private prunedScratch = false;
  /** number of REA processes started (for tests and logs) */
  processes = 0;

  constructor(opts: ReaAnalyzerOptions = {}) {
    this.install = opts.install === undefined ? findReaInstall() : opts.install;
    this.exec = opts.exec ?? nodeExec;
    this.timeoutMs = opts.timeoutMs ?? (Number(process.env.REA_TIMEOUT_MS) || REA_DEFAULT_TIMEOUT_MS);
    this.repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;
    this.workDir = opts.workDir ?? join(this.repoRoot, 'node_modules', '.cache', 'revers-lab-rea');
  }

  /** Keeps records free of machine paths (results.json is published and must be identical across runs). */
  private scrub(message: string): string {
    let m = message
      .split(join(this.workDir, 'tmp'))
      .join('<rea-scratch>')
      .replace(/<rea-scratch>\/\d+-[A-Za-z0-9]+/g, '<rea-scratch>')
      .split(this.workDir)
      .join('<rea-work>')
      .split(this.repoRoot)
      .join('<repo>');
    for (const [root, label] of [
      [tmpdir(), '<tmp>'],
      [homedir(), '<home>'],
    ] as const)
      if (root && root.length > 1) m = m.split(root.replace(/\/$/, '')).join(label);
    // anything absolute that is left (e.g. /private/var/folders/… on macOS)
    return m.replace(/(^|[\s'"(=:])\/(?:Users|home|private|var|tmp|opt|Library|Applications)\/[^\s'"),;]*/g, '$1<path>');
  }

  private error(rel: string, message: string): ReaError {
    return { status: 'error', tool: 'rea-agents', version: this.install?.version ?? null, input: rel, message: this.scrub(message) };
  }

  /** Removes scratch directories left by lab processes that are gone (e.g. after Ctrl-C), never those of a live one. */
  private pruneScratch(root: string) {
    if (this.prunedScratch) return;
    this.prunedScratch = true;
    try {
      for (const name of readdirSync(root)) {
        const pid = Number(name.split('-')[0]);
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && !alive(pid)) rmSync(join(root, name), { recursive: true, force: true });
      }
    } catch {
      /* nothing to prune */
    }
  }

  /** Runs REA with a private scratch directory (its TMPDIR and any input file), removed afterwards. */
  private async run(args: (scratch: string) => string[]): Promise<ExecResult> {
    const root = join(this.workDir, 'tmp');
    mkdirSync(root, { recursive: true });
    this.pruneScratch(root);
    const scratch = mkdtempSync(join(root, `${process.pid}-`));
    liveDirs.add(scratch);
    installExitHook();
    try {
      const tmp = join(scratch, 'tmp');
      mkdirSync(tmp);
      const argv = args(scratch);
      this.processes++;
      return await this.exec(this.install!.bin, argv, { timeoutMs: this.timeoutMs, cwd: this.repoRoot, tmpDir: tmp });
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      liveDirs.delete(scratch);
    }
  }

  /** Analyses one agent file once per (file, REA version); concurrent and repeated callers share the result. */
  analyzeFile(rel: string): Promise<FileAnalysis | ReaError> {
    const key = `${this.install?.version ?? 'none'}:${rel}`;
    let p = this.files.get(key);
    if (!p) {
      p = this.doAnalyze(rel);
      this.files.set(key, p);
    }
    return p;
  }

  /** REA analyses directories. Each file gets one that holds only that file, named by its content hash: the path (and
   *  so REA's Evidence id) is stable while the file is unchanged, and concurrent lab runs never rewrite or delete a
   *  directory another run is analysing (it is created by an atomic rename and never modified). */
  private stage(rel: string, bytes: Buffer): string {
    const stem = basename(rel, extname(rel)).replace(/[^A-Za-z0-9._-]/g, '_');
    const parent = join(this.workDir, 'src');
    const stage = join(parent, `${stem}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`);
    const target = join(stage, basename(rel));
    if (sameBytes(target, bytes)) return stage;
    mkdirSync(parent, { recursive: true });
    const tmp = mkdtempSync(join(parent, `.${stem}-`));
    writeFileSync(join(tmp, basename(rel)), bytes);
    try {
      renameSync(tmp, stage);
    } catch {
      rmSync(tmp, { recursive: true, force: true }); // another run staged it first
    }
    if (!sameBytes(target, bytes) || readdirSync(stage).length !== 1) throw new Error(`staged copy at ${stage} does not match ${rel}`);
    // Staged copies of earlier versions of this file, untouched for a day, are no longer used by any run.
    for (const name of readdirSync(parent))
      if (name.startsWith(`${stem}-`) && join(parent, name) !== stage)
        try {
          if (Date.now() - statSync(join(parent, name)).mtimeMs > 86_400_000) rmSync(join(parent, name), { recursive: true, force: true });
        } catch {
          /* gone already */
        }
    return stage;
  }

  private async doAnalyze(rel: string): Promise<FileAnalysis | ReaError> {
    if (!this.install) return this.error(rel, 'rea-agents is not installed (npm install -w @revers/lab)');
    const abs = join(this.repoRoot, rel);
    if (!existsSync(abs)) return this.error(rel, `source file not found: ${rel}`);
    const bytes = readFileSync(abs);
    let stage: string;
    try {
      stage = this.stage(rel, bytes);
    } catch (e) {
      return this.error(rel, `could not stage ${rel}: ${(e as Error).message}`);
    }
    const r = await this.run(() => ['analyze-javascript-application', stage, '--json']);
    if (r.timedOut || r.code !== 0) return this.error(rel, `analyze-javascript-application failed: ${reaFailureMessage(r, this.timeoutMs)}`);
    try {
      const evidence = parseAnalysis(r.stdout);
      return { rel, modulePath: basename(rel), source: bytes.toString('utf8'), evidence, stdout: r.stdout.trim() };
    } catch (e) {
      return this.error(rel, `analyze-javascript-application: ${(e as Error).message}`);
    }
  }

  private ownershipTrace(fa: FileAnalysis, fnNodeId: string): Promise<OwnershipTrace | string> {
    const key = `${this.install?.version}:${fa.rel}:${fnNodeId}`;
    let p = this.traces.get(key);
    if (!p) {
      p = (async () => {
        const query = JSON.stringify({ seed: { kind: 'semantic-node', node_id: fnNodeId }, direction: 'ownership' });
        let r: ExecResult;
        try {
          r = await this.run((scratch) => {
            const input = join(scratch, 'trace-input.json');
            writeFileSync(input, `{"application":${fa.stdout},"query":${query}}`);
            return ['trace-javascript-semantics', input, '--json'];
          });
        } catch (e) {
          return this.scrub(`could not run trace: ${(e as Error).message}`);
        }
        if (r.timedOut || r.code !== 0) return this.scrub(`trace-javascript-semantics failed: ${reaFailureMessage(r, this.timeoutMs)}`);
        try {
          return parseTrace(r.stdout);
        } catch (e) {
          return `trace-javascript-semantics: ${(e as Error).message}`;
        }
      })();
      this.traces.set(key, p);
    }
    return p;
  }

  /** REA evidence for the code path at `rel:line` (rel is repo-relative). Never throws: failures become error records. */
  async explain(rel: string, line: number): Promise<ReaEvidence> {
    try {
      return await this.explainUnsafe(rel, line);
    } catch (e) {
      return this.error(rel, `unexpected REA output: ${(e as Error).message}`);
    }
  }

  private async explainUnsafe(rel: string, line: number): Promise<ReaEvidence> {
    const fa = await this.analyzeFile(rel);
    if ('status' in fa) return fa;
    const g = fa.evidence.normalized_result.semantic_graph;
    const ex = explainLine(g, fa.modulePath, line, { source: fa.source });
    const facts = [...ex.facts];
    let queryId: string | null = null;
    let traceCoverage: string | null = null;
    let command = `rea analyze-javascript-application <dir with ${rel}> --json`;
    if (ex.function) {
      command += ` && rea trace-javascript-semantics {seed: ${ex.function.name}, direction: ownership}`;
      const t = await this.ownershipTrace(fa, ex.function.nodeId);
      if (typeof t === 'string') facts.push({ basis: 'rea', state: 'unknown', text: `ownership trace not available: ${t}` });
      else {
        queryId = t.query_id;
        traceCoverage = typeof t.coverage?.status === 'string' ? t.coverage.status : null;
        facts.push(...traceFacts(t, ex.function.name));
      }
    }
    facts.push(...importFacts(fa.evidence));
    const pf = fa.evidence.normalized_result.statistics?.parse_failures ?? 0;
    if (pf > 0) facts.push({ basis: 'rea', state: 'unknown', text: `REA reported ${pf} parse failures` });
    return {
      status: 'ran',
      tool: 'rea-agents',
      version: this.install!.version,
      command,
      input: rel,
      graphId: g.graph_id,
      queryId,
      traceCoverage,
      reaEvidenceId: fa.evidence.evidence_id,
      function: ex.function ? { name: ex.function.name, startLine: ex.function.startLine, endLine: ex.function.endLine } : null,
      summary: ex.summary,
      facts,
    };
  }
}

export type ReaMode = 'on' | 'disabled' | 'missing' | 'no-toolchain';

/** Whether attribution should call REA: on by default when rea-agents is installed (and, on macOS, `xcrun swiftc`
 *  works); REA_ENABLE=0 turns it off. */
export function reaMode(
  env: NodeJS.ProcessEnv = process.env,
  install: ReaInstall | null = findReaInstall(),
  toolchainProblem: () => string | null = () => reaToolchainProblem(),
): ReaMode {
  if (env.REA_ENABLE === '0') return 'disabled';
  if (!install) return 'missing';
  return toolchainProblem() ? 'no-toolchain' : 'on';
}

/** The attribution's rea string when REA does not run for the whole lab run. */
export function reaNotRunReason(mode: ReaMode, toolchainProblem: () => string | null = () => reaToolchainProblem()): string {
  if (mode === 'disabled') return 'not-run (REA_ENABLE=0)';
  if (mode === 'missing') return 'not-run (rea-agents not installed)';
  if (mode === 'no-toolchain') return `not-run (${toolchainProblem() ?? 'xcrun swiftc unavailable'})`;
  return 'not-run';
}

let shared: ReaAnalyzer | null | undefined;

/** The process-wide analyzer (one cache per lab run), or null when REA is off. With REA_ENABLE=1 an analyzer is returned
 *  even when rea-agents or `xcrun swiftc` is missing, so every attribution records REA's error instead of skipping. */
export function defaultReaAnalyzer(): ReaAnalyzer | null {
  if (shared === undefined) {
    const install = findReaInstall();
    const mode = reaMode(process.env, install);
    shared = mode === 'on' || (mode !== 'disabled' && process.env.REA_ENABLE === '1') ? new ReaAnalyzer({ install }) : null;
  }
  return shared;
}
