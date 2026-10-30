// client.viewer.js: renders one GLB with orbit controls. A separate, self-contained chunk so
// three.js is fetched only when a model is first previewed.
import { Box3, PerspectiveCamera, PMREMGenerator, Scene, Vector3, WebGLRenderer, type Material, type Mesh } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type Viewer = {
  /** Triangles across every mesh, as drawn. */
  triangles: number
  /** Back to the framed view the model opened with. */
  reset(): void
  setAutoRotate(on: boolean): void
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
  gltf.scene.traverse((node) => {
    const geometry = (node as Mesh).isMesh ? (node as Mesh).geometry : undefined
    if (geometry) triangles += (geometry.index?.count ?? geometry.attributes.position?.count ?? 0) / 3
  })

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

  let spin = 0
  const tick = () => { controls.update(); spin = requestAnimationFrame(tick) }

  return {
    triangles: Math.round(triangles),
    reset: () => { moved = false; frame(); draw() },
    setAutoRotate: (on) => {
      controls.autoRotate = on
      cancelAnimationFrame(spin)
      if (on) spin = requestAnimationFrame(tick)
    },
    dispose: () => {
      cancelAnimationFrame(spin)
      observer.disconnect()
      controls.dispose()
      gltf.scene.traverse((node) => {
        const mesh = node as Mesh
        mesh.geometry?.dispose()
        for (const material of ([] as Material[]).concat(mesh.material ?? [])) material.dispose()
      })
      environment.dispose()
      pmrem.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}
