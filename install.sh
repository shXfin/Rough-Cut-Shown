#!/bin/bash
# install.sh: sets up (or upgrades) the Claude Adobe bridge (Claude <-> Premiere Pro / After Effects) and the
# Take Finder panel on a Mac. Run from the repo folder.
#
#   ./install.sh                 install or upgrade everything (bridge + Take Finder)
#   ./install.sh --bridge-only   only the bridge (leaves Take Finder alone)
#   ./install.sh --rollback      put back the bridge from the most recent backup
#   ./install.sh --rollback <backup folder name>
#   ./install.sh --list-backups
#
# Every install backs up what's there first, to ~/.claude-adobe-bridge/backups/<date-time>/ (last 10 kept).
# Upgrading doesn't touch running Claude sessions: they keep the server they started with until Claude Code is
# restarted. The open Claude Bridge panel keeps running until Premiere restarts or the panel is reopened.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT="$HOME/Library/Application Support/Adobe/CEP/extensions"
BR="$HOME/.claude-adobe-bridge"
BACKUPS="$BR/backups"
PANEL="com.shownmedia.claudebridge"
TF="com.shownmedia.takefinder"

MODE=install
BRIDGE_ONLY=0
ROLLBACK_TO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bridge-only) BRIDGE_ONLY=1 ;;
    --rollback) MODE=rollback; if [ $# -gt 1 ] && [ "${2#--}" = "$2" ]; then ROLLBACK_TO="$2"; shift; fi ;;
    --list-backups) MODE=list ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)"; exit 1 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }

# ---------- backup / restore ----------
backup() {
  local dest="$BACKUPS/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$dest"
  local any=0
  for f in server.mjs bin v2 host config.json; do
    if [ -e "$BR/$f" ]; then cp -R "$BR/$f" "$dest/"; any=1; fi
  done
  if [ -d "$EXT/$PANEL" ]; then mkdir -p "$dest/cep"; cp -R "$EXT/$PANEL" "$dest/cep/"; any=1; fi
  if [ "$BRIDGE_ONLY" = 0 ] && [ -d "$EXT/$TF" ]; then mkdir -p "$dest/cep"; cp -R "$EXT/$TF" "$dest/cep/"; fi
  if [ "$any" = 0 ]; then rmdir "$dest" 2>/dev/null || true; return; fi
  { echo "backed up: $(date)"; echo "from repo: $HERE"; } > "$dest/BACKUP.txt"
  say "Backed up the current bridge to $dest"
  # keep the 10 newest
  local n; n=$(ls -1d "$BACKUPS"/*/ 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" -gt 10 ]; then ls -1d "$BACKUPS"/*/ | sort | head -n $((n - 10)) | while read -r old; do rm -rf "$old"; done; fi
}

latest_backup() { ls -1d "$BACKUPS"/*/ 2>/dev/null | sort | tail -n 1 | sed 's:/$::'; }

# Swap a folder in place: copy next to it, then rename (the old one is moved aside, then removed).
swap_dir() {
  local src="$1" dst="$2"
  local tmp="$dst.installing.$$" old="$dst.old.$$"
  rm -rf "$tmp"; cp -R "$src" "$tmp"
  if [ -e "$dst" ]; then mv "$dst" "$old"; fi
  mv "$tmp" "$dst"
  rm -rf "$old"
}

swap_file() {
  local src="$1" dst="$2"
  cp "$src" "$dst.installing.$$"; mv -f "$dst.installing.$$" "$dst"
}

if [ "$MODE" = list ]; then
  ls -1 "$BACKUPS" 2>/dev/null || say "No backups yet."
  exit 0
fi

if [ "$MODE" = rollback ]; then
  SRC="${ROLLBACK_TO:+$BACKUPS/$ROLLBACK_TO}"
  SRC="${SRC:-$(latest_backup)}"
  [ -n "$SRC" ] && [ -d "$SRC" ] || { say "No backup found in $BACKUPS."; exit 1; }
  say "Restoring the bridge from $SRC"
  [ -f "$SRC/server.mjs" ] && swap_file "$SRC/server.mjs" "$BR/server.mjs"
  [ -d "$SRC/bin" ] && swap_dir "$SRC/bin" "$BR/bin"
  for d in v2 host; do
    if [ -d "$SRC/$d" ]; then swap_dir "$SRC/$d" "$BR/$d"; else rm -rf "$BR/$d"; fi
  done
  if [ -f "$SRC/config.json" ]; then cp "$SRC/config.json" "$BR/config.json"; fi
  [ -d "$SRC/cep/$PANEL" ] && swap_dir "$SRC/cep/$PANEL" "$EXT/$PANEL"
  [ -d "$SRC/cep/$TF" ] && swap_dir "$SRC/cep/$TF" "$EXT/$TF"
  say "Rolled back to: $(/usr/bin/env node "$BR/server.mjs" version 2>/dev/null | head -n 1)"
  say "Restart Claude Code to use it; reopen the Claude Bridge panel (or restart Premiere) for the panel."
  exit 0
fi

# ---------- install / upgrade ----------
command -v node >/dev/null || { say "Node.js is needed first: https://nodejs.org (or: brew install node)"; exit 1; }
NODE="$(command -v node)"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || { say "Node.js 18 or newer is needed (found $("$NODE" --version))."; exit 1; }

# Check the new server loads before touching anything installed.
"$NODE" "$HERE/bridge/server.mjs" version | grep -q "v2 tools: loaded" || { say "The bridge in this repo doesn't load:"; "$NODE" "$HERE/bridge/server.mjs" version; exit 1; }

mkdir -p "$BR/bin" "$EXT"
backup

# 1. MCP server Claude talks to, its v2 tools and Premiere helpers, plus the shared secret the panel checks
swap_file "$HERE/bridge/server.mjs" "$BR/server.mjs"; chmod +x "$BR/server.mjs"
swap_dir "$HERE/bridge/v2" "$BR/v2"
swap_dir "$HERE/bridge/host" "$BR/host"
[ -f "$BR/token" ] || { openssl rand -hex 32 > "$BR/token"; chmod 600 "$BR/token"; say "Made a new bridge token."; }
printf '#!/bin/bash\nexec "%s" "%s" "$@"\n' "$NODE" "$BR/server.mjs" > "$BR/bin/adobe-bridge"; chmod +x "$BR/bin/adobe-bridge"

# ffmpeg/ffprobe paths (Claude Code may start the server with a shorter PATH than your shell)
FF="$(command -v ffmpeg || true)"; FP="$(command -v ffprobe || true)"
"$NODE" -e '
  const fs = require("fs"); const f = process.argv[1];
  let c = {}; try { c = JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  if (process.argv[2]) c.ffmpeg = process.argv[2];
  if (process.argv[3]) c.ffprobe = process.argv[3];
  fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
' "$BR/config.json" "$FF" "$FP"
[ -n "$FF" ] || say "Note: ffmpeg not found. Frames, WAV, bleeps and title cards need it (brew install ffmpeg), then re-run this."

# 2. CEP panels: the bridge (runs the scripts inside the app) and Take Finder
swap_dir "$HERE/bridge/cep/$PANEL" "$EXT/$PANEL"
if [ "$BRIDGE_ONLY" = 0 ]; then
  mkdir -p "$EXT/$TF.new.$$"; cp -R "$HERE/panel-takefinder/CSXS" "$HERE/panel-takefinder/index.html" "$EXT/$TF.new.$$/"
  swap_dir "$EXT/$TF.new.$$" "$EXT/$TF"; rm -rf "$EXT/$TF.new.$$"
fi

# 3. Unsigned panels need debug mode on (only written if not already set)
if [ -z "${CLAUDE_BRIDGE_SKIP_DEFAULTS:-}" ]; then
  for v in 9 10 11 12; do
    [ "$(defaults read "com.adobe.CSXS.$v" PlayerDebugMode 2>/dev/null || true)" = 1 ] || defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
  done
fi

# 4. Self-check of what was installed
say
say "Installed: $("$NODE" "$BR/server.mjs" version)"
say "  tools: $("$NODE" "$BR/server.mjs" tools | wc -l | tr -d ' ')  ·  ffmpeg: ${FF:-missing}"
say "  backups: $BACKUPS  (undo with: ./install.sh --rollback)"
say
if ! grep -q '"adobe-bridge"' "$HOME/.claude.json" 2>/dev/null; then
  say "Add the bridge to Claude Code:  claude mcp add adobe-bridge -- \"$NODE\" \"$BR/server.mjs\""
fi
say "Next:"
say "  - Restart Claude Code (or start a new session) to get the new tools. Sessions already running keep the old ones."
say "  - The Claude Bridge panel: reopen it (Window > Extensions > Claude Bridge) or restart Premiere for the new"
say "    status line and Cancel button. The new tools also work with the panel that's open now."
