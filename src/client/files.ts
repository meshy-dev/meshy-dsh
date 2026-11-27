// Reading session workspace files from the browser, and calling the host's /api/meshy.* routes.
// Shared by the GLB preview, Meshy Studio and the tool cards.

// dsh's workspace file Remote: a call never rejects, the result carries the failure.
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message?: string; details?: { limit?: number } } }
export type WorkspaceFiles = {
  readBytes(sessionId: string, path: string, options: { range: { offset: number; length: number } }, signal: AbortSignal):
    Promise<Result<{ data: Uint8Array; eof: boolean; bytes?: number; version: string }>>
}

/**
 * dsh refuses a complete-file read above 32 MiB (`maxFileBytes`), so the preview reads 2 MiB
 * windows (`maxBytes`, the per-window cap) and stops at its own limit instead.
 */
export const WINDOW = 2 << 20
export const MAX_GLB = 256 << 20

let workspaceFiles: WorkspaceFiles | undefined
export function setWorkspaceFiles(next: WorkspaceFiles | undefined) { workspaceFiles = next }
export function hasWorkspaceFiles() { return workspaceFiles !== undefined }

export class TooLarge extends Error {
  constructor(readonly size: number) { super('too large') }
}

/** A preview tab's `dsh-resource://file/session/<id>/<path>` address (dsh-util-workspace-path's grammar). */
export function sessionFileOf(address: string) {
  const m = /^dsh-resource:\/\/file\/session\/([^/?#]+)\/([^?#]+)/.exec(address)
  return m ? { sessionId: decodeURIComponent(m[1]), path: m[2].split('/').map(decodeURIComponent).join('/') } : undefined
}

/** The address of a workspace file of a session, each segment encoded. */
export function fileAddress(sessionId: string, path: string) {
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${path.split('/').map(encodeURIComponent).join('/')}`
}

/** Read a whole session file window by window; a change mid-read starts over on the new version. */
export async function readFile(sessionId: string, path: string, signal: AbortSignal, progress?: (read: number, total: number) => void, max = MAX_GLB) {
  if (!workspaceFiles) throw new Error(`cannot read ${path}`)
  let chunks: Uint8Array[] = []
  let offset = 0
  let version: string | undefined
  let length = WINDOW
  for (;;) {
    const res = await workspaceFiles.readBytes(sessionId, path, { range: { offset, length } }, signal)
    signal.throwIfAborted()
    if (!res.ok) {
      // A host configured with smaller windows names its cap.
      const limit = res.error.details?.limit
      if (res.error.code === 'workspace-file/too-large' && limit && limit < length) { length = limit; continue }
      throw new Error(res.error.message ?? res.error.code)
    }
    const w = res.value
    if (version !== undefined && w.version !== version) { chunks = []; offset = 0; version = undefined; continue }
    version = w.version
    if ((w.bytes ?? 0) > max) throw new TooLarge(w.bytes!)
    chunks.push(w.data)
    offset += w.data.byteLength
    if (offset > max) throw new TooLarge(offset)
    progress?.(offset, w.bytes ?? offset)
    if (w.eof || w.data.byteLength === 0) break
  }
  const data = new Uint8Array(offset)
  let at = 0
  for (const c of chunks) { data.set(c, at); at += c.byteLength }
  return { data, version: version! }
}

/** The version of a session file, read with the smallest window; undefined when it cannot be read. */
export async function versionOf(sessionId: string, path: string, signal: AbortSignal) {
  const res = await workspaceFiles?.readBytes(sessionId, path, { range: { offset: 0, length: 1 } }, signal)
  return res?.ok ? res.value.version : undefined
}

export async function api(path: string, body?: object): Promise<{ status: number; data: any }> {
  const res = await fetch(`api/${path}`, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
