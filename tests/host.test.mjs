// The host half, run against a fake CLI (MESHY_DSH_CLI): fixed arguments, validated input, the
// session it hands to shell calls, the sign-in tool, and never the device code. No network, no
// real CLI.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
else { out({ ok: false, error: { message: "unexpected " + args } }); process.exitCode = 2; }
`);
process.env.MESHY_DSH_CLI = fake;
test.after(() => { delete process.env.MESHY_DSH_CLI; rmSync(dir, { recursive: true, force: true }); });

const { apply, loginFinish, loginStart, logout, refreshSession, shellFacts, signIn, status } = await import("../lib/index.js");

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

  const registered = {};
  pending[0].callback({ shellEnv: { register: (c) => { registered.env = c; } } });
  pending[1].callback({ tools: { register: (t) => { registered.tool = t; } } });
  pending[2].callback(ctx);
  assert.equal(registered.env.name, "meshy");
  assert.ok(Object.keys(registered.env.variables).every((k) => k.startsWith("DSH_MESHY_")));
  assert.equal(registered.tool.name, "meshy_sign_in");
  assert.deepEqual(routes, ["GET /api/meshy.status", "POST /api/meshy.login", "POST /api/meshy.login.finish", "POST /api/meshy.logout"]);
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
