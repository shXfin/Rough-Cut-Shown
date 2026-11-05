# make_twins.py ranges.json out_dir   -> local ProRes 422 "twins" of camera originals for grading
# A twin has the original's exact length, frame rate and timecode, so Premiere can point the file at it (changeMediaPath)
# and every edit stays put. Only the ranges the cut uses (+ handles) are real 4K frames; the rest is black, which costs
# almost nothing in ProRes. Notch: 4K originals on Aspect's cloud drive (167 GB) -> ~30 GB of local, smooth ProRes.
# ranges.json: {original_path: [[start_s, end_s], ...]}  (file-relative seconds, handles already added)
import json, os, random, subprocess, sys, tempfile
FF = "ffmpeg"; R, OUT = json.load(open(sys.argv[1])), os.path.abspath(sys.argv[2]); os.makedirs(OUT, exist_ok=True)
FPS = 24000 / 1001
def probe(p):
    o = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,nb_frames,color_range:stream_tags=timecode:format=duration:format_tags=timecode",
                                   "-of", "json", p], capture_output=True, text=True).stdout)
    v = next(s for s in o["streams"] if s["codec_type"] == "video")
    tc = (o.get("format", {}).get("tags", {}) or {}).get("timecode") or next((s.get("tags", {}).get("timecode") for s in o["streams"] if s.get("tags", {}).get("timecode")), None)
    n = int(v.get("nb_frames") or round(float(o["format"]["duration"]) * FPS))
    return v["width"], v["height"], n, tc, v.get("color_range", "tv"), any(s["codec_type"] == "audio" for s in o["streams"])
def enc(args, out, w, h, rng):
    vf = f"scale={w}:{h}:in_range={'full' if rng == 'pc' else 'tv'}:out_range=tv,format=p210le"
    subprocess.run([FF, "-v", "error", "-y"] + args + ["-vf", vf, "-c:v", "prores_videotoolbox", "-profile:v", "standard", "-vendor", "apl0",
                    "-color_range", "tv", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", out], check=True)
items = list(R.items())
if len(sys.argv) > 3: items.sort(key=lambda kv: -sum(b - a for a, b in kv[1])) if sys.argv[3] == "big" else items.reverse()
for src, ranges in items:
    name = os.path.splitext(os.path.basename(src))[0] + "_4K.mov"; final = os.path.join(OUT, name)
    if os.path.exists(final): print("done already:", name); continue
    try: lk = os.open(final + ".lock", os.O_CREAT | os.O_EXCL)   # parallel workers: one file, one worker
    except FileExistsError: continue
    w, h, n, tc, rng, has_a = probe(src); tmp = tempfile.mkdtemp(dir=OUT)
    fr = sorted([max(0, int(a * FPS)), min(n, int(b * FPS) + 1)] for a, b in ranges)
    merged = []
    for a, b in fr:
        if merged and a <= merged[-1][1]: merged[-1][1] = max(merged[-1][1], b)
        else: merged.append([a, b])
    parts, cur = [], 0
    def black(k, i):
        p = os.path.join(tmp, f"{i:03d}_black.mov")
        enc(["-f", "lavfi", "-i", f"color=black:s={w}x{h}:r=24000/1001", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-frames:v", str(k), "-t", f"{k / FPS:.6f}"], p, w, h, "tv")
        parts.append(p)
    for i, (a, b) in enumerate(merged):
        if a > cur: black(a - cur, 2 * i)
        p = os.path.join(tmp, f"{2 * i + 1:03d}_real.mov"); k = b - a
        inp = ["-ss", f"{a / FPS:.6f}", "-i", src]
        if not has_a: inp += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-map", "0:v:0", "-map", "1:a:0"]
        else: inp += ["-map", "0:v:0", "-map", "0:a:0"]
        enc(inp + ["-frames:v", str(k), "-t", f"{k / FPS:.6f}"], p, w, h, rng); parts.append(p); cur = b
        print(f"  {name}: frames {a}-{b} real ({k / FPS:.1f}s)", flush=True)
    if cur < n: black(n - cur, 2 * len(merged))
    lst = os.path.join(tmp, "list.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
    subprocess.run([FF, "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy"] + (["-timecode", tc] if tc else []) + [final], check=True)
    got = int(json.loads(subprocess.run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v", "-show_entries", "stream=nb_read_packets", "-of", "json", final],
                                        capture_output=True, text=True).stdout)["streams"][0]["nb_read_packets"])
    for p in parts + [lst]: os.remove(p)
    os.rmdir(tmp); os.close(lk); os.remove(final + ".lock")
    print(f"{name}: {got}/{n} frames {'OK' if got == n else 'FRAME COUNT DIFFERS'}, tc {tc}, {os.path.getsize(final) / 1e9:.1f} GB", flush=True)
