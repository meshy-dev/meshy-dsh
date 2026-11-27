// Unit tests for lib/tasks.js and lib/catalog.js: the CLI's own command listing, journal parsing,
// per-chat state directories, task cache/concurrency, account library aggregation, bounded
// workspace GLB walk, asset URL filtering, size-capped model streaming, path traversal refusal,
// and the asset index.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assetUrl,
  createLibraryReader,
  createTaskStates,
  glbsOf,
  fetchModel,
  kindOfResource,
  listModels,
  outputKind,
  readAssetIndex,
  readJournal,
  recordAsset,
  resolveWorkspaceFile,
  serveWorkspaceModel,
  sessionStateDir,
  TASK_ID,
  viewOf,
} from "../lib/tasks.js";
import { classify, commandTokens, createCatalog, parseResources } from "../lib/catalog.js";
import { RESOURCES, withResources } from "./fixtures/resources.mjs";

const dir = mkdtempSync(join(tmpdir(), "meshy-dsh-tasks-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("catalog: task commands come from `meshy resources`, never from a name alone", async () => {
  let reads = 0;
  const catalog = createCatalog({ cli: withResources(() => { throw new Error("no other call"); }), now: () => 0 });
  const counting = createCatalog({ cli: async (args) => { reads++; return RESOURCES; } });
  assert.deepEqual(await catalog.taskArgs("text-to-3d", "get", "0190abcdef1234"), ["text-to-3d", "get", "0190abcdef1234"]);
  assert.deepEqual(await catalog.taskArgs("creative-lab.figure.build", "get", "0190abcdef1234"), ["creative-lab", "figure", "build", "get", "0190abcdef1234"]);
  assert.equal(await catalog.taskArgs("text-to-3d", "get", "-flag-injection"), undefined);
  assert.equal(await catalog.taskArgs("text-to-3d", "get", "short"), undefined);
  // Not a task resource (a query, a local command) or not listed at all: refused.
  assert.equal(await catalog.taskArgs("balance", "get", "0190abcdef1234"), undefined);
  assert.equal(await catalog.taskArgs("make", "get", "0190abcdef1234"), undefined);
  assert.equal(await catalog.taskArgs("not-a-resource", "get", "0190abcdef1234"), undefined);
  assert.equal(await catalog.taskArgs("../x", "get", "0190abcdef1234"), undefined);
  assert.equal(TASK_ID.test("--help"), false);
  assert.equal(TASK_ID.test("0190abcd-1234"), true);
  assert.deepEqual([...(await catalog.listable())].sort().slice(0, 3), ["animate", "creative-lab.figure.build", "image-to-3d"]);
  // Read once, then kept.
  await counting.taskCommand("remesh");
  await counting.taskCommand("rigging");
  assert.equal(reads, 1);
  assert.deepEqual(commandTokens("meshy creative-lab figure build"), ["creative-lab", "figure", "build"]);
  assert.deepEqual(commandTokens("meshy x; rm -rf /"), []);
  assert.equal(parseResources({ ok: false }), null);
});

test("catalog: a failed listing is read again next time, and fails closed meanwhile", async () => {
  let up = false;
  const catalog = createCatalog({ cli: async () => (up ? RESOURCES : { ok: false, error: { message: "broken" } }) });
  assert.equal(await catalog.taskCommand("text-to-3d"), undefined);
  assert.deepEqual(await catalog.classify(["remesh", "create", "--input-task-id", "x"]), { paid: true, long: true, resource: null, verb: null });
  up = true;
  assert.deepEqual(await catalog.taskCommand("text-to-3d"), ["text-to-3d"]);
});

test("catalog: what needs approval follows the CLI's contract", () => {
  const items = parseResources(RESOURCES);
  const c = (argv) => classify(argv, items);
  // make spends, except a dry run; help never does.
  assert.equal(c(["make", "a red fox"]).paid, true);
  assert.equal(c(["make", "a red fox"]).long, true);
  assert.equal(c(["make", "a red fox", "--dry-run"]).paid, false);
  assert.equal(c(["make", "--help"]).paid, false);
  // create on a task resource spends and runs long; its other verbs do not spend.
  assert.deepEqual(c(["image-to-3d", "create", "--image-url", "a.png"]), { paid: true, long: true, resource: "image-to-3d", verb: "create" });
  assert.deepEqual(c(["creative-lab", "figure", "build", "create"]), { paid: true, long: true, resource: "creative-lab.figure.build", verb: "create" });
  assert.deepEqual(c(["image-to-3d", "wait", "0190abcdef1234"]), { paid: false, long: true, resource: "image-to-3d", verb: "wait" });
  assert.deepEqual(c(["image-to-3d", "get", "0190abcdef1234"]), { paid: false, long: false, resource: "image-to-3d", verb: "get" });
  assert.equal(c(["image-to-3d", "create", "--help"]).paid, false);
  // Not a task resource: nothing to approve.
  assert.equal(c(["balance"]).paid, false);
  assert.equal(c(["download", "0190abcdef1234"]).paid, false);
  assert.equal(c(["delete", "0190abcdef1234"]).paid, false);
  // api: only GET runs without asking; an unclear method asks.
  assert.equal(c(["api", "GET", "/balance"]).paid, false);
  assert.equal(c(["api", "get", "/balance"]).paid, false);
  assert.equal(c(["api", "POST", "/text-to-3d"]).paid, true);
  assert.equal(c(["api", "--v2", "GET", "/x"]).paid, true);
});

test("tasks: each chat's CLI state lives in its own folder under .meshy/sessions", () => {
  assert.equal(sessionStateDir("/ws", "4c4f01a8-15b6"), join("/ws", ".meshy", "sessions", "4c4f01a8-15b6"));
  assert.equal(sessionStateDir("/ws", "../../etc"), join("/ws", ".meshy", "sessions", "__.._etc"));
  assert.equal(sessionStateDir("/ws", ".."), join("/ws", ".meshy", "sessions", "_"));
  assert.equal(sessionStateDir("/ws", undefined), join("/ws", ".meshy", "sessions", "unknown"));
});

test("tasks: assetUrl allows only https on meshy.ai / meshy.cn hosts", () => {
  assert.equal(assetUrl("https://assets.meshy.ai/a.glb"), "https://assets.meshy.ai/a.glb");
  assert.equal(assetUrl("https://cdn.meshy.cn/b.png"), "https://cdn.meshy.cn/b.png");
  assert.equal(assetUrl("http://assets.meshy.ai/a.glb"), null);
  assert.equal(assetUrl("https://evil-meshy.ai/a.glb"), null);
  assert.equal(assetUrl("https://meshy.ai.evil.com/a.glb"), null);
  assert.equal(assetUrl("https://user:pass@assets.meshy.ai/a.glb"), null);
});

test("tasks: readJournal parses valid v1 records newest first and ignores malformed files", async () => {
  const jdir = join(dir, "journal");
  mkdirSync(jdir, { recursive: true });
  writeFileSync(join(jdir, "op-old.json"), JSON.stringify({
    schema_version: 1, operation_id: "op-old", resource: "text-to-3d", state: "accepted", task_id: "0190old12345", started_at: "2026-11-20T00:00:00Z",
  }));
  writeFileSync(join(jdir, "op-new.json"), JSON.stringify({
    schema_version: 1, operation_id: "op-new", resource: "image-to-3d", state: "accepted", task_id: "0190new12345", started_at: "2026-11-26T00:00:00Z",
  }));
  writeFileSync(join(jdir, "broken.json"), "{not-json");
  writeFileSync(join(jdir, ".hidden.json"), JSON.stringify({
    schema_version: 1, operation_id: "hidden", resource: "text-to-3d", state: "accepted", started_at: "2026-11-26T01:00:00Z",
  }));

  const all = await readJournal(jdir);
  assert.deepEqual(all.map((r) => r.operationId), ["op-new", "op-old"]);
  const filtered = await readJournal(jdir, { since: Date.parse("2026-11-25T00:00:00Z") });
  assert.deepEqual(filtered.map((r) => r.operationId), ["op-new"]);
});

test("tasks: createTaskStates caches live/terminal states and enforces concurrency limit", async () => {
  let clock = 1000;
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const states = createTaskStates({
    catalog: createCatalog({ cli: async () => RESOURCES }),
    now: () => clock,
    liveMs: 4000,
    doneMs: 60_000,
    concurrency: 2,
    cli: async (args) => {
      calls++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      const id = args[2];
      return {
        ok: true,
        result: {
          task: {
            task_id: id,
            status: id.includes("done") ? "SUCCEEDED" : "IN_PROGRESS",
            progress: id.includes("done") ? 100 : 50,
            model_urls: id.includes("done") ? { glb: "https://assets.meshy.ai/ok.glb" } : {},
          },
        },
      };
    },
  });

  // Deduplicated concurrent requests + max 2 concurrency across 4 tasks
  const [a1, a2] = await Promise.all([
    states.get("text-to-3d", "0190running11"),
    states.get("text-to-3d", "0190running11"),
    states.get("text-to-3d", "0190running22"),
    states.get("text-to-3d", "0190done12345"),
  ]);
  assert.equal(a1.view.progress, 50);
  assert.equal(a2.view.progress, 50);
  assert.equal(maxInFlight, 2);
  assert.equal(calls, 3);

  // Within liveMs: cached
  clock += 2000;
  await states.get("text-to-3d", "0190running11");
  assert.equal(calls, 3);

  // Past liveMs: re-reads running, keeps done cached
  clock += 3000;
  await states.get("text-to-3d", "0190running11");
  await states.get("text-to-3d", "0190done12345");
  assert.equal(calls, 4);
});

test("tasks: createLibraryReader aggregates, sorts newest first, caches, and handles unauthenticated", async () => {
  let cliCalls = 0;
  let signedIn = true;
  const NOW = 1_800_000_000_000;
  const DAY = 24 * 3600_000;
  const pages = [];
  const reader = createLibraryReader({
    catalog: createCatalog({ cli: async () => RESOURCES }),
    now: () => NOW,
    cli: async (args) => {
      cliCalls++;
      pages.push(args[args.indexOf("--page-size") + 1]);
      if (!signedIn) return { ok: false, error: { code: "auth", message: "not signed in" } };
      const res = args[0];
      const age = ["retexture", "rigging", "animate", "multi-image-to-3d", "image-to-3d", "text-to-3d", "text-to-image", "image-to-image"].indexOf(res) + 1;
      const output = res.endsWith("image") ? { image_urls: ["https://assets.meshy.ai/x.png"] } : { model_urls: { glb: "https://assets.meshy.ai/x.glb" } };
      return {
        ok: true,
        result: {
          items: [
            { task_id: `0190${res.replace(/-/g, "")}1`, status: "SUCCEEDED", name: `${res}-a`, created_at: NOW - age * 3600_000, ...output },
            // Past the API's 3-day retention (no expires_at: counted from finished_at).
            { task_id: `0190${res.replace(/-/g, "")}2`, status: "SUCCEEDED", name: "old", created_at: NOW - 4 * DAY, finished_at: NOW - 3 * DAY - 1, ...output },
            // expires_at already passed, though created recently.
            { task_id: `0190${res.replace(/-/g, "")}3`, status: "SUCCEEDED", name: "gone", created_at: NOW - 3600_000, expires_at: new Date(NOW - 1000).toISOString(), ...output },
          ],
        },
      };
    },
  });

  const first = await reader.list();
  assert.equal(first.authenticated, true);
  assert.equal(first.retentionDays, 3);
  // Models and images both, newest first; each item says which it is. Expired ones are gone.
  assert.deepEqual(first.items.map((i) => i.resource), ["retexture", "rigging", "animate", "multi-image-to-3d", "image-to-3d", "text-to-3d", "text-to-image", "image-to-image"]);
  assert.deepEqual(first.items.map((i) => i.kind), ["model", "model", "model", "model", "model", "model", "image", "image"]);
  assert.equal(first.items[0].expiresAt, NOW - 3600_000 + 3 * DAY);
  assert.deepEqual([...new Set(pages)], ["30"]);
  assert.equal(cliCalls, 8);

  // Cached hit
  await reader.list();
  assert.equal(cliCalls, 8);

  // Refresh bypasses cache; auth error reports authenticated: false
  signedIn = false;
  const unauth = await reader.list({ limit: 10, refresh: true });
  assert.deepEqual(unauth, { authenticated: false, items: [], retentionDays: 3 });

  await assert.rejects(() => reader.list({ resource: "bad-resource" }), /unsupported library resource/);
});

test("tasks: createLibraryReader lists a task once, under the resource its type names", async () => {
  const NOW = 1_800_000_000_000;
  const t2i = { task_id: "0190t2ishared1", type: "text-to-image", status: "SUCCEEDED", created_at: NOW - 60_000, image_urls: ["https://assets.meshy.ai/a.png"] };
  const i2i = { task_id: "0190i2iown0001", type: "image-to-image", status: "SUCCEEDED", created_at: NOW - 120_000, image_urls: ["https://assets.meshy.ai/b.png"] };
  const reader = createLibraryReader({
    catalog: createCatalog({ cli: async () => RESOURCES }),
    now: () => NOW,
    cli: async (args) => {
      const res = args[0];
      // The API's image-to-image list also returns text-to-image tasks.
      if (res === "image-to-image") return { ok: true, result: { items: [t2i, i2i] } };
      if (res === "text-to-image") return { ok: true, result: { items: [t2i] } };
      return { ok: true, result: { items: [] } };
    },
  });
  const all = await reader.list();
  assert.deepEqual(all.items.map((i) => [i.resource, i.taskId]), [["text-to-image", "0190t2ishared1"], ["image-to-image", "0190i2iown0001"]]);
  const onlyEdits = await reader.list({ resource: "image-to-image" });
  assert.deepEqual(onlyEdits.items.map((i) => i.taskId), ["0190i2iown0001"]);
});

test("tasks: listModels walks workspace boundedly, includes .meshy/models, skips node_modules and symlinks", async () => {
  const ws = join(dir, "ws-models");
  mkdirSync(join(ws, "meshy_output"), { recursive: true });
  mkdirSync(join(ws, ".meshy", "models"), { recursive: true });
  mkdirSync(join(ws, ".hidden"), { recursive: true });
  mkdirSync(join(ws, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(ws, "meshy_output", "a.glb"), "aaa");
  writeFileSync(join(ws, "meshy_output", "print.3mf"), "PK");
  writeFileSync(join(ws, ".meshy", "models", "b.glb"), "bbb");
  writeFileSync(join(ws, ".hidden", "secret.glb"), "ccc");
  writeFileSync(join(ws, "node_modules", "pkg", "dep.glb"), "ddd");
  const outside = join(dir, "outside.glb");
  writeFileSync(outside, "outside");
  symlinkSync(outside, join(ws, "linked.glb"));

  const models = await listModels(ws);
  const names = models.map((m) => m.file).sort();
  assert.deepEqual(names, [".meshy/models/b.glb", "meshy_output/a.glb", "meshy_output/print.3mf"]);
});

test("tasks: workspace path resolution refuses traversal, symlinks escaping workspace, and non-glb preview", async () => {
  const ws = join(dir, "ws-safe");
  mkdirSync(join(ws, "sub"), { recursive: true });
  writeFileSync(join(ws, "sub", "ok.glb"), "glb-data");
  writeFileSync(join(ws, "sub", "print.3mf"), "3mf-data");
  writeFileSync(join(ws, "sub", "notes.txt"), "text");
  const secret = join(dir, "secret.glb");
  writeFileSync(secret, "secret");
  symlinkSync(secret, join(ws, "escape.glb"));

  const ok = await resolveWorkspaceFile(ws, "sub/ok.glb", { allowedExts: new Set([".glb"]) });
  assert.equal(ok.rel, "sub/ok.glb");

  await assert.rejects(() => resolveWorkspaceFile(ws, "../secret.glb"), /escapes/);
  await assert.rejects(() => resolveWorkspaceFile(ws, "escape.glb"), /escapes/);
  await assert.rejects(() => resolveWorkspaceFile(ws, "sub/notes.txt", { allowedExts: new Set([".glb"]) }), /unsupported file extension/);

  const res = await serveWorkspaceModel(ws, "sub/ok.glb");
  assert.equal(res.headers.get("content-type"), "model/gltf-binary");
  assert.equal(await res.text(), "glb-data");
  const print = await serveWorkspaceModel(ws, "sub/print.3mf");
  assert.equal(print.headers.get("content-type"), "model/3mf");
  await assert.rejects(() => serveWorkspaceModel(ws, "sub/notes.txt"), /unsupported file extension/);
  await assert.rejects(() => serveWorkspaceModel(ws, "sub/ok.glb", { max: 2 }), /too large/);
});

test("tasks: fetchModel refuses non-Meshy hosts and enforces streaming byte cap", async () => {
  await assert.rejects(() => fetchModel("https://evil.example/a.glb"), /not a Meshy asset URL/);

  const fakeFetch = async () => new Response(new Uint8Array(100), { status: 200, headers: { "content-length": "100" } });
  const ok = await fetchModel("https://assets.meshy.ai/ok.glb", { max: 200, fetchImpl: fakeFetch });
  assert.equal((await ok.arrayBuffer()).byteLength, 100);

  await assert.rejects(() => fetchModel("https://assets.meshy.ai/big.glb", { max: 50, fetchImpl: fakeFetch }), /too large/);

  // Undisclosed content-length still capped while streaming
  const streamFetch = async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(40)); c.enqueue(new Uint8Array(40)); c.close(); },
  }), { status: 200 });
  const res = await fetchModel("https://assets.meshy.ai/stream.glb", { max: 50, fetchImpl: streamFetch });
  await assert.rejects(() => res.arrayBuffer(), /too large/);
});


test("tasks: the asset index records tasks atomically and keeps concurrent writes", async () => {
  const ws = join(dir, "ws-index");
  mkdirSync(ws, { recursive: true });
  assert.deepEqual(await readAssetIndex(ws), {});
  await Promise.all(Array.from({ length: 8 }, (_, i) => recordAsset(ws, `0190idx${String(i).padStart(7, "0")}`, {
    resource: "text-to-3d", title: `Item ${i}`, file: `meshy_output/item-${i}.glb`, files: [`meshy_output/item-${i}.glb`],
  })));
  const index = await readAssetIndex(ws);
  assert.equal(Object.keys(index).length, 8);
  assert.deepEqual(index["0190idx0000003"], {
    resource: "text-to-3d", kind: null, title: "Item 3", file: "meshy_output/item-3.glb", files: ["meshy_output/item-3.glb"], createdAt: index["0190idx0000003"].createdAt,
  });
  // A later download merges into the entry and keeps the task's first name; what it produced is
  // recorded once known; a bad id is ignored; no temp files are left behind.
  await recordAsset(ws, "0190idx0000003", { files: ["meshy_output/item-3.fbx"], file: "meshy_output/item-3.fbx", title: "Waiting for item 3", kind: "model" });
  let entry = (await readAssetIndex(ws))["0190idx0000003"];
  assert.equal(entry.title, "Item 3");
  assert.equal(entry.kind, "model");
  // Files accumulate; the one the Studio opens stays the most previewable (a GLB over an FBX).
  assert.deepEqual(entry.files, ["meshy_output/item-3.glb", "meshy_output/item-3.fbx"]);
  assert.equal(entry.file, "meshy_output/item-3.glb");
  // A later 3MF does not replace the GLB either; a "nothing" read never downgrades a model.
  await recordAsset(ws, "0190idx0000003", { files: ["meshy_output/item-3.3mf"], file: "meshy_output/item-3.3mf", kind: "none" });
  entry = (await readAssetIndex(ws))["0190idx0000003"];
  assert.equal(entry.file, "meshy_output/item-3.glb");
  assert.equal(entry.files.length, 3);
  assert.equal(entry.kind, "model");
  // Without a GLB, a 3MF is preferred over an image.
  await recordAsset(ws, "0190idx0000099", { files: ["out/p.png", "out/p.3mf"], file: "out/p.png" });
  assert.equal((await readAssetIndex(ws))["0190idx0000099"].file, "out/p.3mf");
  assert.equal(await recordAsset(ws, "--bad", { file: "x" }), null);
  assert.deepEqual(readdirSync(join(ws, ".meshy")), ["dsh-assets.json"]);
  assert.equal(statSync(join(ws, ".meshy", "dsh-assets.json")).mode & 0o777, 0o600);
  assert.ok(existsSync(join(ws, ".meshy", "dsh-assets.json")));
});

test("tasks: outputKind reads what a task produced; kindOfResource only guesses for a running one", () => {
  assert.equal(outputKind(viewOf({ task_id: "0190abc12345", status: "SUCCEEDED", model_urls: { "3mf": "https://assets.meshy.ai/m.3mf" } })), "model");
  assert.equal(outputKind(viewOf({ task_id: "0190abc12345", status: "SUCCEEDED", result: { rigged_character_glb_url: "https://assets.meshy.ai/r.glb" } })), "model");
  assert.equal(outputKind(viewOf({ task_id: "0190abc12345", status: "SUCCEEDED", image_urls: ["https://assets.meshy.ai/a.png"] })), "image");
  // A printability report: finished, nothing to show.
  assert.equal(outputKind(viewOf({ task_id: "0190abc12345", status: "SUCCEEDED", printability: { ok: true } })), "none");
  assert.equal(outputKind(viewOf({ task_id: "0190abc12345", status: "IN_PROGRESS" })), null);
  assert.equal(outputKind(null), null);
  // A URL the plugin will not fetch still says what the task made.
  assert.equal(outputKind(viewOf({ task_id: "0190abc12345", status: "SUCCEEDED", model_urls: { glb: "http://example.com/m.glb" } })), "model");
  assert.equal(outputKind(viewOf({ task_id: "0190abc12345", status: "SUCCEEDED", image_urls: ["http://example.com/a.png"] })), "image");
  assert.equal(kindOfResource("text-to-image"), "image");
  assert.equal(kindOfResource("image-to-image"), "image");
  assert.equal(kindOfResource("multi-image-to-3d"), "model");
  assert.equal(kindOfResource("analyze-printability"), "model");
});

test("tasks: a task with only a print file keeps its 3MF host-side as the model to show", () => {
  const v = viewOf({ task_id: "0190abc12345", status: "SUCCEEDED", model_urls: { "3mf": "https://assets.meshy.ai/p.3mf" } });
  assert.equal(v.glb, null);
  assert.equal(v.printFile, "https://assets.meshy.ai/p.3mf");
  assert.deepEqual(v.formats, ["3mf"]);
  assert.equal(outputKind(v), "model");
});

test("tasks: viewOf extracts formats, thumbnail fallback from image_urls, and parentTaskId", () => {
  const v = viewOf({
    task_id: "0190abc12345",
    status: "SUCCEEDED",
    progress: 100,
    preview_task_id: "0190prev1234",
    image_urls: ["https://assets.meshy.ai/out.png"],
    model_urls: { glb: "https://assets.meshy.ai/m.glb", obj: "https://assets.meshy.ai/m.obj", fbx: "https://evil.com/x.fbx" },
  });
  assert.equal(v.thumbnail, "https://assets.meshy.ai/out.png");
  assert.deepEqual(v.formats, ["glb", "obj"]);
  assert.equal(v.parentTaskId, "0190prev1234");
});

test("tasks: glbsOf and viewOf expose a rigging task's GLB variants, preferring an animated one", () => {
  const rigging = {
    task_id: "0190rig0000001",
    status: "SUCCEEDED",
    result: {
      rigged_character_glb_url: "https://assets.meshy.ai/rigged.glb",
      rigged_character_fbx_url: "https://assets.meshy.ai/rigged.fbx",
      basic_animations: {
        walking_glb_url: "https://assets.meshy.ai/walking.glb",
        walking_armature_glb_url: "https://assets.meshy.ai/walking-armature.glb",
        running_glb_url: "https://assets.meshy.ai/running.glb",
      },
    },
  };
  assert.deepEqual(glbsOf(rigging), {
    rigged: "https://assets.meshy.ai/rigged.glb",
    walking: "https://assets.meshy.ai/walking.glb",
    running: "https://assets.meshy.ai/running.glb",
  });
  const view = viewOf(rigging);
  assert.equal(view.glb, "https://assets.meshy.ai/walking.glb");
  assert.deepEqual(view.variants, ["rigged", "walking", "running"]);

  const animation = { task_id: "0190anim000001", status: "SUCCEEDED", result: { animation_glb_url: "https://assets.meshy.ai/anim.glb", animation_fbx_url: "https://assets.meshy.ai/anim.fbx" } };
  assert.equal(viewOf(animation).glb, "https://assets.meshy.ai/anim.glb");
  assert.deepEqual(viewOf(animation).variants, ["animation"]);

  const model = { task_id: "0190model00001", status: "SUCCEEDED", model_urls: { glb: "https://assets.meshy.ai/m.glb", fbx: "https://assets.meshy.ai/m.fbx" } };
  assert.deepEqual(viewOf(model).variants, ["model"]);
  assert.deepEqual(viewOf({ task_id: "0190none000001", status: "SUCCEEDED", result: { rigged_character_glb_url: "http://insecure.example/x.glb" } }).variants, []);
});
