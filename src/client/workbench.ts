// Pure client logic (no React, no DOM): task phases, the tool card read from `result.meta`
// (with the old `MESHY_CARD:` trailer as a fallback for sessions recorded before 0.4.0),
// Studio assets, titles, relative time, follow-up prompts and composer insertion.

export type TaskPhase = 'active' | 'done' | 'failed' | 'canceled'
export type AssetKind = 'model' | 'image'

export type TaskRow = {
  id: string
  resource: string
  taskId: string | null
  startedAt: number
  journal?: string | null
  submitError?: string | null
  status: string | null
  progress: number | null
  name?: string | null
  title?: string | null
  prompt?: string | null
  type?: string | null
  stage?: string | null
  kind?: AssetKind | string | null
  createdAt?: number | null
  expiresAt?: number | null
  finishedAt?: number | null
  credits?: number | null
  thumbnail?: string | null
  model?: boolean
  /** The GLB variants a finished task has (`model`, `rigged`, `walking`, `running`, `animation`). */
  variants?: string[]
  formats?: string[]
  localFile?: string | null
  files?: string[]
  parentTaskId?: string | null
  error?: string | null
  readError?: string | null
  stale?: boolean
  callId?: string | null
  jobId?: string | null
}

export type ModelFile = {
  file: string
  size: number
  mtimeMs: number
}

export type LibraryItem = {
  resource: string
  kind?: AssetKind | string | null
  taskId: string
  status: string
  progress?: number | null
  name?: string | null
  prompt?: string | null
  type?: string | null
  createdAt?: number | null
  finishedAt?: number | null
  expiresAt?: number | null
  credits?: number | null
  thumbnail?: string | null
  model?: boolean
  variants?: string[]
  formats?: string[]
}

export type MeshyCardItem = {
  resource?: string
  taskId?: string
  kind?: string
  progress?: number
  status?: string
  title?: string
  thumbnail?: string
  credits?: number
}

/** The card a Meshy tool result carries in `result.meta` (presentation only, never model-facing). */
export type MeshyCard = {
  tool?: string
  status?: string
  /** `meshy`: the command as it ran, its tasks, and the approved estimate. */
  command?: string
  tasks?: MeshyCardItem[]
  paid?: boolean
  estimate?: number
  resource?: string
  stage?: string
  kind?: AssetKind | string
  taskId?: string
  jobId?: string
  parentTaskId?: string
  title?: string
  prompt?: string
  thumbnail?: string
  file?: string
  files?: string[]
  formats?: string[]
  format?: string
  credits?: number
  estimated?: boolean
  balance?: number | null
  accountName?: string | null
  authenticated?: boolean
  region?: string
  scope?: string
  count?: number
  progress?: number | null
  error?: string | null
  prices?: Record<string, unknown>
  items?: MeshyCardItem[]
  verificationUrl?: string
  userCode?: string
  expiresIn?: number
}

export type ActionKind =
  | 'refine' | 'retexture' | 'remesh' | 'uvUnwrap' | 'rig' | 'animate'
  | 'print' | 'printCheck' | 'printRepair' | 'multiColor' | 'splitParts' | 'resize' | 'slicer'
  | 'imageTo3d' | 'editImage' | 'useInSession' | 'export' | 'convert'

export const MESHY_CARD_PREFIX = 'MESHY_CARD:'

/**
 * What a task shows as: what it produced once it has finished (`kind`, read by the host from its
 * output; `none` for a report such as a print check, which the Studio leaves out), and while it
 * runs a guess from its name: a resource ending in "image" makes pictures, any other a model.
 */
export function kindOf(row: { kind?: string | null; resource?: string | null }): AssetKind | null {
  if (row.kind === 'model' || row.kind === 'image') return row.kind
  if (row.kind === 'none') return null
  const resource = (row.resource ?? '').toLowerCase()
  if (!resource) return null
  return /(?:^|-)image$/.test(resource) ? 'image' : 'model'
}

/** Classify a task into its UI lifecycle phase. */
export function phaseOf(task: Pick<TaskRow, 'status' | 'submitError' | 'journal'> & { stale?: boolean }): TaskPhase {
  if (task.submitError || task.journal === 'failed') return 'failed'
  const status = (task.status ?? '').toUpperCase()
  if (status === 'SUCCEEDED' || status === 'DONE' || status === 'COMPLETED' || status === 'OK') return 'done'
  if (status === 'FAILED' || status === 'ERROR' || status === 'EXPIRED') return 'failed'
  if (status === 'CANCELED' || status === 'CANCELLED' || status === 'INTERRUPTED') return 'canceled'
  if (task.stale) return 'canceled'
  return 'active'
}

const RESOURCE_LABELS: Record<string, [string, string]> = {
  'text-to-3d': ['Text to 3D', '文生 3D'],
  'image-to-3d': ['Image to 3D', '图生 3D'],
  'multi-image-to-3d': ['Multi-image to 3D', '多图生 3D'],
  'text-to-image': ['Text to image', '文生图'],
  'image-to-image': ['Image edit', '图片编辑'],
  retexture: ['Retexture', '重新贴图'],
  remesh: ['Remesh', '重拓扑'],
  'uv-unwrap': ['UV unwrap', 'UV 展开'],
  convert: ['Format conversion', '格式转换'],
  resize: ['Resize', '调整尺寸'],
  'multi-color-print': ['Multi-color print', '多色打印'],
  'repair-printability': ['Print repair', '打印修复'],
  'auto-split': ['Split into parts', '拆分部件'],
  rigging: ['Rigging', '骨骼绑定'],
  animate: ['Animation', '动画'],
  animation: ['Animation', '动画'],
}

/** A short, localized name for a task resource. */
export function resourceLabel(resource: string | null | undefined, locale: 'en' | 'zh' = 'en', stage?: string | null): string {
  if (!resource) return ''
  const pair = RESOURCE_LABELS[resource.toLowerCase()]
  const base = pair ? pair[locale === 'zh' ? 1 : 0] : resource
  if (resource === 'text-to-3d' && stage === 'preview') return locale === 'zh' ? '文生 3D · 白模' : 'Text to 3D · Preview'
  if (resource === 'text-to-3d' && stage === 'refine') return locale === 'zh' ? '文生 3D · 贴图' : 'Text to 3D · Refine'
  return base
}

function clip(text: string, maxLen: number): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length > maxLen ? `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…` : clean
}

/** The file name without directories or extension. */
export function baseName(file: string | null | undefined): string {
  if (!file) return ''
  const last = file.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''
  return last.replace(/\.[^.]+$/, '')
}

/** A concise display title: the given title, a saved file's name, the prompt, then the resource. */
export function titleOf(
  task: {
    title?: string | null
    name?: string | null
    prompt?: string | null
    localFile?: string | null
    file?: string | null
    type?: string | null
    resource?: string | null
    taskId?: string | null
  },
  maxLen = 56,
  locale: 'en' | 'zh' = 'en',
): string {
  const explicit = task.title ?? task.name
  if (explicit && explicit.trim()) return clip(explicit, maxLen)
  const fromFile = baseName(task.localFile ?? task.file)
  if (fromFile) return clip(fromFile, maxLen)
  if (task.prompt && task.prompt.trim()) return clip(task.prompt, maxLen)
  if (task.resource) return resourceLabel(task.resource, locale)
  if (task.type) return task.type
  if (task.taskId) return task.taskId.slice(0, 12)
  return 'Meshy'
}

/** Format a compact relative timestamp in English or Chinese. */
export function agoText(ts: number | null | undefined, now = Date.now(), locale: 'en' | 'zh' = 'en'): string {
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return ''
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000))
  if (diffSec < 45) return locale === 'zh' ? '刚刚' : 'just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return locale === 'zh' ? `${diffMin} 分钟前` : `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return locale === 'zh' ? `${diffHr} 小时前` : `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return locale === 'zh' ? `${diffDay} 天前` : `${diffDay}d ago`
  const diffMo = Math.floor(diffDay / 30)
  return locale === 'zh' ? `${diffMo} 个月前` : `${diffMo}mo ago`
}

/**
 * Extract the `MESHY_CARD: {...}` trailer that tool results carried before 0.4.0 and strip it
 * from the text. Returns `{ card: null, body }` when it is missing or malformed.
 */
export function parseMeshyCard(text: string): { card: MeshyCard | null; body: string } {
  if (!text) return { card: null, body: '' }
  const lines = text.split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim()
    if (!trimmed.startsWith(MESHY_CARD_PREFIX)) continue
    const jsonPart = trimmed.slice(MESHY_CARD_PREFIX.length).trim()
    if (!jsonPart.startsWith('{')) continue
    try {
      const value: unknown = JSON.parse(jsonPart)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const body = lines.filter((_, idx) => idx !== i).join('\n').trim()
        return { card: value as MeshyCard, body }
      }
    } catch {
      // Malformed trailer: keep looking.
    }
  }
  return { card: null, body: text.trim() }
}

/** The card of a settled tool result: `result.meta` first, the legacy trailer otherwise. */
export function cardOf(meta: unknown, text: string): { card: MeshyCard | null; body: string } {
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const value = meta as MeshyCard
    if (typeof value.tool === 'string' || typeof value.taskId === 'string' || typeof value.status === 'string') {
      return { card: value, body: parseMeshyCard(text).body }
    }
  }
  return parseMeshyCard(text)
}

export type PromptTarget = {
  taskId?: string | null
  resource?: string | null
  file?: string | null
  title?: string | null
  /** `export` only: the file format, as the task lists it; none lets the user name one. */
  format?: string | null
}

function targetRef(target: PromptTarget, locale: 'en' | 'zh'): string {
  if (target.file && target.taskId) return `${target.file} (${locale === 'zh' ? '任务' : 'task'} ${target.taskId})`
  if (target.file) return target.file
  if (target.taskId) return locale === 'zh' ? `任务 ${target.taskId}` : `task ${target.taskId}`
  if (target.title) return `"${target.title}"`
  return locale === 'zh' ? '当前模型' : 'this model'
}

/** A ready-to-edit prompt for a follow-up Meshy action on one asset. */
export function actionPrompt(kind: ActionKind, target: PromptTarget, locale: 'en' | 'zh' = 'en'): string {
  const ref = targetRef(target, locale)
  const zh = locale === 'zh'
  switch (kind) {
    case 'refine':
      return zh ? `给白模 ${ref} 生成 PBR 贴图（Refine）。` : `Refine the preview model ${ref} with PBR textures.`
    case 'retexture':
      return zh ? `给 ${ref} 重新生成贴图，风格：` : `Retexture ${ref} in this style: `
    case 'remesh':
      return zh ? `把 ${ref} 重拓扑成适合游戏的干净网格。` : `Remesh ${ref} to clean, game-ready topology.`
    case 'uvUnwrap':
      return zh ? `给 ${ref} 重新展开 UV，得到一个可以拿去外部贴图的白模。` : `Unwrap fresh UVs for ${ref}, as a white model ready for texturing elsewhere.`
    case 'rig':
      return zh ? `给 ${ref} 绑定骨骼并加一个走路动画。` : `Rig ${ref} and add a walking animation.`
    case 'animate':
      return zh ? `给绑好骨骼的 ${ref} 换一个动画：` : `Give the rigged ${ref} another animation: `
    case 'print':
      return zh ? `把 ${ref} 处理成可以直接 3D 打印的模型。` : `Prepare ${ref} for 3D printing.`
    case 'printCheck':
      return zh ? `检查 ${ref} 能不能直接 3D 打印。` : `Check whether ${ref} is ready to 3D print.`
    case 'printRepair':
      return zh ? `修复 ${ref} 的打印问题（破洞、非流形边等）。` : `Repair ${ref} for 3D printing (holes, non-manifold edges).`
    case 'multiColor':
      return zh ? `把 ${ref} 做成多色打印的 3MF，颜色数：` : `Make a multi-color 3MF of ${ref} for printing, with this many colors: `
    case 'splitParts':
      return zh ? `把 ${ref} 拆成可以分别打印的部件：` : `Split ${ref} into separately printable parts: `
    case 'resize':
      return zh ? `把 ${ref} 调整到实际尺寸，高度：` : `Resize ${ref} to real-world size, height: `
    case 'slicer':
      return zh ? `在我的切片软件里打开 ${ref}。` : `Open ${ref} in my slicer.`
    case 'imageTo3d':
      return zh ? `用图片 ${ref} 生成带贴图的 3D 模型。` : `Turn the image ${ref} into a textured 3D model.`
    case 'editImage':
      return zh ? `修改图片 ${ref}：` : `Edit the image ${ref}: `
    case 'export': {
      const format = target.format ? target.format.toUpperCase() : ''
      if (!format) return actionPrompt('convert', target, locale)
      return zh ? `把 ${ref} 导出为 ${format} 格式，保存到工作区。` : `Export ${ref} as ${format} into the workspace.`
    }
    case 'convert':
      return zh ? `把 ${ref} 转换为其他格式：` : `Convert ${ref} to `
    case 'useInSession': {
      const namePart = target.title ? (zh ? `「${target.title}」` : `"${target.title}" `) : ''
      const resPart = target.resource ? ` (${target.resource})` : ''
      return zh
        ? `继续处理我的 Meshy 模型 ${namePart}${ref}${resPart}：`
        : `Continue working with my Meshy model ${namePart}${ref}${resPart}: `
    }
  }
}

/** dsh's session composer contract (`inputActions`, a session-scoped standard prop). */
export type InputActions = {
  setDraft?(text: string): void
  captureInsertion?(): unknown
  insertText?(text: string, span: unknown): boolean
}

export type ComposerBridge = {
  inputActions?: InputActions | null
  draftEmpty?: boolean
  copy?: (text: string) => Promise<boolean> | boolean
}

/**
 * Put a prompt in the session composer: replace a draft known to be empty, otherwise insert it
 * at the caret (on a new line after existing text), so a draft is never overwritten. Without a
 * composer, copy it to the clipboard.
 */
export async function putInComposer(bridge: ComposerBridge, prompt: string): Promise<'composer' | 'copied' | 'none'> {
  const actions = bridge.inputActions
  if (actions) {
    try {
      if (bridge.draftEmpty === true && typeof actions.setDraft === 'function') {
        actions.setDraft(prompt)
        return 'composer'
      }
      if (typeof actions.captureInsertion === 'function' && typeof actions.insertText === 'function') {
        const text = bridge.draftEmpty === false ? `\n${prompt}` : prompt
        if (actions.insertText(text, actions.captureInsertion()) !== false) return 'composer'
      }
    } catch {
      // Fall back to the clipboard.
    }
  }
  if (bridge.copy) {
    try {
      if (await bridge.copy(prompt)) return 'copied'
    } catch {
      // Clipboard unavailable.
    }
  }
  return 'none'
}

/** Parse a preview tab's `dsh-resource://file/session/<id>/<path>` address. */
export function sessionFileOf(address: string): { sessionId: string; path: string } | undefined {
  const m = /^dsh-resource:\/\/file\/session\/([^/?#]+)\/([^?#]+)/.exec(address)
  if (!m) return undefined
  try {
    return { sessionId: decodeURIComponent(m[1]), path: m[2].split('/').map(decodeURIComponent).join('/') }
  } catch {
    return undefined
  }
}

/** The `dsh-resource://` address of a workspace-relative file in a session. */
export function fileAddress(sessionId: string, path: string): string {
  const rel = path.replace(/\\/g, '/').replace(/^\.\//, '')
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${rel.split('/').map(encodeURIComponent).join('/')}`
}

/** Format a workspace-relative path for compact display. */
export function displayPath(filePath: string, cwd?: string): string {
  const norm = filePath.replace(/\\/g, '/').trim()
  if (!norm) return ''
  let rel = norm
  if (cwd) {
    const normCwd = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
    if (normCwd && rel.startsWith(`${normCwd}/`)) rel = rel.slice(normCwd.length + 1)
  }
  return rel.replace(/^\.\//, '')
}

/** One thing the Studio shows: a task's output or a workspace model no task accounts for. */
export type Asset = {
  key: string
  kind: AssetKind
  phase: TaskPhase
  title: string
  resource: string | null
  taskId: string | null
  stage: 'preview' | 'refine' | null
  file: string | null
  thumbnail: string | null
  progress: number | null
  credits: number | null
  at: number
  formats: string[]
  parentTaskId: string | null
  error: string | null
  /** GLB variants of the task (a rigging task: `rigged`, `walking`, `running`). */
  variants: string[]
  /** Rigged or animated: the viewer offers animation playback. */
  animated: boolean
  /** Other tasks saved to the same file (files written before 0.4.0 could overwrite each other). */
  shared: boolean
}

/** The asset a Studio target names: by task (and file, for multi-image tasks), else by file. */
export function findAsset(
  assets: readonly Asset[],
  target: { taskId?: string | null; file?: string | null } | null | undefined,
): Asset | undefined {
  if (!target) return undefined
  const file = target.file ? displayPath(target.file) : null
  if (target.taskId) {
    const own = assets.filter((a) => a.taskId === target.taskId)
    return (file && own.find((a) => a.file && displayPath(a.file) === file)) || own[0]
  }
  return file ? assets.find((a) => a.file && displayPath(a.file) === file) : undefined
}

/** Resources whose output is a rigged or animated character. */
const ANIMATED_RESOURCES = new Set(['rigging', 'animate', 'animation'])
/** GLB variants that carry an animation clip. */
const ANIMATED_VARIANTS = new Set(['animation', 'walking', 'running'])
/** Workspace files that by their name hold a rig or an animation. */
const ANIMATED_FILE = /(?:^|[-_/])(rigged|walking|running|animation|animated|anim)(?:[-_.]|$)/i

/** A submit that never got a task id after this long is dead (its process ended). */
const DEAD_SUBMIT_MS = 15 * 60_000

const hiddenPath = (rel: string): boolean => rel.startsWith('.') || rel.includes('/.')

/**
 * The Studio's assets, running first, then newest first: task outputs (models and images;
 * analyses and print checks are left out) plus workspace `.glb` files no task saved. A
 * workspace can be shared by many sessions, so a file only counts as this session's when it
 * changed after the session's first Meshy task, or when it was opened explicitly (`include`);
 * files under hidden directories never count on their own.
 */
export function assetsOf(
  tasks: readonly TaskRow[],
  models: readonly ModelFile[],
  locale: 'en' | 'zh' = 'en',
  options: { include?: ReadonlySet<string>; now?: number } = {},
): Asset[] {
  const now = options.now ?? Date.now()
  const out: Asset[] = []
  const claimed = new Set<string>()
  const claims = new Map<string, number>()
  for (const row of tasks) {
    if (row.localFile) claims.set(displayPath(row.localFile), (claims.get(displayPath(row.localFile)) ?? 0) + 1)
  }
  const byTask = new Map(tasks.filter((r) => r.taskId).map((r) => [r.taskId as string, r]))
  let since = Infinity
  for (const row of tasks) {
    const kind = kindOf(row)
    if (!kind) continue
    const phase = phaseOf(row)
    const file = row.localFile ?? null
    if (row.stale && !file && phase !== 'done') continue
    if (!row.taskId && phase === 'active' && now - (row.startedAt ?? 0) > DEAD_SUBMIT_MS) continue
    // The API no longer knows the task (expired or never created): nothing to show.
    if (!row.status && row.readError && /\b404\b|not found/i.test(row.readError)) continue
    since = Math.min(since, row.startedAt || row.createdAt || Infinity)
    for (const f of [file, ...(row.files ?? [])]) if (f) claimed.add(displayPath(f))
    const stage = row.stage === 'preview' || row.type === 'text-to-3d-preview'
      ? 'preview'
      : row.stage === 'refine' || row.type === 'text-to-3d-refine' ? 'refine' : null
    // A rig or an animation shows its source model's picture and name until it has its own.
    const parent = row.parentTaskId ? byTask.get(row.parentTaskId) : undefined
    const derived = ANIMATED_RESOURCES.has((row.resource ?? '').toLowerCase())
    const ownTitle = row.title ?? row.name ?? row.prompt
    const title = !ownTitle && parent && derived
      ? `${titleOf(parent, 48, locale)} · ${resourceLabel(row.resource, locale)}`
      : titleOf(row, 64, locale)
    const variants = row.variants ?? []
    const base: Asset = {
      key: row.taskId ? `task:${row.taskId}` : `op:${row.id}`,
      kind,
      phase,
      title,
      resource: row.resource,
      taskId: row.taskId,
      stage,
      file,
      thumbnail: row.thumbnail ?? (derived ? parent?.thumbnail ?? null : null),
      progress: typeof row.progress === 'number' ? Math.max(0, Math.min(100, Math.round(row.progress))) : null,
      credits: typeof row.credits === 'number' ? row.credits : null,
      at: row.createdAt ?? row.startedAt ?? 0,
      formats: row.formats ?? [],
      parentTaskId: row.parentTaskId ?? null,
      error: row.error ?? row.submitError ?? null,
      shared: Boolean(file && (claims.get(displayPath(file)) ?? 0) > 1),
      variants,
      animated: derived || variants.some((v) => ANIMATED_VARIANTS.has(v)),
    }
    // An image task that saved several pictures shows each one; the first keeps the task's key.
    const images = kind === 'image' ? [...new Set([file, ...(row.files ?? [])].filter((f): f is string => Boolean(f)))] : []
    if (images.length > 1) {
      images.forEach((f, i) => {
        out.push({
          ...base,
          key: i === 0 ? base.key : `${base.key}#${i}`,
          file: f,
          title: i === 0 ? base.title : `${base.title} (${i + 1})`,
          thumbnail: i === 0 ? base.thumbnail : null,
          credits: i === 0 ? base.credits : null,
        })
      })
    } else {
      out.push(base)
    }
  }
  for (const m of models) {
    const rel = displayPath(m.file)
    if (claimed.has(rel)) continue
    const own = options.include?.has(rel) || (!hiddenPath(rel) && m.mtimeMs >= since - 60_000)
    if (!own) continue
    out.push({
      key: `file:${rel}`,
      kind: 'model',
      phase: 'done',
      title: baseName(rel) || rel,
      resource: null,
      taskId: null,
      stage: null,
      file: rel,
      thumbnail: null,
      progress: null,
      credits: null,
      at: m.mtimeMs,
      formats: [/\.3mf$/i.test(rel) ? '3mf' : 'glb'],
      parentTaskId: null,
      error: null,
      shared: false,
      variants: [],
      animated: ANIMATED_FILE.test(rel),
    })
  }
  const rank = (a: Asset) => (a.phase === 'active' ? 0 : 1)
  out.sort((a, b) => rank(a) - rank(b) || b.at - a.at)
  return out
}

// ---------------------------------------------------------------------------
// Meshy entries (the Studio's New menu, the /meshy command): requests for the agent
// ---------------------------------------------------------------------------
export type EntryId = 'imageTo3d' | 'textTo3d' | 'textToImage' | 'editImage' | 'creativeLab'
export type Entry = { id: EntryId; images?: { max: number } }

/** The Studio's four entries, in menu order. Image entries ask for images first. */
export const ENTRIES: readonly Entry[] = [
  { id: 'imageTo3d', images: { max: 4 } },
  { id: 'textTo3d' },
  { id: 'textToImage' },
  { id: 'editImage', images: { max: 5 } },
]

/**
 * The `/meshy` command's entries: the Studio's, plus Creative Lab (a photo made into a printable
 * keepsake), which the agent walks through product by product, so it has no place in the Studio.
 */
export const COMMAND_ENTRIES: readonly Entry[] = [...ENTRIES, { id: 'creativeLab', images: { max: 1 } }]

/** dsh's file mention for a workspace path: `@path`, quoted when the path has whitespace. */
export function mention(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`
}

/** The request an entry puts in the composer, with the saved images named first. */
export function entryPrompt(id: EntryId, files: readonly string[], locale: 'en' | 'zh'): string {
  const zh = locale === 'zh'
  const lead = files.length > 0 ? `${files.map(mention).join(' ')} ` : ''
  switch (id) {
    case 'imageTo3d':
      return lead + (files.length > 1
        ? (zh ? '用这几张图片生成 3D 模型，它们是同一个物体的不同角度。' : 'Make a 3D model from these images. They show the same object from different angles.')
        : (zh ? '用这张图片生成 3D 模型。' : 'Make a 3D model from this image.'))
    case 'textTo3d':
      return zh ? '生成一个 3D 模型：' : 'Make a 3D model of '
    case 'textToImage':
      return zh ? '生成一张图片：' : 'Make an image of '
    case 'editImage':
      return lead + (zh ? '修改这张图片：' : 'Edit this image: ')
    case 'creativeLab':
      return lead + (zh
        ? '用这张照片在 Meshy 创意工坊做一个可以打印的小物件：先列出可以做哪些，再问我选哪个。'
        : 'Make a printable keepsake from this photo with Meshy Creative Lab: list what it can make first, then ask me which one.')
  }
}

export type HandOffResult =
  | { status: 'composer' | 'copied' | 'none' | 'cancelled' }
  | { status: 'tooMany'; max: number }
  | { status: 'failed'; message: string }

/**
 * One entry, start to finish: pick and save its images (when it takes any), then put its request
 * in the composer. Nothing is sent: the user reads the request, adds to it, and sends it.
 */
export async function runEntry(
  entry: Entry,
  locale: 'en' | 'zh',
  io: {
    pick(multiple: boolean): Promise<File[]>
    save(file: File): Promise<string>
    put(text: string): Promise<'composer' | 'copied' | 'none'>
    onSaving?(): void
  },
): Promise<HandOffResult> {
  let files: string[] = []
  if (entry.images) {
    const picked = await io.pick(entry.images.max > 1)
    if (picked.length === 0) return { status: 'cancelled' }
    if (picked.length > entry.images.max) return { status: 'tooMany', max: entry.images.max }
    io.onSaving?.()
    try {
      files = await Promise.all(picked.map((f) => io.save(f)))
    } catch (err) {
      return { status: 'failed', message: String((err as Error)?.message ?? err) }
    }
  }
  return { status: await io.put(entryPrompt(entry.id, files, locale)) }
}
