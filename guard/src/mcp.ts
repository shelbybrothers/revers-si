// MCP stdio server exposing the revers.si pre-trade guard to any MCP-capable agent.
//
// Run:   npx tsx guard/src/mcp.ts
// Env:   REVERS_RPC_URL   JSON-RPC endpoint (default http://127.0.0.1:8545)
//        REVERS_REGISTRY  StockRegistry address (required unless REVERS_WORLD provides it)
//        REVERS_WORLD     optional path to contracts/deployments/world.json (registry + token->feed map)
//        REVERS_FEEDS     optional JSON object {"<token>": "<feed>"} merged over the world map
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPublicClient, http, isAddress, type Address } from 'viem';
import { z } from 'zod';
import { createGuard, type Guard, type WorldJson } from './guard.js';
import { bigintReplacer } from './index.js';

const address = z
  .string()
  .refine((s) => isAddress(s, { strict: false }), { message: 'must be a 0x-prefixed 20-byte address' });

function ok(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, bigintReplacer, 2) }] };
}

function fail(e: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: `error: ${(e as Error)?.message ?? String(e)}` }] };
}

export function buildServer(guard: Guard): McpServer {
  const server = new McpServer({ name: 'revers-guard', version: '0.1.0' });

  server.registerTool(
    'revers_check_identity',
    {
      description:
        'Check whether a token is the GENUINE Robinhood Chain stock token (StockRegistry membership). Never trusts name, symbol or uiMultiplier(). Returns {genuine, reasons}.',
      inputSchema: { token: address.describe('token address to check') },
    },
    async ({ token }) => {
      try {
        return ok(await guard.checkIdentity(token as Address));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'revers_market_state',
    {
      description:
        'US equity session (regular/extended/closed, America/New_York, DST-aware; no holiday calendar in v0), oracle feed age and staleness, oraclePaused and registry globalPaused for a stock token.',
      inputSchema: {
        token: address.describe('genuine stock token address'),
        now: z.number().int().optional().describe('unix seconds; defaults to latest block timestamp'),
        feed: address.optional().describe('EquityFeed address (optional if configured via env)'),
      },
    },
    async ({ token, now, feed }) => {
      try {
        return ok(await guard.marketState(token as Address, now, feed as Address | undefined));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'revers_pretrade',
    {
      description:
        'Run all pre-trade checks (identity, global pause, oracle pause, session/staleness, pool premium vs oracle). Returns {allow, verdict: allow|defer|block, reasons, evidence}. Do not trade unless verdict is "allow".',
      inputSchema: {
        token: address.describe('stock token address'),
        pool: address.describe('pool address the trade will execute against'),
        usdIn: z.number().positive().describe('trade size in USD'),
        side: z.enum(['buy', 'sell']),
        maxPremiumPct: z.number().nonnegative().optional().describe('max pool premium/discount vs oracle, percent (default 5)'),
        now: z.number().int().optional().describe('unix seconds; defaults to latest block timestamp'),
        account: address.optional().describe('trader address to check against the registry blocklist'),
        feed: address.optional().describe('EquityFeed address (optional if configured via env)'),
      },
    },
    async (args) => {
      try {
        return ok(
          await guard.preTrade({
            token: args.token as Address,
            pool: args.pool as Address,
            usdIn: args.usdIn,
            side: args.side,
            maxPremiumPct: args.maxPremiumPct,
            now: args.now,
            account: args.account as Address | undefined,
            feed: args.feed as Address | undefined,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'revers_position_value',
    {
      description:
        'Split-safe position valuation: balance x oracle answer (the Robinhood equity feed already includes uiMultiplier, so it is never applied twice).',
      inputSchema: {
        token: address.describe('stock token address'),
        balance: z.string().regex(/^\d+$/).describe('raw token balance in base units (18 decimals), decimal string'),
        feed: address.optional().describe('EquityFeed address (optional if configured via env)'),
      },
    },
    async ({ token, balance, feed }) => {
      try {
        return ok(await guard.positionValue(token as Address, BigInt(balance), feed as Address | undefined));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

export function guardFromEnv(env: NodeJS.ProcessEnv = process.env): Guard {
  const rpcUrl = env.REVERS_RPC_URL || 'http://127.0.0.1:8545';
  let registry = env.REVERS_REGISTRY as Address | undefined;
  const feeds: Record<string, Address> = {};
  if (env.REVERS_WORLD) {
    const world = JSON.parse(readFileSync(env.REVERS_WORLD, 'utf8')) as WorldJson;
    registry ??= world.registry;
    for (const t of Object.values(world.tokens ?? {})) feeds[t.token] = t.feed;
  }
  if (env.REVERS_FEEDS) Object.assign(feeds, JSON.parse(env.REVERS_FEEDS) as Record<string, Address>);
  if (!registry) throw new Error('REVERS_REGISTRY (or REVERS_WORLD) must be set');
  const client = createPublicClient({ transport: http(rpcUrl) });
  return createGuard({ client, registry, feeds });
}

async function main() {
  const server = buildServer(guardFromEnv());
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; log to stderr only.
  process.stderr.write('revers-guard MCP server ready on stdio\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((e) => {
    process.stderr.write(`revers-guard: ${(e as Error).message}\n`);
    process.exit(1);
  });
}
