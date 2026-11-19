/*
 * Claude Bridge v2: Premiere Pro helpers.
 * Loaded on demand by the v2 MCP server ($.evalFile) on top of the panel's bridge.jsx, so it works with
 * any panel version. ExtendScript is ES3: no let/const/arrow functions, JSON, Array map/forEach/indexOf,
 * trailing commas, or String trim. Never name a variable `ok` (reserved in Premiere's eval).
 *
 * Times cross the wire as ticks (254016000000 per second, as numbers). The server turns seconds and
 * timecode into ticks, so nothing here guesses about frame rates.
 */
// Scripts run in their own global-level scope, so `var ok`, `var B` etc. in a script can't break the bridge.
function __claudeBridgeEval2(__claudeSrc) { return eval(__claudeSrc); }

(function (B) {
    if (!B) { throw new Error("Claude Bridge core (bridge.jsx) is not loaded."); }

    var V = { version: "2.0.0", build: null, fns: {}, keyBase: null, moveForm: null };
    var F = V.fns;
    var TPS = 254016000000;
    var MEDIA_ALL = 4;
    var journal = [];
    var BIN_SNAP = "Claude snapshots";
    var BIN_TEMP = "Claude temp";

    // ------------------------------------------------------------------ basics
    function fail(msg) { var e = new Error(msg); e.user = true; throw e; }
    function did(msg) { journal.push(msg); }
    function has(o, k) { return o !== null && o !== undefined && o[k] !== undefined && o[k] !== null; }
    function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
    function trim(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
    function lower(s) { return String(s).toLowerCase(); }
    function normPath(p) { return String(p || "").replace(/\\/g, "/").toLowerCase(); }
    function inList(arr, v) { for (var i = 0; i < arr.length; i++) { if (arr[i] === v) { return true; } } return false; }
    function absf(x) { return x < 0 ? -x : x; }

    function tk(t) {
        if (t === null || t === undefined) { return null; }
        if (typeof t === "number") { return t; }
        if (typeof t === "string") { return Number(t); }
        try { if (t.ticks !== undefined) { return Number(t.ticks); } } catch (e) {}
        try { if (t.seconds !== undefined) { return Math.round(Number(t.seconds) * TPS); } } catch (e2) {}
        return null;
    }
    function tstr(n) {
        n = Math.round(Number(n));
        if (n < 0) { return "-" + tstr(-n); }
        var s = String(n);
        if (s.indexOf("e") >= 0) {
            // very large numbers: build the digits by hand
            var out = "", x = n;
            while (x >= 1) { var d = x % 10; out = String(d) + out; x = (x - d) / 10; }
            s = out || "0";
        }
        return s;
    }
    function mkTime(ticks) { var t = new Time(); t.ticks = tstr(ticks); return t; }
    function secs(ticks) { return Math.round(Number(ticks) / TPS * 1000000) / 1000000; }

    function errInfo(e) {
        var msg;
        try { msg = (e && e.message) ? e.message : String(e); } catch (x) { msg = "Unknown error"; }
        var info = { ok: false, error: msg };
        if (!(e && e.user)) {
            try { if (e && e.line) { info.line = e.line; } } catch (y) {}
            try {
                var f = e && e.fileName ? e.fileName : "";
                if (f && typeof f !== "string") { f = f.fsName || String(f); }
                info.file = f ? String(f) : "(eval)";
            } catch (z) {}
            try { info.stack = String($.stack).slice(0, 2000); } catch (w) {}
        }
        if (journal.length) { info.done = journal.slice(0); }
        try { if (e && e.snapshot) { info.snapshot = e.snapshot; } } catch (s) {}
        return info;
    }

    V.call = function (name, args) {
        journal = [];
        try {
            if (!F.hasOwnProperty(name)) { fail("Unknown v2 helper: " + name + ". The server and ppro2.jsx don't match: restart Claude Code."); }
            var r = F[name](args || {});
            return B.stringify({ ok: true, result: r });
        } catch (e) {
            return B.stringify(errInfo(e));
        }
    };

    // Run a user script (a job step). The value of the last expression is returned.
    V.exec = function (src) {
        journal = [];
        try {
            var r = __claudeBridgeEval2(src);
            return B.stringify({ ok: true, result: r });
        } catch (e) {
            var info = errInfo(e);
            // An error in the script itself: report the script's line, not a library file's.
            try { if (e.source === src) { info.file = "(eval)"; } } catch (x) {}
            return B.stringify(info);
        }
    };

    // No automatic undo: on Premiere 27 some script changes never reach the undo stack (a clip's enabled state)
    // and one undo() can step back more than one action, so undoing could revert the editor's own work.
    // Edits check everything they can before changing anything; multi-step edits save a snapshot first, and an
    // error lists what was already done.
    function guarded(a, fn) {
        return fn();
    }

    // ------------------------------------------------------------------ project, bins, items
    function project() {
        if (!app.project) { fail("No Premiere Pro project is open."); }
        return app.project;
    }

    function getSeq(id) {
        var p = project();
        if (id === undefined || id === null || id === "") {
            if (!p.activeSequence) { fail("No active sequence. Open one in the Timeline or pass sequence_id."); }
            return p.activeSequence;
        }
        for (var i = 0; i < p.sequences.numSequences; i++) {
            var s = p.sequences[i];
            if (String(s.sequenceID) === String(id)) { return s; }
        }
        var hits = [];
        for (var j = 0; j < p.sequences.numSequences; j++) {
            if (p.sequences[j].name === id) { hits.push(p.sequences[j]); }
        }
        if (hits.length === 1) { return hits[0]; }
        if (hits.length > 1) { fail(hits.length + " sequences are called '" + id + "'. Pass the sequence id instead (premiere_get_project lists them)."); }
        fail("Sequence not found: " + id);
    }

    function seqById(id) {
        var p = project();
        for (var i = 0; i < p.sequences.numSequences; i++) {
            if (String(p.sequences[i].sequenceID) === String(id)) { return p.sequences[i]; }
        }
        return null;
    }

    function seqIds() {
        var p = project(), ids = {};
        for (var i = 0; i < p.sequences.numSequences; i++) { ids[String(p.sequences[i].sequenceID)] = true; }
        return ids;
    }

    function getBin(name, create) {
        var root = project().rootItem;
        for (var i = 0; i < root.children.numItems; i++) {
            var c = root.children[i];
            if (c.type === 2 && c.name === name) { return c; }
        }
        if (!create) { return null; }
        var bin = root.createBin(name);
        if (bin) { return bin; }
        return getBin(name, false);
    }

    function walkItems(item, fn) {
        for (var i = 0; i < item.children.numItems; i++) {
            var c = item.children[i];
            if (c.type === 2) { if (walkItems(c, fn)) { return true; } }
            else if (fn(c)) { return true; }
        }
        return false;
    }

    function itemByPath(p) {
        var target = normPath(p), hit = null;
        walkItems(project().rootItem, function (c) {
            var mp = "";
            try { mp = c.getMediaPath(); } catch (e) {}
            if (mp && normPath(mp) === target) { hit = c; return true; }
            return false;
        });
        return hit;
    }

    function itemByNodeId(id) {
        var hit = null;
        walkItems(project().rootItem, function (c) { if (String(c.nodeId) === String(id)) { hit = c; return true; } return false; });
        return hit;
    }

    function importFile(p, binName) {
        var it = itemByPath(p);
        if (it) { return it; }
        var f = new File(p);
        if (!f.exists) { fail("File not found: " + p); }
        var bin = binName ? getBin(binName, true) : project().getInsertionBin();
        project().importFiles([p], true, bin, false);
        it = itemByPath(p);
        if (!it) { fail("Premiere didn't import " + p); }
        did("imported " + f.name);
        return it;
    }

    function resolveItem(src) {
        if (!src) { fail("source is required (path or node_id)."); }
        if (has(src, "node_id")) {
            var it = itemByNodeId(src.node_id);
            if (!it) { fail("No project item with node_id " + src.node_id); }
            return it;
        }
        if (has(src, "path")) { return importFile(src.path, src.bin || null); }
        fail("source needs a path or a node_id.");
    }

    // ------------------------------------------------------------------ tracks and clips
    function trackColl(seq, kind) { return kind === "audio" ? seq.audioTracks : seq.videoTracks; }
    function label(kind, i) { return (kind === "audio" ? "A" : "V") + (i + 1); }

    function parseTrack(t) {
        if (t === null || t === undefined) { return null; }
        if (typeof t === "string") {
            var m = /^\s*([VvAa])\s*(\d+)\s*$/.exec(t);
            if (!m) { fail("Track '" + t + "' isn't valid. Use names like V1, V2, A1, A3."); }
            return { kind: (m[1] === "A" || m[1] === "a") ? "audio" : "video", index: Number(m[2]) - 1 };
        }
        if (has(t, "kind") && has(t, "index")) { return { kind: t.kind, index: Number(t.index) }; }
        fail("Bad track: " + B.stringify(t));
    }

    function getTrack(seq, t) {
        var p = parseTrack(t);
        var coll = trackColl(seq, p.kind);
        if (p.index < 0 || p.index >= coll.numTracks) { fail(label(p.kind, p.index) + " doesn't exist in '" + seq.name + "' (it has " + coll.numTracks + " " + p.kind + " tracks)."); }
        return { kind: p.kind, index: p.index, track: coll[p.index] };
    }

    function allTracks(seq) {
        var out = [];
        var kinds = ["video", "audio"];
        for (var k = 0; k < kinds.length; k++) {
            var coll = trackColl(seq, kinds[k]);
            for (var i = 0; i < coll.numTracks; i++) {
                var t = coll[i], locked = false, muted = false;
                try { locked = !!t.isLocked(); } catch (e) {}
                try { muted = !!t.isMuted(); } catch (e2) {}
                out.push({ kind: kinds[k], index: i, track: t, locked: locked, muted: muted, label: label(kinds[k], i) });
            }
        }
        return out;
    }

    // Premiere reports a speed-changed clip's In/Out divided by its speed (half speed: a 30 s In reads 60 s).
    // These give the real source times.
    function speedOf(c) {
        var sp = 1;
        try { sp = Number(c.getSpeed()) || 1; } catch (e) {}
        return sp;
    }
    function srcIn(c) {
        var sp = speedOf(c);
        return sp === 1 ? tk(c.inPoint) : Math.round(tk(c.inPoint) * sp);
    }
    function srcOut(c) {
        var sp = speedOf(c);
        return sp === 1 ? tk(c.outPoint) : srcIn(c) + Math.round((tk(c.end) - tk(c.start)) * sp);
    }

    function rec(c, kind, ti, ci, full) {
        var r = { kind: kind, track: ti, index: ci, name: c.name, start: tk(c.start), end: tk(c.end) };
        r["in"] = srcIn(c);
        r.out = srcOut(c);
        try { r.nodeId = String(c.nodeId); } catch (e) {}
        try { r.disabled = !!c.disabled; } catch (e2) {}
        try { r.speed = Number(c.getSpeed()); } catch (e3) {}
        try { r.reversed = !!c.isSpeedReversed(); } catch (e4) {}
        if (full !== false) {
            try { if (c.projectItem) { r.mediaPath = c.projectItem.getMediaPath(); r.itemId = String(c.projectItem.nodeId); } } catch (e5) {}
            try { r.adjustment = !!c.isAdjustmentLayer(); } catch (e6) {}
            try { r.mgt = !!c.isMGT(); } catch (e7) {}
        }
        return r;
    }

    function clipsIn(seq, start, end, full) {
        var out = [], ts = allTracks(seq);
        for (var i = 0; i < ts.length; i++) {
            var cl = ts[i].track.clips;
            for (var c = 0; c < cl.numItems; c++) {
                var it = cl[c], s = tk(it.start), e = tk(it.end);
                if (start !== null && start !== undefined && e <= start) { continue; }
                if (end !== null && end !== undefined && s >= end) { continue; }
                out.push(rec(it, ts[i].kind, ts[i].index, c, full));
            }
        }
        return out;
    }

    // ref: { node_id } | { track: "V1", at: ticks } | { track: "V1", index: n }
    function findClip(seq, ref) {
        if (!ref) { fail("clip is required: { track: \"V1\", at: <time inside the clip> } or { node_id }."); }
        var ts = allTracks(seq), i, c, cl;
        if (has(ref, "node_id")) {
            for (i = 0; i < ts.length; i++) {
                cl = ts[i].track.clips;
                for (c = 0; c < cl.numItems; c++) {
                    if (String(cl[c].nodeId) === String(ref.node_id)) { return { clip: cl[c], kind: ts[i].kind, ti: ts[i].index, ci: c, track: ts[i].track }; }
                }
            }
            fail("No clip with node_id " + ref.node_id + " in '" + seq.name + "'. It may have been deleted or rebuilt; read the timeline again.");
        }
        var t = getTrack(seq, ref.track);
        cl = t.track.clips;
        if (has(ref, "index")) {
            if (ref.index < 0 || ref.index >= cl.numItems) { fail(label(t.kind, t.index) + " has no clip number " + (ref.index + 1) + "."); }
            return { clip: cl[ref.index], kind: t.kind, ti: t.index, ci: ref.index, track: t.track };
        }
        if (has(ref, "at")) {
            for (c = 0; c < cl.numItems; c++) {
                if (tk(cl[c].start) <= ref.at && tk(cl[c].end) > ref.at) { return { clip: cl[c], kind: t.kind, ti: t.index, ci: c, track: t.track }; }
            }
            fail("No clip on " + label(t.kind, t.index) + " at that time.");
        }
        fail("clip needs node_id, or track plus at/index.");
    }

    function frameTicks(seq) { return Number(seq.timebase); }

    // ------------------------------------------------------------------ QE (needed for razor, speed, effects, transitions)
    function qeSeqFor(seq) {
        app.enableQE();
        var q = qe.project.getActiveSequence();
        if (q) {
            var same = false;
            try { same = String(q.guid) === String(seq.sequenceID); } catch (e) {}
            if (!same) { try { same = q.name === seq.name && project().activeSequence && String(project().activeSequence.sequenceID) === String(seq.sequenceID); } catch (e2) {} }
            if (same) { return q; }
        }
        fail("This edit needs '" + seq.name + "' to be the active sequence in the Timeline. Open it (premiere_open_sequence) and try again.");
    }

    function qeTC(seq, ticks) {
        var t = mkTime(Number(ticks) + Number(seq.zeroPoint || 0));
        return t.getFormatted(seq.getSettings().videoFrameRate, seq.videoDisplayFormat);
    }

    // A duration (not a position) in the sequence's timecode format.
    function durTC(seq, ticks) {
        return mkTime(Number(ticks)).getFormatted(seq.getSettings().videoFrameRate, seq.videoDisplayFormat);
    }

    function qeTrack(seq, kind, ti) {
        var q = qeSeqFor(seq);
        return kind === "audio" ? q.getAudioTrackAt(ti) : q.getVideoTrackAt(ti);
    }

    function qeItemFor(seq, kind, ti, clip) {
        var qt = qeTrack(seq, kind, ti);
        var st = tk(clip.start), ft = frameTicks(seq);
        for (var i = 0; i < qt.numItems; i++) {
            var it = qt.getItemAt(i);
            if (!it) { continue; }
            var ty = "";
            try { ty = String(it.type); } catch (e) {}
            if (ty === "Empty") { continue; }
            var s = tk(it.start);
            if (s !== null && absf(s - st) < ft / 2) { return it; }
        }
        fail("Couldn't find '" + clip.name + "' in Premiere's QE layer (needed for this edit).");
    }

    // Premiere keeps each track's clips in a list. A scripted trackItem.move() past another clip leaves that
    // list out of time order, and from then on QE razor fails on most of the track (seen on Premiere 27).
    function trackInOrder(track) {
        var cl = track.clips, last = -1;
        for (var i = 0; i < cl.numItems; i++) {
            var s = tk(cl[i].start);
            if (s < last) { return false; }
            last = s;
        }
        return true;
    }

    function razorTrack(seq, kind, ti, ticks) {
        var cl = trackColl(seq, kind)[ti].clips;
        for (var c = 0; c < cl.numItems; c++) {
            var s = tk(cl[c].start), e = tk(cl[c].end);
            if (s < ticks && e > ticks) {
                var qt = qeTrack(seq, kind, ti);
                qt.razor(qeTC(seq, ticks), true, true);
                // check
                var cl2 = trackColl(seq, kind)[ti].clips, cut = false;
                for (var k = 0; k < cl2.numItems; k++) { if (tk(cl2[k].start) === ticks) { cut = true; } }
                if (!cut) {
                    var why = trackInOrder(trackColl(seq, kind)[ti]) ? "" : " This track's clips are out of order inside Premiere (a clip was moved past another by script), which stops scripted cuts on it; make the cut by hand, or work on a snapshot.";
                    fail("Razor at " + qeTC(seq, ticks) + " on " + label(kind, ti) + " didn't cut the clip." + why);
                }
                did("cut " + label(kind, ti) + " at " + qeTC(seq, ticks));
                return true;
            }
        }
        return false;
    }

    // Which track (kind, index) a DOM track item sits on.
    function trackOfClip(seq, c) {
        var id = String(c.nodeId), kinds = ["video", "audio"];
        for (var k = 0; k < kinds.length; k++) {
            var coll = trackColl(seq, kinds[k]);
            for (var i = 0; i < coll.numTracks; i++) {
                var cl = coll[i].clips;
                for (var j = 0; j < cl.numItems; j++) { if (String(cl[j].nodeId) === id) { return { kind: kinds[k], index: i }; } }
            }
        }
        return null;
    }

    // QE move: QE trackItem.move("<signed duration TC>", ...) shifts the clip by that much and keeps Premiere's
    // clip list in time order (tested on Premiere 27). It overwrites whatever is at the destination, so callers only
    // move into free space, and it deletes the clip's transitions (put back by carryTransitions). Returns true when
    // the clip landed exactly; false when QE can't do it here (sequence not active, item not found, delta not a whole
    // frame).
    function qeMoveBy(seq, c, delta) {
        var ft = frameTicks(seq);
        if (!ft || absf(delta % ft) > 1) { return false; }
        var q = null;
        try { q = qeSeqFor(seq); } catch (e) { return false; }
        var where = trackOfClip(seq, c);
        if (!where) { return false; }
        var qt = where.kind === "audio" ? q.getAudioTrackAt(where.index) : q.getVideoTrackAt(where.index);
        var st = tk(c.start), it = null;
        for (var i = 0; i < qt.numItems; i++) {
            var x = qt.getItemAt(i);
            if (!x) { continue; }
            var ty = "";
            try { ty = String(x.type); } catch (e1) {}
            if (ty === "Empty") { continue; }
            if (absf(tk(x.start) - st) < ft / 2) { it = x; break; }
        }
        if (!it) { return false; }
        var tc = (delta < 0 ? "-" : "") + durTC(seq, absf(delta));
        try { it.move(tc, false, false, false, false, false, false); } catch (e2) { return false; }
        return absf(tk(c.start) - (st + delta)) < 2;
    }

    // Would moving c by delta take it past another clip on its track?
    function passesAnother(seq, c, delta) {
        var where = trackOfClip(seq, c);
        if (!where) { return false; }
        var cl = trackColl(seq, where.kind)[where.index].clips, before = tk(c.start);
        var lo = Math.min(before, before + delta), hi = Math.max(before, before + delta);
        for (var p = 0; p < cl.numItems; p++) {
            var ps = tk(cl[p].start);
            if (String(cl[p].nodeId) !== String(c.nodeId) && ps > lo && ps < hi) { return true; }
        }
        return false;
    }

    // Move a track item by delta ticks; verified. A clip that passes no other clip moves with the DOM move (its
    // transitions stay as they are and are moved after it by carryTransitions). One that must pass another clip
    // moves with QE: the DOM move would leave Premiere's clip list out of time order (see trackInOrder).
    function moveBy(seq, c, delta) {
        if (!delta) { return; }
        var before = tk(c.start);
        if (passesAnother(seq, c, delta)) {
            if (qeMoveBy(seq, c, delta)) { return; }
            if (tk(c.start) !== before) { fail("Moving '" + c.name + "' landed at " + qeTC(seq, tk(c.start)) + " instead of " + qeTC(seq, before + delta) + "."); }
            fail("Moving '" + c.name + "' past another clip needs Premiere's own move, which needs '" + seq.name + "' open as the active sequence. Open it (premiere_open_sequence) and try again.");
        }
        var forms = V.moveForm ? [V.moveForm] : ["time", "seconds"];
        var last = "";
        for (var i = 0; i < forms.length; i++) {
            try {
                if (forms[i] === "time") { c.move(mkTime(delta)); } else { c.move(delta / TPS); }
            } catch (e) { last = e.message; continue; }
            var now = tk(c.start);
            if (absf(now - (before + delta)) < 2) { V.moveForm = forms[i]; return; }
            if (now !== before) {
                // moved by a different amount: put it where it should be with the seconds form (known to take seconds)
                try { c.move((before + delta - now) / TPS); } catch (e2) {}
                now = tk(c.start);
                if (absf(now - (before + delta)) < 2) { V.moveForm = "seconds"; return; }
                fail("Moving '" + c.name + "' landed at " + qeTC(seq, now) + " instead of " + qeTC(seq, before + delta) + ".");
            }
            last = "it didn't move";
        }
        fail("Couldn't move '" + c.name + "' (" + last + ").");
    }

    // ------------------------------------------------------------------ transitions ride along with moves
    // Transitions don't follow scripted moves (Premiere 27): a DOM clip move leaves them where the clip was (an
    // orphaned audio transition can silence the rest of the track), and a QE move deletes them. So every edit that
    // moves clips records each transition with the cut it sits on and which side of it ("in": on the clip after the
    // cut, "out": on the clip before it, "both": across it), then puts it back on that cut afterwards: moved by the
    // same amount, removed when its side of the cut was cut away, or added again when a QE move deleted it.
    function newTLog() { return { moved: 0, removed: [], readded: [], failed: [] }; }
    function tlog() { if (!V.tlog) { V.tlog = newTLog(); } return V.tlog; }
    function transDesc(seq, r) { return { track: label(r.kind, r.ti), name: r.name, start: r.start, end: r.end }; }

    function qeAlignments(seq, kind, ti) {
        var out = {};
        try {
            var qt = qeTrack(seq, kind, ti);
            for (var i = 0; i < qt.numTransitions; i++) {
                var t = qt.getTransitionAt(i), ty = "";
                if (!t) { continue; }
                try { ty = String(t.type); } catch (e0) {}
                if (ty === "Empty") { continue; }
                try { out[tk(t.start) + ":" + tk(t.end)] = Number(t.alignment); } catch (e1) {}
            }
        } catch (e) {}
        return out;
    }

    // Is the transition [s, e] on a real clip edge? It needs a cut under it with clip content on the side(s) it
    // covers: "in" (after the cut) needs a clip starting there, "out" one ending there, "both" one of each. Returns
    // { edge, side } or null (an orphan).
    function transEdge(cl, s, e, tol) {
        var starts = [], ends = [], c, best = null, out = null;
        for (c = 0; c < cl.numItems; c++) { starts.push(tk(cl[c].start)); ends.push(tk(cl[c].end)); }
        function near(list, E) { for (var q = 0; q < list.length; q++) { if (absf(list[q] - E) < tol) { return true; } } return false; }
        var cands = starts.concat(ends);
        for (c = 0; c < cands.length; c++) {
            var E = cands[c];
            if (E < s - tol || E > e + tol) { continue; }
            var side = s >= E - tol ? "in" : (e <= E + tol ? "out" : "both");
            var ok = side === "in" ? near(starts, E) : (side === "out" ? near(ends, E) : (near(starts, E) && near(ends, E)));
            if (!ok) { continue; }
            var score = Math.min(absf(E - s), absf(E - e), absf(E - (s + e) / 2));
            if (best === null || score < best) { best = score; out = { edge: E, side: side }; }
        }
        return out;
    }

    function transRecords(seq, tracks) {
        var out = [], tol = frameTicks(seq) / 2;
        for (var i = 0; i < tracks.length; i++) {
            var t = tracks[i], trs = null;
            try { trs = t.track.transitions; } catch (e) {}
            if (!trs || !trs.numItems) { continue; }
            var cl = t.track.clips, al = null;
            for (var k = 0; k < trs.numItems; k++) {
                var x = trs[k], s = tk(x.start), e = tk(x.end), at = transEdge(cl, s, e, tol);
                if (!at) { continue; } // already an orphan: not ours to move (read_timeline flags it)
                if (al === null) { al = qeAlignments(seq, t.kind, t.index); }
                out.push({ kind: t.kind, ti: t.index, nodeId: String(x.nodeId), name: x.name, start: s, end: e, edge: at.edge, side: at.side, alignment: has(al, s + ":" + e) ? al[s + ":" + e] : null });
            }
        }
        return out;
    }

    function findTransition(seq, kind, ti, nodeId) {
        var trs = null;
        try { trs = trackColl(seq, kind)[ti].transitions; } catch (e) { return null; }
        for (var k = 0; k < trs.numItems; k++) { if (String(trs[k].nodeId) === nodeId) { return trs[k]; } }
        return null;
    }

    function moveTransition(seq, x, delta) {
        var before = tk(x.start), forms = ["time", "seconds"];
        for (var i = 0; i < forms.length; i++) {
            try {
                if (forms[i] === "time") { x.move(mkTime(delta)); } else { x.move(delta / TPS); }
            } catch (e) { continue; }
            var now = tk(x.start);
            if (absf(now - (before + delta)) < 2) { return true; }
            if (now !== before) { try { x.move((before + delta - now) / TPS); } catch (e2) {} return absf(tk(x.start) - (before + delta)) < 2; }
        }
        return false;
    }

    // Remove one transition: DOM remove first, QE remove as the fallback. True when it's gone.
    function dropTransition(seq, r) {
        var x = findTransition(seq, r.kind, r.ti, r.nodeId);
        if (!x) { return true; }
        try { x.remove(false, false); } catch (e) {}
        if (!findTransition(seq, r.kind, r.ti, r.nodeId)) { return true; }
        try { removeTransitionsIn(seq, r.kind, r.ti, tk(x.start), tk(x.end)); } catch (e2) {}
        return !findTransition(seq, r.kind, r.ti, r.nodeId);
    }

    // Add a transition again (a QE move deleted it) on the cut at nE, as it was: same name, length, side, alignment.
    function readdTransition(seq, r, nE) {
        var trk = trackColl(seq, r.kind)[r.ti], cl = trk.clips, ft = frameTicks(seq), clip = null, atStart = r.side !== "out";
        for (var i = 0; i < cl.numItems && !clip; i++) {
            if (atStart && absf(tk(cl[i].start) - nE) < ft / 2) { clip = cl[i]; }
            if (!atStart && absf(tk(cl[i].end) - nE) < ft / 2) { clip = cl[i]; }
        }
        if (!clip) { return false; }
        var fx = null;
        try { fx = r.kind === "audio" ? qe.project.getAudioTransitionByName(r.name) : qe.project.getVideoTransitionByName(r.name); } catch (e) {}
        if (!fx) { return false; }
        var al = r.alignment !== null ? r.alignment : (r.side === "in" ? 0 : (r.side === "out" ? 1 : 0.5));
        var want = r.start + (nE - r.edge), before = transList(trk);
        try {
            qeItemFor(seq, r.kind, r.ti, clip).addTransition(fx, atStart, durTC(seq, r.end - r.start), durTC(seq, 0), al, r.side !== "both", true);
        } catch (e2) { return false; }
        var after = transList(trackColl(seq, r.kind)[r.ti]);
        for (var k = 0; k < after.length; k++) {
            var seen = false;
            for (var b = 0; b < before.length; b++) { if (before[b].start === after[k].start && before[b].end === after[k].end) { seen = true; } }
            if (seen) { continue; }
            if (absf(after[k].start - want) < ft / 2 && absf((after[k].end - after[k].start) - (r.end - r.start)) < ft / 2) { return true; }
            removeTransitionsIn(seq, r.kind, r.ti, after[k].start, after[k].end); // landed wrong: take it off again
        }
        return false;
    }

    // Put every recorded transition back on its cut. mapIn(t) / mapOut(t): where the content just after / just
    // before time t ends up (null: it was cut away).
    function carryTransitions(seq, recs, mapIn, mapOut) {
        var L = tlog();
        for (var i = 0; i < recs.length; i++) {
            var r = recs[i], nIn = mapIn(r.edge), nOut = mapOut(r.edge), nE;
            if (r.side === "in") { nE = nIn; } else if (r.side === "out") { nE = nOut; } else { nE = (nIn !== null && nOut !== null && absf(nIn - nOut) < 2) ? nIn : null; }
            if (nE === null) {
                if (dropTransition(seq, r)) { L.removed.push(transDesc(seq, r)); } else { L.failed.push(transDesc(seq, r)); }
                continue;
            }
            var d = nE - r.edge, x = findTransition(seq, r.kind, r.ti, r.nodeId);
            if (x) {
                var cur = tk(x.start);
                if (absf(cur - (r.start + d)) < 2) { if (d) { L.moved++; } continue; }
                if (moveTransition(seq, x, r.start + d - cur)) { L.moved++; } else { L.failed.push(transDesc(seq, r)); }
                continue;
            }
            if (readdTransition(seq, r, nE)) { L.readded.push(transDesc(seq, r)); } else { L.failed.push(transDesc(seq, r)); }
        }
    }

    // Remove the transitions on content in (A, Z) that an edit cut away (before the clips after it close the gap,
    // which would otherwise slide under them).
    function dropTransitionsIn(seq, tracks, A, Z) {
        var tol = frameTicks(seq) / 2, L = tlog();
        for (var i = 0; i < tracks.length; i++) {
            var trs = null;
            try { trs = tracks[i].track.transitions; } catch (e) {}
            if (!trs || !trs.numItems) { continue; }
            var list = [];
            for (var k = 0; k < trs.numItems; k++) {
                var s = tk(trs[k].start), e = tk(trs[k].end);
                if (s < Z - tol && e > A + tol) { list.push({ kind: tracks[i].kind, ti: tracks[i].index, nodeId: String(trs[k].nodeId), name: trs[k].name, start: s, end: e }); }
            }
            for (var j = 0; j < list.length; j++) {
                if (dropTransition(seq, list[j])) { L.removed.push(transDesc(seq, list[j])); } else { L.failed.push(transDesc(seq, list[j])); }
            }
        }
    }

    // Shift every clip starting at/after `from` on the given tracks by delta. Linked partners that already
    // moved along are not moved twice.
    function shiftAfter(seq, tracks, from, delta, noCarry) {
        var recs = noCarry ? [] : transRecords(seq, tracks);
        var items = [];
        for (var i = 0; i < tracks.length; i++) {
            var cl = tracks[i].track.clips;
            for (var c = 0; c < cl.numItems; c++) {
                var s = tk(cl[c].start);
                if (s >= from) { items.push({ clip: cl[c], target: s + delta, nodeId: String(cl[c].nodeId), kind: tracks[i].kind, ti: tracks[i].index }); }
            }
        }
        items.sort(function (x, y) { return delta < 0 ? (x.target - y.target) : (y.target - x.target); });
        var moved = 0;
        for (var j = 0; j < items.length; j++) {
            var it = items[j], now = tk(it.clip.start);
            if (absf(now - it.target) < 2) { continue; }
            moveBy(seq, it.clip, it.target - now);
            moved++;
        }
        if (moved) { did("shifted " + items.length + " clips " + (delta < 0 ? "left" : "right") + " by " + secs(absf(delta)) + "s"); }
        if (!noCarry) { carryTransitions(seq, recs, function (t) { return t >= from ? t + delta : t; }, function (t) { return t > from ? t + delta : t; }); }
        return items.length;
    }

    function shiftMarkers(seq, from, delta, mode) {
        if (mode === "keep") { return 0; }
        var ms = seq.markers, list = [], m = ms.getFirstMarker();
        while (m) { list.push(m); m = ms.getNextMarker(m); }
        var n = 0;
        for (var i = 0; i < list.length; i++) {
            var mk = list[i], s = tk(mk.start), e = tk(mk.end);
            if (s < from) { continue; }
            moveMarker(mk, s + delta, e + delta);
            n++;
        }
        if (n) { did("shifted " + n + " markers"); }
        return n;
    }

    // Marker start/end take seconds (numbers). Set the far side first so start never passes end.
    function moveMarker(mk, s, e) {
        if (s > tk(mk.start)) { mk.end = e / TPS; mk.start = s / TPS; }
        else { mk.start = s / TPS; mk.end = e / TPS; }
        if (absf(tk(mk.start) - s) > TPS / 1000) { fail("Marker '" + mk.name + "' didn't move (Premiere kept it at " + secs(tk(mk.start)) + "s)."); }
    }

    function lockedConflict(tracks, after) {
        var bad = [];
        for (var i = 0; i < tracks.length; i++) {
            if (!tracks[i].locked) { continue; }
            var cl = tracks[i].track.clips;
            for (var c = 0; c < cl.numItems; c++) { if (tk(cl[c].end) > after) { bad.push(tracks[i].label); break; } }
        }
        return bad;
    }

    function unlocked(tracks) {
        var out = [];
        for (var i = 0; i < tracks.length; i++) { if (!tracks[i].locked) { out.push(tracks[i]); } }
        return out;
    }

    function pickTracks(seq, which) {
        var ts = allTracks(seq);
        if (!which || which === "all") { return ts; }
        var out = [];
        for (var i = 0; i < which.length; i++) {
            var p = parseTrack(which[i]);
            for (var j = 0; j < ts.length; j++) { if (ts[j].kind === p.kind && ts[j].index === p.index) { out.push(ts[j]); } }
        }
        return out;
    }

    // ------------------------------------------------------------------ snapshots / clones
    function cloneSeq(seq, newName, binName) {
        var before = seqIds();
        var active = project().activeSequence ? String(project().activeSequence.sequenceID) : null;
        if (!seq.clone()) { fail("Premiere wouldn't copy '" + seq.name + "'."); }
        var p = project(), copy = null;
        for (var i = 0; i < p.sequences.numSequences; i++) {
            if (!before[String(p.sequences[i].sequenceID)]) { copy = p.sequences[i]; }
        }
        if (!copy) { fail("Premiere said it copied '" + seq.name + "' but the copy isn't in the project."); }
        copy.name = newName;
        if (binName) { try { copy.projectItem.moveBin(getBin(binName, true)); } catch (e) {} }
        if (active && project().activeSequence && String(project().activeSequence.sequenceID) !== active) {
            try { project().openSequence(active); } catch (e2) {}
        }
        return copy;
    }

    function hhmmss() {
        var d = new Date();
        function p(n) { return n < 10 ? "0" + n : String(n); }
        return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    }

    function snapshot(seq, what) {
        var copy = cloneSeq(seq, seq.name + " - before " + what + " " + hhmmss(), BIN_SNAP);
        did("saved a copy of the sequence: \"" + copy.name + "\"");
        return { id: String(copy.sequenceID), name: copy.name };
    }

    // The caller read the timeline earlier; refuse if that part changed since (checked in the same call as the edit).
    function checkExpect(seq, ex) {
        if (!ex || !ex.clips) { return; }
        if (ex.sequence && String(ex.sequence) !== String(seq.sequenceID)) { fail("expect_layout was read from a different sequence."); }
        var now = clipsIn(seq, ex.start, ex.end, false), byId = {}, seen = {}, diffs = [], i;
        for (i = 0; i < now.length; i++) { byId[now[i].nodeId] = now[i]; }
        function nm(c) { return label(c.kind, c.track) + " '" + c.name + "'"; }
        for (i = 0; i < ex.clips.length; i++) {
            var o = ex.clips[i], n = byId[o.nodeId];
            seen[o.nodeId] = true;
            if (!n) { diffs.push(nm(o) + " at " + secs(o.start) + "s was removed or replaced"); continue; }
            if (n.kind !== o.kind || n.track !== o.track) { diffs.push(nm(o) + " moved to " + label(n.kind, n.track)); }
            if (n.start !== o.start || n.end !== o.end) { diffs.push(nm(o) + " moved or was trimmed (" + secs(o.start) + "-" + secs(o.end) + "s is now " + secs(n.start) + "-" + secs(n.end) + "s)"); }
            else if (n["in"] !== o["in"] || n.out !== o.out) { diffs.push(nm(o) + " was slipped"); }
            if (!!n.disabled !== !!o.disabled) { diffs.push(nm(o) + " was " + (n.disabled ? "disabled" : "enabled")); }
        }
        for (i = 0; i < now.length; i++) { if (!seen[now[i].nodeId]) { diffs.push("new clip " + nm(now[i]) + " at " + secs(now[i].start) + "s"); } }
        if (diffs.length) {
            fail("The timeline changed in that area since it was read, so nothing was done:\n- " + diffs.slice(0, 8).join("\n- ") + (diffs.length > 8 ? "\n- and " + (diffs.length - 8) + " more" : "") + "\nRead it again (premiere_read_timeline) and redo the edit.");
        }
    }

    // Run an edit: check the layout, snapshot the sequence, then edit.
    function edit(a, seq, what, fn) {
        checkExpect(seq, a.expect);
        var snap = null;
        if (a.snapshot !== false) { snap = snapshot(seq, what); }
        V.tlog = newTLog();
        try {
            var r = guarded(a, fn);
            if (snap) { r.snapshot = snap; }
            var L = V.tlog;
            if (L.moved || L.removed.length || L.readded.length || L.failed.length) { r.transitions = L; }
            return r;
        } catch (e) {
            if (snap) { e.snapshot = snap.name; }
            throw e;
        } finally {
            V.tlog = null;
        }
    }

    // ================================================================== registered helpers

    F.v2_ping = function () {
        return { version: V.version, build: V.build, app: app.version, project: app.project ? app.project.name : null };
    };

    function seqInfo(seq) {
        var info = {
            id: String(seq.sequenceID), name: seq.name, timebase: String(seq.timebase), zeroPoint: String(seq.zeroPoint || "0"),
            displayFormat: seq.videoDisplayFormat, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical, end: tk(seq.end)
        };
        try { info.sampleTC = qeTC(seq, Number(seq.timebase) * 3600); info.dropFrame = info.sampleTC.indexOf(";") >= 0; } catch (e) { info.dropFrame = false; }
        try { info.active = !!(project().activeSequence && String(project().activeSequence.sequenceID) === info.id); } catch (e2) {}
        try { info.playhead = tk(seq.getPlayerPosition()); } catch (e3) {}
        try { info.inPoint = tk(seq.getInPointAsTime()); info.outPoint = tk(seq.getOutPointAsTime()); } catch (e4) {}
        try { info.workIn = tk(seq.getWorkAreaInPointAsTime()); info.workOut = tk(seq.getWorkAreaOutPointAsTime()); info.workAreaEnabled = !!seq.isWorkAreaEnabled(); } catch (e5) {}
        try { var st = seq.getSettings(); info.audioSampleRate = tk(st.audioSampleRate); info.maxRenderQuality = st.maximumRenderQuality; info.maxBitDepth = st.maximumBitDepth; } catch (e6) {}
        info.videoTracks = seq.videoTracks.numTracks;
        info.audioTracks = seq.audioTracks.numTracks;
        return info;
    }

    F.v2_info = function (a) {
        var p = project();
        var info = { app: app.version, project: p.name, projectPath: p.path, proxiesEnabled: null, openProjects: [] };
        try { info.proxiesEnabled = !!app.getEnableProxies(); } catch (e) {}
        try { for (var i = 0; i < app.projects.numProjects; i++) { info.openProjects.push({ name: app.projects[i].name, path: app.projects[i].path }); } } catch (e2) {}
        try { info.activeSequence = p.activeSequence ? seqInfo(p.activeSequence) : null; } catch (e3) {}
        if (a && a.sequence_id) { info.sequence = seqInfo(getSeq(a.sequence_id)); }
        return info;
    };

    F.v2_seq_info = function (a) { return seqInfo(getSeq(a.sequence_id)); };

    F.v2_timeline = function (a) {
        var seq = getSeq(a.sequence_id);
        var info = seqInfo(seq);
        var start = has(a, "start") ? a.start : null, end = has(a, "end") ? a.end : null;
        var ts = allTracks(seq);
        info.tracks = [];
        for (var i = 0; i < ts.length; i++) {
            var tr = { label: ts[i].label, kind: ts[i].kind, index: ts[i].index, name: ts[i].track.name, muted: ts[i].muted, locked: ts[i].locked, clips: [] };
            try { tr.targeted = !!ts[i].track.isTargeted(); } catch (e) {}
            if (!trackInOrder(ts[i].track)) { tr.outOfOrder = true; }
            var cl = ts[i].track.clips;
            for (var c = 0; c < cl.numItems; c++) {
                var s = tk(cl[c].start), e = tk(cl[c].end);
                if (start !== null && e <= start) { continue; }
                if (end !== null && s >= end) { continue; }
                tr.clips.push(rec(cl[c], ts[i].kind, ts[i].index, c, a.full !== false));
            }
            try {
                var trs = ts[i].track.transitions;
                if (trs && trs.numItems) {
                    tr.transitions = [];
                    // a transition with no clip edge under it was left behind by a scripted move: an orphaned audio
                    // transition can silence the rest of the track
                    var ctl = ts[i].track.clips, tol = frameTicks(seq) / 2;
                    for (var x = 0; x < trs.numItems; x++) {
                        var xs = tk(trs[x].start), xe = tk(trs[x].end);
                        var tro = { name: trs[x].name, start: xs, end: xe };
                        if (!transEdge(ctl, xs, xe, tol)) { tro.orphan = true; tr.orphanTransitions = (tr.orphanTransitions || 0) + 1; }
                        tr.transitions.push(tro);
                    }
                }
            } catch (e7) {}
            info.tracks.push(tr);
        }
        info.markers = [];
        var m = seq.markers.getFirstMarker();
        while (m) {
            var ms = tk(m.start), me = tk(m.end);
            if ((start === null || me >= start) && (end === null || ms <= end)) {
                var mr = { name: m.name, comment: m.comments, start: ms, end: me };
                try { mr.color = m.getColorByIndex(0); } catch (e8) {}
                try { mr.guid = String(m.guid); } catch (e9) {}
                info.markers.push(mr);
            }
            m = seq.markers.getNextMarker(m);
        }
        return info;
    };

    F.v2_layout = function (a) {
        var seq = getSeq(a.sequence_id);
        return { id: String(seq.sequenceID), clips: clipsIn(seq, a.start, a.end, false), tracks: seq.videoTracks.numTracks + "/" + seq.audioTracks.numTracks };
    };

    // ------------------------------------------------------------------ rendering
    // In/Out by script on Premiere 27: setInPoint/setOutPoint take seconds or a Time (kept exactly, not snapped).
    // "No In/Out" reads back as -400000 s and is restored by setting -400000 s. The work area can't be set by
    // script on Premiere 27 (the setters do nothing), so renders use In/Out and put it back afterwards.
    var UNSET = -101606400000000000;
    function getInOut(seq) { return { inT: tk(seq.getInPointAsTime()), outT: tk(seq.getOutPointAsTime()) }; }
    function putPoint(seq, which, t) {
        var setter = which === "in" ? function (v) { seq.setInPoint(v); } : function (v) { seq.setOutPoint(v); };
        var getter = which === "in" ? function () { return tk(seq.getInPointAsTime()); } : function () { return tk(seq.getOutPointAsTime()); };
        if (t <= UNSET / 2) { setter(-400000); return getter() <= UNSET / 2; }
        try { setter(mkTime(t)); } catch (e) {}
        if (absf(getter() - t) <= 1) { return true; }
        try { setter(t / TPS); } catch (e2) {}
        return absf(getter() - t) <= frameTicks(seq) / 100;
    }
    function setInOut(seq, inT, outT) {
        var cur = getInOut(seq), good;
        // never let In pass Out while moving them
        if (cur.outT > UNSET / 2 && inT >= cur.outT) { good = putPoint(seq, "out", outT) && putPoint(seq, "in", inT); }
        else { good = putPoint(seq, "in", inT) && putPoint(seq, "out", outT); }
        var now = getInOut(seq);
        if (!good) { fail("Couldn't set In/Out to " + (inT > UNSET / 2 ? qeTC(seq, inT) : "none") + " - " + (outT > UNSET / 2 ? qeTC(seq, outT) : "none") + " (read back " + now.inT + " / " + now.outT + ")."); }
        return { "in": now.inT, out: now.outT };
    }

    function mediaReport(seq, start, end, proxiesOff) {
        var out = [], seen = {};
        var cl = clipsIn(seq, start, end, true);
        for (var i = 0; i < cl.length; i++) {
            var c = cl[i];
            if (c.disabled || !c.mediaPath) { continue; }
            var key = c.mediaPath + "|" + c.kind;
            if (seen[key]) { continue; }
            seen[key] = true;
            var r = { track: label(c.kind, c.track), clip: c.name, media: c.mediaPath, proxy: null, renderedFrom: "original" };
            try {
                var pi = itemByNodeId(c.itemId);
                if (pi && pi.hasProxy()) { r.proxy = pi.getProxyPath(); r.renderedFrom = proxiesOff ? "original" : "proxy (proxies were on)"; }
            } catch (e) {}
            out.push(r);
        }
        return out;
    }

    // Render [in, out] of a sequence with a preset, at full quality, then put every setting back.
    F.v2_render_range = function (a) {
        var seq = getSeq(a.sequence_id);
        var saved = { proxies: null, mutes: [], range: null };
        var notes = [], result = null, set = null;
        try {
            if (a.use_proxies !== true) {
                try {
                    saved.proxies = app.getEnableProxies();
                    if (saved.proxies) { app.setEnableProxies(false); did("proxies switched off for the render"); }
                } catch (e) { notes.push("couldn't switch proxies off: " + e.message); }
            }
            var mutes = a.mute_tracks || [];
            for (var i = 0; i < mutes.length; i++) {
                var t = getTrack(seq, mutes[i]);
                if (!t.track.isMuted()) { t.track.setMute(1); saved.mutes.push(t.track); did("muted " + label(t.kind, t.index)); }
            }
            saved.range = getInOut(seq);
            set = setInOut(seq, a["in"], a.out);
            var res = seq.exportAsMediaDirect(a.path, a.preset, 1);
            result = { path: a.path, exportResult: String(res), range: set, method: "In/Out (restored after)" };
        } finally {
            var restoreErr = [];
            if (saved.range) {
                try { setInOut(seq, saved.range.inT, saved.range.outT); } catch (e4) { restoreErr.push(e4.message); }
            }
            for (var m = 0; m < saved.mutes.length; m++) { try { saved.mutes[m].setMute(0); } catch (e6) { restoreErr.push("unmute: " + e6.message); } }
            if (saved.proxies) { try { app.setEnableProxies(true); } catch (e7) { restoreErr.push("proxies back on: " + e7.message); } }
            if (restoreErr.length) { notes.push("NOT RESTORED: " + restoreErr.join("; ")); }
        }
        result.media = mediaReport(seq, a["in"], a.out, !!saved.proxies || a.use_proxies !== true);
        result.proxiesWereOn = !!saved.proxies;
        result.notes = notes;
        return result;
    };

    // Queue a range in Adobe Media Encoder (doesn't block Premiere). The range is restored right after queueing.
    F.v2_queue_ame = function (a) {
        var seq = getSeq(a.sequence_id);
        var saved = getInOut(seq), job;
        try {
            if (has(a, "in")) { setInOut(seq, a["in"], a.out); }
            app.encoder.launchEncoder();
            job = app.encoder.encodeSequence(seq, a.path, a.preset, has(a, "in") ? 1 : 0, true);
            app.encoder.startBatch();
        } finally {
            if (has(a, "in")) { try { setInOut(seq, saved.inT, saved.outT); } catch (e2) {} }
        }
        return { queued: true, jobId: String(job), path: a.path };
    };

    // A clip's source at native size with its effects: build a temp sequence from the clip's media.
    F.v2_source_prepare = function (a) {
        var seq = getSeq(a.sequence_id);
        var f = findClip(seq, a.clip);
        var pi = f.clip.projectItem;
        if (!pi) { fail("That clip has no source media (is it a graphic or a nested sequence?)."); }
        var active = project().activeSequence ? String(project().activeSequence.sequenceID) : null;
        var marks = { inT: null, outT: null };
        try { marks.inT = tk(pi.getInPoint(MEDIA_ALL)); marks.outT = tk(pi.getOutPoint(MEDIA_ALL)); } catch (e) {}
        try { pi.clearInPoint(); pi.clearOutPoint(); } catch (e2) {}
        var tmp = null;
        try {
            tmp = project().createNewSequenceFromClips("Claude temp render " + hhmmss(), [pi], getBin(BIN_TEMP, true));
        } finally {
            try { if (marks.inT !== null) { pi.setInPoint(tstr(marks.inT), MEDIA_ALL); } if (marks.outT !== null) { pi.setOutPoint(tstr(marks.outT), MEDIA_ALL); } } catch (e3) {}
        }
        if (!tmp) { fail("Premiere didn't create the temp sequence."); }
        did("made temp sequence \"" + tmp.name + "\"");
        var tclip = null;
        if (f.kind === "video" && tmp.videoTracks.numTracks && tmp.videoTracks[0].clips.numItems) { tclip = { clip: tmp.videoTracks[0].clips[0], kind: "video", ti: 0 }; }
        else if (tmp.audioTracks.numTracks && tmp.audioTracks[0].clips.numItems) { tclip = { clip: tmp.audioTracks[0].clips[0], kind: "audio", ti: 0 }; }
        if (!tclip) { fail("The temp sequence came out empty."); }
        var copied = null;
        if (a.copy_effects !== false) {
            copied = copyEffects(seq, f, tmp, tclip, { skip_intrinsic: a.copy_motion !== true, only: a.effects || null, needQE: false });
        }
        if (active) { try { if (!project().activeSequence || String(project().activeSequence.sequenceID) !== active) { project().openSequence(active); } } catch (e4) {} }
        return {
            temp_id: String(tmp.sequenceID), temp_name: tmp.name, timebase: String(tmp.timebase), width: tmp.frameSizeHorizontal, height: tmp.frameSizeVertical,
            clip_start: tk(tclip.clip.start), clip_in: tk(tclip.clip.inPoint), clip_end: tk(tclip.clip.end),
            source: { "in": srcIn(f.clip), out: srcOut(f.clip), start: tk(f.clip.start), end: tk(f.clip.end), speed: speedOf(f.clip), media: pi.getMediaPath() },
            effects: copied, active: active
        };
    };

    F.v2_source_cleanup = function (a) {
        var tmp = seqById(a.temp_id), removed = false;
        if (tmp) { removed = !!project().deleteSequence(tmp); }
        var bin = getBin(BIN_TEMP, false);
        if (bin && bin.children.numItems === 0) { try { bin.deleteBin(); } catch (e) {} }
        if (a.active) { try { if (!project().activeSequence || String(project().activeSequence.sequenceID) !== String(a.active)) { project().openSequence(a.active); } } catch (e2) {} }
        return { removed: removed };
    };

    // ------------------------------------------------------------------ snapshots
    F.v2_snapshot = function (a) {
        var seq = getSeq(a.sequence_id);
        return snapshot(seq, a.label || "Claude edit");
    };

    F.v2_clone = function (a) {
        var seq = getSeq(a.sequence_id);
        var copy = cloneSeq(seq, a.name || (seq.name + " copy"), a.bin || null);
        return { id: String(copy.sequenceID), name: copy.name };
    };

    // Add one empty audio track at the end of a sequence (opens it: QE works on the active sequence only).
    // QE addTracks(video, videoAfter, audio, audioType, audioAfter, submix, submixType, submixAfter), checked.
    F.v2_add_audio_track = function (a) {
        var seq = getSeq(a.sequence_id);
        project().openSequence(String(seq.sequenceID));
        var q = qeSeqFor(seq);
        var n = seq.audioTracks.numTracks;
        try { q.addTracks(0, 0, 1, 1, n, 0, 0, 0); } catch (e) { fail("Couldn't add an audio track to '" + seq.name + "' (" + e.message + ")."); }
        if (seq.audioTracks.numTracks !== n + 1) { fail("Couldn't add an audio track to '" + seq.name + "'."); }
        did("added " + label("audio", n));
        return { index: n, track: label("audio", n) };
    };

    // ------------------------------------------------------------------ ripple edits
    F.v2_ripple_delete = function (a) {
        var seq = getSeq(a.sequence_id);
        var A = a.start, Z = a.end, d = Z - A;
        if (!(d > 0)) { fail("end must be after start."); }
        var ts = allTracks(seq);
        var bad = lockedConflict(ts, A);
        if (bad.length && !a.ignore_locked) { fail("Locked track(s) " + bad.join(", ") + " have clips after the cut; rippling would pull them out of sync. Unlock them or pass ignore_locked: true."); }
        return edit(a, seq, "ripple delete", function () {
            var tr = unlocked(ts), i, c;
            for (i = 0; i < tr.length; i++) { razorTrack(seq, tr[i].kind, tr[i].index, A); razorTrack(seq, tr[i].kind, tr[i].index, Z); }
            var removed = 0;
            for (i = 0; i < tr.length; i++) {
                var cl = tr[i].track.clips;
                for (c = cl.numItems - 1; c >= 0; c--) {
                    var s = tk(cl[c].start), e = tk(cl[c].end);
                    if (s >= A && e <= Z) { cl[c].remove(false, false); removed++; }
                }
            }
            if (removed) { did("removed " + removed + " clip pieces"); }
            dropTransitionsIn(seq, tr, A, Z);
            var shifted = shiftAfter(seq, tr, Z, -d);
            var mk = shiftMarkers(seq, Z, -d, a.markers);
            return { removed: removed, shifted: shifted, markersShifted: mk, newEnd: tk(seq.end) };
        });
    };

    F.v2_insert_gap = function (a) {
        var seq = getSeq(a.sequence_id);
        var at = a.at, d = a.duration;
        if (!(d > 0)) { fail("duration must be more than 0."); }
        var ts = pickTracks(seq, a.tracks);
        var bad = lockedConflict(ts, at);
        if (bad.length && !a.ignore_locked) { fail("Locked track(s) " + bad.join(", ") + " have clips after that point; inserting would pull them out of sync. Unlock them or pass ignore_locked: true."); }
        return edit(a, seq, "insert gap", function () {
            var tr = unlocked(ts);
            for (var i = 0; i < tr.length; i++) { razorTrack(seq, tr[i].kind, tr[i].index, at); }
            var shifted = shiftAfter(seq, tr, at, d);
            var mk = (!a.tracks || a.tracks === "all") ? shiftMarkers(seq, at, d, a.markers) : 0;
            return { shifted: shifted, markersShifted: mk, newEnd: tk(seq.end) };
        });
    };

    // Move [start, end) to `to` (a time in the timeline as it is now), closing the hole it leaves.
    F.v2_move_range = function (a) {
        var seq = getSeq(a.sequence_id);
        var A = a.start, Z = a.end, C = a.to, L = Z - A;
        if (!(L > 0)) { fail("end must be after start."); }
        if (C > A && C < Z) { fail("The destination is inside the range being moved."); }
        if (C === A || C === Z) { return { moved: 0, note: "nothing to do: the destination is the range's own edge" }; }
        // the pieces pass other clips on their way, which only Premiere's own (QE) move does cleanly: needs the
        // sequence active, so check before anything changes
        qeSeqFor(seq);
        var ts = allTracks(seq);
        var bad = lockedConflict(ts, Math.min(A, C));
        if (bad.length && !a.ignore_locked) { fail("Locked track(s) " + bad.join(", ") + " have clips in the way. Unlock them or pass ignore_locked: true."); }
        return edit(a, seq, "move range", function () {
            var tr = unlocked(ts), i, c;
            // 1. cut at the range edges and at the destination
            for (i = 0; i < tr.length; i++) {
                razorTrack(seq, tr[i].kind, tr[i].index, A);
                razorTrack(seq, tr[i].kind, tr[i].index, Z);
                razorTrack(seq, tr[i].kind, tr[i].index, C);
            }
            // 2. remember the pieces inside the range
            var pieces = [];
            for (i = 0; i < tr.length; i++) {
                var cl = tr[i].track.clips;
                for (c = 0; c < cl.numItems; c++) {
                    var s = tk(cl[c].start), e = tk(cl[c].end);
                    if (s >= A && e <= Z) { pieces.push(String(cl[c].nodeId)); }
                }
            }
            function findNode(id) {
                for (var x = 0; x < tr.length; x++) {
                    var cc = tr[x].track.clips;
                    for (var y = 0; y < cc.numItems; y++) { if (String(cc[y].nodeId) === id) { return cc[y]; } }
                }
                return null;
            }
            // 3. open a gap at the destination
            var srcA = A;
            if (C < A) {
                // the range itself moves right by L when the gap opens before it
                var all = [];
                for (i = 0; i < tr.length; i++) { all.push(tr[i]); }
                shiftAfter(seq, all, C, L);
                srcA = A + L;
            } else {
                shiftAfter(seq, tr, C, L);
            }
            // 4. move the pieces into the gap (QE moves: they pass other clips; their transitions are put back below)
            var off = C - srcA;
            var precs = transRecords(seq, tr);
            var items = [];
            for (i = 0; i < pieces.length; i++) { var it = findNode(pieces[i]); if (it) { items.push({ clip: it, target: tk(it.start) + off }); } }
            items.sort(function (x, y) { return off < 0 ? x.target - y.target : y.target - x.target; });
            for (i = 0; i < items.length; i++) {
                var now = tk(items[i].clip.start);
                if (absf(now - items[i].target) >= 2) { moveBy(seq, items[i].clip, items[i].target - now); }
            }
            did("moved " + items.length + " pieces");
            var inStretch = function (t) { return t >= srcA && t < srcA + L; };
            var stretchRecs = [];
            for (i = 0; i < precs.length; i++) {
                var pr = precs[i], ins = pr.side === "in" ? inStretch(pr.edge) : (pr.side === "out" ? inStretch(pr.edge - 1) : inStretch(pr.edge) && inStretch(pr.edge - 1));
                if (ins) { stretchRecs.push(pr); }
            }
            carryTransitions(seq, stretchRecs, function (t) { return inStretch(t) ? t + off : t; }, function (t) { return inStretch(t - 1) ? t + off : t; });
            // 5. close the hole the range left
            var holeA = srcA, holeZ = srcA + L;
            shiftAfter(seq, tr, holeZ, -L);
            // markers: those inside the range travel with it
            var mkMoved = 0;
            if (a.markers !== "keep") {
                var ms = seq.markers, list = [], m = ms.getFirstMarker();
                while (m) { list.push(m); m = ms.getNextMarker(m); }
                for (i = 0; i < list.length; i++) {
                    var mstart = tk(list[i].start), mend = tk(list[i].end), ns = mstart;
                    // positions in the original timeline -> final
                    if (mstart >= A && mstart < Z) { ns = mstart + (C > A ? C - Z : C - A); }
                    else if (C > A && mstart >= Z && mstart < C) { ns = mstart - L; }
                    else if (C < A && mstart >= C && mstart < A) { ns = mstart + L; }
                    if (ns !== mstart) { moveMarker(list[i], ns, mend + (ns - mstart)); mkMoved++; }
                }
            }
            return { moved: items.length, markersMoved: mkMoved, holeClosedAt: holeA, newEnd: tk(seq.end) };
        });
    };

    // Sort ranges and join the ones that overlap or touch.
    function mergeRanges(list) {
        var r = [], i;
        for (i = 0; i < (list || []).length; i++) {
            var s = Number(list[i].start), e = Number(list[i].end);
            if (!(e > s)) { fail("Range " + (i + 1) + ": end must be after start."); }
            r.push({ start: s, end: e });
        }
        r.sort(function (x, y) { return x.start - y.start; });
        var out = [];
        for (i = 0; i < r.length; i++) {
            if (out.length && r[i].start <= out[out.length - 1].end) { out[out.length - 1].end = Math.max(out[out.length - 1].end, r[i].end); }
            else { out.push(r[i]); }
        }
        return out;
    }

    // Remove several ranges (times in the timeline as it is now) in one edit: cut at every edge, remove the pieces,
    // then move each remaining clip once, straight to where it ends up, left to right. One snapshot, and no clip
    // is moved past another (which would jumble Premiere's clip list, see trackInOrder).
    F.v2_ripple_delete_many = function (a) {
        var seq = getSeq(a.sequence_id);
        var R = mergeRanges(a.ranges);
        if (!R.length) { fail("ranges is empty."); }
        var ts = allTracks(seq);
        var bad = lockedConflict(ts, R[0].start);
        if (bad.length && !a.ignore_locked) { fail("Locked track(s) " + bad.join(", ") + " have clips after the first cut; rippling would pull them out of sync. Unlock them or pass ignore_locked: true."); }
        function removedBefore(t) {
            var d = 0;
            for (var k = 0; k < R.length; k++) { if (R[k].end <= t) { d += R[k].end - R[k].start; } }
            return d;
        }
        function rangeAt(t) {
            for (var k = 0; k < R.length; k++) { if (t >= R[k].start && t < R[k].end) { return R[k]; } }
            return null;
        }
        return edit(a, seq, "ripple delete x" + R.length, function () {
            var tr = unlocked(ts), i, k, c, cl;
            for (i = 0; i < tr.length; i++) {
                for (k = 0; k < R.length; k++) { razorTrack(seq, tr[i].kind, tr[i].index, R[k].start); razorTrack(seq, tr[i].kind, tr[i].index, R[k].end); }
            }
            var removed = 0;
            for (i = 0; i < tr.length; i++) {
                cl = tr[i].track.clips;
                for (c = cl.numItems - 1; c >= 0; c--) {
                    var s = tk(cl[c].start), e = tk(cl[c].end), hit = rangeAt(s);
                    if (hit && e <= hit.end) { cl[c].remove(false, false); removed++; }
                }
            }
            if (removed) { did("removed " + removed + " clip pieces"); }
            for (k = 0; k < R.length; k++) { dropTransitionsIn(seq, tr, R[k].start, R[k].end); }
            var recs = transRecords(seq, tr);
            // where every remaining clip goes, worked out from its start before anything moves
            var items = [];
            for (i = 0; i < tr.length; i++) {
                cl = tr[i].track.clips;
                for (c = 0; c < cl.numItems; c++) {
                    var st = tk(cl[c].start), d = removedBefore(st);
                    if (d) { items.push({ clip: cl[c], target: st - d, nodeId: String(cl[c].nodeId), kind: tr[i].kind, ti: tr[i].index }); }
                }
            }
            items.sort(function (x, y) { return x.target - y.target; });
            var moved = 0, j;
            for (j = 0; j < items.length; j++) {
                var now = tk(items[j].clip.start);
                if (absf(now - items[j].target) < 2) { continue; } // a linked partner already took it there
                moveBy(seq, items[j].clip, items[j].target - now);
                moved++;
            }
            // a linked partner moved along with another clip can overshoot; put any stray back, then check them all
            var wrong = [];
            for (j = 0; j < items.length; j++) {
                var f = null;
                try { f = findClip(seq, { node_id: items[j].nodeId }); } catch (eF) {}
                if (!f) { continue; }
                var n2 = tk(f.clip.start);
                if (absf(n2 - items[j].target) >= 2) {
                    try { moveBy(seq, f.clip, items[j].target - n2); } catch (eM) {}
                    if (absf(tk(f.clip.start) - items[j].target) >= 2) { wrong.push(label(f.kind, f.ti) + " '" + f.clip.name + "' is at " + qeTC(seq, tk(f.clip.start)) + ", should be " + qeTC(seq, items[j].target)); }
                }
            }
            if (wrong.length) { fail("Some clips didn't land where they should:\n- " + wrong.slice(0, 8).join("\n- ")); }
            did("moved " + moved + " clips");
            // content just after / just before t: gone if a range removed it, else moved left by what went before
            carryTransitions(seq, recs, function (t) {
                for (var q = 0; q < R.length; q++) { if (t >= R[q].start && t < R[q].end) { return null; } }
                return t - removedBefore(t);
            }, function (t) {
                var d0 = 0;
                for (var q = 0; q < R.length; q++) {
                    if (t > R[q].start && t <= R[q].end) { return null; }
                    if (R[q].end < t) { d0 += R[q].end - R[q].start; }
                }
                return t - d0;
            });
            var mk = 0;
            if (a.markers !== "keep") {
                var ms = seq.markers, list = [], m = ms.getFirstMarker();
                while (m) { list.push(m); m = ms.getNextMarker(m); }
                var plan = [];
                for (i = 0; i < list.length; i++) {
                    var ms0 = tk(list[i].start), me0 = tk(list[i].end), hr = rangeAt(ms0);
                    // a marker inside a removed range goes to the cut that replaced it
                    var ns = hr ? hr.start - removedBefore(hr.start) : ms0 - removedBefore(ms0);
                    if (ns !== ms0) { plan.push({ m: list[i], s: ns, e: me0 + (ns - ms0) }); }
                }
                plan.sort(function (x, y) { return x.s - y.s; });
                for (i = 0; i < plan.length; i++) { moveMarker(plan[i].m, plan[i].s, plan[i].e); mk++; }
                if (mk) { did("shifted " + mk + " markers"); }
            }
            var total = 0;
            for (k = 0; k < R.length; k++) { total += R[k].end - R[k].start; }
            return { ranges: R, removed: removed, shifted: items.length, moved: moved, markersShifted: mk, removedTotal: total, newEnd: tk(seq.end) };
        });
    };

    // ------------------------------------------------------------------ placing clips
    function newClipIds(seq) {
        var ids = {}, ts = allTracks(seq);
        for (var i = 0; i < ts.length; i++) {
            var cl = ts[i].track.clips;
            for (var c = 0; c < cl.numItems; c++) { ids[String(cl[c].nodeId)] = true; }
        }
        return ids;
    }

    function clipsNotIn(seq, before) {
        var out = [], ts = allTracks(seq);
        for (var i = 0; i < ts.length; i++) {
            var cl = ts[i].track.clips;
            for (var c = 0; c < cl.numItems; c++) {
                if (!before[String(cl[c].nodeId)]) { out.push({ clip: cl[c], kind: ts[i].kind, ti: ts[i].index, track: ts[i].track }); }
            }
        }
        return out;
    }

    // Project-item In/Out snap to the media's own frames (2.5 s on 23.976 media lands on frame 59 = 2.461 s),
    // so the read-back only has to be within a frame; the placed clip is slipped to the exact time afterwards.
    function setItemRange(pi, inT, outT) {
        var tol = TPS / 20;
        var forms = [function (t) { return mkTime(t); }, function (t) { return tstr(t); }, function (t) { return t / TPS; }];
        for (var i = 0; i < forms.length; i++) {
            try {
                pi.setInPoint(forms[i](inT), MEDIA_ALL);
                pi.setOutPoint(forms[i](outT), MEDIA_ALL);
                var gi = tk(pi.getInPoint(MEDIA_ALL)), go = tk(pi.getOutPoint(MEDIA_ALL));
                if (absf(gi - inT) < tol && absf(go - outT) < tol) { return { "in": gi, out: go }; }
            } catch (e) {}
        }
        fail("Couldn't set the source in/out on '" + pi.name + "' (" + secs(inT) + "-" + secs(outT) + "s). Is that inside the media?");
    }

    function itemMarks(pi) {
        var m = { inT: null, outT: null };
        try { m.inT = tk(pi.getInPoint(MEDIA_ALL)); m.outT = tk(pi.getOutPoint(MEDIA_ALL)); } catch (e) {}
        return m;
    }
    // Put the item's marks back. Unmarked media reads as 0..end, so clear first and only re-set if it differed.
    function restoreMarks(pi, m) {
        try {
            pi.clearInPoint(); pi.clearOutPoint();
            if (m.inT === null) { return; }
            var c = itemMarks(pi);
            if (c.inT === m.inT && c.outT === m.outT) { return; }
            pi.setInPoint(mkTime(m.inT), MEDIA_ALL);
            pi.setOutPoint(mkTime(m.outT), MEDIA_ALL);
        } catch (e) {}
    }

    // Make a placed clip show exactly [inT, inT + len) of its source and last exactly len on the timeline.
    // overwriteClip goes by the item's frame-snapped marks, so it can land a frame early; slip it back.
    function fixSource(seq, c, inT, len) {
        var ft = frameTicks(seq), info = { slippedFrames: 0 };
        var gotIn = tk(c.inPoint), start = tk(c.start);
        if (absf(gotIn - inT) > 1) {
            var srcLen = tk(c.outPoint) - gotIn;
            try { c.inPoint = mkTime(inT); } catch (e) {}
            try { c.outPoint = mkTime(inT + srcLen); } catch (e2) {}
            if (absf(tk(c.inPoint) - inT) > ft / 2) {
                try {
                    var f = findClip(seq, { node_id: String(c.nodeId) });
                    var qi = qeItemFor(seq, f.kind, f.ti, c);
                    qi.slip(String(Math.round((inT - tk(c.inPoint)) / ft)), false);
                } catch (e3) {}
            }
            info.slippedFrames = Math.round((tk(c.inPoint) - gotIn) / ft * 100) / 100;
            if (info.slippedFrames) { did("slipped '" + c.name + "' to the exact source in (" + info.slippedFrames + " frame)"); }
        }
        if (absf(tk(c.start) - start) > 1) { info.startMoved = true; }
        // Lengths come out in whole frames (Premiere snaps the source marks), so within a frame is right. Only a
        // bigger miss is fixed, and never by running over the next clip on the track.
        var curLen = tk(c.end) - tk(c.start);
        if (absf(curLen - len) > ft + 1) {
            var want = Math.round(len / ft) * ft, newEnd = tk(c.start) + want, blocked = false;
            if (want > curLen) {
                var f2 = findClip(seq, { node_id: String(c.nodeId) }), cl = f2.track.clips;
                for (var k = 0; k < cl.numItems; k++) {
                    if (String(cl[k].nodeId) !== String(c.nodeId) && tk(cl[k].start) >= tk(c.end) - 1 && tk(cl[k].start) < newEnd) { blocked = true; }
                }
            }
            if (!blocked) { try { c.end = mkTime(newEnd); } catch (e4) {} }
            else { info.lengthNote = "came out " + Math.round((len - curLen) / ft * 10) / 10 + " frame(s) short; not extended because the next clip starts there"; }
        }
        info.inError = tk(c.inPoint) - inT;
        if (absf(info.inError) > ft / 2) { fail("'" + c.name + "' landed with source in " + secs(tk(c.inPoint)) + "s instead of " + secs(inT) + "s and couldn't be slipped back."); }
        return info;
    }

    // Premiere adds audio (or video) tracks when a multi-channel clip has nowhere to go. Remove the ones this edit
    // added, only if they're still empty; tracks that were there before are never touched.
    function dropNewEmptyTracks(seq, nV0, nA0) {
        var res = { removed: 0, left: 0 }, q = null, i;
        var nA = seq.audioTracks.numTracks, nV = seq.videoTracks.numTracks;
        if (nA <= nA0 && nV <= nV0) { return res; }
        try { q = qeSeqFor(seq); } catch (e) { q = null; }
        for (i = nA - 1; i >= nA0; i--) {
            if (seq.audioTracks[i].clips.numItems === 0 && q) {
                try { q.removeAudioTrack(i); } catch (e2) {}
            }
        }
        for (i = nV - 1; i >= nV0; i--) {
            if (seq.videoTracks[i].clips.numItems === 0 && q) {
                try { q.removeVideoTrack(i); } catch (e3) {}
            }
        }
        res.removed = (nA - seq.audioTracks.numTracks) + (nV - seq.videoTracks.numTracks);
        res.left = (seq.audioTracks.numTracks - nA0) + (seq.videoTracks.numTracks - nV0);
        if (res.removed) { did("removed " + res.removed + " empty track(s) Premiere added for the clip's extra channels"); }
        return res;
    }

    F.v2_place_clip = function (a) {
        var seq = getSeq(a.sequence_id);
        var pi = resolveItem(a.source);
        var inT = a.src_in, outT = a.src_out, at = a.at;
        if (!(outT > inT)) { fail("src_out must be after src_in."); }
        var vt = a.video_track ? getTrack(seq, a.video_track) : null;
        var at_ = a.audio_track ? getTrack(seq, a.audio_track) : null;
        if (vt && vt.kind !== "video") { fail("video_track must be a V track."); }
        if (at_ && at_.kind !== "audio") { fail("audio_track must be an A track."); }
        if (!vt && !at_) { fail("Pass video_track and/or audio_track."); }
        var dur = outT - inT;
        return edit(a, seq, "place clip", function () {
            if (a.mode === "insert") {
                var ts = allTracks(seq), tr = unlocked(ts);
                for (var i = 0; i < tr.length; i++) { razorTrack(seq, tr[i].kind, tr[i].index, at); }
                shiftAfter(seq, tr, at, Math.round(dur / frameTicks(seq)) * frameTicks(seq));
            }
            var marks = itemMarks(pi);
            var placed = [], removedSpill = 0, nV0 = seq.videoTracks.numTracks, nA0 = seq.audioTracks.numTracks, tracksInfo = null;
            try {
                // Lock every track we must not touch, so a multi-channel camera clip can't spill onto them.
                var ts2 = allTracks(seq), locks = [];
                for (var k = 0; k < ts2.length; k++) {
                    var keep = (vt && ts2[k].kind === "video" && ts2[k].index === vt.index) || (at_ && ts2[k].kind === "audio" && ts2[k].index === at_.index);
                    if (!keep && !ts2[k].locked) { try { ts2[k].track.setLocked(1); locks.push(ts2[k].track); } catch (e) {} }
                }
                try {
                    setItemRange(pi, inT, outT);
                    var before = newClipIds(seq);
                    var target = vt ? vt.track : at_.track;
                    if (!target.overwriteClip(pi, tstr(at))) {
                        var t2 = new Time(); t2.ticks = tstr(at);
                        target.overwriteClip(pi, t2);
                    }
                    var fresh = clipsNotIn(seq, before);
                    for (var n = 0; n < fresh.length; n++) {
                        var fc = fresh[n];
                        var wanted = (vt && fc.kind === "video" && fc.ti === vt.index) || (at_ && fc.kind === "audio" && fc.ti === at_.index);
                        if (!wanted) { fc.clip.remove(false, false); removedSpill++; continue; }
                        placed.push(fc);
                    }
                    // Audio requested on a different track than the video's partner: place audio separately.
                    var haveAudio = false;
                    for (n = 0; n < placed.length; n++) { if (placed[n].kind === "audio") { haveAudio = true; } }
                    if (at_ && !haveAudio && vt) {
                        var before2 = newClipIds(seq);
                        at_.track.overwriteClip(pi, tstr(at));
                        var fresh2 = clipsNotIn(seq, before2);
                        for (n = 0; n < fresh2.length; n++) {
                            if (fresh2[n].kind === "audio" && fresh2[n].ti === at_.index) { placed.push(fresh2[n]); }
                            else if (fresh2[n].kind === "video" && vt && fresh2[n].ti === vt.index) { fresh2[n].clip.remove(false, false); }
                            else { fresh2[n].clip.remove(false, false); removedSpill++; }
                        }
                    }
                } finally {
                    for (var u = 0; u < locks.length; u++) { try { locks[u].setLocked(0); } catch (e2) {} }
                    restoreMarks(pi, marks);
                }
            } finally {
                tracksInfo = dropNewEmptyTracks(seq, nV0, nA0);
            }
            if (!placed.length) { fail("Premiere didn't place anything (is the target track locked?)."); }
            var out = [];
            for (var p = 0; p < placed.length; p++) {
                var pc = placed[p];
                if (pc.kind === "video" && !vt) { pc.clip.remove(false, false); continue; }
                var fx = fixSource(seq, pc.clip, inT, outT - inT);
                var rr = rec(pc.clip, pc.kind, pc.ti, 0, true);
                rr.fix = fx;
                out.push(rr);
            }
            if (removedSpill) { did("kept " + removedSpill + " extra channel clip(s) off other tracks"); }
            var r = { placed: out, removedSpill: removedSpill };
            if (tracksInfo && tracksInfo.left > 0) { r.note = "Premiere added " + tracksInfo.left + " track(s) for the clip's extra channels and they couldn't be removed (open the sequence first, or use Sequence > Delete Tracks > empty tracks)."; }
            return r;
        });
    };

    // ------------------------------------------------------------------ speed
    function nextStartOn(track, after, skipId) {
        var best = null, cl = track.clips;
        for (var i = 0; i < cl.numItems; i++) {
            if (String(cl[i].nodeId) === skipId) { continue; }
            var st = tk(cl[i].start);
            if (st >= after && (best === null || st < best)) { best = st; }
        }
        return best;
    }

    F.v2_set_speed = function (a) {
        var seq = getSeq(a.sequence_id);
        var f = findClip(seq, a.clip);
        var c = f.clip, speed = Number(a.speed);
        if (!(speed > 0)) { fail("speed must be more than 0 (1 = 100%, 0.5 = half speed)."); }
        var ft = frameTicks(seq);
        var oldStart = tk(c.start), oldEnd = tk(c.end), oldSpeed = speedOf(c), oldIn = srcIn(c);
        var srcDur = (oldEnd - oldStart) * oldSpeed; // source time the clip shows now
        var newEnd = oldStart + Math.max(1, Math.round(srcDur / speed / ft)) * ft;
        var delta = newEnd - oldEnd;
        var ripple = a.ripple || "sequence";
        return edit(a, seq, "speed change", function () {
            var ts = ripple === "track" ? [{ kind: f.kind, index: f.ti, track: f.track, locked: false, label: label(f.kind, f.ti) }] : unlocked(allTracks(seq));
            var linked = [];
            try { var li = c.getLinkedItems(); for (var i = 0; i < li.numItems; i++) { if (String(li[i].nodeId) !== String(c.nodeId)) { linked.push(li[i]); } } } catch (e) {}
            if (ripple === "track") {
                for (var l = 0; l < linked.length; l++) {
                    var lf = findClip(seq, { node_id: String(linked[l].nodeId) });
                    ts.push({ kind: lf.kind, index: lf.ti, track: lf.track, locked: false, label: label(lf.kind, lf.ti) });
                }
            }
            // transitions: recorded now, put back once the speed and the ripple are done (the speed clip's own track
            // and its linked tracks stretch with it; the others only shift)
            var spTracks = {};
            spTracks[f.kind + f.ti] = true;
            if (a.include_linked !== false) {
                for (var sl = 0; sl < linked.length; sl++) { try { var slf = findClip(seq, { node_id: String(linked[sl].nodeId) }); spTracks[slf.kind + slf.ti] = true; } catch (eL) {} }
            }
            var recTracks = ts.slice(0);
            var allT = allTracks(seq);
            for (var at0 = 0; at0 < allT.length; at0++) {
                var inTs = false;
                for (var at1 = 0; at1 < ts.length; at1++) { if (ts[at1].kind === allT[at0].kind && ts[at1].index === allT[at0].index) { inTs = true; } }
                if (!inTs && spTracks[allT[at0].kind + allT[at0].index]) { recTracks.push(allT[at0]); }
            }
            var trRecs = transRecords(seq, recTracks);
            if (delta > 0 && ripple !== "none") {
                for (var r = 0; r < ts.length; r++) { razorTrack(seq, ts[r].kind, ts[r].index, oldEnd); }
                shiftAfter(seq, ts, oldEnd, delta, true);
            }
            var targets = [f];
            if (a.include_linked !== false) {
                for (var k = 0; k < linked.length; k++) { targets.push(findClip(seq, { node_id: String(linked[k].nodeId) })); }
            }
            var results = [], capped = [];
            for (var t = 0; t < targets.length; t++) {
                var tf = targets[t];
                // How long it should be; with ripple 'none' it can't run into the next clip.
                var end = newEnd;
                if (delta > 0 && ripple === "none") {
                    var room = nextStartOn(tf.track, tk(tf.clip.end) - 1, String(tf.clip.nodeId));
                    if (room !== null && room < end) { end = room; capped.push(label(tf.kind, tf.ti)); }
                }
                // Premiere's own speed call with the new duration keeps the clip consistent (setting the end or
                // Out point by script afterwards leaves a clip Premiere can no longer razor). It can come out a
                // frame short, so check and ask once more with the difference.
                var want = end - oldStart, fresh = tf.clip;
                for (var attempt = 0; attempt < 2; attempt++) {
                    var qi = qeItemFor(seq, tf.kind, tf.ti, fresh);
                    qi.setSpeed(speed, durTC(seq, want), !!a.reverse, false, !!a.maintain_pitch);
                    fresh = findClip(seq, { node_id: String(tf.clip.nodeId) }).clip;
                    var gotLen = tk(fresh.end) - tk(fresh.start);
                    if (absf(gotLen - (end - oldStart)) < ft / 2) { break; }
                    want = want + ((end - oldStart) - gotLen);
                }
                var got = Number(fresh.getSpeed());
                if (absf(got - speed) > 0.001 && absf(got - speed * 100) > 0.1) { fail("Premiere set the speed of '" + fresh.name + "' to " + got + " instead of " + speed + "."); }
                if (absf((tk(fresh.end) - tk(fresh.start)) - (end - oldStart)) > ft + 1) {
                    fail("Premiere changed the speed but made '" + fresh.name + "' " + secs(tk(fresh.end) - tk(fresh.start)) + "s long instead of " + secs(end - oldStart) + "s.");
                }
                results.push(rec(fresh, tf.kind, tf.ti, 0, false));
            }
            did("speed set to " + Math.round(speed * 1000) / 10 + "%");
            var main = findClip(seq, { node_id: String(c.nodeId) }).clip;
            var gotEnd = tk(main.end);
            if (ripple !== "none") {
                if (delta < 0) {
                    // close the gap the shorter clip left
                    shiftAfter(seq, ts, oldEnd, gotEnd - oldEnd, true);
                } else if (delta > 0 && absf(gotEnd - newEnd) > 1) {
                    // Premiere landed a frame off: butt the moved clips against it
                    shiftAfter(seq, ts, newEnd, gotEnd - newEnd, true);
                }
            }
            var shiftBy = ripple === "none" ? 0 : gotEnd - oldEnd, scale = (gotEnd - oldStart) / (oldEnd - oldStart);
            var stretchRecs = [], otherRecs = [];
            for (var tr0 = 0; tr0 < trRecs.length; tr0++) { (spTracks[trRecs[tr0].kind + trRecs[tr0].ti] ? stretchRecs : otherRecs).push(trRecs[tr0]); }
            carryTransitions(seq, stretchRecs, function (t) {
                return t < oldStart ? t : (t < oldEnd ? Math.round(oldStart + (t - oldStart) * scale) : t + shiftBy);
            }, function (t) {
                return t <= oldStart ? t : (t <= oldEnd ? Math.round(oldStart + (t - oldStart) * scale) : t + shiftBy);
            });
            carryTransitions(seq, otherRecs, function (t) { return t >= oldEnd && shiftBy ? t + shiftBy : t; }, function (t) { return t > oldEnd && shiftBy ? t + shiftBy : t; });
            var inMoved = srcIn(main) - oldIn;
            var res = { clips: results, oldSpeed: oldSpeed, newSpeed: speed, oldEnd: oldEnd, newEnd: gotEnd, expectedEnd: newEnd };
            if (absf(inMoved) > ft / 2) { res.note = "Premiere moved the source In by " + secs(inMoved) + "s when the speed changed."; }
            if (capped.length) { res.note = (res.note ? res.note + " " : "") + "ripple 'none': " + capped.join(", ") + " stopped at the next clip, so less of the source plays."; }
            return res;
        });
    };

    // ------------------------------------------------------------------ markers
    F.v2_move_markers = function (a) {
        var seq = getSeq(a.sequence_id);
        var ms = seq.markers, list = [], m = ms.getFirstMarker();
        while (m) { list.push(m); m = ms.getNextMarker(m); }
        var moved = [];
        for (var i = 0; i < list.length; i++) {
            var mk = list[i], s = tk(mk.start), e = tk(mk.end);
            if (has(a, "from") && s < a.from) { continue; }
            if (has(a, "to") && s >= a.to) { continue; }
            if (a.names && a.names.length) {
                var hit = false;
                for (var n = 0; n < a.names.length; n++) { if (lower(mk.name).indexOf(lower(a.names[n])) >= 0) { hit = true; } }
                if (!hit) { continue; }
            }
            var ns = s + a.delta;
            if (ns < 0) { fail("Moving '" + mk.name + "' by that much would put it before the sequence start."); }
            moveMarker(mk, ns, e + a.delta);
            moved.push({ name: mk.name, from: s, to: tk(mk.start) });
        }
        return { moved: moved };
    };

    // ------------------------------------------------------------------ effects
    var INTRINSIC = ["AE.ADBE Opacity", "AE.ADBE Motion", "AE.ADBE Time Remapping", "audio.Volume", "audio.Channel Volume", "audio.Panner"];

    function isIntrinsic(comp, i) {
        var mn = "";
        try { mn = comp.matchName; } catch (e) {}
        if (inList(INTRINSIC, mn)) { return true; }
        var dn = lower(comp.displayName);
        return dn === "opacity" || dn === "motion" || dn === "time remapping" || dn === "volume" || dn === "channel volume" || dn === "panner";
    }

    function compList(c) {
        var out = [];
        for (var i = 0; i < c.components.numItems; i++) {
            var comp = c.components[i], r = { index: i, name: comp.displayName, matchName: "", params: [] };
            try { r.matchName = comp.matchName; } catch (e) {}
            r.builtIn = isIntrinsic(comp, i);
            for (var p = 0; p < comp.properties.numItems; p++) {
                var pr = comp.properties[p], pv = { name: pr.displayName };
                try { pv.keyframed = !!pr.isTimeVarying(); } catch (e2) {}
                try { var v = pr.getValue(); pv.value = (typeof v === "object" && v !== null && !(v instanceof Array)) ? String(v) : v; } catch (e3) { pv.value = null; }
                try { if (pv.keyframed) { pv.keys = pr.getKeys().length; } } catch (e4) {}
                r.params.push(pv);
            }
            out.push(r);
        }
        return out;
    }

    F.v2_list_effects = function (a) {
        var seq = getSeq(a.sequence_id);
        var f = findClip(seq, a.clip);
        return { clip: rec(f.clip, f.kind, f.ti, f.ci, true), effects: compList(f.clip), keyframeTimeBase: V.keyBase };
    };

    function findComp(c, name) {
        var n = lower(name);
        for (var i = 0; i < c.components.numItems; i++) {
            var comp = c.components[i], mn = "";
            try { mn = lower(comp.matchName); } catch (e) {}
            if (lower(comp.displayName) === n || mn === n) { return comp; }
        }
        return null;
    }

    function findParam(comp, names) {
        for (var k = 0; k < names.length; k++) {
            var n = lower(names[k]);
            for (var p = 0; p < comp.properties.numItems; p++) { if (lower(comp.properties[p].displayName) === n) { return comp.properties[p]; } }
        }
        return null;
    }

    function paramNames(comp) {
        var out = [];
        for (var p = 0; p < comp.properties.numItems; p++) { out.push(comp.properties[p].displayName); }
        return out;
    }

    function compNames(c) {
        var out = [];
        for (var i = 0; i < c.components.numItems; i++) { out.push(c.components[i].displayName); }
        return out;
    }

    // Keyframe times: Premiere stores them in the clip's real source (media) time, also on speed-changed clips
    // (whose inPoint reads divided by the speed, so srcIn() is used, not inPoint). Checked by rendering on Premiere 27
    // at 100% and 50%. clipT is seconds from the clip's start on the timeline. V.keyBase can be set to "clip" if a
    // build differs.
    function keyTimeFor(c, clipT) {
        if (V.keyBase === "clip") { return mkTime(Math.round(clipT * TPS)); }
        return mkTime(srcIn(c) + Math.round(clipT * speedOf(c) * TPS));
    }
    function keyToClipT(c, keyTime) {
        if (V.keyBase === "clip") { return tk(keyTime) / TPS; }
        return (tk(keyTime) - srcIn(c)) / speedOf(c) / TPS;
    }

    function addQEEffect(seq, f, name) {
        var qi = qeItemFor(seq, f.kind, f.ti, f.clip);
        var fx = f.kind === "audio" ? qe.project.getAudioEffectByName(name) : qe.project.getVideoEffectByName(name);
        if (!fx) { fail("Premiere has no " + f.kind + " effect called '" + name + "'."); }
        var k0 = compKeys(f.clip);
        if (f.kind === "audio") { qi.addAudioEffect(fx); } else { qi.addVideoEffect(fx); }
        var fresh = findClip(seq, { node_id: String(f.clip.nodeId) });
        var k1 = compKeys(fresh.clip);
        if (k1.length <= k0.length) { fail("Premiere didn't add '" + name + "' to '" + f.clip.name + "'."); }
        f.clip = fresh.clip;
        did("added " + name + " to '" + f.clip.name + "'");
        // Premiere 27 puts a new effect at the top of the stack (just under Motion/Opacity), not at the bottom:
        // the new one is where the lists first differ.
        var idx = k1.length - 1;
        for (var i = 0; i < k0.length; i++) { if (k0[i] !== k1[i]) { idx = i; break; } }
        return f.clip.components[idx];
    }

    function compKeys(c) {
        var o = [];
        for (var i = 0; i < c.components.numItems; i++) {
            var mn = "";
            try { mn = c.components[i].matchName; } catch (e) {}
            o.push(mn + "|" + c.components[i].displayName);
        }
        return o;
    }

    // Parameters Premiere keeps for itself (blank names, "_ Applied Version", the Impact effects' "Error occurred").
    function hiddenParam(name) {
        return !name || /^\s*$/.test(name) || /^_ /.test(name) || name === "Error occurred";
    }

    function sameValue(x, y) {
        if (typeof x === "number" && typeof y === "number") { return absf(x - y) <= Math.max(1e-6, absf(x) * 1e-5); }
        return B.stringify(x) === B.stringify(y);
    }

    function copyParam(sp, dp, srcClip, dstClip, report, where) {
        var keyed = false;
        try { keyed = !!sp.isTimeVarying(); } catch (e) {}
        if (keyed) {
            var keys = sp.getKeys();
            try { if (dp.isTimeVarying()) { dp.setTimeVarying(false); } } catch (e0) {}
            dp.setTimeVarying(true);
            var n = 0;
            for (var k = 0; k < keys.length; k++) {
                var v = sp.getValueAtKey(keys[k]);
                var t = keyTimeFor(dstClip, keyToClipT(srcClip, keys[k]));
                dp.addKey(t);
                dp.setValueAtKey(t, v, true);
                n++;
            }
            report.copied.push(where + " (" + n + " keyframes)");
            report.notes = report.notes || [];
            if (!report.interpNote) { report.interpNote = true; report.notes.push("Keyframe interpolation (bezier/hold) can't be read by script; copied keyframes use Premiere's default."); }
            return;
        }
        var val = null, isColor = false;
        try { val = sp.getValue(); } catch (e1) { val = undefined; }
        if (val === undefined || val === null) {
            try { val = sp.getColorValue(); isColor = true; } catch (e2) {}
        }
        if (val === undefined || val === null) { report.skipped.push(where + ": no readable value"); return; }
        var before = null;
        try { before = isColor ? dp.getColorValue() : dp.getValue(); } catch (e3) {}
        if (sameValue(before, val)) { report.copied.push(where); return; }
        try {
            if (isColor) { dp.setColorValue(val[0], val[1], val[2], val[3], true); } else { dp.setValue(val, true); }
        } catch (e4) { report.skipped.push(where + ": " + e4.message); return; }
        var after = null;
        try { after = isColor ? dp.getColorValue() : dp.getValue(); } catch (e5) {}
        if (sameValue(after, val)) { report.copied.push(where); }
        else { report.skipped.push(where + ": Premiere didn't take the value (" + (typeof val === "string" ? "text/data value, " + val.length + " chars" : B.stringify(val)) + ")"); }
    }

    function copyEffects(srcSeq, src, dstSeq, dst, opts) {
        var report = { copied: [], added: [], skipped: [] };
        var sc = src.clip, hidden = 0;
        // Each added effect lands at the top of the target's stack, so add the source's effects bottom-up to end up
        // in the same order (Motion/Opacity first, they're already there).
        var order = [], extra = [], q;
        for (q = 0; q < sc.components.numItems; q++) { if (isIntrinsic(sc.components[q], q)) { order.push(q); } else { extra.push(q); } }
        for (q = extra.length - 1; q >= 0; q--) { order.push(extra[q]); }
        for (var oi = 0; oi < order.length; oi++) {
            var i = order[oi];
            var comp = sc.components[i];
            var intrinsic = isIntrinsic(comp, i);
            if (opts.only) {
                var want = false;
                for (var o = 0; o < opts.only.length; o++) { if (lower(opts.only[o]) === lower(comp.displayName)) { want = true; } }
                if (!want) { continue; }
            } else if (intrinsic && opts.skip_intrinsic) { continue; }
            var target = null;
            if (intrinsic) { target = findComp(dst.clip, comp.displayName); }
            else {
                try {
                    var dstSeqObj = dstSeq;
                    if (!opts.needQE) {
                        // temp sequences aren't active: QE can still reach them if Premiere opened them; try, else report
                        target = addEffectAnywhere(dstSeqObj, dst, comp.displayName);
                    } else {
                        target = addQEEffect(dstSeqObj, dst, comp.displayName);
                    }
                    report.added.push(comp.displayName);
                } catch (e) {
                    report.skipped.push(comp.displayName + ": couldn't add the effect (" + e.message + ")");
                    continue;
                }
            }
            if (!target) { report.skipped.push(comp.displayName + ": not found on the target"); continue; }
            var smn = "", tmn = "";
            try { smn = comp.matchName; tmn = target.matchName; } catch (eM) {}
            if (smn && tmn && smn !== tmn) {
                report.notes = report.notes || [];
                report.notes.push("Premiere has more than one effect called '" + comp.displayName + "'; the target got " + tmn + " instead of " + smn + ". Parameters were matched by name.");
            }
            for (var p = 0; p < comp.properties.numItems; p++) {
                var sp = comp.properties[p];
                if (hiddenParam(sp.displayName)) { hidden++; continue; }
                var dp = (p < target.properties.numItems && target.properties[p].displayName === sp.displayName) ? target.properties[p] : findParam(target, [sp.displayName]);
                if (!dp) { report.skipped.push(comp.displayName + " > " + sp.displayName + ": no such parameter on the target"); continue; }
                try { copyParam(sp, dp, sc, dst.clip, report, comp.displayName + " > " + sp.displayName); }
                catch (e2) { report.skipped.push(comp.displayName + " > " + sp.displayName + ": " + e2.message); }
            }
        }
        if (hidden) { report.hiddenParamsSkipped = hidden; }
        // Check the effect order came out the same.
        var want = [], got = [], d = dst.clip, w;
        for (w = 0; w < sc.components.numItems; w++) { if (!isIntrinsic(sc.components[w], w)) { want.push(sc.components[w].displayName); } }
        for (w = 0; w < d.components.numItems; w++) { if (!isIntrinsic(d.components[w], w)) { got.push(d.components[w].displayName); } }
        if (report.added.length && got.slice(0, want.length).join("|") !== want.join("|")) {
            report.notes = report.notes || [];
            report.notes.push("Effect order on the target is " + got.join(" > ") + " (source: " + want.join(" > ") + "). Drag them in the Effect Controls panel if the order matters.");
        }
        return report;
    }

    // QE only reaches the active sequence. For a temp sequence, open it briefly, add the effect, and go back.
    function addEffectAnywhere(seq, f, name) {
        var active = project().activeSequence ? String(project().activeSequence.sequenceID) : null;
        var switched = false;
        if (!active || active !== String(seq.sequenceID)) { project().openSequence(String(seq.sequenceID)); switched = true; }
        try {
            return addQEEffect(seq, f, name);
        } finally {
            if (switched && active) { try { project().openSequence(active); } catch (e) {} }
        }
    }

    F.v2_copy_effects = function (a) {
        var seq = getSeq(a.sequence_id);
        var src = findClip(seq, a.from);
        var targets = a.to || [];
        if (!targets.length) { fail("to needs at least one clip."); }
        checkExpect(seq, a.expect);
        return guarded(a, function () {
            var out = [];
            for (var i = 0; i < targets.length; i++) {
                var dst = findClip(seq, targets[i]);
                if (dst.kind !== src.kind) { out.push({ clip: dst.clip.name, error: "can't copy " + src.kind + " effects to a " + dst.kind + " clip" }); continue; }
                var rep = copyEffects(seq, src, seq, dst, { skip_intrinsic: a.include_motion_opacity === false, only: a.effects || null, needQE: true });
                rep.clip = dst.clip.name;
                out.push(rep);
            }
            return { from: src.clip.name, results: out };
        });
    };

    // Set one effect parameter by a friendly name; knows the common traps and checks the value really changed.
    F.v2_set_param = function (a) {
        var seq = getSeq(a.sequence_id);
        var f = findClip(seq, a.clip);
        var notes = [];
        var comp = findComp(f.clip, a.effect);
        if (!comp && a.effect_aliases) { for (var x = 0; x < a.effect_aliases.length && !comp; x++) { comp = findComp(f.clip, a.effect_aliases[x]); } }
        if (!comp && a.add_if_missing) { comp = addQEEffect(seq, f, a.effect_add_name || a.effect); }
        if (!comp) { fail("'" + f.clip.name + "' has no effect called '" + a.effect + "'. Its effects: " + compNames(f.clip).join(", ") + ". Pass add_if_missing: true to add it."); }
        var cname = lower(comp.displayName);
        var names = [a.param].concat(a.param_aliases || []);
        var pname = lower(a.param);
        // Uniform Scale trap (Transform and Motion)
        var uni = findParam(comp, ["Uniform Scale"]);
        var uniOn = null;
        if (uni) { try { uniOn = !!uni.getValue(); } catch (e) {} }
        var targetsList = null;
        if ((cname === "transform") && (pname === "scale" || pname === "scale width" || pname === "scale height")) {
            if (uniOn) {
                if (pname === "scale width") { notes.push("Uniform Scale is on, so Transform scales with 'Scale Height'; 'Scale Width' does nothing (that's what leaves black edges). Set Scale Height instead."); }
                names = ["Scale Height"];
            } else if (pname === "scale") { targetsList = ["Scale Height", "Scale Width"]; notes.push("Uniform Scale is off: set both Scale Height and Scale Width."); }
        }
        if (cname === "motion" && (pname === "scale" || pname === "scale width" || pname === "scale height")) {
            if (uniOn) {
                if (pname !== "scale") { notes.push("Uniform Scale is on, so Motion uses 'Scale' for both directions."); }
                names = ["Scale"];
            } else if (pname === "scale") { targetsList = ["Scale", "Scale Width"]; notes.push("Uniform Scale is off: 'Scale' is the height and 'Scale Width' the width; both were set."); }
            else if (pname === "scale height") { names = ["Scale"]; }
        }
        if (cname === "offset") { notes.push("Offset wraps the frame around: pixels pushed off one edge come back on the other, which shows as a seam on gradients. Use Transform's Position for a plain shift."); }
        var params = [];
        if (targetsList) { for (var t = 0; t < targetsList.length; t++) { var pp = findParam(comp, [targetsList[t]]); if (pp) { params.push(pp); } } }
        else { var p1 = findParam(comp, names); if (p1) { params.push(p1); } }
        if (!params.length) { fail(comp.displayName + " has no parameter '" + a.param + "'. Its parameters: " + paramNames(comp).join(", ") + "."); }
        var results = [];
        checkExpect(seq, a.expect);
        return guarded(a, function () {
            for (var i = 0; i < params.length; i++) {
                var pr = params[i];
                var before = null;
                try { before = pr.getValue(); } catch (e1) {}
                if (has(a, "clip_time")) {
                    var kt = keyTimeFor(f.clip, a.clip_time);
                    if (!pr.isTimeVarying()) { pr.setTimeVarying(true); }
                    pr.addKey(kt);
                    pr.setValueAtKey(kt, a.value, true);
                    var got = pr.getValueAtKey(kt);
                    if (!sameValue(got, a.value)) { fail(comp.displayName + " > " + pr.displayName + ": keyframe set but Premiere reads back " + B.stringify(got) + "."); }
                    results.push({ param: pr.displayName, keyframe: a.clip_time, value: got });
                } else {
                    if (pr.isTimeVarying && pr.isTimeVarying()) { notes.push(pr.displayName + " has keyframes; setValue changes the value at the playhead's keyframe only. Pass clip_time to set a keyframe."); }
                    pr.setValue(a.value, true);
                    var after = pr.getValue();
                    if (!sameValue(after, a.value)) {
                        fail(comp.displayName + " > " + pr.displayName + " didn't change: asked for " + B.stringify(a.value) + ", Premiere reads " + B.stringify(after) + " (was " + B.stringify(before) + ").");
                    }
                    results.push({ param: pr.displayName, before: before, after: after });
                }
            }
            did("set " + comp.displayName + " on '" + f.clip.name + "'");
            return { effect: comp.displayName, results: results, notes: notes };
        });
    };

    // ------------------------------------------------------------------ transitions
    // Remove every transition that sits on no clip edge (left behind by a scripted move; an orphaned audio
    // transition can silence the rest of its track). Optional a.tracks, e.g. ["A1","A2"].
    F.v2_remove_orphan_transitions = function (a) {
        var seq = getSeq(a.sequence_id);
        var ts = a.tracks && a.tracks.length ? pickTracks(seq, a.tracks) : allTracks(seq);
        return edit(a, seq, "remove orphan transitions", function () {
            var L = tlog(), tol = frameTicks(seq) / 2, found = 0;
            for (var i = 0; i < ts.length; i++) {
                var trs = null;
                try { trs = ts[i].track.transitions; } catch (e) {}
                if (!trs || !trs.numItems) { continue; }
                var cl = ts[i].track.clips, list = [];
                for (var k = 0; k < trs.numItems; k++) {
                    var s = tk(trs[k].start), e = tk(trs[k].end);
                    if (!transEdge(cl, s, e, tol)) { list.push({ kind: ts[i].kind, ti: ts[i].index, nodeId: String(trs[k].nodeId), name: trs[k].name, start: s, end: e }); }
                }
                for (var x = 0; x < list.length; x++) {
                    found++;
                    if (dropTransition(seq, list[x])) { L.removed.push(transDesc(seq, list[x])); } else { L.failed.push(transDesc(seq, list[x])); }
                }
            }
            if (found) { did("removed " + L.removed.length + " orphaned transitions"); }
            return { found: found, removed: L.removed.length, failed: L.failed.length };
        });
    };

    F.v2_transition = function (a) {
        var seq = getSeq(a.sequence_id);
        var f = findClip(seq, a.clip);
        var action = a.action || "add";
        var edge = a.edge || "end";
        var tr = f.track.transitions;
        function list() {
            var out = [];
            try { for (var i = 0; i < tr.numItems; i++) { out.push({ index: i, name: tr[i].name, start: tk(tr[i].start), end: tk(tr[i].end) }); } } catch (e) {}
            return out;
        }
        if (action === "list") { return { transitions: list() }; }
        checkExpect(seq, a.expect);
        return guarded(a, function () {
            var qt = qeTrack(seq, f.kind, f.ti);
            var at = edge === "start" ? tk(f.clip.start) : tk(f.clip.end);
            if (action === "add") {
                var fx = f.kind === "audio" ? qe.project.getAudioTransitionByName(a.name || "Constant Power") : qe.project.getVideoTransitionByName(a.name || "Cross Dissolve");
                if (!fx) { fail("No " + f.kind + " transition called '" + (a.name || "") + "'."); }
                var qi = qeItemFor(seq, f.kind, f.ti, f.clip);
                var n0 = qt.numTransitions, dn0 = 0;
                try { dn0 = tr.numItems; } catch (eT0) {}
                // addTransition(transition, atStart, duration, offset, alignment 0..1, singleSided, alignToVideo)
                qi.addTransition(fx, edge === "start", durTC(seq, a.duration), durTC(seq, 0), has(a, "alignment") ? a.alignment : 0.5, !!a.single_sided, true);
                var dn = 0;
                try { dn = findClip(seq, { node_id: String(f.clip.nodeId) }).track.transitions.numItems; } catch (eT) {}
                if (qeTrack(seq, f.kind, f.ti).numTransitions <= n0 && dn <= dn0) { fail("Premiere didn't add the transition (is there media to overlap at that edit?)."); }
                did("added " + (a.name || "transition"));
                return { added: true, transitions: list() };
            }
            // remove
            var removed = 0, errs = [];
            for (var i = qt.numTransitions - 1; i >= 0; i--) {
                var t = qt.getTransitionAt(i);
                if (!t) { continue; }
                var s = tk(t.start), e = tk(t.end);
                if (s === null) { try { s = tk(tr[i].start); e = tk(tr[i].end); } catch (x) {} }
                if (s === null || !(s <= at + frameTicks(seq) && e >= at - frameTicks(seq))) { continue; }
                var before = qt.numTransitions;
                try { t.remove(); } catch (e1) { errs.push(e1.message); }
                if (qt.numTransitions < before) { removed++; }
            }
            if (!removed) { fail("Couldn't remove the transition by script" + (errs.length ? " (" + errs.join("; ") + ")" : "") + ". Select it in the Timeline and press Delete, or undo the edit that added it."); }
            did("removed " + removed + " transition(s)");
            return { removed: removed, transitions: list() };
        });
    };

    // ------------------------------------------------------------------ media
    F.v2_media_users = function (a) {
        var out = [];
        var paths = a.paths || [];
        for (var i = 0; i < paths.length; i++) {
            var target = normPath(paths[i]), users = [];
            walkItems(project().rootItem, function (c) {
                var mp = "", pp = "";
                try { mp = c.getMediaPath(); } catch (e) {}
                try { if (c.hasProxy()) { pp = c.getProxyPath(); } } catch (e2) {}
                if ((mp && normPath(mp) === target) || (pp && normPath(pp) === target)) { users.push({ name: c.name, nodeId: String(c.nodeId), as: normPath(mp) === target ? "media" : "proxy" }); }
                return false;
            });
            out.push({ path: paths[i], users: users });
        }
        return out;
    };

    F.v2_replace_media = function (a) {
        var newPath = a.new_path;
        if (!new File(newPath).exists) { fail("The new file doesn't exist: " + newPath); }
        var items = [];
        if (a.node_id) {
            var it = itemByNodeId(a.node_id);
            if (!it) { fail("No project item with node_id " + a.node_id); }
            items.push(it);
        } else {
            var target = normPath(a.old_path);
            walkItems(project().rootItem, function (c) {
                var mp = "";
                try { mp = c.getMediaPath(); } catch (e) {}
                if (mp && normPath(mp) === target) { items.push(c); }
                return false;
            });
            if (!items.length) { fail("Nothing in the project uses " + a.old_path); }
        }
        var done = [];
        for (var i = 0; i < items.length; i++) {
            var c = items[i], old = c.getMediaPath();
            try { if (c.canChangeMediaPath && !c.canChangeMediaPath()) { done.push({ name: c.name, changed: false, why: "Premiere says this item can't be relinked" }); continue; } } catch (e0) {}
            var r = c.changeMediaPath(newPath, true);
            var now = c.getMediaPath();
            done.push({ name: c.name, nodeId: String(c.nodeId), from: old, to: now, changed: normPath(now) === normPath(newPath), result: r });
        }
        return { items: done };
    };

    F.v2_import = function (a) {
        var it = importFile(a.path, a.bin || null);
        return { name: it.name, nodeId: String(it.nodeId), path: it.getMediaPath() };
    };

    // ------------------------------------------------------------------ captions and bleeps
    F.v2_audio_clips = function (a) {
        var seq = getSeq(a.sequence_id);
        var out = { tracks: [], clips: [] };
        for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var tr = seq.audioTracks[t], muted = false;
            try { muted = !!tr.isMuted(); } catch (e) {}
            out.tracks.push({ index: t, name: tr.name, muted: muted });
            for (var c = 0; c < tr.clips.numItems; c++) {
                var r = rec(tr.clips[c], "audio", t, c, true);
                r.trackMuted = muted;
                r.trackName = tr.name;
                out.clips.push(r);
            }
        }
        out.seq = seqInfo(seq);
        return out;
    };

    F.v2_caption_track = function (a) {
        var seq = getSeq(a.sequence_id);
        var item = importFile(a.path, a.bin || "Claude captions");
        var fmt = 0;
        try { fmt = Sequence.CAPTION_FORMAT_SUBTITLE; } catch (e) {}
        var made = false, tries = [], start = has(a, "start") ? a.start : 0;
        var forms = [
            function () { return seq.createCaptionTrack(item, start / TPS, fmt); },
            function () { return seq.createCaptionTrack(item, mkTime(start), fmt); },
            function () { return seq.createCaptionTrack(item, start / TPS); }
        ];
        for (var i = 0; i < forms.length && !made; i++) {
            try { made = !!forms[i](); tries.push("form " + i + ": " + made); } catch (e2) { tries.push("form " + i + ": " + e2.message); }
        }
        if (!made) { fail("Premiere didn't create the caption track (" + tries.join("; ") + "). Import the SRT by hand: File > Import, then drag it onto the sequence."); }
        did("caption track created from " + item.name);
        return { created: true, item: item.name, nodeId: String(item.nodeId) };
    };

    // Place pieces of one audio file (e.g. a bleep tone) at sequence times on one audio track.
    F.v2_place_audio = function (a) {
        var seq = getSeq(a.sequence_id);
        var pi = resolveItem(a.source);
        var t = getTrack(seq, a.track);
        if (t.kind !== "audio") { fail("track must be an audio track (A1, A2, ...)."); }
        var marks = itemMarks(pi), placed = [];
        var ts = allTracks(seq), locks = [];
        for (var k = 0; k < ts.length; k++) {
            if (!(ts[k].kind === "audio" && ts[k].index === t.index) && !ts[k].locked) { try { ts[k].track.setLocked(1); locks.push(ts[k].track); } catch (e) {} }
        }
        try {
            for (var i = 0; i < a.placements.length; i++) {
                var pl = a.placements[i];
                setItemRange(pi, pl.src_in, pl.src_out);
                var before = newClipIds(seq);
                t.track.overwriteClip(pi, tstr(pl.at));
                var fresh = clipsNotIn(seq, before), got = null;
                for (var n = 0; n < fresh.length; n++) {
                    if (fresh[n].kind === "audio" && fresh[n].ti === t.index && !got) { got = fresh[n].clip; }
                    else { fresh[n].clip.remove(false, false); }
                }
                if (!got) { fail("Bleep " + (i + 1) + " wasn't placed (is " + label("audio", t.index) + " locked?)."); }
                var wantEnd = pl.at + (pl.src_out - pl.src_in);
                if (absf(tk(got.end) - wantEnd) > TPS / 200) { try { got.end = mkTime(wantEnd); } catch (e2) {} }
                placed.push({ start: tk(got.start), end: tk(got.end) });
            }
        } finally {
            for (var u = 0; u < locks.length; u++) { try { locks[u].setLocked(0); } catch (e3) {} }
            restoreMarks(pi, marks);
        }
        did("placed " + placed.length + " audio pieces on " + label("audio", t.index));
        return { placed: placed };
    };

    function volumeParam(c) {
        var comp = findComp(c, "Volume");
        if (!comp) { return null; }
        return findParam(comp, ["Level"]);
    }

    // Duck audio clips under each range with Volume keyframes (ramp in/out), keeping the rest untouched.
    F.v2_duck = function (a) {
        var seq = getSeq(a.sequence_id);
        var ramp = a.ramp || Math.round(TPS * 0.008);
        var low = has(a, "level") ? a.level : 0;
        var tracks = a.tracks || [];
        var n = 0, missed = [];
        for (var r = 0; r < a.ranges.length; r++) {
            var R = a.ranges[r];
            for (var ti = 0; ti < tracks.length; ti++) {
                var t = getTrack(seq, tracks[ti]);
                if (t.kind !== "audio") { continue; }
                var cl = t.track.clips;
                for (var c = 0; c < cl.numItems; c++) {
                    var cc = cl[c], s = tk(cc.start), e = tk(cc.end);
                    if (e <= R.start || s >= R.end) { continue; }
                    var pr = volumeParam(cc);
                    if (!pr) { missed.push(cc.name); continue; }
                    var t0 = Math.max(R.start, s), t1 = Math.min(R.end, e);
                    var pts = [Math.max(s, t0 - ramp), t0, t1, Math.min(e, t1 + ramp)];
                    var vals = [];
                    for (var q = 0; q < 4; q++) {
                        var kt = keyTimeFor(cc, (pts[q] - s) / TPS);
                        var base;
                        try { base = pr.isTimeVarying() ? pr.getValueAtTime(kt) : pr.getValue(); } catch (e1) { base = pr.getValue(); }
                        vals.push({ t: kt, v: (q === 1 || q === 2) ? low : base });
                    }
                    if (!pr.isTimeVarying()) { pr.setTimeVarying(true); }
                    for (q = 0; q < 4; q++) { pr.addKey(vals[q].t); pr.setValueAtKey(vals[q].t, vals[q].v, true); }
                    n++;
                }
            }
        }
        did("ducked " + n + " clip ranges");
        return { ducked: n, missingVolume: missed };
    };

    // ------------------------------------------------------------------ audio fades
    // Two traps wreck fades written by hand in a script:
    // - Volume > Level is linear gain with 15 dB of headroom: 0 dB reads 0.1778 (10^(-15/20)), 1.0 is +15 dB and
    //   0 is silence. A key value of 1 meant as "100%" makes the clip 15 dB louder.
    // - Its keyframes sit in the clip's source time (see keyTimeFor). Keys placed at clip-relative times land
    //   outside the clip, so the whole clip plays at one key's level (often silence).
    var SILENT = 0;

    function levelAt(pr, kt) {
        try { if (pr.isTimeVarying()) { return Number(pr.getValueAtTime(kt)); } } catch (e) {}
        return Number(pr.getValue());
    }
    function levelDb(v) { return v > 0 ? Math.round((20 * Math.log(v) / Math.LN10 + 15) * 100) / 100 : null; }

    // Remove keyframes between two key times (inclusive). Returns how many went.
    function removeKeysIn(pr, t0, t1) {
        var keys = null;
        try { if (!pr.isTimeVarying()) { return 0; } keys = pr.getKeys(); } catch (e) { return 0; }
        if (!keys || !keys.length) { return 0; }
        var n = 0;
        for (var i = keys.length - 1; i >= 0; i--) {
            var t = tk(keys[i]);
            if (t >= t0 - 2 && t <= t1 + 2) {
                var before = pr.getKeys().length;
                try { pr.removeKey(keys[i]); } catch (e1) {}
                var after = 0;
                try { after = (pr.getKeys() || []).length; } catch (e2) {}
                if (after < before) { n++; } else { fail("Premiere wouldn't remove the old Volume keyframe at " + secs(t) + "s (source time)."); }
            }
        }
        return n;
    }

    // Fade one audio clip with Volume keyframes; the level in between is left exactly as it was.
    function fadeKeys(seq, c, fin, fout) {
        var pr = volumeParam(c);
        if (!pr) { fail("'" + c.name + "' has no Volume > Level (Premiere adds it to every audio clip; is this an audio clip?)."); }
        try { if (c.isSpeedReversed && c.isSpeedReversed()) { fail("'" + c.name + "' plays reversed; fade it by hand."); } } catch (eR) { if (eR.user) { throw eR; } }
        var L = tk(c.end) - tk(c.start), note = null;
        if (fin + fout > L) {
            var k = L / (fin + fout);
            fin = Math.floor(fin * k); fout = L - fin;
            note = "fades shortened to fit the clip";
        }
        var kS = keyTimeFor(c, 0), kE = keyTimeFor(c, L / TPS);
        var kIn = keyTimeFor(c, fin / TPS), kOut = keyTimeFor(c, (L - fout) / TPS);
        var midT = keyTimeFor(c, (fin + (L - fout - fin) / 2) / TPS);
        // read the levels first: the fade goes from silence to whatever the clip plays at there
        var baseIn = levelAt(pr, kIn), baseOut = levelAt(pr, kOut), baseMid = levelAt(pr, midT);
        var replaced = 0;
        if (fin) { replaced += removeKeysIn(pr, tk(kS), tk(kIn)); }
        if (fout) { replaced += removeKeysIn(pr, tk(kOut), tk(kE)); }
        if (!pr.isTimeVarying()) { pr.setTimeVarying(true); }
        var keys = [];
        if (fin) { keys.push({ t: kS, v: SILENT }); keys.push({ t: kIn, v: baseIn }); }
        if (fout) { keys.push({ t: kOut, v: baseOut }); keys.push({ t: kE, v: SILENT }); }
        for (var i = 0; i < keys.length; i++) {
            pr.addKey(keys[i].t);
            pr.setValueAtKey(keys[i].t, keys[i].v, true);
            var got = Number(pr.getValueAtKey(keys[i].t));
            var good = keys[i].v === SILENT ? got <= 0.001 : absf(got - keys[i].v) <= Math.max(1e-6, keys[i].v * 1e-4);
            if (!good) { fail("'" + c.name + "': Volume keyframe at " + secs(tk(keys[i].t)) + "s (source time) reads " + got + " instead of " + keys[i].v + "."); }
        }
        var nowMid = levelAt(pr, midT);
        if (absf(nowMid - baseMid) > Math.max(1e-6, baseMid * 1e-3)) {
            fail("'" + c.name + "': the level between the fades changed (" + levelDb(baseMid) + " dB -> " + levelDb(nowMid) + " dB).");
        }
        return { fadeIn: fin, fadeOut: fout, replacedKeys: replaced, levelDb: levelDb(baseMid), note: note };
    }

    function trackShape(track) {
        var cl = track.clips, o = [];
        for (var i = 0; i < cl.numItems; i++) { o.push(tk(cl[i].start) + ":" + tk(cl[i].end) + ":" + srcIn(cl[i]) + ":" + String(cl[i].nodeId)); }
        return o.join("|");
    }
    function transList(track) {
        var o = [];
        try { var tr = track.transitions; for (var i = 0; i < tr.numItems; i++) { o.push({ name: tr[i].name, start: tk(tr[i].start), end: tk(tr[i].end) }); } } catch (e) {}
        return o;
    }
    function removeTransitionsIn(seq, kind, ti, s, e) {
        var qt = qeTrack(seq, kind, ti), n = 0, tr = trackColl(seq, kind)[ti].transitions;
        for (var i = qt.numTransitions - 1; i >= 0; i--) {
            var t = qt.getTransitionAt(i);
            if (!t) { continue; }
            var ts = tk(t.start), te = tk(t.end);
            if (ts === null) { try { ts = tk(tr[i].start); te = tk(tr[i].end); } catch (x) {} }
            if (ts === null || ts < s - 2 || te > e + 2) { continue; }
            var before = qt.numTransitions;
            try { t.remove(); } catch (e1) {}
            if (qt.numTransitions < before) { n++; }
        }
        return n;
    }

    // Fade one edge of an audio clip with one of Premiere's audio transitions, on this clip only (single-sided),
    // inside the clip. Which alignment value does that is learnt on first use and checked every time.
    function fadeTransition(seq, f, edge, dur, shape) {
        var fx = qe.project.getAudioTransitionByName(shape);
        if (!fx) { fail("Premiere has no audio transition called '" + shape + "'. Try Constant Power, Constant Gain or Exponential Fade."); }
        var s = tk(f.clip.start), e = tk(f.clip.end), ft = frameTicks(seq);
        var lo = edge === "start" ? s : e - dur, hi = edge === "start" ? s + dur : e;
        var tr0 = transList(f.track);
        for (var x = 0; x < tr0.length; x++) {
            if (tr0[x].start < (edge === "start" ? s + ft : e) && tr0[x].end > (edge === "start" ? s : e - ft)) { return { skipped: "already has a transition (" + tr0[x].name + ") at its " + edge }; }
        }
        var shape0 = trackShape(f.track);
        V.fadeAlign = V.fadeAlign || {};
        var forms = has(V.fadeAlign, edge) ? [V.fadeAlign[edge]] : (edge === "start" ? [0, 1] : [1, 0]);
        for (var i = 0; i < forms.length; i++) {
            var qi = qeItemFor(seq, "audio", f.ti, f.clip);
            qi.addTransition(fx, edge === "start", durTC(seq, dur), durTC(seq, 0), forms[i], true, true);
            var fr = findClip(seq, { node_id: String(f.clip.nodeId) });
            f.clip = fr.clip; f.track = fr.track; f.ti = fr.ti;
            if (trackShape(fr.track) !== shape0) { fail("Premiere moved or trimmed clips on " + label("audio", fr.ti) + " while adding the " + shape + " fade to '" + f.clip.name + "'."); }
            var tr1 = transList(fr.track), added = null;
            for (var y = 0; y < tr1.length && !added; y++) {
                var seen = false;
                for (var z = 0; z < tr0.length; z++) { if (tr0[z].start === tr1[y].start && tr0[z].end === tr1[y].end) { seen = true; } }
                if (!seen) { added = tr1[y]; }
            }
            if (!added) { fail("Premiere didn't add the " + shape + " fade at the " + edge + " of '" + f.clip.name + "'."); }
            if (added.start >= lo - ft / 2 && added.end <= hi + ft / 2) {
                V.fadeAlign[edge] = forms[i];
                return { start: added.start, end: added.end, name: added.name };
            }
            // it went on the wrong side of the cut: take it off and try the other alignment
            if (!removeTransitionsIn(seq, "audio", f.ti, added.start, added.end)) {
                fail("The " + shape + " fade landed outside '" + f.clip.name + "' (" + qeTC(seq, added.start) + "-" + qeTC(seq, added.end) + ") and couldn't be removed by script: select it in the Timeline and press Delete.");
            }
        }
        fail("Premiere wouldn't put the " + shape + " fade inside '" + f.clip.name + "'.");
    }

    // Audio clips to fade for one reference: the clip itself (if audio), plus its linked audio.
    function audioTargets(seq, ref, includeLinked) {
        var f = findClip(seq, ref), out = [];
        if (f.kind === "audio") { out.push(f); }
        if (f.kind === "video" || includeLinked !== false) {
            var li = null;
            try { li = f.clip.getLinkedItems(); } catch (e) {}
            if (li) {
                for (var i = 0; i < li.numItems; i++) {
                    var mt = "";
                    try { mt = String(li[i].mediaType); } catch (e2) {}
                    if (mt !== "Audio") { continue; }
                    try { out.push(findClip(seq, { node_id: String(li[i].nodeId) })); } catch (e3) {}
                }
            }
        }
        return out;
    }

    // Same take carrying on across a cut (same media, the source continues): fading there would make a dip.
    function throughEdit(x, y) {
        if (!x || !y) { return false; }
        if (absf(tk(x.end) - tk(y.start)) > 2) { return false; }
        var px = "", py = "";
        try { px = x.projectItem.getMediaPath(); py = y.projectItem.getMediaPath(); } catch (e) { return false; }
        if (!px || normPath(px) !== normPath(py)) { return false; }
        if (speedOf(x) !== speedOf(y)) { return false; }
        return absf(srcOut(x) - srcIn(y)) <= TPS / 200;
    }

    F.v2_audio_fade = function (a) {
        var seq = getSeq(a.sequence_id);
        var fin = num(a.fade_in, 0), fout = num(a.fade_out, 0);
        if (!(fin > 0) && !(fout > 0)) { fail("Give fade_in and/or fade_out (more than 0)."); }
        var method = a.method === "transition" ? "transition" : "keyframes";
        var shape = a.shape || "Constant Power";
        // 1. collect the clips (and which edges) before changing anything
        var jobs = [], seen = {}, skipped = [], i, k;
        function add(f, wantIn, wantOut) {
            var id = String(f.clip.nodeId);
            if (seen[id]) { return; }
            seen[id] = true;
            jobs.push({ f: f, fin: wantIn ? fin : 0, fout: wantOut ? fout : 0 });
        }
        if (a.range) {
            var A = a.range.start, Z = a.range.end;
            var tl = a.tracks && a.tracks.length ? a.tracks : null, ts = allTracks(seq);
            for (i = 0; i < ts.length; i++) {
                if (ts[i].kind !== "audio") { continue; }
                if (tl) { var on = false; for (k = 0; k < tl.length; k++) { var p = parseTrack(tl[k]); if (p.kind === "audio" && p.index === ts[i].index) { on = true; } } if (!on) { continue; } }
                if (ts[i].locked) { skipped.push({ track: ts[i].label, why: "track is locked" }); continue; }
                var cl = ts[i].track.clips;
                for (var c = 0; c < cl.numItems; c++) {
                    var s = tk(cl[c].start), e = tk(cl[c].end);
                    if (e <= A || s >= Z) { continue; }
                    var wIn = fin > 0 && s >= A && s < Z, wOut = fout > 0 && e > A && e <= Z;
                    if (a.through_edits !== "fade") {
                        if (wIn && c > 0 && throughEdit(cl[c - 1], cl[c])) { wIn = false; skipped.push({ track: ts[i].label, at: s, why: "start: same take carries on from the clip before" }); }
                        if (wOut && c + 1 < cl.numItems && throughEdit(cl[c], cl[c + 1])) { wOut = false; skipped.push({ track: ts[i].label, at: e, why: "end: same take carries on into the next clip" }); }
                    }
                    if (wIn || wOut) { add({ clip: cl[c], kind: "audio", ti: ts[i].index, ci: c, track: ts[i].track }, wIn, wOut); }
                }
            }
        } else {
            var refs = a.clips || [];
            if (!refs.length) { fail("Give clips, or a range."); }
            for (i = 0; i < refs.length; i++) {
                var tg = audioTargets(seq, refs[i], a.include_linked);
                if (!tg.length) { skipped.push({ clip: refs[i], why: "no audio clip there (a video clip with no linked audio?)" }); }
                for (k = 0; k < tg.length; k++) {
                    var tt = allTracks(seq), lk = false;
                    for (var q = 0; q < tt.length; q++) { if (tt[q].kind === "audio" && tt[q].index === tg[k].ti) { lk = tt[q].locked; } }
                    if (lk) { skipped.push({ track: label("audio", tg[k].ti), at: tk(tg[k].clip.start), why: "track is locked" }); continue; }
                    add(tg[k], true, true);
                }
            }
        }
        if (!jobs.length) { return { faded: [], skipped: skipped, method: method }; }
        var run = function () {
            var out = [];
            for (var j = 0; j < jobs.length; j++) {
                var J = jobs[j], f = J.f, r = { clip: rec(f.clip, "audio", f.ti, f.ci, false) };
                if (method === "keyframes") {
                    var kr = fadeKeys(seq, f.clip, J.fin, J.fout);
                    r.fadeIn = kr.fadeIn; r.fadeOut = kr.fadeOut; r.replacedKeys = kr.replacedKeys; r.levelDb = kr.levelDb;
                    if (kr.note) { r.note = kr.note; }
                } else {
                    var L = tk(f.clip.end) - tk(f.clip.start);
                    if (J.fin + J.fout > L) { fail("'" + f.clip.name + "' is shorter than the two fades together."); }
                    if (J.fin) { var t1 = fadeTransition(seq, f, "start", J.fin, shape); if (t1.skipped) { r.inSkipped = t1.skipped; } else { r.fadeIn = J.fin; } }
                    if (J.fout) { var t2 = fadeTransition(seq, f, "end", J.fout, shape); if (t2.skipped) { r.outSkipped = t2.skipped; } else { r.fadeOut = J.fout; } }
                }
                did("faded " + label("audio", f.ti) + " '" + f.clip.name + "' at " + qeTC(seq, tk(f.clip.start)));
                out.push(r);
            }
            return { faded: out, skipped: skipped, method: method, shape: method === "transition" ? shape : null };
        };
        if (method === "transition") { qeSeqFor(seq); }
        return edit(a, seq, "audio fades", run);
    };

    // Place a still (title card PNG) on a video track for a duration.
    F.v2_place_still = function (a) {
        var seq = getSeq(a.sequence_id);
        var pi = importFile(a.path, a.bin || "Claude titles");
        var t = getTrack(seq, a.track || "V2");
        if (t.kind !== "video") { fail("track must be a video track."); }
        return guarded(a, function () {
            var ts = allTracks(seq), locks = [];
            for (var k = 0; k < ts.length; k++) {
                if (!(ts[k].kind === "video" && ts[k].index === t.index) && !ts[k].locked) { try { ts[k].track.setLocked(1); locks.push(ts[k].track); } catch (e) {} }
            }
            var got = null;
            try {
                var before = newClipIds(seq);
                t.track.overwriteClip(pi, tstr(a.at));
                var fresh = clipsNotIn(seq, before);
                for (var n = 0; n < fresh.length; n++) { if (fresh[n].kind === "video" && fresh[n].ti === t.index && !got) { got = fresh[n].clip; } else { fresh[n].clip.remove(false, false); } }
            } finally {
                for (var u = 0; u < locks.length; u++) { try { locks[u].setLocked(0); } catch (e2) {} }
            }
            if (!got) { fail("The title wasn't placed."); }
            var want = a.at + a.duration;
            if (absf(tk(got.end) - want) > 2) { try { got.end = mkTime(want); } catch (e3) {} }
            if (absf(tk(got.end) - want) > frameTicks(seq) / 2) { did("title placed, but its length is " + secs(tk(got.end) - tk(got.start)) + "s (Premiere's still-image default); drag it longer if needed"); }
            return { clip: rec(got, "video", t.index, 0, true) };
        });
    };

    // ------------------------------------------------------------------ diagnostics (used by the scratch tests)
    F.v2_set_key_base = function (a) { V.keyBase = a.base === "clip" ? "clip" : (a.base === "media" ? "media" : null); return { keyBase: V.keyBase }; };

    // Fix for panels older than 2.0: their exec() ran scripts in its own scope, so a script declaring
    // `var ok` broke it ("ok is not a function"). Same results, run in an isolated scope.
    if (!B.execIsolated) {
        B.exec = function (src) {
            try {
                return B.stringify({ ok: true, result: __claudeBridgeEval2(src) });
            } catch (e) {
                var info = { ok: false, error: (e && e.message) ? e.message : String(e) };
                try { if (e && e.line) { info.line = e.line; } } catch (y) {}
                return B.stringify(info);
            }
        };
        B.execIsolated = true;
    }

    B.v2 = V;
})(__claudeBridge);
