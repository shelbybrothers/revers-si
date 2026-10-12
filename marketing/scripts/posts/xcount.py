"""Weighted X (Twitter) post length, following twitter-text v3 rules closely enough for planning.

- Code points in 0-4351, 8192-8205, 8208-8223, 8242-8247 weigh 1; everything else (CJK, emoji, arrows) weighs 2.
- Every URL counts as 23. A bare domain with no path (e.g. `revers.si`) may or may not be autolinked by X,
  so it is counted as max(len, 23): the conservative upper bound.
- Text is NFC-normalised first, as twitter-text does.

`find_links()` also reports every token X could turn into a link (domain + known TLD), so accidental links such as
`tools.buy` (".buy" is a real TLD) are caught before posting.
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

URL_WEIGHT = 23
MAX_WEIGHTED = 280
_LIGHT = ((0, 4351), (8192, 8205), (8208, 8223), (8242, 8247))

_TLDS = {t.strip() for t in (Path(__file__).with_name('tlds.txt')).read_text().split() if t.strip()}

# scheme://... or label(.label)+.tld with optional :port and path. Labels: letters, digits, hyphen.
_URL_RE = re.compile(
    r'(?<![\w@$#/.-])'                     # not glued to a word, mention, cashtag, hashtag or path
    r'(?P<url>'
    r'(?:https?://)?'
    r'(?P<host>(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?P<tld>[a-z]{2,63}))'
    r'(?P<port>:\d{1,5})?'
    r'(?P<path>/[^\s]*)?'
    r')',
    re.IGNORECASE,
)
_TRAILING = '.,;:!?)]}"\''


def find_links(text: str):
    """Yield dicts {url, host, has_path, start, end} for every token X may autolink."""
    for m in _URL_RE.finditer(text):
        tld = m.group('tld').lower()
        if tld not in _TLDS:
            continue
        url = m.group('url')
        start, end = m.start('url'), m.end('url')
        while url and url[-1] in _TRAILING:   # trailing punctuation is not part of the link
            url = url[:-1]
            end -= 1
        has_path = bool(m.group('path')) and len(url) > len(m.group('host')) + (len(m.group('port') or ''))
        yield {
            'url': url,
            'host': m.group('host').lower(),
            'has_scheme': url.lower().startswith(('http://', 'https://')),
            'has_path': has_path,
            'start': start,
            'end': end,
        }


def _char_weight(ch: str) -> int:
    cp = ord(ch)
    for lo, hi in _LIGHT:
        if lo <= cp <= hi:
            return 1
    return 2


def weighted_length(text: str) -> int:
    text = unicodedata.normalize('NFC', text)
    links = list(find_links(text))
    total = 0
    i = 0
    for ln in links:
        total += sum(_char_weight(c) for c in text[i:ln['start']])
        raw = sum(_char_weight(c) for c in text[ln['start']:ln['end']])
        definite = ln['has_scheme'] or ln['has_path']
        total += URL_WEIGHT if definite else max(raw, URL_WEIGHT)
        i = ln['end']
    total += sum(_char_weight(c) for c in text[i:])
    return total


if __name__ == '__main__':
    import sys
    s = sys.stdin.read()
    print(weighted_length(s), [l['url'] for l in find_links(s)])
