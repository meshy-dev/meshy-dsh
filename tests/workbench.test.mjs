// Offline unit tests for the pure client logic: tool cards (result.meta and the legacy trailer),
// Studio assets, titles, prompts, the Meshy entries' handoff to the composer, composer insertion,
// addresses and EN/ZH locale parity.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  actionPrompt, agoText, assetsOf, cardOf, COMMAND_ENTRIES, displayPath, ENTRIES, entryPrompt, fileAddress, findAsset,
  kindOf, mention, parseMeshyCard, phaseOf, putInComposer, runEntry, sessionFileOf, titleOf,
} from '../src/client/workbench.ts'
import { en, zh, NS } from '../src/client/locales.ts'

test('locales: en and zh have exact key parity and non-empty strings', () => {
  assert.equal(NS, 'meshy')
  const enKeys = Object.keys(en).sort()
  const zhKeys = Object.keys(zh).sort()
  assert.deepEqual(zhKeys, enKeys, 'zh and en must expose identical keys')
  for (const key of enKeys) {
    assert.ok(typeof en[key] === 'string' && en[key].length > 0, `en.${key} must be non-empty`)
    assert.ok(typeof zh[key] === 'string' && zh[key].length > 0, `zh.${key} must be non-empty`)
  }
  // The three tools have localized titles, and every entry a label and a detail line.
  for (const tool of ['meshy', 'meshy_sign_in', 'meshy_preview_model']) {
    assert.ok(`tool.name.${tool}` in en, `missing key for ${tool}`)
  }
  for (const { id } of COMMAND_ENTRIES) {
    assert.ok(`entry.${id}` in en && `entry.${id}.detail` in en, `missing entry strings for ${id}`)
  }
  // Every Studio next step has a label.
  for (const id of ['uvUnwrap', 'printMenu', 'printCheck', 'printRepair', 'multiColor', 'splitParts', 'resize', 'slicer']) {
    assert.ok(`action.${id}` in en, `missing action label for ${id}`)
  }
  assert.ok(!Object.keys(en).some((k) => k.startsWith('create.')), 'the chat tab is gone, and its strings with it')
})

test('entries: four requests in the UI language, saved images named first, never a CLI option', () => {
  assert.deepEqual(ENTRIES.map((e) => [e.id, e.images?.max ?? 0]), [['imageTo3d', 4], ['textTo3d', 0], ['textToImage', 0], ['editImage', 5]])
  assert.equal(entryPrompt('imageTo3d', ['meshy_input/fox.png'], 'zh'), '@meshy_input/fox.png 用这张图片生成 3D 模型。')
  assert.equal(entryPrompt('imageTo3d', ['meshy_input/a.png', 'meshy_input/b.png'], 'zh'), '@meshy_input/a.png @meshy_input/b.png 用这几张图片生成 3D 模型，它们是同一个物体的不同角度。')
  assert.equal(entryPrompt('imageTo3d', ['meshy_input/fox.png'], 'en'), '@meshy_input/fox.png Make a 3D model from this image.')
  assert.equal(entryPrompt('imageTo3d', ['a.png', 'b.png', 'c.png'], 'en'), '@a.png @b.png @c.png Make a 3D model from these images. They show the same object from different angles.')
  assert.equal(entryPrompt('textTo3d', [], 'zh'), '生成一个 3D 模型：')
  assert.equal(entryPrompt('textTo3d', [], 'en'), 'Make a 3D model of ')
  assert.equal(entryPrompt('textToImage', [], 'zh'), '生成一张图片：')
  assert.equal(entryPrompt('textToImage', [], 'en'), 'Make an image of ')
  assert.equal(entryPrompt('editImage', ['meshy_input/cat.webp'], 'zh'), '@meshy_input/cat.webp 修改这张图片：')
  assert.equal(entryPrompt('editImage', ['meshy_input/cat.webp'], 'en'), '@meshy_input/cat.webp Edit this image: ')
  assert.equal(mention('meshy_input/my cat.png'), '@"meshy_input/my cat.png"')
  for (const { id } of ENTRIES) {
    for (const locale of ['en', 'zh']) assert.doesNotMatch(entryPrompt(id, ['x.png'], locale), /--|meshy-\d|credits|积分/)
  }
})

test('entries: images are picked, saved, then named; nothing is put in the composer on cancel or failure', async () => {
  const file = (name) => ({ name, size: 10 })
  const run = async (entry, picked, { failSave = false } = {}) => {
    const log = []
    const result = await runEntry(entry, 'zh', {
      pick: async (multiple) => { log.push(['pick', multiple]); return picked },
      save: async (f) => { if (failSave) throw new Error('disk full'); log.push(['save', f.name]); return `meshy_input/${f.name}` },
      put: async (text) => { log.push(['put', text]); return 'composer' },
      onSaving: () => log.push(['saving']),
    })
    return { result, log }
  }
  const [imageTo3d, textTo3d, , editImage] = ENTRIES
  const one = await run(imageTo3d, [file('fox.png')])
  assert.deepEqual(one.result, { status: 'composer' })
  assert.deepEqual(one.log, [['pick', true], ['saving'], ['save', 'fox.png'], ['put', '@meshy_input/fox.png 用这张图片生成 3D 模型。']])
  const views = await run(imageTo3d, [file('front.png'), file('side.png')])
  assert.match(views.log.at(-1)[1], /^@meshy_input\/front\.png @meshy_input\/side\.png 用这几张图片/)
  assert.deepEqual((await run(imageTo3d, [])).result, { status: 'cancelled' })
  assert.deepEqual((await run(imageTo3d, [1, 2, 3, 4, 5].map((n) => file(`${n}.png`)))).result, { status: 'tooMany', max: 4 })
  const failed = await run(editImage, [file('cat.png')], { failSave: true })
  assert.deepEqual(failed.result, { status: 'failed', message: 'disk full' })
  assert.ok(!failed.log.some(([step]) => step === 'put'))
  // A text entry asks for no image.
  const text = await run(textTo3d, [])
  assert.deepEqual(text.log, [['put', '生成一个 3D 模型：']])
})

test('entries: /meshy adds Creative Lab (one photo) to the Studio\'s four; its request asks the agent to offer the products', () => {
  assert.deepEqual(COMMAND_ENTRIES.map((e) => e.id), [...ENTRIES.map((e) => e.id), 'creativeLab'])
  assert.ok(!ENTRIES.some((e) => e.id === 'creativeLab'), 'Creative Lab is not in the Studio')
  assert.equal(COMMAND_ENTRIES.at(-1).images.max, 1)
  assert.equal(entryPrompt('creativeLab', ['meshy_input/cat.jpg'], 'zh'), '@meshy_input/cat.jpg 用这张照片在 Meshy 创意工坊做一个可以打印的小物件：先列出可以做哪些，再问我选哪个。')
  assert.match(entryPrompt('creativeLab', ['meshy_input/cat.jpg'], 'en'), /^@meshy_input\/cat\.jpg Make a printable keepsake from this photo with Meshy Creative Lab/)
})

test('actionPrompt: the print steps, UV unwrap and the slicer are requests naming the model', () => {
  const target = { taskId: '0190abc', file: 'meshy_output/chest.glb' }
  for (const kind of ['uvUnwrap', 'printCheck', 'printRepair', 'multiColor', 'splitParts', 'resize', 'slicer']) {
    for (const locale of ['en', 'zh']) {
      const prompt = actionPrompt(kind, target, locale)
      assert.match(prompt, /meshy_output\/chest\.glb/, `${kind} ${locale}`)
      assert.doesNotMatch(prompt, /--|credit|积分/, `${kind} ${locale} names no option or price`)
    }
  }
  assert.equal(actionPrompt('multiColor', target, 'en'), 'Make a multi-color 3MF of meshy_output/chest.glb (task 0190abc) for printing, with this many colors: ')
})

test('actionPrompt: export is a request for the agent, with or without a format', () => {
  const target = { taskId: '0190abc', file: 'meshy_output/chest.glb' }
  assert.equal(actionPrompt('export', { ...target, format: 'fbx' }, 'zh'), '把 meshy_output/chest.glb (任务 0190abc) 导出为 FBX 格式，保存到工作区。')
  assert.equal(actionPrompt('export', { ...target, format: 'fbx' }, 'en'), 'Export meshy_output/chest.glb (task 0190abc) as FBX into the workspace.')
  assert.equal(actionPrompt('export', { ...target, format: '' }, 'zh'), '把 meshy_output/chest.glb (任务 0190abc) 转换为其他格式：')
  assert.equal(actionPrompt('convert', target, 'zh'), '把 meshy_output/chest.glb (任务 0190abc) 转换为其他格式：')
  assert.equal(actionPrompt('convert', target, 'en'), 'Convert meshy_output/chest.glb (task 0190abc) to ')
})

test('parseMeshyCard: extracts structured JSON trailer and strips it from body', () => {
  const raw = [
    'Generated 3D preview for "Wooden chest".',
    'Saved GLB to meshy_output/chest.glb (20 credits).',
    'MESHY_CARD: {"tool":"meshy_text_to_3d_preview","status":"succeeded","resource":"text-to-3d","stage":"preview","taskId":"0190-abc","title":"Wooden chest","file":"meshy_output/chest.glb","credits":20}',
  ].join('\n')
  const { card, body } = parseMeshyCard(raw)
  assert.ok(card)
  assert.equal(card.tool, 'meshy_text_to_3d_preview')
  assert.equal(card.taskId, '0190-abc')
  assert.equal(card.stage, 'preview')
  assert.equal(card.credits, 20)
  assert.equal(card.file, 'meshy_output/chest.glb')
  assert.ok(!body.includes('MESHY_CARD:'), 'trailer must be stripped from human body')
  assert.equal(body, 'Generated 3D preview for "Wooden chest".\nSaved GLB to meshy_output/chest.glb (20 credits).')
})

test('parseMeshyCard: safely falls back on missing or malformed trailer', () => {
  const plain = parseMeshyCard('Just plain output text.')
  assert.equal(plain.card, null)
  assert.equal(plain.body, 'Just plain output text.')

  const malformed = parseMeshyCard('Line 1\nMESHY_CARD: {not valid json')
  assert.equal(malformed.card, null)
  assert.equal(malformed.body, 'Line 1\nMESHY_CARD: {not valid json')

  const arrayTrailer = parseMeshyCard('Line 1\nMESHY_CARD: [1, 2, 3]')
  assert.equal(arrayTrailer.card, null)

  const empty = parseMeshyCard('')
  assert.equal(empty.card, null)
  assert.equal(empty.body, '')
})

test('phaseOf: classifies task lifecycle statuses accurately', () => {
  assert.equal(phaseOf({ status: 'PENDING', submitError: null }), 'active')
  assert.equal(phaseOf({ status: 'IN_PROGRESS', submitError: null }), 'active')
  assert.equal(phaseOf({ status: null, submitError: null }), 'active')
  assert.equal(phaseOf({ status: 'SUCCEEDED', submitError: null }), 'done')
  assert.equal(phaseOf({ status: 'FAILED', submitError: null }), 'failed')
  assert.equal(phaseOf({ status: 'EXPIRED', submitError: null }), 'failed')
  assert.equal(phaseOf({ status: 'SUCCEEDED', submitError: 'network' }), 'failed')
  assert.equal(phaseOf({ status: 'PENDING', journal: 'failed' }), 'failed')
  assert.equal(phaseOf({ status: 'CANCELED', submitError: null }), 'canceled')
  assert.equal(phaseOf({ status: 'CANCELLED', submitError: null }), 'canceled')
})

test('titleOf: picks title or name, saved file name, truncated prompt, resource label, or taskId', () => {
  assert.equal(titleOf({ name: '  Treasure Chest  ', resource: 'text-to-3d', taskId: 'abc' }), 'Treasure Chest')
  assert.equal(titleOf({ title: 'Knight', name: 'other' }), 'Knight')
  assert.equal(titleOf({ localFile: 'meshy_output/round-shield.glb', prompt: 'a shield' }), 'round-shield')
  const longPrompt = 'A very detailed ornate medieval wooden treasure chest with iron bands and gold coins spilling out'
  const truncated = titleOf({ prompt: longPrompt, resource: 'text-to-3d', taskId: 'abc' }, 30)
  assert.ok(truncated.length <= 30)
  assert.ok(truncated.endsWith('…'))
  assert.equal(titleOf({ resource: 'retexture', taskId: 'abc' }), 'Retexture')
  assert.equal(titleOf({ resource: 'text-to-image', taskId: 'abc' }, 56, 'zh'), '文生图')
  assert.equal(titleOf({ resource: '', taskId: '01901234567890' }), '019012345678')
})

test('agoText: formats compact relative times in English and Chinese', () => {
  const now = 1_700_000_000_000
  assert.equal(agoText(now - 10_000, now, 'en'), 'just now')
  assert.equal(agoText(now - 10_000, now, 'zh'), '刚刚')
  assert.equal(agoText(now - 5 * 60_000, now, 'en'), '5m ago')
  assert.equal(agoText(now - 5 * 60_000, now, 'zh'), '5 分钟前')
  assert.equal(agoText(now - 3 * 3600_000, now, 'en'), '3h ago')
  assert.equal(agoText(now - 3 * 3600_000, now, 'zh'), '3 小时前')
  assert.equal(agoText(now - 4 * 86_400_000, now, 'en'), '4d ago')
  assert.equal(agoText(now - 4 * 86_400_000, now, 'zh'), '4 天前')
  assert.equal(agoText(null, now, 'en'), '')
})

test('actionPrompt: produces context-aware EN and ZH prompts referencing task/file', () => {
  const refineEn = actionPrompt('refine', { taskId: '0190-prev', resource: 'text-to-3d' }, 'en')
  assert.match(refineEn, /0190-prev/)
  assert.match(refineEn, /Refine/i)

  const refineZh = actionPrompt('refine', { taskId: '0190-prev', resource: 'text-to-3d' }, 'zh')
  assert.match(refineZh, /0190-prev/)
  assert.match(refineZh, /Refine/)

  const imgEn = actionPrompt('imageTo3d', { taskId: 'img-1', file: 'meshy_output/hero.png' }, 'en')
  assert.match(imgEn, /meshy_output\/hero\.png/)
  assert.match(imgEn, /img-1/)

  const libZh = actionPrompt('useInSession', { taskId: '0190-lib', resource: 'image-to-3d', title: 'Shiba' }, 'zh')
  assert.match(libZh, /0190-lib/)
  assert.match(libZh, /Shiba/)
})

test('putInComposer: replaces only an empty draft, inserts otherwise, falls back to the clipboard', async () => {
  const calls = []
  const actions = {
    setDraft(text) { calls.push(['setDraft', text]) },
    captureInsertion() { return 'span' },
    insertText(text, span) { calls.push(['insertText', text, span]); return true },
  }
  assert.equal(await putInComposer({ inputActions: actions, draftEmpty: true }, 'Refine task 123'), 'composer')
  assert.deepEqual(calls.pop(), ['setDraft', 'Refine task 123'])

  assert.equal(await putInComposer({ inputActions: actions, draftEmpty: false }, 'Remesh it'), 'composer')
  assert.deepEqual(calls.pop(), ['insertText', '\nRemesh it', 'span'])

  // Unknown draft state never overwrites: insert at the caret without a leading newline.
  assert.equal(await putInComposer({ inputActions: actions }, 'Rig it'), 'composer')
  assert.deepEqual(calls.pop(), ['insertText', 'Rig it', 'span'])

  let copied = ''
  const viaClipboard = await putInComposer(
    { inputActions: { setDraft() { throw new Error('gone') } }, draftEmpty: true, copy: async (text) => { copied = text; return true } },
    'Remesh model',
  )
  assert.equal(viaClipboard, 'copied')
  assert.equal(copied, 'Remesh model')

  assert.equal(await putInComposer({}, 'Nothing available'), 'none')
})

test('sessionFileOf and displayPath: parse resource addresses and normalize paths', () => {
  assert.deepEqual(
    sessionFileOf('dsh-resource://file/session/abc%201/meshy_output/my%20model.glb'),
    { sessionId: 'abc 1', path: 'meshy_output/my model.glb' },
  )
  assert.equal(sessionFileOf('https://example.com/a.glb'), undefined)
  assert.equal(displayPath('/work/proj/meshy_output/chest.glb', '/work/proj'), 'meshy_output/chest.glb')
  assert.equal(displayPath('./meshy_output\\chest.glb'), 'meshy_output/chest.glb')
})

test('cardOf: prefers result.meta and strips a legacy trailer from the text', () => {
  const meta = { tool: 'meshy_image_to_3d', status: 'submitted', taskId: 't1', jobId: 'j1' }
  assert.deepEqual(cardOf(meta, 'Submitted.'), { card: meta, body: 'Submitted.' })
  const legacy = cardOf(undefined, 'Done.\nMESHY_CARD: {"tool":"meshy_retexture","taskId":"t2"}')
  assert.equal(legacy.card?.taskId, 't2')
  assert.equal(legacy.body, 'Done.')
  assert.deepEqual(cardOf({ unrelated: true }, 'plain'), { card: null, body: 'plain' })
})

test('kindOf: what a task produced, a guess from its name while it runs, and reports left out', () => {
  assert.equal(kindOf({ resource: 'image-to-3d' }), 'model')
  assert.equal(kindOf({ resource: 'multi-image-to-3d' }), 'model')
  assert.equal(kindOf({ resource: 'text-to-image' }), 'image')
  assert.equal(kindOf({ resource: 'image-to-image' }), 'image')
  assert.equal(kindOf({ kind: 'image', resource: 'text-to-3d' }), 'image')
  // A finished printability check has no model or image: the Studio leaves it out.
  assert.equal(kindOf({ kind: 'none', resource: 'analyze-printability' }), null)
  // A multi-color print's 3MF is a model.
  assert.equal(kindOf({ kind: 'model', resource: 'multi-color-print' }), 'model')
  assert.equal(kindOf({}), null)
})

test('assetsOf: splits models from images, expands multi-image tasks, keeps workspace models to this session', () => {
  const T0 = 1_700_000_000_000
  const now = T0 + 3_600_000
  const tasks = [
    { id: 'a', resource: 'text-to-3d', taskId: 'm1', type: 'text-to-3d-preview', status: 'SUCCEEDED', progress: 100, startedAt: T0 + 10, createdAt: T0 + 10, localFile: 'meshy_output/chest.glb' },
    { id: 'b', resource: 'text-to-image', taskId: 'i1', status: 'SUCCEEDED', progress: 100, startedAt: T0 + 20, createdAt: T0 + 20, localFile: 'meshy_output/hero.png', files: ['meshy_output/hero.png', 'meshy_output/hero-2.png'] },
    { id: 'c', resource: 'image-to-3d', taskId: 'm2', status: 'IN_PROGRESS', progress: 42.4, startedAt: T0 + 5, createdAt: T0 + 5 },
    { id: 'd', resource: 'image-to-3d', taskId: 'm3', status: 'PENDING', progress: 0, startedAt: T0 + 4, createdAt: T0 + 4, stale: true },
    { id: 'e', resource: 'analyze-printability', kind: 'none', taskId: 'p1', status: 'SUCCEEDED', progress: 100, startedAt: T0 + 30, createdAt: T0 + 30 },
    { id: 'f', resource: 'retexture', taskId: null, status: null, progress: null, startedAt: T0 },
    { id: 'g', resource: 'retexture', taskId: 'gone', status: null, progress: null, startedAt: T0 + 6, readError: 'meshy api 404 on /retexture/gone: Task not found' },
  ]
  const models = [
    { file: 'meshy_output/chest.glb', size: 10, mtimeMs: T0 + 11 },
    { file: 'props/barrel.glb', size: 10, mtimeMs: T0 + 15 },
    { file: 'other-session/old.glb', size: 10, mtimeMs: T0 - 86_400_000 },
    { file: '.cache/scratch.glb', size: 10, mtimeMs: T0 + 40 },
  ]
  const assets = assetsOf(tasks, models, 'en', { now })
  assert.deepEqual(assets.map((a) => a.key), ['task:m2', 'task:i1', 'task:i1#1', 'file:props/barrel.glb', 'task:m1'])
  const running = assets[0]
  assert.equal(running.phase, 'active')
  assert.equal(running.progress, 42)
  assert.equal(assets.find((a) => a.key === 'task:m1').stage, 'preview')
  assert.deepEqual(assets.filter((a) => a.kind === 'image').map((a) => a.file), ['meshy_output/hero.png', 'meshy_output/hero-2.png'])

  // A file opened explicitly counts even when it predates the session or is hidden.
  const withOld = assetsOf(tasks, models, 'en', { now, include: new Set(['other-session/old.glb']) })
  assert.ok(withOld.some((a) => a.key === 'file:other-session/old.glb'))
  assert.ok(!withOld.some((a) => a.key === 'file:.cache/scratch.glb'))
  // With no Meshy task in the session, only explicitly opened files show.
  assert.deepEqual(assetsOf([], models, 'en', { now }).map((a) => a.key), [])

  assert.equal(findAsset(assets, { taskId: 'i1', file: 'meshy_output/hero-2.png' })?.key, 'task:i1#1')
  assert.equal(findAsset(assets, { taskId: 'i1' })?.key, 'task:i1')
  assert.equal(findAsset(assets, { file: './props/barrel.glb' })?.key, 'file:props/barrel.glb')
  assert.equal(findAsset(assets, { taskId: 'nope' }), undefined)
})

test('fileAddress: round-trips through sessionFileOf', () => {
  const address = fileAddress('abc 1', './meshy_output/my model.glb')
  assert.equal(address, 'dsh-resource://file/session/abc%201/meshy_output/my%20model.glb')
  assert.deepEqual(sessionFileOf(address), { sessionId: 'abc 1', path: 'meshy_output/my model.glb' })
})

test('assetsOf: a rig shows its source model name and picture and is marked animated', () => {
  const T0 = 1_700_000_000_000
  const tasks = [
    { id: 'm', resource: 'image-to-3d', taskId: 'src1', status: 'SUCCEEDED', progress: 100, startedAt: T0, createdAt: T0, title: 'Husky', thumbnail: 'https://assets.meshy.ai/husky.png' },
    { id: 'r', resource: 'rigging', taskId: 'rig1', status: 'SUCCEEDED', progress: 100, startedAt: T0 + 10, createdAt: T0 + 10, parentTaskId: 'src1', variants: ['rigged', 'walking', 'running'] },
  ]
  const rig = assetsOf(tasks, [], 'en', { now: T0 + 60_000 }).find((a) => a.taskId === 'rig1')
  assert.equal(rig.title, 'Husky · Rigging')
  assert.equal(rig.thumbnail, 'https://assets.meshy.ai/husky.png')
  assert.equal(rig.animated, true)
  assert.deepEqual(rig.variants, ['rigged', 'walking', 'running'])
  const files = assetsOf([tasks[0]], [{ file: 'meshy_output/husky-walking.glb', size: 1, mtimeMs: T0 + 5 }], 'en', { now: T0 + 60_000 })
  assert.equal(files.find((a) => a.file === 'meshy_output/husky-walking.glb').animated, true)
  assert.equal(actionPrompt('animate', { taskId: 'rig1' }, 'en'), 'Give the rigged task rig1 another animation: ')
})
