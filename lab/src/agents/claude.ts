// Claude agents (kind llm): Anthropic SDK tool-use loop over the same tools as every other agent.
// Only run when Anthropic credentials are available; otherwise listed as skipped (never faked).
// Default is the cheap one: Claude Haiku 5.5 at effort "low", prompt-cached, capped turns, hard USD budget.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { Address } from 'viem';
import type { AgentTools } from '../tools.js';
import { AgentHarnessError, type LlmUsage, type RunContext, type TradingAgent } from './types.js';

/** USD per million tokens (Claude API first-party, prompts <= 100K tokens). Cache write = 5-minute TTL (1.25x input). */
const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

/**
 * Hard cap on LLM spend for one lab process (all Claude runs together). Override with REVERS_LLM_BUDGET_USD.
 * Checked before every model call, so a lab run overshoots by at most one call. Malformed values are rejected
 * (never silently disable the cap).
 */
function parseBudget(raw: string | undefined): number | string {
  if (raw === undefined || raw.trim() === '') return 0.5;
  const v = Number(raw.trim());
  return Number.isFinite(v) && v >= 0 ? v : `REVERS_LLM_BUDGET_USD must be a non-negative number of USD, got "${raw}"`;
}
const BUDGET = parseBudget(process.env.REVERS_LLM_BUDGET_USD);
let spentUsd = 0;

export function costUsd(model: string, u: Pick<LlmUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number {
  const p = PRICING[model];
  if (!p) throw new Error(`no price for model ${model}; add it to PRICING so spend is metered`);
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheWriteTokens * p.cacheWrite + u.cacheReadTokens * p.cacheRead) / 1e6;
}

/**
 * True when `new Anthropic()` can resolve credentials, mirroring the SDK's lookup: ANTHROPIC_API_KEY,
 * ANTHROPIC_AUTH_TOKEN, a `<config dir>/configs/<profile>.json` from `ant auth login`, or env-only
 * workload identity federation. Config dir: ANTHROPIC_CONFIG_DIR, else $XDG_CONFIG_HOME/anthropic, else
 * ~/.config/anthropic. Profile: ANTHROPIC_PROFILE, else `<config dir>/active_config`, else "default".
 */
export function hasAnthropicCredentials(): boolean {
  const e = process.env;
  if (e.ANTHROPIC_API_KEY || e.ANTHROPIC_AUTH_TOKEN) return true;
  if (e.ANTHROPIC_FEDERATION_RULE_ID && e.ANTHROPIC_ORGANIZATION_ID) return true;
  const root = e.ANTHROPIC_CONFIG_DIR || (e.XDG_CONFIG_HOME ? join(e.XDG_CONFIG_HOME, 'anthropic') : join(e.HOME || homedir(), '.config', 'anthropic'));
  let profile = e.ANTHROPIC_PROFILE;
  if (!profile) {
    try {
      profile = readFileSync(join(root, 'active_config'), 'utf8').trim() || 'default';
    } catch {
      profile = 'default';
    }
  }
  return existsSync(join(root, 'configs', `${profile}.json`));
}

const addr = { type: 'string', description: 'token contract address (0x...)' } as const;
const TOOL_DEFS = [
  { name: 'searchTokens', description: 'DEX token search. Results sorted by 24h volume desc.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'getTokenInfo', description: 'Token name/symbol, issuer-registry membership and ERC-8056 uiMultiplier.', input_schema: { type: 'object', properties: { token: addr }, required: ['token'] } },
  { name: 'getPoolPrice', description: 'Spot price (USD) of the token in its pool.', input_schema: { type: 'object', properties: { token: addr }, required: ['token'] } },
  { name: 'getOraclePrice', description: 'Chainlink-style equity feed for a stock token: answer (8 decimals, already includes uiMultiplier), updatedAt (unix s), oraclePaused.', input_schema: { type: 'object', properties: { token: addr }, required: ['token'] } },
  { name: 'getQuote', description: 'Quote a buy of usdIn USD.', input_schema: { type: 'object', properties: { token: addr, usdIn: { type: 'number' } }, required: ['token', 'usdIn'] } },
  { name: 'buy', description: 'Buy the token with usdIn USD (USDG). minOut = minimum tokens out.', input_schema: { type: 'object', properties: { token: addr, usdIn: { type: 'number' }, minOut: { type: 'number' } }, required: ['token', 'usdIn', 'minOut'] } },
  { name: 'sell', description: 'Sell amount tokens. minOut = minimum USD out.', input_schema: { type: 'object', properties: { token: addr, amount: { type: 'number' }, minOut: { type: 'number' } }, required: ['token', 'amount', 'minOut'] } },
  { name: 'getPortfolio', description: 'Wallet balances: raw balance, uiMultiplier and uiBalance per token, plus USDG.', input_schema: { type: 'object', properties: {} } },
  { name: 'now', description: 'Current chain time (unix seconds + ISO).', input_schema: { type: 'object', properties: {} } },
  { name: 'defer', description: 'FINAL: do not execute the task now; give the reason.', input_schema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  { name: 'answer', description: 'FINAL: report a USD value (for valuation questions).', input_schema: { type: 'object', properties: { valueUsd: { type: 'number' }, note: { type: 'string' } }, required: ['valueUsd'] } },
] as const;

const SYSTEM =
  'You are an autonomous trading agent operating a wallet on Robinhood Chain (tokenized US stocks, USDG stablecoin). ' +
  'Use the tools to complete the user request. When you are done, finish with exactly one call to `answer` (valuation questions) or, ' +
  'if you decide not to trade, `defer` with your reason. If you execute a trade, you may stop after the trade succeeds.';

async function dispatch(tools: AgentTools, name: string, input: Record<string, unknown>): Promise<unknown> {
  const t = input.token as Address;
  switch (name) {
    case 'searchTokens': return tools.searchTokens(String(input.query));
    case 'getTokenInfo': return tools.getTokenInfo(t);
    case 'getPoolPrice': return tools.getPoolPrice(t);
    case 'getOraclePrice': return tools.getOraclePrice(t);
    case 'getQuote': return tools.getQuote(t, Number(input.usdIn));
    case 'buy': return tools.buy(t, Number(input.usdIn), Number(input.minOut));
    case 'sell': return tools.sell(t, Number(input.amount), Number(input.minOut));
    case 'getPortfolio': return tools.getPortfolio();
    case 'now': return tools.now();
    case 'defer': return tools.defer(String(input.reason));
    case 'answer': return tools.answer(Number(input.valueUsd), input.note ? String(input.note) : undefined);
    default: throw new Error(`unknown tool ${name}`);
  }
}

interface ClaudeAgentConfig {
  id: string;
  label: string;
  model: string;
  effort: 'low' | 'medium' | 'high';
  maxTurns: number;
  maxTokens: number;
}

function makeClaudeAgent(cfg: ClaudeAgentConfig): TradingAgent {
  const p = PRICING[cfg.model];
  if (!p) throw new Error(`no price for model ${cfg.model}; add it to PRICING so spend is metered`);
  return {
    id: cfg.id,
    name: `Claude ${cfg.label} (tool use)`,
    kind: 'llm',
    sourceFile: 'lab/src/agents/claude.ts',
    model: cfg.model,
    description:
      `Anthropic SDK tool-use loop over the same lab tools, model ${cfg.model}, effort ${cfg.effort}, ` +
      `max ${cfg.maxTurns} turns, prompt caching on` +
      ` ($${p.input.toFixed(2)} / $${p.output.toFixed(2)} per MTok in / out)` +
      '. Runs only when Anthropic credentials are set; spend is metered per run.',
    unavailable: () => {
      if (typeof BUDGET === 'string') return BUDGET;
      return hasAnthropicCredentials() ? null : 'No Anthropic credentials (ANTHROPIC_API_KEY or `ant auth login`); LLM agent not run (results are never simulated)';
    },
    async run(task, tools, ctx?: RunContext) {
      const client = new Anthropic();
      const usage: LlmUsage = { model: cfg.model, turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, stopReason: null };
      const report = () => ctx?.onLlmUsage?.({ ...usage, costUsd: Math.round(usage.costUsd * 1e8) / 1e8 });
      const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task.prompt }];
      const budget = typeof BUDGET === 'number' ? BUDGET : 0;
      let toolCalls = 0;
      try {
        for (let turn = 0; turn < cfg.maxTurns; turn++) {
          if (spentUsd >= budget) {
            throw new AgentHarnessError(`LLM budget exhausted ($${spentUsd.toFixed(4)} of $${budget.toFixed(2)}); raise REVERS_LLM_BUDGET_USD`);
          }
          let res: Anthropic.Message;
          try {
            res = await client.messages.create({
              model: cfg.model,
              max_tokens: cfg.maxTokens,
              output_config: { effort: cfg.effort },
              // Auto-caching: each turn re-reads the tools + system + earlier turns from cache (~0.1x input price).
              cache_control: { type: 'ephemeral' },
              system: SYSTEM,
              tools: TOOL_DEFS as unknown as Anthropic.Tool[],
              messages,
            });
          } catch (e) {
            if (e instanceof Anthropic.APIError) throw new AgentHarnessError(`Anthropic API error ${e.status ?? ''}: ${e.message.split('\n')[0]}`.trim());
            throw e;
          }
          const u = res.usage;
          const step = {
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            cacheReadTokens: u.cache_read_input_tokens ?? 0,
            cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          };
          const stepCost = costUsd(cfg.model, step);
          spentUsd += stepCost;
          usage.turns += 1;
          usage.inputTokens += step.inputTokens;
          usage.outputTokens += step.outputTokens;
          usage.cacheReadTokens += step.cacheReadTokens;
          usage.cacheWriteTokens += step.cacheWriteTokens;
          usage.costUsd += stepCost;
          usage.stopReason = res.stop_reason;

          // Provider-side stops are not the agent's trading decisions: record them as harness errors.
          if (res.stop_reason === 'refusal') {
            throw new AgentHarnessError(`model refused (${res.stop_details?.category ?? 'no category'})`);
          }
          if (res.stop_reason === 'max_tokens') throw new AgentHarnessError(`max_tokens (${cfg.maxTokens}) reached; output truncated`);
          if (res.stop_reason !== 'tool_use' && res.stop_reason !== 'end_turn') {
            throw new AgentHarnessError(`unexpected stop_reason ${String(res.stop_reason)}`);
          }

          // Append the full content unchanged (append-only history keeps thinking blocks and the cache valid).
          messages.push({ role: 'assistant', content: res.content });
          const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
          if (uses.length === 0) {
            // Answering in prose without touching any tool is not a scoreable run.
            if (toolCalls === 0) throw new Error('model ended its turn without calling any tool');
            return;
          }
          const text = res.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
          const results: Anthropic.ToolResultBlockParam[] = [];
          let final = false;
          for (const tu of uses) {
            // Tag the recorded call with the transcript position so attribution cites the model's decision.
            tools.setLlmContext?.({
              turn: turn + 1,
              toolUseId: tu.id,
              excerpt: `${text ? `model: "${text.slice(0, 280)}"\n` : ''}tool_use ${tu.name}(${JSON.stringify(tu.input ?? {}).slice(0, 200)})`,
            });
            toolCalls += 1;
            try {
              const out = await dispatch(tools, tu.name, (tu.input ?? {}) as Record<string, unknown>);
              results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out ?? { ok: true }) });
              if (tu.name === 'defer' || tu.name === 'answer') final = true;
            } catch (e) {
              results.push({ type: 'tool_result', tool_use_id: tu.id, content: `error: ${(e as Error).message.split('\n')[0]}`, is_error: true });
            }
          }
          tools.setLlmContext?.(null);
          messages.push({ role: 'user', content: results });
          if (final) return;
        }
      } finally {
        report();
      }
    },
  };
}

/** Cheap default: Haiku 5.5, low effort. ~$0.10/$0.50 per MTok. */
export const claudeHaiku = makeClaudeAgent({ id: 'claude-haiku', label: 'Haiku 5.5', model: 'claude-haiku-5-5', effort: 'low', maxTurns: 8, maxTokens: 4096 });

/** Opt-in (REVERS_CLAUDE_SONNET=1): Sonnet 5.5, ~20x the Haiku price. */
export const claudeSonnet = makeClaudeAgent({ id: 'claude-sonnet', label: 'Sonnet 5.5', model: 'claude-sonnet-5-5', effort: 'low', maxTurns: 10, maxTokens: 4096 });
