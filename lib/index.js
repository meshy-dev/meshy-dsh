// Host half of the plugin. It owns the Meshy sign-in, shell environment injection
// (DSH_MESHY_*), three native Cordis tools (`meshy`, which passes the agent's CLI arguments
// through, `meshy_sign_in` and `meshy_preview_model`), live SSE events, `/api/meshy.*` routes for
// Web and Desktop, the adaptive `meshy:compose` prompt section, and the public `meshy` Cordis
// service. The host's own CLI calls run with fixed, validated arguments.
import { spawn } from 'node:child_process'
import { createReadStream, readFileSync, watch } from 'node:fs'
import { readdir, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createCatalog } from './catalog.js'
import { registerCompose } from './compose.js'
import { createEventBus } from './events.js'
import { createMeshyService } from './service.js'
import {
  createLibraryReader,
  createTaskStates,
  fetchModel,
  JOURNAL,
  kindOfResource,
  outputKind,
  listModels,
  readAssetIndex,
  readJournal,
  serveWorkspaceModel,
  sessionStateDir,
  SESSIONS_DIR,
  TERMINAL,
} from './tasks.js'
import { createTools } from './tools.js'
import { createInputRoute } from './uploads.js'

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
const SSE_PING_MS = 25_000

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const ENV_HDR_PATH = fileURLToPath(new URL('../assets/viewer-env.hdr', import.meta.url))
const REGISTRIES = ['https://registry.npmjs.org/meshy-dsh', 'https://registry.npmmirror.com/meshy-dsh']
const RELEASE_AGE_MS = 24 * 3600_000
const UPDATE_CHECK_MS = 6 * 3600_000
const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/

/**
 * Run one command with fixed argv (no shell), capped output, a deadline, and optional
 * AbortSignal cancellation. `onStdoutLine` / `onStderrLine` receive each output line as it comes.
 * @returns {Promise<{ code: number | null, stdout: string, timedOut: boolean }>}
 */
export function run(cmd, args, timeoutMs, env = process.env, signal, { cwd, onStdoutLine, onStderrLine } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('Operation aborted')
      err.name = 'AbortError'
      return reject(err)
    }
    const child = spawn(cmd, args, {
      env,
      ...(cwd ? { cwd } : {}),
      stdio: ['ignore', 'pipe', onStderrLine ? 'pipe' : 'ignore'],
      windowsHide: true,
    })
    let stdout = ''
    let timedOut = false
    let aborted = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    const onAbort = () => { aborted = true; child.kill() }
    signal?.addEventListener('abort', onAbort, { once: true })
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const lines = (stream, each) => {
      let rest = ''
      stream.setEncoding('utf8').on('data', (chunk) => {
        if (stream === child.stdout && stdout.length < MAX_OUTPUT) stdout += chunk
        if (!each) return
        rest += chunk
        let nl
        while ((nl = rest.indexOf('\n')) >= 0) {
          const line = rest.slice(0, nl).replace(/\r$/, '')
          rest = rest.slice(nl + 1)
          try { each(line) } catch { /* a line handler never stops the run */ }
        }
        if (rest.length > MAX_OUTPUT) rest = ''
      }).on('end', () => {
        if (each && rest) {
          try { each(rest) } catch { /* as above */ }
        }
      })
    }
    lines(child.stdout, onStdoutLine)
    if (child.stderr) lines(child.stderr, onStderrLine)
    child.once('error', (err) => { cleanup(); reject(err) })
    child.once('close', (code) => {
      cleanup()
      if (aborted) {
        const err = new Error('Operation aborted')
        err.name = 'AbortError'
        return reject(err)
      }
      resolve({ code, stdout, timedOut })
    })
  })
}

/**
 * The host's environment without what would stand in for the stored login: dsh keeps an
 * exported MESHY_API_KEY out of shell calls on purpose, so the host does not pass one on either,
 * and a dsh started from a dsh shell must not read back the credential it was handed.
 */
function hostEnv(extraEnv) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => {
    const key = k.toUpperCase()
    return key !== 'MESHY_API_KEY' && !key.startsWith('DSH_MESHY_')
  }))
  if (extraEnv && typeof extraEnv === 'object') {
    for (const [k, v] of Object.entries(extraEnv)) {
      if (typeof v === 'string') env[k] = v
    }
  }
  if (ELECTRON) env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

/**
 * Run the bundled CLI and resolve to its v1 envelope. The plugin owns the output format (`json`,
 * or `ndjson` with `stream`, whose `task` events go to `onEvent` as they arrive) and, with
 * `workspace`, the CLI's write limit; both go before a `--` so they never read as arguments.
 */
async function meshy(args, optsOrTimeout = 60_000) {
  const opts = typeof optsOrTimeout === 'number' ? { timeoutMs: optsOrTimeout } : (optsOrTimeout ?? {})
  const timeoutMs = opts.timeoutMs ?? 60_000
  const owned = [
    ...(opts.stream ? ['--format', 'ndjson', '--no-update-check'] : JSON_FLAGS),
    ...(opts.workspace ? ['--workspace', opts.workspace] : []),
  ]
  const cut = args.indexOf('--')
  const argv = cut >= 0 ? [...args.slice(0, cut), ...owned, ...args.slice(cut)] : [...args, ...owned]
  let last = null
  const onStdoutLine = opts.stream
    ? (line) => {
        if (!line.trim()) return
        let event
        try {
          event = JSON.parse(line)
        } catch {
          return
        }
        last = event
        if (event?.event === 'task') opts.onEvent?.(event)
      }
    : undefined
  const out = await run(process.execPath, [cli(), ...argv], timeoutMs, hostEnv(opts.extraEnv), opts.signal, {
    cwd: opts.cwd,
    onStdoutLine,
    onStderrLine: opts.onStderrLine,
  })
  const failed = (message) => ({ ok: false, error: { message } })
  let envelope
  if (opts.stream) {
    if (last && last.event !== 'task') {
      const { event: _e, sequence: _s, ...body } = last
      envelope = body
    } else {
      envelope = failed(out.timedOut ? 'timed out' : `the Meshy CLI ended without a result (exit ${out.code})`)
      if (last?.result) envelope.result = last.result
    }
  } else {
    try {
      envelope = JSON.parse(out.stdout)
    } catch {
      envelope = failed(out.timedOut ? 'timed out' : 'the Meshy CLI printed no result')
    }
  }
  return { ...envelope, timedOut: out.timedOut }
}

const regionOf = (baseUrl) => typeof baseUrl === 'string' && baseUrl.includes('meshy.cn') ? 'cn' : 'global'

function originOf(baseUrl) {
  try {
    return typeof baseUrl === 'string' && baseUrl ? new URL(baseUrl).origin : null
  } catch {
    return null
  }
}

/** The signed-in session handed to shells, or null while signed out. Never sent to a page. */
let session = null
/** The API origin the CLI uses now (signed in or not), from the last session read. */
let apiOrigin = null
let reading = null
let watcher = null
let watchedFile = null

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
      apiOrigin = originOf(r.base_url_v1) ?? apiOrigin
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
  DSH_MESHY_STATE_DIR: { description: "Where the Meshy CLI keeps this chat's operation journal: .meshy/sessions/<chat> in the workspace." },
}

/** Observed session headers captured from shell/tool executions as a lookup fallback. */
const seenSessions = new Map()
/** A task still not finished this long after it started is shown as stale, not as running. */
const STALE_MS = 24 * 3600_000

function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/** What one shell call gets: the CLI, the session while signed in, and a writable journal. */
export function shellFacts(execution) {
  const facts = { DSH_MESHY_NODE: NODE, DSH_MESHY_CLI: cli() }
  const header = execution?.agent?.session?.header
  const cwd = header?.cwd
  if (typeof header?.id === 'string' && header.id && typeof cwd === 'string' && cwd) {
    seenSessions.set(header.id, { cwd, createdAt: parseTimestamp(header.createdAt) })
  }
  if (typeof cwd === 'string' && cwd) facts.DSH_MESHY_STATE_DIR = sessionStateDir(cwd, header?.id)
  if (session) {
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
 * user approves or the code expires, and the session is re-read when it lands.
 */
export async function signIn(region) {
  if (signingIn?.region === region) return signingIn.view
  const started = await meshy(['auth', 'login', '--device', '--no-wait', '--region', region])
  const r = started.result ?? {}
  if (!started.ok || typeof r.verification_url !== 'string' || !r.verification_url.startsWith('https://') || !FLOW_ID.test(r.flow_id ?? '')) {
    throw new Error(started.error?.message ?? 'the Meshy CLI could not start a sign-in')
  }
  const expiresIn = typeof r.expires_in === 'number' ? r.expires_in : 600
  const view = { status: 'waiting_for_approval', verification_url: r.verification_url, user_code: String(r.user_code ?? ''), expires_in: expiresIn }
  const attempt = { region, view }
  signingIn = attempt
  meshy(['auth', 'login', `--device-flow=${r.flow_id}`], expiresIn * 1000 + 30_000)
    .then((done) => done.ok ? refreshSession() : undefined)
    .catch(() => {})
    .finally(() => { if (signingIn === attempt) signingIn = null })
  return view
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

export async function readAuthStatus() {
  const auth = await meshy(['auth', 'status'])
  const r = auth.result ?? {}
  const text = (v) => typeof v === 'string' && v ? v : null
  return {
    authenticated: r.authenticated === true,
    verified: r.verified === true,
    // Read from expires_at, which the CLI reports for a browser sign-in only (an API key does not
    // expire), not from the masked credential: access tokens are JWTs now, no longer msy_at_.
    method: r.authenticated !== true ? null : typeof r.expires_at === 'number' ? 'browser' : 'apiKey',
    account: r.account && (text(r.account.name) || text(r.account.email)) ? { name: text(r.account.name), email: text(r.account.email) } : null,
    region: regionOf(r.base_url_v1),
    balance: typeof r.balance?.balance === 'number' ? r.balance.balance : null,
    hint: r.hint ?? null,
  }
}

export async function status() {
  const version = await run(process.execPath, [cli(), '--version'], 30_000, hostEnv()).catch(() => undefined)
  if (!version || version.code !== 0) return json({ cli: null, error: 'Meshy CLI not found: reinstall the Meshy plugin' })
  return json({
    cli: { version: version.stdout.trim() },
    auth: await readAuthStatus(),
  })
}

function compare(a, b) {
  const x = RELEASE.exec(String(a)), y = RELEASE.exec(String(b))
  if (!x || !y) return NaN
  for (let i = 1; i <= 3; i++) if (x[i] !== y[i]) return Number(x[i]) - Number(y[i])
  return 0
}

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
  return json({ verification_url: r.verification_url, user_code: r.user_code, flow_id: r.flow_id, expires_in: r.expires_in })
}

export async function loginFinish(request) {
  const input = await body(request)
  if (typeof input?.flow_id !== 'string' || !FLOW_ID.test(input.flow_id)) return json({ error: 'invalid flow_id' }, 400)
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

function headerFacts(header) {
  if (!header || typeof header !== 'object') return null
  const cwd = typeof header.cwd === 'string' && header.cwd ? header.cwd : null
  if (!cwd) return null
  return { cwd, createdAt: parseTimestamp(header.createdAt) }
}

function getService(ctx, name) {
  if (!ctx || typeof ctx !== 'object') return undefined
  if (typeof ctx.get === 'function') return ctx.get(name)
  return ctx[name]
}

/**
 * Resolve a session's `{ cwd, createdAt }`: the live session's header (`ctx.sessions.get(id)`),
 * else the stored one (`ctx.sessionPersistence.stat(id)`), else a header seen in a shell call.
 */
export async function resolveSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) return null
  try {
    const live = getService(ctx, 'sessions')?.get?.(sessionId)
    const facts = headerFacts(live?.header)
    if (facts) return facts
  } catch {
    // Fall through to the stored header.
  }
  try {
    const stored = await getService(ctx, 'sessionPersistence')?.stat?.(sessionId)
    const facts = headerFacts(stored?.header)
    if (facts) return facts
  } catch {
    // Fall through to headers seen in shell calls.
  }
  return seenSessions.get(sessionId) ?? null
}

function createHostRuntime(ctx, { cliImpl = meshy, eventsBus = createEventBus(), now = Date.now, currentOrigin = () => apiOrigin } = {}) {
  const catalog = createCatalog({ cli: cliImpl })
  const taskStates = createTaskStates({ cli: cliImpl, catalog })
  const library = createLibraryReader({ cli: cliImpl, catalog })

  /** The chat state directories under a workspace (for the whole-workspace view). */
  async function chatStateDirs(cwd) {
    const root = join(cwd, ...SESSIONS_DIR)
    try {
      const names = await readdir(root, { withFileTypes: true })
      return names.filter((d) => d.isDirectory()).slice(0, 200).map((d) => join(root, d.name))
    } catch {
      return []
    }
  }

  /**
   * A chat's operation records, newest first: its own CLI state directory, plus the shared journal
   * of plugin versions before 0.4.0, attributed by time (records started since the chat began).
   */
  async function chatJournal(meta, sessionId, scope) {
    const dirs = scope === 'workspace' ? await chatStateDirs(meta.cwd) : [sessionStateDir(meta.cwd, sessionId)]
    const legacySince = scope === 'workspace' ? 0 : Math.max(0, (meta.createdAt || 0) - 5000)
    const lists = await Promise.all([
      readJournal(join(meta.cwd, ...JOURNAL), { since: legacySince }),
      ...dirs.map((dir) => readJournal(join(dir, 'operations'))),
    ])
    const byId = new Map()
    for (const r of lists.flat()) if (!byId.has(r.operationId)) byId.set(r.operationId, r)
    return [...byId.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50)
  }

  async function sessionTasks(sessionId, { light = false, scope = 'session', fallback } = {}) {
    const meta = (await resolveSession(ctx, sessionId)) ?? (fallback?.cwd ? { cwd: fallback.cwd, createdAt: parseTimestamp(fallback.createdAt) } : null)
    if (!meta?.cwd) return light ? { workspace: null, tasks: [] } : { workspace: null, tasks: [], models: [] }
    const records = await chatJournal(meta, sessionId, scope)
    if (light) {
      return {
        workspace: meta.cwd,
        tasks: records.map((r) => ({ id: r.operationId, startedAt: r.startedAt })),
      }
    }

    // A record another CLI submitted to a different API origin cannot be read with this sign-in.
    const here = currentOrigin()
    const foreign = (r) => Boolean(here && r.apiOrigin && r.apiOrigin !== here)
    const [models, assets, states] = await Promise.all([
      listModels(meta.cwd),
      readAssetIndex(meta.cwd),
      Promise.all(records.map((r) => r.state === 'accepted' && r.taskId && !foreign(r) ? taskStates.get(r.resource, r.taskId) : undefined)),
    ])
    const tasks = records.map((r, i) => {
      const state = states[i]
      const v = state?.view ?? null
      const saved = r.taskId ? assets[r.taskId] ?? null : null
      // A row is stale when its task cannot be read (another API origin, a 404, a failed read),
      // or it has not finished a day after it started: no live status is shown, and nothing
      // should keep polling it.
      const unread = r.state === 'accepted' && Boolean(r.taskId) && !v
      const unfinished = !r.error && !TERMINAL.has(v?.status) && now() - r.startedAt > STALE_MS
      const stale = unread || unfinished
      return {
        id: r.operationId,
        resource: r.resource,
        kind: outputKind(v) ?? saved?.kind ?? kindOfResource(r.resource),
        taskId: r.taskId,
        callId: saved?.callId ?? null,
        jobId: saved?.jobId ?? null,
        stage: saved?.stage ?? null,
        startedAt: r.startedAt,
        journal: r.state,
        submitError: r.error,
        status: stale ? null : (v?.status ?? null),
        ...(stale ? { stale: true } : {}),
        progress: stale ? null : (v?.progress ?? null),
        title: saved?.title ?? v?.name ?? v?.prompt ?? null,
        name: v?.name ?? null,
        prompt: v?.prompt ?? saved?.prompt ?? null,
        type: v?.type ?? null,
        createdAt: v?.createdAt ?? null,
        finishedAt: v?.finishedAt ?? null,
        expiresAt: v?.expiresAt ?? null,
        credits: v?.credits ?? null,
        thumbnail: v?.thumbnail ?? null,
        model: Boolean(v?.glb || v?.printFile),
        variants: v?.variants ?? [],
        formats: v?.formats ?? [],
        localFile: saved?.file ?? null,
        files: saved?.files ?? [],
        parentTaskId: v?.parentTaskId ?? null,
        error: v?.error ?? null,
        readError: foreign(r) ? 'submitted through another Meshy API; not readable with this sign-in' : (state?.failed ?? null),
      }
    })

    // Fill localFile from workspace models if a file name contains the task id and wasn't cached yet.
    for (const t of tasks) {
      if (!t.localFile && t.taskId) {
        const match = models.find((m) => m.file.includes(t.taskId))
        if (match) t.localFile = match.file
      }
    }

    return { workspace: meta.cwd, tasks, models }
  }

  async function handleTasks(request) {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('session') ?? ''
    if (!sessionId) return json({ workspace: null, tasks: [], models: [] })
    const light = url.searchParams.get('light') === '1'
    const scope = url.searchParams.get('scope') === 'workspace' ? 'workspace' : 'session'
    return json(await sessionTasks(sessionId, { light, scope }))
  }

  async function handleLibrary(request) {
    const url = new URL(request.url)
    const limitParam = url.searchParams.get('limit')
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 24
    const resource = url.searchParams.get('resource') || undefined
    const refresh = url.searchParams.get('refresh') === '1'
    try {
      return json(await library.list({ resource, limit, refresh }))
    } catch (err) {
      return json({ error: String(err?.message ?? err) }, err?.statusCode ?? 500)
    }
  }

  async function handleModel(request) {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('session')
    const file = url.searchParams.get('file')
    if (sessionId && file) {
      const meta = await resolveSession(ctx, sessionId)
      if (!meta?.cwd) return json({ error: 'session workspace not found' }, 404)
      try {
        return await serveWorkspaceModel(meta.cwd, file)
      } catch (err) {
        return json({ error: String(err?.message ?? err) }, err?.statusCode ?? 400)
      }
    }

    const resource = url.searchParams.get('resource')
    const taskId = url.searchParams.get('task')
    if (!resource || !taskId || !(await catalog.taskArgs(resource, 'get', taskId))) {
      return json({ error: 'provide either (resource, task) or (session, file)' }, 400)
    }
    const state = await taskStates.get(resource, taskId)
    // `variant` picks one GLB of a task that has several (a rigging task's walking/running).
    const variant = url.searchParams.get('variant')
    // A task with no GLB shows its print file (a multi-color 3MF).
    const glb = variant ? state?.view?.glbs?.[variant] : state?.view?.glb ?? state?.view?.printFile
    if (!glb) {
      return json({ error: state?.failed ?? (variant ? `no ${variant} model for this task` : 'model not available for this task') }, 404)
    }
    try {
      return await fetchModel(glb)
    } catch (err) {
      return json({ error: String(err?.message ?? err) }, err?.statusCode ?? 502)
    }
  }

  async function handleEvents(request) {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('session') ?? ''
    if (!sessionId) return json({ error: 'session is required' }, 400)
    const meta = await resolveSession(ctx, sessionId)
    let workspaceRoot = null
    if (meta?.cwd) {
      workspaceRoot = await realpath(meta.cwd).catch(() => meta.cwd)
    }

    const encoder = new TextEncoder()
    let unsubscribe = () => {}
    let pingTimer = null

    const stream = new ReadableStream({
      start(controller) {
        const push = (chunk) => {
          try {
            controller.enqueue(encoder.encode(chunk))
          } catch {
            cleanup()
          }
        }
        const cleanup = () => {
          unsubscribe()
          unsubscribe = () => {}
          if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
        }

        push('retry: 3000\n\n')

        unsubscribe = eventsBus.subscribe((event) => {
          const matchesSession = Boolean(event.sessionId && event.sessionId === sessionId)
          const matchesWorkspace = Boolean(
            event.workspace && (
              (workspaceRoot && event.workspace === workspaceRoot)
              || (meta?.cwd && event.workspace === meta.cwd)
            ),
          )
          if (!matchesSession && !matchesWorkspace) return
          // Strip internal routing fields so the host workspace path never leaks to the browser.
          const { sessionId: _s, workspace: _w, ...publicPayload } = event
          push(`data: ${JSON.stringify(publicPayload)}\n\n`)
        })

        pingTimer = setInterval(() => push(': ping\n\n'), SSE_PING_MS)
        pingTimer.unref?.()

        request.signal?.addEventListener('abort', () => {
          cleanup()
          try { controller.close() } catch { /* already closed */ }
        }, { once: true })
      },
      cancel() {
        unsubscribe()
        unsubscribe = () => {}
        if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
      },
    })

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    })
  }

  async function handleEnvHdr() {
    const stream = Readable.toWeb(createReadStream(ENV_HDR_PATH))
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'public, max-age=86400',
      },
    })
  }

  const { tools, meshyTool } = createTools({ ctx, cli: cliImpl, catalog, signIn, events: eventsBus })

  const service = createMeshyService({
    getStatus: async () => {
      const auth = await readAuthStatus()
      return {
        authenticated: auth.authenticated,
        verified: auth.verified,
        region: auth.region,
        account: auth.account,
        balance: auth.balance,
      }
    },
    sessionTasks,
    library,
    taskStates,
    events: eventsBus,
    meshyTool,
  })

  const handleInput = createInputRoute({
    workspaceOf: async (sessionId) => (await resolveSession(ctx, sessionId))?.cwd ?? null,
  })

  const routes = [
    ['/api/meshy.status', 'GET', status],
    ['/api/meshy.update', 'GET', update],
    ['/api/meshy.login', 'POST', loginStart],
    ['/api/meshy.login.finish', 'POST', loginFinish],
    ['/api/meshy.logout', 'POST', logout],
    ['/api/meshy.tasks', 'GET', handleTasks],
    ['/api/meshy.library', 'GET', handleLibrary],
    ['/api/meshy.model', 'GET', handleModel],
    ['/api/meshy.input', 'POST', handleInput],
    ['/api/meshy.events', 'GET', handleEvents],
    ['/api/meshy.env.hdr', 'GET', handleEnvHdr],
  ]

  return { routes, tools, service, events: eventsBus, taskStates, library, catalog }
}

export { createHostRuntime }

export function apply(ctx) {
  const runtime = createHostRuntime(ctx)

  ctx.effect(() => {
    void refreshSession()
    const timer = setInterval(refreshSession, SESSION_REFRESH_MS)
    timer.unref?.()
    return () => {
      clearInterval(timer)
      stopWatching()
    }
  }, 'meshy-dsh: session refresh')

  if (typeof ctx.provide === 'function') {
    ctx.provide('meshy', runtime.service)
  }

  ctx.inject(['shellEnv'], (inner) => {
    inner.shellEnv.register({ name: 'meshy', variables: SHELL_VARIABLES, resolve: shellFacts })
  })

  ctx.inject(['tools'], (inner) => {
    for (const tool of runtime.tools) inner.tools.register(tool)
  })

  ctx.inject(['systemPrompt'], (inner) => {
    registerCompose(inner, ctx)
  })

  ctx.inject(['connection'], (inner) => {
    for (const [path, method, handle] of runtime.routes) {
      inner.effect(() => inner.connection.fetch.register({
        path,
        methods: [method],
        requestBody: 'buffered',
        fetch: (request) => handle(request).catch((err) => json({ error: String(err?.message ?? err) }, 500)),
      }), `meshy-dsh: ${path}`)
    }
  })
}
