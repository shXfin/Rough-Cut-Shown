// Word-level transcripts: read the common JSON shapes and match them to media files by name.
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Accepts:
 *  - a list of words: [{ w | word | text, start, end, speaker? }]
 *  - WhisperX output: { segments: [{ speaker?, words: [{ word, start, end, speaker? }] }], word_segments?: [...] }
 *  - { words: [...] } or { word_segments: [...] }
 * Words without times (WhisperX leaves numbers unaligned) get times spread between their neighbours.
 * Returns { words: [{ text, start, end, speaker }], source }  (times in seconds from the file start)
 */
export function parseTranscript(json) {
  let raw = [];
  let source = null;
  if (Array.isArray(json)) raw = json;
  else if (json && typeof json === "object") {
    source = json.audio_path || json.audio || json.source || json.media || json.file || null;
    if (Array.isArray(json.segments) && json.segments.some((s) => Array.isArray(s.words))) {
      for (const seg of json.segments) {
        for (const w of seg.words || []) raw.push({ ...w, speaker: w.speaker ?? seg.speaker });
      }
    } else if (Array.isArray(json.word_segments)) raw = json.word_segments;
    else if (Array.isArray(json.words)) raw = json.words;
    else if (Array.isArray(json.segments)) {
      // Segment-level only: treat each segment as one "word" so captions still work (less precise).
      raw = json.segments.map((s) => ({ text: s.text, start: s.start, end: s.end, speaker: s.speaker }));
    }
  }
  const words = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const text = String(w.w ?? w.word ?? w.text ?? "").trim();
    if (!text) continue;
    const start = num(w.start);
    const end = num(w.end);
    words.push({ text, start, end, speaker: w.speaker != null ? String(w.speaker) : null });
  }
  fillMissingTimes(words);
  return { words: words.filter((w) => w.start != null && w.end != null && w.end >= w.start), source };
}

function num(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && isFinite(n) ? n : null;
}

function fillMissingTimes(words) {
  for (let i = 0; i < words.length; i++) {
    if (words[i].start != null && words[i].end != null) continue;
    let j = i;
    while (j < words.length && (words[j].start == null || words[j].end == null)) j++;
    const prevEnd = i > 0 ? words[i - 1].end : null;
    const nextStart = j < words.length ? words[j].start : null;
    const lo = prevEnd ?? (nextStart != null ? Math.max(0, nextStart - 0.3 * (j - i)) : null);
    const hi = nextStart ?? (prevEnd != null ? prevEnd + 0.3 * (j - i) : null);
    if (lo == null || hi == null) {
      i = j;
      continue;
    }
    const step = (hi - lo) / (j - i);
    for (let k = i; k < j; k++) {
      words[k].start = lo + step * (k - i);
      words[k].end = lo + step * (k - i + 1);
      words[k].estimated = true;
    }
    i = j;
  }
}

const SUFFIXES = [".words", ".aligned", ".whisperx", ".whisper", ".transcript", ".json"];

/** "A001C003.MP4.words.json" -> "a001c003";  "/x/A001C003_Proxy.mov" -> "a001c003" */
export function mediaKey(fileOrPath) {
  let b = path.basename(String(fileOrPath || "")).toLowerCase();
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of SUFFIXES) {
      if (b.endsWith(s)) {
        b = b.slice(0, -s.length);
        changed = true;
      }
    }
  }
  b = b.replace(/\.[a-z0-9]{2,5}$/, ""); // media extension
  b = b.replace(/[ _-]?proxy$/, "");
  return b;
}

/**
 * Load transcripts. `spec` can be:
 *  - a folder path (every .json inside, one level of subfolders)
 *  - a list of .json paths
 *  - an object { "<media path or file name>": "<transcript .json path>" }
 * Returns Map(mediaKey -> { words, file, source })
 */
export async function loadTranscripts(spec, expandHome = (p) => p) {
  const out = new Map();
  const add = async (file, forMedia) => {
    const json = JSON.parse(await fsp.readFile(file, "utf8"));
    const t = parseTranscript(json);
    const key = mediaKey(forMedia || t.source || file);
    out.set(key, { words: t.words, file, source: forMedia || t.source || null });
  };
  if (!spec) throw new Error("transcripts is required: a folder of .json files, a list of files, or a { media: transcript } map.");
  if (typeof spec === "string") {
    const dir = expandHome(spec);
    const st = await fsp.stat(dir).catch(() => null);
    if (!st) throw new Error(`Transcript path not found: ${dir}`);
    if (st.isFile()) {
      await add(dir);
    } else {
      for (const f of await listJson(dir, 1)) await add(f);
    }
  } else if (Array.isArray(spec)) {
    for (const f of spec) await add(expandHome(f));
  } else if (typeof spec === "object") {
    for (const [media, f] of Object.entries(spec)) await add(expandHome(f), media);
  }
  if (!out.size) throw new Error("No transcripts found (looked for .json files).");
  return out;
}

async function listJson(dir, depth) {
  const res = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) res.push(...(await listJson(full, depth - 1)));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".json")) res.push(full);
  }
  return res;
}

export function transcriptFor(transcripts, mediaPath) {
  return transcripts.get(mediaKey(mediaPath)) || null;
}

export const _test = { fillMissingTimes };
