// Captions from word-level transcripts, word search, and a bleep pass on a copy of the sequence.
import fsp from "node:fs/promises";
import path from "node:path";
import * as P from "../lib/premiere.mjs";
import { seqClock } from "../lib/common.mjs";
import { TPS } from "../lib/timecode.mjs";
import { loadTranscripts } from "../lib/transcripts.mjs";
import { mapWordsToSequence, buildCues, toSrt, findWords, bleepRanges } from "../lib/captions.mjs";
import { nextVersionPath, outputFolder, requireTool, runTool, safeName, exists } from "../lib/files.mjs";
import { startJob, withActivity, publicJob } from "../lib/jobs.mjs";
import { dbToLevel } from "./effects.mjs";

const trackIndex = (label) => {
  const m = String(label).trim().match(/^[Aa](\d+)$/);
  if (!m) throw new Error(`"${label}" isn't an audio track. Use A1, A2, ...`);
  return Number(m[1]) - 1;
};

async function sequenceWords(ctx, a) {
  const { info, clock } = await seqClock(a.sequence_id);
  const transcripts = await loadTranscripts(a.transcripts, ctx.expandHome);
  const ac = await P.call("v2_audio_clips", { sequence_id: info.id }, { timeoutMs: 120000 });
  const clips = ac.clips.map((c) => ({ ...c, start: c.start / TPS, end: c.end / TPS, in: c.in / TPS, out: c.out / TPS }));
  const mapped = mapWordsToSequence(clips, transcripts, {
    tracks: a.tracks ? a.tracks.map(trackIndex) : null,
    prefer_tracks: a.prefer_tracks ? a.prefer_tracks.map(trackIndex) : null,
    include_muted_tracks: a.include_muted_tracks,
    include_disabled_clips: a.include_disabled_clips,
    speaker_map: a.speaker_map
  });
  return { info, clock, mapped, transcripts };
}

export function register(def, ctx) {
  const { z, S } = ctx;
  const source = {
    ...S.Common,
    transcripts: z
      .union([z.string(), z.array(z.string()), z.record(z.string(), z.string())])
      .describe('Word-level transcript JSON (WhisperX, or [{w|word, start, end}]): a folder, a list of files, or { "<media file or name>": "<transcript.json>" }. Matched to clips by media file name (proxy/original names both work).'),
    tracks: z.array(z.string()).optional().describe('Only these audio tracks, e.g. ["A1"]'),
    prefer_tracks: z.array(z.string()).optional().describe('When the same words are on several tracks (lav + camera), keep these first (default: lowest track)'),
    include_muted_tracks: z.boolean().optional(),
    include_disabled_clips: z.boolean().optional(),
    speaker_map: z.record(z.string(), z.string()).optional().describe('Speaker names: keys match the transcript speaker label, clip name, media file name or track, * allowed. e.g. { "SPEAKER_00": "ANA", "A2": "HOST", "*Wireless*": "ANA" }')
  };

  def(
    "premiere_captions_from_transcripts",
    "Build captions for a sequence from the word-level transcripts of its source files: maps every audio clip back to its source words (in points, trims, speed changes; skips disabled clips, muted tracks and reversed clips; one copy when lav and camera carry the same speech), writes an SRT (speaker labels when there's more than one speaker or speaker_map is given), imports it and creates a caption track. Run it again after edits: it writes the next version of the SRT and a new caption track (delete or hide the old track by hand: scripts can't delete caption tracks). Caption styling (font, size, position) isn't reachable by script: apply a saved Track Style once in the Properties/Essential Graphics panel.",
    {
      ...source,
      max_chars_per_line: z.number().int().min(10).optional().describe("Default 42"),
      max_lines: z.number().int().min(1).max(3).optional().describe("Default 2"),
      max_duration: z.number().positive().optional().describe("Longest cue in seconds (default 6)"),
      min_duration: z.number().positive().optional().describe("Shortest cue (default 0.8)"),
      max_gap: z.number().positive().optional().describe("A pause longer than this starts a new cue (default 0.8 s)"),
      speaker_labels: z.union([z.boolean(), z.literal("auto")]).optional(),
      label_style: z.enum(["colon", "brackets"]).optional().describe('"ANA: hi" (default) or "[ANA] hi"'),
      output_dir: z.string().optional().describe("Default: <project folder>/Claude Bridge/captions"),
      create_caption_track: z.boolean().optional().describe("Default true; false = only write the SRT"),
      preview: z.number().int().min(0).max(50).optional().describe("How many cues to show (default 8)")
    },
    async (a) => {
      const { info, clock, mapped } = await sequenceWords(ctx, a);
      if (!mapped.words.length) throw new Error(`No words landed in "${info.name}". Clips skipped: ${JSON.stringify(mapped.skipped.slice(0, 10))}`);
      const cues = buildCues(mapped.words, a);
      const srt = toSrt(cues);
      const proj = (await P.call("v2_info", { sequence_id: info.id })).projectPath;
      const dir = await outputFolder("captions", proj, a.output_dir ? ctx.expandHome(a.output_dir) : null);
      let file = path.join(dir, `${safeName(info.name)}_captions.srt`);
      if (await exists(file)) file = await nextVersionPath(file);
      await fsp.writeFile(file, srt);
      const out = {
        sequence: info.name,
        srt: file,
        cues: cues.length,
        words: mapped.words.length,
        estimated_word_times: mapped.words.filter((w) => w.estimated).length || undefined,
        speakers: [...new Set(cues.map((c) => c.speaker).filter(Boolean))],
        clips_used: mapped.used.length,
        clips_skipped: mapped.skipped.length ? mapped.skipped : undefined,
        first_cues: cues.slice(0, a.preview ?? 8).map((c) => ({ start: clock.tc(Math.round(c.start * TPS)), end: clock.tc(Math.round(c.end * TPS)), text: c.text }))
      };
      if (a.create_caption_track !== false) {
        const r = await withActivity(`adding captions to "${info.name}"`, () => P.call("v2_caption_track", { sequence_id: info.id, path: file, start: 0, bin: "Claude captions" }));
        out.caption_track = r.created ? `created from ${r.item}` : r;
      }
      return out;
    }
  );

  def(
    "premiere_find_words",
    "Find words or short phrases in the cut (case-insensitive, * wildcard: \"fuck*\") using the source transcripts, with exact sequence times, the clip/track they're on and some context. Handy for a bleep pass, or to jump to a line.",
    { ...source, words: z.array(z.string()).min(1).describe('e.g. ["fuck*", "shit*", "oh my god"]') },
    async (a) => {
      const { info, clock, mapped } = await sequenceWords(ctx, a);
      const hits = findWords(mapped.words, a.words);
      return {
        sequence: info.name,
        hits: hits.map((h) => ({ word: h.text, start: clock.tc(Math.round(h.start * TPS)), end: clock.tc(Math.round(h.end * TPS)), start_s: Math.round(h.start * 1000) / 1000, end_s: Math.round(h.end * 1000) / 1000, track: `A${h.track + 1}`, clip: h.clip, speaker: h.speaker || undefined, context: h.context, ...(h.estimated ? { estimated_time: true } : {}) })),
        count: hits.length,
        clips_skipped: mapped.skipped.length ? mapped.skipped.length : undefined
      };
    }
  );

  def(
    "premiere_bleep",
    "Bleep listed words in a COPY of the sequence (the original is never touched): finds them from the transcripts, keeps the first letter audible (keep_first_ms), ducks the dialogue under each word with Volume keyframes (sample-accurate ramps), and places a generated tone on a free audio track (adds one to the copy when none is free). Returns the new sequence and every bleep with its timecode. Runs as a job when there are many words (as_job).",
    {
      ...source,
      words: z.array(z.string()).min(1),
      new_name: z.string().optional().describe('Default "<sequence> (bleeped)"'),
      bleep_track: z.string().optional().describe("Audio track for the tone (default: the first one free under every bleep)"),
      duck_tracks: z.array(z.string()).optional().describe("Tracks to duck (default: every track a hit was found on)"),
      keep_first_ms: z.number().min(0).max(300).optional().describe("Audible start of the word (default 70 ms, at most 35% of the word)"),
      pad_after_ms: z.number().min(0).max(300).optional().describe("Bleep runs this much past the word (default 30)"),
      duck_db: z.number().optional().describe("Dialogue level under the bleep in dB (default: silent)"),
      tone_hz: z.number().positive().optional().describe("Default 1000"),
      tone_db: z.number().max(0).optional().describe("Tone peak level in dBFS (default -14)"),
      output_dir: z.string().optional(),
      as_job: z.boolean().optional()
    },
    async (a) => {
      const work = async (job) => {
        const { info, clock, mapped } = await sequenceWords(ctx, a);
        const hits = findWords(mapped.words, a.words);
        if (!hits.length) return { sequence: info.name, bleeps: 0, note: "None of those words are in the cut." };
        const ranges = bleepRanges(hits, a);
        if (job) job.progress(0, 4, "copying the sequence");
        const copy = await P.call("v2_clone", { sequence_id: info.id, name: a.new_name || `${info.name} (bleeped)` });
        // tone file (deterministic name; reused, never rewritten)
        const proj = (await P.call("v2_info", { sequence_id: copy.id })).projectPath;
        const dir = await outputFolder("bleeps", proj, a.output_dir ? ctx.expandHome(a.output_dir) : null);
        const hz = a.tone_hz || 1000;
        const db = a.tone_db ?? -14;
        const longest = Math.ceil(Math.max(...ranges.map((r) => r.end - r.start)) + 1);
        // tone_db is the peak level. (ffmpeg's sine source peaks at 1/8, about -18 dBFS, so a full-scale sine is
        // made with aevalsrc instead.)
        const tone = path.join(dir, `bleep_${hz}Hz_${db}dBFS-peak_${Math.max(10, longest)}s.wav`);
        if (!(await exists(tone))) {
          await runTool(requireTool("ffmpeg"), ["-v", "error", "-f", "lavfi", "-i", `aevalsrc=sin(2*PI*${hz}*t):s=48000:d=${Math.max(10, longest)}`, "-af", `volume=${db}dB,afade=t=in:d=0.004,areverse,afade=t=in:d=0.004,areverse`, "-c:a", "pcm_s24le", tone]);
        }
        // pick the tone track
        if (job) job.progress(1, 4, "finding a free track");
        const ac = await P.call("v2_audio_clips", { sequence_id: copy.id });
        let tIdx;
        let trackAdded = null;
        if (a.bleep_track) tIdx = trackIndex(a.bleep_track);
        else {
          const busy = new Set();
          for (const c of ac.clips) for (const r of ranges) if (c.start / TPS < r.end && c.end / TPS > r.start) busy.add(c.track);
          const hitTracks = new Set(hits.map((h) => h.track));
          tIdx = ac.tracks.map((t) => t.index).find((i) => !busy.has(i) && !hitTracks.has(i));
          if (tIdx === undefined) {
            // none free: add one to the copy (never to the original)
            const added = await P.call("v2_add_audio_track", { sequence_id: copy.id });
            tIdx = added.index;
            trackAdded = added.track;
          }
        }
        const duck = a.duck_tracks ? a.duck_tracks : [...new Set(hits.map((h) => `A${h.track + 1}`))];
        if (job) job.progress(2, 4, `ducking ${ranges.length} words`);
        const level = a.duck_db !== undefined ? dbToLevel(a.duck_db) : 0;
        const d = await P.call("v2_duck", { sequence_id: copy.id, ranges: ranges.map((r) => ({ start: Math.round(r.start * TPS), end: Math.round(r.end * TPS) })), tracks: duck, level, ramp: Math.round(0.008 * TPS) }, { timeoutMs: 180000, label: "bleep: duck" });
        if (job) job.progress(3, 4, `placing ${ranges.length} bleeps`);
        const pl = await P.call(
          "v2_place_audio",
          { sequence_id: copy.id, source: { path: tone, bin: "Claude bleeps" }, track: `A${tIdx + 1}`, placements: ranges.map((r) => ({ at: Math.round(r.start * TPS), src_in: 0, src_out: Math.round((r.end - r.start) * TPS) })) },
          { timeoutMs: 180000, label: "bleep: place tones" }
        );
        return {
          original: info.name,
          bleeped_copy: copy.name,
          bleeped_copy_id: copy.id,
          tone_track: `A${tIdx + 1}`,
          ...(trackAdded ? { tone_track_added: `${trackAdded} was added to the copy for the tones (no audio track was free under every bleep)` } : {}),
          ducked_tracks: duck,
          ducked_clip_ranges: d.ducked,
          tone_file: tone,
          bleeps: ranges.map((r, i) => ({ words: r.words.join(" "), start: clock.tc(Math.round(r.start * TPS)), start_s: Math.round(r.start * 1000) / 1000, end_s: Math.round(r.end * 1000) / 1000, placed_at: pl.placed[i] ? clock.tc(pl.placed[i].start) : null })),
          note: "Clips on the timeline start on whole frames, so a tone can start up to one frame after the duck; the duck itself is exact."
        };
      };
      if (a.as_job) {
        const job = startJob("bleep", `Bleep pass on ${a.sequence_id || "the active sequence"}`, (j) => work(j));
        return { job: publicJob(job) };
      }
      return withActivity("bleep pass (on a copy)", () => work(null));
    }
  );
}
