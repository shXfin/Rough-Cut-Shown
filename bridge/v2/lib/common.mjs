// Helpers shared by the v2 tools: schemas, sequence clocks, clip formatting, layout checks.
import * as P from "./premiere.mjs";
import { makeClock, TPS } from "./timecode.mjs";
import { makeToken, parseToken, remembered_ } from "./layout.mjs";

export function schemas(z) {
  const Time = z
    .union([z.number(), z.string()])
    .describe('Seconds from the sequence start (12.5), frames ("300f"), or timecode exactly as Premiere shows it ("00:00:12:12")');
  const ClipRef = z
    .object({
      track: z.string().optional().describe('Track, e.g. "V1" or "A2"'),
      at: Time.optional().describe("Any time inside the clip"),
      index: z.number().int().min(0).optional().describe("0-based clip number on the track (instead of at)"),
      node_id: z.string().optional().describe("Clip node_id from premiere_read_timeline (survives moves)")
    })
    .describe('Which clip: { track: "V1", at: "00:00:12:00" } or { node_id }');
  const Common = {
    sequence_id: z.string().optional().describe("Sequence id or name; defaults to the active sequence"),
    project: z
      .string()
      .optional()
      .describe("Path of the .prproj to work in (adobe_status lists the open ones). Only needed when two projects are open: by default the tools use the project that holds sequence_id, else the one Premiere has in front")
  };
  const Safety = {
    expect_layout: z
      .string()
      .optional()
      .describe("layout_token from premiere_read_timeline. If that part of the timeline changed since, the edit is refused and nothing happens"),
    snapshot: z.boolean().optional().describe('Save a copy of the sequence in the "Claude snapshots" bin first (default true for multi-step edits). If an edit fails partway it is not undone; the error lists what was done and names this copy')
  };
  return { Time, ClipRef, Common, Safety };
}

const clocks = new Map(); // sequence id -> { clock, info, at }

export async function seqClock(sequenceId) {
  const info = await P.call("v2_seq_info", { sequence_id: sequenceId || null });
  const clock = makeClock(info);
  clocks.set(info.id, { clock, info, at: Date.now() });
  return { info, clock };
}

export function toTicks(clock, v, what) {
  return clock.parse(v, what);
}

/** Time a person can read, both ways. */
export function when(clock, ticks) {
  if (ticks === null || ticks === undefined) return null;
  const f = clock.format(ticks);
  return { tc: f.tc, s: f.s };
}

export function trackLabel(c) {
  return `${c.kind === "audio" ? "A" : "V"}${c.track + 1}`;
}

/** A clip record from ppro2.jsx (ticks) -> what Claude sees (timecode + seconds). */
export function clipOut(clock, c) {
  const o = {
    track: trackLabel(c),
    name: c.name,
    start: clock.tc(c.start),
    end: clock.tc(c.end),
    start_s: round(c.start / TPS),
    end_s: round(c.end / TPS),
    src_in_s: round(c.in / TPS),
    src_out_s: round(c.out / TPS),
    node_id: c.nodeId
  };
  if (c.speed !== undefined && c.speed !== 1) o.speed = c.speed;
  if (c.reversed) o.reversed = true;
  if (c.disabled) o.disabled = true;
  if (c.mediaPath) o.media = c.mediaPath;
  if (c.adjustment) o.adjustment = true;
  if (c.mgt) o.graphic = true;
  return o;
}

export const round = (v, p = 3) => (v === null || v === undefined ? v : Math.round(v * 10 ** p) / 10 ** p);

/** Resolve a ClipRef's times to ticks. */
export function clipRef(clock, ref) {
  if (!ref) return ref;
  const r = { ...ref };
  if (r.at !== undefined) r.at = clock.parse(r.at, "clip.at");
  return r;
}

/** Make a layout token for [start, end] (ticks) of a sequence. */
export async function layoutToken(seqId, start, end) {
  const now = await P.call("v2_layout", { sequence_id: seqId, start, end });
  return makeToken(now.id, start, end, now.clips, [now.tracks]);
}

/**
 * Turn expect_layout into what ppro2.jsx checks in the same call as the edit.
 * needs: [startTicks, endTicks] the edit depends on; must sit inside the token's range.
 */
export async function expectFor(seqInfo, clock, token, needs) {
  if (!token) return null;
  const t = parseToken(token);
  if (needs) {
    const [a, b] = needs;
    if (a < t.start || b > t.end) {
      throw new Error(
        `expect_layout covers ${clock.tc(t.start)}-${clock.tc(t.end)}, but this edit works on ${clock.tc(a)}-${clock.tc(b)}. Read the timeline for that range (premiere_read_timeline with start/end) and pass the new layout_token.`
      );
    }
  }
  const mem = remembered_(token);
  if (mem) {
    if (mem.sequenceId !== seqInfo.id) throw new Error("expect_layout was read from a different sequence.");
    return { sequence: mem.sequenceId, start: t.start, end: t.end, clips: mem.clips };
  }
  // Token from before a server restart: compare hashes now (not atomic, but still catches changes).
  const fresh = await layoutToken(seqInfo.id, t.start, t.end);
  if (fresh !== token) {
    throw new Error("The timeline changed in that area since it was read, so nothing was done. Read it again (premiere_read_timeline) and redo the edit.");
  }
  return null;
}

export function snapshotNote(r) {
  if (!r || !r.snapshot) return null;
  return `A copy from before the edit is in the "Claude snapshots" bin: "${r.snapshot.name}".` + (r.snapshot.labelWarning ? ` ${r.snapshot.labelWarning}` : "");
}

/** A length (not a position): seconds, "12f", or a timecode duration ("00:00:00:12"); whole frames. */
export function durationTicks(clock, v, what) {
  const t = typeof v === "string" && /[:;]/.test(v) ? clock.tcToFrames(v) * clock.frameTicks : clock.parse(v, what);
  return clock.snap(t);
}
