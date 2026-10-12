/* revers.si promo: one deterministic clock drives every element.
 * render(t) sets every animated style from t alone (no incremental state), so a frame can be
 * rendered in any order: ?mode=step exposes window.__render(t) for frame-exact capture,
 * ?mode=realtime runs the same clock off requestAnimationFrame (for Playwright recordVideo),
 * ?t=12.3 renders one still. Numbers in the agent tiles come from data.js (live results.json). */
(() => {
  const qs = new URLSearchParams(location.search);
  const TALL = qs.get('format') === 'tall';
  const MODE = qs.get('mode') || (qs.has('t') ? 'still' : 'realtime');
  document.body.classList.add(TALL ? 'tall' : 'wide');
  const D = window.PROMO_DATA;

  /* ---------------- timeline (seconds) ---------------- */
  const DURATION = 46.5; // end card holds ~4 s after its disclaimer is fully in
  const SCENES = {
    s1: [0, 3.0], s2: [2.7, 8.45], s3: [8.3, 12.75], s4: [12.55, 16.75], s5: [16.55, 19.85],
    s6: [19.6, 26.95], s7: [26.55, 30.0], s8: [29.85, 37.4], s9: [37.15, 40.75], s10: [40.4, DURATION + 1],
  };
  // dark band wipes: 'up' = band shrinks to the top (reveals porcelain), 'in' = band grows from the bottom
  const WIPES = [[2.45, 0.75, 'up'], [26.55, 0.7, 'in'], [29.55, 0.75, 'up'], [40.4, 0.7, 'in']];
  const SHOT0 = 29.95, SHOT_LEN = 2.48; // montage
  const HUD_LABELS = [
    [3.0, 8.3, 'Robinhood Chain · Stock Tokens'],
    [8.45, 12.6, 'Source · Bitquery investigation'],
    [12.7, 16.6, 'Source · Chainlink docs'],
    [16.7, 26.6, 'Replica lab · not mainnet'],
    [26.8, 29.6, 'What revers.si tests'],
    [29.9, 37.2, 'Live captures · revers.si'],
    [37.3, 40.4, 'Open source · MIT'],
  ];

  /* ---------------- math ---------------- */
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const E = {
    linear: (t) => t,
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
    outQuint: (t) => 1 - Math.pow(1 - t, 5),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inCubic: (t) => t * t * t,
    inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inOutQuart: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
    inOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
    outBack: (t) => { const c1 = 1.45, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  const prog = (t, a, d, ease = E.outCubic) => ease(clamp01((t - a) / d));
  const lerp = (a, b, p) => a + (b - a) * p;
  const f2 = (n) => n.toFixed(2);
  const $ = (id) => document.getElementById(id);
  const mixRGBA = (c1, c2, p) => `rgba(${c1.map((v, i) => (i < 3 ? Math.round(lerp(v, c2[i], p)) : f2(lerp(v, c2[i], p)))).join(',')})`;

  /** Generic transform/opacity/blur writer. */
  function put(el, { o = 1, x = 0, y = 0, s = 1, r = 0, b = 0, ry = 0, persp = 0 } = {}) {
    el.style.opacity = o.toFixed(4);
    el.style.transform = `${persp ? `perspective(${persp}px) ` : ''}translate3d(${f2(x)}px,${f2(y)}px,0)${ry ? ` rotateY(${f2(ry)}deg)` : ''}${r ? ` rotate(${f2(r)}deg)` : ''} scale(${s.toFixed(4)})`;
    el.style.filter = b > 0.02 ? `blur(${f2(b)}px)` : 'none';
  }
  /** Enter (fade + rise) and optional exit (fade + lift + blur). */
  function io(el, t, a, d = 0.8, oa = null, od = 0.45, { dy = 34, ey = -44, s0 = 1, ease = E.outExpo } = {}) {
    const pi = prog(t, a, d, ease);
    const po = oa == null ? 0 : prog(t, oa, od, E.inCubic);
    put(el, { o: pi * (1 - po), y: (1 - pi) * dy + po * ey, s: lerp(s0, 1, pi), b: po * 9 });
  }
  function out(el, t, a, d = 0.45, ey = -50, extraO = 1) {
    const p = prog(t, a, d, E.inCubic);
    put(el, { o: (1 - p) * extraO, y: ey * p, b: p * 9 });
  }

  /* ---------------- kinetic words ---------------- */
  function split(el) {
    const words = [];
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
          const parts = child.textContent.split(/([ \t\n\r]+)/);
          const frag = document.createDocumentFragment();
          for (const part of parts) {
            if (!part) continue;
            if (/^[ \t\n\r]+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); continue; }
            const w = document.createElement('span'); w.className = 'w';
            const wi = document.createElement('span'); wi.className = 'wi'; wi.textContent = part;
            w.appendChild(wi); frag.appendChild(w); words.push(wi);
          }
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1) walk(child);
      }
    };
    walk(el);
    el._words = words;
  }
  function words(el, t, a, { st = 0.055, d = 0.95, ease = E.outExpo } = {}) {
    el._words.forEach((w, i) => {
      const p = prog(t, a + i * st, d, ease);
      w.style.transform = `translate3d(0,${f2((1 - p) * 112)}%,0)`;
    });
  }

  /* ---------------- icons ---------------- */
  const ICON = {
    pass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    fail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    deferred: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.5 4.5v4.2h4.2"/></svg>',
  };
  ICON.error = ICON.fail;

  /* ---------------- build ---------------- */
  const S = {};
  for (const id of Object.keys(SCENES)) S[id] = $(id);
  document.querySelectorAll('[data-split]').forEach(split);
  document.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = ICON[el.dataset.icon]));

  // HUD (two copies: one under the dark band, one inside it, so the wipe edge recolours it exactly)
  const hudHTML = `<div class="mark"><img src="assets/revers-512.png" alt=""><span>revers<span class="dot">.</span>si</span></div>
    <div class="lbls">${HUD_LABELS.map((l) => `<div class="lbl">${l[2]}</div>`).join('')}</div>`;
  const huds = [$('hudDark'), $('hudLight')];
  huds.forEach((h) => (h.innerHTML = hudHTML));
  const hudLbls = huds.map((h) => Array.from(h.querySelectorAll('.lbl')));

  // S3: 19 x 19 = 361 dots, one is the registry token
  const DOTS = 361, COLS = 19, GENUINE = 4 * COLS + 12;
  const dotsEl = $('s3dots');
  const dots = [];
  for (let i = 0; i < DOTS; i++) {
    const d = document.createElement('i');
    if (i === GENUINE) d.className = 'g';
    dotsEl.appendChild(d); dots.push(d);
  }
  const numEl = $('s3num');
  numEl.innerHTML = '361'.split('').map((c) => `<span class="w"><span class="wi">${c}</span></span>`).join('');
  numEl._words = Array.from(numEl.querySelectorAll('.wi'));
  const callout = document.createElement('div'); callout.className = 'callout'; callout.textContent = 'registry token';
  const leader = document.createElement('div'); leader.style.cssText = 'position:absolute;width:2px;background:var(--accent);transform-origin:50% 100%';
  const pulse = document.createElement('div'); pulse.className = 'pulse';
  dotsEl.append(leader, pulse, callout);

  // S6: agent tiles from live results
  const DESC = {
    'naive-search': 'Buys the top search result by 24h volume.',
    'registry-only': 'Contract-address screening, then buys.',
    'oracle-blind': 'Registry + price check. Ignores feed age and pauses.',
    'revers-guarded': '@revers/guard: identity, feed freshness, pauses, premium.',
  };
  const tiles = D.agents.map((a) => {
    const el = document.createElement('div');
    el.className = 'agt';
    el.innerHTML = `<div class="tint"></div><div class="stripe"></div>
      <div class="k"><span>${a.kind} agent</span><span>${a.runs} runs</span></div>
      <div class="nm">${a.id}</div>
      <div class="ds">${DESC[a.id] ?? a.name}</div>
      <div class="sc"><span class="v num"><span class="w"><span class="wi">${Math.round(a.avgScore)}</span></span></span><span class="u">/100 avg</span></div>
      <div class="cells">${a.cells.map((c) => `<div class="cell ${c.verdict}"><div class="f">${ICON[c.verdict] ?? ''}</div></div>`).join('')}</div>
      <div class="ft"><span>${a.failures} of ${a.runs} runs failed</span><span class="badge ${a.failures ? 'bad' : 'good'}">${a.failures ? `${a.failures} fails` : 'no fails'}</span></div>`;
    $('s6tiles').appendChild(el);
    const v = el.querySelector('.v'); v._words = Array.from(v.querySelectorAll('.wi'));
    return { a, el, u: el.querySelector('.u'), tint: el.querySelector('.tint'), stripe: el.querySelector('.stripe'), v, cells: Array.from(el.querySelectorAll('.cell .f')), badge: el.querySelector('.badge'), score: Math.round(a.avgScore) };
  });
  $('s6skip').innerHTML = D.skipped.length
    ? D.skipped.map((s) => `<span>${s.id} (LLM agent): skipped, not run. Results are never simulated.</span>`).join('')
    : '';

  // S8: montage of live captures
  const RUN_FOCUS = (window.PROMO_FOCUS && window.PROMO_FOCUS.runDetail) || { x0: 0.556, y0: 0.776, x1: 0.957, y1: 0.802 };
  const SHOTS = [
    {
      img: '../../out/video/captures/lab-leaderboard.png', url: '<b>revers.si</b>/lab',
      idx: '01 / 03 · Lab', ttl: 'Leaderboard, <span class="serif accent">run by run.</span>',
      sub: `${D.scenarios} scenarios · ${D.totalRuns} runs · reference agents written for the lab`,
      chips: '<span class="chip acc">Replica lab</span>',
      from: { z: 1.0, fx: 0.5, fy: 0.5 }, to: { z: 1.03, fx: 0.5, fy: 0.62 }, zoomAt: [0.2, 2.6],
    },
    {
      img: '../../out/video/captures/run-detail.png', url: '<b>revers.si</b>/lab?run=naive-search~counterfeit-ticker~buy-gme-100',
      idx: '02 / 03 · Run detail', ttl: 'The exact <span class="serif accent">line of code.</span>',
      sub: 'naive-search × counterfeit ticker<br>lab/src/agents/naive-search.ts:19',
      chips: '<span class="chip acc">Replica lab</span>',
      // Zoom target and focus box come from capture-site.mjs (the highlighted line 19, wrapped whole).
      from: { z: 1.0, fx: 0.5, fy: 0.5 }, to: { z: 2.1, fx: (RUN_FOCUS.x0 + RUN_FOCUS.x1) / 2, fy: (RUN_FOCUS.y0 + RUN_FOCUS.y1) / 2 }, zoomAt: [0.45, 1.3],
      focus: { ...RUN_FOCUS, at: 1.65 },
    },
    {
      img: '../../out/video/captures/wallet-check.png', url: '<b>revers.si</b>/wallet',
      idx: '03 / 03 · Wallet check', ttl: 'Check Stock Tokens, <span class="serif accent">read-only.</span>',
      sub: 'Each contract address is checked against the Stock Token factory. No signatures, transactions or approvals.',
      chips: '<span class="chip acc">Read-only</span>',
      from: { z: 1.0, fx: 0.5, fy: 0.5 }, to: { z: 1.1, fx: 0.475, fy: 0.3 }, zoomAt: [0.25, 2.5],
    },
  ];
  const shotEls = SHOTS.map((sh) => {
    const cap = document.createElement('div');
    cap.className = 'shot-cap';
    cap.innerHTML = `<div class="idx">${sh.idx}</div><div class="ttl">${sh.ttl}</div><div class="sub">${sh.sub}</div><div class="chips">${sh.chips}</div>`;
    const fr = document.createElement('div');
    fr.className = 'frame';
    fr.innerHTML = `<div class="bar"><span class="lights"><i></i><i></i><i></i></span><div class="url"><span></span><span>${sh.url}</span></div><span class="live">Live capture</span></div>
      <div class="view"><img src="${sh.img}" alt=""><div class="focus-box"></div></div>`;
    S.s8.append(fr, cap);
    const ttl = cap.querySelector('.ttl');
    split(ttl);
    return { sh, cap, fr, ttl, idx: cap.querySelector('.idx'), sub: cap.querySelector('.sub'), chips: cap.querySelector('.chips'), view: fr.querySelector('.view'), img: fr.querySelector('img'), focus: fr.querySelector('.focus-box') };
  });
  S.s8.querySelectorAll('.url > span:first-child').forEach((s) => { s.style.cssText = 'width:10px;height:10px;border-radius:50%;background:var(--accent);opacity:.7;flex:none'; });

  /* ---------------- measurements (after fonts/images) ---------------- */
  const M = {};
  function measure() {
    // scenes are display:none between their windows; lay everything out once to measure it
    Object.values(S).forEach((el) => (el.style.display = 'block'));
    shotEls.forEach((s) => { s.fr.style.display = s.cap.style.display = 'block'; });
    const wm = $('s1wm');
    M.s1shift = TALL ? (wm.offsetHeight + 44) / 2 : (wm.offsetWidth + 56) / 2;
    const g = dots[GENUINE];
    M.gx = g.offsetLeft + g.offsetWidth / 2; M.gy = g.offsetTop; M.gs = g.offsetWidth;
    callout.style.left = `${M.gx - 24}px`; callout.style.top = `${-76}px`;
    leader.style.left = `${M.gx - 1}px`; leader.style.top = `${-42}px`; leader.style.height = `${M.gy + 42 - 4}px`;
    pulse.style.width = pulse.style.height = `${M.gs}px`;
    pulse.style.left = `${g.offsetLeft}px`; pulse.style.top = `${g.offsetTop}px`;
    shotEls.forEach((s) => { s.vw = s.view.clientWidth; s.vh = s.view.clientHeight; s.iw = s.img.naturalWidth; s.ih = s.img.naturalHeight; s.img.style.width = `${s.iw}px`; s.img.style.height = `${s.ih}px`; });
  }

  /* ---------------- render ---------------- */
  function show(id, t) {
    const [a, b] = SCENES[id];
    const on = t >= a && t <= b;
    S[id].style.display = on ? 'block' : 'none';
    return on;
  }

  function renderBackground(t) {
    const bg = $('bgDark'), edge = $('wipeEdge');
    let top = 0, bottom = 0, edgeY = null, edgeO = 0;
    let state = 'full';
    for (const [a, d, kind] of WIPES) {
      if (t >= a + d) state = kind === 'up' ? 'hidden' : 'full';
      else if (t >= a) {
        const p = E.inOutQuart((t - a) / d);
        if (kind === 'up') { bottom = 100 * p; edgeY = 100 - bottom; } else { top = 100 * (1 - p); edgeY = top; }
        edgeO = Math.sin(Math.PI * clamp01((t - a) / d));
        state = 'wipe';
        break;
      }
    }
    if (state === 'hidden') { bg.style.visibility = 'hidden'; } else {
      bg.style.visibility = 'visible';
      bg.style.clipPath = state === 'full' ? 'none' : `inset(${f2(top)}% 0 ${f2(bottom)}% 0)`;
    }
    if (edgeY == null) edge.style.opacity = 0;
    else { edge.style.opacity = edgeO.toFixed(3); edge.style.top = `calc(${f2(edgeY)}% - 1px)`; }
  }

  function renderHud(t) {
    const o = prog(t, 3.0, 0.6) * (1 - prog(t, 40.15, 0.35, E.inCubic));
    huds.forEach((h) => { h.style.opacity = o.toFixed(3); });
    HUD_LABELS.forEach(([a, b], i) => {
      const p = prog(t, a, 0.45, E.outCubic) * (1 - prog(t, b - 0.3, 0.3, E.inCubic));
      hudLbls.forEach((ls) => put(ls[i], { o: p, y: (1 - p) * 10 }));
    });
  }

  function renderS1(t) {
    if (!show('s1', t)) return;
    // Frame 0 already shows the whole lock-up (tile, star, wordmark, tagline), so the first frame works as the feed
    // preview and the no-autoplay state; the sting then settles: the star turns its last few degrees and a sheen
    // crosses the tile before the scene exits.
    const exitP = prog(t, 2.35, 0.5, E.inCubic);
    put($('s1ring'), { o: 0 });
    put($('s1tile'), { o: 1, s: lerp(0.965, 1, prog(t, 0, 1.2, E.outCubic)) });
    const sp = prog(t, 0, 1.3, E.outExpo);
    const star = $('s1star');
    star.style.opacity = '1';
    star.style.transform = `translate(-50%,-50%) rotate(${f2(lerp(-24, 0, sp))}deg) scale(${lerp(0.9, 1, sp).toFixed(4)})`;
    $('s1sheen').style.left = `${f2(lerp(-60, 150, prog(t, 0.45, 0.8, E.inOutCubic)))}%`;
    const wm = $('s1wm');
    wm.style.clipPath = 'none';
    put(wm, { o: 1 });
    put($('s1tag'), { o: 1 - exitP, y: -exitP * 60, b: exitP * 8 });
    put($('s1row').parentElement, { o: 1 - exitP, y: -exitP * 70, b: exitP * 8 });
  }

  function renderS2(t) {
    if (!show('s2', t)) return;
    io($('s2eb'), t, 2.95, 0.8, 7.8, 0.45);
    const l1 = $('s2l1'), l2 = $('s2l2');
    words(l1, t, 3.0, { st: 0.07, d: 1.0 });
    words(l2, t, 5.25, { st: 0.11, d: 1.05 });
    const dim = lerp(1, 0.4, prog(t, 5.15, 0.7, E.inOutCubic));
    out(l1, t, 7.85, 0.45, -50, dim);
    out(l2, t, 7.95, 0.45, -50);
  }

  function renderS3(t) {
    if (!show('s3', t)) return;
    const X = 12.2;
    io($('s3eb'), t, 8.45, 0.8, X, 0.45);
    io($('s3big'), t, 8.5, 0.9, X + 0.03, 0.45, { dy: 50 });
    words(numEl, t, 8.55, { st: 0.09, d: 1.1 });
    words($('s3txt'), t, 8.95, { st: 0.035, d: 0.9 });
    out($('s3txt'), t, X + 0.06, 0.45);
    io($('s3src'), t, 9.7, 0.7, X + 0.09, 0.45);
    // dots wave
    const dimOthers = lerp(1, 0.55, prog(t, 10.35, 0.6, E.inOutCubic));
    for (let i = 0; i < DOTS; i++) {
      const r = Math.floor(i / COLS), c = i % COLS;
      const p = prog(t, 8.6 + (r + c) * 0.024, 0.45, E.outBack);
      const d = dots[i];
      if (i === GENUINE) {
        const g = prog(t, 10.35, 0.55, E.outBack);
        d.style.opacity = clamp01(p * 3).toFixed(3);
        d.style.transform = `scale(${(clamp01(p) * lerp(1, 1.45, g)).toFixed(4)})`;
        d.style.background = mixRGBA([180, 68, 47, 0.3], [1, 105, 56, 1], prog(t, 10.35, 0.35));
        d.style.boxShadow = `0 0 ${f2(g * 22)}px ${f2(g * 4)}px rgba(1,105,56,${f2(0.35 * g)})`;
      } else {
        d.style.opacity = (clamp01(p * 3) * dimOthers).toFixed(3);
        d.style.transform = `scale(${clamp01(p).toFixed(4)})`;
      }
    }
    const pp = prog(t, 10.45, 1.0, E.outCubic);
    put(pulse, { o: (1 - pp) * (t > 10.45 ? 0.9 : 0), s: lerp(1, 4.2, pp) });
    const lp = prog(t, 10.6, 0.55, E.outQuart);
    leader.style.opacity = lp > 0 ? 1 : 0; leader.style.transform = `scaleY(${lp.toFixed(4)})`;
    io(callout, t, 10.85, 0.6, null, 0, { dy: 12 });
    io($('s3leg'), t, 10.0, 0.7, null, 0, { dy: 16 });
    out($('s3dw'), t, X + 0.05, 0.45);
  }

  function renderS4(t) {
    if (!show('s4', t)) return;
    const X = 16.2;
    io($('s4eb'), t, 12.75, 0.8, X, 0.45);
    words($('s4a'), t, 12.8, { st: 0.07 });
    words($('s4b'), t, 13.35, { st: 0.09 });
    out($('s4a'), t, X + 0.02, 0.45); out($('s4b'), t, X + 0.05, 0.45);
    io($('s4week'), t, 13.6, 0.9, X + 0.08, 0.45, { dy: 40 });
    $('s4f1').style.transform = `scaleX(${prog(t, 13.85, 1.0, E.inOutCubic).toFixed(4)})`;
    $('s4f2').style.transform = `scaleX(${prog(t, 14.1, 0.85, E.inOutCubic).toFixed(4)})`;
    $('s4f3').style.opacity = prog(t, 14.85, 0.4).toFixed(3);
    io($('s4wl'), t, 15.0, 0.6, null, 0, { dy: 10 });
    io($('s4foot'), t, 15.2, 0.7, X + 0.1, 0.45, { dy: 20 });
  }

  function renderS5(t) {
    if (!show('s5', t)) return;
    const X = 19.35;
    words($('s5h'), t, 16.75, { st: 0.07 });
    out($('s5h'), t, X, 0.45);
    io($('s5term'), t, 17.0, 0.9, X + 0.05, 0.45, { dy: 70, s0: 0.97, ey: -80 });
    io($('s5c1'), t, 17.3, 0.5, null, 0, { dy: 8 });
    io($('s5c2'), t, 17.5, 0.5, null, 0, { dy: 8 });
    const full = `“${D.prompt}”`;
    const n = Math.floor(prog(t, 17.75, 1.25, E.linear) * full.length);
    $('s5typed').textContent = full.slice(0, n);
    const typing = t > 17.6 && t < 19.05;
    $('s5cur').style.opacity = typing || (t * 2.2) % 1 < 0.6 ? 1 : 0;
  }

  function renderS6(t) {
    if (!show('s6', t)) return;
    const X = 26.35;
    io($('s6chips'), t, 19.75, 0.8, X, 0.45);
    words($('s6h'), t, 19.85, { st: 0.06 });
    out($('s6h'), t, X + 0.03, 0.45);
    const FAIL = [180, 68, 47], OK = [1, 105, 56], BORDER = [201, 211, 198];
    tiles.forEach((tl, i) => {
      const enter = 20.1 + i * 0.1;
      const start = 20.75 + i * 0.42;
      const lift = tl.a.failures === 0 ? prog(t, 23.35, 0.7, E.outCubic) : 0;
      const pi = prog(t, enter, 0.9, E.outExpo), po = prog(t, X + 0.04 * i, 0.45, E.inCubic);
      put(tl.el, { o: pi * (1 - po), y: (1 - pi) * 70 - po * 50 - lift * 10, b: po * 8, s: 1 + lift * 0.015 });
      tl.el.style.boxShadow = `0 ${f2(30 + lift * 20)}px ${f2(60 + lift * 40)}px -40px rgba(15,42,30,${f2(0.35 + lift * 0.25)})`;
      tl.cells.forEach((c, j) => {
        const p = prog(t, start + j * 0.085, 0.32, E.outBack);
        c.style.opacity = clamp01(p * 2).toFixed(3);
        c.style.transform = `scale(${lerp(0.55, 1, p).toFixed(4)})`;
      });
      words(tl.v, t, start + 0.55, { d: 0.9 });
      io(tl.u, t, start + 0.7, 0.6, null, 0, { dy: 8 });
      const vp = prog(t, start + 0.95, 0.45, E.inOutCubic);
      const col = tl.a.failures ? FAIL : OK;
      tl.stripe.style.background = mixRGBA([...BORDER, 1], [...col, 1], vp);
      tl.el.style.borderColor = mixRGBA([...BORDER, 1], [...col, 0.6], vp);
      tl.tint.style.opacity = vp.toFixed(3);
      tl.tint.style.background = `linear-gradient(180deg, rgba(${col.join(',')},.10), rgba(${col.join(',')},.03) 60%, transparent)`;
      tl.v.style.color = mixRGBA([38, 48, 42, 1], tl.a.failures ? [156, 58, 39, 1] : [...OK, 1], vp);
      io(tl.badge, t, start + 1.0, 0.5, null, 0, { dy: 8, s0: 0.85, ease: E.outBack });
    });
    io($('s6leg'), t, 23.1, 0.7, X + 0.15, 0.45, { dy: 20 });
    io($('s6skip'), t, 23.45, 0.7, null, 0, { dy: 10 });
  }

  function renderS7(t) {
    if (!show('s7', t)) return;
    const X = 29.3;
    words($('s7l1'), t, 26.95, { st: 0.065 });
    words($('s7l2'), t, 27.8, { st: 0.09, d: 1.05 });
    out($('s7l1'), t, X, 0.45, -50, lerp(1, 0.7, prog(t, 27.7, 0.6)));
    out($('s7l2'), t, X + 0.04, 0.45);
    Array.from($('s7haz').children).forEach((c, i) => io(c, t, 28.45 + i * 0.07, 0.6, X + 0.06, 0.45, { dy: 16 }));
  }

  function kenburns(s, p, zoomP) {
    const { sh } = s;
    const contain = Math.min(s.vw / s.iw, s.vh / s.ih);
    const z = lerp(sh.from.z, sh.to.z, zoomP), fx = lerp(sh.from.fx, sh.to.fx, zoomP), fy = lerp(sh.from.fy, sh.to.fy, zoomP);
    const sc = contain * z * lerp(1.0, 1.02, p); // slow drift on top of the zoom
    const dw = s.iw * sc, dh = s.ih * sc;
    let tx = s.vw / 2 - fx * dw, ty = s.vh / 2 - fy * dh;
    tx = dw <= s.vw ? (s.vw - dw) / 2 : Math.min(0, Math.max(s.vw - dw, tx));
    ty = dh <= s.vh ? (s.vh - dh) / 2 : Math.min(0, Math.max(s.vh - dh, ty));
    s.img.style.transform = `translate3d(${f2(tx)}px,${f2(ty)}px,0) scale(${sc.toFixed(5)})`;
    return { tx, ty, dw, dh };
  }

  function renderS8(t) {
    if (!show('s8', t)) return;
    shotEls.forEach((s, i) => {
      const a = SHOT0 + i * SHOT_LEN, b = a + SHOT_LEN;
      const last = i === shotEls.length - 1;
      const exitAt = last ? 36.85 : b - 0.32;
      const vis = t > a - 0.05 && t < exitAt + 0.6;
      s.fr.style.display = s.cap.style.display = vis ? 'block' : 'none';
      if (!vis) return;
      const pi = prog(t, a, 0.85, E.outExpo), po = prog(t, exitAt, 0.5, E.inCubic);
      if (TALL) put(s.fr, { o: pi * (1 - po), y: (1 - pi) * 140 - po * 60, x: 0, s: lerp(0.94, 1, pi) - po * 0.03, b: po * 6 });
      else put(s.fr, { persp: 2200, o: pi * (1 - po), x: (1 - pi) * 220 - po * 160, ry: (1 - pi) * -14 + po * 8, s: lerp(0.96, 1, pi) - po * 0.04, b: po * 6 });
      const zoomP = prog(t, a + s.sh.zoomAt[0], s.sh.zoomAt[1], E.inOutCubic);
      const geo = kenburns(s, prog(t, a, SHOT_LEN + 0.5, E.linear), zoomP);
      if (s.sh.focus) {
        const f = s.sh.focus;
        const fp = prog(t, a + f.at, 0.45, E.outCubic);
        s.focus.style.left = `${f2(geo.tx + f.x0 * geo.dw - 8)}px`;
        s.focus.style.top = `${f2(geo.ty + f.y0 * geo.dh - 6)}px`;
        s.focus.style.width = `${f2((f.x1 - f.x0) * geo.dw + 16)}px`;
        s.focus.style.height = `${f2((f.y1 - f.y0) * geo.dh + 12)}px`;
        s.focus.style.opacity = fp.toFixed(3);
        s.focus.style.transform = `scale(${lerp(1.08, 1, fp).toFixed(4)})`;
      }
      // caption
      io(s.idx, t, a + 0.1, 0.7, exitAt, 0.4, { dy: 14 });
      words(s.ttl, t, a + 0.15, { st: 0.06, d: 0.9 });
      out(s.ttl, t, exitAt + 0.03, 0.4);
      io(s.sub, t, a + 0.45, 0.7, exitAt + 0.06, 0.4, { dy: 16 });
      io(s.chips, t, a + 0.6, 0.7, exitAt + 0.09, 0.4, { dy: 16 });
    });
  }

  function renderS9(t) {
    if (!show('s9', t)) return;
    const X = 40.15;
    io($('s9eb'), t, 37.35, 0.8, X, 0.4);
    words($('s9h'), t, 37.4, { st: 0.07 });
    out($('s9h'), t, X + 0.03, 0.4);
    io($('s9q'), t, 37.95, 0.9, X + 0.06, 0.4, { dy: 30 });
    Array.from($('s9chips').children).forEach((c, i) => io(c, t, 38.45 + i * 0.08, 0.6, X + 0.09, 0.4, { dy: 14 }));
  }

  function renderS10(t) {
    if (!show('s10', t)) return;
    const tp = prog(t, 40.85, 0.9, E.outBack);
    put($('s10tile'), { o: prog(t, 40.85, 0.3), s: lerp(0.5, 1, tp) });
    const sp = prog(t, 40.95, 1.1, E.outExpo);
    $('s10star').style.transform = `translate(-50%,-50%) rotate(${f2(lerp(-90, 0, sp))}deg) scale(${lerp(0.4, 1, sp).toFixed(4)})`;
    const wp = prog(t, 41.2, 0.9, E.outQuart);
    const wm = $('s10wm');
    wm.style.clipPath = `inset(-10% ${f2((1 - wp) * 100)}% -10% 0)`;
    put(wm, { o: prog(t, 41.2, 0.3), x: (1 - wp) * -24 });
    words($('s10tl'), t, 41.55, { st: 0.06 });
    io($('s10row'), t, 42.05, 0.8, null, 0, { dy: 18 });
    io($('s10micro'), t, 41.95, 0.6, null, 0, { dy: 12 });
  }

  const grids = Array.from(document.querySelectorAll('.grid-lines'));
  function render(t) {
    grids.forEach((g) => (g.style.backgroundPosition = `${f2(t * 7)}px ${f2(t * 3.5)}px`)); // slow drift keeps holds alive
    renderBackground(t); renderHud(t);
    renderS1(t); renderS2(t); renderS3(t); renderS4(t); renderS5(t);
    renderS6(t); renderS7(t); renderS8(t); renderS9(t); renderS10(t);
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    const faces = ['300 100px "Inter Tight"', '400 100px "Inter Tight"', '500 100px "Inter Tight"', 'italic 500 100px "Bitter"', 'italic 600 100px "Bitter"', '400 40px "JetBrains Mono"', '500 40px "JetBrains Mono"'];
    await Promise.all(faces.map((f) => document.fonts.load(f, 'Ag0123')));
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((im) => (im.complete && im.naturalWidth ? im.decode().catch(() => {}) : new Promise((r) => { im.onload = () => im.decode().then(r, r); im.onerror = r; }))));
    measure();
    window.__fontsOk = faces.map((f) => [f, document.fonts.check(f)]);
    render(MODE === 'still' ? parseFloat(qs.get('t')) || 0 : 0);
    window.__ready = true;
    if (MODE === 'realtime' && !qs.has('wait')) startRealtime();
  }
  function startRealtime() {
    const t0 = performance.now();
    window.__t0 = t0;
    const loop = (now) => {
      const t = (now - t0) / 1000;
      render(Math.min(t, DURATION));
      if (t < DURATION) requestAnimationFrame(loop); else window.__done = true;
    };
    requestAnimationFrame(loop);
  }
  window.__render = (t) => { render(t); return t; };
  window.__startRealtime = startRealtime;
  window.__duration = DURATION;
  boot();
})();
