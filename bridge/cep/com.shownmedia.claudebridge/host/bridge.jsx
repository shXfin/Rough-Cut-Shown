/*
 * Claude Bridge — shared ExtendScript core (loaded in Premiere Pro and After Effects).
 * ExtendScript is ES3: no let/const, arrow functions, JSON, Array#map/forEach/indexOf.
 */
var __claudeBridge = (function () {
    var api = { version: "1.0.0", fns: {}, hostLoaded: false };

    var ESCAPES = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

    function quote(s) {
        return '"' + String(s).replace(/[\\"\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, function (c) {
            if (ESCAPES[c]) { return ESCAPES[c]; }
            var h = c.charCodeAt(0).toString(16);
            while (h.length < 4) { h = "0" + h; }
            return "\\u" + h;
        }) + '"';
    }

    function contains(arr, v) {
        for (var i = 0; i < arr.length; i++) { if (arr[i] === v) { return true; } }
        return false;
    }

    function isPlainObject(v) {
        try { return v.constructor === Object; } catch (e) { return false; }
    }

    function stringify(v, depth, seen) {
        depth = depth || 0;
        seen = seen || [];
        if (v === null || v === undefined) { return "null"; }
        var t = typeof v;
        if (t === "number") { return isFinite(v) ? String(v) : "null"; }
        if (t === "boolean") { return v ? "true" : "false"; }
        if (t === "string") { return quote(v); }
        if (t === "function") { return "null"; }
        if (depth > 12) { return quote("[max depth]"); }
        if (contains(seen, v)) { return quote("[circular]"); }
        try { if (typeof File !== "undefined" && (v instanceof File || v instanceof Folder)) { return quote(v.fsName); } } catch (e0) {}
        if (v instanceof Date) { return quote(v.toString()); }
        seen.push(v);
        var out;
        if (v instanceof Array) {
            var parts = [];
            for (var i = 0; i < v.length; i++) { parts.push(stringify(v[i], depth + 1, seen)); }
            out = "[" + parts.join(",") + "]";
        } else if (isPlainObject(v)) {
            var props = [];
            for (var k in v) {
                var val;
                try { val = v[k]; } catch (e1) { continue; }
                if (typeof val === "function" || val === undefined) { continue; }
                props.push(quote(k) + ":" + stringify(val, depth + 1, seen));
            }
            out = "{" + props.join(",") + "}";
        } else {
            // Host objects (Sequence, CompItem, ...) are not walked; return their type name.
            var s;
            try { s = String(v); } catch (e2) { s = "[host object]"; }
            out = quote(s);
        }
        seen.pop();
        return out;
    }

    function ok(result) { return stringify({ ok: true, result: result }); }

    function fail(e) {
        var msg;
        try { msg = (e && e.message) ? e.message : String(e); } catch (x) { msg = "Unknown error"; }
        var info = { ok: false, error: msg };
        try { if (e && e.line) { info.line = e.line; } } catch (y) {}
        return stringify(info);
    }

    api.stringify = stringify;

    // Run arbitrary ExtendScript source; the value of the last expression is returned.
    api.exec = function (src) {
        try {
            var r = eval(src);
            return ok(r);
        } catch (e) {
            return fail(e);
        }
    };

    // Call a named helper registered by ppro.jsx / aeft.jsx.
    api.call = function (name, args) {
        try {
            if (!api.fns.hasOwnProperty(name)) { throw new Error("Unknown bridge function: " + name); }
            return ok(api.fns[name](args || {}));
        } catch (e) {
            return fail(e);
        }
    };

    // ---- small ES3 helpers shared by host files ----
    api.util = {
        contains: contains,
        has: function (o, k) { return o !== null && o !== undefined && o[k] !== undefined && o[k] !== null; },
        num: function (v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; },
        round: function (v, places) { var m = Math.pow(10, places || 3); return Math.round(v * m) / m; },
        lower: function (s) { return String(s).toLowerCase(); },
        normPath: function (p) { return String(p || "").replace(/\\/g, "/").toLowerCase(); }
    };

    return api;
})();
