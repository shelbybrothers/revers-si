#!/usr/bin/env python3
"""Turn raw captures (from screens-capture.mjs / screens-tutorial.mjs) into final X-ready images and a MANIFEST.json.

Usage: python3 scripts/screens-finish.py <jobs.json> <out_dir> [<out_dir_for_manifest_merge>]

Job kinds:
  desktop       raw 16:9 viewport capture (any size) -> 1600x900 PNG (JPG q90 if PNG > 5 MB)
  mobile-crop   raw 390x844@3x capture -> crop 4:5 window [cropTop, cropTop+cropH] (CSS px) -> 1080x1350 PNG
  mobile-phone  raw 390x844@3x capture -> whole phone screen framed on a 1080x1350 porcelain canvas
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter

CANVAS = (0xE1, 0xE6, 0xDF)
BORDER = (0xC9, 0xD3, 0xC6)
MAX_BYTES = 5 * 1024 * 1024


def save(img, path):
    img = img.convert('RGB')
    img.save(path, 'PNG', optimize=True)
    if os.path.getsize(path) > MAX_BYTES:
        os.remove(path)
        path = os.path.splitext(path)[0] + '.jpg'
        img.save(path, 'JPEG', quality=90, optimize=True, progressive=True)
    return path


def desktop(job):
    im = Image.open(job['raw']).convert('RGB')
    w, h = im.size
    # Raw is always 16:9 by construction; guard against rounding by center-cropping to 16:9.
    target = 16 / 9
    if abs(w / h - target) > 0.002:
        if w / h > target:
            nw = round(h * target)
            im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
        else:
            nh = round(w / target)
            im = im.crop((0, 0, w, nh))
    return im.resize((1600, 900), Image.LANCZOS)


def mobile_crop(job):
    im = Image.open(job['raw']).convert('RGB')
    scale = im.size[0] / 390.0
    top = round(job.get('cropTop', 0) * scale)
    hh = round(job['cropH'] * scale)
    im = im.crop((0, top, im.size[0], min(im.size[1], top + hh)))
    return im.resize((1080, 1350), Image.LANCZOS)


def rounded(im, radius):
    mask = Image.new('L', im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), radius=radius, fill=255)
    return mask


def mobile_phone(job):
    im = Image.open(job['raw']).convert('RGB')
    W, H = 1080, 1350
    margin = 56
    ph = H - 2 * margin
    pw = round(im.size[0] * ph / im.size[1])
    shot = im.resize((pw, ph), Image.LANCZOS)
    canvas = Image.new('RGB', (W, H), CANVAS)
    x, y = (W - pw) // 2, margin
    radius = 44
    # soft shadow
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle((x, y + 14, x + pw, y + ph + 14), radius=radius, fill=90)
    sh = sh.filter(ImageFilter.GaussianBlur(26))
    canvas.paste(Image.new('RGB', (W, H), (0x0F, 0x2A, 0x1E)), (0, 0), sh)
    # bezel
    bz = 10
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((x - bz, y - bz, x + pw + bz, y + ph + bz), radius=radius + bz, fill=(0x0F, 0x2A, 0x1E))
    canvas.paste(shot, (x, y), rounded(shot, radius))
    d.rounded_rectangle((x - bz, y - bz, x + pw + bz, y + ph + bz), radius=radius + bz, outline=BORDER, width=2)
    return canvas


def main():
    jobs_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    jobs = json.load(open(jobs_path))
    manifest_path = os.path.join(out_dir, 'MANIFEST.json')
    manifest = []
    for job in jobs:
        kind = job['kind']
        if kind == 'file':
            path = job['path']
            manifest.append({
                'file': os.path.basename(path),
                'kind': job.get('mime', 'application/octet-stream'),
                'size_bytes': os.path.getsize(path),
                'width': None,
                'height': None,
                'what_it_shows': job['what_it_shows'],
                'alt_text': job['alt_text'],
            })
            print(f"{os.path.basename(path):52s} file {os.path.getsize(path)} B")
            continue
        img = {'desktop': desktop, 'mobile-crop': mobile_crop, 'mobile-phone': mobile_phone}[kind](job)
        path = save(img, os.path.join(out_dir, job['out']))
        with Image.open(path) as chk:
            w, h = chk.size
        entry = {
            'file': os.path.basename(path),
            'kind': 'image/' + ('png' if path.endswith('.png') else 'jpeg'),
            'size_bytes': os.path.getsize(path),
            'width': w,
            'height': h,
            'what_it_shows': job['what_it_shows'],
            'alt_text': job['alt_text'],
        }
        assert len(entry['alt_text']) <= 1000, (entry['file'], len(entry['alt_text']))
        assert entry['size_bytes'] <= MAX_BYTES, entry['file']
        manifest.append(entry)
        print(f"{entry['file']:52s} {w}x{h} {entry['size_bytes']/1024:.0f} KB  alt={len(entry['alt_text'])}")
    json.dump(manifest, open(manifest_path, 'w'), indent=2, ensure_ascii=False)
    print('manifest ->', manifest_path, len(manifest))


if __name__ == '__main__':
    main()
