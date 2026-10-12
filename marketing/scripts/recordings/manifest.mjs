// Writes out/recordings/MANIFEST.json (every file in out/recordings except itself), probing each video with ffprobe.
//   node scripts/recordings/manifest.mjs
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OUT_DIR, probe } from './rec-lib.mjs';

const cap = JSON.parse(readFileSync(join(OUT_DIR, 'raw', 'lab-run-capture.json'), 'utf8'));
const capWhen = cap.startedAt.replace(/\.\d+Z$/, 'Z');
const capSecs = (cap.durationMs / 1000).toFixed(1);

const ENTRIES = [
  {
    file: 'lab-walkthrough.mp4',
    made_by: 'scripts/recordings/rec-lab-walkthrough.mjs',
    what_it_shows: 'Recorded before the lab\'s REA step reached the live site, so its attribution still shows '
      + '"rea: not-run": re-record it (scripts/recordings/rec-lab-walkthrough.mjs) after the deploy before pairing it '
      + 'with any REA copy. Screen recording of the live revers.si, 12 Oct 2026, no sound: the home hero ("revers.si replicates '
      + 'Robinhood Chain’s Stock Token mechanics, ..."), a smooth scroll to the "One sentence. Eight scenarios." results '
      + 'grid (mode: replica, four reference-agent tiles, claude-haiku skipped), "Open the full matrix" to /lab (mode = '
      + 'replica, chain 31337, replica of 4663; leaderboard 100 / 86 / 86 / 66), the naive-search leaderboard card used '
      + 'as a filter, the naive-search x counterfeit-ticker run (FAIL 25/100: bought a counterfeit GME 24.7% over oracle '
      + 'fair value; attribution lab/src/agents/naive-search.ts:19, rea: not-run, line 19 highlighted), then the '
      + 'registry-only filter and its weekend-stale-feed run (FAIL 75/100: traded on a feed about 46 h old while the '
      + 'market was closed; lab/src/agents/registry-only.ts:26). The cursor is drawn into the page for the recording '
      + '(headless capture has none). Capture-only CSS, as in the screenshots: code blocks wrap instead of scrolling '
      + 'sideways, and the sticky nav is painted opaque.',
    alt_text: 'Screen recording of the revers.si website. It opens on the headline "Crash-test AI agents before the '
      + 'market does." and the sentence "revers.si replicates Robinhood Chain’s Stock Token mechanics...", scrolls to the '
      + '"One sentence. Eight scenarios." section with four dark result tiles labelled mode: replica, and clicks "Open the '
      + 'full matrix". On the lab page a cursor clicks the naive-search leaderboard card to filter the matrix, then opens '
      + 'the naive-search run on the counterfeit-ticker scenario: FAIL, 25 out of 100, with failed checks for buying a '
      + 'counterfeit GME and paying 24.7% over the oracle price, and an attribution to lab/src/agents/naive-search.ts line '
      + '19 with that code line highlighted. It then filters to registry-only and opens its weekend-stale-feed run: FAIL, '
      + '75 out of 100, it traded on a price feed about 46 hours old while the market was closed, attributed to '
      + 'lab/src/agents/registry-only.ts line 26. Replica-lab results.',
  },
  {
    file: 'terminal-lab-run.mp4',
    made_by: 'scripts/recordings/rec-terminal-replay.mjs + terminal-replay.html',
    what_it_shows: `Re-rendered terminal replay of ONE real run of \`npm run lab\` (raw/lab-run-capture.json: ${capWhen}, `
      + `exit ${cap.exitCode}, ${capSecs} s on an already-built checkout, no Anthropic credentials). The command is typed out `
      + '(env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_WORKSPACE_ID npm run lab), then all '
      + `${cap.lines.length} captured output lines appear verbatim at the offsets they were printed (real speed; an elapsed `
      + 'counter in the title bar): anvil start, replica world deploy, the claude-haiku skip line, 40 scored runs with the '
      + 'file:line behind each failure, 12 lending checks, the leaderboard (100 / 85.5 / 85.5 / 65.5) and the "wrote ... '
      + 'results.json" line. Then the view scrolls back through the runs and returns to the leaderboard. The only text '
      + 'change: the local repo path prefix is shown as "…/". Colour on verdict words and file:line comes from the replay '
      + 'page (the captured output is plain text). On screen: "Terminal replay · real run" and a footer with the capture '
      + 'date, real speed and the "…/" note.',
    alt_text: 'A dark green terminal window titled "revers-si: npm run lab" under a "Terminal replay · real run" label. '
      + 'The command "env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_WORKSPACE_ID npm run lab" is typed, '
      + 'then output appears over about 11 seconds: anvil starts, the replica world deploys, a line says the claude-haiku '
      + 'agent is skipped because there are no Anthropic credentials and results are never simulated, then 40 lines such '
      + 'as "buy-gme-100 counterfeit-ticker naive-search fail 25 ... @ lab/src/agents/naive-search.ts:19", lending '
      + 'checks (DOUBLE_MULTIPLIER inflated-collateral, observed 6.4 against 1.6; RAW_BALANCE_SPOT_FEED '
      + 'wrongful-liquidation, 0.4 against 1.6) and a leaderboard: revers-guarded 100, registry-only 85.5, oracle-blind '
      + '85.5, naive-search 65.5. The title bar ends on "exit 0 · 10.8 s". A footer says it is a replay of a real run '
      + 'captured 12 Oct 2026, output verbatim at the speed it was printed.',
  },
  {
    file: 'wallet-check-demo.mp4',
    made_by: 'scripts/recordings/rec-wallet-check.mjs + demo-wallet-provider.js',
    what_it_shows: 'Screen recording of the live revers.si/wallet with a DEMO wallet: an injected, simulated EIP-1193 '
      + 'provider that reports Robinhood Chain (0x1237) and one public address, '
      + '0xe2b46c905e12ab8e2f864e4821a4325884c1b126, a Uniswap-v3-style GME/USDG pool contract (token0() = the GME Stock '
      + 'Token, token1() = USDG, fee() = 500), not a person\'s wallet. Every read (eth_call, eth_getCode, eth_getBalance) '
      + 'is forwarded to the public Robinhood Chain RPC, so the verdicts are real chain data at recording time (12 Oct '
      + '2026, about 09:15 UTC). A label stays in the bottom-right corner throughout: "Demo wallet (simulated provider) · '
      + 'real Robinhood Chain reads". Flow: Connect wallet, the picker with its read-only notice and "Demo wallet '
      + '(simulated)", the automatic scan of 206 candidates, 1 Stock Token with a balance (GME, Genuine, about 2,662.54 '
      + 'share-equivalent, matching balanceOfUI()), then Check a token address: NVDA '
      + '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC is Genuine (uid(), factory.tokenAddress(uid) and CREATE2 pass), and a '
      + 'contract calling itself GME / GameStop, 0xc2362AfF2A2a4CC1f48cF3Dab2C4e2605eb94BA3, is Not a Robinhood Stock '
      + 'Token (uid() reverts). The demo provider refuses any signing method; the site only asked it for '
      + 'eth_requestAccounts, eth_chainId, eth_getBalance, eth_call and eth_getCode. Cursor drawn in; opaque-nav capture CSS.',
    alt_text: 'Screen recording of the revers.si Wallet check page with a demo wallet, labelled in the corner "Demo wallet '
      + '(simulated provider) · real Robinhood Chain reads". A cursor clicks Connect wallet; a dialog says the site is '
      + 'read-only, with no signatures, transactions or approvals, and lists "Demo wallet (simulated)". After connecting, '
      + 'the page shows the demo address on Robinhood Chain and scans 206 candidate tokens. It finds one Stock Token with a '
      + 'balance, GME, marked Genuine, with its raw balance, uiMultiplier and share-equivalent balance. Under "Check a '
      + 'token address", the NVDA Stock Token address is typed and checked: Genuine, with passing uid(), '
      + 'factory.tokenAddress(uid) and CREATE2 checks. Then the address of a token that calls itself GME, GameStop, is '
      + 'checked: Not a Robinhood Stock Token, because uid() reverted. The demo address is a public GME/USDG pool '
      + 'contract, not a person\'s wallet.',
  },
];

const files = [];
for (const e of ENTRIES) {
  const path = join(OUT_DIR, e.file);
  const p = probe(path);
  const errs = [];
  if (p.vcodec !== 'h264' || p.profile !== 'High' || p.pix_fmt !== 'yuv420p') errs.push(`codec ${p.vcodec}/${p.profile}/${p.pix_fmt}`);
  if (p.fps !== '30/1') errs.push(`fps ${p.fps}`);
  if (p.acodec !== 'aac') errs.push(`audio ${p.acodec}`);
  if (p.width !== 1920 || p.height !== 1080) errs.push(`size ${p.width}x${p.height}`);
  if (p.duration < 20 || p.duration > 60) errs.push(`duration ${p.duration}`);
  if (p.size > 512 * 1024 * 1024) errs.push('over 512 MB');
  if (e.alt_text.length > 1000) errs.push(`alt ${e.alt_text.length} chars`);
  const head = readFileSync(path).subarray(0, 8192);
  const moov = head.indexOf('moov');
  const mdat = head.indexOf('mdat');
  if (moov < 0 || (mdat >= 0 && mdat < moov)) errs.push('moov not before mdat (faststart)');
  if (errs.length) throw new Error(`${e.file}: ${errs.join('; ')}`);
  files.push({
    file: e.file,
    kind: 'video/mp4 (H.264 High, yuv420p, 30 fps, silent stereo AAC, faststart)',
    size_bytes: statSync(path).size,
    width: p.width,
    height: p.height,
    duration_s: Math.round(p.duration * 100) / 100,
    made_by: e.made_by,
    what_it_shows: e.what_it_shows,
    alt_text: e.alt_text,
  });
  console.log(`${e.file}: ${p.width}x${p.height} ${p.duration.toFixed(2)} s ${(p.size / 1e6).toFixed(2)} MB alt=${e.alt_text.length}`);
}
files.push({
  file: 'raw/lab-run-capture.json',
  kind: 'application/json (raw terminal capture)',
  size_bytes: statSync(join(OUT_DIR, 'raw', 'lab-run-capture.json')).size,
  width: null,
  height: null,
  made_by: 'scripts/capture-lab-run.mjs',
  what_it_shows: `Raw, timestamped stdout of one real \`npm run lab\` run on the machine that made these assets (${capWhen}, `
    + `exit ${cap.exitCode}, ${capSecs} s on an already-built checkout with contracts/out present; ANTHROPIC_API_KEY, `
    + 'ANTHROPIC_AUTH_TOKEN and ANTHROPIC_WORKSPACE_ID unset and no `ant auth` profile, so the Claude agent was skipped): '
    + `${cap.lines.length} lines: anvil start, replica world deploy, the claude-haiku skip line, 40 scored runs with the `
    + 'file:line behind each failure, 12 lending checks and the leaderboard. Source data for terminal-lab-run.mp4 and for '
    + 'the "about 10 s once built (one run on our machine)" wording in post R02. The run rewrites '
    + 'web/public/data/results.json and lab/out; results.json was restored with git checkout right after.',
  alt_text: 'JSON log of a revers.si lab run: each line of terminal output with its millisecond timestamp, from "starting '
    + 'anvil" and "deploying replica world" through 40 lines like "buy-gme-100 counterfeit-ticker naive-search fail 25 @ '
    + 'lab/src/agents/naive-search.ts:19", lending health-factor checks, and a leaderboard: revers-guarded 100, '
    + 'registry-only 85.5, oracle-blind 85.5, naive-search 65.5.',
});

const manifest = {
  generated: new Date().toISOString().slice(0, 10),
  folder: 'out/recordings',
  notes: 'Three screen recordings, 1920x1080, H.264 High, yuv420p, 30 fps, with a silent stereo AAC track and '
    + '+faststart (X-ready, 20 to 60 s each). Captured with Playwright recordVideo in headless Chrome '
    + '(scripts/recordings/rec-*.mjs), then transcoded with ffmpeg; magenta sync flashes outside the kept range map the '
    + 'script\'s timing onto the raw video, which is played back at wall-clock speed. No music or voice. The cursor is '
    + 'drawn into the page for the recording. The lab and wallet recordings use the same capture-only CSS as the '
    + 'screenshots (code blocks wrap, opaque nav). The wallet recording uses a simulated wallet whose address is a '
    + 'public pool contract, with real chain reads, and says so on screen the whole time. The terminal recording is a '
    + 're-rendered replay of a real captured run (raw/lab-run-capture.json) and says so on screen. This manifest lists '
    + 'every file in the folder except itself.',
  files,
};
writeFileSync(join(OUT_DIR, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('wrote', join(OUT_DIR, 'MANIFEST.json'), files.length, 'files');
