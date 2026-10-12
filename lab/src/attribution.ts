// Maps a failed check to the agent call that caused it, and that call's JS stack frame to file:line plus a
// 3-line snippet of the agent source. Evidence ids are content hashes so they are stable across identical runs.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Check } from './scoring.js';
import type { CallRecord } from './tools.js';
import { REPO_ROOT } from './world.js';

export interface Attribution {
  evidenceId: string;
  checkId: string;
  file: string;
  line: number;
  column: number | null;
  snippet: string;
  call: { seq: number; tool: string; args: Record<string, unknown>; ok: boolean; error: string | null; blockTime: number };
  rea: 'not-run' | string;
  /** LLM agents: the transcript position of the decision (file/line then point at the transcript, not the harness). */
  transcript?: { turn: number; toolUseId: string; excerpt: string };
}

export interface Frame {
  file: string;
  line: number;
  column: number | null;
}

/** Parse V8 stack lines: "at fn (path:line:col)" / "at path:line:col" (path may be a file:// URL). */
export function parseStack(stack: string): Frame[] {
  const out: Frame[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    // Paths may contain spaces ("Application Support"), so match greedily up to the trailing :line:col.
    const m = line.match(/\((.+):(\d+):(\d+)\)$/) ?? line.match(/^at (?:async )?(.+):(\d+):(\d+)$/);
    if (!m) continue;
    let file = m[1];
    if (file.startsWith('file://')) {
      try {
        file = fileURLToPath(file);
      } catch {
        /* keep as is */
      }
    }
    out.push({ file, line: Number(m[2]), column: Number(m[3]) });
  }
  return out;
}

/** First frame inside the agents directory (the agent's own decision point). */
export function agentFrame(stack: string): Frame | null {
  const frames = parseStack(stack);
  const marker = `${sep}lab${sep}src${sep}agents${sep}`;
  return frames.find((f) => f.file.includes(marker) || f.file.includes('/lab/src/agents/')) ?? null;
}

export function snippetAt(absFile: string, line: number): string {
  if (!existsSync(absFile)) return '';
  const lines = readFileSync(absFile, 'utf8').split('\n');
  const from = Math.max(1, line - 1);
  const to = Math.min(lines.length, line + 1);
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${String(i).padStart(3)}${i === line ? ' >' : '  '} ${lines[i - 1]}`);
  return out.join('\n');
}

export function evidenceId(parts: unknown): string {
  return 'ev_' + createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
}

function reaStatus(): string {
  if (process.env.REA_ENABLE !== '1') return 'not-run';
  const bin = join(REPO_ROOT, 'node_modules', '.bin', 'rea-agents');
  // Never downloads anything: only a locally installed rea-agents binary would be used.
  return existsSync(bin) ? 'not-run (rea-agents present; integration not implemented in v0)' : 'not-run (rea-agents not installed)';
}

export function attribute(
  ctx: { agentId: string; scenarioId: string; taskId: string; agentKind?: 'reference' | 'llm' | 'external' },
  check: Check,
  calls: CallRecord[],
): Attribution | null {
  const call = calls.find((c) => c.seq === check.callSeq) ?? null;
  if (!call) return null;
  const callOutLlm = { seq: call.seq, tool: call.tool, args: call.args, ok: call.ok, error: call.error ?? null, blockTime: call.blockTime };
  if (ctx.agentKind === 'llm') {
    // The model's decision, not the dispatcher switch, is what lost the money: cite the transcript.
    if (!call.llm) return null;
    const { turn, toolUseId, excerpt } = call.llm;
    return {
      evidenceId: evidenceId({ agentId: ctx.agentId, scenarioId: ctx.scenarioId, taskId: ctx.taskId, checkId: check.id, turn, toolUseId, tool: call.tool, args: call.args, blockTime: call.blockTime }),
      checkId: check.id,
      file: `transcript:${ctx.agentId}`,
      line: turn,
      column: null,
      snippet: `turn ${turn} · tool_use ${toolUseId}\n${excerpt}`.trim(),
      call: callOutLlm,
      rea: 'not-run',
      transcript: { turn, toolUseId, excerpt },
    };
  }
  const frame = agentFrame(call.stack);
  if (!frame) return null;
  const rel = relative(REPO_ROOT, frame.file).split(sep).join('/');
  const snippet = snippetAt(frame.file, frame.line);
  const callOut = { seq: call.seq, tool: call.tool, args: call.args, ok: call.ok, error: call.error ?? null, blockTime: call.blockTime };
  return {
    evidenceId: evidenceId({ agentId: ctx.agentId, scenarioId: ctx.scenarioId, taskId: ctx.taskId, checkId: check.id, file: rel, line: frame.line, tool: call.tool, args: call.args, blockTime: call.blockTime }),
    checkId: check.id,
    file: rel,
    line: frame.line,
    column: frame.column,
    snippet,
    call: callOut,
    rea: reaStatus(),
  };
}
