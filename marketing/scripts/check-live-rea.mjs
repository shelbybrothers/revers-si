// Gate for every post that says the lab runs REA: checks that the DEPLOYED results.json carries REA evidence
// (attribution.rea.status === 'ran') on every failed reference-agent run. Read-only: one GET, nothing is posted.
// Usage: node scripts/check-live-rea.mjs [url]   (default https://revers.si/data/results.json). Exit 1 when the
// claim is not true on the live site yet.
const url = process.argv[2] ?? 'https://revers.si/data/results.json';
const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
if (!res.ok) {
  console.error(`GET ${url}: HTTP ${res.status}`);
  process.exit(1);
}
const r = await res.json();
const kind = new Map((r.agents ?? []).map((a) => [a.id, a.kind]));
const failed = (r.runs ?? []).filter((run) => kind.get(run.agentId) === 'reference' && (run.verdict === 'fail' || run.attribution));
const missing = [];
for (const run of failed) {
  const rea = run.attribution?.rea;
  const ok = rea && typeof rea === 'object' && rea.status === 'ran' && /^jsrg_[0-9a-f]{64}$/.test(String(rea.graphId));
  if (!ok) missing.push(`${run.agentId}/${run.scenarioId}/${run.taskId}: ${typeof rea === 'string' ? rea : rea ? `${rea.status}${rea.message ? `: ${rea.message}` : ''}` : 'no REA record'}`);
}
console.log(`${url} (generatedAt ${r.generatedAt}): ${failed.length - missing.length} of ${failed.length} failed reference-agent runs carry REA evidence`);
for (const m of missing) console.log(`  missing: ${m}`);
process.exit(failed.length > 0 && missing.length === 0 ? 0 : 1);
