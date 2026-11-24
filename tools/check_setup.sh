#!/bin/bash
# check_setup.sh [project folder]   -> read-only check that this Mac can run the rough-cut tools. Changes nothing.
# Prints OK / MISSING for each piece with the command that fixes it. Run it before the first project on a new machine.
# PY=/path/to/python overrides which Python the tools run with (default: python3).
HERE="$(cd "$(dirname "$0")/.." && pwd)"; PY="${PY:-python3}"; PROJ="${1:-}"; bad=0
ok()   { printf "  OK       %s\n" "$1"; }
miss() { printf "  MISSING  %s\n           fix: %s\n" "$1" "$2"; bad=$((bad+1)); }
echo "Machine: $(sysctl -n machdep.cpu.brand_string 2>/dev/null), $(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 )) GB RAM"
echo "Programs"
for c in git node ffmpeg ffprobe rclone; do
  if command -v $c >/dev/null; then ok "$c"; else miss "$c" "brew install $c"; fi
done
if command -v rclone >/dev/null; then
  if rclone listremotes 2>/dev/null | grep -qx "gdrive:"; then ok "rclone remote gdrive"; else miss "rclone remote gdrive" "rclone config  (new remote, name gdrive, type drive)"; fi
fi
echo "Python ($PY: $($PY --version 2>&1))"
for m in numpy rapidfuzz PIL faster_whisper whisperx mediapipe; do
  if "$PY" -c "import $m" 2>/dev/null; then ok "$m"; else
    pkg=$m; [ $m = PIL ] && pkg=pillow; [ $m = faster_whisper ] && pkg=faster-whisper
    miss "python package $m" "$PY -m pip install $pkg"; fi
done
echo "Files"
[ -s "$HERE/models/face_landmarker.task" ] && ok "face model (eyeline)" || miss "face model" "git pull (it ships in models/)"
[ -f "$HOME/.claude-adobe-bridge/server.mjs" ] && ok "Premiere bridge installed" || miss "Premiere bridge" "./install.sh"
if [ -f "$HOME/.claude-adobe-bridge/server.mjs" ] && ! cmp -s "$HERE/bridge/server.mjs" "$HOME/.claude-adobe-bridge/server.mjs"; then
  echo "  NOTE     installed bridge differs from this repo: run the v1 check, then ./install.sh (see bridge/README.md)"; fi
if [ -n "$PROJ" ]; then
  mkdir -p "$PROJ" 2>/dev/null
  free=$(df -k "$PROJ" | awk 'NR==2{print int($4/1048576)}'); echo "Space"
  [ "$free" -ge 170 ] && ok "$free GB free at $PROJ" || miss "only $free GB free at $PROJ (Stanley needs ~170)" "pick a bigger drive"
fi
echo; [ $bad = 0 ] && echo "All good." || echo "$bad thing(s) to fix above, then run this again."
