// Captures live screenshots of https://revers.si used in the promo's features montage.
// Real pages, real data: nothing on the page is edited. Injected capture-only styles unpin the sticky
// nav so it does not overlap element crops further down the page, and let code blocks wrap instead of
// scrolling sideways, so the attribution line is readable whole in the montage. The highlighted line's
// position in run-detail.png is written to scripts/promo/capture-focus.js for the montage's zoom + focus box.
//
//   node scripts/promo/capture-site.mjs            -> out/video/captures/*.png (2x DPR)
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'out', 'video', 'captures');
mkdirSync(OUT, { recursive: true });

const SITE = 'https://revers.si';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce', // the site's RevealObserver then shows everything at once
  colorScheme: 'light',
});
const page = await ctx.newPage();

async function open(path) {
  await page.goto(SITE + path, { waitUntil: 'networkidle' });
  await page.addStyleTag({
    content: '.nav{position:static !important}'
      + 'pre.code,pre.code code{white-space:pre-wrap!important;overflow-wrap:anywhere!important}'
      + '.snippet code{display:block!important;min-width:0!important}'
      + '.snippet .ln{white-space:pre-wrap!important;overflow-wrap:anywhere!important;padding-left:calc(3ch + 14px);text-indent:calc(-3ch - 14px)}',
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

/** Screenshot the union of the boxes of all elements matched by `selectors`, padded. */
async function shootUnion(file, selectors, pad = 32, padTop = pad) {
  const box = await page.evaluate(
    ({ selectors, pad, padTop }) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of selectors) {
        for (const el of document.querySelectorAll(s)) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          x0 = Math.min(x0, r.left + scrollX); y0 = Math.min(y0, r.top + scrollY);
          x1 = Math.max(x1, r.right + scrollX); y1 = Math.max(y1, r.bottom + scrollY);
        }
      }
      if (!isFinite(x0)) return null;
      return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - padTop), width: x1 - x0 + pad * 2, height: y1 - y0 + pad + padTop };
    },
    { selectors, pad, padTop },
  );
  if (!box) throw new Error(`nothing matched ${selectors.join(', ')}`);
  await page.screenshot({ path: join(OUT, file), clip: box, fullPage: true });
  console.log('captured', file, Math.round(box.width * 2), 'x', Math.round(box.height * 2));
  return box;
}

/** Position of `sel` inside a captured box, as fractions of the box (0..1). */
async function fractionOf(sel, box) {
  const r = await page.evaluate((sel) => {
    const b = document.querySelector(sel)?.getBoundingClientRect();
    return b && { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height };
  }, sel);
  if (!r) throw new Error(`nothing matched ${sel}`);
  const f = (v) => Math.round(v * 1000) / 1000;
  return { x0: f((r.x - box.x) / box.width), y0: f((r.y - box.y) / box.height), x1: f((r.x + r.w - box.x) / box.width), y1: f((r.y + r.h - box.y) / box.height) };
}

// 1. Lab leaderboard: headline + the four ranked reference-agent cards.
await open('/lab');
await shootUnion('lab-leaderboard.png', ['main h1', '.lb-card'], 36, 96);

// 2. Run detail: naive-search on the counterfeit ticker, with the file:line attribution.
await open('/lab?run=naive-search~counterfeit-ticker~buy-gme-100');
await page.waitForSelector('.panel.detail .attr');
const runBox = await shootUnion('run-detail.png', ['.panel.detail'], 20);
const runFocus = await fractionOf('.panel.detail .snippet .ln.hit', runBox);
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'capture-focus.js'),
  `// Written by capture-site.mjs: where the highlighted attribution line sits in out/video/captures/run-detail.png.\n` +
  `window.PROMO_FOCUS = ${JSON.stringify({ runDetail: runFocus })};\n`);
console.log('focus', JSON.stringify(runFocus));

// 3. Wallet check: read-only page, no wallet connected (the honest default state).
await open('/wallet');
await shootUnion('wallet-check.png', ['main h1', 'main .eyebrow', 'main section .panel:first-of-type'], 36);

await browser.close();
