// "How to use revers.si" tutorial frames (1600x900), annotated by injecting an overlay into the LIVE page:
// emerald 3px rounded outline + numbered badge + caption bar. Nothing on the page is changed except the overlay
// and the capture CSS from screens-lib (sticky-nav paint fix; code blocks wrap instead of scrolling sideways). Writes raw frames + jobs to REVERS_RAW_DIR; finish with
//   python3 scripts/screens-finish.py $REVERS_RAW_DIR/tutorial.jobs.json out/tutorial
import { launch, desktopContext, open, settle, scrollTo, fitRegion, alignTop, resetDesktop, rawShot, writeJobs, rectOf } from './screens-lib.mjs';

const RUN = 'naive-search~counterfeit-ticker~buy-gme-100';
const TOTAL = 8;
// GME Stock Token address from the site's own published list (https://revers.si/data/stock-tokens.json), used only
// as example input in the token-address field. The check itself needs a connected wallet and is not run here.
const GME_STOCK_TOKEN = '0x1b0e319c6a659f002271b69db8a7df2f911c153e';
const BAR_OUT_PX = 172; // output pixels reserved for the caption bar when fitting regions

/**
 * Inject the annotation overlay. Sizes are given in output pixels and divided by the zoom, so every frame
 * has the same badge/bar size after the 1600x900 downscale.
 */
async function annotate(page, { zoom = 1, kicker, badge, title, accent, caption, targets, bar = 'bottom' }) {
  const warn = await page.evaluate(
    ({ zoom, kicker, badge, title, accent, caption, targets, bar }) => {
      const s = 1 / zoom;
      const px = (n) => `${n * s}px`;
      document.getElementById('rv-annot')?.remove();
      const find = (t) => {
        if (t && t.range) {
          // A run of text inside an element (e.g. one line of a code block), outlined by its own box.
          const host = document.querySelector(t.range.sel);
          if (!host) return null;
          const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.textContent.indexOf(t.range.text);
            if (i < 0) continue;
            const rg = document.createRange();
            rg.setStart(n, i);
            rg.setEnd(n, i + t.range.text.length);
            return { getBoundingClientRect: () => rg.getBoundingClientRect(), children: [] };
          }
          return null;
        }
        if (typeof t === 'string') return document.querySelector(t);
        const list = Array.from(document.querySelectorAll(t.sel));
        if (t.text) return list.find((e) => e.textContent.trim().includes(t.text)) ?? null;
        if (t.aria) {
          const parts = [].concat(t.aria);
          return list.find((e) => parts.every((p) => (e.getAttribute('aria-label') ?? '').includes(p))) ?? null;
        }
        return list[t.index ?? 0] ?? null;
      };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const navH = document.querySelector('header.nav')?.getBoundingClientRect().height ?? 0;
      const root = document.createElement('div');
      root.id = 'rv-annot';
      root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;';
      document.body.appendChild(root);

      // ---- caption bar
      const barEl = document.createElement('div');
      barEl.style.cssText = [
        'position:fixed', 'left:0', 'right:0', bar === 'top' ? `top:${navH}px` : 'bottom:0',
        'background:#0f2a1e', `border-${bar === 'top' ? 'bottom' : 'top'}:${px(4)} solid #016938`,
        `padding:${px(22)} ${px(48)} ${px(24)}`, 'display:flex', 'align-items:center', `gap:${px(32)}`,
        'box-sizing:border-box', 'font-family:var(--font-sans)', 'color:#fff', 'font-feature-settings:"calt" 0',
        `box-shadow:0 ${px(-10)} ${px(30)} rgba(15,42,30,0.18)`,
      ].join(';');
      const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      // Inter's contextual alternates turn the x in "0x3" into a multiplication sign, so set addresses and other
      // hex values in JetBrains Mono (and switch calt off for the whole bar).
      const hex = (h) => h.replace(/\b0x[0-9a-fA-F]{4,}\b/g, (m) => `<span style="font-family:var(--font-mono);font-size:.9em;letter-spacing:0">${m}</span>`);
      const titleHtml = accent && title.includes(accent)
        ? esc(title).replace(esc(accent), `<em style="font-family:var(--font-serif);font-style:italic;font-weight:500;color:#bfdfb4">${esc(accent)}</em>`)
        : esc(title);
      barEl.innerHTML = `
        <div style="flex:0 0 auto;width:${px(64)};height:${px(64)};border-radius:50%;background:#016938;border:${px(3)} solid #bfdfb4;
          display:flex;align-items:center;justify-content:center;font-family:var(--font-mono);font-weight:500;font-size:${px(badge.length > 2 ? 15 : 26)};color:#fff;box-sizing:border-box">${esc(badge)}</div>
        <div style="flex:1 1 auto;min-width:0">
          <div style="font-family:var(--font-mono);font-size:${px(13)};letter-spacing:.14em;text-transform:uppercase;color:#bfdfb4;margin-bottom:${px(4)}">${esc(kicker)}</div>
          <div style="font-weight:300;font-size:${px(34)};line-height:1.12;letter-spacing:-0.01em">${titleHtml}</div>
          <div style="font-size:${px(17.5)};line-height:1.42;color:rgba(255,255,255,0.80);margin-top:${px(6)};max-width:${px(1180)}">${hex(esc(caption))}</div>
        </div>
        <div style="flex:0 0 auto;display:flex;align-items:center;gap:${px(10)};align-self:flex-start;margin-top:${px(2)}">
          <img src="/brand/revers-128.png" alt="" style="width:${px(34)};height:${px(34)};border-radius:${px(7)}">
          <span style="font-family:var(--font-mono);font-size:${px(16)};color:#fff">revers.si</span>
        </div>`;
      root.appendChild(barEl);
      const barRect = barEl.getBoundingClientRect();

      // ---- dim with holes (SVG mask) + outlines + badges/labels
      const rects = [];
      const issues = [];
      for (const t of targets) {
        const el = find(t.target);
        if (!el) { issues.push('missing ' + JSON.stringify(t.target)); continue; }
        let r = el.getBoundingClientRect();
        if (t.children && el.children.length) {
          const cs = Array.from(el.children).map((c) => c.getBoundingClientRect());
          const l = Math.min(...cs.map((c) => c.left)), tp = Math.min(...cs.map((c) => c.top));
          const rr = Math.max(...cs.map((c) => c.right)), bb = Math.max(...cs.map((c) => c.bottom));
          r = { left: l, top: tp, width: rr - l, height: bb - tp };
        }
        const pad = (t.pad ?? 8) * s;
        const box = { x: r.left - pad, y: r.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad, t };
        rects.push(box);
        if (box.y < navH - 1 && !t.allowNav) issues.push(`target under nav ${JSON.stringify(t.target)} y=${box.y}`);
        const overlapsBar = bar === 'top' ? box.y < barRect.bottom : box.y + box.h > barRect.top;
        if (overlapsBar) issues.push(`target overlaps bar ${JSON.stringify(t.target)}`);
        if (box.x < 0 || box.x + box.w > vw) issues.push(`target off-screen x ${JSON.stringify(t.target)}`);
      }
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('width', vw); svg.setAttribute('height', vh);
      svg.style.cssText = 'position:fixed;inset:0';
      const holes = rects.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${10 * s}" fill="black"/>`).join('');
      svg.innerHTML = `<defs><mask id="rv-m"><rect width="100%" height="100%" fill="white"/>${holes}</mask></defs>
        <rect width="100%" height="100%" fill="rgba(15,42,30,0.22)" mask="url(#rv-m)"/>`;
      root.insertBefore(svg, barEl);

      for (const b of rects) {
        const o = document.createElement('div');
        o.style.cssText = `position:fixed;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;box-sizing:border-box;
          border:${px(3)} solid #016938;border-radius:${px(10)};box-shadow:0 0 0 ${px(5)} rgba(1,105,56,0.16), 0 ${px(8)} ${px(28)} rgba(1,105,56,0.18);`;
        root.insertBefore(o, barEl);
        const primary = !!b.t.primary;
        let labelLeft = b.x;
        if (primary) {
          const d = 44 * s;
          const pos = b.t.badgePos ?? 'tl';
          let bx = b.x - d / 2;
          let by = b.y - d / 2;
          if (pos === 'tr') bx = b.x + b.w - d / 2;
          if (pos === 'left') { bx = b.x - d - 8 * s; by = b.y + b.h / 2 - d / 2; }
          bx = Math.max(4 * s, Math.min(vw - d - 4 * s, bx));
          by = b.t.allowNav ? Math.max(4 * s, by) : Math.max(navH + 4 * s, by);
          const bd = document.createElement('div');
          bd.textContent = badge;
          bd.style.cssText = `position:fixed;left:${bx}px;top:${by}px;width:${d}px;height:${d}px;border-radius:50%;background:#016938;color:#fff;
            border:${px(3)} solid #e1e6df;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
            font-family:var(--font-mono);font-weight:500;font-size:${px(badge.length > 2 ? 12 : 19)};box-shadow:0 ${px(4)} ${px(14)} rgba(15,42,30,0.25)`;
          root.insertBefore(bd, barEl);
          labelLeft = pos === 'tl' ? bx + d + 8 * s : b.x;
        }
        if (b.t.label) {
          const lb = document.createElement('div');
          lb.textContent = b.t.label;
          lb.style.cssText = `position:fixed;white-space:nowrap;background:${primary || b.t.labelAccent ? '#016938' : '#0f2a1e'};color:#fff;border-radius:999px;
            padding:${px(5)} ${px(12)};font-family:var(--font-mono);font-size:${px(12.5)};letter-spacing:.04em;line-height:1.3;
            box-shadow:0 ${px(4)} ${px(12)} rgba(15,42,30,0.22)`;
          root.insertBefore(lb, barEl);
          const lr = lb.getBoundingClientRect();
          let top = b.t.labelPos === 'below' ? b.y + b.h + 8 * s : b.y - lr.height - 8 * s;
          if (b.t.labelPos !== 'below' && top < navH + 4 * s) top = b.y + b.h + 8 * s;
          let left = b.t.labelPos === 'right' ? b.x + b.w - lr.width : labelLeft;
          left = Math.max(4 * s, Math.min(vw - lr.width - 4 * s, left));
          if (b.t.labelPos === 'inside-top') top = b.y + 8 * s;
          if (b.t.labelPos === 'side-right') { left = b.x + b.w + 12 * s; top = b.y + b.h / 2 - lr.height / 2; }
          if (b.t.labelPos === 'side-left') { left = b.x - lr.width - 12 * s; top = b.y + b.h / 2 - lr.height / 2; }
          if (b.t.labelPos === 'inside-right') { left = b.x + b.w - lr.width - 14 * s; top = b.y + b.h / 2 - lr.height / 2; }
          if (left + lr.width > vw - 4 * s) { left = b.x + b.w - lr.width; top = b.y + b.h + 8 * s; } // fallback: below, right-aligned
          if (left < 4 * s) left = 4 * s;
          lb.style.left = `${left}px`;
          lb.style.top = `${top}px`;
        }
      }
      return issues;
    },
    { zoom, kicker, badge, title, accent, caption, targets, bar },
  );
  await page.evaluate(() => Promise.all(Array.from(document.querySelectorAll('#rv-annot img')).map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
  await page.waitForTimeout(200);
  if (warn.length) console.warn('  annotate warnings:', warn);
  return warn;
}

const jobs = [];
const steps = [];
const browser = await launch();
const ctx = await desktopContext(browser);
const page = await ctx.newPage();

async function shoot(name, out, meta, ann) {
  await annotate(page, ann);
  const raw = await rawShot(page, name);
  jobs.push({ kind: 'desktop', raw, out, zoom: ann.zoom ?? 1, ...meta });
  steps.push({ out, badge: ann.badge, kicker: ann.kicker, title: ann.title, caption: ann.caption, ...meta });
  console.log('frame', out);
  await page.evaluate(() => document.getElementById('rv-annot')?.remove());
}

// 1 ── open the lab
// Framed on the home page's "One sentence. Eight scenarios." section, not the hero: the live hero sentence says
// "forks Robinhood Chain", while every published result is replica mode.
await open(page, '/');
await resetDesktop(page);
await alignTop(page, '#results .eyebrow', 28);
await shoot('t01', 'step-01-open-the-lab.png', {
  what_it_shows: 'Tutorial step 1: the Lab link in the revers.si menu outlined (badge 1), above the home page\'s "One sentence. Eight scenarios." section with the shared task sentence and the "mode: replica" chip outlined. The hero is not in the frame.',
  alt_text: 'Tutorial step 1 of 8 on the revers.si home page. The "Lab" link in the top menu is outlined in green with a numbered badge 1. Below, the section "The lab: One sentence. Eight scenarios." The paragraph "Every agent gets the same instruction, Buy $100 of GME on Robinhood Chain, and the same tools..." is outlined with the label "same sentence, same tools", and the small "mode: replica" chip is outlined with the label "replica lab, not mainnet". The tops of the dark agent tiles start below. The rest of the page is slightly dimmed. A dark green caption bar at the bottom reads "Step 1 of 8. Open the lab. Go to revers.si/lab, or press Lab in the menu. Every agent gets the same sentence, Buy $100 of GME on Robinhood Chain, and the same tools."',
}, {
  kicker: `Step 1 of ${TOTAL}`, badge: '1', title: 'Open the lab', accent: 'the lab',
  caption: 'Go to revers.si/lab, or press Lab in the menu. Every agent gets the same sentence, “Buy $100 of GME on Robinhood Chain”, and the same tools.',
  targets: [
    { target: { sel: 'header.nav a.link', text: 'Lab' }, primary: true, pad: 6, allowNav: true, badgePos: 'left' },
    { target: '#results p.lede', label: 'same sentence, same tools', labelPos: 'side-right', pad: 8 },
    { target: '#results span.chip', label: 'replica lab, not mainnet', labelPos: 'side-left', pad: 5 },
  ],
});

// 2 ── read the leaderboard
await open(page, '/lab');
await resetDesktop(page);
await scrollTo(page, 60);
await shoot('t02', 'step-02-read-the-leaderboard.png', {
  what_it_shows: 'Tutorial step 2: /lab leaderboard cards outlined (badge 2) and the replica-mode chips (mode = replica, chain 31337, replica of 4663) outlined.',
  alt_text: 'Tutorial step 2 of 8 on the revers.si lab page, headline "Leaderboard and run detail." The four leaderboard cards are outlined in green with badge 2: revers-guarded 100 (pass rate 100%, 0 fails), registry-only 86 (60%, 4 fails), oracle-blind 86 (60%, 4 fails) and naive-search 66 (30%, 7 fails), all labelled reference. The row of chips above them (generated 2026-10-12 04:18 UTC, mode = replica, chain 31337, replica of 4663, 8 scenarios, 40 runs) is outlined with the label "replica on a local chain, not mainnet". Caption bar: "Step 2 of 8. Read the leaderboard. Average score per agent over 10 runs on a deterministic replica of Robinhood Chain Stock Token mechanics on a local chain. The agents are reference implementations written for the lab; the Claude agent has not run yet and is listed as skipped, never simulated."',
}, {
  kicker: `Step 2 of ${TOTAL}`, badge: '2', title: 'Read the leaderboard', accent: 'leaderboard',
  caption: 'Average score per agent over 10 runs on a deterministic replica of Robinhood Chain Stock Token mechanics on a local chain. The agents are reference implementations written for the lab; the Claude agent has not run yet and is listed as skipped, never simulated.',
  targets: [
    { target: '.lab-sum', primary: true, pad: 10 },
    { target: '.page-head .meta-row', children: true, label: 'replica on a local chain, not mainnet', labelPos: 'side-right', pad: 5 },
  ],
});

// 3 ── open a failing run
let z = await fitRegion(page, { from: '.matrix-wrap', margin: 16, reserveBottom: BAR_OUT_PX, maxZoom: 1, align: 'top' });
await shoot('t03', 'step-03-open-a-failing-run.png', {
  what_it_shows: 'Tutorial step 3: /lab matrix with the naive-search x counterfeit-ticker cell (25, FAIL) outlined (badge 3) and the claude-haiku skipped row outlined.',
  alt_text: 'Tutorial step 3 of 8 on the revers.si lab matrix: agents as rows, the eight scenarios as columns, each cell a score with pass, fail or deferred. The naive-search cell under counterfeit-ticker, reading 25 FAIL, is outlined in green with badge 3 and the label "click a red cell". The bottom row, claude-haiku, is outlined with the label "skipped, never simulated". Caption bar: "Step 3 of 8. Open a failing run. Red cells failed. Click naive-search x counterfeit-ticker: it scored 25/100. Each run deep-links, for example /lab?run=naive-search~counterfeit-ticker~buy-gme-100."',
}, {
  zoom: z.zoom, kicker: `Step 3 of ${TOTAL}`, badge: '3', title: 'Open a failing run', accent: 'failing run',
  caption: 'Red cells failed. Click naive-search × counterfeit-ticker: it scored 25/100. Every run has its own link, e.g. revers.si/lab?run=naive-search~counterfeit-ticker~buy-gme-100',
  targets: [
    { target: { sel: '.matrix button', aria: ['Counterfeit ticker', 'score 25'] }, primary: true, pad: 6, label: 'click a red cell', labelPos: 'below' },
    { target: 'tr.skiprow', label: 'skipped, never simulated', labelPos: 'inside-right', pad: 2 },
  ],
});

// 4 ── read the attribution
await open(page, `/lab?run=${RUN}`);
await page.waitForSelector('article.panel.detail .attr', { timeout: 20_000 });
await settle(page);
z = await fitRegion(page, { from: 'article.panel.detail', margin: 14, reserveBottom: BAR_OUT_PX });
await shoot('t04', 'step-04-read-the-attribution.png', {
  what_it_shows: 'Tutorial step 4: run detail for naive-search x counterfeit-ticker with the Attribution block (lab/src/agents/naive-search.ts:19 + snippet) outlined (badge 4) and the checks list outlined.',
  alt_text: 'Tutorial step 4 of 8: the revers.si run detail for "Naive search agent x Counterfeit ticker", FAIL, 25/100. The Checks list is outlined with the label "3 checks failed": bought a counterfeit GME not in the issuer registry, paid 24.7% above oracle fair value, and did not do what was asked. The Attribution block is outlined in green with badge 4: lab/src/agents/naive-search.ts:19, an evidence id, "rea: not-run", and a code snippet with line 19 highlighted. Caption bar: "Step 4 of 8. Read the attribution. Each failed check is traced to the agent call and its line of code. naive-search.ts:19, await tools.buy(top.address, task.intent.usd, quote.tokensOut * 0.99), bought the top search hit: a counterfeit GME that is not in the issuer registry."',
}, {
  zoom: z.zoom, kicker: `Step 4 of ${TOTAL}`, badge: '4', title: 'Read the attribution', accent: 'attribution',
  caption: 'Each failed check is traced to the agent call and its line of code. naive-search.ts:19 — await tools.buy(top.address, task.intent.usd, quote.tokensOut * 0.99) — bought the top search hit: a counterfeit GME that is not in the issuer registry.',
  targets: [
    { target: 'article.panel.detail .attr', primary: true, pad: 10, badgePos: 'tr' },
    { target: 'article.panel.detail .checks', label: '3 checks failed', labelPos: 'right', pad: 6 },
  ],
});

// 5 ── run it yourself
await open(page, '/docs');
z = await fitRegion(page, { from: '#run h2', to: '#run pre', margin: 24, reserveBottom: BAR_OUT_PX, extraBottom: 90, align: 'top' });
await shoot('t05', 'step-05-run-it-yourself.png', {
  what_it_shows: 'Tutorial step 5: /docs "Run locally" (requirements: Node 20+ with npm and Foundry) with the command block outlined (badge 5) and the "cd contracts && forge build" line outlined and labelled, since npm run lab needs the compiled contracts. Caption gives the full fresh-clone sequence.',
  alt_text: 'Tutorial step 5 of 8 on the revers.si docs, "Run locally" section. Requirements: Node 20+ with npm, and Foundry (forge, anvil, cast); no Docker. The dark command block is outlined in green with badge 5: npm install; cd contracts && forge build && forge test; npm run lab to run every agent against every scenario; or pick a subset with npx tsx lab/src/cli.ts run --agents naive-search,revers-guarded --scenarios split-4-for-1. The forge build line is outlined separately with the label "build the contracts before npm run lab". Caption bar: "Step 5 of 8. Run it yourself. Needs Node and Foundry. git clone https://github.com/shelbybrothers/revers-si && cd revers-si, then npm install, (cd contracts && forge build), npm run lab. It starts a local anvil chain, deploys the replica world and runs every agent against every scenario. No API keys needed."',
}, {
  zoom: z.zoom, kicker: `Step 5 of ${TOTAL}`, badge: '5', title: 'Run it yourself', accent: 'yourself',
  caption: 'Needs Node and Foundry. git clone https://github.com/shelbybrothers/revers-si && cd revers-si, then npm install, (cd contracts && forge build), npm run lab. It starts a local anvil chain, deploys the replica world and runs every agent against every scenario. No API keys needed.',
  targets: [
    { target: '#run pre', primary: true, pad: 8, badgePos: 'left' },
    { target: { range: { sel: '#run pre', text: 'cd contracts && forge build && forge test && cd ..' } }, pad: 5, label: 'build the contracts before npm run lab', labelPos: 'side-right', labelAccent: true },
  ],
});

// 6 ── wallet: connect read-only
await open(page, '/wallet');
await resetDesktop(page);
await scrollTo(page, 40);
await shoot('t06', 'step-06-wallet-connect-read-only.png', {
  what_it_shows: 'Tutorial step 6: /wallet (disconnected) with the Connect wallet button outlined (badge 6) and the read-only chips outlined.',
  alt_text: 'Tutorial step 6 of 8 on the revers.si Wallet check page, headline "Check your Stock Tokens without signing anything." The green "Connect wallet" button is outlined with badge 6. The row of chips, read-only; eth_call, eth_getCode, eth_getBalance; Robinhood Chain 4663; list: 192 Stock Tokens, is outlined with the label "reads only, no signatures". The page is in its real disconnected state. Caption bar: "Step 6 of 8. Wallet check: connect read-only. On revers.si/wallet, connect a wallet on Robinhood Chain. revers.si only reads through your wallet (eth_call, eth_getCode, eth_getBalance): no signatures, transactions or approvals, and nothing is sent to revers.si."',
}, {
  kicker: `Step 6 of ${TOTAL}`, badge: '6', title: 'Wallet check: connect read-only', accent: 'read-only',
  caption: 'On revers.si/wallet, connect a wallet on Robinhood Chain. revers.si only reads through your wallet (eth_call, eth_getCode, eth_getBalance): no signatures, transactions or approvals, and nothing is sent to revers.si.',
  targets: [
    { target: '.wc-head-cta .btn', primary: true, pad: 8 },
    { target: '.page-head .meta-row', children: true, label: 'reads only, no signatures', labelPos: 'side-right', pad: 6 },
  ],
});

// 7 ── check a token address (example input only; the check needs a connected wallet)
await page.fill('#token-address', GME_STOCK_TOKEN);
await page.evaluate(() => document.activeElement?.blur());
z = await fitRegion(page, { from: '.wc-oneline', to: '.wc-grid', margin: 20, reserveBottom: BAR_OUT_PX });
await shoot('t07', 'step-07-check-a-token-address.png', {
  what_it_shows: 'Tutorial step 7: /wallet "Check a token address" card outlined (badge 7) with an example address typed in (GME Stock Token from the site\'s published list); the Check button stays disabled until a wallet is connected, so no verdict is shown.',
  alt_text: 'Tutorial step 7 of 8 on the revers.si Wallet check page. Three cards: Your wallet (Not connected), Stock Token holdings (scans 192 Stock Tokens and 14 lookalikes) and Check a token address. The Check a token address card is outlined in green with badge 7. Its field contains the example address 0x1b0e319c6a659f002271b69db8a7df2f911c153e, labelled "example: GME Stock Token address from the site\'s list"; the Check button is greyed out and the hint reads "Connect a wallet on Robinhood Chain to run the check." No verdict is shown. Caption bar: "Step 7 of 8. Check a token address. Paste a contract address, never a ticker: names and symbols can be copied. With a wallet on Robinhood Chain connected, Check says whether the Stock Token factory issued that exact address."',
}, {
  zoom: z.zoom, kicker: `Step 7 of ${TOTAL}`, badge: '7', title: 'Check a token address', accent: 'token address',
  caption: 'Paste a contract address, never a ticker: names and symbols can be copied. With a wallet on Robinhood Chain connected, Check says whether the Stock Token factory issued that exact address.',
  targets: [
    { target: '#check', primary: true, pad: 8 },
    { target: '#token-address', label: 'example: GME Stock Token address from the site’s list', labelPos: 'inside-right', pad: 4 },
  ],
});

// 8 ── $REVERS contract check
await open(page, '/');
await resetDesktop(page);
await alignTop(page, '#token', -10);
await shoot('t08', 'step-08-check-the-revers-contract.png', {
  what_it_shows: 'Tutorial step 8: home $REVERS panel with the contract address + Copy button outlined (badge 8) and the "View on Blockscout" button outlined.',
  alt_text: 'Tutorial step 8 of 8 on the revers.si $REVERS panel: the emerald star logo, "On Robinhood Chain" and the title "$REVERS the revers.si coin". The contract address field 0x326fcb91685d946529ac68031e95be7dc32e24cc with its Copy button is outlined in green with badge 8. The "View on Blockscout" button is outlined with the label "verify on the explorer". The panel notes that $REVERS is a community token, not a Stock Token, that crypto tokens are volatile and that nothing here is investment advice. Caption bar: "Step 8 of 8. Check the $REVERS contract. Copycat tokens reuse names and tickers. The only $REVERS contract linked from revers.si is 0x326fcb91685d946529ac68031e95be7dc32e24cc on Robinhood Chain: compare it before you buy. Not investment advice."',
}, {
  kicker: `Step 8 of ${TOTAL}`, badge: '8', title: 'Check the $REVERS contract', accent: '$REVERS contract',
  caption: 'Copycat tokens reuse names and tickers. The only $REVERS contract linked from revers.si is 0x326fcb91685d946529ac68031e95be7dc32e24cc on Robinhood Chain: compare it before you buy. Not investment advice.',
  targets: [
    { target: '.token-panel .ca', primary: true, pad: 8, badgePos: 'left' },
    { target: { sel: '.token-panel a', text: 'Blockscout' }, label: 'verify on the explorer', labelPos: 'side-right', pad: 6 },
  ],
});

// Credit ── we used REA (open source, @reatools) while building revers.si
await scrollTo(page, 1e6);
await shoot('t09', 'credit-we-used-rea.png', {
  what_it_shows: 'Credit frame: caption "We used REA": we used REA (Reverse Engineer Anything), the open-source, MIT-licensed toolkit by @reatools, while building revers.si; the lab\'s line-of-code attributions don\'t use REA yet. Below, the revers.si footer credit line and the "GitHub · REA" link (github.com/morluto/rea) are outlined.',
  alt_text: 'A credit frame on the revers.si home page footer. A dark green caption bar near the top reads "Credit. We used REA. We used REA (Reverse Engineer Anything), the open-source, MIT-licensed toolkit by @reatools, while building revers.si. The lab\'s line-of-code attributions don\'t use REA yet. github.com/morluto/rea". Below it, the dark "Is your agent ready for Saturday?" band, and in the footer the line "2026 · Built with Reverse Engineer Anything (REA)" is outlined in green with a badge, and the "GitHub · REA" link at the right end of the footer links is outlined with the label "github.com/morluto/rea".',
}, {
  bar: 'top', kicker: 'Credit', badge: 'REA', title: 'We used REA', accent: 'REA',
  caption: 'We used REA (Reverse Engineer Anything), the open-source, MIT-licensed toolkit by @reatools, while building revers.si. The lab’s line-of-code attributions don’t use REA yet. github.com/morluto/rea',
  targets: [
    { target: 'footer .built', primary: true, pad: 8, badgePos: 'left' },
    { target: { sel: 'footer a', aria: 'REA on GitHub' }, label: 'github.com/morluto/rea', labelPos: 'below', pad: 6 },
  ],
});

await browser.close();
// The thread captions (hand-written, kept next to the images) are listed in the manifest too.
jobs.push({
  kind: 'file', path: new URL('../out/tutorial/tutorial.md', import.meta.url).pathname, mime: 'text/markdown',
  what_it_shows: 'Notes for the "How to use revers.si" tutorial frames: honesty notes, the caption rendered in each frame, and a pointer to the post copy, which lives only in out/posts/calendar.md (post T01) so there is one source of truth.',
  alt_text: 'Markdown document for the revers.si tutorial images: honesty notes about replica-mode results, the wallet frames and $REVERS, the REA credit wording ("we used REA while building revers.si"; the lab attributions do not use REA yet), a table of the eight step captions plus the credit caption with each file name, and a pointer to the thread copy in posts/calendar.md.',
});
const p = writeJobs('tutorial', jobs);
writeJobs('tutorial.steps', steps);
console.log('jobs ->', p, jobs.length);
