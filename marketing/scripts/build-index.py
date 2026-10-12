#!/usr/bin/env python3
"""Write out/INDEX.md: a human-readable index of every asset in out/ plus the calendar summary.

Reads every out/<folder>/MANIFEST.json and out/posts/calendar.json, so run it after the other scripts:
    python3 scripts/build-index.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # .../marketing
OUT = ROOT / 'out'
FOLDERS = [
    ('banners', 'Banners and profile images', 'scripts/banners/render.mjs'),
    ('screens', 'Screenshots of the live site', 'scripts/screens-capture.mjs + scripts/screens-finish.py'),
    ('tutorial', 'Tutorial frames ("How to use revers.si")', 'scripts/screens-tutorial.mjs + scripts/screens-finish.py'),
    ('video', 'Promo video, posters and source captures', 'scripts/promo/render.mjs, capture-site.mjs, manifest.mjs'),
    ('recordings', 'Screen recordings', 'scripts/recordings/rec-lab-walkthrough.mjs, rec-terminal-replay.mjs, '
     'rec-wallet-check.mjs and manifest.mjs (raw run: scripts/capture-lab-run.mjs)'),
    ('posts', 'Post calendar', 'scripts/posts/build_calendar.py'),
]

# What changed in the review pass of 2026-10-12, and what was checked and left alone.
REVIEW_PASS = [
    ('REA wording (major)', 'One wording everywhere: "We used REA (open source, MIT, @reatools) while building '
     'revers.si. The lab now runs REA\'s static analysis on the agent file behind every failed reference-agent '
     'run." (Until the lab integrated REA the second sentence was "The lab\'s line-of-code attributions don\'t use '
     'REA yet.") Banner 07 (`banners/07-we-used-rea.png`), the credit frame (`tutorial/credit-we-used-rea.png`), '
     'tutorial step 4, desktop-12, mobile-08, desktop-16, T01 post 9, Q01 and Q02 carry the new wording; the '
     'promo video\'s REA scene reads "We used it while building revers.si". Hold them until '
     '`node scripts/check-live-rea.mjs` passes against the deployed site, then re-render. The calendar build fails '
     'on "inspired by", "built with REA" and on the stale "don\'t use REA yet" / "rea: not-run".'),
    ('Run-it-yourself steps (major)', 'Checked against the repo (contracts/out is gitignored; lab/src/world.ts '
     'loads ABIs before deploying). T01 post 5 and the step-05 caption now give the fresh-clone sequence with '
     'https://, cd, Node + Foundry and forge build; the step-05 frame outlines the forge build line. R02 says "about '
     '10 s once built (one run on our machine)".'),
    ('Contract address in step 8 (major)', 'Caption bar sets hex values in JetBrains Mono and turns Inter\'s calt '
     'off, so the address reads 0x326f... (zoom-checked). No other Inter caption had a digit-x-digit pattern; banners '
     'and the promo already set addresses in mono or had calt off.'),
    ('Promo end card (major)', 'Videos re-rendered (46.5 s): the end card now shows "$REVERS is a community token, '
     'not a Stock Token. Not investment advice." at 50 px (16:9) / 34 px (4:5) in white, with the contract on its own '
     'line, held about 4 s. P01 and F16 copy also say "Not financial advice." (P01 shortened to 277/280).'),
    ('Hero sentence (major)', 'The site was not changed (web is read-only here). The three hero screenshots are held '
     'out of the calendar; F14 uses banner 01, F15 the 16:9 poster + desktop-15, F12 the lab leaderboard instead of '
     'the hero phone; tutorial step 1 is re-framed on the "One sentence. Eight scenarios." section. (Superseded by '
     'the follow-up pass below: the site hero changed and the heroes are back.)'),
    ('$REVERS 4:5 crop (major)', '`screens/mobile-05-revers-token-phone.png` replaces the 4:5 crop: the whole phone '
     'screen, from the title through the risk line. The address still wraps onto two lines because that is how the '
     'live site lays it out at phone width.'),
    ('Token panel slice (minor)', '`screens/desktop-08-revers-token-panel.png` is now zoomed so the token section '
     'alone fills the frame; no part of the next dark band shows.'),
    ('Cut-off code (minor)', 'Captures let code blocks wrap (capture-only CSS) instead of scrolling sideways: '
     'desktop-12, step-04, mobile-08 (now cropped to end just below the code block), mobile-11 and the video\'s '
     'run-detail capture (its zoom/focus box is now measured from the page). F15 uses desktop-15 instead of '
     'mobile-11, which is kept as a spare.'),
    ('Blank first video frame (minor)', 'The logo lock-up is fully visible from frame 0 (luma std dev about 22, was '
     'about 4). Same encode settings: H.264 High, yuv420p, 30 fps, silent AAC, moov before mdat.'),
    ('4:5 video size (minor)', 'F16 now uses the 16:9 video; the 4:5 cut is a spare, and video/MANIFEST.json notes '
     'that 1080x1350 is outside the brief\'s X sizes. The calendar build now fails on any other video size.'),
    ('Recordings folder (minor)', '`recordings/MANIFEST.json` added (lists raw/lab-run-capture.json). R01 falls back '
     'to desktop-10 + desktop-12, R03 post 1 to desktop-13 (all 1600x900). (Superseded by the follow-up pass below: '
     'the three recordings exist now.)'),
    ('tutorial.md (minor)', 'The old thread copy is gone; tutorial.md points to posts/calendar.md T01 and lists '
     'the rendered captions.'),
    ('Hero phone crop (minor)', '`screens/mobile-01b-hero-phone.png` now shows the claude-haiku skipped row in full '
     '(it was held because of the hero sentence until the follow-up pass below).'),
    ('Poster alt text (minor)', 'Poster alt texts no longer claim the frame shows the task sentence; F02 picked up '
     'the corrected text.'),
    ('Cadence (minor)', 'Option B is the default (cadence.default); option A is listed second, as not recommended. '
     'Both use the new order: P01, F01, F02, then T01.'),
]


# Follow-up pass after the site's hero sentence changed (same day).
FOLLOW_UP = [
    ('Hero sentence', 'The live hero (and meta description) now says "revers.si replicates Robinhood Chain’s Stock '
     'Token mechanics, throws splits, ...". `screens/desktop-01-hero.png`, `mobile-01-hero-4x5.png` and '
     '`mobile-01b-hero-phone.png` were recaptured after the deploy with scripts/screens-capture.mjs (only these three '
     'replaced; the other screenshots were re-shot too and differed only by sub-pixel scroll offsets, so the reviewed '
     'files were kept). Nothing is held any more: desktop-01 is in F14, mobile-01b in F12 (with the lab leaderboard, '
     'wallet and picker), mobile-01 in F15 (with the scenarios crop; F15 no longer reuses the 16:9 poster and '
     'desktop-15, which stay in F02 and F09). No tutorial frame showed the hero, so none was re-shot.'),
    ('Recordings', 'Three 1920x1080 recordings in `recordings/` (H.264 High, yuv420p, 30 fps, silent AAC, '
     'faststart): `lab-walkthrough.mp4` (live site), `terminal-lab-run.mp4` (re-rendered replay of a real npm run lab '
     'captured 12 Oct 2026 08:44 UTC, labelled on screen, lines verbatim at real speed) and `wallet-check-demo.mp4` '
     '(simulated wallet on a public GME/USDG pool contract address, real Robinhood Chain reads, labelled on screen '
     'throughout). R01, R02 and R03 now use them; R03 post 2 picked up desktop-13. R01 copy says "two failing runs" '
     '(the video opens two). The calendar build now fails if a recording manifest stops confirming its on-screen '
     'label.'),
    ('Raw run', '`recordings/raw/lab-run-capture.json` was re-captured (10.8 s, exit 0; was 9.5 s earlier the same '
     'day), so R02\'s "about 10 s once built" still holds. web/public/data/results.json, which the run rewrites, was '
     'restored with git checkout.'),
]


def human(n: int) -> str:
    return f'{n / 1e6:.2f} MB' if n >= 1e6 else f'{n / 1e3:.0f} KB'


def dims(e: dict) -> str:
    if e.get('duration_s'):
        return f'{e["width"]}x{e["height"]}, {e["duration_s"]} s'
    if e.get('width'):
        return f'{e["width"]}x{e["height"]}'
    return '-'


def cell(t: str) -> str:
    return (t or '').replace('|', '\\|').replace('\n', ' ')


cal = json.loads((OUT / 'posts' / 'calendar.json').read_text())
held = {h['media']: h['why'] for h in cal.get('held_media', [])}
spare = {h['media']: h['why'] for h in cal.get('spare_media', [])}
used = cal.get('media_coverage', {})

md: list[str] = []
md.append('# revers.si launch media: index')
md.append('')
md.append(f'Generated {dt.datetime.now(dt.timezone(dt.timedelta(hours=7))).isoformat(timespec="seconds")} by '
          f'`scripts/build-index.py` from the MANIFEST.json in each folder and `posts/calendar.json`. Paths are '
          f'relative to `marketing/out/`. Nothing has been posted anywhere.')
md.append('')
md.append('Lab figures in these assets come from a deterministic replica of Robinhood Chain Stock Token mechanics on '
          'a local chain, with reference agents written for the lab. The Claude agent has not run (shown as skipped). '
          '$REVERS is a community token, not a Stock Token; nothing here is investment advice.')
md.append('')

# ------------------------------------------------------------------ calendar summary
posts = cal['posts']
b = cal['cadence']['option_B_recommended']
md.append('## Calendar summary')
md.append('')
md.append(f'- {len(posts)} posts ({sum(len(p.get("thread", [p])) for p in posts)} individual posts counting the two '
          f'threads) for @reversintel. Full copy, media and alt text: `posts/calendar.md`; machine-readable: '
          f'`posts/calendar.json`.')
md.append(f'- Default cadence: **option B**. {b["summary"].removeprefix("Default. ")}')
md.append(f'- Alternative: option A. {cal["cadence"]["option_A_every_15_min"]["summary"]}')
md.append(f'- Validation: {len(cal["validation"]["errors"])} errors, {len(cal["validation"]["warnings"])} warnings.')
recs = ', '.join(f'{k}: {v or "none yet (fallback stills)"}' for k, v in cal['recordings_found'].items())
md.append(f'- Recordings: {recs}.')
md.append('')
md.append('| # | post | kind | topic | option B (WIB) | media |')
md.append('|---|---|---|---|---|---|')
for p in posts:
    media = [m for t in p.get('thread', [p]) for m in t['media']]
    short = ', '.join(f'`{m.replace("out/", "", 1)}`' for m in dict.fromkeys(media))
    kind = p['kind'] + (' (pin)' if p['pin'] else '') + (' ($REVERS)' if p['mentions_revers'] else '')
    md.append(f'| {p["order"]} | {p["id"]} | {kind} | {cell(p["topic"])} | {p["slot_B_recommended"]["label_wib"]} | '
              f'{short} |')
md.append('')
md.append('Review before posting (from the calendar):')
md.append('')
md.extend(f'- {r}' for r in cal['review_before_posting'])
md.append('')

# ------------------------------------------------------------------ assets
md.append('## Assets')
md.append('')
md.append('Status: **used in** lists the calendar posts; **held** means do not post until the reason is fixed; '
          '**spare** means fine to use but not in the calendar.')
for folder, title, source in FOLDERS:
    mf = json.loads((OUT / folder / 'MANIFEST.json').read_text())
    items = mf['files'] if isinstance(mf, dict) else mf
    md.append('')
    md.append(f'### {title} (`{folder}/`)')
    md.append('')
    md.append(f'Made by {source}. Manifest: `{folder}/MANIFEST.json`.')
    if isinstance(mf, dict) and mf.get('notes'):
        md.append('')
        md.append(mf['notes'])
    md.append('')
    md.append('| file | size | dimensions | status | what it shows |')
    md.append('|---|---|---|---|---|')
    for e in items:
        rel = f'out/{folder}/{e["file"]}'
        if rel in held:
            status = '**held**: ' + held[rel]
        elif rel in spare:
            status = '**spare**: ' + spare[rel]
        elif rel in used:
            status = 'used in ' + ', '.join(dict.fromkeys(used[rel]))
        elif folder == 'video' and e['file'].startswith('captures/'):
            status = 'promo source capture (not posted)'
        elif folder in ('posts', 'recordings') or e['file'].endswith('.md'):
            status = 'document'
        else:
            status = 'not in calendar'
        md.append(f'| `{folder}/{e["file"]}` | {human(e["size_bytes"])} | {dims(e)} | {cell(status)} | '
                  f'{cell(e["what_it_shows"])} |')

# ------------------------------------------------------------------ any other output folder (e.g. made by another job)
known = {f for f, _, _ in FOLDERS} | {'_qa'}
for d in sorted(p for p in OUT.iterdir() if p.is_dir() and p.name not in known):
    md.append('')
    md.append(f'### Other folder: `{d.name}/`')
    md.append('')
    mfp = d / 'MANIFEST.json'
    if mfp.exists():
        mf = json.loads(mfp.read_text())
        items = mf['files'] if isinstance(mf, dict) else mf
        md.append(f'Not part of the calendar build. Manifest: `{d.name}/MANIFEST.json`.')
        md.append('')
        md.append('| file | size | dimensions | what it shows |')
        md.append('|---|---|---|---|')
        for e in items:
            md.append(f'| `{d.name}/{e["file"]}` | {human(e["size_bytes"])} | {dims(e)} | {cell(e.get("what_it_shows", ""))} |')
    else:
        md.append('No MANIFEST.json yet when this index was written (made outside the calendar build); files found:')
        md.append('')
        for f in sorted(x for x in d.rglob('*') if x.is_file() and x.name != '.DS_Store'):
            md.append(f'- `{f.relative_to(OUT)}` ({human(f.stat().st_size)})')

# ------------------------------------------------------------------ QA and superseded
md.append('')
md.append('### Review scratch (`_qa/`)')
md.append('')
md.append('Contact sheets, zoom checks and frame grabs made while reviewing. Not deliverables and never to be posted. '
          '`_qa/superseded/` keeps the files this review pass replaced, for comparison only:')
md.append('')
sup = OUT / '_qa' / 'superseded'
for p in sorted(sup.rglob('*')) if sup.exists() else []:
    if p.is_file() and p.name != '.DS_Store':
        md.append(f'- `{p.relative_to(OUT)}` ({human(p.stat().st_size)})')
md.append('')

# ------------------------------------------------------------------ review pass
md.append('## Review pass, 2026-10-12')
md.append('')
md.append('Every finding was checked against the files and the repo before changing anything; all of them held up.')
md.append('')
for k, v in REVIEW_PASS:
    md.append(f'- **{k}.** {v}')
md.append('')
md.append('## Follow-up pass, 2026-10-12 (after the hero deploy)')
md.append('')
for k, v in FOLLOW_UP:
    md.append(f'- **{k}.** {v}')
md.append('')
md.append('## Regenerate')
md.append('')
md.append('```bash')
md.append('cd marketing')
md.append('node scripts/banners/render.mjs                       # banners + banners/MANIFEST.json')
md.append('REVERS_RAW_DIR=/tmp/revers-raw node scripts/screens-capture.mjs')
md.append('python3 scripts/screens-finish.py /tmp/revers-raw/screens.jobs.json out/screens')
md.append('REVERS_RAW_DIR=/tmp/revers-raw node scripts/screens-tutorial.mjs')
md.append('python3 scripts/screens-finish.py /tmp/revers-raw/tutorial.jobs.json out/tutorial')
md.append('node scripts/promo/capture-site.mjs && node scripts/promo/render.mjs --format wide && node scripts/promo/render.mjs --format tall')
md.append('node scripts/promo/manifest.mjs')
md.append('node scripts/capture-lab-run.mjs && git -C .. checkout -- web/public/data/results.json  # real run for R02')
md.append('node scripts/recordings/rec-lab-walkthrough.mjs && node scripts/recordings/rec-terminal-replay.mjs && node scripts/recordings/rec-wallet-check.mjs')
md.append('node scripts/recordings/manifest.mjs')
md.append('python3 scripts/posts/build_calendar.py')
md.append('python3 scripts/build-index.py')
md.append('```')
md.append('')
(OUT / 'INDEX.md').write_text('\n'.join(md))
print('wrote', OUT / 'INDEX.md', len(md), 'lines')
