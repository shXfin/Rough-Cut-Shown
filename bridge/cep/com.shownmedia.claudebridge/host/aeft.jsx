/*
 * Claude Bridge — After Effects helpers. Requires bridge.jsx to be loaded first.
 * Every change is wrapped in an undo group, so Cmd+Z reverts one Claude action at a time.
 */
(function (B) {
    var U = B.util;
    var fns = B.fns;

    function r3(v) { return (typeof v === "number") ? U.round(v, 3) : v; }

    function undoable(label, fn) {
        return function (a) {
            app.beginUndoGroup("Claude: " + label);
            try { return fn(a || {}); } finally { app.endUndoGroup(); }
        };
    }

    function itemById(id) {
        try { var it = app.project.itemByID(id); if (it) { return it; } } catch (e) {}
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i).id === id) { return app.project.item(i); }
        }
        return null;
    }

    function getComp(a) {
        var c = null;
        if (U.has(a, "comp_id")) {
            c = itemById(a.comp_id);
        } else if (U.has(a, "comp_name")) {
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (it instanceof CompItem && it.name === a.comp_name) { c = it; break; }
            }
        } else {
            c = app.project.activeItem;
        }
        if (!(c instanceof CompItem)) {
            throw new Error("Composition not found. Pass comp_id or comp_name, or open a comp in the viewer.");
        }
        return c;
    }

    function getLayer(comp, a) {
        var l = null;
        if (U.has(a, "layer_index")) { l = comp.layer(a.layer_index); }
        else if (U.has(a, "layer_name")) { l = comp.layer(a.layer_name); }
        if (!l) { throw new Error("Layer not found in '" + comp.name + "'. Pass layer_index or layer_name."); }
        return l;
    }

    function layerType(l) {
        try {
            if (l instanceof TextLayer) { return "text"; }
            if (l instanceof ShapeLayer) { return "shape"; }
            if (l instanceof CameraLayer) { return "camera"; }
            if (l instanceof LightLayer) { return "light"; }
            if (l.nullLayer) { return "null"; }
            if (l.adjustmentLayer) { return "adjustment"; }
            if (l.source instanceof CompItem) { return "precomp"; }
            if (l.source && l.source.mainSource instanceof SolidSource) { return "solid"; }
            if (l.source && !l.hasVideo && l.hasAudio) { return "audio"; }
            if (l.source) { return "footage"; }
        } catch (e) {}
        return "layer";
    }

    function layerInfo(l) {
        var info = {
            index: l.index,
            name: l.name,
            type: layerType(l),
            enabled: l.enabled,
            inPoint: r3(l.inPoint),
            outPoint: r3(l.outPoint),
            startTime: r3(l.startTime)
        };
        try { info.parent = l.parent ? l.parent.index : null; } catch (e) {}
        try { if (l.source) { info.source = { id: l.source.id, name: l.source.name }; } } catch (e2) {}
        try { if (info.type === "text") { info.text = l.property("ADBE Text Properties").property("ADBE Text Document").value.text; } } catch (e3) {}
        try {
            var tr = l.property("ADBE Transform Group");
            info.position = tr.property("ADBE Position").value;
            info.scale = tr.property("ADBE Scale").value;
            info.opacity = tr.property("ADBE Opacity").value;
        } catch (e4) {}
        return info;
    }

    function compSummary(c) {
        return {
            id: c.id, name: c.name, width: c.width, height: c.height,
            duration: r3(c.duration), fps: r3(c.frameRate), numLayers: c.numLayers
        };
    }

    function itemSummary(it) {
        var s = { id: it.id, name: it.name, type: it.typeName };
        try { s.folder = it.parentFolder ? it.parentFolder.name : null; } catch (e) {}
        if (it instanceof CompItem) {
            var cs = compSummary(it);
            s.width = cs.width; s.height = cs.height; s.duration = cs.duration; s.fps = cs.fps; s.numLayers = cs.numLayers;
        } else if (it instanceof FootageItem) {
            try { if (it.file) { s.file = it.file.fsName; } } catch (e2) {}
            try { s.width = it.width; s.height = it.height; s.duration = r3(it.duration); } catch (e3) {}
        }
        return s;
    }

    function walkProperty(layer, path) {
        if (!(path instanceof Array)) { path = [path]; }
        var p = layer;
        for (var i = 0; i < path.length; i++) {
            p = p.property(path[i]);
            if (!p) { throw new Error("Property not found: " + path.slice(0, i + 1).join(" > ")); }
        }
        return p;
    }

    function readValue(p) {
        var v = p.value;
        try { if (p.propertyValueType === PropertyValueType.TEXT_DOCUMENT) { return v.text; } } catch (e) {}
        return v;
    }

    function coerceValue(p, value, time) {
        try {
            if (p.propertyValueType === PropertyValueType.TEXT_DOCUMENT && typeof value === "string") {
                var td = (time === null || time === undefined) ? p.value : p.valueAtTime(time, true);
                td.text = value;
                return td;
            }
        } catch (e) {}
        return value;
    }

    function importOne(path) {
        var f = new File(path);
        if (!f.exists) { throw new Error("File not found: " + path); }
        var io = new ImportOptions(f);
        return app.project.importFile(io);
    }

    // ================= registered functions =================

    fns.ae_status = function () {
        var info = { app: "After Effects", version: app.version, projectOpen: !!app.project };
        try { info.projectPath = app.project.file ? app.project.file.fsName : null; } catch (e) {}
        try { info.activeComp = (app.project.activeItem instanceof CompItem) ? app.project.activeItem.name : null; } catch (e2) {}
        return info;
    };

    fns.ae_get_project = function (a) {
        var items = [];
        var limit = U.num(a.max_items, 500);
        for (var i = 1; i <= app.project.numItems && items.length < limit; i++) {
            items.push(itemSummary(app.project.item(i)));
        }
        var active = app.project.activeItem;
        return {
            path: app.project.file ? app.project.file.fsName : null,
            numItems: app.project.numItems,
            activeCompId: (active instanceof CompItem) ? active.id : null,
            items: items
        };
    };

    fns.ae_get_comp = function (a) {
        var c = getComp(a);
        var info = compSummary(c);
        info.currentTime = r3(c.time);
        info.workArea = { start: r3(c.workAreaStart), duration: r3(c.workAreaDuration) };
        info.layers = [];
        for (var i = 1; i <= c.numLayers; i++) { info.layers.push(layerInfo(c.layer(i))); }
        info.markers = [];
        try {
            var mk = c.markerProperty;
            for (var k = 1; k <= mk.numKeys; k++) {
                info.markers.push({ time: r3(mk.keyTime(k)), comment: mk.keyValue(k).comment });
            }
        } catch (e) {}
        return info;
    };

    fns.ae_create_comp = undoable("Create comp", function (a) {
        var c = app.project.items.addComp(
            a.name || "Claude Comp",
            U.num(a.width, 1920), U.num(a.height, 1080), 1,
            U.num(a.duration, 10), U.num(a.fps, 30)
        );
        if (a.bg_color) { c.bgColor = a.bg_color; }
        try { c.openInViewer(); } catch (e) {}
        return compSummary(c);
    });

    fns.ae_import = undoable("Import", function (a) {
        if (!a.paths || !a.paths.length) { throw new Error("paths is required"); }
        var comp = (U.has(a, "comp_id") || U.has(a, "comp_name") || a.add_to_active_comp) ? getComp(a) : null;
        var out = [];
        app.beginSuppressDialogs();
        try {
            for (var i = 0; i < a.paths.length; i++) {
                var it = importOne(a.paths[i]);
                var e = { path: a.paths[i], id: it.id, name: it.name };
                if (comp) {
                    var l = comp.layers.add(it);
                    if (U.has(a, "start_time")) { l.startTime = a.start_time; }
                    e.layerIndex = l.index;
                }
                out.push(e);
            }
        } finally {
            app.endSuppressDialogs(false);
        }
        return { imported: out };
    });

    fns.ae_add_text = undoable("Add text", function (a) {
        var c = getComp(a);
        var l = c.layers.addText(a.text || "");
        var st = l.property("ADBE Text Properties").property("ADBE Text Document");
        var td = st.value;
        if (a.font) { td.font = a.font; }
        if (U.has(a, "font_size")) { td.fontSize = a.font_size; }
        if (a.color) { td.applyFill = true; td.fillColor = a.color; }
        if (a.justification === "center") { td.justification = ParagraphJustification.CENTER_JUSTIFY; }
        else if (a.justification === "right") { td.justification = ParagraphJustification.RIGHT_JUSTIFY; }
        else if (a.justification === "left") { td.justification = ParagraphJustification.LEFT_JUSTIFY; }
        st.setValue(td);
        if (a.position) { l.property("ADBE Transform Group").property("ADBE Position").setValue(a.position); }
        if (a.name) { l.name = a.name; }
        if (U.has(a, "start")) { l.inPoint = a.start; }
        if (U.has(a, "duration")) { l.outPoint = l.inPoint + a.duration; }
        return layerInfo(l);
    });

    fns.ae_set_property = undoable("Set property", function (a) {
        var c = getComp(a);
        var l = getLayer(c, a);
        var p = walkProperty(l, a.property);
        if (a.expression !== undefined && a.expression !== null) {
            p.expression = a.expression;
        }
        if (a.keyframes && a.keyframes.length) {
            for (var i = 0; i < a.keyframes.length; i++) {
                var k = a.keyframes[i];
                p.setValueAtTime(k.time, coerceValue(p, k.value, k.time));
            }
        } else if (a.value !== undefined && a.value !== null) {
            if (U.has(a, "time")) {
                p.setValueAtTime(a.time, coerceValue(p, a.value, a.time));
            } else {
                if (p.numKeys > 0) { throw new Error("Property has keyframes; pass time or keyframes to change it."); }
                p.setValue(coerceValue(p, a.value, null));
            }
        }
        var res = { layer: l.name, property: p.name, numKeys: p.numKeys, value: readValue(p) };
        try { res.expression = p.expression; res.expressionError = p.expressionError; } catch (e) {}
        return res;
    });

    fns.ae_set_layer = undoable("Edit layer", function (a) {
        var c = getComp(a);
        var l = getLayer(c, a);
        if (a.name) { l.name = a.name; }
        if (U.has(a, "enabled")) { l.enabled = !!a.enabled; }
        if (U.has(a, "start_time")) { l.startTime = a.start_time; }
        if (U.has(a, "in_point")) { l.inPoint = a.in_point; }
        if (U.has(a, "out_point")) { l.outPoint = a.out_point; }
        if (U.has(a, "parent_index")) { l.parent = a.parent_index ? c.layer(a.parent_index) : null; }
        if (U.has(a, "move_to_index")) { l.moveBefore(c.layer(a.move_to_index)); }
        if (a.remove) { var nm = l.name; l.remove(); return { removed: nm }; }
        return layerInfo(l);
    });

    fns.ae_render = function (a) {
        var c = getComp(a);
        var rq = app.project.renderQueue;
        var paused = [];
        for (var i = 1; i <= rq.numItems; i++) {
            var other = rq.item(i);
            try { if (other.render) { other.render = false; paused.push(other); } } catch (e) {}
        }
        var item = rq.items.add(c);
        var om = item.outputModule(1);
        var tmpl = a.template || "H.264 - Match Render Settings - 15 Mbps";
        var applied = null;
        try { om.applyTemplate(tmpl); applied = tmpl; } catch (e2) { applied = null; }
        om.file = new File(a.output_path);
        var output = om.file.fsName;
        try {
            if (a.mode === "ame") {
                if (!rq.canQueueInAME) { throw new Error("Adobe Media Encoder is not available for queueing."); }
                rq.queueInAME(true);
                return { queued: true, output: output, template: applied };
            }
            rq.render();
            return { rendered: true, output: output, template: applied };
        } finally {
            for (var k = 0; k < paused.length; k++) { try { paused[k].render = true; } catch (e3) {} }
        }
    };

    fns.ae_export_frame = function (a) {
        var c = getComp(a);
        var t = U.has(a, "time") ? a.time : c.time;
        c.saveFrameToPng(t, new File(a.path));
        return { time: r3(t), path: a.path, comp: c.name };
    };

    fns.ae_save = function (a) {
        if (a.path) { app.project.save(new File(a.path)); }
        else if (app.project.file) { app.project.save(); }
        else { throw new Error("Project has never been saved; pass path."); }
        return { saved: true, path: app.project.file ? app.project.file.fsName : a.path };
    };

    fns.ae_open_project = function (a) {
        var p = app.open(new File(a.path));
        return { opened: !!p, path: a.path };
    };

    B.hostLoaded = "AEFT";
})(__claudeBridge);
