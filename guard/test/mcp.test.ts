import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGuard } from '../src/index.js';
import { buildServer } from '../src/mcp.js';
import { A, T, baselineState, mockClient } from './mockClient.js';

async function connect() {
  const guard = createGuard({
    client: mockClient(baselineState(T.tue1000)),
    registry: A.registry,
    feeds: { [A.gme]: A.gmeFeed },
  });
  const server = buildServer(guard);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  return client;
}

function textOf(res: unknown): string {
  const content = (res as { content: { type: string; text: string }[] }).content;
  return content.map((c) => c.text).join('\n');
}

describe('MCP server', () => {
  it('exposes the 4 revers tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'revers_check_identity',
      'revers_market_state',
      'revers_position_value',
      'revers_pretrade',
    ]);
  });

  it('revers_pretrade blocks the counterfeit and allows the genuine token', async () => {
    const client = await connect();
    const bad = JSON.parse(
      textOf(
        await client.callTool({
          name: 'revers_pretrade',
          arguments: { token: A.fakeGme, pool: A.fakeGmePool, usdIn: 100, side: 'buy', now: T.tue1000 },
        }),
      ),
    );
    expect(bad.verdict).toBe('block');
    const good = JSON.parse(
      textOf(
        await client.callTool({
          name: 'revers_pretrade',
          arguments: { token: A.gme, pool: A.gmePool, usdIn: 100, side: 'buy', now: T.tue1000 },
        }),
      ),
    );
    expect(good.verdict).toBe('allow');
  });

  it('revers_position_value and revers_market_state return JSON (bigints as strings)', async () => {
    const client = await connect();
    const pv = JSON.parse(
      textOf(await client.callTool({ name: 'revers_position_value', arguments: { token: A.gme, balance: (10n * 10n ** 18n).toString() } })),
    );
    expect(pv.valueUsd).toBe(250);
    expect(pv.valueUsdScaled).toBe('25000000000');
    const ms = JSON.parse(textOf(await client.callTool({ name: 'revers_market_state', arguments: { token: A.gme, now: T.sat1200 } })));
    expect(ms.session).toBe('closed');
    const id = JSON.parse(textOf(await client.callTool({ name: 'revers_check_identity', arguments: { token: A.gme } })));
    expect(id.genuine).toBe(true);
  });

  it('rejects malformed addresses via zod', async () => {
    const client = await connect();
    const res = (await client.callTool({ name: 'revers_check_identity', arguments: { token: 'GME' } })) as { isError?: boolean };
    expect(res.isError).toBe(true);
  });
});
