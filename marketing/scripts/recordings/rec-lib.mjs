// Shared helpers for the three screen recordings (out/recordings/*.mp4).
//
// Capture: Playwright recordVideo at 1920x1080 in the system Chrome (headless), then ffmpeg -> H.264 High, yuv420p,
// 30 fps, silent stereo AAC, +faststart. Playwright only records through its own ffmpeg build, so this module points
// PLAYWRIGHT_BROWSERS_PATH at a private dir whose "ffmpeg" is ffmpeg-shim.sh (system ffmpeg, higher VP8 bitrate).
//
// In-page helpers (injected with addInitScript, so they survive full page loads):
//   - a fake cursor that glides to targets with easing and shows a click ripple (headless video has no cursor);
//   - eased smooth scrolling with explicit durations, so reading pauses are deterministic;
//   - an optional persistent corner label.
// Nothing here signs, submits or sends anything; the recordings only read public pages.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..', '..');
export const OUT_DIR = join(ROOT, 'out', 'recordings');
export const SITE = process.env.REVERS_SITE ?? 'https://revers.si';
export const W = 1920;
export const H = 1080;
export const FFMPEG = process.env.FFMPEG ?? '/opt/homebrew/bin/ffmpeg';
export const FFPROBE = process.env.FFPROBE ?? '/opt/homebrew/bin/ffprobe';
export const WORK = process.env.REVERS_REC_WORK ?? join(tmpdir(), 'revers-recordings');
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

{
  const pw = join(WORK, 'pw-browsers');
  for (const rev of ['1011', '1010']) {
    const dir = join(pw, `ffmpeg-${rev}`);
    mkdirSync(dir, { recursive: true });
    for (const name of ['ffmpeg-mac', 'ffmpeg-linux']) {
      copyFileSync(join(HERE, 'ffmpeg-shim.sh'), join(dir, name));
      chmodSync(join(dir, name), 0o755);
    }
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = pw;
  process.env.FFMPEG_BIN = FFMPEG;
}
const { chromium } = await import('playwright-core');

/** Capture-only CSS, same as the screenshot pass (scripts/screens-lib.mjs): opaque nav, wrapped code blocks. */
export const CAPTURE_CSS =
  '.nav{background:rgb(225,230,223)!important}'
  + 'pre.code,pre.code code{white-space:pre-wrap!important;overflow-wrap:anywhere!important}'
  + '.snippet code{display:block!important;min-width:0!important}'
  + '.snippet .ln{white-space:pre-wrap!important;overflow-wrap:anywhere!important;padding-left:calc(3ch + 14px);text-indent:calc(-3ch - 14px)}'
  + 'html{scroll-behavior:auto!important}';

function overlayScript({ css, label, cursor = true }) {
  // Runs in the page before any site script, on every document.
  const CURSOR_SVG = '<svg width="34" height="34" viewBox="0 0 34 34" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M6 3 L6 27 L12.2 21.2 L16.4 30.4 L20.6 28.6 L16.5 19.6 L25 19.6 Z" fill="#111814" stroke="#ffffff" '
    + 'stroke-width="2" stroke-linejoin="round"/></svg>';
  return `(() => {
    const CSS = ${JSON.stringify(css ?? '')};
    const LABEL = ${JSON.stringify(label ?? null)};
    const CURSOR = ${JSON.stringify(!!cursor)};
    let pos;
    try { pos = JSON.parse(sessionStorage.getItem('rv-cursor-pos') || 'null'); } catch { pos = null; }
    pos = pos || { x: ${Math.round(W * 0.62)}, y: ${Math.round(H * 0.58)} };
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    function install() {
      if (!document.documentElement) return;
      if (CSS && !document.getElementById('rv-rec-css')) {
        const s = document.createElement('style'); s.id = 'rv-rec-css'; s.textContent = CSS;
        (document.head || document.documentElement).appendChild(s);
      }
      if (!document.body) return;
      if (CURSOR && !document.getElementById('rv-cursor')) {
        const c = document.createElement('div');
        c.id = 'rv-cursor';
        c.innerHTML = ${JSON.stringify(CURSOR_SVG)};
        c.style.cssText = 'position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;pointer-events:none;'
          + 'filter:drop-shadow(0 3px 4px rgba(0,0,0,.35));will-change:transform;';
        document.documentElement.appendChild(c);
        place();
      }
      if (LABEL && !document.getElementById('rv-label')) {
        const l = document.createElement('div');
        l.id = 'rv-label';
        l.textContent = LABEL;
        // Bottom-right, inside the page margin (right of the 1104 px content column at 1920 wide); newlines break lines.
        l.style.cssText = 'position:fixed;right:24px;bottom:24px;max-width:372px;z-index:2147483645;pointer-events:none;'
          + 'white-space:pre-line;background:#0f2a1e;color:#fff;border:2px solid #bfdfb4;border-radius:14px;'
          + 'padding:12px 18px;font:500 20px/1.35 var(--font-sans,"Helvetica Neue",Arial,sans-serif);'
          + 'box-shadow:0 8px 24px rgba(15,42,30,.28);';
        document.documentElement.appendChild(l);
      }
    }
    function place() {
      const c = document.getElementById('rv-cursor');
      if (c) c.style.transform = 'translate(' + (pos.x - 6) + 'px,' + (pos.y - 3) + 'px)';
      try { sessionStorage.setItem('rv-cursor-pos', JSON.stringify(pos)); } catch {}
    }
    window.__rv = {
      pos: () => ({ ...pos }),
      moveTo(x, y, ms) {
        install();
        const from = { ...pos };
        const t0 = performance.now();
        return new Promise((done) => {
          const step = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            const e = ease(k);
            pos = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e };
            place();
            if (k < 1) requestAnimationFrame(step); else done();
          };
          requestAnimationFrame(step);
        });
      },
      ripple() {
        const r = document.createElement('div');
        r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;width:18px;height:18px;border-radius:50%;'
          + 'left:' + (pos.x - 9) + 'px;top:' + (pos.y - 9) + 'px;border:3px solid #016938;background:rgba(1,105,56,.18);'
          + 'transition:transform .55s cubic-bezier(.2,.7,.2,1),opacity .55s ease-out;transform:scale(.6);opacity:1;';
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => requestAnimationFrame(() => { r.style.transform = 'scale(3.2)'; r.style.opacity = '0'; }));
        setTimeout(() => r.remove(), 700);
      },
      scrollTo(y, ms) {
        const from = window.scrollY;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const to = Math.max(0, Math.min(max, y));
        const t0 = performance.now();
        return new Promise((done) => {
          if (Math.abs(to - from) < 1) return done(to);
          const step = (now) => {
            const k = Math.min(1, (now - t0) / ms);
            window.scrollTo(0, from + (to - from) * ease(k));
            if (k < 1) requestAnimationFrame(step); else done(to);
          };
          requestAnimationFrame(step);
        });
      },
      install,
    };
    document.addEventListener('DOMContentLoaded', install);
    window.addEventListener('load', install);
    setInterval(install, 250); // re-add if hydration or a re-render drops an overlay
  })();`;
}

/**
 * Starts a recording context. Returns { browser, context, page, mark, finish }.
 * mark(name) records the offset (s) of a moment in the raw video; finish({ out, from, to }) closes the context and
 * encodes [from, to] of the raw video to an X-ready MP4.
 */
export async function startRecording(name, { css = CAPTURE_CSS, label = null, cursor = true, initScripts = [], colorScheme = 'light' } = {}) {
  const raw = join(WORK, name);
  rmSync(raw, { recursive: true, force: true });
  mkdirSync(raw, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const inset = await windowInset(browser);
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    colorScheme,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    recordVideo: { dir: raw, size: { width: W, height: H } },
  });
  for (const s of initScripts) await context.addInitScript(s);
  await context.addInitScript(overlayScript({ css, label, cursor }));
  const page = await context.newPage();
  // Headless Chrome reserves ~87 px of the window for its (invisible) UI, and the screencast behind recordVideo only
  // covers what is left: Playwright sizes the window to the viewport, so frames come out 1920x993 with a gray band.
  // Grow the window by the measured inset so every frame shows the whole 1920x1080 viewport.
  {
    const cdp = await context.newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: W, height: H + inset } });
    await cdp.detach();
  }
  const t0 = Date.now();
  const marks = {};
  page.on('pageerror', (e) => console.warn('  pageerror:', e.message));
  const mark = (k) => {
    marks[k] = (Date.now() - t0) / 1000;
    console.log(`  [${marks[k].toFixed(2)} s] ${k}`);
    return marks[k];
  };
  /**
   * Sync flash: a full-screen magenta frame for ~0.4 s, placed outside the part that gets encoded (one before the
   * start mark, one after the end mark). The raw video's clock does not run exactly with the wall clock, so marks are
   * mapped onto the video linearly between the two flashes, which are found in the frames.
   */
  async function sync(name) {
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'rv-sync';
      d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#ff00ff;';
      document.documentElement.appendChild(d);
    });
    mark(name);
    await sleep(450);
    await page.evaluate(() => document.getElementById('rv-sync')?.remove());
    await sleep(350);
  }
  // No fade-in: the first frame is the X feed preview, so it must show the page, not black.
  async function finish({ out, from = 0, to = null, fadeIn = 0, fadeOut = 0.5 }) {
    const video = page.video();
    await context.close();
    await browser.close();
    const webm = await video.path();
    const rawDur = probe(webm).duration;
    const flashes = findFlashes(webm);
    if (flashes.length < 2 || marks.sync0 === undefined || marks.sync1 === undefined) {
      throw new Error(`sync flashes not found (${JSON.stringify(flashes)})`);
    }
    const [v0, v1] = [flashes[0], flashes[flashes.length - 1]];
    const k = (v1 - v0) / (marks.sync1 - marks.sync0);
    const toVideo = (m) => v0 + (m - marks.sync0) * k;
    const vFrom = toVideo(from);
    const vTo = toVideo(to);
    const dur = vTo - vFrom;
    console.log(`  sync: flashes at ${v0.toFixed(2)} / ${v1.toFixed(2)} s of ${rawDur.toFixed(2)} s (clock ratio ${k.toFixed(4)}); `
      + `encoding [${vFrom.toFixed(2)}, ${vTo.toFixed(2)}]`);
    if (vFrom <= v0 + 0.45 || vTo >= v1) throw new Error('trim range overlaps a sync flash');
    // Play back at wall-clock speed: the raw video runs slow by the clock ratio k.
    const params = { from: vFrom, dur: dur / k, speed: k, fadeIn, fadeOut };
    writeFileSync(join(raw, 'encode.json'), JSON.stringify({ webm, out, ...params, marks, flashes }, null, 2));
    encode(webm, out, params);
    return { webm, rawDur, from: vFrom, dur: dur / k, clockRatio: k, marks, toVideo };
  }
  return { browser, context, page, mark, marks, sync, finish, t0 };
}

/** Height Chrome's headless window keeps for itself (measured with a screencast frame on a throwaway page). */
async function windowInset(browser) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  let inset = 87;
  for (let i = 0; i < 3; i++) {
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: W, height: H + inset } });
    await page.waitForTimeout(150);
    const meta = await new Promise((res) => {
      cdp.once('Page.screencastFrame', (f) => res(f.metadata));
      cdp.send('Page.startScreencast', { format: 'jpeg', quality: 30 });
    });
    await cdp.send('Page.stopScreencast');
    const dh = Math.round(meta.deviceHeight);
    if (dh === H) break;
    inset += H - dh;
  }
  await ctx.close();
  return inset;
}

export function encode(input, out, { from = 0, dur, speed = 1, fadeIn = 0, fadeOut = 0.5, inputArgs = [], inRange = 'pc' }) {
  const vf = [
    `setpts=(PTS-STARTPTS)/${speed.toFixed(6)}`,
    // Playwright's VP8 stream carries the screencast JPEGs' full-range BT.601 values without flagging them, so read it
    // as full range (otherwise every colour is stretched: the site's #e1e6df canvas would come out as #f3f9ed).
    `scale=${W}:${H}:flags=lanczos:in_range=${inRange}:in_color_matrix=bt601:out_color_matrix=bt709:out_range=tv`,
    'fps=30',
    fadeIn > 0 ? `fade=t=in:st=0:d=${fadeIn}` : null,
    fadeOut > 0 ? `fade=t=out:st=${(dur - fadeOut).toFixed(3)}:d=${fadeOut}` : null,
    'format=yuv420p',
    'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
  ].filter(Boolean).join(',');
  const args = [
    '-hide_banner', '-loglevel', 'error',
    ...inputArgs,
    '-ss', from.toFixed(3), '-i', input,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-map', '0:v:0', '-map', '1:a:0', '-t', dur.toFixed(3),
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level:v', '4.2',
    '-r', '30', '-g', '60', '-bf', '2',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', '-y', out,
  ];
  const r = spawnSync(FFMPEG, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${out}`);
  const p = probe(out);
  console.log(`  -> ${out}: ${p.width}x${p.height}, ${p.duration.toFixed(2)} s, ${(statSync(out).size / 1e6).toFixed(2)} MB`);
  return p;
}

/** Start times (s) of magenta sync flashes in a raw recording (decoded at 25 fps, 32x18). */
export function findFlashes(file) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-vf', 'fps=25,scale=32:18', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 30 });
  const buf = r.stdout;
  const fsz = 32 * 18 * 3;
  const out = [];
  let inFlash = false;
  for (let i = 0; i * fsz < buf.length; i++) {
    let rr = 0, gg = 0, bb = 0;
    for (let j = i * fsz; j < (i + 1) * fsz; j += 3) { rr += buf[j]; gg += buf[j + 1]; bb += buf[j + 2]; }
    const n = fsz / 3;
    const magenta = rr / n > 200 && gg / n < 70 && bb / n > 200;
    if (magenta && !inFlash) out.push(i / 25);
    inFlash = magenta;
  }
  return out;
}

export function probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,channels,sample_rate',
    '-of', 'json', file], { encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(j.format.duration),
    size: Number(j.format.size),
    width: v?.width, height: v?.height, vcodec: v?.codec_name, profile: v?.profile, pix_fmt: v?.pix_fmt,
    fps: v?.r_frame_rate, acodec: a?.codec_name ?? null, channels: a?.channels ?? null,
  };
}

// ------------------------------------------------------------------ page actions

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Centre of an element (viewport coords) or null. `target` is a selector string or a Locator. */
export async function centerOf(page, target, { dx = 0, dy = 0 } = {}) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  const b = await loc.boundingBox();
  if (!b) throw new Error('centerOf: no box for ' + target);
  return { x: b.x + b.width / 2 + dx, y: b.y + b.height / 2 + dy, box: b };
}

/** Glide the fake cursor to (x, y) and move the real mouse there (hover states). */
export async function glide(page, x, y, ms = 900) {
  await page.evaluate(({ x, y, ms }) => window.__rv.moveTo(x, y, ms), { x, y, ms });
  await page.mouse.move(x, y);
}

/** Glide to an element, pause, click it (real click) with a ripple. */
export async function clickOn(page, target, { ms = 900, pause = 250, dx = 0, dy = 0, after = 300 } = {}) {
  const { x, y } = await centerOf(page, target, { dx, dy });
  await glide(page, x, y, ms);
  await sleep(pause);
  await page.evaluate(() => window.__rv.ripple());
  await page.mouse.click(x, y);
  await sleep(after);
}

/** Eased smooth scroll so that document-y `y` is at the top of the viewport. */
export async function smoothScroll(page, y, ms = 1200) {
  await page.evaluate(({ y, ms }) => window.__rv.scrollTo(y, ms), { y, ms });
  await sleep(60);
}

/** Document-space top of an element. */
export async function docTop(page, sel) {
  return page.evaluate((s) => {
    const el = typeof s === 'string' ? document.querySelector(s) : null;
    if (!el) return null;
    return el.getBoundingClientRect().top + window.scrollY;
  }, sel);
}

export async function navHeight(page) {
  return page.evaluate(() => document.querySelector('header.nav')?.getBoundingClientRect().height ?? 0);
}

/** Wait for fonts + images and force .reveal sections visible (they animate in on scroll on the site). */
export async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).filter((i) => !i.complete)
      .map((i) => new Promise((r) => { i.onload = i.onerror = r; })));
    window.__rv?.install();
  });
}

export function cleanRawDir(name) {
  const dir = join(WORK, name);
  if (existsSync(dir)) for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
}
