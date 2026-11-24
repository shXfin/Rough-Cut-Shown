#!/bin/bash
# make_proxies.sh "<folder with camera originals>" <CAM name> <project folder>
# For shoots that are NOT on Aspect (footage came from Drive or a card): makes the same 540p proxies
# fetch_proxies.sh makes from Aspect, straight from the local originals (MXF, MP4, MOV), one file at a time
# so an 8 GB Mac stays usable. Shows "n of N" as it goes. Already made proxies are skipped, so it can be re-run.
# 540p is enough to find takes, sync and pick cameras; the final export always conforms to the originals.
set -u
SRC="$1"; CAM="$2"; PROJ="$3"
FF="${FF:-$(command -v ffmpeg || echo /Volumes/T7/work/ffbin/bin/ffmpeg)}"
OUT="$PROJ/proxies/$CAM"; mkdir -p "$OUT"
LIST=$(find "$SRC" -type f \( -iname "*.mxf" -o -iname "*.mp4" -o -iname "*.mov" \) ! -name "._*" | sort)
N=$(printf "%s\n" "$LIST" | grep -c .); i=0
printf "%s\n" "$LIST" | while read -r f; do
  [ -z "$f" ] && continue; i=$((i+1))
  name=$(basename "$f"); name="${name%.*}_proxy.mp4"; dst="$OUT/$name"
  [ -s "$dst" ] && { echo "[$i/$N] skip $name (done)"; continue; }
  echo "[$i/$N] $CAM $(basename "$f") ..."
  # Apple hardware H.264 (VideoToolbox), software fallback; keeps all audio channels' first pair for sync
  "$FF" -v error -stats -y -hwaccel videotoolbox -i "$f" -map 0:v:0 -map 0:a:0? \
    -vf "scale=-2:540,setsar=1" -c:v h264_videotoolbox -b:v 400k -maxrate 800k -bufsize 1600k -allow_sw 1 \
    -c:a aac -b:a 96k -ac 2 "$dst.part.mp4" </dev/null && mv "$dst.part.mp4" "$dst" && echo "[$i/$N] done $(du -h "$dst" | cut -f1)"
done
