// Shared banner helpers. render.mjs injects window.RESULTS (live https://revers.si/data/results.json) before load.
(function () {
  const X_PATH =
    'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z';

  window.xIcon = (size = 19) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${X_PATH}"/></svg>`;

  window.R = {
    data: () => window.RESULTS,
    run(agent, scenario, task = 'buy-gme-100') {
      return window.RESULTS.runs.find((r) => r.agentId === agent && r.scenarioId === scenario && r.taskId === task);
    },
    lending(market, scenario) {
      return window.RESULTS.lending.find((l) => l.marketId === market && l.scenarioId === scenario);
    },
    scenario(id) {
      return window.RESULTS.scenarios.find((s) => s.id === id);
    },
    agent(id) {
      return window.RESULTS.agents.find((a) => a.id === id);
    },
    board(id) {
      return window.RESULTS.leaderboard.find((b) => b.agentId === id);
    },
    generated() {
      const d = new Date(window.RESULTS.generatedAt);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
    },
  };

  function build() {
    document.querySelectorAll('.frame').forEach((frame) => {
      if (!frame.querySelector('.grid') && !frame.hasAttribute('data-nogrid')) {
        const g = document.createElement('div');
        g.className = 'grid';
        frame.prepend(g);
      }
      if (!frame.querySelector('.grain')) {
        const n = document.createElement('div');
        n.className = 'grain';
        frame.append(n);
      }
    });
    document.querySelectorAll('footer.foot').forEach((f) => {
      const micro = f.getAttribute('data-micro') || '';
      f.innerHTML = `
        <div class="brand"><img src="assets/revers-128.png" alt="">revers.si</div>
        <div class="micro">${micro}</div>
        <div class="handle">${window.xIcon(19)}@reversintel</div>`;
    });
    document.querySelectorAll('[data-generated]').forEach((el) => (el.textContent = window.R.generated()));
  }

  window.addEventListener('DOMContentLoaded', async () => {
    try {
      if (typeof window.beforeBuild === 'function') window.beforeBuild();
      build();
      if (typeof window.afterBuild === 'function') window.afterBuild();
    } catch (e) {
      window.__error = String(e && e.stack ? e.stack : e);
    }
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r))))
    );
    window.__ready = true;
  });
})();
