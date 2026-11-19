// Layout tokens: a short fingerprint of the clips in a time range, so an edit can refuse to run
// if someone changed that part of the timeline after Claude read it.
import crypto from "node:crypto";

const remembered = new Map(); // token -> { sequenceId, start, end, clips }
const MAX_REMEMBERED = 300;

function line(c) {
  return [c.kind === "audio" ? "A" : "V", c.track + 1, c.nodeId, c.start, c.end, c.in, c.out, c.disabled ? 1 : 0, c.speed ?? 1].join("|");
}

/** clips: records from v2_layout (ticks). start/end: ticks of the range the token covers. */
export function makeToken(sequenceId, start, end, clips, extra = []) {
  const lines = clips.map(line).sort().concat(extra.map(String));
  const hash = crypto.createHash("sha1").update(`${sequenceId}\n${lines.join("\n")}`).digest("hex").slice(0, 12);
  const token = `${start}-${end}:${hash}`;
  remembered.set(token, { sequenceId, start, end, clips });
  if (remembered.size > MAX_REMEMBERED) remembered.delete(remembered.keys().next().value);
  return token;
}

export function parseToken(token) {
  const m = String(token || "").match(/^(\d+)-(\d+):([0-9a-f]{12})$/);
  if (!m) throw new Error(`"${token}" isn't a layout token. Get one from premiere_read_timeline (layout_token).`);
  return { start: Number(m[1]), end: Number(m[2]), hash: m[3] };
}

export function remembered_(token) {
  return remembered.get(token) || null;
}

/** Human-readable list of what changed between two clip lists. fmt(ticks) -> display string. */
export function describeChanges(oldClips, newClips, fmt) {
  const key = (c) => String(c.nodeId);
  const label = (c) => `${c.kind === "audio" ? "A" : "V"}${c.track + 1} "${c.name}"`;
  const before = new Map(oldClips.map((c) => [key(c), c]));
  const after = new Map(newClips.map((c) => [key(c), c]));
  const out = [];
  for (const [k, o] of before) {
    const n = after.get(k);
    if (!n) {
      out.push(`${label(o)} at ${fmt(o.start)} is gone`);
      continue;
    }
    if (n.start !== o.start || n.end !== o.end) out.push(`${label(o)} moved/trimmed: ${fmt(o.start)}-${fmt(o.end)} -> ${fmt(n.start)}-${fmt(n.end)}`);
    else if (n.in !== o.in || n.out !== o.out) out.push(`${label(o)} was slipped (source in/out changed)`);
    if (n.track !== o.track || n.kind !== o.kind) out.push(`${label(o)} moved to ${label(n)}`);
    if (!!n.disabled !== !!o.disabled) out.push(`${label(o)} was ${n.disabled ? "disabled" : "enabled"}`);
    if ((n.speed ?? 1) !== (o.speed ?? 1)) out.push(`${label(o)} speed changed ${o.speed} -> ${n.speed}`);
  }
  for (const [k, n] of after) if (!before.has(k)) out.push(`new clip ${label(n)} at ${fmt(n.start)}`);
  return out;
}
