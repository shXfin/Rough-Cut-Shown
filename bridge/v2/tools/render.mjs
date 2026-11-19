// Full-quality frames and short ranges (sequence or a clip's own source), with optional WAV.
import fsp from "node:fs/promises";
import path from "node:path";
import * as P from "../lib/premiere.mjs";
import { seqClock, clipRef, when, round } from "../lib/common.mjs";
import { makeClock, TPS } from "../lib/timecode.mjs";
import { requireTool, runTool, stamp, safeName, exists } from "../lib/files.mjs";
import { startJob, withActivity, publicJob } from "../lib/jobs.mjs";

const MAX_DIRECT_SECONDS = 30;
let presetCache = null;

async function proresPreset(ctx, override) {
  if (override) return ctx.expandHome(override);
  if (presetCache) return presetCache;
  const all = await ctx.findExportPresets();
  const pick = (re) => all.find((p) => re.test(path.basename(p)));
  presetCache = pick(/^Apple ProRes 422 HQ\.epr$/i) || pick(/ProRes 422 HQ\.epr$/i) || pick(/^Apple ProRes 422\.epr$/i) || null;
  if (!presetCache) throw new Error("No Apple ProRes 422 HQ export preset (.epr) found. Pass preset_path (premiere_export with list_presets: true lists them).");
  return presetCache;
}

async function probe(file) {
  const ffprobe = requireTool("ffprobe");
  const { stdout } = await runTool(ffprobe, ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=width,height,nb_read_packets,r_frame_rate", "-of", "json", file], { timeoutMs: 120000 });
  const s = (JSON.parse(stdout).streams || [])[0] || {};
  return { width: s.width, height: s.height, frames: Number(s.nb_read_packets) || 0, rate: s.r_frame_rate };
}

/** Group frame numbers into renders: frames within `gap` of each other share one render. */
function clusters(frames, gap) {
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  const out = [];
  for (const f of sorted) {
    const last = out[out.length - 1];
    if (last && f - last[last.length - 1] <= gap) last.push(f);
    else out.push([f]);
  }
  return out;
}

/** Extract frames (indices into the movie) to PNG files, in order. */
async function extract(movie, indices, names) {
  const ffmpeg = requireTool("ffmpeg");
  const dir = path.dirname(names[0]);
  const tmpPattern = path.join(dir, `.x-${process.pid}-${Date.now()}-%04d.png`);
  const sel = indices.map((k) => `eq(n\\,${k})`).join("+");
  await runTool(ffmpeg, ["-v", "error", "-y", "-i", movie, "-vf", `select='${sel}'`, "-fps_mode", "vfr", "-pix_fmt", "rgb24", tmpPattern], { timeoutMs: 300000 });
  const made = [];
  for (let i = 0; i < names.length; i++) {
    const src = tmpPattern.replace("%04d", String(i + 1).padStart(4, "0"));
    if (await exists(src)) {
      await fsp.rename(src, names[i]);
      made.push(names[i]);
    } else made.push(null);
  }
  return made;
}

async function extractWav(movie, out) {
  const ffmpeg = requireTool("ffmpeg");
  await runTool(ffmpeg, ["-v", "error", "-y", "-i", movie, "-vn", "-c:a", "pcm_s24le", out], { timeoutMs: 300000 });
  return out;
}

async function waitForMovie(file, timeoutMs, ctxJob) {
  const t0 = Date.now();
  let lastSize = -1;
  while (Date.now() - t0 < timeoutMs) {
    if (ctxJob) await ctxJob.pause(2000);
    else await new Promise((r) => setTimeout(r, 2000));
    let size = -1;
    try {
      size = (await fsp.stat(file)).size;
    } catch {}
    if (size > 0 && size === lastSize) {
      try {
        const p = await probe(file);
        if (p.frames > 0) return p;
      } catch {}
    }
    lastSize = size;
    if (ctxJob) ctxJob.progress(null, null, `waiting for Media Encoder (${Math.round(size / 1e6)} MB so far)`);
  }
  throw new Error(`Media Encoder didn't finish ${path.basename(file)} in time. Check its queue.`);
}

/**
 * The shared pipeline: render one or more clusters of a sequence and pull out frames / WAV.
 * frames: frame numbers (sequence-relative); wavRange: [firstFrame, lastFrame] or null
 */
async function renderPipeline(ctx, { seqId, clock, seqName, frames, wavRange, outDir, preset, mute, useProxies, method, keepMovie, job }) {
  const ft = clock.frameTicks;
  const groups = frames.length ? clusters(frames, Math.round(clock.fps * 2)) : [];
  if (wavRange) {
    // the WAV range gets its own render unless a frame cluster already covers it
    const covered = groups.some((g) => g[0] <= wavRange[0] && g[g.length - 1] >= wavRange[1]);
    if (!covered) groups.push([wavRange[0], wavRange[1]]);
  }
  const results = { frames: [], wav: null, movies: [], media: [], notes: [] };
  let gi = 0;
  for (const g of groups) {
    gi++;
    const first = g[0];
    const last = g[g.length - 1];
    const seconds = ((last - first + 1) * ft) / TPS;
    const useAme = method === "ame" || (method !== "direct" && seconds > MAX_DIRECT_SECONDS);
    if (useAme && !job) throw new Error(`That range is ${Math.round(seconds)} s long; ranges over ${MAX_DIRECT_SECONDS} s render through Media Encoder. Pass as_job: true (then poll premiere_job_status).`);
    const movie = path.join(outDir, `${safeName(seqName, 40)}_${clock.tc(first * ft).replace(/[:;]/g, "-")}_${stamp()}.mov`);
    // Mid-frame in/out: the first rendered frame is exactly `first`, the last exactly `last`.
    const inT = first * ft + Math.round(ft / 2);
    const outT = (last + 1) * ft + Math.round(ft / 2);
    if (job) job.progress(gi - 1, groups.length, `rendering ${clock.tc(first * ft)}-${clock.tc(last * ft)}`);
    let info;
    if (useAme) {
      info = await P.call("v2_queue_ame", { sequence_id: seqId, in: inT, out: outT, path: movie, preset }, { timeoutMs: 120000, label: "render (AME)" });
      results.notes.push("Rendered through Media Encoder (Premiere stays free). Proxies follow Media Encoder's own setting.");
      await waitForMovie(movie, 10 * 60 * 1000 + seconds * 20000, job);
    } else {
      info = await P.call(
        "v2_render_range",
        { sequence_id: seqId, in: inT, out: outT, path: movie, preset, mute_tracks: mute, use_proxies: !!useProxies },
        { timeoutMs: Math.max(120000, seconds * 30000), label: "render" }
      );
      if (info.notes && info.notes.length) results.notes.push(...info.notes);
      results.media.push(...(info.media || []));
    }
    const pr = await probe(movie);
    const expected = last - first + 1;
    if (pr.frames < expected) results.notes.push(`The render has ${pr.frames} frames, expected ${expected}: the last frame(s) may be missing.`);
    const want = g.filter((f) => frames.includes(f));
    if (want.length) {
      const names = want.map((f) => path.join(outDir, `${safeName(seqName, 40)}_${clock.tc(f * ft).replace(/[:;]/g, "-")}_f${f}.png`));
      const made = await extract(movie, want.map((f) => f - first), names);
      want.forEach((f, i) => results.frames.push({ timecode: clock.tc(f * ft), seconds: round((f * ft) / TPS), frame: f, path: made[i], size: `${pr.width}x${pr.height}` }));
    }
    if (wavRange && first <= wavRange[0] && last >= wavRange[1] && !results.wav) {
      results.wav = await extractWav(movie, movie.replace(/\.mov$/, ".wav"));
    }
    if (keepMovie) results.movies.push(movie);
    else await fsp.rm(movie, { force: true });
  }
  if (job) job.progress(groups.length, groups.length, "done");
  return results;
}

async function withPreviews(ctx, res, n) {
  const content = [];
  const imgs = res.frames.filter((f) => f.path).slice(0, n);
  for (const f of imgs) content.push(await ctx.imageContent(f.path));
  content.push({ type: "text", text: JSON.stringify(res, null, 2) });
  return { content };
}

function framesFrom(clock, a, ft) {
  let frames = [];
  if (a.times && a.times.length) frames = a.times.map((t) => clock.floorFrame(clock.parse(t, "time")));
  let wavRange = null;
  if (a.start !== undefined || a.end !== undefined) {
    const s = clock.floorFrame(clock.parse(a.start ?? 0, "start"));
    const e = clock.floorFrame(clock.parse(a.end ?? a.start, "end"));
    if (e < s) throw new Error("end is before start.");
    const step = a.step_frames || (e - s <= Math.round(clock.fps * 2) ? 1 : Math.max(1, Math.round(clock.fps / 2)));
    if (a.frames !== false) for (let f = s; f <= e; f += step) frames.push(f);
    if (a.wav) wavRange = [s, e];
  } else if (a.wav && frames.length) {
    wavRange = [Math.min(...frames), Math.max(...frames)];
  }
  const max = a.max_frames ?? 120;
  if (frames.length > max) throw new Error(`That's ${frames.length} frames; the limit is ${max}. Use a bigger step_frames or pass max_frames.`);
  if (!frames.length && !wavRange) throw new Error("Pass times (frames to grab) or start/end (a range).");
  return { frames, wavRange };
}

export function register(def, ctx) {
  const { z, S } = ctx;
  const common = {
    times: z.array(S.Time).optional().describe("Frames to grab (sequence times)"),
    start: S.Time.optional().describe("Range start (renders the range; frames every step_frames)"),
    end: S.Time.optional().describe("Range end (inclusive frame)"),
    step_frames: z.number().int().min(1).optional().describe("In a range, grab every Nth frame (default: every frame up to 2 s, else 2 per second)"),
    frames: z.boolean().optional().describe("false = no PNGs from the range (e.g. only the WAV)"),
    max_frames: z.number().int().optional(),
    wav: z.boolean().optional().describe("Also write a 24-bit WAV of the range"),
    preview: z.number().int().min(0).max(6).optional().describe("How many frames to show inline (default 2; full-size files are always written)"),
    output_dir: z.string().optional().describe("Where to write (default: a temp folder)"),
    keep_movie: z.boolean().optional().describe("Keep the ProRes render too"),
    preset_path: z.string().optional().describe("Export preset (.epr); default Apple ProRes 422 HQ (matches the sequence size)")
  };

  def(
    "premiere_render_frames",
    "Full-quality stills (and optionally a WAV) of a sequence: renders the frames at full resolution with an Apple ProRes 422 HQ preset (not the soft Program-monitor preview), then extracts PNGs with ffmpeg. Proxies are switched off for the render and back on after; the result says which media each clip rendered from. The sequence In/Out is set with mid-frame times so the first frame is exact, and put back exactly afterwards (including 'not set'). mute_tracks gives a 'clean plate' (e.g. [\"V3\"] hides labels), unmuted after. Ranges over 30 s render through Media Encoder as a job.",
    {
      ...S.Common,
      ...common,
      mute_tracks: z.array(z.string()).optional().describe('Tracks to switch off just for this render, e.g. ["V3", "A2"]'),
      use_proxies: z.boolean().optional().describe("Render from proxies (default false: originals)"),
      method: z.enum(["direct", "ame"]).optional().describe("direct = render in Premiere (blocks Premiere for the render); ame = Media Encoder (needs as_job)"),
      as_job: z.boolean().optional().describe("Run in the background and return a job id (poll premiere_job_status)")
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const { frames, wavRange } = framesFrom(clock, a, clock.frameTicks);
      const preset = await proresPreset(ctx, a.preset_path);
      const outDir = a.output_dir ? ctx.expandHome(a.output_dir) : path.join(ctx.FRAME_DIR, `render-${stamp()}`);
      await fsp.mkdir(outDir, { recursive: true });
      const opts = { seqId: info.id, clock, seqName: info.name, frames, wavRange, outDir, preset, mute: a.mute_tracks || [], useProxies: a.use_proxies, method: a.method, keepMovie: a.keep_movie };
      if (a.as_job) {
        const job = startJob("render", `Render ${frames.length} frame(s) of "${info.name}"`, (j) => renderPipeline(ctx, { ...opts, job: j }));
        return { job: publicJob(job), note: "Poll premiere_job_status with this job_id (wait_s up to 50)." };
      }
      const res = await withActivity(`rendering frames of "${info.name}"`, () => renderPipeline(ctx, opts));
      res.sequence = info.name;
      res.preset = path.basename(preset);
      return withPreviews(ctx, res, a.preview ?? 2);
    }
  );

  def(
    "premiere_render_source",
    "A timeline clip's own source at native resolution, with that clip's effects (Lumetri etc.) copied on: builds a temporary sequence from the clip's media (so the frame size and rate are the camera's, not the sequence's), copies the effects, renders full quality, extracts PNG/WAV, then deletes the temporary sequence. Motion/Opacity aren't copied unless copy_motion is true (they're framed for the sequence). Use times inside the clip on the sequence, or source_seconds.",
    {
      ...S.Common,
      clip: S.ClipRef,
      ...common,
      source_seconds: z.array(z.number()).optional().describe("Frames by source media time (seconds from the media's first frame) instead of sequence times"),
      copy_effects: z.boolean().optional().describe("Copy the clip's effects (default true)"),
      copy_motion: z.boolean().optional().describe("Also copy Motion/Opacity (default false)"),
      effects: z.array(z.string()).optional().describe('Only these effects, e.g. ["Lumetri Color"]')
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const ref = clipRef(clock, a.clip);
      const preset = await proresPreset(ctx, a.preset_path);
      const outDir = a.output_dir ? ctx.expandHome(a.output_dir) : path.join(ctx.FRAME_DIR, `source-${stamp()}`);
      await fsp.mkdir(outDir, { recursive: true });
      return withActivity(`rendering source of a clip in "${info.name}"`, async () => {
        const prep = await P.call(
          "v2_source_prepare",
          { sequence_id: info.id, clip: ref, copy_effects: a.copy_effects !== false, copy_motion: !!a.copy_motion, effects: a.effects || null },
          { timeoutMs: 120000, label: "source render: prepare" }
        );
        try {
          const tclock = makeClock({ timebase: prep.timebase, zeroPoint: 0 });
          const src = prep.source;
          const toTemp = (srcTicks) => prep.clip_start + (srcTicks - prep.clip_in);
          const fromSeq = (seqTicks) => src.in + Math.round((seqTicks - src.start) * (src.speed || 1));
          let frames = [];
          if (a.source_seconds && a.source_seconds.length) frames = a.source_seconds.map((s) => tclock.floorFrame(toTemp(Math.round(s * TPS))));
          if (a.times && a.times.length) frames.push(...a.times.map((t) => tclock.floorFrame(toTemp(fromSeq(clock.parse(t, "time"))))));
          let wavRange = null;
          if (a.start !== undefined || a.end !== undefined) {
            const s = tclock.floorFrame(toTemp(fromSeq(clock.parse(a.start ?? 0, "start"))));
            const e = tclock.floorFrame(toTemp(fromSeq(clock.parse(a.end ?? a.start, "end"))));
            const step = a.step_frames || (e - s <= Math.round(tclock.fps * 2) ? 1 : Math.max(1, Math.round(tclock.fps / 2)));
            if (a.frames !== false) for (let f = s; f <= e; f += step) frames.push(f);
            if (a.wav) wavRange = [s, e];
          }
          if (!frames.length && !wavRange) throw new Error("Pass times, source_seconds, or start/end.");
          const maxF = tclock.floorFrame(prep.clip_end - 1);
          const bad = frames.filter((f) => f < 0 || f > maxF);
          if (bad.length) throw new Error("Some of those times are outside the clip's media.");
          const res = await renderPipeline(ctx, { seqId: prep.temp_id, clock: tclock, seqName: path.basename(src.media || "source"), frames, wavRange, outDir, preset, mute: [], useProxies: false, method: "direct", keepMovie: a.keep_movie });
          res.source = { media: src.media, native_size: `${prep.width}x${prep.height}`, rate: tclock.rate };
          res.effects = prep.effects;
          for (const f of res.frames) f.source_seconds = round(((f.frame * tclock.frameTicks) - prep.clip_start + prep.clip_in) / TPS);
          return withPreviews(ctx, res, a.preview ?? 2);
        } finally {
          await P.call("v2_source_cleanup", { temp_id: prep.temp_id, active: prep.active }, { label: "source render: clean up" }).catch(() => {});
        }
      });
    }
  );
}

export const _test = { clusters, framesFrom, when };
