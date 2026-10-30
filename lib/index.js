// Host half of the Meshy settings page. In Web and Desktop it serves four authenticated routes
// under /api that run the Meshy CLI with fixed arguments; in tui and headless, where there is
// no `connection` service, it does nothing. The skills never call these routes.
import { spawn } from 'node:child_process'

export const name = 'meshy-dsh'

const WIN = process.platform === 'win32'
const MESHY = WIN ? 'meshy.cmd' : 'meshy'
const NPM = WIN ? 'npm.cmd' : 'npm'
// 0.7.3 is the first CLI whose --no-wait output leaves the device code out.
const TEMPORARY = ['exec', '--yes', '--package=meshy-cli@0.7', '--', 'meshy']
const JSON_FLAGS = ['--format', 'json', '--no-update-check']
const MAX_OUTPUT = 1 << 20
const FLOW_ID = /^[A-Za-z0-9_-]{16,64}$/
const REGIONS = new Set(['global', 'cn'])

/**
 * Run one command with fixed argv (no shell outside Windows, where .cmd shims need one; every
 * argument is a constant or validated), capped output and a deadline.
 * @returns {Promise<{ code: number | null, stdout: string, timedOut: boolean }>}
 */
export function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: WIN, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let stdout = ''
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk
    })
    child.once('error', (err) => { clearTimeout(timer); reject(err) })
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout, timedOut }) })
  })
}

/** `meshy` from PATH when it is 0.7.3 or a later 0.7.x, else the temporary package. */
async function runner() {
  const probe = await run(MESHY, ['--version'], 10_000).catch(() => undefined)
  const patch = /^0\.7\.(\d+)$/.exec(probe?.stdout.trim() ?? '')?.[1]
  return patch !== undefined && Number(patch) >= 3 ? [MESHY, []] : [NPM, TEMPORARY]
}

async function meshy(args, timeoutMs = 60_000) {
  const [cmd, prefix] = await runner()
  const out = await run(cmd, [...prefix, ...args, ...JSON_FLAGS], timeoutMs)
  let envelope
  try {
    envelope = JSON.parse(out.stdout)
  } catch {
    envelope = { ok: false, error: { message: out.timedOut ? 'timed out' : 'the Meshy CLI printed no result' } }
  }
  return { ...envelope, timedOut: out.timedOut, runner: prefix.length ? 'npm exec' : 'meshy' }
}

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
const failure = (envelope, status = 502) => json({ error: envelope.error?.message ?? 'the Meshy CLI failed' }, status)

async function body(request) {
  try {
    const value = await request.json()
    return typeof value === 'object' && value !== null ? value : undefined
  } catch {
    return undefined
  }
}

export async function status() {
  const [cmd, prefix] = await runner()
  const version = await run(cmd, [...prefix, '--version'], 120_000).catch(() => undefined)
  if (!version || version.code !== 0) return json({ cli: null, error: 'Meshy CLI not found: Node.js 22.12+ with npm is needed' })
  const auth = await meshy(['auth', 'status'])
  const r = auth.result ?? {}
  return json({
    cli: { version: version.stdout.trim(), runner: prefix.length ? 'npm exec' : 'meshy' },
    auth: {
      authenticated: r.authenticated === true,
      verified: r.verified === true,
      source: r.source ?? null,
      credential: r.credential ?? null,
      region: typeof r.base_url_v1 === 'string' && r.base_url_v1.includes('meshy.cn') ? 'cn' : 'global',
      balance: typeof r.balance?.balance === 'number' ? r.balance.balance : null,
      hint: r.hint ?? null,
    },
  })
}

export async function loginStart(request) {
  const input = await body(request)
  const region = input?.region ?? 'global'
  if (!input || !REGIONS.has(region)) return json({ error: 'region must be global or cn' }, 400)
  const started = await meshy(['auth', 'login', '--device', '--no-wait', '--region', region])
  const r = started.result ?? {}
  if (!started.ok || typeof r.verification_url !== 'string' || !r.verification_url.startsWith('https://')) return failure(started)
  // Only what the page shows: an older CLI also prints the device code, a bearer secret.
  return json({ verification_url: r.verification_url, user_code: r.user_code, flow_id: r.flow_id, expires_in: r.expires_in })
}

export async function loginFinish(request) {
  const input = await body(request)
  if (typeof input?.flow_id !== 'string' || !FLOW_ID.test(input.flow_id)) return json({ error: 'invalid flow_id' }, 400)
  // `=` keeps an id that starts with "-" from reading as an option.
  const done = await meshy(['auth', 'login', `--device-flow=${input.flow_id}`], 60_000)
  if (done.timedOut) return json({ status: 'pending' }, 202)
  if (!done.ok) return failure(done)
  return json({ status: done.result?.status ?? 'logged_in' })
}

export async function logout() {
  const out = await meshy(['auth', 'logout'])
  return out.ok ? json({ status: 'logged_out' }) : failure(out)
}

const ROUTES = [
  ['/api/meshy.status', 'GET', status],
  ['/api/meshy.login', 'POST', loginStart],
  ['/api/meshy.login.finish', 'POST', loginFinish],
  ['/api/meshy.logout', 'POST', logout],
]

export function apply(ctx) {
  ctx.inject(['connection'], (ctx) => {
    for (const [path, method, handle] of ROUTES) {
      ctx.effect(() => ctx.connection.fetch.register({
        path,
        methods: [method],
        requestBody: 'buffered',
        fetch: (request) => handle(request).catch((err) => json({ error: String(err?.message ?? err) }, 500)),
      }), `meshy-dsh: ${path}`)
    }
  })
}
