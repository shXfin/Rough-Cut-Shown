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
