# Rough Cut Shown

Tools that turn a Shown launch shoot (camera proxies, recorder audio, shooting script) into a Premiere rough cut. Built on top of Sam's Socrates agent and his Claude Adobe bridge; tested first on Wajo.

## Pipeline (one script per step, in order)

| Step | Script | What it does |
|---|---|---|
| Transcribe | `tools/transcribe.py` | Word-level transcript of recorder WAVs and camera proxies (faster-whisper) |
| Re-time words | `tools/align.py` | WhisperX forced alignment; word ends are ~80 ms later than Whisper says |
| Sync | `tools/textsync.py` | Sync cameras to the recorder by matching spoken words (waveform sync failed on Wajo) |
| Find takes | `tools/scrub.py` | Every take of every script line, using the slate to tell setups apart |
| Pick | `tools/pick.py` | Best take per line, keeping a running moment in one take |
| AI voice | `tools/fo_voice.py`, `tools/voice_takes.py` | Replace placeholder reads with the rendered AI-character voice files |
| Build | `tools/build_xml.py` | FCP XML for Premiere: cameras by role, clean per-line audio, room tone, section holds, markers. `CONFORM=1` builds it on the camera originals |
| Preview | `tools/render_preview.py` | Quick MP4 with plain-English labels |
| Measure | `tools/style.py` | Pacing stats of any rough cut, ours or an editor's |

## Rules

`rules-rough-cut-draft.md` holds every editing rule learned so far. It is meant to go into the agent's skill.

## Never committed

Footage, audio, transcripts, client scripts, exports and timelines never go in this repo: they stay in Aspect and on each editor's own drive (see `.gitignore`). Point the tools at wherever your project folder lives.
