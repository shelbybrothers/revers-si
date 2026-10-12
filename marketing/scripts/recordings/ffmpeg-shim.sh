#!/bin/bash
# Stand-in for Playwright's bundled ffmpeg (recordVideo). Same arguments Playwright passes, except the VP8 bitrate
# cap (1M -> 16M), the quantizer ceiling (50 -> 18) and the thread count (1 -> 8), so small type stays legible
# in the intermediate .webm. Uses the system ffmpeg (FFMPEG_BIN, default /opt/homebrew/bin/ffmpeg).
out=(); prev=""
for x in "$@"; do
  y="$x"
  case "$prev" in
    -b:v) y=16M ;;
    -qmax) y=18 ;;
    -threads) y=8 ;;
  esac
  out+=("$y"); prev="$x"
done
exec "${FFMPEG_BIN:-/opt/homebrew/bin/ffmpeg}" "${out[@]}"
