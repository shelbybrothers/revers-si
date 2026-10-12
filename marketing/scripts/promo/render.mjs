// Records the promo (scripts/promo/promo.html) to an X-ready MP4.
//
//   node scripts/promo/render.mjs --format wide|tall [--method frames|recordvideo] [--out file.mp4]
//
// --method frames (default): steps the page's single clock frame by frame (t = i/30) through
//   window.__render(t), screenshots each frame and pipes the PNGs into ffmpeg. Frame-exact and
//   lossless until the final H.264 encode, so the result does not depend on machine speed.
// --method recordvideo: runs the same clock in real time (requestAnimationFrame) and records it
//   with Playwright's recordVideo (25 fps VP8 at ~1 Mbit/s), trims the load, then transcodes.
//   Kept as the reference path; it needs an ffmpeg binary where Playwright looks for one, so this
//   script points PLAYWRIGHT_BROWSERS_PATH at a scratch dir that links the system ffmpeg.
//   Tested 2026-10-12 at 1920x1080: the headless screencast covers only the window's visible area
//   (1920x993; Playwright pads the rest with a gray band), colours were washed out, small type
//   smeared and the real-time clock drifted against the recording, so the published files use
//   --method frames.
//
// Both finish with: H.264 High, yuv420p (BT.709), 30 fps, silent stereo AAC track, +faststart.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []));
const format = args.format === 'tall' ? 'tall' : 'wide';
const method = args.method === 'recordvideo' ? 'recordvideo' : 'frames';
const FPS = 30;
const size = format === 'tall' ? { width: 1080, height: 1350 } : { width: 1920, height: 1080 };
const out = resolve(args.out ?? join(ROOT, 'out', 'video', `revers-promo-${format === 'tall' ? '4x5-1080x1350' : '16x9-1920x1080'}.mp4`));
mkdirSync(dirname(out), { recursive: true });
const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
const pageUrl = (mode) => `${pathToFileURL(join(HERE, 'promo.html')).href}?format=${format}&mode=${mode}`;

// X-friendly H.264 output settings shared by both methods.
const ENCODE = [
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-map', '0:v:0', '-map', '1:a:0', '-shortest',
  '-vf', `scale=${size.width}:${size.height}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-level:v', '4.2',
  '-r', String(FPS), '-g', String(FPS * 2), '-bf', '2',
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
  '-movflags', '+faststart', '-y', out,
];

function run(cmd, argv, { input } = {}) {
  const p = spawn(cmd, argv, { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`)))));
  return { p, done };
}

if (method === 'recordvideo') {
  // Playwright looks for its own ffmpeg build and reads PLAYWRIGHT_BROWSERS_PATH when it loads,
  // so link the system ffmpeg into a private browsers path before importing it.
  const pw = join(process.env.PROMO_SCRATCH ?? mkdtempSync(join(tmpdir(), 'promo-pw-')), 'pw-browsers');
  for (const rev of ['1011', '1010']) {
    const dir = join(pw, `ffmpeg-${rev}`);
    mkdirSync(dir, { recursive: true });
    for (const name of ['ffmpeg-mac', 'ffmpeg-linux']) if (!existsSync(join(dir, name))) symlinkSync(FFMPEG, join(dir, name));
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = pw;
}
const { chromium } = await import('playwright-core');

if (method === 'frames') {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror:', e.message));
  await page.goto(pageUrl('step'));
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  const fonts = await page.evaluate(() => window.__fontsOk);
  if (fonts.some(([, ok]) => !ok)) throw new Error(`fonts not loaded: ${JSON.stringify(fonts)}`);
  const duration = await page.evaluate(() => window.__duration);
  const frames = Math.round(duration * FPS);
  const cdp = await page.context().newCDPSession(page);
  const ff = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', 'pipe:0', ...ENCODE], { input: true });
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => new Promise((r) => { window.__render(t); requestAnimationFrame(() => r()); }), i / FPS);
    // Clip + captureBeyondViewport are both required: without them headless Chrome returns (or
    // paints) only the window's visible area (1920x993 here), not the emulated 1920x1080 viewport.
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, captureBeyondViewport: true, clip: { x: 0, y: 0, ...size, scale: 1 } });
    const png = Buffer.from(data, 'base64');
    if (png.readUInt32BE(16) !== size.width || png.readUInt32BE(20) !== size.height) throw new Error(`frame ${i} is ${png.readUInt32BE(16)}x${png.readUInt32BE(20)}, expected ${size.width}x${size.height}`);
    if (!ff.p.stdin.write(png)) await new Promise((r) => ff.p.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`frame ${i}/${frames}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.p.stdin.end();
  await ff.done;
  await browser.close();
} else {
  const vdir = mkdtempSync(join(tmpdir(), 'promo-rec-'));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, recordVideo: { dir: vdir, size } });
  const page = await ctx.newPage();
  const recStart = Date.now();
  await page.goto(`${pageUrl('realtime')}&wait=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const startOffset = (Date.now() - recStart) / 1000;
  await page.evaluate(() => window.__startRealtime());
  const duration = await page.evaluate(() => window.__duration);
  await page.waitForFunction(() => window.__done === true, null, { timeout: (duration + 30) * 1000, polling: 250 });
  await page.waitForTimeout(300);
  await ctx.close();
  await browser.close();
  const webm = readdirSync(vdir).find((f) => f.endsWith('.webm'));
  console.log('recorded', join(vdir, webm), 'start offset', startOffset.toFixed(2), 's');
  const ff = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', startOffset.toFixed(3), '-t', String(duration), '-i', join(vdir, webm), ...ENCODE]);
  await ff.done;
  if (!args.keep) rmSync(vdir, { recursive: true, force: true });
}
console.log('wrote', out);
