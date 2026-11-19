// End-to-end test of the bridge (v1 + v2) inside Premiere, on a SCRATCH project only.
//
//   node bridge/test/scratch-premiere.mjs <scratch folder> [section ...]
//
// <scratch folder> holds media/ (bars.mov, cam4.mov, speech_ana.wav, speech_dan.wav) and transcripts/.
// It copies Premiere's own blank "Standard Template Project" there, opens it next to whatever is open, runs the
// tests, and closes it again. Before every step it checks that the active project IS the scratch project and
// stops if not, so nothing runs against another project. Sections: open v1 timecode render edits place source
// speed effects keys keys2 transitions batch fades rtrans markers media captions bleep title jobs jobs2 errors ame close
// (default: all but ame).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..", "server.mjs");
const ROOT = path.resolve(process.argv[2] || "");
const ALL = ["open", "v1", "timecode", "render", "edits", "place", "source", "speed", "effects", "keys", "keys2", "transitions", "batch", "fades", "rtrans", "markers", "media", "captions", "bleep", "title", "jobs", "jobs2", "errors", "close"];
const want = process.argv.slice(3).length ? process.argv.slice(3) : ALL;
if (!fs.existsSync(path.join(ROOT, "media", "bars.mov"))) {
  console.error("Usage: node scratch-premiere.mjs <scratch folder with media/ and transcripts/> [sections]");
  process.exit(2);
}
const PROJ = path.join(ROOT, "ClaudeBridgeV2_scratch.prproj");
const STATE = path.join(ROOT, "state.json");
const TMP = path.join(ROOT, "tmp");
fs.mkdirSync(TMP, { recursive: true });
const M = (f) => path.join(ROOT, "media", f);
let state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 1));
let pass = 0;
let failed = 0;
const fails = [];

function ok(cond, what, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${what}`);
  } else {
    failed++;
    fails.push(what);
    console.log(`  FAIL  ${what}${detail !== undefined ? `\n        ${typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 900)}` : ""}`);
  }
}

function run(args, input) {
  const r = spawnSync(process.execPath, [SERVER, ...args], { encoding: "utf8", input, maxBuffer: 64 << 20, timeout: 15 * 60 * 1000 });
  return { code: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function jsx(code) {
  const f = path.join(TMP, `s${Date.now()}${Math.random().toString(36).slice(2, 6)}.jsx`);
  fs.writeFileSync(f, code);
  const r = run(["eval", "ppro", "--file", f]);
  if (r.code !== 0) throw new Error(r.err || r.out);
  try {
    return JSON.parse(r.out);
  } catch {
    return r.out;
  }
}

function guard() {
  const p = jsx("app.project ? app.project.path : ''");
  if (path.resolve(String(p)) !== path.resolve(PROJ)) {
    console.error(`\nSTOP: the active project is not the scratch project (it's ${p}). Nothing else will run.`);
    process.exit(3);
  }
}

/** Call a bridge tool through the server's command line. Returns { error, data, images }. */
function tool(name, args, { noGuard } = {}) {
  if (!noGuard) guard();
  const f = path.join(TMP, `a${Date.now()}.json`);
  fs.writeFileSync(f, JSON.stringify(args || {}));
  const r = run(["call", name, "--file", f]);
  const lines = r.out.split("\n");
  const images = lines.filter((l) => /^\[image/.test(l)).length;
  const text = lines.filter((l) => !/^\[image/.test(l)).join("\n");
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { error: r.code !== 0 ? text || r.err : null, data, images, raw: text };
}

/** premiere_read_timeline that stops the section with the real error if the read fails. */
function tlRead(args) {
  const r = tool("premiere_read_timeline", args);
  if (r.error || !r.data || !r.data.sequence) throw new Error(`premiere_read_timeline failed: ${r.error || r.raw}`);
  return r;
}

const TPS = 254016000000;
function decodeFrame(png, blockW) {
  // 10 blocks across the top 100 px encode the source frame number in binary (black 0 / white 1)
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", png, "-vf", "crop=iw:1:0:50,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
  const row = r.stdout;
  let n = 0;
  for (let b = 0; b < 10; b++) {
    const x = Math.round((b + 0.5) * blockW * (row.length / (blockW * 10)));
    if (row[x] > 128) n |= 1 << b;
  }
  return n;
}
function meanLuma(png) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", png, "-vf", "crop=200:200:(iw-200)/2:(ih-200)/2+100,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
  let s = 0;
  for (const v of r.stdout) s += v;
  return s / r.stdout.length;
}
function band(wav, start, end, hz) {
  const af = `atrim=start=${start}:end=${end}` + (hz ? `,bandpass=f=${hz}:width_type=h:w=120` : "") + ",volumedetect";
  const r = spawnSync("ffmpeg", ["-v", "info", "-i", wav, "-af", af, "-f", "null", "-"], { encoding: "utf8" });
  const m = (r.stderr || "").match(/mean_volume:\s*(-?[\d.]+|-inf)/);
  return m ? Number(m[1]) : -999;
}
const fpsT = 24000 / 1001;

// ---------------------------------------------------------------- sections
const S = {};

S.open = () => {
  console.log("\n== open the scratch project");
  const before = jsx(`(function(){var o=[];for(var i=0;i<app.projects.numProjects;i++){o.push(app.projects[i].path);}return {active: app.project ? app.project.path : null, open: o};})()`);
  state.userActive = before.active;
  state.userOpen = before.open;
  save();
  console.log(`  projects open before: ${before.open.length}; active: ${path.basename(String(before.active))}`);
  const tpl = "/Applications/Adobe Premiere Pro 2027/Adobe Premiere Pro 2027.app/Contents/Resources/TemplateProjects/en_US/Standard Template Project.prproj";
  if (!fs.existsSync(PROJ)) fs.copyFileSync(tpl, PROJ);
  const r = tool("premiere_open_project", { path: PROJ }, { noGuard: true });
  ok(!r.error, "v1 premiere_open_project opens the scratch project", r.error);
  guard();
  ok(true, "scratch project is now the active one");
};

S.v1 = () => {
  console.log("\n== v1 tools on the scratch project");
  let r = tool("adobe_status", {});
  ok(!r.error && r.data["Premiere Pro"].connected, "adobe_status", r.error || r.data);
  ok(r.data["Claude bridge"] && r.data["Claude bridge"].server === "2.0.0", "adobe_status reports the v2 server", r.data["Claude bridge"]);
  r = tool("premiere_import", { paths: [M("bars.mov"), M("cam4.mov"), M("speech_ana.wav"), M("speech_dan.wav")], bin: "Media" });
  ok(!r.error && r.data.items.every((i) => i.found), "premiere_import (4 files into a bin)", r.error || r.data);
  r = tool("premiere_build_sequence", {
    name: "T1",
    bin: "Media",
    segments: [
      { path: M("bars.mov"), in: 0, out: 10 },
      { path: M("bars.mov"), in: 12, out: 22 },
      { path: M("bars.mov"), in: 30, out: 40 }
    ]
  });
  ok(!r.error && r.data.placed.length === 3, "premiere_build_sequence T1 (3 bars clips)", r.error || r.data);
  state.T1 = r.data && r.data.sequence ? r.data.sequence.id : null;
  save();
  r = tool("premiere_get_project", {});
  ok(!r.error && r.data.sequences.some((s) => s.name === "T1"), "premiere_get_project lists T1", r.error);
  r = tool("premiere_open_sequence", { sequence_id: state.T1 });
  ok(!r.error, "premiere_open_sequence", r.error);
  r = tool("premiere_set_playhead", { seconds: 5, sequence_id: state.T1 });
  ok(!r.error && Math.abs(r.data.playhead - 5) < 0.05, "premiere_set_playhead", r.error || r.data);
  r = tool("premiere_get_sequence", { sequence_id: state.T1 });
  ok(!r.error && r.data.videoTracks[0].clips.length === 3, "premiere_get_sequence", r.error || r.data);
  r = tool("premiere_add_markers", { sequence_id: state.T1, markers: [{ time: 3, name: "M1", color: 1 }, { time: 15, name: "M2", duration: 2 }] });
  ok(!r.error && r.data.added === 2, "premiere_add_markers", r.error);
  r = tool("premiere_export_frame", { seconds: 5, sequence_id: state.T1 });
  ok(!r.error && r.images === 1, "premiere_export_frame returns an image", r.error);
  r = tool("premiere_run_jsx", { script: "var ok = 41; ok + 1" });
  ok(!r.error && r.data === 42, "premiere_run_jsx: a script with `var ok` works (isolated eval)", r.error || r.data);
  r = tool("premiere_run_jsx", { script: "var a = 1;\nvar b = null;\nb.foo;" });
  ok(r.error && /line 3/.test(r.error) && /b\.foo/.test(r.error), "premiere_run_jsx error names line 3 and shows the code", r.error);
  r = tool("premiere_save", {});
  ok(!r.error && path.resolve(r.data.path) === path.resolve(PROJ), "premiere_save saves the scratch project", r.error || r.data);
};

S.timecode = () => {
  console.log("\n== timecode");
  const r = tool("premiere_timecode", { sequence_id: state.T1, values: [60.06, "00:01:00:00", "1440f", "00:00:10:00"] });
  ok(!r.error && r.data.rate.startsWith("23.976"), "rate is 23.976 non-drop", r.error || r.data);
  const v = r.data.values;
  ok(v[1].frame === 1440 && Math.abs(v[1].seconds - 60.06) < 1e-6, "TC 00:01:00:00 = frame 1440 = 60.06 s", v[1]);
  ok(v[0].timecode === "00:01:00:00", "60.06 s shows as 00:01:00:00", v[0]);
  // compare with Premiere's own formatting
  const p = jsx(`(function(){var s=app.project.activeSequence;var t=new Time();t.ticks=String(1440*Number(s.timebase));return t.getFormatted(s.getSettings().videoFrameRate,s.videoDisplayFormat);})()`);
  ok(p === "00:01:00:00", "Premiere formats the same frame identically", p);
  const tl = tlRead({ sequence_id: state.T1 });
  ok(!tl.error && tl.data.layout_token && tl.data.tracks.find((t) => t.track === "V1").clips.length === 3, "premiere_read_timeline + layout_token", tl.error);
  state.T1clips = tl.data.tracks.find((t) => t.track === "V1").clips;
  save();
};

S.render = () => {
  console.log("\n== full-quality frames");
  const clips = state.T1clips;
  const times = ["00:00:05:00", "00:00:12:07", 25.5];
  const before = jsx(`(function(){var s=app.project.activeSequence;return {wi:s.getWorkAreaInPointAsTime().ticks,wo:s.getWorkAreaOutPointAsTime().ticks,i:s.getInPointAsTime().ticks,o:s.getOutPointAsTime().ticks,px:app.getEnableProxies()};})()`);
  const r = tool("premiere_render_frames", { sequence_id: state.T1, times, preview: 1, wav: false });
  ok(!r.error && r.data.frames.length === 3 && r.images === 1, "3 frames rendered, 1 preview inline", r.error || r.data);
  if (!r.error) {
    for (const f of r.data.frames) {
      const tlF = f.frame;
      const c = clips.find((c) => tlF >= Math.round(c.start_s * fpsT) && tlF < Math.round(c.end_s * fpsT));
      const srcF = tlF - Math.round(c.start_s * fpsT) + Math.round(c.src_in_s * fpsT);
      const got = decodeFrame(f.path, 192);
      ok(got === srcF, `frame ${f.timecode} is exactly source frame ${srcF}`, `decoded ${got}`);
      ok(f.size === "1920x1080", `full size ${f.size}`);
    }
  }
  const after = jsx(`(function(){var s=app.project.activeSequence;return {wi:s.getWorkAreaInPointAsTime().ticks,wo:s.getWorkAreaOutPointAsTime().ticks,i:s.getInPointAsTime().ticks,o:s.getOutPointAsTime().ticks,px:app.getEnableProxies()};})()`);
  ok(JSON.stringify(before) === JSON.stringify(after), "work area, In/Out and proxy setting restored exactly", { before, after });
  // range + WAV
  const r2 = tool("premiere_render_frames", { sequence_id: state.T1, start: "00:00:02:00", end: "00:00:03:23", wav: true, step_frames: 47, preview: 0 });
  ok(!r2.error && r2.data.wav && fs.existsSync(r2.data.wav), "range render writes a WAV", r2.error || r2.data);
  if (!r2.error) {
    const d = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", r2.data.wav], { encoding: "utf8" }).stdout);
    ok(Math.abs(d - 48 / fpsT) < 0.06, `WAV is the range length (${d.toFixed(3)} s for 48 frames)`);
  }
  state.renderOk = !r.error;
  save();
};

S.place = () => {
  console.log("\n== exact placement, no audio spill");
  tool("premiere_open_sequence", { sequence_id: state.T1 });
  const nTracks0 = tlRead({ sequence_id: state.T1 }).data.tracks.length;
  let r = tool("premiere_place_clip", { sequence_id: state.T1, source: { path: M("speech_ana.wav") }, src_in: 0, src_out: 12.49, at: 2, audio_track: "A2" });
  ok(!r.error && r.data.placed.length === 1 && r.data.placed[0].track === "A2", "speech placed on A2 at 2 s", r.error || r.data);
  r = tool("premiere_place_clip", { sequence_id: state.T1, source: { path: M("speech_dan.wav") }, src_in: 0, src_out: 6.99, at: 16, audio_track: "A3" });
  ok(!r.error && r.data.placed[0].track === "A3", "second speaker placed on A3 at 16 s", r.error || r.data);
  // camera clip, video only, at a non-frame-aligned source in
  r = tool("premiere_place_clip", { sequence_id: state.T1, source: { path: M("cam4.mov") }, src_in: 2.5, src_out: 6.5, at: 5, video_track: "V2" });
  ok(!r.error && r.data.placed.length === 1 && r.data.placed[0].track === "V2", "camera video-only on V2 (no audio placed)", r.error || r.data);
  if (!r.error) ok(Math.abs(r.data.placed[0].src_in_s - 2.5) < 1 / fpsT, `source in lands on 2.5 s (got ${r.data.placed[0].src_in_s})`);
  // camera with its 4 channels onto V2 + A2 at 17 s: A3 (second speaker) must be untouched
  r = tool("premiere_place_clip", { sequence_id: state.T1, source: { path: M("cam4.mov") }, src_in: 0, src_out: 2, at: 17, video_track: "V2", audio_track: "A2" });
  ok(!r.error && r.data.placed.length === 2, "camera video + one audio channel placed", r.error || r.data);
  const tl = tlRead({ sequence_id: state.T1 });
  const a3 = tl.data.tracks.find((t) => t.track === "A3").clips;
  ok(a3.length === 1 && Math.abs(a3[0].start_s - 16) < 1 / fpsT, "A3 (second speaker) untouched by the 4-channel clip", a3);
  const a4 = tl.data.tracks.find((t) => t.track === "A4");
  ok(!a4 || a4.clips.length === 0, "no channel clips spilled onto A4", a4);
  ok(tl.data.tracks.length === nTracks0, `no empty tracks left behind (${nTracks0} -> ${tl.data.tracks.length})`);
  state.T1clips = tl.data.tracks.find((t) => t.track === "V1").clips;
  state.cam = tl.data.tracks.find((t) => t.track === "V2").clips[0];
  save();
};

S.source = () => {
  console.log("\n== native-size source frame with the clip's effects");
  tool("premiere_open_sequence", { sequence_id: state.T1 });
  // give the camera clip a Lumetri exposure so we can see it carried over
  let r = tool("premiere_set_effect_param", { sequence_id: state.T1, clip: { track: "V2", at: 6 }, effect: "Lumetri", param: "exposure", value: 1.5, add_if_missing: true });
  ok(!r.error, "Lumetri exposure set on the camera clip", r.error || r.data);
  r = tool("premiere_render_source", { sequence_id: state.T1, clip: { track: "V2", at: 6 }, times: ["00:00:06:00"], preview: 1 });
  ok(!r.error && r.data.frames.length === 1, "source frame rendered", r.error || r.data);
  if (!r.error) {
    ok(r.data.frames[0].size === "2560x1440", `native size ${r.data.frames[0].size} (sequence is 1920x1080)`);
    const expectSrc = Math.floor((2.5 + 1.0) * fpsT + 1e-6);
    const got = decodeFrame(r.data.frames[0].path, 256);
    ok(Math.abs(got - expectSrc) <= 1, `it's source frame ~${expectSrc}`, `decoded ${got}`);
    ok(r.data.effects && r.data.effects.added.includes("Lumetri Color"), "Lumetri copied onto the temp clip", r.data.effects);
  }
  const left = jsx(`(function(){var n=0;for(var i=0;i<app.project.sequences.numSequences;i++){if(/^Claude temp render/.test(app.project.sequences[i].name))n++;}return n;})()`);
  ok(left === 0, "temp sequence deleted afterwards", left);
};

S.edits = () => {
  console.log("\n== ripple delete / insert / move, layout check, snapshots, undo");
  const mk = jsx(`(function(){var p=app.project,ids={},i;for(i=0;i<p.sequences.numSequences;i++){ids[String(p.sequences[i].sequenceID)]=1;}
    var s=null;for(i=0;i<p.sequences.numSequences;i++){if(String(p.sequences[i].sequenceID)===${JSON.stringify(String(state.T1))}){s=p.sequences[i];}}
    s.clone();for(i=0;i<p.sequences.numSequences;i++){if(!ids[String(p.sequences[i].sequenceID)]){p.sequences[i].name="E1";return String(p.sequences[i].sequenceID);}}return null;})()`);
  state.E1 = mk;
  save();
  tool("premiere_open_sequence", { sequence_id: state.E1 });
  let tl = tlRead({ sequence_id: state.E1 });
  const endBefore = tl.data.sequence.duration.s;
  const token = tl.data.layout_token;
  let r = tool("premiere_ripple_delete", { sequence_id: state.E1, start: "00:00:04:00", end: "00:00:06:00", expect_layout: token });
  ok(!r.error, "ripple delete 4-6 s", r.error || r.data);
  tl = tlRead({ sequence_id: state.E1 });
  ok(Math.abs(tl.data.sequence.duration.s - (endBefore - 48 / fpsT)) < 0.01, `sequence 48 frames shorter (${endBefore} -> ${tl.data.sequence.duration.s})`);
  const v1 = tl.data.tracks.find((t) => t.track === "V1").clips;
  ok(v1[0].end === "00:00:04:00" && v1[1].start === "00:00:04:00" && v1[1].src_in_s > 5.9, "V1 cut at 4 s, next piece starts where 6 s was", v1.slice(0, 3));
  ok(r.data && /Claude snapshots/.test(r.data.snapshot || ""), "snapshot saved before the edit", r.data);
  const firstSnap = (r.data && r.data.snapshot) || "";
  // stale token must be refused
  r = tool("premiere_insert_gap", { sequence_id: state.E1, at: 4, duration: 2, expect_layout: token });
  ok(r.error && /changed/.test(r.error), "old layout token is refused", r.error || r.data);
  tl = tlRead({ sequence_id: state.E1 });
  r = tool("premiere_insert_gap", { sequence_id: state.E1, at: 4, duration: "48f", expect_layout: tl.data.layout_token });
  ok(!r.error, "insert 48-frame gap at 4 s", r.error || r.data);
  tl = tlRead({ sequence_id: state.E1 });
  ok(Math.abs(tl.data.sequence.duration.s - endBefore) < 0.01, "length back to the original", tl.data.sequence.duration);
  // move 20-22 s to 2 s
  r = tool("premiere_move_range", { sequence_id: state.E1, start: 20, end: 22, to: 2 });
  ok(!r.error, "move 20-22 s to 2 s", r.error || r.data);
  tl = tlRead({ sequence_id: state.E1, start: 2, end: 4 });
  const piece = tl.data.tracks.find((t) => t.track === "V1").clips.find((c) => c.start === "00:00:02:00");
  ok(piece && Math.abs(piece.src_in_s - 30) < 0.05, "the 20 s material (source 30 s) now starts at 2 s", piece);
  tl = tlRead({ sequence_id: state.E1 });
  ok(Math.abs(tl.data.sequence.duration.s - endBefore) < 0.01, "length unchanged by the move");
  const jumbled = tl.data.tracks.filter((t) => t.warning).map((t) => t.track);
  ok(!jumbled.length, "no track's clip order is jumbled by the move", jumbled);
  // a cut inside the moved piece (the place DOM moves used to break)
  r = tool("premiere_ripple_delete", { sequence_id: state.E1, start: "00:00:02:12", end: "00:00:03:00", snapshot: false });
  ok(!r.error, "a cut inside the moved piece works after the move", r.error || r.data);
  tl = tlRead({ sequence_id: state.E1 });
  ok(Math.abs(tl.data.sequence.duration.s - (endBefore - 12 / fpsT)) < 0.01, "12 frames shorter after that cut", tl.data.sequence.duration);
  // the snapshot taken before the first edit holds the sequence as it was (Premiere 27's undo isn't reliable
  // enough to use automatically, so the snapshot is the way back)
  const snapName = (firstSnap.match(/"([^"]+)"\.?$/) || [])[1];
  const snapEnd = jsx(`(function(){var p=app.project;for(var i=0;i<p.sequences.numSequences;i++){if(p.sequences[i].name===${JSON.stringify(String(snapName))}){return Number(p.sequences[i].end)/254016000000;}}return null;})()`);
  ok(snapEnd !== null && Math.abs(snapEnd - endBefore) < 0.01, `snapshot "${snapName}" has the sequence as it was before (${snapEnd} s)`);
};

S.speed = () => {
  console.log("\n== speed with ripple");
  tool("premiere_open_sequence", { sequence_id: state.E1 });
  let tl = tlRead({ sequence_id: state.E1 });
  const byTime = (cl) => cl.slice().sort((x, y) => x.start_s - y.start_s);
  const v1 = byTime(tl.data.tracks.find((t) => t.track === "V1").clips);
  const c = v1[v1.length - 2];
  const next = v1[v1.length - 1];
  const len = c.end_s - c.start_s;
  let r = tool("premiere_set_speed", { sequence_id: state.E1, clip: { node_id: c.node_id }, speed: "50%" });
  ok(!r.error, "speed 50% with ripple", r.error || r.data);
  tl = tlRead({ sequence_id: state.E1 });
  const after = byTime(tl.data.tracks.find((t) => t.track === "V1").clips);
  const c2 = after.find((x) => x.node_id === c.node_id) || after[after.length - 2];
  ok(Math.abs(c2.end_s - c2.start_s - 2 * len) < 0.1, `clip is twice as long (${len.toFixed(2)} -> ${(c2.end_s - c2.start_s).toFixed(2)} s)`, c2);
  const n2 = after.find((x) => x.node_id === next.node_id) || after[after.length - 1];
  ok(Math.abs(n2.start_s - c2.end_s) < 0.05, "the next clip moved to butt against it", { c2, n2 });
  ok(c2.speed === 0.5 || c2.speed === 50, `speed reads ${c2.speed}`);
  ok(Math.abs(c2.src_in_s - c.src_in_s) < 0.05 && Math.abs(c2.src_out_s - c.src_out_s) < 0.05, `same source plays (${c.src_in_s}-${c.src_out_s} s -> ${c2.src_in_s}-${c2.src_out_s} s)`);
  state.slow = c2;
  save();
};

S.effects = () => {
  console.log("\n== effect params, traps, copy with keyframes");
  tool("premiere_open_sequence", { sequence_id: state.E1 });
  const at = { track: "V1", at: 1 };
  // Transform added by script starts with Uniform Scale off (Motion's is on); switch it on to hit the trap
  let r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Transform", param: "Uniform Scale", value: true, add_if_missing: true });
  ok(!r.error, "Transform Uniform Scale on", r.error || r.data);
  r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Transform", param: "Scale Width", value: 150 });
  ok(!r.error && r.data.results[0].param === "Scale Height" && r.data.notes.some((n) => /Uniform Scale/.test(n)), "Transform 'Scale Width' with Uniform Scale on -> sets Scale Height and says why", r.error || r.data);
  r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Directional Blur", param: "direction", value: 45, add_if_missing: true });
  ok(!r.error && r.data.results[0].after === 45, "Directional Blur direction (alias resolved)", r.error || r.data);
  r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Directional Blur", param: "length", value: 7 });
  ok(!r.error, "Directional Blur length (Blur Length/Amount)", r.error || r.data);
  r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Transform", param: "Wobble", value: 1 });
  ok(r.error && /parameters:/.test(r.error), "unknown parameter is refused with the real names", r.error);
  r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Lumetri", param: "exposure", value: 0.5, add_if_missing: true });
  ok(!r.error, "Lumetri exposure 0.5", r.error || r.data);
  r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Lumetri", param: "saturation", value: 150, clip_time: 0.5 });
  ok(!r.error, "Lumetri saturation keyframe at 0.5 s", r.error || r.data);
  r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Lumetri", param: "saturation", value: 50, clip_time: 1.5 });
  ok(!r.error, "Lumetri saturation keyframe at 1.5 s", r.error || r.data);
  const tl = tlRead({ sequence_id: state.E1 });
  const v1 = tl.data.tracks.find((t) => t.track === "V1").clips;
  r = tool("premiere_copy_effects", { sequence_id: state.E1, from: at, to: [{ node_id: v1[2].node_id }] });
  ok(!r.error && r.data.results[0].added.length >= 3, "copy effects to another clip (Transform, Directional Blur, Lumetri)", r.error || r.data);
  if (!r.error) {
    const res = r.data.results[0];
    ok(res.copied.some((x) => /Saturation \(2 keyframes\)/.test(x)), "keyframes copied", res.copied);
    console.log(`        not copied: ${res.skipped.length ? res.skipped.join(" | ").slice(0, 600) : "nothing"}`);
  }
  const le = tool("premiere_list_effects", { sequence_id: state.E1, clip: { node_id: v1[2].node_id } });
  ok(!le.error && le.data.effects.some((e) => e.name === "Lumetri Color"), "premiere_list_effects shows the copied Lumetri", le.error);
};

S.keys = () => {
  console.log("\n== keyframe time base (source time vs clip time), checked by rendering");
  tool("premiere_open_sequence", { sequence_id: state.T1 });
  // V1 clip 2 sits at 10-20 s with source in 12 s. Opacity keys at media time 12 s (=0%) and 13 s (=100%).
  const res = jsx(`(function(){var s=app.project.activeSequence;var c=s.videoTracks[0].clips[1];var op=null;for(var i=0;i<c.components.numItems;i++){if(c.components[i].displayName==="Opacity"){op=c.components[i].properties[0];}}
    op.setTimeVarying(true);var t0=new Time();t0.ticks=String(Number(c.inPoint.ticks));var t1=new Time();t1.ticks=String(Number(c.inPoint.ticks)+254016000000);
    op.addKey(t0);op.setValueAtKey(t0,0,true);op.addKey(t1);op.setValueAtKey(t1,100,true);
    var k=op.getKeys();return {inPoint:c.inPoint.seconds,start:c.start.seconds,keys:[k[0].seconds,k[1].seconds]};})()`);
  console.log(`        keys read back at ${JSON.stringify(res)}`);
  const r = tool("premiere_render_frames", { sequence_id: state.T1, times: ["00:00:10:01", "00:00:11:12"], preview: 0 });
  if (r.error) return ok(false, "render for the keyframe test", r.error);
  const l0 = meanLuma(r.data.frames[0].path);
  const l1 = meanLuma(r.data.frames[1].path);
  const media = l0 < 30 && l1 > 60;
  const clipBase = l0 < 30 && l1 < 30;
  ok(media || clipBase, `keyframe base detected: ${media ? "SOURCE (media) time" : clipBase ? "CLIP time" : "unclear"} (luma ${l0.toFixed(0)} / ${l1.toFixed(0)})`);
  state.keyBase = media ? "media" : clipBase ? "clip" : "unknown";
  save();
  // clean up the opacity keys
  jsx(`(function(){var c=app.project.activeSequence.videoTracks[0].clips[1];for(var i=0;i<c.components.numItems;i++){if(c.components[i].displayName==="Opacity"){var p=c.components[i].properties[0];p.setTimeVarying(false);p.setValue(100,true);}}return 1;})()`);
};

S.keys2 = () => {
  console.log("\n== keyframes on a speed-changed clip, then razored (checked by rendering)");
  tool("premiere_open_sequence", { sequence_id: state.E1 });
  const v1 = tlRead({ sequence_id: state.E1 }).data.tracks.find((t) => t.track === "V1").clips;
  const c = v1.find((x) => x.speed === 0.5);
  if (!c) return ok(false, "needs the 50% clip from the speed section");
  const at = { node_id: c.node_id };
  // start from no opacity keys (scratch only)
  jsx(`(function(){if(!/ClaudeBridgeV2_scratch\\.prproj$/.test(app.project.path))return "NOT SCRATCH";var v=app.project.activeSequence.videoTracks[0].clips;for(var i=0;i<v.numItems;i++){if(String(v[i].nodeId)===${JSON.stringify(c.node_id)}){var p=v[i].components[0].properties[0];p.setTimeVarying(false);p.setValue(100,true);}}return 1;})()`);
  let r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Opacity", param: "Opacity", value: 0, clip_time: 1.0 });
  ok(!r.error, "opacity key 0% at 1.0 s into the 50% clip", r.error || r.data);
  r = tool("premiere_set_effect_param", { sequence_id: state.E1, clip: at, effect: "Opacity", param: "Opacity", value: 100, clip_time: 3.0 });
  ok(!r.error, "opacity key 100% at 3.0 s into it", r.error || r.data);
  const t = (x) => Math.round((c.start_s + x) * 1000) / 1000;
  const rr = tool("premiere_render_frames", { sequence_id: state.E1, times: [t(0.5), t(2.0), t(3.6)], preview: 0 });
  if (rr.error) return ok(false, "render", rr.error);
  const [l0, lMid, lFull] = rr.data.frames.map((f) => meanLuma(f.path));
  const ratio = lMid / lFull;
  ok(l0 < 0.1 * lFull && ratio > 0.25 && ratio < 0.75, `keys land at the right clip times at 50% speed (luma ${l0.toFixed(0)} / ${lMid.toFixed(0)} / ${lFull.toFixed(0)})`);
  state.keySpeedOk = l0 < 0.1 * lFull && ratio > 0.25 && ratio < 0.75;
  // cut the clip between the keys with the bridge's own razor (a 1-frame insert at 1.5 s); the frame that was at
  // 2.0 s is now one frame later and must look the same
  const fr = 1001 / 24000;
  const g = tool("premiere_insert_gap", { sequence_id: state.E1, at: t(1.5), duration: "1f", snapshot: false });
  ok(!g.error, "clip cut between its keys (1-frame insert)", g.error || g.data);
  const r2 = tool("premiere_render_frames", { sequence_id: state.E1, times: [Math.round((c.start_s + 2.0 + fr) * 1000) / 1000], preview: 0 });
  if (r2.error) return ok(false, "render after razor", r2.error);
  const lAfter = meanLuma(r2.data.frames[0].path);
  ok(Math.abs(lAfter - lMid) < 0.1 * lFull, `after the cut the keyframed frame is unchanged (luma ${lMid.toFixed(0)} -> ${lAfter.toFixed(0)})`);
  const le = tool("premiere_list_effects", { sequence_id: state.E1, clip: { track: "V1", at: t(2.0) + fr } });
  const op = !le.error && le.data.effects.find((e) => e.name === "Opacity");
  console.log(`        right half after razor: ${JSON.stringify(op ? op.params[0] : le.error).slice(0, 300)}`);
  save();
};

S.transitions = () => {
  console.log("\n== transitions");
  tool("premiere_open_sequence", { sequence_id: state.E1 });
  let r = tool("premiere_transition", { sequence_id: state.E1, clip: { track: "V1", at: 1 }, action: "add", edge: "end", duration: "12f" });
  ok(!r.error && r.data.added, "add Cross Dissolve at the end of V1 clip 1", r.error || r.data);
  r = tool("premiere_transition", { sequence_id: state.E1, clip: { track: "V1", at: 1 }, action: "list" });
  ok(!r.error && r.data.transitions.length >= 1, "list shows it", r.error || r.data);
  r = tool("premiere_transition", { sequence_id: state.E1, clip: { track: "V1", at: 1 }, action: "remove", edge: "end" });
  ok(!r.error ? r.data.removed >= 1 : /Couldn't remove/.test(r.error), r.error ? "remove refused clearly (documented limit)" : "remove works", r.error || r.data);
  state.transitionRemove = r.error ? "refused" : "works";
  save();
};

/** A fresh copy of T1 (scratch project only). */
function cloneT1(name) {
  return jsx(`(function(){if(!/ClaudeBridgeV2_scratch\\.prproj$/.test(app.project.path))return "NOT SCRATCH";var p=app.project,ids={},i;for(i=0;i<p.sequences.numSequences;i++){ids[String(p.sequences[i].sequenceID)]=1;}
    var s=null;for(i=0;i<p.sequences.numSequences;i++){if(String(p.sequences[i].sequenceID)===${JSON.stringify(String(state.T1))}){s=p.sequences[i];}}
    s.clone();for(i=0;i<p.sequences.numSequences;i++){if(!ids[String(p.sequences[i].sequenceID)]){p.sequences[i].name=${JSON.stringify(name)};return String(p.sequences[i].sequenceID);}}return null;})()`);
}

S.batch = () => {
  console.log("\n== many ranges in one ripple delete, against one at a time (timed)");
  const ranges = [[1, 2], [11, 12.5], [24, 25]];
  state.E2 = cloneT1("E2");
  state.E3 = cloneT1("E3");
  save();
  if (state.E2 === "NOT SCRATCH" || state.E3 === "NOT SCRATCH") return ok(false, "scratch project not active");
  // one at a time, the old way (last range first, so the earlier ones don't move)
  tool("premiere_open_sequence", { sequence_id: state.E3 });
  const before = tlRead({ sequence_id: state.E3 }).data;
  let t0 = Date.now();
  for (const [s, e] of ranges.slice().reverse()) {
    const r = tool("premiere_ripple_delete", { sequence_id: state.E3, start: s, end: e });
    if (r.error) return ok(false, `one-at-a-time delete ${s}-${e}`, r.error);
  }
  const tOne = (Date.now() - t0) / 1000;
  const one = tlRead({ sequence_id: state.E3 }).data;
  tool("premiere_open_sequence", { sequence_id: state.E2 });
  t0 = Date.now();
  const r = tool("premiere_ripple_delete_ranges", { sequence_id: state.E2, ranges: ranges.map(([start, end]) => ({ start, end })) });
  const tBatch = (Date.now() - t0) / 1000;
  ok(!r.error, `3 ranges in one call: ${tBatch.toFixed(1)} s (one at a time: ${tOne.toFixed(1)} s)`, r.error || r.data);
  if (r.error) return;
  const many = tlRead({ sequence_id: state.E2 }).data;
  const shape = (d) => d.tracks.map((t) => t.track + ":" + t.clips.map((c) => `${c.start}-${c.end}@${c.src_in_s}`).join(",")).join(" | ");
  ok(shape(many) === shape(one), "same clips as three separate ripple deletes", { many: shape(many), one: shape(one) });
  ok(JSON.stringify(many.markers.map((m) => m.start)) === JSON.stringify(one.markers.map((m) => m.start)), "same markers", { many: many.markers, one: one.markers });
  ok(many.tracks.every((t) => !t.warning), "every track's clips still in time order", many.tracks.filter((t) => t.warning));
  const shorter = before.sequence.duration.s - many.sequence.duration.s;
  ok(Math.abs(shorter - 3.5) < 0.1, `sequence ${shorter.toFixed(3)} s shorter`);
  ok(/Claude snapshots/.test(r.data.snapshot || ""), "one snapshot saved", r.data.snapshot);
  const g = tool("premiere_insert_gap", { sequence_id: state.E2, at: 5, duration: "1f", snapshot: false });
  ok(!g.error, "a scripted cut still works on the result", g.error);
  state.timing = { oneAtATime: tOne, batch: tBatch };
  save();
};

S.fades = () => {
  console.log("\n== audio fades (checked by rendering the audio)");
  state.E4 = cloneT1("E4");
  save();
  if (state.E4 === "NOT SCRATCH") return ok(false, "scratch project not active");
  tool("premiere_open_sequence", { sequence_id: state.E4 });
  // by now T1 also has speech and camera audio on other tracks: clear them from this copy so the WAVs hold only
  // the bars tone on A1
  const cleared = jsx(`(function(){if(!/ClaudeBridgeV2_scratch\\.prproj$/.test(app.project.path))return "NOT SCRATCH";var p=app.project,s=null,i,n=0;for(i=0;i<p.sequences.numSequences;i++){if(String(p.sequences[i].sequenceID)===${JSON.stringify(String(state.E4))}){s=p.sequences[i];}}
    for(var t=1;t<s.audioTracks.numTracks;t++){var cl=s.audioTracks[t].clips;for(var k=cl.numItems-1;k>=0;k--){cl[k].remove(false,false);n++;}}return n;})()`);
  ok(typeof cleared === "number", `other audio tracks cleared on the copy (${cleared} clips)`, cleared);
  const tl = tlRead({ sequence_id: state.E4 }).data;
  const a1 = tl.tracks.find((t) => t.track === "A1").clips.slice().sort((x, y) => x.start_s - y.start_s);
  if (a1.length < 3) return ok(false, "needs the bars audio on A1", a1);
  const [c1, c2, c3] = a1;
  const wav = (s, e) => {
    const r = tool("premiere_render_frames", { sequence_id: state.E4, start: Math.round(s * 1000) / 1000, end: Math.round(e * 1000) / 1000, wav: true, frames: false, preview: 0 });
    if (r.error) throw new Error(`render: ${r.error}`);
    return r.data.wav;
  };
  // bars.mov carries a steady tone, so any change in level is the fade
  const w0 = wav(0, 2), w0e = wav(c1.end_s - 1, c1.end_s);
  const mid0 = band(w0, 1.0, 1.5, 0), head0 = band(w0, 0, 0.08, 0), tail0 = band(w0e, 0.92, 0.995, 0);
  let r = tool("premiere_audio_fade", { sequence_id: state.E4, clips: [{ node_id: c1.node_id }], fade_in: "12f", fade_out: "12f" });
  ok(!r.error && r.data.clips_faded >= 1, "keyframe fades on A1 clip 1", r.error || r.data);
  if (r.error) return;
  ok(r.data.faded[0].level_between_db === 0, `clip level read as 0 dB (${r.data.faded[0].level_between_db})`);
  const w1 = wav(0, 2), w1e = wav(c1.end_s - 1, c1.end_s);
  const mid1 = band(w1, 1.0, 1.5, 0), head1 = band(w1, 0, 0.08, 0), tail1 = band(w1e, 0.92, 0.995, 0), half = band(w1, 0.2, 0.3, 0);
  ok(Math.abs(mid1 - mid0) < 0.3, `level between the fades unchanged (${mid0} -> ${mid1} dB)`);
  ok(head1 < head0 - 12, `starts from silence (${head0} -> ${head1} dB in the first 2 frames)`);
  ok(tail1 < tail0 - 12, `ends in silence (${tail0} -> ${tail1} dB in the last 2 frames)`);
  ok(half < mid1 - 2 && half > mid1 - 15, `half way through the fade it's in between (${half} dB vs ${mid1} dB)`);
  r = tool("premiere_audio_fade", { sequence_id: state.E4, clips: [{ node_id: c1.node_id }], fade_in: "12f", fade_out: "12f" });
  ok(!r.error && r.data.faded[0].old_keyframes_replaced === 4, "running it again replaces its own 4 keyframes", r.error || r.data);
  const w2 = wav(0, 2);
  ok(Math.abs(band(w2, 1.0, 1.5, 0) - mid1) < 0.3 && Math.abs(band(w2, 0, 0.08, 0) - head1) < 1, "and sounds the same");
  // Premiere's own transition, on clip 2's start only
  const wb = wav(c2.start_s - 0.5, c2.start_s + 1);
  const h2b = band(wb, 0.5, 0.58, 0), end1b = band(wb, 0.0, 0.3, 0);
  r = tool("premiere_audio_fade", { sequence_id: state.E4, clips: [{ node_id: c2.node_id }], fade_in: "12f", method: "transition" });
  ok(!r.error && r.data.faded[0] && r.data.faded[0].fade_in === "12f", "Constant Power fade-in on clip 2", r.error || r.data);
  if (!r.error) {
    const after = tlRead({ sequence_id: state.E4 }).data;
    const a1b = after.tracks.find((t) => t.track === "A1");
    const pos = (cl) => cl.map((c) => `${c.start}-${c.end}@${c.src_in_s}`).sort().join();
    ok(pos(a1b.clips) === pos(tl.tracks.find((t) => t.track === "A1").clips), "no clip moved or trimmed");
    const tr = (a1b.transitions || []).find((x) => x.start >= c2.start);
    ok(tr && tr.start === c2.start, `transition sits inside clip 2 from its start (${JSON.stringify(tr)})`);
    const wa = wav(c2.start_s - 0.5, c2.start_s + 1);
    const h2a = band(wa, 0.5, 0.58, 0);
    ok(h2a < h2b - 10, `clip 2 starts from silence (${h2b} -> ${h2a} dB in its first 2 frames)`);
    ok(Math.abs(band(wa, 0.0, 0.3, 0) - end1b) < 0.5, "clip 1 untouched by it");
    console.log(`        alignment learnt: ${JSON.stringify(jsx("__claudeBridge.v2 && __claudeBridge.v2.fadeAlign ? __claudeBridge.v2.fadeAlign : null"))}`);
  }
  // a video clip means its linked audio
  r = tool("premiere_audio_fade", { sequence_id: state.E4, clips: [{ track: "V1", at: c3.start_s + 1 }], fade_out: "2f" });
  ok(!r.error && r.data.faded.length >= 1 && r.data.faded.every((f) => f.track.startsWith("A")), "video clip -> its linked audio faded", r.error || r.data);
  save();
};

// Scripted ripples used to leave transitions where the clips had been, and an audio fade left on empty space can
// silence the rest of the track. Every ripple tool must take each transition along with its clip edge.
S.rtrans = () => {
  console.log("\n== transitions move with their clips through ripple edits");
  const fr = (tc) => { const m = String(tc).split(/[:;]/).map(Number); return ((m[0] * 60 + m[1]) * 60 + m[2]) * 24 + m[3]; };
  const trs = (id) => {
    const tl = tlRead({ sequence_id: id }).data;
    const o = {};
    for (const t of tl.tracks) if (t.transitions && t.transitions.length) o[t.track] = t.transitions.map((x) => [fr(x.start), fr(x.end)]).sort((a, b) => a[0] - b[0]);
    const edges = {};
    for (const t of tl.tracks) edges[t.track] = new Set(t.clips.flatMap((c) => [fr(c.start), fr(c.end)]));
    const orphans = [];
    for (const [k, list] of Object.entries(o)) for (const [a, b] of list) if (!edges[k] || ![...edges[k]].some((e) => e >= a && e <= b)) orphans.push(`${k} ${a}-${b}`);
    return { o, orphans, tl };
  };
  const setup = (name) => {
    const id = cloneT1(name);
    tool("premiere_open_sequence", { sequence_id: id });
    // only the bars on V1/A1: other audio (speech, camera) would mask what the renders listen for
    jsx(`(function(){if(!/ClaudeBridgeV2_scratch\\.prproj$/.test(app.project.path))return "NOT SCRATCH";var p=app.project,s=null,i;for(i=0;i<p.sequences.numSequences;i++){if(String(p.sequences[i].sequenceID)===${JSON.stringify(String(id))}){s=p.sequences[i];}}
      for(var t=1;t<s.audioTracks.numTracks;t++){var cl=s.audioTracks[t].clips;for(var k=cl.numItems-1;k>=0;k--){cl[k].remove(false,false);}}return true;})()`);
    let r = tool("premiere_audio_fade", { sequence_id: id, clips: [{ track: "A1", at: 25 }], fade_in: "12f", fade_out: "12f", method: "transition", include_linked: false, snapshot: false });
    ok(!r.error && r.data.faded[0] && r.data.faded[0].fade_in && r.data.faded[0].fade_out, `${name}: fade in and out on A1 clip 3 as transitions`, r.error || r.data);
    r = tool("premiere_transition", { sequence_id: id, clip: { track: "V1", at: 15 }, action: "add", edge: "end", duration: "12f" });
    ok(!r.error, `${name}: Cross Dissolve between V1 clips 2 and 3`, r.error || r.data);
    return { id, before: trs(id) };
  };
  const shifted = (b, d, from) => Object.fromEntries(Object.entries(b.o).map(([k, l]) => [k, l.map(([x, y]) => (x >= from ? [x + d, y + d] : [x, y]))]));
  const cases = [
    ["RT_ripple", (id) => tool("premiere_ripple_delete", { sequence_id: id, start: "00:00:04:00", end: "00:00:06:00", snapshot: false }), -48, 96],
    ["RT_batch", (id) => tool("premiere_ripple_delete_ranges", { sequence_id: id, ranges: [{ start: "00:00:04:00", end: "00:00:05:00" }, { start: "00:00:06:00", end: "00:00:07:00" }], snapshot: false }), -48, 168],
    ["RT_gap", (id) => tool("premiere_insert_gap", { sequence_id: id, at: "00:00:04:00", duration: "48f", snapshot: false }), 48, 96],
    // clip 2 (10-20 s) at half speed: it ends at 30 s, so the dissolve at its end and clip 3's fades move 240 frames
    ["RT_speed", (id) => tool("premiere_set_speed", { sequence_id: id, clip: { track: "V1", at: 15 }, speed: 0.5, snapshot: false }), 240, 470]
  ];
  for (const [name, fn, d, from] of cases) {
    const { id, before } = setup(name);
    state[name] = id;
    if (before.orphans.length) ok(false, `${name}: no orphans before the edit`, before.orphans);
    const r = fn(id);
    ok(!r.error, `${name}: edit ran`, r.error || r.data);
    if (r.error) continue;
    const after = trs(id);
    ok(JSON.stringify(after.o) === JSON.stringify(shifted(before, d, from)), `${name}: every transition moved ${d > 0 ? "+" : ""}${d} frames with its clip`, { before: before.o, after: after.o });
    ok(!after.orphans.length, `${name}: no transition left off a clip edge`, after.orphans);
    if (r.data && r.data.transitions_moved !== undefined) console.log(`        transitions moved: ${r.data.transitions_moved}`);
  }
  // listen after the ripple: clip 3 (now from 18 s) fades in from silence, plays at its level, and the track isn't silenced
  {
    const id = state.RT_ripple;
    const r = tool("premiere_render_frames", { sequence_id: id, start: 16, end: 26, wav: true, frames: false, preview: 0 });
    if (!r.error) {
      const w = r.data.wav;
      const c2 = band(w, 0.5, 1.5, 0), head = band(w, 2.02, 2.1, 0), mid = band(w, 5, 6, 0);
      ok(c2 > -50 && mid > -50 && head < mid - 10, `RT_ripple sounds right: clip 2 ${c2} dB, clip 3 first 2 frames ${head} dB, middle ${mid} dB`);
    } else ok(false, "RT_ripple render", r.error);
  }
  // an orphan made the old way (a DOM move with no carry), flagged by read_timeline, then removed
  {
    const { id } = setup("RT_orphan");
    const m = jsx(`(function(){if(!/ClaudeBridgeV2_scratch\\.prproj$/.test(app.project.path))return "NOT SCRATCH";var p=app.project,s=null;for(var i=0;i<p.sequences.numSequences;i++){if(String(p.sequences[i].sequenceID)===${JSON.stringify(String(id))})s=p.sequences[i];}
      var t=new Time();t.ticks=String(48*Number(s.timebase));s.audioTracks[0].clips[2].move(t);return s.audioTracks[0].clips[2].start.seconds;})()`);
    ok(typeof m === "number" && m > 22, `A1 clip 3 moved by a plain DOM move to ${m} s (fades left behind)`, m);
    let tl = tlRead({ sequence_id: id }).data;
    const a1 = tl.tracks.find((t) => t.track === "A1");
    ok(a1.transition_warning && a1.transitions.filter((x) => x.orphan).length === 2, "read_timeline flags the 2 orphaned fades", a1.transitions);
    const before = tool("premiere_render_frames", { sequence_id: id, start: 22, end: 31, wav: true, frames: false, preview: 0 });
    const lvBefore = before.error ? null : band(before.data.wav, 2, 6, 0);
    console.log(`        clip 3 with the orphans on the track: ${lvBefore} dB`);
    const r = tool("premiere_transition", { sequence_id: id, action: "remove_orphans" });
    ok(!r.error && r.data.orphans_found === 2 && r.data.removed.length === 2, "remove_orphans removes both", r.error || r.data);
    tl = tlRead({ sequence_id: id }).data;
    ok(!tl.tracks.find((t) => t.track === "A1").transition_warning, "no orphan warning afterwards");
    ok((tl.tracks.find((t) => t.track === "V1").transitions || []).length === 1, "the dissolve on V1 (on a clip edge) is kept");
    const after = tool("premiere_render_frames", { sequence_id: id, start: 22, end: 31, wav: true, frames: false, preview: 0 });
    const lvAfter = after.error ? null : band(after.data.wav, 2, 6, 0);
    ok(lvAfter !== null && lvAfter > -50, `clip 3 plays at its level afterwards (${lvAfter} dB)`);
  }
  // move_range: 12-14 s (inside clip 2) to 2 s; the dissolve at 20 s and the fades on clip 3 stay put
  const { id, before } = setup("RT_move");
  const r = tool("premiere_move_range", { sequence_id: id, start: "00:00:12:00", end: "00:00:14:00", to: "00:00:02:00", snapshot: false });
  ok(!r.error, "RT_move: edit ran", r.error || r.data);
  if (!r.error) {
    const after = trs(id);
    ok(JSON.stringify(after.o) === JSON.stringify(before.o), "RT_move: transitions outside the moved stretch stayed where they were", { before: before.o, after: after.o });
    ok(!after.orphans.length, "RT_move: no transition left off a clip edge", after.orphans);
  }
};

S.markers = () => {
  console.log("\n== markers");
  let r = tool("premiere_move_markers", { sequence_id: state.T1, delta: "+12f", names: ["M2"] });
  ok(!r.error && r.data.count === 1 && r.data.moved[0].to === "00:00:15:12", "M2 moved 12 frames (15:00 -> 15:12)", r.error || r.data);
  r = tool("premiere_move_markers", { sequence_id: state.T1, delta: -0.5, from: 15 });
  ok(!r.error && r.data.count === 1, "move by -0.5 s from 15 s on", r.error || r.data);
};

S.media = () => {
  console.log("\n== versioned file + relink (no Link Media popup)");
  // versions left by an earlier run would make the next one _v3
  for (const f of fs.readdirSync(path.join(ROOT, "media"))) if (/^speech_ana_v\d+\.wav$/.test(f)) fs.rmSync(M(f));
  let r = tool("premiere_versioned_path", { path: M("speech_ana.wav") });
  ok(!r.error && r.data.used_by_project.length >= 1 && /speech_ana_v2\.wav$/.test(r.data.write_to), "original is in use; next version is _v2", r.error || r.data);
  const nv = r.data.write_to;
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", M("speech_ana.wav"), "-af", "volume=-6dB", "-c:a", "pcm_s24le", nv]);
  const before = tlRead({ sequence_id: state.T1 }).data.tracks.find((t) => t.track === "A2").clips[0];
  r = tool("premiere_replace_media", { old_path: M("speech_ana.wav"), new_path: nv });
  ok(!r.error && r.data.relinked >= 1, "relinked to the new version", r.error || r.data);
  const after = tlRead({ sequence_id: state.T1 }).data.tracks.find((t) => t.track === "A2").clips[0];
  ok(after.media === nv && after.start === before.start && after.src_in_s === before.src_in_s, "clip kept its place and in/out, now plays the new file", { before, after });
  r = tool("premiere_replace_media", { old_path: nv, new_path: M("speech_ana.wav") });
  ok(!r.error, "relinked back");
  if (!r.error) fs.rmSync(nv, { force: true });
};

S.captions = () => {
  console.log("\n== captions from transcripts");
  const tr = path.join(ROOT, "transcripts");
  let r = tool("premiere_captions_from_transcripts", { sequence_id: state.T1, transcripts: tr, speaker_map: { "speech_ana*": "ANA", SPEAKER_01: "DAN" }, output_dir: path.join(ROOT, "out") });
  ok(!r.error && r.data.cues > 3 && r.data.speakers.includes("ANA") && r.data.speakers.includes("DAN"), "SRT written with two speakers", r.error || r.data);
  if (!r.error) {
    const srt = fs.readFileSync(r.data.srt, "utf8");
    const words = JSON.parse(fs.readFileSync(path.join(tr, "speech_ana.wav.words.json"), "utf8"));
    const first = srt.split("\n")[1].split(" --> ")[0];
    const want = 2 + words[0].start;
    const [h, m, s] = first.replace(",", ".").split(":").map(Number);
    ok(Math.abs(h * 3600 + m * 60 + s - want) < 0.002, `first cue at ${first} = 2 s + first word (${want.toFixed(3)})`);
    ok(/ANA: Hello there\./.test(srt) && /DAN: Second speaker here\./.test(srt), "labels on speaker changes", srt.slice(0, 300));
    ok(/created/.test(String(r.data.caption_track)), "caption track created", r.data.caption_track);
    state.srt = r.data.srt;
    save();
  }
  r = tool("premiere_find_words", { sequence_id: state.T1, transcripts: tr, words: ["damn", "shit*", "fuck*", "oh my god"] });
  ok(!r.error && r.data.count === 4, "find_words: damn, shit, fuck, 'oh my god'", r.error || r.data);
  if (!r.error) {
    const damn = r.data.hits.find((h) => /damn/i.test(h.word));
    ok(Math.abs(damn.start_s - (2 + 3.042)) < 0.002, `"damn" at ${damn.start} (${damn.start_s} s)`);
    state.hits = r.data.hits;
    save();
  }
};

S.bleep = () => {
  console.log("\n== bleep pass on a copy");
  const tr = path.join(ROOT, "transcripts");
  const before = tlRead({ sequence_id: state.T1 });
  let r = tool("premiere_bleep", { sequence_id: state.T1, transcripts: tr, words: ["damn", "shit*", "fuck*"], output_dir: path.join(ROOT, "out") });
  ok(!r.error && r.data.bleeps.length === 3, "3 bleeps on a copy", r.error || r.data);
  if (r.error) return;
  if (r.data.tone_track_added) console.log(`        ${r.data.tone_track_added}`);
  state.B1 = r.data.bleeped_copy_id;
  save();
  const after = tlRead({ sequence_id: state.T1 });
  ok(after.data.layout_token === before.data.layout_token, "the original sequence is untouched");
  const copy = tlRead({ sequence_id: state.B1 });
  const tone = copy.data.tracks.find((t) => t.track === r.data.tone_track).clips;
  ok(tone.length === 3, `tones on ${r.data.tone_track}`, tone);
  // listen: render the copy's audio around "damn"
  const damn = r.data.bleeps[0];
  const wr = tool("premiere_render_frames", { sequence_id: state.B1, start: Math.max(0, damn.start_s - 1), end: damn.end_s + 1, wav: true, frames: false, preview: 0 });
  ok(!wr.error && wr.data.wav, "rendered the bleeped audio", wr.error);
  if (!wr.error) {
    const t0 = Math.max(0, damn.start_s - 1);
    const wordStart = damn.start_s - 0.07 - t0; // the bleep starts 70 ms into the word
    const toneIn = band(wr.data.wav, damn.start_s - t0 + 0.06, damn.end_s - t0 - 0.03, 1000);
    const toneBefore = band(wr.data.wav, Math.max(0, wordStart - 0.5), wordStart - 0.05, 1000);
    const head = band(wr.data.wav, wordStart, wordStart + 0.05, 0);
    ok(toneIn > -30 && toneIn - toneBefore > 15, `tone over the word (${toneIn} dB in the 1 kHz band vs ${toneBefore} dB before)`);
    ok(head > -45, `first letter still audible (${head} dB in the first 50 ms)`);
  }
};

S.title = () => {
  console.log("\n== title card");
  tool("premiere_open_sequence", { sequence_id: state.T1 });
  const r = tool("premiere_title_card", { sequence_id: state.T1, text: "Claude Bridge v2\\nTitle test", font: "Helvetica", position: "lower_third", at: 30, duration: 3, track: "V3", output_dir: path.join(ROOT, "out") });
  ok(!r.error && fs.existsSync(r.data.png) && r.data.placed && r.data.placed.track === "V3", "title PNG made and placed on V3", r.error || r.data);
  if (!r.error) ok(Math.abs(r.data.placed.end_s - r.data.placed.start_s - 3) < 0.05, `on screen ${(r.data.placed.end_s - r.data.placed.start_s).toFixed(2)} s`);
};

S.jobs = () => {
  console.log("\n== jobs");
  const r = tool("premiere_job_start", {
    steps: [{ label: "count", script: "app.project.sequences.numSequences" }, { label: "broken", script: "var x = 1;\nundefinedThing.go();" }, { label: "never", script: "1" }],
    snapshot_sequence: state.E1
  });
  ok(!r.error && r.data.job, "job started", r.error);
  // the CLI waits for jobs before exiting, so the job is done here; the result is in its file
  const jf = path.join(process.env.HOME, ".claude-adobe-bridge", "jobs", `${r.data.job.id}.json`);
  const job = JSON.parse(fs.readFileSync(jf, "utf8"));
  ok(job.status === "failed" && /broken failed/.test(job.error) && /line 2/.test(job.error), "stops at the failing step and names line 2", job.error);
  ok(job.result && job.result.steps.length === 2 && job.result.steps[0].ok, "first step's result kept, third never ran", job.result);
};

/** One MCP server over stdio, as Claude Code runs it (job status and cancel need the same server process). */
async function mcpSession() {
  const p = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "";
  let id = 0;
  const waiting = new Map();
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        continue;
      }
      if (m.id !== undefined && waiting.has(m.id)) {
        waiting.get(m.id)(m);
        waiting.delete(m.id);
      }
    }
  });
  const send = (method, params) =>
    new Promise((res) => {
      const n = ++id;
      waiting.set(n, res);
      p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    });
  await send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "scratch-test", version: "1" } });
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const call = async (name, args) => {
    const m = await send("tools/call", { name, arguments: args });
    const text = ((m.result && m.result.content) || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { error: m.error ? m.error.message : m.result && m.result.isError ? text : null, data };
  };
  return { call, close: () => p.kill() };
}

S.jobs2 = async () => {
  console.log("\n== snapshot, job status and cancel (one MCP server, as Claude Code runs it)");
  const m = await mcpSession();
  try {
    let r = await m.call("premiere_snapshot", { sequence_id: state.T1, label: "scratch test" });
    ok(!r.error && /scratch test/.test(r.data.saved), "premiere_snapshot saves a copy", r.error || r.data);
    r = await m.call("premiere_job_start", { steps: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `step ${n}`, script: String(n) })), pause_ms: 1500 });
    ok(!r.error && r.data.job && r.data.job.id, "slow job started", r.error || r.data);
    if (r.error) return;
    const id = r.data.job.id;
    await new Promise((res) => setTimeout(res, 2500));
    r = await m.call("premiere_job_status", { job_id: id });
    ok(!r.error && r.data.status === "running", `status while it runs: ${r.data && r.data.status}`, r.error || r.data);
    r = await m.call("premiere_job_cancel", { job_id: id });
    ok(!r.error, "cancel accepted", r.error || r.data);
    r = await m.call("premiere_job_status", { job_id: id, wait_s: 20 });
    ok(!r.error && r.data.status === "cancelled", `job stopped: ${r.data && r.data.status}`, r.error || r.data);
    r = await m.call("premiere_job_status", {});
    ok(!r.error && r.data.jobs.some((j) => j.id === id), "the job list shows it", r.error || r.data);
  } finally {
    m.close();
  }
};

S.errors = () => {
  console.log("\n== error messages");
  let r = tool("premiere_ripple_delete", { sequence_id: state.E1, start: 5, end: 4 });
  ok(r.error && /end must be after start/.test(r.error), "bad range explained", r.error);
  r = tool("premiere_read_timeline", { sequence_id: "No Such Sequence" });
  ok(r.error && /Sequence not found/.test(r.error), "unknown sequence explained", r.error);
  r = tool("premiere_timecode", { sequence_id: state.T1, values: ["00:00:01:30"] });
  ok(r.error && /frames go 00-23/.test(r.error), "bad timecode explained", r.error);
};

S.ame = () => {
  console.log("\n== long range through Media Encoder (job)");
  const r = tool("premiere_render_frames", { sequence_id: state.T1, start: 0, end: 35, step_frames: 240, as_job: true, preview: 0 });
  ok(!r.error && r.data.job, "AME job started", r.error || r.data);
  const jf = path.join(process.env.HOME, ".claude-adobe-bridge", "jobs", `${r.data.job.id}.json`);
  const job = JSON.parse(fs.readFileSync(jf, "utf8"));
  ok(job.status === "done" && job.result.frames.length >= 4, "AME render finished and frames extracted", job.error || job.result);
};

S.close = () => {
  console.log("\n== close the scratch project");
  guard();
  const r = jsx(`(function(){var p=app.project;var path=p.path;var closed=p.closeDocument(false,false);var o=[];for(var i=0;i<app.projects.numProjects;i++){o.push(app.projects[i].path);}return {closed:!!closed,path:path,active:app.project?app.project.path:null,open:o};})()`);
  ok(r.closed, "scratch project closed without saving", r);
  ok(!r.open.some((p) => path.resolve(p) === path.resolve(PROJ)), "scratch project no longer open");
  const userStill = (state.userOpen || []).every((p) => r.open.some((q) => path.resolve(q) === path.resolve(p)));
  ok(userStill, "every project that was open before is still open", { before: state.userOpen, now: r.open });
  ok(state.userActive ? path.resolve(String(r.active)) === path.resolve(state.userActive) : true, `active project is back to ${path.basename(String(state.userActive))}`, r.active);
};

for (const s of want) {
  if (!S[s]) {
    console.log(`(no section ${s})`);
    continue;
  }
  try {
    if (s !== "open") guard();
    await S[s]();
  } catch (e) {
    ok(false, `section ${s} crashed`, e.message);
  }
}
console.log(`\n${pass} passed, ${failed} failed${failed ? ":\n  - " + fails.join("\n  - ") : ""}`);
process.exit(failed ? 1 : 0);
