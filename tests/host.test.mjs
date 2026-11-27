// The host half, run against a fake CLI (MESHY_DSH_CLI): fixed arguments, validated input, the
// session it hands to shell calls, the sign-in tool, and never the device code. No network, no
// real CLI.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "meshy-dsh-host-"));
const log = join(dir, "calls.log");
const store = join(dir, "store");
mkdirSync(store);
const fake = join(dir, "meshy.js");
writeFileSync(fake, `
const args = process.argv.slice(2).join(" ");
require("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, apiKey: process.env.MESHY_API_KEY ?? null, host: process.env.DSH_MESHY_CREDENTIAL ?? null }) + "\\n");
const out = (o) => process.stdout.write(JSON.stringify(o));
if (args === "--version") process.stdout.write("0.8.0\\n");
else if (args.startsWith("auth status --offline --show-token")) out({ ok: true, result: { authenticated: true, source: "file", token: "msy_at_host_session", subject: "user-9", expires_at: Date.now() + 3600000, base_url_v1: "https://api.meshy.cn/openapi/v1", credentials_file: ${JSON.stringify(join(store, "credentials.v2.json"))} } });
else if (args.startsWith("auth status")) out({ ok: true, result: { authenticated: true, verified: true, source: "file", credential: "msy_at_U…abcd", account: { name: "Ada Lovelace", email: "ada@example.com" }, base_url_v1: "https://api.meshy.cn/openapi/v1", balance: { balance: 1085, monthly_credits: 1000 }, profiles: ["default"] } });
else if (args.startsWith("auth login --device --no-wait")) out({ ok: true, result: { status: "device_flow_started", verification_url: "https://www.meshy.ai/device?user_code=ABCD-1234", user_code: "ABCD-1234", flow_id: "AbCdEfGhIjKlMnOp", device_code: "SECRET-DEVICE-CODE", expires_in: 600 } });
else if (args.startsWith("auth login --device-flow=")) out({ ok: true, result: { status: "logged_in" } });
else if (args.startsWith("auth logout")) out({ ok: true, result: { status: "logged_out" } });
else if (args.startsWith("retexture get rt-1")) out({ ok: true, result: { task: { task_id: "rt-1", status: "IN_PROGRESS", progress: 60 } } });
else { out({ ok: false, error: { message: "unexpected " + args } }); process.exitCode = 2; }
`);
process.env.MESHY_DSH_CLI = fake;
test.after(() => { delete process.env.MESHY_DSH_CLI; rmSync(dir, { recursive: true, force: true }); });

const { apply, loginFinish, loginStart, logout, pickUpdate, refreshSession, shellFacts, signIn, status, update } = await import("../lib/index.js");

const post = (body) => new Request("http://host/api/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const calls = () => readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const ran = (args) => calls().some((c) => c.args === args);
const execution = { agent: { session: { header: { id: "s1", cwd: join(dir, "workspace") } } } };

test("host: the session refresher, shell env, sign-in tool and routes each wait for their service", () => {
  const routes = [];
  const pending = [];
  const effects = [];
  const ctx = {
    effect: (execute, label) => { effects.push(label); return execute(); },
    connection: { fetch: { register: (route) => { routes.push(`${route.methods} ${route.path}`); return async () => {}; } } },
    inject: (deps, callback) => pending.push({ deps, callback }),
  };
  apply(ctx);
  assert.deepEqual(effects, ["meshy-dsh: session refresh"]);
  assert.deepEqual(pending.map((p) => p.deps), [["shellEnv"], ["tools"], ["connection"]]);
  assert.deepEqual(routes, [], "nothing serves pages in tui or headless, where connection never arrives");

  const registered = { tools: [] };
  pending[0].callback({ shellEnv: { register: (c) => { registered.env = c; } } });
  pending[1].callback({ tools: { register: (t) => { registered.tools.push(t); } } });
  pending[2].callback(ctx);
  assert.equal(registered.env.name, "meshy");
  assert.ok(Object.keys(registered.env.variables).every((k) => k.startsWith("DSH_MESHY_")));
  assert.deepEqual(registered.tools.map((t) => t.name), ["meshy_sign_in", "meshy_project", "meshy_open_studio"]);
  assert.deepEqual(routes, ["GET /api/meshy.status", "GET /api/meshy.update", "POST /api/meshy.login", "POST /api/meshy.login.finish", "POST /api/meshy.logout", "GET,POST /api/meshy.project"]);
});

test("host: shell calls get the shipped CLI and a workspace journal; the session once signed in", async () => {
  const facts = shellFacts(execution);
  assert.equal(facts.DSH_MESHY_CLI, fake);
  assert.equal(facts.DSH_MESHY_NODE, process.execPath);
  assert.equal(facts.DSH_MESHY_STATE_DIR, join(dir, "workspace", ".meshy"));

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
  // Another process refreshed: its write replaces the file.
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
    cli: { version: "0.8.0" },
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
  assert.equal(pickUpdate(p, "0.3.4", now), "0.4.0", "0.4.1 is under a day old: pnpm would still install 0.4.0");
  assert.equal(pickUpdate(p, "0.4.0", now), null);
  assert.equal(pickUpdate(p, "0.4.1", now), null);
  assert.equal(pickUpdate(p, "0.3.4", now + DAY), "0.4.1", "offered the next day without a new read");
  assert.equal(pickUpdate(p, "0.3.10", now), "0.4.0", "numeric, not string, order");
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

    // A failed read is retried on the next request; one registry answering is enough.
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

// ---- Meshy Studio: the project tools and routes ----

function studioWorkspace() {
  const cwd = join(dir, `ws-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(cwd, "meshy_output/chest"), { recursive: true });
  writeFileSync(join(cwd, "meshy_output/chest/model.glb"), "glb");
  writeFileSync(join(cwd, "meshy_output/chest/meta.json"), JSON.stringify({ resource: "text-to-3d", task: { id: "mdl-1", status: "SUCCEEDED", face_count: 4000, created_at: 1 }, saved_files: [join(cwd, "meshy_output/chest/model.glb")] }));
  mkdirSync(join(cwd, ".meshy/operations"), { recursive: true });
  writeFileSync(join(cwd, ".meshy/operations/op.json"), JSON.stringify({ state: "accepted", task_id: "rt-1", resource: "retexture", started_at: new Date().toISOString() }));
  return cwd;
}

function studioHost(cwd) {
  const tools = {};
  const handlers = {};
  const ctx = {
    effect: (execute) => execute(),
    get: (name) => name === "sessions" ? { get: (id) => id === "s-1" ? { header: { cwd } } : undefined } : undefined,
    connection: { fetch: { register: (r) => { handlers[r.path] = r.fetch; return () => {}; } } },
    inject: (deps, callback) => callback({ ...ctx, shellEnv: { register() {} }, tools: { register: (t) => { tools[t.name] = t; } } }),
  };
  apply(ctx);
  return { tools, project: handlers["/api/meshy.project"] };
}

test("host: meshy_project reads the session's assets and records links, labels and resolved pins", async () => {
  const cwd = studioWorkspace();
  const { tools } = studioHost(cwd);
  const exec = { agent: { session: { header: { id: "s-1", cwd } } } };
  const read = await tools.meshy_project.execute({}, exec);
  assert.deepEqual(read.assets.map((a) => [a.id, a.status]), [["mdl-1", "succeeded"], ["rt-1", "running"]]);
  assert.equal(read.activeAssetId, "mdl-1");
  assert.equal(read.projectFile, "meshy_output/project.meshy");
  assert.equal(tools.meshy_project.isConcurrencySafe({ action: "read" }), true);
  assert.equal(tools.meshy_project.isConcurrencySafe({ action: "link" }), false);

  const linked = await tools.meshy_project.execute({ action: "link", asset_id: "rt-1", parent_id: "mdl-1" }, exec);
  assert.equal(linked.assets.find((a) => a.id === "rt-1").parentId, "mdl-1");
  await assert.rejects(tools.meshy_project.execute({ action: "link", asset_id: "nope", parent_id: "mdl-1" }, exec), TypeError);
  await assert.rejects(tools.meshy_project.execute({}, {}), /no session workspace/);

  const opened = await tools.meshy_open_studio.execute({ asset_id: "mdl-1" }, exec);
  assert.deepEqual([opened.projectFile, opened.assetId, opened.faces], ["meshy_output/project.meshy", "mdl-1", 4000]);
  assert.ok(existsSync(join(cwd, "meshy_output/project.meshy")));
});

test("host: the project route resolves the session's workspace, adds progress, and refuses stale writes", async () => {
  const cwd = studioWorkspace();
  const { project } = studioHost(cwd);
  await refreshSession();
  const get = await project(new Request("http://host/api/meshy.project?session=s-1"));
  const body = await get.json();
  assert.equal(get.status, 200);
  assert.equal(body.signedIn, true);
  assert.equal(body.assets.find((a) => a.id === "rt-1").progress, 0.6, "progress read with the host's sign-in");
  assert.ok(ran("retexture get rt-1 --format json --no-update-check"));

  assert.equal((await project(new Request("http://host/api/meshy.project?session=other"))).status, 404);
  assert.equal((await project(new Request("http://host/api/meshy.project?session=../x"))).status, 404);

  const write = (change, revision) => project(new Request("http://host/api/meshy.project?session=s-1", { method: "POST", body: JSON.stringify({ change, revision }) }));
  const ok = await write({ op: "activate", assetId: "rt-1" }, body.revision);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).project.activeAssetId, "rt-1");
  const stale = await write({ op: "activate", assetId: "mdl-1" }, body.revision);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).project.revision, body.revision + 1);
  assert.equal((await write({ op: "exec", cmd: "rm" })).status, 400);
});
