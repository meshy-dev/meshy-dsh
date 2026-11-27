// The Meshy project of one session workspace: every 3D asset made in it and how they relate, the
// asset the user is looking at, and the pins the user left for the agent. The host is the only
// writer. Assets are derived from what the Meshy CLI already leaves in the workspace, so the agent
// keeps using the CLI through its shell and nothing changes for the skills:
//   - an `-o` download's sidecar (`meta.json`, `<stem>_meta.json`): resource, the full task,
//     saved file paths;
//   - the operation journal (`.meshy/operations/<id>.json`): tasks submitted but not downloaded.
// What the CLI cannot know (a label, a parent link the agent declares, the active asset, pins,
// the route) lives in the project file, `meshy_output/project.meshy`, together with a snapshot of
// the derived assets so a page can read the whole project with one file read. Every write bumps
// `revision`; a write that names an older revision is refused with the current project.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'

export const PROJECT_FILE = join('meshy_output', 'project.meshy')
export const SNAPSHOT_DIR = join('.meshy', 'snapshots')
const SCHEMA = 1
const ROUTES = new Set(['game', 'print', 'showcase'])
const SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.cache'])
const MAX_DEPTH = 6
const MAX_ENTRIES = 20_000
const MAX_PINS = 200
const MAX_MARKS = 2_000
const MAX_NOTE = 2_000
const MAX_LABEL = 120
const MAX_SNAPSHOT = 8 << 20
/** A submitted task with no download yet counts as running for this long, then as submitted. */
const RUNNING_MS = 45 * 60_000
const IMAGE_RESOURCES = new Set(['text-to-image', 'image-to-image'])
const MODEL_FORMATS = ['glb', 'fbx', 'obj', 'stl', '3mf', 'usdz', 'blend']
/** Raw task fields that name the task an operation started from, when the API reports one. */
const TITLE_KEYS = ['name', 'prompt', 'object_prompt', 'text_style_prompt', 'texture_prompt']
const MAX_TITLE = 80
const PARENT_KEYS = ['input_task_id', 'preview_task_id', 'rig_task_id', 'source_task_id', 'image_task_id']
/** Task, asset and pin ids. A leading letter or digit: the host passes a task id to the CLI, where "-x" would read as an option. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export class Conflict extends Error {
  constructor(project) { super('the project changed; reload it and try again'); this.project = project }
}

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const posix = (p) => p.split(sep).join('/')

/** A path inside the workspace, relative and in forward slashes; null for anything outside. */
function inside(cwd, path) {
  if (typeof path !== 'string' || !path) return null
  const rel = relative(cwd, isAbsolute(path) ? path : join(cwd, path))
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? posix(rel) : null
}

/** Sidecar files under the workspace, bounded in depth and count, skipping dependency trees. */
function sidecars(cwd) {
  const found = []
  let seen = 0
  const walk = (dir, depth) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (++seen > MAX_ENTRIES) return
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRS.has(e.name) && !(e.name.startsWith('.') && e.name !== '.meshy')) walk(join(dir, e.name), depth + 1)
      } else if (e.isFile() && (e.name === 'meta.json' || e.name.endsWith('_meta.json'))) {
        found.push(join(dir, e.name))
      }
    }
  }
  walk(cwd, 0)
  return found
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return undefined }
}

function iso(v) {
  if (typeof v === 'number' && v > 0) return new Date(v).toISOString()
  if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString()
  return null
}

/** One asset from a download sidecar, or undefined when the file is not a Meshy sidecar. */
function fromSidecar(cwd, file) {
  const meta = readJson(file)
  const task = meta?.task
  if (!isObject(meta) || typeof meta.resource !== 'string' || !isObject(task) || typeof task.id !== 'string' || !ID.test(task.id)) return undefined
  const saved = (Array.isArray(meta.saved_files) ? meta.saved_files : []).map((p) => inside(cwd, p)).filter(Boolean)
  const files = {}
  for (const fmt of MODEL_FORMATS) files[fmt] = saved.find((p) => extname(p).toLowerCase() === `.${fmt}`) ?? null
  const images = saved.filter((p) => /\.(png|jpe?g|webp)$/i.test(p))
  files.thumbnail = images.find((p) => /thumbnail|preview/i.test(p)) ?? images[0] ?? null
  files.images = images
  let bytes = null
  const main = files.glb ?? MODEL_FORMATS.map((f) => files[f]).find(Boolean)
  if (main) try { bytes = statSync(join(cwd, main)).size } catch {}
  // The skills save the preview image beside the model (`preview.png`, `preview-<id>.png`) with
  // a separate download, so it is not in this sidecar's list.
  if (!files.thumbnail && main) {
    const dir = dirname(main)
    try {
      const near = readdirSync(join(cwd, dir)).filter((n) => /^(preview|thumbnail)[\w.-]*\.(png|jpe?g|webp)$/i.test(n))
      const pick = near.find((n) => n.includes(task.id)) ?? near.find((n) => /^(preview|thumbnail)\.(png|jpe?g|webp)$/i.test(n))
      if (pick) files.thumbnail = posix(join(dir, pick))
    } catch {}
  }
  // The API echoes a create's request under `input` (a refine's preview_task_id, for one).
  const input = isObject(task.input) ? task.input : {}
  const parents = PARENT_KEYS.flatMap((k) => [task[k], input[k]]).filter((v) => typeof v === 'string' && ID.test(v))
  const status = String(task.status ?? '').toUpperCase()
  const textures = Array.isArray(task.texture_urls) && task.texture_urls.length > 0
  const model = String(task.ai_model ?? input.ai_model ?? '')
  const shape = String(task.model_type ?? input.model_type ?? '')
  return {
    id: task.id,
    kind: IMAGE_RESOURCES.has(meta.resource) ? 'image' : 'model',
    operation: meta.resource,
    type: typeof task.type === 'string' && task.type ? task.type.slice(0, 64) : null,
    taskId: task.id,
    // What the user asked for, as the webapp names a task: its name, else its prompt.
    title: TITLE_KEYS.map((k) => text(task[k], MAX_TITLE) || text(input[k], MAX_TITLE)).find(Boolean) ?? null,
    status: status === 'SUCCEEDED' ? 'succeeded' : status === 'FAILED' || status === 'CANCELED' ? 'failed' : 'running',
    progress: typeof task.progress === 'number' ? task.progress / 100 : null,
    files,
    stats: {
      faces: typeof task.face_count === 'number' ? task.face_count : null,
      bytes,
      rigged: meta.resource === 'rigging' || meta.resource === 'animate' || saved.some((p) => /rigged|animation|_glb\.glb$/i.test(p)),
      animations: saved.filter((p) => /animation|_glb\.glb$|walking|running/i.test(p) && /\.(glb|fbx)$/i.test(p)),
      // A preview or a UV unwrap is a white model; rigging and animation keep their source's texture.
      textured: IMAGE_RESOURCES.has(meta.resource) ? false : textures || meta.resource === 'rigging' || meta.resource === 'animate',
      // Smart topology (Meshy T2 / T2.5, low-poly) is already at its face budget: no remesh.
      smartTopology: /^(lowpoly|smart-topology)$/i.test(shape) || /^meshy-t2/i.test(model),
    },
    credits: typeof task.consumed_credits === 'number' ? task.consumed_credits : null,
    sidecar: inside(cwd, file),
    sourceParent: parents[0] ?? null,
    createdAt: iso(task.created_at) ?? iso(meta.downloaded_at),
  }
}

/** Tasks the journal says were accepted; those without a download are shown as in progress. */
function fromJournal(cwd, now) {
  const dir = join(cwd, '.meshy', 'operations')
  let names
  try { names = readdirSync(dir) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const op = readJson(join(dir, name))
    if (!isObject(op) || op.state !== 'accepted' || typeof op.task_id !== 'string' || !ID.test(op.task_id) || typeof op.resource !== 'string') continue
    const started = Date.parse(op.started_at)
    out.push({
      id: op.task_id,
      kind: IMAGE_RESOURCES.has(op.resource) ? 'image' : 'model',
      operation: op.resource,
      type: null,
      taskId: op.task_id,
      status: Number.isFinite(started) && now - started < RUNNING_MS ? 'running' : 'submitted',
      progress: null,
      files: { images: [], thumbnail: null, ...Object.fromEntries(MODEL_FORMATS.map((f) => [f, null])) },
      title: null,
      stats: { faces: null, bytes: null, rigged: false, animations: [], textured: null, smartTopology: false },
      credits: null,
      sidecar: null,
      sourceParent: null,
      createdAt: iso(op.started_at),
    })
  }
  return out
}

/** The kept part of the project file: what only the user and the agent can say. */
function blank() {
  return { schema: SCHEMA, revision: 0, route: null, activeAssetId: null, labels: {}, links: {}, starred: [], archived: [], pins: [] }
}

/** Read the kept part; a missing or damaged file starts over (the damaged one is set aside). */
export function readKept(cwd) {
  const file = join(cwd, PROJECT_FILE)
  if (!existsSync(file)) return blank()
  const raw = readJson(file)
  if (!isObject(raw) || raw.schema !== SCHEMA) {
    try { renameSync(file, `${file}.damaged-${Date.now()}`) } catch {}
    return blank()
  }
  const kept = blank()
  kept.revision = Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0
  kept.route = ROUTES.has(raw.route) ? raw.route : null
  kept.activeAssetId = typeof raw.activeAssetId === 'string' && ID.test(raw.activeAssetId) ? raw.activeAssetId : null
  for (const [k, v] of Object.entries(isObject(raw.labels) ? raw.labels : {})) if (ID.test(k) && text(v, MAX_LABEL)) kept.labels[k] = text(v, MAX_LABEL)
  for (const [k, v] of Object.entries(isObject(raw.links) ? raw.links : {})) if (ID.test(k) && typeof v === 'string' && ID.test(v) && k !== v) kept.links[k] = v
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, MAX_MARKS)
  kept.starred = ids(raw.starred)
  kept.archived = ids(raw.archived)
  kept.pins = (Array.isArray(raw.pins) ? raw.pins : []).filter((p) => isObject(p) && typeof p.id === 'string' && ID.test(p.id)).slice(-MAX_PINS).map((p) => ({
    id: p.id,
    assetId: typeof p.assetId === 'string' && ID.test(p.assetId) ? p.assetId : null,
    note: text(p.note, MAX_NOTE),
    snapshot: typeof p.snapshot === 'string' && inside(cwd, p.snapshot) ? inside(cwd, p.snapshot) : null,
    camera: isObject(p.camera) ? { azimuth: Number(p.camera.azimuth) || 0, elevation: Number(p.camera.elevation) || 0 } : null,
    resolved: p.resolved === true,
    createdAt: iso(p.createdAt),
  }))
  return kept
}

/**
 * The whole project: kept fields plus assets derived from the workspace. A parent link the agent
 * declared wins over one read from the task; ids that point nowhere are dropped.
 */
export function readProject(cwd, now = Date.now()) {
  const kept = readKept(cwd)
  const byId = new Map()
  for (const a of fromJournal(cwd, now)) byId.set(a.id, a)
  for (const file of sidecars(cwd)) {
    const a = fromSidecar(cwd, file)
    if (!a) continue
    const prev = byId.get(a.id)
    // Two sidecars of one task (a directory and a single file): keep the richer one.
    if (prev && prev.sidecar && (prev.files.glb || !a.files.glb)) continue
    byId.set(a.id, a)
  }
  const assets = [...byId.values()].map(({ sourceParent, ...a }) => {
    const parentId = kept.links[a.id] ?? sourceParent
    return {
      ...a,
      parentId: parentId && byId.has(parentId) ? parentId : null,
      label: kept.labels[a.id] ?? null,
      starred: kept.starred.includes(a.id),
      archived: kept.archived.includes(a.id),
    }
  })
  assets.sort((x, y) => String(x.createdAt ?? '').localeCompare(String(y.createdAt ?? '')) || x.id.localeCompare(y.id))
  const active = kept.activeAssetId && byId.has(kept.activeAssetId) ? kept.activeAssetId : null
  const latest = [...assets].reverse().find((a) => a.kind === 'model' && a.status === 'succeeded' && !a.archived)
  return {
    schema: SCHEMA,
    revision: kept.revision,
    route: kept.route,
    activeAssetId: active ?? latest?.id ?? null,
    assets,
    pins: kept.pins,
    labels: kept.labels,
    links: kept.links,
    starred: kept.starred,
    archived: kept.archived,
    file: posix(PROJECT_FILE),
  }
}

function writeAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

/** Store the project (kept fields and the derived snapshot) without changing its revision. */
function store(cwd, project) {
  const { file, ...body } = project
  writeAtomic(join(cwd, PROJECT_FILE), `${JSON.stringify(body, null, 2)}\n`)
}

/**
 * Refresh the derived part on disk when the workspace changed (a download, a new journal entry);
 * the revision stays, since nobody changed what is kept. Returns the project.
 */
export function syncProject(cwd, now = Date.now()) {
  const project = readProject(cwd, now)
  if (!project.assets.length && !existsSync(join(cwd, PROJECT_FILE))) return project
  const before = readJson(join(cwd, PROJECT_FILE))
  const { file, ...body } = project
  if (JSON.stringify(before) !== JSON.stringify(body)) store(cwd, project)
  return project
}

const nextPinId = (pins) => `p_${pins.reduce((n, p) => Math.max(n, Number(/^p_(\d+)$/.exec(p.id)?.[1] ?? 0)), 0) + 1}`

/**
 * Apply one change. `revision`, when given, must be the current one. Changes are a closed set:
 *   { op: 'activate', assetId }            the asset the user is looking at
 *   { op: 'label', assetId, label }        a name for an asset ('' removes it)
 *   { op: 'link', assetId, parentId }      the asset it was made from (null removes it)
 *   { op: 'pin', assetId, note, camera, snapshotPng }  a view the user points the agent at
 *   { op: 'resolve', pinId }               the agent dealt with a pin
 *   { op: 'route', route }                 game, print, showcase or null
 *   { op: 'star', assetId, on }            mark an asset as a favourite, or not
 *   { op: 'archive', assetId, on }         hide an asset from the library (files stay), or show it
 * Returns { project, pin? }.
 */
export function changeProject(cwd, change, revision) {
  const project = readProject(cwd)
  if (revision !== undefined && revision !== null && revision !== project.revision) throw new Conflict(project)
  const has = (id) => typeof id === 'string' && project.assets.some((a) => a.id === id)
  const kept = { route: project.route, activeAssetId: project.activeAssetId, labels: { ...project.labels }, links: { ...project.links }, starred: [...project.starred], archived: [...project.archived], pins: [...project.pins] }
  let pin
  switch (change?.op) {
    case 'activate':
      if (!has(change.assetId)) throw new TypeError('unknown asset')
      kept.activeAssetId = change.assetId
      break
    case 'label': {
      if (!has(change.assetId)) throw new TypeError('unknown asset')
      const label = text(change.label, MAX_LABEL)
      if (label) kept.labels[change.assetId] = label
      else delete kept.labels[change.assetId]
      break
    }
    case 'link':
      if (!has(change.assetId)) throw new TypeError('unknown asset')
      if (change.parentId === null) delete kept.links[change.assetId]
      else if (has(change.parentId) && change.parentId !== change.assetId) kept.links[change.assetId] = change.parentId
      else throw new TypeError('unknown parent asset')
      break
    case 'pin': {
      if (!has(change.assetId)) throw new TypeError('unknown asset')
      const note = text(change.note, MAX_NOTE)
      const id = nextPinId(kept.pins)
      let snapshot = null
      if (typeof change.snapshotPng === 'string' && change.snapshotPng) {
        const png = Buffer.from(change.snapshotPng.replace(/^data:image\/png;base64,/, ''), 'base64')
        if (png.length > MAX_SNAPSHOT || png.readUInt32BE(0) !== 0x89504e47) throw new TypeError('snapshot must be a PNG under 8 MB')
        snapshot = posix(join(SNAPSHOT_DIR, `${id}.png`))
        writeAtomic(join(cwd, snapshot), png)
      }
      const c = change.camera
      pin = {
        id,
        assetId: change.assetId,
        note,
        snapshot,
        camera: isObject(c) ? { azimuth: Math.round(Number(c.azimuth) || 0), elevation: Math.round(Number(c.elevation) || 0) } : null,
        resolved: false,
        createdAt: new Date().toISOString(),
      }
      kept.pins = [...kept.pins, pin].slice(-MAX_PINS)
      break
    }
    case 'resolve': {
      const i = kept.pins.findIndex((p) => p.id === change.pinId)
      if (i < 0) throw new TypeError('unknown pin')
      kept.pins[i] = { ...kept.pins[i], resolved: true }
      break
    }
    case 'star':
    case 'archive': {
      if (!has(change.assetId)) throw new TypeError('unknown asset')
      const key = change.op === 'star' ? 'starred' : 'archived'
      const rest = kept[key].filter((id) => id !== change.assetId)
      kept[key] = change.on === false ? rest : [...rest, change.assetId].slice(-MAX_MARKS)
      if (key === 'archived' && change.on !== false && kept.activeAssetId === change.assetId) kept.activeAssetId = null
      break
    }
    case 'route':
      if (change.route !== null && !ROUTES.has(change.route)) throw new TypeError('route must be game, print, showcase or null')
      kept.route = change.route
      break
    default:
      throw new TypeError('unknown change')
  }
  const next = { ...project, ...kept, revision: project.revision + 1 }
  store(cwd, next)
  return { project: readProject(cwd), pin }
}

/** What the agent needs, without the bulk: short asset lines, the active asset, open pins. */
export function summary(project) {
  const asset = (a) => ({
    id: a.id,
    label: a.label,
    title: a.title,
    operation: a.operation,
    kind: a.kind,
    status: a.status,
    parentId: a.parentId,
    file: a.files.glb ?? MODEL_FORMATS.map((f) => a.files[f]).find(Boolean) ?? a.files.images?.[0] ?? null,
    faces: a.stats.faces,
    credits: a.credits,
    ...(a.starred ? { starred: true } : {}),
    ...(a.archived ? { archived: true } : {}),
  })
  return {
    revision: project.revision,
    route: project.route,
    activeAssetId: project.activeAssetId,
    projectFile: project.file,
    assets: project.assets.map(asset),
    openPins: project.pins.filter((p) => !p.resolved),
  }
}
