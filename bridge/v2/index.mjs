// Claude Adobe Bridge v2 tools. Loaded by server.mjs; if this file fails to load, the v1 tools still work.
import fs from "node:fs";
import path from "node:path";
import * as P from "./lib/premiere.mjs";
import { schemas } from "./lib/common.mjs";
import { findTool, BRIDGE_HOME } from "./lib/files.mjs";
import { waitForJobs as wait } from "./lib/jobs.mjs";
import * as timeline from "./tools/timeline.mjs";
import * as render from "./tools/render.mjs";
import * as jobs from "./tools/jobs.mjs";
import * as edit from "./tools/edit.mjs";
import * as effects from "./tools/effects.mjs";
import * as media from "./tools/media.mjs";
import * as captions from "./tools/captions.mjs";
import * as audio from "./tools/audio.mjs";

export const V2_VERSION = "2.0.0";
let ctxRef = null;

/** Wrap a handler: plain objects become JSON text; { content } passes through. */
function wrap(ctx, handler) {
  return async (args) => {
    let r;
    try {
      const a = args ?? {};
      r = await P.inProject(a.project, () => handler(a));
    } catch (e) {
      // Expected failures (Premiere refused, bad input, timeline changed) come back as plain messages.
      // Real bugs (TypeError and friends) keep their stack so they can be fixed.
      if (e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError || e instanceof RangeError) throw e;
      throw new ctx.BridgeError(e && e.message ? e.message : String(e));
    }
    if (r && Array.isArray(r.content)) return r;
    return ctx.text(r);
  };
}

export function register(ctx) {
  ctxRef = ctx;
  P.init(ctx);
  const S = schemas(ctx.z);
  const def = (name, description, shape, handler) => ctx.tool(name, description, shape, wrap(ctx, handler));
  const c = { ...ctx, S };
  for (const mod of [timeline, render, jobs, edit, effects, audio, media, captions]) mod.register(def, c);
}

/** Extra fields for adobe_status. */
export async function statusInfo() {
  const info = {
    v2Version: V2_VERSION,
    ffmpeg: findTool("ffmpeg") || "not found (needed for frames, WAV, bleeps, titles)",
    ffprobe: findTool("ffprobe") || "not found"
  };
  try {
    const st = fs.statSync(P.JSX_PATH);
    info.premiereHelpers = `${path.basename(P.JSX_PATH)} (${st.size} bytes)`;
  } catch {
    info.premiereHelpers = `missing: ${P.JSX_PATH}`;
  }
  if (ctxRef) {
    try {
      const d = await ctxRef.request("ppro", "GET", "/ping", null, 4000);
      info.premierePanel = d.bridgeVersion;
      if (String(d.bridgeVersion).startsWith("1.")) info.panelNote = "Panel 1.x: all tools work; reopen the Claude Bridge panel (or restart Premiere) for the v2 status line and Cancel button.";
      const v = await P.call("v2_info", {}, { timeoutMs: 8000 });
      info.proxiesOn = v.proxiesEnabled;
      info.openProjects = v.openProjects;
    } catch (e) {
      info.premiere = e.message;
    }
  }
  info.home = BRIDGE_HOME;
  return info;
}

export async function waitForJobs() {
  await wait();
}
