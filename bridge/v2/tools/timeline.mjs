// Reading the timeline, timecode conversion, snapshots.
import * as P from "../lib/premiere.mjs";
import { seqClock, clipOut, layoutToken, when } from "../lib/common.mjs";

// Premiere reads an unset In or Out as -400000 s.
const markOrUnset = (clock, t) => (t === null || t === undefined || t < -1e15 ? "not set" : when(clock, t));

export function register(def, { z, S }) {
  def(
    "premiere_timecode",
    "Convert times for a sequence exactly as Premiere shows them: seconds <-> timecode <-> frame number. Handles 23.976 non-drop (24 timecode frames per real 1.001 s), 29.97/59.94 drop-frame, and a sequence that starts at 01:00:00:00. Every v2 tool accepts any of these forms; use this to check a conversion.",
    {
      ...S.Common,
      values: z.array(S.Time).min(1).describe('Times to convert, e.g. [12.5, "00:01:00:00", "1439f"]')
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      return {
        sequence: info.name,
        rate: clock.rate,
        starts_at: clock.framesToTC(clock.zeroFrames),
        values: a.values.map((v) => {
          const t = clock.parse(v);
          const f = clock.format(t);
          return { input: v, timecode: f.tc, seconds: f.s, frame: f.f, ticks: String(t) };
        })
      };
    }
  );

  def(
    "premiere_read_timeline",
    "Read a sequence (or one time range of it) with timecodes and seconds side by side: every track (muted/locked), every clip (source in/out, speed, disabled, media, node_id), transitions and markers. Also returns layout_token: pass it as expect_layout to an edit tool so the edit is refused if someone changed this part of the timeline in the meantime.",
    {
      ...S.Common,
      start: S.Time.optional().describe("Only clips that overlap this range (default: whole sequence)"),
      end: S.Time.optional(),
      include_media: z.boolean().optional().describe("Include media paths (default true)")
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const start = a.start !== undefined ? clock.parse(a.start, "start") : 0;
      const end = a.end !== undefined ? clock.parse(a.end, "end") : Math.max(info.end, clock.frameTicks);
      const tl = await P.call("v2_timeline", { sequence_id: info.id, start: a.start !== undefined ? start : null, end: a.end !== undefined ? end : null, full: a.include_media !== false });
      const token = await layoutToken(info.id, start, end);
      return {
        sequence: { id: info.id, name: info.name, rate: clock.rate, size: `${info.width}x${info.height}`, starts_at: clock.framesToTC(clock.zeroFrames), duration: when(clock, info.end), active: info.active },
        playhead: when(clock, tl.playhead),
        in_out: tl.inPoint !== undefined ? { in: markOrUnset(clock, tl.inPoint), out: markOrUnset(clock, tl.outPoint) } : null,
        range: { start: when(clock, start), end: when(clock, end) },
        layout_token: token,
        tracks: tl.tracks.map((t) => ({
          track: t.label,
          name: t.name,
          ...(t.muted ? { muted: true } : {}),
          ...(t.locked ? { locked: true } : {}),
          ...(t.outOfOrder ? { warning: "Premiere's internal clip order on this track isn't by time (a clip was moved past another by script). Scripted cuts fail on most of it, so ripple/insert/move/speed edits here may refuse." } : {}),
          clips: t.clips.map((c) => clipOut(clock, c)),
          ...(t.transitions ? { transitions: t.transitions.map((x) => ({ name: x.name, start: clock.tc(x.start), end: clock.tc(x.end), ...(x.orphan ? { orphan: true } : {}) })) } : {}),
          ...(t.orphanTransitions ? { transition_warning: `${t.orphanTransitions} transition(s) here sit on no clip edge (left behind by a scripted move). An orphaned audio transition can silence the rest of the track: delete it in the Timeline, or remove them all with premiere_transition action remove_orphans.` } : {})
        })),
        markers: tl.markers.map((m) => ({ name: m.name, comment: m.comment || undefined, start: clock.tc(m.start), start_s: Math.round((m.start / 254016000000) * 1000) / 1000, end: m.end !== m.start ? clock.tc(m.end) : undefined, color: m.color }))
      };
    }
  );

  def(
    "premiere_snapshot",
    'Save a copy of a sequence in the "Claude snapshots" bin (named "<sequence> - before <label> <time>"). Edit tools do this on their own before multi-step edits; use this before a hand-written script.',
    { ...S.Common, label: z.string().optional().describe('What you are about to do, e.g. "tighten act 2"') },
    async (a) => {
      const r = await P.call("v2_snapshot", { sequence_id: a.sequence_id || null, label: a.label || "Claude edit" });
      return { saved: r.name, id: r.id, bin: "Claude snapshots" };
    }
  );
}
