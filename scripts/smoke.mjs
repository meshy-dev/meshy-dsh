#!/usr/bin/env node
/**
 * End-to-end check in a real DeepSeek Harness: pack this bundle, install it into a throwaway
 * headless profile, boot dsh with a probe plugin and confirm both skills load and the
 * package's own row (the settings page's host half) starts without a Web carrier. Needs
 * network for npm; calls no model and no Meshy API.
 *
 *   node scripts/smoke.mjs [dsh-version]    (default: latest)
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'meshy-dsh-smoke-'))
const env = { ...process.env, DSH_HOME: join(work, 'home') }
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', env, ...opts })

const [{ filename }] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], { cwd: root }))
run('npm', ['install', '--prefix', join(work, 'host'), `@deepseek-ai/dsh@${process.argv[2] ?? 'latest'}`, '--no-audit', '--no-fund'])
const dsh = join(work, 'host', 'node_modules', '.bin', 'dsh')
run(dsh, ['plugin', '--profile', 'headless', 'add', join(work, filename)])

// The probe reports what the skills registry lists for this bundle's provider and the state of
// the meshy-ui row (2 is ACTIVE), then exits before the headless app reaches a model.
writeFileSync(join(work, 'probe.mjs'), `
export const name = 'meshy-smoke-probe'
export const inject = ['skills', 'loader']
export function apply(ctx) {
  setTimeout(async () => {
    const cwd = process.cwd()
    const skills = (await ctx.skills.list({ cwd })).filter((s) => s.provider === 'meshy')
    const body = skills[0] && (await ctx.skills.get(skills[0].name, { cwd }))
    const ui = [...ctx.loader.entries()].find((e) => e.options.id === 'meshy-ui')
    process.stderr.write('SMOKE ' + JSON.stringify({ names: skills.map((s) => s.name).sort(), body: body?.content.length ?? 0, ui: ui?.fiber?.state ?? null }) + '\\n')
    process.exit(0)
  }, 0)
}
`)
writeFileSync(join(work, 'probe.yml'), `- insert:\n    - id: meshy-smoke-probe\n      name: '${join(work, 'probe.mjs')}'\n`)

const boot = spawnSync(dsh, ['--profile', 'headless', '--patch', join(work, 'probe.yml'), 'noop'], { env, encoding: 'utf8', timeout: 90_000 })
const line = `${boot.stderr}\n${boot.stdout}`.split('\n').find((l) => l.startsWith('SMOKE '))
const result = line ? JSON.parse(line.slice('SMOKE '.length)) : undefined
if (result?.names.join() !== 'meshy-3d-generation,meshy-3d-printing' || !result.body || result.ui !== 2) {
  console.error(`dsh did not load both Meshy skills and the meshy-ui row: ${line ?? String(boot.stderr).slice(-3000)}`)
  process.exit(1)
}
console.log(`dsh ${run(dsh, ['--version']).trim()} loaded ${result.names.join(', ')} and the meshy-ui row from ${filename}`)
rmSync(work, { recursive: true, force: true }) // kept on failure for inspection
