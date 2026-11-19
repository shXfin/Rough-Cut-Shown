// Map source-file words onto a sequence, build caption cues and SRT, find words for a bleep pass.
// All times here are seconds. Clip times come from Premiere as ticks and are converted by the caller.
import { srtTime } from "./timecode.mjs";
import { transcriptFor, mediaKey } from "./transcripts.mjs";

/**
 * clips: [{ track, trackName, trackMuted, name, nodeId, start, end, in, out, speed, reversed, disabled, mediaPath }]
 *        (seconds; `in`/`out` are source times, speed 1 = 100%)
 * Returns { words: [...seq words], used: [...], skipped: [...] }
 */
export function mapWordsToSequence(clips, transcripts, opts = {}) {
  const includeMuted = !!opts.include_muted_tracks;
  const includeDisabled = !!opts.include_disabled_clips;
  const onlyTracks = opts.tracks ? new Set(opts.tracks.map(Number)) : null;
  const prefer = opts.prefer_tracks ? opts.prefer_tracks.map(Number) : [];
  const rank = (t) => {
    const i = prefer.indexOf(t);
    return i >= 0 ? i : prefer.length + t;
  };
  const skipped = [];
  const used = [];
  const candidates = [];
  for (const c of clips) {
    const label = `A${c.track + 1} "${c.name}" at ${c.start.toFixed(2)}s`;
    if (onlyTracks && !onlyTracks.has(c.track)) continue;
    if (c.trackMuted && !includeMuted) {
      skipped.push({ clip: label, why: "track is muted" });
      continue;
    }
    if (c.disabled && !includeDisabled) {
      skipped.push({ clip: label, why: "clip is disabled" });
      continue;
    }
    if (c.reversed) {
      skipped.push({ clip: label, why: "clip plays reversed" });
      continue;
    }
    const t = transcriptFor(transcripts, c.mediaPath || c.name);
    if (!t) {
      skipped.push({ clip: label, why: `no transcript for ${mediaKey(c.mediaPath || c.name)}` });
      continue;
    }
    const speed = c.speed > 0 ? c.speed : 1;
    let n = 0;
    for (const w of t.words) {
      const mid = (w.start + w.end) / 2;
      if (mid < c.in || mid >= c.out) continue;
      const s = c.start + (Math.max(w.start, c.in) - c.in) / speed;
      const e = c.start + (Math.min(w.end, c.out) - c.in) / speed;
      if (e <= s) continue;
      candidates.push({
        text: w.text,
        start: Math.max(c.start, s),
        end: Math.min(c.end, e),
        speaker: w.speaker,
        track: c.track,
        clip: c.name,
        clipNodeId: c.nodeId,
        clipKey: c.nodeId ?? `${c.track}|${c.start}`,
        mediaPath: c.mediaPath,
        srcStart: w.start,
        srcEnd: w.end,
        estimated: !!w.estimated,
        rank: rank(c.track)
      });
      n++;
    }
    used.push({ clip: label, words: n, transcript: t.file });
  }
  // The same speech is often on several tracks (lav + camera). Keep one copy: preferred track first.
  candidates.sort((a, b) => a.rank - b.rank || a.start - b.start);
  const accepted = [];
  for (const w of candidates) {
    const clash = accepted.some(
      (o) => o.clipKey !== w.clipKey && overlap(o, w) > 0.5 * Math.min(o.end - o.start, w.end - w.start)
    );
    if (!clash) accepted.push(w);
  }
  accepted.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const w of accepted) w.speaker = resolveSpeaker(w, opts.speaker_map);
  return { words: accepted.map(({ rank, clipKey, ...w }) => w), used, skipped };
}

function overlap(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function globMatch(pattern, value) {
  if (value == null) return false;
  const re = new RegExp("^" + String(pattern).toLowerCase().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return re.test(String(value).toLowerCase());
}

/** speaker_map keys may match the transcript's speaker label, the clip name, the media file name or the track ("A2"). */
export function resolveSpeaker(w, map) {
  if (!map) return w.speaker || null;
  const base = w.mediaPath ? w.mediaPath.split(/[\\/]/).pop() : null;
  const probes = [w.speaker, w.clip, base, base ? mediaKey(base) : null, `A${w.track + 1}`];
  for (const probe of probes) {
    if (probe == null) continue;
    for (const [k, v] of Object.entries(map)) if (globMatch(k, probe)) return v;
  }
  return w.speaker || null;
}

const SENTENCE_END = /[.?!…]["')\]]*$/;

/**
 * Group words into caption cues.
 * opts: max_chars_per_line (42), max_lines (2), max_duration (6), min_duration (0.8), max_gap (0.8),
 *       speaker_labels ("auto" | true | false), label_style ("colon" -> "ANA: hi", "brackets" -> "[ANA] hi")
 */
export function buildCues(words, opts = {}) {
  const maxChars = opts.max_chars_per_line ?? 42;
  const maxLines = opts.max_lines ?? 2;
  const maxDur = opts.max_duration ?? 6;
  const minDur = opts.min_duration ?? 0.8;
  const maxGap = opts.max_gap ?? 0.8;
  const speakers = new Set(words.map((w) => w.speaker).filter(Boolean));
  const labels = opts.speaker_labels === true || (opts.speaker_labels !== false && speakers.size > 1);
  const cues = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.words.length) cues.push(cur);
    cur = null;
  };
  for (const w of words) {
    if (cur) {
      const last = cur.words[cur.words.length - 1];
      const text = cur.words.map((x) => x.text).join(" ") + " " + w.text;
      const brk =
        w.speaker !== cur.speaker ||
        w.start - last.end > maxGap ||
        text.length > maxChars * maxLines ||
        w.end - cur.start > maxDur ||
        (SENTENCE_END.test(last.text) && cur.words.map((x) => x.text).join(" ").length >= Math.min(20, maxChars / 2));
      if (brk) flush();
    }
    if (!cur) cur = { start: w.start, end: w.end, speaker: w.speaker, words: [] };
    cur.words.push(w);
    cur.end = w.end;
  }
  flush();
  // Timing: hold each cue a little, never into the next one, and give short cues room to be read.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const limit = next ? next.start - 0.04 : Infinity;
    let end = Math.min(cues[i].end + 0.2, limit);
    if (end - cues[i].start < minDur) end = Math.min(cues[i].start + minDur, limit);
    cues[i].end = Math.max(end, cues[i].end > limit ? limit : cues[i].end);
    if (cues[i].end <= cues[i].start) cues[i].end = cues[i].start + 0.04;
  }
  let prevSpeaker = null;
  for (const c of cues) {
    let text = c.words.map((w) => w.text).join(" ").replace(/\s+([,.?!;:…])/g, "$1");
    if (labels && c.speaker && c.speaker !== prevSpeaker) {
      text = opts.label_style === "brackets" ? `[${c.speaker}] ${text}` : `${c.speaker}: ${text}`;
    }
    prevSpeaker = c.speaker;
    c.lines = wrapLines(text, maxChars, maxLines);
    c.text = c.lines.join("\n");
  }
  return cues;
}

/** Split text into at most maxLines lines of about equal length, breaking at spaces. */
export function wrapLines(text, maxChars, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  if (text.length <= maxChars || maxLines < 2) return [text];
  // Two lines (the common case): pick the break that balances the lines best without exceeding maxChars.
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const over = Math.max(0, a.length - maxChars) + Math.max(0, b.length - maxChars);
    const score = over * 1000 + Math.abs(a.length - b.length);
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  if (maxLines === 2 || best.score < 1000) return best.lines;
  // More lines: greedy fill.
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > maxChars && lines.length < maxLines - 1) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  lines.push(cur);
  return lines;
}

export function toSrt(cues) {
  return (
    cues
      .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
      .join("\n")
      .trim() + "\n"
  );
}

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}'*]+/gu, "");

/**
 * Find listed words or short phrases. Patterns are case-insensitive; * matches any letters ("fuck*").
 * Returns hits sorted by time: { text, start, end, pattern, context, word indices, ... }
 */
export function findWords(words, patterns, opts = {}) {
  const pats = patterns.map((p) => {
    const parts = String(p).trim().split(/\s+/).map(norm).filter(Boolean);
    return {
      pattern: p,
      parts: parts.map((x) => new RegExp("^" + x.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "u"))
    };
  });
  const normed = words.map((w) => norm(w.text));
  const hits = [];
  for (let i = 0; i < words.length; i++) {
    for (const p of pats) {
      if (i + p.parts.length > words.length) continue;
      let ok = true;
      for (let k = 0; k < p.parts.length; k++) if (!p.parts[k].test(normed[i + k])) ok = false;
      if (!ok) continue;
      const first = words[i];
      const last = words[i + p.parts.length - 1];
      const ctx = opts.context ?? 4;
      hits.push({
        text: words.slice(i, i + p.parts.length).map((w) => w.text).join(" "),
        pattern: p.pattern,
        start: first.start,
        end: last.end,
        speaker: first.speaker || null,
        track: first.track,
        clip: first.clip,
        clipNodeId: first.clipNodeId,
        mediaPath: first.mediaPath,
        srcStart: first.srcStart,
        estimated: !!(first.estimated || last.estimated),
        context: words
          .slice(Math.max(0, i - ctx), i + p.parts.length + ctx)
          .map((w) => w.text)
          .join(" ")
      });
      break;
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/**
 * Where the bleep goes for each hit: start after the first letter, end a touch after the word.
 * keep_first_ms: how much of the word's start stays audible (default 70 ms, at most 35% of the word).
 * Overlapping ranges are merged.
 */
export function bleepRanges(hits, opts = {}) {
  const keep = (opts.keep_first_ms ?? 70) / 1000;
  const pad = (opts.pad_after_ms ?? 30) / 1000;
  const ranges = hits
    .map((h) => {
      const dur = h.end - h.start;
      const k = Math.min(keep, dur * 0.35);
      return { start: h.start + k, end: h.end + pad, words: [h.text], hits: [h] };
    })
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 0.02) {
      last.end = Math.max(last.end, r.end);
      last.words.push(...r.words);
      last.hits.push(...r.hits);
    } else merged.push({ ...r });
  }
  return merged;
}
