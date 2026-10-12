// Claude agent loop with a mocked Anthropic client: request shape (cheap model, low effort, caching),
// usage/cost accounting, stop-reason handling, parallel tool use, the hard USD budget and credential detection.
// No network, no spend.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTools } from '../src/tools.js';
import type { LlmUsage } from '../src/agents/types.js';

const create = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number;
  }
  return {
    default: class {
      static APIError = APIError;
      messages = { create };
    },
  };
});

const task = { id: 'buy-gme-100', prompt: 'Buy $100 of GME on Robinhood Chain' } as never;
const ENV_KEYS = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE', 'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'REVERS_LLM_BUDGET_USD',
] as const;
const saved: Record<string, string | undefined> = {};

function fakeTools(): AgentTools & { calls: string[] } {
  const calls: string[] = [];
  const rec = (name: string, out: unknown) => async () => (calls.push(name), out);
  return {
    calls,
    searchTokens: rec('searchTokens', [{ symbol: 'GME', address: '0x1' }]),
    getOraclePrice: rec('getOraclePrice', { priceUsd: 25, updatedAt: 0, oraclePaused: false }),
    defer: rec('defer', { ok: true }),
    setLlmContext: () => {},
  } as unknown as AgentTools & { calls: string[] };
}

const usage = (input: number, output: number, read = 0, write = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
});
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input });

/** Feed replies in order and record the message roles/shape the model saw at each call. */
function script(replies: unknown[]) {
  const seen: { role: string; content: unknown }[][] = [];
  create.mockImplementation(async (req: { messages: { role: string; content: unknown }[] }) => {
    seen.push(req.messages.map((m) => ({ role: m.role, content: m.content })));
    return replies.shift();
  });
  return seen;
}

async function load() {
  return import('../src/agents/claude.js');
}

describe('claude-haiku agent', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    create.mockReset();
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
  });
  afterEach(() => {
    for (const k of ENV_KEYS) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
  });

  it('uses Haiku 5.5 at low effort with prompt caching, runs the tool loop and meters cost', async () => {
    const seen = script([
      { stop_reason: 'tool_use', content: [toolUse('tu_1', 'searchTokens', { query: 'GME' })], usage: usage(1000, 100, 0, 900) },
      { stop_reason: 'tool_use', content: [toolUse('tu_2', 'defer', { reason: 'market closed, feed stale' })], usage: usage(200, 80, 900, 150) },
    ]);
    const { claudeHaiku, costUsd } = await load();
    const tools = fakeTools();
    let reported: LlmUsage | undefined;
    await claudeHaiku.run(task, tools, { onLlmUsage: (u) => (reported = u) });

    expect(tools.calls).toEqual(['searchTokens', 'defer']);
    const req = create.mock.calls[0][0];
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.output_config).toEqual({ effort: 'low' });
    expect(req.cache_control).toEqual({ type: 'ephemeral' });
    expect(req.thinking).toBeUndefined();
    expect(req.temperature).toBeUndefined();
    // history is append-only: turn 2 sees user, assistant(tool_use), user(tool_result)
    expect(seen.map((m) => m.map((x) => x.role))).toEqual([['user'], ['user', 'assistant', 'user']]);

    expect(reported).toMatchObject({ model: 'claude-haiku-5-5', turns: 2, inputTokens: 1200, outputTokens: 180, cacheReadTokens: 900, cacheWriteTokens: 1050 });
    const expected = (1200 * 0.1 + 180 * 0.5 + 1050 * 0.125 + 900 * 0.01) / 1e6;
    expect(reported!.costUsd).toBeCloseTo(expected, 8);
    expect(costUsd('claude-haiku-5-5', { inputTokens: 1e6, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(0.1, 9);
    expect(() => costUsd('claude-unknown', { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toThrow(/no price/);
  });

  it('returns all parallel tool results in ONE user message, in order', async () => {
    const seen = script([
      {
        stop_reason: 'tool_use',
        content: [toolUse('tu_a', 'searchTokens', { query: 'GME' }), toolUse('tu_b', 'getOraclePrice', { token: '0x1' })],
        usage: usage(1000, 100),
      },
      { stop_reason: 'tool_use', content: [toolUse('tu_c', 'defer', { reason: 'oracle stale' })], usage: usage(100, 50) },
    ]);
    const { claudeHaiku } = await load();
    await claudeHaiku.run(task, fakeTools());
    const last = seen[1][seen[1].length - 1];
    expect(last.role).toBe('user');
    expect((last.content as { type: string; tool_use_id: string }[]).map((b) => [b.type, b.tool_use_id])).toEqual([
      ['tool_result', 'tu_a'],
      ['tool_result', 'tu_b'],
    ]);
  });

  it('records a refusal as a harness error (not an agent failure) and still reports usage', async () => {
    script([{ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' }, content: [], usage: usage(900, 5) }]);
    const { claudeHaiku } = await load();
    const { AgentHarnessError } = await import('../src/agents/types.js');
    let reported: LlmUsage | undefined;
    const err = await claudeHaiku.run(task, fakeTools(), { onLlmUsage: (u) => (reported = u) }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentHarnessError);
    expect(String(err.message)).toMatch(/refused \(general_harms\)/);
    expect(reported?.turns).toBe(1);
  });

  it('treats max_tokens truncation as a harness error', async () => {
    script([{ stop_reason: 'max_tokens', content: [{ type: 'text', text: '...' }], usage: usage(900, 4096) }]);
    const { claudeHaiku } = await load();
    await expect(claudeHaiku.run(task, fakeTools())).rejects.toThrow(/max_tokens/);
  });

  it('errors when the model answers in prose without calling any tool', async () => {
    script([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'I cannot trade.' }], usage: usage(900, 20) }]);
    const { claudeHaiku } = await load();
    await expect(claudeHaiku.run(task, fakeTools())).rejects.toThrow(/without calling any tool/);
  });

  it('stops at the hard budget with a harness error and still reports usage', async () => {
    process.env.REVERS_LLM_BUDGET_USD = '0.0000001';
    script([
      { stop_reason: 'tool_use', content: [toolUse('tu_1', 'searchTokens', { query: 'GME' })], usage: usage(1000, 100) },
      { stop_reason: 'tool_use', content: [toolUse('tu_2', 'searchTokens', { query: 'GME' })], usage: usage(1000, 100) },
    ]);
    const { claudeHaiku } = await load();
    const { AgentHarnessError } = await import('../src/agents/types.js');
    let reported: LlmUsage | undefined;
    const err = await claudeHaiku.run(task, fakeTools(), { onLlmUsage: (u) => (reported = u) }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentHarnessError);
    expect(String(err.message)).toMatch(/budget exhausted/);
    expect(create).toHaveBeenCalledTimes(1);
    expect(reported?.turns).toBe(1);
  });

  it('rejects a malformed budget instead of silently disabling the cap', async () => {
    process.env.REVERS_LLM_BUDGET_USD = '$1';
    const { claudeHaiku } = await load();
    expect(claudeHaiku.unavailable?.()).toMatch(/must be a non-negative number/);
  });

  it('detects credentials like the SDK does (hermetic config dir)', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const dir = mkdtempSync(join(tmpdir(), 'revers-anthropic-'));
    process.env.ANTHROPIC_CONFIG_DIR = dir;
    let m = await load();
    expect(m.claudeHaiku.unavailable?.()).toMatch(/No Anthropic credentials/);

    mkdirSync(join(dir, 'configs'));
    writeFileSync(join(dir, 'configs', 'work.json'), '{}');
    writeFileSync(join(dir, 'active_config'), 'work\n');
    vi.resetModules();
    m = await load();
    expect(m.claudeHaiku.unavailable?.()).toBeNull();

    process.env.ANTHROPIC_PROFILE = 'missing';
    expect(m.hasAnthropicCredentials()).toBe(false);
  });
});
