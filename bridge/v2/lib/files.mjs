// Config, external tools (ffmpeg/ffprobe), versioned file names and output folders.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";

export const BRIDGE_HOME = process.env.CLAUDE_BRIDGE_HOME || path.join(os.homedir(), ".claude-adobe-bridge");
const CONFIG_FILE = path.join(BRIDGE_HOME, "config.json");

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

const toolCache = {};
/** Find ffmpeg / ffprobe: config.json, then CLAUDE_BRIDGE_FFMPEG / _FFPROBE, then PATH, then Homebrew folders. */
export function findTool(name) {
  if (toolCache[name] !== undefined) return toolCache[name];
  const cfg = loadConfig();
  const env = process.env[`CLAUDE_BRIDGE_${name.toUpperCase()}`];
  const dirs = (process.env.PATH || "").split(path.delimiter).concat(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]);
  const candidates = [cfg[name], env, ...dirs.map((d) => path.join(d, name))].filter(Boolean);
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return (toolCache[name] = c);
    } catch {}
  }
  return (toolCache[name] = null);
}

export function requireTool(name) {
  const p = findTool(name);
  if (!p) {
    throw new Error(
      `${name} isn't installed or wasn't found. Install it (brew install ffmpeg) or put its path in ${CONFIG_FILE} as {"${name}": "/path/to/${name}"}, then retry.`
    );
  }
  return p;
}

export function runTool(cmd, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || err.message).trim().split("\n").slice(-6).join("\n");
        reject(new Error(`${path.basename(cmd)} failed: ${tail}`));
      } else resolve({ stdout, stderr });
    })
  );
}

/**
 * Next free versioned name: "mix.wav" -> "mix_v2.wav"; "mix_v2.wav" -> "mix_v3.wav"; keeps zero padding ("_v009" -> "_v010").
 * `taken(path)` can add extra "in use" checks besides existing on disk.
 */
export async function nextVersionPath(p, taken = async () => false) {
  const dir = path.dirname(p);
  const ext = path.extname(p);
  let stem = path.basename(p, ext);
  let n = 1;
  let width = 1;
  const m = stem.match(/^(.*)_v(\d+)$/i);
  if (m) {
    stem = m[1];
    n = Number(m[2]);
    width = m[2].length;
  }
  for (let i = n + 1; i < n + 10000; i++) {
    const cand = path.join(dir, `${stem}_v${String(i).padStart(width, "0")}${ext}`);
    if (!(await exists(cand)) && !(await taken(cand))) return cand;
  }
  throw new Error(`No free version name next to ${p}`);
}

export async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * A durable folder for things Premiere will reference (captions, bleeps, titles):
 * "<project folder>/Claude Bridge/<kind>" if writable, else "~/Documents/Claude Bridge/<kind>".
 */
export async function outputFolder(kind, projectPath, override) {
  const tries = [];
  if (override) tries.push(override);
  if (projectPath) tries.push(path.join(path.dirname(projectPath), "Claude Bridge", kind));
  tries.push(path.join(os.homedir(), "Documents", "Claude Bridge", kind));
  let lastErr = null;
  for (const dir of tries) {
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.access(dir, fs.constants.W_OK);
      return dir;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Couldn't make an output folder for ${kind}: ${lastErr && lastErr.message}`);
}

export function safeName(s, max = 60) {
  return String(s || "untitled")
    .replace(/[\/\\:*?"<>|\x00-\x1f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
