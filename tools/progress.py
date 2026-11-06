# progress.py project_dir [camera_dir_A camera_dir_B]   -> live progress board in a terminal (refreshes every 5 s)
# Shows every pipeline step for one project by counting the files each step writes, so the editor can watch
# instead of asking. Works for any project folder laid out like Notch/ or Concurrence/ (work/ inside it).
import os, sys, time, glob, json
P = os.path.abspath(sys.argv[1]); W = os.path.join(P, "work")
CAM_A = sys.argv[2] if len(sys.argv) > 2 else ""
CAM_B = sys.argv[3] if len(sys.argv) > 3 else ""
def n(pat): return len([f for f in glob.glob(os.path.join(W, pat)) if ".tmp" not in f])
def count(d, exts): return len([f for f in glob.glob(os.path.join(d, "*")) if f.lower().endswith(exts)]) if d else 0
def bar(done, total, w=30):
    if not total: return "[" + "-" * w + "]   -"
    k = int(w * min(done, total) / total); return "[" + "#" * k + "-" * (w - k) + f"] {done}/{total}"
def mark(done, total): return "DONE   " if total and done >= total else ("running" if done else "waiting")
while True:
    a_tot = count(CAM_A, (".crm", ".mov", ".mp4")); b_tot = count(CAM_B, (".mp4", ".mov"))
    prox = count(os.path.join(CAM_A, "Proxies"), (".mov",)) if CAM_A else 0
    rows = [
        ("A cam audio pulled", n("audio_A/*.wav"), a_tot),
        ("B cam audio pulled", n("audio_B/*.wav"), b_tot),
        ("Recorder transcribed", n("words_rec/*.json"), len(glob.glob(os.path.join(W, "words_rec", "*"))) or 0),
        ("B cam transcribed", n("words_B/*.json"), b_tot),
        ("A cam transcribed", n("words_A/*.json"), a_tot),
        ("Synced", 1 if glob.glob(os.path.join(W, "sync*.jsonl")) else 0, 1),
        ("Takes matched", 1 if os.path.exists(os.path.join(W, "takes.json")) else 0, 1),
        ("Scrub built", 1 if glob.glob(os.path.join(W, "*SCRUB*.xml")) else 0, 1),
        ("A cam proxies (Media Encoder)", prox, a_tot),
    ]
    os.system("clear")
    print(f"{os.path.basename(P).upper()} PIPELINE   {time.strftime('%H:%M:%S')}   (Ctrl-C to close, nothing stops)\n")
    for name, d, t in rows: print(f"  {name:30s} {mark(d, t)}  {bar(d, t)}")
    logs = sorted(glob.glob(os.path.join(W, "*.log")), key=os.path.getmtime)
    if logs:
        print("\nLatest:", os.path.basename(logs[-1]))
        try: print("  " + "\n  ".join(open(logs[-1]).read().strip().splitlines()[-4:]))
        except Exception: pass
    time.sleep(5)
