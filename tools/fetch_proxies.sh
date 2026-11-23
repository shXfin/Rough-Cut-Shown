#!/bin/bash
# fetch_proxies.sh "<Aspect path>" <CAM name> <project folder>
# Pulls Aspect's own stream proxies for one camera folder (read-only on Aspect), then shrinks each to
# 540p and deletes the 1080p download, so a 2-hour shoot costs ~1 GB on the T7 instead of ~2 GB.
# 540p is enough to find takes, sync and pick cameras; the final export always conforms to the originals.
set -u
SRC="$1"; CAM="$2"; PROJ="$3"
FF=/Volumes/T7/work/ffbin/bin/ffmpeg
DL="$PROJ/proxies/_download/$CAM"; OUT="$PROJ/proxies/$CAM"
mkdir -p "$DL" "$OUT"
aspect download "$SRC" "$DL" --variant stream_proxy || exit 1
find "$DL" -type f -iname "*.mp4" | while read -r f; do
  name=$(basename "$f"); name="${name%.*}"; name="${name%_proxy}_proxy.mp4"
  dst="$OUT/$name"
  [ -s "$dst" ] && { rm -f "$f"; continue; }
  # Apple hardware H.264 (VideoToolbox), ~2.6x faster than libx264; -allow_sw 1 falls back to software where there is no chip
  "$FF" -v error -y -hwaccel videotoolbox -i "$f" -vf "scale=-2:540,setsar=1" -c:v h264_videotoolbox -b:v 400k -maxrate 800k -bufsize 1600k -allow_sw 1 -c:a aac -b:a 96k "$dst" </dev/null \
    && rm -f "$f" && echo "$CAM $name $(du -h "$dst" | cut -f1)"
done
rm -rf "$PROJ/proxies/_download/$CAM"
