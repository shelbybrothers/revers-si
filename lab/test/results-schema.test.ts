import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OUT, validateResults } from '../src/report.js';

describe('results.json schema', () => {
  it('rejects malformed results', () => {
    expect(validateResults({})).not.toHaveLength(0);
    expect(validateResults({ version: '1', generatedAt: 'x', mode: 'replica', chain: { id: 1, replicaOf: 4663 }, scenarios: [], agents: [], tasks: [], runs: [{ score: 101 }], leaderboard: [], lending: [] }).length).toBeGreaterThan(0);
  });
  it.skipIf(!existsSync(DEFAULT_OUT))('lab/out/results.json (from `npm run lab`) validates', () => {
    const r = JSON.parse(readFileSync(DEFAULT_OUT, 'utf8'));
    expect(validateResults(r)).toEqual([]);
    expect(r.runs.length).toBeGreaterThan(0);
  });
});
