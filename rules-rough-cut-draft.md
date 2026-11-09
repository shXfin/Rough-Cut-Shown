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
- Buried lav (Founder 2): blend.py, lav below 1.5 kHz + the A camera ORIGINAL's mic above it, aligned to the sample
  by cross-correlation (0.92-0.97), level-matched on the voice body (400-1400 Hz). REBAKE with BLEND=1 applies it to
  pieces more than 6 dB dull. Natural top end instead of boosted, "under water" EQ.
- A "spike" can be the founder's own voice (a 90 ms squeak on "fatigue", L17, in the original recording): check the
  raw before processing it; the fix is another take, not a filter.

## Handles on every sound piece (Notch, 2026-11-05)
- Shafin: "if I see anything cut off, I should be able to drag the audio". Every piece file now carries FILE_HANDLE
  (2 s) of real sound before and after the edit; the clip plays only the edit (in point = the handle). Loudness is
  measured on the edit only; click/noise mutes apply only inside the edit, the handles stay open.
- Existing cuts get handles in place: REBAKE (same s0/s1, handles added) + ppro_relink_handles.py, which swaps the
  file and slides every clip using it, in every sequence, by the handle, keyframes included. Tested on a copy first,
  project file backed up first (Notch/backups). Manifests record "pre" (handle before the edit); every tool subtracts it.

## 4K conform for grading (Notch, 2026-11-05)
- conform_4k.py builds "<cut> 4K (for grading)" FROM the editor's live proxy cut: XML export, proxies -> camera
  originals, import beside it, then each camera clip copies its Motion from the proxy cut at 1/4 scale (540 -> 2160).
  The proxy cut is never touched. Check frames side by side (A cam, B cam, a punch-in) before handing it over.
- XML drops some audio effects and Custom Fades: list them for the editor (Paste Attributes brings them back).
- Grade only on the 4K copy, after the cut is final.
- Never link Premiere to originals on a cloud mount (Aspect's "Home Project" streams through 127.0.0.1): Premiere
  reads them in the background (audio conform, thumbnails) even with proxies on, and a 16 GB Mac swaps until every
  sequence stutters. Copy only the used ranges + handles to a local drive first (Notch: 24 GB instead of 167 GB).

## Eyeline: founders looking off camera (Notch, 2026-11-05, from Shafin)
- In most takes of the opening (Lines 1 and 2) the founders glance away from the lens. The editor's cut (Notch Rough
  Cut V2) used the one continuous take where both hold the lens (MixPre-012 at 18.2 s, A cam 7T0A9128 at 16.5 s,
  Lines 1-3 with no performance cut). Sound alone can't see this: it picked a take where they look elsewhere.
- Until vision is in: when an editor's reference cut exists, match its takes by sound (cross-correlate its audio with
  every recording: 0.50+ is a hit, others sit near 0.1) and offer those takes first.
- Next (vision, Gemini via Melius): score every take for eyeline (looking at lens vs away), blinks on key words, and
  hand/face moments, and make it part of pick.py's ranking. A continuous take where both founders hold the lens beats
  stitched "best" lines.

## Vision: eyeline on every take, and Sam's 3-take scrub (Notch, 2026-11-05)
- eyeline.py (MediaPipe Face Landmarker, local, 478 points with irises): samples the A cam at 4 fps while the line is
  spoken, zooms into the head area (medium shots are too small for the model at proxy size: 0 faces found until then),
  keeps the N largest faces (PEOPLE=2), measures head turn + iris direction, and scores the share of the line where
  EVERY founder looks at the lens. Calibrate per project on a take confirmed good (--calibrate SRC:START:END).
- Checked by eye: 0% takes really look away (head down, eyes off to the side); 80-100% takes hold the lens.
- top3.py: the best 3 takes per line on sound rank + eyeline (weight 45); eyeline under 70% only fills a line with
  nothing better, and is flagged LOOKING AWAY. KEEP=top3.json builds the scrub from just those (Sam: 3, not 16-19).
- Next: Gemini (via Melius) for what landmarks can't judge: expression, energy, a smile on the wrong word.
- Eyeline is judged on the MAIN camera(s) only (Notch: A cam, the close shot; the wide B cam faces are too small).
  Per project: list which cameras count (EYE_CAMS, default the top/main one); with several close cameras, score each
  and a take passes if the camera you'd cut to has everyone on lens.

## Lessons from review round 2 (2026-11-06)
Audio
- Never let a voice ride the limiter: gain to target, gentle compressor (3:1, -22 dB), then MEASURE AGAIN and re-gain,
  limiter last at -3 dB. A reviewer hears limiter slamming as "clipping at 0 dB" even when the source is clean.
- Every sound file Premiere gets is STEREO (dual mono). A mono file plays on the left only.
- Ticks (4-12 kHz, regular) and wind gusts are fixed per band, never with a broad cut (no muffle).
- After building, scan the full export in 5 s windows: level, peaks, wind, brightness/esses, noisy pauses. Fix only flagged pieces.
- Any outside audio (ElevenLabs isolator etc.) must be sync-checked: rebuild the synced lav from the timeline clip list and
  cross-correlate against the export. Calibrate on a lav-only section first (export adds ~20 ms). Slip > 40 ms = fix.
Picture
- Proxies tagged full-range (yuvj, "pc") look flatter and cooler than the 4K in Premiere with the same grade.
  Measure both renders on the same frame and offset the proxy grade (Notch: Sat +30, Temp +4, Blacks -6).
- B cam (log) gets its own grade matched to A on shared content (grass, sky), not a copy of A.
Scrub
- A scrub clip starts 1-7 s BEFORE the spoken line. Check for slate/crew from the clip's in-point, not the line start.
  If crew is still in frame when speech starts, swap the take (trimming would cut the first word).
- When the picker's inputs drift, don't re-run it on a reviewed scrub: patch only the bad takes.
Vision
- MediaPipe on every take (free): head turns, extra faces. Gemini (Melius) only on unsure takes, sent as short snippets
  joined into one clip (17 s = 20 credits). If MediaPipe, Gemini and a frame check disagree, flag for the editor.

## Progress board (2026-11-07)
- Every project run gets a live board in a terminal tab: `python3 tools/progress.py <project_dir> <A cam folder> <B cam folder>`.
  It counts the files each step writes (audio pulled, transcripts, sync, takes, scrub, proxies), refreshes every 5 s,
  and closing it stops nothing. Start it at the beginning of every run so the editor never has to ask for status.

## Lessons from Concurrence ingest (2026-11-07)
- **Canon RAW (.CRM, 7K):** proxies are slow (Media Encoder's RAW decoder, ~1.5-1.9 GB/min, ~5 h for 550 GB), so
  NEVER wait on them. The audio is readable straight from the CRM with ffmpeg in seconds per file; Concurrence's
  A cam carries 4 mono tracks and only tracks 3 and 4 have sound (`-filter_complex [0:a:2][0:a:3]amerge`).
  Pull audio while the encoder is PAUSED: two readers on one USB drive drop both to ~33 MB/s.
- Proxies carry the camera audio too, so a clip whose proxy is done needs no separate audio pull.
- Build the scrub on the camera originals; attach proxies afterwards (`attachProxy`), they play once encoded.
- **No slates:** if no recorder file has a spoken slate, scrub.py now treats every file as in-section (was: 0 takes).
- A recorder that runs for an hour (Wireless PRO) makes recorder-level coverage look low; judge camera coverage per
  TAKE, not per recorder file.
- Shooting script check worked again: the Drive doc held 6 versions; the recorder matched "Teleprompter v2".
- **Drive link speed first.** Before any proxy job, check `system_profiler SPUSBHostDataType` for the media drive.
  Concurrence's SanDisk sat at 480 Mb/s (USB 2) on a MacBook charging cable: 35 MB/s, so every proxy app crawled.
  On a 10 Gb/s cable: ~900 MB/s, Resolve rendered 7K Canon RAW at ~23 fps (19 clips, 234 GB, ~30 min).
- **Resolve proxies for Premiere:** timeline resolution must match the camera shape (1280x676 for 17:9), else the
  proxy gets black bars inside. Render Individual clips, ProRes 422 Proxy, Source name, 4 audio channels, no
  directory levels. Premiere accepts them with attachProxy; export still uses the RAW.

## When to cut to cam B (2026-11-09, measured + researched)
- Measured: Concurrence's editor rough cut (RoughCut_v1, 3:54) uses cam B ZERO times; every shot is A (the hook's
  "twin on the glass" is A cam plus VFX). Notch's launched cut: 2 B shots in the whole video. So: A is the default,
  B is the exception, never a rhythm ("switch every line" was already flagged as abrupt).
- Use B only for a reason, and name the reason in the marker:
  1. Hide a cut INSIDE one line or a take change mid-sentence, where A would jump-cut (same framing both sides).
  2. A section change or a new beat (hook -> demo, demo -> founder story) as a one-shot reset.
  3. A moment that needs a different feel: an aside, a reaction, the founder looking off at something (phone, screen).
  4. A cam is unusable on the best take (soft, blink, slate, crew in frame) but B is clean.
- Cut to B on a pause or breath, never mid-word; hold B at least ~2-3 s; come back to A at the next sentence.
- Never cut A -> B -> A on near-identical framings (it reads as a jump). B must differ by angle (~30 deg) or size.
- Rough cut default: A only, plus B where rules 1 and 4 force it. Leave rules 2 and 3 to the editor's taste.
- **Weak text-sync pairings are wrong pairings (Concurrence 0:48).** textsync keeps any camera clip that shares a few
  4-word phrases with a recorder file. With one founder repeating lines ("let me show you how it works" x21), short
  phrases recur across takes and a clip got paired with the WRONG take (6-7 matches), so the picture showed another
  take. Rule: a pairing needs >= 30 matches, or its camera audio must correlate with the recorder (> 0.55) over the
  clip. Drop the rest BEFORE building. Then check every rough-cut line: camera audio vs recorder at the take, lag
  within 40 ms and correlation > 0.6, else flag. (Concurrence: 14 A and 12 B false pairings removed.)

## Alternative demos / versions (2026-11-10)
- Scripts often hold SEVERAL versions of a section (Concurrence's doc: metformin call, hair-loss call, Sarah call,
  "without Concurrence" receptionist call). Before building, search the transcripts for each version's key words
  and list which were actually SHOT. Unshot versions are ignored, not reported as missing lines.
- "Aha 1/2/3" inside one version are PARTS of one demo (played in order), not alternatives. Alternatives are whole
  versions of the same section with different wording/props.
- When 2+ versions of a section were shot: tag every line with its version (lines.json "variant": "Demo A ...").
  The 3-best scrub keeps EVERY shot version, each as its own labelled block ("DEMO A - metformin", "DEMO B - hair
  loss") with a marker, so the producer can choose. The rough cut uses ONE version by default (the one in the
  shooting script, else the one with the most usable takes) and puts a marker at the section start:
  "Other demo versions in the scrub: B, C". Never mix lines from two versions in one rough cut.
- Concurrence check: only the metformin demo was shot; all 3 aha parts are in both scrubs and the rough cut.
- **Rough cut picks must have the main camera.** A take with sound only (no A cam rolling) goes black in the cut
  (Concurrence L19 "Of course"). Pick the best take WITH A cam; for an off-camera voice line (agent, crew read)
  that means a take where the founder is on camera listening.
- **Editor's picks as a reference.** When a human rough cut exists (Aspect), find which take it used per line by
  matching its audio against every take (log-envelope correlation > 0.6, then keep only matches that run in script
  order: short lines otherwise match the wrong spot). Mark them in the 3-best scrub as "EDITOR PICK" (and add the
  take if it isn't in our top 3) so the producer can compare. Add section markers (HOOK, AHA 1/2/3, CLOSE) too.
- **Scene continuity beats take quality.** Lines that belong to one scene (script notes like "OUTFIT SWITCH", "1 month
  later", a new location) must all come from that scene's setup. Concurrence L35+L36 are the couch follow-up call
  (clip C030); L36 had also been read in the office, and picking that read broke the scene (outfit and room jump).
  Detect setups from the camera clips (location/outfit changes) and only pick takes from the line's scene.

## AI voices for scripted AI/agent lines (Concurrence, 2026-11-10)
- Lines the script gives to an AI agent or app are read by the crew on set as placeholders. In the rough cut, replace every one with an AI voice, generated straight from the SCRIPT text (not the crew's wording: L35 crew said "last week", the script says "last month").
- Melius: ElevenLabs v3 (`eleven_v3`, text-to-speech), one voice for the whole film. Pick it with `audio_voice_list` (search "assistant calm", "customer service"). Concurrence used "Sofia - Friendly, AI Assistant, American" (x8GG27Jf8JBB9yLaSos4). v3 speaks other languages in the same voice, so a Spanish agent line stays in character. 7 lines cost 54 credits. Files go in `work/ai_voice/`.
- Placement: remove the crew-read sound clip and put the AI line in at the slot's start + 0.2 s. If the AI line runs longer than the slot, slide it earlier first, never over the next line's first word.
- An agent line that was never shot gets its own slot: open a gap, hold the previous shot of the talent listening over it, and add a marker.
- Crew reads hidden INSIDE a talent take. Whisper often misses a non-English or far-off crew read (Concurrence L15: 3.4 s of the cameraman reading the Spanish line, picked up quietly on Ali's lav, transcribed as one stretched "okay"). Check the talent's lav level in 0.1 s steps around every reply to an agent line. A long quiet stretch at -45 to -50 dB between the talent's words is the crew reading. Trim the take to the talent's first word. To the reviewer this looks like "audio out of sync", because the voice plays while his lips don't move.

## Lav goes dull when the talent moves (Concurrence, 2026-11-10)
- Symptom: inside one line the voice suddenly sounds muffled or "pitched down" for a second or two, then clear again. Measured on L24: the lav's 3-8 kHz band fell 10-15 dB under the voice body, while the A cam mic stayed bright at the same moments. That is the lav under a sweater when he turns or leans, not the chain.
- A fixed EQ can't follow it. `polish.unmuffle` runs in every bake: per frame, it lifts the 2-14 kHz bands back toward the piece's own clear vowels (85th percentile of its louder frames), only while he talks, smoothed over 0.25 s and capped at 10 dB. Rebake with `REBAKE=<pieces> BLEND=1 BAKE=1` (the blend adds the A cam mic on very dull pieces), then run `ppro_relink.py`.
- Check that it worked: compare the HF/body ratio of baked vs raw in 0.5 s windows. Dull windows should come up about 4-8 dB, and clear windows stay put.

## Cam A only means A on top, B kept under it (Concurrence, 2026-11-10)
- The builder puts A on V2 and B on V1, and DISABLES the A clip wherever it chose B. So "remove cam B" left 14 disabled A clips: dark on the timeline and black on playback. When the editor wants A only: enable every A clip, and KEEP B on V1 underneath as the alternate angle. Never delete B.
- Put B back without its sound: `createSubClip(name, inTicks, outTicks, 0, 1, 0)` (video only), then `overwriteClip` on V1. A plain overwrite of the B file would also drop its camera audio over A1.

## ExtendScript gotchas found the hard way (2026-11-10)
- `trackItem.move(seconds)` takes a plain number. If a script fails halfway, the moves before the error have ALREADY happened: re-read positions before running it again (one rerun shifted the cut twice).
- Setting `trackItem.start` does not trim the head. It shortens the tail and keeps the inPoint. To trim a head, also set `trackItem.inPoint` to old in + trim, and check that out - in equals end - start.
- Marker `start`/`end` take numbers (seconds), not Time objects.
- `ok` is a reserved name inside Premiere's ExtendScript eval. Don't use it as a variable.
- ffmpeg is not on the default PATH here. Use `/Volumes/T7/work/irl-retrenchment/_tools` (final_build.sh exports it).
