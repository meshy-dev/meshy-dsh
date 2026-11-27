// The right-sidebar Meshy Studio tab (a type-aware stage over a Models / Images gallery) and the
// `.glb` document preview with its Meshy action menu. The 3D stage itself is in stage.tsx.
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button, ImageLightbox, Menu, SegmentedTabs, StateDot, TextShimmer, Toast, Tooltip,
  IconChevronDownOutlineRegular, IconDownloadOutlineRegular, IconEditOutlineRegular,
  IconPlayOutlineRegular, IconRefreshOutlineRegular, IconRightUpOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  insertPrompt, Logo, MeshyGlyph, openFileTab, openStudio, rememberStudioPane, snapshotKey,
  useHasActiveTask, useSessionData, useSnapshot, useWorkspaceImage,
  GLB_ID, TASKS_ID, TASKS_KIND,
  type ModelSource, type StudioTarget,
} from './common.tsx'
import { ENTRIES, handOff, handOffNotice, NoticeToast, type Entry, type Notice } from './handoff.tsx'
import { detectLocale, type T } from './locales.ts'
import { glyph, StageViewer } from './stage.tsx'
import {
  actionPrompt, agoText, assetsOf, displayPath, findAsset, sessionFileOf,
  type ActionKind, type Asset, type AssetKind, type InputActions,
} from './workbench.ts'

export { StageViewer, TASKS_ID, TASKS_KIND }

/** Remote thumbnails outlive the API's 3-day asset retention by a margin we do not count on. */
const REMOTE_FRESH_MS = 60 * 3600_000

type InputHook = <V>(select: (s: { draft: string; phase: string }) => V) => V
type TabInfo = {
  panel?: { id?: string; isFloating?: boolean }
  tab?: {
    contentId?: string
    visible?: boolean
    signal?: AbortSignal
    navigation?: { params?: { target?: StudioTarget } | null; revision?: number }
    actions?: { openResource?(address: string, options?: { preferNewPane?: boolean }): void }
  }
}

/** Whether an element is narrower than `width` (follows pane resizes). */
function useNarrow(ref: { current: HTMLElement | null }, width: number): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, width])
  return narrow
}

/** The composer bridge for one session-scoped slot: its input actions and whether the draft is empty. */
function useComposer(inputActions: unknown, useInput?: InputHook) {
  const draftEmpty = useInput ? useInput((s) => !s.draft.trim()) : undefined
  const ref = useRef(draftEmpty)
  ref.current = draftEmpty
  return (prompt: string) => insertPrompt(prompt, { inputActions: inputActions as InputActions | undefined, draftEmpty: ref.current })
}

/** Tell the Studio opener which pane holds this chat's Studio, so a second open reveals it there. */
function useStudioPane(sessionId: string | undefined, info: TabInfo | undefined) {
  const paneId = info?.panel?.id
  const signal = info?.tab?.signal
  useEffect(() => rememberStudioPane(sessionId, paneId, signal), [sessionId, paneId, signal])
}

// ---------------------------------------------------------------------------
// Studio pieces
// ---------------------------------------------------------------------------
/** A thumbnail that falls back to the Meshy glyph when it is missing or no longer served. */
function Thumb({ src, size = 18, name }: { src?: string | null; size?: number; name?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) {
    return (
      <>
        <MeshyGlyph size={size} />
        {name && <span className="meshy-tile-name">{name}</span>}
      </>
    )
  }
  return <img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />
}

/** An image asset's best source: the saved workspace file, else the API's (expiring) URL. */
function useAssetImage(sessionId: string | undefined, asset: Asset, preferLocal: boolean): string | undefined {
  const remoteFresh = Boolean(asset.thumbnail) && Date.now() - asset.at < REMOTE_FRESH_MS
  // A file several tasks saved to holds only the last one's output: trust the API's copy then.
  const local = (preferLocal && !asset.shared) || !remoteFresh
  return useWorkspaceImage(sessionId, local ? asset.file : null, remoteFresh ? asset.thumbnail : null)
}

function ImageStage({ sessionId, asset, t }: { sessionId?: string; asset: Asset; t: T }) {
  const src = useAssetImage(sessionId, asset, true)
  const [zoom, setZoom] = useState(false)
  if (!src) {
    return (
      <div className="meshy-overlay">
        <MeshyGlyph size={24} />
        <span className="meshy-small">{t('studio.imageMissing')}</span>
      </div>
    )
  }
  return (
    <>
      <button type="button" className="meshy-image" aria-label={t('studio.zoom')} onClick={() => setZoom(true)}>
        <img src={src} alt={asset.title} draggable={false} />
      </button>
      {zoom && (
        <ImageLightbox
          src={src}
          alt={asset.title}
          labels={{ dialog: asset.title, close: t('close') }}
          onClose={() => setZoom(false)}
        />
      )}
    </>
  )
}

function PendingStage({ asset, t }: { asset: Asset; t: T }) {
  const pct = asset.progress
  return (
    <div className="meshy-pending">
      {asset.thumbnail && <img src={asset.thumbnail} alt="" aria-hidden="true" />}
      <Logo />
      <TextShimmer active>
        {pct ? t('studio.generatingPct', { pct }) : t('studio.queued')}
      </TextShimmer>
      <span className="meshy-progress" data-indeterminate={pct ? undefined : ''}>
        <span style={{ width: `${pct ?? 0}%` }} />
      </span>
      <span className="meshy-xs meshy-muted">{t('studio.background')}</span>
    </div>
  )
}

function FailedStage({ asset, t }: { asset: Asset; t: T }) {
  return (
    <div className="meshy-overlay" role="alert">
      <IconWarningOutlineRegular size={20} />
      <span>{asset.phase === 'canceled' ? t('studio.canceled') : t('studio.failed')}</span>
      {asset.error && <span className="meshy-small meshy-muted">{asset.error}</span>}
    </div>
  )
}

function Tile({ sessionId, asset, current, onSelect, t }: {
  sessionId?: string
  asset: Asset
  current: boolean
  onSelect(): void
  t: T
}) {
  const image = useAssetImage(sessionId, asset, false)
  const still = useSnapshot(
    snapshotKey({ resource: asset.resource, taskId: asset.taskId }),
    snapshotKey({ sessionId, file: asset.file }),
  )
  const src = asset.kind === 'image' ? image : asset.thumbnail ?? still
  const label = [asset.title, asset.animated ? t('studio.animated') : null, t(`sidebar.status.${asset.phase}`)].filter(Boolean).join(' · ')
  return (
    <Tooltip label={asset.title} side="top" portal>
      <button type="button" className="meshy-tile" aria-current={current} aria-label={label} onClick={onSelect}>
        <Thumb src={src} name={asset.phase === 'done' ? asset.title : undefined} />
        {asset.phase === 'active' && (
          <>
            <span className="meshy-tile-state">{asset.progress ? `${asset.progress}%` : <StateDot state="ongoing" size={10} />}</span>
            <span className="meshy-progress" data-indeterminate={asset.progress ? undefined : ''}>
              <span style={{ width: `${asset.progress ?? 0}%` }} />
            </span>
          </>
        )}
        {(asset.phase === 'failed' || asset.phase === 'canceled') && (
          <span className="meshy-tile-state" data-err={asset.phase === 'failed' || undefined}>
            <IconWarningOutlineRegular size={14} />
          </span>
        )}
        {asset.animated && asset.phase === 'done' && (
          <span className="meshy-tile-badge" aria-hidden="true"><IconPlayOutlineRegular size={10} /></span>
        )}
      </button>
    </Tooltip>
  )
}

type ActionId = ActionKind | 'open' | `export:${string}`
const isActionKind = (id: string): id is ActionKind => id !== 'open' && !id.startsWith('export:')

/** The 3D print menu: the whole preparation, then each step on its own, then the slicer. */
const PRINT_MENU: readonly (ActionKind | 'separator')[] = [
  'print', 'separator', 'printCheck', 'printRepair', 'multiColor', 'splitParts', 'resize', 'separator', 'slicer',
]
type Tool = ActionKind | 'printMenu'

/** A model that only exists as a print file: no GLB, so Meshy's mesh tools cannot take it. */
function isPrintFile(asset: Asset): boolean {
  // A task with a GLB is a model, whatever else it saved.
  if (asset.variants.length > 0 || asset.formats.includes('glb')) return false
  return asset.file ? /\.3mf$/i.test(asset.file) : asset.formats.includes('3mf')
}

/** Glyphs for the Studio's next steps that the host's icon set has none for. */
const TOOL_GLYPHS: Partial<Record<ActionKind, ReactNode>> = {
  refine: glyph(<><path d="M13 3 7.6 8.4" /><path d="M7.6 8.4c-1.6-.4-3.4.7-3.4 2.6 0 .9-.6 1.6-1.4 1.9 2.4.9 5.6-.2 5.6-2.8z" /></>),
  retexture: glyph(<><path d="M13 3 7.6 8.4" /><path d="M7.6 8.4c-1.6-.4-3.4.7-3.4 2.6 0 .9-.6 1.6-1.4 1.9 2.4.9 5.6-.2 5.6-2.8z" /></>),
  remesh: glyph(<><path d="M2.5 13.5h11L8 2.5z" /><path d="M5.25 8h5.5M8 13.5 5.25 8M8 13.5 10.75 8" /></>),
  // An unfolded cube: the net UVs are laid out on.
  uvUnwrap: glyph(<><path d="M6 2.5h4v4h3.5v3H10v4H6v-4H2.5v-3H6z" /><path d="M6 6.5h4v3H6" /></>),
  print: glyph(<><path d="M4.5 6V2.5h7V6" /><rect x="2.5" y="6" width="11" height="5" rx="1" /><path d="M5 9.5h6v4H5z" /></>),
  // Stacked layers: what a slicer makes of a model.
  slicer: glyph(<><path d="M8 2.5 13.5 5 8 7.5 2.5 5z" /><path d="M2.5 8 8 10.5 13.5 8M2.5 11 8 13.5 13.5 11" /></>),
  rig: glyph(<><circle cx="8" cy="3.4" r="1.4" /><path d="M8 4.8v4.7M8 9.5l-2.5 4M8 9.5l2.5 4M4.3 6.6 8 7.1l3.7-.5" /></>),
  animate: <IconPlayOutlineRegular size={16} />,
  imageTo3d: glyph(<><path d="M8 2.5l5 2.75v5.5L8 13.5l-5-2.75v-5.5z" /><path d="M3 5.25 8 8l5-2.75M8 8v5.5" /></>),
  editImage: <IconEditOutlineRegular size={16} />,
}

/** One icon tool of the Studio toolbar, named by its tooltip. */
function ToolButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick(): void }) {
  return (
    <Tooltip label={label} side="top" portal>
      <Button variant="ghost" size="sm" aria-label={label} icon={icon} onClick={onClick} />
    </Tooltip>
  )
}

/** A menu button over dsh's Menu: labelled, or a toolbar glyph with a caret. */
function MenuButton({ label, icon, items, onSelect }: {
  label: string
  icon?: ReactNode
  items: ({ id: string; label: string; disabled?: boolean } | { type: 'separator' })[]
  onSelect(id: string): void
}) {
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  const anchor = icon ? (
    <Button variant="ghost" size="sm" aria-label={label} aria-expanded={open} className="meshy-tool-menu" onClick={() => setOpen((v) => !v)}>
      {icon}
      <IconChevronDownOutlineRegular size={10} />
    </Button>
  ) : (
    <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <span>{label}</span>
      <IconChevronDownOutlineRegular size={12} />
    </Button>
  )
  return (
    <Menu
      open={open}
      anchor={anchor}
      items={items}
      align="end"
      portal
      compact
      onClose={() => setOpen(false)}
      onSelect={(id: string) => {
        setOpen(false)
        onSelect(id)
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Right-sidebar tab
// ---------------------------------------------------------------------------
export function MeshyTabTitle(props: { sessionId?: string; useTabInfo?: () => TabInfo; t: T }) {
  useStudioPane(props.sessionId, props.useTabInfo?.())
  const active = useHasActiveTask(props.sessionId)
  return (
    <span className="meshy-root meshy-tab-title">
      <span>{props.t('sidebar.title')}</span>
      {active && <StateDot state="ongoing" size={10} />}
    </span>
  )
}

export function MeshyStudioTab(props: {
  sessionId?: string
  useTabInfo?: () => TabInfo
  inputActions?: unknown
  useInput?: InputHook
  t: T
}) {
  const { t, sessionId } = props
  const locale = detectLocale(t)
  const info = props.useTabInfo?.()
  useStudioPane(sessionId, info)
  const compose = useComposer(props.inputActions, props.useInput)
  const data = useSessionData(sessionId)
  // Workspace files opened in the Studio explicitly (the `.glb` preview's menu, other plugins).
  const [include, setInclude] = useState<ReadonlySet<string>>(() => new Set())
  const assets = useMemo(
    () => assetsOf(data.tasks, data.models, locale, { include }),
    [data.tasks, data.models, locale, include],
  )
  const counts = useMemo(() => ({
    model: assets.filter((a) => a.kind === 'model').length,
    image: assets.filter((a) => a.kind === 'image').length,
  }), [assets])

  const [segment, setSegment] = useState<AssetKind>()
  const [selectedKey, setSelectedKey] = useState<string>()
  const [wanted, setWanted] = useState<StudioTarget | null>(null)
  const [toast, setToast] = useState<Notice>()
  // Assets the viewer found to be rigged or animated, whatever their file is called.
  const [rigged, setRigged] = useState<ReadonlySet<string>>(() => new Set())
  const root = useRef<HTMLDivElement>(null)
  const narrow = useNarrow(root, 320)

  // Navigation params (`openTab('meshy', { params: { target } })`) select an asset once it is known.
  const navigation = info?.tab?.navigation
  useEffect(() => {
    const target = navigation?.params?.target
    if (!target || !(target.taskId || target.file)) return
    if (target.file && !target.taskId) {
      const rel = displayPath(target.file)
      setInclude((prev) => (prev.has(rel) ? prev : new Set([...prev, rel])))
    }
    setWanted(target)
  }, [navigation?.revision])
  useEffect(() => {
    if (!wanted) return
    const hit = findAsset(assets, wanted)
    if (!hit) return
    setSegment(hit.kind)
    setSelectedKey(hit.key)
    setWanted(null)
  }, [wanted, assets])

  const kind: AssetKind = segment ?? assets[0]?.kind ?? 'model'
  const list = assets.filter((a) => a.kind === kind)
  const current = list.find((a) => a.key === selectedKey) ?? list.find((a) => a.phase === 'done') ?? list[0]

  const notify = (text: string, warn = false) => setToast({ text, warn })
  const startEntry = async (entry: Entry | undefined) => {
    if (!entry) return
    if (!sessionId) {
      notify(t('entry.noChat'), true)
      return
    }
    const result = await handOff(sessionId, entry, locale, { onSaving: () => notify(t('entry.uploading')) })
    const notice = handOffNotice(result, t)
    if (notice) setToast(notice)
  }
  const entryItems = ENTRIES.map((e) => ({ id: e.id, label: t(`entry.${e.id}`) }))
  const runAction = async (id: ActionId) => {
    if (!current || !sessionId) return
    if (id === 'open') {
      if (current.file && openFileTab(sessionId, current.file, info?.tab?.actions?.openResource)) return
      notify(t('studio.openFailed'), true)
      return
    }
    // Every next step, export included, is a request for the agent, never a call from here.
    const format = id.startsWith('export:') ? id.slice('export:'.length) : undefined
    const prompt = actionPrompt(isActionKind(id) ? id : 'export', {
      taskId: current.taskId, resource: current.resource, file: current.file, title: current.title, format,
    }, locale)
    const result = await compose(prompt)
    if (result === 'composer') notify(t('sidebar.composerAdded'))
    else if (result === 'copied') notify(t('sidebar.composerCopied'))
  }

  // The toolbar over the stage, after Meshy's workspace: a lime lead step when there is an
  // obvious next one, then groups of icon tools (texture, mesh, UVs | print, rig | export, open).
  // A print file (a multi-color 3MF, say) has no mesh to work on: it goes to the slicer.
  let lead: ActionKind | undefined
  let groups: Tool[][] = []
  const animated = Boolean(current && (current.animated || rigged.has(current.key)))
  const done = current?.phase === 'done'
  const printFile = Boolean(done && current.kind === 'model' && !animated && isPrintFile(current))
  if (done && current.kind === 'model' && animated) {
    lead = 'animate'
  } else if (printFile) {
    groups = [['slicer']]
  } else if (done && current.kind === 'model') {
    if (current.stage === 'preview') lead = 'refine'
    groups = [[...(lead ? [] : ['retexture' as const]), 'remesh', 'uvUnwrap'], ['printMenu', 'rig']]
  } else if (done && current.kind === 'image') {
    lead = 'imageTo3d'
    groups = [['editImage']]
  }
  const formats = done && current.kind === 'model' ? current.formats : []
  const exportable = done && current.kind === 'model'
  const openable = done && Boolean(current.file)
  const tail = exportable || openable
  const hasToolbar = Boolean(lead || groups.length || tail)

  // The API does not say which model made a 3D result, so the line under the title is its time.
  const meta = current ? [agoText(current.at, Date.now(), locale)].filter(Boolean) : []

  const stageSource: ModelSource | undefined =
    current?.kind === 'model' && current.phase === 'done' && sessionId
      ? current.file
        ? { kind: 'file', sessionId, file: current.file }
        : current.taskId && current.resource
          ? { kind: 'task', resource: current.resource, taskId: current.taskId }
          : undefined
      : undefined

  return (
    <div ref={root} className="meshy-root meshy-studio">
      <div className="meshy-studio-head">
        <SegmentedTabs
          size="sm"
          label={t('studio.kind')}
          value={kind}
          onChange={(value: string) => {
            setSegment(value as AssetKind)
            setSelectedKey(undefined)
          }}
          items={[
            { value: 'model', label: counts.model ? `${t('studio.models')} ${counts.model}` : t('studio.models') },
            { value: 'image', label: counts.image ? `${t('studio.images')} ${counts.image}` : t('studio.images') },
          ]}
        />
        <span className="meshy-spacer" />
        <MenuButton
          label={t('entry.new')}
          items={entryItems}
          onSelect={(id) => { void startEntry(ENTRIES.find((e) => e.id === id)) }}
        />
        <Tooltip label={t('refresh')} side="bottom" portal>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('refresh')}
            disabled={data.loading}
            icon={<IconRefreshOutlineRegular size={14} />}
            onClick={data.refresh}
          />
        </Tooltip>
      </div>

      {!current ? (
        <div className="meshy-empty">
          {data.loaded && data.failed && !assets.length ? (
            <>
              <IconWarningOutlineRegular size={20} />
              <span className="meshy-name">{t('studio.loadFailed')}</span>
              <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={14} />} onClick={data.refresh}>
                {t('viewer.retry')}
              </Button>
            </>
          ) : data.loaded ? (
            <>
              <MeshyGlyph size={28} />
              <span className="meshy-name">{kind === 'image' ? t('studio.emptyImages') : t('studio.emptyModels')}</span>
              <span className="meshy-small meshy-muted">{kind === 'image' ? t('studio.emptyImagesHint') : t('studio.emptyModelsHint')}</span>
              <div className="meshy-entries" role="list" aria-label={t('entry.newHint')}>
                {ENTRIES.map((e) => (
                  <div key={e.id} role="listitem">
                    <button type="button" className="meshy-entry" onClick={() => { void startEntry(e) }}>
                      <span className="meshy-entry-label">{t(`entry.${e.id}`)}</span>
                      <span className="meshy-xs meshy-muted">{t(`entry.${e.id}.detail`)}</span>
                    </button>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <TextShimmer active>{t('studio.loading')}</TextShimmer>
          )}
        </div>
      ) : (
        <>
          <div className="meshy-studio-stage">
            {current.phase === 'active' ? (
              <PendingStage asset={current} t={t} />
            ) : current.phase !== 'done' ? (
              <FailedStage asset={current} t={t} />
            ) : current.kind === 'image' ? (
              <ImageStage sessionId={sessionId} asset={current} t={t} />
            ) : stageSource ? (
              <StageViewer
                source={stageSource}
                variants={current.variants}
                task={current.taskId && current.resource ? { resource: current.resource, taskId: current.taskId } : undefined}
                t={t}
                showSize={false}
                onModel={({ animated: found }) => {
                  const key = current.key
                  if (found !== rigged.has(key)) {
                    setRigged((prev) => {
                      const next = new Set(prev)
                      if (found) next.add(key)
                      else next.delete(key)
                      return next
                    })
                  }
                }}
              />
            ) : (
              <FailedStage asset={{ ...current, error: t('studio.noModel') }} t={t} />
            )}
            {hasToolbar && (
              <div className="meshy-studio-toolbar" role="toolbar" aria-label={t('studio.actions')}>
                {lead && (
                  narrow ? (
                    <Tooltip label={t(`action.${lead}`)} side="top" portal>
                      <Button size="sm" className="meshy-accent" aria-label={t(`action.${lead}`)} icon={TOOL_GLYPHS[lead]} onClick={() => { void runAction(lead!) }} />
                    </Tooltip>
                  ) : (
                    <Button size="sm" className="meshy-accent" icon={TOOL_GLYPHS[lead]} onClick={() => { void runAction(lead!) }}>
                      {t(`action.${lead}`)}
                    </Button>
                  )
                )}
                {groups.map((group, i) => (
                  <Fragment key={group.join()}>
                    {(lead || i > 0) && <span className="meshy-toolbar-divider" />}
                    {group.map((id) => id === 'printMenu' ? (
                      <MenuButton
                        key={id}
                        label={t('action.printMenu')}
                        icon={TOOL_GLYPHS.print}
                        items={PRINT_MENU.map((step) => step === 'separator' ? { type: 'separator' as const } : { id: step, label: t(`action.${step}`) })}
                        onSelect={(step) => { void runAction(step as ActionId) }}
                      />
                    ) : (
                      <ToolButton key={id} label={t(`action.${id}`)} icon={TOOL_GLYPHS[id]} onClick={() => { void runAction(id) }} />
                    ))}
                  </Fragment>
                ))}
                {tail && (lead || groups.length > 0) && <span className="meshy-toolbar-divider" />}
                {exportable && (
                  <MenuButton
                    label={t('studio.export')}
                    icon={<IconDownloadOutlineRegular size={16} />}
                    items={[
                      // The formats the task already has download as they are; anything else is a conversion.
                      ...formats.map((f) => ({ id: `export:${f}`, label: f.toUpperCase() })),
                      ...(formats.length ? [{ type: 'separator' as const }] : []),
                      { id: 'convert', label: t('action.convert') },
                    ]}
                    onSelect={(id) => { void runAction(id as ActionId) }}
                  />
                )}
                {openable && (
                  <ToolButton label={t('studio.openTab')} icon={<IconRightUpOutlineRegular size={16} />} onClick={() => { void runAction('open') }} />
                )}
              </div>
            )}
          </div>

          <div className="meshy-studio-info">
            <div className="meshy-studio-title">
              <span className="meshy-ellipsis" title={current.title}>{current.title}</span>
            </div>
            <div className="meshy-meta">
              {meta.map((m) => <span key={m as string} className="meshy-ellipsis">{m}</span>)}
            </div>
          </div>
        </>
      )}

      {list.length > 0 && (
        <div className="meshy-gallery" role="list" aria-label={kind === 'image' ? t('studio.images') : t('studio.models')}>
          {list.map((asset) => (
            <div key={asset.key} role="listitem">
              <Tile
                sessionId={sessionId}
                asset={asset}
                current={asset.key === current?.key}
                onSelect={() => setSelectedKey(asset.key)}
                t={t}
              />
            </div>
          ))}
        </div>
      )}

      {toast && <NoticeToast notice={toast} anchor={root.current ?? undefined} onDone={() => setToast(undefined)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// `.glb` document preview (sidebar.right.tab.document) and its Meshy action menu
// ---------------------------------------------------------------------------
type RendererContent = {
  kind: string
  revision?: number
  loaded?(version: string): void
  failed?(): void
}

export function GlbBody({ content, resourceAddress, t }: { content: RendererContent; resourceAddress: string; t: T }) {
  if (content.kind !== 'renderer') return null
  return (
    <StageViewer
      source={{ kind: 'address', address: resourceAddress }}
      revision={content.revision ?? 0}
      t={t}
      onLoaded={(version) => content.loaded?.(version ?? '')}
      onFailed={() => content.failed?.()}
    />
  )
}

export function GlbMeshyAction(props: {
  resourceAddress?: string
  useTabInfo?: () => TabInfo
  previewId?: string
  inputActions?: unknown
  useInput?: InputHook
  t: T
}) {
  const { t } = props
  const info = props.useTabInfo?.()
  const resourceAddress = props.resourceAddress ?? info?.tab?.contentId
  const locale = detectLocale(t)
  const parsed = useMemo(() => (resourceAddress ? sessionFileOf(resourceAddress) : undefined), [resourceAddress])
  const compose = useComposer(props.inputActions, props.useInput)
  const [toast, setToast] = useState<string>()
  const isModel = !props.previewId || props.previewId === GLB_ID || Boolean(parsed?.path && /\.(?:glb|3mf)$/i.test(parsed.path))
  if (!isModel || !parsed) return null

  // A print file goes to the slicer; a GLB takes Meshy's mesh tools.
  const items = /\.3mf$/i.test(parsed.path) ? [
    { id: 'studio', label: t('sidebar.openStudio') },
    { type: 'separator' },
    { id: 'slicer', label: t('action.slicer') },
  ] : [
    { id: 'studio', label: t('sidebar.openStudio') },
    { type: 'separator' },
    { id: 'retexture', label: t('action.retexture') },
    { id: 'remesh', label: t('action.remesh') },
    { id: 'uvUnwrap', label: t('action.uvUnwrap') },
    { id: 'rig', label: t('action.rig') },
    { id: 'print', label: t('action.print') },
  ]
  return (
    <span className="meshy-root">
      <GlbMenu
        label={t('action.menu')}
        items={items}
        onSelect={async (id) => {
          if (id === 'studio') {
            openStudio(parsed.sessionId, { file: parsed.path })
            return
          }
          const result = await compose(actionPrompt(id as ActionKind, { file: parsed.path }, locale))
          if (result === 'composer') setToast(t('sidebar.composerAdded'))
          else if (result === 'copied') setToast(t('sidebar.composerCopied'))
        }}
      />
      {toast && <Toast text={toast} tone="success" onDone={() => setToast(undefined)} />}
    </span>
  )
}

function GlbMenu({ label, items, onSelect }: { label: string; items: object[]; onSelect(id: string): void }) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      anchor={(
        <Tooltip label={label} side="bottom" portal>
          <Button
            variant="ghost"
            size="sm"
            aria-label={label}
            aria-expanded={open}
            icon={<MeshyGlyph size={14} />}
            onClick={() => setOpen((v) => !v)}
          />
        </Tooltip>
      )}
      items={items}
      align="end"
      portal
      compact
      onClose={() => setOpen(false)}
      onSelect={(id: string) => {
        setOpen(false)
        onSelect(id)
      }}
    />
  )
}

