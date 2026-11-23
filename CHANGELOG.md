# Changelog

Every change to the rough-cut agent gets an entry here, newest first, in the same commit as the change.

## 2026-11-23

### Added
- `tools/link_takes.py`: links each take's A cam, B cam and recorder clips in a `build_scrub.py` XML (FCP XML `<link>`), so Match Frame and edge drags reach the full source files.
- Rules: build the scrub on original files (not cleaned per-take copies) so Take Finder and Match Frame keep working; one camera clip per recorder file when lines repeat across files; date shoots from the recorder, not camera clocks.
- Rule: ffmpeg uses Apple's hardware encoder (VideoToolbox) for H.264/H.265 previews and upload copies, with measured
  speed-ups on an 8 GB M1 (2.8x on HEVC camera files), the ProRes limit on base M1 chips, the split-encode-join
  pattern for long renders (one or two pieces at a time on 8 GB), and a frame check on every hardware-encoded file.
- Rules: local Whisper drops repeated takes and crew talk (gap scan + re-transcribe), Scribe v2 on Melius is the most
  accurate transcript (text only, no timings), Gemini is not for long transcripts, Melius text answers cap and time
  out, so label without repeating the transcript. Measured costs included.

## 2026-11-19

### Added
- Rules from a fast review round (`rules-rough-cut-draft.md`):
  - Triage each note batch into edits the editor does by hand (with timecodes) and work the agent does.
  - Scripted ripples leave transitions behind; orphaned audio fades can silence a whole track. Find and fix them after every scripted shift, and check audio one track at a time.
  - Everything placed by script sits on whole frames, edges next to speed-changed clips are checked frame by frame, and cached frames are flushed after scripted edits so hand edits show at once.
  - On-screen number overlays: match the talent's pose between angles with pose detection, one font fit and one render per shot, every variable-font axis set, handles for hand trimming, shot and overlay nested together.
  - Export checks: In/Out on the main cut, pitch and level checked on speed-changed dialogue (nested mono voice can drop about 3 dB).
  - Colour labels for the current timeline, the main scrub and generated sequences.
- **Claude Adobe bridge v2** (`bridge/`). 26 new Premiere tools, each tested on a scratch project in Premiere Pro 27. Every v1 tool keeps its name, arguments and behaviour. Details and examples are in `bridge/README.md`.
  - Full-quality frames and WAVs with exact first frames and the In/Out and proxy setting put back. Source frames at the camera's own size, with the clip's effects.
  - Background jobs with progress, status and Cancel. The panel shows "Claude is editing" while it works.
  - Edits: ripple delete, insert gap, move range, exact clip placement (no audio spill onto other tracks, no empty tracks left), speed changes that ripple, marker moves.
  - Transitions go with their clips. When a script moves clips, Premiere leaves the transitions behind (the DOM move) or deletes them (the QE move), and an orphaned audio transition can silence its track. Every edit tool puts each transition back on its cut, removes the ones whose content was cut away, and lists what it did. `premiere_read_timeline` flags orphaned transitions and `premiere_transition` action `remove_orphans` removes them.
  - Many cuts in one edit: `premiere_ripple_delete_ranges` removes a whole list of ranges (given as the timeline is now) with one snapshot, moving each clip once (three ranges: 0.8 s instead of 2.0 s).
  - Audio fades that don't wreck the audio: `premiere_audio_fade` fades one clip, a list, or every audio edit in a range, with Volume keyframes from silence to the clip's own level or with Premiere's audio transitions. It handles the two Premiere traps that break fades written as one-off scripts: Volume values aren't percent (1 is +15 dB), and keyframe times are in source time (clip-relative times land outside the clip).
  - Effects: set a parameter by a friendly name (knows the Uniform Scale, Directional Blur and Offset traps), copy effects with keyframes in the right order and report what couldn't be copied, add and remove transitions.
  - Relink to a new file version without the Link Media popup; title cards as PNGs in any font.
  - Captions from word-level transcripts (SRT plus caption track, speaker labels), word search, and a bleep pass on a copy of the sequence (it adds an audio track to the copy for the tones when none is free).
  - Exact timecode everywhere (23.976 non-drop, drop-frame, sequences that start at 01:00:00:00).
  - Safety: a layout check that refuses an edit if that part of the timeline changed, a snapshot before multi-step edits, and errors that give the file, line and code.
- `install.sh`: backs up the installed bridge before every install (last 10 kept), `--rollback`, `--list-backups`, `--bridge-only`, and a self-check.
- Bridge tests: unit tests, tests of the Premiere-side code against a stand-in for Premiere, a v1 compatibility check, an ExtendScript lint, and an end-to-end Premiere test that only runs on a scratch project.

### Changed
- `CHANGES.md`: person and project names replaced with roles.

### Fixed
- `premiere_run_jsx`: a script that declared a variable called `ok` failed with "ok is not a function". Scripts now run in their own scope.
- The bridge's `call` command no longer cuts off long output.
- Bridge: snapshots and every other sequence the bridge creates (bleep copies, temporary render sequences, `premiere_build_sequence`) are labelled Magenta. A copy kept the original's colour label, so a snapshot looked exactly like the working timeline.
- Bridge, two projects open: the v2 tools now work in the project that holds the sequence (found by path among the open projects) instead of whichever project Premiere has in front. A new optional `project` argument (a .prproj path) picks the project when no sequence is named.

## 2026-11-18

### Fixed
- **Take Finder v18:** finds the right take from any child sequence, and does no background work.
  - The sequence list refreshes when you click into the panel (no timer), and Premiere is only polled while Follow is on.
  - A child pointing at the originals now matches a parent built from the proxies (or the other way round): it tries the exact media file first, then the same file name in any folder with any extension. Before, every conformed clip said "That clip's media isn't in the parent".
  - A clip left selected in the child no longer hijacks every lookup; a selection only counts when it is under the playhead.
  - The top visible clip under the playhead wins. Lower or switched-off clips and audio only count when the top clip's take is more than a second further off. Hidden tracks are skipped.

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
