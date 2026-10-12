// Render the banner HTML pages to PNG with Playwright + system Chrome, then write MANIFEST.json.
// Usage: node scripts/banners/render.mjs [name-filter ...]   (filter matches the job id)
// Data: fetches https://revers.si/data/results.json live and injects it as window.RESULTS,
// so every lab figure on the banners comes from the published results file.
import { chromium } from 'playwright-core';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JOBS } from './jobs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../out/banners');
const RESULTS_URL = 'https://revers.si/data/results.json';
const SNAPSHOT = join(HERE, 'data', 'results.snapshot.json');

async function loadResults() {
  try {
    const res = await fetch(RESULTS_URL, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    await mkdir(dirname(SNAPSHOT), { recursive: true });
    await writeFile(SNAPSHOT, JSON.stringify(json, null, 1));
    console.log(`results.json: live (${json.generatedAt}, mode ${json.mode}, ${json.runs.length} runs)`);
    return json;
  } catch (e) {
    console.warn(`results.json live fetch failed (${e.message}); using snapshot`);
    return JSON.parse(await readFile(SNAPSHOT, 'utf8'));
  }
}

function pngSize(buf) {
  // IHDR: width/height big-endian at bytes 16..23
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// The $REVERS address on the token banner must equal the site's TOKEN.address (web/lib/site.ts, read-only).
{
  const site = await readFile(resolve(HERE, '../../../web/lib/site.ts'), 'utf8');
  const siteAddr = (site.match(/address:\s*'(0x[0-9a-fA-F]{40})'/) || [])[1];
  const page = await readFile(join(HERE, '06-token.html'), 'utf8');
  const pageAddr = (page.match(/ADDRESS = '(0x[0-9a-fA-F]{40})'/) || [])[1];
  if (!siteAddr || siteAddr.toLowerCase() !== (pageAddr || '').toLowerCase())
    throw new Error(`token address mismatch: site ${siteAddr} vs banner ${pageAddr}`);
}

const filters = process.argv.slice(2);
const results = await loadResults();
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const problems = [];
for (const job of JOBS) {
  if (filters.length && !filters.some((f) => job.id.includes(f))) continue;
  const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && problems.push(`${job.id}: console ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${job.id}: pageerror ${e.message}`));
  await page.addInitScript((r) => (window.RESULTS = r), results);
  await page.goto(pathToFileURL(join(HERE, job.html)).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  const report = await page.evaluate(() => {
    const fonts = ['300 20px "Inter Tight"', 'italic 500 20px "Bitter"', '400 20px "JetBrains Mono"'].map((f) => [
      f,
      document.fonts.check(f),
    ]);
    // Anything that overflows the frame or its own box (text clipping) is reported.
    const frame = document.querySelector('.frame').getBoundingClientRect();
    const out = [];
    document.querySelectorAll('.frame *').forEach((el) => {
      if (el.closest('[data-allow-bleed]')) return;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' && (el.classList.contains('grid') || el.classList.contains('grain') || el.classList.contains('glow'))) return;
      const content = el.closest('.content');
      if (content && el !== content && !el.closest('[data-allow-bleed]')) {
        const padX = parseFloat(getComputedStyle(content).paddingLeft);
        if (r.right > frame.right - padX + 2 || r.left < frame.left + padX - 2)
          out.push(`outside safe area: <${el.tagName.toLowerCase()} class="${el.className}"> x ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
      if (r.right > frame.right + 0.5 || r.bottom > frame.bottom + 0.5 || r.left < frame.left - 0.5 || r.top < frame.top - 0.5)
        out.push(`outside frame: <${el.tagName.toLowerCase()} class="${el.className}"> ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible')
        out.push(`clipped text: <${el.tagName.toLowerCase()} class="${el.className}">`);
    });
    return { fonts, out, error: window.__error || null };
  });
  for (const [f, ok] of report.fonts) if (!ok) problems.push(`${job.id}: font not loaded ${f}`);
  if (report.error) problems.push(`${job.id}: ${report.error}`);
  for (const o of report.out) problems.push(`${job.id}: ${o}`);
  const file = join(OUT, job.file);
  await page.locator('.frame').screenshot({ path: file, type: 'png', animations: 'disabled' });
  await page.close();
  console.log(`rendered ${job.file}`);
}
await browser.close();

// Manifest covers every PNG job (rendered now or earlier).
const manifest = [];
for (const job of JOBS) {
  const file = join(OUT, job.file);
  let s;
  try {
    s = await stat(file);
  } catch {
    continue;
  }
  const buf = await readFile(file);
  const { width, height } = pngSize(buf);
  if (width !== job.width || height !== job.height) problems.push(`${job.id}: size ${width}x${height} != ${job.width}x${job.height}`);
  if (s.size > 5 * 1024 * 1024) problems.push(`${job.id}: ${s.size} bytes > 5 MB`);
  const val = (v) => (typeof v === 'function' ? v(results) : v);
  const altText = val(job.altText);
  const whatItShows = val(job.whatItShows);
  if (altText.length > 1000) problems.push(`${job.id}: alt_text ${altText.length} chars > 1000`);
  manifest.push({
    file: job.file,
    kind: job.kind,
    size_bytes: s.size,
    width,
    height,
    what_it_shows: whatItShows,
    alt_text: altText,
  });
}
await writeFile(join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`MANIFEST.json: ${manifest.length} files`);
if (problems.length) {
  console.log('\nPROBLEMS:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exitCode = 1;
}
