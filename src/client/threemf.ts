// 3MF for the viewer, read the way Meshy's web viewer reads it (three's 3MF loader): the build
// items with their transforms, objects and components (production `p:path` parts included),
// `basematerials` colours per triangle, `colorgroup` colours per vertex, triangles as given with
// flat shading, and Z up turned to Y up. Textured 3MFs (`texture2dgroup`) show their geometry
// only. On top of that, the per-triangle filament painting that Bambu Studio and Orca Slicer write
// (`paint_color`; PrusaSlicer's `slic3rpe:mmu_segmentation`), which a Meshy multi-color 3MF is:
// each painted triangle is split as the slicer splits it and drawn in its filament's colour, with
// the colours from the project settings. No DOM: the XML is scanned directly, so a model of a
// million triangles stays fast and the module runs in Node for tests.
import {
  BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, SRGBColorSpace,
} from 'three'
import { strFromU8, unzipSync } from 'three/examples/jsm/libs/fflate.module.js'

/** A zip archive (a 3MF is one) starts with a local file header. */
export function isZip(data: Uint8Array): boolean {
  return data.byteLength > 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04
}

const ROOT_MODEL = '3D/3dmodel.model'
const MODEL_REL = /\/3dmodel$/
/** What triangles carry no colour of their own in a file that has colours (the web viewer's default). */
const WHITE: readonly [number, number, number] = [1, 1, 1]
/** A filament the project settings do not list. */
const UNKNOWN_FILAMENT = '#808080'
/** The most triangles a painted file is split into for drawing (see `parseThreeMf`). */
const SPLIT_BUDGET = 1_500_000
/** The most nodes (build items and components) drawn; a file that nests more is cut there. */
const NODE_BUDGET = 20_000
/** The most model and settings data read out of the archive (unzipped). */
const MAX_UNZIPPED = 768 << 20
/** Distinct stand-ins when a painted file carries no filament colours at all. */
const STAND_IN_FILAMENTS = ['#F2F2F2', '#E53935', '#1E88E5', '#43A047', '#FDD835', '#8E24AA', '#FB8C00', '#00ACC1']

type RGB = readonly [number, number, number]
type Component = { path: string; objectId: string; transform: Matrix4 | null }
type MeshData = {
  positions: Float32Array
  /** v1 v2 v3 per triangle. */
  triangles: Uint32Array
  /** Per triangle: index into `pids`, or -1 for the object's own. */
  pid: Int32Array | null
  pids: string[]
  /** Per triangle and corner: a property index, or -1. */
  p: Int32Array | null
  /** Per triangle: the slicer's paint string, when it has one. */
  paint: (string | undefined)[] | null
  /** Per triangle: the paint state covering most of it (-1: none or malformed), once summarized. */
  dominant?: Int16Array
}
type ObjectData = { id: string; name: string | null; pid: string | null; pindex: number; mesh: MeshData | null; components: Component[] }
type Part = {
  objects: Map<string, ObjectData>
  basematerials: Map<string, RGB[]>
  colorgroups: Map<string, RGB[]>
  build: Component[]
}

/** What the viewer needs from a parsed 3MF: `triangles` counts the file's own, once per placement. */
export type ThreeMf = { scene: Group; colored: boolean; triangles: number }

// ---------------------------------------------------------------------------
// XML scanning
// ---------------------------------------------------------------------------
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function unescape(value: string): string {
  if (!value.includes('&')) return value
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e] ?? m
  })
}

/**
 * One attribute of a tag's attribute text (the hot path: a vertex or a triangle, read without
 * building an object), or undefined. `key` is the attribute's full name, prefix included.
 */
function attr(tag: string, key: string): string | undefined {
  let i = 0
  for (;;) {
    const k = tag.indexOf(key, i)
    if (k < 0) return undefined
    let e = k + key.length
    while (e < tag.length && tag.charCodeAt(e) <= 32) e++
    if ((k === 0 || tag.charCodeAt(k - 1) <= 32) && tag.charCodeAt(e) === 61 /* = */) {
      let q = e + 1
      while (q < tag.length && tag.charCodeAt(q) <= 32) q++
      const quote = tag[q]
      if (quote !== '"' && quote !== "'") return undefined
      const close = tag.indexOf(quote, q + 1)
      return close < 0 ? undefined : tag.slice(q + 1, close)
    }
    i = k + 1
  }
}

/** The attributes of one tag (`from` just after its name, `to` at its `>` or `/>`). */
function attributes(xml: string, from: number, to: number): Record<string, string> {
  const out: Record<string, string> = {}
  let i = from
  while (i < to) {
    const eq = xml.indexOf('=', i)
    if (eq < 0 || eq >= to) break
    const name = xml.slice(i, eq).trim()
    let q = eq + 1
    while (q < to && xml.charCodeAt(q) <= 32) q++
    const quote = xml[q]
    if (quote !== '"' && quote !== "'") break
    const close = xml.indexOf(quote, q + 1)
    if (close < 0) break
    out[name] = xml.slice(q + 1, close)
    i = close + 1
  }
  return out
}

/**
 * Call `open(name, attrs, empty)` for every start tag and `close(name)` for every end tag (an
 * empty element calls both), with namespace prefixes dropped from element names. Attribute
 * names keep their prefix. Declarations, comments, CDATA and processing instructions are skipped.
 */
function scan(xml: string, open: (name: string, xmlRef: string, from: number, to: number, empty: boolean) => void, close: (name: string) => void) {
  let i = 0
  // The next quote of each kind at or after a position, kept so a file without one is not searched
  // to its end at every tag.
  let dq = -2
  let sq = -2
  const quoteFrom = (j: number) => {
    if (dq !== -1 && dq < j) dq = xml.indexOf('"', j)
    if (sq !== -1 && sq < j) sq = xml.indexOf("'", j)
    return dq < 0 ? sq : sq < 0 ? dq : Math.min(dq, sq)
  }
  for (;;) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) return
    const next = xml.charCodeAt(lt + 1)
    if (next === 33 /* ! */) {
      const [opener, closer] = xml.startsWith('<!--', lt) ? ['<!--', '-->'] : xml.startsWith('<![CDATA[', lt) ? ['<![CDATA[', ']]>'] : ['<!', '>']
      const end = xml.indexOf(closer, lt + opener.length)
      if (end < 0) return
      i = end + closer.length
      continue
    }
    if (next === 63 /* ? */) {
      const end = xml.indexOf('?>', lt)
      if (end < 0) return
      i = end + 2
      continue
    }
    // The tag ends at the first `>` outside a quoted value.
    let j = lt + 1
    let gt = -1
    for (;;) {
      const g = xml.indexOf('>', j)
      if (g < 0) return
      const q = quoteFrom(j)
      if (q < 0 || q > g) {
        gt = g
        break
      }
      const end = xml.indexOf(xml[q], q + 1)
      if (end < 0) return
      j = end + 1
    }
    const closing = next === 47 /* / */
    let n = closing ? lt + 2 : lt + 1
    const start = n
    while (n < gt) {
      const c = xml.charCodeAt(n)
      if (c <= 32 || c === 47 || c === 62) break
      n++
    }
    const qualified = xml.slice(start, n)
    const colon = qualified.indexOf(':')
    const name = colon >= 0 ? qualified.slice(colon + 1) : qualified
    if (closing) {
      close(name)
    } else {
      const empty = xml.charCodeAt(gt - 1) === 47
      open(name, xml, n, empty ? gt - 1 : gt, empty)
      if (empty) close(name)
    }
    i = gt + 1
  }
}

// ---------------------------------------------------------------------------
// Model parts
// ---------------------------------------------------------------------------
/** The 3MF transform "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" (row vectors). */
export function parseTransform(value: string | undefined): Matrix4 | null {
  if (!value) return null
  const t = value.trim().split(/\s+/).map(Number)
  if (t.length !== 12 || t.some((v) => !Number.isFinite(v))) return null
  return new Matrix4().set(
    t[0], t[3], t[6], t[9],
    t[1], t[4], t[7], t[10],
    t[2], t[5], t[8], t[11],
    0, 0, 0, 1,
  )
}

/** An sRGB `#RRGGBB` or `#RRGGBBAA` colour in the renderer's working (linear) space. */
function rgb(value: string | undefined, fallback: RGB = WHITE): RGB {
  const hex = /^#?([0-9a-f]{6})/i.exec(value?.trim() ?? '')
  if (!hex) return fallback
  const c = new Color().setStyle(`#${hex[1]}`, SRGBColorSpace)
  return [c.r, c.g, c.b]
}

class Floats {
  data = new Float32Array(1024)
  length = 0
  push3(a: number, b: number, c: number) {
    if (this.length + 3 > this.data.length) {
      const next = new Float32Array(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    this.data[this.length++] = a
    this.data[this.length++] = b
    this.data[this.length++] = c
  }
  done(): Float32Array {
    return this.data.slice(0, this.length)
  }
}

class Ints {
  data: Int32Array | Uint32Array
  length = 0
  constructor(signed: boolean) {
    this.data = signed ? new Int32Array(1024) : new Uint32Array(1024)
  }
  push(v: number) {
    if (this.length + 1 > this.data.length) {
      const next = new (this.data.constructor as Int32ArrayConstructor)(this.data.length * 2)
      next.set(this.data)
      this.data = next
    }
    this.data[this.length++] = v
  }
}

const intOr = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

/** A coordinate as written; a missing or unreadable one is 0. */
const coordinate = (value: string | undefined) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/^\/+/, '')

/** One model part: its objects, materials and (in the root part) build items. */
function parsePart(xml: string, ownPath: string): Part {
  const part: Part = { objects: new Map(), basematerials: new Map(), colorgroups: new Map(), build: [] }
  let object: ObjectData | null = null
  let vertices: Floats | null = null
  let tris: Ints | null = null
  let triPid: Ints | null = null
  let props: Ints | null = null
  let paint: (string | undefined)[] | null = null
  let pids: string[] = []
  let anyPid = false
  let anyProp = false
  let anyPaint = false
  let base: RGB[] | null = null
  let group: RGB[] | null = null
  let inBuild = false

  scan(xml, (name, src, from, to) => {
    switch (name) {
      case 'vertex': {
        if (!vertices) return
        const tag = src.slice(from, to)
        vertices.push3(coordinate(attr(tag, 'x')), coordinate(attr(tag, 'y')), coordinate(attr(tag, 'z')))
        return
      }
      case 'triangle': {
        if (!tris) return
        const tag = src.slice(from, to)
        // A missing or negative index wraps past every vertex, so the triangle is skipped when drawn.
        tris.push(intOr(attr(tag, 'v1'), -1))
        tris.push(intOr(attr(tag, 'v2'), -1))
        tris.push(intOr(attr(tag, 'v3'), -1))
        const pid = attr(tag, 'pid')
        let slot = -1
        if (pid !== undefined) {
          slot = pids.indexOf(pid)
          if (slot < 0) slot = pids.push(pid) - 1
          anyPid = true
        }
        triPid!.push(slot)
        const p1 = intOr(attr(tag, 'p1'), -1)
        if (p1 >= 0) {
          anyProp = true
          props!.push(p1)
          props!.push(intOr(attr(tag, 'p2'), -1))
          props!.push(intOr(attr(tag, 'p3'), -1))
        } else {
          props!.push(-1)
          props!.push(-1)
          props!.push(-1)
        }
        const painted = attr(tag, 'paint_color') ?? attr(tag, 'slic3rpe:mmu_segmentation')
        if (painted) anyPaint = true
        paint!.push(painted || undefined)
        return
      }
      case 'object': {
        const a = attributes(src, from, to)
        object = { id: a.id ?? '', name: a.name ? unescape(a.name) : null, pid: a.pid ?? null, pindex: intOr(a.pindex, 0), mesh: null, components: [] }
        part.objects.set(object.id, object)
        return
      }
      case 'mesh':
        vertices = new Floats()
        tris = new Ints(false)
        triPid = new Ints(true)
        props = new Ints(true)
        paint = []
        pids = []
        anyPid = anyProp = anyPaint = false
        return
      case 'component': {
        if (!object) return
        const a = attributes(src, from, to)
        const path = a['p:path'] ?? Object.entries(a).find(([k]) => k.endsWith(':path'))?.[1]
        object.components.push({ path: path ? normalizePath(unescape(path)) : ownPath, objectId: a.objectid ?? '', transform: parseTransform(a.transform) })
        return
      }
      case 'basematerials':
        base = []
        part.basematerials.set(attributes(src, from, to).id ?? '', base)
        return
      case 'base':
        base?.push(rgb(attributes(src, from, to).displaycolor))
        return
      case 'colorgroup':
        group = []
        part.colorgroups.set(attributes(src, from, to).id ?? '', group)
        return
      case 'color':
        group?.push(rgb(attributes(src, from, to).color))
        return
      case 'build':
        inBuild = true
        return
      case 'item': {
        if (!inBuild) return
        const a = attributes(src, from, to)
        const path = a['p:path'] ?? Object.entries(a).find(([k]) => k.endsWith(':path'))?.[1]
        part.build.push({ path: path ? normalizePath(unescape(path)) : ownPath, objectId: a.objectid ?? '', transform: parseTransform(a.transform) })
        return
      }
      default:
    }
  }, (name) => {
    switch (name) {
      case 'mesh':
        if (object && vertices && tris) {
          object.mesh = {
            positions: vertices.done(),
            triangles: (tris.data as Uint32Array).slice(0, tris.length),
            pid: anyPid ? (triPid!.data as Int32Array).slice(0, triPid!.length) : null,
            pids,
            p: anyProp ? (props!.data as Int32Array).slice(0, props!.length) : null,
            paint: anyPaint ? paint : null,
          }
        }
        vertices = tris = triPid = props = null
        paint = null
        return
      case 'object':
        object = null
        return
      case 'basematerials':
        base = null
        return
      case 'colorgroup':
        group = null
        return
      case 'build':
        inBuild = false
        return
      default:
    }
  })
  return part
}

// ---------------------------------------------------------------------------
// Slicer painting (TriangleSelector serialization)
// ---------------------------------------------------------------------------
type Emit = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, state: number) => void

/** The slicer's hex as nibbles in reading order (from its last character), or null if malformed. */
function paintNibbles(paint: string): Uint8Array | null {
  const n = paint.length
  const nibbles = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    // Upper-case hex only: the slicer drops a triangle written any other way.
    const c = paint.charCodeAt(n - 1 - i)
    const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : -1
    if (v < 0) return null
    nibbles[i] = v
  }
  return n > 0 ? nibbles : null
}

/** Each child's share of its parent's area, by the number of split sides (children at midpoints). */
const CHILD_AREAS: Record<number, readonly number[]> = { 1: [0.5, 0.5], 2: [0.25, 0.25, 0.5], 3: [0.25, 0.25, 0.25, 0.25] }

/**
 * How one painted triangle splits, without its geometry: how many triangles it splits into, and
 * the paint state covering most of its area. Null for a malformed string.
 */
export function paintSummary(paint: string): { leaves: number; dominant: number } | null {
  const nibbles = paintNibbles(paint)
  if (!nibbles) return null
  const area: number[] = []
  let leaves = 0
  let at = 0
  const next = () => (at < nibbles.length ? nibbles[at++] : -1)
  const node = (weight: number, depth: number): boolean => {
    if (depth > 64) return false
    const code = next()
    if (code < 0) return false
    const sides = code & 3
    if (sides === 0) {
      let state = code >> 2
      if (state === 3) {
        let n = next()
        let runs = 0
        while (n === 15) {
          runs++
          n = next()
        }
        if (n < 0) return false
        state = n + 15 * runs + 3
      }
      leaves++
      area[state] = (area[state] ?? 0) + weight
      return true
    }
    const special = code >> 2
    if (special > 2 || (sides === 3 && special !== 0)) return false
    const shares = CHILD_AREAS[sides]
    for (let i = shares.length - 1; i >= 0; i--) if (!node(weight * shares[i], depth + 1)) return false
    return true
  }
  if (!node(1, 0)) return null
  let dominant = 0
  let best = -1
  for (let state = 0; state < area.length; state++) {
    const share = area[state]
    if (share !== undefined && share > best) {
      best = share
      dominant = state
    }
  }
  return { leaves, dominant }
}

/**
 * Split one painted triangle as the slicer does and report each leaf with its paint state (0:
 * unpainted, n: filament n). The string is the slicer's hex, read from its last character; each
 * node is a nibble: split sides in the low two bits, and in the high two either the special side
 * (a split node) or the state (a leaf; `11` means the state continues in the next nibbles).
 * Children are read last first. Returns false (nothing emitted) for a malformed string.
 */
export function decodePaint(paint: string, a: readonly number[], b: readonly number[], c: readonly number[], emit: Emit): boolean {
  const nibbles = paintNibbles(paint)
  if (!nibbles) return false
  // Fast path: an unsplit triangle in one filament.
  if (nibbles.length <= 2) {
    const code = nibbles[0]
    if ((code & 3) === 0) {
      if ((code & 12) !== 12) {
        emit(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], code >> 2)
        return true
      }
      if (nibbles.length === 2 && nibbles[1] !== 15) {
        emit(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], nibbles[1] + 3)
        return true
      }
    }
  }
  const leaves: number[] = []
  let at = 0
  const next = () => (at < nibbles.length ? nibbles[at++] : -1)
  const mid = (p: readonly number[], q: readonly number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]
  const node = (v0: readonly number[], v1: readonly number[], v2: readonly number[], depth: number): boolean => {
    if (depth > 64) return false
    const code = next()
    if (code < 0) return false
    const sides = code & 3
    if (sides === 0) {
      let state = code >> 2
      if (state === 3) {
        let n = next()
        let runs = 0
        while (n === 15) {
          runs++
          n = next()
        }
        if (n < 0) return false
        state = n + 15 * runs + 3
      }
      leaves.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2], state)
      return true
    }
    const special = code >> 2
    if (special > 2 || (sides === 3 && special !== 0)) return false
    // The corners, starting at the special side.
    const corners = [v0, v1, v2]
    const p = corners[special]
    const q = corners[(special + 1) % 3]
    const r = corners[(special + 2) % 3]
    let children: (readonly number[])[][]
    if (sides === 1) {
      const m = mid(r, q)
      children = [[p, q, m], [m, r, p]]
    } else if (sides === 2) {
      const pq = mid(q, p)
      const pr = mid(p, r)
      children = [[p, pq, pr], [pq, q, pr], [q, r, pr]]
    } else {
      const pq = mid(q, p)
      const qr = mid(r, q)
      const rp = mid(p, r)
      children = [[p, pq, rp], [pq, q, qr], [qr, r, rp], [pq, qr, rp]]
    }
    for (let i = children.length - 1; i >= 0; i--) {
      const [x, y, z] = children[i]
      if (!node(x, y, z, depth + 1)) return false
    }
    return true
  }
  if (!node(a, b, c, 0)) return false
  for (let i = 0; i < leaves.length; i += 10) {
    emit(leaves[i], leaves[i + 1], leaves[i + 2], leaves[i + 3], leaves[i + 4], leaves[i + 5], leaves[i + 6], leaves[i + 7], leaves[i + 8], leaves[i + 9])
  }
  return true
}

/**
 * The slicer's model settings: which filament each object and part prints with, and the parts
 * that are not printed solid (negative volumes, modifiers, support blockers and enforcers), which
 * the slicer shows apart from the print and which are left out here.
 */
type Settings = { objectExtruder: Map<string, number>; partExtruder: Map<string, Map<string, number>>; hiddenParts: Map<string, Set<string>> }
/** The slicer project's filament colours, with the model settings. */
type Painting = Settings & { filaments: RGB[] }

function readSettings(files: Record<string, Uint8Array>): Settings {
  const objectExtruder = new Map<string, number>()
  const partExtruder = new Map<string, Map<string, number>>()
  const hiddenParts = new Map<string, Set<string>>()
  const settings = files['Metadata/model_settings.config'] ?? files['Metadata/Slic3r_PE_model.config']
  if (settings) {
    const xml = strFromU8(settings)
    for (const block of xml.matchAll(/<object\s+id="([^"]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/object>)/g)) {
      const [, id, body] = block
      if (!body) continue
      const parts = new Map<string, number>()
      const hidden = new Set<string>()
      const outside = body.replace(/<(part|volume)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/g, (whole) => {
        const open = /<(?:part|volume)\b[^>]*>/.exec(whole)?.[0] ?? ''
        const pid = /\bid="([^"]+)"/.exec(open)?.[1]
        const subtype = /\bsubtype="([^"]+)"/.exec(open)?.[1]
        const ext = /key="extruder"\s+value="(\d+)"/.exec(whole)?.[1]
        if (pid && ext) parts.set(pid, Number(ext))
        if (pid && subtype && subtype !== 'normal_part') hidden.add(pid)
        return ''
      })
      const ext = /key="extruder"\s+value="(\d+)"/.exec(outside)?.[1]
      if (ext) objectExtruder.set(id, Number(ext))
      if (parts.size) partExtruder.set(id, parts)
      if (hidden.size) hiddenParts.set(id, hidden)
    }
  }
  return { objectExtruder, partExtruder, hiddenParts }
}

function readPainting(files: Record<string, Uint8Array>, settings: Settings): Painting {
  const filaments: RGB[] = []
  const project = files['Metadata/project_settings.config']
  if (project) {
    try {
      const settings = JSON.parse(strFromU8(project)) as { filament_colour?: unknown }
      if (Array.isArray(settings.filament_colour)) {
        for (const c of settings.filament_colour) filaments.push(rgb(typeof c === 'string' ? c : undefined, rgb(UNKNOWN_FILAMENT)))
      }
    } catch {
      // Not JSON: no colours.
    }
  }
  const prusa = files['Metadata/Slic3r_PE.config']
  if (!filaments.length && prusa) {
    const text = strFromU8(prusa)
    const list = (key: string) => (new RegExp(`^; ${key} = (.*)$`, 'm').exec(text)?.[1] ?? '').split(';').map((s) => s.trim().replace(/^"|"$/g, ''))
    const extruders = list('extruder_colour')
    const colours = list('filament_colour')
    const n = Math.max(extruders.length, colours.length)
    for (let i = 0; i < n; i++) filaments.push(rgb(extruders[i] || colours[i] || UNKNOWN_FILAMENT, rgb(UNKNOWN_FILAMENT)))
  }
  if (!filaments.length) for (const c of STAND_IN_FILAMENTS) filaments.push(rgb(c))
  return { ...settings, filaments }
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
/** The colour one triangle corner takes from basematerials or a colorgroup, or null for none. */
function propertyColor(part: Part, pid: string | null, index: number): RGB | null {
  if (pid === null || index < 0) return null
  const list = part.basematerials.get(pid) ?? part.colorgroups.get(pid)
  return list?.[index] ?? null
}

type Built = { geometry: BufferGeometry; colored: boolean; triangles: number; source: number }

/**
 * One object's mesh as flat-shaded triangles: painted in filament colours when the file is
 * painted (`extruder`: the filament of unpainted triangles), else coloured from its properties.
 */
function buildMesh(part: Part, object: ObjectData, painting: Painting | null, extruder: number, split: boolean): Built {
  const mesh = object.mesh!
  const { positions, triangles } = mesh
  const count = Math.floor(triangles.length / 3)
  const vertexCount = positions.length / 3
  // A triangle naming a vertex the mesh does not have is left out (the slicer refuses the file).
  const valid = (t: number) => triangles[t * 3] < vertexCount && triangles[t * 3 + 1] < vertexCount && triangles[t * 3 + 2] < vertexCount
  let source = 0
  const out = new Floats()
  const colors = new Floats()
  let colored = false
  const corner = (i: number) => {
    const v = triangles[i] * 3
    return [positions[v], positions[v + 1], positions[v + 2]]
  }
  // A state past the project's filaments is unpainted, as the slicer reads it.
  const filaments = painting?.filaments ?? []
  const filament = (state: number): RGB => {
    const n = state === 0 || state > filaments.length ? extruder : state
    return filaments[n - 1] ?? rgb(UNKNOWN_FILAMENT)
  }
  const pushTriangle = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c1: RGB, c2: RGB, c3: RGB) => {
    out.push3(ax, ay, az)
    out.push3(bx, by, bz)
    out.push3(cx, cy, cz)
    colors.push3(c1[0], c1[1], c1[2])
    colors.push3(c2[0], c2[1], c2[2])
    colors.push3(c3[0], c3[1], c3[2])
  }
  if (painting) {
    colored = true
    const emit: Emit = (ax, ay, az, bx, by, bz, cx, cy, cz, state) => {
      const c = filament(state)
      pushTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, c, c, c)
    }
    for (let t = 0; t < count; t++) {
      if (!valid(t)) continue
      source++
      const a = corner(t * 3)
      const b = corner(t * 3 + 1)
      const c = corner(t * 3 + 2)
      const paint = mesh.paint?.[t]
      if (!paint) {
        emit(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], 0)
      } else if (split) {
        if (!decodePaint(paint, a, b, c, emit)) emit(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], 0)
      } else {
        // Too finely painted to draw every piece: the triangle in the filament covering most of it.
        emit(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], Math.max(0, mesh.dominant?.[t] ?? 0))
      }
    }
  } else {
    for (let t = 0; t < count; t++) {
      if (!valid(t)) continue
      source++
      const a = corner(t * 3)
      const b = corner(t * 3 + 1)
      const c = corner(t * 3 + 2)
      const slot = mesh.pid ? mesh.pid[t] : -1
      const pid = slot >= 0 ? mesh.pids[slot] : object.pid
      const p1 = mesh.p ? mesh.p[t * 3] : -1
      const first = p1 >= 0 ? p1 : object.pindex
      const isGroup = pid !== null && part.colorgroups.has(pid)
      const c1 = propertyColor(part, pid, first)
      // A colorgroup colours each corner; a base material the whole triangle.
      const c2 = isGroup && mesh.p && mesh.p[t * 3 + 1] >= 0 ? propertyColor(part, pid, mesh.p[t * 3 + 1]) : c1
      const c3 = isGroup && mesh.p && mesh.p[t * 3 + 2] >= 0 ? propertyColor(part, pid, mesh.p[t * 3 + 2]) : c1
      if (c1) colored = true
      pushTriangle(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], c1 ?? WHITE, c2 ?? c1 ?? WHITE, c3 ?? c1 ?? WHITE)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(out.done(), 3))
  if (colored) geometry.setAttribute('color', new Float32BufferAttribute(colors.done(), 3))
  // Unindexed triangles: each gets its own face normal, as the slicer and the web viewer show them.
  geometry.computeVertexNormals()
  // The file's own vertices and triangles, for the viewer's statistics (the drawn copy repeats
  // vertices per triangle and splits painted triangles).
  geometry.userData.sourceVertices = vertexCount
  geometry.userData.sourceTriangles = source
  return { geometry, colored, triangles: out.length / 9, source }
}

/** The relationship target of the 3D model part in `_rels/.rels`, else the conventional path. */
function rootModelPath(files: Record<string, Uint8Array>): string {
  const rels = files['_rels/.rels']
  if (rels) {
    const text = strFromU8(rels)
    for (const m of text.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = m[0]
      const type = /Type="([^"]+)"/.exec(tag)?.[1] ?? ''
      const target = /Target="([^"]+)"/.exec(tag)?.[1]
      if (target && MODEL_REL.test(type)) {
        const path = normalizePath(unescape(target))
        if (files[path]) return path
      }
    }
  }
  return ROOT_MODEL
}

/**
 * Parse a 3MF archive into a scene: Y up, in the file's own units, one mesh per object with
 * vertex colours where the file has colours. Throws when there is no model to show.
 */
export function parseThreeMf(data: Uint8Array, { splitBudget = SPLIT_BUDGET, maxUnzipped = MAX_UNZIPPED } = {}): ThreeMf {
  let unzipped = 0
  let tooLarge = false
  const files = unzipSync(data, {
    filter: (f) => {
      const wanted = /\.model$/i.test(f.name) || f.name === '_rels/.rels' || (f.name.startsWith('Metadata/') && /\.config$/i.test(f.name))
      if (!wanted) return false
      unzipped += f.originalSize
      if (unzipped > maxUnzipped) tooLarge = true
      return !tooLarge
    },
  })
  if (tooLarge) throw new Error('This 3MF is too large to preview')
  const rootPath = rootModelPath(files)
  if (!files[rootPath]) throw new Error('This 3MF has no 3D model')
  const parts = new Map<string, Part>()
  const partAt = (path: string): Part | undefined => {
    let part = parts.get(path)
    if (!part && files[path]) {
      part = parsePart(strFromU8(files[path]), path)
      parts.set(path, part)
    }
    return part
  }
  const root = partAt(rootPath)!
  // Painting anywhere makes the whole file a painted one: unpainted triangles take their filament.
  for (const path of Object.keys(files)) if (/\.model$/i.test(path)) partAt(path)
  const painted = [...parts.values()].some((part) => [...part.objects.values()].some((o) => o.mesh?.paint))
  const settings = readSettings(files)
  const painting = painted ? readPainting(files, settings) : null
  // The slicer may split a painted triangle hundreds of times; past a budget the file is drawn
  // with each triangle in its main filament instead (as the web app's multi-color preview colours
  // whole faces), so a large print does not take a gigabyte of vertices.
  let split = false
  if (painting) {
    let total = 0
    for (const part of parts.values()) {
      for (const o of part.objects.values()) {
        if (!o.mesh?.paint) {
          total += o.mesh ? Math.floor(o.mesh.triangles.length / 3) : 0
          continue
        }
        const count = Math.floor(o.mesh.triangles.length / 3)
        const dominant = new Int16Array(count).fill(-1)
        for (let t = 0; t < count; t++) {
          const paint = o.mesh.paint[t]
          if (!paint) {
            total++
            continue
          }
          const summary = paintSummary(paint)
          total += summary?.leaves ?? 1
          if (summary) dominant[t] = summary.dominant
        }
        o.mesh.dominant = dominant
      }
    }
    split = total <= splitBudget
  }

  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, flatShading: true })
  const colorMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, flatShading: true, vertexColors: true })
  const built = new Map<string, Built>()
  let colored = false
  let triangles = 0
  let nodes = 0
  // The objects on the way down to a component: one that contains itself is not followed again.
  const ancestors = new Set<string>()
  const add = (parent: Group, path: string, objectId: string, transform: Matrix4 | null, extruder: number, top: string, depth: number) => {
    const id = `${path}#${objectId}`
    if (depth > 16 || nodes >= NODE_BUDGET || ancestors.has(id)) return
    const part = partAt(path)
    const object = part?.objects.get(objectId)
    if (!part || !object) return
    // A negative volume, modifier or support part of a slicer object is not part of the print.
    if (depth > 0 && settings.hiddenParts.get(top)?.has(object.id)) return
    nodes++
    const node = new Group()
    if (object.name) node.name = object.name
    // The matrix as written (shear and mirroring included), never decomposed.
    if (transform) node.matrix.copy(transform)
    node.matrixAutoUpdate = false
    parent.add(node)
    if (object.mesh) {
      // Unpainted triangles print with the part's filament, else the object's, else the first.
      const partFilament = painting?.partExtruder.get(top)?.get(object.id)
      const own = partFilament && partFilament > 0 ? partFilament : extruder
      const key = `${path}#${object.id}#${painting ? own : ''}`
      let mesh = built.get(key)
      if (!mesh) {
        mesh = buildMesh(part, object, painting, own || 1, split)
        built.set(key, mesh)
      }
      colored ||= mesh.colored
      triangles += mesh.source
      const m = new Mesh(mesh.geometry, mesh.colored ? colorMaterial : material)
      if (object.name) m.name = object.name
      node.add(m)
    }
    ancestors.add(id)
    for (const component of object.components) {
      add(node, component.path, component.objectId, component.transform, extruder, top, depth + 1)
    }
    ancestors.delete(id)
  }
  const scene = new Group()
  // 3MF is Z up; the viewer, like the web app, is Y up.
  const model = new Group()
  model.rotation.x = -Math.PI / 2
  scene.add(model)
  for (const item of root.build) {
    const extruder = painting?.objectExtruder.get(item.objectId) || 1
    add(model, item.path, item.objectId, item.transform, extruder, item.objectId, 0)
  }
  if (triangles === 0) throw new Error('This 3MF has no triangles to show')
  return { scene, colored, triangles }
}
