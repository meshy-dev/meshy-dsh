// Unit tests for lib/service.js (the public `meshy` Cordis service) and lib/compose.js (the
// adaptive `meshy:compose` system prompt section).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCatalog } from "../lib/catalog.js";
import { buildComposeText, registerCompose } from "../lib/compose.js";
import { createEventBus } from "../lib/events.js";
import { createMeshyService } from "../lib/service.js";
import { createLibraryReader, createTaskStates, readAssetIndex } from "../lib/tasks.js";
import { createTools } from "../lib/tools.js";
import { withResources } from "./fixtures/resources.mjs";

const dir = mkdtempSync(join(tmpdir(), "meshy-dsh-service-"));
const ws = join(dir, "workspace");
mkdirSync(ws, { recursive: true });
writeFileSync(join(ws, "hero.glb"), Buffer.from("glTF-hero"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

function setup({ approvalOutcome = "allowed-once" } = {}) {
  const events = createEventBus();
  const emitted = [];
  events.subscribe((e) => emitted.push(e));
  const approvals = [];
  const runs = [];
  const cli = withResources(async (argv, opts) => {
    if (argv[0] === "balance") return { ok: true, result: { balance: 99 } };
    runs.push({ argv, opts });
    if (argv[1] === "get") return { ok: true, result: { task: { task_id: argv[2], status: "SUCCEEDED", progress: 100 } } };
    return { ok: true, command: argv[0], result: { task: { task_id: "0190made12345678", resource: "text-to-3d", status: "SUCCEEDED", progress: 100, consumed_credits: 30 } } };
  });
  const catalog = createCatalog({ cli });
  const ctx = { approval: { request: async (req) => { approvals.push(req); return approvalOutcome; } }, jobs: { start: () => { throw new Error("the service never starts a job"); } } };
  const { meshyTool } = createTools({ ctx, cli, catalog, signIn: async () => ({}), events });
  const service = createMeshyService({
    getStatus: async () => ({ authenticated: true, region: "global", balance: 99 }),
    sessionTasks: async (id) => ({ workspace: ws, tasks: [{ id: "op-1", sessionId: id }], models: [] }),
    library: createLibraryReader({ cli, catalog }),
    taskStates: createTaskStates({ cli, catalog }),
    events,
    meshyTool,
  });
  return { service, approvals, runs, emitted };
}

test("service: exposes status, tasks, models, ui, run and subscribe; no price table and no typed generators", async () => {
  const { service, emitted } = setup();
  assert.equal(service.version, 1);
  assert.equal(service.pricing, undefined);
  assert.equal(service.generate, undefined);
  assert.deepEqual(await service.status(), { authenticated: true, region: "global", balance: 99 });
  assert.equal((await service.tasks.session("s-1")).tasks[0].sessionId, "s-1");
  assert.equal((await service.tasks.get("text-to-3d", "0190abcdef1234")).view.status, "SUCCEEDED");
  assert.equal(await service.tasks.get("make", "0190abcdef1234"), undefined);
  assert.deepEqual((await service.models.list(ws)).map((m) => m.file), ["hero.glb"]);

  const announced = await service.models.announce(ws, "hero.glb", { sessionId: "s-1", taskId: "0190hero12345678", resource: "text-to-3d" });
  assert.deepEqual(announced, { file: "hero.glb" });
  assert.equal((await readAssetIndex(ws))["0190hero12345678"].file, "hero.glb");
  await assert.rejects(() => service.models.announce(ws, "../x.glb"));

  service.ui.openModel("s-1", { file: "hero.glb" });
  service.ui.openTasks("s-1");
  const got = [];
  const off = service.subscribe((e) => got.push(e.type));
  service.ui.openTasks("s-1");
  off();
  service.ui.openTasks("s-1");
  assert.deepEqual(got, ["open"]);
  assert.equal(emitted.filter((e) => e.type === "open").length, 4);
});

test("service: run takes CLI arguments, asks the user before a paid command, and waits for the result", async () => {
  const { service, approvals, runs } = setup();
  const agent = { session: { header: { id: "s-1", cwd: ws } } };
  const free = await service.run({ agent, args: ["image-to-3d", "get", "0190abcdef1234"] });
  assert.equal(free.status, "ok");
  assert.equal(approvals.length, 0);

  const made = await service.run({ agent, requester: "Canvas plugin", args: ["make", "a red fox"], estimatedCredits: 30, estimateSource: "make --dry-run", title: "fox" });
  assert.equal(made.status, "ok");
  assert.equal(made.credits, 30);
  assert.equal(made.title, "fox");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].displayReason.en, "Run meshy make 'a red fox' (requested by Canvas plugin). Estimated ~30 credits (make --dry-run). Balance: 99 credits.");
  assert.deepEqual(runs.at(-1).argv, ["make", "a red fox"]);

  const declined = setup({ approvalOutcome: "rejected" });
  await assert.rejects(() => declined.service.run({ agent, args: ["make", "a red fox"] }), /declined/);
  assert.equal(declined.runs.length, 0);
});

test("compose: guides the meshy tool and the skills' cost rule, adapts only to installed tools, never mentions installing plugins", () => {
  const baseCtx = { tools: { definitions: () => [{ name: "meshy" }] } };
  const base = buildComposeText(baseCtx);
  assert.match(base, /native `meshy` tool/);
  assert.match(base, /`make --dry-run` or the published price list, never a guess/);
  assert.match(base, /background jobs/);
  assert.match(base, /do not poll/);
  assert.match(base, /`wait` command the envelope names/);
  assert.match(base, /meshy_input\//);
  assert.match(base, /meshy_sign_in/);
  assert.match(base, /`--help`/);
  // No CLI flag, model or price lives in the prompt: the skills teach those.
  assert.ok(!/--image-url|meshy-7|meshy-6|credits\b.*\d/.test(base));
  assert.ok(!/canvas_write/.test(base));
  assert.ok(!/interactive UI rendering/.test(base));
  assert.ok(!/plugin_manager|install .*plugin/i.test(base));

  const enhanced = buildComposeText({ tools: { definitions: () => [{ name: "meshy" }, { name: "canvas_write" }, { name: "genui_render" }] } });
  assert.match(enhanced, /canvas_write/);
  assert.match(enhanced, /interactive UI rendering/);

  // A tool set without any Meshy tool gets no section.
  assert.equal(buildComposeText({ tools: { definitions: () => [{ name: "read_file" }] } }, { toolSet: {} }), "");
  assert.notEqual(buildComposeText({ tools: { definitions: () => [{ name: "meshy_sign_in" }] } }, { toolSet: {} }), "");

  let registered = null;
  registerCompose({ systemPrompt: { section: (s) => { registered = s; } }, tools: baseCtx.tools });
  assert.equal(registered.name, "meshy:compose");
  assert.equal(registered.interpolate, false);
  assert.match(registered.text({}), /Meshy 3D Creation/);
});
