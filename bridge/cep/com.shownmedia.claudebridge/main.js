/*
 * Claude Bridge panel: a localhost-only HTTP server inside Premiere Pro / After Effects.
 * The Claude MCP server sends ExtendScript here; the panel runs it in the host app.
 *
 * Security: binds to 127.0.0.1 only, requires the secret token from ~/.claude-adobe-bridge/token,
 * rejects any request carrying a browser Origin header, and checks the Host header
 * (blocks web pages and DNS-rebinding attacks from reaching the app).
 */
(function () {
  "use strict";

  var BRIDGE_VERSION = "2.0.0";
  var PORTS = { PPRO: 47811, AEFT: 47812 };
  var MAX_BODY = 8 * 1024 * 1024;

  var cep = window.__adobe_cep__;
  var nodeRequire = (window.cep_node && window.cep_node.require) || window.require;
  var http = nodeRequire("http");
  var fs = nodeRequire("fs");
  var path = nodeRequire("path");
  var os = nodeRequire("os");
  var crypto = nodeRequire("crypto");
  var Buffer = nodeRequire("buffer").Buffer;

  var env = JSON.parse(cep.getHostEnvironment());
  var APP = env.appName;
  var PORT = PORTS[APP];
  var APP_LABEL = APP === "PPRO" ? "Premiere Pro" : APP === "AEFT" ? "After Effects" : APP;

  var extPath = decodeURI(cep.getSystemPath("extension")).replace(/^file:\/\//, "");
  var CORE_JSX = path.join(extPath, "host", "bridge.jsx");
  var HOST_JSX = path.join(extPath, "host", APP === "PPRO" ? "ppro.jsx" : "aeft.jsx");
  var BRIDGE_HOME = path.join(os.homedir(), ".claude-adobe-bridge");
  var TOKEN_FILE = path.join(BRIDGE_HOME, "token");
  var ACT_DIR = path.join(BRIDGE_HOME, "activity");
  var JOB_DIR = path.join(BRIDGE_HOME, "jobs");

  var LOADER =
    'if (typeof __claudeBridge === "undefined" || !__claudeBridge.hostLoaded) {' +
    " $.evalFile(" + JSON.stringify(CORE_JSX) + ");" +
    " $.evalFile(" + JSON.stringify(HOST_JSX) + "); }\n";

  // ---------- UI ----------
  var doc = typeof document !== "undefined" ? document : null;
  function $(id) { return doc ? doc.getElementById(id) : null; }

  var lastStatus = { state: "", text: "" };
  function setStatus(state, text) {
    lastStatus = { state: state, text: text };
    var dot = $("dot"), st = $("status");
    if (dot) dot.className = "dot " + (state || "");
    if (st) st.textContent = text;
  }

  // ---------- "Claude is editing" + jobs (written by the MCP server, one file per Claude session) ----------
  var proc = nodeRequire("process");
  function alive(pid) {
    try { proc.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; }
  }

  function readActivity() {
    var out = [];
    var files = [];
    try { files = fs.readdirSync(ACT_DIR); } catch (e) { return out; }
    for (var i = 0; i < files.length; i++) {
      if (!/\.json$/.test(files[i])) continue;
      var full = path.join(ACT_DIR, files[i]);
      try {
        var d = JSON.parse(fs.readFileSync(full, "utf8"));
        if (!d.pid || !alive(d.pid)) { try { fs.unlinkSync(full); } catch (e2) {} continue; }
        out.push(d);
      } catch (e3) {}
    }
    return out;
  }

  function renderActivity() {
    var box = $("activity");
    if (!box) return;
    var acts = readActivity();
    while (box.firstChild) box.removeChild(box.firstChild);
    var busy = false;
    for (var i = 0; i < acts.length; i++) {
      var a = acts[i];
      if (a.editing) {
        busy = true;
        var e = doc.createElement("div");
        e.className = "editing";
        e.textContent = "Claude is editing: " + a.editing.label;
        box.appendChild(e);
      }
      var jobs = a.jobs || [];
      for (var j = 0; j < jobs.length; j++) {
        busy = true;
        var job = jobs[j], p = job.progress || {};
        var row = doc.createElement("div");
        row.className = "job";
        var label = doc.createElement("span");
        label.className = "joblabel";
        label.textContent = job.label + (p.total ? "  " + (p.done || 0) + "/" + p.total : "") + (p.message ? "  " + p.message : "");
        var bar = doc.createElement("div");
        bar.className = "bar";
        var fill = doc.createElement("div");
        fill.style.width = (p.total ? Math.round(100 * (p.done || 0) / p.total) : 5) + "%";
        bar.appendChild(fill);
        var cancel = doc.createElement("button");
        cancel.textContent = "Cancel";
        cancel.setAttribute("data-job", job.id);
        cancel.addEventListener("click", function (ev) {
          var id = ev.target.getAttribute("data-job");
          try { fs.mkdirSync(JOB_DIR, { recursive: true }); fs.writeFileSync(path.join(JOB_DIR, id + ".cancel"), "cancel"); ev.target.textContent = "Cancelling…"; } catch (e4) { log("cancel failed: " + e4.message, true); }
        });
        row.appendChild(label);
        row.appendChild(cancel);
        row.appendChild(bar);
        box.appendChild(row);
      }
    }
    box.style.display = busy ? "block" : "none";
    var dot = $("dot");
    if (dot && lastStatus.state === "ok") dot.className = "dot " + (busy ? "busy" : "ok");
  }

  var actTimer = null;
  function watchActivity() {
    try { fs.mkdirSync(ACT_DIR, { recursive: true }); } catch (e) {}
    try {
      fs.watch(ACT_DIR, function () {
        if (actTimer) return;
        actTimer = setTimeout(function () { actTimer = null; renderActivity(); }, 150);
      });
    } catch (e2) { log("activity watch unavailable: " + e2.message, true); }
    renderActivity();
  }

  function log(msg, isErr) {
    var el = $("log");
    var line = new Date().toTimeString().slice(0, 8) + "  " + msg;
    if (!el) { if (isErr) console.error(line); else console.log(line); return; }
    var d = doc.createElement("div");
    d.textContent = line;
    if (isErr) d.className = "err";
    el.insertBefore(d, el.firstChild);
    while (el.childNodes.length > 60) el.removeChild(el.lastChild);
  }

  // ---------- auth ----------
  function readToken() {
    try { return fs.readFileSync(TOKEN_FILE, "utf8").trim(); } catch (e) { return null; }
  }

  function tokenMatches(given) {
    var expected = readToken();
    if (!expected || !given) return false;
    var a = Buffer.from(String(given)), b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function hostAllowed(h) {
    return h === "127.0.0.1:" + PORT || h === "localhost:" + PORT;
  }

  // ---------- ExtendScript execution (serialized) ----------
  var queue = Promise.resolve();

  function evalScript(src, timeoutMs) {
    var run = function () {
      return new Promise(function (resolve, reject) {
        var finished = false;
        var timer = setTimeout(function () {
          if (finished) return;
          finished = true;
          reject(new Error("Timed out after " + timeoutMs + " ms (the script may still be running in " + APP_LABEL + ")."));
        }, timeoutMs);
        cep.evalScript(src, function (res) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(res);
        });
      });
    };
    var p = queue.then(run, run);
    queue = p.catch(function () {});
    return p;
  }

  function reloadScripts() {
    return evalScript('__claudeBridge = undefined; "reset"', 10000).then(function () {
      return evalScript(LOADER + '__claudeBridge.version + " / " + __claudeBridge.hostLoaded', 10000);
    });
  }

  // ---------- HTTP ----------
  function send(res, code, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
    res.end(body);
  }

  function readBody(req) {
    return new Promise(function (resolve, reject) {
      var chunks = [], size = 0;
      req.on("data", function (c) {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error("Request too large")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
      req.on("error", reject);
    });
  }

  function handle(req, res) {
    var remote = req.socket.remoteAddress;
    if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") return send(res, 403, { ok: false, error: "local only" });
    if (req.headers.origin) return send(res, 403, { ok: false, error: "browser requests are not allowed" });
    if (!hostAllowed(req.headers.host)) return send(res, 403, { ok: false, error: "bad host header" });
    if (!tokenMatches(req.headers["x-bridge-token"])) return send(res, 401, { ok: false, error: "bad or missing token (re-run install.sh)" });

    var url = req.url.split("?")[0];

    if (req.method === "GET" && url === "/ping") {
      return send(res, 200, { ok: true, app: APP, appLabel: APP_LABEL, appVersion: env.appVersion, bridgeVersion: BRIDGE_VERSION, features: ["activity", "isolated-eval"] });
    }

    if (req.method === "POST" && url === "/reload") {
      return reloadScripts().then(function (r) {
        log("scripts reloaded (" + r + ")");
        send(res, 200, { ok: true, raw: r });
      }, function (e) { send(res, 500, { ok: false, error: e.message }); });
    }

    if (req.method === "POST" && url === "/eval") {
      return readBody(req).then(function (body) {
        var payload = JSON.parse(body);
        if (typeof payload.script !== "string") throw new Error("script must be a string");
        var timeoutMs = Math.min(Math.max(Number(payload.timeoutMs) || 60000, 1000), 60 * 60 * 1000);
        var label = payload.label || "script";
        var started = Date.now();
        return evalScript(LOADER + payload.script, timeoutMs).then(function (raw) {
          var bad = raw === "EvalScript error." || raw === undefined || raw === null;
          log(label + "  " + (Date.now() - started) + "ms" + (bad ? "  ERROR" : ""), bad);
          if (bad) return send(res, 200, { ok: false, error: "EvalScript error — usually a syntax error in the ExtendScript (ES3: no let/const/arrow functions)." });
          send(res, 200, { ok: true, raw: raw });
        });
      }).catch(function (e) {
        log((e && e.message) || String(e), true);
        send(res, 500, { ok: false, error: (e && e.message) || String(e) });
      });
    }

    send(res, 404, { ok: false, error: "not found" });
  }

  var server = null;

  function start() {
    if (!PORT) { setStatus("bad", "Unsupported host app: " + APP); return; }
    if (!readToken()) {
      setStatus("bad", "No token found at ~/.claude-adobe-bridge/token. Run install.sh, then click Restart.");
      return;
    }
    server = http.createServer(handle);
    server.on("error", function (e) {
      var msg = e.code === "EADDRINUSE"
        ? "Port " + PORT + " is busy — is another copy of " + APP_LABEL + " (or this panel) open?"
        : "Server error: " + e.message;
      setStatus("bad", msg);
      log(msg, true);
    });
    server.listen(PORT, "127.0.0.1", function () {
      setStatus("ok", "Ready · " + APP_LABEL + " " + env.appVersion + " · bridge " + BRIDGE_VERSION + " · port " + PORT + ". Keep this panel open (docked is fine).");
      log("bridge " + BRIDGE_VERSION + " ready");
    });
    evalScript(LOADER + '"loaded " + __claudeBridge.hostLoaded', 15000).then(
      function (r) { log(r); },
      function (e) { log("script load failed: " + e.message, true); }
    );
  }

  function restart() {
    if (server) { try { server.close(); } catch (e) {} server = null; }
    setTimeout(start, 300);
  }

  if (doc) {
    $("restart").addEventListener("click", restart);
    $("reload").addEventListener("click", function () {
      reloadScripts().then(function (r) { log("scripts reloaded (" + r + ")"); }, function (e) { log(e.message, true); });
    });
  }

  // Exposed for tests.
  window.__claudeBridgePanel = { start: start, restart: restart, port: PORT, stop: function () { if (server) server.close(); } };

  start();
  if (doc) watchActivity();
})();
