# check_sync.py work_dir "Sequence name" [--fix]   -> every camera clip checked against the sound under it
# For each video clip: the audio piece on A1 at its middle says which moment of the recording plays there
# (<build>.pieces.json: piece -> recording range); the verified sync (sync_*_ok.jsonl) says which camera frame
# matches that moment. A clip showing a different frame is out of sync by the difference. --fix slides the clip's
# source in/out by that much, in place: its position, length, effects and your other edits stay as they are.
import glob, json, os, subprocess, sys
W, SEQ = os.path.abspath(sys.argv[1]), sys.argv[2]; FIX = "--fix" in sys.argv
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
def ev(js):
    r = subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=600)
    if r.returncode or not r.stdout.strip(): sys.exit("Premiere: " + (r.stderr.strip() or "no answer"))
    return r.stdout.strip()
FIND = f"var q=null;for(var i=0;i<app.project.sequences.numSequences;i++)if(app.project.sequences[i].name=={json.dumps(SEQ)})q=app.project.sequences[i];if(!q)'NOSEQ';else "
out = ev("(function(){" + FIND.replace("'NOSEQ';else ", "return 'NOSEQ';") + """var o=[];
function dump(tracks,kind){for(var t=0;t<tracks.numTracks;t++){var c=tracks[t].clips;for(var k=0;k<c.numItems;k++){var x=c[k];
 o.push([kind,t,k,x.projectItem?x.projectItem.name:'?',x.start.seconds,x.end.seconds,x.inPoint.seconds,x.outPoint.seconds].join('|'));}}}
dump(q.videoTracks,'V');dump(q.audioTracks,'A');return o.join('\\n');})()""")
if out.endswith("NOSEQ"): sys.exit("Sequence not found: " + SEQ)
rows = [r.split("|") for r in out.splitlines() if r.count("|") == 7]
rows = [(k, int(t), int(i), n, *map(float, x)) for k, t, i, n, *x in rows]
PIECES = {}
for f in sorted(glob.glob(os.path.join(W, "*.pieces.json")), key=os.path.getmtime): PIECES.update(json.load(open(f)))
SYNC = {}
for f in glob.glob(os.path.join(W, "sync_*_ok.jsonl")):
    for l in open(f):
        if l.startswith("{"):
            r = json.loads(l); SYNC.setdefault((os.path.basename(r["ref"]), os.path.basename(r["other"])), []).append(r["offset_s"])
aud = [r for r in rows if r[0] == "A" and r[3] in PIECES]
def sound_at(t):   # (recording file, second in it) playing at timeline second t
    for k, tr, i, n, st, en, a, b in aud:
        if st <= t < en: p = PIECES[n]; return p["src"], p["s0"] - p.get("pre", 0) + a + (t - st)   # pre: the handle before the edit
    return None
bad = []; ok = 0
for k, tr, i, n, st, en, a, b in rows:
    if k != "V" or not n.endswith(".mp4"): continue
    mid = (st + en) / 2; snd = sound_at(mid)
    if not snd: continue
    offs = SYNC.get((n, snd[0]))
    if not offs: continue
    want = snd[1] + offs[0]; have = a + (mid - st); d = have - want
    if abs(d) > 0.05: bad.append((tr, i, n, st, d))
    else: ok += 1
mm = lambda x: f"{int(x // 60):02d}:{int(x % 60):02d}:{int(round((x % 1) * 24)):02d}"
print(f"{SEQ}: {ok} camera clips in sync, {len(bad)} out")
for tr, i, n, st, d in bad: print(f"  V{tr + 1} at {mm(st)}  {n}  {'late' if d > 0 else 'early'} by {abs(d):.2f} s")
if FIX and bad:
    fx = ";".join(f"fix({tr},{i},{-d:.4f})" for tr, i, n, st, d in bad)
    r = ev("(function(){" + FIND.replace("'NOSEQ';else ", "return 'NOSEQ';") + """var n=0,e=[];
function fix(t,i,d){var x=q.videoTracks[t].clips[i];try{var a=x.inPoint.seconds+d,b=x.outPoint.seconds+d;
 var ti=new Time();ti.seconds=a;var to=new Time();to.seconds=b;x.inPoint=ti;x.outPoint=to;
 if(Math.abs(x.inPoint.seconds-a)<0.02)n++;else e.push(t+'/'+i);}catch(err){e.push(t+'/'+i+':'+err);}}
""" + fx + ";app.project.save();return n+' fixed'+(e.length?', failed: '+e.join(' '):'');})()")
    print(r)
