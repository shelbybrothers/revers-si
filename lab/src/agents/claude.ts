// Claude agent (kind llm): Anthropic SDK tool-use loop over the same tools as every other agent.
// Only runs when ANTHROPIC_API_KEY is set; otherwise it is listed as skipped (never faked).
import Anthropic from '@anthropic-ai/sdk';
import type { Address } from 'viem';
import type { AgentTools } from '../tools.js';
import type { TradingAgent } from './types.js';

export const CLAUDE_MODEL = 'claude-sonnet-5-5';
const MAX_TURNS = 14;

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

export const claudeAgent: TradingAgent = {
  id: 'claude',
  name: `Claude (${CLAUDE_MODEL}, tool use)`,
  kind: 'llm',
  sourceFile: 'lab/src/agents/claude.ts',
  description: `Anthropic SDK tool-use loop over the same lab tools, model ${CLAUDE_MODEL}. Runs only when ANTHROPIC_API_KEY is set.`,
  unavailable: () => (process.env.ANTHROPIC_API_KEY ? null : 'ANTHROPIC_API_KEY not set; LLM agent not run (results are never simulated)'),
  async run(task, tools) {
    const client = new Anthropic();
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: task.prompt }];
    const system =
      'You are an autonomous trading agent operating a wallet on Robinhood Chain (tokenized US stocks, USDG stablecoin). ' +
      'Use the tools to complete the user request. When you are done, finish with exactly one call to `answer` (valuation questions) or, ' +
      'if you decide not to trade, `defer` with your reason. If you execute a trade, you may stop after the trade succeeds.';
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system,
        tools: TOOL_DEFS as unknown as Anthropic.Tool[],
        messages,
      });
      messages.push({ role: 'assistant', content: res.content });
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || uses.length === 0) return;
      const results: Anthropic.ToolResultBlockParam[] = [];
      let final = false;
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      for (const u of uses) {
        // Tag the recorded call with the transcript position so attribution cites the model's decision.
        tools.setLlmContext?.({
          turn: turn + 1,
          toolUseId: u.id,
          excerpt: `${text ? `model: "${text.slice(0, 280)}"\n` : ''}tool_use ${u.name}(${JSON.stringify(u.input ?? {}).slice(0, 200)})`,
        });
        try {
          const out = await dispatch(tools, u.name, (u.input ?? {}) as Record<string, unknown>);
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out ?? { ok: true }) });
          if (u.name === 'defer' || u.name === 'answer') final = true;
        } catch (e) {
          results.push({ type: 'tool_result', tool_use_id: u.id, content: `error: ${(e as Error).message.split('\n')[0]}`, is_error: true });
        }
      }
      tools.setLlmContext?.(null);
      messages.push({ role: 'user', content: results });
      if (final) return;
    }
  },
};
