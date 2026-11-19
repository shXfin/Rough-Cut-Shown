// Runs ppro2.jsx against a small stand-in for Premiere's scripting objects (no Premiere needed), to check the
// logic of the batch ripple delete and the keyframe fades before they're tried for real.
// Run: node --test bridge/test/jsx-mock.test.mjs
// The stand-in only models what these helpers use: tracks, clips with linked partners, razor, QE move (shifts one
// clip and keeps the list in time order, as Premiere 27 does), DOM move/remove (leaves the list as it was), markers,
// a Volume > Level parameter with keyframes, and transitions as Premiere 27 treats them: a DOM clip move or remove
// leaves them where they were, a QE move deletes the moved clip's transitions, QE addTransition adds one. It also
// flags any move that makes clips overlap.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "..", "host", "ppro2.jsx"), "utf8");
const TPS = 254016000000;
const FT = 10594584000; // 23.976
const F = (n) => n * FT;
const UNITY = Math.pow(10, -15 / 20);

class Time {
  constructor() { this._t = 0; }
  get ticks() { return String(this._t); }
  set ticks(v) { this._t = Number(v); }
  get seconds() { return this._t / TPS; }
  set seconds(s) { this._t = Math.round(s * TPS); }
  getFormatted() { return "f" + Math.round(this._t / FT); }
}
const T = (ticks) => { const t = new Time(); t._t = ticks; return t; };
const coll = (arr, key = "numItems") => { const o = { [key]: arr.length }; arr.forEach((v, i) => (o[i] = v)); return o; };

function makeWorld(opts = {}) {
  const qeMove = opts.qeMove !== false;
  let ids = 100;
  const problems = [];
  const seqs = [];
  function levelParam(start = UNITY) {
    const keys = new Map(); // key ticks -> value
    const p = {
      displayName: "Level", _static: start, _tv: false, keys,
      isTimeVarying: () => p._tv,
      setTimeVarying: (b) => { p._tv = !!b; if (!b) keys.clear(); },
      getValue: () => (p._tv && keys.size ? p.getValueAtTime(T(0)) : p._static),
      setValue: (v) => { p._static = v; },
      getKeys: () => (keys.size ? [...keys.keys()].sort((a, b) => a - b).map(T) : null),
      addKey: (t) => { if (!keys.has(t._t)) keys.set(t._t, p.getValueAtTime(t)); },
      setValueAtKey: (t, v) => { keys.set(t._t, v); },
      getValueAtKey: (t) => keys.get(t._t),
      removeKey: (t) => { keys.delete(t._t); },
      getValueAtTime: (t) => {
        if (!keys.size) return p._static;
        const ks = [...keys.keys()].sort((a, b) => a - b), x = t._t;
        if (x <= ks[0]) return keys.get(ks[0]);
        if (x >= ks[ks.length - 1]) return keys.get(ks[ks.length - 1]);
        for (let i = 1; i < ks.length; i++) if (x <= ks[i]) { const a = ks[i - 1], b = ks[i]; return keys.get(a) + ((keys.get(b) - keys.get(a)) * (x - a)) / (b - a); }
      }
    };
    return p;
  }
  function makeSeq(name, label = 15, home = seqs) {
    const seq = {
      sequenceID: "seq-" + ++ids, name, timebase: String(FT), zeroPoint: "0", videoDisplayFormat: 110,
      _v: [], _a: [], _markers: [],
      get end() { let e = 0; for (const t of [...seq._v, ...seq._a]) for (const c of t._clips) e = Math.max(e, c._e); return T(e); },
      get videoTracks() { return coll(seq._v, "numTracks"); },
      get audioTracks() { return coll(seq._a, "numTracks"); },
      getSettings: () => ({ videoFrameRate: T(FT) }),
      // a copy keeps the original's colour label, as in Premiere
      clone: () => { const c = makeSeq(name + " copy", seq.projectItem._label, home); home.push(c); return true; },
      projectItem: { _label: label, moveBin() {}, setColorLabel(n) { this._label = n; }, getColorLabel() { return this._label; } },
      markers: {
        getFirstMarker: () => seq._markers.slice().sort((a, b) => a._s - b._s)[0] || null,
        getNextMarker: (m) => { const l = seq._markers.slice().sort((a, b) => a._s - b._s); return l[l.indexOf(m) + 1] || null; }
      }
    };
    return seq;
  }
  function track(seq, kind) {
    const t = {
      kind, _clips: [], name: kind + (kind === "video" ? seq._v.length + 1 : seq._a.length + 1), _locked: false,
      get clips() { return coll(t._clips.slice()); },
      _trans: [],
      get transitions() { return coll(t._trans.slice().sort((a, b) => a._s - b._s)); },
      isLocked: () => t._locked, isMuted: () => false, setLocked: (b) => { t._locked = !!b; }
    };
    (kind === "video" ? seq._v : seq._a).push(t);
    return t;
  }
  function checkTrack(t, why) {
    const cs = t._clips.slice().sort((a, b) => a._s - b._s);
    for (let i = 1; i < cs.length; i++) if (cs[i]._s < cs[i - 1]._e) problems.push(`${why}: '${cs[i - 1].name}' and '${cs[i].name}' overlap on ${t.name}`);
  }
  function transition(t, name, s, e, alignment) {
    const x = {
      name, matchName: name, nodeId: "tr" + ++ids, _s: s, _e: e, alignment, mediaType: t.kind === "audio" ? "Audio" : "Video",
      get start() { return T(x._s); }, get end() { return T(x._e); },
      move: (arg) => { const d = arg instanceof Time ? arg._t : Math.round(arg * TPS); x._s += d; x._e += d; },
      remove: () => { const i = t._trans.indexOf(x); if (i >= 0) t._trans.splice(i, 1); }
    };
    t._trans.push(x);
    return x;
  }
  function clip(seq, t, name, s, e, inT, media, group, mediaType) {
    const c = {
      name, nodeId: String(++ids), _s: s, _e: e, _in: inT, _t: t, _group: group, _media: media, mediaType, disabled: false,
      get start() { return T(c._s); }, get end() { return T(c._e); },
      get inPoint() { return T(c._in); }, get outPoint() { return T(c._in + (c._e - c._s)); },
      getSpeed: () => 1, isSpeedReversed: () => false, isAdjustmentLayer: () => false, isMGT: () => false,
      projectItem: { getMediaPath: () => media, nodeId: "pi-" + media },
      partners: () => (group ? allClips(seq).filter((x) => x !== c && x._group === group) : []),
      getLinkedItems: () => coll(c.partners()),
      move: (arg) => {
        const d = arg instanceof Time ? arg._t : Math.round(arg * TPS);
        for (const x of [c, ...c.partners()]) { x._s += d; x._e += d; } // linked partners move along (worst case)
        for (const x of [c, ...c.partners()]) checkTrack(x._t, `move of '${c.name}'`);
      },
      remove: () => { t._clips.splice(t._clips.indexOf(c), 1); },
      components: coll(mediaType === "Audio" ? [{ displayName: "Volume", matchName: "audio.Volume", properties: coll([{ displayName: "Bypass" }, levelParam()]) }] : [])
    };
    t._clips.push(c);
    t._clips.sort((a, b) => a._s - b._s);
    return c;
  }
  function allClips(seq) { return [...seq._v, ...seq._a].flatMap((t) => t._clips); }
  function razor(seq, t, ticks) {
    const c = t._clips.find((x) => x._s < ticks && x._e > ticks);
    if (!c) return;
    const n = clip(seq, t, c.name, ticks, c._e, c._in + (ticks - c._s), c._media, c._group ? c._group + "@" + ticks : null, c.mediaType);
    c._e = ticks;
    return n;
  }
  const seq = makeSeq("Test");
  seqs.push(seq);
  const makeProject = (name, list, active) => ({
    name: name + ".prproj", path: "/tmp/" + name + ".prproj",
    get sequences() { return coll(list, "numSequences"); },
    get activeSequence() { return active; },
    openSequence() {},
    rootItem: { children: coll([]), createBin: (n) => ({ type: 2, name: n, children: coll([]) }) },
    getInsertionBin: () => null
  });
  const project = makeProject("mock", seqs, seq);
  // opts.otherProject: a second open project that Premiere has in front (app.project), with its own sequence
  const otherSeqs = [];
  const other = opts.otherProject ? makeProject("other", otherSeqs, null) : null;
  if (other) { const o = makeSeq("Front", 4, otherSeqs); otherSeqs.push(o); Object.defineProperty(other, "activeSequence", { get: () => o }); }
  // QE track: razor, and items whose move("[-]f<frames>") shifts that one clip (not its linked partners) and
  // keeps the list in time order. With qeMove false it lists no items, so the DOM fallback is used.
  const qeTrack = (t) => ({
    razor: (tc) => razor(seq, t, F(Number(String(tc).slice(1)))),
    get numItems() { return qeMove ? t._clips.length : 0; },
    get numTransitions() { return t._trans.length; },
    getTransitionAt: (k) => {
      const x = t._trans.slice().sort((a, b) => a._s - b._s)[k];
      return x ? { type: "Transition", name: x.name, alignment: x.alignment, get start() { return T(x._s); }, get end() { return T(x._e); }, remove: () => x.remove() } : null;
    },
    getItemAt: (k) => {
      const c = t._clips[k];
      return {
        type: "Clip", get start() { return T(c._s); },
        addTransition: (fx, atStart, durTC, offTC, al, single) => {
          const d = F(Number(String(durTC).slice(1))), cut = atStart ? c._s : c._e;
          transition(t, fx.name, cut - al * d, cut + (1 - al) * d, al);
        },
        move: (tc) => {
          const m = /^(-?)f(\d+)$/.exec(String(tc));
          const d = (m[1] ? -1 : 1) * F(Number(m[2]));
          const tol = FT / 2;
          for (const x of t._trans.slice()) if ((x._s <= c._s + tol && x._e >= c._s - tol) || (x._s <= c._e + tol && x._e >= c._e - tol)) x.remove();
          c._s += d; c._e += d;
          t._clips.sort((a, b) => a._s - b._s);
          checkTrack(t, `QE move of '${c.name}'`);
          return true;
        }
      };
    }
  });
  const qeSeq = {
    guid: seq.sequenceID, name: seq.name,
    getVideoTrackAt: (i) => qeTrack(seq._v[i]),
    getAudioTrackAt: (i) => qeTrack(seq._a[i])
  };
  const ctx = {
    __claudeBridge: { stringify: (x) => JSON.stringify(x) },
    app: { project: other || project, projects: coll(other ? [other, project] : [project], "numProjects"), enableQE() {}, version: "mock" },
    qe: { project: { getActiveSequence: () => qeSeq, getAudioTransitionByName: (n) => ({ name: n }), getVideoTransitionByName: (n) => ({ name: n }) } },
    Time, $: { stack: "" }, File: function () { return { exists: true }; }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const call = (name, args, proj) => JSON.parse(ctx.__claudeBridge.v2.call(name, args, proj));
  const marker = (name, s) => { const m = { name, _s: s, _e: s, get start() { return T(m._s); }, set start(sec) { m._s = Math.round(sec * TPS); }, get end() { return T(m._e); }, set end(sec) { m._e = Math.round(sec * TPS); } }; seq._markers.push(m); return m; };
  return { seq, track, clip, transition, call, problems, marker, seqs, otherSeqs, allClips: () => allClips(seq) };
}

// A camera take on V1+A1+A2 (linked), music on A3 with a gap, and markers.
function cutWorld(opts) {
  const w = makeWorld(opts);
  const v1 = w.track(w.seq, "video"), a1 = w.track(w.seq, "audio"), a2 = w.track(w.seq, "audio"), a3 = w.track(w.seq, "audio");
  for (const [n, s, e, src] of [["take1", 0, 240, 1000], ["take2", 240, 480, 5000], ["take3", 480, 720, 9000]]) {
    const g = "g" + n;
    w.clip(w.seq, v1, n, F(s), F(e), F(src), "/m/" + n + ".mov", g, "Video");
    w.clip(w.seq, a1, n, F(s), F(e), F(src), "/m/" + n + ".mov", g, "Audio");
    w.clip(w.seq, a2, n, F(s), F(e), F(src), "/m/" + n + ".mov", g, "Audio");
  }
  w.clip(w.seq, a3, "music", F(100), F(600), 0, "/m/music.wav", null, "Audio");
  return { w, v1, a1, a2, a3 };
}

const layout = (t) => t._clips.slice().sort((a, b) => a._s - b._s).map((c) => [c._s / FT, c._e / FT, c._in / FT]);

for (const qeMove of [true, false]) test(`ripple delete many ranges: every clip ends where one-by-one deletes would put it (${qeMove ? "QE move" : "DOM move fallback"})`, () => {
  const { w, v1, a1, a2, a3 } = cutWorld({ qeMove });
  const mGap = w.marker("in a removed range", F(300));
  const mAfter = w.marker("after", F(600));
  const mBefore = w.marker("before", F(10));
  // ranges in the timeline as it is now; two of them overlap (joined)
  const ranges = [[50, 74], [290, 340], [330, 360], [700, 720]].map(([s, e]) => ({ start: F(s), end: F(e) }));
  const r = w.call("v2_ripple_delete_many", { sequence_id: w.seq.sequenceID, ranges, snapshot: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.ranges.map((x) => [x.start / FT, x.end / FT]), [[50, 74], [290, 360], [700, 720]]);
  assert.deepEqual(w.problems, []);
  // expected: removed 24 + 70 + 20 frames
  const want = [
    [0, 50, 1000], [50, 216, 1074], // take1 cut at 50-74
    [216, 266, 5000], [266, 386, 5120], // take2 cut at 290-360 (source 5000+50 .. 5000+120)
    [386, 606, 9000] // take3 lost its last 20 frames (720 - 114 = 606)
  ];
  for (const t of [v1, a1, a2]) assert.deepEqual(layout(t), want, t.name);
  // music: 100-290 stays (shifted by 24), 290-360 removed, 360-600 shifted by 94
  assert.deepEqual(layout(a3), [[76, 266, 0], [266, 506, 260]]);
  assert.equal(mBefore._s, F(10));
  assert.equal(mGap._s, F(290 - 24)); // went to the cut
  assert.equal(mAfter._s, F(600 - 94));
  assert.equal(r.result.removedTotal, F(114));
  // nothing passed another clip: Premiere's list stays in time order
  for (const t of [v1, a1, a2, a3]) {
    const s = t._clips.map((c) => c._s);
    assert.deepEqual(s, s.slice().sort((a, b) => a - b), t.name + " order");
  }
});

test("ripple delete many: refuses bad ranges and locked tracks out of sync", () => {
  const { w, a3 } = cutWorld();
  let r = w.call("v2_ripple_delete_many", { sequence_id: w.seq.sequenceID, ranges: [{ start: F(10), end: F(10) }], snapshot: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /end must be after start/);
  a3._locked = true;
  r = w.call("v2_ripple_delete_many", { sequence_id: w.seq.sequenceID, ranges: [{ start: F(10), end: F(20) }], snapshot: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /Locked track/);
  assert.equal(w.problems.length, 0);
});

test("ripple delete many saves one snapshot", () => {
  const { w } = cutWorld();
  const n0 = w.seqs.length;
  const r = w.call("v2_ripple_delete_many", { sequence_id: w.seq.sequenceID, ranges: [{ start: F(10), end: F(20) }, { start: F(400), end: F(410) }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(w.seqs.length, n0 + 1);
  assert.ok(r.result.snapshot && /before ripple delete x2/.test(r.result.snapshot.name));
});

test("move range: pieces pass other clips with Premiere's own move, and the clip order stays right", () => {
  const { w, v1, a1, a2, a3 } = cutWorld();
  const r = w.call("v2_move_range", { sequence_id: w.seq.sequenceID, start: F(300), end: F(340), to: F(600), snapshot: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(w.problems, []);
  const want = [[0, 240, 1000], [240, 300, 5000], [300, 440, 5100], [440, 560, 9000], [560, 600, 5060], [600, 720, 9120]];
  for (const t of [v1, a1, a2]) assert.deepEqual(layout(t), want, t.name);
  assert.deepEqual(layout(a3), [[100, 300, 0], [300, 560, 240], [560, 600, 200]]);
  for (const t of [v1, a1, a2, a3]) {
    const s = t._clips.map((c) => c._s);
    assert.deepEqual(s, s.slice().sort((a, b) => a - b), t.name + " order");
  }
});

test("move: without Premiere's own move, a clip is never moved past another (it refuses instead)", () => {
  const { w, v1 } = cutWorld({ qeMove: false });
  const r = w.call("v2_move_range", { sequence_id: w.seq.sequenceID, start: F(300), end: F(340), to: F(600), snapshot: false });
  assert.equal(r.ok, false);
  assert.match(r.error, /past another clip/);
  const s = v1._clips.map((c) => c._s);
  assert.deepEqual(s, s.slice().sort((a, b) => a - b), "V1 order");
});

const trs = (t) => t._trans.slice().sort((a, b) => a._s - b._s).map((x) => [x.name, x._s / FT, x._e / FT]);

test("ripple delete many: transitions go with their cuts; ones on cut-away content are removed", () => {
  const { w, v1, a1 } = cutWorld();
  w.transition(a1, "Constant Power", F(480), F(492), 0); // fade-in on take3
  w.transition(a1, "Constant Power", F(708), F(720), 1); // fade-out on take3, its end gets cut away
  w.transition(v1, "Cross Dissolve", F(474), F(486), 0.5); // take2 -> take3
  const ranges = [[50, 74], [290, 360], [700, 720]].map(([s, e]) => ({ start: F(s), end: F(e) }));
  const r = w.call("v2_ripple_delete_many", { sequence_id: w.seq.sequenceID, ranges, snapshot: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(trs(a1), [["Constant Power", 386, 398]]);
  assert.deepEqual(trs(v1), [["Cross Dissolve", 380, 392]]);
  assert.equal(r.result.transitions.moved, 2);
  assert.equal(r.result.transitions.removed.length, 1);
  assert.equal(r.result.transitions.failed.length, 0);
});

test("ripple delete / insert gap: transitions move with the clips (a DOM move alone would leave them behind)", () => {
  let { w, v1, a1 } = cutWorld();
  w.transition(a1, "Constant Power", F(480), F(492), 0);
  w.transition(v1, "Cross Dissolve", F(234), F(246), 0.5);
  let r = w.call("v2_ripple_delete", { sequence_id: w.seq.sequenceID, start: F(100), end: F(124), snapshot: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(trs(a1), [["Constant Power", 456, 468]]);
  assert.deepEqual(trs(v1), [["Cross Dissolve", 210, 222]]);
  r = w.call("v2_insert_gap", { sequence_id: w.seq.sequenceID, at: F(300), duration: F(48), snapshot: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(trs(a1), [["Constant Power", 504, 516]]);
  assert.deepEqual(trs(v1), [["Cross Dissolve", 210, 222]]);
  ({ w, v1, a1 } = cutWorld());
  w.transition(a1, "Constant Power", F(480), F(492), 0);
  // a fade-in whose clip head is cut away goes with it
  r = w.call("v2_ripple_delete", { sequence_id: w.seq.sequenceID, start: F(470), end: F(500), snapshot: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(trs(a1), []);
  assert.equal(r.result.transitions.removed.length, 1);
});

test("move range: a transition on a moved piece is put back after Premiere's own move deletes it", () => {
  const { w, a1 } = cutWorld();
  w.transition(a1, "Constant Power", F(240), F(252), 0); // fade-in at take2's start, inside the moved stretch
  w.transition(a1, "Constant Power", F(708), F(720), 1); // fade-out at the end, outside it
  const r = w.call("v2_move_range", { sequence_id: w.seq.sequenceID, start: F(230), end: F(260), to: F(600), snapshot: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(trs(a1), [["Constant Power", 580, 592], ["Constant Power", 708, 720]]);
  assert.equal(r.result.transitions.readded.length, 1);
  assert.equal(r.result.transitions.failed.length, 0);
});

function levelOf(c) { return c.components[0].properties[1]; }
const db = (v) => 20 * Math.log10(v) + 15;

test("audio fade with keyframes: keys in source time, from silence to the clip's own level", () => {
  const { w, a1 } = cutWorld();
  const take2 = a1._clips.find((c) => c.name === "take2");
  const p = levelOf(take2);
  p._static = Math.pow(10, (-6 - 15) / 20); // the clip plays at -6 dB
  const r = w.call("v2_audio_fade", { sequence_id: w.seq.sequenceID, clips: [{ track: "A1", at: F(300) }], fade_in: F(2), fade_out: F(12), include_linked: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.faded.length, 1);
  const keys = [...p.keys.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => [t / FT, Math.round(db(v) * 100) / 100]);
  // take2 shows source 5000..5240 frames
  assert.deepEqual(keys, [[5000, -Infinity], [5002, -6], [5228, -6], [5240, -Infinity]]);
  assert.equal(r.result.faded[0].levelDb, -6);
});

test("audio fade: running it again replaces its own keys, keeps keys outside the fades", () => {
  const { w, a1 } = cutWorld();
  const take2 = a1._clips.find((c) => c.name === "take2");
  const p = levelOf(take2);
  p._tv = true;
  p.keys.set(F(5100), UNITY); // a ducking dip the editor made
  p.keys.set(F(5110), UNITY * 0.5);
  p.keys.set(F(5120), UNITY);
  for (let i = 0; i < 2; i++) {
    const r = w.call("v2_audio_fade", { sequence_id: w.seq.sequenceID, clips: [{ track: "A1", at: F(300) }], fade_in: F(2), fade_out: F(2), include_linked: false });
    assert.equal(r.ok, true, JSON.stringify(r));
    if (i === 1) assert.equal(r.result.faded[0].replacedKeys, 4);
  }
  assert.deepEqual([...p.keys.keys()].sort((a, b) => a - b).map((t) => t / FT), [5000, 5002, 5100, 5110, 5120, 5238, 5240]);
  assert.equal(p.keys.get(F(5110)), UNITY * 0.5);
});

test("audio fade on a video clip fades its linked audio channels only", () => {
  const { w, a1, a2, a3 } = cutWorld();
  const r = w.call("v2_audio_fade", { sequence_id: w.seq.sequenceID, clips: [{ track: "V1", at: F(10) }], fade_in: F(2) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.result.faded.map((f) => f.clip.track).sort(), [0, 1]);
  assert.equal(levelOf(a1._clips[0]).keys.size, 2);
  assert.equal(levelOf(a2._clips[0]).keys.size, 2);
  assert.equal(levelOf(a3._clips[0]).keys.size, 0);
});

test("audio fade over a range: every edit, but not where the same take carries on", () => {
  const { w, a1 } = cutWorld();
  // razor take2 in two with continuous source: a through edit at 360
  w.call("v2_ripple_delete_many", { sequence_id: w.seq.sequenceID, ranges: [{ start: F(700), end: F(720) }], snapshot: false });
  const t2 = a1._clips.find((c) => c.name === "take2");
  const cut = w.clip(w.seq, a1, "take2", F(360), F(480), t2._in + F(120), t2._media, null, "Audio");
  t2._e = F(360);
  const r = w.call("v2_audio_fade", { sequence_id: w.seq.sequenceID, range: { start: 0, end: F(800) }, tracks: ["A1"], fade_in: F(2), fade_out: F(2) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.faded.length, 4);
  assert.ok(r.result.skipped.some((s) => /carries on/.test(s.why)));
  assert.deepEqual([...levelOf(t2).keys.keys()].sort((a, b) => a - b).map((t) => t / FT), [5000, 5002]); // fade in only
  assert.deepEqual([...levelOf(cut).keys.keys()].sort((a, b) => a - b).map((t) => t / FT), [5238, 5240]); // fade out only
});

test("audio fade: fades longer than the clip are shortened to fit", () => {
  const { w, a1 } = cutWorld();
  const r = w.call("v2_audio_fade", { sequence_id: w.seq.sequenceID, clips: [{ track: "A1", at: F(10) }], fade_in: F(200), fade_out: F(200), include_linked: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  const f = r.result.faded[0];
  assert.equal(f.fadeIn + f.fadeOut, F(240));
  assert.match(f.note, /shortened/);
});

test("snapshot: the copy is labelled Magenta, the original keeps its colour", () => {
  const { w } = cutWorld();
  const r = w.call("v2_snapshot", { sequence_id: w.seq.sequenceID, label: "test" });
  assert.equal(r.ok, true, JSON.stringify(r));
  const copy = w.seqs.find((s) => s.sequenceID === r.result.id);
  assert.equal(copy.projectItem._label, 11);
  assert.equal(w.seq.projectItem._label, 15);
  assert.equal(r.result.project, "mock.prproj");
  assert.equal(r.result.labelWarning, undefined);
  // edit tools' own snapshots too
  const e = w.call("v2_ripple_delete_many", { sequence_id: w.seq.sequenceID, ranges: [{ start: F(10), end: F(20) }] });
  assert.equal(e.ok, true, JSON.stringify(e));
  assert.equal(w.seqs.find((s) => s.sequenceID === e.result.snapshot.id).projectItem._label, 11);
});

test("two projects open: a sequence is found and copied in its own project, not the one in front", () => {
  const { w } = cutWorld({ otherProject: true });
  const r = w.call("v2_snapshot", { sequence_id: w.seq.sequenceID, label: "test" });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.project, "mock.prproj");
  assert.ok(w.seqs.some((s) => s.sequenceID === r.result.id));
  assert.equal(w.otherSeqs.length, 1, "nothing added to the project in front");
  // by name too, when only that project has it
  const n = w.call("v2_seq_info", { sequence_id: "Test" });
  assert.equal(n.ok, true, JSON.stringify(n));
  assert.equal(n.result.project, "mock.prproj");
  // without sequence_id: the front project's active sequence...
  const f = w.call("v2_seq_info", {});
  assert.equal(f.result.name, "Front");
  // ...unless the project is named by path (or name)
  const p = w.call("v2_seq_info", {}, "/tmp/mock.prproj");
  assert.equal(p.result.name, "Test");
  assert.equal(w.call("v2_seq_info", {}, "mock").result.name, "Test");
  // a sequence of another project isn't looked for when the project is named
  const x = w.call("v2_seq_info", { sequence_id: w.otherSeqs[0].sequenceID }, "/tmp/mock.prproj");
  assert.equal(x.ok, false);
  assert.match(x.error, /not found in mock\.prproj/);
  const bad = w.call("v2_seq_info", {}, "/tmp/nope.prproj");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /isn't open in Premiere.*\/tmp\/other\.prproj, \/tmp\/mock\.prproj/);
});
