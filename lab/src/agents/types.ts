import type { AgentTools } from '../tools.js';
import type { Task } from '../tasks.js';

export interface TradingAgent {
  id: string;
  name: string;
  kind: 'reference' | 'llm' | 'external';
  description: string;
  /** source file (repo-relative) used by attribution */
  sourceFile: string;
  /** returns a reason string when the agent cannot run in this environment (status 'skipped') */
  unavailable?(): string | null;
  run(task: Task, tools: AgentTools): Promise<void>;
}
