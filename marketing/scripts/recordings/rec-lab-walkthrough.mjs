// Screen recording (a): lab walkthrough on the LIVE site, 1920x1080.
//   revers.si home -> smooth scroll to the "One sentence. Eight scenarios." results grid -> Open the full matrix (/lab)
//   -> filter by naive-search (leaderboard card) -> open naive-search x counterfeit-ticker -> pause on the checks and the
//   attribution snippet -> filter by registry-only -> open registry-only x weekend-stale-feed -> pause.
// Read-only: only clicks links and buttons inside revers.si. Capture-only CSS (same as the screenshot pass): code blocks
// wrap instead of scrolling sideways, and the sticky nav is painted opaque.
//
//   node scripts/recordings/rec-lab-walkthrough.mjs
import { join } from 'node:path';
import { OUT_DIR, SITE, clickOn, glide, settle, sleep, smoothScroll, startRecording } from './rec-lib.mjs';

const OUT = join(OUT_DIR, 'lab-walkthrough.mp4');
const rec = await startRecording('lab-walkthrough');
const { page, mark } = rec;

async function waitScrollIdle(ms = 400) {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return y;
    last = y;
    await sleep(ms / 4);
  }
  return last;
}

// ---- home, hero
await page.goto(SITE + '/', { waitUntil: 'networkidle', timeout: 60_000 });
await settle(page);
await page.evaluate(() => window.__rv.moveTo(1700, 780, 1)); // right margin, clear of the content column
await sleep(500);
await rec.sync('sync0');
mark('start');
await sleep(2600); // read the hero

// ---- smooth scroll to the results grid
const resultsTop = await page.evaluate(() => document.querySelector('#results .eyebrow').getBoundingClientRect().top + scrollY);
const nav = await page.evaluate(() => document.querySelector('header.nav').getBoundingClientRect().height);
await smoothScroll(page, resultsTop - nav - 36, 2600);
await sleep(2200); // heading, the one sentence, mode: replica
const tilesBottom = await page.evaluate(() => document.querySelector('#results .btn-row').getBoundingClientRect().bottom + scrollY);
await smoothScroll(page, tilesBottom + 40 - 1080, 1600);
await sleep(3000); // the four agent tiles + claude-haiku skipped strip

// ---- go to /lab
await clickOn(page, page.locator('#results .btn-row a[href="/lab"]'), { ms: 1100, pause: 350 });
await page.waitForURL('**/lab', { timeout: 20_000 });
await page.waitForSelector('.lab-sum button', { timeout: 20_000 });
await settle(page);
await page.evaluate(() => window.scrollTo(0, 0));
mark('lab');
await sleep(2600); // header chips: mode = replica, chain 31337, replica of 4663 + leaderboard

// ---- filter by naive-search (leaderboard card toggles the agent filter)
await clickOn(page, page.locator('.lab-sum button', { hasText: 'naive-search' }), { ms: 1000, pause: 300 });
await sleep(900);
await smoothScroll(page, 230, 1100);
await sleep(1400); // matrix now shows only the naive-search rows

// ---- open naive-search x counterfeit-ticker
await clickOn(page, page.locator('.matrix button[aria-label^="Naive search agent on Counterfeit ticker, task Buy"]'), { ms: 1000, pause: 350 });
await sleep(300);
await waitScrollIdle();
await page.waitForSelector('article.panel.detail .attr', { timeout: 20_000 });
mark('run1');
await sleep(1600); // header: FAIL, 25/100
{
  // The cursor tip rests between a check's verdict chip and its text, so it never covers the words.
  const chip = async (li) => { const b = await li.locator('.chip').first().boundingBox(); return { x: b.x + b.width + 6, y: b.y + b.height / 2 + 6 }; };
  let c = await chip(page.locator('article.panel.detail .checks li').first());
  await glide(page, c.x, c.y, 1000);
  await sleep(1500);
  c = await chip(page.locator('article.panel.detail .checks li').nth(1));
  await glide(page, c.x, c.y, 700);
  await sleep(1700); // checks: genuine-asset FAIL, price-sanity FAIL (+24.7%), ...
  const loc = await page.locator('article.panel.detail .attr .loc b').first().boundingBox();
  await glide(page, loc.x + loc.width + 14, loc.y + loc.height / 2 + 4, 1100);
  await sleep(1500); // lab/src/agents/naive-search.ts:19
  const hit = await page.locator('article.panel.detail .snippet .ln.hit').first().boundingBox();
  await glide(page, hit.x + 12, hit.y + hit.height / 2 + 6, 800); // on the line-number gutter, clear of the code
  await sleep(2600); // the highlighted line 19
}

// ---- filter by registry-only, open registry-only x weekend-stale-feed
await glide(page, 1700, 640, 700);
await smoothScroll(page, 400, 1500);
await sleep(500);
await clickOn(page, page.locator('.lab-sum button', { hasText: 'registry-only' }), { ms: 1000, pause: 300 });
await sleep(1100);
await clickOn(page, page.locator('.matrix button[aria-label*="on Weekend-stale feed, task Buy"]').first(), { ms: 1000, pause: 350 });
await sleep(300);
await waitScrollIdle();
await page.waitForFunction(() => document.querySelector('article.panel.detail h2')?.textContent.includes('Weekend-stale'), null, { timeout: 20_000 });
mark('run2');
await sleep(1600); // header: FAIL, 75/100, Sunday 14:00 ET, feed ~46h old
{
  const b = await page.locator('article.panel.detail .checks li', { hasText: 'stale feed' }).first().locator('.chip').first().boundingBox();
  await glide(page, b.x + b.width + 6, b.y + b.height / 2 + 6, 1000);
  await sleep(2600); // FAIL: traded during the closed session on a feed 46h old
  const loc = await page.locator('article.panel.detail .attr .loc b').first().boundingBox();
  await glide(page, loc.x + loc.width + 14, loc.y + loc.height / 2 + 4, 1000);
  await sleep(3200); // lab/src/agents/registry-only.ts:26
}
mark('end');
await sleep(500);
await rec.sync('sync1');

const res = await rec.finish({ out: OUT, from: rec.marks.start, to: rec.marks.end + 0.4 });
console.log(JSON.stringify({ out: OUT, rawDur: res.rawDur, dur: res.dur, clockRatio: res.clockRatio }));
