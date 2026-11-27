// Offline tests for the 3MF reader: the slicer's paint encoding, a Bambu-style painted print
// (production components, build transform, filament colours, object filament), basematerials,
// and a file without colours. The archives are built here with fflate.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Box3, Color, SRGBColorSpace, Vector3 } from 'three'
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js'
import { decodePaint, isZip, paintSummary, parseThreeMf, parseTransform } from '../src/client/threemf.ts'

const CORE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'
const PROD = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06'
const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`

const archive = (files) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
const linear = (hex) => {
  const c = new Color().setStyle(hex, SRGBColorSpace)
  return [c.r, c.g, c.b].map((v) => Number(v.toFixed(4)))
}
const meshesOf = (scene) => {
  const out = []
  scene.traverse((o) => { if (o.isMesh) out.push(o) })
  return out
}
/** The colour of each triangle (its first corner), in order. */
const triangleColors = (mesh) => {
  const c = mesh.geometry.getAttribute('color')
  const out = []
  for (let i = 0; i < c.count; i += 3) out.push([c.getX(i), c.getY(i), c.getZ(i)].map((v) => Number(v.toFixed(4))))
  return out
}

test('3mf: paint strings decode as the slicer splits them', () => {
  const a = [0, 0, 0]
  const b = [4, 0, 0]
  const c = [0, 4, 0]
  const leaves = []
  const emit = (ax, ay, az, bx, by, bz, cx, cy, cz, state) => leaves.push({ corners: [[ax, ay, az], [bx, by, bz], [cx, cy, cz]], state })
  // One filament each: "4" is filament 1, "8" filament 2, "0C" filament 3, "1C" filament 4.
  for (const [paint, state] of [['4', 1], ['8', 2], ['0C', 3], ['1C', 4], ['2C', 5]]) {
    leaves.length = 0
    assert.equal(decodePaint(paint, a, b, c, emit), true)
    assert.deepEqual(leaves.map((l) => l.state), [state])
  }
  // Split on all three sides (nibble 3); children read last first: 1, 2, 1, then 3 for the corner at a.
  leaves.length = 0
  assert.equal(decodePaint('0C4843', a, b, c, emit), true)
  assert.equal(leaves.length, 4)
  const byCorner = (corners) => leaves.find((l) => JSON.stringify(l.corners) === JSON.stringify(corners))?.state
  assert.equal(byCorner([a, [2, 0, 0], [0, 2, 0]]), 3)
  assert.equal(byCorner([[2, 0, 0], b, [2, 2, 0]]), 1)
  assert.equal(byCorner([[2, 2, 0], c, [0, 2, 0]]), 2)
  assert.equal(byCorner([[2, 0, 0], [2, 2, 0], [0, 2, 0]]), 1)
  // A malformed string (lower case, truncated) is refused, so the triangle stays unpainted.
  assert.equal(decodePaint('0c4843', a, b, c, emit), false)
  assert.equal(decodePaint('3', a, b, c, emit), false)
  // The summary counts the pieces and finds the filament over most of the area.
  assert.deepEqual(paintSummary('0C4843'), { leaves: 4, dominant: 1 })
  assert.deepEqual(paintSummary('1C8883888388838883'), { leaves: 13, dominant: 2 })
  assert.equal(paintSummary('xyz'), null)
})

test('3mf: transforms are the spec\'s row-vector layout', () => {
  const m = parseTransform('1 0 0 0 1 0 0 0 1 125 125 0')
  const p = new Vector3(1, 2, 3).applyMatrix4(m)
  assert.deepEqual(p.toArray(), [126, 127, 3])
  assert.equal(parseTransform('1 0 0'), null)
  assert.equal(parseTransform(undefined), null)
})

test('3mf: a Bambu multi-color print is drawn in its filament colours, placed by its build item', () => {
  const objectModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="${CORE}" xmlns:p="${PROD}">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="0" y="0" z="0"/>
     <vertex x="4" y="0" z="0"/>
     <vertex x="0" y="4" z="0"/>
     <vertex x="0" y="0" z="4"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2" paint_color="8"/>
     <triangle v1="0" v2="1" v3="3" paint_color="0C4843"/>
     <triangle v1="0" v2="2" v3="3"/>
    </triangles>
   </mesh>
  </object>
 </resources>
</model>`
  const rootModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="${CORE}" xmlns:p="${PROD}" requiredextensions="p">
 <metadata name="Application">BambuStudio-02.03.01.00</metadata>
 <resources>
  <object id="2" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 125 125 0" printable="1"/>
 </build>
</model>`
  const data = archive({
    '_rels/.rels': RELS,
    '3D/3dmodel.model': rootModel,
    '3D/Objects/object_1.model': objectModel,
    'Metadata/project_settings.config': JSON.stringify({ filament_colour: ['#FF0000FF', '#00FF00FF', '#0000FFFF'] }),
    'Metadata/model_settings.config': '<config><object id="2"><metadata key="extruder" value="3"/><part id="1" subtype="normal_part"><metadata key="name" value="x"/></part></object></config>',
  })
  assert.equal(isZip(data), true)
  const { scene, colored, triangles } = parseThreeMf(data)
  assert.equal(colored, true)
  // The file's three triangles, drawn as 1 + 4 pieces of the split one + 1 unpainted.
  assert.equal(triangles, 3)
  const [mesh] = meshesOf(scene)
  assert.equal(mesh.geometry.getAttribute('position').count, 18)
  assert.equal(mesh.material.flatShading, true)
  assert.equal(mesh.material.vertexColors, true)
  const colors = triangleColors(mesh)
  const red = linear('#FF0000')
  const green = linear('#00FF00')
  const blue = linear('#0000FF')
  assert.deepEqual(colors[0], green)
  // The split triangle: filament 1, 2, 1 and 3 (state 3 is filament 3).
  assert.deepEqual(colors.slice(1, 5), [red, green, red, blue])
  // Unpainted: the object's filament (3).
  assert.deepEqual(colors[5], blue)
  // Placed at (125, 125) on the plate, Z up turned to Y up.
  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(scene)
  assert.deepEqual(box.min.toArray().map((v) => Math.round(v * 1000) / 1000), [125, 0, -129])
  assert.deepEqual(box.max.toArray().map((v) => Math.round(v * 1000) / 1000), [129, 4, -125])
})

test('3mf: basematerials colour whole triangles; a file without colours is plain', () => {
  const withMaterials = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="${CORE}">
 <resources>
  <basematerials id="1">
   <base name="Red" displaycolor="#FF0000"/>
   <base name="Blue" displaycolor="#0000FFFF"/>
  </basematerials>
  <object id="2" type="model" pid="1" pindex="0">
   <mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2"/>
     <triangle v1="0" v2="1" v3="3" pid="1" p1="1"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="2"/></build>
</model>`
  const colored = parseThreeMf(archive({ '_rels/.rels': RELS, '3D/3dmodel.model': withMaterials }))
  assert.equal(colored.colored, true)
  assert.deepEqual(triangleColors(meshesOf(colored.scene)[0]), [linear('#FF0000'), linear('#0000FF')])

  const plain = parseThreeMf(archive({ '3D/3dmodel.model': withMaterials.replace(' pid="1" pindex="0"', '').replace(' pid="1" p1="1"', '') }))
  assert.equal(plain.colored, false)
  assert.equal(plain.triangles, 2)
  assert.equal(meshesOf(plain.scene)[0].geometry.getAttribute('color'), undefined)

  assert.throws(() => parseThreeMf(archive({ 'readme.txt': 'no model' })), /no 3D model/)
  assert.equal(isZip(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0])), false)
})

const single = (resources, build = '<build><item objectid="2"/></build>', head = '') => `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="${CORE}" xmlns:p="${PROD}">${head}
 <resources>${resources}</resources>
 ${build}
</model>`
const TETRA = '<vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices>'

test('3mf: triangles naming missing vertices are left out; unreadable coordinates are 0', () => {
  const xml = single(`<object id="2" type="model"><mesh>
   <vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="abc" y="0"/></vertices>
   <triangles>
    <triangle v1="0" v2="1" v3="2"/>
    <triangle v1="0" v2="1" v3="9"/>
    <triangle v1="-1" v2="1" v3="2"/>
    <triangle v1="0" v2="1"/>
    <triangle v1="0" v2="1" v3="3"/>
   </triangles></mesh></object>`)
  const { scene, triangles } = parseThreeMf(archive({ '3D/3dmodel.model': xml }))
  assert.equal(triangles, 2)
  const [mesh] = meshesOf(scene)
  const position = mesh.geometry.getAttribute('position')
  assert.equal(position.count, 6)
  for (let i = 0; i < position.array.length; i++) assert.ok(Number.isFinite(position.array[i]))
  assert.equal(mesh.geometry.userData.sourceTriangles, 2)
  assert.equal(mesh.geometry.userData.sourceVertices, 4)
})

test('3mf: a colorgroup colours each corner', () => {
  const xml = single(`<colorgroup id="5"><color color="#FF0000"/><color color="#00FF00"/><color color="#0000FF"/></colorgroup>
  <object id="2" type="model"><mesh>${TETRA}<triangles><triangle v1="0" v2="1" v3="2" pid="5" p1="0" p2="1" p3="2"/></triangles></mesh></object>`)
  const { scene, colored } = parseThreeMf(archive({ '3D/3dmodel.model': xml }))
  assert.equal(colored, true)
  const c = meshesOf(scene)[0].geometry.getAttribute('color')
  const corners = [0, 1, 2].map((i) => [c.getX(i), c.getY(i), c.getZ(i)].map((v) => Number(v.toFixed(4))))
  assert.deepEqual(corners, [linear('#FF0000'), linear('#00FF00'), linear('#0000FF')])
})

test('3mf: past the split budget a painted triangle is drawn whole in the filament covering most of it', () => {
  const xml = single(`<object id="2" type="model"><mesh>${TETRA}<triangles><triangle v1="0" v2="1" v3="2" paint_color="1C8883888388838883"/></triangles></mesh></object>`)
  const data = archive({ '3D/3dmodel.model': xml, 'Metadata/project_settings.config': JSON.stringify({ filament_colour: ['#FF0000', '#00FF00'] }) })
  const whole = parseThreeMf(data, { splitBudget: 4 })
  const [mesh] = meshesOf(whole.scene)
  assert.equal(mesh.geometry.getAttribute('position').count, 3)
  assert.deepEqual(triangleColors(mesh), [linear('#00FF00')])
  // Within the budget it is split into its 13 pieces; the face count stays the file's own.
  const split = parseThreeMf(data)
  assert.equal(meshesOf(split.scene)[0].geometry.getAttribute('position').count, 39)
  assert.equal(split.triangles, 1)
})

test('3mf: components that contain themselves are followed once', () => {
  const xml = single(`<object id="1" type="model"><mesh>${TETRA}<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh>
   <components><component objectid="2"/></components></object>
  <object id="2" type="model"><components><component objectid="1"/><component objectid="2"/></components></object>`)
  const { scene, triangles } = parseThreeMf(archive({ '3D/3dmodel.model': xml }))
  assert.equal(triangles, 1)
  assert.equal(meshesOf(scene).length, 1)
})

test('3mf: a slicer object\'s negative and modifier parts are not drawn', () => {
  const parts = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="${CORE}"><resources>
 <object id="1" type="model"><mesh>${TETRA}<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
 <object id="3" type="model"><mesh>${TETRA}<triangles><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="2" v3="3"/></triangles></mesh></object>
 <object id="4" type="model"><mesh>${TETRA}<triangles><triangle v1="1" v2="2" v3="3"/></triangles></mesh></object>
</resources><build/></model>`
  const root = single(`<object id="2" type="model"><components>
   <component p:path="/3D/Objects/o.model" objectid="1"/><component p:path="/3D/Objects/o.model" objectid="3"/><component p:path="/3D/Objects/o.model" objectid="4"/>
  </components></object>`)
  const settings = '<config><object id="2"><part id="1" subtype="normal_part"/><part id="3" subtype="negative_part"></part><part id="4" subtype="modifier_part"></part></object></config>'
  const { triangles } = parseThreeMf(archive({ '_rels/.rels': RELS, '3D/3dmodel.model': root, '3D/Objects/o.model': parts, 'Metadata/model_settings.config': settings }))
  assert.equal(triangles, 1)
})

test('3mf: CDATA and comments are skipped; an archive past the size limit is refused', () => {
  const xml = single(
    `<object id="2" type="model"><mesh>${TETRA}<triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`,
    '<build><item objectid="2"/></build>',
    '<metadata name="note"><![CDATA[ <build><item objectid="2"/></build> ]]></metadata><!-- <item objectid="2"/> -->',
  )
  assert.equal(parseThreeMf(archive({ '3D/3dmodel.model': xml })).triangles, 1)
  assert.throws(() => parseThreeMf(archive({ '3D/3dmodel.model': xml }), { maxUnzipped: 100 }), /too large/)
  assert.throws(() => parseThreeMf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0])), /zip|3MF/i)
})
