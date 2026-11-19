// Tested timeline edits: ripple delete / insert / move across all tracks, exact clip placement,
// rippling speed changes, marker moves. Each one checks the layout it depends on (expect_layout),
// saves a copy of the sequence first, and if it fails partway says what was done and where the copy is.
import * as P from "../lib/premiere.mjs";
import { seqClock, clipRef, clipOut, expectFor, snapshotNote } from "../lib/common.mjs";
import { withActivity } from "../lib/jobs.mjs";
import { TPS } from "../lib/timecode.mjs";

function base(a, info, expect) {
  return { sequence_id: info.id, expect, snapshot: a.snapshot, ignore_locked: a.ignore_locked, markers: a.markers };
}

// Transitions don't follow scripted moves in Premiere, so every edit puts them back on their cuts (ppro2.jsx,
// carryTransitions) and says what it did.
function transitionsOut(clock, t) {
  if (!t) return undefined;
  const one = (x) => `${x.track} ${x.name} ${clock.tc(x.start)}-${clock.tc(x.end)}`;
  const o = {};
  if (t.moved) o.moved_with_their_clips = t.moved;
  if (t.readded.length) o.added_again = t.readded.map(one);
  if (t.removed.length) o.removed_with_cut_away_content = t.removed.map(one);
  if (t.failed.length) o.NOT_FIXED = { transitions: t.failed.map(one), what_to_do: "These transitions are no longer on a clip edge. Delete them in the Timeline (an orphaned audio transition can silence the rest of its track), then re-add with premiere_audio_fade or premiere_transition." };
  return Object.keys(o).length ? o : undefined;
}

function finish(clock, r, extra = {}) {
  const out = { ...extra };
  if (r.newEnd !== undefined) out.sequence_now_ends = clock.tc(r.newEnd);
  const tr = transitionsOut(clock, r.transitions);
  if (tr) out.transitions = tr;
  const note = snapshotNote(r);
  if (note) out.snapshot = note;
  if (r.note) out.note = r.note;
  return out;
}

export function register(def, { z, S }) {
  const markers = z.enum(["shift", "keep"]).optional().describe("Sequence markers after the edit point move with the cut (default shift) or stay put");
  const ignoreLocked = z.boolean().optional().describe("Edit even if a locked track has clips that would go out of sync");

  def(
    "premiere_ripple_delete",
    "Remove a time range from every unlocked track and close the gap (like Premiere's Extract, across all tracks): clips crossing the edges are cut, everything after slides left by the same amount, markers after it follow. Refuses if a locked track would go out of sync.",
    { ...S.Common, start: S.Time, end: S.Time.describe("Exclusive: the first frame that stays"), markers, ignore_locked: ignoreLocked, ...S.Safety },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const start = clock.snap(clock.parse(a.start, "start"));
      const end = clock.snap(clock.parse(a.end, "end"));
      const expect = await expectFor(info, clock, a.expect_layout, [start, end]);
      return withActivity(`ripple delete ${clock.tc(start)}-${clock.tc(end)} in "${info.name}"`, async () => {
        const r = await P.call("v2_ripple_delete", { ...base(a, info, expect), start, end }, { timeoutMs: 180000, label: "ripple delete" });
        return finish(clock, r, { removed: `${clock.tc(start)}-${clock.tc(end)} (${Math.round(((end - start) / TPS) * 1000) / 1000} s)`, clip_pieces_removed: r.removed, clips_shifted: r.shifted, markers_shifted: r.markersShifted });
      });
    }
  );

  def(
    "premiere_ripple_delete_ranges",
    "Remove many time ranges in ONE edit and close every gap (Extract across all unlocked tracks), e.g. all the pauses, flubs and bad takes of a cut at once. Give every range in the timeline as it is NOW: no need to work out where things land after each cut. Much faster than one premiere_ripple_delete per range: one snapshot, one layout check, and each clip after the first cut moves once, straight to its final place. Overlapping or touching ranges are joined. Markers after a cut follow; a marker inside a removed range goes to that cut. Refuses if a locked track would go out of sync.",
    {
      ...S.Common,
      ranges: z.array(z.object({ start: S.Time, end: S.Time.describe("Exclusive: the first frame that stays") })).min(1),
      markers,
      ignore_locked: ignoreLocked,
      ...S.Safety
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const ranges = a.ranges.map((r, i) => {
        const start = clock.snap(clock.parse(r.start, `ranges[${i}].start`));
        const end = clock.snap(clock.parse(r.end, `ranges[${i}].end`));
        if (!(end > start)) throw new Error(`ranges[${i}]: end (${clock.tc(end)}) must be after start (${clock.tc(start)}).`);
        return { start, end };
      });
      const lo = Math.min(...ranges.map((r) => r.start));
      const hi = Math.max(...ranges.map((r) => r.end));
      const expect = await expectFor(info, clock, a.expect_layout, [lo, hi]);
      return withActivity(`ripple delete ${ranges.length} ranges in "${info.name}"`, async () => {
        const r = await P.call("v2_ripple_delete_many", { ...base(a, info, expect), ranges }, { timeoutMs: Math.min(1800000, 180000 + 30000 * ranges.length), label: "ripple delete ranges" });
        return finish(clock, r, {
          removed: r.ranges.map((x) => `${clock.tc(x.start)}-${clock.tc(x.end)}`),
          removed_total_s: Math.round((r.removedTotal / TPS) * 1000) / 1000,
          ...(r.ranges.length < ranges.length ? { joined: `${ranges.length} ranges given, ${r.ranges.length} after joining overlaps` } : {}),
          clip_pieces_removed: r.removed,
          clips_moved: r.moved,
          markers_shifted: r.markersShifted
        });
      });
    }
  );

  def(
    "premiere_insert_gap",
    "Open a gap at a time on every unlocked track (or only the tracks you list): clips crossing that point are cut and everything after slides right. Markers after it follow when all tracks move.",
    {
      ...S.Common,
      at: S.Time,
      duration: S.Time.describe('Length of the gap: seconds, "48f" or a timecode duration'),
      tracks: z.array(z.string()).optional().describe('Only these tracks, e.g. ["V1","A1"] (default all, which keeps sync)'),
      markers,
      ignore_locked: ignoreLocked,
      ...S.Safety
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const at = clock.snap(clock.parse(a.at, "at"));
      const dur = clock.snap(typeof a.duration === "string" && /[:;]/.test(a.duration) ? clock.tcToFrames(a.duration) * clock.frameTicks : clock.parse(a.duration, "duration"));
      const expect = await expectFor(info, clock, a.expect_layout, [at, at]);
      return withActivity(`insert gap at ${clock.tc(at)} in "${info.name}"`, async () => {
        const r = await P.call("v2_insert_gap", { ...base(a, info, expect), at, duration: dur, tracks: a.tracks || "all" }, { timeoutMs: 180000, label: "insert gap" });
        return finish(clock, r, { gap: `${clock.tc(at)} + ${Math.round((dur / TPS) * 1000) / 1000} s`, clips_shifted: r.shifted, markers_shifted: r.markersShifted });
      });
    }
  );

  def(
    "premiere_move_range",
    "Ripple-move a time range (every unlocked track) to another point and close the hole it leaves: the same as cutting it out and inserting it elsewhere, with sync kept. `to` is a time in the timeline as it is now (before the move). Markers inside the range travel with it.",
    { ...S.Common, start: S.Time, end: S.Time, to: S.Time.describe("Where the range should start, in the current timeline"), markers, ignore_locked: ignoreLocked, ...S.Safety },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const start = clock.snap(clock.parse(a.start, "start"));
      const end = clock.snap(clock.parse(a.end, "end"));
      const to = clock.snap(clock.parse(a.to, "to"));
      const expect = await expectFor(info, clock, a.expect_layout, [Math.min(start, to), Math.max(end, to)]);
      return withActivity(`move ${clock.tc(start)}-${clock.tc(end)} to ${clock.tc(to)} in "${info.name}"`, async () => {
        const r = await P.call("v2_move_range", { ...base(a, info, expect), start, end, to }, { timeoutMs: 240000, label: "move range" });
        const landed = to < start ? to : to - (end - start);
        return finish(clock, r, { moved: `${clock.tc(start)}-${clock.tc(end)}`, now_starts_at: clock.tc(landed), pieces_moved: r.moved, markers_moved: r.markersMoved });
      });
    }
  );

  def(
    "premiere_place_clip",
    "Put a source range on the timeline at an exact time with an exact source in/out (overwriteClip can land a frame early; this checks and slips it back). Choose the video track and/or audio track: every other track is locked during the placement, so a camera clip with 4 audio channels can't spill onto (and overwrite) other audio tracks; extra channel clips are removed. mode insert opens room first (ripples everything after).",
    {
      ...S.Common,
      source: z.object({ path: z.string().optional(), node_id: z.string().optional(), bin: z.string().optional() }).describe("Media file path (imported if needed) or project item node_id"),
      src_in: z.number().min(0).describe("Source in, seconds from the media's first frame"),
      src_out: z.number().min(0).describe("Source out, seconds (exclusive)"),
      at: S.Time.describe("Where it starts on the timeline"),
      video_track: z.string().optional().describe('e.g. "V2"; omit for audio only'),
      audio_track: z.string().optional().describe('e.g. "A1"; omit for video only'),
      mode: z.enum(["overwrite", "insert"]).optional(),
      ...S.Safety
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const at = clock.snap(clock.parse(a.at, "at"));
      const inT = Math.round(a.src_in * TPS);
      const outT = Math.round(a.src_out * TPS);
      const len = clock.snap(outT - inT);
      const expect = await expectFor(info, clock, a.expect_layout, [at, at + len]);
      const src = { ...a.source, path: a.source.path ? a.source.path.replace(/^~(?=\/)/, process.env.HOME) : undefined };
      return withActivity(`placing a clip at ${clock.tc(at)} in "${info.name}"`, async () => {
        const r = await P.call(
          "v2_place_clip",
          { sequence_id: info.id, expect, snapshot: a.snapshot ?? a.mode === "insert", source: src, src_in: inT, src_out: inT + len, at, video_track: a.video_track || null, audio_track: a.audio_track || null, mode: a.mode || "overwrite" },
          { timeoutMs: 120000, label: "place clip" }
        );
        return finish(clock, r, { placed: r.placed.map((c) => clipOut(clock, c)), extra_channel_clips_removed: r.removedSpill || 0 });
      });
    }
  );

  def(
    "premiere_set_speed",
    "Change a clip's speed and make room on the timeline (or close up) so the same source still plays. Room is opened first, then Premiere's own speed change sets the new length, so the clip stays a normal clip (it can still be cut, trimmed and keyframed). ripple: sequence (default; everything after moves on every track, keeps sync), track (only this clip's track and its linked audio), none (no room made: the clip is cut short if blocked). Linked audio gets the same speed unless include_linked is false.",
    {
      ...S.Common,
      clip: S.ClipRef,
      speed: z.union([z.number().positive(), z.string()]).describe('1 = 100%, 0.5 = half speed, or "50%"'),
      ripple: z.enum(["sequence", "track", "none"]).optional(),
      include_linked: z.boolean().optional(),
      maintain_pitch: z.boolean().optional(),
      reverse: z.boolean().optional(),
      ...S.Safety
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const speed = typeof a.speed === "string" ? (/%$/.test(a.speed.trim()) ? parseFloat(a.speed) / 100 : parseFloat(a.speed)) : a.speed;
      if (!(speed > 0)) throw new Error(`Can't read speed "${a.speed}". Use 0.5 or "50%".`);
      const ref = clipRef(clock, a.clip);
      const point = ref.at ?? 0;
      const expect = await expectFor(info, clock, a.expect_layout, a.expect_layout ? [point, point] : null);
      return withActivity(`speed change in "${info.name}"`, async () => {
        const r = await P.call("v2_set_speed", { sequence_id: info.id, expect, snapshot: a.snapshot, clip: ref, speed, ripple: a.ripple || "sequence", include_linked: a.include_linked, maintain_pitch: a.maintain_pitch, reverse: a.reverse }, { timeoutMs: 180000, label: "set speed" });
        return finish(clock, r, {
          speed: `${Math.round(r.oldSpeed * 1000) / 10}% -> ${Math.round(speed * 1000) / 10}%`,
          clip_now_ends: clock.tc(r.newEnd),
          was_ending: clock.tc(r.oldEnd),
          ...(Math.abs(r.newEnd - r.expectedEnd) > clock.frameTicks / 2 ? { warning: `Expected it to end at ${clock.tc(r.expectedEnd)}; Premiere rounded it to ${clock.tc(r.newEnd)}.` } : {}),
          clips: r.clips.map((c) => clipOut(clock, c))
        });
      });
    }
  );

  def(
    "premiere_move_markers",
    "Move sequence markers by an amount (all of them, those in a time range, or those whose name contains a word). Marker times are set in seconds the way Premiere expects, and each move is checked.",
    {
      ...S.Common,
      delta: z.union([z.number(), z.string()]).describe('Seconds (negative moves left) or frames like "-12f" / "+48f"'),
      from: S.Time.optional().describe("Only markers starting at/after this"),
      to: S.Time.optional().describe("Only markers starting before this"),
      names: z.array(z.string()).optional().describe("Only markers whose name contains one of these")
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      let delta;
      if (typeof a.delta === "number") delta = Math.round(a.delta * TPS);
      else {
        const m = String(a.delta).trim().match(/^([+-]?)(\d+)f$/i);
        if (m) delta = (m[1] === "-" ? -1 : 1) * Number(m[2]) * clock.frameTicks;
        else delta = Math.round(parseFloat(a.delta) * TPS);
      }
      if (!isFinite(delta) || !delta) throw new Error(`Can't read delta "${a.delta}".`);
      const r = await P.call("v2_move_markers", { sequence_id: info.id, delta, from: a.from !== undefined ? clock.parse(a.from, "from") : null, to: a.to !== undefined ? clock.parse(a.to, "to") : null, names: a.names || null });
      return { moved: r.moved.map((m) => ({ name: m.name, from: clock.tc(m.from), to: clock.tc(m.to) })), count: r.moved.length };
    }
  );
}

