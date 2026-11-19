// Audio fades that don't wreck the audio. Hand-written fade scripts hit two Premiere traps: Volume > Level is
// linear gain with 15 dB of headroom (1.0 is +15 dB, 0 dB is 0.1778), and its keyframes sit in the clip's
// source time, not clip time. This tool handles both, keeps the level between the fades exactly as it was,
// and checks every keyframe it sets.
import * as P from "../lib/premiere.mjs";
import { seqClock, clipRef, expectFor, snapshotNote, durationTicks, trackLabel } from "../lib/common.mjs";
import { withActivity } from "../lib/jobs.mjs";

export function register(def, { z, S }) {
  def(
    "premiere_audio_fade",
    "Fade audio in and/or out, safely, in one call for one clip, many clips, or every audio edit in a range. Default method keyframes: Volume keyframes from silence to the level the clip already plays at (whatever gain or keyframes it has in between stay exactly as they were; old keyframes inside the fade are replaced, so running it again is safe). Method transition: Premiere's own audio transition (Constant Power, Constant Gain or Exponential Fade) on that clip only, inside it, never moving or trimming anything. With range, every audio clip edge inside it is faded, except where the same take simply carries on across a cut (fading there would make a dip). A video clip in clips means its linked audio.",
    {
      ...S.Common,
      clips: z.array(S.ClipRef).optional().describe("Clips to fade. An audio clip (its linked audio channels too, unless include_linked is false) or a video clip (its linked audio)"),
      range: z.object({ start: S.Time, end: S.Time }).optional().describe("Instead of clips: fade every audio clip that starts and/or ends inside this range"),
      tracks: z.array(z.string()).optional().describe('With range: only these audio tracks, e.g. ["A1","A2"] (default all audio tracks)'),
      fade_in: S.Time.optional().describe('Length of the fade at each clip\'s start: seconds, "2f" or a timecode duration. 2 frames stops a click at a cut; 12 frames to 1 s is a heard fade'),
      fade_out: S.Time.optional().describe("Length of the fade at each clip's end"),
      method: z.enum(["keyframes", "transition"]).optional().describe("keyframes (default; plain Volume keyframes, survive XML/AAF) or transition (Premiere's audio transition, shown as a box on the clip)"),
      shape: z.string().optional().describe('With method transition: "Constant Power" (default), "Constant Gain" or "Exponential Fade"'),
      include_linked: z.boolean().optional().describe("Also fade the clip's linked audio channels on other tracks (default true)"),
      through_edits: z.enum(["skip", "fade"]).optional().describe("With range: skip (default) leaves cuts where the same take carries on unfaded"),
      expect_layout: S.Safety.expect_layout,
      snapshot: S.Safety.snapshot.describe('Save a copy of the sequence first (default: only for method transition; keyframe fades move nothing)')
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const fadeIn = a.fade_in !== undefined ? durationTicks(clock, a.fade_in, "fade_in") : 0;
      const fadeOut = a.fade_out !== undefined ? durationTicks(clock, a.fade_out, "fade_out") : 0;
      if (!(fadeIn > 0) && !(fadeOut > 0)) throw new Error('Give fade_in and/or fade_out, e.g. "2f" or 0.5.');
      if (!a.clips && !a.range) throw new Error("Give clips, or a range.");
      if (a.clips && a.range) throw new Error("Give clips or a range, not both.");
      const method = a.method || "keyframes";
      let range = null;
      if (a.range) {
        range = { start: clock.snap(clock.parse(a.range.start, "range.start")), end: clock.snap(clock.parse(a.range.end, "range.end")) };
        if (!(range.end > range.start)) throw new Error("range.end must be after range.start.");
      }
      const expect = await expectFor(info, clock, a.expect_layout, range ? [range.start, range.end] : null);
      const frames = (t) => `${Math.round(t / clock.frameTicks)}f`;
      return withActivity(`audio fades in "${info.name}"`, async () => {
        const r = await P.call(
          "v2_audio_fade",
          {
            sequence_id: info.id,
            clips: a.clips ? a.clips.map((c) => clipRef(clock, c)) : null,
            range,
            tracks: a.tracks || null,
            fade_in: fadeIn,
            fade_out: fadeOut,
            method,
            shape: a.shape || "Constant Power",
            include_linked: a.include_linked,
            through_edits: a.through_edits || "skip",
            expect,
            snapshot: a.snapshot ?? method === "transition"
          },
          { timeoutMs: 600000, label: "audio fades" }
        );
        const out = {
          method: method === "transition" ? `transition (${r.shape})` : "volume keyframes",
          faded: r.faded.map((f) => {
            const o = { track: trackLabel(f.clip), name: f.clip.name, start: clock.tc(f.clip.start), end: clock.tc(f.clip.end) };
            if (f.fadeIn) o.fade_in = frames(f.fadeIn);
            if (f.fadeOut) o.fade_out = frames(f.fadeOut);
            if (f.levelDb !== undefined && f.levelDb !== null) o.level_between_db = f.levelDb;
            if (f.replacedKeys) o.old_keyframes_replaced = f.replacedKeys;
            if (f.inSkipped) o.start_not_faded = f.inSkipped;
            if (f.outSkipped) o.end_not_faded = f.outSkipped;
            if (f.note) o.note = f.note;
            return o;
          }),
          clips_faded: r.faded.length
        };
        if (r.skipped && r.skipped.length) {
          out.not_faded = r.skipped.map((s) => ({ ...(s.track ? { track: s.track } : {}), ...(s.at !== undefined ? { at: clock.tc(s.at) } : {}), why: s.why }));
        }
        const note = snapshotNote(r);
        if (note) out.snapshot = note;
        return out;
      });
    }
  );
}
