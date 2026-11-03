# render_preview.py segments.json out.mp4   -> quick 720p proxy preview with a plain-English label burn-in
# Picture is cut per line; sound is laid per unbroken stretch (segments sharing a "block"), so a
# continuous read plays as one piece of audio with fades only where the sound really cuts.
import json, os, subprocess, sys, tempfile
SEG = json.load(open(sys.argv[1])); OUT = sys.argv[2]
tmp = tempfile.mkdtemp(dir=os.path.dirname(os.path.abspath(OUT)))   # stays on the T7
def run(*a): subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=True)

vparts = []
for i, s in enumerate(SEG):
    f = os.path.join(tmp, f"v{i:03d}.mp4")
    label = s["label"].replace("·", "-").replace(":", "").replace("'", "")   # drawtext chokes on : and '
    draw = f"drawtext=text='{label}':x=24:y=24:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8"
    vin = ["-ss", str(s["vin"]), "-t", str(s["dur"]), "-i", s["video"]] if s["video"] else \
          ["-f", "lavfi", "-t", str(s["dur"]), "-i", "color=c=black:s=1920x1080:r=24000/1001"]
    run(*vin, "-an", "-vf", f"scale=1280:-2,{draw}", "-r", "24000/1001", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", f)
    vparts.append(f)

# sound = the cleaned, already-faded pieces build_xml.py baked, laid end to end exactly as on the timeline
aparts = []; seen = set()
for s in SEG:
    if s["block"] in seen: continue
    seen.add(s["block"]); aparts.append(s["vo"])

def listfile(parts, name):
    p = os.path.join(tmp, name); open(p, "w").write("".join(f"file '{x}'\n" for x in parts)); return p
vl, al = listfile(vparts, "v.txt"), listfile(aparts, "a.txt")
bed = os.path.join(os.path.dirname(SEG[0]["vo"]), "roomtone_bed.wav")   # A2 on the timeline
mix = ["-i", bed, "-filter_complex", "[1:a][2:a]amix=inputs=2:duration=first:normalize=0[a]", "-map", "[a]"] \
      if os.path.exists(bed) else ["-map", "1:a"]
run("-f", "concat", "-safe", "0", "-i", vl, "-f", "concat", "-safe", "0", "-i", al, *mix,
    "-map", "0:v", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", OUT)
for p in vparts + [vl, al]: os.remove(p)
os.rmdir(tmp)
print(OUT)
