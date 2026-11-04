# build_scrub.py work_dir out.xml   -> the SCRUB: every take of every script line, in script order, labelled,
# with every synced camera stacked over the recorder sound (Socrates' SELECTS tab, Mateus's day-2 deliverable).
# Reviewers pick takes from it; the rough cut is built from the picks afterwards.
# Inputs in work_dir: lines.json, takes.json, sources.json, sync_a_ok.jsonl / sync_b_ok.jsonl
# (verified syncs: cam_time = recorder_time + offset_s). Cameras without a verified sync for a take are left off.
import json, os, re, subprocess, sys, urllib.parse
from xml.sax.saxutils import escape
W, OUT = sys.argv[1], sys.argv[2]
RC = len(sys.argv) > 3 and sys.argv[3] == "--rough-cut"   # rough cut: only the picked take of each main line, butted together
J = lambda n: json.load(open(os.path.join(W, n)))
LINES = {l["line"]: l for l in J("lines.json")}
TAKES = J("takes.json")
# the scrub is ALWAYS multicam (Shafin: one scrub, eagle eye on every camera): every camera on, then ppro_grid.py
# tiles them side by side. GRID=0 builds a single-camera scrub; the rough cut and per-line builds stay single-camera.
GRID = os.environ.get("GRID", "1") == "1" and not RC and not os.environ.get("LINE")
SRC = {os.path.basename(p): p for p in J("sources.json")}
FPS = 24000/1001; fr = lambda s: int(round(s * FPS))
GAP_TAKE, GAP_LINE, HANDLE = 1.0, 3.0, 0.5
TAIL = 0.5   # after the last word: Whisper ends words early, and a falling last word ("...more info") needs room to finish
if RC: GAP_TAKE, GAP_LINE, HANDLE, TAIL = 0.0, 0.0, 0.2, 0.4   # seconds between takes / between lines; air kept around each take
REC_TRACK = 1                                 # unbaked scrub only; baked pieces pick the speaker's own channel (best_channel)
CAMS = [("A", "sync_a_ok.jsonl"), ("B", "sync_b_ok.jsonl")]   # A shown on top, B underneath, ready to switch

def syncs(name):
    p = os.path.join(W, name); out = {}
    for l in (open(p) if os.path.exists(p) else []):
        if l.startswith("{"):
            r = json.loads(l); out.setdefault(os.path.basename(r["other"]), []).append(r)
    return out
SYNC = {c: syncs(f) for c, f in CAMS}
_dur = {}
def dur(p):
    if p not in _dur:
        _dur[p] = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                                       capture_output=True, text=True).stdout.strip() or 0)
    return _dur[p]
_size = {}
def size(p):
    if p not in _size:
        o = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", p],
                           capture_output=True, text=True).stdout.strip().split(",")
        _size[p] = (int(o[0]), int(o[1])) if len(o) == 2 else (1920, 1080)
    return _size[p]
BAKE = os.environ.get("BAKE") == "1"   # clean each piece (Mateus: noise, hum, sibilance)
VO = os.path.abspath(os.path.join(W, "vo_RC" if RC else (f"vo_line_{os.environ['LINE']}" if os.environ.get("LINE") else "vo_SCRUB"))); 
CLEAN = ("highpass=f=90:poles=2,highpass=f=90:poles=2,"                 # wind and rumble: steep 24 dB/oct under the voice
         "equalizer=f=60:t=q:w=10:g=-18,equalizer=f=120:t=q:w=10:g=-10,equalizer=f=180:t=q:w=10:g=-6,"   # 60 Hz hum (US mains)
         "afftdn=nr=10:nf=-45:tn=1,"                                            # gentle broadband noise: never watery
         "equalizer=f=250:t=q:w=1.2:g=-2,equalizer=f=4500:t=q:w=1.5:g=1.5,"      # less boxy lav, a touch of presence
         "deesser=i=0.25:m=0.5:f=0.5,"                                          # soft de-ess (the presence lift adds s)
         "acompressor=threshold=-26dB:ratio=2:attack=20:release=250:knee=6")     # light glue, keeps it natural
TONE_UNDER_DB = 6   # outdoors the bed only smooths the cuts; indoors it can sit at 0-3
TARGET_LUFS = -19.0   # measured mono; the stereo file plays at -16 LUFS. Every piece levelled to the same loudness, so both founders and every take match

FADE = 0.083 if RC else 0.25   # visible fade per clip (volume keyframes). Rough cut: 2 frames where the take changes (inside
# the 0.2 s handle), none at a join inside one take, so a running sentence never dips. The baked file only gets a 12 ms anti-click.
# Scrub: 0.25 s inside each take's 0.5 s handle, so no word is touched
def best_channel(wav, s0, d):
    """Each founder has his own lav (recorder ch1/ch2 here, not a mix). Taking ch1 for everything put Notch
    L13-L39 on the OTHER founder's mic: thin and roomy. Use the channel where this piece is loudest."""
    lv = []
    for c in range(4):
        o = subprocess.run(["ffmpeg", "-hide_banner", "-ss", f"{s0:.3f}", "-t", f"{d:.3f}", "-i", wav, "-af", f"pan=mono|c0=c{c},volumedetect",
                            "-f", "null", "-"], capture_output=True, text=True).stderr
        m = [l for l in o.splitlines() if "mean_volume" in l]
        lv.append(float(m[0].split(":")[1].split()[0]) if m else -99)
    return max(range(4), key=lambda c: lv[c]), lv
CHAN = {}; GAINS = []
import time, glob as _g
STAMP = time.strftime("%H%M%S")   # new names every build: reusing a name left Premiere drawing the old (or no) waveform
# old pieces stay on disk: the sequence open in Premiere still points at them (deleting them sent it offline)
def bake(wav, s0, s1, n, fin=0.012, fout=0.012):
    os.makedirs(VO, exist_ok=True); out = os.path.join(VO, f"{'rc' if RC else 'take'}_{STAMP}_{n:03d}.wav"); d = s1 - s0
    ch, lv = best_channel(wav, s0, d); CHAN[n] = (ch + 1, [round(x, 1) for x in lv])
    af = f"pan=mono|c0=c{ch}," + CLEAN
    tmp = out + ".tmp.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{s0:.3f}", "-t", f"{d:.3f}", "-i", wav, "-af", af, "-ar", "48000", "-c:a", "pcm_f32le", tmp], check=True)
    o = subprocess.run(["ffmpeg", "-hide_banner", "-i", tmp, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    I = [l for l in o.splitlines() if l.strip().startswith("I:")]
    gain = TARGET_LUFS - float(I[-1].split()[1]) if I and "-inf" not in I[-1] else 0
    gain = max(-12, min(30, gain)); GAINS.append(gain)   # dialogue levelling, like riding the fader per line
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp, "-af",
                    f"volume={gain:.2f}dB,alimiter=limit=0.79:level=false,afade=t=in:d={fin},afade=t=out:st={d-fout:.3f}:d={fout},pan=stereo|c0=c0|c1=c0",
                    "-c:a", "pcm_s24le", out], check=True)
    os.remove(tmp)
    return out
def cam_for(cam, wav, t0, t1):   # the verified camera clip that covers this take, and where in it
    for r in SYNC[cam].get(wav, []):
        a, b = t0 + r["offset_s"], t1 + r["offset_s"]
        if a >= 0 and b <= dur(r["ref"]): return r["ref"], a
    return None, None

SW, SH = 1920, 1080   # deliverables are 16:9; every camera is scaled to fill the height (see clip())
RATE = '<rate><timebase>24</timebase><ntsc>TRUE</ntsc></rate>'
seen = set()
def file_el(path, kind):
    fid = "f_" + os.path.basename(path).replace(".", "_").replace(" ", "_")
    if fid in seen: return f'<file id="{fid}"/>'
    seen.add(fid)
    if kind == "video":   # each camera's real frame size: declaring one size for all squeezed Notch's cinema-width A cam
        w, h = size(path)
        media = f'<video><samplecharacteristics><width>{w}</width><height>{h}</height></samplecharacteristics></video><audio><channelcount>2</channelcount></audio>'
    else:
        media = f'<audio><channelcount>{2 if path.startswith(VO) else 4}</channelcount></audio>'
    return (f'<file id="{fid}"><name>{escape(os.path.basename(path))}</name><pathurl>file://localhost{urllib.parse.quote(path)}</pathurl>'
            f'{RATE}<duration>{fr(dur(path))}</duration><media>{media}</media></file>')
def clip(cid, path, kind, start, inp, length, enabled=True, fin=0, fout=0, punch=1.0):
    st = f'<sourcetrack><mediatype>audio</mediatype><trackindex>{REC_TRACK}</trackindex></sourcetrack>' if kind == "audio" else ""
    en = "" if enabled else "<enabled>FALSE</enabled>"
    fx = ""
    if kind == "audio" and (fin or fout):   # visible fades: volume keyframes on the clip, as an editor draws them
        a, b = fr(fin), length - fr(fout)
        ks = [(inp, 0 if fin else 1), (inp + a, 1), (inp + b, 1), (inp + length, 0 if fout else 1)]
        fx = ('<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory>'
              '<effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name>'
              '<valuemin>0</valuemin><valuemax>3.98109</valuemax><value>1</value>'
              + "".join(f'<keyframe><when>{w}</when><value>{v}</value></keyframe>' for w, v in ks) + '</parameter></effect></filter>')
    if kind == "video":   # fill the 16:9 frame's height; a cinema-width camera loses a thin strip each side
        fx = (f'<filter><effect><name>Basic Motion</name><effectid>basic</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>'
              f'<parameter><parameterid>scale</parameterid><name>Scale</name><value>{round(SH / size(path)[1] * 100 * punch, 3)}</value></parameter></effect></filter>')
    return (f'<clipitem id="{cid}"><name>{escape(os.path.basename(path))}</name>{en}<duration>{fr(dur(path))}</duration>{RATE}'
            f'<start>{start}</start><end>{start+length}</end><in>{inp}</in><out>{inp+length}</out>{file_el(path, kind)}{st}{fx}</clipitem>')

SECTION = {"HOOK": "Hook", "AHA": "Demo 1", "AHA2": "Demo 2", "AHA3": "Demo 3", "FEATURES": "Features",
           "PROOF": "Social proof", "CLOSE": "Closing", "CTA": "Giveaway"}
WHO = {"FOUNDER1": "Founder 1", "FOUNDER2": "Founder 2"}
order = list(LINES)
by_line = {}
for t in TAKES: by_line.setdefault(t["line"], []).append(t)
N_TAKES = {}
for _t in TAKES: N_TAKES[_t["line"]] = N_TAKES.get(_t["line"], 0) + 1
NEEDS = []
_sr = os.environ.get("SCRUB_REPORT", os.path.join(W, "notch_SCRUB_work.takes.json"))   # where each take sits in the scrub
SCRUB_AT = {(r["line"], r["take"]): r["at"] for r in (json.load(open(_sr)) if os.path.exists(_sr) else [])}
def tc(x):
    if x is None: return "-"
    f = int(round(x * FPS)); return f"{f // (24*3600):02d}:{f // (24*60) % 60:02d}:{f // 24 % 60:02d}:{f % 24:02d}"
ONLY = os.environ.get("LINE")   # takes-by-line: one short sequence per script line, every take of it back to back
if ONLY: by_line = {ONLY: by_line.get(ONLY, [])}
PICKS = {}
if RC:   # keep only each main line's pick (pick.py), in script order
    PICKS = {p["line"]: p for p in J("picks.json")}
    by_line = {L: [t for t in ts if L in PICKS and t["take"] == PICKS[L]["take"] and t["src"] == PICKS[L]["src"]]
               for L, ts in by_line.items() if LINES[L]["main"]}
v = {c: [] for c, _ in CAMS}; aud, markers = [], []
t = 0; n = 0; report = []; MAIN_PATH = None
JOIN_IN, JOIN_OUT = {}, {}
TIGHT = []; KEEP_PAUSE = 0.35   # seconds of a long pause that stay: a breath, not a think
def tighten(piece):
    """Silences over 0.5 s INSIDE the line (the founder thinking mid-sentence) shrink to KEEP_PAUSE.
    Found on the cleaned, levelled piece, so -38 dB is reliably 'not talking'. Edges are left alone."""
    o = subprocess.run(["ffmpeg", "-hide_banner", "-i", piece, "-af", "silencedetect=n=-38dB:d=0.5", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    st = [float(l.split("silence_start: ")[1]) for l in o.splitlines() if "silence_start" in l]
    en = [float(l.split("silence_end: ")[1].split()[0]) for l in o.splitlines() if "silence_end" in l]
    d = dur(piece); segs = []; cur = 0.0
    for a, b in zip(st, en):
        if a < 0.3 or b > d - 0.3: continue                       # lead-in / tail: not inside the line
        cut_in, cut_out = a + KEEP_PAUSE / 2, b - KEEP_PAUSE / 2
        segs.append((cur, cut_in)); cur = cut_out
    segs.append((cur, d))
    return [(round(a, 3), round(b, 3)) for a, b in segs]
LOOK = (None, 1.0); PUNCH = 1.15   # 4K source: a 15% punch-in stays sharp
if RC:
    seq_ = [(L, by_line[L][0]) for L in order if by_line.get(L)]
    for (La, a), (Lb, b) in zip(seq_, seq_[1:]):
        if a["src"] == b["src"] and -1.0 <= b["start"] - a["end"] < 1.6:
            cut = (a["end"] + b["start"]) / 2 if b["start"] > a["end"] else b["start"] - 0.02
            JOIN_OUT[La] = JOIN_IN[Lb] = cut
for L in order:
    ts = sorted(by_line.get(L, []), key=lambda x: (x["src"], x["start"]))   # shooting order
    if not ts: continue
    ln = LINES[L]
    for k, tk in enumerate(ts, 1):
        s0, s1 = max(tk["start"] - HANDLE, 0), tk["end"] + max(HANDLE, TAIL)
        if RC:   # lines that run on in one take join at the gap between them: no word plays twice
            if L in JOIN_IN: s0 = JOIN_IN[L]
            if L in JOIN_OUT: s1 = JOIN_OUT[L]
        length = fr(s1) - fr(s0)
        wav = SRC.get(tk["src"])
        on = None
        have = {}
        for cam, _ in CAMS:
            path, at = cam_for(cam, tk["src"], s0, s1)
            if path: have[cam] = (path, at)
        look = (next(iter(have), None), 1.0)
        if RC and have:   # a take change on the same framing is a jump cut (faces shift): change angle, or punch in
            if L in JOIN_IN and LOOK[0] in have: look = LOOK      # same take running on: keep the shot
            else:
                other = [c for c in have if c != LOOK[0]]
                look = (other[0], 1.0) if other else (LOOK[0], 1.0 if LOOK[1] != 1.0 else PUNCH)
            LOOK = look
        piece = bake(wav, s0, s1, n) if wav and BAKE else None
        segs = tighten(piece) if RC and piece else [(0.0, s1 - s0)]   # long pauses inside the line cut down to a breath
        t_start = t; length = 0
        for j, (a0, a1) in enumerate(segs):
            if j:   # a tightened pause is a cut inside the line: hide it like a take change
                other = [c for c in have if c != look[0]]
                look = (other[0], 1.0) if other else (look[0], 1.0 if look[1] != 1.0 else PUNCH); LOOK = look
            sl = fr(s0 + a1) - fr(s0 + a0); cid = f"{n}" if not j else f"{n}_{j}"
            for cam, (path, at) in have.items():
                if cam == CAMS[0][0] and MAIN_PATH is None: MAIN_PATH = path
                v[cam].append(clip(f"v{cam}{cid}", path, "video", t, fr(at + a0), sl, enabled=GRID or (cam == look[0]), punch=look[1] if cam == look[0] else 1.0))
                on = on or cam
            first, last = j == 0, j == len(segs) - 1
            fi = (0 if RC and L in JOIN_IN else FADE) if first else 0.042   # 1 frame at a tightened pause: no click
            fo = (0 if RC and L in JOIN_OUT else FADE) if last else 0.042
            if piece: aud.append(clip(f"a{cid}", piece, "audio", t, fr(a0), sl, fin=fi, fout=fo))
            elif wav: aud.append(clip(f"a{cid}", wav, "audio", t, fr(s0 + a0), sl))
            t += sl; length += sl
        t = t_start
        if len(segs) > 1: TIGHT.append((L, len(segs) - 1, round((s1 - s0) - sum(b - a for a, b in segs), 2)))
        flag = "" if tk.get("flag") == "green" else ", reworded or rough"
        if tk.get("off_mic"): flag = ", CAMERAMAN READING IT (skip)"
        elif tk.get("part_feed"): flag = f', CAMERAMAN READS PART ("{tk["part_feed"]}")'
        cams = "+".join(c for c, _ in CAMS if c in have) or "sound only"
        miss = [c for c, _ in CAMS if c not in cams.split("+")]
        flag += "".join(f", no {c} camera" for c in miss)   # a missing camera is flagged on the timeline, never silent
        tnum, tof = tk.get("take", k), N_TAKES.get(L, len(ts))   # the take's real number, same as in the scrub
        mm = lambda x: f"{int(x // 60):02d}:{x % 60:04.1f}"
        where = f"Sound: {tk['src']} at {mm(tk['start'])}" + "".join(
            f" | {c} camera: {os.path.basename(pth).replace('_proxy.mp4', '')} at {mm(at + (tk['start'] - s0))}" for c, (pth, at) in have.items())
        why = []
        if RC:   # anything a person should hear before this ships: listed, marked CHECK, with where the other takes are
            pk = PICKS.get(L, {})
            # strong reasons only: a list of 36 of 39 lines is noise (missing cams are marked separately: NO B CAM)
            # (no "near tie": pick.py's runner-up predates the continuity pass and pointed at the pick itself)
            if tk.get("wind_db", -99) > 12: why.append("wind gust")
            if max((w["end"] - w["start"] for w in tk.get("words", []) if len(w["w"]) < 12), default=0) > 0.9: why.append("dragged word")
            if len(segs) > 1: why.append("pause tightened")
            if tk.get("flag") != "green": why.append("reworded")
            if tk.get("part_feed"): why.append("cameraman reads part of it")   # only if you chose it in the Take Finder
            sc = SCRUB_AT.get((L, tnum))
            if why: NEEDS.append((t / FPS, L, tnum, tof, ", ".join(why), sc))
            where += f" | in the scrub at {tc(sc)}" if sc is not None else ""
        # plain words for editors: "Line 10, take 4 of 6" (no codes like L10, no dot separators)
        name = (f'{"CHECK (" + ", ".join(why) + "): " if why else ""}Line {int(L[1:])}, take {tnum} of {tof}, '
                f'{WHO.get(ln.get("who"), "")}, {SECTION.get(ln["beat"], ln["beat"].title())}{flag}')
        color = '<color><alpha>0</alpha><red>255</red><green>0</green><blue>0</blue></color>' if miss or why else ""
        markers.append(f'<marker>{color}<name>{escape(name)}</name><comment>{escape(tk.get("text", ""))} || {escape(where)}</comment><in>{t}</in><out>-1</out></marker>')
        mid = (tk["start"] + tk["end"]) / 2 - s0   # a frame from the middle of the take, per camera, for the take finder
        report.append(dict(line=L, take=tnum, of=tof, src=tk["src"], at=round(t / FPS, 2), dur=round(length / FPS, 2), cams=cams,
                           frames={c: [pth, round(at + mid, 2)] for c, (pth, at) in have.items()}, text=tk.get("text", ""),
                           feed=bool(tk.get("off_mic") or tk.get("part_feed")), part_feed=tk.get("part_feed", ""),
                           start=tk["start"], wind=tk.get("wind_db"), check=why))
        t += length + fr(GAP_TAKE if k < len(ts) else GAP_LINE); n += 1

tone = ""
if BAKE and GAINS:   # room tone under everything: no dead air in gaps, and the background never drops out at a cut
    import statistics
    import numpy as np
    def steadiest(src, lo, hi, ch, win=3.0):   # the 3 s with the lowest loudest moment: no bump, cough or far voice
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{lo:.3f}", "-t", f"{hi-lo:.3f}", "-i", SRC[src], "-af", f"pan=mono|c0=c{ch}",
                              "-ar", "8000", "-f", "s16le", "-"], capture_output=True).stdout
        x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768; h = 400; m = len(x) // h
        if m < win * 20 + 6: return None
        r = 20 * np.log10(np.sqrt((x[:m*h].reshape(m, h) ** 2).mean(1)) + 1e-9); k = int(win * 20)
        peaks = np.array([r[i:i+k].max() for i in range(0, m - k, 5)]); i = int(peaks.argmin()) * 5
        return peaks.min(), lo + i / 20
    best = None
    for f in sorted(os.listdir(os.path.join(W, "words"))):
        src = f[:-len(".words.json")]
        if src not in SRC: continue
        ws = json.load(open(os.path.join(W, "words", f)))
        for a_, b_ in zip(ws, ws[1:]):
            if b_["start"] - a_["end"] > 3.6:
                ch, _ = best_channel(SRC[src], a_["end"] + 0.3, b_["start"] - a_["end"] - 0.6)
                q = steadiest(src, a_["end"] + 0.3, b_["start"] - 0.3, ch)
                if q and (best is None or q[0] < best[3]): best = (src, q[1], 3.0, q[0])
    best = best[:3] if best else None
    if best:
        src, s0, d = best; ch, _ = best_channel(SRC[src], s0, d); tp = os.path.join(VO, f"roomtone_{STAMP}.wav")
        g = statistics.median(GAINS) - TONE_UNDER_DB
        seg = tp + ".seg.wav"   # clean the quiet stretch once, then loop it with a short crossfade-free fade at each end
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{s0:.3f}", "-t", f"{d:.3f}", "-i", SRC[src], "-af",
                        f"pan=mono|c0=c{ch}," + CLEAN + f",volume={g:.2f}dB,afade=t=in:d=0.05,afade=t=out:st={d-0.05:.3f}:d=0.05", "-ar", "48000", seg], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-stream_loop", "-1", "-i", seg, "-t", f"{t / FPS:.3f}",
                        "-af", "pan=stereo|c0=c0|c1=c0", "-c:a", "pcm_s24le", tp], check=True)
        os.remove(seg)
        tone = '<track>' + clip("tone", tp, "audio", 0, 0, t) + '</track>'
        print(f"room tone: {src} {s0:.1f}s for {d:.1f}s (looped), {TONE_UNDER_DB} dB under the dialogue's noise floor", file=sys.stderr)
SEQ = os.path.splitext(os.path.basename(OUT))[0]
vt = "".join(f'<track>{"".join(v[c])}</track>' for c in reversed([c for c, _ in CAMS]))   # V1 = B, V2 = A (top)
xml = (f'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="{SEQ}"><name>{SEQ}</name>'
       f'<duration>{t}</duration>{RATE}<timecode>{RATE}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>'
       f'<media><video><format><samplecharacteristics>{RATE}<width>{SW}</width><height>{SH}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>'
       f'{vt}</video><audio><track>{"".join(aud)}</track>{tone}</audio></media>{"".join(markers)}</sequence></xmeml>\n')
open(OUT, "w").write(xml)
json.dump(report, open(OUT.replace(".xml", ".takes.json"), "w"), indent=1)
both = sum(r["cams"] == "A+B" for r in report); none = sum(r["cams"] == "sound only" for r in report)
gaps = {}
for r in report:
    for c, _ in CAMS:
        if c not in r["cams"].split("+"): gaps.setdefault(c, []).append(r["line"])
if NEEDS:   # the human list: every line a person should hear, with the scrub timecode of its other takes
    with open(OUT.replace(".xml", ".needs_your_ear.txt"), "w") as fh:
        for at_, L_, n_, of_, why_, sc_ in NEEDS:
            fh.write(f"{tc(at_)}  Line {int(L_[1:])}, take {n_} of {of_}: {why_}. Other takes: scrub at {tc(sc_)}, or the Take Finder panel\n")
    print(f"NEEDS YOUR EAR: {len(NEEDS)} lines, list in {os.path.basename(OUT.replace('.xml', '.needs_your_ear.txt'))}", file=sys.stderr)
for L_, k_, cut_ in TIGHT: print(f"tightened {L_}: {k_} pause(s), {cut_} s of thinking removed", file=sys.stderr)
for c, ls in gaps.items():   # loud, so it reaches the editor: a camera that silently drops out is the worst miss
    print(f"WARNING: no {c} cam on {len(ls)} pieces: {' '.join(sorted(set(ls)))}", file=sys.stderr)
print(json.dumps(dict(takes=len(report), lines=len({r["line"] for r in report}), minutes=round(t / FPS / 60, 1),
                      with_A_and_B=both, sound_only=none)))
