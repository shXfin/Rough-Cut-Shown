# build_scrub.py work_dir out.xml   -> the SCRUB: every take of every script line, in script order, labelled,
# with every synced camera stacked over the recorder sound (Socrates' SELECTS tab, Mateus's day-2 deliverable).
# Reviewers pick takes from it; the rough cut is built from the picks afterwards.
# Inputs in work_dir: lines.json, takes.json, sources.json, sync_a_ok.jsonl / sync_b_ok.jsonl
# (verified syncs: cam_time = recorder_time + offset_s). Cameras without a verified sync for a take are left off.
import json, os, subprocess, sys, urllib.parse
from xml.sax.saxutils import escape
W, OUT = sys.argv[1], sys.argv[2]
RC = len(sys.argv) > 3 and sys.argv[3] == "--rough-cut"   # rough cut: only the picked take of each main line, butted together
J = lambda n: json.load(open(os.path.join(W, n)))
LINES = {l["line"]: l for l in J("lines.json")}
TAKES = J("takes.json")
SRC = {os.path.basename(p): p for p in J("sources.json")}
FPS = 24000/1001; fr = lambda s: int(round(s * FPS))
GAP_TAKE, GAP_LINE, HANDLE = 1.0, 3.0, 0.5
if RC: GAP_TAKE, GAP_LINE, HANDLE = 0.0, 0.0, 0.2   # seconds between takes / between lines; air kept around each take
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
VO = os.path.join(W, "vo_RC" if RC else "vo_SCRUB"); 
CLEAN = ("highpass=f=75:poles=2,"                                          # rumble, wind, handling
         "equalizer=f=60:t=q:w=10:g=-18,equalizer=f=120:t=q:w=10:g=-10,equalizer=f=180:t=q:w=10:g=-6,"   # 60 Hz hum (US mains)
         "afftdn=nr=10:nf=-45:tn=1,"                                            # gentle broadband noise: never watery
         "equalizer=f=250:t=q:w=1.2:g=-2,equalizer=f=4500:t=q:w=1.5:g=1.5,"      # less boxy lav, a touch of presence
         "deesser=i=0.25:m=0.5:f=0.5,"                                          # soft de-ess (the presence lift adds s)
         "acompressor=threshold=-26dB:ratio=2:attack=20:release=250:knee=6")     # light glue, keeps it natural
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
CHAN = {}
def bake(wav, s0, s1, n, fin=0.012, fout=0.012):
    os.makedirs(VO, exist_ok=True); out = os.path.join(VO, f"{'rc' if RC else 'take'}_{n:03d}.wav"); d = s1 - s0
    ch, lv = best_channel(wav, s0, d); CHAN[n] = (ch + 1, [round(x, 1) for x in lv])
    af = f"pan=mono|c0=c{ch}," + CLEAN
    tmp = out + ".tmp.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{s0:.3f}", "-t", f"{d:.3f}", "-i", wav, "-af", af, "-ar", "48000", "-c:a", "pcm_f32le", tmp], check=True)
    o = subprocess.run(["ffmpeg", "-hide_banner", "-i", tmp, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    I = [l for l in o.splitlines() if l.strip().startswith("I:")]
    gain = TARGET_LUFS - float(I[-1].split()[1]) if I and "-inf" not in I[-1] else 0
    gain = max(-12, min(30, gain))   # dialogue levelling, like riding the fader per line
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
def clip(cid, path, kind, start, inp, length, enabled=True, fin=0, fout=0):
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
              f'<parameter><parameterid>scale</parameterid><name>Scale</name><value>{round(SH / size(path)[1] * 100, 3)}</value></parameter></effect></filter>')
    return (f'<clipitem id="{cid}"><name>{escape(os.path.basename(path))}</name>{en}<duration>{fr(dur(path))}</duration>{RATE}'
            f'<start>{start}</start><end>{start+length}</end><in>{inp}</in><out>{inp+length}</out>{file_el(path, kind)}{st}{fx}</clipitem>')

SECTION = {"HOOK": "Hook", "AHA": "Demo 1", "AHA2": "Demo 2", "AHA3": "Demo 3", "FEATURES": "Features",
           "PROOF": "Social proof", "CLOSE": "Closing", "CTA": "Giveaway"}
WHO = {"FOUNDER1": "Founder 1", "FOUNDER2": "Founder 2"}
order = list(LINES)
by_line = {}
for t in TAKES: by_line.setdefault(t["line"], []).append(t)
if RC:   # keep only each main line's pick (pick.py), in script order
    PICKS = {p["line"]: p for p in J("picks.json")}
    by_line = {L: [t for t in ts if L in PICKS and t["take"] == PICKS[L]["take"] and t["src"] == PICKS[L]["src"]]
               for L, ts in by_line.items() if LINES[L]["main"]}
v = {c: [] for c, _ in CAMS}; aud, markers = [], []
t = 0; n = 0; report = []; MAIN_PATH = None
JOIN_IN, JOIN_OUT = {}, {}
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
        s0, s1 = max(tk["start"] - HANDLE, 0), tk["end"] + HANDLE
        if RC:   # lines that run on in one take join at the gap between them: no word plays twice
            if L in JOIN_IN: s0 = JOIN_IN[L]
            if L in JOIN_OUT: s1 = JOIN_OUT[L]
        length = fr(s1) - fr(s0)
        wav = SRC.get(tk["src"])
        on = None
        for cam, _ in CAMS:
            path, at = cam_for(cam, tk["src"], s0, s1)
            if path:
                if cam == CAMS[0][0] and MAIN_PATH is None: MAIN_PATH = path
                v[cam].append(clip(f"v{cam}{n}", path, "video", t, fr(at), length, enabled=on is None)); on = on or cam
        if wav and BAKE: aud.append(clip(f"a{n}", bake(wav, s0, s1, n), "audio", t, 0, length, fin=0 if RC and L in JOIN_IN else FADE, fout=0 if RC and L in JOIN_OUT else FADE))
        elif wav: aud.append(clip(f"a{n}", wav, "audio", t, fr(s0), length))
        flag = "" if tk.get("flag") == "green" else " · reworded or rough"
        cams = "+".join(c for c, _ in CAMS if any(f'id="v{c}{n}"' in x for x in v[c][-1:])) or "sound only"
        miss = [c for c, _ in CAMS if c not in cams.split("+")]
        flag += "".join(f" · NO {c} CAM" for c in miss)   # a missing camera is flagged on the timeline, never silent
        name = f'{SECTION.get(ln["beat"], ln["beat"].title())} · {L} · Take {k} of {len(ts)} · {WHO.get(ln.get("who"), "")}{flag}'
        color = '<color><alpha>0</alpha><red>255</red><green>0</green><blue>0</blue></color>' if miss else ""
        markers.append(f'<marker>{color}<name>{escape(name)}</name><comment>{escape(tk.get("text", ""))} | cameras: {cams}</comment><in>{t}</in><out>-1</out></marker>')
        report.append(dict(line=L, take=k, of=len(ts), at=round(t / FPS, 2), dur=round(length / FPS, 2), cams=cams))
        t += length + fr(GAP_TAKE if k < len(ts) else GAP_LINE); n += 1

SEQ = os.path.splitext(os.path.basename(OUT))[0]
vt = "".join(f'<track>{"".join(v[c])}</track>' for c in reversed([c for c, _ in CAMS]))   # V1 = B, V2 = A (top)
xml = (f'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="{SEQ}"><name>{SEQ}</name>'
       f'<duration>{t}</duration>{RATE}<timecode>{RATE}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>'
       f'<media><video><format><samplecharacteristics>{RATE}<width>{SW}</width><height>{SH}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>'
       f'{vt}</video><audio><track>{"".join(aud)}</track></audio></media>{"".join(markers)}</sequence></xmeml>\n')
open(OUT, "w").write(xml)
json.dump(report, open(OUT.replace(".xml", ".takes.json"), "w"), indent=1)
both = sum(r["cams"] == "A+B" for r in report); none = sum(r["cams"] == "sound only" for r in report)
gaps = {}
for r in report:
    for c, _ in CAMS:
        if c not in r["cams"].split("+"): gaps.setdefault(c, []).append(r["line"])
for c, ls in gaps.items():   # loud, so it reaches the editor: a camera that silently drops out is the worst miss
    print(f"WARNING: no {c} cam on {len(ls)} pieces: {' '.join(sorted(set(ls)))}", file=sys.stderr)
print(json.dumps(dict(takes=len(report), lines=len({r["line"] for r in report}), minutes=round(t / FPS / 60, 1),
                      with_A_and_B=both, sound_only=none)))
