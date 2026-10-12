// Screen recording (c): revers.si/wallet with a DEMO wallet, 1920x1080, on the LIVE site.
//
// The page gets an injected EIP-1193 demo provider (demo-wallet-provider.js) instead of a real wallet: chain 0x1237,
// one PUBLIC address, and real reads (eth_call / eth_getCode / eth_getBalance) forwarded to the public Robinhood Chain
// RPC. The address is a public Uniswap-v3-style GME/USDG pool contract (token0() = the GME Stock Token, token1() =
// USDG, fee() = 500), not a person's wallet. A corner label stays on screen the whole time:
// "Demo wallet (simulated provider) · real Robinhood Chain reads".
//
// Flow: Connect wallet -> pick "Demo wallet (simulated)" -> automatic holdings scan -> verdict card -> Check a token
// address: NVDA (genuine) then a counterfeit "GME". The demo provider refuses any signing method, and the run fails
// if the site asked for anything outside the read-only set.
//
//   node scripts/recordings/rec-wallet-check.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_DIR, SITE, clickOn, glide, settle, sleep, smoothScroll, startRecording } from './rec-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(OUT_DIR, 'wallet-check-demo.mp4');
const DEMO = {
  address: '0xe2b46c905e12ab8e2f864e4821a4325884c1b126', // public GME/USDG pool contract on Robinhood Chain
  rpc: 'https://robinhood-rpc.publicnode.com',
  genuine: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', // NVDA Stock Token (site list)
  counterfeit: '0xc2362AfF2A2a4CC1f48cF3Dab2C4e2605eb94BA3', // a contract calling itself "GME" / "GameStop"
};
const LABEL = 'Demo wallet (simulated provider) ·\nreal Robinhood Chain reads';
const ALLOWED = new Set(['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'eth_call', 'eth_getCode', 'eth_getBalance']);

const rec = await startRecording('wallet-check-demo', {
  label: LABEL,
  initScripts: [
    `window.__DEMO_ADDRESS = ${JSON.stringify(DEMO.address)}; window.__DEMO_RPC = ${JSON.stringify(DEMO.rpc)};`,
    readFileSync(join(HERE, 'demo-wallet-provider.js'), 'utf8'),
  ],
});
const { page, mark } = rec;

async function waitScrollIdle() {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return y;
    last = y;
    await sleep(100);
  }
  return last;
}
const nav = 72;
const docTop = (sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + scrollY, sel);

await page.goto(SITE + '/wallet', { waitUntil: 'networkidle', timeout: 60_000 });
await settle(page);
await page.evaluate(() => window.__rv.moveTo(1700, 720, 1));
await sleep(500);
await rec.sync('sync0');
mark('start');
await sleep(2400); // headline, read-only chips, demo label

// ---- connect
await clickOn(page, '.wc-head-cta .btn', { ms: 1000, pause: 300 });
await page.waitForSelector('.wdlg .wopt', { timeout: 15_000 });
await sleep(2000); // picker: read-only notice + the demo wallet entry
await clickOn(page, page.locator('.wdlg .wopt', { hasText: 'Demo wallet' }), { ms: 900, pause: 300 });
await page.waitForSelector('.wa-addr', { timeout: 20_000 });
mark('connected');
await glide(page, 1700, 700, 700);
await sleep(300);

// ---- scan: progress, then the verdict card
await smoothScroll(page, (await docTop('.wc-grid')) - nav - 24, 1200);
await page.waitForSelector('.wc-sum', { timeout: 120_000 });
mark('scanned');
await sleep(1200);
{
  const chip = await page.locator('.tcards .tcard .chip').first().boundingBox();
  await glide(page, chip.x + chip.width / 2, chip.y + chip.height + 8, 1000);
  await sleep(2000); // GME · GameStop • Robinhood Token: GENUINE
  const bal = await page.locator('.tcards .tcard .tcard-bal > div').nth(2).boundingBox();
  await glide(page, bal.x - 18, bal.y + 14, 900);
  await sleep(2200); // share-equivalent balance, matches balanceOfUI()
}

// ---- check a token address: genuine NVDA
await glide(page, 1700, 700, 600);
await smoothScroll(page, (await docTop('#check')) - nav - 24, 1400);
await sleep(700);
await clickOn(page, '#token-address', { ms: 900, pause: 200, dx: -380 });
await page.locator('#token-address').pressSequentially(DEMO.genuine, { delay: 32 });
await sleep(400);
await clickOn(page, '#check button[type=submit]', { ms: 700, pause: 250 });
await page.waitForFunction((a) => document.querySelector('#check .tcard')?.innerText.includes(a), DEMO.genuine, { timeout: 60_000 });
mark('genuine');
await sleep(1500); // NVDA · NVIDIA • Robinhood Token: GENUINE
{
  const li = page.locator('#check .tcard .checks li', { hasText: 'factory.tokenAddress' }).first();
  const b = await li.locator('.chip').boundingBox();
  await glide(page, b.x + b.width / 2, b.y + b.height + 3, 1000); // tip under the chip, clear of the label text
  await sleep(2600); // uid() PASS, factory.tokenAddress(uid) PASS, CREATE2 PASS
}

// ---- counterfeit "GME"
await clickOn(page, '#token-address', { ms: 900, pause: 200, dx: -380, after: 0 });
await page.locator('#token-address').selectText();
await sleep(250);
await page.locator('#token-address').pressSequentially(DEMO.counterfeit, { delay: 32 });
await sleep(400);
await clickOn(page, '#check button[type=submit]', { ms: 700, pause: 250 });
await page.waitForFunction((a) => document.querySelector('#check .tcard')?.innerText.includes(a), DEMO.counterfeit, { timeout: 60_000 });
await waitScrollIdle();
mark('counterfeit');
await sleep(1300);
{
  const chip = await page.locator('#check .tcard .tcard-h .chip').first().boundingBox();
  await glide(page, chip.x + chip.width / 2, chip.y + chip.height + 8, 900);
  await sleep(1800); // NOT A ROBINHOOD STOCK TOKEN
  const li = page.locator('#check .tcard .checks li', { hasText: 'uid()' }).first();
  const b = await li.locator('.chip').boundingBox();
  await glide(page, b.x + b.width / 2, b.y + b.height + 3, 900);
  await sleep(3000); // uid() reverted: every Stock Token answers uid()
}
mark('end');
await sleep(2000); // static tail: the final state keeps holding even if the raw video's clock drifts locally
const asked = await page.evaluate(() => window.__DEMO_LOG.slice());
await rec.sync('sync1');

const bad = [...new Set(asked)].filter((m) => !ALLOWED.has(m));
if (bad.length) throw new Error(`site asked the demo wallet for ${bad.join(', ')}`);
const res = await rec.finish({ out: OUT, from: rec.marks.start, to: rec.marks.end + 1.6 });
console.log(JSON.stringify({ out: OUT, dur: res.dur, clockRatio: res.clockRatio, methods: [...new Set(asked)], requests: asked.length }));
