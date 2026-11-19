/*
 * Claude Bridge — Premiere Pro helpers. Requires bridge.jsx to be loaded first.
 * Times exchanged with Claude are always in seconds.
 */
(function (B) {
    var U = B.util;
    var TICKS = 254016000000;
    var MEDIA_ALL = 4;
    var fns = B.fns;

    function ticks(sec) { return String(Math.round(sec * TICKS)); }

    function secs(t) {
        if (t === undefined || t === null) { return null; }
        if (typeof t === "number") { return t; }
        if (typeof t === "string") { return parseFloat(t) / TICKS; }
        try { if (t.seconds !== undefined) { return Number(t.seconds); } } catch (e) {}
        return null;
    }

    function r3(v) { return v === null ? null : U.round(v, 3); }

    function project() {
        if (!app.project) { throw new Error("No Premiere Pro project is open."); }
        return app.project;
    }

    function itemTypeName(t) {
        if (t === 1) { return "clip"; }
        if (t === 2) { return "bin"; }
        if (t === 3) { return "root"; }
        if (t === 4) { return "file"; }
        return String(t);
    }

    function getSequence(id) {
        var p = project();
        if (id === undefined || id === null || id === "") {
            if (!p.activeSequence) { throw new Error("No active sequence. Open a sequence or pass sequence_id."); }
            return p.activeSequence;
        }
        for (var i = 0; i < p.sequences.numSequences; i++) {
            var s = p.sequences[i];
            if (String(s.sequenceID) === String(id) || s.name === id) { return s; }
        }
        throw new Error("Sequence not found: " + id);
    }

    function seqFps(seq) {
        try { var tb = parseFloat(seq.timebase); if (tb > 0) { return U.round(TICKS / tb, 3); } } catch (e) {}
        return null;
    }

    function seqSummary(seq) {
        var info = { id: String(seq.sequenceID), name: seq.name, fps: seqFps(seq) };
        try { info.duration = r3(secs(seq.end) - secs(seq.zeroPoint || "0")); } catch (e) { info.duration = null; }
        try { var st = seq.getSettings(); info.width = st.videoFrameWidth; info.height = st.videoFrameHeight; } catch (e2) {}
        return info;
    }

    // ---------- project items ----------
    function walk(item, path, depth, maxDepth, out, limit, includeFiles) {
        if (!item || !item.children) { return; }
        for (var i = 0; i < item.children.numItems; i++) {
            if (out.length >= limit) { return; }
            var c = item.children[i];
            var p = path + "/" + c.name;
            var isBin = c.type === 2;
            if (isBin || includeFiles) {
                var e = { name: c.name, type: itemTypeName(c.type), path: p, nodeId: c.nodeId };
                if (!isBin) { try { e.mediaPath = c.getMediaPath(); } catch (x) {} }
                out.push(e);
            }
            if (isBin && depth < maxDepth) { walk(c, p, depth + 1, maxDepth, out, limit, includeFiles); }
        }
    }

    function findItem(pred, item) {
        item = item || project().rootItem;
        for (var i = 0; i < item.children.numItems; i++) {
            var c = item.children[i];
            if (c.type === 2) {
                var hit = findItem(pred, c);
                if (hit) { return hit; }
            } else if (pred(c)) {
                return c;
            }
        }
        return null;
    }

    function findByPath(path) {
        var target = U.normPath(path);
        return findItem(function (c) {
            try { return U.normPath(c.getMediaPath()) === target; } catch (e) { return false; }
        });
    }

    function findByNodeId(id) {
        return findItem(function (c) { return String(c.nodeId) === String(id); });
    }

    function getOrCreateBin(name) {
        var root = project().rootItem;
        for (var i = 0; i < root.children.numItems; i++) {
            var c = root.children[i];
            if (c.type === 2 && c.name === name) { return c; }
        }
        var bin = root.createBin(name);
        if (bin) { return bin; }
        for (var j = 0; j < root.children.numItems; j++) {
            if (root.children[j].type === 2 && root.children[j].name === name) { return root.children[j]; }
        }
        throw new Error("Could not create bin: " + name);
    }

    function importPaths(paths, bin) {
        var target = bin || project().getInsertionBin();
        var need = [];
        for (var i = 0; i < paths.length; i++) { if (!findByPath(paths[i])) { need.push(paths[i]); } }
        if (need.length) { project().importFiles(need, true, target, false); }
        var items = [];
        for (var k = 0; k < paths.length; k++) {
            var it = findByPath(paths[k]);
            items.push({ path: paths[k], found: !!it, nodeId: it ? it.nodeId : null, name: it ? it.name : null });
        }
        return items;
    }

    function resolveSource(seg, bin) {
        var it = null;
        if (U.has(seg, "nodeId")) { it = findByNodeId(seg.nodeId); }
        if (!it && U.has(seg, "path")) {
            it = findByPath(seg.path);
            if (!it) { importPaths([seg.path], bin); it = findByPath(seg.path); }
        }
        if (!it) { throw new Error("Could not find or import source: " + (seg.path || seg.nodeId)); }
        return it;
    }

    // ---------- timeline reading ----------
    function clipInfo(c) {
        var info = {
            name: c.name,
            start: r3(secs(c.start)),
            end: r3(secs(c.end)),
            "in": r3(secs(c.inPoint)),
            out: r3(secs(c.outPoint))
        };
        try { info.nodeId = c.nodeId; } catch (e0) {}
        try { if (c.projectItem) { info.mediaPath = c.projectItem.getMediaPath(); info.sourceNodeId = c.projectItem.nodeId; } } catch (e) {}
        try { info.disabled = !!c.disabled; } catch (e2) {}
        try { info.selected = !!c.isSelected(); } catch (e3) {}
        return info;
    }

    function trackInfo(t, idx, kind, maxClips) {
        var info = { index: idx, kind: kind, name: t.name, clipCount: t.clips.numItems, clips: [] };
        try { info.muted = !!t.isMuted(); } catch (e) {}
        try { info.locked = !!t.isLocked(); } catch (e2) {}
        for (var i = 0; i < t.clips.numItems && i < maxClips; i++) { info.clips.push(clipInfo(t.clips[i])); }
        if (t.clips.numItems > maxClips) { info.truncated = true; }
        return info;
    }

    function markerList(seq, limit) {
        var out = [];
        try {
            var ms = seq.markers;
            var m = ms.getFirstMarker();
            while (m && out.length < limit) {
                var e = { name: m.name, comment: m.comments, start: r3(secs(m.start)), end: r3(secs(m.end)) };
                try { e.type = m.type; } catch (x) {}
                try { e.color = m.getColorByIndex(0); } catch (y) {}
                out.push(e);
                m = ms.getNextMarker(m);
            }
        } catch (e2) {}
        return out;
    }

    // ---------- range + placement helpers (verify, then fall back) ----------
    function close(a, b, tol) { return a !== null && b !== null && Math.abs(a - b) <= tol; }

    function setItemPoint(item, which, sec) {
        var setter = which === "in" ? "setInPoint" : "setOutPoint";
        var getter = which === "in" ? "getInPoint" : "getOutPoint";
        // Documented form is a ticks string; the others are fallbacks for older/newer builds.
        var attempts = [
            function () { item[setter](ticks(sec), MEDIA_ALL); },
            function () { var t = new Time(); t.seconds = sec; item[setter](t, MEDIA_ALL); },
            function () { item[setter](sec, MEDIA_ALL); }
        ];
        var last = null;
        for (var i = 0; i < attempts.length; i++) {
            try {
                attempts[i]();
                var got = secs(item[getter]());
                if (close(got, sec, 0.05)) { return true; }
                last = "read back " + got + "s";
            } catch (e) { last = e.message; }
        }
        throw new Error("Could not set " + which + " point on '" + item.name + "' to " + sec + "s (" + last + ")");
    }

    function clearItemRange(item) {
        try { item.clearInPoint(); } catch (e) {}
        try { item.clearOutPoint(); } catch (e2) {}
    }

    function clipAt(track, sec) {
        for (var i = 0; i < track.clips.numItems; i++) {
            if (close(secs(track.clips[i].start), sec, 0.05)) { return track.clips[i]; }
        }
        return null;
    }

    function clipIds(seq) {
        var ids = {};
        var groups = [seq.videoTracks, seq.audioTracks];
        for (var g = 0; g < groups.length; g++) {
            for (var t = 0; t < groups[g].numTracks; t++) {
                var tr = groups[g][t];
                for (var c = 0; c < tr.clips.numItems; c++) { ids[String(tr.clips[c].nodeId)] = true; }
            }
        }
        return ids;
    }

    // Remove anything a failed placement attempt added, so a retry can't leave junk on the timeline.
    function removeNewClips(seq, before) {
        var groups = [seq.videoTracks, seq.audioTracks];
        for (var g = 0; g < groups.length; g++) {
            for (var t = 0; t < groups[g].numTracks; t++) {
                var tr = groups[g][t];
                for (var c = tr.clips.numItems - 1; c >= 0; c--) {
                    if (!before[String(tr.clips[c].nodeId)]) { try { tr.clips[c].remove(false, false); } catch (e) {} }
                }
            }
        }
    }

    function overwriteAt(seq, track, item, sec) {
        // Documented form is a ticks string; the others are fallbacks.
        var attempts = [
            function () { track.overwriteClip(item, ticks(sec)); },
            function () { var t = new Time(); t.seconds = sec; track.overwriteClip(item, t); },
            function () { track.overwriteClip(item, sec); }
        ];
        var last = null;
        for (var i = 0; i < attempts.length; i++) {
            var before = clipIds(seq);
            try {
                attempts[i]();
                if (clipAt(track, sec)) { return true; }
                last = "clip did not land at " + sec + "s";
            } catch (e) { last = e.message; }
            removeNewClips(seq, before);
        }
        throw new Error("Could not place '" + item.name + "' at " + sec + "s (" + last + ")");
    }

    function clearSequence(seq) {
        var groups = [seq.videoTracks, seq.audioTracks];
        for (var g = 0; g < groups.length; g++) {
            for (var t = 0; t < groups[g].numTracks; t++) {
                var tr = groups[g][t];
                for (var c = tr.clips.numItems - 1; c >= 0; c--) {
                    try { tr.clips[c].remove(false, false); } catch (e) {}
                }
            }
        }
    }

    // ================= registered functions =================

    fns.ppro_status = function () {
        var info = { app: "Premiere Pro", version: app.version, projectOpen: !!app.project };
        if (app.project) {
            info.project = app.project.name;
            info.projectPath = app.project.path;
            info.activeSequence = app.project.activeSequence ? app.project.activeSequence.name : null;
        }
        return info;
    };

    fns.ppro_get_project = function (a) {
        var p = project();
        var seqs = [];
        for (var i = 0; i < p.sequences.numSequences; i++) { seqs.push(seqSummary(p.sequences[i])); }
        var items = [];
        walk(p.rootItem, "", 0, U.num(a.max_depth, 4), items, U.num(a.max_items, 300), a.include_items !== false);
        return {
            name: p.name,
            path: p.path,
            activeSequenceId: p.activeSequence ? String(p.activeSequence.sequenceID) : null,
            sequences: seqs,
            items: items,
            itemsTruncated: items.length >= U.num(a.max_items, 300)
        };
    };

    fns.ppro_get_sequence = function (a) {
        var seq = getSequence(a.sequence_id);
        var info = seqSummary(seq);
        var maxClips = U.num(a.max_clips_per_track, 300);
        try { info.playhead = r3(secs(seq.getPlayerPosition())); } catch (e) {}
        try { info.inPoint = r3(parseFloat(seq.getInPoint())); info.outPoint = r3(parseFloat(seq.getOutPoint())); } catch (e2) {}
        info.videoTracks = [];
        info.audioTracks = [];
        for (var v = 0; v < seq.videoTracks.numTracks; v++) { info.videoTracks.push(trackInfo(seq.videoTracks[v], v, "video", maxClips)); }
        for (var au = 0; au < seq.audioTracks.numTracks; au++) { info.audioTracks.push(trackInfo(seq.audioTracks[au], au, "audio", maxClips)); }
        info.markers = markerList(seq, 500);
        return info;
    };

    fns.ppro_open_sequence = function (a) {
        var seq = getSequence(a.sequence_id);
        var opened = project().openSequence(seq.sequenceID);
        return { opened: opened !== false, sequence: seqSummary(seq) };
    };

    fns.ppro_set_playhead = function (a) {
        var seq = getSequence(a.sequence_id);
        seq.setPlayerPosition(ticks(a.seconds));
        return { playhead: r3(secs(seq.getPlayerPosition())) };
    };

    fns.ppro_import = function (a) {
        if (!a.paths || !a.paths.length) { throw new Error("paths is required"); }
        var bin = a.bin ? getOrCreateBin(a.bin) : null;
        return { items: importPaths(a.paths, bin) };
    };

    fns.ppro_add_markers = function (a) {
        var seq = getSequence(a.sequence_id);
        var added = [];
        for (var i = 0; i < a.markers.length; i++) {
            var spec = a.markers[i];
            var m = seq.markers.createMarker(spec.time);
            if (spec.name) { m.name = spec.name; }
            if (spec.comment) { m.comments = spec.comment; }
            if (U.has(spec, "duration") && spec.duration > 0) { m.end = spec.time + spec.duration; }
            if (U.has(spec, "color")) { try { m.setColorByIndex(spec.color); } catch (e) {} }
            added.push({ name: spec.name || "", start: spec.time });
        }
        return { added: added.length, markers: added };
    };

    // Build a new sequence from source ranges (a rough cut / selects reel).
    fns.ppro_build_sequence = function (a) {
        if (!a.segments || !a.segments.length) { throw new Error("segments is required"); }
        var bin = a.bin ? getOrCreateBin(a.bin) : null;
        var sources = [];
        for (var i = 0; i < a.segments.length; i++) { sources.push(resolveSource(a.segments[i], bin)); }

        var seq = project().createNewSequenceFromClips(a.name, [sources[0]], bin || project().getInsertionBin());
        if (!seq) { throw new Error("Premiere did not create the sequence."); }
        clearSequence(seq);

        var cursor = 0;
        var placed = [];
        var touched = [];
        try {
            for (var s = 0; s < a.segments.length; s++) {
                var seg = a.segments[s];
                var item = sources[s];
                if (!(seg.out > seg["in"])) { throw new Error("Segment " + s + " has out <= in"); }
                if (!U.contains(touched, item)) { touched.push(item); }
                clearItemRange(item);
                setItemPoint(item, "in", seg["in"]);
                setItemPoint(item, "out", seg.out);
                var vt = U.num(seg.video_track, 0);
                var track = seq.videoTracks.numTracks > vt ? seq.videoTracks[vt] : null;
                var hasVideo = true;
                try { hasVideo = item.getMediaPath() ? !/\.(wav|mp3|aif|aiff|m4a|aac|flac)$/i.test(item.getMediaPath()) : true; } catch (e0) {}
                if (!hasVideo || !track) { track = seq.audioTracks[U.num(seg.audio_track, 0)]; }
                overwriteAt(seq, track, item, cursor);
                placed.push({ index: s, source: item.name, "in": seg["in"], out: seg.out, start: r3(cursor), label: seg.label || null });
                cursor += seg.out - seg["in"];
            }
        } finally {
            for (var k = 0; k < touched.length; k++) { clearItemRange(touched[k]); }
        }
        try { project().openSequence(seq.sequenceID); } catch (e1) {}
        return { sequence: seqSummary(seq), placed: placed, totalDuration: r3(cursor) };
    };

    fns.ppro_export_frame = function (a) {
        var seq = getSequence(a.sequence_id);
        project().openSequence(seq.sequenceID);
        if (U.has(a, "seconds")) { seq.setPlayerPosition(ticks(a.seconds)); }
        app.enableQE();
        var q = qe.project.getActiveSequence();
        var tc = q.CTI.timecode;
        q.exportFramePNG(tc, a.path);
        return { timecode: tc, path: a.path };
    };

    fns.ppro_export = function (a) {
        var seq = getSequence(a.sequence_id);
        var ranges = { entire: 0, in_out: 1, work_area: 2 };
        var range = ranges.hasOwnProperty(a.range) ? ranges[a.range] : 0;
        if (a.mode === "ame") {
            app.encoder.launchEncoder();
            var job = app.encoder.encodeSequence(seq, a.output_path, a.preset_path, range, 1);
            app.encoder.startBatch();
            return { queued: true, jobId: job, output: a.output_path };
        }
        var res = seq.exportAsMediaDirect(a.output_path, a.preset_path, range);
        return { exported: true, result: res, output: a.output_path };
    };

    fns.ppro_save = function () {
        project().save();
        return { saved: true, path: project().path };
    };

    fns.ppro_open_project = function (a) {
        var opened = app.openDocument(a.path, true, true, true);
        return { opened: !!opened, path: a.path };
    };

    B.hostLoaded = "PPRO";
})(__claudeBridge);
