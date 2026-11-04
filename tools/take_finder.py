# take_finder.py work_dir [port]   -> a visual take finder at http://127.0.0.1:<port>
# One row per script line: the rough cut's pick (A and B frames) and every other take as thumbnails with take
# number, scrub timecode and flags (cameraman read, wind, CHECK). Clicking a take jumps Premiere's playhead to it
# in the scrub; "Rough cut" jumps to the line in the rough cut. Jumps go through the Claude Adobe Bridge CLI on
# this Mac, so the bridge token never reaches the page.
import json, os, subprocess, sys, html, http.server, urllib.parse
W = os.path.abspath(sys.argv[1]); PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 4310
FD = os.path.join(W, "finder"); TH = os.path.join(FD, "thumbs"); os.makedirs(TH, exist_ok=True)
SCRUB_SEQ = os.environ.get("SCRUB_SEQ", "NOTCH REVIEW 2 - Scrub (every take)")
RC_SEQ = os.environ.get("RC_SEQ", "NOTCH REVIEW 1 - Rough cut (picked takes)")
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
LINES = {l["line"]: l for l in json.load(open(os.path.join(W, "lines.json")))}
SCRUB = json.load(open(os.path.join(W, os.environ.get("SCRUB_REPORT", "notch_SCRUB_work.takes.json"))))
RC = {r["line"]: r for r in json.load(open(os.path.join(W, os.environ.get("RC_REPORT", "notch_RC_clean.takes.json"))))}
def thumb(path, sec, name):
    out = os.path.join(TH, name)
    if not os.path.exists(out):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(sec, 0):.2f}", "-i", path, "-frames:v", "1",
                        "-vf", "scale=-2:150,setsar=1", "-q:v", "5", out])
    return os.path.basename(out) if os.path.exists(out) else None
def tc(x):
    f = int(round(x * 24000 / 1001)); return f"{f // 86400:02d}:{f // 1440 % 60:02d}:{f // 24 % 60:02d}:{f % 24:02d}"
rows = []
for L, ln in LINES.items():
    takes = [r for r in SCRUB if r["line"] == L]
    pk = RC.get(L)   # the rough cut's pick first, then every other take in shooting order
    takes.sort(key=lambda r: not (pk and pk["take"] == r["take"] and pk["src"] == r["src"]))
    if not takes: continue
    pick = RC.get(L)
    cards = []
    for r in takes:
        is_pick = pick and pick["take"] == r["take"] and pick["src"] == r["src"]
        imgs = "".join(f'<figure><img loading="lazy" src="thumbs/{t}" alt=""><figcaption>{c}</figcaption></figure>'
                       for c, (p, s) in sorted(r.get("frames", {}).items()) for t in [thumb(p, s, f"{L}_{r['take']}_{c}.jpg")] if t) \
               or '<div class="nopic">sound only</div>'
        tags = (['<b class="t pick">In rough cut</b>'] if is_pick else []) + (['<b class="t feed">Cameraman read</b>'] if r.get("feed") else []) \
             + (['<b class="t wind">Wind</b>'] if (r.get("wind") or -99) > 12 else []) \
             + [f'<b class="t miss">No {c} cam</b>' for c in ("A", "B") if c not in r.get("cams", "")]
        cards.append(f'''<button class="take{' is-pick' if is_pick else ''}{' is-feed' if r.get('feed') else ''}" data-seq="scrub" data-t="{r['at']}" data-say="{L} take {r['take']}"
          title="{html.escape(r.get('text',''))}"><div class="pics">{imgs}</div><div class="meta"><span class="num">Take {r['take']}</span>
          <span class="tc">{tc(r['at'])}</span></div><div class="tags">{''.join(tags)}</div><p>{html.escape(r.get('text','')[:110])}</p></button>''')
    check = ", ".join(pick.get("check") or []) if pick else ""
    rc_btn = f'<button class="jump" data-seq="rc" data-t="{pick["at"]}">Rough cut {tc(pick["at"])}</button>' if pick else ""
    rows.append(f'''<section class="line{' has-check' if check else ''}" id="{L}"><header><h2>{L}</h2><div class="script">{html.escape(ln['text'])}</div>
      <div class="who">{html.escape(ln.get('who','').title())}{' · ' + html.escape(check) if check else ''}</div>{rc_btn}</header>
      <div class="strip">{''.join(cards)}</div></section>''')
checks = sum(1 for r in RC.values() if r.get("check"))
page = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "take_finder.html")).read()
page = page.replace("{{ROWS}}", "\n".join(rows)).replace("{{N}}", str(len(rows))).replace("{{CHECKS}}", str(checks))
open(os.path.join(FD, "index.html"), "w").write(page)
def jump(seq, t):
    name = SCRUB_SEQ if seq == "scrub" else RC_SEQ
    ticks = str(int(round(float(t) * 254016000000)))
    code = (f"var q=null; for(var i=0;i<app.project.sequences.numSequences;i++) if(app.project.sequences[i].name=={json.dumps(name)}) q=app.project.sequences[i];"
            f"if(!q) 'missing'; else {{ app.project.openSequence(q.sequenceID); q.setPlayerPosition('{ticks}'); 'ok'; }}")
    o = subprocess.run([BR, "eval", "ppro", code], capture_output=True, text=True, timeout=30)
    return (o.stdout.strip().splitlines() or ["error"])[-1]
RC_SPANS = sorted((r["at"], r["at"] + r["dur"], r["line"]) for r in RC.values())
SC_SPANS = sorted((r["at"], r["at"] + r["dur"], r["line"]) for r in SCRUB)
def selected():
    """The clip selected in Premiere's active sequence -> its script line (rough cut or scrub), or the playhead's."""
    code = ("var q=app.project.activeSequence; if(!q) 'none'; else { var s=q.getSelection(), t=-1;"
            " for(var i=0;i<s.length;i++) if(s[i].start){ t=s[i].start.seconds; break; }"
            " (t<0 ? 'P' : 'S')+'|'+q.name+'|'+(t<0 ? q.getPlayerPosition().seconds : t+0.05); }")
    o = subprocess.run([BR, "eval", "ppro", code], capture_output=True, text=True, timeout=15)
    parts = (o.stdout.strip().splitlines() or ["none"])[-1].split("|")
    if len(parts) != 3: return {}
    kind, seq, t = parts[0], parts[1], float(parts[2])
    spans = RC_SPANS if seq == RC_SEQ else SC_SPANS if seq == SCRUB_SEQ else []
    line = next((L for a, b, L in spans if a <= t < b), None)
    return {"line": line, "by": "selection" if kind == "S" else "playhead", "seq": seq}
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/selected"):
            b = json.dumps(selected()).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b); return
        return super().do_GET()
    def __init__(self, *a, **k): super().__init__(*a, directory=FD, **k)
    def log_message(self, *a): pass
    def do_POST(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        r = jump(q.get("seq", ["scrub"])[0], q.get("t", ["0"])[0]) if self.path.startswith("/jump") else "unknown"
        self.send_response(200); self.send_header("Content-Type", "text/plain"); self.end_headers(); self.wfile.write(r.encode())
print(f"take finder: http://127.0.0.1:{PORT}  ({len(rows)} lines)", flush=True)
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
