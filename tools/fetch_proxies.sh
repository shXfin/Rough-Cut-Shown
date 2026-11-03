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
  "$FF" -v error -y -i "$f" -vf "scale=-2:540,setsar=1" -c:v libx264 -preset veryfast -crf 26 -c:a aac -b:a 96k "$dst" </dev/null \
    && rm -f "$f" && echo "$CAM $name $(du -h "$dst" | cut -f1)"
done
rm -rf "$PROJ/proxies/_download/$CAM"
