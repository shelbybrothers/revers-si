// Writes out/video/MANIFEST.json: every file in out/video with size, dimensions, duration and alt text.
//   node scripts/promo/manifest.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, '..', '..', 'out', 'video');
const FFPROBE = process.env.FFPROBE ?? '/opt/homebrew/bin/ffprobe';
const D = JSON.parse(readFileSync(join(HERE, 'data.js'), 'utf8').replace(/^[\s\S]*?window\.PROMO_DATA = /, '').replace(/;\s*$/, ''));

const tiles = D.agents.map((a) => `${a.id} ${Math.round(a.avgScore)}${a.failures ? ` (${a.failures} of ${a.runs} runs failed)` : ' (no failed runs)'}`).join(', ');
const skipped = D.skipped.map((s) => `${s.id} skipped, not run`).join('; ');

const videoAlt = (shape) =>
  `${shape} silent promo for revers.si. It opens on the jade star logo and wordmark. ` +
  `Text: "AI agents can trade Stock Tokens 24/7. The market can't." 361 dots: 361 contracts use the GME symbol on Robinhood Chain, one is the registry token (Bitquery). ` +
  `A week chart: Stock Tokens trade 24/7, equity feeds update 24/5 (Chainlink docs). A terminal types "${D.prompt}". ` +
  `Replica-lab reference agents: ${tiles}; ${skipped}. "Contract scanners check the token. revers.si checks the agent." ` +
  `Live captures: lab leaderboard, a file:line attribution, the read-only wallet check. ` +
  `Credit: we used open-source REA (@reatools) while building revers.si. ` +
  `End card: revers.si, @reversintel, $REVERS, then large type: "$REVERS is a community token, not a Stock Token. Not investment advice." and the contract address.`;

const posterAlt = (layout) =>
  `A frame from the revers.si promo video: replica-lab results for the one-sentence task every agent gets (the sentence itself is not in this frame). Chips read "Replica lab" and "Deterministic replica, local chain, not mainnet", above the title "Four reference agents. Same sentence." ` +
  `Four reference-agent cards ${layout}, each with an average score and ten run cells (pass, deferred or fail): ${tiles}. ` +
  `The failing agents' cards are tinted red and revers-guarded is tinted green. A footnote says ${skipped}, and results are never simulated.`;

const secs = (f) => Math.floor(parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(DIR, f)]).toString()));
const WIDE = 'revers-promo-16x9-1920x1080.mp4', TALL = 'revers-promo-4x5-1080x1350.mp4';
const INFO = {
  'revers-promo-16x9-1920x1080.mp4': {
    kind: 'video',
    what_it_shows: 'Main 16:9 promo (X feed, 1920x1080, 30 fps, H.264 High + silent AAC, faststart). Used for the pinned post P01 and the weekend post F16. Storyboard: logo lock-up fully visible from frame 0 (so the feed preview is not blank), the 24/7 problem, sourced stats (Bitquery 361 GME contracts; Chainlink 24/5 feeds), the one-sentence task, four replica-lab agent tiles with real scores from revers.si/data/results.json, the token-versus-agent line, live captures of /lab, a run attribution (code wrapped so line 19 is whole) and /wallet, the REA credit ("we used it while building revers.si"), and the end card, whose $REVERS disclaimer is set large (50 px at 1920 wide) in white and held about 4 s.',
    alt_text: videoAlt(`${secs(WIDE)}-second 16:9`),
  },
  'revers-promo-4x5-1080x1350.mp4': {
    kind: 'video',
    what_it_shows: '4:5 cut of the same promo for mobile feeds (1080x1350, 30 fps, H.264 High + silent AAC, faststart). Same timeline and copy, with layouts restacked: the agent tiles sit in a 2x2 grid and each montage caption sits above its browser frame; the end-card disclaimer is 34 px at 1080 wide. EXCEPTION: 1080x1350 is outside the brief\'s X video sizes (1280x720 or 1920x1080), so the X calendar does not use this file (F16 uses the 16:9 video). X does accept portrait video and 1080x1350 is within its limits; this cut is kept for other platforms or for X if you accept the exception.',
    alt_text: videoAlt(`${secs(TALL)}-second vertical 4:5`),
  },
  'revers-promo-16x9-poster.png': {
    kind: 'image',
    what_it_shows: 'Poster frame of the 16:9 promo at 24.5 s: the four replica-lab agent tiles after the results have filled in. Usable as a custom thumbnail.',
    alt_text: posterAlt('in a row'),
  },
  'revers-promo-4x5-poster.png': {
    kind: 'image',
    what_it_shows: 'Poster frame of the 4:5 promo at 24.5 s: the agent tiles in a 2x2 grid. Usable as a custom thumbnail.',
    alt_text: posterAlt('in a two-by-two grid'),
  },
  'captures/lab-leaderboard.png': {
    kind: 'image (source capture)',
    what_it_shows: 'Live 2x screenshot of https://revers.si/lab taken for the montage: the "Leaderboard and run detail" headline, the mode = replica / chain 31337 / replica of 4663 chips and the four reference-agent cards.',
    alt_text: 'Screenshot of the revers.si lab page. Headline "Leaderboard and run detail." Chips: generated 2026-10-12 04:18 UTC, mode = replica, chain 31337, replica of 4663, 8 scenarios, 40 runs. Four cards: #1 revers-guarded 100, pass rate 100%, 0 fails; #2 registry-only 86, 60%, 4 fails; #3 oracle-blind 86, 60%, 4 fails; #4 naive-search 66, 30%, 7 fails.',
  },
  'captures/run-detail.png': {
    kind: 'image (source capture)',
    what_it_shows: 'Live 2x screenshot of the run detail at https://revers.si/lab?run=naive-search~counterfeit-ticker~buy-gme-100: checks, agent calls and the file:line attribution, which the montage zooms into. Code lines wrap for the capture (the site scrolls them sideways) so line 19 is whole; the highlighted line\'s position is written to scripts/promo/capture-focus.js.',
    alt_text: 'Screenshot of a revers.si run detail: "Naive search agent × Counterfeit ticker", score 25/100, fail, task "Buy $100 of GME on Robinhood Chain". Checks show it bought a counterfeit GME token not in the issuer registry and paid 24.7% above oracle fair value. The agent calls are searchTokens, getQuote and buy. Attribution points to lab/src/agents/naive-search.ts line 19, the tools.buy call, with "rea: not-run".',
  },
  'captures/wallet-check.png': {
    kind: 'image (source capture)',
    what_it_shows: 'Live 2x screenshot of https://revers.si/wallet in its default state (no wallet connected): headline, read-only chips and the "Your wallet: Not connected" panel.',
    alt_text: 'Screenshot of the revers.si wallet check page. Headline "Check your Stock Tokens without signing anything." It explains that revers.si reads, through your own wallet, which Stock Tokens it holds and checks each contract address against the Stock Token factory. Chips: read-only; eth_call, eth_getCode, eth_getBalance; Robinhood Chain 4663; list of 192 Stock Tokens, 2026-10-12. Panel: Your wallet, not connected, with a Connect wallet button.',
  },
};

function pngSize(file) {
  const b = readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
function probe(file) {
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt', '-of', 'json', file]).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return { width: v.width, height: v.height, duration_s: Math.round(parseFloat(j.format.duration) * 100) / 100, video_codec: v.codec_name, pix_fmt: v.pix_fmt, fps: v.r_frame_rate, audio_codec: a ? `${a.codec_name} (silent)` : null };
}
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

const entries = walk(DIR)
  .map((f) => relative(DIR, f))
  .filter((f) => f !== 'MANIFEST.json' && !f.endsWith('.DS_Store'))
  .sort()
  .map((file) => {
    const info = INFO[file];
    if (!info) throw new Error(`no manifest entry for ${file}`);
    if (info.alt_text.length > 1000) throw new Error(`alt text too long for ${file}: ${info.alt_text.length}`);
    const abs = join(DIR, file);
    const dims = file.endsWith('.mp4') ? probe(abs) : pngSize(abs);
    return { file, kind: info.kind, size_bytes: statSync(abs).size, ...dims, what_it_shows: info.what_it_shows, alt_text: info.alt_text };
  });

const manifest = {
  generated: new Date().toISOString(),
  folder: 'out/video',
  source: 'scripts/promo (promo.html + promo.js timeline, captured frame by frame with Playwright and encoded with ffmpeg)',
  data: `Agent scores from ${D.source} (results generated ${D.generatedAt}, mode ${D.mode}). Lab results come from a deterministic replica of Robinhood Chain Stock Token mechanics on a local chain, with reference agents written for the lab.`,
  notes: 'No music; each video carries a silent stereo AAC track. Not investment advice. The 4:5 video is outside the brief\'s X sizes (see its entry) and is not used in the X calendar. This manifest lists every file in the folder except itself.',
  files: entries,
};
writeFileSync(join(DIR, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const e of entries) console.log(e.file.padEnd(36), String(e.size_bytes).padStart(9), `${e.width}x${e.height}`, e.duration_s ?? '', `alt ${e.alt_text.length}`);
