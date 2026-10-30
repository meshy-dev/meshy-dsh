// Browser half: the "Meshy" settings section (also the meshy-dsh page in Plugins) and a 3D
// preview for .glb files in the right sidebar. React and dsh's component library come from the
// host's seed table; three.js lives in the client.viewer.js chunk, fetched on first preview.
// Layout follows dsh's own Account section (cards, rows, dividers, theme tokens); Meshy's lime
// marks only the primary actions and the signed-in state.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  Button, Modal, SegmentedControl, StateDot, TextShimmer, Tooltip, fileSizeText, writeClipboard,
  IconCheckOutlineRegular, IconChevronRightOutlineRegular, IconCopyOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular,
  IconRefreshOutlineRegular, IconRightUpOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import qrcode from 'qrcode-generator'
import type { Viewer } from './viewer.ts'

/** The module loader's lazy chunk import (see dsh-client-modules "Lazy-CJS model"). */
declare const require: { async(path: string): Promise<typeof import('./viewer.ts')> }
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
  effect(execute: () => () => unknown, label?: string): unknown
  inject(deps: string[], callback: (ctx: Ctx) => void): unknown
}

// dsh's workspace file Remote: a call never rejects, the result carries the failure.
type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message?: string; details?: { limit?: number } } }
type WorkspaceFiles = {
  readBytes(sessionId: string, path: string, options: { range: { offset: number; length: number } }, signal: AbortSignal):
    Promise<Result<{ data: Uint8Array; eof: boolean; bytes?: number; version: string }>>
}

export const name = 'meshy-dsh-client'
export const inject = ['slots', 'locale']

const NS = 'meshy'
const GLB_ID = 'meshy-dsh/glb'
/**
 * dsh refuses a complete-file read above 32 MiB (`maxFileBytes`), so the preview reads 2 MiB
 * windows (`maxBytes`, the per-window cap) and stops at its own limit instead.
 */
const WINDOW = 2 << 20
const MAX_GLB = 256 << 20
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
  'cli.temporary': 'run through npm exec',
  'error.cli': 'Meshy CLI not found',
  'error.cliHint': 'Install Node.js 22.12 or newer, then run this and refresh:',
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
  'cli.temporary': '通过 npm exec 运行',
  'error.cli': '找不到 Meshy CLI',
  'error.cliHint': '请安装 Node.js 22.12 或更新版本，运行下面的命令后刷新：',
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
.meshy-mark{display:inline-flex;flex:none}
.meshy-tools{display:flex;gap:4px;padding:2px;border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent);backdrop-filter:blur(8px)}
`
if (typeof document !== 'undefined' && !document.querySelector('style[data-plugin-css="meshy-dsh/client.css"]')) {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'meshy-dsh'
  tag.dataset.pluginCss = 'meshy-dsh/client.css'
  tag.textContent = CSS
  document.head.append(tag)
}

type Auth = { authenticated: boolean; verified: boolean; method: 'browser' | 'apiKey' | null; region: Site; balance: number | null }
type Status = { cli: { version: string; runner: string } | null; error?: string; auth?: Auth }
type Flow = { verification_url: string; user_code: string; flow_id: string; expires_in?: number }
type Problem = { kind: 'cli' | 'expired' | 'generic'; message?: string }

async function api(path: string, body?: object): Promise<{ status: number; data: any }> {
  const res = await fetch(`api/${path}`, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

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

function MeshyPanel({ t, view }: { t: T; view?: 'page' | 'summary' }) {
  const [status, setStatus] = useState<Status>()
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

  return (
    <section className="meshy-root meshy-section" aria-label={t('nav')}>
      {!status ? (
        <><Identity t={t} page={view === 'page'} line={t(view === 'page' ? 'summary' : 'tagline')} pill="checking" /><Skeleton /></>
      ) : (
        <>
          <Identity
            t={t}
            page={view === 'page'}
            line={signedIn ? `${t(`site.${shownSite}`)} · ${SITES[shownSite].host}` : t(view === 'page' ? 'summary' : 'tagline')}
            pill={!status.cli ? 'off' : !signedIn ? 'off' : auth!.verified ? 'on' : 'warn'}
          />

          {problem && (
            <Alert action={problem.kind === 'cli'
              ? <Button variant="outline" size="sm" onClick={refresh}>{t('refresh')}</Button>
              : problem.kind === 'expired' ? <Button variant="outline" size="sm" onClick={signIn}>{t('retry')}</Button> : undefined}>
              <span>{problemText}</span>
              {problem.kind === 'cli' && <><span className="meshy-muted meshy-small">{t('error.cliHint')}</span><code>npm install -g meshy-cli@0.7</code></>}
            </Alert>
          )}

          {status.cli && signedIn && (
            <div className="meshy-card meshy-rows">
              {!auth!.verified && <Alert><span>{t('unverified.hint')}</span></Alert>}
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
              <span>{t('cli', { version: status.cli.version })}{status.cli.runner === 'npm exec' ? ` · ${t('cli.temporary')}` : ''}</span>
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

/** Left-sidebar icon: the host passes the edge size (18 expanded, 16 collapsed); colour follows the row. */
function MeshySidebarIcon({ size = 16 }: { size?: number; active?: boolean }) {
  return <span className="meshy-mark" aria-hidden="true" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: __MESHY_MONO__ }} />
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
        <MeshyPanel t={t} view="page" />
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

let workspaceFiles: WorkspaceFiles | undefined

class TooLarge extends Error {
  constructor(readonly size: number) { super('too large') }
}

/** A preview tab's `dsh-resource://file/session/<id>/<path>` address (dsh-util-workspace-path's grammar). */
function sessionFileOf(address: string) {
  const m = /^dsh-resource:\/\/file\/session\/([^/?#]+)\/([^?#]+)/.exec(address)
  return m ? { sessionId: decodeURIComponent(m[1]), path: m[2].split('/').map(decodeURIComponent).join('/') } : undefined
}

/** Read the whole file window by window; a change mid-read starts over on the new version. */
async function readWindows(address: string, signal: AbortSignal, progress: (read: number, total: number) => void) {
  const file = sessionFileOf(address)
  if (!file || !workspaceFiles) throw new Error(`cannot read ${address}`)
  let chunks: Uint8Array[] = []
  let offset = 0
  let version: string | undefined
  let length = WINDOW
  for (;;) {
    const res = await workspaceFiles.readBytes(file.sessionId, file.path, { range: { offset, length } }, signal)
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
    if ((w.bytes ?? 0) > MAX_GLB) throw new TooLarge(w.bytes!)
    chunks.push(w.data)
    offset += w.data.byteLength
    if (offset > MAX_GLB) throw new TooLarge(offset)
    progress(offset, w.bytes ?? offset)
    if (w.eof || w.data.byteLength === 0) break
  }
  const data = new Uint8Array(offset)
  let at = 0
  for (const c of chunks) { data.set(c, at); at += c.byteLength }
  return { data, version: version! }
}

type RendererContent = { kind: string; revision?: number; loaded?(version: string): void; failed?(): void }

/** The keyed `sidebar.right.tab.document` body for .glb; it reads the file itself (renderer loading). */
function GlbBody({ content, resourceAddress, t }: { content: RendererContent; resourceAddress: string; t: T }) {
  const host = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<Viewer>()
  const [error, setError] = useState<string>()
  const [spinning, setSpinning] = useState(false)
  const [size, setSize] = useState(0)
  const [progress, setProgress] = useState<[number, number]>()
  useEffect(() => {
    const el = host.current
    if (content.kind !== 'renderer' || !el) return
    const abort = new AbortController()
    let mounted: Viewer | undefined
    setError(undefined)
    setViewer(undefined)
    setSpinning(false)
    setProgress(undefined)
    readWindows(resourceAddress, abort.signal, (read, total) => setProgress([read, total]))
      .then(async ({ data, version }) => {
        const v = await (await require.async('./client.viewer.js')).mountViewer(el, data)
        if (abort.signal.aborted) return v.dispose()
        mounted = v
        setSize(data.byteLength)
        setViewer(v)
        content.loaded?.(version)
      })
      .catch((err) => {
        if (abort.signal.aborted) return
        setError(err instanceof TooLarge
          ? t('viewer.tooLarge', { size: fileSizeText(err.size), limit: fileSizeText(MAX_GLB) })
          : String(err?.message ?? err))
        content.failed?.()
      })
    return () => { abort.abort(); mounted?.dispose() }
    // One read per revision: reload and implementation changes bump it.
  }, [content.kind, content.revision, resourceAddress])
  const toggle = () => { viewer?.setAutoRotate(!spinning); setSpinning(!spinning) }
  return (
    <div className="meshy-root meshy-viewer">
      <div ref={host} className="meshy-stage" />
      {!viewer && !error && (
        <div className="meshy-overlay meshy-muted">
          <Logo /><TextShimmer active>{t('viewer.loading')}</TextShimmer>
          {progress && progress[1] > WINDOW && <span className="meshy-small">{fileSizeText(progress[0])} / {fileSizeText(progress[1])}</span>}
        </div>
      )}
      {error && (
        <div className="meshy-overlay" role="alert">
          <IconWarningOutlineRegular size={20} />
          <span>{t('viewer.failed')}</span>
          <span className="meshy-muted meshy-small">{error}</span>
        </div>
      )}
      {viewer && (
        <div className="meshy-bar">
          <span className="meshy-chip">
            {fileSizeText(size)} · {t('viewer.triangles', { count: viewer.triangles.toLocaleString() })}
          </span>
          <span className="meshy-tools">
            <Tooltip label={t('viewer.reset')} side="top">
              <Button variant="ghost" size="sm" aria-label={t('viewer.reset')} icon={<IconRefreshOutlineRegular size={14} />} onClick={() => viewer.reset()} />
            </Tooltip>
            <Tooltip label={spinning ? t('viewer.stop') : t('viewer.spin')} side="top">
              <Button variant="ghost" size="sm" aria-label={spinning ? t('viewer.stop') : t('viewer.spin')} aria-pressed={spinning}
                icon={spinning ? <IconPauseOutlineRegular size={14} /> : <IconPlayOutlineRegular size={14} />} onClick={toggle} />
            </Tooltip>
          </span>
        </div>
      )}
    </div>
  )
}

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
  // Only where the document preview is mounted (the right sidebar of Web and Desktop).
  ctx.inject(['documentPreviews', 'slots', 'locale', 'remote', 'remote.workspaceFiles'], (ctx) => {
    ctx.effect(() => {
      workspaceFiles = ctx.remote.workspaceFiles
      return () => { workspaceFiles = undefined }
    }, 'meshy-dsh: workspace file reads')
    ctx.effect(() => ctx.documentPreviews.register({
      id: GLB_ID,
      extensions: ['glb'],
      binaryExtensions: ['glb'],
      priority: 'extension',
      title: () => ctx.locale.bind(NS)('viewer.title'),
      loading: 'renderer',
    }), 'meshy-dsh: glb preview')
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
      { name: 'sidebar.right.tab.document', key: GLB_ID, locale: NS },
      GlbBody,
    )), 'meshy-dsh: glb body')
  })
}
