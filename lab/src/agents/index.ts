import { claudeHaiku, claudeSonnet } from './claude.js';
import { naiveSearch } from './naive-search.js';
import { oracleBlind } from './oracle-blind.js';
import { registryOnly } from './registry-only.js';
import { reversGuarded } from './revers-guarded.js';
import type { TradingAgent } from './types.js';

export type { TradingAgent };
export const AGENTS: TradingAgent[] = [
  naiveSearch,
  registryOnly,
  oracleBlind,
  reversGuarded,
  claudeHaiku,
  // Sonnet costs ~20x Haiku; only include it when explicitly asked for.
  ...(process.env.REVERS_CLAUDE_SONNET === '1' ? [claudeSonnet] : []),
];
