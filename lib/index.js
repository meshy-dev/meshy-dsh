// Host half of the plugin. It owns the Meshy sign-in: dsh runs model shell calls in a sandbox
// that cannot write the CLI's credential store, and a refresh that cannot be saved spends the
// login, so the host signs in, keeps the session fresh and hands every shell call a current
// credential (DSH_MESHY_*), together with the CLI this package ships, so no session installs
// one. It also registers `meshy_sign_in` for chats where no settings page is at hand, and, in
// Web and Desktop, five authenticated routes under /api for the settings page. Every CLI call
// uses fixed arguments.
import { spawn } from 'node:child_process'
import { readFileSync, watch } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'

export const name = 'meshy-dsh'

// The CLI this package depends on, run with the host's own Node. Desktop runs the host inside the
// Electron app binary, which ELECTRON_RUN_AS_NODE turns into a plain Node (as dsh's own `node`
// shim does); a shell call cannot set that variable, so there it gets `node` from PATH.
// MESHY_DSH_CLI is a test hook.
const cli = () => process.env.MESHY_DSH_CLI || createRequire(import.meta.url).resolve('meshy-cli')
const ELECTRON = Boolean(process.versions.electron)
const NODE = ELECTRON ? 'node' : process.execPath
const JSON_FLAGS = ['--format', 'json', '--no-update-check']
// The CLI refreshes a token with under 30 minutes left; reading it this often keeps every
// credential handed to a shell good for at least 25 minutes.
const SESSION_REFRESH_MS = 5 * 60_000
const MAX_OUTPUT = 1 << 20
const FLOW_ID = /^[A-Za-z0-9_-]{16,64}$/
const REGIONS = new Set(['global', 'cn'])

// dsh never updates a plugin it installed from npm, so the settings page says when reinstalling
// would bring a newer release. The registries are the two dsh installs plugins from; the first
// to answer wins, and the host's fetch goes through dsh's proxy settings.
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const REGISTRIES = ['https://registry.npmjs.org/meshy-dsh', 'https://registry.npmmirror.com/meshy-dsh']
// dsh installs with pnpm, which holds a release back for its first day (`minimumReleaseAge`), so
// a release is offered only once a reinstall would actually get it.
const RELEASE_AGE_MS = 24 * 3600_000
const UPDATE_CHECK_MS = 6 * 3600_000
const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/

/**
 * Run one command with fixed argv (no shell; every argument is a constant or validated), capped
 * output and a deadline.
 * @returns {Promise<{ code: number | null, stdout: string, timedOut: boolean }>}
 */
export function run(cmd, args, timeoutMs, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
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

/**
 * The host's environment without what would stand in for the stored login: dsh keeps an
 * exported MESHY_API_KEY out of shell calls on purpose, so the host does not pass one on either,
 * and a dsh started from a dsh shell must not read back the credential it was handed.
 */
function hostEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => {
    const key = k.toUpperCase()
    return key !== 'MESHY_API_KEY' && !key.startsWith('DSH_MESHY_')
  }))
  if (ELECTRON) env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

async function meshy(args, timeoutMs = 60_000) {
  const out = await run(process.execPath, [cli(), ...args, ...JSON_FLAGS], timeoutMs, hostEnv())
  let envelope
  try {
    envelope = JSON.parse(out.stdout)
  } catch {
    envelope = { ok: false, error: { message: out.timedOut ? 'timed out' : 'the Meshy CLI printed no result' } }
  }
  return { ...envelope, timedOut: out.timedOut }
}

const regionOf = (baseUrl) => typeof baseUrl === 'string' && baseUrl.includes('meshy.cn') ? 'cn' : 'global'

/** The signed-in session handed to shells, or null while signed out. Never sent to a page. */
let session = null
let reading = null
let watcher = null
let watchedFile = null

/**
 * Re-read the session as soon as the credentials file changes. A refresh by any other process (a
 * terminal, another agent) ends the access token this host holds, so waiting for the next timer
 * tick would hand shells a rejected token in the meantime.
 */
function watchStore(file) {
  if (typeof file !== 'string' || !file || file === watchedFile) return
  stopWatching()
  try {
    watcher = watch(dirname(file), { persistent: false }, (_event, name) => {
      if (name === null || String(name) === basename(file)) void refreshSession()
    })
    watcher.on('error', stopWatching)
    watchedFile = file
  } catch {
    // The directory does not exist yet (never signed in); the next read tries again.
  }
}

function stopWatching() {
  watcher?.close()
  watcher = null
  watchedFile = null
}

/**
 * Re-read the session. `auth status --offline` refreshes the token here, where the store is
 * writable, once it has under 30 minutes left; it makes no other network call.
 */
export function refreshSession() {
  reading ??= meshy(['auth', 'status', '--offline', '--show-token'])
    .then((out) => {
      const r = out.result ?? {}
      watchStore(r.credentials_file)
      session = out.ok && r.authenticated === true && typeof r.token === 'string' && r.token
        ? {
            token: r.token,
            subject: typeof r.subject === 'string' ? r.subject : '',
            region: regionOf(r.base_url_v1),
            expiresAt: typeof r.expires_at === 'number' ? r.expires_at : null,
          }
        : null
    })
    .catch(() => {})
    .finally(() => { reading = null })
  return reading
}

const SHELL_VARIABLES = {
  DSH_MESHY_NODE: { description: 'Node.js that runs the Meshy CLI: "$DSH_MESHY_NODE" "$DSH_MESHY_CLI" <command>.' },
  DSH_MESHY_CLI: { description: 'The Meshy CLI this plugin ships (a JavaScript file run with DSH_MESHY_NODE).' },
  DSH_MESHY_CREDENTIAL: { description: 'The Meshy sign-in, kept fresh by the plugin; the CLI reads it. Never print it.' },
  DSH_MESHY_REGION: { description: 'The Meshy site of that sign-in: global or cn.' },
  DSH_MESHY_SUBJECT: { description: 'The Meshy account the CLI binds its operation journal to.' },
  DSH_MESHY_STATE_DIR: { description: "Where the Meshy CLI keeps its operation journal: .meshy in the session's workspace." },
}

/** What one shell call gets: the CLI, the session while signed in, and a writable journal. */
export function shellFacts(execution) {
  const facts = { DSH_MESHY_NODE: NODE, DSH_MESHY_CLI: cli() }
  const cwd = execution?.agent?.session?.header?.cwd
  if (typeof cwd === 'string' && cwd) facts.DSH_MESHY_STATE_DIR = join(cwd, '.meshy')
  if (session) {
    // After a sleep the timer may not have run yet: refresh now, and leave out a token that
    // would be rejected (the CLI then explains, and the next call has the fresh one).
    const left = session.expiresAt === null ? Infinity : session.expiresAt - Date.now()
    if (left < 60_000) void refreshSession()
    if (left > 0) {
      facts.DSH_MESHY_CREDENTIAL = session.token
      facts.DSH_MESHY_REGION = session.region
      if (session.subject) facts.DSH_MESHY_SUBJECT = session.subject
    }
  }
  return facts
}

let signingIn = null

/**
 * Start a browser sign-in on the host and finish it in the background: the CLI polls until the
 * user approves or the code expires, and the session is re-read when it lands. A second call
 * while one is waiting returns the same link and code.
 */
export async function signIn(region) {
  if (signingIn?.region === region) return signingIn.view
  const started = await meshy(['auth', 'login', '--device', '--no-wait', '--region', region])
  const r = started.result ?? {}
  if (!started.ok || typeof r.verification_url !== 'string' || !r.verification_url.startsWith('https://') || !FLOW_ID.test(r.flow_id ?? '')) {
    throw new Error(started.error?.message ?? 'the Meshy CLI could not start a sign-in')
  }
  const expiresIn = typeof r.expires_in === 'number' ? r.expires_in : 600
  // Only what the user needs: an older CLI also prints the device code, a bearer secret.
  const view = { status: 'waiting_for_approval', verification_url: r.verification_url, user_code: String(r.user_code ?? ''), expires_in: expiresIn }
  const attempt = { region, view }
  signingIn = attempt
  meshy(['auth', 'login', `--device-flow=${r.flow_id}`], expiresIn * 1000 + 30_000)
    .then((done) => done.ok ? refreshSession() : undefined)
    .catch(() => {})
    .finally(() => { if (signingIn === attempt) signingIn = null })
  return view
}

const SIGN_IN_TOOL = {
  name: 'meshy_sign_in',
  description:
    'Sign the user in to Meshy, and how to run Meshy here. In DeepSeek Harness the Meshy plugin ships ' +
    'the Meshy CLI and keeps the sign-in: run every Meshy command as "$DSH_MESHY_NODE" "$DSH_MESHY_CLI" ' +
    '<command> (PowerShell: & $env:DSH_MESHY_NODE $env:DSH_MESHY_CLI <command>), never a `meshy` found ' +
    'on PATH, which cannot see this sign-in, and install nothing. Call this tool only when such a ' +
    'command reports that nobody is signed in or the session was rejected; never run `auth login` in ' +
    'the shell, which cannot store a login. It returns a link and a code: show both to the user, wait ' +
    'until they say they approved it, then retry the command. Use region "cn" only when the user signs ' +
    'in on the China site (meshy.cn).',
  parameters: {
    type: 'object',
    properties: { region: { type: 'string', enum: ['global', 'cn'], description: 'Meshy site; default global.' } },
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        verification_url: { type: 'string' },
        user_code: { type: 'string' },
        expires_in: { type: 'integer' },
      },
      required: ['status', 'verification_url', 'user_code', 'expires_in'],
      additionalProperties: false,
    },
    render: (_args, v) => [{ type: 'text', text: `Open ${v.verification_url} and confirm code ${v.user_code} (valid ${Math.round(v.expires_in / 60)} minutes).` }],
  },
  async execute(args) {
    const region = args?.region ?? 'global'
    if (!REGIONS.has(region)) throw new Error('meshy_sign_in: region must be global or cn')
    return signIn(region)
  },
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
  const version = await run(process.execPath, [cli(), '--version'], 30_000, hostEnv()).catch(() => undefined)
  if (!version || version.code !== 0) return json({ cli: null, error: 'Meshy CLI not found: reinstall the Meshy plugin' })
  const auth = await meshy(['auth', 'status'])
  const r = auth.result ?? {}
  const text = (v) => typeof v === 'string' && v ? v : null
  return json({
    cli: { version: version.stdout.trim() },
    auth: {
      authenticated: r.authenticated === true,
      verified: r.verified === true,
      // How it signed in, never the credential: an OAuth access token starts msy_at_.
      method: r.authenticated !== true ? null : String(r.credential ?? '').startsWith('msy_at_') ? 'browser' : 'apiKey',
      // Who signed in, when the site reports it (not for an API key, a login before CLI 0.8, or
      // the China site yet).
      account: r.account && (text(r.account.name) || text(r.account.email)) ? { name: text(r.account.name), email: text(r.account.email) } : null,
      region: regionOf(r.base_url_v1),
      balance: typeof r.balance?.balance === 'number' ? r.balance.balance : null,
      hint: r.hint ?? null,
    },
  })
}

/** Compare two plain x.y.z versions; NaN when either is not one, so every comparison fails. */
function compare(a, b) {
  const x = RELEASE.exec(String(a)), y = RELEASE.exec(String(b))
  if (!x || !y) return NaN
  for (let i = 1; i <= 3; i++) if (x[i] !== y[i]) return Number(x[i]) - Number(y[i])
  return 0
}

/**
 * The release a reinstall would bring, when it is newer than `current`: the highest version up to
 * `latest` that has been out for a day. Prereleases and malformed entries are never offered.
 */
export function pickUpdate(packument, current, now = Date.now()) {
  const latest = packument?.['dist-tags']?.latest
  let best = null
  for (const version of Object.keys(packument?.versions ?? {})) {
    const age = now - Date.parse(packument.time?.[version])
    if (compare(version, current) > 0 && compare(version, latest) <= 0 && age >= RELEASE_AGE_MS && (best === null || compare(version, best) > 0)) best = version
  }
  return best
}

let packument = null
let checkedAt = 0
let checking = null

/** Read the published releases again once the last read is six hours old; a failed read retries next time. */
function checkForUpdate() {
  if (Date.now() - checkedAt < UPDATE_CHECK_MS) return Promise.resolve()
  checking ??= (async () => {
    const done = new AbortController()
    try {
      packument = await Promise.any(REGISTRIES.map(async (url) => {
        const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.any([done.signal, AbortSignal.timeout(15_000)]) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      }))
      checkedAt = Date.now()
    } catch {
      // Offline or both registries unreachable: no notice.
    } finally {
      done.abort()
      checking = null
    }
  })()
  return checking
}

export async function update() {
  await checkForUpdate()
  return json({ version: VERSION, update: pickUpdate(packument, VERSION) })
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
  await refreshSession()
  return json({ status: done.result?.status ?? 'logged_in' })
}

export async function logout() {
  const out = await meshy(['auth', 'logout'])
  await refreshSession()
  return out.ok ? json({ status: 'logged_out' }) : failure(out)
}

const ROUTES = [
  ['/api/meshy.status', 'GET', status],
  ['/api/meshy.update', 'GET', update],
  ['/api/meshy.login', 'POST', loginStart],
  ['/api/meshy.login.finish', 'POST', loginFinish],
  ['/api/meshy.logout', 'POST', logout],
]

export function apply(ctx) {
  ctx.effect(() => {
    void refreshSession()
    const timer = setInterval(refreshSession, SESSION_REFRESH_MS)
    timer.unref?.()
    return () => {
      clearInterval(timer)
      stopWatching()
    }
  }, 'meshy-dsh: session refresh')
  ctx.inject(['shellEnv'], (ctx) => {
    ctx.shellEnv.register({ name: 'meshy', variables: SHELL_VARIABLES, resolve: shellFacts })
  })
  ctx.inject(['tools'], (ctx) => {
    ctx.tools.register(SIGN_IN_TOOL)
  })
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
