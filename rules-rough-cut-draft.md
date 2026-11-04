# Rough cut rules: draft from the Wajo test

Editor notes from cutting the Wajo shoot (Shivani, Fo launch, Sept 2026) with the local pipeline.
Written to drop into ShownRoom's (formerly Motion Studio) `rules/rough-cut.md`. Each rule says what went wrong and what to do instead.

## Shown's standard (measured from editors' rough cuts: Rayline RC 1.3, Notch RC V2)

- **Tight inside a section:** 0.2 to 0.5 s between sentences.
- **One breath at a section change:** about 1 s, left on purpose, with a "trim point" marker where a tight cut would go.
- **Hold the shot:** editors run a shot 6 s to over a minute. Switch camera only when the speaker or section changes, or after about 8 s. Switching every line (every ~4.7 s) feels abrupt even when the sound is fine.
- **No alternate takes left in the rough cut.**
- Re-measure with `tools/style.py` on every new example; add launches to make these numbers firmer.

## Script

- **Use the shooting script, not the latest draft.** Wajo's script doc held five versions. The footage matched the first one (the "lunch date" version), not the Mike and Sarah draft at the bottom. Before matching, check that the script's lines actually appear in the transcript; if under half match, ask for the right version.
- **Expect on-set rewrites.** "I finished getting ready" became "I just got back from lunch". Treat a rewrite as a take of the same line and flag it, never as a missing line.
- **Paraphrase is normal.** The founder said "a decade" for "12 years" and swapped the order of "Meta, Amazon and Google". Score wording loosely; only numbers and claims must match exactly.
- **Numbers need normalizing.** The script writes "twelve thirty", the transcript writes "12 .30". Compare digits to digits.

## Takes

- **Use the slate to know the setup.** "This is hook two, take one" tells you which section a take belongs to. Hook 1 and Hook 2 share lines ("you're a lifesaver"), and without the slate the takes got swapped between them.
- **Ignore everything before the first slate.** Sound checks and crew chatter ("I've got the boom on channel one") matched short script lines like "I've got it".
- **Short lines need a stricter match.** Lines of four words or fewer ("You did what?", "I know") match random chatter easily.
- **Lines read off-mic are placeholders.** Fo's lines were read on set by a crew member. The real voice files live in `Assets/FO VOICE LINES` on Aspect; use those for the AI character's lines.

## Sync

- **Check which cameras have sound.** Wajo's A cam proxies were silent. Never assume two cameras started together because their clip lengths match: that put every A cam shot out of sync.
- **Match words, not waveforms.** Camera scratch audio and the recorder correlated too weakly for waveform sync (no file locked). Matching the same spoken words on both devices locked every B cam, C cam and recorder file.
- **Camera timecode isn't shared unless someone jammed it.** A and B cam timecode didn't line up on Wajo. Ask on set, or sync silent cameras by eye at a clap.
- **Proxies drop timecode.** The originals keep it in a small XML file next to each clip (Sony `M01.XML`). Read that, never the big video file.

## Cameras

- **Camera letters don't mean the same thing every shoot.** The fixed rule "A for hooks, C for demos" picked a blurry handheld C cam shot. On Wajo: A = locked-off shot of the founder, B = locked close-up of the green-screen phone (the AI character's "face"), C = roaming BTS handheld. Tag each camera's role once per shoot and choose by role.
- **Show whoever is talking.** The founder's lines go on the founder's camera; the AI character's lines go on its phone shot. Leaving the founder's camera out put the phone on screen for her lines.
- **Look before you pick.** Check one frame of the chosen angle: soft focus, blinking mid-word, or the subject out of frame means take the next angle. On a locked-off shot, compare against an empty-set frame: if the chair is empty, use the camera that follows her.
- **Don't hold one static shot for minutes.** The AI character talks for about two minutes; alternate its close-up with the wide of the set.

## Picking takes

- **Keep a running moment in one take.** Picking each line's best take on its own stitched "...excited to introduce" from take 3 into "oh shoot" from take 1, cutting her off mid-phrase. Lines performed back to back in one take stay together, even if one of them is slightly weaker.
- **But continuity never rescues a bad take.** Only keep a take for flow if it's close to the line's best on both delivery and wording, on both sides of the join. Otherwise a flubbed read ("...the last week") gets in just because the next line follows it.

## Cut points

- **Cut in silence, not on Whisper's word times.** Word times run early on word endings, so cuts clipped the last syllable. Find the quietest frame near each end of a line and cut there.
- **Leave room after the line.** About a quarter second after the last word, more on the last line of a section, so it breathes.
- **Fade every audio edit** by about 2 frames, so cuts never click.
- **Use the right mic for the speaker.** The founder's lav is about 10 dB cleaner than the mix, but it only hears her: off-mic lines came out silent on it. Lav for the person wearing it, the mix for anyone else.
- **Never cut inside the neighbouring words.** Stop before the word after the line and start after the word before it, or the edges leak ("Guys.", "now now").
- **Run-on words stay.** If the next word follows with no pause ("for a year now"), carry the line through it instead of shaving the last syllable.
- **A take never opens mid-sentence.** Grow a match back to the sentence start ("Now with Fo..."), not "...it or email it".
- **Never play the same words twice** where two lines from one take overlap.
- **Lay continuous reads as one piece of sound.** Back-to-back lines from the same take keep one unbroken audio clip; only the picture cuts.

## Sound

- **Abrupt usually means the background jumped, not the cut.** The crew's off-mic reads had room noise only ~8 dB under the voice; every switch to the clean lav slammed the hiss in and out.
- **Use the real voice files for the AI character.** Placeholder reads on set get replaced by the rendered voice (Wajo: `Assets/FO VOICE LINES`, official takes listed in LINES.txt, whole-scene renders for gaps, plus the owner's and plumber's files).
- **Room tone under everything.** Lay the recorded room tone on its own track for the whole cut, so the background never drops to dead silence between clips.
- **Match the background between words** on every piece (pull it down between words using the word timings), and level every piece to the same voiced loudness.
- **Soft ceiling, no hard clipping.** Measure clipped samples on every render; the target is zero.
- **Check by ear's stand-in before an editor watches:** transcribe the render and read it start to end against the script. Missing, clipped, repeated or leaked words show up there.

## Premiere

- **Multicam from XML loses sync.** Premiere lines every angle up at zero on import. Either fix the offsets by script right after import, or put angles on stacked tracks until that exists.
- **Keep labels out of the picture.** Use sequence markers or a separate label track the editor can switch off, never burned-in text.
- **Write labels in plain words** ("Hook · Take 2 of 4 · B cam · needs a look"), not codes like "L10 T2/4 B".

## When a project is done

- **Clean up.** Keep only what the final sequences need (the final XML, its 4K version, their audio folders), the export, and the small text files (script lines, takes, picks, sync, word timings) as a record. Delete old versions' audio, previews, frame grabs, check transcripts and study copies.
- **Tell the editor which old sequences go offline** after the clean-up, so they can remove them from the Premiere project.
- **Caches are the editor's call:** Premiere's media cache (Settings → Media Cache → Delete) and Aspect's cache (in the Aspect app). Never delete these without asking.

## Before anything else on a new project

- **Check the proxies first:** that every camera clip has a proxy, that each proxy has sound (Aspect drops it on some clips), and that its length matches the original. Do this before transcribing, syncing or downloading anything big.
- **One silent clip must never stop the batch:** skip it, list it, and place it by picture later.

## Camera coverage is checked, never assumed (Notch, 2026-11-04)
- FIRST, right after sync and before takes, scrub or any edit: run `coverage.py work_dir`. It prints, per recorder
  file, how much of the speech each camera covers, and exits 2 if any camera is under 90% anywhere. On exit 2 the run
  stops and the editor is told which camera, which files, and the likely cause (stopped rolling, missing card, failed
  sync). Socrates only falls back to another angle silently; we flag instead.
- Every camera must sit on every take where it was rolling. Sync keeps EVERY camera clip that matches a recorder
  file (textsync.py), not only the best one: cameras stop and restart inside one recorder take.
- Each sync is confirmed word by word (verify_sync.py) before it is used.
- After every build, the builder prints `WARNING: no B cam on N pieces: L13 ...` and each such take's marker says
  `NO B CAM`. The editor is told in chat, with the line list and the reason (footage stops, or sync failed).
- If a camera's footage simply ends (Notch B cam stops during MixPre-017), say so and ask whether another card exists.

## Sound per speaker (audio engineer pass)
- Natural first: gentle noise reduction (never watery), hum notches, light EQ (less boxy, a touch of presence),
  soft de-ess, light 2:1 compression, then every piece levelled to the same loudness (-16 LUFS stereo, peaks < -1.5 dB).
- Recorder channels are separate lavs, not a mix. Each piece uses the channel where it is loudest (best_channel).
- A take more than 12 dB under the line's other takes has no voice (Whisper invented it): never picked.
- A word longer than 1.5 s is a timing failure: fix_stretched.py re-listens and keeps the most complete read.
- Check transcription runs without the script as a prompt, and any line it misses is re-checked on its own.

## Notch round 3 fixes (2026-11-04, from Shafin's review)
### Picking: stumbles
- Whisper writes a stumbled take as clean text. `stumble.py` measures talking that no word covers (false start,
  "uh", repeated half-word) and pick.py takes 8 points per second of it.
- Halting delivery counts too: pause time mid-sentence (not after a comma or stop) over 0.3 s costs 10 points per
  second. Notch L08 take 3 has a 0.7 s pause inside "brand's ... Shopify": the editor's ear decides those.
### Swapping a bad pick fast
- Every line also gets its own short sequence in `Takes by line` (L08 = every take of line 8, back to back,
  labelled). Watch it, then tell the agent "L08 take 5" or swap by hand. The Markers panel search ("L08") also
  jumps to that line's takes in the long scrub.
### Jump cuts (faces shift at a cut)
- Two takes on the same framing never butt together. At every take change the rough cut switches angle (A <-> B);
  where only one camera exists it alternates a 15% punch-in (4K source stays sharp). Lines that run on in one take
  keep the shot. This is what the editor's cut does (A cam medium, punched-in A, B wide).
### Sound
- Wind: steep 24 dB/oct high-pass at 90 Hz, then gentle broadband noise reduction. Never over-process.
- Room tone: a bed on A2 under the whole sequence, from the steadiest 3 s of the quietest pause (chosen by sound,
  not by transcript gaps: a "silent" gap can hold a bump or a far voice). Outdoors 6 dB under the dialogue noise
  floor (it only smooths cuts); indoors 0-3 dB under, where it matters more.
- Far-away voices (crew, passers-by) under a line: flag them; a gate or a hand fix in Premiere.
- Baked files get new names every build: reusing a name made Premiere show a stale or blank waveform.

### Thinking pauses inside a line
- After cleaning, every rough-cut piece is scanned for silence over 0.5 s inside the line (not the lead-in or tail).
  Each is cut down to a 0.35 s breath, and the cut is hidden like a take change (angle switch, or punch-in).
  The build lists them: "tightened L20: 2 pause(s), 0.39 s of thinking removed". Pauses at sentence ends stay.
- A dragged word (over 0.65 s, e.g. "brand'sss... Shopify") is a voiced hesitation that silence checks miss: the
  picker penalises it. When the editor flags a pick, check every take of the line verbatim (words/s, longest word,
  longest gap) and swap; record the swap in picks.json as "override" with the reason.

## Line feeds and the script check (Notch, 2026-11-04)
- On set the cameraman often reads the line for the founder to repeat. That read is a "take" to Whisper. stumble.py
  marks any take more than 10 dB under its recorder file's median founder level as `off_mic` (a line feed), pick.py
  never picks it, and the scrub labels it `LINE FEED (cameraman reading it, off-mic)`. Notch had 46.
- Never override a pick without checking its voice level: my L08 swap to take 2 put the cameraman's read in the cut.
- After EVERY rebuild run `script_check.py work_dir rc.xml`: each rough-cut line, exactly as the timeline plays it,
  is transcribed on its own and compared with the script. Any line under 90% is listed with script vs heard. Spelling
  differences (15/fifteen, brand names) are fine; missing or changed words are not.
- Exact script wording beats a smoother reworded read (the drag penalty is capped so it never outweighs this).

## Editor workflow: rough cut <-> scrub (Notch, 2026-11-04)
- Every rough-cut marker shows the REAL take number ("L08 · Take 3 of 8"), the same number the scrub uses.
- Every marker comment says where the piece came from and where its alternatives are:
  `Recorder MixPre-013 @ 01:36.2 | A cam 7T0A9130 @ 01:38.7 | B cam A_0001C011 @ 01:37.9 | in scrub @ 00:12:34:05`.
  The recorder WAV, the A cam file and the B cam file are three recordings of the same moment; the times say where
  that moment is inside each file.
- Lines a person should hear get a red marker starting `CHECK:` with the reason (close call, wind, dragged word,
  pause tightened, missing cam, reworded), and a list `<rc>.needs_your_ear.txt` with the scrub timecode of the other
  takes. The agent hands that list to the editor instead of guessing.
- To swap: open the scrub at that timecode (or `Takes by line/L08`), pick, tell the agent "L08 take 5".
- Visual problems the sound can't show (the other founder coughing, looking away) are the editor's call; flag them
  and they get added to the list.

## Premiere safety
- Sequences go into Premiere ONLY through `ppro_swap.py "Notch/Sequences" "name" file.xml`: import first, confirm the
  new sequence exists and has clips, then replace the old one in that exact bin path. A failed import keeps the old.
  (A batch import once silently skipped the scrub after the old one was already deleted.)
- Wind is measured on the worst half second of each take, not the average: one gust over "To prove it" ruins a line.
- Each line keeps 0.4 s after its last word, so a falling last word ("...more info") finishes.

## Take Finder (visual swap, 2026-11-04)
- `take_finder.py work_dir 4310` (run in a Terminal, not the preview runner: it needs the T7). Opens a page with one
  row per script line: the rough cut's pick first (green), then every other take as A/B thumbnails with take number,
  scrub timecode and flags (cameraman read, wind, missing cam, CHECK). Clicking a take jumps Premiere's playhead to
  it in the scrub (through the bridge CLI; the token never reaches the page) and copies "L08 take 5" to paste back.
- "Follow Premiere": select any clip (picture or sound) in the rough cut or scrub and the finder scrolls to that
  line with all its takes.

## Take Finder panel (inside Premiere) and multicam review (2026-11-04)
- Editors work in Premiere, not a browser. `panel-takefinder/` is our own CEP panel (separate from Sam's Claude
  Bridge, which stays untouched). Install: copy it to ~/Library/Application Support/Adobe/CEP/extensions/
  com.shownmedia.takefinder, restart Premiere, Window > Extensions > Take Finder.
- After every build run `panel_data.py work_dir Client`: writes ~/.shown/takefinder.json + thumbnails.
- Click any clip in the rough cut or scrub: the panel shows that line and every take (A/B frames, "In your rough
  cut", "Cameraman reading it (skip)", "Windy", "No B camera"). "Show in scrub" jumps there; "Back to rough cut" returns.
- Labels are plain words: "Line 10, take 4 of 6, Founder 1, Demo 1". Never codes like L10, never dot separators.
- The scrub IS the multicam (Shafin: one scrub, eagle eye on everything). Premiere can't export the multicam monitor
  and Frame.io can't switch angles, so the scrub is built
  `REVIEW 3 - Scrub multicam` with every camera on (GRID=1); `ppro_grid.py` tiles A left, B right, one sound track.
  No paid grid plugin needed.

## Scrub markers and the attention list (2026-11-04)
- After the scrub is swapped in, run `ppro_markers.py work_dir "<scrub name>"`:
  - one range marker per script line across all its takes, alternating green / blue, "Line 1: ... (19 takes)",
    so the editor sees where one line's takes end and the next begin (the per-take marker clutter is removed);
  - a clip marker on each take's own audio piece: "PICKED, take 6 of 19" (green), "ALT, take 3 of 19", or
    "CAMERAMAN READING, skip" (red). The pieces are scrub-only files, so these never appear in the rough cut.
  Premiere ignores marker colours and clip markers in XML, so this has to run inside Premiere afterwards.
- The Take Finder panel has a "Needs your attention (N)" button: tap it for the list of lines to check; tapping a
  line shows its takes and jumps to it in the rough cut.
- Markers are not burned into an exported video. For a Frame.io review, burn the line/take text in.

## Part feeds, flags and swaps from the panel (Notch, 2026-11-05)
- The cameraman can read only HALF a line inside a take the founder starts (Notch L07 take 2: founder says "Six weeks
  ago, we connected Notch to Scentless", cameraman says "A brand that was performing quite poorly"). The whole-take
  level check missed it. stumble.py now checks word by word: 3+ words in a row 15 dB under the take's own loud words
  = `part_feed`. pick.py never picks it; the panel shows "Cameraman reads part of it: ..." in red.
- Whisper with the script as a prompt writes the script, not what was said. Any doubt about a word: re-listen
  WITHOUT the prompt (script_check.py already does).
- Take Finder v6:
  - Ticks on "Needs your attention", saved in ~/.shown/state.json.
  - "Flag this spot" (playhead or selected clip) and "Flag" on any take, with a note. "My flags" list with ticks,
    tap to jump, "Copy open flags for Claude". Saved in ~/.shown/flags.json, so "check my flags" works too.
  - "Use this take" queues a swap in <work>/overrides.json; "Rebuild rough cut" opens <work>/Rebuild rough cut.command
    (tools/rebuild_rc.sh): learn hand swaps, re-pick (your choices win), build, script check, into Premiere, scrub
    tags, panel data. The panel reloads by itself.
  - The old rough cut is never deleted on a panel rebuild: it waits in Sequences/Old as
    "... (before your last swap)" (one copy, replaced each time), so hand trims in it can be copied back.
  - Hand swaps count: every audio piece file is named in takefinder.json, so a scrub take dragged into the rough cut
    is recognised by the panel (by file, not by time) and hand_edits.py keeps it on the next rebuild (trims and deleted lines too).
  - A rebuild redoes the whole rough cut sequence: hand trims and extra edits in it don't carry over (they stay in
    the backup). Make take choices first, fine edits after.

## Muffled lav and "under water" sound (Notch, 2026-11-05)
- Founder 2's lav was buried under his jacket: 8-12 dB less 2-10 kHz than Founder 1 from Line 13 on (the editor's
  cut has the same dullness). Our afftdn noise reduction then ate another 8-10 dB of the quiet air on top: under water.
- Fix: no broadband noise reduction (outdoor lavs sit ~35 dB over the noise; the room tone bed covers it), plus
  matcheq.py: every piece's speech spectrum pulled 80% toward the clearer half of the project's pieces (boost up to
  9 dB, cut 3 dB at most, smoothed, no rumble added). Spread in clarity across pieces went from 30 dB to ~15 dB,
  hiss in pauses stays ~40 dB under the voice. Measure, never assume: compare each piece to its raw channel.
- Don't use the median of ALL pieces as the target: the speaker with most lines (the muffled one) drags it down.

## Hand edits, clean starts, labels (Notch, 2026-11-05)
- A rebuild while the editor works lost his trims and swaps (they survived only in Sequences/Old). Now:
  hand_edits.py reads the live sequence before every rebuild and keeps take swaps, trims (exact recording in/out)
  and deleted lines in overrides.json; anything else (extra clips, effects, keyframes) is listed as not carried.
  rebuild_rc.sh refuses to replace the sequence if it changed while building; the panel shows a red banner then.
  Claude never starts a rebuild of a sequence the editor may be in without saying so first.
- Every build writes <build>.pieces.json (piece file -> line, take, recording range), so edits are read exactly.
- Clean starts: a line opened on a click 0.15 s before "Fifteen" (L16). clean_edges() finds the real voice onset,
  mutes any noise in the lead-in or tail, and opens BREATH (0.25 s) of quiet before the first word.
- Sound, round 2: full match EQ (up to 13 dB) plus a light harmonic exciter above 3.5 kHz on pieces more than 8 dB
  dull: Founder 2 measured -29.3 against Founder 1's -28.3 (EQ alone stopped at -34.6; the editor's cut is -45).
- Multicam scrub export (Mateus): "CAM A - Take 1" / "CAM B - Take 1" burned in over each half (labels/ PNGs on V3),
  take numbers restart every line, no black between takes, 1 s between lines.

## In-place fixes on an edited cut (Notch, 2026-11-05)
- Never rebuild a cut the editor has worked on to fix sound or sync. Fix in place:
  check_sync.py (every camera clip vs the sound under it; --fix slides only the source frames, positions untouched),
  REBAKE=all + ppro_relink.py (sound re-made at exactly the same length, clips pointed at it: every edit stays),
  live_script_check.py (1:1 of the cut as it is in Premiere: missing lines, doubled lines, order, wording).
- Sync bug: cameras were looked up before a trim/clean start moved the sound (L07/L08/L27 0.5-42 s off). Edges first.
- Joined lines cut in the real silence between them (quiet_between), never at Whisper's start (it chopped "info").
- polish.py: pops/bumps turned down to speech level; wind cut on the low band only during gusts, measured against the
  piece's calmest moments.
- No grading until the cut is final and the 4K is conformed.
- Test every Premiere script change on a CLONE first, and find the clone by name, never by its index in the list
  (an index guess renamed a Wajo sequence; restored from the saved project).
