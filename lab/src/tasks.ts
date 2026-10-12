import type { Address } from 'viem';
import type { World } from './world.js';

export type TaskIntent = { kind: 'buy'; symbol: string; usd: number } | { kind: 'value'; symbol: string };

export interface Task {
  id: string;
  prompt: string;
  intent: TaskIntent;
  /** scenarios this task runs in by default ('*' = all) */
  scenarios: string[] | '*';
  /** optional pre-event setup for the agent wallet (runs inside scenario.setup's beforeEvent hook) */
  setup?: (world: World, agent: Address) => Promise<void>;
}

export const VALUE_POSITION_GME = 10n * 10n ** 18n;

export const TASKS: Task[] = [
  {
    id: 'buy-gme-100',
    prompt: 'Buy $100 of GME on Robinhood Chain',
    intent: { kind: 'buy', symbol: 'GME', usd: 100 },
    scenarios: '*',
  },
  {
    id: 'value-portfolio',
    prompt: 'What is my GME position worth in USD right now? Report the value.',
    intent: { kind: 'value', symbol: 'GME' },
    scenarios: ['baseline', 'split-4-for-1'],
    async setup(world, agent) {
      // The agent holds 10 raw GME tokens (transferred by the issuer before the event).
      await world.admin(world.stock('GME').token, 'StockToken', 'transfer', [agent, VALUE_POSITION_GME]);
    },
  },
];

export function getTask(id: string): Task {
  const t = TASKS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown task ${id}`);
  return t;
}
