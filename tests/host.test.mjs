// The host half's routes, run against a fake `meshy` on PATH: fixed arguments, validated input,
// and never the device code. No network, no real CLI.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { apply, loginFinish, loginStart, logout, status } from "../lib/index.js";

const bin = mkdtempSync(join(tmpdir(), "meshy-dsh-host-"));
const log = join(bin, "calls.log");
writeFileSync(join(bin, "meshy"), `#!/usr/bin/env node
const args = process.argv.slice(2).join(" ");
require("node:fs").appendFileSync(${JSON.stringify(log)}, args + "\\n");
const out = (o) => process.stdout.write(JSON.stringify(o));
if (args === "--version") process.stdout.write("0.7.3\\n");
else if (args.startsWith("auth status")) out({ ok: true, result: { authenticated: true, verified: true, source: "file", credential: "msy_at_U…abcd", base_url_v1: "https://api.meshy.cn/openapi/v1", balance: { balance: 1085, monthly_credits: 1000 }, profiles: ["default"] } });
else if (args.startsWith("auth login --device --no-wait")) out({ ok: true, result: { status: "device_flow_started", verification_url: "https://www.meshy.ai/device?user_code=ABCD-1234", user_code: "ABCD-1234", flow_id: "AbCdEfGhIjKlMnOp", device_code: "SECRET-DEVICE-CODE", expires_in: 600 } });
else if (args.startsWith("auth login --device-flow=")) out({ ok: true, result: { status: "logged_in" } });
else if (args.startsWith("auth logout")) out({ ok: true, result: { status: "logged_out" } });
else { out({ ok: false, error: { message: "unexpected " + args } }); process.exitCode = 2; }
`);
chmodSync(join(bin, "meshy"), 0o755);
const savedPath = process.env.PATH;
process.env.PATH = `${bin}${delimiter}${savedPath}`;
test.after(() => { process.env.PATH = savedPath; rmSync(bin, { recursive: true, force: true }); });

const post = (body) => new Request("http://host/api/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const calls = () => readFileSync(log, "utf8").trim().split("\n");

test("host: routes register only once the connection service exists", () => {
  const routes = [];
  const pending = [];
  const ctx = {
    effect: (execute) => execute(),
    connection: { fetch: { register: (route) => { routes.push(`${route.methods} ${route.path}`); return async () => {}; } } },
    inject: (deps, callback) => pending.push({ deps, callback }),
  };
  apply(ctx);
  assert.deepEqual(pending.map((p) => p.deps), [["connection"]]);
  assert.deepEqual(routes, [], "nothing runs in tui or headless, where connection never arrives");
  pending[0].callback(ctx);
  assert.deepEqual(routes, ["GET /api/meshy.status", "POST /api/meshy.login", "POST /api/meshy.login.finish", "POST /api/meshy.logout"]);
});

test("host: status reports the CLI, the account, the site and the credits, nothing more", async () => {
  const body = await (await status()).json();
  assert.deepEqual(body, {
    cli: { version: "0.7.3", runner: "meshy" },
    auth: { authenticated: true, verified: true, method: "browser", region: "cn", balance: 1085, hint: null },
  });
});

test("host: sign-in returns the link and code but never the device code", async () => {
  const res = await loginStart(post({ region: "cn" }));
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("SECRET-DEVICE-CODE"));
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["expires_in", "flow_id", "user_code", "verification_url"]);
  assert.ok(calls().includes("auth login --device --no-wait --region cn --format json --no-update-check"));
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
  assert.ok(calls().includes("auth login --device-flow=-bCdEfGhIjKlMnOp --format json --no-update-check"));
  assert.deepEqual(await (await logout()).json(), { status: "logged_out" });
});
