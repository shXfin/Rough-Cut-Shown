#!/bin/bash
# install.sh: sets up the Claude Adobe bridge (Claude <-> Premiere Pro / After Effects) and the Take Finder panel on a Mac.
# Run from the repo folder:  ./install.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT="$HOME/Library/Application Support/Adobe/CEP/extensions"
BR="$HOME/.claude-adobe-bridge"

command -v node >/dev/null || { echo "Node.js is needed first: https://nodejs.org (or: brew install node)"; exit 1; }

# 1. MCP server Claude talks to, plus the shared secret the Premiere/AE panel checks
mkdir -p "$BR/bin"
cp "$HERE/bridge/server.mjs" "$BR/server.mjs"; chmod +x "$BR/server.mjs"
[ -f "$BR/token" ] || { openssl rand -hex 32 > "$BR/token"; chmod 600 "$BR/token"; echo "Made a new bridge token."; }
printf '#!/bin/bash\nexec "%s" "%s" "$@"\n' "$(command -v node)" "$BR/server.mjs" > "$BR/bin/adobe-bridge"; chmod +x "$BR/bin/adobe-bridge"

# 2. CEP panels: the bridge (runs the scripts inside the app) and Take Finder
mkdir -p "$EXT"
rm -rf "$EXT/com.shownmedia.claudebridge" "$EXT/com.shownmedia.takefinder"
cp -R "$HERE/bridge/cep/com.shownmedia.claudebridge" "$EXT/"
mkdir -p "$EXT/com.shownmedia.takefinder"; cp -R "$HERE/panel-takefinder/CSXS" "$HERE/panel-takefinder/index.html" "$EXT/com.shownmedia.takefinder/"

# 3. Unsigned panels need debug mode on
for v in 9 10 11 12; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done

echo
echo "Installed. Now:"
echo "  1. Add the bridge to Claude Code:  claude mcp add adobe-bridge -- \"$(command -v node)\" \"$BR/server.mjs\""
echo "  2. Restart Premiere Pro / After Effects, then open Window > Extensions > Claude Bridge (keep it open)"
echo "     and Window > Extensions > Take Finder."
