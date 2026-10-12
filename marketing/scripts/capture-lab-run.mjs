// Runs the real lab (`npm run lab` at the repo root, with ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ANTHROPIC_WORKSPACE_ID removed)
// and records every stdout/stderr line verbatim with its time offset from spawn.
// Output: out/recordings/raw/lab-run-capture.json  { command, startedAt, exitCode, durationMs, lines: [{t, stream, text}] }
// Afterwards restore web/public/data/results.json (see README in MANIFEST notes).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const outFile = resolve(here, '../out/recordings/raw/lab-run-capture.json');
mkdirSync(dirname(outFile), { recursive: true });

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;
delete env.ANTHROPIC_AUTH_TOKEN;
delete env.ANTHROPIC_WORKSPACE_ID;
env.FORCE_COLOR = '0';
env.NO_COLOR = '1';

const startedAt = new Date().toISOString();
const t0 = performance.now();
const child = spawn('npm', ['run', 'lab'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
const lines = [];
const bufs = { stdout: '', stderr: '' };
function feed(stream, chunk) {
  const t = Math.round(performance.now() - t0);
  bufs[stream] += chunk.toString('utf8');
  let i;
  while ((i = bufs[stream].indexOf('\n')) >= 0) {
    const text = bufs[stream].slice(0, i).replace(/\r$/, '');
    bufs[stream] = bufs[stream].slice(i + 1);
    lines.push({ t, stream, text });
    process.stdout.write(`${String(t).padStart(6)}ms ${stream === 'stderr' ? '!' : ' '} ${text}\n`);
  }
}
child.stdout.on('data', (c) => feed('stdout', c));
child.stderr.on('data', (c) => feed('stderr', c));
child.on('close', (code) => {
  const t = Math.round(performance.now() - t0);
  for (const s of ['stdout', 'stderr']) if (bufs[s]) lines.push({ t, stream: s, text: bufs[s] });
  writeFileSync(
    outFile,
    JSON.stringify({ command: 'cd /Users/medikamedika/KOMET && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_WORKSPACE_ID npm run lab', cwd: repo, startedAt, exitCode: code, durationMs: t, lines }, null, 2),
  );
  console.log(`\ncaptured ${lines.length} lines, exit ${code}, ${t} ms -> ${outFile}`);
  process.exit(code ?? 1);
});
