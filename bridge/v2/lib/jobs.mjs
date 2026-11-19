// Background jobs and the "Claude is editing" activity line.
// A job is a list of short steps run one after another with a pause in between, so Premiere stays
// responsive and no single tool call waits long. State is mirrored to ~/.claude-adobe-bridge/jobs/<id>.json
// (the panel shows it); a file <id>.cancel (written by the panel's Cancel button or premiere_job_cancel) stops it.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { BRIDGE_HOME } from "./files.mjs";

const JOB_DIR = path.join(BRIDGE_HOME, "jobs");
const ACT_DIR = path.join(BRIDGE_HOME, "activity");
const jobs = new Map();
const running = new Set();

export class Cancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.cancelled = true;
  }
}

function newId() {
  return "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

async function persist(job) {
  try {
    await fsp.mkdir(JOB_DIR, { recursive: true });
    const { _promise, ...rest } = job;
    await fsp.writeFile(path.join(JOB_DIR, job.id + ".json"), JSON.stringify(rest, null, 1));
  } catch {}
}

function cancelRequested(job) {
  if (job.cancel) return true;
  try {
    fs.accessSync(path.join(JOB_DIR, job.id + ".cancel"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a job. fn(ctx) does the work; ctx = { progress(done, total, message), log(msg), check(), pause(ms) }.
 * Returns the job record right away.
 */
export function startJob(kind, label, fn, { pauseMs = 250 } = {}) {
  const job = {
    id: newId(),
    kind,
    label,
    pid: process.pid,
    status: "running",
    progress: { done: 0, total: null, message: "starting" },
    log: [],
    result: null,
    error: null,
    started: new Date().toISOString(),
    ended: null
  };
  jobs.set(job.id, job);
  running.add(job.id);
  const ctx = {
    job,
    progress(done, total, message) {
      job.progress = { done, total: total ?? job.progress.total, message: message ?? job.progress.message };
      persist(job);
      activityUpdate();
    },
    log(msg) {
      job.log.push(`${new Date().toTimeString().slice(0, 8)} ${msg}`);
      if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
    },
    check() {
      if (cancelRequested(job)) throw new Cancelled();
    },
    async pause(ms = pauseMs) {
      await new Promise((r) => setTimeout(r, ms));
      if (cancelRequested(job)) throw new Cancelled();
    }
  };
  persist(job);
  activityUpdate();
  job._promise = (async () => {
    try {
      job.result = await fn(ctx);
      job.status = "done";
    } catch (e) {
      job.status = e && e.cancelled ? "cancelled" : "failed";
      job.error = e && e.message ? e.message : String(e);
      if (e && e.partial) job.result = e.partial;
    } finally {
      job.ended = new Date().toISOString();
      running.delete(job.id);
      try {
        fs.rmSync(path.join(JOB_DIR, job.id + ".cancel"), { force: true });
      } catch {}
      await persist(job);
      activityUpdate();
    }
  })();
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function listJobs() {
  return [...jobs.values()].map(publicJob);
}

export function publicJob(job) {
  if (!job) return null;
  const { _promise, cancel, ...rest } = job;
  return rest;
}

export async function cancelJob(id) {
  const job = jobs.get(id);
  if (job) job.cancel = true;
  await fsp.mkdir(JOB_DIR, { recursive: true });
  await fsp.writeFile(path.join(JOB_DIR, id + ".cancel"), "cancel");
  return job;
}

/** Wait for running jobs (used by the command line so a job isn't cut off when the process exits). */
export async function waitForJobs() {
  await Promise.all([...jobs.values()].map((j) => j._promise).filter(Boolean));
}

export async function waitForJob(id, timeoutMs) {
  const job = jobs.get(id);
  if (!job) return null;
  await Promise.race([job._promise, new Promise((r) => setTimeout(r, timeoutMs))]);
  return job;
}

// ---------- activity line shown in the panel ----------
let editing = null;

function activityFile() {
  return path.join(ACT_DIR, `${process.pid}.json`);
}

function activityUpdate() {
  const active = [...running].map((id) => jobs.get(id)).filter(Boolean);
  const data = {
    pid: process.pid,
    editing,
    jobs: active.map((j) => ({ id: j.id, label: j.label, progress: j.progress })),
    updated: new Date().toISOString()
  };
  try {
    if (!editing && !active.length) {
      fs.rmSync(activityFile(), { force: true });
      return;
    }
    fs.mkdirSync(ACT_DIR, { recursive: true });
    fs.writeFileSync(activityFile(), JSON.stringify(data));
  } catch {}
}

/** Show "Claude is editing: <label>" in the panel while fn runs. */
export async function withActivity(label, fn) {
  const prev = editing;
  editing = { label, since: new Date().toISOString() };
  activityUpdate();
  try {
    return await fn();
  } finally {
    editing = prev;
    activityUpdate();
  }
}

process.on("exit", () => {
  try {
    fs.rmSync(activityFile(), { force: true });
  } catch {}
});
