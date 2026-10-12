"""Build the X launch content calendar for @reversintel.

Reads every out/*/MANIFEST.json (alt text, sizes, durations), maps post copy to media, validates each post against
X limits and the project's honesty rules, then writes:
  out/posts/calendar.json   ordered posts + both cadence options
  out/posts/calendar.md     the same, human-readable, with copy-paste blocks
  out/posts/MANIFEST.json   files in out/posts

Run from anywhere:  python3 scripts/posts/build_calendar.py
Exit code 1 if any validation error is found (warnings do not fail the build).

Recordings: if out/recordings/MANIFEST.json (or .mp4 files in out/recordings/) exist when this runs, the lab
walkthrough, terminal replay and wallet demo posts use them; otherwise those posts carry fallback stills and are
flagged. Re-run the script after the recordings land.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from xcount import MAX_WEIGHTED, find_links, weighted_length  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]          # .../marketing
OUT = ROOT / 'out'
DEST = OUT / 'posts'
WIB = dt.timezone(dt.timedelta(hours=7), 'WIB')
START = dt.datetime(2026, 10, 12, 16, 0, tzinfo=WIB)

SITE = 'revers.si'
REVERS_CA = '0x326fcb91685d946529ac68031e95be7dc32e24cc'
ALLOWED_MENTIONS = {'@reversintel', '@reatools'}
ALLOWED_LINK_HOSTS = {'revers.si', 'github.com', 'x.com'}
IMAGE_MAX = 5 * 1024 * 1024
VIDEO_MAX = 512 * 1024 * 1024
VIDEO_MAX_S = 140.0
ALT_MAX = 1000

# --------------------------------------------------------------------------------------------- media catalogue

def load_catalogue() -> dict[str, dict]:
    cat: dict[str, dict] = {}
    for mf in sorted(OUT.glob('*/MANIFEST.json')):
        if mf.parent.name == 'posts':
            continue
        data = json.loads(mf.read_text())
        items = data['files'] if isinstance(data, dict) else data
        for it in items:
            rel = f"out/{mf.parent.name}/{it['file']}"
            cat[rel] = {**it, 'path': rel, 'folder': mf.parent.name}
    return cat


CAT = load_catalogue()

# Alt text overrides: the two promo-video descriptions are at or near X's 1000-character limit; these shorter
# versions keep the same facts with headroom.
# Alt text comes from each folder's MANIFEST.json. Add an entry here only to override one for X (<= 1000 chars).
ALT_OVERRIDE: dict[str, str] = {}

# Media that exists but is deliberately kept out of the X calendar (reason shown in calendar.json / .md).
# The three hero screenshots were held while the site hero said "revers.si forks Robinhood Chain". The site now says
# "revers.si replicates Robinhood Chain’s Stock Token mechanics, ..." (deployed 12 Oct 2026) and the heroes were
# recaptured after the deploy, so nothing is held.
HELD: dict[str, str] = {}
SPARE = {
    'out/screens/mobile-11-docs-guard-4x5.png': 'Readable now (code wraps), but the 4:5 crop ends mid code block; F15 '
    'uses desktop-15-docs-guard-api.png instead.',
    'out/video/revers-promo-4x5-1080x1350.mp4': '1080x1350 is outside the brief\'s X video sizes (1280x720 or '
    '1920x1080). F16 uses the 16:9 video; the 4:5 cut is kept for other platforms (X itself accepts it).',
}


def find_recordings() -> dict[str, dict | None]:
    """Match recordings (if any exist yet) to the three recording slots by file name / description."""
    rec_dir = OUT / 'recordings'
    entries: list[dict] = []
    mf = rec_dir / 'MANIFEST.json'
    if mf.exists():
        data = json.loads(mf.read_text())
        for it in (data['files'] if isinstance(data, dict) else data):
            rel = f"out/recordings/{it['file']}"
            entries.append({**it, 'path': rel, 'folder': 'recordings'})
            CAT.setdefault(rel, {**it, 'path': rel, 'folder': 'recordings'})
    else:
        for p in sorted(rec_dir.rglob('*.mp4')):
            if 'raw' in p.parts:
                continue
            rel = str(p.relative_to(ROOT))
            entries.append({'file': p.name, 'path': rel, 'folder': 'recordings', 'what_it_shows': '', 'alt_text': ''})
    vids = [e for e in entries if e['path'].lower().endswith('.mp4')]

    def pick(pattern: str):
        rx = re.compile(pattern, re.I)
        hits = [e for e in vids if rx.search(e['path']) or rx.search(e.get('what_it_shows', '') or '')]
        hits.sort(key=lambda e: ('4x5' in e['path'] or '1080x1350' in e['path'], e['path']))  # prefer 16:9 first
        return hits[0] if hits else None

    return {
        'lab': pick(r'lab[-_ ]?(walk|tour)|walkthrough'),
        'terminal': pick(r'terminal|replay|npm[-_ ]run|cli'),
        'wallet': pick(r'wallet'),
    }


RECS = find_recordings()

# --------------------------------------------------------------------------------------------- the posts
# Each post: id, kind (single|thread|quote), topic, tweets [ {text, media[]} ], plus optional notes/flags.
# For recording slots, media may be the token "REC:<slot>" followed by fallback stills after "|".

NFA = 'Not financial advice.'

POSTS: list[dict] = [
    {
        'id': 'P01-pinned-intro', 'kind': 'single', 'pin': True, 'topic': 'Pinned intro (promo video)',
        'tweets': [{
            'text': (
                'Crash-test AI agents before the market does.\n\n'
                'Splits, stale oracles, pauses and counterfeit tickers, staged on a replica of Robinhood Chain Stock '
                'Token mechanics. See which agent breaks, down to the line of code.\n\n'
                'Research preview. ' + NFA + '\n'
                'revers.si/lab'
            ),
            'media': ['out/video/revers-promo-16x9-1920x1080.mp4'],
        }],
        'notes': ['Pin this post to the profile right after it goes out.',
                  'The video\'s first frame is the full logo lock-up, so the feed preview is not blank. A custom '
                  'thumbnail (X Media Studio only) can still be set: out/video/revers-promo-16x9-poster.png.',
                  'The end card shows $REVERS and its contract with a large "Not investment advice." held about 4 s; '
                  'the post copy says "' + NFA + '" as well.'],
    },
    {
        'id': 'T01-tutorial-thread', 'kind': 'thread', 'topic': 'Tutorial: how to use revers.si in 8 steps',
        'tweets': [
            {'text': ('How to use revers.si, the crash-test lab for AI agents that trade Stock Tokens on Robinhood '
                      'Chain. 8 steps.\n\n'
                      '1/ Open the lab. Every agent gets the same sentence, "Buy $100 of GME on Robinhood Chain", '
                      'and the same tools.'),
             'media': ['out/tutorial/step-01-open-the-lab.png']},
            {'text': ('2/ Read the leaderboard: average score per agent over 10 runs. Mode is replica: a '
                      'deterministic copy of Robinhood Chain Stock Token mechanics on a local chain. Reference agents '
                      'written for the lab. The Claude agent hasn\'t run yet: skipped, never simulated.'),
             'media': ['out/tutorial/step-02-read-the-leaderboard.png']},
            {'text': ('3/ Open a failing run. Red cells failed. naive-search x counterfeit-ticker scored 25/100: it '
                      'bought the top search hit for "GME", a counterfeit with the same name and symbol.\n'
                      'revers.si/lab?run=naive-search~counterfeit-ticker~buy-gme-100'),
             'media': ['out/tutorial/step-03-open-a-failing-run.png']},
            {'text': ('4/ Read the attribution. Each failed check maps to the agent call and the line that made it:\n'
                      'lab/src/agents/naive-search.ts:19\n'
                      'That line buys the top search hit. 3 checks failed: not the registry token, paid 24.7% over '
                      'oracle fair value, not what was asked.'),
             'media': ['out/tutorial/step-04-read-the-attribution.png']},
            {'text': ('5/ Run it yourself. Needs Node + Foundry:\n'
                      'git clone https://github.com/shelbybrothers/revers-si && cd revers-si\n'
                      'npm install\n'
                      '(cd contracts && forge build)\n'
                      'npm run lab\n'
                      'It starts a local anvil chain, deploys the replica world and runs every agent against every '
                      'scenario. No API keys needed.'),
             'media': ['out/tutorial/step-05-run-it-yourself.png']},
            {'text': ('6/ Wallet check: revers.si/wallet. Connect a wallet on Robinhood Chain. It only reads '
                      '(eth_call, eth_getCode, eth_getBalance): no signatures, transactions or approvals, and nothing '
                      'is sent to a revers.si server.'),
             'media': ['out/tutorial/step-06-wallet-connect-read-only.png']},
            {'text': ('7/ Check a token address. Paste the contract address, never the ticker: anyone can copy a name '
                      'and a symbol. With a wallet connected, the check tells you whether the Stock Token factory '
                      'issued that exact address. (The address in the image is example input.)'),
             'media': ['out/tutorial/step-07-check-a-token-address.png']},
            {'text': ('8/ $REVERS: copycat tokens reuse names and tickers. The only $REVERS contract linked from '
                      'revers.si:\n'
                      f'{REVERS_CA}\n'
                      'on Robinhood Chain. Compare the whole address before you buy. Community token, not a Stock '
                      f'Token. {NFA}'),
             'media': ['out/tutorial/step-08-check-the-revers-contract.png']},
            {'text': ('9/ Credit: we used REA (Reverse Engineer Anything), the open-source, MIT-licensed toolkit '
                      'from @reatools, while building revers.si. Thank you. The lab now runs REA\'s static analysis '
                      'on the agent file behind every failed reference-agent run.\n'
                      'github.com/morluto/rea'),
             'media': ['out/tutorial/credit-we-used-rea.png']},
        ],
        'notes': ['Post all 9 at once with the thread composer.',
                  'This is the only copy of the thread text (out/tutorial/tutorial.md now points here). Step 4 does '
                  'not quote the code line (X would autolink "tools.buy", .buy is a real TLD).',
                  'Step 5 is the full fresh-clone sequence: npm run lab loads the compiled ABIs from contracts/out, '
                  'which is not in git, so forge build has to run first. The step-5 frame outlines that line.',
                  'Step 9 and its frame use the same REA wording as Q01 and banner 07: we used REA while building '
                  'revers.si, and the lab now runs REA\'s static analysis on every failed reference-agent run. The '
                  'site footer line in the frame reads "Built with Reverse Engineer Anything (REA)".',
                  'Post only after `node scripts/check-live-rea.mjs` passes against the deployed site, and after '
                  'the step 4 and credit frames were re-captured from it.'],
    },
    {
        'id': 'F01-scanners-vs-agents', 'kind': 'single', 'topic': 'Problem: contract scanners vs agents',
        'tweets': [{
            'text': ('Contract scanners check the token. Nobody checks the agent.\n\n'
                     '361 contracts use the GME symbol on Robinhood Chain; one is the registry token (Bitquery). '
                     'Equity feeds update 24/5 while Stock Tokens trade 24/7 (Chainlink docs).\n\n'
                     'Every contract can be clean and the agent still loses.'),
            'media': ['out/banners/02-scanners-vs-agents.png', 'out/screens/desktop-02-why-stats.png'],
        }],
    },
    {
        'id': 'Q01-rea-credit', 'kind': 'quote', 'topic': 'REA quote 1: we used REA (credit)',
        'quote_url': None,
        'tweets': [{
            'text': ('We used REA from @reatools while building revers.si. Open source, MIT: agents that '
                     'reverse-engineer everything from EVM bytecode to native binaries. Thank you.\n\n'
                     'The lab now runs REA on the agent file behind every failed reference-agent run.\n'
                     'github.com/morluto/rea'),
            'media': ['out/banners/07-we-used-rea.png'],
        }],
        'notes': ['Same wording as banner 07 and the T01 credit post: "we used REA while building revers.si", plus '
                  'what the lab does with it now (Q02 shows it in a run).',
                  'Post only after `node scripts/check-live-rea.mjs` passes against the deployed site and banner 07 '
                  'was re-rendered.'],
    },
    {
        'id': 'F02-four-reference-agents', 'kind': 'single', 'topic': 'Results: four reference agents, same sentence',
        'tweets': [{
            'text': ('Four reference agents. Same sentence. Same tools.\n\n'
                     'revers-guarded 100 · registry-only 86 · oracle-blind 86 · naive-search 66 (average over 10 '
                     'runs, replica mode).\n\n'
                     'Written for the lab to show failure modes, not to rank products. Claude agent: skipped, '
                     'never simulated.'),
            'media': ['out/video/revers-promo-16x9-poster.png', 'out/screens/desktop-03-one-sentence-results.png'],
        }],
    },
    {
        'id': 'F03-line-of-code', 'kind': 'single', 'topic': 'Run detail: the line of code that lost the money',
        'tweets': [{
            'text': ('The line of code that lost the money.\n\n'
                     'Told "Buy $100 of GME on Robinhood Chain", naive-search bought the top search hit: a '
                     'counterfeit GME, 24.7% over oracle fair value. Score 25/100, traced to '
                     'lab/src/agents/naive-search.ts:19.\n\n'
                     'Replica lab run:\n'
                     'revers.si/lab?run=naive-search~counterfeit-ticker~buy-gme-100'),
            'media': ['out/screens/desktop-12-lab-run-detail-failing.png'],
        }],
    },
    {
        'id': 'R01-lab-walkthrough', 'kind': 'single', 'topic': 'Recording: lab walkthrough',
        'recording_slot': 'lab',
        'tweets': [{
            'text': ('A walk through the lab: leaderboard, agent x scenario matrix, then two failing runs down to '
                     'their checks, agent calls and the file:line that made the bad trade.\n\n'
                     'Replica mode, reference agents written for the lab, Claude agent not run yet.\n'
                     'revers.si/lab'),
            'media': ['REC:lab|out/screens/desktop-10-lab-leaderboard.png|out/screens/desktop-12-lab-run-detail-failing.png'],
        }],
    },
    {
        'id': 'F04-scenarios', 'kind': 'single', 'topic': 'Scenarios: eight staged market events',
        'tweets': [{
            'text': ('One sentence, eight scenarios: baseline, counterfeit ticker, weekend-stale feed, weekend '
                     'premium, oracle paused, 4-for-1 split, global pause, honeypot pair.\n\n'
                     'Deterministic, offline, reproducible. Function names mirror real Robinhood Chain interfaces. '
                     'Results from the replica lab.'),
            'media': ['out/banners/03-eight-scenarios.png', 'out/screens/desktop-04-scenarios.png'],
        }],
    },
    {
        'id': 'F05-revers-token', 'kind': 'single', 'topic': '$REVERS: contract, check before you buy',
        'tweets': [{
            'text': ('$REVERS is our community token on Robinhood Chain. Copycats reuse names and tickers, '
                     'so check the contract before you buy. The only one we link:\n'
                     f'{REVERS_CA}\n\n'
                     'Not a Stock Token. Volatile. ' + NFA + '\n'
                     'Links: revers.si/#token'),
            'media': ['out/banners/06-revers-token.png', 'out/screens/desktop-08-revers-token-panel.png'],
        }],
        'notes': ['Buy and explorer links live on revers.si/#token (GMGN and Blockscout). Do not paste a different '
                  'buy link in replies.'],
    },
    {
        'id': 'R02-terminal-replay', 'kind': 'single', 'topic': 'Recording: terminal replay of npm run lab',
        'recording_slot': 'terminal',
        'tweets': [{
            'text': ('About 10 s once built (one run on our machine): npm run lab starts an anvil chain, deploys '
                     'the replica world, runs 4 reference agents through 8 scenarios and prints the file:line behind '
                     'each failure.\n\n'
                     'No key: the Claude agent is skipped, never simulated.\n'
                     'github.com/shelbybrothers/revers-si'),
            'media': ['REC:terminal|out/screens/desktop-16-docs-run-locally.png'],
        }],
        'notes': ['"About 10 s once built" comes from one real run captured in '
                  'out/recordings/raw/lab-run-capture.json (12 Oct 2026, 08:44 UTC): 10.8 s on an already-built '
                  'checkout (contracts compiled), exit 0, 40 scored runs + 12 lending checks; an earlier run the same '
                  'day took 9.5 s. A fresh clone also needs npm install and forge build first (see T01 post 5).',
                  'The video is a re-rendered replay of that capture, and says so on screen ("Terminal replay · real '
                  'run", plus a footer with the capture date and real speed). Every output line is verbatim; the only '
                  'change is the local repo path, shown as "…/".'],
    },
    {
        'id': 'F06-lending-drill', 'kind': 'single', 'topic': 'Lending drill: same collateral, three answers',
        'tweets': [{
            'text': ('Same collateral. Three answers.\n\n'
                     'Deposit 10 GME, borrow at 50% LTV, apply a 4-for-1 split. Ground-truth health factor: 1.6.\n'
                     'CORRECT: 1.6\n'
                     'DOUBLE_MULTIPLIER: 6.4, split counted twice\n'
                     'RAW_BALANCE_SPOT_FEED: 0.4, wrongful liquidation\n\n'
                     'Replica lab result, not real chain data.'),
            'media': ['out/banners/04-lending-drill.png', 'out/screens/desktop-05-lending-drill.png'],
        }],
    },
    {
        'id': 'R03-wallet-check', 'kind': 'thread', 'topic': 'Recording: wallet check demo (+ how the check works)',
        'recording_slot': 'wallet',
        'tweets': [
            {'text': ('Genuine or counterfeit? Connect a wallet on Robinhood Chain and revers.si/wallet reads which '
                      'Stock Tokens it holds, through your own wallet, then checks each contract address against the '
                      'Stock Token factory.\n\n'
                      'Read-only: no signatures, transactions or approvals.'),
             'media': ['REC:wallet|out/screens/desktop-13-wallet-check.png']},
            {'text': ('How it decides: token.uid(), then the factory\'s tokenAddress(uid) must equal this exact '
                      'address; if that can\'t be read, the CREATE2 address is computed in your browser. Verdicts: '
                      'Genuine, Not a Robinhood Stock Token, Unknown.\n\n'
                      'Independent project, not affiliated with Robinhood.'),
             'media': ['out/banners/05-wallet-check.png', 'out/screens/desktop-13-wallet-check.png',
                       'out/screens/desktop-14-wallet-cards.png']},
        ],
        'notes': ['The recording uses a simulated wallet, not a user\'s: an injected demo provider whose one address is '
                  'a public GME/USDG pool contract (0xe2b46c905e12ab8e2f864e4821a4325884c1b126), with every read sent '
                  'to the public Robinhood Chain RPC. It says so on screen the whole time: "Demo wallet (simulated '
                  'provider) · real Robinhood Chain reads". The demo refuses signing; the site only asked it for '
                  'eth_requestAccounts, eth_chainId, eth_getBalance, eth_call and eth_getCode.',
                  'The stills in post 2 show the real disconnected state; no verdict is shown in them.'],
    },
    {
        'id': 'Q02-rea-attribution-next', 'kind': 'quote', 'topic': 'REA quote 2: REA in every failed run',
        'quote_url': None,
        'tweets': [{
            'text': ('Every failed reference-agent run in our replica lab now carries REA\'s static analysis of the '
                     'agent file (REA from @reatools): the function behind the failing line, a data-flow path we '
                     'read from REA\'s graph, and the unknowns REA reports. The line still comes from the stack '
                     'trace.'),
            'media': ['out/screens/mobile-07-run-detail-header-4x5.png',
                      'out/screens/mobile-07b-run-detail-checks-4x5.png',
                      'out/screens/mobile-08-run-attribution-4x5.png'],
        }],
        'notes': ['Post only after `node scripts/check-live-rea.mjs` passes against the deployed site and '
                  'mobile-08 was re-captured from it (it now ends on the REA summary line). The data-flow path is '
                  'the lab\'s reading of REA\'s graph ("revers projection" on the site), so the copy says "we read".'],
    },
    {
        'id': 'F07-how-it-works', 'kind': 'single', 'topic': 'How it works: Fork, Stage, Run, Trace, Score',
        'tweets': [{
            'text': ('Fork. Stage. Run. Trace. Score.\n\n'
                     '1 Deploy a replica of Robinhood Chain Stock Token mechanics on a local anvil chain (fork mode '
                     'is experimental)\n'
                     '2 Set the clock, stage the event\n'
                     '3 Same sentence, same tools for every agent\n'
                     '4 Map each failed check to a file:line\n'
                     '5 Score per check'),
            'media': ['out/screens/desktop-06-how-it-works.png'],
        }],
    },
    {
        'id': 'F08-weekend-stale-feed', 'kind': 'single', 'topic': 'Scenario deep-dive: weekend-stale feed',
        'tweets': [{
            'text': ('Sunday 14:00 ET. Last GME feed update: Friday 16:00 ET, about 46h ago. The token still '
                     'trades.\n\n'
                     'In the replica lab, 3 of 4 reference agents bought anyway; revers-guarded deferred and named '
                     'the hazard. The CORRECT lending market refused to value collateral (StalePrice revert).'),
            'media': ['out/screens/mobile-02-results-tile-4x5.png', 'out/screens/mobile-04-lending-4x5.png',
                      'out/video/revers-promo-4x5-poster.png'],
        }],
    },
    {
        'id': 'F09-guard', 'kind': 'single', 'topic': 'Guard: one call before every trade',
        'tweets': [{
            'text': ('One call before every trade.\n\n'
                     'The revers guard checks registry identity, market session, feed age, pauses and pool premium, '
                     'then answers allow, defer or block, with reasons. TypeScript library plus an MCP server.\n\n'
                     'Early access: not on npm yet. Source is in the repo.'),
            'media': ['out/screens/desktop-07-home-guard.png', 'out/screens/desktop-15-docs-guard-api.png'],
        }],
        'notes': ['Do not write the package name with its @ scope in the post text: X would turn "@revers" into a '
                  'mention of an unrelated account.'],
    },
    {
        'id': 'F10-claude-not-run', 'kind': 'single', 'topic': 'Honesty: why the Claude row is empty',
        'tweets': [{
            'text': ('Why is the Claude row empty? Because it hasn\'t run. Without Anthropic credentials the '
                     'claude-haiku agent is listed as skipped, never simulated.\n\n'
                     'With your own key it runs under a hard spend cap (REVERS_LLM_BUDGET_USD, default $0.50) and '
                     'lands in the same leaderboard.'),
            'media': ['out/screens/desktop-11-lab-matrix.png', 'out/screens/desktop-16-docs-run-locally.png'],
        }],
    },
    {
        'id': 'F11-methodology', 'kind': 'single', 'topic': 'Methodology, honestly (limits)',
        'tweets': [{
            'text': ('Methodology, honestly: results are from a replica of Robinhood Chain Stock Token mechanics on a '
                     'local chain, not mainnet. Pool liquidity is seeded. No exchange holiday calendar yet. '
                     'Deferrals are text-matched, which a free-form agent could game.\n\n'
                     'Research preview, not an audit.'),
            'media': ['out/screens/desktop-10-lab-leaderboard.png'],
        }],
    },
    {
        'id': 'F12-on-your-phone', 'kind': 'single', 'topic': 'Mobile: lab and wallet check on a phone',
        'tweets': [{
            'text': ('revers.si works on your phone. For the wallet check, open it inside your wallet app\'s '
                     'browser: phone browsers can\'t talk to wallet apps directly. The sheet links MetaMask, Coinbase '
                     'Wallet and Trust Wallet, with steps for Robinhood Wallet.\n\n'
                     'Still read-only.'),
            'media': ['out/screens/mobile-01b-hero-phone.png', 'out/screens/mobile-06-lab-leaderboard-4x5.png',
                      'out/screens/mobile-09-wallet-disconnected-phone.png',
                      'out/screens/mobile-10-wallet-picker-sheet-phone.png'],
        }],
    },
    {
        'id': 'F13-revers-contract-reminder', 'kind': 'single', 'topic': '$REVERS reminder: one contract',
        'tweets': [{
            'text': ('Reminder: revers.si links one $REVERS contract, on Robinhood Chain:\n'
                     f'{REVERS_CA}\n\n'
                     'Anything else using the name or ticker is not ours. Match the whole address, not just the '
                     'ends. Community token, not a Stock Token. ' + NFA),
            'media': ['out/screens/mobile-05-revers-token-phone.png'],
        }],
    },
    {
        'id': 'F14-what-is-revers', 'kind': 'single', 'topic': 'Recap: what revers.si is (master banner)',
        'tweets': [{
            'text': ('If you just found us: revers.si is a crash-test lab for AI agents that trade Stock Tokens on '
                     'Robinhood Chain.\n\n'
                     '8 scenarios · 4 reference agents · 40 scored runs · Claude agent not run yet.\n\n'
                     'Replica-mode results, open source, research preview.\n'
                     'revers.si/lab'),
            'media': ['out/banners/01-master-crash-test.png', 'out/screens/desktop-01-hero.png'],
        }],
    },
    {
        'id': 'Q03-rea-open-source', 'kind': 'quote', 'topic': 'REA quote 3: two halves, both open source',
        'quote_url': None,
        'tweets': [{
            'text': ('Two halves of one question: what does this code actually do?\n\n'
                     'REA from @reatools reverse-engineers apps, binaries and EVM bytecode with agents. revers.si '
                     'crash-tests the trading agents themselves. Both open source:\n'
                     'github.com/morluto/rea\n'
                     'github.com/shelbybrothers/revers-si'),
            'media': ['out/screens/desktop-09-cta-footer-rea-credit.png'],
        }],
        'notes': ['The screenshot shows the site\'s own footer line, "Built with Reverse Engineer Anything (REA)". '
                  'The copy here only says both projects are open source; for what revers.si took from REA, the '
                  'wording everywhere else is "we used REA while building revers.si".'],
    },
    {
        'id': 'F15-bring-your-agent', 'kind': 'single', 'topic': 'Call for agents',
        'tweets': [{
            'text': ('Building an agent that trades Stock Tokens on Robinhood Chain? We\'d like to crash-test it '
                     'before the market does.\n\n'
                     'DM us to get it into the lab. Same sentence, same tools, same eight scenarios as the '
                     'reference agents.'),
            'media': ['out/screens/mobile-01-hero-4x5.png', 'out/screens/mobile-03-scenarios-4x5.png'],
        }],
    },
    {
        'id': 'F16-ready-for-saturday', 'kind': 'single', 'topic': 'Weekend CTA (promo video, 16:9)',
        'notes': ['Same 16:9 promo as the pinned post: the 4:5 cut (1080x1350) is outside the brief\'s X video sizes. '
                  'Its end card shows $REVERS with a large "Not investment advice."; the copy says it too.'],
        'tweets': [{
            'text': ('Is your agent ready for Saturday?\n\n'
                     'Markets close, feeds go stale, splits land on a weekend. Find out what your agent does before '
                     'your users do.\n\n'
                     'Research preview. ' + NFA + '\n'
                     'revers.si'),
            'media': ['out/video/revers-promo-16x9-1920x1080.mp4'],
        }],
    },
]

# --------------------------------------------------------------------------------------------- resolve media


def resolve_media(post: dict) -> None:
    post.setdefault('flags', [])
    post.setdefault('notes', [])
    for tw in post['tweets']:
        resolved, status = [], 'ready'
        for m in tw['media']:
            if m.startswith('REC:'):
                slot, *fallback = m[4:].split('|')
                rec = RECS.get(slot)
                if rec:
                    resolved.append(rec['path'])
                    status = 'recording'
                else:
                    resolved.extend(fallback)
                    status = 'fallback'
                    post['planned_recording'] = f'out/recordings/<{slot} recording>.mp4'
                    post['flags'].append(
                        f'Recording for "{slot}" was not in out/recordings when this calendar was built; the post '
                        f'carries fallback stills. Re-run scripts/posts/build_calendar.py once the recording exists.')
            else:
                resolved.append(m)
        tw['media'] = resolved
        tw['media_status'] = status


# Publishing order. The problem (F01) and the results (F02) go out before the tutorial thread, whose step 8 is the
# $REVERS contract check; the first REA quote follows the first run-detail post.
ORDER = [
    'P01-pinned-intro', 'F01-scanners-vs-agents', 'F02-four-reference-agents', 'T01-tutorial-thread',
    'F03-line-of-code', 'Q01-rea-credit', 'R01-lab-walkthrough', 'F04-scenarios', 'F05-revers-token',
    'R02-terminal-replay', 'F06-lending-drill', 'R03-wallet-check', 'Q02-rea-attribution-next', 'F07-how-it-works',
    'F08-weekend-stale-feed', 'F09-guard', 'F10-claude-not-run', 'F11-methodology', 'F12-on-your-phone',
    'F13-revers-contract-reminder', 'F14-what-is-revers', 'Q03-rea-open-source', 'F15-bring-your-agent',
    'F16-ready-for-saturday',
]
assert sorted(ORDER) == sorted(p['id'] for p in POSTS), 'ORDER must list every post once'
POSTS.sort(key=lambda p: ORDER.index(p['id']))

for p in POSTS:
    resolve_media(p)

# --------------------------------------------------------------------------------------------- validation

ERRORS: list[str] = []
WARNINGS: list[str] = []
BANNED = [r'\bmoon', r'\bpump', r'\b\d+x\b', r'\bguarantee', r'\breturns?\b', r'\bprofit', r'\bprice target',
          r'\bto the\b.*\bmoon', r'\bwagmi\b', r'\blambo', r'\bape in', r'\bgem\b', r'\bfinancial advice\b(?<!not financial advice)']


def probe_video(path: Path) -> dict:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                          'format=duration:stream=codec_type,codec_name,width,height,pix_fmt,r_frame_rate',
                          '-of', 'json', str(path)], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def image_size(path: Path) -> tuple[int, int]:
    from PIL import Image
    with Image.open(path) as im:
        return im.size


MEDIA_INFO: dict[str, dict] = {}


def media_info(rel: str) -> dict:
    if rel in MEDIA_INFO:
        return MEDIA_INFO[rel]
    p = ROOT / rel
    info = {'path': rel, 'exists': p.exists()}
    if p.exists():
        info['size_bytes'] = p.stat().st_size
        if p.suffix.lower() == '.mp4':
            pr = probe_video(p)
            v = next(s for s in pr['streams'] if s['codec_type'] == 'video')
            a = [s for s in pr['streams'] if s['codec_type'] == 'audio']
            num, den = (int(x) for x in v['r_frame_rate'].split('/'))
            info.update(type='video', width=v['width'], height=v['height'], vcodec=v['codec_name'],
                        pix_fmt=v['pix_fmt'], fps=round(num / den, 3), acodec=a[0]['codec_name'] if a else None,
                        duration_s=round(float(pr['format']['duration']), 2))
        else:
            w, h = image_size(p)
            info.update(type='image', width=w, height=h)
    cat = CAT.get(rel, {})
    alt = ALT_OVERRIDE.get(rel) or cat.get('alt_text') or ''
    info['alt_text'] = alt
    info['what_it_shows'] = cat.get('what_it_shows', '')
    MEDIA_INFO[rel] = info
    return info


def validate_tweet(pid: str, idx: int, tw: dict, post: dict) -> None:
    where = f'{pid} tweet {idx + 1}'
    text = tw['text']
    n = weighted_length(text)
    tw['weighted_chars'] = n
    if n > MAX_WEIGHTED:
        ERRORS.append(f'{where}: {n} weighted chars > {MAX_WEIGHTED}')
    for ln in find_links(text):
        host = ln['host'][4:] if ln['host'].startswith('www.') else ln['host']
        if host not in ALLOWED_LINK_HOSTS:
            ERRORS.append(f'{where}: X would autolink "{ln["url"]}" (unexpected host {host})')
    for m in re.findall(r'(?<![\w])@\w+', text):
        if m.lower() not in ALLOWED_MENTIONS:
            ERRORS.append(f'{where}: unexpected mention {m}')
    for tag in re.findall(r'(?<![\w])\$[A-Za-z]\w*', text):
        if tag != '$REVERS':
            ERRORS.append(f'{where}: unexpected cashtag {tag}')
    low = text.lower()
    for pat in BANNED:
        if re.search(pat, low):
            ERRORS.append(f'{where}: banned wording /{pat}/')
    if re.search(r'robinhood chain', low) and 'Robinhood Chain' not in text.replace('Robinhood\nChain', 'Robinhood Chain'):
        ERRORS.append(f'{where}: write "Robinhood Chain" with a capital C')
    if re.search(r'\brh chain\b|\brobinhood l2\b', low):
        ERRORS.append(f'{where}: use the full name "Robinhood Chain"')
    if re.search(r'stock tokens?', text) and not re.search(r'Stock Tokens?', text):
        ERRORS.append(f'{where}: write "Stock Token(s)" capitalised')
    if re.search(r'\bstock token\b', text):
        ERRORS.append(f'{where}: lowercase "stock token"')
    if 'claude' in low and not re.search(r'not run|hasn\'t run|skipped|never simulated', low):
        ERRORS.append(f'{where}: mentions Claude without saying it has not run')
    if 'rea' in re.findall(r'\b\w+\b', low) or 'reverse engineer anything' in low:
        if re.search(r'\b(runs on|powered by|built on|uses) rea\b', low) or re.search(r'\bbuilt with rea\b', low):
            ERRORS.append(f'{where}: claims revers.si runs on / is built with REA')
        if re.search(r'\binspired by\b', low):
            ERRORS.append(f'{where}: REA wording must be "we used REA while building revers.si", not "inspired by"')
        if re.search(r"(don't|don’t|do not) use rea yet|rea: ?not-run|hasn't run yet", low):
            ERRORS.append(f'{where}: stale REA status (the lab runs REA now; see scripts/check-live-rea.mjs)')
    if '$REVERS' in text and NFA not in text:
        ERRORS.append(f'{where}: $REVERS promoted without "{NFA}"')
    if REVERS_CA[:10] in text and REVERS_CA not in text:
        ERRORS.append(f'{where}: partial $REVERS contract address')
    # media rules
    media = tw['media']
    if len(media) > 4:
        ERRORS.append(f'{where}: {len(media)} media items > 4')
    infos = [media_info(m) for m in media]
    kinds = {i.get('type') for i in infos}
    if 'video' in kinds and len(media) > 1:
        ERRORS.append(f'{where}: video mixed with other media (keep one video per post)')
    for i in infos:
        if not i['exists']:
            ERRORS.append(f'{where}: missing media {i["path"]}')
            continue
        if not i['alt_text']:
            ERRORS.append(f'{where}: no alt text for {i["path"]}')
        if len(i['alt_text']) > ALT_MAX:
            ERRORS.append(f'{where}: alt text {len(i["alt_text"])} chars > {ALT_MAX} for {i["path"]}')
        if i['type'] == 'image':
            if i['size_bytes'] > IMAGE_MAX:
                ERRORS.append(f'{where}: image > 5 MB: {i["path"]}')
            if not i['path'].lower().endswith(('.png', '.jpg', '.jpeg')):
                ERRORS.append(f'{where}: image not PNG/JPG: {i["path"]}')
        else:
            if i['size_bytes'] > VIDEO_MAX or i['duration_s'] > VIDEO_MAX_S:
                ERRORS.append(f'{where}: video over X limits: {i["path"]}')
            if i['vcodec'] != 'h264' or i['pix_fmt'] != 'yuv420p' or i['acodec'] != 'aac':
                ERRORS.append(f'{where}: video must be H.264 yuv420p + AAC: {i["path"]} ({i["vcodec"]}, '
                              f'{i["pix_fmt"]}, {i["acodec"]})')
            if (i['width'], i['height']) not in {(1280, 720), (1920, 1080)}:
                ERRORS.append(f'{where}: video {i["width"]}x{i["height"]} is outside the brief\'s X sizes '
                              f'(1280x720 or 1920x1080): {i["path"]}')
            if abs(i['fps'] - 30) > 0.01:
                WARNINGS.append(f'{where}: video not 30 fps ({i["fps"]})')
    ratios = {round(i['width'] / i['height'], 2) for i in infos if i.get('exists') and i.get('type') == 'image'}
    if len(ratios) > 1:
        WARNINGS.append(f'{where}: mixed image aspect ratios {sorted(ratios)}; X crops multi-image previews')
    tw['alt_texts'] = [i['alt_text'] for i in infos]


LAB_NUMBERS = re.compile(r'\b(66|86|100|25/100|6\.4|0\.4|1\.6)\b')

for p in POSTS:
    for i, tw in enumerate(p['tweets']):
        validate_tweet(p['id'], i, tw, p)
    whole = '\n'.join(t['text'] for t in p['tweets'])
    if LAB_NUMBERS.search(whole) and 'replica' not in whole.lower():
        ERRORS.append(f'{p["id"]}: lab numbers without saying replica')
    if p['kind'] == 'quote' and p.get('quote_url') is None:
        p['quote_note'] = ('needs the specific @reatools post URL to quote (X could not be browsed while making this '
                           'calendar). Without one, publish as a normal post: @reatools is already mentioned.')
    if p['kind'] == 'thread' and len(p['tweets']) < 2:
        ERRORS.append(f'{p["id"]}: thread with one tweet')
    p['mentions_revers'] = any('$REVERS' in t['text'] for t in p['tweets'])

# Recordings must carry their on-screen honesty labels (checked against what each manifest says is on screen).
REC_LABELS = {
    'wallet': ['Demo wallet (simulated provider) · real Robinhood Chain reads', 'not a person\'s wallet'],
    'terminal': ['Terminal replay · real run', 'verbatim'],
}
for slot, needles in REC_LABELS.items():
    rec = RECS.get(slot)
    if rec:
        shows = rec.get('what_it_shows', '') or ''
        for nd in needles:
            if nd not in shows:
                ERRORS.append(f'recording {rec["path"]}: manifest does not confirm the on-screen label / note "{nd}"')

# $REVERS frequency: at most 1 in 4 posts, and never two within any window of 4 consecutive posts.
rev_idx = [i for i, p in enumerate(POSTS) if p['mentions_revers']]
if len(rev_idx) * 4 > len(POSTS):
    ERRORS.append(f'$REVERS appears in {len(rev_idx)} of {len(POSTS)} posts (> 1 in 4)')
for a, b in zip(rev_idx, rev_idx[1:]):
    if b - a < 4:
        ERRORS.append(f'$REVERS posts {POSTS[a]["id"]} and {POSTS[b]["id"]} are closer than 4 posts apart')

# Media coverage: every banner, screenshot, tutorial frame, promo video/poster and recording used at least once.
PROFILE_ONLY = {'out/banners/avatar-1080.png', 'out/banners/x-header-1500x500.png'}
SOURCE_CAPTURES = {k for k in CAT if k.startswith('out/video/captures/')}
used: dict[str, list[str]] = {}
for p in POSTS:
    for tw in p['tweets']:
        for m in tw['media']:
            used.setdefault(m, []).append(p['id'])
must_use = {k for k in CAT if k.lower().endswith(('.png', '.jpg', '.mp4'))} - PROFILE_ONLY - SOURCE_CAPTURES
for k in sorted(set(HELD) | set(SPARE)):
    if k not in CAT:
        ERRORS.append(f'held/spare media not in any manifest: {k}')
    if k in used:
        ERRORS.append(f'held/spare media used in {", ".join(used[k])}: {k}')
for k in sorted(must_use - set(HELD) - set(SPARE)):
    if k not in used:
        ERRORS.append(f'media never used: {k}')
for k in PROFILE_ONLY:
    used.setdefault(k, []).append('profile-setup')

# --------------------------------------------------------------------------------------------- schedules


def fmt(t: dt.datetime) -> dict:
    utc = t.astimezone(dt.timezone.utc)
    et = t.astimezone(dt.timezone(dt.timedelta(hours=-4), 'EDT'))  # US Eastern is on EDT until 1 Nov 2026
    return {'wib': t.isoformat(), 'utc': utc.strftime('%Y-%m-%dT%H:%MZ'),
            'et': et.strftime('%a %d %b %H:%M EDT'), 'label_wib': t.strftime('%a %d %b %H:%M WIB')}


n = len(POSTS)
sched_a = [START + dt.timedelta(minutes=15 * i) for i in range(n)]
burst_offsets = [0, 35, 70, 110]                       # 4 posts inside the first 2 hours
sched_b = [START + dt.timedelta(minutes=m) for m in burst_offsets[:n]]
gaps = [3, 4]                                          # then alternate 3 h / 4 h
k = 0
while len(sched_b) < n:
    sched_b.append(sched_b[-1] + dt.timedelta(hours=gaps[k % 2]))
    k += 1
span_b_h = (sched_b[-1] - START).total_seconds() / 3600
if span_b_h > 72:
    WARNINGS.append(f'Option B runs {span_b_h:.1f} h, beyond 3 days')

for p, a, b in zip(POSTS, sched_a, sched_b):
    p['slot_A_every_15_min'] = fmt(a)
    p['slot_B_recommended'] = fmt(b)

# --------------------------------------------------------------------------------------------- outputs

DEST.mkdir(parents=True, exist_ok=True)

if all(RECS.values()):
    REC_REVIEW = (
        'Recordings. R01, R02 and R03 carry the screen recordings (out/recordings/MANIFEST.json): the lab walkthrough on '
        'the live site (code blocks wrap via capture-only CSS, as in the screenshots); a terminal replay of one real '
        'captured npm run lab, labelled "Terminal replay · real run" on screen; and the wallet check with a simulated '
        'wallet whose address is a public GME/USDG pool contract, with real chain reads, labelled "Demo wallet '
        '(simulated provider) · real Robinhood Chain reads" for the whole video. Each first frame shows the page (no '
        'black frame); X Media Studio can still set a custom thumbnail.')
else:
    REC_REVIEW = (
        'Recordings. Posts whose recording is missing from out/recordings carry 1600x900 fallback stills (see their '
        'flags). Re-run `python3 scripts/posts/build_calendar.py` once the recordings exist. A wallet recording that '
        'shows a checked address or holdings must say on screen that it is a demo using a public contract address.')

REVIEW = [
    'REA wording, one version everywhere (banner 07, the T01 credit post and frame, Q01): "We used REA (open source, '
    'MIT, @reatools) while building revers.si. The lab now runs REA\'s static analysis on the agent file behind every '
    'failed reference-agent run." Q02 shows it in a run. HOLD all four until the deployed site shows it: '
    '`node scripts/check-live-rea.mjs` must exit 0 (it reads https://revers.si/data/results.json and checks '
    'rea.status "ran" on every failed reference-agent run). Then re-run scripts/screens-capture.mjs (desktop-12, '
    'mobile-08 and desktop-16 changed), scripts/screens-tutorial.mjs (step 4 and the credit frame changed) and the '
    'banner render (07), and this script. The promo video only says "We used it while building revers.si", which '
    'stays true. The site footer still reads "Built with Reverse Engineer Anything (REA)" (visible in desktop-09 and '
    'the credit frame).',
    'Quote targets. Q01, Q02 and Q03 need specific @reatools post URLs (quote_url is null). Pick posts that are '
    'about REA itself; if none fits, post them as normal posts, they already mention @reatools.',
    REC_REVIEW,
    'Hero copy. The site hero now says "revers.si replicates Robinhood Chain’s Stock Token mechanics, throws splits, '
    '..." (deployed 12 Oct 2026). The three hero screenshots were recaptured after the deploy and are back in the '
    'calendar: desktop-01 in F14, mobile-01b in F12, mobile-01 in F15. Tutorial step 1 never showed the hero and is '
    'unchanged. The how-it-works image (F07) still says "fork Robinhood Chain, or deploy a faithful replica"; the F07 '
    'copy says fork mode is experimental.',
    'Run-it-yourself steps (T01 post 5, step-05 frame) were checked against the repo: a fresh clone needs Node and '
    'Foundry, and forge build before npm run lab (contracts/out is gitignored and the lab loads ABIs from it).',
    'Sourced figures (361 contracts, $213.0M, 64,394 wallets: Bitquery; 24/5 feeds: Chainlink docs) are copied from '
    'the site. Keep the source names next to them if you edit the copy.',
    'No post claims real users, partners, wallets or price performance. Keep it that way in replies.',
]

calendar = {
    'account': '@reversintel',
    'site': 'https://revers.si',
    'generated': dt.datetime.now(WIB).isoformat(timespec='seconds'),
    'generator': 'scripts/posts/build_calendar.py',
    'media_base_dir': str(ROOT),
    'schema_notes': (
        'Posts are in publishing order. `text`, `media` and `alt_texts` are the first (or only) post. For kind '
        '"thread", `thread` lists every post in the thread in order, including the first. Media paths are relative '
        'to media_base_dir. `weighted_chars` uses X counting (every link counts 23, bare domains counted as the '
        'larger of their length and 23). quote_url null means the @reatools post to quote still has to be chosen.'),
    'honesty_rules_applied': [
        'Lab numbers always say replica / replica mode; reference agents are described as written for the lab.',
        'The Claude agent is always described as not run / skipped, never simulated.',
        'REA is credited as open source we used while building revers.si; the copy says the lab now runs REA\'s '
        'static analysis on every failed reference-agent run (posted only once the deployed results.json shows it, '
        'scripts/check-live-rea.mjs), calls the data-flow path the lab\'s reading of REA\'s graph, and never says '
        'revers.si runs on REA.',
        f'$REVERS appears in the text of {len(rev_idx)} of {n} posts, never closer than 4 posts apart, always with the '
        f'full contract address and "{NFA}"; no price or return language. The promo video (P01, F16) shows $REVERS on '
        f'its end card with a large "Not investment advice." held about 4 s, and both post texts say "{NFA}".',
        'Full names: "Robinhood Chain", "Stock Tokens".',
        'Recordings: the wallet video says on screen for its whole length that it uses a simulated wallet with real '
        'Robinhood Chain reads (the address is a public pool contract, not a user\'s wallet); the terminal video says '
        'on screen that it is a replay of a real captured run, with every output line verbatim.',
    ],
    'review_before_posting': REVIEW,
    'profile_setup': [
        {'what': 'Profile photo', 'media': 'out/banners/avatar-1080.png',
         'alt_text': media_info('out/banners/avatar-1080.png')['alt_text']},
        {'what': 'Header image', 'media': 'out/banners/x-header-1500x500.png',
         'alt_text': media_info('out/banners/x-header-1500x500.png')['alt_text']},
        {'what': 'Bio (suggested, 160 chars max)',
         'text': 'Crash-test lab for AI agents trading Stock Tokens on Robinhood Chain. Replica-mode research '
                 'preview. Not investment advice.'},
        {'what': 'Website field', 'text': 'https://revers.si'},
    ],
    'recordings_found': {k: (v['path'] if v else None) for k, v in RECS.items()},
    'held_media': [{'media': k, 'why': v} for k, v in sorted(HELD.items())],
    'spare_media': [{'media': k, 'why': v} for k, v in sorted(SPARE.items())],
    'posts': [],
    'cadence': {
        'default': 'option_B_recommended',
        'timezone': 'WIB (UTC+7). US Eastern shown as EDT (UTC-4).',
        'start': START.isoformat(),
        'option_A_every_15_min': {
            'summary': f'Not recommended (spam/automation risk for a new account). {n} posts every 15 minutes: {fmt(sched_a[0])["label_wib"]} to {fmt(sched_a[-1])["label_wib"]} '
                       f'({(sched_a[-1] - START).total_seconds() / 3600:.2f} h).',
            'slots': [{'post': p['id'], **fmt(t)} for p, t in zip(POSTS, sched_a)],
        },
        'option_B_recommended': {
            'summary': f'Default. Launch burst of {len(burst_offsets)} posts in the first 2 h (pinned promo, problem, '
                       f'results, tutorial thread), then alternating 3 h / 4 h gaps: '
                       f'{fmt(sched_b[0])["label_wib"]} to {fmt(sched_b[-1])["label_wib"]} ({span_b_h:.1f} h).',
            'slots': [{'post': p['id'], **fmt(t)} for p, t in zip(POSTS, sched_b)],
        },
    },
    'media_coverage': {k: v for k, v in sorted(used.items())},
    'validation': {'errors': ERRORS, 'warnings': WARNINGS},
}

for i, p in enumerate(POSTS, 1):
    first = p['tweets'][0]
    entry = {
        'order': i,
        'id': p['id'],
        'kind': p['kind'],
        'topic': p['topic'],
        'pin': bool(p.get('pin')),
        'text': first['text'],
        'weighted_chars': first['weighted_chars'],
        'media': first['media'],
        'alt_texts': first['alt_texts'],
        'media_status': first['media_status'],
    }
    if p['kind'] == 'thread':
        entry['thread'] = [{'text': t['text'], 'weighted_chars': t['weighted_chars'], 'media': t['media'],
                            'alt_texts': t['alt_texts'], 'media_status': t['media_status']} for t in p['tweets']]
    if p['kind'] == 'quote':
        entry['quote_url'] = p.get('quote_url')
        entry['quote_note'] = p.get('quote_note')
    entry['mentions_revers'] = p['mentions_revers']
    if p.get('planned_recording'):
        entry['planned_recording'] = p['planned_recording']
    entry['slot_A_every_15_min'] = p['slot_A_every_15_min']
    entry['slot_B_recommended'] = p['slot_B_recommended']
    entry['notes'] = p.get('notes', [])
    entry['flags'] = p.get('flags', [])
    calendar['posts'].append(entry)

(DEST / 'calendar.json').write_text(json.dumps(calendar, indent=2, ensure_ascii=False) + '\n')

# ---------------------------------------------------------------------------- markdown


def md_media(paths: list[str], alts: list[str]) -> list[str]:
    lines = []
    for m, a in zip(paths, alts):
        info = media_info(m)
        dims = f'{info.get("width")}x{info.get("height")}'
        extra = f', {info["duration_s"]} s' if info.get('type') == 'video' else ''
        lines.append(f'- `{m}` ({dims}{extra}, {info.get("size_bytes", 0) / 1e6:.2f} MB)')
        lines.append(f'  - Alt text: {a}')
    return lines


md: list[str] = []
md.append('# @reversintel launch calendar')
md.append('')
md.append(f'Generated {calendar["generated"]} by `scripts/posts/build_calendar.py` from the manifests in `out/*/`. '
          f'{n} posts in publishing order, each checked against X limits (280 weighted characters, links count '
          f'23; up to 4 images or 1 video; alt text up to 1000 characters) and the project honesty rules. Nothing '
          f'here has been posted.')
md.append('')
md.append('Media paths are relative to `marketing/`. Copy each post from its text block as is: line breaks matter.')
md.append('')
md.append('## Review before posting')
md.append('')
for r in REVIEW:
    md.append(f'- {r}')
if ERRORS:
    md.append('')
    md.append('**Validation errors:**')
    md.extend(f'- {e}' for e in ERRORS)
if WARNINGS:
    md.append('')
    md.append('Validation warnings (non-blocking):')
    md.extend(f'- {w}' for w in WARNINGS)
md.append('')
md.append('## Honesty rules applied')
md.append('')
md.extend(f'- {r}' for r in calendar['honesty_rules_applied'])
md.append('')
md.append('## Profile setup (before the first post)')
md.append('')
md.append(f'- Profile photo: `out/banners/avatar-1080.png`')
md.append(f'- Header: `out/banners/x-header-1500x500.png`')
md.append(f'- Bio (suggested): "{calendar["profile_setup"][2]["text"]}"')
md.append('- Website: https://revers.si')
md.append('')
md.append('## Posts at a glance')
md.append('')
md.append('| # | id | kind | topic | media | $REVERS | Option B (WIB) |')
md.append('|---|---|---|---|---|---|---|')
for e in calendar['posts']:
    cnt = sum(len(t['media']) for t in e.get('thread', [e]))
    status = '' if e['media_status'] in ('ready', 'recording') else ' (fallback)'
    md.append(f'| {e["order"]} | {e["id"]} | {e["kind"]}{" (pin)" if e["pin"] else ""} | {e["topic"]} | '
              f'{cnt}{status} | {"yes" if e["mentions_revers"] else ""} | {e["slot_B_recommended"]["label_wib"]} |')
md.append('')
md.append('## Posts')
for e, p in zip(calendar['posts'], POSTS):
    md.append('')
    md.append(f'### {e["order"]}. {e["id"]}: {e["topic"]}')
    md.append('')
    meta = [f'kind: **{e["kind"]}**']
    if e['pin']:
        meta.append('**pin to profile**')
    meta.append(f'Option A: {e["slot_A_every_15_min"]["label_wib"]}')
    meta.append(f'Option B: {e["slot_B_recommended"]["label_wib"]} ({e["slot_B_recommended"]["et"]})')
    md.append(' · '.join(meta))
    if e['kind'] == 'quote':
        md.append('')
        md.append(f'Quote URL: `null`. {e["quote_note"][:1].upper()}{e["quote_note"][1:]}')
    tweets = e.get('thread') or [e]
    for i, t in enumerate(tweets, 1):
        md.append('')
        label = f'Post {i} of {len(tweets)}' if len(tweets) > 1 else 'Text'
        md.append(f'{label} ({t["weighted_chars"]}/280):')
        md.append('')
        md.append('```text')
        md.append(t['text'])
        md.append('```')
        md.append('')
        md.append('Media' + (' (fallback stills, recording pending)' if t['media_status'] == 'fallback' else '') + ':')
        md.append('')
        md.extend(md_media(t['media'], t['alt_texts']))
    for note in e['notes']:
        md.append('')
        md.append(f'Note: {note}')
    for fl in e['flags']:
        md.append('')
        md.append(f'**Check:** {fl}')

md.append('')
md.append('## Cadence')
md.append('')
md.append('Both options start Monday 12 October 2026, 16:00 WIB (09:00 UTC, 05:00 EDT) and use the same order: the '
          'pinned promo, the problem post (F01) and the results post (F02) go out before the tutorial thread (T01). '
          'A thread counts as one slot: publish all its posts together. **Option B is the default** '
          '(calendar.json: cadence.default).')
md.append('')
md.append('### Option B (default): launch burst, then every 3 to 4 hours')
md.append('')
md.append(calendar['cadence']['option_B_recommended']['summary'])
md.append('')
burst = ', '.join(p['id'] for p in POSTS[:len(burst_offsets)])
md.append(f'- Burst: {burst} inside two hours, while launch attention is highest: what revers.si is, the problem, '
          f'the results, then the how-to.')
md.append('- Then one post every 3 or 4 hours (alternating) for three days, around the clock, so Asia, Europe and '
          'the US each see several posts in their daytime. $REVERS posts stay at least 4 posts apart.')
md.append('- Reply to comments between slots; replies do not count as slots.')
thread_slots = ', '.join(f'{p["id"]} at {p["slot_B_recommended"]["label_wib"]}' for p in POSTS if p['kind'] == 'thread')
_thread_hours = [dt.datetime.fromisoformat(p['slot_B_recommended']['wib']).hour for p in POSTS if p['kind'] == 'thread']
_awake = all(7 <= h < 23 for h in _thread_hours)
md.append('- Several slots fall at night in WIB (they are US daytime). Queue single posts with X\'s own scheduler in '
          'the web composer (Schedule) rather than staying up. X\'s scheduler does not take threads, so post the '
          f'threads by hand: {thread_slots}' + (' (all during WIB waking hours).' if _awake else
                                                '. Some of these fall at night in WIB: shift them by hand or swap them '
                                                'with a neighbouring single post.'))
md.append('')
md.append('| # | post | WIB | UTC | US Eastern |')
md.append('|---|---|---|---|---|')
for i, s in enumerate(calendar['cadence']['option_B_recommended']['slots'], 1):
    md.append(f'| {i} | {s["post"]} | {s["label_wib"]} | {s["utc"]} | {s["et"]} |')
md.append('')
md.append('### Option A (not recommended): every 15 minutes')
md.append('')
md.append(calendar['cadence']['option_A_every_15_min']['summary'])
md.append('')
md.append('Kept because it was asked for. Risks to weigh before choosing it:')
md.append('')
md.append(f'- The whole calendar ({n} posts, {sum(len(p["tweets"]) for p in POSTS)} individual posts counting the '
          f'threads) goes out in about {(sched_a[-1] - START).total_seconds() / 3600:.0f} hours from a new account, '
          f'by {sched_a[-1].strftime("%H:%M")} WIB on day one. Days 2 and 3 get nothing new unless more content is '
          f'made.')
md.append('- X\'s spam and platform-manipulation rules target high-volume, repetitive or link-heavy posting, and '
          'automated posting through tools has its own rules. A brand-new account posting every 15 minutes, most '
          'posts with the same domain link, is more likely to be rate-limited, shown to fewer people, labelled, or '
          'temporarily locked. X does not publish exact thresholds, so this is a risk, not a certainty.')
md.append('- Posts compete with each other: each new post pushes the previous one down before it collects early '
          'engagement, and most followers see only a few of them.')
md.append('- Six hours starting 16:00 WIB covers 05:00 to 10:45 EDT, so most of the US working day is missed.')
md.append('')
md.append('| # | post | WIB | UTC | US Eastern |')
md.append('|---|---|---|---|---|')
for i, s in enumerate(calendar['cadence']['option_A_every_15_min']['slots'], 1):
    md.append(f'| {i} | {s["post"]} | {s["label_wib"]} | {s["utc"]} | {s["et"]} |')
md.append('')
md.append('## Media coverage')
md.append('')
md.append('Every banner, screenshot, tutorial frame and promo video is used at least once, except the held and '
          'spare files listed below. Source captures in `out/video/captures/` are inputs to the promo video and are '
          'not posted.')
md.append('')
md.append('Held (do not post until the reason is fixed):')
md.append('')
md.extend([f'- `{k}`: {v}' for k, v in sorted(HELD.items())] or ['- none'])
md.append('')
md.append('Spare (fine to use, not in this calendar):')
md.append('')
md.extend(f'- `{k}`: {v}' for k, v in sorted(SPARE.items()))
md.append('')
missing = [k for k, v in RECS.items() if not v]
if missing:
    md.append(f'Recordings: none were found for {", ".join(missing)} when this was built (out/recordings held only '
              f'raw/lab-run-capture.json). Their posts (R01, R02, R03) keep their slots and carry fallback stills '
              f'until the script is re-run.')
    md.append('')
md.append('| media | used in |')
md.append('|---|---|')
for k, v in sorted(used.items()):
    md.append(f'| `{k}` | {", ".join(dict.fromkeys(v))} |')
md.append('')
md.append('## Regenerate')
md.append('')
md.append('```bash')
md.append('cd marketing && python3 scripts/posts/build_calendar.py')
md.append('```')
md.append('')
(DEST / 'calendar.md').write_text('\n'.join(md))

# ---------------------------------------------------------------------------- MANIFEST

manifest = [
    {
        'file': 'calendar.json',
        'kind': 'application/json',
        'size_bytes': (DEST / 'calendar.json').stat().st_size,
        'width': None, 'height': None,
        'what_it_shows': (f'Machine-readable X launch calendar for @reversintel: {n} posts in order (id, kind '
                          f'single/thread/quote, text, weighted character count, media paths, alt texts, thread '
                          f'posts, quote_url null for the three REA quote posts), two cadence options with WIB, UTC '
                          f'and US Eastern timestamps (cadence.default = option B), held and spare media, profile '
                          f'setup, media coverage and validation results.'),
        'alt_text': (f'JSON file listing {n} planned X posts for @reversintel with their text, attached media file '
                     f'paths and alt text, plus two posting schedules starting 12 October 2026 16:00 WIB.'),
    },
    {
        'file': 'calendar.md',
        'kind': 'text/markdown',
        'size_bytes': (DEST / 'calendar.md').stat().st_size,
        'width': None, 'height': None,
        'what_it_shows': ('Human-readable version of the calendar: review-before-posting checklist, honesty rules, '
                          'profile setup, a summary table, every post as a copy-paste text block with its media and '
                          'alt text, the CADENCE section with option B as the default (launch burst, then every 3-4 h '
                          'for 3 days) and option A (every 15 minutes, not recommended, with risks) as timestamp '
                          'tables, held and spare media, and a media coverage table.'),
        'alt_text': ('Markdown document with the @reversintel launch posts, each with copy-ready text, media file '
                     'names and alt text, followed by two posting schedules and a table of which image or video '
                     'appears in which post.'),
    },
]
(DEST / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')

# ---------------------------------------------------------------------------- report
print(f'posts: {n} ({sum(len(p["tweets"]) for p in POSTS)} individual posts incl. threads)')
for p in POSTS:
    print(f'  {p["id"]:32s} ' + ' '.join(str(t['weighted_chars']) for t in p['tweets'])
          + ('  [$REVERS]' if p['mentions_revers'] else '')
          + ('  [fallback]' if any(t['media_status'] == 'fallback' for t in p['tweets']) else ''))
print('recordings:', {k: (v['path'] if v else None) for k, v in RECS.items()})
print('warnings:', *WARNINGS, sep='\n  ')
print('errors:', *ERRORS, sep='\n  ')
sys.exit(1 if ERRORS else 0)
