# conform_4k.py "Proxy sequence" "New 4K sequence name" "Project/Sequences" camera_root [camera_root ...]
# A 4K copy of the editor's cut for grading, built FROM the live timeline (every edit kept); the proxy cut is untouched.
# 1. Premiere exports the sequence as FCP XML (read only).  2. Every *_proxy.mp4 is pointed at its camera original
# (found by name under the camera roots), with the original's frame size.  3. Imported beside the proxy cut (ppro_swap).
# 4. Each camera clip copies its partner's Motion from the proxy cut at 1/(original/proxy height) scale: the XML export
# adds a hidden "aspect" squash on proxies that once had a pixel-shape fix (Notch: A cam came in squashed).
# Not carried by XML (listed by Premiere): some audio effects (e.g. DeNoise, FFT Filter) and Custom Fade transitions
# (become crossfades). Paste Attributes from the proxy cut brings them back.
import glob, json, os, re, subprocess, sys, urllib.parse
SEQ, NEW, BIN, ROOTS = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
T = os.path.dirname(os.path.abspath(__file__)); BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
OUT = os.path.join(os.getcwd(), "conform"); os.makedirs(OUT, exist_ok=True)
def ev(js): return subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=900).stdout.strip().splitlines()[-1]
GET = "function g(n){for(var i=0;i<app.project.sequences.numSequences;i++)if(app.project.sequences[i].name==n)return app.project.sequences[i];}"
src = os.path.join(OUT, "proxy_export.xml")
print("export:", ev(f"(function(){{{GET}return g({json.dumps(SEQ)}).exportAsFinalCutProXML({json.dumps(src)},1);}})()"))
s = open(src).read(); ratio = {}
def original_of(name):
    stem = name.replace("_proxy.mp4", "")
    for r in ROOTS:
        hit = [p for p in glob.glob(os.path.join(r, "**", stem + ".*"), recursive=True) if not p.upper().endswith(".CPF")]
        if hit: return hit[0]
def fix_file(m):
    blk, fid = m.group(0), m.group(1); nm = re.search(r"<name>([^<]*)</name>", blk).group(1)
    o = original_of(nm) if nm.endswith("_proxy.mp4") else None
    if not o: return blk
    w, h = map(int, subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=width,height", "-of", "csv=p=0", o],
                                   capture_output=True, text=True).stdout.strip().split(",")[:2])
    pw = re.search(r"<width>(\d+)</width>", blk).group(1); ph = re.search(r"<height>(\d+)</height>", blk).group(1)
    ratio[fid] = int(ph) / h
    blk = blk.replace(f"<name>{nm}</name>", f"<name>{os.path.basename(o)}</name>", 1)
    blk = re.sub(r"<pathurl>[^<]*</pathurl>", "<pathurl>file://localhost" + urllib.parse.quote(o) + "</pathurl>", blk, 1)
    return blk.replace(f"<width>{pw}</width>", f"<width>{w}</width>").replace(f"<height>{ph}</height>", f"<height>{h}</height>")
s = re.sub(r'<file id="([^"]+)">.*?</file>', fix_file, s, flags=re.S)
s = s.replace(f"<name>{SEQ}</name>", f"<name>{NEW}</name>", 1)
dst = os.path.join(OUT, "conform_4k.xml"); open(dst, "w").write(s)
k = sorted(set(round(v, 4) for v in ratio.values())); print(f"{len(ratio)} camera files -> originals, scale factors {k}, proxy paths left: {s.count('_proxy.mp4</pathurl>')}")
print(subprocess.run([sys.executable, os.path.join(T, "ppro_swap.py"), BIN, NEW, dst], capture_output=True, text=True).stdout.strip())
f = k[0] if len(k) == 1 else None
if f is None: sys.exit("cameras have different proxy ratios: set Motion per camera by hand")
print("motion:", ev(f"""(function(){{{GET}var P=g({json.dumps(SEQ)}),K=g({json.dumps(NEW)}),n=0,kf=[];
function mot(x){{for(var j=0;j<x.components.numItems;j++)if(x.components[j].displayName=="Motion")return x.components[j];}}
function prop(m,a){{for(var p=0;p<m.properties.numItems;p++)if(m.properties[p].displayName==a)return m.properties[p];}}
for(var t=0;t<K.videoTracks.numTracks;t++){{var kc=K.videoTracks[t].clips,pc=P.videoTracks[t].clips;
 for(var i=0;i<kc.numItems;i++){{var x=kc[i],y=null;for(var j=0;j<pc.numItems;j++)if(Math.abs(pc[j].start.seconds-x.start.seconds)<0.01){{y=pc[j];break;}}
  if(!y||!/_proxy/.test(y.projectItem.name))continue;var mk=mot(x),mp=mot(y),sp=prop(mp,"Scale");if(sp.isTimeVarying()){{kf.push(x.start.seconds.toFixed(1));continue;}}
  prop(mk,"Uniform Scale").setValue(true,true);prop(mk,"Scale").setValue(sp.getValue()*{f},true);prop(mk,"Scale Width").setValue(prop(mp,"Scale Width").getValue()*{f},true);
  prop(mk,"Position").setValue(prop(mp,"Position").getValue(),true);n++;}}}}
app.project.save();return n+" clips matched"+(kf.length?", animated scale to check by hand at "+kf.join(" "):"");}})()"""))
