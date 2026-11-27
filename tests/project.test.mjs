// The project of a session workspace (lib/project.js): assets derived from the CLI's download
// sidecars and operation journal, the kept fields only the host writes, revision conflicts and
// rebuilding from a damaged file. Plain files in a temp directory; no CLI, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { changeProject, Conflict, PROJECT_FILE, readProject, summary, syncProject } = await import("../lib/project.js");

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082", "hex").toString("base64");

function workspace() {
  const cwd = mkdtempSync(join(tmpdir(), "meshy-dsh-project-"));
  test.after(() => rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function sidecar(cwd, dir, resource, task, files) {
  mkdirSync(join(cwd, dir), { recursive: true });
  for (const f of files) writeFileSync(join(cwd, dir, f), "x".repeat(10));
  writeFileSync(join(cwd, dir, "meta.json"), JSON.stringify({
    resource,
    task: { status: "SUCCEEDED", progress: 100, created_at: Date.parse("2020-01-01T02:00:00Z"), ...task },
    saved_files: files.map((f) => join(cwd, dir, f)),
    skipped: [],
    downloaded_at: "2026-11-27T02:05:00Z",
  }));
}

test("project: assets come from download sidecars and the journal, newest model is active", () => {
  const cwd = workspace();
  sidecar(cwd, "meshy_output/chest/concept", "text-to-image", { id: "img-1", created_at: Date.parse("2020-01-01T01:00:00Z") }, ["image_0.png"]);
  sidecar(cwd, "meshy_output/chest/model", "image-to-3d", { id: "mdl-1", face_count: 12000, consumed_credits: 30, input_task_id: "img-1" }, ["model.glb", "thumbnail.png"]);
  mkdirSync(join(cwd, "node_modules/x"), { recursive: true });
  writeFileSync(join(cwd, "node_modules/x/meta.json"), JSON.stringify({ resource: "x", task: { id: "nope" } }));
  mkdirSync(join(cwd, ".meshy/operations"), { recursive: true });
  writeFileSync(join(cwd, ".meshy/operations/op1.json"), JSON.stringify({ state: "accepted", task_id: "rt-1", resource: "retexture", started_at: new Date().toISOString() }));
  writeFileSync(join(cwd, ".meshy/operations/op2.json"), JSON.stringify({ state: "rejected", task_id: null, resource: "retexture" }));

  const p = readProject(cwd);
  assert.deepEqual(p.assets.map((a) => a.id), ["img-1", "mdl-1", "rt-1"]);
  const model = p.assets.find((a) => a.id === "mdl-1");
  assert.equal(model.kind, "model");
  assert.equal(model.files.glb, "meshy_output/chest/model/model.glb");
  assert.equal(model.files.thumbnail, "meshy_output/chest/model/thumbnail.png");
  assert.equal(model.stats.faces, 12000);
  assert.equal(model.stats.bytes, 10);
  assert.equal(model.credits, 30);
  assert.equal(model.parentId, "img-1", "the task's own source link");
  assert.equal(p.assets.find((a) => a.id === "rt-1").status, "running");
  assert.equal(p.activeAssetId, "mdl-1");
  assert.equal(p.revision, 0);
});

test("project: changes bump the revision, a stale revision is refused with the current project", () => {
  const cwd = workspace();
  sidecar(cwd, "meshy_output/a", "text-to-3d", { id: "a" }, ["model.glb"]);
  sidecar(cwd, "meshy_output/b", "retexture", { id: "b" }, ["model.glb"]);

  let { project } = changeProject(cwd, { op: "link", assetId: "b", parentId: "a" }, 0);
  assert.equal(project.revision, 1);
  assert.equal(project.assets.find((a) => a.id === "b").parentId, "a");
  ({ project } = changeProject(cwd, { op: "label", assetId: "b", label: "宝箱 v2" }, 1));
  ({ project } = changeProject(cwd, { op: "activate", assetId: "a" }, 2));
  assert.equal(project.activeAssetId, "a");
  assert.equal(project.assets.find((a) => a.id === "b").label, "宝箱 v2");

  assert.throws(() => changeProject(cwd, { op: "activate", assetId: "b" }, 1), (err) => err instanceof Conflict && err.project.revision === 3);
  assert.throws(() => changeProject(cwd, { op: "activate", assetId: "zzz" }), TypeError);
  assert.throws(() => changeProject(cwd, { op: "rm -rf" }), TypeError);
  assert.throws(() => changeProject(cwd, { op: "route", route: "space" }), TypeError);
  assert.equal(changeProject(cwd, { op: "route", route: "print" }).project.route, "print");
});

test("project: star and archive mark assets; archiving the current one moves the Studio on", () => {
  const cwd = workspace();
  sidecar(cwd, "meshy_output/a", "text-to-3d", { id: "a", created_at: Date.parse("2020-01-01T01:00:00Z") }, ["model.glb"]);
  sidecar(cwd, "meshy_output/b", "retexture", { id: "b" }, ["model.glb"]);

  let { project } = changeProject(cwd, { op: "star", assetId: "a", on: true });
  assert.equal(project.assets.find((a) => a.id === "a").starred, true);
  assert.equal(project.activeAssetId, "b");
  ({ project } = changeProject(cwd, { op: "archive", assetId: "b", on: true }));
  assert.equal(project.assets.find((a) => a.id === "b").archived, true);
  assert.equal(project.activeAssetId, "a", "the newest model left is current");
  assert.deepEqual(summary(project).assets.map((a) => [a.id, !!a.starred, !!a.archived]), [["a", true, false], ["b", false, true]]);
  ({ project } = changeProject(cwd, { op: "archive", assetId: "b", on: false }));
  ({ project } = changeProject(cwd, { op: "star", assetId: "a", on: false }));
  assert.deepEqual(project.assets.map((a) => [a.starred, a.archived]), [[false, false], [false, false]]);
  assert.throws(() => changeProject(cwd, { op: "star", assetId: "zzz", on: true }), TypeError);
  // Hand-edited marks that are not ids are dropped on read.
  const file = join(cwd, PROJECT_FILE);
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), starred: ["a", "-x", 3, "a"] }));
  assert.deepEqual(readProject(cwd).starred, ["a"]);
});

test("project: a pin stores its snapshot in the workspace and stays open until resolved", () => {
  const cwd = workspace();
  sidecar(cwd, "meshy_output/a", "text-to-3d", { id: "a", face_count: 900 }, ["model.glb"]);
  const { project, pin } = changeProject(cwd, { op: "pin", assetId: "a", note: "把锁改成金色", camera: { azimuth: 35.4, elevation: 20 }, snapshotPng: `data:image/png;base64,${PNG}` });
  assert.equal(pin.id, "p_1");
  assert.equal(pin.snapshot, ".meshy/snapshots/p_1.png");
  assert.ok(readFileSync(join(cwd, pin.snapshot)).subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
  assert.deepEqual(pin.camera, { azimuth: 35, elevation: 20 });
  assert.deepEqual(summary(project).openPins.map((p) => p.note), ["把锁改成金色"]);
  assert.throws(() => changeProject(cwd, { op: "pin", assetId: "a", snapshotPng: Buffer.from("not png").toString("base64") }), TypeError);

  const after = changeProject(cwd, { op: "resolve", pinId: "p_1" }).project;
  assert.deepEqual(summary(after).openPins, []);
  assert.equal(summary(after).assets[0].file, "meshy_output/a/model.glb");
});

test("project: a damaged project file is set aside and rebuilt from the workspace", () => {
  const cwd = workspace();
  sidecar(cwd, "meshy_output/a", "text-to-3d", { id: "a" }, ["model.glb"]);
  mkdirSync(join(cwd, "meshy_output"), { recursive: true });
  writeFileSync(join(cwd, PROJECT_FILE), "{ not json");
  const p = readProject(cwd);
  assert.deepEqual(p.assets.map((a) => a.id), ["a"]);
  assert.equal(p.revision, 0);
  assert.ok(readdirSync(join(cwd, "meshy_output")).some((n) => n.startsWith("project.meshy.damaged-")));
});

test("project: sync writes the derived snapshot only when it changed, and never an empty project", () => {
  const cwd = workspace();
  syncProject(cwd);
  assert.equal(existsSync(join(cwd, PROJECT_FILE)), false, "no Meshy work, no project file");
  sidecar(cwd, "meshy_output/a", "text-to-3d", { id: "a" }, ["model.glb"]);
  syncProject(cwd);
  const first = readFileSync(join(cwd, PROJECT_FILE), "utf8");
  assert.equal(JSON.parse(first).assets.length, 1);
  syncProject(cwd);
  assert.equal(readFileSync(join(cwd, PROJECT_FILE), "utf8"), first);
});

test("project: a refine names its preview under the task's echoed input", () => {
  const cwd = workspace();
  mkdirSync(join(cwd, ".meshy/operations"), { recursive: true });
  writeFileSync(join(cwd, ".meshy/operations/op.json"), JSON.stringify({ state: "accepted", task_id: "prev-1", resource: "text-to-3d", started_at: "2020-01-01T00:00:00Z" }));
  sidecar(cwd, "meshy_output/chest", "text-to-3d", { id: "ref-1", type: "text-to-3d-refine", input: { mode: "refine", preview_task_id: "prev-1" } }, ["chest.glb"]);
  const p = readProject(cwd);
  assert.equal(p.assets.find((a) => a.id === "ref-1").parentId, "prev-1");
  assert.equal(p.assets.find((a) => a.id === "prev-1").status, "submitted", "an old submission with no download");
});

test("project: a journal or sidecar id that could read as a CLI option is ignored", () => {
  const cwd = workspace();
  mkdirSync(join(cwd, ".meshy/operations"), { recursive: true });
  writeFileSync(join(cwd, ".meshy/operations/evil.json"), JSON.stringify({ state: "accepted", task_id: "--output=/tmp/x", resource: "retexture", started_at: new Date().toISOString() }));
  sidecar(cwd, "meshy_output/x", "text-to-3d", { id: "-o" }, ["model.glb"]);
  assert.deepEqual(readProject(cwd).assets, []);
});
