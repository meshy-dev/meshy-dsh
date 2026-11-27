// Task journal reading, a cache of CLI `get` reads, account library aggregation, bounded
// workspace GLB discovery, safe Meshy asset streaming, and the per-workspace asset index.
// The CLI runner and its resource catalog are passed in, so this module never spawns a process
// and keeps no list of the CLI's commands.
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

/** Where the CLI kept its operation journal before 0.4.0: one for the whole workspace. */
export const JOURNAL = ['.meshy', 'operations']
/** Since 0.4.0 each chat has its own CLI state directory (`DSH_MESHY_STATE_DIR`) under here. */
export const SESSIONS_DIR = ['.meshy', 'sessions']
/** Hidden folder where task models may also be stored. */
export const MESHY_MODELS_DIR = ['.meshy', 'models']
/** Per-workspace index of the files each task saved (task id -> asset entry). */
export const ASSET_INDEX = ['.meshy', 'dsh-assets.json']
const MAX_ASSETS = 500
/** Files remembered for one task. */
const MAX_FILES = 64
/** How well a saved file previews: a GLB, then a 3MF, then an image, then anything else. */
const FILE_RANKS = [/\.glb$/i, /\.3mf$/i, /\.(?:png|jpe?g|webp)$/i]
const fileRank = (file) => {
  const i = FILE_RANKS.findIndex((re) => re.test(file))
  return i < 0 ? FILE_RANKS.length : i
}

/** API assets live this long on non-Enterprise plans (public docs: Asset Retention). */
export const RETENTION_DAYS = 3
const RETENTION_MS = RETENTION_DAYS * 24 * 3600_000

/**
 * What a task is expected to produce before its output says: `image` for a resource whose name
 * ends in "image" (the CLI's 2D generators), `model` for any other. Only a running task needs it.
 */
export function kindOfResource(resource) {
  return /(?:^|-)image$/.test(String(resource ?? '')) ? 'image' : 'model'
}

/**
 * What a task produced, read from its output: `model` (model files), `image` (pictures only),
 * `none` (it finished with neither, such as a printability report), or null while unknown.
 */
export function outputKind(view) {
  if (!view) return null
  if (view.glb || view.formats?.length > 0 || view.produced === 'model') return 'model'
  if (view.imageUrls?.length > 0 || view.produced === 'image') return 'image'
  return view.status === 'SUCCEEDED' ? 'none' : null
}

const filled = (v) => typeof v === 'string' && v.length > 0

/**
 * What a task's output fields hold, whatever their URLs: `model`, `image` or null. A URL this
 * plugin will not fetch still says what the task made, so it never reads as having made nothing.
 */
function producedOf(task) {
  const urls = task?.model_urls && typeof task.model_urls === 'object' ? Object.values(task.model_urls) : []
  const result = task?.result && typeof task.result === 'object' ? task.result : {}
  if (urls.some(filled) || Object.entries(result).some(([k, v]) => /_glb_url$/.test(k) && filled(v))) return 'model'
  if (Array.isArray(task?.image_urls) && task.image_urls.some(filled)) return 'image'
  return null
}

const ASSET_KINDS = new Set(['model', 'image', 'none'])

/**
 * The account library's default lists (the left Meshy page): the generations people browse.
 * Only those the CLI still lists as task resources with `list` are read.
 */
export const LIBRARY_RESOURCES = ['text-to-3d', 'image-to-3d', 'multi-image-to-3d', 'retexture', 'rigging', 'animate', 'text-to-image', 'image-to-image']

/** A task id as the API issues them; never starts with "-", so it cannot read as an option. */
export const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/

/** Statuses after which a task never changes again. */
export const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED'])

/** Maximum GLB file size streamed for 3D previews (256 MiB). */
export const MAX_GLB = 256 << 20

/** Bounded workspace walk limits for `.glb` discovery. */
export const MAX_DEPTH = 6
export const MAX_MODELS = 200
const MAX_DIRS = 2000
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'bower_components', 'vendor', 'target', 'build', 'dist', 'out', 'venv', '__pycache__',
])
/** Model files the viewer opens: GLB, and 3MF print files (a multi-color print, say). */
const GLB_RE = /\.(?:glb|3mf)$/i

/**
 * The CLI state directory of one chat: `<workspace>/.meshy/sessions/<id>`. The id is made
 * path-safe, so it can never leave that folder.
 */
export function sessionStateDir(workspace, sessionId) {
  const safe = String(sessionId ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '_').slice(0, 120) || 'unknown'
  return join(workspace, ...SESSIONS_DIR, safe)
}

// Record names as the CLI writes them (a UUID, or a caller's --operation-id made path-safe).
const OPERATION_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.json$/
const MAX_RECORD = 64 << 10
const MAX_PARSED = 4000
/** Parsed records by path, kept while the file's mtime and size stay the same. */
const parsed = new Map()

function normalize(r) {
  if (r?.schema_version !== 1 || typeof r.operation_id !== 'string' || typeof r.resource !== 'string' || typeof r.state !== 'string') return null
  const startedAt = Date.parse(r.started_at)
  if (!Number.isFinite(startedAt)) return null
  return {
    operationId: r.operation_id,
    resource: r.resource,
    state: r.state,
    taskId: typeof r.task_id === 'string' ? r.task_id : null,
    startedAt,
    error: typeof r.error === 'string' ? r.error : null,
    // The API the CLI submitted to; a task from another origin cannot be read with this sign-in.
    apiOrigin: typeof r.api_origin === 'string' && r.api_origin ? r.api_origin : null,
  }
}

/**
 * The operation records in `dir` started at or after `since` (epoch ms), newest first. A missing
 * directory, an unreadable file or a malformed record is skipped, never thrown.
 */
export async function readJournal(dir, { since = 0, limit = 50 } = {}) {
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  if (parsed.size > MAX_PARSED) parsed.clear()
  const records = []
  await Promise.all(names.filter((name) => OPERATION_FILE.test(name)).map(async (name) => {
    const file = join(dir, name)
    let info
    try {
      info = await stat(file)
    } catch {
      return
    }
    if (!info.isFile() || info.size > MAX_RECORD || info.mtimeMs < since) return
    let hit = parsed.get(file)
    if (!hit || hit.mtimeMs !== info.mtimeMs || hit.size !== info.size) {
      let record = null
      try {
        record = normalize(JSON.parse(await readFile(file, 'utf8')))
      } catch {
        // Half-written or malformed record: skip it this poll.
      }
      hit = { mtimeMs: info.mtimeMs, size: info.size, record }
      parsed.set(file, hit)
    }
    if (hit.record && hit.record.startedAt >= since) records.push(hit.record)
  }))
  records.sort((a, b) => b.startedAt - a.startedAt || (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0))
  return records.slice(0, limit)
}

const isAssetHost = (host) => ['meshy.ai', 'meshy.cn'].some((domain) => host === domain || host.endsWith(`.${domain}`))

/** An https URL on Meshy's own hosts, or null: the only URLs shown or fetched. */
export function assetUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && isAssetHost(url.hostname) ? url.href : null
  } catch {
    return null
  }
}

/**
 * Every GLB a finished task produced, by variant: `model` (model_urls.glb), `rigged`
 * (rigged_character_glb_url), `animation` (animation_glb_url), and one per basic animation
 * (`walking`, `running`, ...). Armature-only GLBs carry no mesh and are left out.
 */
export function glbsOf(task) {
  const out = {}
  const put = (variant, value) => {
    const url = assetUrl(value)
    if (url && !out[variant] && !Object.values(out).includes(url)) out[variant] = url
  }
  put('model', task?.model_urls?.glb)
  const result = task?.result && typeof task.result === 'object' ? task.result : {}
  put('rigged', result.rigged_character_glb_url)
  put('animation', result.animation_glb_url)
  const animations = result.basic_animations && typeof result.basic_animations === 'object' ? result.basic_animations : {}
  for (const [key, value] of Object.entries(animations)) {
    const m = /^([a-z0-9]+)_glb_url$/.exec(key)
    if (m) put(m[1], value)
  }
  for (const [key, value] of Object.entries(result)) {
    const m = /^([a-z0-9_]+?)_glb_url$/.exec(key)
    if (m && !m[1].includes('armature')) put(m[1], value)
  }
  return out
}

/** Variants in the order a viewer should prefer: a playing animation before a bind pose. */
const GLB_PREFERENCE = ['model', 'animation', 'walking', 'running', 'rigged']

/** The GLB to show first: the model, else an animated character, else the rigged one. */
function glbOf(task, glbs = glbsOf(task)) {
  for (const variant of GLB_PREFERENCE) if (glbs[variant]) return glbs[variant]
  return Object.values(glbs)[0] ?? null
}

function formatsOf(task, glb) {
  const formats = []
  const urls = task?.model_urls && typeof task.model_urls === 'object' ? task.model_urls : {}
  for (const [fmt, value] of Object.entries(urls)) {
    const key = fmt.toLowerCase()
    if (/^[a-z0-9]{2,8}$/.test(key) && assetUrl(value)) formats.push(key)
  }
  if (glb && !formats.includes('glb')) formats.unshift('glb')
  return formats
}

const num = (v) => typeof v === 'number' && Number.isFinite(v) ? v : null
const text = (v) => typeof v === 'string' && v ? v : null

/** Epoch ms from a number (ms) or an ISO string, else null. */
function epochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/** Normalized task view extracted from a meshy-cli task object. `glb` stays host-side. */
export function viewOf(task) {
  if (!task || typeof task !== 'object') return null
  const glbs = glbsOf(task)
  const glb = glbOf(task, glbs)
  const imageUrls = Array.isArray(task.image_urls) ? task.image_urls.map(assetUrl).filter(Boolean) : []
  return {
    taskId: text(task.task_id) ?? text(task.id),
    status: text(task.status),
    progress: num(task.progress),
    name: text(task.name),
    prompt: text(task.prompt) ?? text(task.raw?.prompt) ?? text(task.texture_prompt) ?? text(task.text_style_prompt) ?? text(task.name),
    type: text(task.type),
    createdAt: num(task.created_at),
    finishedAt: num(task.finished_at),
    expiresAt: epochMs(task.expires_at),
    credits: num(task.consumed_credits),
    thumbnail: assetUrl(task.thumbnail_url) ?? imageUrls[0] ?? null,
    glb,
    glbs,
    // A print file (`model_urls['3mf']`), shown when the task has no GLB; host-side like `glb`.
    printFile: assetUrl(task?.model_urls?.['3mf']) ?? assetUrl(task?.model_urls?.['3MF']),
    // Public: which GLB variants exist (the URLs stay host-side).
    variants: Object.keys(glbs),
    formats: formatsOf(task, glb),
    imageUrls,
    produced: producedOf(task),
    parentTaskId: text(task.preview_task_id) ?? text(task.input_task_id) ?? text(task.raw?.preview_task_id) ?? text(task.raw?.input_task_id) ?? null,
    error: text(task.task_error?.message),
  }
}

/**
 * Live task states read through `cli(args)` (which resolves to the CLI's JSON envelope).
 * A running task is cached for `liveMs`, a terminal task for `doneMs`, and concurrent asks share
 * one in-flight call (max `concurrency` simultaneous CLI invocations).
 */
export function createTaskStates({ cli, catalog, now = Date.now, liveMs = 4000, doneMs = 10 * 60_000, concurrency = 2 }) {
  const cache = new Map()
  let active = 0
  const waiting = []
  const acquire = () => new Promise((resolveAcquire) => {
    if (active < concurrency) { active++; resolveAcquire() } else waiting.push(resolveAcquire)
  })
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else active--
  }

  async function read(args, signal) {
    await acquire()
    try {
      const out = await cli(args, signal ? { signal } : undefined)
      if (!out?.ok) {
        const failed = text(out?.error?.message) ?? 'the Meshy CLI could not read this task'
        // A 404 never turns into a task later (another account or API), so it is cached as final.
        const notFound = out?.error?.code === 'not_found' || /\bmeshy api 404\b/.test(failed)
        return notFound ? { failed, notFound: true } : { failed }
      }
      return { view: viewOf(out.result?.task) }
    } finally {
      release()
    }
  }

  /**
   * Read a task's state: `{ view }`, `{ failed }` (plus `notFound: true` on a 404, kept as long as
   * a finished task), or undefined when the CLI lists no such task resource or the id is malformed.
   */
  async function get(resource, taskId, { fresh = false, signal } = {}) {
    const args = await catalog.taskArgs(resource, 'get', taskId)
    if (!args) return undefined
    const key = `${resource} ${taskId}`
    const hit = cache.get(key)
    if (!fresh && hit?.state) {
      const ttl = TERMINAL.has(hit.state.view?.status) || hit.state.notFound ? doneMs : liveMs
      if (now() - hit.at < ttl) return hit.state
    }
    if (!fresh && hit?.reading) return hit.reading
    const reading = read(args, signal)
      .catch((err) => {
        if (err?.name === 'AbortError' || signal?.aborted) throw err
        return { failed: String(err?.message ?? err) }
      })
      .then((state) => {
        const kept = state.failed && hit?.state?.view ? { ...hit.state, failed: state.failed } : state
        cache.set(key, { at: now(), state: kept })
        return kept
      })
    if (!fresh) cache.set(key, { ...hit, reading })
    return reading
  }

  function invalidate(resource, taskId) {
    cache.delete(`${resource} ${taskId}`)
  }

  return { get, invalidate }
}

function isAuthError(envelope) {
  if (!envelope || envelope.ok) return false
  const code = String(envelope.error?.code ?? '').toLowerCase()
  const msg = String(envelope.error?.message ?? '').toLowerCase()
  return code === 'auth' || code === 'unauthorized' || /not signed in|unauthenticated|sign in|api key|credential|401/.test(msg)
}

/**
 * When a listed task's files stop being downloadable: its `expires_at`, else (text-to-3d tasks and
 * older records carry none) three days after it finished or was created. Null when unknown.
 */
export function expiryOf(view) {
  if (!view) return null
  if (typeof view.expiresAt === 'number') return view.expiresAt
  const ref = view.finishedAt ?? view.createdAt
  return typeof ref === 'number' && ref > 0 ? ref + RETENTION_MS : null
}

/**
 * Aggregated recent account library reader across `LIBRARY_RESOURCES` (or one requested listable
 * resource), cached for 60s. Tasks past the API's asset retention are
 * dropped: their thumbnails and models no longer load.
 */
export function createLibraryReader({ cli, catalog, now = Date.now, ttlMs = 60_000 }) {
  const cache = new Map()

  async function list({ resource, limit = 24, refresh = false } = {}) {
    const clamped = Math.max(1, Math.min(30, Number.isInteger(limit) ? limit : Number.parseInt(String(limit ?? 24), 10) || 24))
    const listable = await catalog.listable()
    let resources
    if (resource) {
      if (!listable.has(resource)) {
        throw Object.assign(new Error(`unsupported library resource: ${resource}`), { statusCode: 400 })
      }
      resources = [resource]
    } else {
      resources = LIBRARY_RESOURCES.filter((name) => listable.has(name))
    }
    const key = `${resources.join(',')}|${clamped}`
    const hit = cache.get(key)
    if (!refresh && hit && now() - hit.at < ttlMs) return hit.data

    // Newest first from the API; a full page per resource leaves enough after the expiry filter.
    const pageSize = 30
    const results = await Promise.all(resources.map(async (resName) => {
      const cmd = await catalog.taskCommand(resName)
      const out = await cli([...cmd, 'list', '--page-size', String(pageSize)]).catch((err) => ({ ok: false, error: { message: String(err?.message ?? err) } }))
      return { resName, out }
    }))

    if (results.every(({ out }) => isAuthError(out))) {
      const data = { authenticated: false, items: [], retentionDays: RETENTION_DAYS }
      cache.set(key, { at: now(), data })
      return data
    }

    const at = now()
    // The image-to-image list also returns text-to-image tasks (their `type` says so): an item
    // belongs to the list its type names, and each task appears once.
    const seen = new Set()
    const items = []
    for (const { resName, out } of results) {
      if (!out?.ok) continue
      const listItems = Array.isArray(out.result?.items) ? out.result.items : []
      for (const rawItem of listItems) {
        const v = viewOf(rawItem)
        if (!v?.taskId || seen.has(v.taskId)) continue
        if (v.type && v.type !== resName && listable.has(v.type)) continue
        const expiresAt = expiryOf(v)
        if (expiresAt !== null && expiresAt <= at) continue
        const kind = outputKind(v) ?? kindOfResource(resName)
        if (kind === 'none') continue
        seen.add(v.taskId)
        items.push({
          resource: resName,
          kind,
          taskId: v.taskId,
          status: v.status,
          progress: v.progress,
          name: v.name,
          prompt: v.prompt,
          type: v.type,
          createdAt: v.createdAt,
          finishedAt: v.finishedAt,
          expiresAt,
          credits: v.credits,
          thumbnail: v.thumbnail,
          model: Boolean(v.glb || v.printFile),
          variants: v.variants,
          formats: v.formats,
        })
      }
    }

    items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))
    const data = { authenticated: true, items: items.slice(0, clamped), retentionDays: RETENTION_DAYS }
    cache.set(key, { at: now(), data })
    return data
  }

  function clear() {
    cache.clear()
  }

  return { list, clear }
}

/**
 * Bounded workspace walk of `.glb` files (max 200 files, max depth 6, skipping dependency/build
 * and hidden dirs except `.meshy/models`), never following symlinks, sorted newest first.
 */
export async function listModels(cwd) {
  if (typeof cwd !== 'string' || !cwd) return []
  let root
  try {
    root = await realpath(cwd)
  } catch {
    return []
  }
  const seen = new Set()
  const files = []
  let dirs = 0

  const visit = async (dir, rel, depth) => {
    if (++dirs > MAX_DIRS) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isFile() && GLB_RE.test(entry.name)) {
        if (!seen.has(path)) { seen.add(path); files.push(path) }
      } else if (entry.isDirectory() && depth < MAX_DEPTH && !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name)) {
        await visit(join(dir, entry.name), path, depth + 1)
      }
    }
  }

  await visit(root, '', 0)
  // Also include .meshy/models (the one hidden folder allowed by contract).
  try {
    const meshyModels = join(root, ...MESHY_MODELS_DIR)
    const entries = await readdir(meshyModels, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isSymbolicLink() && entry.isFile() && GLB_RE.test(entry.name)) {
        const path = `${MESHY_MODELS_DIR.join('/')}/${entry.name}`
        if (!seen.has(path)) { seen.add(path); files.push(path) }
      }
    }
  } catch {
    // No .meshy/models directory yet.
  }

  const models = (await Promise.all(files.map(async (file) => {
    const info = await stat(join(root, ...file.split('/'))).catch(() => null)
    if (!info?.isFile()) return null
    return { file, size: info.size, mtimeMs: Math.round(info.mtimeMs) }
  }))).filter(Boolean)

  models.sort((a, b) => b.mtimeMs - a.mtimeMs || a.file.localeCompare(b.file))
  return models.slice(0, MAX_MODELS)
}

function isInsideRoot(root, candidate) {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * Resolve an existing file inside `workspace` with `realpath` containment checking.
 * Refuses path traversal, null bytes, symlinks escaping `workspace`, and disallowed extensions.
 */
export async function resolveWorkspaceFile(workspace, inputPath, { allowedExts } = {}) {
  if (typeof workspace !== 'string' || !workspace) throw Object.assign(new Error('workspace is unavailable'), { statusCode: 400 })
  if (typeof inputPath !== 'string' || !inputPath.trim() || inputPath.includes('\0')) {
    throw Object.assign(new Error('invalid file path'), { statusCode: 400 })
  }
  const root = await realpath(workspace)
  const candidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath)
  if (!isInsideRoot(root, candidate)) {
    throw Object.assign(new Error('file path escapes the session workspace'), { statusCode: 400 })
  }
  let real
  try {
    real = await realpath(candidate)
  } catch {
    throw Object.assign(new Error(`file not found: ${inputPath}`), { statusCode: 404 })
  }
  if (!isInsideRoot(root, real) || real === root) {
    throw Object.assign(new Error('file path escapes the session workspace'), { statusCode: 400 })
  }
  const info = await stat(real)
  if (!info.isFile()) throw Object.assign(new Error('path is not a regular file'), { statusCode: 400 })
  const ext = extname(real).toLowerCase()
  if (allowedExts && !allowedExts.has(ext)) {
    throw Object.assign(new Error(`unsupported file extension: ${ext || '(none)'}`), { statusCode: 400 })
  }
  const rel = relative(root, real).split(sep).join('/')
  return { root, abs: real, rel, size: info.size }
}

/**
 * Stream a local `.glb` file from the session workspace with strict realpath + size checking.
 */
export async function serveWorkspaceModel(workspace, relFile, { max = MAX_GLB } = {}) {
  const { abs, size } = await resolveWorkspaceFile(workspace, relFile, { allowedExts: new Set(['.glb', '.3mf']) })
  if (size > max) {
    throw Object.assign(new Error('the model is too large to preview'), { statusCode: 413, tooLarge: size })
  }
  const stream = Readable.toWeb(createReadStream(abs))
  return new Response(stream, {
    headers: { 'content-type': modelType(abs), 'cache-control': 'no-store' },
  })
}

const modelType = (name) => (/\.3mf(?:$|\?)/i.test(name) ? 'model/3mf' : 'model/gltf-binary')

/**
 * Fetch a GLB (or 3MF) from Meshy's asset hosts as a byte stream, refusing anything over `max` bytes.
 * Resolves to a Response for the browser, or throws.
 */
export async function fetchModel(url, { max = MAX_GLB, fetchImpl = fetch, timeoutMs = 120_000 } = {}) {
  const target = assetUrl(url)
  if (!target) throw Object.assign(new Error('not a Meshy asset URL'), { statusCode: 400 })
  const res = await fetchImpl(target, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok || !res.body) throw Object.assign(new Error(`the model download failed (HTTP ${res.status})`), { statusCode: 502 })
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    throw Object.assign(new Error('the model is too large to preview'), { statusCode: 413, tooLarge: declared })
  }
  let seen = 0
  const capped = res.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength
      if (seen > max) controller.error(new Error('the model is too large to preview'))
      else controller.enqueue(chunk)
    },
  }))
  return new Response(capped, { headers: { 'content-type': modelType(new URL(target).pathname), 'cache-control': 'no-store' } })
}

// ---------------------------------------------------------------------------
// Asset index
// ---------------------------------------------------------------------------

/** Serialize index writes per workspace so concurrent jobs never lose each other's entries. */
const indexLocks = new Map()

function indexPath(root) {
  return join(root, ...ASSET_INDEX)
}

async function rootOf(workspace) {
  if (typeof workspace !== 'string' || !workspace) return null
  return realpath(workspace).catch(() => null)
}

const OPTIONAL_FACTS = ['prompt', 'stage', 'callId', 'jobId']

/** The optional string facts an index entry may carry (the submitting call, its job, the prompt). */
function optionalFacts(entry) {
  const out = {}
  for (const key of OPTIONAL_FACTS) {
    const value = text(entry?.[key])
    if (value) out[key] = key === 'prompt' ? value.slice(0, 800) : value.slice(0, 200)
  }
  return out
}

/**
 * The asset index of a workspace: `{ [taskId]: { resource, kind, title, file, files, createdAt } }`,
 * plus `prompt`, `stage`, `callId` and `jobId` when the task was submitted here.
 */
export async function readAssetIndex(workspace) {
  const root = await rootOf(workspace)
  if (!root) return {}
  try {
    const raw = JSON.parse(await readFile(indexPath(root), 'utf8'))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out = {}
    for (const [id, entry] of Object.entries(raw)) {
      if (!TASK_ID.test(id) || !entry || typeof entry !== 'object') continue
      out[id] = {
        resource: text(entry.resource),
        kind: ASSET_KINDS.has(entry.kind) ? entry.kind : null,
        title: text(entry.title),
        file: text(entry.file),
        files: Array.isArray(entry.files) ? entry.files.filter((f) => typeof f === 'string') : [],
        createdAt: num(entry.createdAt),
        ...optionalFacts(entry),
      }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Record (or update) the files a task saved, atomically (temp file + rename), keeping the newest
 * 500 entries. Never throws: the index is a convenience, the files are already on disk.
 */
export async function recordAsset(workspace, taskId, entry, { now = Date.now } = {}) {
  const root = await rootOf(workspace)
  if (!root || typeof taskId !== 'string' || !TASK_ID.test(taskId)) return null
  const previous = indexLocks.get(root) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    const index = await readAssetIndex(root)
    const prior = index[taskId] ?? {}
    // Every file any call saved for the task, the newest last.
    const added = Array.isArray(entry?.files) ? entry.files.filter((f) => typeof f === 'string' && f) : []
    const files = [...new Set([...(prior.files ?? []), ...added])].slice(-MAX_FILES)
    // A finished output is never downgraded to "nothing" by a later, emptier read.
    const kind = ASSET_KINDS.has(entry?.kind) && !(entry.kind === 'none' && prior.kind && prior.kind !== 'none')
      ? entry.kind
      : (prior.kind ?? null)
    const merged = {
      resource: text(entry?.resource) ?? prior.resource ?? null,
      kind,
      // A task keeps the name it was submitted with; a later wait or get never renames it.
      title: prior.title ?? text(entry?.title) ?? null,
      // The file the Studio opens: the most previewable one saved, the newest on a tie.
      file: [text(entry?.file), prior.file, ...[...files].reverse()].reduce(
        (best, f) => (f && (best === null || fileRank(f) < fileRank(best)) ? f : best),
        null,
      ),
      files,
      createdAt: num(prior.createdAt) ?? num(entry?.createdAt) ?? now(),
      ...optionalFacts(prior),
      ...optionalFacts(entry),
    }
    index[taskId] = merged
    const kept = Object.entries(index)
      .sort((a, b) => (b[1].createdAt ?? 0) - (a[1].createdAt ?? 0))
      .slice(0, MAX_ASSETS)
    const path = indexPath(root)
    await mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
    await writeFile(tmp, `${JSON.stringify(Object.fromEntries(kept), null, 1)}\n`, { mode: 0o600 })
    await rename(tmp, path)
    return merged
  })
  const settled = next.catch(() => null)
  indexLocks.set(root, settled)
  settled.finally(() => { if (indexLocks.get(root) === settled) indexLocks.delete(root) })
  return settled
}
