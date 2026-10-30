// This bundle is configuration only: its patch points dsh's filesystem skill
// provider at the package's skills/. These checks cover what
// dsh reads without running it: the manifest, display metadata and the packed
// file list. No CLI or network needed.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const SKILLS = ["meshy-3d-generation", "meshy-3d-printing"];

test("dsh package: the patch scans this package's own skills directory", async () => {
  const patch = await readFile(new URL(pkg.dsh.bundle.patch, root), "utf8");
  assert.match(patch, /name: '@deepseek-ai\/dsh-skill-filesystem'/);
  assert.match(patch, /includeDefaultRoots: false/);
  // The skills path is resolved through this package's own package.json; without
  // that export the bundle installs fine and silently mounts zero skills.
  assert.ok(patch.includes(`resolve('${pkg.name}/package.json')`), "customSkillDirs must resolve this package");
  assert.equal(pkg.exports["./package.json"], "./package.json");
});

test("dsh package: titles, descriptions and the icon for Plugin Manager", async () => {
  for (const locale of ["en", "zh"]) {
    const { meta } = JSON.parse(await readFile(new URL(`locale/${locale}.json`, root), "utf8"));
    assert.ok(meta.title && meta.description, `locale/${locale}.json needs meta.title and meta.description`);
  }
  const icon = new URL(pkg.exports["./icon"], root);
  assert.ok((await stat(icon)).size <= 256 * 1024);
  assert.match(await readFile(icon, "utf8"), /^<svg[\s>]/);
});

test("dsh package: npm pack ships the patch, display resources and every skill file", () => {
  const [{ files }] = JSON.parse(execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" }));
  const packed = new Set(files.map((f) => f.path));
  for (const path of ["package.json", "cordis.patch.yml", "locale/en.json", "locale/zh.json", "icon.svg"]) {
    assert.ok(packed.has(path), `${path} is not packed`);
  }
  assert.ok(![...packed].some((path) => /^(tests|scripts|\.github)\//.test(path)), "repository tooling must not ship");
  for (const skill of SKILLS) {
    for (const ref of ["SKILL.md", "references/setup.md", "references/troubleshooting.md"]) {
      assert.ok(packed.has(`skills/${skill}/${ref}`), `skills/${skill}/${ref} is not packed`);
    }
  }
});
