# build_xml.py picks.json sources.json sync_a_wav.jsonl sync_a_b.jsonl out.xml
# Baseline rough cut as FCP 7 XML (Socrates phase 5, simplified: plain clips, not multicam).
# V1 = picked angle (proxy), A1 = recorder WAV range, one sequence marker per line.
import json, os, sys, urllib.parse
from xml.sax.saxutils import escape

PICKS = [p for p in json.load(open(sys.argv[1])) if p["main"]]
SRC = {os.path.basename(p): p for p in json.load(open(sys.argv[2]))}
FPS = 24000/1001
def fr(s): return int(round(s*FPS))
def best(path):
    rows = [json.loads(l) for l in open(path) if l.startswith("{")]
    out = {}
    for r in rows:
        k = os.path.basename(r["other"])
        if k not in out or r["confidence"] > out[k]["confidence"]: out[k] = r
    return out
# Wajo: A cam proxies carry no audio, so B cam is the sync reference.
WAV2B = best(sys.argv[3])                                   # wav -> {ref: B clip, offset_s}: b_time = wav_time + offset
B2C = {}                                                    # B clip -> C partner: c_time = b_time - offset
for r in best(sys.argv[4]).values(): B2C[os.path.basename(r["ref"])] = r
def a_partner(bclip):   # A and B were triggered together: same clip number, offset 0 (unverified, durations match)
    n = bclip[4:8]
    return next((p for k, p in SRC.items() if k.startswith("B029" + n)), None)

dur_cache = {}
def dur(p):
    if p not in dur_cache:
        import subprocess
        dur_cache[p] = float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",p],
                                            capture_output=True, text=True).stdout.strip())
    return dur_cache[p]

# CONFORM=1 builds the same cut on the camera originals (Socrates phase 9): every proxy path is swapped
# for its original on the mounted Aspect drive (same name minus "_proxy", same length), at 3840x2160.
# Sound is unchanged: it already comes from the full-quality recorder files.
CONFORM = os.environ.get("CONFORM") == "1"
ORIG_ROOT = os.environ.get("ORIG_ROOT", "/Volumes/Home Project/Wajo/RAW FOOTAGE")
W_, H_ = (3840, 2160) if CONFORM else (1920, 1080)
def original(path):
    if not CONFORM or not path.endswith("_proxy.mp4"): return path
    cam = os.path.basename(os.path.dirname(os.path.dirname(path)))          # A_CAM / B_CAM / C_CAM
    o = os.path.join(ORIG_ROOT, cam, "CLIP", os.path.basename(path).replace("_proxy.mp4", ".MP4"))
    if not os.path.exists(o): raise SystemExit(f"original missing on Aspect: {o}")
    return o

seen = set()
def file_el(path, kind):
    fid = "f_" + os.path.basename(path).replace(".", "_")
    if fid in seen: return f'<file id="{fid}"/>'
    seen.add(fid)
    url = "file://localhost" + urllib.parse.quote(path)
    media = (f'<video><samplecharacteristics><width>{W_}</width><height>{H_}</height></samplecharacteristics></video>'
             '<audio><channelcount>2</channelcount></audio>') if kind == "video" else '<audio><channelcount>1</channelcount></audio>'
    return (f'<file id="{fid}"><name>{escape(os.path.basename(path))}</name><pathurl>{url}</pathurl>'
            f'<rate><timebase>24</timebase><ntsc>TRUE</ntsc></rate><duration>{fr(dur(path))}</duration><media>{media}</media></file>')

RATE = '<rate><timebase>24</timebase><ntsc>TRUE</ntsc></rate>'
# Recorder tracks: 1 = mix, 4 = lav (on Shivani, ~10 dB cleaner). The lav only hears the person wearing it:
# Fo's lines were read off-mic by crew and came out silent on the lav in v05, so other speakers use the mix.
LAV, MIX = 4, 1
WHO = {l["line"]: l.get("who", "SHIVANI") for l in json.load(open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "lines.json")))}
def mic(p): return LAV if WHO.get(p["line"]) == "SHIVANI" else MIX
def clip(cid, path, kind, start, inp, outp, enabled=True):
    st = '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>' if kind == "audio" else ''
    en = '' if enabled else '<enabled>FALSE</enabled>'
    return (f'<clipitem id="{cid}"><name>{escape(os.path.basename(path))}</name>{en}<duration>{fr(dur(path))}</duration>{RATE}'
            f'<start>{start}</start><end>{start+outp-inp}</end><in>{inp}</in><out>{outp}</out>{file_el(path, kind)}{st}</clipitem>')

import subprocess, numpy as np
_env = {}
def energy(path, ch):   # 10 ms RMS of one recorder track
    if (path, ch) not in _env:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-af", f"pan=mono|c0=c{ch-1}", "-ar", "8000", "-f", "s16le", "-"],
                             capture_output=True, check=True).stdout
        x = np.frombuffer(raw, np.int16).astype(np.float32) / 32768; n = len(x) // 80
        _env[(path, ch)] = np.sqrt((x[:n*80].reshape(n, 80) ** 2).mean(1))
    return _env[(path, ch)]
# word timings: WhisperX forced-aligned ones when present (word ends are ~80 ms later than Whisper's)
WDIR = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), os.environ.get("WORDS_DIR", "words"))
_words = {}
def neighbours(src, w0, w1):   # end of the word before the line, start of the word after it
    if src not in _words: _words[src] = json.load(open(os.path.join(WDIR, src + ".words.json")))
    ws = _words[src]
    before = max((w["end"] for w in ws if w["end"] <= w0 + 0.01 and w["start"] < w0 - 0.01), default=0.0)
    after = min((w["start"] for w in ws if w["start"] >= w1 - 0.01 and w["end"] > w1 + 0.01), default=1e9)
    return before, after
def snap(p, last_of_beat):
    """Cut in the quietest frame near each end of the line, never inside a word and never inside the
    neighbouring words (v05 leaked "Guys.", "Um", "now now" and "Reply" from the lines around it)."""
    e = energy(SRC[p["src"]], mic(p)); w0, w1 = p["start"], p["end"]
    before, after = neighbours(p["src"], w0, w1)
    # run-on words: when the next word follows with no pause ("for a year now"), cutting between them shaves
    # the last word, so the line carries on through them until a real pause (up to 3 words)
    for _ in range(3):
        if after - w1 >= 0.2: break
        nxt = next((w for w in _words[p["src"]] if abs(w["start"] - after) < 1e-6), None)
        if not nxt: break
        w1 = nxt["end"]; before, after = neighbours(p["src"], w0, w1)
    def quiet(a, b):   # only frame boundaries are real cut points, so score those (loudest 10 ms within ±15 ms)
        if b <= a: return (a + b) / 2
        cands = [k/FPS for k in range(int(np.ceil(max(a, 0)*FPS)), int(b*FPS)+1)]
        if not cands: return (a + b) / 2
        lvl = [e[max(int(c*100)-1, 0):int(c*100)+2].max() for c in cands]
        return cands[int(np.argmin(lvl))]
    s_in = quiet(max(w0 - 0.4, before + 0.03), w0 - 0.08)   # at least 80 ms of air before the first word
    s_out = quiet(w1 + 0.08, min(w1 + (0.6 if last_of_beat else 0.45), after - 0.03))
    return s_in, s_out, quiet

# Lines read back to back in one take stay one unbroken piece of sound: only the picture cuts between
# them, at the quietest frame in the gap. Cutting and re-joining a continuous read is what made the
# audio jump ("cuts off abruptly") in v02 to v04.
# Fo's official AI voice files (fo_map.json, mapped by hand from the voice folder's LINES.txt). A line can
# need two files; they play with a short beat between them.
_fm = os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "fo_map.json")
# Entries cut from a whole-scene render (voice_takes.py) carry start/end and are flagged as an older take.
_fmj = json.load(open(_fm)) if os.path.exists(_fm) else {}
FOV = {k: [(f["path"], f.get("start"), f.get("end")) for f in v] for k, v in _fmj.items()}
FOV_OLDER = {k for k, v in _fmj.items() if any(f.get("older") for f in v)}
FO_PAD, FO_GAP = 0.15, 0.25
def _vlen(f): return (f[2] - f[1]) if f[1] is not None else dur(f[0])
FOV_LEN = {k: sum(_vlen(f) for f in fs) + FO_GAP * (len(fs) - 1) for k, fs in FOV.items()}

# Section holds (learned from Shown's own rough cuts: tight 0.2-0.5 s pauses inside a section, one
# deliberate breath at a section change). The last line of every section keeps HOLD seconds of air
# after it: picture runs on, sound is room tone. A "trim point" marker sits where a tight cut would be.
HOLD = float(os.environ.get("SECTION_HOLD", "2.0"))   # Shafin: 2 s, so the next editor has room (editors use ~1 s)
hold_of, trim_at = {}, {}

cuts = []; blk = -1
for n, p in enumerate(PICKS):
    last_of_beat = n+1 == len(PICKS) or PICKS[n+1]["beat"] != p["beat"]
    s_in, s_out, quiet = snap(p, last_of_beat)
    if p["line"] in FOV:   # the real Fo voice replaces the crew read: the slot is as long as the voice
        s_out = s_in + FOV_LEN[p["line"]] + 2 * FO_PAD
    prev = PICKS[n-1] if n else None
    joined = prev is not None and prev["src"] == p["src"] and mic(prev) == mic(p) and -1.0 <= p["start"] - prev["end"] < 1.6 \
        and p["line"] not in FOV and prev["line"] not in FOV and prev["beat"] == p["beat"]   # a section end always holds
    if joined:
        if p["start"] < prev["end"]:   # matches overlap by a word: the earlier line gives it up
            j = quiet(p["start"] - 0.3, p["start"] - 0.02)
        else:
            j = quiet(prev["end"] + 0.02, max(p["start"] - 0.02, prev["end"] + 0.03))   # picture cut inside the gap
        cuts[-1][1] = j; s_in = j
    elif prev is not None and prev["src"] == p["src"] and p["start"] < cuts[-1][1] < p["end"] \
            and prev["line"] not in FOV and p["line"] not in FOV:   # voice-file lines can't repeat recorder words
        cuts[-1][1] = s_in = quiet(p["start"] - 0.3, p["start"] - 0.02)   # never play the same words twice
        blk += 1
    else:
        blk += 1
    if last_of_beat and n+1 < len(PICKS):
        trim_at[n] = s_out - s_in        # where a tight cut would be, from the start of this line
        s_out += HOLD; hold_of[blk] = HOLD
    cuts.append([s_in, s_out, blk])

# One cleaned file per unbroken stretch of sound (Socrates phase 8, lighter): chosen mic, rumble cut,
# light noise reduction, every piece levelled to the same voiced loudness, 20 ms fades at both ends so
# no edit can pop. Premiere plays these instead of the raw recorder files.
# one audio folder per version, so rebuilding never changes a sequence that's already in Premiere
VODIR = os.path.join(os.path.dirname(os.path.abspath(sys.argv[5])), "vo_" + os.path.splitext(os.path.basename(sys.argv[5]))[0])
os.makedirs(VODIR, exist_ok=True)
vo_of = {}
def pcm(args):
    return np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", *args, "-ar", "48000", "-ac", "1", "-f", "f32le", "-"],
                                        capture_output=True, check=True).stdout, np.float32).copy()
def level(x, target_db):   # every piece to the same voiced loudness
    f = x[:len(x)//480*480].reshape(-1, 480); e = np.sqrt((f**2).mean(1))
    v = e[e >= np.percentile(e, 50)] if len(e) else e
    return x * (10**(target_db/20) / (np.sqrt((v**2).mean()) + 1e-9)) if len(v) else x
def word_gate(src, ss, n, floor_db):
    """Pull the background down between words (by floor_db) so every piece's room noise sits at the same
    level and the room-tone bed on A2 carries the gaps. Words come from the transcript; ramps are 40 ms."""
    if src not in _words: _words[src] = json.load(open(os.path.join(WDIR, src + ".words.json")))
    g = np.full(n, 10**(floor_db/20), np.float32)
    for w in _words[src]:
        a, b = int((w["start"] - ss - 0.10) * 48000), int((w["end"] - ss + 0.15) * 48000)
        if b > 0 and a < n: g[max(a, 0):min(b, n)] = 1.0
    k = int(0.04 * 48000)
    return np.convolve(g, np.ones(k, np.float32) / k, "same")
def bake(src, ch, ss, d, b, fade=0.02, target_db=-20.0, line=None):
    hold = hold_of.get(b, 0.0)
    if hold and line not in FOV:   # section hold: read only the speech, then let room tone carry the hold
        x = _bake(src, ch, ss, d - hold, b, fade, target_db, line, out_suffix="")
        return pad_file(x, d)
    return _bake(src, ch, ss, d, b, fade, target_db, line)
def pad_file(path, d):
    y = pcm(["-i", path]); y = np.pad(y, (0, max(int(round(d*48000)) - len(y), 0)))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", "-", "-c:a", "pcm_s24le", path],
                   input=y.astype(np.float32).tobytes(), check=True)
    return path
def _bake(src, ch, ss, d, b, fade=0.02, target_db=-20.0, line=None, out_suffix=""):
    out = os.path.join(VODIR, f"piece{b:02d}_{os.path.splitext(os.path.basename(src))[0]}_ch{ch}.wav")
    if line in FOV:   # official Fo voice: clean already, just pad, join, level
        parts = [np.zeros(int(FO_PAD*48000), np.float32)]
        for k, f in enumerate(FOV[line]):
            if k: parts.append(np.zeros(int(FO_GAP*48000), np.float32))
            path, a0, a1 = f
            src_args = ["-ss", f"{a0:.3f}", "-t", f"{a1 - a0:.3f}", "-i", path] if a0 is not None else ["-i", path]
            piece = level(pcm(src_args), target_db); k2 = min(int(0.015*48000), len(piece)//2)
            if k2: r2 = np.sin(np.linspace(0, np.pi/2, k2))**2; piece[:k2] *= r2; piece[-k2:] *= r2[::-1]
            parts.append(piece)
        parts.append(np.zeros(int(FO_PAD*48000), np.float32))
        x = np.concatenate(parts); x = np.pad(x, (0, max(int(round(d*48000)) - len(x), 0)))[:int(round(d*48000))]
        out = out.replace(".wav", "_fo-voice.wav")
    else:
        placeholder = ch != LAV   # crew read off-mic: noise only ~8 dB under the voice, so clean harder, sit lower
        x = pcm(["-ss", f"{ss:.4f}", "-t", f"{d:.4f}", "-i", src, "-af",
                 f"pan=mono|c0=c{ch-1},highpass=f=90,afftdn=nr={24 if placeholder else 10}:nf={-35 if placeholder else -45}"])
        x = level(x, target_db - (4 if placeholder else 0))
        x *= word_gate(os.path.basename(src), ss, len(x), -26 if placeholder else -14)
    x = 0.89 * np.tanh(x / 0.89)                    # soft ceiling at about -1 dBFS: no hard clipping
    k = min(int(fade*48000), len(x)//2)
    if k: ramp = np.sin(np.linspace(0, np.pi/2, k))**2; x[:k] *= ramp; x[-k:] *= ramp[::-1]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", "-",
                    "-c:a", "pcm_s24le", out], input=x.tobytes(), check=True)
    return out

SECTION = {"HOOK": "Hook", "HOOK1": "Alt hook", "AHA": "Demo 1", "AHA2": "Demo 2", "AHA3": "Demo 3",
           "CLOSE": "Closing", "CTA": "Call to action"}
ANGLE_TRACKS = ["B", "C", "A"]   # V1 phone, V2 BTS, V3 Shivani (top)

# A cam has no audio, so it is placed from camera timecode (the originals' Sony XML sidecars, read once
# into originals.json). Unverified: A and B clocks may not be jammed, so every A shot is labelled
# "check sync" until an editor confirms one, or a proper sync point replaces this.
ORIG = json.load(open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[1])), "originals.json")))
def _tc(s): h, m, sec, f = map(int, s.split(":")); return ((h*60 + m)*60 + sec)*24 + f
def frame(path, at):   # small grey frame for comparing shots
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(at, 0):.3f}", "-i", path, "-frames:v", "1",
                          "-vf", "scale=96:54,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
    if len(raw) != 96*54: return None
    c = np.frombuffer(raw, np.uint8).astype(np.float32).reshape(54, 96)[18:50, 24:46]   # the chair, brightness-neutral
    return c - c.mean()
_empty = None
def chair_empty(path, at, half):
    """A is locked off, so an empty-set frame (taken while Fo talks and she is away, A clip 007) is a
    fixed reference: a mid-line frame that looks like it means she isn't in the shot."""
    global _empty
    if _empty is None:
        ref = next((p for k, p in SRC.items() if k.startswith("B029C007")), None)
        _empty = frame(ref, 30.0) if ref else False
    f = frame(path, at + half)
    if _empty is False or f is None: return False
    return float(np.abs(f - _empty).mean()) < 15.0   # Wajo: empty chair 8-9, Shivani seated 21-25
def a_from_b(bclip):   # -> (A proxy path, seconds A started after B)
    n = bclip[4:8]; b_orig = bclip.replace("_proxy.mp4", ".MP4")
    a_orig = next((k for k in ORIG if k.startswith("B029" + n)), None)
    if not a_orig or b_orig not in ORIG: return None, 0
    return SRC.get(a_orig.replace(".MP4", "_proxy.mp4")), (_tc(ORIG[a_orig]["tc"]) - _tc(ORIG[b_orig]["tc"])) / FPS
v, a, markers, report = {c: [] for c in ANGLE_TRACKS}, [], [], []
t = 0; prev_angle = None; prev_take = None; shot_start = 0
for n, p in enumerate(PICKS):
    s_in, s_out, b = cuts[n]
    angles = {}
    if p["src"] in WAV2B:
        r = WAV2B[p["src"]]; bclip = os.path.basename(r["ref"]); bt = s_in + r["offset_s"]
        angles["B"] = (SRC[bclip], bt)
        # A cam is left out: its proxies have no audio and "same start as B" proved wrong in the preview.
        # It comes back once A has a real sync (originals' timecode from Aspect metadata, or a manual sync point).
        c = B2C.get(bclip)
        if c and bt - c["offset_s"] >= 0: angles["C"] = (c["other"], bt - c["offset_s"])
        ap, ad = a_from_b(bclip)
        if ap and bt - ad >= 0: angles["A"] = (ap, bt - ad)
        audio = (SRC[p["src"]], s_in)
    else:   # camera-only take (or unsynced recorder take): picture and sound from the same file
        audio = (SRC[p["src"]], s_in)
        if p["src"].endswith(".mp4"): angles["C" if "C_CAM" in SRC[p["src"]] else "A"] = (SRC[p["src"]], s_in)
    # Cameras by role, not by letter (Wajo: A = Shivani, B = the phone that is Fo, C = roaming BTS).
    # Shivani's lines show her; everyone else's lines show the phone. C is the alternate underneath.
    founder = WHO.get(p["line"]) == "SHIVANI"
    if founder:
        pref = ["A", "C", "B"]
    else:   # Fo talks for two minutes: alternate the phone close-up with the wide of the set, every ~8 s
        pref = ["B", "A", "C"]
    # look before trusting A: if she has walked out of the locked-off shot, the roaming C cam has her
    empty = pref[0] == "A" and "A" in angles and "C" in angles and chair_empty(*angles["A"], (s_out - s_in) / 2)
    if empty: pref = ["C", "A", "B"]
    # Hold the shot like Shown's editors do (their rough cuts run 6 s to over a minute per shot; v09 switched
    # every line, every 4.7 s). Stay on the current camera unless the speaker or section changes, or it has run 8 s.
    same_speaker = n > 0 and (WHO.get(PICKS[n-1]["line"]) == "SHIVANI") == founder
    same_section = n > 0 and PICKS[n-1]["beat"] == p["beat"]
    held = (t - shot_start) / FPS if n else 0
    if prev_angle in angles and same_speaker and same_section and held < 8.0 and not (empty and prev_angle == "A"):
        pref = [prev_angle] + [x for x in pref if x != prev_angle]
    elif not founder and same_speaker and prev_angle in pref and held >= 8.0:
        pref = [x for x in pref if x != prev_angle] + [prev_angle]   # Fo: change the view after 8 s
    angle = next((x for x in pref if x in angles), None)
    L = fr(s_out) - fr(s_in)
    # every synced angle goes on its own track (V1 B cam, V2 C cam); only the pick is switched on.
    # Until we have real multicam, switch angles by turning clips on/off (Shift+E).
    for cam in ANGLE_TRACKS:
        if cam in angles:
            vp, vin = angles[cam]
            v[cam].append(clip(f"v{cam}{n}", original(vp), "video", t, fr(vin), fr(vin)+L, enabled=(cam == angle)))
    if n == 0 or cuts[n-1][2] != b: blk_t, blk_in = t, fr(audio[1])              # first line of an unbroken stretch
    if n+1 == len(PICKS) or cuts[n+1][2] != b:                                    # last line: lay the whole stretch
        vo = bake(audio[0], mic(p), blk_in / FPS, (t + L - blk_t) / FPS, b, line=p["line"])
        a.append(clip(f"a{b}", vo, "audio", blk_t, 0, t + L - blk_t))
        vo_of[b] = vo
    # plain wording an editor reads without a key: "Hook · Take 2 of 4 · B cam · needs a look"
    label = (f'{SECTION.get(p["beat"], p["beat"].title())} · Take {p["take"]} of {p["of"]} · '
             f'{angle + " cam" if angle else "no picture"}'
             + (" (check sync)" if angle == "A" and WHO.get(p["line"]) == "SHIVANI" else "")
             + ((" · voice file (older take)" if p["line"] in FOV_OLDER else " · Fo voice") if p["line"] in FOV
                else (" · placeholder read" if WHO.get(p["line"]) != "SHIVANI" else ""))
             + ("" if p["flag"] == "green" else " · needs a look"))
    markers.append(f'<marker><name>{escape(label)}</name><comment>{escape(p["text"])} [{p["line"]}]</comment>'
                   f'<in>{t}</in><out>-1</out></marker>')
    if n in trim_at:   # end of a section: the 1 s hold is on purpose; this marks where a tight cut would go
        markers.append(f'<marker><name>Trim point · end of {escape(SECTION.get(p["beat"], p["beat"].title()))}</name>'
                       f'<comment>Section hold of {HOLD:.0f} s left on purpose. Cut here for a tight edit.</comment>'
                       f'<in>{t + fr(trim_at[n])}</in><out>-1</out></marker>')
    report.append(dict(line=p["line"], take=p["take"], of=p["of"], angle=angle or "-", at=round(t/FPS, 2), dur=round(L/FPS, 2),
                       video=angles[angle][0] if angle else None, vin=fr(angles[angle][1])/FPS if angle else 0,
                       audio=audio[0], ain=fr(audio[1])/FPS, flag=p["flag"], text=p["text"], label=label, block=b))
    if angle != prev_angle: shot_start = t
    t += L; prev_angle, prev_take = angle, (p["line"], p["take"])

# A2: room tone under the whole cut, so the background never drops to dead silence between pieces.
# Wajo's sound mixer recorded 10 s of it on purpose (MixPre-014); take its steadiest 2 s off the lav.
def room_tone(total_frames):
    src = next((p for k, p in SRC.items() if k.startswith("MixPre-014")), None)
    if not src: return ""
    x = pcm(["-i", src, "-af", f"pan=mono|c0=c{LAV-1},highpass=f=90"]); w = 48000*2
    e = [np.sqrt((x[i:i+w]**2).mean()) for i in range(0, len(x) - w, 4800)]
    i0 = int(np.argsort(e)[len(e)//4]) * 4800        # quiet but not a dropout
    tone = x[i0:i0+w]; n = int(total_frames / FPS * 48000) + 48000; xf = 4800
    out = np.zeros(n, np.float32); ramp = np.sin(np.linspace(0, np.pi/2, xf))**2; pos = 0
    while pos < n:                                    # loop it with 100 ms equal-power overlaps
        seg = tone.copy(); seg[:xf] *= ramp; seg[-xf:] *= ramp[::-1]
        m = min(len(seg), n - pos); out[pos:pos+m] += seg[:m]; pos += len(seg) - xf
    out *= 10**(-54/20) / (np.sqrt((out**2).mean()) + 1e-9)   # sits just under the lav's own floor
    path = os.path.join(VODIR, "roomtone_bed.wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", "-", "-c:a", "pcm_s24le", path],
                   input=out.tobytes(), check=True)
    return clip("roomtone", path, "audio", 0, 0, total_frames)
rt = room_tone(t)

SEQ = os.path.splitext(os.path.basename(sys.argv[5]))[0]
vtracks = "".join(f'<track>{"".join(v[c])}</track>' for c in ANGLE_TRACKS)
xml = (f'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="{SEQ}">'
       f'<name>{SEQ}</name><duration>{t}</duration>{RATE}<timecode>{RATE}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>'
       f'<media><video><format><samplecharacteristics>{RATE}<width>{W_}</width><height>{H_}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>'
       f'{vtracks}</video><audio><track>{"".join(a)}</track><track>{rt}</track></audio></media>{"".join(markers)}</sequence></xmeml>\n')
open(sys.argv[5], "w").write(xml)
for r in report: r["vo"] = vo_of[r["block"]]
json.dump(report, open(sys.argv[5].replace(".xml", ".segments.json"), "w"), indent=1)
print(json.dumps(dict(segments=len(report), runtime_s=round(t/FPS, 1), no_picture=[r["line"] for r in report if r["angle"] == "-"])))
for r in report: print(r)
