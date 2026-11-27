// client.viewer.js: renders one GLB with orbit controls. A separate, self-contained chunk so
// three.js is fetched only when a model is first previewed. Meshy Studio also switches the
// display (textured, clay, wireframe), takes a snapshot of the current view for a pin and reads
// the camera angle to describe it.
import {
  AnimationMixer, Box3, Clock, MeshStandardMaterial, PerspectiveCamera, PMREMGenerator, Scene, Spherical, Vector3, WebGLRenderer,
  type Material, type Mesh,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type DisplayMode = 'textured' | 'clay' | 'wireframe'

export type Viewer = {
  /** Triangles across every mesh, as drawn. */
  triangles: number
  /** Vertices across every mesh. */
  vertices: number
  /** Whether the model carries a skeleton. */
  rigged: boolean
  /** Names of the animation clips in the file, in file order (unnamed ones as `Clip N`). */
  animations: string[]
  /** Play one clip on a loop, by its index in `animations`; null stops and returns to the rest pose. */
  play(index: number | null): void
  /** Back to the framed view the model opened with. */
  reset(): void
  setAutoRotate(on: boolean): void
  setMode(mode: DisplayMode): void
  /** The current view as a PNG data URL, at most `maxSide` pixels on its longer side. */
  snapshot(maxSide?: number): string
  /** Where the camera looks from, in degrees: azimuth around the model, elevation above it. */
  camera(): { azimuth: number; elevation: number }
  dispose(): void
}

/**
 * Parse `data` and draw it inside `host`, framed to fit, on a transparent background so the
 * pane's own theme shows through. Redraws only when the view changes or while auto-rotating.
 */
export async function mountViewer(host: HTMLElement, data: Uint8Array): Promise<Viewer> {
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const gltf = await new GLTFLoader().parseAsync(buffer, '')

  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  host.append(renderer.domElement)
  renderer.domElement.style.display = 'block'

  const scene = new Scene()
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = environment
  scene.add(gltf.scene)

  let triangles = 0
  let vertices = 0
  let rigged = false
  const meshes: Mesh[] = []
  gltf.scene.traverse((node) => {
    const mesh = node as Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    meshes.push(mesh)
    const geometry = mesh.geometry
    triangles += (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3
    vertices += geometry.attributes.position?.count ?? 0
    if ((node as { isSkinnedMesh?: boolean }).isSkinnedMesh) rigged = true
  })

  // Each mesh keeps its own materials; clay and wireframe are shared stand-ins swapped in.
  const original = new Map<Mesh, Material | Material[]>(meshes.map((m) => [m, m.material]))
  const clay = new MeshStandardMaterial({ color: 0xd9d9d6, roughness: 0.85, metalness: 0 })
  const wire = new MeshStandardMaterial({ color: 0x8a8f98, roughness: 1, metalness: 0, wireframe: true })

  const box = new Box3().setFromObject(gltf.scene)
  const radius = box.getSize(new Vector3()).length() / 2 || 1
  const center = box.getCenter(new Vector3())
  const camera = new PerspectiveCamera(40, 1, radius / 50, radius * 200)
  const direction = new Vector3(0.6, 0.45, 1).normalize()

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(center)
  controls.autoRotateSpeed = 1.5
  const draw = () => renderer.render(scene, camera)
  controls.addEventListener('change', draw)
  let moved = false
  controls.addEventListener('start', () => { moved = true })

  // Fit the bounding sphere into the narrower of the two fields of view, until the user moves.
  const frame = () => {
    const half = (camera.fov * Math.PI) / 360
    const narrow = Math.min(half, Math.atan(Math.tan(half) * camera.aspect))
    camera.position.copy(center).addScaledVector(direction, (radius / Math.sin(narrow)) * 1.1)
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
  resize()

  // One loop drives both auto-rotate and a playing clip; it runs only while either is on.
  const mixer = new AnimationMixer(gltf.scene)
  const clock = new Clock()
  let playing = false
  let spin = 0
  const tick = () => {
    if (playing) mixer.update(clock.getDelta())
    controls.update()
    if (playing) draw()
    spin = requestAnimationFrame(tick)
  }
  const loop = () => {
    cancelAnimationFrame(spin)
    spin = 0
    if (playing || controls.autoRotate) { clock.getDelta(); spin = requestAnimationFrame(tick) }
  }

  return {
    triangles: Math.round(triangles),
    vertices,
    rigged,
    animations: gltf.animations.map((a, i) => a.name || `Clip ${i + 1}`),
    play: (index) => {
      mixer.stopAllAction()
      const clip = index === null ? undefined : gltf.animations[index]
      playing = !!clip
      if (clip) mixer.clipAction(clip).reset().play()
      loop()
      draw()
    },
    reset: () => { moved = false; frame(); draw() },
    setAutoRotate: (on) => {
      controls.autoRotate = on
      loop()
    },
    setMode: (mode) => {
      for (const mesh of meshes) mesh.material = mode === 'clay' ? clay : mode === 'wireframe' ? wire : original.get(mesh)!
      draw()
    },
    snapshot: (maxSide = 1024) => {
      // Drawn and read in one task, so the buffer is still there without preserveDrawingBuffer.
      draw()
      const src = renderer.domElement
      const scale = Math.min(1, maxSide / Math.max(src.width, src.height))
      if (scale === 1) return src.toDataURL('image/png')
      const out = document.createElement('canvas')
      out.width = Math.round(src.width * scale)
      out.height = Math.round(src.height * scale)
      out.getContext('2d')!.drawImage(src, 0, 0, out.width, out.height)
      return out.toDataURL('image/png')
    },
    camera: () => {
      const s = new Spherical().setFromVector3(camera.position.clone().sub(controls.target))
      const azimuth = Math.round(((s.theta * 180) / Math.PI + 360) % 360)
      const elevation = Math.round(90 - (s.phi * 180) / Math.PI)
      return { azimuth, elevation }
    },
    dispose: () => {
      cancelAnimationFrame(spin)
      mixer.stopAllAction()
      mixer.uncacheRoot(gltf.scene)
      observer.disconnect()
      controls.dispose()
      for (const [mesh, material] of original) mesh.material = material
      gltf.scene.traverse((node) => {
        const mesh = node as Mesh
        mesh.geometry?.dispose()
        for (const material of ([] as Material[]).concat(mesh.material ?? [])) material.dispose()
      })
      clay.dispose()
      wire.dispose()
      environment.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
