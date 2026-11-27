// client.viewer.js: renders one GLB or 3MF with studio HDR lighting and the web app's viewer modes
// (solid / unlit texture channels / lit, wireframe overlay, grid, skeleton), animation playback
// and orbit controls. A separate, self-contained chunk so three.js is fetched only on first preview.
import {
  AnimationMixer, Box3, Color, DirectionalLight, EquirectangularReflectionMapping,
  FrontSide, GridHelper, LoopRepeat, Mesh, MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping,
  PCFShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, ShadowMaterial,
  SkeletonHelper, SkinnedMesh, SRGBColorSpace, Vector3, WebGLRenderer,
  type AnimationAction, type AnimationClip, type Material, type Object3D, type Texture,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { isZip, parseThreeMf } from './threemf.ts'

/** Solid: neutral clay. Unlit: one texture channel, no lighting. Lit: the model's own PBR materials. */
export type RenderMode = 'solid' | 'unlit' | 'lit'
export type Channel = 'baseColor' | 'roughness' | 'metallic' | 'normal' | 'emissive' | 'ao'
export const CHANNELS: readonly Channel[] = ['baseColor', 'roughness', 'metallic', 'normal', 'emissive', 'ao']

/** A texture channel the model has, with a small preview image (data URL) when one could be drawn. */
export type ChannelInfo = { id: Channel; thumb: string | null }

export type ViewSettings = {
  mode: RenderMode
  /** The channel shown in `unlit` mode. */
  channel: Channel
  wireframe: boolean
  grid: boolean
  skeleton: boolean
  autoRotate: boolean
  /** Light strength multiplier, 0–2. */
  light: number
  /** Environment rotation in degrees, 0–360. */
  lightAngle: number
}

/** One playable animation clip. */
export type ClipInfo = { name: string; label: string; duration: number }

/** Playback state reported to the UI. */
export type PlaybackState = { clip: number; playing: boolean; time: number; duration: number; speed: number }

export type Viewer = {
  /** Triangles across every mesh, as drawn. */
  readonly triangles: number
  readonly vertices: number
  /** Whether the model has any texture map (otherwise only `solid` applies, or `lit` for colours). */
  readonly hasTexture: boolean
  /** A 3MF with colours of its own (filament painting, material colours) and no textures: `lit` shows them. */
  readonly hasColor: boolean
  /** Texture channels present in the model, in display order. */
  readonly channels: readonly ChannelInfo[]
  /** Whether the model has a skinned skeleton. */
  readonly hasSkeleton: boolean
  /** Rigged or animated: defaults follow the web app's animation view. */
  readonly animated: boolean
  readonly view: ViewSettings
  /** Apply part of the view settings; returns the settings now in effect. */
  setView(patch: Partial<ViewSettings>): ViewSettings
  /** Return camera to the initial framed view. */
  reset(): void
  /** A square still of the current view (data URL), for thumbnails. */
  snapshot(size?: number): string | null
  /** Animation clips in the model (bind poses shorter than 0.1 s are left out). */
  readonly clips: readonly ClipInfo[]
  readonly playback: PlaybackState
  /** Play clip `index` from its start. */
  playClip(index: number): void
  setPlaying(on: boolean): void
  seek(time: number): void
  setSpeed(speed: number): void
  /** Add the clips of another GLB of the same rig (e.g. a rigging task's running GLB), labelled `label`. */
  addClips(data: Uint8Array, label?: string): Promise<readonly ClipInfo[]>
  /** Called on every playback change and animation frame while playing. */
  onPlayback(listener: (state: PlaybackState) => void): () => void
  dispose(): void
}

export const DEFAULT_LIGHT = 1
export const DEFAULT_LIGHT_ANGLE = 159

/** "Armature|walking_man|baselayer" -> "Walking"; Mixamo-style names -> their last word. */
export function clipLabel(name: string): string {
  const parts = name.split('|').map((p) => p.trim()).filter(Boolean)
  let core = parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[1] : parts[0] ?? ''
  const generic = /^(baselayer|clip\s*\d*|take\s*\d*|mixamo\.com|animation|armature|default)$/i
  if (generic.test(core)) core = parts.find((p) => !generic.test(p)) ?? ''
  core = core.replace(/[_-](man|woman|loop|inplace|in_place)$/i, '').replace(/[_-]+/g, ' ').trim()
  if (!core) return 'Animation'
  return core.charAt(0).toUpperCase() + core.slice(1)
}

const MIN_CLIP_SECONDS = 0.1

// Mid grey so the form reads against both the light and the dark stage.
const CLAY = { color: 0xbdbdbd, roughness: 0.8, metalness: 0 }
/** Depth bias on every surface so the wireframe overlay's lines sit on top without z-fighting. */
const OFFSET = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }
const WIRE_LINE = { color: 0x282d2b, wireframe: true, transparent: true, opacity: 0.9 }
/** Data channels (sampled from one texel component, or all three for normals). */
const SWIZZLE: Partial<Record<Channel, string>> = { roughness: 'g', metallic: 'b', ao: 'r', normal: 'rgb' }

/** Check GLB JSON chunk header for Draco compression before handing to GLTFLoader. */
function assertNotDraco(data: Uint8Array): void {
  if (data.byteLength < 20) return
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  // glTF binary magic 'glTF' (0x46546C67)
  if (view.getUint32(0, true) !== 0x46546c67) return
  const chunkLen = view.getUint32(12, true)
  const chunkType = view.getUint32(16, true)
  // JSON chunk type 0x4E4F534A
  if (chunkType !== 0x4e4f534a || 20 + chunkLen > data.byteLength) return
  try {
    const text = new TextDecoder().decode(data.subarray(20, 20 + chunkLen))
    const json = JSON.parse(text) as { extensionsRequired?: unknown }
    if (Array.isArray(json.extensionsRequired) && json.extensionsRequired.includes('KHR_draco_mesh_compression')) {
      throw new Error('Draco-compressed GLB is not supported in this preview')
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('Draco')) throw err
  }
}

/**
 * Shared studio HDR environment map served by the host at `api/meshy.env.hdr`.
 * Falls back to three.js RoomEnvironment when unavailable.
 */
let studioEnvironment: Promise<Texture | null> | undefined
const loadStudioEnvironment = () =>
  (studioEnvironment ??= new HDRLoader()
    .loadAsync('api/meshy.env.hdr')
    .then((texture) => {
      texture.mapping = EquirectangularReflectionMapping
      return texture as Texture
    })
    .catch(() => {
      studioEnvironment = undefined
      return null
    }))

function disposeMaterial(mat: Material): void {
  const rec = mat as unknown as Record<string, unknown>
  for (const value of Object.values(rec)) {
    if (value && typeof value === 'object' && 'isTexture' in value && typeof (value as Texture).dispose === 'function') {
      ;(value as Texture).dispose()
    }
  }
  mat.dispose()
}

const asStandard = (mat: Material | undefined) =>
  mat && (mat as MeshStandardMaterial).isMeshStandardMaterial ? (mat as MeshStandardMaterial) : undefined

function channelTexture(source: Material | undefined, channel: Channel): Texture | null {
  // Unlit glTF materials (MeshBasicMaterial) still carry a base colour map.
  if (channel === 'baseColor') return (source as MeshBasicMaterial | undefined)?.map ?? null
  const mat = asStandard(source)
  if (!mat) return null
  switch (channel) {
    case 'roughness': return mat.roughnessMap ?? null
    case 'metallic': return mat.metalnessMap ?? null
    case 'normal': return mat.normalMap ?? null
    case 'emissive': return mat.emissiveMap ?? null
    case 'ao': return mat.aoMap ?? null
    default: return null
  }
}

/**
 * An unlit material that shows one channel of `source` as the web app's channel views do: colour
 * channels as authored, data channels (roughness, metallic, AO, normal) as their raw texel values.
 */
function channelMaterial(source: Material | undefined, channel: Channel, vertexColors: boolean): MeshBasicMaterial {
  const std = asStandard(source)
  const texture = channelTexture(source, channel)
  const mat = new MeshBasicMaterial({ toneMapped: false, side: source?.side ?? FrontSide, ...OFFSET })
  if (channel === 'baseColor') {
    mat.map = texture ?? undefined
    const color = (source as MeshBasicMaterial | undefined)?.color
    if (color) mat.color.copy(color)
    mat.vertexColors = vertexColors
    mat.transparent = source?.transparent ?? false
    mat.opacity = source?.opacity ?? 1
    mat.alphaTest = source?.alphaTest ?? 0
    return mat
  }
  if (channel === 'emissive') {
    mat.map = texture ?? undefined
    if (std) mat.color.copy(std.emissive).multiplyScalar(std.emissiveIntensity)
    else mat.color.set(0x000000)
    return mat
  }
  const factor = channel === 'roughness' ? std?.roughness ?? 1 : channel === 'metallic' ? std?.metalness ?? 0 : 1
  if (!texture) {
    // No map: the factor alone, shown as the same grey the texel value would be.
    if (channel === 'normal') mat.color.setRGB(0.5, 0.5, 1, SRGBColorSpace)
    else mat.color.setRGB(factor, factor, factor, SRGBColorSpace)
    return mat
  }
  mat.map = texture
  const swizzle = SWIZZLE[channel] ?? 'rgb'
  type Shader = { uniforms: Record<string, { value: unknown }>; fragmentShader: string }
  ;(mat as unknown as { onBeforeCompile(shader: Shader): void }).onBeforeCompile = (shader: Shader) => {
    shader.uniforms.meshyFactor = { value: factor }
    shader.fragmentShader = `uniform float meshyFactor;\n${shader.fragmentShader}`.replace(
      '#include <map_fragment>',
      [
        '#ifdef USE_MAP',
        '  vec4 meshyTexel = texture2D( map, vMapUv );',
        `  vec3 meshyValue = ${swizzle === 'rgb' ? 'meshyTexel.rgb' : `vec3( meshyTexel.${swizzle} * meshyFactor )`};`,
        // The output pass encodes to sRGB; decode first so the screen shows the stored value.
        '  diffuseColor.rgb = sRGBTransferEOTF( vec4( meshyValue, 1.0 ) ).rgb;',
        '#endif',
      ].join('\n'),
    )
  }
  mat.customProgramCacheKey = () => `meshy-channel-${swizzle}`
  return mat
}

/** A 56px preview of one channel, drawn from the texture's own image. */
function channelThumb(texture: Texture | null, channel: Channel): string | null {
  const image = texture?.image as CanvasImageSource | undefined
  if (!image || typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 56
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(image, 0, 0, 56, 56)
    const swizzle = SWIZZLE[channel]
    if (swizzle && swizzle !== 'rgb') {
      const pixels = ctx.getImageData(0, 0, 56, 56)
      const offset = { r: 0, g: 1, b: 2 }[swizzle as 'r' | 'g' | 'b']
      const d = pixels.data
      for (let i = 0; i < d.length; i += 4) {
        const v = d[i + offset]
        d[i] = d[i + 1] = d[i + 2] = v
        d[i + 3] = 255
      }
      ctx.putImageData(pixels, 0, 0)
    }
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

type MeshRecord = {
  mesh: Mesh
  original: Material | Material[]
  clay: MeshStandardMaterial
  vertexColors: boolean
  channels: Map<Channel, Material | Material[]>
  wireOverlay: Mesh
}

/** A model as the viewer takes it: GLB through three's loader, 3MF through `threemf.ts`. */
async function loadModel(data: Uint8Array): Promise<{ root: Object3D; animations: AnimationClip[]; threeMf: boolean; colored: boolean }> {
  if (isZip(data)) {
    const model = parseThreeMf(data)
    return { root: model.scene, animations: [], threeMf: true, colored: model.colored }
  }
  assertNotDraco(data)
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const gltf = await new GLTFLoader().parseAsync(buffer, '')
  return { root: gltf.scene, animations: gltf.animations, threeMf: false, colored: false }
}

/**
 * Parse `data` (GLB or 3MF) and mount an interactive studio 3D viewer inside `host`.
 * Redraws on demand when the camera moves, the view changes, or while rotating / playing.
 */
export async function mountViewer(host: HTMLElement, data: Uint8Array, initial: Partial<ViewSettings> = {}): Promise<Viewer> {
  // The environment starts loading first: a 3MF is parsed synchronously inside `loadModel`.
  const environment = loadStudioEnvironment()
  const [model, studio] = await Promise.all([loadModel(data), environment])
  const { root, animations } = model

  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = 1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true
  host.append(renderer.domElement)
  renderer.domElement.style.display = 'block'

  const anisotropy = renderer.capabilities.getMaxAnisotropy()
  const scene = new Scene()
  const pmrem = studio ? undefined : new PMREMGenerator(renderer)
  const fallback = pmrem?.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = studio ?? fallback ?? null
  const baseEnvironment = studio ? 1 : 0.45
  scene.add(root)

  const clayPlain = new MeshStandardMaterial({ ...CLAY, ...OFFSET })
  const clayVertex = new MeshStandardMaterial({ ...CLAY, ...OFFSET, vertexColors: true })
  const wireLineMat = new MeshBasicMaterial({ ...WIRE_LINE })
  const sharedMaterials: Material[] = [clayPlain, clayVertex, wireLineMat]

  const meshes: Mesh[] = []
  let hasSkeleton = false
  root.traverse((node) => {
    const mesh = node as Mesh
    if (mesh.isMesh && mesh.geometry) meshes.push(mesh)
    if ((node as SkinnedMesh).isSkinnedMesh) hasSkeleton = true
  })

  const records: MeshRecord[] = []
  let triangles = 0
  let vertices = 0
  for (const mesh of meshes) {
    const geometry = mesh.geometry
    triangles += geometry.userData.sourceTriangles ?? (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3
    vertices += geometry.userData.sourceVertices ?? geometry.attributes.position?.count ?? 0
    mesh.castShadow = true
    mesh.receiveShadow = true
    if (!geometry.attributes.normal) {
      mesh.geometry = geometry.index ? geometry : mergeVertices(geometry)
      mesh.geometry.computeVertexNormals()
    }
    for (const mat of ([] as Material[]).concat(mesh.material)) {
      Object.assign(mat, OFFSET)
      // Large textures stay sharp at grazing angles.
      for (const channel of CHANNELS) {
        const texture = channelTexture(mat, channel)
        if (texture) texture.anisotropy = anisotropy
      }
    }
    // A 3MF's colours are its print colours, shown in `lit`; its clay stays plain.
    const vertexColors = Boolean(mesh.geometry.attributes.color) && !model.threeMf
    // A skinned mesh's overlay shares its skeleton so the wireframe follows the animation.
    const skinned = (mesh as SkinnedMesh).isSkinnedMesh ? (mesh as SkinnedMesh) : null
    const wireOverlay = skinned ? new SkinnedMesh(mesh.geometry, wireLineMat) : new Mesh(mesh.geometry, wireLineMat)
    if (skinned) {
      ;(wireOverlay as SkinnedMesh).bindMode = skinned.bindMode
      ;(wireOverlay as SkinnedMesh).bind(skinned.skeleton, skinned.bindMatrix)
    }
    wireOverlay.frustumCulled = false
    wireOverlay.visible = false
    wireOverlay.castShadow = false
    wireOverlay.receiveShadow = false
    wireOverlay.renderOrder = 2
    mesh.add(wireOverlay)
    records.push({
      mesh,
      original: mesh.material,
      clay: vertexColors ? clayVertex : clayPlain,
      vertexColors,
      channels: new Map(),
      wireOverlay,
    })
  }

  // Channels the model actually has, previewed from the first material that carries each map.
  const channels: ChannelInfo[] = []
  for (const channel of CHANNELS) {
    let texture: Texture | null = null
    for (const rec of records) {
      for (const mat of ([] as Material[]).concat(rec.original)) {
        texture = channelTexture(mat, channel)
        if (texture) break
      }
      if (texture) break
    }
    if (texture) channels.push({ id: channel, thumb: channelThumb(texture, channel) })
  }
  const hasTexture = channels.length > 0
  const hasColor = !hasTexture && model.colored
  const modes: readonly RenderMode[] = hasTexture ? ['solid', 'unlit', 'lit'] : hasColor ? ['solid', 'lit'] : ['solid']

  const materialFor = (rec: MeshRecord, mode: RenderMode, channel: Channel): Material | Material[] => {
    if (mode === 'lit' && (hasTexture || hasColor)) return rec.original
    if (mode === 'unlit' && hasTexture) {
      let mats = rec.channels.get(channel)
      if (!mats) {
        mats = Array.isArray(rec.original)
          ? rec.original.map((m) => channelMaterial(m, channel, rec.vertexColors))
          : channelMaterial(rec.original, channel, rec.vertexColors)
        rec.channels.set(channel, mats)
      }
      return mats
    }
    return rec.clay
  }

  // Measure the model as it is drawn: a rigged mesh's vertices run through its skeleton (its
  // stored bounds are of an unposed or zeroed rig), sampled across its first clip so a walk cycle
  // that leans or steps forward stays in frame.
  const box = new Box3()
  const point = new Vector3()
  const measure = () => {
    root.updateMatrixWorld(true)
    for (const mesh of meshes) {
      const skinned = (mesh as SkinnedMesh).isSkinnedMesh ? (mesh as SkinnedMesh) : null
      if (!skinned) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
        if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld))
        continue
      }
      skinned.skeleton.update()
      const position = skinned.geometry.attributes.position
      const step = Math.max(1, Math.floor(position.count / 20000))
      for (let i = 0; i < position.count; i += step) {
        skinned.getVertexPosition(i, point)
        box.expandByPoint(point.applyMatrix4(skinned.matrixWorld))
      }
    }
  }
  for (const mesh of meshes) {
    // Animated poses leave the bind-pose bounds, so never cull a skinned mesh.
    if ((mesh as SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false
  }
  const firstClip = animations.find((c) => c.duration >= MIN_CLIP_SECONDS)
  if (firstClip) {
    const probe = new AnimationMixer(root)
    probe.clipAction(firstClip).play()
    const samples = 8
    for (let i = 0; i <= samples; i++) {
      probe.setTime((firstClip.duration * i) / samples)
      measure()
    }
    probe.stopAllAction()
    probe.uncacheRoot(root)
  } else {
    measure()
  }
  if (box.isEmpty()) box.setFromObject(root)
  const size = box.getSize(new Vector3())
  const radius = size.length() / 2 || 1
  const center = box.getCenter(new Vector3())
  const camera = new PerspectiveCamera(35, 1, radius / 100, radius * 200)
  const direction = new Vector3(3, 3, 10).normalize()

  // The HDR environment does the lighting; one key light only casts the contact shadow.
  const key = new DirectionalLight(0xffffff, 1.6)
  key.position.copy(center).add(new Vector3(-1.75, 15, 7).setLength(4 * radius))
  key.target.position.copy(center)
  key.castShadow = true
  key.shadow.intensity = 0.4
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.radius = 3
  key.shadow.blurSamples = 12
  key.shadow.bias = -0.0005
  key.shadow.normalBias = 0.02 * radius
  Object.assign(key.shadow.camera, {
    left: -2 * radius,
    right: 2 * radius,
    top: 2 * radius,
    bottom: -2 * radius,
    near: 0.01 * radius,
    far: 10 * radius,
  })
  key.shadow.camera.updateProjectionMatrix()
  const lights = [[key, key.intensity]] as const

  const ground = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.3 }))
  ground.rotation.x = -Math.PI / 2
  ground.position.set(center.x, box.min.y - 0.015 * radius, center.z)
  ground.scale.setScalar(Math.max(2.4 * Math.max(size.x, size.z), 3 * radius))
  ground.receiveShadow = true
  scene.add(key, key.target, ground)

  // The web app's grid: 10 divisions over twice the footprint, at the model's feet.
  const gridSize = Math.max(2 * Math.max(size.x, size.z), radius)
  const grid = new GridHelper(gridSize, 10, new Color(0x585858), new Color(0x3f3f3f))
  grid.position.set(center.x, box.min.y, center.z)
  for (const mat of ([] as Material[]).concat(grid.material)) Object.assign(mat, { transparent: true, opacity: 0.7, depthWrite: false })
  grid.visible = false
  scene.add(grid)

  let skeleton: SkeletonHelper | null = null
  if (hasSkeleton) {
    skeleton = new SkeletonHelper(root)
    skeleton.setColors(new Color(0xc5f955), new Color(0xffffff))
    Object.assign(skeleton.material, { depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 })
    skeleton.renderOrder = 3
    skeleton.visible = false
    scene.add(skeleton)
  }

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(center)
  controls.autoRotateSpeed = 2
  controls.minDistance = 0.1 * radius
  controls.maxDistance = 20 * radius
  const draw = () => renderer.render(scene, camera)
  controls.addEventListener('change', draw)
  let moved = false
  controls.addEventListener('start', () => {
    moved = true
  })

  // Fit the bounding box's corners (not its sphere) so the model fills the stage.
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(
    i & 1 ? box.max.x : box.min.x,
    i & 2 ? box.max.y : box.min.y,
    i & 4 ? box.max.z : box.min.z,
  ))
  const projected = new Vector3()
  const fits = (distance: number) => {
    camera.position.copy(center).addScaledVector(direction, distance)
    camera.lookAt(center)
    camera.updateMatrixWorld()
    return corners.every((corner) => {
      projected.copy(corner).project(camera)
      return projected.z < 1 && Math.abs(projected.x) <= 0.92 && Math.abs(projected.y) <= 0.86
    })
  }
  const frame = () => {
    let near = 0.5 * radius
    let far = 20 * radius
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2
      if (fits(mid)) far = mid
      else near = mid
    }
    camera.position.copy(center).addScaledVector(direction, far)
    controls.target.copy(center)
    controls.update()
  }
  const resize = () => {
    const width = host.clientWidth || 1
    const height = host.clientHeight || 1
    renderer.setSize(width, height, false)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    if (!moved) frame()
    draw()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)

  // Animation: one mixer over the scene; extra clips from sibling GLBs bind by node name.
  const mixer = new AnimationMixer(root)
  const clipList: { clip: AnimationClip; info: ClipInfo }[] = []
  const addClipList = (clips: readonly AnimationClip[], label?: string) => {
    const real = clips.filter((c) => c.duration >= MIN_CLIP_SECONDS)
    real.forEach((clip, i) => {
      const base = label ?? clipLabel(clip.name)
      const name = real.length > 1 && label ? `${base} ${i + 1}` : base
      if (clipList.some((c) => c.info.label === name)) return
      clipList.push({ clip, info: { name: clip.name, label: name, duration: clip.duration } })
    })
  }
  addClipList(animations)
  const animated = hasSkeleton || clipList.length > 0

  // The web app's defaults: lit for textured models, unlit with a grid for animated ones.
  const view: ViewSettings = {
    mode: hasTexture ? (animated ? 'unlit' : 'lit') : hasColor ? 'lit' : 'solid',
    channel: 'baseColor',
    wireframe: false,
    grid: animated,
    skeleton: false,
    autoRotate: false,
    light: DEFAULT_LIGHT,
    lightAngle: DEFAULT_LIGHT_ANGLE,
    ...initial,
  }

  let action: AnimationAction | null = null
  let clipIndex = -1
  let playing = false
  let userPaused = false
  let speed = 1
  const listeners = new Set<(state: PlaybackState) => void>()
  const state = (): PlaybackState => ({
    clip: clipIndex,
    playing,
    time: action ? action.time : 0,
    duration: clipIndex >= 0 ? clipList[clipIndex].info.duration : 0,
    speed,
  })
  const emit = () => {
    const snapshot = state()
    for (const fn of listeners) fn(snapshot)
  }

  // One loop runs only while something moves (auto-rotate or a playing clip).
  let spin = 0
  let last = 0
  const tick = (now: number) => {
    const delta = last ? Math.min(0.1, (now - last) / 1000) : 0
    last = now
    if (playing && action) {
      mixer.update(delta)
      renderer.shadowMap.needsUpdate = true
    }
    controls.update()
    draw()
    if (playing) emit()
    spin = requestAnimationFrame(tick)
  }
  const syncLoop = () => {
    const run = view.autoRotate || (playing && action !== null)
    if (run && !spin) {
      last = 0
      spin = requestAnimationFrame(tick)
    } else if (!run && spin) {
      cancelAnimationFrame(spin)
      spin = 0
    }
  }

  const applyView = () => {
    if (!modes.includes(view.mode)) view.mode = hasColor ? 'lit' : 'solid'
    if (!channels.some((c) => c.id === view.channel)) view.channel = channels[0]?.id ?? 'baseColor'
    view.light = Math.max(0, Math.min(2, view.light))
    view.lightAngle = ((view.lightAngle % 360) + 360) % 360
    for (const rec of records) {
      rec.mesh.material = materialFor(rec, view.mode, view.channel)
      rec.wireOverlay.visible = view.wireframe
    }
    grid.visible = view.grid
    if (skeleton) skeleton.visible = view.skeleton
    scene.environmentIntensity = baseEnvironment * view.light
    scene.environmentRotation.y = (view.lightAngle * Math.PI) / 180
    for (const [light, base] of lights) light.intensity = base * view.light
    controls.autoRotate = view.autoRotate
    renderer.shadowMap.needsUpdate = true
    syncLoop()
  }
  applyView()
  resize()

  const playClip = (index: number) => {
    const entry = clipList[index]
    if (!entry) return
    action?.stop()
    action = mixer.clipAction(entry.clip)
    action.setLoop(LoopRepeat, Infinity)
    action.reset().play()
    action.timeScale = speed
    clipIndex = index
    playing = true
    userPaused = false
    mixer.update(0)
    renderer.shadowMap.needsUpdate = true
    syncLoop()
    draw()
    emit()
  }
  // Animated models start playing their first clip, like the web app.
  if (clipList.length) playClip(0)

  return {
    triangles: Math.round(triangles),
    vertices,
    hasTexture,
    hasColor,
    channels,
    hasSkeleton,
    animated,
    get view() {
      return { ...view }
    },
    setView(patch) {
      Object.assign(view, patch)
      applyView()
      draw()
      return { ...view }
    },
    reset() {
      moved = false
      frame()
      draw()
    },
    snapshot(side = 192) {
      try {
        // Read the drawing buffer in the same task as the render, before it is presented.
        draw()
        const src = renderer.domElement
        const crop = Math.min(src.width, src.height)
        if (!crop) return null
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = side
        canvas.getContext('2d')?.drawImage(src, (src.width - crop) / 2, (src.height - crop) / 2, crop, crop, 0, 0, side, side)
        return canvas.toDataURL('image/webp', 0.82)
      } catch {
        return null
      }
    },
    get clips() {
      return clipList.map((c) => c.info)
    },
    get playback() {
      return state()
    },
    playClip,
    setPlaying(on) {
      if (!action) {
        if (on && clipList.length) playClip(0)
        return
      }
      playing = on
      userPaused = !on
      action.paused = !on
      syncLoop()
      draw()
      emit()
    },
    seek(time) {
      if (!action) return
      const duration = clipList[clipIndex].info.duration
      action.time = Math.max(0, Math.min(duration, time))
      mixer.update(0)
      renderer.shadowMap.needsUpdate = true
      draw()
      emit()
    },
    setSpeed(next) {
      speed = next
      if (action) action.timeScale = next
      emit()
    },
    async addClips(extra, label) {
      assertNotDraco(extra)
      const buf = extra.buffer.slice(extra.byteOffset, extra.byteOffset + extra.byteLength) as ArrayBuffer
      const other = await new GLTFLoader().parseAsync(buf, '')
      const before = clipList.length
      addClipList(other.animations, label)
      // Only the clips are kept; the other model's meshes and textures are released.
      other.scene.traverse((node) => {
        const m = node as Mesh
        if (!m.isMesh) return
        m.geometry?.dispose()
        for (const mat of ([] as Material[]).concat(m.material ?? [])) disposeMaterial(mat)
      })
      if (clipList.length !== before) {
        if (!action && !userPaused) playClip(0)
        else emit()
      }
      return clipList.map((c) => c.info)
    },
    onPlayback(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      cancelAnimationFrame(spin)
      spin = 0
      listeners.clear()
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      observer.disconnect()
      controls.dispose()
      const disposedMats = new Set<Material>()
      const release = (mat: Material, textures: boolean) => {
        if (disposedMats.has(mat)) return
        disposedMats.add(mat)
        if (textures) disposeMaterial(mat)
        else mat.dispose()
      }
      for (const rec of records) {
        rec.wireOverlay.removeFromParent()
        rec.mesh.geometry?.dispose()
        for (const mat of ([] as Material[]).concat(rec.original ?? [])) release(mat, true)
        // Channel views borrow the original textures, so only the materials themselves go.
        for (const mats of rec.channels.values()) for (const mat of ([] as Material[]).concat(mats)) release(mat, false)
      }
      for (const mat of sharedMaterials) release(mat, false)
      grid.dispose()
      skeleton?.dispose()
      ground.geometry.dispose()
      ;(ground.material as Material).dispose()
      key.shadow.map?.dispose()
      fallback?.dispose()
      pmrem?.dispose()
      renderer.dispose()
      // Several stages can be open at once; give the GL context back right away.
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
