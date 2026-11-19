// Unit tests for the v2 logic that doesn't need Premiere.  Run: node --test bridge/test/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeClock, TPS, srtTime } from "../v2/lib/timecode.mjs";
import { parseTranscript, mediaKey, loadTranscripts } from "../v2/lib/transcripts.mjs";
import { mapWordsToSequence, buildCues, toSrt, findWords, bleepRanges, wrapLines, resolveSpeaker } from "../v2/lib/captions.mjs";
import { makeToken, parseToken, describeChanges } from "../v2/lib/layout.mjs";
import { nextVersionPath } from "../v2/lib/files.mjs";
import { resolveEffect, dbToLevel, levelToDb } from "../v2/tools/effects.mjs";
import { _test as R } from "../v2/tools/render.mjs";

const F23 = 10594584000; // ticks per frame at 23.976
const F2997 = 8475667200;
const F25 = 10160640000;

test("23.976 non-drop: 24 timecode frames per 1.001 s", () => {
  const c = makeClock({ timebase: F23, zeroPoint: 0 });
  assert.equal(c.base, 24);
  assert.equal(c.dropFrame, false);
  assert.equal(c.tc(0), "00:00:00:00");
  assert.equal(c.tc(24 * F23), "00:00:01:00");
  // one timecode minute is 60.06 real seconds
  const t = c.parse("00:01:00:00");
  assert.equal(t, 1440 * F23);
  assert.ok(Math.abs(t / TPS - 60.06) < 1e-9);
  assert.equal(c.format(t).f, 1440);
  // seconds snap to the frame they fall in
  assert.equal(c.floorFrame(c.parse(1.0)), 23);
  assert.equal(c.parse("300f"), 300 * F23);
  assert.equal(c.parse("12.5s"), Math.round(12.5 * TPS));
});

test("29.97 drop-frame round trips and skips ;00 and ;01 each minute", () => {
  const c = makeClock({ timebase: F2997, zeroPoint: 0, dropFrame: true });
  assert.equal(c.dropFrame, true);
  assert.equal(c.framesToTC(1799), "00;00;59;29");
  assert.equal(c.framesToTC(1800), "00;01;00;02");
  assert.equal(c.framesToTC(17982), "00;10;00;00");
  for (const f of [0, 1, 1799, 1800, 1801, 17981, 17982, 107892, 107891, 123456]) {
    assert.equal(c.tcToFrames(c.framesToTC(f)), f, `frame ${f}`);
  }
  // one hour of drop-frame is 107892 frames
  assert.equal(c.tcToFrames("01;00;00;00"), 107892);
});

test("start offset: timecode includes it, seconds don't", () => {
  const c = makeClock({ timebase: F25, zeroPoint: 3600 * TPS });
  assert.equal(c.tc(0), "01:00:00:00");
  assert.equal(c.parse("01:00:10:00"), 250 * F25);
  assert.equal(c.parse(10), 10 * TPS);
  assert.throws(() => c.parse("00:00:10:00"), /before the sequence start.*01:00:10:00/);
  assert.throws(() => c.parse("00:00:10:25"), /valid/);
  assert.throws(() => c.parse("soon"), /Can't read/);
});

test("srtTime", () => {
  assert.equal(srtTime(0), "00:00:00,000");
  assert.equal(srtTime(3661.0456), "01:01:01,046");
});

test("transcript shapes: list, WhisperX segments, word_segments, missing times", () => {
  const a = parseTranscript([{ w: "hi", start: 1, end: 1.2 }, { word: "there", start: 1.3, end: 1.6 }]);
  assert.deepEqual(a.words.map((w) => w.text), ["hi", "there"]);
  const b = parseTranscript({
    segments: [{ speaker: "SPEAKER_00", words: [{ word: " one", start: 0, end: 0.3 }, { word: "2", score: 0 }, { word: "three", start: 1, end: 1.4 }] }]
  });
  assert.equal(b.words.length, 3);
  assert.equal(b.words[1].estimated, true);
  assert.ok(b.words[1].start >= 0.3 && b.words[1].end <= 1.0);
  assert.equal(b.words[0].speaker, "SPEAKER_00");
  const c = parseTranscript({ word_segments: [{ word: "x", start: 2, end: 2.1 }] });
  assert.equal(c.words[0].start, 2);
});

test("mediaKey matches transcripts to media across names", () => {
  assert.equal(mediaKey("/x/A001C003.MP4.words.json"), "a001c003");
  assert.equal(mediaKey("A001C003_Proxy.mov"), "a001c003");
  assert.equal(mediaKey("/Volumes/x/00001_Wireless PRO.WAV"), "00001_wireless pro");
  assert.equal(mediaKey("00001_Wireless PRO.json"), "00001_wireless pro");
});

function transcripts(map) {
  const m = new Map();
  for (const [k, words] of Object.entries(map)) m.set(mediaKey(k), { words, file: k + ".json" });
  return m;
}

test("word mapping: in point, trims, speed, muted, disabled, duplicates on two tracks", () => {
  const words = [
    { text: "before", start: 0.5, end: 0.9 },
    { text: "hello", start: 10.0, end: 10.4 },
    { text: "world.", start: 10.5, end: 11.0 },
    { text: "after", start: 20, end: 20.5 }
  ];
  const t = transcripts({ "lav.wav": words, "cam.mov": words });
  const clips = [
    { track: 0, name: "lav", start: 100, end: 102, in: 10, out: 12, speed: 1, mediaPath: "/m/lav.wav" },
    // same speech on the camera track: dropped as a duplicate
    { track: 2, name: "cam", start: 100, end: 102, in: 10, out: 12, speed: 1, mediaPath: "/m/cam.mov" },
    // half speed: "hello" lands at 200 + (10-10)/0.5
    { track: 1, name: "lav slow", start: 200, end: 204, in: 10, out: 12, speed: 0.5, mediaPath: "/m/lav.wav" },
    { track: 3, name: "muted", start: 300, end: 302, in: 10, out: 12, speed: 1, mediaPath: "/m/lav.wav", trackMuted: true },
    { track: 0, name: "off", start: 400, end: 402, in: 10, out: 12, speed: 1, mediaPath: "/m/lav.wav", disabled: true }
  ];
  const r = mapWordsToSequence(clips, t, {});
  const at100 = r.words.filter((w) => w.start < 150);
  assert.deepEqual(at100.map((w) => w.text), ["hello", "world."]);
  assert.equal(at100[0].track, 0);
  const slow = r.words.filter((w) => w.start >= 200 && w.start < 210);
  assert.equal(slow[0].start, 200);
  assert.ok(Math.abs(slow[1].start - 201) < 1e-9); // (10.5-10)/0.5
  assert.ok(Math.abs(slow[1].end - 202) < 1e-9);
  assert.ok(!r.words.some((w) => w.start >= 300));
  assert.equal(r.skipped.length, 2);
  // prefer the camera track instead
  const r2 = mapWordsToSequence(clips.slice(0, 2), t, { prefer_tracks: [2] });
  assert.equal(r2.words[0].track, 2);
});

test("speaker map by transcript label, clip, file and track", () => {
  const w = { speaker: "SPEAKER_01", clip: "C015", mediaPath: "/x/00002_Wireless PRO.WAV", track: 1 };
  assert.equal(resolveSpeaker(w, { SPEAKER_01: "ANA" }), "ANA");
  assert.equal(resolveSpeaker({ ...w, speaker: null }, { "*wireless*": "HOST" }), "HOST");
  assert.equal(resolveSpeaker({ ...w, speaker: null }, { A2: "GUEST" }), "GUEST");
  assert.equal(resolveSpeaker({ ...w, speaker: null }, {}), null);
});

test("cues: breaks on pauses, speakers, sentence ends; wraps at 42; labels when 2 speakers", () => {
  const mk = (text, s, e, speaker = "A") => ({ text, start: s, end: e, speaker });
  const words = [
    mk("So", 0, 0.2), mk("this", 0.25, 0.4), mk("is", 0.45, 0.5), mk("the", 0.55, 0.6), mk("first", 0.65, 0.9), mk("line.", 0.95, 1.2),
    mk("And", 3, 3.2), mk("here", 3.25, 3.5),
    mk("Yes!", 3.6, 4.0, "B")
  ];
  const cues = buildCues(words, {});
  assert.equal(cues.length, 3);
  assert.equal(cues[0].text, "A: So this is the first line.");
  assert.equal(cues[1].text, "And here"); // same speaker as the cue before: no label
  assert.equal(cues[2].text, "B: Yes!");
  assert.ok(cues[1].end <= cues[2].start - 0.04 + 1e-9);
  const srt = toSrt(cues);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:01,400\nA: So this is the first line\.\n\n2\n/);
  const lines = wrapLines("This is a fairly long caption line that needs to wrap in two", 42, 2);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.length <= 42));
});

test("find words with wildcards and phrases; bleep keeps the first letter", () => {
  const words = [
    { text: "Oh,", start: 0, end: 0.2 },
    { text: "my", start: 0.25, end: 0.4 },
    { text: "God", start: 0.45, end: 0.8 },
    { text: "that's", start: 1, end: 1.2 },
    { text: "SHITTY!", start: 1.3, end: 1.7, track: 0 }
  ];
  const hits = findWords(words, ["shit*", "oh my god"]);
  assert.deepEqual(hits.map((h) => h.text), ["Oh, my God", "SHITTY!"]);
  const r = bleepRanges([hits[1]], { keep_first_ms: 70 });
  assert.ok(Math.abs(r[0].start - 1.37) < 1e-9);
  assert.ok(Math.abs(r[0].end - 1.73) < 1e-9);
  // a very short word keeps at most 35% of itself
  const short = bleepRanges([{ text: "f", start: 5, end: 5.1 }], { keep_first_ms: 70 });
  assert.ok(Math.abs(short[0].start - 5.035) < 1e-9);
  // overlapping ranges merge
  const m = bleepRanges([{ text: "a", start: 0, end: 0.3 }, { text: "b", start: 0.25, end: 0.6 }], {});
  assert.equal(m.length, 1);
});

test("layout tokens and change descriptions", () => {
  const clips = [{ kind: "video", track: 0, nodeId: "1", name: "A", start: 0, end: 100, in: 0, out: 100 }];
  const t1 = makeToken("seq", 0, 500, clips);
  const t2 = makeToken("seq", 0, 500, [{ ...clips[0], end: 120 }]);
  assert.notEqual(t1, t2);
  assert.deepEqual(parseToken(t1).start, 0);
  assert.throws(() => parseToken("nope"), /isn't a layout token/);
  const d = describeChanges(clips, [{ ...clips[0], start: 10, end: 110 }], (t) => `${t}`);
  assert.match(d[0], /moved\/trimmed/);
});

test("versioned paths never reuse a name", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-test-"));
  const f = path.join(dir, "mix.wav");
  fs.writeFileSync(f, "x");
  assert.equal(await nextVersionPath(f), path.join(dir, "mix_v2.wav"));
  fs.writeFileSync(path.join(dir, "mix_v2.wav"), "x");
  assert.equal(await nextVersionPath(f), path.join(dir, "mix_v3.wav"));
  assert.equal(await nextVersionPath(path.join(dir, "take_v009.wav")), path.join(dir, "take_v010.wav"));
  assert.equal(await nextVersionPath(f, async (p) => p.endsWith("_v3.wav")), path.join(dir, "mix_v4.wav"));
  fs.rmSync(dir, { recursive: true });
});

test("loadTranscripts from a folder and a map", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-tr-"));
  fs.writeFileSync(path.join(dir, "A001.MP4.words.json"), JSON.stringify([{ w: "a", start: 0, end: 1 }]));
  fs.writeFileSync(path.join(dir, "other.json"), JSON.stringify({ segments: [{ words: [{ word: "b", start: 0, end: 1 }] }] }));
  const t = await loadTranscripts(dir);
  assert.ok(t.get("a001"));
  const t2 = await loadTranscripts({ "/media/Cam B.mov": path.join(dir, "other.json") });
  assert.ok(t2.get("cam b"));
  fs.rmSync(dir, { recursive: true });
});

test("effect aliases and volume dB", () => {
  assert.deepEqual(resolveEffect("directional blur", "direction").param, "Direction");
  assert.ok(resolveEffect("directional blur", "direction").paramAliases.includes("Angle"));
  assert.equal(resolveEffect("Lumetri", "exposure").effect, "Lumetri Color");
  assert.equal(resolveEffect("Some Plugin", "Knob").param, "Knob");
  assert.ok(Math.abs(dbToLevel(0) - 0.1778) < 1e-4);
  assert.equal(dbToLevel(15), 1);
  assert.equal(dbToLevel(-Infinity), 0);
  assert.ok(Math.abs(levelToDb(dbToLevel(-6)) + 6) < 1e-9);
});

test("render: frames group into a few renders", () => {
  assert.deepEqual(R.clusters([1, 2, 3, 100, 101, 400], 48), [[1, 2, 3], [100, 101], [400]]);
  const c = makeClock({ timebase: F23, zeroPoint: 0 });
  const r = R.framesFrom(c, { start: 0, end: "00:00:00:23" }, F23);
  assert.equal(r.frames.length, 24);
  const r2 = R.framesFrom(c, { start: 0, end: 10, wav: true }, F23);
  assert.equal(r2.frames.length, 20); // frames 0, 12, ... 228 (two per second over 10 s)
  assert.deepEqual(r2.wavRange, [0, 239]);
  assert.throws(() => R.framesFrom(c, {}, F23), /Pass times/);
});
