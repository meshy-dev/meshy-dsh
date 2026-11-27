// Unit tests for the native Cordis tools in lib/tools.js: the `meshy` tool's argument passthrough
// (what it refuses, what it owns), which commands ask for approval and what the dialog says, the
// background-job path and its inline fallback, the CLI envelope becoming the card and the Studio's
// rows and files, and `meshy_sign_in` / `meshy_preview_model`. The CLI is a stand-in; no network,
// no credits.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCatalog } from "../lib/catalog.js";
import { createEventBus } from "../lib/events.js";
import { readAssetIndex, sessionStateDir } from "../lib/tasks.js";
import { collectFiles, collectTasks, createTools, displayOf, prepareArgs } from "../lib/tools.js";
import { withResources } from "./fixtures/resources.mjs";

const dir = mkdtempSync(join(tmpdir(), "meshy-dsh-tools-"));
const ws = join(dir, "workspace");
mkdirSync(join(ws, "meshy_input"), { recursive: true });
writeFileSync(join(ws, "meshy_input", "fox.png"), Buffer.from([137, 80, 78, 71]));
writeFileSync(join(ws, "mesh.glb"), Buffer.from("glTF-mesh"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const TASK = "0190aaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const taskView = (status, progress, extra = {}) => ({
  task_id: TASK,
  resource: "image-to-3d",
  name: "Red fox",
  status,
  progress,
  consumed_credits: status === "SUCCEEDED" ? 30 : null,
  thumbnail_url: "https://assets.meshy.ai/fox.png",
  model_urls: status === "SUCCEEDED" ? { glb: "https://assets.meshy.ai/fox.glb" } : {},
  image_urls: [],
  task_error: null,
  ...extra,
});

/** The tools over a stand-in CLI. `outcome(argv, opts)` answers every command but `resources`/`balance`. */
function harness({ approvalOutcome = "allowed-once", hasApproval = true, jobs = null, outcome } = {}) {
  const events = createEventBus();
  const emitted = [];
  events.subscribe((e) => emitted.push(e));
  const approvals = [];
  const runs = [];
  const cli = withResources(async (argv, opts) => {
    if (argv[0] === "balance") return { ok: true, result: { balance: 420 } };
    runs.push({ argv, opts });
    if (outcome) return outcome(argv, opts);
    return { ok: true, command: argv.slice(0, 2).join(" "), result: { echoed: argv } };
  });
  const ctx = {
    ...(hasApproval ? { approval: { request: async (req) => { approvals.push(req); return typeof approvalOutcome === "function" ? approvalOutcome(req) : approvalOutcome; } } } : {}),
    ...(jobs ? { jobs } : {}),
  };
  const { tools } = createTools({
    ctx,
    cli,
    catalog: createCatalog({ cli }),
    signIn: async (region) => ({ status: "waiting_for_approval", verification_url: `https://www.meshy.${region === "cn" ? "cn" : "ai"}/device`, user_code: "ABCD-1234", expires_in: 600 }),
    events,
  });
  const byName = new Map(tools.map((t) => [t.name, t]));
  const exec = (overrides = {}) => ({ callId: "call-42", agent: { session: { header: { id: "sess-1", cwd: ws } } }, ...overrides });
  return { byName, meshy: byName.get("meshy"), approvals, runs, emitted, exec };
}

/** A fake dsh job registry: records each spec and keeps the hooks `run` returned. */
function fakeJobs({ fail = false } = {}) {
  const started = [];
  return {
    started,
    start(spec) {
      if (fail) throw new Error("no job controller attached");
      const progress = [];
      const output = [];
      const handle = { id: `job-${started.length + 1}`, append: (t) => output.push(t), updateProgress: (p) => progress.push(p) };
      const hooks = spec.run(handle);
      started.push({ spec, hooks, progress, output });
      return handle.id;
    },
  };
}

/** An image-to-3d run as the CLI streams it: two task events, then the envelope with the saved files. */
function imageTo3d({ write = true } = {}) {
  return async (_argv, opts) => {
    opts.onEvent?.({ ok: true, event: "task", result: { task: taskView("PENDING", 0) } });
    opts.onEvent?.({ ok: true, event: "task", result: { task: taskView("IN_PROGRESS", 45) } });
    const out = join(ws, "meshy_output", "fox");
    if (write) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "model.glb"), "glTF");
      writeFileSync(join(out, "preview.png"), Buffer.from([137, 80, 78, 71]));
    }
    return {
      ok: true,
      command: "image-to-3d create",
      result: {
        task: taskView("SUCCEEDED", 100),
        submission: { state: "accepted" },
        task_id: TASK,
        downloads: {
          state: "completed",
          files: [
            { key: "model.glb", path: join(out, "model.glb"), status: "written" },
            { key: "thumbnail", path: join(out, "preview.png"), status: "written" },
            { key: "texture", path: join(out, "missing.png"), status: "failed" },
            { key: "elsewhere", path: join(dir, "outside.glb"), status: "written" },
          ],
          metadata_path: join(out, "meta.json"),
        },
      },
    };
  };
}

const card = (tool, args, value) => {
  const meta = tool.output.presentationMeta(args, value);
  for (const [k, v] of Object.entries(meta)) assert.ok(v !== null && v !== undefined, `${tool.name} meta.${k} is null`);
  return meta;
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

test("tools: the agent's arguments pass through, minus the options the plugin owns", () => {
  assert.deepEqual(prepareArgs(["image-to-3d", "create", "--image-url", "meshy_input/fox.png", "-o", "meshy_output/"]), ["image-to-3d", "create", "--image-url", "meshy_input/fox.png", "-o", "meshy_output/"]);
  assert.deepEqual(prepareArgs(["meshy", "balance"]), ["balance"]);
  assert.deepEqual(prepareArgs(["balance", "--format", "pretty", "--json", "--no-update-check", "--workspace", "/elsewhere", "--format=ndjson", "--workspace=/x"]), ["balance"]);
  // After `--` everything is the agent's, as given.
  assert.deepEqual(prepareArgs(["make", "--", "--format", "a red fox"]), ["make", "--", "--format", "a red fox"]);
  assert.deepEqual(prepareArgs(["auth", "status"]), ["auth", "status"]);
});

test("tools: arguments that start with an option, replace or print the sign-in, log in, or start a viewer are refused", () => {
  assert.throws(() => prepareArgs([]), /starting with the command/);
  assert.throws(() => prepareArgs("make a fox"), /list of strings/);
  assert.throws(() => prepareArgs(["--format", "json", "balance"]), /start with the command/);
  assert.throws(() => prepareArgs(["auth", "login"]), /meshy_sign_in/);
  assert.throws(() => prepareArgs(["auth", "logout"]), /meshy_sign_in/);
  assert.throws(() => prepareArgs(["view", "meshy_output/fox.glb", "--detach"]), /meshy_preview_model/);
  assert.throws(() => prepareArgs(["balance", "--api-key", "msy_x"]), /--api-key is not allowed/);
  assert.throws(() => prepareArgs(["balance", "--api-key-file=.env"]), /--api-key-file is not allowed/);
  assert.throws(() => prepareArgs(["balance", "--base-url-v1", "https://example.com"]), /--base-url-v1 is not allowed/);
  assert.throws(() => prepareArgs(["auth", "status", "--show-token"]), /--show-token is not allowed/);
  assert.throws(() => prepareArgs(["balance", 3]), /args\[1\] must be a string/);
  assert.throws(() => prepareArgs(["balance", "a\0b"]), /args\[1\]/);
  assert.equal(displayOf(["make", "a red fox", "-o", "meshy_output/"]), "meshy make 'a red fox' -o meshy_output/");
  assert.equal(displayOf(["make", "it's"]), `meshy make 'it'\\''s'`);
});

// ---------------------------------------------------------------------------
// Free commands
// ---------------------------------------------------------------------------

test("tools: a free command runs at once in the workspace, with this chat's state dir, and returns the envelope", async () => {
  const { meshy, approvals, runs, exec } = harness();
  const value = await meshy.execute({ args: ["image-to-3d", "get", TASK] }, exec());
  assert.equal(approvals.length, 0);
  assert.deepEqual(runs[0].argv, ["image-to-3d", "get", TASK]);
  assert.equal(runs[0].opts.cwd, ws);
  assert.equal(runs[0].opts.workspace, ws);
  assert.equal(runs[0].opts.stream, false);
  assert.deepEqual(runs[0].opts.extraEnv, { DSH_MESHY_STATE_DIR: sessionStateDir(ws, "sess-1") });
  assert.equal(value.status, "ok");
  const text = meshy.output.render({}, value)[0].text;
  assert.deepEqual(JSON.parse(text), { ok: true, command: "image-to-3d get", result: { echoed: ["image-to-3d", "get", TASK] } });
  assert.deepEqual(card(meshy, {}, value), { tool: "meshy", status: "ok", command: `meshy image-to-3d get ${TASK}`, tasks: [], files: [] });
});

test("tools: a failed free command comes back as the CLI's own error envelope", async () => {
  const { meshy, exec } = harness({ outcome: () => ({ ok: false, command: "image-to-3d get", error: { code: "not_found", message: "meshy api 404" } }) });
  const value = await meshy.execute({ args: ["image-to-3d", "get", TASK] }, exec());
  assert.equal(value.status, "failed");
  assert.equal(value.error, "meshy api 404");
  assert.match(meshy.output.render({}, value)[0].text, /"code":"not_found"/);
});

test("tools: the meshy tool needs a session workspace", async () => {
  const { meshy } = harness();
  await assert.rejects(() => meshy.execute({ args: ["balance"] }, { agent: { session: { header: { id: "s" } } } }), /session workspace/);
});

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

test("tools: a paid command asks first, with the agent's estimate, its source and the balance, in both languages", async () => {
  const { meshy, approvals, runs, exec } = harness({ outcome: imageTo3d({ write: false }) });
  await meshy.execute({ args: ["image-to-3d", "create", "--image-url", "meshy_input/fox.png"], estimated_credits: 30, estimate_source: "Meshy pricing page" }, exec());
  assert.equal(approvals.length, 1);
  const req = approvals[0];
  assert.equal(req.toolName, "meshy");
  assert.equal(req.callId, "call-42");
  assert.equal(req.displayReason.en, "Run meshy image-to-3d create --image-url meshy_input/fox.png. Estimated ~30 credits (Meshy pricing page). Balance: 420 credits.");
  assert.equal(req.displayReason.zh, "运行 meshy image-to-3d create --image-url meshy_input/fox.png。预计约 30 积分（Meshy pricing page）。当前余额 420 积分。");
  assert.equal(req.reason, req.displayReason.en);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].opts.stream, true);
});

test("tools: without an estimate the dialog says the price is unknown and the actual charge applies", async () => {
  const { meshy, approvals, exec } = harness();
  await meshy.execute({ args: ["make", "a red fox"] }, exec());
  assert.match(approvals[0].displayReason.zh, /价格未知，以实际扣费为准。/);
  assert.match(approvals[0].displayReason.en, /Price unknown; the actual charge applies\./);
});

test("tools: make --dry-run, help, a GET api call and other verbs run without asking", async () => {
  const { meshy, approvals, runs, exec } = harness();
  for (const args of [["make", "a red fox", "--dry-run"], ["make", "--help"], ["api", "GET", "/balance"], ["image-to-3d", "list"], ["download", TASK], ["doctor"]]) {
    await meshy.execute({ args }, exec());
  }
  assert.equal(approvals.length, 0);
  assert.equal(runs.length, 6);
  const { approvals: asked } = await (async () => {
    const h = harness();
    await h.meshy.execute({ args: ["api", "POST", "/text-to-3d", "--data", "{}"] }, h.exec());
    return h;
  })();
  assert.equal(asked.length, 1);
});

test("tools: a declined, cancelled or unavailable approval runs nothing (fail closed)", async () => {
  for (const [opts, pattern, name] of [
    [{ approvalOutcome: "rejected" }, /The user declined; meshy make 'a fox' did not run \(0 credits spent\)/, "Error"],
    [{ approvalOutcome: "cancelled" }, /Approval cancelled/, "AbortError"],
    [{ hasApproval: false }, /Approval is unavailable/, "Error"],
    [{ approvalOutcome: async () => { throw new Error("dialog crashed"); } }, /Approval failed \(dialog crashed\)/, "Error"],
  ]) {
    const { meshy, runs, exec } = harness(opts);
    await assert.rejects(() => meshy.execute({ args: ["make", "a fox"] }, exec()), (err) => pattern.test(err.message) && err.name === name);
    assert.equal(runs.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------

test("tools: a paid command becomes a background job; its events drive the card and Studio, its files open", async () => {
  rmSync(join(ws, ".meshy", "dsh-assets.json"), { force: true });
  const jobs = fakeJobs();
  const { meshy, emitted, exec } = harness({ jobs, outcome: imageTo3d() });
  const value = await meshy.execute({ args: ["image-to-3d", "create", "--image-url", "meshy_input/fox.png", "-o", "meshy_output/fox/"], title: "red fox", estimated_credits: 30, estimate_source: "make --dry-run" }, exec({ rootCallId: "root-1" }));
  assert.deepEqual(value, { status: "started", command: "meshy image-to-3d create --image-url meshy_input/fox.png -o meshy_output/fox/", jobId: "job-1", title: "red fox", paid: true, estimate: 30 });
  assert.match(meshy.output.render({}, value)[0].text, /background job job-1/);
  assert.deepEqual(card(meshy, {}, value), { tool: "meshy", status: "started", command: value.command, title: "red fox", jobId: "job-1", paid: true, estimate: 30 });

  const { spec, hooks, progress } = jobs.started[0];
  assert.equal(spec.kind, "meshy");
  assert.equal(spec.owner, "sess-1");
  assert.deepEqual(spec.toolCall, { callId: "call-42", rootCallId: "root-1" });
  assert.match(spec.label, /^red fox · meshy image-to-3d create/);
  const done = await hooks.done;
  assert.equal(done.status, "completed");
  assert.equal(JSON.parse(done.result).command, "image-to-3d create");
  assert.deepEqual(progress, ["PENDING 0%", "IN_PROGRESS 45%"]);

  const tasks = emitted.filter((e) => e.type === "task");
  assert.deepEqual(tasks.map((e) => [e.status, e.progress]), [["PENDING", 0], ["IN_PROGRESS", 45], ["SUCCEEDED", 100]]);
  for (const e of tasks) {
    assert.equal(e.callId, "call-42");
    assert.equal(e.jobId, "job-1");
    assert.equal(e.taskId, TASK);
    assert.equal(e.resource, "image-to-3d");
    assert.equal(e.title, "red fox");
  }
  const last = tasks.at(-1);
  assert.equal(last.kind, "model");
  assert.equal(last.credits, 30);
  assert.equal(last.localFile, "meshy_output/fox/model.glb");
  // Failed files and files outside the workspace are left out.
  assert.deepEqual(last.files, ["meshy_output/fox/model.glb", "meshy_output/fox/preview.png"]);
  assert.ok(emitted.some((e) => e.type === "open" && e.kind === "model" && e.target.file === "meshy_output/fox/model.glb"));
  assert.ok(emitted.some((e) => e.type === "model" && e.file === "meshy_output/fox/model.glb"));

  const index = await readAssetIndex(ws);
  assert.equal(index[TASK].callId, "call-42");
  assert.equal(index[TASK].jobId, "job-1");
  assert.equal(index[TASK].title, "red fox");
  assert.equal(index[TASK].file, "meshy_output/fox/model.glb");
});

test("tools: a wait on a task keeps the name its create gave it, in the index, the card, the job and the Studio", async () => {
  rmSync(join(ws, ".meshy", "dsh-assets.json"), { force: true });
  const jobs = fakeJobs();
  const { meshy, emitted, exec } = harness({ jobs, outcome: imageTo3d() });
  await meshy.execute({ args: ["image-to-3d", "create", "--image-url", "meshy_input/fox.png"], title: "red fox" }, exec());
  await jobs.started[0].hooks.done;
  emitted.length = 0;
  const value = await meshy.execute({ args: ["image-to-3d", "wait", TASK], title: "waiting for the fox" }, exec({ callId: "call-43" }));
  assert.equal(value.title, "red fox");
  assert.match(jobs.started[1].spec.label, /^red fox · meshy image-to-3d wait/);
  await jobs.started[1].hooks.done;
  assert.ok(emitted.filter((e) => e.type === "task").every((e) => e.title === "red fox"));
  const index = await readAssetIndex(ws);
  assert.equal(index[TASK].title, "red fox");
  assert.equal(index[TASK].kind, "model");
  // The Studio row still links to the call that submitted the task.
  assert.equal(index[TASK].callId, "call-42");
  assert.equal(index[TASK].jobId, "job-1");
});

test("tools: a wait on a task this workspace never named shows the task's own name, not the agent's title", async () => {
  rmSync(join(ws, ".meshy", "dsh-assets.json"), { force: true });
  const jobs = fakeJobs();
  const { meshy, emitted, exec } = harness({ jobs, outcome: imageTo3d() });
  const value = await meshy.execute({ args: ["image-to-3d", "wait", `--task-id=${TASK}`], title: "waiting for the fox" }, exec({ callId: "call-50" }));
  assert.equal(value.title, null);
  assert.match(jobs.started[0].spec.label, /^meshy image-to-3d wait/);
  await jobs.started[0].hooks.done;
  assert.ok(emitted.filter((e) => e.type === "task").every((e) => e.title === "Red fox"));
  const index = await readAssetIndex(ws);
  assert.equal(index[TASK].title, null);
  assert.equal(index[TASK].callId, undefined);
});

test("tools: an --async create names its task and gives it the command's resource", async () => {
  rmSync(join(ws, ".meshy", "dsh-assets.json"), { force: true });
  const jobs = fakeJobs();
  const { meshy, emitted, exec } = harness({
    jobs,
    outcome: async () => ({
      ok: true,
      command: "image-to-3d create",
      result: { task: null, submission: { state: "accepted", operation_id: "op-1", task_id: TASK, request_id: "req-1" }, saved_json: null, task_id: TASK, next: { wait: `meshy image-to-3d wait ${TASK}` } },
    }),
  });
  await meshy.execute({ args: ["image-to-3d", "create", "--async", "--image-url", "meshy_input/fox.png"], title: "red fox" }, exec());
  await jobs.started[0].hooks.done;
  const [event] = emitted.filter((e) => e.type === "task");
  assert.equal(event.taskId, TASK);
  assert.equal(event.resource, "image-to-3d");
  assert.equal(event.status, "PENDING");
  assert.equal(event.title, "red fox");
  const index = await readAssetIndex(ws);
  assert.equal(index[TASK].resource, "image-to-3d");
  assert.equal(index[TASK].title, "red fox");
  assert.equal(index[TASK].callId, "call-42");
});

test("tools: a job whose CLI wait timed out fails with the CLI's envelope, which names the wait command", async () => {
  const jobs = fakeJobs();
  const { meshy, exec } = harness({
    jobs,
    outcome: async (_argv, opts) => {
      opts.onEvent?.({ ok: true, event: "task", result: { task: taskView("IN_PROGRESS", 60) } });
      return { ok: false, command: "image-to-3d create", error: { code: "timed_out", message: "stream deadline of 600s reached (last status: IN_PROGRESS); the server keeps running the task", recovery: { action: "wait", command: `meshy image-to-3d wait ${TASK}` } }, result: { task: taskView("IN_PROGRESS", 60), task_id: TASK } };
    },
  });
  await meshy.execute({ args: ["image-to-3d", "create", "--image-url", "meshy_input/fox.png"] }, exec());
  const done = await jobs.started[0].hooks.done;
  assert.equal(done.status, "failed");
  assert.match(done.detail, /"code":"timed_out"/);
  assert.match(done.detail, new RegExp(`meshy image-to-3d wait ${TASK}`));
});

test("tools: killing a job stops the CLI and says the task keeps running", async () => {
  const jobs = fakeJobs();
  const { meshy, exec } = harness({
    jobs,
    outcome: (_argv, opts) => new Promise((_resolve, reject) => {
      opts.onEvent?.({ ok: true, event: "task", result: { task: taskView("IN_PROGRESS", 10) } });
      opts.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  });
  await meshy.execute({ args: ["image-to-3d", "create", "--image-url", "meshy_input/fox.png"] }, exec());
  const { hooks } = jobs.started[0];
  hooks.cancel();
  const done = await hooks.done;
  assert.equal(done.status, "killed");
  assert.match(done.detail, new RegExp(`Task ${TASK} keeps running on Meshy`));
});

test("tools: with no job registry, a failing start, or meshyWait, a paid command runs inside the call", async () => {
  for (const [jobs, extra] of [[null, {}], [fakeJobs({ fail: true }), {}], [fakeJobs(), { meshyWait: true }]]) {
    const { meshy, exec } = harness({ jobs, outcome: imageTo3d() });
    const value = await meshy.execute({ args: ["image-to-3d", "create", "--image-url", "meshy_input/fox.png", "-o", "meshy_output/fox/"] }, exec(extra));
    assert.equal(value.status, "ok");
    assert.equal(value.credits, 30);
    assert.equal(value.file, "meshy_output/fox/model.glb");
    assert.equal(value.tasks[0].status, "SUCCEEDED");
    const meta = card(meshy, {}, value);
    assert.equal(meta.credits, 30);
    assert.equal(meta.tasks[0].thumbnail, "https://assets.meshy.ai/fox.png");
  }
});

test("tools: wait and stream run as jobs too, without asking", async () => {
  const jobs = fakeJobs();
  const { meshy, approvals, exec } = harness({ jobs, outcome: imageTo3d({ write: false }) });
  const value = await meshy.execute({ args: ["image-to-3d", "wait", TASK] }, exec());
  assert.equal(value.status, "started");
  assert.equal(approvals.length, 0);
});

test("tools: the tasks a command ran come from where the CLI's envelope reports them", () => {
  const P = "0190prev12345678";
  const R = "0190refi12345678";
  // make: its executed steps and the task it followed to the end.
  const make = {
    route: "text-to-3d",
    executed: [
      { step: "preview", resource: "text-to-3d", action: "create", task_id: P, status: "SUCCEEDED", operation_id: "op-1" },
      { step: "refine", resource: "text-to-3d", action: "create", task_id: R, status: null, operation_id: "op-2" },
    ],
    task: { task_id: R, resource: "text-to-3d", status: "SUCCEEDED", consumed_credits: 10 },
    submission: { state: "accepted", operation_id: "op-2", task_id: R },
    downloads: { state: "completed", files: [{ path: "/w/a.glb", status: "written" }, { path: "/w/b.fbx", status: "failed" }] },
    raw: { task_id: "0190rawx12345678", status: "SUCCEEDED" },
  };
  const made = collectTasks(make);
  assert.deepEqual(made.map((t) => [t.task_id, t.resource, t.status]), [[P, "text-to-3d", "SUCCEEDED"], [R, "text-to-3d", "SUCCEEDED"]]);
  assert.equal(made[1].consumed_credits, 10);
  assert.deepEqual(collectFiles(make), ["/w/a.glb"]);
  // make --async: the step it submitted.
  assert.deepEqual(collectTasks({ submitted: { step: "preview", resource: "text-to-3d", action: "create", task_id: P }, submission: { state: "accepted", task_id: P }, task: null, executed: [] }).map((t) => [t.task_id, t.resource]), [[P, "text-to-3d"]]);
  // create --async: a submission, with the command's resource.
  assert.deepEqual(collectTasks({ task: null, submission: { state: "accepted", operation_id: "op-1", task_id: TASK }, task_id: TASK }, "image-to-3d").map((t) => [t.task_id, t.resource]), [[TASK, "image-to-3d"]]);
  // A list names other tasks: none of them ran here.
  assert.deepEqual(collectTasks({ items: [{ task_id: P, resource: "text-to-3d", status: "SUCCEEDED" }] }, "text-to-3d"), []);
  assert.deepEqual(collectTasks(null), []);
});

// ---------------------------------------------------------------------------
// Sign-in and preview
// ---------------------------------------------------------------------------

test("tools: meshy_sign_in returns the link and code, with its card in presentationMeta", async () => {
  const { byName } = harness();
  const tool = byName.get("meshy_sign_in");
  const value = await tool.execute({ region: "cn" });
  assert.match(tool.output.render({ region: "cn" }, value)[0].text, /meshy\.cn\/device.*ABCD-1234/);
  assert.deepEqual(card(tool, { region: "cn" }, value), { tool: "meshy_sign_in", status: "waiting_for_approval", verificationUrl: "https://www.meshy.cn/device", userCode: "ABCD-1234", expiresIn: 600, region: "cn" });
  await assert.rejects(() => tool.execute({ region: "mars" }), /region/);
});

test("tools: meshy_preview_model opens a workspace file, or a task the CLI lists, in the Studio", async () => {
  const { byName, emitted, exec } = harness();
  const tool = byName.get("meshy_preview_model");
  const file = await tool.execute({ file: "mesh.glb" }, exec());
  assert.deepEqual(file, { status: "ok", kind: "model", file: "mesh.glb", resource: null, taskId: null });
  // A 3MF print file opens in the Studio as a model too.
  writeFileSync(join(ws, "print.3mf"), "PK");
  assert.equal((await tool.execute({ file: "print.3mf" }, exec())).kind, "model");
  const task = await tool.execute({ resource: "image-to-3d", task_id: TASK }, exec());
  assert.equal(task.kind, "model");
  assert.deepEqual(emitted.filter((e) => e.type === "open").map((e) => e.target), [{ file: "mesh.glb" }, { file: "print.3mf" }, { resource: "image-to-3d", taskId: TASK }]);
  await assert.rejects(() => tool.execute({ resource: "balance", task_id: TASK }, exec()), /not a Meshy task/);
  await assert.rejects(() => tool.execute({ file: "../outside.glb" }, exec()));
  await assert.rejects(() => tool.execute({}, exec()), /provide either/);
});

test("tools: three tools, and every schema conforms to DSH's JSON Schema subset", () => {
  const { byName } = harness();
  const tools = [...byName.values()];
  assert.deepEqual(tools.map((t) => t.name), ["meshy", "meshy_sign_in", "meshy_preview_model"]);
  const VALID_TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
  const ALLOWED_KEYS = new Set(["type", "oneOf", "properties", "required", "additionalProperties", "items", "enum", "const", "description", "title", "default", "examples"]);
  function validateSchema(node, path) {
    assert.ok(node && typeof node === "object" && !Array.isArray(node), `${path} must be an object`);
    for (const key of Object.keys(node)) assert.ok(ALLOWED_KEYS.has(key), `${path}.${key} is not a supported DSH schema keyword`);
    if ("oneOf" in node) {
      node.oneOf.forEach((branch, i) => validateSchema(branch, `${path}.oneOf[${i}]`));
      return;
    }
    assert.ok(VALID_TYPES.has(node.type), `${path}.type "${node.type}" invalid`);
    if (node.type === "object" && node.properties) {
      for (const [k, v] of Object.entries(node.properties)) validateSchema(v, `${path}.properties.${k}`);
      for (const k of node.required ?? []) assert.ok(k in node.properties, `${path}.required "${k}" missing`);
    }
    if (node.type === "array" && node.items) validateSchema(node.items, `${path}.items`);
  }
  for (const tool of tools) {
    validateSchema(tool.parameters, `${tool.name}.parameters`);
    validateSchema(tool.output.schema, `${tool.name}.output.schema`);
    assert.equal(typeof tool.output.presentationMeta, "function");
  }
  // The paid tool stays exclusive: dsh never runs two of them at once on its own.
  assert.equal(byName.get("meshy").isConcurrencySafe, undefined);
});
