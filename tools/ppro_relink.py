# ppro_relink.py work_dir   -> points Premiere's clips at the re-made sound pieces (rebake_map.json: old -> new file)
# changeMediaPath keeps every clip that uses the piece exactly as you edited it (in/out, position, keyframes, effects).
import json, os, subprocess, sys
W = os.path.abspath(sys.argv[1]); M = json.load(open(os.path.join(W, "rebake_map.json")))
M = {k: (v[0] if isinstance(v, list) else v) for k, v in M.items()}   # build_scrub writes [new_path, handle]
BR = os.path.expanduser("~/.claude-adobe-bridge/bin/adobe-bridge")
js = "(function(){var M=" + json.dumps(M) + """,n=0,miss=[];
function walk(b){for(var i=0;i<b.children.numItems;i++){var c=b.children[i];if(c.type==2)walk(c);else{var mp='';try{mp=c.getMediaPath()||'';}catch(e){}var k=M[c.name]?c.name:mp.split('/').pop();if(M[k]){if(c.changeMediaPath(M[k],true))n++;else miss.push(k);}}}}
walk(app.project.rootItem);app.project.save();return n+' clips relinked'+(miss.length?', failed: '+miss.join(' '):'');})()"""
r = subprocess.run([BR, "eval", "ppro", js], capture_output=True, text=True, timeout=600)
print(r.stdout.strip() or "FAILED: " + r.stderr.strip())
