import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OUT, reaCoverageProblems, validateResults, WEB_OUT } from '../src/report.js';

describe('results.json schema', () => {
  it('rejects malformed results', () => {
    expect(validateResults({})).not.toHaveLength(0);
    expect(validateResults({ version: '1', generatedAt: 'x', mode: 'replica', chain: { id: 1, replicaOf: 4663 }, scenarios: [], agents: [], tasks: [], runs: [{ score: 101 }], leaderboard: [], lending: [] }).length).toBeGreaterThan(0);
  });
  // The published copy is what the site reads: it must validate and every failed reference-agent run must carry REA
  // evidence (the site says so). `npm run lab` refuses to write it otherwise; this catches a hand-edited or stale copy.
  it.skipIf(!existsSync(WEB_OUT))('web/public/data/results.json validates and has REA evidence on every failed reference-agent run', () => {
    const r = JSON.parse(readFileSync(WEB_OUT, 'utf8'));
    expect(validateResults(r)).toEqual([]);
    expect(reaCoverageProblems(r)).toEqual([]);
  });
  it.skipIf(!existsSync(DEFAULT_OUT))('lab/out/results.json (from `npm run lab`) validates', () => {
    const r = JSON.parse(readFileSync(DEFAULT_OUT, 'utf8'));
    expect(validateResults(r)).toEqual([]);
    expect(r.runs.length).toBeGreaterThan(0);
  });
});
