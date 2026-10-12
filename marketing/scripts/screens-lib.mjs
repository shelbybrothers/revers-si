// Shared helpers for the revers.si screenshot + tutorial capture scripts (live site, read-only).
// Nothing here clicks a link that leaves the site, submits a form or signs anything.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SITE = process.env.REVERS_SITE ?? 'https://revers.si';
export const RAW_DIR = process.env.REVERS_RAW_DIR ?? join(tmpdir(), 'revers-screens-raw');
mkdirSync(RAW_DIR, { recursive: true });

export const DESKTOP = { w: 1600, h: 900, dsf: 2 };
export const MOBILE = { w: 390, h: 844, dsf: 3 };
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

export async function launch() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

export async function desktopContext(browser) {
  return browser.newContext({
    viewport: { width: DESKTOP.w, height: DESKTOP.h },
    deviceScaleFactor: DESKTOP.dsf,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
}

export async function mobileContext(browser) {
  return browser.newContext({
    viewport: { width: MOBILE.w, height: MOBILE.h },
    deviceScaleFactor: MOBILE.dsf,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
}

/** Load a page, wait for network, fonts, images, and force every .reveal element visible. */
export async function open(page, path) {
  await page.goto(SITE + path, { waitUntil: 'networkidle', timeout: 60_000 });
  await settle(page);
}

export async function settle(page) {
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    // Capture-only CSS. The sticky nav is 88% opaque with a 10px backdrop blur. Headless Chrome does not render the blur in screenshots,
    // so text scrolled under the nav shows through sharply. Paint the nav with the canvas colour instead, which is
    // what the blurred bar looks like in a real browser. Nothing on the page is hidden by this.
    if (!document.getElementById('rv-capture-css')) {
      const s = document.createElement('style');
      s.id = 'rv-capture-css';
      // Code blocks on the site scroll sideways, so a still would cut every long line at the right edge. For captures,
      // let them wrap instead (same text, hanging indent after the line-number gutter) so each line is readable whole.
      s.textContent = '.nav{background:rgb(225,230,223)!important}'
        + 'pre.code,pre.code code{white-space:pre-wrap!important;overflow-wrap:anywhere!important}'
        + '.snippet code{display:block!important;min-width:0!important}'
        + '.snippet .ln{white-space:pre-wrap!important;overflow-wrap:anywhere!important;padding-left:calc(3ch + 14px);text-indent:calc(-3ch - 14px)}';
      document.head.appendChild(s);
    }
    await document.fonts.ready;
    document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in'));
    await Promise.all(
      Array.from(document.images)
        .filter((i) => !i.complete)
        .map((i) => new Promise((r) => { i.onload = i.onerror = r; })),
    );
  });
  await page.waitForTimeout(700);
}

/** Document-space rect of the first element matching sel (or text match). */
export async function rectOf(page, target) {
  return page.evaluate((t) => {
    const el = findEl(t);
    function findEl(t) {
      if (typeof t === 'string') return document.querySelector(t);
      const list = Array.from(document.querySelectorAll(t.sel));
      if (t.text) return list.find((e) => e.textContent.trim().includes(t.text)) ?? null;
      if (t.aria) {
        const parts = [].concat(t.aria);
        return list.find((e) => parts.every((p) => (e.getAttribute('aria-label') ?? '').includes(p))) ?? null;
      }
      return list[t.index ?? 0] ?? null;
    }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }, target);
}

export async function navHeight(page) {
  return page.evaluate(() => document.querySelector('header.nav')?.getBoundingClientRect().height ?? 0);
}

export async function scrollTo(page, y) {
  await page.evaluate((y) => window.scrollTo({ top: Math.max(0, y), behavior: 'instant' }), y);
  await page.waitForTimeout(450);
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
  await page.waitForTimeout(150);
}

/**
 * Desktop "fit" shot: make the region [from.top - margin, to.bottom + margin] plus the sticky nav fit a 16:9 frame.
 * Width stays 16:9 by enlarging the CSS viewport (same as browser zoom < 100%); the raw image is later downscaled
 * to 1600x900. Returns the zoom used (1 = 100%).
 */
export async function fitRegion(page, { from, to, margin = 28, maxZoom = 1, minZoom = 0.6, extraTop = 0, extraBottom = 0, reserveTop = 0, reserveBottom = 0, align = 'center' }) {
  // reserveTop/reserveBottom: output pixels (of the final 1600x900 frame) kept free for an overlay bar.
  await page.setViewportSize({ width: DESKTOP.w, height: DESKTOP.h });
  await page.waitForTimeout(250);
  const a = await rectOf(page, from);
  const b = await rectOf(page, to ?? from);
  if (!a || !b) throw new Error(`fitRegion: missing ${JSON.stringify(!a ? from : to)}`);
  const nav = await navHeight(page);
  const top = a.y - margin - extraTop;
  const bottom = b.y + b.h + margin + extraBottom;
  const need = bottom - top + nav;
  const reserve = reserveTop + reserveBottom;
  const zoom = Math.max(minZoom, Math.min(maxZoom, (DESKTOP.h - reserve) / need));
  const vw = Math.round(DESKTOP.w / zoom);
  const vh = Math.round(DESKTOP.h / zoom);
  await page.setViewportSize({ width: vw, height: vh });
  await page.waitForTimeout(300);
  // Re-measure after resize (layout is width-stable above 1296px, but be safe).
  const a2 = await rectOf(page, from);
  const nav2 = await navHeight(page);
  const b2 = await rectOf(page, to ?? from);
  const regionH = b2.y + b2.h + margin + extraBottom - (a2.y - margin - extraTop);
  const rTop = reserveTop / zoom;
  const rBottom = reserveBottom / zoom;
  const slack = Math.max(0, vh - nav2 - rTop - rBottom - regionH);
  await scrollTo(page, a2.y - margin - extraTop - nav2 - rTop - (align === 'top' ? 0 : slack / 2));
  return { zoom, vw, vh };
}

/** Scroll so the element's top sits `offset` px below the sticky nav. */
export async function alignTop(page, target, offset = 0) {
  const r = await rectOf(page, target);
  if (!r) throw new Error('alignTop: missing ' + JSON.stringify(target));
  const nav = await navHeight(page);
  await scrollTo(page, r.y - nav - offset);
  return r;
}

export async function resetDesktop(page) {
  await page.setViewportSize({ width: DESKTOP.w, height: DESKTOP.h });
  await page.waitForTimeout(200);
}

/** Viewport screenshot to the raw dir; returns the raw path. */
export async function rawShot(page, name) {
  const p = join(RAW_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false, animations: 'disabled', caret: 'hide' });
  return p;
}

export function writeJobs(name, jobs) {
  const p = join(RAW_DIR, `${name}.jobs.json`);
  writeFileSync(p, JSON.stringify(jobs, null, 2));
  return p;
}
