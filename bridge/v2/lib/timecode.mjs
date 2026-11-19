// Timecode <-> seconds <-> frames <-> ticks, exactly as Premiere shows it.
// Premiere counts time in ticks: 254016000000 per second. A sequence's `timebase` is the ticks per frame
// (23.976 fps = 10594584000). Timecode shown in the Timeline includes the sequence start offset (zeroPoint).
// 23.976 timecode is non-drop and counts 24 frames per timecode second, so "00:01:00:00" is 60.06 real seconds.

export const TPS = 254016000000;

const NOMINAL = (fps) => Math.round(fps);

/**
 * A clock for one sequence.
 * info: { timebase: ticks per frame, zeroPoint: start offset in ticks, dropFrame: boolean }
 */
export function makeClock(info) {
  const frameTicks = Number(info.timebase);
  if (!(frameTicks > 0)) throw new Error(`Bad sequence timebase: ${info.timebase}`);
  const zeroTicks = Number(info.zeroPoint || 0);
  const fps = TPS / frameTicks;
  const base = NOMINAL(fps);
  const isNtscRate = Math.abs(fps - base) > 0.001; // 23.976, 29.97, 59.94
  const dropFrame = !!info.dropFrame && isNtscRate && (base === 30 || base === 60);
  const drop = dropFrame ? (base === 30 ? 2 : 4) : 0;
  const zeroFrames = Math.round(zeroTicks / frameTicks);

  function framesToTC(totalFrames) {
    let f = Math.max(0, Math.round(totalFrames));
    if (drop) {
      const per10 = Math.round(fps * 600);
      const perMin = base * 60 - drop;
      const d = Math.floor(f / per10);
      const m = f % per10;
      f += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / perMin) : 0);
    }
    const ff = f % base;
    const totalSec = Math.floor(f / base);
    const ss = totalSec % 60;
    const mm = Math.floor(totalSec / 60) % 60;
    const hh = Math.floor(totalSec / 3600);
    const sep = drop ? ";" : ":";
    const p = (n) => String(n).padStart(2, "0");
    return `${p(hh)}${sep}${p(mm)}${sep}${p(ss)}${sep}${p(ff)}`;
  }

  function tcToFrames(tc) {
    const m = String(tc).trim().match(/^(\d{1,2})[:;.](\d{1,2})[:;.](\d{1,2})[:;.](\d{1,3})$/);
    if (!m) return null;
    const [hh, mm, ss, ff] = m.slice(1).map(Number);
    if (mm > 59 || ss > 59 || ff >= base) throw new Error(`"${tc}" isn't a valid ${fmtRate()} timecode (frames go 00-${base - 1}).`);
    let frames = (hh * 3600 + mm * 60 + ss) * base + ff;
    if (drop) {
      const totalMin = hh * 60 + mm;
      frames -= drop * (totalMin - Math.floor(totalMin / 10));
    }
    return frames;
  }

  function fmtRate() {
    const r = Math.round(fps * 1000) / 1000;
    return `${r} fps ${drop ? "drop-frame" : "non-drop"}`;
  }

  // Sequence-relative ticks -> display values
  function format(ticks) {
    const t = Number(ticks);
    const frame = Math.round(t / frameTicks);
    return {
      s: Math.round((t / TPS) * 1e6) / 1e6,
      tc: framesToTC(frame + zeroFrames),
      f: frame
    };
  }

  /**
   * Parse a time the way people type it. Returns sequence-relative ticks.
   *  - number: seconds from the sequence start
   *  - "12.5" or "12.5s": seconds
   *  - "300f": frame number from the sequence start
   *  - "00:01:02:03" / "00;01;02;03": timecode as shown in Premiere (includes the start offset)
   */
  function parse(value, what = "time") {
    if (value === null || value === undefined || value === "") throw new Error(`Missing ${what}.`);
    if (typeof value === "number") {
      if (!isFinite(value) || value < 0) throw new Error(`${what} must be 0 or more seconds (got ${value}).`);
      return Math.round(value * TPS);
    }
    if (typeof value === "object" && value !== null) {
      if ("ticks" in value) return Number(value.ticks);
      if ("tc" in value) return parse(value.tc, what);
      if ("s" in value) return parse(Number(value.s), what);
      if ("f" in value) return Number(value.f) * frameTicks;
    }
    const s = String(value).trim();
    let m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*s?$/i))) return Math.round(Number(m[1]) * TPS);
    if ((m = s.match(/^(\d+)\s*f$/i))) return Number(m[1]) * frameTicks;
    if ((m = s.match(/^(\d+)\s*t(?:icks)?$/i))) return Number(m[1]);
    const frames = tcToFrames(s);
    if (frames === null) {
      throw new Error(
        `Can't read ${what} "${value}". Use seconds (12.5), frames ("300f") or timecode as Premiere shows it ("${framesToTC(zeroFrames)}").`
      );
    }
    const rel = frames - zeroFrames;
    if (rel < 0) {
      throw new Error(
        `${what} ${s} is before the sequence start (${framesToTC(zeroFrames)}). Timecode includes the start offset: did you mean ${framesToTC(frames + zeroFrames)}?`
      );
    }
    return rel * frameTicks;
  }

  return {
    fps,
    base,
    dropFrame: !!drop,
    frameTicks,
    zeroTicks,
    zeroFrames,
    rate: fmtRate(),
    parse,
    format,
    framesToTC,
    tcToFrames,
    snap: (ticks) => Math.round(Number(ticks) / frameTicks) * frameTicks,
    floorFrame: (ticks) => Math.floor(Number(ticks) / frameTicks + 1e-9),
    toSeconds: (ticks) => Number(ticks) / TPS,
    fromSeconds: (s) => Math.round(Number(s) * TPS),
    tc: (ticks) => framesToTC(Math.round(Number(ticks) / frameTicks) + zeroFrames)
  };
}

// Plain seconds -> "HH:MM:SS,mmm" for SRT files
export function srtTime(seconds) {
  let ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  ms -= m * 60000;
  const s = Math.floor(ms / 1000);
  ms -= s * 1000;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}
