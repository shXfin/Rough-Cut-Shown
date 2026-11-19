// Background jobs: long work split into short Premiere calls with pauses, so Premiere never freezes
// for long and no tool call waits out the 300 s limit.
import * as P from "../lib/premiere.mjs";
import { startJob, getJob, listJobs, cancelJob, publicJob, waitForJob } from "../lib/jobs.mjs";

export function register(def, { z, S }) {
  def(
    "premiere_job_start",
    "Run a long ExtendScript task as a background job: a list of short steps, each its own Premiere call with a short pause between, so Premiere stays responsive and you can keep working. Returns a job_id right away; poll premiere_job_status. Stops at the first failing step and reports which steps ran (with file/line/source of the error). Optionally saves a copy of a sequence first. Keep each step short (a few seconds): one step that loops for minutes still freezes Premiere.",
    {
      steps: z
        .array(z.object({ label: z.string().optional(), script: z.string().describe("ExtendScript; the value of the last expression is the step's result") }))
        .min(1),
      snapshot_sequence: z.string().optional().describe('Sequence id/name to copy into "Claude snapshots" before step 1 ("active" for the active sequence)'),
      pause_ms: z.number().int().min(0).max(10000).optional().describe("Pause between steps (default 250)"),
      stop_on_error: z.boolean().optional().describe("Default true"),
      step_timeout_ms: z.number().int().optional().describe("Per step, default 120000")
    },
    async (a) => {
      const label = `${a.steps.length} script step(s)`;
      const job = startJob(
        "steps",
        label,
        async (j) => {
          const out = { snapshot: null, steps: [] };
          if (a.snapshot_sequence) {
            const r = await P.call("v2_snapshot", { sequence_id: a.snapshot_sequence === "active" ? null : a.snapshot_sequence, label: "script job" });
            out.snapshot = r.name;
            j.log(`snapshot "${r.name}"`);
          }
          for (let i = 0; i < a.steps.length; i++) {
            const st = a.steps[i];
            const name = st.label || `step ${i + 1}`;
            j.progress(i, a.steps.length, name);
            try {
              const r = await P.runStep(st.script, { timeoutMs: a.step_timeout_ms || 120000, label: `job ${name}` });
              out.steps.push({ step: name, ok: true, result: r });
              j.log(`${name}: done`);
            } catch (e) {
              out.steps.push({ step: name, ok: false, error: e.message });
              j.log(`${name}: FAILED ${e.message.split("\n")[0]}`);
              if (a.stop_on_error !== false) {
                const err = new Error(`${name} failed: ${e.message}${out.snapshot ? `\nThe copy from before the job is "${out.snapshot}" in "Claude snapshots".` : ""}\nSteps that ran: ${out.steps.filter((s) => s.ok).map((s) => s.step).join(", ") || "none"}.`);
                err.partial = out;
                throw err;
              }
            }
            if (i < a.steps.length - 1) await j.pause(a.pause_ms ?? 250);
          }
          j.progress(a.steps.length, a.steps.length, "done");
          return out;
        },
        { pauseMs: a.pause_ms ?? 250 }
      );
      return { job: publicJob(job) };
    }
  );

  def(
    "premiere_job_status",
    "Check background jobs (renders, script steps, bleep passes). With job_id: that job's progress, log, result or error. wait_s waits up to that many seconds for it to finish first. Without job_id: every job this Claude session started.",
    {
      job_id: z.string().optional(),
      wait_s: z.number().min(0).max(50).optional().describe("Wait for the job to finish, up to this long (max 50)")
    },
    async (a) => {
      if (!a.job_id) return { jobs: listJobs() };
      let job = getJob(a.job_id);
      if (!job) throw new Error(`No job ${a.job_id} in this Claude session (jobs live as long as the session's bridge server).`);
      if (a.wait_s && job.status === "running") job = await waitForJob(a.job_id, a.wait_s * 1000);
      return publicJob(job);
    }
  );

  def(
    "premiere_job_cancel",
    "Cancel a background job. It stops before its next step; a step already running inside Premiere finishes first.",
    { job_id: z.string() },
    async (a) => {
      const job = await cancelJob(a.job_id);
      return { cancelling: a.job_id, status: job ? job.status : "unknown (not started by this session; a cancel file was written anyway)" };
    }
  );
}
