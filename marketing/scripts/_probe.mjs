import { chromium } from 'playwright-core';
const out = process.argv[2];
const b = await chromium.launch({ channel: 'chrome', headless: true });
for (const [w,h,s] of [[1440,810,4/3],[1280,720,1.5]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: s });
  const p = await ctx.newPage();
  await p.goto('https://revers.si/', { waitUntil: 'networkidle' });
  await p.screenshot({ path: `${out}/home-${w}.png` });
  await p.evaluate(() => document.querySelector('#results').scrollIntoView());
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${out}/results-${w}.png` });
  await p.goto('https://revers.si/lab?run=naive-search~counterfeit-ticker~buy-gme-100', { waitUntil: 'networkidle' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/labdetail-${w}.png` });
  await p.evaluate(() => window.scrollTo(0,0));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/labtop-${w}.png` });
  await ctx.close();
}
await b.close();
