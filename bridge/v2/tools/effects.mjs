// Effects: list, set one parameter by a friendly name (with the known traps), copy everything incl. keyframes,
// and transitions.
import * as P from "../lib/premiere.mjs";
import { seqClock, clipRef, expectFor, snapshotNote } from "../lib/common.mjs";
import { withActivity } from "../lib/jobs.mjs";

// Friendly names -> what Premiere calls them (names differ between versions, so several are tried).
export const EFFECTS = {
  motion: { names: ["Motion"], params: {} },
  opacity: { names: ["Opacity"], params: { blend: ["Blend Mode"], "blend mode": ["Blend Mode"] } },
  transform: { names: ["Transform"], params: { "use composition shutter": ["Use Composition's Shutter Angle"] } },
  "directional blur": {
    names: ["Directional Blur"],
    params: { direction: ["Direction", "Angle"], angle: ["Angle", "Direction"], length: ["Blur Length", "Amount", "Length"], "blur length": ["Blur Length", "Amount"], amount: ["Amount", "Blur Length"] }
  },
  "gaussian blur": { names: ["Gaussian Blur"], params: { amount: ["Blurriness"], blur: ["Blurriness"], edges: ["Repeat Edge Pixels"], "repeat edges": ["Repeat Edge Pixels"] } },
  lumetri: {
    names: ["Lumetri Color"],
    params: { temp: ["Temperature"], temperature: ["Temperature"], tint: ["Tint"], exposure: ["Exposure"], contrast: ["Contrast"], highlights: ["Highlights"], shadows: ["Shadows"], whites: ["Whites"], blacks: ["Blacks"], saturation: ["Saturation"], vibrance: ["Vibrance"] }
  },
  "lumetri color": { alias: "lumetri" },
  volume: { names: ["Volume"], params: { level: ["Level"], gain: ["Level"] } },
  offset: { names: ["Offset"], params: { shift: ["Shift Center To"], blend: ["Blend With Original"] } },
  crop: { names: ["Crop"], params: { left: ["Left"], right: ["Right"], top: ["Top"], bottom: ["Bottom"], zoom: ["Zoom"], feather: ["Edge Feather"] } },
  "hard limiter": { names: ["Hard Limiter"], params: { ceiling: ["Maximum Amplitude"], "max amplitude": ["Maximum Amplitude"] } }
};

export function resolveEffect(effect, param) {
  const key = String(effect).toLowerCase().trim();
  let e = EFFECTS[key];
  if (e && e.alias) e = EFFECTS[e.alias];
  const effectNames = e ? e.names : [effect];
  const p = String(param).toLowerCase().trim();
  const paramAliases = e && e.params[p] ? e.params[p] : [];
  return { effect: effectNames[0], effectAliases: effectNames.slice(1), param: paramAliases[0] || param, paramAliases: paramAliases.slice(1).concat(paramAliases.length ? [param] : []) };
}

/** Premiere clip Volume > Level is linear: 10^((dB - 15) / 20); 0 dB = 0.1778, max +15 dB = 1. */
export function dbToLevel(db) {
  if (db === -Infinity || db <= -96) return 0;
  return Math.min(1, Math.pow(10, (db - 15) / 20));
}
export function levelToDb(v) {
  return v <= 0 ? -Infinity : 20 * Math.log10(v) + 15;
}

export function register(def, { z, S }) {
  def(
    "premiere_list_effects",
    "List a clip's effects and every parameter with its current value (and whether it's keyframed). Use it to find the exact names before setting or copying.",
    { ...S.Common, clip: S.ClipRef },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const r = await P.call("v2_list_effects", { sequence_id: info.id, clip: clipRef(clock, a.clip) });
      return { clip: `${r.clip.kind === "audio" ? "A" : "V"}${r.clip.track + 1} "${r.clip.name}" at ${clock.tc(r.clip.start)}`, effects: r.effects };
    }
  );

  def(
    "premiere_set_effect_param",
    "Set one effect parameter by a friendly name and check it really changed (returns before -> after, or refuses with the real parameter names). Knows the traps: Transform with Uniform Scale on scales with 'Scale Height' ('Scale Width' silently does nothing and leaves black edges); Motion uses 'Scale' when uniform; Directional Blur's names differ by version (Direction/Angle, Blur Length/Amount); Offset wraps the frame (seams on gradients). Volume level can be given in dB with unit: \"db\". Pass clip_time (seconds from the clip's start) to set a keyframe instead.",
    {
      ...S.Common,
      clip: S.ClipRef,
      effect: z.string().describe('e.g. "Transform", "Lumetri", "Directional Blur", "Volume", "Motion"'),
      param: z.string().describe('e.g. "scale", "exposure", "direction", "level"'),
      value: z.any().describe("Number, boolean, or [x, y] for points (Motion Position is 0-1 of the frame)"),
      unit: z.enum(["db"]).optional().describe("db: value is decibels (Volume level)"),
      clip_time: z.number().min(0).optional().describe("Set a keyframe this many seconds from the clip's start"),
      add_if_missing: z.boolean().optional().describe("Add the effect if the clip doesn't have it"),
      expect_layout: S.Safety.expect_layout
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const ref = clipRef(clock, a.clip);
      const r0 = resolveEffect(a.effect, a.param);
      let value = a.value;
      if (a.unit === "db") value = dbToLevel(Number(a.value));
      const expect = await expectFor(info, clock, a.expect_layout, null);
      return withActivity(`setting ${r0.effect} > ${r0.param} in "${info.name}"`, async () => {
        const r = await P.call("v2_set_param", {
          sequence_id: info.id,
          clip: ref,
          effect: r0.effect,
          effect_aliases: r0.effectAliases,
          effect_add_name: r0.effect,
          param: r0.param,
          param_aliases: r0.paramAliases,
          value,
          clip_time: a.clip_time,
          add_if_missing: !!a.add_if_missing,
          expect
        });
        if (a.unit === "db") for (const x of r.results) for (const k of ["before", "after", "value"]) if (typeof x[k] === "number") x[k + "_db"] = Math.round(levelToDb(x[k]) * 100) / 100;
        return r;
      });
    }
  );

  def(
    "premiere_copy_effects",
    "Copy effects from one clip to others like Paste Attributes, including keyframes (placed at the same offset from each clip's start, speed-aware) and non-numeric values where Premiere accepts them. Returns, per clip, what was copied and every parameter it could NOT copy (e.g. Lumetri curves/LUT data Premiere won't take from a script); for those, use Edit > Paste Attributes. Motion/Opacity are copied too unless include_motion_opacity is false. Copied effects keep the source's order and go above the target's own effects (Premiere adds new effects at the top of the stack).",
    {
      ...S.Common,
      from: S.ClipRef,
      to: z.array(S.ClipRef).min(1),
      effects: z.array(z.string()).optional().describe('Only these, e.g. ["Lumetri Color"]'),
      include_motion_opacity: z.boolean().optional(),
      expect_layout: S.Safety.expect_layout
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const expect = await expectFor(info, clock, a.expect_layout, null);
      return withActivity(`copying effects in "${info.name}"`, () =>
        P.call(
          "v2_copy_effects",
          { sequence_id: info.id, from: clipRef(clock, a.from), to: a.to.map((t) => clipRef(clock, t)), effects: a.effects || null, include_motion_opacity: a.include_motion_opacity, expect },
          { timeoutMs: 180000, label: "copy effects" }
        )
      );
    }
  );

  def(
    "premiere_transition",
    "Add, remove or list transitions at a clip's start or end edge (default Cross Dissolve for video, Constant Power for audio). Each change is checked; if Premiere refuses to remove one by script (it sometimes throws 'Unknown error exception'), it says so and how to do it by hand. action remove_orphans (no clip needed) removes every transition that sits on no clip edge, which scripted moves can leave behind (an orphaned audio transition can silence the rest of its track; premiere_read_timeline flags them); a snapshot is saved first.",
    {
      ...S.Common,
      clip: S.ClipRef.optional().describe("The clip whose edge it is (not needed for remove_orphans)"),
      action: z.enum(["add", "remove", "list", "remove_orphans"]).optional(),
      tracks: z.array(z.string()).optional().describe('With remove_orphans: only these tracks, e.g. ["A1","A2"] (default all)'),
      snapshot: S.Safety.snapshot,
      edge: z.enum(["start", "end"]).optional().describe("Default end"),
      name: z.string().optional().describe('e.g. "Cross Dissolve", "Dip to Black", "Constant Power"'),
      duration: S.Time.optional().describe('Default 12 frames ("12f")'),
      alignment: z.number().min(0).max(1).optional().describe("0 = starts at the cut, 0.5 = centred (default), 1 = ends at the cut"),
      expect_layout: S.Safety.expect_layout
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const expect = await expectFor(info, clock, a.expect_layout, null);
      if (a.action === "remove_orphans") {
        const r = await P.call("v2_remove_orphan_transitions", { sequence_id: info.id, tracks: a.tracks || null, expect, snapshot: a.snapshot }, { timeoutMs: 300000, label: "remove orphaned transitions" });
        const one = (x) => `${x.track} ${x.name} ${clock.tc(x.start)}-${clock.tc(x.end)}`;
        const out = { orphans_found: r.found, removed: (r.transitions ? r.transitions.removed : []).map(one) };
        if (r.transitions && r.transitions.failed.length) out.NOT_REMOVED = { transitions: r.transitions.failed.map(one), what_to_do: "Premiere refused to remove these by script: select each in the Timeline and press Delete." };
        const note = snapshotNote(r);
        if (note) out.snapshot = note;
        return out;
      }
      if (!a.clip) throw new Error('Give clip (e.g. { "track": "A1", "at": 12.5 }), or use action remove_orphans.');
      const duration = a.duration !== undefined ? clock.parse(a.duration, "duration") : 12 * clock.frameTicks;
      const r = await P.call("v2_transition", { sequence_id: info.id, clip: clipRef(clock, a.clip), action: a.action || "add", edge: a.edge || "end", name: a.name, duration, alignment: a.alignment, expect });
      if (r.transitions) r.transitions = r.transitions.map((t) => ({ name: t.name, start: t.start != null ? clock.tc(t.start) : null, end: t.end != null ? clock.tc(t.end) : null }));
      return r;
    }
  );
}
