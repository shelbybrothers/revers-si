// Renders still frames of the promo at given times, for layout review and poster frames.
//   node scripts/promo/stills.mjs <wide|tall> <outDir> <t1,t2,...>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [format = 'wide', outDir = join(HERE, '..', '..', 'out', 'video', 'stills'), times = '1,5,10'] = process.argv.slice(2);
const size = format === 'tall' ? { width: 1080, height: 1350 } : { width: 1920, height: 1080 };
mkdirSync(resolve(outDir), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.error('page:', m.text()); });
page.on('pageerror', (e) => console.error('pageerror:', e.message));
await page.goto(`${pathToFileURL(join(HERE, 'promo.html')).href}?format=${format}&mode=step`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
console.log('fonts', JSON.stringify(await page.evaluate(() => window.__fontsOk)));
for (const t of times.split(',').map(Number)) {
  await page.evaluate((t) => window.__render(t), t);
  const file = join(resolve(outDir), `${format}-${String(t.toFixed(2)).padStart(6, '0')}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
