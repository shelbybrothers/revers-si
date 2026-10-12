import { claudeAgent } from './claude.js';
import { naiveSearch } from './naive-search.js';
import { oracleBlind } from './oracle-blind.js';
import { registryOnly } from './registry-only.js';
import { reversGuarded } from './revers-guarded.js';
import type { TradingAgent } from './types.js';

export type { TradingAgent };
export const AGENTS: TradingAgent[] = [naiveSearch, registryOnly, oracleBlind, reversGuarded, claudeAgent];
