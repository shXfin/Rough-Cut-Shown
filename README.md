# Rough Cut Shown

Tools that turn a Shown launch shoot (camera proxies, recorder audio, shooting script) into a Premiere rough cut. Built on top of the Socrates agent and the Claude Adobe bridge; tested on several launch shoots.

## Pipeline (one script per step, in order)

| Step | Script | What it does |
|---|---|---|
| Transcribe | `tools/transcribe.py` | Word-level transcript of recorder WAVs and camera proxies (faster-whisper) |
| Re-time words | `tools/align.py` | WhisperX forced alignment; word ends are ~80 ms later than Whisper says |
| Sync | `tools/textsync.py` | Sync cameras to the recorder by matching spoken words (waveform sync can fail when cameras run long) |
| Find takes | `tools/scrub.py` | Every take of every script line, using the slate to tell setups apart |
| Pick | `tools/pick.py` | Best take per line, keeping a running moment in one take |
| AI voice | `tools/fo_voice.py`, `tools/voice_takes.py` | Replace placeholder reads with the rendered AI-character voice files |
| Build | `tools/build_xml.py` | FCP XML for Premiere: cameras by role, clean per-line audio, room tone, section holds, markers. `CONFORM=1` builds it on the camera originals |
| Preview | `tools/render_preview.py` | Quick MP4 with plain-English labels |
| Measure | `tools/style.py` | Pacing stats of any rough cut, ours or an editor's |

## Install (Mac)

```bash
./install.sh
```

It sets up three things:
- **Claude Adobe bridge** (`bridge/`): the MCP server Claude calls (`server.mjs`) and the panel that runs the scripts inside Premiere Pro or After Effects. They share a secret token in `~/.claude-adobe-bridge/token`, made on first install and never committed. The panel only listens on 127.0.0.1.
- **Take Finder** (`panel-takefinder/`): the Premiere panel for swapping takes.
- **Debug mode** for unsigned panels (CSXS 9 to 12).

Then add the bridge to Claude Code with the command the script prints, restart Premiere, and open Window > Extensions > Claude Bridge and Take Finder.

## Take Finder

Works on any project, with nothing to set up per project.
- **Parent:** the full scrub, every take of every line, with line/take labels on a top track (PNG stills named like `L13_take2_AB.png`).
- **Child:** the sequence you're cutting: a Best 3 scrub or the rough cut. It needs at least two sequences in the project; the choice is remembered per project.
- **Show all takes:** select a clip in the child (or park the playhead on it). The panel matches it to the parent by media file and source time, so trims, slips and moves don't break it. It jumps the parent to that exact spot and lists every take of that line; click one to jump to it. **Back to child** returns to where you were.
- **Follow:** keeps the list updated as you play the child.

The old project-data panel (flags, rebuild button) is kept in `panel-takefinder/legacy/`.

## Rules

`rules-rough-cut-draft.md` holds every editing rule learned so far. It is meant to go into the agent's skill.

## Never committed

Footage, audio, transcripts, client scripts, exports and timelines never go in this repo: they stay in Aspect and on each editor's own drive (see `.gitignore`). Point the tools at wherever your project folder lives.
