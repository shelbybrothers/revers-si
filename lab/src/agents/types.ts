import type { AgentTools } from '../tools.js';
import type { Task } from '../tasks.js';

/** Token usage and estimated cost of one LLM agent run (summed over its turns). */
export interface LlmUsage {
  model: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** estimated from public per-MTok prices; not an invoice */
  costUsd: number;
  stopReason: string | null;
}

/**
 * Thrown when a run is stopped by the harness or the model provider rather than by the agent's own decisions
 * (spend cap, model refusal, truncated output, API failure). The runner records such runs as verdict 'error',
 * excluded from the leaderboard, instead of scoring them as agent failures.
 */
export class AgentHarnessError extends Error {
  override name = 'AgentHarnessError';
}

export interface RunContext {
  onLlmUsage?(usage: LlmUsage): void;
}

export interface TradingAgent {
  id: string;
  name: string;
  kind: 'reference' | 'llm' | 'external';
  description: string;
  /** model id for kind 'llm' */
  model?: string;
  /** source file (repo-relative) used by attribution */
  sourceFile: string;
  /** returns a reason string when the agent cannot run in this environment (status 'skipped') */
  unavailable?(): string | null;
  /** async check run once before any run (e.g. a free credentials probe); a reason string skips the agent */
  preflight?(): Promise<string | null>;
  run(task: Task, tools: AgentTools, ctx?: RunContext): Promise<void>;
}
