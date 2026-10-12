"""Prepare brand assets for the banner HTML pages (reads web/public/brand read-only)."""
import random
import shutil
from pathlib import Path

from PIL import Image, ImageFilter

BRAND = Path('/Users/medikamedika/KOMET/web/public/brand')
OUT = Path(__file__).resolve().parent / 'assets'
OUT.mkdir(exist_ok=True)

# 1. Logo tiles, copied as-is.
for name in ['revers-512.png', 'revers-128.png', 'revers-630.jpg']:
    shutil.copy(BRAND / name, OUT / name)

# 2. Star cut-out with alpha (luminance key against the emerald ground).
src = Image.open(BRAND / 'revers-630.jpg').convert('RGB')
w, h = src.size
bg = (1, 105, 58)


def lum(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


lbg = lum(bg)
lo, hi = lbg + 10, lbg + 70  # ramp: anything 70+ brighter than the ground is fully opaque
px = src.load()
cut = Image.new('RGBA', (w, h))
cp = cut.load()
for y in range(h):
    for x in range(w):
        c = px[x, y]
        L = lum(c)
        a = 0.0 if L <= lo else 1.0 if L >= hi else (L - lo) / (hi - lo)
        if a <= 0:
            cp[x, y] = (0, 0, 0, 0)
            continue
        # un-mix the emerald ground so edges carry no green fringe
        r = [min(255, max(0, round((c[i] - (1 - a) * bg[i]) / a))) for i in range(3)]
        cp[x, y] = (r[0], r[1], r[2], round(a * 255))
bbox = cut.getbbox()
cut = cut.crop(bbox)
cut.save(OUT / 'star-cutout.png')
print('star cutout', cut.size, 'bbox', bbox)

# 3. Tileable grain (neutral, very low alpha; composited with mix-blend in CSS).
random.seed(7)
S = 240
g = Image.new('L', (S, S))
g.putdata([random.randint(0, 255) for _ in range(S * S)])
g = g.filter(ImageFilter.GaussianBlur(0.45))
grain = Image.merge('LA', (g, Image.new('L', (S, S), 255)))
grain.save(OUT / 'grain.png')
print('grain', grain.size)
