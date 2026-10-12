// Screen recording (b): terminal replay of ONE REAL `npm run lab` run, 1920x1080.
//
// Source: out/recordings/raw/lab-run-capture.json, written by scripts/capture-lab-run.mjs (every stdout/stderr line
// with its time offset from spawn). terminal-replay.html types the command, then prints each captured line verbatim
// at its captured offset (real speed when the run is <= 25 s; longer runs are compressed to 25 s), and finally scrolls
// back through the scored runs. The only text change: the local repo path prefix is shown as "…/".
//
//   node scripts/capture-lab-run.mjs   # the real run; then git checkout -- web/public/data/results.json
//   node scripts/recordings/rec-terminal-replay.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { OUT_DIR, sleep, startRecording } from './rec-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(OUT_DIR, 'terminal-lab-run.mp4');
const cap = JSON.parse(readFileSync(join(OUT_DIR, 'raw', 'lab-run-capture.json'), 'utf8'));
if (cap.exitCode !== 0) throw new Error('capture did not exit 0');

// The command exactly as run, minus the leading `cd <repo> &&`.
const command = cap.command.replace(/^cd \S+ && /, '');
const MAX_RUN_MS = 25_000;
const speed = Math.max(1, cap.durationMs / MAX_RUN_MS);
const when = new Date(cap.startedAt);
const fmtDate = when.toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = when.toISOString().slice(11, 16);
const replay = {
  command,
  cwd: cap.cwd,
  lines: cap.lines.map((l) => ({ t: l.t, text: l.text })),
  durationMs: cap.durationMs,
  exitCode: cap.exitCode,
  speed,
  idleMs: 900,
  typeMs: 30,
  holdEndMs: 2600,
  holdRunsMs: 4200,
  holdRuns2Ms: 3000,
  holdFinalMs: 2200,
  foot: `Replay of a real run of <code>npm run lab</code>, captured ${fmtDate}, ${fmtTime} UTC, on an already-built checkout. `
    + `Output lines verbatim, ${speed === 1 ? 'at the speed they were printed' : `${speed.toFixed(2)}x faster than they were printed`}; `
    + 'local repo path shown as <code>…/</code>.',
};

const rec = await startRecording('terminal-lab-run', {
  css: '', cursor: false,
  initScripts: [`window.__REPLAY = ${JSON.stringify(replay)};`],
  colorScheme: 'dark',
});
const { page, mark } = rec;
await page.goto(pathToFileURL(join(HERE, 'terminal-replay.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => window.__ready);
await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))));
await sleep(400);
await rec.sync('sync0');
mark('start');
await page.evaluate(() => window.__play());
mark('end');
await sleep(300);
await rec.sync('sync1');
const res = await rec.finish({ out: OUT, from: rec.marks.start, to: rec.marks.end + 0.2, fadeOut: 0.4 });
console.log(JSON.stringify({ out: OUT, speed, command, dur: res.dur, clockRatio: res.clockRatio }));
