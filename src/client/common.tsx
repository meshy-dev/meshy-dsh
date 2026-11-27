// Shared browser infrastructure: brand glyphs, the host API, GLB and workspace image loading,
// the lazy three.js viewer chunk, one SSE channel and one task snapshot per session, the
// Studio opener (dsh's `sidebarRight.openTab` with navigation params) and the stylesheet.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  fileAddress, phaseOf, putInComposer, sessionFileOf,
  type InputActions, type ModelFile, type TaskRow,
} from './workbench.ts'

/** The module loader's lazy chunk import (dsh-client-modules lazy-CJS model). */
declare const require: { async(path: string): Promise<typeof import('./viewer.ts')> }
/** The package icon as a data URL, inlined at build time. */
declare const __MESHY_ICON__: string
/** Meshy mono icon in currentColor (SVG markup), inlined at build time. */
declare const __MESHY_MONO__: string

export const GLB_ID = 'meshy-dsh/glb'
export const PAGE_ID = 'meshy'
export const TASKS_ID = 'meshy-dsh/tasks'
export const TASKS_KIND = 'meshy'
export const PACKAGE = 'meshy-dsh'
export const RELEASES = 'https://github.com/meshy-dev/meshy-dsh/releases/tag'
export const UPDATE_POLL_MS = 6 * 3600_000

/** Read workspace files in 2 MiB windows up to 256 MiB. */
export const WINDOW = 2 << 20
export const MAX_GLB = 256 << 20

export const SITES = {
  global: { web: 'https://www.meshy.ai', docs: 'https://docs.meshy.ai', host: 'meshy.ai' },
  cn: { web: 'https://meshy.cn', docs: 'https://docs.meshy.cn', host: 'meshy.cn' },
} as const
export type Site = keyof typeof SITES

const CN_ZONES = new Set(['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Urumqi', 'Asia/Kashgar', 'PRC'])

function guessSite(): Site {
  try {
    return CN_ZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone) ? 'cn' : 'global'
  } catch {
    return 'global'
  }
}

/** A tiny observable value for module-level state shared by components. */
function observable<V>(initial: V) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: V) {
      if (Object.is(next, value)) return
      value = next
      for (const notify of listeners) notify()
    },
    subscribe(notify: () => void) {
      listeners.add(notify)
      return () => { listeners.delete(notify) }
    },
  }
}

const site = observable<Site>(guessSite())
export const setSite = (next: Site): void => site.set(next)
export const useSite = (): Site => useSyncExternalStore(site.subscribe, site.get)

export function docsUrl(s: Site): string {
  return s === 'global' && /^zh/i.test(globalThis.navigator?.language ?? '') ? `${SITES.global.docs}/zh` : SITES[s].docs
}

// ---------------------------------------------------------------------------
// Plugin update status and sign-in revisions (Settings, Plugin page, sidebar mark)
// ---------------------------------------------------------------------------
export type PluginInfo = { version: string; update: string | null }
const plugin = observable<PluginInfo | undefined>(undefined)

export async function readPlugin(): Promise<void> {
  try {
    const { status, data } = await api('meshy.update')
    if (status === 200 && typeof data?.version === 'string') {
      plugin.set({ version: data.version, update: typeof data.update === 'string' ? data.update : null })
    }
  } catch {
    // No notice is the safe default.
  }
}
export const usePlugin = (): PluginInfo | undefined => useSyncExternalStore(plugin.subscribe, plugin.get)

const authRevision = observable(0)
export const notifyAuthChanged = (): void => authRevision.set(authRevision.get() + 1)
export const useAuthRevision = (): number => useSyncExternalStore(authRevision.subscribe, authRevision.get)

// ---------------------------------------------------------------------------
// Host services, set while the corresponding dsh services are mounted
// ---------------------------------------------------------------------------
type Result<V> =
  | { ok: true; value: V }
  | { ok: false; error: { code: string; message?: string; details?: { limit?: number } } }

export type WorkspaceFiles = {
  readBytes(
    sessionId: string,
    path: string,
    options: { range: { offset: number; length: number } },
    signal: AbortSignal,
  ): Promise<Result<{ data: Uint8Array; eof: boolean; bytes?: number; version: string }>>
}

type Snapshot<V> = { getSnapshot(): V; subscribe(listener: () => void): () => void }
export type SidebarRight = {
  mounted?: Snapshot<string | undefined>
  openTab(kind: string, options?: { params?: unknown; paneId?: string }): void
  openResource?(address: string, options?: { preferNewPane?: boolean; destination?: 'sidebar' | 'float' }): void
}

export type StudioTarget = { taskId?: string | null; resource?: string | null; file?: string | null }

let workspaceFilesRef: WorkspaceFiles | undefined
let startSessionRef: ((prompt: string) => void) | undefined
let openBundleRef: ((packageName: string) => void) | undefined
let sidebarRightRef: SidebarRight | undefined
let selectPanelRef: ((id: string) => void) | undefined

export const setWorkspaceFiles = (wf: WorkspaceFiles | undefined): void => { workspaceFilesRef = wf }
export const setStartSession = (fn: ((prompt: string) => void) | undefined): void => { startSessionRef = fn }
export const getStartSession = (): ((prompt: string) => void) | undefined => startSessionRef
export const setOpenBundle = (fn: ((packageName: string) => void) | undefined): void => { openBundleRef = fn }
export const getOpenBundle = (): ((packageName: string) => void) | undefined => openBundleRef
export const setSidebarRight = (s: SidebarRight | undefined): void => { sidebarRightRef = s }
export const setSelectPanel = (fn: ((id: string) => void) | undefined): void => { selectPanelRef = fn }

/** The Session the right sidebar currently shows. */
export const mountedSession = (): string | undefined => sidebarRightRef?.mounted?.getSnapshot()

/** Open the left-sidebar Meshy page. */
export function openMeshyPage(): void {
  try { selectPanelRef?.(PAGE_ID) } catch { /* the page is not registered */ }
}

/** The pane each chat's Studio tab sits in, as the tab reports it (dsh reuses a tab only within its pane). */
const studioPanes = new Map<string, { paneId: string; signal?: AbortSignal }>()

/** Record where a chat's Studio tab is, until the tab closes (its signal aborts). */
export function rememberStudioPane(sessionId: string | undefined, paneId: string | undefined, signal?: AbortSignal): void {
  if (!sessionId || !paneId || signal?.aborted) return
  const entry = { paneId, signal }
  studioPanes.set(sessionId, entry)
  signal?.addEventListener('abort', () => {
    if (studioPanes.get(sessionId) === entry) studioPanes.delete(sessionId)
  }, { once: true })
}

/**
 * Open (or reveal) the right-sidebar Meshy Studio for the mounted Session, optionally selecting
 * one asset through the tab's navigation params, without taking focus from the composer. A Studio
 * already open in another pane is revealed there rather than opened a second time.
 */
export function openStudio(sessionId: string | undefined, target?: StudioTarget | null): boolean {
  const sidebar = sidebarRightRef
  if (!sidebar) return false
  const mounted = sidebar.mounted?.getSnapshot()
  if (sessionId && mounted && mounted !== sessionId) return false
  const active = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
  const editable = Boolean(active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT'))
  const known = studioPanes.get(sessionId ?? mounted ?? '')
  const paneId = known && !known.signal?.aborted ? known.paneId : undefined
  const params = target ? { params: { target } } : {}
  try {
    sidebar.openTab(TASKS_KIND, paneId ? { ...params, paneId } : params)
  } catch {
    if (!paneId) return false
    try {
      sidebar.openTab(TASKS_KIND, params)
    } catch {
      return false
    }
  }
  if (editable && active && typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (document.activeElement !== active && active.isConnected) {
        try { active.focus({ preventScroll: true }) } catch { /* ignore */ }
      }
    })
  }
  return true
}

/** Open a workspace file in its own dsh document tab (images use dsh's image preview). */
export function openFileTab(sessionId: string, file: string, open?: SidebarRight['openResource']): boolean {
  const fn = open ?? sidebarRightRef?.openResource?.bind(sidebarRightRef)
  if (!fn) return false
  try {
    fn(fileAddress(sessionId, file), { preferNewPane: true })
    return true
  } catch {
    return false
  }
}

export function insertPrompt(
  prompt: string,
  composer: { inputActions?: InputActions | null; draftEmpty?: boolean },
): Promise<'composer' | 'copied' | 'none'> {
  return putInComposer({ inputActions: composer.inputActions, draftEmpty: composer.draftEmpty, copy: writeClipboard }, prompt)
}

// ---------------------------------------------------------------------------
// Host HTTP API and model/image loading
// ---------------------------------------------------------------------------
export async function api(path: string, body?: object): Promise<{ status: number; data: any }> {
  const res = await fetch(
    `api/${path}`,
    body === undefined
      ? { cache: 'no-store' }
      : { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  )
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

export class TooLarge extends Error {
  constructor(readonly size: number) {
    super('too large')
  }
}

/** Read a workspace file window by window through dsh's `workspaceFiles` Remote. */
export async function readWindows(
  address: string,
  signal: AbortSignal,
  progress?: (read: number, total: number) => void,
): Promise<{ data: Uint8Array; version: string }> {
  const file = sessionFileOf(address)
  if (!file || !workspaceFilesRef) throw new Error(`cannot read ${address}`)
  let chunks: Uint8Array[] = []
  let offset = 0
  let version: string | undefined
  let length = WINDOW
  for (;;) {
    const res = await workspaceFilesRef.readBytes(file.sessionId, file.path, { range: { offset, length } }, signal)
    signal.throwIfAborted()
    if (!res.ok) {
      const limit = res.error.details?.limit
      if (res.error.code === 'workspace-file/too-large' && limit && limit < length) {
        length = limit
        continue
      }
      throw new Error(res.error.message ?? res.error.code)
    }
    const w = res.value
    if (version !== undefined && w.version !== version) {
      chunks = []
      offset = 0
      version = undefined
      continue
    }
    version = w.version
    if ((w.bytes ?? 0) > MAX_GLB) throw new TooLarge(w.bytes!)
    chunks.push(w.data)
    offset += w.data.byteLength
    if (offset > MAX_GLB) throw new TooLarge(offset)
    progress?.(offset, w.bytes ?? offset)
    if (w.eof || w.data.byteLength === 0) break
  }
  const data = new Uint8Array(offset)
  let at = 0
  for (const c of chunks) {
    data.set(c, at)
    at += c.byteLength
  }
  return { data, version: version! }
}

export type ModelSource =
  | { kind: 'address'; address: string }
  | { kind: 'file'; sessionId: string; file: string }
  | { kind: 'task'; resource: string; taskId: string; variant?: string }

/** The last few remote models, so switching between them in the Studio does not download again. */
const remoteModels = new Map<string, Uint8Array>()
const REMOTE_MODELS_KEPT = 3

/** GLB bytes: workspace files through dsh's reader, remote tasks through `/api/meshy.model`. */
export async function fetchModelBytes(
  source: ModelSource,
  signal: AbortSignal,
  progress?: (read: number, total: number) => void,
): Promise<{ data: Uint8Array; version?: string }> {
  if (source.kind === 'address') return readWindows(source.address, signal, progress)
  if (source.kind === 'file' && workspaceFilesRef) {
    return readWindows(fileAddress(source.sessionId, source.file), signal, progress)
  }
  const cacheKey = source.kind === 'task' ? `${source.resource}:${source.taskId}:${source.variant ?? ''}` : null
  const cached = cacheKey ? remoteModels.get(cacheKey) : undefined
  if (cacheKey && cached) {
    remoteModels.delete(cacheKey)
    remoteModels.set(cacheKey, cached)
    return { data: cached }
  }
  const remember = (data: Uint8Array) => {
    if (!cacheKey) return
    remoteModels.set(cacheKey, data)
    while (remoteModels.size > REMOTE_MODELS_KEPT) remoteModels.delete(remoteModels.keys().next().value!)
  }
  const query = source.kind === 'file'
    ? `session=${encodeURIComponent(source.sessionId)}&file=${encodeURIComponent(source.file)}`
    : `resource=${encodeURIComponent(source.resource)}&task=${encodeURIComponent(source.taskId)}${source.variant ? `&variant=${encodeURIComponent(source.variant)}` : ''}`
  const res = await fetch(`api/meshy.model?${query}`, { cache: 'no-store', signal })
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error ?? `HTTP ${res.status}`)
  }
  const total = Number(res.headers.get('content-length') || '0')
  if (total > MAX_GLB) throw new TooLarge(total)
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_GLB) throw new TooLarge(buf.byteLength)
    remember(buf)
    return { data: buf }
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    signal.throwIfAborted()
    if (done) break
    received += value.byteLength
    if (received > MAX_GLB) {
      await reader.cancel().catch(() => {})
      throw new TooLarge(received)
    }
    chunks.push(value)
    // `total` stays 0 when the server sends no length, so the UI does not show a finished-looking count.
    progress?.(received, total)
  }
  const data = new Uint8Array(received)
  let at = 0
  for (const chunk of chunks) {
    data.set(chunk, at)
    at += chunk.byteLength
  }
  remember(data)
  return { data }
}

const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/** An object URL for a workspace image (durable), falling back to a remote URL while it loads or fails. */
export function useWorkspaceImage(sessionId: string | undefined, file: string | null | undefined, fallback?: string | null): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    setUrl(undefined)
    if (!sessionId || !file || !workspaceFilesRef) return
    const abort = new AbortController()
    let objectUrl: string | undefined
    const ext = (file.split('.').pop() ?? '').toLowerCase()
    readWindows(fileAddress(sessionId, file), abort.signal)
      .then(({ data }) => {
        if (abort.signal.aborted) return
        objectUrl = URL.createObjectURL(new Blob([data as BlobPart], { type: IMAGE_TYPES[ext] ?? 'image/png' }))
        setUrl(objectUrl)
      })
      .catch(() => {})
    return () => {
      abort.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sessionId, file])
  return url ?? fallback ?? undefined
}

let viewerModule: Promise<typeof import('./viewer.ts')> | undefined
/** Load the self-contained three.js viewer chunk once. */
export function loadViewer(): Promise<typeof import('./viewer.ts')> {
  return (viewerModule ??= require.async('./client.viewer.js').catch((err) => {
    viewerModule = undefined
    throw err
  }))
}

// ---------------------------------------------------------------------------
// One SSE channel and one task snapshot per session
// ---------------------------------------------------------------------------
export type TaskEventPayload = {
  type: 'task'
  callId: string | null
  jobId?: string | null
  resource: string
  stage?: string | null
  kind?: string | null
  taskId: string | null
  status: string
  progress: number | null
  thumbnail: string | null
  name: string | null
  title?: string | null
  localFile: string | null
  files?: string[] | null
  credits: number | null
  error: string | null
}
type ModelEventPayload = { type: 'model'; file: string; resource: string | null; taskId: string | null }
type AssetEventPayload = { type: 'asset'; taskId: string; resource: string; kind: string; file: string | null; files?: string[]; title?: string | null }
type OpenEventPayload = { type: 'open'; target: StudioTarget | null }
export type MeshyEvent = TaskEventPayload | ModelEventPayload | AssetEventPayload | OpenEventPayload

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'CANCELLED', 'EXPIRED'])

type SessionData = { tasks: TaskRow[]; models: ModelFile[]; loaded: boolean; loading: boolean; failed?: boolean }

type Channel = {
  sessionId: string
  es: EventSource | null
  listeners: Set<(event: MeshyEvent) => void>
  holders: number
  live: Map<string, TaskEventPayload>
  data: SessionData
  dataListeners: Set<() => void>
  fetching: Promise<void> | null
  poll: ReturnType<typeof setInterval> | null
  reconnect: ReturnType<typeof setTimeout> | null
  close: ReturnType<typeof setTimeout> | null
  backoff: number
  opened: boolean
}

const channels = new Map<string, Channel>()

function emitData(ch: Channel, patch: Partial<SessionData>): void {
  ch.data = { ...ch.data, ...patch }
  for (const fn of ch.dataListeners) fn()
}

function mergeLive(rows: TaskRow[], ev: TaskEventPayload): TaskRow[] {
  // A task's own row first; a call's row only while one of the two has no task id yet (a `make`
  // runs several tasks in one call, each with its own row).
  let idx = ev.taskId ? rows.findIndex((r) => r.taskId === ev.taskId) : -1
  if (idx < 0 && ev.callId) idx = rows.findIndex((r) => r.callId === ev.callId && (!ev.taskId || !r.taskId))
  const patch: Partial<TaskRow> = {
    taskId: ev.taskId,
    status: ev.status,
    progress: ev.progress,
    stale: false,
  }
  // A row keeps the call that submitted it; a later `wait` on the task is found through `live`.
  if (idx < 0 || !rows[idx].callId) {
    patch.callId = ev.callId
    patch.jobId = ev.jobId ?? undefined
  }
  if (ev.resource) patch.resource = ev.resource
  if (ev.kind) patch.kind = ev.kind
  if (ev.stage) patch.stage = ev.stage
  if (ev.thumbnail) patch.thumbnail = ev.thumbnail
  if (ev.title ?? ev.name) patch.title = ev.title ?? ev.name
  if (ev.localFile) patch.localFile = ev.localFile
  if (ev.files?.length) patch.files = ev.files
  if (typeof ev.credits === 'number') patch.credits = ev.credits
  if (ev.error) patch.error = ev.error
  if (idx >= 0) {
    const next = [...rows]
    next[idx] = { ...rows[idx], ...patch }
    return next
  }
  return [{ id: ev.taskId || ev.callId || `live-${Date.now()}`, startedAt: Date.now(), createdAt: Date.now(), ...patch } as TaskRow, ...rows]
}

function refreshData(ch: Channel): Promise<void> {
  ch.fetching ??= (async () => {
    emitData(ch, { loading: true })
    try {
      const { status, data } = await api(`meshy.tasks?session=${encodeURIComponent(ch.sessionId)}`)
      if (status === 200 && data) {
        let tasks: TaskRow[] = Array.isArray(data.tasks) ? data.tasks : []
        // Live events newer than the snapshot win until the snapshot catches up.
        for (const ev of ch.live.values()) {
          const row = tasks.find((r) => r.taskId === ev.taskId)
          if (!row || (phaseOf(row) === 'active' && TERMINAL.has(ev.status.toUpperCase()))) tasks = mergeLive(tasks, ev)
        }
        emitData(ch, { tasks, models: Array.isArray(data.models) ? data.models : [], loaded: true, failed: false })
      } else {
        emitData(ch, { loaded: true, failed: true })
      }
    } catch {
      // Keep the last snapshot; `failed` lets an empty view offer a retry instead of loading forever.
      emitData(ch, { loaded: true, failed: true })
    } finally {
      emitData(ch, { loading: false })
      ch.fetching = null
      schedulePoll(ch)
    }
  })()
  return ch.fetching
}

function schedulePoll(ch: Channel): void {
  const running = ch.data.tasks.some((r) => phaseOf(r) === 'active')
  if (running && !ch.poll && ch.holders > 0) {
    ch.poll = setInterval(() => { void refreshData(ch) }, 5000)
  } else if ((!running || ch.holders === 0) && ch.poll) {
    clearInterval(ch.poll)
    ch.poll = null
  }
}

function connect(ch: Channel): void {
  if (typeof EventSource === 'undefined' || ch.es) return
  const es = new EventSource(`api/meshy.events?session=${encodeURIComponent(ch.sessionId)}`)
  ch.es = es
  es.onopen = () => { ch.backoff = 2000 }
  es.onmessage = (msg) => {
    let event: MeshyEvent
    try {
      event = JSON.parse(msg.data) as MeshyEvent
    } catch {
      return
    }
    if (!event || typeof event !== 'object') return
    if (event.type === 'task') {
      const key = event.taskId ?? event.callId
      if (key) ch.live.set(key, event)
      if (event.callId) ch.live.set(`call:${event.callId}`, event)
      emitData(ch, { tasks: mergeLive(ch.data.tasks, event) })
      schedulePoll(ch)
      if (TERMINAL.has(event.status.toUpperCase())) void refreshData(ch)
      if (!ch.opened) {
        ch.opened = true
        openStudio(ch.sessionId, event.taskId ? { taskId: event.taskId, resource: event.resource } : null)
      }
    } else if (event.type === 'model' || event.type === 'asset') {
      void refreshData(ch)
    } else if (event.type === 'open') {
      ch.opened = true
      openStudio(ch.sessionId, event.target)
    }
    for (const listener of ch.listeners) {
      try { listener(event) } catch { /* isolate listener errors */ }
    }
  }
  es.onerror = () => {
    if (es.readyState !== EventSource.CLOSED) return
    ch.es = null
    if (ch.holders === 0) return
    const delay = ch.backoff
    ch.backoff = Math.min(ch.backoff * 2, 15_000)
    ch.reconnect = setTimeout(() => {
      ch.reconnect = null
      if (ch.holders > 0) connect(ch)
    }, delay)
  }
}

function hold(sessionId: string): () => void {
  let ch = channels.get(sessionId)
  if (!ch) {
    ch = {
      sessionId, es: null, listeners: new Set(), holders: 0, live: new Map(),
      data: { tasks: [], models: [], loaded: false, loading: false }, dataListeners: new Set(),
      fetching: null, poll: null, reconnect: null, close: null, backoff: 2000, opened: false,
    }
    channels.set(sessionId, ch)
  }
  const channel = ch
  channel.holders++
  if (channel.close) {
    clearTimeout(channel.close)
    channel.close = null
  }
  connect(channel)
  return () => {
    channel.holders--
    if (channel.holders > 0) return
    schedulePoll(channel)
    channel.close = setTimeout(() => {
      channel.close = null
      if (channel.holders > 0) return
      if (channel.reconnect) clearTimeout(channel.reconnect)
      channel.reconnect = null
      channel.es?.close()
      channel.es = null
    }, 5000)
  }
}

/** Subscribe to this session's Meshy events (one EventSource per session). */
export function onSessionEvents(sessionId: string | undefined, listener: (event: MeshyEvent) => void): () => void {
  if (!sessionId) return () => {}
  const release = hold(sessionId)
  const ch = channels.get(sessionId)!
  ch.listeners.add(listener)
  return () => {
    ch.listeners.delete(listener)
    release()
  }
}

const EMPTY_DATA: SessionData = { tasks: [], models: [], loaded: false, loading: false }

/** The session's Meshy tasks and workspace models, kept live by SSE and polled while running. */
export function useSessionData(sessionId: string | undefined): SessionData & { refresh(): void } {
  useEffect(() => {
    if (!sessionId) return
    const release = hold(sessionId)
    const ch = channels.get(sessionId)!
    if (!ch.data.loaded && !ch.fetching) void refreshData(ch)
    else schedulePoll(ch)
    return release
  }, [sessionId])
  const data = useSyncExternalStore(
    (notify) => {
      const ch = sessionId ? channels.get(sessionId) : undefined
      if (!ch) return () => {}
      ch.dataListeners.add(notify)
      return () => { ch.dataListeners.delete(notify) }
    },
    () => (sessionId ? channels.get(sessionId)?.data : undefined) ?? EMPTY_DATA,
  )
  return {
    ...data,
    refresh: () => {
      const ch = sessionId ? channels.get(sessionId) : undefined
      if (ch) void refreshData(ch)
    },
  }
}

/** The latest state of one task (by call id or task id) from live events and the snapshot. */
export function useTask(sessionId: string | undefined, callId?: string | null, taskId?: string | null): TaskRow | undefined {
  const { tasks } = useSessionData(sessionId)
  // The task a call is running now (a `wait` on an older task, or a `make`'s latest step).
  const running = !taskId && callId && sessionId ? channels.get(sessionId)?.live.get(`call:${callId}`)?.taskId : null
  const id = taskId || running
  return (id ? tasks.find((r) => r.taskId === id) : undefined) ?? tasks.find((r) => Boolean(callId) && r.callId === callId)
}

/** Whether any Meshy task in this session is still running. */
// ---------------------------------------------------------------------------
// Viewer snapshots: a still of each model the stage has shown, for tiles that have no thumbnail
// (saved files, rigging results). Kept per browser, newest 40.
// ---------------------------------------------------------------------------
const SNAPSHOT_STORE = 'meshy-dsh:snapshots'
const SNAPSHOTS_KEPT = 40
let snapshots: Map<string, string> | undefined
const snapshotListeners = new Set<() => void>()

function snapshotMap(): Map<string, string> {
  if (snapshots) return snapshots
  snapshots = new Map()
  try {
    const saved = JSON.parse(localStorage.getItem(SNAPSHOT_STORE) ?? '[]') as [string, string][]
    for (const [key, url] of saved) if (typeof key === 'string' && typeof url === 'string') snapshots.set(key, url)
  } catch {
    // No storage (private window, blocked site data): snapshots last for this page only.
  }
  return snapshots
}

/** Snapshot key of a model: its task when it has one, else its workspace file. */
export function snapshotKey(ref: { resource?: string | null; taskId?: string | null; sessionId?: string; file?: string | null }): string | undefined {
  if (ref.taskId && ref.resource) return `task:${ref.resource}:${ref.taskId}`
  if (ref.file && ref.sessionId) return `file:${ref.sessionId}:${ref.file}`
  return undefined
}

export function saveSnapshot(keys: (string | undefined)[], url: string): void {
  const map = snapshotMap()
  for (const key of keys) {
    if (!key) continue
    map.delete(key)
    map.set(key, url)
  }
  while (map.size > SNAPSHOTS_KEPT) map.delete(map.keys().next().value!)
  try {
    localStorage.setItem(SNAPSHOT_STORE, JSON.stringify([...map]))
  } catch {
    // Quota or blocked storage: keep the in-memory copy.
  }
  for (const fn of snapshotListeners) fn()
}

/** The stored still for the first key that has one. */
export function useSnapshot(...keys: (string | undefined)[]): string | undefined {
  const [, bump] = useState(0)
  useEffect(() => {
    const listener = () => bump((n) => n + 1)
    snapshotListeners.add(listener)
    return () => { snapshotListeners.delete(listener) }
  }, [])
  const map = snapshotMap()
  for (const key of keys) if (key && map.has(key)) return map.get(key)
  return undefined
}

export function useHasActiveTask(sessionId: string | undefined): boolean {
  const { tasks } = useSessionData(sessionId)
  return tasks.some((r) => phaseOf(r) === 'active')
}

// ---------------------------------------------------------------------------
// Brand glyphs
// ---------------------------------------------------------------------------
export function Logo({ size }: { size?: number }) {
  return <img className="meshy-logo" src={__MESHY_ICON__} alt="" style={size ? { width: size, height: size } : undefined} />
}

export function MeshyGlyph({ size = 14 }: { size?: number }) {
  return (
    <span
      className="meshy-glyph"
      aria-hidden="true"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: __MESHY_MONO__ }}
    />
  )
}

/** Left-sidebar entry icon, with a dot when a newer plugin release is out. */
export function MeshyIcon({ size = 16 }: { size?: number; active?: boolean }) {
  const update = usePlugin()?.update
  return (
    <span className="meshy-mark" aria-hidden="true" style={{ width: size, height: size }}>
      <MeshyGlyph size={size} />
      {update && <span className="meshy-badge" />}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Stylesheet: dsh theme tokens throughout; Meshy lime only on one primary action per surface
// ---------------------------------------------------------------------------
const CSS = `
.meshy-root{--meshy-accent:#beef54;--meshy-accent-hover:#b1ed30;--meshy-accent-label:#111;--meshy-stage-a:#f4f4f5;--meshy-stage-b:#e4e4e7;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:20px}
body[data-ds-dark-theme] .meshy-root{--meshy-accent:#c5f955;--meshy-accent-hover:#a8e328;--meshy-stage-a:#2a2b2e;--meshy-stage-b:#151618}
.meshy-muted{color:var(--dsw-alias-label-tertiary)}
.meshy-secondary{color:var(--dsw-alias-label-secondary)}
.meshy-small{font-size:12px;line-height:18px}
.meshy-xs{font-size:11px;line-height:16px}
.meshy-ellipsis{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meshy-root .meshy-accent{border-color:transparent;background:var(--meshy-accent);color:var(--meshy-accent-label)}
.meshy-root .meshy-accent:hover:not(:disabled){background:var(--meshy-accent-hover)}
.meshy-logo{width:32px;height:32px;flex:none;border-radius:9px}
.meshy-mark{position:relative;display:inline-flex;flex:none}
.meshy-glyph{display:inline-flex;align-items:center;justify-content:center;flex:none}
.meshy-glyph svg{width:100%;height:100%;display:block}
.meshy-badge{position:absolute;top:-2px;right:-3px;width:7px;height:7px;border-radius:50%;background:#beef54;box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base)}
.meshy-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}
.meshy-dot[data-on]{background:var(--dsw-alias-state-success-primary)}
.meshy-dot[data-warn]{background:var(--dsw-alias-state-warn-primary)}
.meshy-dot[data-err]{background:var(--dsw-alias-state-error-primary)}
.meshy-inline{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.meshy-meta{display:flex;flex-wrap:wrap;align-items:center;column-gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden}
.meshy-meta>*+*::before{content:"·";margin-right:6px}
.meshy-meta>*{white-space:nowrap}
.meshy-progress{display:block;width:100%;height:3px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);overflow:hidden}
.meshy-progress>span{display:block;height:100%;border-radius:inherit;background:var(--dsw-alias-label-primary);transition:width .3s ease}
.meshy-progress[data-indeterminate]>span{width:30%!important;animation:meshy-slide 1.2s ease-in-out infinite}
@keyframes meshy-slide{0%{transform:translateX(-100%)}100%{transform:translateX(340%)}}
.meshy-skeleton{display:block;border-radius:6px;background:var(--dsw-alias-bg-skeleton,rgba(128,128,128,.15));animation:meshy-pulse 1.4s ease-in-out infinite}
@keyframes meshy-pulse{50%{opacity:.45}}

/* Settings -> Meshy and the account card */
.meshy-section{display:flex;flex-direction:column;gap:16px;padding:8px 0}
.meshy-card{border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-xl,12px);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-module-platform));padding:12px 16px}
.meshy-head,.meshy-row{display:flex;justify-content:space-between;align-items:center;gap:16px}
.meshy-identity{display:flex;align-items:center;gap:10px;min-width:0;min-height:44px}
.meshy-copy{display:flex;flex-direction:column;min-width:0}
.meshy-name{font-size:14px;font-weight:500}
.meshy-pill{display:inline-flex;align-items:center;gap:6px;flex:none;white-space:nowrap}
.meshy-rows{display:flex;flex-direction:column;gap:8px}
.meshy-row{box-sizing:border-box;min-height:40px;padding:6px 0}
.meshy-divider{border-top:.5px solid var(--dsw-alias-border-l2)}
.meshy-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px}
.meshy-amount{display:inline-flex;align-items:center;gap:8px;font-size:18px;font-weight:510;line-height:28px}
.meshy-account{display:flex;flex-direction:column;align-items:flex-end;min-width:0;text-align:right;overflow-wrap:anywhere}
.meshy-coin{width:12px;height:12px;border-radius:50%;flex:none;background:linear-gradient(135deg,#f9e855,#e99430)}
.meshy-link{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;text-decoration:none;white-space:nowrap}
.meshy-link-sm{height:28px;padding:0 10px;font-size:12px}
.meshy-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-link:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.meshy-signin{display:flex;align-items:center;gap:20px}
.meshy-qr{flex:none;width:136px;height:136px;padding:10px;border-radius:var(--dsw-radius-lg,10px);background:#fff;border:.5px solid var(--dsw-alias-border-l2);image-rendering:pixelated}
.meshy-signin .meshy-copy{gap:10px}
.meshy-code{display:inline-flex;align-items:center;gap:6px}
.meshy-code code{font-family:var(--ds-font-family-code,monospace);font-size:15px;letter-spacing:.08em;padding:2px 8px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-module-platform)}
.meshy-waiting{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary)}
.meshy-alert{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-lg,10px);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
.meshy-alert svg{flex:none;margin-top:2px;color:var(--dsw-alias-state-warn-primary)}
.meshy-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px}
.meshy-update{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 16px}
.meshy-update .meshy-copy{flex:1 1 280px}

/* 3D viewer */
.meshy-viewer{position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:200px;overflow:hidden;background:radial-gradient(120% 90% at 50% 35%,var(--meshy-stage-a) 0%,var(--meshy-stage-b) 100%)}
.meshy-vtools-slot{flex:none;min-height:40px;border-bottom:.5px solid var(--dsw-alias-border-l2);background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.meshy-vtools{display:flex;flex-wrap:wrap;align-items:center;gap:2px;min-height:40px;padding:0 6px}
.meshy-vtools-group{display:inline-flex;align-items:center;gap:2px}
.meshy-vtools-end{margin-left:auto}
.meshy-vtools-div{flex:none;width:1px;height:14px;margin:0 4px;border-radius:1px;background:var(--dsw-alias-border-l2)}
.meshy-root .meshy-tool[aria-pressed=true],.meshy-root .meshy-tool[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-active,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary)}
body[data-ds-dark-theme] .meshy-root .meshy-tool[aria-pressed=true]{color:var(--meshy-accent)}
.meshy-canvas{position:relative;flex:1 1 auto;min-height:0}
.meshy-stage{position:absolute;inset:0}
.meshy-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:16px;text-align:center;color:var(--dsw-alias-label-secondary)}
.meshy-overlay .meshy-logo{width:28px;height:28px;opacity:.9;animation:meshy-pulse 1.4s ease-in-out infinite}
.meshy-viewer-progress{width:min(200px,60%)}
.meshy-chan{appearance:none;position:relative;display:inline-flex;align-items:center;justify-content:center;gap:2px;min-width:28px;height:28px;margin:0;padding:3px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.meshy-chan:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-chan img,.meshy-chan-blank{display:block;width:20px;height:20px;border-radius:5px;object-fit:cover;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform)}
.meshy-chan img{box-shadow:0 0 0 .5px var(--dsw-alias-border-l2)}
.meshy-chan[aria-pressed=true] img,.meshy-chan[aria-pressed=true] .meshy-chan-blank{box-shadow:0 0 0 1.5px var(--dsw-alias-label-primary)}
body[data-ds-dark-theme] .meshy-root .meshy-chan[aria-pressed=true] img{box-shadow:0 0 0 1.5px var(--meshy-accent)}
.meshy-chan:focus-visible,.meshy-pick:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:-2px}
.meshy-chan-pick{padding:3px 4px 3px 3px}
.meshy-chan-icon img,.meshy-chan-icon .meshy-chan-blank{display:block;width:16px;height:16px;border-radius:4px;object-fit:cover}
.meshy-stats{position:absolute;left:8px;top:8px;display:grid;grid-template-columns:auto auto;gap:0 12px;margin:0;padding:6px 10px;border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 72%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);font-size:11px;line-height:16px;pointer-events:none}
.meshy-stats dt{color:var(--dsw-alias-label-secondary)}
.meshy-stats dd{margin:0;text-align:right;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.meshy-anim{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;width:min(400px,calc(100% - 16px));padding:2px 4px 2px 2px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 84%,transparent);border:.5px solid var(--dsw-alias-border-l2);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 4px 12px rgba(0,0,0,.12)}
.meshy-anim-name{display:block;max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.meshy-anim-solo{padding:0 4px;color:var(--dsw-alias-label-secondary)}
.meshy-anim-time{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.meshy-anim-speed{font-size:12px;font-variant-numeric:tabular-nums}
.meshy-anim-scrub{flex:1 1 auto;margin:0 4px}
.meshy-pick{appearance:none;display:inline-flex;align-items:center;gap:2px;height:28px;margin:0;padding:0 6px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.meshy-pick:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-pick>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.meshy-slider{position:relative;min-width:48px;height:20px;cursor:pointer;touch-action:none;outline:none;--meshy-slider-on:var(--dsw-alias-label-primary)}
body[data-ds-dark-theme] .meshy-root .meshy-slider{--meshy-slider-on:var(--meshy-accent)}
.meshy-slider-track{position:absolute;left:0;right:0;top:50%;height:4px;margin-top:-2px;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);overflow:hidden}
.meshy-slider-fill{position:absolute;left:0;top:0;bottom:0;width:var(--meshy-pct);background:var(--meshy-slider-on)}
.meshy-slider-thumb{position:absolute;top:50%;left:var(--meshy-pct);width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:#fff;box-shadow:0 0 0 1.5px var(--meshy-slider-on),0 1px 3px rgba(0,0,0,.25)}
.meshy-slider:focus-visible .meshy-slider-thumb{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:2px}
.meshy-pop{display:flex;flex-direction:column;width:248px;padding:2px 0}
.meshy-pop-head{padding:6px 10px 4px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.meshy-pop-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:34px;padding:0 10px;font-size:13px}
.meshy-pop-slider{display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 8px;padding:6px 10px;font-size:13px}
.meshy-pop-slider .meshy-slider{grid-column:1/-1}
.meshy-pop-value{font-size:12px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.meshy-pop-foot{display:flex;justify-content:flex-end;margin-top:4px;padding:4px 6px 2px;border-top:.5px solid var(--dsw-alias-border-l2)}
.meshy-err{color:var(--dsw-alias-state-error-primary)}

/* Right-sidebar Studio */
.meshy-studio{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;container-type:inline-size}
.meshy-studio-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 8px 8px 12px}
.meshy-studio-head [role=tablist]{width:min(240px,100%)}
.meshy-studio-head [role=tab]{white-space:nowrap}
.meshy-studio-stage{position:relative;flex:1 1 60%;min-height:180px;margin:0 8px;border-radius:var(--dsw-radius-lg,10px);overflow:hidden;background:radial-gradient(120% 90% at 50% 35%,var(--meshy-stage-a) 0%,var(--meshy-stage-b) 100%)}
.meshy-studio-stage .meshy-viewer{position:absolute;inset:0;background:none}
.meshy-image{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:12px;border:0;margin:0;background:none;cursor:zoom-in}
.meshy-image img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.meshy-pending{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center}
.meshy-pending img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(18px) saturate(.8);opacity:.35}
.meshy-pending>*{position:relative}
.meshy-pending .meshy-progress{width:min(220px,70%)}
.meshy-studio-info{flex:none;display:flex;flex-direction:column;gap:2px;padding:10px 12px 8px}
.meshy-studio-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;line-height:20px;font-weight:500}
.meshy-studio-toolbar{position:absolute;left:50%;bottom:10px;z-index:2;transform:translateX(-50%);display:flex;align-items:center;gap:2px;max-width:calc(100% - 16px);padding:4px;border-radius:12px;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-bg-base) 88%,transparent);border:.5px solid var(--dsw-alias-border-l2);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 4px 12px rgba(0,0,0,.12)}
.meshy-studio-toolbar .meshy-accent{margin-right:2px}
.meshy-toolbar-divider{flex:none;width:1px;height:16px;margin:0 4px;background:var(--dsw-alias-border-l2)}
.meshy-tool-menu{gap:2px}
.meshy-studio-stage:has(.meshy-studio-toolbar) .meshy-anim{bottom:58px}
.meshy-note{flex:none;margin:0 12px 8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.meshy-gallery{flex:0 1 auto;max-height:34%;min-height:76px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:6px;align-content:start;padding:10px 8px 12px;border-top:.5px solid var(--dsw-alias-border-l2)}
.meshy-tile{appearance:none;position:relative;display:block;aspect-ratio:1;width:100%;margin:0;padding:0;border:0;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);cursor:pointer}
.meshy-tile img{width:100%;height:100%;object-fit:cover;display:block}
.meshy-tile>.meshy-glyph{position:absolute;inset:0;margin:auto;opacity:.55}
.meshy-tile-name{position:absolute;left:4px;right:4px;bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:13px;text-align:center;color:var(--dsw-alias-label-secondary)}
.meshy-tile:has(.meshy-tile-name)>.meshy-glyph{bottom:12px}
.meshy-tile::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);pointer-events:none}
.meshy-tile:hover::after{box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l3)}
.meshy-tile[aria-current=true]::after{box-shadow:inset 0 0 0 2px var(--dsw-alias-label-primary)}
.meshy-tile:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:1px}
.meshy-tile-state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,transparent);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:500;font-variant-numeric:tabular-nums}
.meshy-tile-state[data-err]{color:var(--dsw-alias-state-error-primary)}
.meshy-tile-badge{position:absolute;right:4px;top:4px;display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent);color:var(--dsw-alias-label-primary)}
.meshy-tile .meshy-progress{position:absolute;left:6px;right:6px;bottom:6px;width:auto}
.meshy-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;padding:24px;text-align:center}
.meshy-empty .meshy-glyph{color:var(--dsw-alias-label-tertiary);margin-bottom:4px}
.meshy-tab-title{display:inline-flex;align-items:center;gap:6px}
@container (max-width:300px){.meshy-studio-head [role=tablist]{width:100%}}

/* Chat tool cards */
.meshy-tool{container-type:inline-size;margin:2px 0}
.meshy-tool-card{display:flex;gap:12px;padding:10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-base);max-width:560px}
.meshy-tool-thumb{appearance:none;position:relative;flex:none;width:76px;height:76px;padding:0;margin:0;border:0;border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;justify-content:center}
.meshy-tool-thumb[data-clickable]{cursor:pointer}
.meshy-tool-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.meshy-tool-thumb::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}
.meshy-tool-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.meshy-tool-title{font-weight:500;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.meshy-tool-status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.meshy-tool-status .meshy-progress{flex:1;max-width:160px}
.meshy-tool-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:5px}
.meshy-tool-actions .meshy-spacer{flex:1}
.meshy-tool-pre{margin:0;padding:8px 10px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-module-platform);font-family:var(--ds-font-family-code,monospace);font-size:11.5px;line-height:17px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;color:var(--dsw-alias-label-secondary)}
.meshy-summary{display:inline-flex;align-items:center;gap:6px;min-width:0;margin-left:8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.meshy-tool-list{display:flex;flex-direction:column;gap:2px;margin-bottom:6px}
.meshy-tool-list-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px;padding:0 4px;border-radius:var(--dsw-radius-sm,6px);font-size:12px}
.meshy-tool-list-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
@container (max-width:380px){.meshy-tool-card{gap:10px;padding:8px}.meshy-tool-thumb{width:56px;height:56px}}
@container (max-width:280px){.meshy-tool-card{flex-direction:column}.meshy-tool-thumb{width:100%;height:auto;aspect-ratio:16/9}}

/* Left-sidebar Meshy page */
.meshy-page{box-sizing:border-box;height:100%;overflow-y:auto;container-type:inline-size}
.meshy-page-inner{box-sizing:border-box;max-width:880px;margin:0 auto;padding:40px 32px 48px;display:flex;flex-direction:column;gap:36px}
.meshy-hero{display:flex;align-items:center;gap:14px}
.meshy-hero .meshy-logo{width:44px;height:44px;border-radius:12px}
.meshy-hero h1{margin:0;font-size:22px;font-weight:600;line-height:30px}
.meshy-h2{margin:0;font-size:15px;font-weight:500;line-height:22px}
.meshy-block{display:flex;flex-direction:column;gap:14px}
.meshy-block-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.meshy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
/* The page's four example prompts: four across when there is room, else two by two (never three and an orphan) */
@container (min-width:760px){.meshy-page .meshy-grid{grid-template-columns:repeat(4,1fr)}}
@container (max-width:759px){.meshy-page .meshy-grid{grid-template-columns:repeat(2,1fr)}}
@container (max-width:420px){.meshy-page .meshy-grid{grid-template-columns:1fr}}
.meshy-lib-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(156px,1fr));gap:16px 12px}
.meshy-lib-item{display:flex;flex-direction:column;gap:8px;min-width:0}
.meshy-lib-thumb{appearance:none;position:relative;display:block;width:100%;aspect-ratio:1;margin:0;padding:0;border:0;border-radius:var(--dsw-radius-lg,10px);overflow:hidden;background:radial-gradient(120% 90% at 50% 35%,var(--meshy-stage-a) 0%,var(--meshy-stage-b) 100%);color:var(--dsw-alias-label-tertiary);cursor:pointer}
.meshy-lib-thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s ease}
.meshy-lib-thumb:hover img{transform:scale(1.03)}
.meshy-lib-thumb>.meshy-glyph{position:absolute;inset:0;margin:auto}
.meshy-lib-thumb::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);pointer-events:none}
.meshy-lib-thumb:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:2px}
.meshy-lib-state{position:absolute;left:8px;top:8px;display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 86%,transparent);font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.meshy-lib-text{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;min-width:0}
.meshy-lib-title{font-size:13px;font-weight:500;line-height:18px}
[role=dialog].meshy-modal{width:min(760px,calc(100vw - 48px));max-width:none}
.meshy-modal-viewer{position:relative;width:100%;height:min(480px,60vh);border-radius:var(--dsw-radius-lg,10px);overflow:hidden}
.meshy-example{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:4px;width:100%;margin:0;padding:12px 14px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg,10px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;transition:background-color .15s}
.meshy-example:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-example:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color);outline-offset:2px}
.meshy-example-title{font-weight:500}
.meshy-links{display:flex;gap:16px}
.meshy-textlink{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);text-decoration:none}
.meshy-textlink:hover{color:var(--dsw-alias-label-primary)}
@container (max-width:520px){.meshy-page-inner{padding:24px 16px 32px;gap:28px}.meshy-lib-grid{grid-template-columns:repeat(auto-fill,minmax(128px,1fr))}}
@media (prefers-reduced-motion:reduce){.meshy-root *,.meshy-root *::before,.meshy-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}.meshy-lib-thumb:hover img{transform:none}}
`

export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  const id = 'meshy-dsh/client.css'
  let tag = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (!tag) {
    tag = document.createElement('style')
    tag.dataset.plugin = 'meshy-dsh'
    tag.dataset.pluginCss = id
    document.head.append(tag)
  }
  if (tag.textContent !== CSS) tag.textContent = CSS
}

ensureStyles()
