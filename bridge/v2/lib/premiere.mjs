// Talking to Premiere for the v2 tools. The v2 ExtendScript helpers (host/ppro2.jsx) are loaded into
// Premiere on first use and reloaded when the file changes, so they work with the v1 panel too.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const JSX_PATH = fileURLToPath(new URL("../../host/ppro2.jsx", import.meta.url));
let ctx = null;
let built = { mtime: 0, hash: null };

export function init(c) {
  ctx = c;
}

const lit = (v) => JSON.stringify(v ?? null).replace(/[\u2028\u2029]/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));

function jsxBuild() {
  const st = fs.statSync(JSX_PATH);
  if (st.mtimeMs !== built.mtime) {
    built = { mtime: st.mtimeMs, hash: crypto.createHash("sha1").update(fs.readFileSync(JSX_PATH)).digest("hex").slice(0, 10) };
  }
  return built.hash;
}

export class PremiereError extends Error {}

function sourceLine(file, line) {
  try {
    if (!file || !line || !fs.existsSync(file)) return "";
    return (fs.readFileSync(file, "utf8").split(/\r?\n/)[line - 1] || "").trim().slice(0, 200);
  } catch {
    return "";
  }
}

/** Turn an ExtendScript failure into a message that says where it broke and what had already happened. */
export function formatError(r, scriptSrc) {
  let msg = r.error || "Unknown Premiere error";
  if (r.line) {
    const file = r.file && r.file !== "(eval)" ? r.file : null;
    const code = file ? sourceLine(file, r.line) : scriptSrc ? (scriptSrc.split(/\r?\n/)[r.line - 1] || "").trim() : "";
    msg += `\n  at ${file ? path.basename(file) : "your script"} line ${r.line}${code ? `:  ${code}` : ""}`;
  }
  if (r.done && r.done.length) msg += `\n  Already done before the error: ${r.done.join("; ")}`;
  if (r.snapshot) {
    msg += `\n  A copy of the sequence from before this edit is in the "Claude snapshots" bin: "${r.snapshot}".`;
    if (r.done && r.done.length) msg += " Nothing was undone automatically: compare the two and keep the right one.";
  }
  return msg;
}

/**
 * Call a v2 helper inside Premiere. Throws PremiereError with a readable message on failure.
 */
export async function call(fn, args = {}, { timeoutMs = 60000, label } = {}) {
  if (!ctx) throw new Error("v2 bridge not initialised");
  const hash = jsxBuild();
  const script =
    `(function(){var B=__claudeBridge;` +
    `try{if(!B.v2||B.v2.build!==${lit(hash)}){$.evalFile(new File(${lit(JSX_PATH)}));B.v2.build=${lit(hash)};}}` +
    `catch(e){return B.stringify({ok:false,error:"Couldn't load the v2 helpers into Premiere: "+e.message,line:e.line,file:${lit(JSX_PATH)}});}` +
    `return B.v2.call(${lit(fn)},${lit(args)});})()`;
  const data = await ctx.request("ppro", "POST", "/eval", { script, timeoutMs, label: label || fn.replace(/^v2_/, "") }, timeoutMs);
  let r;
  try {
    r = JSON.parse(data.raw);
  } catch {
    throw new PremiereError(`Premiere returned something unreadable: ${String(data.raw).slice(0, 200)}`);
  }
  if (!r.ok) throw new PremiereError(formatError(r));
  return r.result;
}

/** Run a user script (one step of a job) with v2 error reporting. */
export async function runStep(src, { timeoutMs = 60000, label = "step" } = {}) {
  const hash = jsxBuild();
  const script =
    `(function(){var B=__claudeBridge;` +
    `try{if(!B.v2||B.v2.build!==${lit(hash)}){$.evalFile(new File(${lit(JSX_PATH)}));B.v2.build=${lit(hash)};}}` +
    `catch(e){return B.stringify({ok:false,error:"Couldn't load the v2 helpers: "+e.message,line:e.line});}` +
    `return B.v2.exec(${lit(src)});})()`;
  const data = await ctx.request("ppro", "POST", "/eval", { script, timeoutMs, label }, timeoutMs);
  const r = JSON.parse(data.raw);
  if (!r.ok) throw new PremiereError(formatError(r, src));
  return r.result;
}
