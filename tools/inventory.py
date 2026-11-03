# inventory.py root out.json   -> what each client folder on Aspect has for rough-cut learning
# Read-only: walks folder and file NAMES and sizes, never opens a file. For each client it counts camera
# clips, recorder audio, Premiere projects, rough-cut renders, scripts and finals, so we can see which
# past launches are a complete training example (raw + script + human rough cut).
import json, os, re, sys
ROOT, OUT = sys.argv[1], sys.argv[2]
VID = (".mp4", ".mov", ".mxf", ".r3d", ".braw", ".mts")
def kind(path, name):
    n, p = name.lower(), path.lower()
    if n.endswith((".prproj",)): return "premiere_project"
    if n.endswith((".xml", ".fcpxml", ".edl")) and re.search(r"rough|rc|cut|seq", n): return "timeline_export"
    if n.endswith(".docx") and "script" in n: return "script"
    if n.endswith((".wav", ".bwf")) and re.search(r"audio|sound|mixpre|zoom|zaxcom", p + n): return "recorder_audio"
    if n.endswith(VID):
        if re.search(r"rough|\brc\b|_rc_|rc_v|rought", n) or re.search(r"/rough ?cut", p): return "rough_cut_render"
        if re.search(r"proxy|proxies", p + n): return "proxy"
        if re.search(r"raw|[abcd][ _-]?cam|cam[ _-]?[abcd]|/clip/|footage", p): return "camera_raw"
        if re.search(r"final|stitch|_x_|linkedin|post|launch video|v\d+\.", p + n): return "final_or_stitch"
        return "other_video"
    return None
report = {}
for client in sorted(os.listdir(ROOT)):
    base = os.path.join(ROOT, client)
    if not os.path.isdir(base) or client.startswith(("MSI", ".")): continue
    r = {}; sizes = {}
    for d, subs, files in os.walk(base):
        if d[len(base):].count(os.sep) > 6: subs[:] = []; continue
        subs[:] = [s for s in subs if not s.startswith(".") and s.lower() not in ("thmbnl", "general", "sub", "adobe premiere pro auto-save")]
        for f in files:
            if f.startswith("."): continue
            k = kind(os.path.relpath(os.path.join(d, f), base), f)
            if not k: continue
            r.setdefault(k, []).append(os.path.relpath(os.path.join(d, f), base))
            try: sizes[k] = sizes.get(k, 0) + os.path.getsize(os.path.join(d, f))
            except OSError: pass
    report[client] = {k: dict(count=len(v), gb=round(sizes.get(k, 0)/1e9, 1), examples=v[:4]) for k, v in r.items()}
    have = lambda k: k in report[client]
    complete = (have("camera_raw") or have("proxy")) and have("script") and (have("rough_cut_render") or have("premiere_project") or have("timeline_export"))
    report[client]["_complete"] = bool(complete)
    print(f'{client:22} raw {report[client].get("camera_raw",{}).get("count",0):4} proxy {report[client].get("proxy",{}).get("count",0):4} '
          f'audio {report[client].get("recorder_audio",{}).get("count",0):3} script {report[client].get("script",{}).get("count",0):2} '
          f'prproj {report[client].get("premiere_project",{}).get("count",0):3} rc_render {report[client].get("rough_cut_render",{}).get("count",0):3} '
          f'final {report[client].get("final_or_stitch",{}).get("count",0):3}  {"COMPLETE" if complete else ""}', flush=True)
json.dump(report, open(OUT, "w"), indent=1)
