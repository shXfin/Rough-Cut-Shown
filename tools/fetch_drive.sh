#!/bin/bash
# fetch_drive.sh <drive folder id> "<sub folder or ''>" <local dest> [remote name, default gdrive]
# Downloads a Google Drive folder (shared drives too) with rclone and shows live progress in the terminal:
# percent done, GB done / total, speed and time left, refreshed every 5 s. Safe to stop with Ctrl+C and run again:
# files already complete are skipped, so it picks up where it left off.
# Needs: rclone with a Google Drive remote you set up yourself ("rclone config", type drive). No keys live in this repo.
set -u
ID="${1:?drive folder id}"; SUB="${2:-}"; DEST="${3:?local destination folder}"; REMOTE="${4:-gdrive}"
command -v rclone >/dev/null || { echo "rclone not installed: brew install rclone (or rclone.org/install)"; exit 1; }
rclone listremotes | grep -qx "$REMOTE:" || { echo "No rclone remote called '$REMOTE'. Run: rclone config  (new remote, type drive)"; exit 1; }
SRC="$REMOTE:$SUB"
echo "Measuring $SUB ..."
rclone size "$SRC" --drive-root-folder-id "$ID" 2>/dev/null | sed 's/^/  /'
NEED=$(rclone size "$SRC" --drive-root-folder-id "$ID" --json 2>/dev/null | sed -E 's/.*"bytes":([0-9]+).*/\1/')
mkdir -p "$DEST"
FREE=$(df -k "$DEST" | awk 'NR==2{print $4*1024}')
if [ -n "$NEED" ] && [ "$FREE" -lt "$NEED" ]; then
  echo "Not enough space on $(df -h "$DEST" | awk 'NR==2{print $NF}'): need $((NEED/1000000000)) GB, free $((FREE/1000000000)) GB"; exit 1
fi
echo "Downloading to $DEST (Ctrl+C to pause, run again to resume)"
rclone copy "$SRC" "$DEST" --drive-root-folder-id "$ID" \
  --progress --stats 5s --stats-one-line-date=false \
  --transfers 4 --checkers 8 --multi-thread-streams 4 \
  --retries 5 --low-level-retries 20 --exclude ".DS_Store"
echo "Done. Checking every file arrived ..."
rclone check "$SRC" "$DEST" --drive-root-folder-id "$ID" --size-only --one-way 2>&1 | tail -3
