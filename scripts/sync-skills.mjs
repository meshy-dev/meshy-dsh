#!/usr/bin/env node
/**
 * Vendors Meshy's CLI skills from meshy-3d-agent into skills/. That repository owns them:
 * change them there, release it, then move the pin here.
 *
 *   node scripts/sync-skills.mjs                     copy from the release pinned in package.json
 *   node scripts/sync-skills.mjs --from <checkout>   copy from a local meshy-3d-agent checkout
 *   node scripts/sync-skills.mjs --check             fail when skills/ differs from the pin
 *
 * package.json "meshy.skills" pins the source as "<owner>/<repo>#<tag>".
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const SKILLS = ['meshy-3d-generation', 'meshy-3d-printing']
const root = fileURLToPath(new URL('..', import.meta.url))
const { values } = parseArgs({ options: { from: { type: 'string' }, check: { type: 'boolean' } } })
const pin = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).meshy.skills
const label = values.from ?? pin

async function download(spec) {
  const [repo, tag] = spec.split('#')
  const res = await fetch(`https://codeload.github.com/${repo}/tar.gz/refs/tags/${tag}`)
  if (!res.ok) throw new Error(`cannot download ${spec}: HTTP ${res.status}`)
  const dir = mkdtempSync(join(tmpdir(), 'meshy-skills-'))
  writeFileSync(join(dir, 'source.tar.gz'), Buffer.from(await res.arrayBuffer()))
  execFileSync('tar', ['-xzf', join(dir, 'source.tar.gz'), '-C', dir, '--strip-components=1'])
  return dir
}

/** Relative path → bytes for every file under dir, dotfiles excluded. */
function files(dir) {
  if (!existsSync(dir)) return new Map()
  return new Map(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => {
        const path = join(entry.parentPath, entry.name)
        return [relative(dir, path), readFileSync(path)]
      }),
  )
}

const source = values.from ?? (await download(pin))
const stale = []
for (const skill of SKILLS) {
  const from = join(source, 'skills', skill)
  const to = join(root, 'skills', skill)
  if (!existsSync(join(from, 'SKILL.md'))) throw new Error(`${label} has no skills/${skill}/SKILL.md`)
  if (values.check) {
    const want = files(from)
    const have = files(to)
    for (const path of new Set([...want.keys(), ...have.keys()])) {
      const [a, b] = [want.get(path), have.get(path)]
      if (!a || !b || !a.equals(b)) stale.push(join('skills', skill, path))
    }
  } else {
    rmSync(to, { recursive: true, force: true })
    cpSync(from, to, { recursive: true, filter: (path) => !basename(path).startsWith('.') })
  }
}

if (stale.length) {
  console.error(`skills/ differs from ${label}:\n  ${stale.join('\n  ')}\nRun: node scripts/sync-skills.mjs`)
  process.exit(1)
}
console.log(values.check ? `skills/ matches ${label}` : `Copied ${SKILLS.join(', ')} from ${label}`)
