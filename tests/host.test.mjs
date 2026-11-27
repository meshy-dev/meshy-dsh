// The host half, run against a fake CLI (MESHY_DSH_CLI): fixed arguments, validated input,
// session env, the three tools, all 11 /api/meshy.* routes (including SSE filtering, env.hdr and
// the composer's image input), Cordis service registration, and adaptive compose prompt. No
// network, no real CLI.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESOURCES } from "./fixtures/resources.mjs";

const dir = mkdtempSync(join(tmpdir(), "meshy-dsh-host-"));
const log = join(dir, "calls.log");
const store = join(dir, "store");
const ws = join(dir, "workspace");
mkdirSync(store);
mkdirSync(join(ws, ".meshy", "operations"), { recursive: true });
mkdirSync(join(ws, ".meshy", "sessions", "s1", "operations"), { recursive: true });
mkdirSync(join(ws, "meshy_output"), { recursive: true });
writeFileSync(join(ws, "meshy_output", "chest.glb"), Buffer.from("glTF-fake-binary"));

const fake = join(dir, "meshy.js");
writeFileSync(fake, `
const fs = require("node:fs");
const path = require("node:path");
const argv = process.argv.slice(2);
const args = argv.join(" ");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, apiKey: process.env.MESHY_API_KEY ?? null, host: process.env.DSH_MESHY_CREDENTIAL ?? null, stateDir: process.env.DSH_MESHY_STATE_DIR ?? null }) + "\\n");
const out = (o) => process.stdout.write(JSON.stringify(o));
if (args === "--version") process.stdout.write("0.8.5\\n");
else if (args === "resources --format json --no-update-check") out(${JSON.stringify(RESOURCES)});
else if (args.startsWith("auth status --offline --show-token")) out({ ok: true, result: { authenticated: true, source: "file", token: "msy_at_host_session", subject: "user-9", expires_at: Date.now() + 3600000, base_url_v1: "https://api.meshy.cn/openapi/v1", credentials_file: ${JSON.stringify(join(store, "credentials.v2.json"))} } });
else if (args.startsWith("auth status")) out({ ok: true, result: { authenticated: true, verified: true, source: "file", credential: "msy_at_U…abcd", account: { name: "Ada Lovelace", email: "ada@example.com" }, base_url_v1: "https://api.meshy.cn/openapi/v1", balance: { balance: 1085, monthly_credits: 1000 }, profiles: ["default"] } });
else if (args.startsWith("auth login --device --no-wait")) out({ ok: true, result: { status: "device_flow_started", verification_url: "https://www.meshy.ai/device?user_code=ABCD-1234", user_code: "ABCD-1234", flow_id: "AbCdEfGhIjKlMnOp", device_code: "SECRET-DEVICE-CODE", expires_in: 600 } });
else if (args.startsWith("auth login --device-flow=")) out({ ok: true, result: { status: "logged_in" } });
else if (args.startsWith("auth logout")) out({ ok: true, result: { status: "logged_out" } });
else if (argv[0] === "text-to-3d" && argv[1] === "get" && argv[2].includes("missing")) {
  out({ ok: false, error: { code: "not_found", message: "meshy api 404 on /text-to-3d/" + argv[2] + ": Task not found" } });
  process.exitCode = 1;
}
else if (argv[0] === "text-to-3d" && argv[1] === "get" && argv[2].includes("running")) {
  out({ ok: true, result: { task: { task_id: argv[2], status: "IN_PROGRESS", progress: 40, name: "Slow tower", created_at: Date.now() - 30 * 3600000 } } });
}
else if (argv[0] === "text-to-3d" && argv[1] === "get") {
  out({ ok: true, result: { task: { task_id: argv[2], status: "SUCCEEDED", progress: 100, name: "Treasure chest", type: "text-to-3d-preview", created_at: 1795660001000, finished_at: 1795660045000, consumed_credits: 20, thumbnail_url: "https://assets.meshy.ai/thumb.png", model_urls: { glb: "https://assets.meshy.ai/chest.glb", fbx: "https://assets.meshy.ai/chest.fbx" } } } });
}
else if ((argv[0] === "text-to-3d" || argv[0] === "image-to-3d" || argv[0] === "retexture") && argv[1] === "list") {
  const ts = Date.now() - (argv[0] === "text-to-3d" ? 3000 : argv[0] === "image-to-3d" ? 4000 : 5000);
  out({ ok: true, result: { items: [{ task_id: "0190" + argv[0].replace(/-/g, "") + "123456", status: "SUCCEEDED", progress: 100, name: argv[0] + " item", type: argv[0], created_at: ts, finished_at: ts + 5000, consumed_credits: 10, thumbnail_url: "https://assets.meshy.ai/" + argv[0] + ".png", model_urls: { glb: "https://assets.meshy.ai/" + argv[0] + ".glb" } }] } });
}
else if (argv[0] === "download") {
  const outIdx = argv.indexOf("--output-dir");
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : process.cwd();
  const fmtIdx = argv.indexOf("--model-format");
  const fmt = fmtIdx >= 0 ? argv[fmtIdx + 1] : "glb";
  const dest = path.join(outDir, "exported." + fmt);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(dest, "downloaded-" + fmt);
  out({ ok: true, result: { downloads: { state: "completed", files: [{ key: "model." + fmt, path: dest, status: "written", bytes: 14 }] } } });
}
else { out({ ok: false, error: { message: "unexpected " + args } }); process.exitCode = 2; }
`);
process.env.MESHY_DSH_CLI = fake;
test.after(() => { delete process.env.MESHY_DSH_CLI; rmSync(dir, { recursive: true, force: true }); });

const {
  apply,
  createHostRuntime,
  loginFinish,
  loginStart,
  logout,
  pickUpdate,
  refreshSession,
  resolveSession,
  shellFacts,
  signIn,
  status,
  update,
} = await import("../lib/index.js");
const { registerCompose } = await import("../lib/compose.js");

const post = (body) => new Request("http://host/api/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const calls = () => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const ran = (args) => calls().some((c) => c.args === args);
const execution = { agent: { session: { header: { id: "s1", cwd: ws } } } };

test("host: apply registers session refresh, meshy service, shellEnv, 3 tools, systemPrompt, and 11 routes", () => {
  const routes = [];
  const pending = [];
  const effects = [];
  const provided = {};
  const ctx = {
    effect: (execute, label) => { effects.push(label); return execute(); },
    provide: (key, value) => { provided[key] = value; },
    connection: { fetch: { register: (route) => { routes.push(`${route.methods} ${route.path}`); return async () => {}; } } },
    inject: (deps, callback) => pending.push({ deps, callback }),
  };
  apply(ctx);
  assert.deepEqual(effects, ["meshy-dsh: session refresh"]);
  assert.equal(provided.meshy.version, 1);
  assert.deepEqual(pending.map((p) => p.deps), [["shellEnv"], ["tools"], ["systemPrompt"], ["connection"]]);
  assert.deepEqual(routes, [], "nothing serves pages in tui or headless, where connection never arrives");

  const registered = { tools: [], sections: [] };
  pending[0].callback({ shellEnv: { register: (c) => { registered.env = c; } } });
  pending[1].callback({ tools: { register: (t) => { registered.tools.push(t.name); } } });
  pending[2].callback({ systemPrompt: { section: (s) => { registered.sections.push(s); } } });
  pending[3].callback(ctx);

  assert.equal(registered.env.name, "meshy");
  assert.ok(Object.keys(registered.env.variables).every((k) => k.startsWith("DSH_MESHY_")));
  assert.deepEqual(registered.tools, ["meshy", "meshy_sign_in", "meshy_preview_model"]);
  assert.equal(registered.sections.length, 1);
  assert.equal(registered.sections[0].name, "meshy:compose");
  assert.deepEqual(routes, [
    "GET /api/meshy.status",
    "GET /api/meshy.update",
    "POST /api/meshy.login",
    "POST /api/meshy.login.finish",
    "POST /api/meshy.logout",
    "GET /api/meshy.tasks",
    "GET /api/meshy.library",
    "GET /api/meshy.model",
    "POST /api/meshy.input",
    "GET /api/meshy.events",
    "GET /api/meshy.env.hdr",
  ]);
});

test("host: shell calls get the shipped CLI and this chat's own journal; the session once signed in", async () => {
  const facts = shellFacts(execution);
  assert.equal(facts.DSH_MESHY_CLI, fake);
  assert.equal(facts.DSH_MESHY_NODE, process.execPath);
  assert.equal(facts.DSH_MESHY_STATE_DIR, join(ws, ".meshy", "sessions", "s1"));

  await refreshSession();
  assert.ok(ran("auth status --offline --show-token --format json --no-update-check"));
  const signedIn = shellFacts(execution);
  assert.equal(signedIn.DSH_MESHY_CREDENTIAL, "msy_at_host_session");
  assert.equal(signedIn.DSH_MESHY_REGION, "cn");
  assert.equal(signedIn.DSH_MESHY_SUBJECT, "user-9");
  assert.equal(shellFacts({}).DSH_MESHY_STATE_DIR, undefined, "no journal dir outside an agent session");
});

test("host: a change to the credentials file re-reads the session at once", async () => {
  await refreshSession();
  const reads = () => calls().filter((c) => c.args.startsWith("auth status --offline --show-token")).length;
  const before = reads();
  writeFileSync(join(store, "credentials.v2.json.tmp"), "{}");
  writeFileSync(join(store, "credentials.v2.json"), "{}");
  for (let i = 0; i < 100 && reads() === before; i++) await new Promise((r) => setTimeout(r, 30));
  assert.ok(reads() > before, "the session was re-read without waiting for the timer");
});

test("host: the CLI never sees an exported MESHY_API_KEY or a credential handed to this process", async () => {
  process.env.MESHY_API_KEY = "msy_exported_key";
  process.env.DSH_MESHY_CREDENTIAL = "msy_at_from_an_outer_dsh";
  try {
    await refreshSession();
  } finally {
    delete process.env.MESHY_API_KEY;
    delete process.env.DSH_MESHY_CREDENTIAL;
  }
  const last = calls().at(-1);
  assert.deepEqual([last.apiKey, last.host], [null, null]);
});

test("host: status reports the CLI, the account, the site and the credits, never the credential", async () => {
  const body = await (await status()).json();
  assert.deepEqual(body, {
    cli: { version: "0.8.5" },
    auth: {
      authenticated: true,
      verified: true,
      method: "browser",
      account: { name: "Ada Lovelace", email: "ada@example.com" },
      region: "cn",
      balance: 1085,
      hint: null,
    },
  });
});

const DAY = 24 * 3600_000;
const now = Date.parse("2026-11-09T12:00:00Z");
const ago = (ms) => new Date(now - ms).toISOString();
const packument = (latest, released) => ({
  "dist-tags": { latest },
  versions: Object.fromEntries(Object.keys(released).map((v) => [v, {}])),
  time: { created: ago(30 * DAY), modified: ago(0), ...released },
});

test("host: a newer release is offered once a reinstall would get it", () => {
  const p = packument("0.4.1", { "0.3.4": ago(5 * DAY), "0.4.0": ago(2 * DAY), "0.4.1": ago(2 * 3600_000) });
  assert.equal(pickUpdate(p, "0.3.4", now), "0.4.0");
  assert.equal(pickUpdate(p, "0.4.0", now), null);
  assert.equal(pickUpdate(p, "0.4.1", now), null);
  assert.equal(pickUpdate(p, "0.3.4", now + DAY), "0.4.1");
  assert.equal(pickUpdate(p, "0.3.10", now), "0.4.0");
});

test("host: prereleases, versions past latest and malformed data are never offered", () => {
  const p = packument("0.4.0", { "0.4.0": ago(3 * DAY), "0.5.0-rc.1": ago(3 * DAY), "0.5.0": ago(3 * DAY), "1.0": ago(3 * DAY) });
  assert.equal(pickUpdate(p, "0.3.0", now), "0.4.0");
  assert.equal(pickUpdate({ ...p, "dist-tags": {} }, "0.3.0", now), null);
  assert.equal(pickUpdate({ ...p, time: {} }, "0.3.0", now), null);
  for (const bad of [null, undefined, "nope", {}]) assert.equal(pickUpdate(bad, "0.3.0", now), null);
});

test("host: the update route reads the registry, and an unreachable one means no notice", async () => {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const [major, minor] = version.split(".").map(Number);
  const next = `${major}.${minor + 1}.0`;
  const real = globalThis.fetch;
  const asked = [];
  try {
    globalThis.fetch = async (url) => { asked.push(String(url)); throw new TypeError("fetch failed"); };
    assert.deepEqual(await (await update()).json(), { version, update: null });
    assert.deepEqual(asked.sort(), ["https://registry.npmjs.org/meshy-dsh", "https://registry.npmmirror.com/meshy-dsh"]);

    globalThis.fetch = async (url) => String(url).includes("npmmirror")
      ? Response.json(packument(next, { [version]: ago(9 * DAY), [next]: new Date(Date.now() - 2 * DAY).toISOString() }))
      : new Response("busy", { status: 503 });
    assert.deepEqual(await (await update()).json(), { version, update: next });
  } finally {
    globalThis.fetch = real;
  }
});

test("host: sign-in returns the link and code but never the device code", async () => {
  const res = await loginStart(post({ region: "cn" }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("SECRET-DEVICE-CODE"));
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["expires_in", "flow_id", "user_code", "verification_url"]);
  assert.ok(ran("auth login --device --no-wait --region cn --format json --no-update-check"));
});

test("host: the sign-in tool starts the flow on the host and finishes it in the background", async () => {
  const view = await signIn("global");
  assert.deepEqual(view, { status: "waiting_for_approval", verification_url: "https://www.meshy.ai/device?user_code=ABCD-1234", user_code: "ABCD-1234", expires_in: 600 });
  assert.ok(!JSON.stringify(view).includes("SECRET-DEVICE-CODE"));
  for (let i = 0; i < 100 && !ran("auth login --device-flow=AbCdEfGhIjKlMnOp --format json --no-update-check"); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(ran("auth login --device-flow=AbCdEfGhIjKlMnOp --format json --no-update-check"));
});

test("host: bad input is refused before the CLI runs", async () => {
  const before = calls().length;
  for (const body of [{ region: "eu" }, "not json", "null"]) assert.equal((await loginStart(post(body))).status, 400);
  for (const flow_id of [undefined, "short", "AbCd EfGh IjKl MnOp", "x".repeat(65), "AbCdEfGhIjKlMnOp; rm -rf ~"]) {
    assert.equal((await loginFinish(post({ flow_id }))).status, 400, String(flow_id));
  }
  assert.equal(calls().length, before);
});

test("host: finishing passes the flow id as one option value, even one that starts with '-'", async () => {
  const res = await loginFinish(post({ flow_id: "-bCdEfGhIjKlMnOp" }));
  assert.deepEqual(await res.json(), { status: "logged_in" });
  assert.ok(ran("auth login --device-flow=-bCdEfGhIjKlMnOp --format json --no-update-check"));
  assert.deepEqual(await (await logout()).json(), { status: "logged_out" });
});

test("host: the routes serve this chat's tasks, the library, local models, image input, env.hdr, and filtered SSE", async () => {
  const startedAt = new Date().toISOString();
  const record = (folder, id, taskId, at) => {
    mkdirSync(join(ws, ...folder), { recursive: true });
    writeFileSync(join(ws, ...folder, `${id}.json`), JSON.stringify({ schema_version: 1, operation_id: id, resource: "text-to-3d", state: "accepted", task_id: taskId, started_at: at }));
  };
  // The shared journal of earlier plugin versions counts by time; each chat's own folder counts whole.
  record([".meshy", "operations"], "op-1", "0190chest12345", startedAt);
  record([".meshy", "operations"], "op-before", "0190chest00000", new Date(Date.now() - 3600_000).toISOString());
  record([".meshy", "sessions", "sess-1", "operations"], "op-own", "0190chest55555", new Date(Date.now() - 7200_000).toISOString());
  record([".meshy", "sessions", "sess-other", "operations"], "op-theirs", "0190chest77777", startedAt);

  const ctx = {
    sessions: new Map([["sess-1", { header: { id: "sess-1", cwd: ws, createdAt: Date.now() - 10_000 } }]]),
  };
  const runtime = createHostRuntime(ctx);
  const routeMap = new Map(runtime.routes.map(([p, , h]) => [p, h]));

  // 1. /api/meshy.tasks (light & full)
  const lightRes = await routeMap.get("/api/meshy.tasks")(new Request("http://host/api/meshy.tasks?session=sess-1&light=1"));
  const lightData = await lightRes.json();
  assert.equal(lightData.workspace, ws);
  assert.deepEqual(lightData.tasks.map((t) => t.id), ["op-1", "op-own"]);
  const everything = await (await routeMap.get("/api/meshy.tasks")(new Request("http://host/api/meshy.tasks?session=sess-1&light=1&scope=workspace"))).json();
  assert.deepEqual(everything.tasks.map((t) => t.id).sort(), ["op-1", "op-before", "op-own", "op-theirs"]);

  const fullRes = await routeMap.get("/api/meshy.tasks")(new Request("http://host/api/meshy.tasks?session=sess-1"));
  const fullData = await fullRes.json();
  assert.equal(fullData.tasks[0].status, "SUCCEEDED");
  assert.equal(fullData.tasks[0].kind, "model");
  assert.equal(fullData.tasks[0].title, "Treasure chest");
  assert.equal(fullData.tasks[0].type, "text-to-3d-preview");
  assert.equal(fullData.tasks[0].stale, undefined);
  assert.equal(fullData.tasks[0].model, true);
  assert.deepEqual(fullData.tasks[0].formats, ["glb", "fbx"]);
  assert.equal(fullData.models.length, 1);
  assert.equal(fullData.models[0].file, "meshy_output/chest.glb");

  // 2. /api/meshy.library
  const libRes = await routeMap.get("/api/meshy.library")(new Request("http://host/api/meshy.library?limit=5"));
  const libData = await libRes.json();
  assert.equal(libData.authenticated, true);
  assert.equal(libData.retentionDays, 3);
  assert.equal(libData.items.length, 3);
  assert.equal(libData.items[0].resource, "text-to-3d");
  assert.equal(libData.items[0].kind, "model");
  assert.equal(typeof libData.items[0].expiresAt, "number");

  // 3. /api/meshy.model (workspace local .glb + traversal refusal)
  const modelRes = await routeMap.get("/api/meshy.model")(new Request("http://host/api/meshy.model?session=sess-1&file=meshy_output/chest.glb"));
  assert.equal(modelRes.status, 200);
  assert.equal(modelRes.headers.get("content-type"), "model/gltf-binary");
  assert.equal(await modelRes.text(), "glTF-fake-binary");

  const badModelRes = await routeMap.get("/api/meshy.model")(new Request("http://host/api/meshy.model?session=sess-1&file=../store/credentials.v2.json"));
  assert.equal(badModelRes.status, 400);

  // 4. /api/meshy.input: a picked image saved as picked under meshy_input/, never over a file
  const input = routeMap.get("/api/meshy.input");
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
  const send = (query, bytes) => input(new Request(`http://host/api/meshy.input?${query}`, { method: "POST", body: bytes }));
  const saved = await send("session=sess-1&name=" + encodeURIComponent("My Robot.PNG"), png);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { file: "meshy_input/My-Robot.png" });
  assert.deepEqual(readFileSync(join(ws, "meshy_input", "My-Robot.png")), png);
  assert.deepEqual(await (await send("session=sess-1&name=My%20Robot.png", png)).json(), { file: "meshy_input/My-Robot-2.png" });
  assert.deepEqual(await (await send("session=sess-1&name=" + encodeURIComponent("../../机器人.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]))).json(), { file: "meshy_input/image.jpg" });
  assert.equal((await send("session=sess-1&name=x.png", Buffer.from("not an image at all"))).status, 400);
  assert.equal((await send("session=sess-1", Buffer.alloc(0))).status, 400);
  assert.equal((await send("name=x.png", png)).status, 400);
  assert.equal((await send("session=sess-9&name=x.png", png)).status, 404);

  // 5. /api/meshy.env.hdr
  const hdrRes = await routeMap.get("/api/meshy.env.hdr")(new Request("http://host/api/meshy.env.hdr"));
  assert.equal(hdrRes.status, 200);
  assert.equal(hdrRes.headers.get("content-type"), "application/octet-stream");
  const hdrBuf = await hdrRes.arrayBuffer();
  assert.ok(hdrBuf.byteLength > 1024);

  // 6. /api/meshy.events SSE filtering & zero workspace path leak
  const ac = new AbortController();
  const sseRes = await routeMap.get("/api/meshy.events")(new Request("http://host/api/meshy.events?session=sess-1", { signal: ac.signal }));
  assert.equal(sseRes.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = sseRes.body.getReader();
  const dec = new TextDecoder();
  const first = dec.decode((await reader.read()).value);
  assert.match(first, /retry: 3000/);

  // Emit one event for another session (must be ignored) and one for sess-1 (must be delivered without workspace path).
  runtime.events.emit({ type: "open", sessionId: "other-session", workspace: "/elsewhere", target: { file: "other.glb" } });
  runtime.events.emit({ type: "open", sessionId: "sess-1", workspace: ws, target: { file: "meshy_output/chest.glb" } });

  const chunk = dec.decode((await reader.read()).value);
  assert.ok(chunk.includes("meshy_output/chest.glb"));
  assert.ok(!chunk.includes("other.glb"), "events from other sessions must be filtered out");
  assert.ok(!chunk.includes(ws), "absolute workspace path must never leak over SSE");
  ac.abort();
});

test("host: rows that cannot be read or never finished are stale, and a 404 is not read again", async () => {
  const ws2 = join(dir, "workspace-stale");
  mkdirSync(join(ws2, ".meshy", "operations"), { recursive: true });
  const record = (id, taskId, startedAt, extra = {}) => writeFileSync(join(ws2, ".meshy", "operations", `${id}.json`), JSON.stringify({
    schema_version: 1, operation_id: id, resource: "text-to-3d", state: "accepted", task_id: taskId, started_at: new Date(startedAt).toISOString(), ...extra,
  }));
  const now = Date.now();
  record("op-ok", "0190chest99999", now - 60_000, { api_origin: "https://api.meshy.ai" });
  record("op-404", "0190missing123", now - 50_000, { api_origin: "https://api.meshy.ai" });
  record("op-elsewhere", "0190remote1234", now - 40_000, { api_origin: "https://api.other.example" });
  record("op-old", "0190running123", now - 30 * 3600_000);

  // The live session's header wins over the stored one.
  const ctx = {
    sessions: { get: (id) => (id === "sess-2" ? { header: { id, cwd: ws2, createdAt: 0 } } : undefined) },
    sessionPersistence: { stat: async () => ({ header: { id: "sess-2", cwd: ws, createdAt: 0 } }) },
  };
  assert.deepEqual(await resolveSession(ctx, "sess-2"), { cwd: ws2, createdAt: 0 });
  const runtime = createHostRuntime(ctx, { currentOrigin: () => "https://api.meshy.ai" });
  const handle = runtime.routes.find(([p]) => p === "/api/meshy.tasks")[2];
  const read = async () => {
    const data = await (await handle(new Request("http://host/api/meshy.tasks?session=sess-2"))).json();
    return Object.fromEntries(data.tasks.map((t) => [t.id, t]));
  };

  const rows = await read();
  assert.equal(rows["op-ok"].status, "SUCCEEDED");
  assert.equal(rows["op-ok"].stale, undefined);
  for (const id of ["op-404", "op-elsewhere", "op-old"]) {
    assert.equal(rows[id].stale, true, id);
    assert.equal(rows[id].status, null, id);
    assert.equal(rows[id].progress, null, id);
  }
  assert.match(rows["op-404"].readError, /404/);
  assert.match(rows["op-elsewhere"].readError, /another Meshy API/);

  const gets = () => calls().filter((c) => c.args.startsWith("text-to-3d get ")).map((c) => c.args.split(" ")[2]);
  assert.ok(!gets().includes("0190remote1234"), "a task from another API origin is never read");
  const missingReads = gets().filter((id) => id === "0190missing123").length;
  assert.equal(missingReads, 1);
  await read();
  assert.equal(gets().filter((id) => id === "0190missing123").length, missingReads, "a 404 is cached like a finished task");
});

test("host: strict Cordis proxy throws on un-injected direct property access and host safely uses ctx.get()", async () => {
  const makeStrictCtx = (services, injected = new Set()) =>
    new Proxy(
      {
        get: (name) => services[name],
      },
      {
        get(target, prop, receiver) {
          if (prop === "get" || typeof prop === "symbol") return Reflect.get(target, prop, receiver);
          if (injected.has(prop)) return services[prop];
          throw new Error(`cannot get property "${String(prop)}" without inject`);
        },
      },
    );

  // 1. registerCompose with inner proxy that only injects systemPrompt (not tools) + root proxy without tools
  let registeredSection = null;
  const spService = { section: (spec) => { registeredSection = spec; } };
  const innerNoTools = makeStrictCtx({ systemPrompt: spService }, new Set(["systemPrompt"]));
  const rootNoTools = makeStrictCtx({});
  registerCompose(innerNoTools, rootNoTools);
  assert.ok(registeredSection);
  const textNoTools = registeredSection.text({});
  assert.match(textNoTools, /## Meshy 3D Creation/);
  assert.ok(!textNoTools.includes("canvas_write"));

  // 2. registerCompose with tools provided on root proxy via ctx.get('tools')
  const toolsService = {
    definitions: () => [{ name: "meshy" }, { name: "canvas_write" }],
  };
  const rootWithTools = makeStrictCtx({ tools: toolsService });
  registerCompose(innerNoTools, rootWithTools);
  const textWithCanvas = registeredSection.text({ scope: "s", toolSet: {} });
  assert.match(textWithCanvas, /canvas_write/);

  // 3. resolveSession with strict proxy: neither sessions nor sessionPersistence present (must not throw)
  assert.equal(await resolveSession(makeStrictCtx({}), "unknown-sess"), null);

  // 4. resolveSession with strict proxy: only sessionPersistence.stat present
  const persistOnly = makeStrictCtx({
    sessionPersistence: {
      stat: async (id) => (id === "persisted-1" ? { header: { id, cwd: ws, createdAt: 1700000000000 } } : null),
    },
  });
  const resolved = await resolveSession(persistOnly, "persisted-1");
  assert.deepEqual(resolved, { cwd: ws, createdAt: 1700000000000 });

  // 5. Paid tool with strict proxy missing approval service fails closed cleanly instead of throwing Proxy error
  const runtime = createHostRuntime(makeStrictCtx({}));
  const meshyTool = runtime.tools.find((t) => t.name === "meshy");
  await assert.rejects(
    () => meshyTool.execute({ args: ["make", "a wooden chair"] }, execution),
    /Approval is unavailable/,
  );
});
