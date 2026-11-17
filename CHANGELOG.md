# Changelog

Every change to the rough-cut agent gets an entry here, newest first, in the same commit as the change.

## 2026-11-18

### Added
- Rules for export prep:
  - grade on the originals, not only on proxies
  - point the timeline at the originals before export (attach them to the proxy items)
  - measured white-studio grade targets
  - one grade per camera body
  - Directional Blur on slowed whips
  - check B-roll windows at 1 frame per second
- Hard rule for writing rules: general principles only, project details only as labelled examples, no names.

### Changed
- The 2026-11-17 rules rewritten to work on any project: cut away when an off-screen voice speaks; on-screen clocks and timers run forward; alternates in-line; real recordings replace temp voices; lines over speed-ramped transitions.

## 2026-11-17

### Added
- **Take Finder v15:** works on any project with no per-project data.
  - You pick the parent (full scrub) and the child (Best 3 or rough cut) from the project's sequences. It needs two or more, and the choice is remembered per project.
  - A clip in the child is matched to the parent by media file and source time (speed-changed clips included).
  - "Show all takes" jumps the parent to that spot and lists every take of the line from its label clips. "Back to child" and "Follow" are there too.
  - The old project-data panel is kept in `panel-takefinder/legacy/`.
- `bridge/`: the Claude Adobe bridge (MCP server and the Premiere/After Effects panel). The token is never committed.
- `install.sh`: one-step Mac install of the bridge and Take Finder (token, CEP panels, debug mode, Claude Code command).
- README: install and Take Finder sections, with no client names.

### Rules
- Rules from the editor's rough cut v1 review in `rules-rough-cut-draft.md`:
  - cut away when an off-screen voice speaks
  - on-screen clocks and timers run forward across cuts
  - alternates in-line with a "who asked" label
  - legal-risk moments labelled
  - real recordings replace temp voices
  - one take per line in the rough cut, with the scrubs kept as backups
  - whip-to-whip transitions matched by measured direction
  - back up and diff the editor's sequence before every round
  - lines over speed-ramped transitions
  - one take for a monologue

## 2026-11-16

### Changed
- Review labels: approved design. A yellow pick badge ("2/3") sits next to a two-line box ("CAM A - HOOK 1" / "Line 1   take 14   OWN WORDS"), colored by take type and never cut off. Rules in `rules-rough-cut-draft.md`, drawn by `build_scrub.py`.
- Take Finder:
  - follows raw recorder audio by recording time: words per take in the data, plus camera audio through sync offsets;
  - a clicked clip resolves by its source time, not its file name;
  - nearest-take fallback for hand-extended pieces;
  - follows any hand-edited sequence's positions (`RC_XML_LIVE`).
- `build_scrub.py`: AI voice pieces (`FO_DIR`, `FO_ONLY`), per-take `end` overrides from KEEP, tags from `take_tags.json`.

## 2026-11-10 (Concurrence)

### Added
- `tools/sync_check.py`: lip sync check on the live edit. It compares each picture clip's camera audio with the lav under it and flags anything off by more than 60 ms.
- `tools/audio_ear.py`: an "ear" for dialogue. It reports loudness (LUFS), peak and DNSMOS speech quality (SIG/BAK) per line on the mix exported from Premiere, and dSIG against the untouched recorder shows where processing hurt a line.
- `tools/tf_sync.py`: syncs the Take Finder with the live rough cut (clip names, line positions, picks, word timings).
- `polish.unmuffle`: lifts the top end back only where the lav goes dull when the talent moves.
- `polish.desibilance`: frame-by-frame de-esser for s/t/sh sounds after the top end is lifted.
- AI agent voices: Melius ElevenLabs v3, one voice, made from the script text, phone-speaker version, full-length WAV on its own track with a Rose label.
- Take Finder v8 to v14:
  - Premiere-style look
  - search bar with Cancel and a list of all lines
  - "Follows" switch for the sequence it tracks
  - the playing take turns green, with a live word highlight
  - × to drop pending swaps
  - takes scroll in their own area
  - native dropdowns replaced with plain lists
  - follows raw recorder clips
  - skips switched-off clips and camera audio

### Changed
- Sound default for a clean indoor lav: the raw recorder audio, one measured clip-volume number per line (about -18 LUFS), and a Hard Limiter as the last effect (-6 dBFS ceiling). The heavy chain is only for takes with real problems, A/B'd against raw.
- Bake chain: limiter at -1 dBFS (attack 6 ms) and compressor 2.5:1 (knee 8), so loud syllables stop crunching.
- Cam A only now means A on top with B kept under it on V1. A clips are never left switched off.
- `ppro_relink.py` accepts `[path, handle]` map values.

### Fixed
- Take Finder jumped to the wrong spots and stopped following after relinks (stale positions, unknown clip names).
- AI voice mp3s played short in Premiere (L30 "every day" was clipped).

### Rules added (rules-rough-cut-draft.md)
- Hidden crew reads inside takes: found from lav level, not the transcript.
- Hesitations Whisper hides: found from overlong words.
- Measure sync, don't trust the pairing.
- Placing and naming AI voices.
- Dialogue level best practice: peaks -6 to -10 dBFS, deliver about -16 LUFS / -1 dBTP.
- ExtendScript gotchas: `move()` takes seconds, setting `start` does not trim the head, markers take numbers, `ok` is reserved, no `Array.indexOf`, and steps before a mid-script error have already run.
- Main sound is always the wireless lav, never the cameras.

## 2026-11-09 (Concurrence)
- Rules:
  - when to cut to cam B
  - drop weak text-sync pairings
  - alternative demo versions
  - rough cut picks need A cam, with editor-pick reference and section markers
  - scene continuity
  - drive link speed and Resolve proxy settings
- Take Finder: one data file per project, never shows another project's takes, thumbnails from proxies for camera RAW.
