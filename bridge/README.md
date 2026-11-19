# Claude Adobe Bridge

Lets Claude (Claude Code or the desktop app) read and edit Premiere Pro and After Effects projects on your Mac.

## How it works

```
Claude ──(MCP, on your Mac)──> server.mjs ──(http://127.0.0.1, secret token)──> Claude Bridge panel ──> ExtendScript in Premiere / AE
```

- **`server.mjs`** is a small Node program Claude starts. It turns tool calls ("render these frames", "ripple delete 4-6 s") into scripts.
- **The Claude Bridge panel** (Window > Extensions > Claude Bridge) runs inside Premiere or After Effects and executes those scripts. It only listens on 127.0.0.1, and only answers calls carrying the token in `~/.claude-adobe-bridge/token`.
- **Everything stays on your Mac.** The bridge itself needs no internet. Claude does: it is the one deciding which tools to call.
- **ffmpeg** (optional, `brew install ffmpeg`) cuts stills and WAVs out of renders and draws title cards.

Version 2 adds 24 tools. Every version 1 tool keeps its name, arguments and behaviour; `test/v1-compat.mjs` checks this.

## Install, upgrade, roll back

```bash
./install.sh
```

From the repo folder. It:
1. checks the new server loads;
2. backs up whatever is installed to `~/.claude-adobe-bridge/backups/<date-time>/` (the last 10 are kept);
3. installs the server, its v2 tools and the Premiere helpers to `~/.claude-adobe-bridge/`, keeps your token (or makes one), and writes the ffmpeg location to `config.json`;
4. installs the panel (and Take Finder, unless you pass `--bridge-only`) and turns on debug mode for unsigned panels;
5. prints a self-check.

```bash
./install.sh --bridge-only
```

Upgrades only the bridge and leaves Take Finder alone.

```bash
./install.sh --rollback
```

Puts back the most recent backup. `./install.sh --list-backups` lists them, and `./install.sh --rollback <name>` restores a specific one.

**After installing:**
- **Claude:** sessions that are already running keep the old server. Restart Claude Code (or start a new session) to get the new tools.
- **Panel:** the panel that's open keeps running the old version until you reopen it (Window > Extensions > Claude Bridge) or restart Premiere. The v2 tools work with the old panel too; reopening adds the "Claude is editing" line and the Cancel button.

`adobe_status` shows the server version, whether the v2 tools loaded, the panel version, ffmpeg, and whether proxies are on.

From a terminal, `~/.claude-adobe-bridge/bin/adobe-bridge` gives:
- `ping`, `version` and `tools`;
- `eval ppro "<code>"`;
- `call <tool> '<json>'`, which runs one tool, the same as Claude would.

## Times

Every v2 tool accepts a time in any of these forms:

| Form | Meaning |
|---|---|
| `12.5` | seconds from the sequence start |
| `"12.5s"` | seconds |
| `"300f"` | frame 300 |
| `"00:00:12:12"` | timecode, exactly as Premiere shows it |
| `"123t"` | Premiere ticks (254016000000 per second) |

**23.976 (non-drop):** timecode counts 24 frames per "second", but each real second is 1.001 s long. So `00:01:00:00` is frame 1440 = **60.06 s**, not 60 s. Seconds that fall between frames snap to the nearest frame. `premiere_timecode` shows any conversion. 29.97/59.94 drop-frame and sequences starting at `01:00:00:00` are handled too.

**Results:** every v2 result gives timecode and seconds side by side.

## Safety

- **Layout check.** `premiere_read_timeline` returns a `layout_token`. Pass it as `expect_layout` to an edit. If anything in that part of the timeline changed since it was read (you trimmed a clip meanwhile), the edit is refused and nothing is changed.
- **Snapshots.** Multi-step edits (ripple delete, insert, move, speed, insert-placement) first save a copy of the sequence in the **Claude snapshots** bin, named like `Main edit - before ripple delete 14:02:11`. Pass `snapshot: false` to skip it.
- **No automatic undo.** On Premiere 27 some script changes never reach the undo stack (a clip's enabled state), and one `undo()` can step back two actions. Undoing automatically could therefore revert your own last edit, so the bridge never does it. Edits check everything they can before changing anything. If one still fails partway, the error lists what was already done and names the snapshot.
- **Errors say where.** A script error gives the file, the line number and the line of code, plus what had already happened.
- **Claude is editing.** While Claude edits or runs a job, the panel shows "Claude is editing: …" with a progress bar and a **Cancel** button.
- **Long work runs as jobs.** Long work (renders over 30 s, bleep passes, long script lists) runs in short steps with pauses, so Premiere stays usable. Cancelling stops it before the next step.

## Tools

The v1 tools work as before:
- Premiere: `adobe_status`, `premiere_get_project`, `premiere_get_sequence`, `premiere_open_project`, `premiere_open_sequence`, `premiere_import`, `premiere_build_sequence`, `premiere_add_markers`, `premiere_set_playhead`, `premiere_export_frame`, `premiere_export`, `premiere_save`, `premiere_run_jsx`.
- After Effects: the `ae_*` tools.

`premiere_run_jsx` now runs each script in its own scope (a script may use any variable name) and reports errors with the line.

The v2 tools are below. Every example is only an example: the paths, names and times are made up. `sequence_id` is optional everywhere and defaults to the active sequence. A **clip** is `{ "track": "V1", "at": 12.5 }` (the clip under that time), `{ "track": "A2", "index": 0 }` or `{ "node_id": "000f4245" }`.

### Reading

#### premiere_timecode
Converts times exactly as Premiere shows them.
```json
{ "values": [60.06, "00:01:00:00", "1440f"] }
```

#### premiere_read_timeline
Reads every track, clip, transition and marker of a sequence (or one range of it), and returns the `layout_token` for edits.
- **Clips:** each one has its source in/out in real source seconds, even when its speed has been changed.
- **Tracks:** a track gets a warning if its clips are out of order inside Premiere (see "Premiere 27 facts").
- **Orphaned transitions:** a transition that sits on no clip edge (left behind by a scripted move, for example by an older script) is marked `orphan` and its track gets a `transition_warning`. Remove them with `premiere_transition` action `remove_orphans`.
```json
{ "start": "00:01:00:00", "end": "00:02:00:00" }
```

#### premiere_snapshot
Saves a copy of a sequence in **Claude snapshots** before you run a hand-written script.
```json
{ "label": "tighten act 2" }
```

### Frames and audio

#### premiere_render_frames
Full-quality stills, rendered at full resolution. The Program monitor's soft preview isn't used.
- **How:** it renders through a ProRes 422 HQ preset, then cuts PNGs with ffmpeg. A WAV of the range is optional.
- **Frame-exact:** the sequence In/Out are set mid-frame, so the first frame is exact.
- **Restores your settings:** In/Out go back exactly as they were (including "not set"), and so does the proxy setting. Proxies are switched off for the render, and the result says which media each clip used.
- **Clean plates:** `mute_tracks` hides tracks for this render only.
- **Long ranges:** ranges over 30 s go through Media Encoder as a job.
```json
{ "times": ["00:00:05:00", 25.5], "preview": 1 }
{ "start": "00:00:02:00", "end": "00:00:03:23", "wav": true, "step_frames": 12, "mute_tracks": ["V3"] }
```

#### premiere_render_source
A timeline clip's own source at native size and frame rate (for example 2560×1440 in a 1080p sequence), with the clip's effects copied on (Lumetri etc.).
- **How:** it builds a temporary sequence, renders it, then deletes it.
- **Times:** give sequence times inside the clip, or `source_seconds`.
```json
{ "clip": { "track": "V2", "at": 6 }, "times": ["00:00:06:00"] }
```

### Jobs

#### premiere_job_start / premiere_job_status / premiere_job_cancel
Runs a list of short scripts as a background job.
- **When something fails:** it stops at the first failing step and reports the line.
- **Snapshot:** `snapshot_sequence` saves a copy first.
- **Waiting:** `premiere_job_status` with `wait_s` waits for the job (up to 50 s per call).
```json
{ "steps": [ { "label": "count", "script": "app.project.sequences.numSequences" } ], "snapshot_sequence": "Main edit" }
```

### Edits

**Transitions go with their clips.** Premiere doesn't move transitions when a script moves clips (see "Premiere 27 facts"), so every edit tool here records each transition and the cut it sits on, and puts it back on that cut afterwards:
- **Shifted clip:** the transition is moved by the same amount.
- **Cut away:** a transition whose side of the cut was removed is deleted, not left behind.
- **Deleted by Premiere:** it is added again with the same name, length and alignment.

The result lists what was done under `transitions`, and anything that couldn't be fixed under `NOT_FIXED`.

#### premiere_ripple_delete
Removes a range from every unlocked track and closes the gap (like Extract).
- **Locked tracks:** it refuses if a locked track would go out of sync.
- **Markers:** markers after the cut move with it.
```json
{ "start": "00:00:04:00", "end": "00:00:06:00", "expect_layout": "<token>" }
```

#### premiere_ripple_delete_ranges
Removes many ranges in **one** edit: all the pauses, flubs and bad takes of a cut at once.
- **Times:** give every range as the timeline is now. You don't work out where things land after each cut.
- **Faster:** one snapshot and one layout check for the whole list. Each clip after the first cut moves once, straight to its final place, instead of once per range.
- **Overlaps:** ranges that overlap or touch are joined.
- **Markers:** markers after a cut follow it; a marker inside a removed range goes to that cut.
- **Clip order:** no clip is moved past another, so later scripted cuts keep working on every track.
- **Speed:** on the scratch test, three ranges took 0.8 s in one call against 2.0 s as three separate ripple deletes, with the same result. The gain grows with the number of ranges.
```json
{ "ranges": [ { "start": 1, "end": 2 }, { "start": "00:00:11:00", "end": "00:00:12:12" }, { "start": 24, "end": 25 } ] }
```

#### premiere_insert_gap
Opens a gap at a point and pushes everything after it right.
- **Tracks:** every unlocked track, or only the ones you list.
```json
{ "at": 4, "duration": "48f" }
```

#### premiere_move_range
Moves a range to another point and closes the hole, with sync kept. `to` is a time in the timeline as it is before the move.
- **Active sequence:** the moved pieces pass other clips, which only Premiere's own move does without jumbling the track (see "Premiere 27 facts"), so the sequence must be open in the Timeline. The tool checks this before it changes anything.
```json
{ "start": 20, "end": 22, "to": 2 }
```

#### premiere_place_clip
Puts an exact source range at an exact time.
- **Exact source in:** Premiere snaps source marks to whole frames. The tool checks the result and slips it back to the exact source in.
- **No spill:** every other track is locked while it places the clip, so a camera clip with four audio channels can't overwrite other audio tracks.
- **Clean up:** extra channel clips are removed, and so are any empty tracks Premiere added for them.
- **Insert mode:** `mode: "insert"` makes room first.
```json
{ "source": { "path": "~/Footage/interview_A.mov" }, "src_in": 2.5, "src_out": 6.5, "at": 5, "video_track": "V2" }
```

#### premiere_set_speed
Changes a clip's speed and makes room for it, or closes up, so the same source still plays.
- **ripple:** `sequence` (the default) moves everything after the clip on every track; `track` moves only this clip's track and its linked audio; `none` lets the clip stop at the next clip.
- **Linked audio** follows unless `include_linked` is false.
```json
{ "clip": { "track": "V1", "at": 12 }, "speed": "50%", "ripple": "sequence" }
```

#### premiere_move_markers
Moves sequence markers by an amount: all of them, those in a time range, or those whose name contains a word.
```json
{ "delta": "+12f", "names": ["chapter"] }
```

### Effects

#### premiere_list_effects
Lists a clip's effects and every parameter with its value (and whether it's keyframed).

#### premiere_set_effect_param
Sets one parameter by a friendly name and checks it changed.
- **Traps it knows:**
  - Transform with Uniform Scale on only scales with **Scale Height**; Scale Width then does nothing, which shows as black edges. A Transform added by script starts with Uniform Scale off.
  - Motion uses Scale when uniform.
  - Directional Blur's parameter names differ by version: Direction or Angle, Blur Length or Amount.
  - Offset wraps the frame around, which shows as a seam on gradients.
- **Volume:** give it in dB with `unit: "db"`.
- **Keyframes:** `clip_time` (seconds from the clip's start) sets a keyframe instead of a value.
```json
{ "clip": { "track": "V1", "at": 1 }, "effect": "Lumetri", "param": "exposure", "value": 0.5, "add_if_missing": true }
{ "clip": { "track": "A1", "at": 1 }, "effect": "Volume", "param": "level", "value": -6, "unit": "db", "clip_time": 0.5 }
```

#### premiere_copy_effects
Copies effects to other clips, like Paste Attributes.
- **Keyframes:** copied to the same place from each clip's start; speed-changed clips are handled.
- **Order:** copied effects keep the source's order.
- **What didn't copy:** the result lists every parameter that couldn't be copied. Use Edit > Paste Attributes for those.
- **Limits:** keyframe interpolation (bezier or hold) can't be read by script, so copied keyframes use Premiere's default.
```json
{ "from": { "track": "V1", "at": 1 }, "to": [ { "track": "V1", "at": 30 } ] }
```

#### premiere_transition
Adds, lists or removes a transition at a clip's start or end.
- **Defaults:** Cross Dissolve for video, Constant Power for audio, 12 frames.
- **Remove:** if Premiere refuses to remove one by script, the tool says so.
- **Orphans:** `action: "remove_orphans"` (no clip needed) removes every transition that sits on no clip edge, on all tracks or the ones in `tracks`. A snapshot is saved first. Transitions on a clip edge are kept.
```json
{ "clip": { "track": "V1", "at": 1 }, "action": "add", "edge": "end", "duration": "12f" }
```
```json
{ "action": "remove_orphans", "tracks": ["A1", "A2"] }
```

#### premiere_audio_fade
Fades audio in and out without wrecking it, for one clip, a list of clips, or every audio edit in a range, in one call.
- **Keyframes (default):** Volume keyframes go from silence to the level the clip already plays at. Gain and keyframes between the fades stay exactly as they were. Old keyframes inside a fade are replaced, so running it again is safe.
- **Transition:** `method: "transition"` uses Premiere's own audio transition (Constant Power, Constant Gain or Exponential Fade) on that clip only, inside it. Nothing is moved or trimmed. The tool checks where the transition landed.
- **Range:** every audio clip that starts or ends inside the range is faded there. Where the same take simply carries on across a cut, it's left alone, because fading there would make a dip.
- **Linked audio:** a video clip means its linked audio, and an audio clip brings its linked channels on other tracks (unless `include_linked` is false).
- **Two traps it handles** (they break fades written as one-off scripts): Volume > Level isn't in dB or percent. It's linear gain with 15 dB of headroom: 0 dB reads 0.1778, so a key value of 1 meant as "100%" is +15 dB. Its keyframes are in the clip's source time, so keys placed at clip-relative times land outside the clip, and the whole clip plays at one key's level, often silence.
```json
{ "clips": [ { "track": "A1", "at": "00:00:04:12" } ], "fade_out": "12f" }
{ "range": { "start": 0, "end": 120 }, "tracks": ["A1", "A2"], "fade_in": "2f", "fade_out": "2f" }
{ "clips": [ { "track": "A1", "at": 30 } ], "fade_in": 1, "method": "transition", "shape": "Exponential Fade" }
```

### Media

#### premiere_versioned_path and premiere_replace_media
Overwriting a file that Premiere has open causes the Link Media popup. Instead:
1. Ask `premiere_versioned_path` for the next free name (`mix.wav` -> `mix_v2.wav`).
2. Write the new file there.
3. Relink with `premiere_replace_media`.

Every clip keeps its place, in/out, keyframes and effects.
```json
{ "old_path": "~/Audio/mix.wav", "new_path": "~/Audio/mix_v2.wav" }
```

#### premiere_title_card
A title or lower third as a transparent PNG, in any installed font (drawn by ffmpeg), placed on a video track.
- **Where it's saved:** in `Claude Bridge/titles` next to the project, with a versioned name.
- **Why a PNG:** this is the workaround for editing Essential Graphics text, which scripts can't do reliably.
```json
{ "text": "Jane Doe\nProducer", "font": "Helvetica Neue", "position": "lower_third", "box": "black@0.5", "at": 30, "duration": 4, "track": "V3" }
```

### Captions and bleeps

These read word-level transcripts of the **source files**: WhisperX JSON, or a plain list of `{ word, start, end }`. A transcript is matched to its media by file name: `interview_A.json` and `interview_A.words.json` both match `interview_A.mov` or `interview_A_proxy.mp4`. Pass a folder, a list of files, or `{ "media file": "transcript" }`.

**How words are mapped:** each audio clip in the cut is mapped back to its source words, taking in points, trims and speed changes into account.
- **Skipped:** disabled clips, muted tracks and reversed clips.
- **Duplicates:** when the same speech is on two tracks (lav and camera), it is used once, from `prefer_tracks` first.

#### premiere_captions_from_transcripts
Writes an SRT (versioned, in `Claude Bridge/captions`), imports it and makes a caption track.
- **Speaker labels:** added when there's more than one speaker, or when you give `speaker_map` (it matches transcript speaker labels, clip names, file names or tracks).
- **Cue rules:** 42 characters a line, 2 lines, at most 6 s, and breaks at sentence ends.
```json
{ "transcripts": "~/Project/transcripts", "speaker_map": { "interview_A*": "HOST", "SPEAKER_01": "GUEST" } }
```

#### premiere_find_words
Finds words or phrases in the cut, with sequence times, track, clip and context.
- **Wildcards:** `*` matches any letters.
- **Phrases:** several words in a row work too.
```json
{ "transcripts": "~/Project/transcripts", "words": ["damn", "shit*", "oh my god"] }
```

#### premiere_bleep
Bleeps words in a **copy** of the sequence; the original is never touched.
- **Ducking:** the dialogue is ducked under each word with Volume keyframes, and a generated tone goes on a free audio track. When no track is free under every bleep, one is added to the copy.
- **First letter:** it stays audible (`keep_first_ms`, default 70 ms).
- **Long lists:** these run as a job with `as_job`.
```json
{ "transcripts": "~/Project/transcripts", "words": ["damn", "shit*", "fuck*"], "tone_hz": 1000 }
```

## What scripting can't do (Premiere 27), and the workaround

| Can't | Workaround |
|---|---|
| Enhance Speech / Enhance Audio | Select the dialogue clips and click Enhance in the Essential Sound panel |
| Edit Essential Graphics text reliably | `premiere_title_card` (PNG in any font) |
| Style captions (font, size, position) | Save a Track Style once in the Properties panel and apply it to each new caption track |
| Delete a caption track | Delete or hide the old one by hand after making a new version |
| Copy Lumetri curves / LUT data | Edit > Paste Attributes (the copy report lists what was skipped) |
| Set the work area | The bridge uses the sequence In/Out instead and restores them |
| Undo reliably | Snapshots (see Safety) |
| Read keyframe interpolation | Copied keyframes use Premiere's default; re-ease by hand if it matters |
| Remove some transitions | Select it and press Delete |

## Premiere 27 facts the bridge relies on

Each one was found or confirmed on Premiere Pro 27 with the scratch test below.
- **Unset In/Out** reads as −400000 s. Setting −400000 s puts "not set" back. (QE `setInOutPoints("","")` sets 0 instead.)
- **Work area:** the scripted work-area setters do nothing.
- **Source marks snap to frames:** a project item's In/Out snap to the media's frames (rounded down), so clips land up to a frame off and are slipped back.
- **Speed and source times:** a speed-changed clip's `inPoint` reads divided by its speed (a 30 s In at 50% reads 60 s). Keyframe times stay in real source time.
- **Changing speed:** setting a slowed clip's end or Out point by script leaves a clip Premiere can't razor. Premiere's own speed call with the new duration doesn't.
- **Transitions don't follow scripted moves.**
  - After a DOM `trackItem.move()`, the clip's transitions stay where the clip was.
  - A QE `move()` deletes the clip's transitions, even ones already moved away from it.
  - Razor cuts leave transitions alone.
  - DOM transitions (in `track.transitions`) have their own `move()` and `remove()`, plus `nodeId`, `name`, `matchName` and `duration`.
  - QE `getTransitionAt(i)` lists the gaps between transitions as items of type `Empty`; skip them. Real QE transitions report their `alignment`.
- **Moving clips past others:** after the DOM `trackItem.move()` takes a clip past another, the track's internal clip list is out of time order, and QE razor then fails on clips in the wrong place. The QE item's `move("<signed duration timecode>", false, false, false, false, false, false)` shifts the clip by that much and keeps the list in order. It moves only that clip (not its linked partners) and overwrites whatever is at the destination. The bridge uses it only when a clip must pass another (`premiere_move_range`), and the DOM move otherwise, because the DOM move keeps the transitions as objects it can move after the clip. `premiere_read_timeline` still flags tracks that were jumbled earlier, for example by another script.
- **Effect stack:** a new effect is added at the top of the stack, just under Motion and Opacity.
- **Duplicate effect names:** some effects share a name ("Transform" twice). The legacy ones are named "… (Legacy)" ("Directional Blur (Legacy)").
- **Extra channels:** placing a multi-channel clip while other tracks are locked makes Premiere add empty audio tracks. `premiere_place_clip` removes them.
- **Undo:** script changes don't all reach the undo stack, and `undo()` can step back more than one action.
- **Audio-only files:** a .wav clip's Out point reads one frame short of its length on the timeline.
- **Volume level:** a clip's Volume > Level is linear gain with 15 dB of headroom: `10^((dB − 15) / 20)`, so 0 dB is 0.1778, +15 dB is 1 and 0 is silence.
- **Keyframe times:** keyframes on any effect are in the clip's source (media) time, not time from the clip's start.

## UXP (Premiere's newer plugin API)

The bridge stays on CEP and ExtendScript for now. UXP (Premiere 25.6 and later) has:
- clip insert, overwrite and ripple remove;
- exporting a sequence frame;
- `changeMediaFilePath`;
- transcript import and export as JSON.

It also has gaps:
- speed and captions are read-only;
- there's no Enhance Speech;
- a plugin needs UXP Developer Tools or a signed .ccx;
- a plugin can't listen on a port, so Claude couldn't call it the way it calls this panel.

## Testing

```bash
node --test test/unit.test.mjs test/jsx-mock.test.mjs
```

No Premiere needed.
- **unit.test.mjs:** timecode, transcripts, caption cues and bleep ranges.
- **jsx-mock.test.mjs:** runs `host/ppro2.jsx` against a small stand-in for Premiere's scripting objects, to check the batch ripple delete (where every clip and marker lands, no overlaps, clip order kept) and the keyframe fades (key times and levels).

```bash
node test/v1-compat.mjs <old server.mjs> server.mjs
```

Checks that every v1 tool is unchanged.

```bash
node test/lint-jsx.mjs host/ppro2.jsx cep/com.shownmedia.claudebridge/host/*.jsx
```

ExtendScript (ES3) lint and syntax check.

```bash
node test/scratch-premiere.mjs <scratch folder>
```

End to end, inside Premiere, on a **scratch project only**.
- **What it does:** copies Premiere's blank template project, opens it next to whatever is open, runs every tool, and checks renders frame by frame (frame numbers are encoded in the test media).
- **Safety:** before every step it stops if the active project isn't the scratch project.
- **Setup:** the scratch folder needs `media/` (test clips) and `transcripts/`.

## Files

| Path | What |
|---|---|
| `server.mjs` | The MCP server and command line (v1 tools; loads v2) |
| `v2/` | v2 tools (`tools/`) and shared code (`lib/`); if this folder fails to load, the v1 tools still work |
| `host/ppro2.jsx` | The v2 helpers that run inside Premiere (loaded on first use, reloaded when changed) |
| `cep/com.shownmedia.claudebridge/` | The panel |
| `test/` | Tests (see above) |
