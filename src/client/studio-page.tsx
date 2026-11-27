// Settings -> Meshy and Plugins -> Meshy (account and sign-in), and the left-sidebar Meshy page:
// the account, recent generations on the account, and prompts that start a session.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, ImageLightbox, Modal, SegmentedControl, SegmentedTabs, StateDot, TextShimmer, Tooltip, writeClipboard,
  IconCheckOutlineRegular, IconCopyOutlineRegular, IconNewChatOutlineRegular,
  IconRefreshOutlineRegular, IconRightUpOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import qrcode from 'qrcode-generator'
import {
  api, docsUrl, getOpenBundle, getStartSession, Logo, MeshyGlyph,
  notifyAuthChanged, readPlugin, setSite, useAuthRevision, usePlugin, useSite,
  PACKAGE, RELEASES, SITES,
  type PluginInfo, type Site,
} from './common.tsx'
import { detectLocale, type T } from './locales.ts'
import { StageViewer } from './stage.tsx'
import { actionPrompt, agoText, kindOf, phaseOf, resourceLabel, titleOf, type LibraryItem } from './workbench.ts'

const EXAMPLES = ['chest', 'photo', 'character', 'print'] as const
const LOW_CREDITS = 30
type LibraryFilter = 'all' | 'model' | 'image'

type Account = { name: string | null; email: string | null }
type Auth = {
  authenticated: boolean
  verified: boolean
  method: 'browser' | 'apiKey' | null
  account: Account | null
  region: Site
  balance: number | null
}
type Status = { cli: { version: string } | null; error?: string; auth?: Auth }
type Flow = { verification_url: string; user_code: string; flow_id: string; expires_in?: number }
type Problem = { kind: 'cli' | 'expired' | 'generic'; message?: string }

function qr(text: string): string {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  return code.createDataURL(6, 0)
}

function Identity({
  t,
  page,
  line,
  pill,
  bare,
}: {
  t: T
  page: boolean
  line: string
  pill: 'checking' | 'on' | 'off' | 'warn'
  /** Drop the card around it, for a head that sits inside another card. */
  bare?: boolean
}) {
  const title = page ? t('accountTitle') : 'Meshy'
  return (
    <div className={bare ? 'meshy-head' : 'meshy-card meshy-head'}>
      <div className="meshy-identity">
        {!page && <Logo />}
        <div className="meshy-copy">
          <span className="meshy-name">{title}</span>
          <span className="meshy-muted">{line}</span>
        </div>
      </div>
      <span className="meshy-pill meshy-muted">
        {pill === 'checking' ? (
          <StateDot state="ongoing" size={12} />
        ) : (
          <span className="meshy-dot" data-on={pill === 'on' || undefined} data-warn={pill === 'warn' || undefined} />
        )}
        {t(pill === 'checking' ? 'checking' : pill === 'on' ? 'signedIn' : pill === 'warn' ? 'unverified' : 'signedOut')}
      </span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="meshy-card meshy-rows" aria-hidden="true">
      <div className="meshy-row">
        <span className="meshy-skeleton" style={{ width: 64, height: 14 }} />
        <span className="meshy-skeleton" style={{ width: 120, height: 22 }} />
      </div>
      <div className="meshy-divider" />
      <div className="meshy-row">
        <span className="meshy-skeleton" style={{ width: 48, height: 14 }} />
        <span className="meshy-skeleton" style={{ width: 180, height: 36 }} />
      </div>
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

function UpdateNotice({ t, plugin, here }: { t: T; plugin: PluginInfo; here: boolean }) {
  const openBundle = getOpenBundle()
  return (
    <div className="meshy-card meshy-update">
      <div className="meshy-copy">
        <span className="meshy-name meshy-pill">
          <span className="meshy-dot" data-on />
          {t('update.title', { version: plugin.update! })}
        </span>
        <span className="meshy-muted meshy-small">
          {t(here ? 'update.hintHere' : 'update.hint', { current: plugin.version })}
        </span>
      </div>
      <div className="meshy-actions">
        <a className="meshy-link" href={`${RELEASES}/v${plugin.update}`} target="_blank" rel="noreferrer">
          {t('update.notes')}
          <IconRightUpOutlineRegular size={12} />
        </a>
        {!here && openBundle && (
          <Button variant="outline" onClick={() => openBundle(PACKAGE)}>
            {t('update.open')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Settings -> Meshy and Plugins -> Meshy account & sign-in panel. */
export function MeshyPanel({ t, view, place }: { t: T; view?: 'page' | 'summary'; place?: 'sidebar' }) {
  const [status, setStatus] = useState<Status>()
  const plugin = usePlugin()
  const site = useSite()
  const [flow, setFlow] = useState<Flow>()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem>()
  const [copied, setCopied] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const polling = useRef(0)

  useEffect(() => {
    if (status?.auth?.authenticated) setSite(status.auth.region)
  }, [status])

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

  const signIn = async () => {
    setBusy(true)
    setProblem(undefined)
    try {
      const { status: code, data } = await api('meshy.login', { region: site })
      if (code !== 200) throw new Error(data.error ?? String(code))
      setFlow(data)
      const run = ++polling.current
      const deadline = Date.now() + (data.expires_in ?? 600) * 1000
      while (run === polling.current) {
        if (Date.now() > deadline) {
          setFlow(undefined)
          setProblem({ kind: 'expired' })
          return
        }
        const done = await api('meshy.login.finish', { flow_id: data.flow_id })
        if (run !== polling.current) return
        if (done.status === 202) continue
        if (done.status !== 200) {
          setFlow(undefined)
          setProblem(
            /expir/i.test(done.data.error ?? '')
              ? { kind: 'expired' }
              : { kind: 'generic', message: done.data.error ?? String(done.status) },
          )
          return
        }
        setFlow(undefined)
        await refresh()
        notifyAuthChanged()
        return
      }
    } catch (err) {
      setFlow(undefined)
      setProblem({ kind: 'generic', message: String((err as Error)?.message ?? err) })
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    polling.current++
    setFlow(undefined)
    setBusy(false)
  }

  const signOut = async () => {
    setConfirmOut(false)
    setBusy(true)
    try {
      const { status: code, data } = await api('meshy.logout', {})
      if (code !== 200) throw new Error(data.error ?? String(code))
      await refresh()
      notifyAuthChanged()
    } catch (err) {
      setProblem({ kind: 'generic', message: String((err as Error)?.message ?? err) })
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (flow && (await writeClipboard(flow.user_code))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const auth = status?.auth
  const signedIn = !!auth?.authenticated
  const shownSite: Site = auth?.region ?? site
  const problemText =
    problem &&
    (problem.kind === 'expired'
      ? t('error.expired')
      : problem.kind === 'cli'
        ? t('error.cli')
        : t('error.generic', { message: problem.message ?? '' }))
  // Lime marks "Get credits" only when one text-to-3d preview and refine (20 + 10) no longer fit.
  const low = auth?.balance != null && auth.balance < LOW_CREDITS
  const identity = status && (
    <Identity
      t={t}
      page={view === 'page'}
      bare={Boolean(status.cli) && signedIn}
      line={signedIn ? `${t(`site.${shownSite}`)} · ${SITES[shownSite].host}` : t(view === 'page' ? 'summary' : 'tagline')}
      pill={!status.cli ? 'off' : !signedIn ? 'off' : auth!.verified ? 'on' : 'warn'}
    />
  )
  const notice = plugin?.update ? (
    <UpdateNotice t={t} plugin={plugin} here={view === 'page' && place !== 'sidebar'} />
  ) : null

  return (
    <section className="meshy-root meshy-section" aria-label={t('nav')}>
      {!status ? (
        <>
          <Identity t={t} page={view === 'page'} line={t(view === 'page' ? 'summary' : 'tagline')} pill="checking" />
          {notice}
          <Skeleton />
        </>
      ) : (
        <>
          {!(status.cli && signedIn) && identity}
          {notice}

          {problem && (
            <Alert
              action={
                problem.kind === 'cli' ? (
                  <Button variant="outline" size="sm" onClick={refresh}>{t('refresh')}</Button>
                ) : problem.kind === 'expired' ? (
                  <Button variant="outline" size="sm" onClick={signIn}>{t('retry')}</Button>
                ) : undefined
              }
            >
              <span>{problemText}</span>
              {problem.kind === 'cli' && <span className="meshy-muted meshy-small">{t('error.cliHint')}</span>}
            </Alert>
          )}

          {status.cli && signedIn && (
            <div className="meshy-card meshy-rows">
              {identity}
              <div className="meshy-divider" />
              {!auth!.verified && <Alert><span>{t('unverified.hint')}</span></Alert>}
              {auth!.account && (
                <>
                  <div className="meshy-row">
                    <span>{t('account')}</span>
                    <span className="meshy-account">
                      <span>{auth!.account.name ?? auth!.account.email}</span>
                      {auth!.account.name && auth!.account.email && (
                        <span className="meshy-muted meshy-small">{auth!.account.email}</span>
                      )}
                    </span>
                  </div>
                  <div className="meshy-divider" />
                </>
              )}
              <div className="meshy-row">
                <span>{t('credits')}</span>
                <span className="meshy-amount">
                  {auth!.balance === null ? (
                    <span className="meshy-muted meshy-small">—</span>
                  ) : (
                    <>
                      <span className="meshy-coin" />
                      {auth!.balance.toLocaleString()}
                    </>
                  )}
                </span>
              </div>
              <div className="meshy-divider" />
              <div className="meshy-row">
                <span>{t('method')}</span>
                <span className="meshy-muted">{auth!.method ? t(`method.${auth!.method}`) : '—'}</span>
              </div>
              <div className="meshy-divider" />
              <div className="meshy-row" style={{ justifyContent: 'flex-end' }}>
                <div className="meshy-actions">
                  <Button variant="outline" disabled={busy} onClick={() => setConfirmOut(true)}>
                    {t('signOut')}
                  </Button>
                  <a
                    className={low ? 'meshy-link meshy-accent' : 'meshy-link'}
                    href={`${SITES[shownSite].web}/pricing`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('credits.get')}
                    <IconRightUpOutlineRegular size={12} />
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
                  options={[
                    { value: 'global', label: `${t('site.global')} · meshy.ai` },
                    { value: 'cn', label: `${t('site.cn')} · meshy.cn` },
                  ]}
                />
              </div>
              <div className="meshy-divider" />
              <div className="meshy-row">
                <span className="meshy-muted">{t('signIn.hint')}</span>
                <Button variant="primary" className="meshy-accent" disabled={busy} onClick={signIn}>
                  {t('signIn')}
                </Button>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('copy')}
                      icon={copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
                      onClick={copy}
                    />
                  </Tooltip>
                </span>
                <span className="meshy-waiting">
                  <StateDot state="ongoing" size={12} />
                  <TextShimmer active>{t('signIn.waiting')}</TextShimmer>
                </span>
                <div className="meshy-actions" style={{ justifyContent: 'flex-start' }}>
                  <a className="meshy-link meshy-accent" href={flow.verification_url} target="_blank" rel="noreferrer">
                    {t('signIn.open')}
                    <IconRightUpOutlineRegular size={12} />
                  </a>
                  <Button variant="outline" onClick={cancel}>{t('cancel')}</Button>
                </div>
              </div>
            </div>
          )}

          {status.cli && (
            <div className="meshy-foot meshy-muted meshy-small">
              <span>
                {plugin
                  ? t('versions', { plugin: plugin.version, cli: status.cli.version })
                  : t('cli', { version: status.cli.version })}
              </span>
              <Tooltip label={t('refresh')} side="top">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('refresh')}
                  disabled={busy}
                  icon={<IconRefreshOutlineRegular size={14} />}
                  onClick={refresh}
                />
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
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOut(false)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={signOut}>{t('signOut')}</Button>
          </>
        }
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Recent generations on the account (GET /api/meshy.library); the API keeps assets 3 days
// ---------------------------------------------------------------------------
const RETENTION_DAYS = 3

function expired(item: LibraryItem, now: number, days: number): boolean {
  if (typeof item.expiresAt === 'number' && item.expiresAt > 0) return item.expiresAt <= now
  const at = item.createdAt ?? 0
  return at > 0 && now - at >= days * 86_400_000
}

/** A library title; tasks with no prompt or name (image to 3D, rigging) get their time to tell them apart. */
function libraryTitle(item: LibraryItem, maxLen: number, locale: 'en' | 'zh'): string {
  const title = titleOf(item, maxLen, locale)
  const at = item.createdAt ?? item.finishedAt
  if (!at || title !== resourceLabel(item.resource, locale)) return title
  const when = new Date(at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return `${title} · ${when}`
}

function LibraryThumb({ src, title }: { src?: string | null; title: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <MeshyGlyph size={28} />
  return <img src={src} alt={title} loading="lazy" draggable={false} onError={() => setFailed(true)} />
}

function LibrarySection({ t }: { t: T }) {
  const locale = detectLocale(t)
  const authRev = useAuthRevision()
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [items, setItems] = useState<LibraryItem[]>([])
  const [days, setDays] = useState(RETENTION_DAYS)
  const [authenticated, setAuthenticated] = useState<boolean>(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [preview, setPreview] = useState<LibraryItem | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const loadLibrary = useCallback(async (forceRefresh = false) => {
    setLoading(true)
    setError(false)
    try {
      const qs = new URLSearchParams({ limit: '24' })
      if (forceRefresh) qs.set('refresh', '1')
      const { status, data } = await api(`meshy.library?${qs.toString()}`)
      if (status !== 200) throw new Error(data?.error ?? String(status))
      setAuthenticated(data?.authenticated !== false)
      setItems(Array.isArray(data?.items) ? data.items : [])
      if (typeof data?.retentionDays === 'number' && data.retentionDays > 0) setDays(data.retentionDays)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadLibrary(false)
  }, [loadLibrary, authRev])

  const live = useMemo(() => {
    const now = Date.now()
    const seen = new Set<string>()
    return items.filter((it) => {
      if (seen.has(it.taskId)) return false
      seen.add(it.taskId)
      return kindOf(it) && !expired(it, now, days) && phaseOf({ status: it.status }) !== 'canceled'
    })
  }, [items, days])
  const counts = { model: live.filter((it) => kindOf(it) === 'model').length, image: live.filter((it) => kindOf(it) === 'image').length }
  const visible = filter === 'all' ? live : live.filter((it) => kindOf(it) === filter)

  const useInNewSession = async (item: LibraryItem) => {
    const prompt = kindOf(item) === 'image'
      ? actionPrompt('imageTo3d', { taskId: item.taskId, resource: item.resource, title: titleOf(item, 56, locale) }, locale)
      : actionPrompt('useInSession', { taskId: item.taskId, resource: item.resource, title: titleOf(item, 56, locale) }, locale)
    const startSession = getStartSession()
    if (startSession) {
      startSession(prompt)
      return
    }
    if (await writeClipboard(prompt)) {
      setCopiedId(item.taskId)
      setTimeout(() => setCopiedId((cur) => (cur === item.taskId ? null : cur)), 1600)
    }
  }

  const previewKind = preview ? kindOf(preview) : null

  return (
    <section className="meshy-block" aria-labelledby="meshy-library">
      <div className="meshy-block-head">
        <div className="meshy-copy">
          <h2 id="meshy-library" className="meshy-h2">{t('library.title')}</h2>
          <span className="meshy-muted meshy-small">{t('library.hint', { days })}</span>
        </div>
        <div className="meshy-actions">
          {counts.model > 0 && counts.image > 0 && (
            <SegmentedTabs
              size="sm"
              label={t('library.filter')}
              value={filter}
              onChange={(value: string) => setFilter(value as LibraryFilter)}
              items={[
                { value: 'all', label: t('library.filter.all') },
                { value: 'model', label: t('studio.models') },
                { value: 'image', label: t('studio.images') },
              ]}
            />
          )}
          <Tooltip label={t('refresh')} side="top" portal>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('refresh')}
              disabled={loading}
              icon={<IconRefreshOutlineRegular size={14} />}
              onClick={() => { void loadLibrary(true) }}
            />
          </Tooltip>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="meshy-lib-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="meshy-lib-item">
              <span className="meshy-skeleton" style={{ width: '100%', aspectRatio: '1', borderRadius: 10 }} />
              <span className="meshy-skeleton" style={{ width: '70%', height: 14 }} />
            </div>
          ))}
        </div>
      ) : !authenticated ? (
        <div className="meshy-card meshy-muted meshy-small">{t('library.signedOut')}</div>
      ) : error ? (
        <Alert action={<Button variant="outline" size="sm" onClick={() => { void loadLibrary(true) }}>{t('retry')}</Button>}>
          <span>{t('library.error')}</span>
        </Alert>
      ) : visible.length === 0 ? (
        <div className="meshy-card meshy-muted meshy-small">{t('library.empty', { days })}</div>
      ) : (
        <div className="meshy-lib-grid">
          {visible.map((item) => {
            const phase = phaseOf({ status: item.status })
            const title = libraryTitle(item, 48, locale)
            return (
              <article key={`${item.resource}:${item.taskId}`} className="meshy-lib-item">
                <button
                  type="button"
                  className="meshy-lib-thumb"
                  aria-label={t('library.preview')}
                  disabled={phase !== 'done'}
                  onClick={() => setPreview(item)}
                >
                  <LibraryThumb src={item.thumbnail} title={title} />
                  {phase !== 'done' && (
                    <span className="meshy-lib-state">
                      {phase === 'active' ? <StateDot state="ongoing" size={10} /> : <span className="meshy-dot" data-err />}
                      {phase === 'active' && typeof item.progress === 'number' ? `${Math.round(item.progress)}%` : t(`sidebar.status.${phase}`)}
                    </span>
                  )}
                </button>
                <div className="meshy-lib-text">
                  <div className="meshy-copy">
                    <span className="meshy-lib-title meshy-ellipsis" title={title}>{title}</span>
                    <span className="meshy-xs meshy-muted meshy-ellipsis">
                      {[
                        resourceLabel(item.resource, locale) !== title ? resourceLabel(item.resource, locale) : null,
                        item.createdAt ? agoText(item.createdAt, Date.now(), locale) : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {phase === 'done' && (
                    <Tooltip label={copiedId === item.taskId ? t('copied') : t('library.use')} side="top" portal>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('library.use')}
                        icon={copiedId === item.taskId ? <IconCheckOutlineRegular size={14} /> : <IconNewChatOutlineRegular size={14} />}
                        onClick={() => { void useInNewSession(item) }}
                      />
                    </Tooltip>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {preview && previewKind === 'image' && preview.thumbnail && (
        <ImageLightbox
          src={preview.thumbnail}
          alt={libraryTitle(preview, 80, locale)}
          labels={{ dialog: libraryTitle(preview, 80, locale), close: t('close') }}
          onClose={() => setPreview(null)}
        />
      )}
      <Modal
        open={preview !== null && previewKind === 'model'}
        onClose={() => setPreview(null)}
        title={preview ? libraryTitle(preview, 80, locale) : t('library.modalTitle')}
        closeLabel={t('close')}
        className="meshy-root meshy-modal"
        footer={
          preview ? (
            <>
              <Button variant="outline" onClick={() => setPreview(null)}>{t('close')}</Button>
              <Button
                className="meshy-accent"
                onClick={() => {
                  const target = preview
                  setPreview(null)
                  void useInNewSession(target)
                }}
              >
                {t('library.use')}
              </Button>
            </>
          ) : undefined
        }
      >
        {preview && previewKind === 'model' && (
          <div className="meshy-modal-viewer">
            <StageViewer source={{ kind: 'task', resource: preview.resource, taskId: preview.taskId }} variants={preview.variants} t={t} />
          </div>
        )}
      </Modal>
    </section>
  )
}

function ExampleCard({ t, id }: { t: T; id: (typeof EXAMPLES)[number] }) {
  const prompt = t(`example.${id}.prompt`)
  const [copied, setCopied] = useState(false)
  const startSession = getStartSession()
  const run = async () => {
    if (startSession) return startSession(prompt)
    if (await writeClipboard(prompt)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <button type="button" className="meshy-example" onClick={run}>
      <span className="meshy-example-title">{t(`example.${id}.title`)}</span>
      <span className="meshy-muted meshy-small">{copied ? t('copied') : prompt}</span>
    </button>
  )
}

/** Left-sidebar Meshy Studio page: Account card + Recent Models Library + Start Creating examples. */
export function MeshyPage({ t }: { t: T }) {
  const site = useSite()
  const startSession = getStartSession()
  return (
    <div className="meshy-root meshy-page">
      <div className="meshy-page-inner">
        <header className="meshy-hero">
          <Logo />
          <div className="meshy-copy">
            <h1>Meshy</h1>
            <span className="meshy-muted">{t('page.tagline')}</span>
          </div>
        </header>
        <MeshyPanel t={t} view="page" place="sidebar" />
        <LibrarySection t={t} />
        <section className="meshy-block" aria-labelledby="meshy-start">
          <div className="meshy-copy">
            <h2 id="meshy-start" className="meshy-h2">{t('page.start')}</h2>
            <span className="meshy-muted">{t(startSession ? 'page.startHint' : 'page.copyHint')}</span>
          </div>
          <div className="meshy-grid">
            {EXAMPLES.map((id) => <ExampleCard key={id} t={t} id={id} />)}
          </div>
        </section>
        <footer className="meshy-links meshy-small">
          <a className="meshy-textlink" href={docsUrl(site)} target="_blank" rel="noreferrer">
            {t('page.docs')}
            <IconRightUpOutlineRegular size={12} />
          </a>
          <a className="meshy-textlink" href={SITES[site].web} target="_blank" rel="noreferrer">
            {t('page.site')}
            <IconRightUpOutlineRegular size={12} />
          </a>
        </footer>
      </div>
    </div>
  )
}
