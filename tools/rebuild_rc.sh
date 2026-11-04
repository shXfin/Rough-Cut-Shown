#!/bin/bash
# rebuild_rc.sh work_dir Client   -> the rough cut rebuilt with your Take Finder choices, back in Premiere
# Run by "Rebuild rough cut" in the Take Finder panel (through <work>/Rebuild rough cut.command). Keeps the scrub as is.
set -e
W="$1"; C="${2:?usage: rebuild_rc.sh work_dir ProjectName}"; c=$(echo "$C" | tr '[:upper:]' '[:lower:]'); CU=$(echo "$C" | tr '[:lower:]' '[:upper:]')
T="$(cd "$(dirname "$0")" && pwd)"; PY=/Volumes/T7/work/whisperx-env/bin/python
export PATH=/Volumes/T7/work/irl-retrenchment/_tools:$PATH
RCSEQ="$CU REVIEW 1 - Rough cut (picked takes)"; SCSEQ="$CU REVIEW 2 - Scrub (every take, A and B side by side)"
cd "$W"
# the Take Finder shows a red "rebuilding, hold your edits" banner while this file exists
mkdir -p ~/.shown; echo "{\"seq\": \"$RCSEQ\", \"since\": \"$(date +%H:%M)\"}" > ~/.shown/busy.json; trap 'rm -f ~/.shown/busy.json' EXIT
echo "1/6  Reading your edits in Premiere (swaps, trims, deleted lines)"; $PY "$T/hand_edits.py" "$W" "$RCSEQ"
echo "2/6  Picking takes, your choices first";            cp picks.json picks_before_swap.json; $PY "$T/pick.py" "$W/takes.json" "$W/picks.json" >/dev/null
echo "3/6  Building the rough cut with clean sound";      BAKE=1 $PY "$T/build_scrub.py" "$W" "$W/${c}_RC_clean.xml" --rough-cut | grep -v "^{" || true
echo "4/6  Checking it against the script";               $PY "$T/script_check.py" "$W" "$W/${c}_RC_clean.xml" 2>/dev/null | tail -3
if ! $PY "$T/hand_edits.py" "$W" "$RCSEQ" --check "$(cat ~/.shown/live.sig)"; then   # you edited while it was building
  echo; echo "STOPPED: you edited $RCSEQ while this was building, so nothing was replaced."
  echo "Press Rebuild again: it reads your new edits first."; exit 3; fi
echo "5/6  Into Premiere (the old one waits in Sequences/Old)"; BACKUP=1 $PY "$T/ppro_swap.py" "$C/Sequences" "$RCSEQ" "$W/${c}_RC_clean.xml"
echo "6/6  Updating scrub tags and the Take Finder";      $PY "$T/ppro_markers.py" "$W" "$SCSEQ"; $PY "$T/panel_data.py" "$W" "$C"
echo; echo "Done. The Take Finder reloads by itself."
