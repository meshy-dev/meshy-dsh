// Browser half: the "Meshy" settings section (also the meshy-dsh page in Plugins) and a 3D
// preview for .glb files in the right sidebar. Only react comes from the host's seed table;
// three.js lives in the client.viewer.js chunk, fetched when a model is first shown.
import { useCallback, useEffect, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'

/** The module loader's lazy chunk import (see dsh-client-modules "Lazy-CJS model"). */
declare const require: { async(path: string): Promise<typeof import('./viewer.ts')> }

type T = (key: string) => string
// Partial projections of the dsh client services this file uses.
type Ctx = {
  slots: { inject(name: string, register: () => () => void): () => void; register(spec: object, component: unknown): () => void }
  locale: { register(ns: string, dicts: object): () => void; bind(ns: string): T }
  documentPreviews: { register(definition: object): () => void }
  effect(execute: () => () => unknown, label?: string): unknown
  inject(deps: string[], callback: (ctx: Ctx) => void): unknown
}

export const name = 'meshy-dsh-client'
export const inject = ['slots', 'locale']

const NS = 'meshy'
const GLB_ID = 'meshy-dsh/glb'

const en = {
  nav: 'Meshy',
  summary: 'Meshy sign-in and the 3D preview for GLB files.',
  loading: 'Loading…',
  refresh: 'Refresh',
  cli: 'Meshy CLI',
  account: 'Account',
  signedIn: 'Signed in',
  signedOut: 'Not signed in',
  unverified: 'Signed in, but the credential could not be verified',
  site: 'Site',
  'site.global': 'Global (meshy.ai)',
  'site.cn': 'China (meshy.cn)',
  credits: 'Credits',
  signIn: 'Sign in',
  signOut: 'Sign out',
  'login.open': 'Open the link and approve, or scan it with your phone:',
  'login.code': 'Code',
  'login.done': 'I have approved',
  'login.pending': 'Still waiting for the approval. Approve in the browser, then try again.',
  failed: 'Something went wrong',
  'viewer.title': '3D model',
  'viewer.failed': 'This model cannot be shown',
}
const zh: typeof en = {
  nav: 'Meshy',
  summary: 'Meshy 登录状态，以及 GLB 文件的 3D 预览。',
  loading: '加载中…',
  refresh: '刷新',
  cli: 'Meshy CLI',
  account: '账号',
  signedIn: '已登录',
  signedOut: '未登录',
  unverified: '已登录，但凭据验证失败',
  site: '站点',
  'site.global': '国际站（meshy.ai）',
  'site.cn': '中国站（meshy.cn）',
  credits: '积分',
  signIn: '登录',
  signOut: '退出登录',
  'login.open': '打开链接并批准，或用手机扫码：',
  'login.code': '验证码',
  'login.done': '我已批准',
  'login.pending': '还没有收到批准。请在浏览器里批准后再试。',
  failed: '出错了',
  'viewer.title': '3D 模型',
  'viewer.failed': '无法显示这个模型',
}

type Status = {
  cli: { version: string; runner: string } | null
  error?: string
  auth?: { authenticated: boolean; verified: boolean; source: string | null; credential: string | null; region: 'global' | 'cn'; balance: number | null; hint: string | null }
}
type Flow = { verification_url: string; user_code: string; flow_id: string }

async function api(path: string, body?: object): Promise<{ status: number; data: any }> {
  const res = await fetch(`api/${path}`, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as const
const muted = { opacity: 0.7 } as const

function MeshyPanel({ t, view }: { t: T; view?: 'page' | 'summary' }) {
  const [status, setStatus] = useState<Status>()
  const [site, setSite] = useState<'global' | 'cn'>('global')
  const [flow, setFlow] = useState<Flow>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string>()

  const refresh = useCallback(async () => {
    setStatus(undefined)
    try {
      setStatus((await api('meshy.status')).data)
    } catch (err) {
      setStatus({ cli: null, error: String(err) })
    }
  }, [])
  useEffect(() => { if (view !== 'summary') void refresh() }, [refresh, view])
  if (view === 'summary') return <span>{t('summary')}</span>

  const act = async (step: () => Promise<void>) => {
    setBusy(true)
    setMessage(undefined)
    try {
      await step()
    } catch (err) {
      setMessage(`${t('failed')}: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }
  const signIn = () => act(async () => {
    const { status: code, data } = await api('meshy.login', { region: site })
    if (code !== 200) throw new Error(data.error ?? code)
    setFlow(data)
  })
  const finish = () => act(async () => {
    const { status: code, data } = await api('meshy.login.finish', { flow_id: flow!.flow_id })
    if (code === 202) return setMessage(t('login.pending'))
    if (code !== 200) throw new Error(data.error ?? code)
    setFlow(undefined)
    await refresh()
  })
  const signOut = () => act(async () => {
    const { status: code, data } = await api('meshy.logout', {})
    if (code !== 200) throw new Error(data.error ?? code)
    await refresh()
  })

  const auth = status?.auth
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0', fontSize: 14 }}>
      {!status ? <div style={muted}>{t('loading')}</div> : !status.cli ? <div role="alert">{status.error}</div> : (
        <>
          <div style={row}><strong>{t('cli')}</strong><span>{status.cli.version}</span><span style={muted}>({status.cli.runner})</span></div>
          <div style={row}>
            <strong>{t('account')}</strong>
            <span>{!auth?.authenticated ? t('signedOut') : auth.verified ? t('signedIn') : t('unverified')}</span>
            {auth?.authenticated && <span style={muted}>{t(`site.${auth.region}`)}{auth.credential ? ` · ${auth.credential}` : ''}</span>}
          </div>
          {auth?.authenticated && auth.balance !== null && <div style={row}><strong>{t('credits')}</strong><span>{auth.balance}</span></div>}
          {auth?.authenticated ? (
            <div style={row}><button type="button" disabled={busy} onClick={signOut}>{t('signOut')}</button></div>
          ) : !flow ? (
            <div style={row}>
              <label style={row}>{t('site')}
                <select value={site} disabled={busy} onChange={(e) => setSite(e.target.value as 'global' | 'cn')}>
                  <option value="global">{t('site.global')}</option>
                  <option value="cn">{t('site.cn')}</option>
                </select>
              </label>
              <button type="button" disabled={busy} onClick={signIn}>{t('signIn')}</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span>{t('login.open')}</span>
              <a href={flow.verification_url} target="_blank" rel="noreferrer">{flow.verification_url}</a>
              <img alt="" src={qr(flow.verification_url)} style={{ width: 168, height: 168, background: '#fff', borderRadius: 8 }} />
              <div style={row}><strong>{t('login.code')}</strong><code>{flow.user_code}</code></div>
              <div style={row}><button type="button" disabled={busy} onClick={finish}>{t('login.done')}</button></div>
            </div>
          )}
          <div style={row}><button type="button" disabled={busy} onClick={refresh}>{t('refresh')}</button></div>
        </>
      )}
      {message && <div role="status">{message}</div>}
    </div>
  )
}

function qr(text: string): string {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  return code.createDataURL(4, 2)
}

/** The keyed `sidebar.right.tab.document` body for .glb, fed the file's complete bytes. */
function GlbBody({ content, t }: { content: { kind: string; data?: Uint8Array }; t: T }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  useEffect(() => {
    const el = host.current
    if (content.kind !== 'bytes' || !content.data || !el) return
    let dispose: (() => void) | undefined
    let cancelled = false
    setError(undefined)
    require.async('./client.viewer.js')
      .then((viewer) => viewer.mountViewer(el, content.data!))
      .then((stop) => { if (cancelled) stop(); else dispose = stop })
      .catch((err) => { if (!cancelled) setError(String(err?.message ?? err)) })
    return () => { cancelled = true; dispose?.() }
  }, [content])
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 360 }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      {error && <div role="alert" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 16, textAlign: 'center' }}>{t('viewer.failed')}: {error}</div>}
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
  // Only where the document preview is mounted (the right sidebar of Web and Desktop).
  ctx.inject(['documentPreviews', 'slots', 'locale'], (ctx) => {
    ctx.effect(() => ctx.documentPreviews.register({
      id: GLB_ID,
      extensions: ['glb'],
      binaryExtensions: ['glb'],
      priority: 'extension',
      title: () => ctx.locale.bind(NS)('viewer.title'),
      loading: 'bytes-complete',
    }), 'meshy-dsh: glb preview')
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
      { name: 'sidebar.right.tab.document', key: GLB_ID, locale: NS },
      GlbBody,
    )), 'meshy-dsh: glb body')
  })
}
