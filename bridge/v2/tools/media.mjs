// Media replacement without Link Media popups, versioned file names, and title cards (instead of
// editing Essential Graphics text, which scripts can't do reliably).
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as P from "../lib/premiere.mjs";
import { seqClock, clipOut } from "../lib/common.mjs";
import { nextVersionPath, outputFolder, requireTool, runTool, safeName, exists } from "../lib/files.mjs";
import { withActivity } from "../lib/jobs.mjs";

/** Is this file used by the open project (as media or proxy)? */
export async function usersOf(paths) {
  try {
    return await P.call("v2_media_users", { paths });
  } catch {
    return paths.map((p) => ({ path: p, users: [] }));
  }
}

const FONT_DIRS = ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts", path.join(os.homedir(), "Library/Fonts")];

export async function findFont(name) {
  if (!name) name = "Helvetica";
  const expanded = name.replace(/^~(?=\/)/, os.homedir());
  if (/\.(ttf|otf|ttc)$/i.test(expanded) && (await exists(expanded))) return expanded;
  const want = name.toLowerCase().replace(/[\s_-]+/g, "");
  const files = [];
  for (const d of FONT_DIRS) {
    try {
      for (const f of await fsp.readdir(d)) if (/\.(ttf|otf|ttc)$/i.test(f)) files.push(path.join(d, f));
    } catch {}
  }
  const key = (f) => path.basename(f).replace(/\.(ttf|otf|ttc)$/i, "").toLowerCase().replace(/[\s_-]+/g, "");
  const exact = files.find((f) => key(f) === want);
  if (exact) return exact;
  const starts = files.filter((f) => key(f).startsWith(want)).sort((x, y) => key(x).length - key(y).length);
  if (starts.length) return starts[0];
  const part = files.find((f) => key(f).includes(want));
  if (part) return part;
  throw new Error(`Font "${name}" not found in ${FONT_DIRS.join(", ")}. Pass a .ttf/.otf path, or a font file name like "Arial Bold".`);
}

// ffmpeg filter option values: single-quoted (keeps spaces, commas and colons literal); a ' becomes '\''.
const fq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

export function register(def, ctx) {
  const { z, S } = ctx;

  def(
    "premiere_versioned_path",
    "Get the next free versioned file name for a file you're about to (re)write, e.g. mix.wav -> mix_v2.wav, and say whether the open project uses the original. Write new versions there and relink with premiere_replace_media: overwriting a file Premiere has open causes the Link Media popup.",
    { path: z.string() },
    async (a) => {
      const p = ctx.expandHome(a.path);
      const [u] = await usersOf([p]);
      const next = await nextVersionPath(p, async (cand) => ((await usersOf([cand]))[0].users || []).length > 0);
      return { original: p, used_by_project: (u.users || []).map((x) => `${x.name} (${x.as})`), write_to: next };
    }
  );

  def(
    "premiere_replace_media",
    "Point project items at a new file (re-rendered audio, a fixed graphic) without the Link Media popup: relinks with changeMediaPath, keeping every clip's in/out, position, keyframes and effects, then checks each item. Never overwrite the file Premiere is using: write a new version (premiere_versioned_path) and pass it here.",
    {
      old_path: z.string().optional().describe("Media path the project uses now (every item using it is relinked)"),
      node_id: z.string().optional().describe("Or one project item"),
      new_path: z.string().describe("The new file (must exist)")
    },
    async (a) => {
      if (!a.old_path && !a.node_id) throw new Error("Pass old_path or node_id.");
      const np = ctx.expandHome(a.new_path);
      if (!(await exists(np))) throw new Error(`New file not found: ${np}`);
      if (a.old_path && path.resolve(ctx.expandHome(a.old_path)) === path.resolve(np)) throw new Error("old_path and new_path are the same file. Write the new version to a new name (premiere_versioned_path) first.");
      const r = await withActivity("relinking media", () => P.call("v2_replace_media", { old_path: a.old_path ? ctx.expandHome(a.old_path) : null, node_id: a.node_id || null, new_path: np }, { timeoutMs: 120000 }));
      const failed = r.items.filter((i) => !i.changed);
      return { relinked: r.items.filter((i) => i.changed).length, failed: failed.length ? failed : undefined, items: r.items };
    }
  );

  def(
    "premiere_title_card",
    "Make a title/lower-third as a transparent PNG with any installed font (rendered by ffmpeg) and place it on a video track. Use this instead of editing Essential Graphics text, which scripts can't do reliably. The PNG is written under the project's folder in 'Claude Bridge/titles' with a versioned name.",
    {
      ...S.Common,
      text: z.string().describe("Text; use \\n for a new line"),
      font: z.string().optional().describe('Font name or file, e.g. "Helvetica Neue", "Arial Bold", "~/Library/Fonts/Inter-Bold.otf"'),
      size: z.number().positive().optional().describe("Font size in pixels (default: 6% of the frame height)"),
      color: z.string().optional().describe('e.g. "white", "#FFD600" (default white)'),
      box: z.string().optional().describe('Background box colour with opacity, e.g. "black@0.6" (default none)'),
      shadow: z.boolean().optional().describe("Soft drop shadow (default true)"),
      position: z.union([z.enum(["center", "lower_third", "top", "bottom"]), z.array(z.number()).length(2)]).optional().describe("Or [x, y] in pixels for the text's top-left"),
      width: z.number().int().optional().describe("Default: sequence width"),
      height: z.number().int().optional().describe("Default: sequence height"),
      at: S.Time.optional().describe("Place it here (default: playhead)"),
      duration: z.number().positive().optional().describe("Seconds on screen (default 4)"),
      track: z.string().optional().describe('Default "V2"'),
      place: z.boolean().optional().describe("false = only write the PNG"),
      output_dir: z.string().optional()
    },
    async (a) => {
      const { info, clock } = await seqClock(a.sequence_id);
      const W = a.width || info.width;
      const H = a.height || info.height;
      const font = await findFont(a.font);
      const size = a.size || Math.round(H * 0.06);
      const proj = (await P.call("v2_info", {})).projectPath;
      const dir = await outputFolder("titles", proj, a.output_dir ? ctx.expandHome(a.output_dir) : null);
      let file = path.join(dir, `${safeName(a.text.split("\n")[0], 40)}.png`);
      if (await exists(file)) file = await nextVersionPath(file);
      const txt = path.join(os.tmpdir(), `claude-title-${process.pid}-${Date.now()}.txt`);
      await fsp.writeFile(txt, a.text.replace(/\\n/g, "\n"));
      let x = "(w-text_w)/2";
      let y = "(h-text_h)/2";
      const pos = a.position || "center";
      if (Array.isArray(pos)) [x, y] = pos.map(String);
      else if (pos === "lower_third") y = "h*0.78-text_h/2";
      else if (pos === "top") y = "h*0.08";
      else if (pos === "bottom") y = "h*0.90-text_h";
      const parts = [
        `fontfile=${fq(font)}`,
        `textfile=${fq(txt)}`,
        `fontsize=${size}`,
        `fontcolor=${fq(a.color || "white")}`,
        `line_spacing=${Math.round(size * 0.25)}`,
        `x=${fq(x)}`,
        `y=${fq(y)}`
      ];
      if (a.box) parts.push("box=1", `boxcolor=${fq(a.box)}`, `boxborderw=${Math.round(size * 0.4)}`);
      if (a.shadow !== false) parts.push("shadowcolor=black@0.55", `shadowx=${Math.max(1, Math.round(size / 24))}`, `shadowy=${Math.max(1, Math.round(size / 24))}`);
      const ffmpeg = requireTool("ffmpeg");
      try {
        await runTool(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${W}x${H},format=rgba`, "-frames:v", "1", "-vf", `drawtext=${parts.join(":")}`, file]);
      } finally {
        fs.rmSync(txt, { force: true });
      }
      const out = { png: file, font, size: `${W}x${H}` };
      if (a.place === false) return out;
      const at = a.at !== undefined ? clock.snap(clock.parse(a.at, "at")) : clock.snap((await P.call("v2_seq_info", { sequence_id: info.id })).playhead || 0);
      const dur = clock.snap(Math.round((a.duration || 4) * 254016000000));
      const r = await withActivity(`placing a title in "${info.name}"`, () => P.call("v2_place_still", { sequence_id: info.id, path: file, track: a.track || "V2", at, duration: dur, bin: "Claude titles" }));
      out.placed = clipOut(clock, r.clip);
      return out;
    }
  );
}
