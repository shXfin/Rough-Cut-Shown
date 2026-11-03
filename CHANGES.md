# Changes from Sam's Socrates agent

Running list for the daily sync: what we changed from Socrates (the starting point), why, and the proof.
Newest first. Each line: what changed · why · how we know it worked.

## Nov 3, 2026

**Tools and setup**
- **Pushed the pipeline to GitHub** (`shXfin/Rough-Cut-Shown`, private, Sam added). Code and rules only; no client footage, audio, scripts or transcripts.
- **Proxies straight from Aspect, shrunk to 540p** (`tools/fetch_proxies.sh`). Notch: 43 clips, 2 h of footage, 208 MB instead of 270 GB of originals. Nothing is created or changed on Aspect.
- **Recorder audio read straight from Aspect originals,** never copied, never proxies.
- **Installing (not used yet):** CrisperWhisper (catches "um"s and stumbles for take scoring), active speaker detection (who is talking on screen, for two-person shoots), MediaPipe (face, eyes, blinks). Will be added one at a time and measured.

**Learned on Notch (second test)**
- **Find the shooting script, not the latest draft.** Notch's script doc had V1 to V4; the "tele" (teleprompter) section is what was shot.
- **Check every clip for sound, not just the first.** Only 1 of 18 B cam proxies is silent; checking just the first file nearly triggered a 48 GB download.
- **Camera clocks can't be trusted:** Notch B cam reads 1 Jan 2000. Sync by matching words.

## Nov 2 to 3, 2026 (Wajo test, v01 to v11)

**Sync**
- **Sync by matching spoken words instead of waveforms.** Socrates' waveform sync locked 0 of 15 Wajo recorder files; word matching locked all of them.
- **Silent cameras are placed by camera timecode** and labelled "check sync" (Wajo A cam).

**Script and take finding**
- **Use the slate** ("hook two, take one") to tell setups apart. Hook 1 and Hook 2 share lines and were getting mixed up.
- **Ignore everything before the first slate** (sound checks matched short script lines).
- **On-set rewrites count as takes,** flagged yellow.
- **Numbers normalised** ("twelve thirty" = "12:30"), Spanish numbers too.
- **A take never opens mid-sentence;** matches grow to the sentence start.

**Picking takes**
- **Keep a running moment in one take** (Socrates picks each line on its own). Fixed the hook being stitched from take 3 into take 1 mid-phrase.
- **Continuity never rescues a bad take** (it let a flubbed "...the last week" in).

**Sound** (Socrates phase 8 cleans per line; these are on top)
- **WhisperX word timing.** Whisper ends 89% of words ~80 ms too early, which is what clipped last syllables.
- **Cut in real silence, never inside the neighbouring words;** keep run-on words ("for a year now").
- **Right mic per speaker:** founder's lav (~10 dB cleaner), mix for anyone off-mic (they came out silent on the lav).
- **Back-to-back lines from one take stay one unbroken piece of sound;** only the picture cuts.
- **Real AI-character voice files** replace the crew's placeholder reads; the placeholders' room hiss was what made it feel abrupt.
- **Room tone bed under the whole cut,** background matched between words, soft limiting. Result: 0 clipped samples, no background jumps.
- **Every render is checked by transcript** end to end before an editor sees it.

**Picture**
- **Cameras chosen by role, not letter** (Socrates: A for hooks, C for demos). Show whoever is talking.
- **Empty-chair check** on locked-off shots: switch to the camera that follows her.
- **Hold the shot like Shown's editors** (measured from Rayline and Notch rough cuts): camera cuts down from 26 to 16, typical shot 4.7 s to 9.8 s.
- **Section holds of 2 s** with "Trim point" markers, so the next editor has room.

**Premiere**
- **Plain-English labels** ("Hook · Take 2 of 4 · B cam · needs a look") instead of "L10 T2/4 B".
- **All angles stacked on tracks,** pick switched on (real multicam still needs the offset fix after XML import).
- **4K conform version** on the Aspect originals; exported 1080p through Media Encoder.
- **One audio folder per version,** so rebuilding never changes a sequence already in Premiere.

**Housekeeping**
- **Clean up when a project is done;** caches are the editor's call.

## Open (not done yet)
- Face-jump fix at same-camera cuts (v12): face detection, switch angle or punch in with no black edges.
- Wajo A cam lip sync still unverified.
- Notch blind cut, compared by Shafin against Notch Rough Cut V2.
- One-command runner so anyone can use it (Andrii's ask); Shownroom page after that.

## 2026-11-04 (Notch)
- build_scrub.py: scrub (every take, labelled, A over B) and rough cut from picks. 16:9 1080p, cameras fill height.
  Clean sound per piece (hum, noise, sibilance, level), speaker's own mic per piece, visible fades (volume keyframes).
  Prints WARNING and marks `NO B CAM` on any take a camera is missing from.
- textsync.py: keeps every camera clip that matches a recorder file (cameras restart mid-take). verify_sync.py confirms each.
- fix_stretched.py: re-listens to takes where Whisper stretched a word over missed speech.
- pick.py: takes with no real voice (12 dB under the others) are never picked.
- fetch_proxies.sh: proxies tagged square pixels (Premiere stretched cinema-width proxies).
