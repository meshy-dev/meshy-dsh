// The composer handoff's host route: an image the user picks from a Meshy entry (the Studio's New
// menu, the /meshy command, the Meshy page) is saved as picked under `meshy_input/` in the chat's
// workspace, so the message the composer gets can name it and the agent can hand that path to the
// Meshy CLI. Nothing is generated or sent anywhere here.
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Where picked images are kept in the workspace. */
export const UPLOAD_DIR = 'meshy_input'
/** The largest image saved. */
export const MAX_INPUT = 20 << 20

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/** The image type the bytes call for: `png`, `jpg` or `webp`, else null. */
export function sniffImage(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}

/** A file name stem from the picked file's name: ASCII letters, digits, `-` and `_`, else `image`. */
export function uploadStem(name) {
  const stem = String(name ?? '').split(/[\\/]/).pop().replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return stem || 'image'
}

const exists = (path) => access(path).then(() => true, () => false)

/** Save one image under `meshy_input/`, never over an existing file; resolves to its workspace path. */
export async function saveInput(workspace, bytes, name) {
  const ext = sniffImage(bytes)
  if (!ext) throw Object.assign(new Error('the file is not a PNG, JPEG or WebP image'), { statusCode: 400 })
  const dir = join(workspace, UPLOAD_DIR)
  await mkdir(dir, { recursive: true })
  const stem = uploadStem(name)
  for (let i = 1; i < 1000; i++) {
    const file = `${i === 1 ? stem : `${stem}-${i}`}.${ext}`
    if (await exists(join(dir, file))) continue
    try {
      await writeFile(join(dir, file), bytes, { flag: 'wx', mode: 0o644 })
    } catch (err) {
      if (err?.code === 'EEXIST') continue
      throw err
    }
    return `${UPLOAD_DIR}/${file}`
  }
  throw new Error('too many images with this name')
}

/**
 * `POST /api/meshy.input?session=<id>&name=<file name>` with the image's bytes as the body.
 * `workspaceOf` resolves a session id to its workspace (null when unknown).
 */
export function createInputRoute({ workspaceOf }) {
  return async function handleInput(request) {
    const url = new URL(request.url)
    const sessionId = url.searchParams.get('session') ?? ''
    if (!sessionId) return json({ error: 'session is required' }, 400)
    const declared = Number(request.headers.get('content-length') ?? 0)
    if (declared > MAX_INPUT) return json({ error: `the image is over ${MAX_INPUT >> 20} MB` }, 413)
    const workspace = await workspaceOf(sessionId)
    if (!workspace) return json({ error: 'session workspace not found' }, 404)
    let bytes
    try {
      bytes = Buffer.from(await request.arrayBuffer())
    } catch {
      return json({ error: 'could not read the image' }, 400)
    }
    if (bytes.length === 0) return json({ error: 'an image is required' }, 400)
    if (bytes.length > MAX_INPUT) return json({ error: `the image is over ${MAX_INPUT >> 20} MB` }, 413)
    try {
      return json({ file: await saveInput(workspace, bytes, url.searchParams.get('name')) })
    } catch (err) {
      return json({ error: String(err?.message ?? err) }, err?.statusCode ?? 500)
    }
  }
}
