"""Cut the porcelain-jade star out of the emerald logo tile (web/public/brand/revers-512.png)
so the promo can animate the mark on its own. Output: scripts/promo/assets/star.png (RGBA)."""
import sys
from PIL import Image, ImageFilter
import numpy as np

src, dst = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
h, w, _ = im.shape
border = np.concatenate([im[:8].reshape(-1, 3), im[-8:].reshape(-1, 3), im[:, :8].reshape(-1, 3), im[:, -8:].reshape(-1, 3)])
bg = np.median(border, axis=0)
lum = im @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
bl = float(bg @ np.array([0.299, 0.587, 0.114]))
a = np.clip((lum - bl - 18) / 60.0, 0, 1)
# smooth the matte edge a touch
am = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))
a = np.asarray(am).astype(np.float32) / 255.0
# un-premultiply against the background so edges do not carry a green fringe
safe = np.maximum(a, 1e-3)[..., None]
rgb = np.clip((im - bg * (1 - a[..., None])) / safe, 0, 255)
out = np.dstack([rgb, a * 255]).astype(np.uint8)
img = Image.fromarray(out, 'RGBA')
bbox = img.getbbox()
pad = 12
img = img.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(w, bbox[2] + pad), min(h, bbox[3] + pad)))
img.save(dst)
print('bg', bg, 'size', img.size)
