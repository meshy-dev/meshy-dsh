// Browser half: the "Meshy" settings section (also the meshy-dsh page in Plugins), Meshy Studio
// in the right sidebar (for the session's project file and for .glb files) and the cards of the
// Studio tools. React and dsh's component library come from the host's seed table; three.js lives
// in the client.viewer.js chunk, fetched on first preview. Layout follows dsh's own Account
// section (cards, rows, dividers, theme tokens); Meshy's lime marks only the primary actions and
// the signed-in state.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Button, Modal, SegmentedControl, StateDot, TextShimmer, Tooltip, writeClipboard,
  IconCheckOutlineRegular, IconChevronRightOutlineRegular, IconCopyOutlineRegular,
  IconRefreshOutlineRegular, IconRightUpOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import qrcode from 'qrcode-generator'
import { api, sessionFileOf, setWorkspaceFiles, versionOf, type WorkspaceFiles } from './files.ts'
import { OpenStudioCard, ProjectRow, Studio, type InputActions } from './studio.tsx'

/** The package icon as a data URL, inlined at build time. */
declare const __MESHY_ICON__: string
/** The media kit's black logo, cropped to the icon and drawn in currentColor (SVG markup). */
declare const __MESHY_MONO__: string

type T = (key: string, params?: Record<string, string | number>) => string
// Partial projections of the dsh client services this file uses.
type Ctx = {
  uiWorkspace: { startSession(workspaceId?: string, options?: { prompt?: string; whenDraftExists?: 'keep' | 'replace' | 'append' }): void }
  slots: { inject(name: string, register: () => () => void): () => void; register(spec: object, component: unknown): () => void }
  locale: { register(ns: string, dicts: object): () => void; bind(ns: string): T }
  documentPreviews: { register(definition: object): () => void }
  remote: { workspaceFiles: WorkspaceFiles }
  pluginNavigation: { openBundle(packageName: string): void }
  effect(execute: () => () => unknown, label?: string): unknown
  inject(deps: string[], callback: (ctx: Ctx) => void): unknown
}

export const name = 'meshy-dsh-client'
export const inject = ['slots', 'locale']

const NS = 'meshy'
const GLB_ID = 'meshy-dsh/glb'
/** The session's Meshy project file (`meshy_output/project.meshy`), shown as Meshy Studio. */
const STUDIO_ID = 'meshy-dsh/studio'
/** The left-sidebar entry and its page in the main column share this id. */
const PAGE_ID = 'meshy'
const EXAMPLES = ['chest', 'photo', 'character', 'print'] as const
const SITES = {
  global: { web: 'https://www.meshy.ai', docs: 'https://docs.meshy.ai', host: 'meshy.ai' },
  cn: { web: 'https://meshy.cn', docs: 'https://docs.meshy.cn', host: 'meshy.cn' },
} as const
type Site = keyof typeof SITES

// Mainland China time zones: a viewer there most likely cannot open meshy.ai, so the China site
// is the default until a signed-in account or the viewer's own choice says otherwise.
const CN_ZONES = new Set(['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'Asia/Urumqi', 'Asia/Kashgar', 'PRC'])
function guessSite(): Site {
  try { return CN_ZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone) ? 'cn' : 'global' } catch { return 'global' }
}
// One site for every Meshy view on the page (settings, plugin page, sidebar page and its links).
let currentSite: Site = guessSite()
const siteListeners = new Set<() => void>()
function setSite(next: Site) {
  if (next === currentSite) return
  currentSite = next
  for (const notify of siteListeners) notify()
}
function useSite(): Site {
  return useSyncExternalStore((notify) => { siteListeners.add(notify); return () => { siteListeners.delete(notify) } }, () => currentSite)
}
/** Docs in the reader's language on the global site; the China site serves Chinese by default. */
function docsUrl(site: Site): string {
  return site === 'global' && /^zh/i.test(globalThis.navigator?.language ?? '') ? `${SITES.global.docs}/zh` : SITES[site].docs
}

// This plugin's version and the newer release a reinstall would bring (the host decides, and
// offers a release only once dsh's installer would pick it). One copy for the panel and the
// sidebar mark; read when the client starts, every six hours, and on the panel's refresh.
const PACKAGE = 'meshy-dsh'
const RELEASES = 'https://github.com/meshy-dev/meshy-dsh/releases/tag'
const UPDATE_POLL_MS = 6 * 3600_000
type Plugin = { version: string; update: string | null }
let plugin: Plugin | undefined
const pluginListeners = new Set<() => void>()
async function readPlugin() {
  try {
    const { status, data } = await api('meshy.update')
    if (status !== 200 || typeof data?.version !== 'string') return
    plugin = { version: data.version, update: typeof data.update === 'string' ? data.update : null }
    for (const notify of pluginListeners) notify()
  } catch {
    // No notice is the safe default.
  }
}
function usePlugin(): Plugin | undefined {
  return useSyncExternalStore((notify) => { pluginListeners.add(notify); return () => { pluginListeners.delete(notify) } }, () => plugin)
}
/** Set while the Plugins page's navigation service is mounted: opens this plugin's page there. */
let openBundle: ((packageName: string) => void) | undefined

const en = {
  nav: 'Meshy',
  accountTitle: 'Meshy account',
  summary: 'Sign in to Meshy and preview GLB models in 3D.',
  tagline: 'Text and images to 3D models, right in DeepSeek Harness',
  checking: 'Checking…',
  signedIn: 'Signed in',
  signedOut: 'Not signed in',
  unverified: 'Needs attention',
  'unverified.hint': 'The saved sign-in could not be verified. Refresh, or sign in again.',
  site: 'Site',
  'site.global': 'Global',
  'site.cn': 'China',
  account: 'Account',
  credits: 'Credits',
  'credits.get': 'Get credits',
  method: 'Signed in with',
  'method.browser': 'Browser',
  'method.apiKey': 'API key',
  more: 'Manage account',
  signIn: 'Sign in to Meshy',
  'signIn.hint': 'Approve in your browser once; the Meshy skills then use this sign-in.',
  'signIn.scan': 'Scan with your phone, or open the link',
  'signIn.scanHint': 'Sign in to {host} and approve. This page finishes on its own.',
  'signIn.code': 'Code',
  'signIn.open': 'Open in browser',
  'signIn.waiting': 'Waiting for your approval…',
  copy: 'Copy code',
  copied: 'Copied',
  cancel: 'Cancel',
  retry: 'Try again',
  refresh: 'Refresh',
  signOut: 'Sign out',
  'signOut.title': 'Sign out of Meshy?',
  'signOut.body': 'The Meshy skills in DeepSeek Harness will ask you to sign in again before they generate.',
  close: 'Close',
  cli: 'Meshy CLI {version}',
  versions: 'Meshy plugin {plugin} · CLI {cli}',
  'update.title': 'Meshy plugin {version} is available',
  'update.hint': 'You have {current}. To update, uninstall Meshy on its plugin page, then add meshy-dsh again with Add plugin. You stay signed in.',
  'update.hintHere': 'You have {current}. To update, uninstall Meshy on this page, then add meshy-dsh again with Add plugin. You stay signed in.',
  'update.open': 'Open plugin page',
  'update.notes': "What's new",
  'error.cli': 'Meshy CLI not found',
  'error.cliHint': 'Reinstall the Meshy plugin under Plugins, then refresh.',
  'error.expired': 'The code expired. Start again for a new one.',
  'error.generic': 'Something went wrong: {message}',
  'viewer.title': '3D model',
  'viewer.loading': 'Loading model…',
  'viewer.failed': 'This model cannot be shown',
  'viewer.tooLarge': 'The model is {size}, over the {limit} preview limit. Remesh it to fewer faces to preview it.',
  'viewer.triangles': '{count} triangles',
  'viewer.reset': 'Reset view',
  'viewer.spin': 'Auto-rotate',
  'viewer.stop': 'Stop rotating',
  'page.tagline': 'Turn text and images into 3D models, rig and animate them, or get them ready to print.',
  'page.start': 'Start creating',
  'page.startHint': 'Pick one to open a new session with it filled in. Edit it, then send.',
  'page.copyHint': 'Copy one into a session, edit it, then send.',
  'page.try': 'Start a session',
  'page.docs': 'Documentation',
  'page.site': 'Meshy website',
  'example.chest.title': 'Game asset',
  'example.chest.prompt': 'Make a low-poly cartoon treasure chest for my game and export it as GLB.',
  'example.photo.title': 'Photo to 3D',
  'example.photo.prompt': 'Turn the photo I attach into a textured 3D model.',
  'example.character.title': 'Animated character',
  'example.character.prompt': 'Create a cartoon knight, rig it, add a walking animation and export FBX.',
  'example.print.title': '3D print',
  'example.print.prompt': 'Make a 10 cm tall shiba inu figurine and prepare a print-ready 3MF.',
  'viewer.faces': '{count} faces',
  'studio.title': 'Meshy Studio',
  'studio.loading': 'Opening Meshy Studio…',
  'studio.unavailable': 'Meshy Studio cannot open this session',
  'studio.empty': 'No Meshy model in this session yet. Ask for one in the chat, and it shows up here.',
  'studio.signedOut': 'Not signed in to Meshy: sign in under Settings → Meshy to generate and to see progress.',
  'studio.ref': 'the Meshy asset "{name}" (id {id}, file {file})',
  'studio.mode': 'Display',
  'studio.mode.textured': 'Textured',
  'studio.mode.clay': 'Clay',
  'studio.mode.wireframe': 'Wireframe',
  'studio.drafted': 'Added to your message. Edit it if you like, then send.',
  'studio.pinned': 'View captured and added to your message. Say what to change, then send.',
  'studio.copied': 'Copied. Paste it into the chat, then send.',
  'studio.draftFailed': 'Could not add it to your message.',
  'studio.comparing': 'Comparing with {name}',
  'studio.makeCurrent': 'Use this one',
  'studio.versionsLabel': 'Versions of this model',
  'studio.compare': 'Compare',
  'studio.compareOff': 'Stop comparing',
  'studio.compareHint': 'Pick another version to compare it side by side.',
  'studio.credits': '{count} credits',
  'studio.openPins': 'Views waiting for the agent ({count})',
  'studio.angle': '{azimuth}° around, {elevation}° up',
  'studio.dismissPin': 'Dismiss',
  'studio.advanced': 'Advanced',
  'studio.operation': 'Operation',
  'studio.taskId': 'Task id',
  'studio.topology': 'Topology',
  'studio.projectFile': 'Project file',
  'status.running': 'Generating…',
  'status.downloading': 'Finished, saving the files…',
  'status.submitted': 'Submitted, not saved yet',
  'status.submittedHint': 'The agent started this task but never saved its result here. Ask it to download the result.',
  'status.succeeded': 'Ready',
  'status.failed': 'This task failed',
  'op.refine': 'Textured model',
  'card.opening': 'Opening Meshy Studio…',
  'card.failed': 'Meshy Studio could not open',
  'card.assets': '{count} assets',
  'card.open': 'Open Studio',
  'card.reading': 'Reading the Meshy project…',
  'card.read': 'Read the Meshy project: {assets} assets, {pins} views waiting',
  'card.link': 'Linked a new version to its source',
  'card.label': 'Named a Meshy asset',
  'card.resolve_pin': 'Marked a pointed view as done',
  'card.activate': 'Switched the Studio to an asset',
  'studio.flow': 'Workspace',
  'studio.tools': 'Tools',
  'studio.clips': 'Animation clips',
  'studio.restPose': 'Rest pose',
  'studio.related': 'Related assets ({count})',
  'studio.allAssets': 'All assets',
  'studio.mentioned': 'File added to your message.',
  'studio.smartTopology': 'Smart topology',
  'studio.prompt': 'Prompt',
  'studio.creditsLabel': 'Credits',
  'studio.actionsHint': 'Adds a request to your message; nothing is spent until you send it and approve the cost.',
  'tab.image': 'Image',
  'tab.model': 'Model',
  'tab.print': 'Print',
  'tab.animate': 'Animate',
  'tab.assets': 'Assets',
  'stage.image': 'Image',
  'stage.untextured': 'Untextured',
  'stage.textured': 'Textured',
  'stage.rigged': 'Rigged',
  'stage.animated': 'Animated',
  'stage.print': 'Print-ready',
  'gate.notReady': 'Available once this model is finished and saved',
  'gate.smartTopology': 'Smart-topology models are already at their face budget',
  'gate.uvFaces': 'Needs 40,000 faces or fewer: remesh first',
  'gate.needsTexture': 'Texture the model first',
  'gate.animated': 'Pick the rigged or textured version to print',
  'tool.texture': 'Texture',
  'tool.texture.hint': 'Paint textures on this white model',
  'tool.retexture': 'Retexture',
  'tool.retexture.hint': 'A new look on the same shape',
  'tool.remesh': 'Remesh',
  'tool.remesh.hint': 'Face count and topology',
  'tool.uv': 'Unwrap UV',
  'tool.uv.hint': 'A UV white model for your own textures',
  'tool.export': 'Export',
  'tool.export.hint': 'FBX, OBJ, USDZ, STL, 3MF, Blender',
  'tool.check': 'Print check',
  'tool.check.hint': 'Watertight, holes, non-manifold edges',
  'tool.repair': 'Make printable',
  'tool.repair.hint': 'Fix the mesh for printing',
  'tool.multicolor': 'Multi-color',
  'tool.multicolor.hint': 'A colored 3MF for multi-material printers',
  'tool.split': 'Split',
  'tool.split.hint': 'Print in separate parts',
  'tool.resize': 'Size',
  'tool.resize.hint': 'The printed height',
  'tool.slicer': 'Send to slicer',
  'tool.slicer.hint': 'Open the print file in your slicer',
  'tool.rig': 'Rig',
  'tool.rig.hint': 'Add a skeleton to a humanoid',
  'tool.animate': 'Add animations',
  'tool.animate.hint': 'Actions from the animation library',
  'tool.style': 'Style',
  'tool.stylePlaceholder': 'e.g. weathered oak with brass fittings',
  'tool.pbr': 'PBR materials (metal, roughness, normal)',
  'tool.targetFaces': 'Target faces (now {now})',
  'tool.topology': 'Topology',
  'tool.triangle': 'triangles',
  'tool.quad': 'quads',
  'tool.uvHint': 'Outputs an untextured model with clean UVs, for texturing elsewhere. Needs 40,000 faces or fewer.',
  'tool.owned': 'Already in the workspace: {formats}',
  'tool.formats': 'Formats',
  'tool.checkHint': 'Checks whether the mesh is watertight and free of holes and non-manifold edges, and reports before fixing anything.',
  'tool.repairHint': 'Closes holes and fixes non-manifold edges so the model prints. A repaired model can no longer be retextured.',
  'tool.colors': 'Colors at most',
  'tool.parts': 'Parts',
  'tool.partsPlaceholder': 'e.g. lid, body, base (empty: by shape)',
  'tool.height': 'Printed height',
  'tool.slicerPick': 'Slicer',
  'tool.rigHint': 'For a textured humanoid with clear limbs, best in an A or T pose. Walking and running come with the rig.',
  'tool.rigHeight': 'Character height',
  'tool.actions': 'Actions',
  'tool.customAction': 'Other action',
  'tool.customPlaceholder': 'e.g. bow, then wave with the left hand',
  'tool.close': 'Close',
  'tool.send': 'Add to message',
  'slicer.auto': 'Detect',
  'slicer.bambu': 'Bambu Studio',
  'slicer.orca': 'OrcaSlicer',
  'slicer.prusa': 'PrusaSlicer',
  'slicer.cura': 'Cura',
  'anim.idle': 'Idle',
  'anim.walk': 'Walk',
  'anim.run': 'Run',
  'anim.jump': 'Jump',
  'anim.wave': 'Wave',
  'anim.dance': 'Dance',
  'anim.attack': 'Attack',
  'anim.sit': 'Sit',
  'anim.step.rig': 'Rig',
  'anim.step.animate': 'Animate',
  'anim.tooMany': 'This model has {count} faces; rigging takes at most {max}. Remesh it first.',
  'anim.rigFailed': 'Rigging failed. Check the model is a humanoid in an A or T pose, then try again.',
  'anim.needsTexture': 'Rigging works on a textured model: texture it first for the best result.',
  'anim.rigging': 'Rigging…',
  'anim.hasRig': 'This model has a rigged version.',
  'anim.openRig': 'Open the rig',
  'anim.playHint': 'Pick a clip under the model to play it.',
  'anim.riggedHint': 'Rigged: add animations from the library.',
  'anim.made': 'Animations ({count})',
  'list.sep': ', ',
  'draft.texture': 'Texture {ref}{pbr}. Style: {style}',
  'draft.retexture': 'Retexture {ref}{pbr}. Style: {style}',
  'draft.pbr': ' with PBR materials',
  'draft.remesh': 'Remesh {ref} to about {faces} faces in {topology}, keeping its shape.',
  'draft.uv': 'Unwrap the UVs of {ref}, as an untextured model I can texture myself.',
  'draft.export': 'Export {ref} as {formats}.',
  'draft.check': 'Check whether {ref} can be 3D printed (watertight, holes, non-manifold edges) and tell me before fixing anything.',
  'draft.repair': 'Make {ref} printable (close holes, fix non-manifold edges) and prepare the print file.',
  'draft.multicolor': 'Make a multi-color print file (3MF) of {ref} with at most {colors} colors.',
  'draft.split': 'Split {ref} into parts to print separately: {parts}',
  'draft.resize': 'Set the printed height of {ref} to {height} mm.',
  'draft.slicer': 'Open the print file of {ref} in my slicer ({slicer}).',
  'draft.rig': 'Rig {ref} (a humanoid about {height} m tall) so I can animate it.',
  'draft.animate': 'Add these animations to {ref}: {actions}. Use the Meshy animation library, and generate any action it does not have.',
  'draft.build': 'Make a 3D model from {ref}.',
  'draft.editImage': 'Edit the image {ref}: ',
  'draft.concept': 'Draw a concept image first for a 3D model of: ',
  'draft.pin': '{mention}[Meshy pin {pin}] Look at {ref} from this view ({azimuth}° around, {elevation}° up, {faces} faces): ',
  'action.build': 'Make 3D model',
  'action.editImage': 'Edit image',
  'action.newImage': 'New image',
  'action.pin': 'Point the agent here',
  'action.pinHint': 'Capture this view and ask the agent about it',
  'image.empty': 'No image yet. Ask the agent for a concept image first, then turn it into a 3D model.',
  'image.ask': 'Ask for a concept image',
  'image.models': 'Models from this image ({count})',
  'image.all': 'All images ({count})',
  'model.fromImage': 'No 3D model yet. Make one from a concept image in the Image tab.',
  'model.next': 'Next:',
  'assets.open': 'Open',
  'assets.star': 'Star',
  'assets.unstar': 'Unstar',
  'assets.rename': 'Rename',
  'assets.mention': 'Mention',
  'assets.archive': 'Archive',
  'assets.restore': 'Restore',
  'assets.search': 'Search assets',
  'assets.layout': 'Layout',
  'assets.folder': 'By model',
  'assets.grid': 'Grid',
  'assets.filter': 'Filter',
  'assets.none': 'Nothing matches.',
  'assets.related': '{count} assets',
  'assets.footer': '{count} assets · {credits} credits in this session. Archived assets keep their files.',
  'filter.all': 'All',
  'filter.image': 'Images',
  'filter.untextured': 'Untextured',
  'filter.textured': 'Textured',
  'filter.animation': 'Animation',
  'filter.starred': 'Starred',
  'filter.archived': 'Archived',
  'op.preview': 'Untextured model',
  'op.text-to-image': 'Concept image',
  'op.image-to-image': 'Edited image',
  'op.text-to-3d': 'Model from text',
  'op.image-to-3d': 'Model from image',
  'op.multi-image-to-3d': 'Model from images',
  'op.retexture': 'Retextured',
  'op.remesh': 'Fewer faces',
  'op.rigging': 'Rigged',
  'op.animate': 'Animated',
  'op.convert': 'Converted',
  'op.resize': 'Resized',
  'op.repair-printability': 'Printable',
  'op.analyze-printability': 'Print check',
  'op.multi-color-print': 'Multicolor print',
}
const zh: typeof en = {
  nav: 'Meshy',
  accountTitle: 'Meshy 账号',
  summary: '登录 Meshy，并在 3D 中预览 GLB 模型。',
  tagline: '在 DeepSeek Harness 里用文字或图片生成 3D 模型',
  checking: '检查中…',
  signedIn: '已登录',
  signedOut: '未登录',
  unverified: '需要处理',
  'unverified.hint': '已保存的登录无法验证。请刷新，或重新登录。',
  site: '站点',
  'site.global': '国际站',
  'site.cn': '中国站',
  account: '账号',
  credits: '积分',
  'credits.get': '获取积分',
  method: '登录方式',
  'method.browser': '浏览器登录',
  'method.apiKey': 'API key',
  more: '管理账号',
  signIn: '登录 Meshy',
  'signIn.hint': '在浏览器里批准一次，Meshy 技能之后都会使用这个登录。',
  'signIn.scan': '用手机扫码，或打开链接',
  'signIn.scanHint': '登录 {host} 并批准，本页会自动完成。',
  'signIn.code': '验证码',
  'signIn.open': '在浏览器中打开',
  'signIn.waiting': '正在等待你的批准…',
  copy: '复制验证码',
  copied: '已复制',
  cancel: '取消',
  retry: '重试',
  refresh: '刷新',
  signOut: '退出登录',
  'signOut.title': '退出 Meshy 登录？',
  'signOut.body': '退出后，DeepSeek Harness 里的 Meshy 技能在生成前会要求你重新登录。',
  close: '关闭',
  cli: 'Meshy CLI {version}',
  versions: 'Meshy 插件 {plugin} · CLI {cli}',
  'update.title': 'Meshy 插件 {version} 已发布',
  'update.hint': '当前是 {current}。在插件页卸载 Meshy，再用「添加插件」重新安装 meshy-dsh，登录会保留。',
  'update.hintHere': '当前是 {current}。在本页卸载 Meshy，再用「添加插件」重新安装 meshy-dsh，登录会保留。',
  'update.open': '前往插件页',
  'update.notes': '更新内容',
  'error.cli': '找不到 Meshy CLI',
  'error.cliHint': '请在「插件」中重新安装 Meshy 插件，然后刷新。',
  'error.expired': '验证码已过期，请重新开始。',
  'error.generic': '出错了：{message}',
  'viewer.title': '3D 模型',
  'viewer.loading': '正在加载模型…',
  'viewer.failed': '无法显示这个模型',
  'viewer.tooLarge': '模型有 {size}，超过 {limit} 的预览上限。减面后再预览。',
  'viewer.triangles': '{count} 个三角面',
  'viewer.reset': '重置视角',
  'viewer.spin': '自动旋转',
  'viewer.stop': '停止旋转',
  'page.tagline': '用文字或图片生成 3D 模型，绑骨做动画，或者准备好直接 3D 打印。',
  'page.start': '开始创作',
  'page.startHint': '选一个，会新开一个会话并填好需求，改一改再发送。',
  'page.copyHint': '复制到会话里，改一改再发送。',
  'page.try': '新开会话',
  'page.docs': '文档',
  'page.site': 'Meshy 官网',
  'example.chest.title': '游戏资产',
  'example.chest.prompt': '做一个低多边形的卡通宝箱，用在我的游戏里，导出 GLB。',
  'example.photo.title': '照片转 3D',
  'example.photo.prompt': '把我附上的这张照片做成带贴图的 3D 模型。',
  'example.character.title': '动画角色',
  'example.character.prompt': '生成一个卡通骑士，绑骨并加上走路动画，导出 FBX。',
  'example.print.title': '3D 打印',
  'example.print.prompt': '做一个 10 厘米高的柴犬手办，并准备好可以直接打印的 3MF。',
  'viewer.faces': '{count} 个面',
  'studio.title': 'Meshy Studio',
  'studio.loading': '正在打开 Meshy Studio…',
  'studio.unavailable': 'Meshy Studio 打不开这个会话',
  'studio.empty': '这个会话还没有 Meshy 模型。在对话里提需求，生成后会出现在这里。',
  'studio.signedOut': '还没登录 Meshy：在「设置 → Meshy」登录后才能生成和查看进度。',
  'studio.ref': 'Meshy 资产「{name}」（id {id}，文件 {file}）',
  'studio.mode': '显示',
  'studio.mode.textured': '带贴图',
  'studio.mode.clay': '白模',
  'studio.mode.wireframe': '线框',
  'studio.drafted': '已写进输入框，改一改再发送。',
  'studio.pinned': '已截下这个视角并写进输入框，说说要改什么再发送。',
  'studio.copied': '已复制，粘贴到对话里再发送。',
  'studio.draftFailed': '没能写进输入框。',
  'studio.comparing': '正在和「{name}」对比',
  'studio.makeCurrent': '设为当前',
  'studio.versionsLabel': '这个模型的各个版本',
  'studio.compare': '对比',
  'studio.compareOff': '结束对比',
  'studio.compareHint': '再选一个版本，并排对比。',
  'studio.credits': '{count} 积分',
  'studio.openPins': '等待 Agent 处理的视角（{count}）',
  'studio.angle': '方位 {azimuth}°，俯仰 {elevation}°',
  'studio.dismissPin': '忽略',
  'studio.advanced': '高级',
  'studio.operation': '操作',
  'studio.taskId': '任务 id',
  'studio.topology': '拓扑',
  'studio.projectFile': '项目文件',
  'status.running': '正在生成…',
  'status.downloading': '已完成，正在保存文件…',
  'status.submitted': '已提交，还没保存',
  'status.submittedHint': 'Agent 提交了这个任务，但结果没有保存到工作区。可以让它把结果下载下来。',
  'status.succeeded': '已完成',
  'status.failed': '这个任务失败了',
  'op.refine': '带贴图的模型',
  'card.opening': '正在打开 Meshy Studio…',
  'card.failed': 'Meshy Studio 没能打开',
  'card.assets': '{count} 个资产',
  'card.open': '打开 Studio',
  'card.reading': '正在读取 Meshy 项目…',
  'card.read': '已读取 Meshy 项目：{assets} 个资产，{pins} 个视角待处理',
  'card.link': '已把新版本关联到来源',
  'card.label': '已给 Meshy 资产命名',
  'card.resolve_pin': '已处理一个标注的视角',
  'card.activate': '已把 Studio 切到一个资产',
  'studio.flow': '工作区',
  'studio.tools': '工具',
  'studio.clips': '动画片段',
  'studio.restPose': '静止姿势',
  'studio.related': '相关资产（{count}）',
  'studio.allAssets': '全部资产',
  'studio.mentioned': '已把文件引用写进输入框。',
  'studio.smartTopology': '智能拓扑',
  'studio.prompt': '提示词',
  'studio.creditsLabel': '积分',
  'studio.actionsHint': '只会把需求写进输入框；你发送并确认花费之前，不会扣积分。',
  'tab.image': '图像',
  'tab.model': '模型',
  'tab.print': '打印',
  'tab.animate': '动画',
  'tab.assets': '资产',
  'stage.image': '图像',
  'stage.untextured': '白模',
  'stage.textured': '贴图模型',
  'stage.rigged': '已绑骨',
  'stage.animated': '动画',
  'stage.print': '打印版',
  'gate.notReady': '模型生成并保存后才能用',
  'gate.smartTopology': '智能拓扑模型已经按面数预算生成，不需要重拓扑',
  'gate.uvFaces': '需要 40,000 面以内，先重拓扑',
  'gate.needsTexture': '先给模型贴图',
  'gate.animated': '请选绑骨前的版本来打印',
  'tool.texture': '贴图',
  'tool.texture.hint': '给白模生成贴图',
  'tool.retexture': '重新贴图',
  'tool.retexture.hint': '同一形状换个外观',
  'tool.remesh': '重拓扑',
  'tool.remesh.hint': '面数与拓扑',
  'tool.uv': 'UV 展开',
  'tool.uv.hint': '输出带 UV 的白模，自己贴图',
  'tool.export': '导出',
  'tool.export.hint': 'FBX、OBJ、USDZ、STL、3MF、Blender',
  'tool.check': '打印检查',
  'tool.check.hint': '水密、破洞、非流形边',
  'tool.repair': '修复为可打印',
  'tool.repair.hint': '修好网格再打印',
  'tool.multicolor': '多色打印',
  'tool.multicolor.hint': '多材料打印机用的彩色 3MF',
  'tool.split': '拆分',
  'tool.split.hint': '分成几个部件打印',
  'tool.resize': '尺寸',
  'tool.resize.hint': '打印出来的高度',
  'tool.slicer': '发送到切片软件',
  'tool.slicer.hint': '在切片软件里打开打印文件',
  'tool.rig': '绑定骨骼',
  'tool.rig.hint': '给人形角色加骨骼',
  'tool.animate': '添加动画',
  'tool.animate.hint': '从动画库选动作',
  'tool.style': '风格',
  'tool.stylePlaceholder': '例如：做旧橡木配黄铜包角',
  'tool.pbr': 'PBR 材质（金属度、粗糙度、法线）',
  'tool.targetFaces': '目标面数（现在 {now}）',
  'tool.topology': '拓扑',
  'tool.triangle': '三角面',
  'tool.quad': '四边面',
  'tool.uvHint': '输出带干净 UV 的白模，方便你在别的软件里贴图。需要 40,000 面以内。',
  'tool.owned': '工作区里已有：{formats}',
  'tool.formats': '格式',
  'tool.checkHint': '检查网格是否水密、有没有破洞和非流形边，先报告结果，不会直接修改。',
  'tool.repairHint': '补洞、修复非流形边，让模型可以打印。修复后的模型不能再重新贴图。',
  'tool.colors': '最多颜色数',
  'tool.parts': '部件',
  'tool.partsPlaceholder': '例如：盖子、箱体、底座（留空则按形状拆）',
  'tool.height': '打印高度',
  'tool.slicerPick': '切片软件',
  'tool.rigHint': '适合带贴图、四肢清楚的人形角色，最好是 A 姿势或 T 姿势。绑骨自带走路和跑步动画。',
  'tool.rigHeight': '角色身高',
  'tool.actions': '动作',
  'tool.customAction': '其他动作',
  'tool.customPlaceholder': '例如：先鞠躬，再用左手挥手',
  'tool.close': '收起',
  'tool.send': '写进对话',
  'slicer.auto': '自动检测',
  'slicer.bambu': 'Bambu Studio',
  'slicer.orca': 'OrcaSlicer',
  'slicer.prusa': 'PrusaSlicer',
  'slicer.cura': 'Cura',
  'anim.idle': '待机',
  'anim.walk': '走路',
  'anim.run': '跑步',
  'anim.jump': '跳跃',
  'anim.wave': '挥手',
  'anim.dance': '跳舞',
  'anim.attack': '攻击',
  'anim.sit': '坐下',
  'anim.step.rig': '绑定骨骼',
  'anim.step.animate': '添加动画',
  'anim.tooMany': '这个模型有 {count} 个面，绑骨最多支持 {max} 个面，请先重拓扑。',
  'anim.rigFailed': '绑骨失败了。确认是 A 姿势或 T 姿势的人形角色后再试一次。',
  'anim.needsTexture': '绑骨要用带贴图的模型，先贴图效果更好。',
  'anim.rigging': '正在绑骨…',
  'anim.hasRig': '这个模型已经有绑骨版本。',
  'anim.openRig': '打开绑骨版本',
  'anim.playHint': '在模型下方选一个片段播放。',
  'anim.riggedHint': '已绑骨：可以从动画库添加动画。',
  'anim.made': '动画（{count}）',
  'list.sep': '、',
  'draft.texture': '给{ref}贴图{pbr}，风格：{style}',
  'draft.retexture': '给{ref}重新贴图{pbr}，风格：{style}',
  'draft.pbr': '（PBR 材质）',
  'draft.remesh': '把{ref}重拓扑为{topology}，约 {faces} 个面，保持外形不变。',
  'draft.uv': '给{ref}展开 UV，输出带 UV 的白模，我自己来贴图。',
  'draft.export': '把{ref}导出为 {formats}。',
  'draft.check': '检查{ref}能不能 3D 打印（水密、破洞、非流形边），先告诉我结果，不要直接修。',
  'draft.repair': '把{ref}修复为可打印（补洞、修复非流形边），并准备好打印文件。',
  'draft.multicolor': '把{ref}做成多色打印文件（3MF），最多 {colors} 种颜色。',
  'draft.split': '把{ref}拆分成几个部件分开打印：{parts}',
  'draft.resize': '把{ref}的打印高度设为 {height} 毫米。',
  'draft.slicer': '在切片软件（{slicer}）里打开{ref}的打印文件。',
  'draft.rig': '给{ref}绑定骨骼（人形角色，身高约 {height} 米），之后我要加动画。',
  'draft.animate': '给{ref}添加动画：{actions}。从 Meshy 动画库里选，库里没有的用文字生成动作。',
  'draft.build': '用{ref}生成 3D 模型。',
  'draft.editImage': '修改图片{ref}：',
  'draft.concept': '先画一张概念图，用来生成这个 3D 模型：',
  'draft.pin': '{mention}[Meshy 标注 {pin}] 看{ref}的这个视角（方位 {azimuth}°，俯仰 {elevation}°，{faces} 个面）：',
  'action.build': '生成 3D 模型',
  'action.editImage': '改图',
  'action.newImage': '新概念图',
  'action.pin': '指给 Agent 看',
  'action.pinHint': '截下这个视角，问 Agent',
  'image.empty': '还没有图像。先让 Agent 画一张概念图，再用它生成 3D 模型。',
  'image.ask': '让 Agent 画概念图',
  'image.models': '由这张图生成的模型（{count}）',
  'image.all': '全部图像（{count}）',
  'model.fromImage': '还没有 3D 模型。到「图像」里用概念图生成一个。',
  'model.next': '下一步：',
  'assets.open': '打开',
  'assets.star': '收藏',
  'assets.unstar': '取消收藏',
  'assets.rename': '重命名',
  'assets.mention': '引用',
  'assets.archive': '归档',
  'assets.restore': '恢复',
  'assets.search': '搜索资产',
  'assets.layout': '布局',
  'assets.folder': '按模型',
  'assets.grid': '平铺',
  'assets.filter': '筛选',
  'assets.none': '没有符合条件的资产。',
  'assets.related': '{count} 个资产',
  'assets.footer': '共 {count} 个资产 · 本会话 {credits} 积分。归档只是隐藏，文件仍在工作区。',
  'filter.all': '全部',
  'filter.image': '图像',
  'filter.untextured': '白模',
  'filter.textured': '贴图模型',
  'filter.animation': '动画',
  'filter.starred': '收藏',
  'filter.archived': '已归档',
  'op.preview': '白模',
  'op.text-to-image': '概念图',
  'op.image-to-image': '改图',
  'op.text-to-3d': '文字生成模型',
  'op.image-to-3d': '图片生成模型',
  'op.multi-image-to-3d': '多图生成模型',
  'op.retexture': '重新贴图',
  'op.remesh': '减面',
  'op.rigging': '绑骨',
  'op.animate': '动画',
  'op.convert': '转格式',
  'op.resize': '调整尺寸',
  'op.repair-printability': '可打印版',
  'op.analyze-printability': '打印检查',
  'op.multi-color-print': '多色打印',
}

// Same delivery as dsh's own client plugins: one tagged <style>, added once. Theme tokens only,
// plus Meshy's lime (light/dark per the Meshy design system) for primary actions and status.
const CSS = `
.meshy-root{--meshy-accent:#beef54;--meshy-accent-hover:#b1ed30;--meshy-accent-label:#000;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:22px}
body[data-ds-dark-theme] .meshy-root{--meshy-accent:#c5f955;--meshy-accent-hover:#a8e328}
.meshy-section{display:flex;flex-direction:column;gap:16px;padding:8px 0}
.meshy-card{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);padding:12px 16px}
.meshy-head,.meshy-row{display:flex;justify-content:space-between;align-items:center;gap:16px}
.meshy-identity{display:flex;align-items:center;gap:10px;min-width:0;min-height:44px}
.meshy-logo{width:32px;height:32px;flex:none;border-radius:9px}
.meshy-copy{display:flex;flex-direction:column;min-width:0}
.meshy-name{font-size:14px;font-weight:500}
.meshy-muted{color:var(--dsw-alias-label-tertiary)}
.meshy-small{font-size:12px;line-height:18px}
.meshy-pill{display:inline-flex;align-items:center;gap:6px;flex:none;white-space:nowrap}
.meshy-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.meshy-dot[data-on]{background:var(--meshy-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--meshy-accent) 25%,transparent)}
.meshy-dot[data-warn]{background:var(--dsw-alias-state-warn-primary)}
.meshy-rows{display:flex;flex-direction:column;gap:8px}
.meshy-row{box-sizing:border-box;min-height:40px;padding:6px 0}
.meshy-divider{border-top:.5px solid var(--dsw-alias-border-l2)}
.meshy-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:10px}
.meshy-amount{display:inline-flex;align-items:center;gap:8px;font-size:18px;font-weight:510;line-height:28px}
.meshy-account{display:flex;flex-direction:column;align-items:flex-end;min-width:0;text-align:right;overflow-wrap:anywhere}
.meshy-coin{width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,#f9e855,#e99430)}
.meshy-link{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;text-decoration:none;white-space:nowrap}
.meshy-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-link:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.meshy-root .meshy-accent{flex:none;white-space:nowrap;border-color:transparent;background:var(--meshy-accent);color:var(--meshy-accent-label);font-weight:500}
.meshy-root .meshy-accent:hover:not(:disabled){background:var(--meshy-accent-hover)}
.meshy-signin{display:flex;align-items:center;gap:20px}
.meshy-qr{flex:none;width:136px;height:136px;padding:10px;border-radius:var(--dsw-radius-lg);background:#fff;border:.5px solid var(--dsw-alias-border-l2);image-rendering:pixelated}
.meshy-signin .meshy-copy{gap:10px}
.meshy-code{display:inline-flex;align-items:center;gap:8px}
.meshy-code code{font-family:var(--ds-font-family-code);font-size:16px;letter-spacing:.08em;padding:2px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform)}
.meshy-waiting{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary)}
.meshy-alert{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-lg);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
.meshy-alert svg{flex:none;margin-top:3px;color:var(--dsw-alias-state-warn-primary)}
.meshy-alert code{align-self:flex-start;margin-top:4px;padding:1px 6px;border-radius:var(--dsw-radius-xs);font-family:var(--ds-font-family-code);font-size:12px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.meshy-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px}
.meshy-skeleton{display:block;border-radius:6px;background:var(--dsw-alias-bg-skeleton);animation:meshy-pulse 1.4s ease-in-out infinite}
@keyframes meshy-pulse{50%{opacity:.45}}
.meshy-viewer{position:relative;width:100%;height:100%;min-height:360px}
.meshy-stage{position:absolute;inset:0}
.meshy-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center}
.meshy-overlay .meshy-logo{width:40px;height:40px;animation:meshy-pulse 1.4s ease-in-out infinite}
.meshy-bar{position:absolute;left:12px;right:12px;bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;pointer-events:none}
.meshy-bar>*{pointer-events:auto}
.meshy-chip{padding:2px 10px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent);backdrop-filter:blur(8px);font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.meshy-page{box-sizing:border-box;height:100%;overflow-y:auto}
.meshy-page-inner{box-sizing:border-box;max-width:760px;margin:0 auto;padding:56px 32px 48px;display:flex;flex-direction:column;gap:32px}
.meshy-hero{display:flex;align-items:center;gap:16px}
.meshy-hero .meshy-logo{width:56px;height:56px;border-radius:14px}
.meshy-hero h1{margin:0;font-size:24px;font-weight:600;line-height:32px;color:var(--dsw-alias-label-primary)}
.meshy-h2{margin:0;font-size:15px;font-weight:500;line-height:24px}
.meshy-block{display:flex;flex-direction:column;gap:12px}
.meshy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.meshy-example{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:6px;width:100%;margin:0;padding:14px 16px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;transition:background-color .15s,border-color .15s}
.meshy-example:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:color-mix(in srgb,var(--meshy-accent) 70%,transparent)}
.meshy-example:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.meshy-example-title{display:inline-flex;align-items:center;gap:8px;font-weight:500}
.meshy-example-title::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--meshy-accent)}
.meshy-example-cta{display:inline-flex;align-items:center;gap:4px;margin-top:4px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.meshy-example:hover .meshy-example-cta{color:var(--dsw-alias-label-primary)}
.meshy-links{display:flex;gap:16px}
.meshy-textlink{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);text-decoration:none}
.meshy-textlink:hover{color:var(--dsw-alias-label-primary)}
.meshy-mark{position:relative;display:inline-flex;flex:none}
.meshy-glyph{display:inline-flex;width:100%;height:100%}
.meshy-badge{position:absolute;top:-2px;right:-3px;width:7px;height:7px;border-radius:50%;background:#beef54;box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base)}
body[data-ds-dark-theme] .meshy-badge{background:#c5f955}
.meshy-update{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px 16px}
.meshy-update .meshy-copy{flex:1 1 280px}
.meshy-tools{display:flex;gap:4px;padding:2px;border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent);backdrop-filter:blur(8px)}
.meshy-studio{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;height:100%;min-height:480px;padding:10px 12px 16px;overflow-y:auto;position:relative}
.meshy-studio>*{flex-shrink:0}
.meshy-tabs{display:flex;gap:2px;margin:0 -4px;padding:0 0 4px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.meshy-tab{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;height:44px;padding:0 2px;border:none;border-radius:var(--dsw-radius-md);background:none;font:inherit;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer;position:relative;white-space:nowrap}
.meshy-tab>span:not(.meshy-tab-count){max-width:100%;overflow:hidden;text-overflow:ellipsis}
.meshy-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.meshy-tab[aria-current=page]{color:var(--dsw-alias-label-primary);font-weight:510}
.meshy-tab[aria-current=page]{background:var(--dsw-alias-bg-module-platform)}
.meshy-tab[aria-current=page]::after{content:"";position:absolute;left:30%;right:30%;bottom:-5px;height:2px;border-radius:1px;background:var(--meshy-accent)}
.meshy-tab[data-assets]{margin-left:6px}
.meshy-tab[data-assets]::before{content:"";position:absolute;left:-4px;top:10px;bottom:10px;border-left:.5px solid var(--dsw-alias-border-l2)}
.meshy-tab-count{position:absolute;top:3px;left:calc(50% + 7px);min-width:14px;padding:0 3px;border-radius:999px;font-size:9px;line-height:14px;text-align:center;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary)}
.meshy-tab[aria-current=page] .meshy-tab-count{background:var(--meshy-accent);color:var(--meshy-accent-label)}
.meshy-head{display:flex;flex-direction:column;gap:2px;min-width:0}
.meshy-head-title{display:flex;align-items:center;gap:6px;min-width:0}
.meshy-head-name{min-width:0;padding:0;border:none;background:none;font:inherit;font-size:14px;font-weight:510;line-height:22px;color:var(--dsw-alias-label-primary);text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:text}
.meshy-head-name:hover{text-decoration:underline dotted}
.meshy-head .meshy-input{font-size:14px}
.meshy-asset-star{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.meshy-asset-star:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.meshy-asset-star[aria-pressed=true]{color:#e9a630}
.meshy-section-title{font-size:12px;line-height:18px;font-weight:510;color:var(--dsw-alias-label-secondary)}
.meshy-toolgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:6px}
.meshy-tool{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;min-height:52px;padding:8px 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);font:inherit;text-align:left;cursor:pointer;color:var(--dsw-alias-label-primary)}
.meshy-tool:hover{border-color:color-mix(in srgb,var(--meshy-accent) 70%,transparent);background:var(--dsw-alias-interactive-bg-hover)}
.meshy-tool[aria-pressed=true]{border-color:var(--meshy-accent);box-shadow:inset 0 0 0 1px var(--meshy-accent)}
.meshy-tool[aria-disabled=true]{cursor:not-allowed;opacity:.55}
.meshy-tool[aria-disabled=true]:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
.meshy-tool-name{font-size:13px;font-weight:510;line-height:20px}
.meshy-tool-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meshy-panel{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:var(--dsw-radius-lg);border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill)}
.meshy-panel-head,.meshy-panel-foot{display:flex;align-items:center;justify-content:space-between;gap:12px}
.meshy-panel-foot .meshy-small{flex:1;min-width:0}
.meshy-field{display:flex;flex-direction:column;gap:6px}
.meshy-field-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.meshy-input{box-sizing:border-box;width:100%;padding:6px 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);resize:vertical}
.meshy-input:focus{outline:none;border-color:var(--meshy-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--meshy-accent) 30%,transparent)}
.meshy-unit{display:inline-flex;align-items:center;gap:6px;max-width:160px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.meshy-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.meshy-chips{display:flex;flex-wrap:wrap;gap:6px}
.meshy-chipbtn{display:inline-flex;align-items:center;gap:4px;max-width:160px;height:26px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-base);font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meshy-chipbtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.meshy-chipbtn[aria-pressed=true]{border-color:transparent;background:color-mix(in srgb,var(--meshy-accent) 35%,transparent);color:var(--dsw-alias-label-primary)}
.meshy-bar-left{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}
.meshy-clips{display:flex;flex-wrap:wrap;gap:4px;max-width:100%}
.meshy-clips .meshy-chipbtn{height:22px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 85%,transparent);backdrop-filter:blur(8px)}
.meshy-actions-row{display:flex;flex-wrap:wrap;gap:6px}
.meshy-jump{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.meshy-steps{display:flex;gap:6px;margin:0;padding:0;list-style:none;counter-reset:step}
.meshy-steps li{counter-increment:step;display:inline-flex;align-items:center;gap:6px;padding:2px 10px 2px 4px;border-radius:999px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-module-platform)}
.meshy-steps li::before{content:counter(step);display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;font-size:10px;background:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.meshy-steps li[data-current]{color:var(--dsw-alias-label-primary)}
.meshy-steps li[data-current]::before{background:var(--meshy-accent);color:var(--meshy-accent-label)}
.meshy-steps li[data-done]{color:var(--dsw-alias-label-secondary)}
.meshy-steps li[data-done]::before{content:"✓";background:color-mix(in srgb,var(--meshy-accent) 45%,transparent)}
.meshy-empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:260px;padding:24px;text-align:center}
.meshy-empty-state .meshy-logo{width:40px;height:40px;border-radius:10px}
.meshy-empty{padding:16px 0;text-align:center}
.meshy-toast{position:sticky;bottom:0;align-self:center;padding:6px 12px;border-radius:999px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);box-shadow:0 4px 16px rgba(0,0,0,.15)}
.meshy-thumb-failed{position:absolute;right:4px;top:4px;color:var(--dsw-alias-state-warn-primary)}
.meshy-library{display:flex;flex-direction:column;gap:10px}
.meshy-library-bar{display:flex;align-items:center;gap:8px}
.meshy-search{flex:1;min-width:0}
.meshy-family{display:flex;flex-direction:column;gap:8px}
.meshy-family-head{display:flex;align-items:center;gap:6px;min-width:0;padding:4px 0;border:none;background:none;font:inherit;text-align:left;color:var(--dsw-alias-label-primary);cursor:pointer}
.meshy-family-head .meshy-name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
.meshy-family-head .meshy-small{flex:none}
.meshy-chevron{display:inline-flex;transition:transform .15s;color:var(--dsw-alias-label-tertiary)}
.meshy-chevron[data-open]{transform:rotate(90deg)}
.meshy-assetgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:10px}
.meshy-asset{position:relative;display:flex;flex-direction:column;gap:3px;min-width:0}
.meshy-asset[data-archived]{opacity:.6}
.meshy-asset-img{position:relative;display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:1;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);overflow:hidden;cursor:pointer}
.meshy-asset-img:hover{border-color:color-mix(in srgb,var(--meshy-accent) 70%,transparent)}
.meshy-asset[data-active] .meshy-asset-img{border:2px solid var(--meshy-accent)}
.meshy-asset-img img{width:100%;height:100%;object-fit:cover}
.meshy-asset>.meshy-asset-star{position:absolute;top:4px;right:4px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent)}
.meshy-asset-name{font-size:12px;font-weight:510;line-height:18px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meshy-asset-rename{padding:2px 6px;font-size:12px}
.meshy-asset-facts{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meshy-asset-actions{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:11px;line-height:16px}
.meshy-views{display:flex;flex-direction:column;gap:8px}
.meshy-viewport{position:relative;width:100%;height:clamp(260px,46vh,520px);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform);overflow:hidden}
.meshy-viewport[data-compact]{height:clamp(200px,30vh,360px)}
.meshy-image{display:flex;align-items:center;justify-content:center}
.meshy-image img{max-width:100%;max-height:100%;object-fit:contain}
.meshy-viewtools{position:absolute;top:8px;left:8px;right:8px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:6px}
.meshy-viewtools>[role=radiogroup],.meshy-viewtools>div:first-child{background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent);backdrop-filter:blur(8px);border-radius:var(--dsw-radius-md)}
.meshy-meter{display:block;width:160px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden}
.meshy-meter>span{display:block;height:100%;background:var(--meshy-accent);transition:width .4s}
.meshy-compare{display:flex;flex-direction:column;gap:6px}
.meshy-compare-head,.meshy-strip-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.meshy-strip-tools{display:inline-flex;gap:12px}
.meshy-textbtn{padding:0;border:none;background:none;font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer}
.meshy-textbtn:hover,.meshy-textbtn[aria-pressed=true]{color:var(--dsw-alias-label-primary);text-decoration:underline}
.meshy-strip{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.meshy-thumb{position:relative;flex:none;display:flex;flex-direction:column;gap:4px;width:84px;padding:0;border:none;background:none;font:inherit;text-align:left;cursor:pointer;color:var(--dsw-alias-label-secondary)}
.meshy-thumb-img{position:relative;display:flex;align-items:center;justify-content:center;width:84px;height:84px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);overflow:hidden}
.meshy-thumb-img img{width:100%;height:100%;object-fit:cover}
.meshy-thumb[data-active] .meshy-thumb-img{border:2px solid var(--meshy-accent)}
.meshy-thumb[data-compared] .meshy-thumb-img{border:2px dashed var(--dsw-alias-label-secondary)}
.meshy-thumb[data-active]{color:var(--dsw-alias-label-primary)}
.meshy-thumb-label{font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meshy-thumb-tag{position:absolute;top:4px;left:4px;padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 85%,transparent)}
.meshy-thumb-progress{position:absolute;left:0;bottom:0;height:3px;background:var(--meshy-accent)}
.meshy-facts{display:flex;flex-wrap:wrap;gap:4px 12px;color:var(--dsw-alias-label-secondary)}
.meshy-advanced summary{cursor:pointer;color:var(--dsw-alias-label-tertiary)}
.meshy-advanced dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:8px 0 0}
.meshy-advanced dt{color:var(--dsw-alias-label-tertiary)}
.meshy-advanced dd{margin:0;overflow-wrap:anywhere}
.meshy-advanced code{font-family:var(--ds-font-family-code);font-size:11px}
.meshy-toolcard{display:flex;align-items:center;gap:12px;padding:10px 12px;margin:4px 0}
.meshy-toolcard .meshy-logo{width:28px;height:28px;border-radius:8px}
.meshy-toolrow{display:flex;align-items:center;gap:8px;font-size:13px;line-height:22px}
.meshy-toolrow .meshy-logo{width:16px;height:16px;border-radius:4px}
`
if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="meshy-dsh/client.css"]')) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'meshy-dsh'
  tag.dataset.pluginCss = 'meshy-dsh/client.css'
  tag.textContent = CSS
  document.head.append(tag)
}

type Account = { name: string | null; email: string | null }
type Auth = { authenticated: boolean; verified: boolean; method: 'browser' | 'apiKey' | null; account: Account | null; region: Site; balance: number | null }
type Status = { cli: { version: string } | null; error?: string; auth?: Auth }
type Flow = { verification_url: string; user_code: string; flow_id: string; expires_in?: number }
type Problem = { kind: 'cli' | 'expired' | 'generic'; message?: string }

function qr(text: string): string {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  return code.createDataURL(6, 0)
}

const Logo = () => <img className="meshy-logo" src={__MESHY_ICON__} alt="" />

// On the plugin's own page the host already shows the logo and name, so the card drops them.
function Identity({ t, page, line, pill }: { t: T; page: boolean; line: string; pill: 'checking' | 'on' | 'off' | 'warn' }) {
  const title = page ? t('accountTitle') : 'Meshy'
  return (
    <div className="meshy-card meshy-head">
      <div className="meshy-identity">
        {!page && <Logo />}
        <div className="meshy-copy"><span className="meshy-name">{title}</span><span className="meshy-muted">{line}</span></div>
      </div>
      <span className="meshy-pill meshy-muted">
        {pill === 'checking' ? <StateDot state="ongoing" size={12} /> : <span className="meshy-dot" data-on={pill === 'on' || undefined} data-warn={pill === 'warn' || undefined} />}
        {t(pill === 'checking' ? 'checking' : pill === 'on' ? 'signedIn' : pill === 'warn' ? 'unverified' : 'signedOut')}
      </span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="meshy-card meshy-rows" aria-hidden="true">
      <div className="meshy-row"><span className="meshy-skeleton" style={{ width: 64, height: 14 }} /><span className="meshy-skeleton" style={{ width: 120, height: 22 }} /></div>
      <div className="meshy-divider" />
      <div className="meshy-row"><span className="meshy-skeleton" style={{ width: 48, height: 14 }} /><span className="meshy-skeleton" style={{ width: 180, height: 36 }} /></div>
    </div>
  )
}

function Alert({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="meshy-alert" role="alert">
      <IconWarningOutlineRegular size={14} />
      <div className="meshy-copy" style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  )
}

/** A newer release and how to get it; on the plugin's own page the uninstall control is right there. */
function UpdateNotice({ t, plugin, here }: { t: T; plugin: Plugin; here: boolean }) {
  return (
    <div className="meshy-card meshy-update">
      <div className="meshy-copy">
        <span className="meshy-name meshy-pill"><span className="meshy-dot" data-on />{t('update.title', { version: plugin.update! })}</span>
        <span className="meshy-muted meshy-small">{t(here ? 'update.hintHere' : 'update.hint', { current: plugin.version })}</span>
      </div>
      <div className="meshy-actions">
        <a className="meshy-link" href={`${RELEASES}/v${plugin.update}`} target="_blank" rel="noreferrer">{t('update.notes')}<IconRightUpOutlineRegular size={12} /></a>
        {!here && openBundle && <Button variant="outline" onClick={() => openBundle?.(PACKAGE)}>{t('update.open')}</Button>}
      </div>
    </div>
  )
}

function MeshyPanel({ t, view, place }: { t: T; view?: 'page' | 'summary'; place?: 'sidebar' }) {
  const [status, setStatus] = useState<Status>()
  const plugin = usePlugin()
  const site = useSite()
  const [flow, setFlow] = useState<Flow>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem>()
  const [copied, setCopied] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const polling = useRef(0)
  // A signed-in account decides the site for every link on the page.
  useEffect(() => { if (status?.auth?.authenticated) setSite(status.auth.region) }, [status])

  const refresh = useCallback(async () => {
    setStatus(undefined)
    setProblem(undefined)
    void readPlugin()
    try {
      const next: Status = (await api('meshy.status')).data
      setStatus(next)
      if (!next.cli) setProblem({ kind: 'cli' })
    } catch (err) {
      setStatus({ cli: null })
      setProblem({ kind: 'generic', message: String(err) })
    }
  }, [])
  useEffect(() => {
    if (view !== 'summary') void refresh()
    return () => { polling.current++ }
  }, [refresh, view])
  if (view === 'summary') return <span>{t('summary')}</span>

  // Start the two-step device flow, then keep finishing it: the route waits up to a minute per
  // call and answers 202 while the approval is pending.
  const signIn = async () => {
    setBusy(true)
    setProblem(undefined)
    try {
      const { status: code, data } = await api('meshy.login', { region: site })
      if (code !== 200) throw new Error(data.error ?? String(code))
      setFlow(data)
      const run = ++polling.current
      const deadline = Date.now() + ((data.expires_in ?? 600) * 1000)
      while (run === polling.current) {
        if (Date.now() > deadline) { setFlow(undefined); setProblem({ kind: 'expired' }); return }
        const done = await api('meshy.login.finish', { flow_id: data.flow_id })
        if (run !== polling.current) return
        if (done.status === 202) continue
        if (done.status !== 200) {
          setFlow(undefined)
          setProblem(/expir/i.test(done.data.error ?? '') ? { kind: 'expired' } : { kind: 'generic', message: done.data.error ?? String(done.status) })
          return
        }
        setFlow(undefined)
        await refresh()
        return
      }
    } catch (err) {
      setFlow(undefined)
      setProblem({ kind: 'generic', message: String((err as Error)?.message ?? err) })
    } finally {
      setBusy(false)
    }
  }
  const cancel = () => { polling.current++; setFlow(undefined); setBusy(false) }
  const signOut = async () => {
    setConfirmOut(false)
    setBusy(true)
    try {
      const { status: code, data } = await api('meshy.logout', {})
      if (code !== 200) throw new Error(data.error ?? String(code))
      await refresh()
    } catch (err) {
      setProblem({ kind: 'generic', message: String((err as Error)?.message ?? err) })
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (flow && await writeClipboard(flow.user_code)) { setCopied(true); setTimeout(() => setCopied(false), 1500) }
  }

  const auth = status?.auth
  const signedIn = !!auth?.authenticated
  const shownSite: Site = auth?.region ?? site
  const problemText = problem && (problem.kind === 'expired' ? t('error.expired') : problem.kind === 'cli' ? t('error.cli') : t('error.generic', { message: problem.message ?? '' }))
  // The host renders `view: 'page'` on this plugin's page in Plugins; the sidebar page says `place`.
  const notice = plugin?.update ? <UpdateNotice t={t} plugin={plugin} here={view === 'page' && place !== 'sidebar'} /> : null

  return (
    <section className="meshy-root meshy-section" aria-label={t('nav')}>
      {!status ? (
        <><Identity t={t} page={view === 'page'} line={t(view === 'page' ? 'summary' : 'tagline')} pill="checking" />{notice}<Skeleton /></>
      ) : (
        <>
          <Identity
            t={t}
            page={view === 'page'}
            line={signedIn ? `${t(`site.${shownSite}`)} · ${SITES[shownSite].host}` : t(view === 'page' ? 'summary' : 'tagline')}
            pill={!status.cli ? 'off' : !signedIn ? 'off' : auth!.verified ? 'on' : 'warn'}
          />
          {notice}

          {problem && (
            <Alert action={problem.kind === 'cli'
              ? <Button variant="outline" size="sm" onClick={refresh}>{t('refresh')}</Button>
              : problem.kind === 'expired' ? <Button variant="outline" size="sm" onClick={signIn}>{t('retry')}</Button> : undefined}>
              <span>{problemText}</span>
              {problem.kind === 'cli' && <span className="meshy-muted meshy-small">{t('error.cliHint')}</span>}
            </Alert>
          )}

          {status.cli && signedIn && (
            <div className="meshy-card meshy-rows">
              {!auth!.verified && <Alert><span>{t('unverified.hint')}</span></Alert>}
              {auth!.account && (
                <>
                  <div className="meshy-row">
                    <span>{t('account')}</span>
                    <span className="meshy-account">
                      <span>{auth!.account.name ?? auth!.account.email}</span>
                      {auth!.account.name && auth!.account.email && <span className="meshy-muted meshy-small">{auth!.account.email}</span>}
                    </span>
                  </div>
                  <div className="meshy-divider" />
                </>
              )}
              <div className="meshy-row">
                <span>{t('credits')}</span>
                <span className="meshy-amount">{auth!.balance === null ? <span className="meshy-muted meshy-small">—</span> : <><span className="meshy-coin" />{auth!.balance.toLocaleString()}</>}</span>
              </div>
              <div className="meshy-divider" />
              <div className="meshy-row">
                <span>{t('method')}</span>
                <span className="meshy-muted">{auth!.method ? t(`method.${auth!.method}`) : '—'}</span>
              </div>
              <div className="meshy-divider" />
              <div className="meshy-row">
                <span className="meshy-muted">{t('more')}</span>
                <div className="meshy-actions">
                  <Button variant="outline" disabled={busy} onClick={() => setConfirmOut(true)}>{t('signOut')}</Button>
                  <a className="meshy-link meshy-accent" href={`${SITES[shownSite].web}/pricing`} target="_blank" rel="noreferrer">
                    {t('credits.get')}<IconRightUpOutlineRegular size={12} />
                  </a>
                </div>
              </div>
            </div>
          )}

          {status.cli && !signedIn && !flow && (
            <div className="meshy-card meshy-rows">
              <div className="meshy-row">
                <span>{t('site')}</span>
                <SegmentedControl
                  id="meshy-site"
                  label={t('site')}
                  value={site}
                  disabled={busy}
                  onChange={(value: Site) => setSite(value)}
                  options={[{ value: 'global', label: `${t('site.global')} · meshy.ai` }, { value: 'cn', label: `${t('site.cn')} · meshy.cn` }]}
                />
              </div>
              <div className="meshy-divider" />
              <div className="meshy-row">
                <span className="meshy-muted">{t('signIn.hint')}</span>
                <Button variant="primary" className="meshy-accent" disabled={busy} onClick={signIn}>{t('signIn')}</Button>
              </div>
            </div>
          )}

          {flow && (
            <div className="meshy-card meshy-signin">
              <img className="meshy-qr" src={qr(flow.verification_url)} alt="" />
              <div className="meshy-copy">
                <span className="meshy-name">{t('signIn.scan')}</span>
                <span className="meshy-muted">{t('signIn.scanHint', { host: SITES[site].host })}</span>
                <span className="meshy-code">
                  <span className="meshy-muted">{t('signIn.code')}</span>
                  <code>{flow.user_code}</code>
                  <Tooltip label={copied ? t('copied') : t('copy')} side="top">
                    <Button variant="ghost" size="sm" aria-label={t('copy')} icon={copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />} onClick={copy} />
                  </Tooltip>
                </span>
                <span className="meshy-waiting"><StateDot state="ongoing" size={12} /><TextShimmer active>{t('signIn.waiting')}</TextShimmer></span>
                <div className="meshy-actions" style={{ justifyContent: 'flex-start' }}>
                  <a className="meshy-link meshy-accent" href={flow.verification_url} target="_blank" rel="noreferrer">
                    {t('signIn.open')}<IconRightUpOutlineRegular size={12} />
                  </a>
                  <Button variant="outline" onClick={cancel}>{t('cancel')}</Button>
                </div>
              </div>
            </div>
          )}

          {status.cli && (
            <div className="meshy-foot meshy-muted meshy-small">
              <span>{plugin ? t('versions', { plugin: plugin.version, cli: status.cli.version }) : t('cli', { version: status.cli.version })}</span>
              <Tooltip label={t('refresh')} side="top">
                <Button variant="ghost" size="sm" aria-label={t('refresh')} disabled={busy} icon={<IconRefreshOutlineRegular size={14} />} onClick={refresh} />
              </Tooltip>
            </div>
          )}
        </>
      )}

      <Modal
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title={t('signOut.title')}
        closeLabel={t('close')}
        description={t('signOut.body')}
        footer={<>
          <Button variant="outline" onClick={() => setConfirmOut(false)}>{t('cancel')}</Button>
          <Button variant="primary" onClick={signOut}>{t('signOut')}</Button>
        </>}
      />
    </section>
  )
}

/** Set while the workspace navigation service is mounted: opens a new session with the prompt filled in. */
let startSession: ((prompt: string) => void) | undefined

/** Left-sidebar icon: the host passes the edge size (18 expanded, 16 collapsed); colour follows the row. A dot marks a newer release. */
function MeshySidebarIcon({ size = 16 }: { size?: number; active?: boolean }) {
  const update = usePlugin()?.update
  return (
    <span className="meshy-mark" aria-hidden="true" style={{ width: size, height: size }}>
      <span className="meshy-glyph" dangerouslySetInnerHTML={{ __html: __MESHY_MONO__ }} />
      {update && <span className="meshy-badge" />}
    </span>
  )
}

function ExampleCard({ t, id }: { t: T; id: (typeof EXAMPLES)[number] }) {
  const prompt = t(`example.${id}.prompt`)
  const [copied, setCopied] = useState(false)
  const run = async () => {
    if (startSession) return startSession(prompt)
    if (await writeClipboard(prompt)) { setCopied(true); setTimeout(() => setCopied(false), 1500) }
  }
  return (
    <button type="button" className="meshy-example" onClick={run}>
      <span className="meshy-example-title">{t(`example.${id}.title`)}</span>
      <span className="meshy-muted">{prompt}</span>
      <span className="meshy-example-cta">
        {startSession ? <>{t('page.try')}<IconChevronRightOutlineRegular size={12} /></> : copied ? t('copied') : <>{t('copy')}<IconCopyOutlineRegular size={12} /></>}
      </span>
    </button>
  )
}

/** The page the sidebar entry opens in the main column: the account card plus ways to start. */
function MeshyPage({ t }: { t: T }) {
  const site = useSite()
  return (
    <div className="meshy-root meshy-page">
      <div className="meshy-page-inner">
        <header className="meshy-hero">
          <Logo />
          <div className="meshy-copy"><h1>Meshy</h1><span className="meshy-muted">{t('page.tagline')}</span></div>
        </header>
        <MeshyPanel t={t} view="page" place="sidebar" />
        <section className="meshy-block" aria-labelledby="meshy-start">
          <div className="meshy-copy">
            <h2 id="meshy-start" className="meshy-h2">{t('page.start')}</h2>
            <span className="meshy-muted">{t(startSession ? 'page.startHint' : 'page.copyHint')}</span>
          </div>
          <div className="meshy-grid">{EXAMPLES.map((id) => <ExampleCard key={id} t={t} id={id} />)}</div>
        </section>
        <footer className="meshy-links meshy-small">
          <a className="meshy-textlink" href={docsUrl(site)} target="_blank" rel="noreferrer">{t('page.docs')}<IconRightUpOutlineRegular size={12} /></a>
          <a className="meshy-textlink" href={SITES[site].web} target="_blank" rel="noreferrer">{t('page.site')}<IconRightUpOutlineRegular size={12} /></a>
        </footer>
      </div>
    </div>
  )
}

type RendererContent = { kind: string; revision?: number; loaded?(version: string): void; failed?(): void }
type DocumentProps = { content: RendererContent; resourceAddress: string; t: T; sessionId?: string; inputActions?: InputActions }

/**
 * The keyed `sidebar.right.tab.document` body for the project file and for .glb: Meshy Studio.
 * The renderer contract wants the file's version once it is shown; a .glb no Meshy asset owns
 * opens in the plain viewer inside the Studio.
 */
function StudioBody({ content, resourceAddress, t, sessionId, inputActions, glb }: DocumentProps & { glb: boolean }) {
  const file = sessionFileOf(resourceAddress)
  const sid = file?.sessionId ?? sessionId
  const ready = useCallback((ok: boolean) => {
    if (!file || !sid) return
    const abort = new AbortController()
    void versionOf(sid, file.path, abort.signal).then((v) => (ok && v ? content.loaded?.(v) : content.failed?.()))
  }, [resourceAddress, content.revision])
  // The project file changes with every Studio write (a star, the current asset), and the Studio
  // polls the project itself, so a new revision of it only needs acknowledging: remounting would
  // drop the open tab and reload the model. A .glb that changed is a new model: start over.
  const shown = useRef(false)
  const onReady = useCallback((ok: boolean) => { shown.current = ok; ready(ok) }, [ready])
  useEffect(() => { if (!glb && shown.current) ready(true) }, [content.revision])
  if (!sid || !file) return null
  return <Studio key={glb ? `${resourceAddress}#${content.revision ?? 0}` : resourceAddress} t={t} sessionId={sid} focusPath={glb ? file.path : undefined} inputActions={inputActions} onReady={onReady} />
}
const GlbBody = (props: DocumentProps) => <StudioBody {...props} glb />
const ProjectBody = (props: DocumentProps) => <StudioBody {...props} glb={false} />

export function apply(ctx: Ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'meshy-dsh: dictionaries')
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'meshy', order: 40, label: () => ctx.locale.bind(NS)('nav'), locale: NS },
    MeshyPanel,
  )), 'meshy-dsh: settings section')
  ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
    { name: 'plugins.bundle.config', key: 'meshy-dsh', locale: NS },
    MeshyPanel,
  )), 'meshy-dsh: bundle page')
  // The left-sidebar entry and its page; `layout` owns the main column the entry selects.
  ctx.inject(['layout', 'slots', 'locale'], (ctx) => {
    ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
      { name: 'main', key: PAGE_ID, locale: NS },
      MeshyPage,
    )), 'meshy-dsh: page')
    ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
      { name: 'sidebar.panellist', id: PAGE_ID, order: 20, label: 'Meshy' },
      MeshySidebarIcon,
    )), 'meshy-dsh: sidebar entry')
  })
  ctx.inject(['uiWorkspace'], (ctx) => {
    ctx.effect(() => {
      startSession = (prompt) => ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'replace' })
      return () => { startSession = undefined }
    }, 'meshy-dsh: start a session from an example')
  })
  ctx.effect(() => {
    void readPlugin()
    const timer = setInterval(readPlugin, UPDATE_POLL_MS)
    return () => clearInterval(timer)
  }, 'meshy-dsh: update check')
  ctx.inject(['pluginNavigation'], (ctx) => {
    ctx.effect(() => {
      openBundle = (packageName) => ctx.pluginNavigation.openBundle(packageName)
      return () => { openBundle = undefined }
    }, 'meshy-dsh: open the plugin page')
  })
  // The cards of the Studio tools in the chat; the Studio card opens the project in the right sidebar.
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'meshy_open_studio', locale: NS },
    OpenStudioCard,
  )), 'meshy-dsh: studio card')
  ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'meshy_project', locale: NS },
    ProjectRow,
  )), 'meshy-dsh: project row')
  // Only where the document preview is mounted (the right sidebar of Web and Desktop).
  ctx.inject(['documentPreviews', 'slots', 'locale', 'remote', 'remote.workspaceFiles'], (ctx) => {
    ctx.effect(() => {
      setWorkspaceFiles(ctx.remote.workspaceFiles)
      return () => { setWorkspaceFiles(undefined) }
    }, 'meshy-dsh: workspace file reads')
    ctx.effect(() => ctx.documentPreviews.register({
      id: STUDIO_ID,
      extensions: ['meshy'],
      priority: 'extension',
      title: () => ctx.locale.bind(NS)('studio.title'),
      loading: 'renderer',
    }), 'meshy-dsh: studio preview')
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
      { name: 'sidebar.right.tab.document', key: STUDIO_ID, locale: NS },
      ProjectBody,
    )), 'meshy-dsh: studio body')
    ctx.effect(() => ctx.documentPreviews.register({
      id: GLB_ID,
      extensions: ['glb'],
      binaryExtensions: ['glb'],
      priority: 'extension',
      title: () => ctx.locale.bind(NS)('studio.title'),
      loading: 'renderer',
    }), 'meshy-dsh: glb preview')
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
      { name: 'sidebar.right.tab.document', key: GLB_ID, locale: NS },
      GlbBody,
    )), 'meshy-dsh: glb body')
  })
}
