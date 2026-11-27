// The 3D stage shared by the Studio, the `.glb` preview and the Library preview: a viewer toolbar
// modelled on the Meshy web app's (display settings, solid / unlit / lit, wireframe, skeleton,
// lighting, texture channels), model statistics, and an animation bar for rigged or animated models.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import {
  Button, Menu, Switch, TextShimmer, Tooltip, fileSizeText, IconRefreshOutlineRegular,
  IconChevronDownOutlineRegular, IconLightOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular,
  IconSlidersTwoOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { fetchModelBytes, loadViewer, Logo, saveSnapshot, snapshotKey, TooLarge, MAX_GLB, WINDOW, type ModelSource } from './common.tsx'
import type { T } from './locales.ts'
import type { Channel, ClipInfo, PlaybackState, RenderMode, Viewer, ViewSettings } from './viewer.ts'

/** The host's order for a task's first GLB (see `GLB_PREFERENCE` in lib/tasks.js). */
const GLB_PREFERENCE = ['model', 'animation', 'walking', 'running', 'rigged']
/** Variants whose GLB carries a clip, with the label its clip gets (undefined: the clip's own name). */
const CLIP_VARIANTS: Record<string, string | undefined> = { animation: undefined, walking: 'Walking', running: 'Running' }
const SPEEDS = [0.5, 1, 1.5, 2]

/** View choices that carry over from one model to the next while the app is open. */
const remembered: { stats: boolean; light?: number; lightAngle?: number } = { stats: true }

function compact(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 10_000) return `${(count / 1_000).toFixed(1)}k`
  return count.toLocaleString()
}

function clock(seconds: number): string {
  const s = Math.max(0, seconds)
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

/** The clips of a task's other animated GLBs, to load next to the one shown. */
function extraClips(source: ModelSource, task: { resource: string; taskId: string } | undefined, variants: readonly string[]) {
  if (!task) return []
  const shown =
    source.kind === 'task' && source.taskId === task.taskId
      ? source.variant ?? GLB_PREFERENCE.find((v) => variants.includes(v))
      : undefined
  return variants
    .filter((v) => v in CLIP_VARIANTS && v !== shown)
    .map((variant) => ({
      source: { kind: 'task', resource: task.resource, taskId: task.taskId, variant } as ModelSource,
      label: CLIP_VARIANTS[variant],
    }))
}

/** Width of an element, following resizes. */
function useWidth(ref: { current: HTMLElement | null }): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

// ---------------------------------------------------------------------------
// Glyphs for the 3D-specific tools (the host's icon set has none); 16px, currentColor.
// ---------------------------------------------------------------------------
export const glyph = (children: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)
const GLYPHS: Record<RenderMode | 'wireframe' | 'skeleton', ReactNode> = {
  solid: glyph(<circle cx="8" cy="8" r="5.6" fill="currentColor" stroke="none" />),
  unlit: glyph(<><circle cx="8" cy="8" r="5.6" /><path d="M8 2.4a5.6 5.6 0 0 0 0 11.2z" fill="currentColor" stroke="none" /></>),
  lit: glyph(<><circle cx="8" cy="8" r="5.6" /><circle cx="6.1" cy="6.1" r="1.5" fill="currentColor" stroke="none" /></>),
  wireframe: glyph(<><circle cx="8" cy="8" r="5.6" /><ellipse cx="8" cy="8" rx="5.6" ry="2.2" /><ellipse cx="8" cy="8" rx="2.2" ry="5.6" /></>),
  skeleton: glyph(<><path d="M5.6 10.4l4.8-4.8" /><circle cx="4.3" cy="10.2" r="1.3" /><circle cx="5.8" cy="11.7" r="1.3" /><circle cx="10.2" cy="4.3" r="1.3" /><circle cx="11.7" cy="5.8" r="1.3" /></>),
}

// ---------------------------------------------------------------------------
// Small controls over dsh's primitives
// ---------------------------------------------------------------------------
/** A pointer-and-keyboard slider (dsh has none); the track follows the theme's label colour. */
function Slider({ value, min, max, step, label, valueText, onChange, className = '' }: {
  value: number
  min: number
  max: number
  step: number
  label: string
  valueText?: string
  onChange(value: number): void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const span = max - min || 1
  const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100))
  const snap = (v: number) => Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min))
  const fromPointer = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    onChange(snap(min + ((clientX - rect.left) / rect.width) * span))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const big = Math.max(step, span / 10)
    const next =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? value - step
        : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? value + step
          : event.key === 'PageDown' ? value - big
            : event.key === 'PageUp' ? value + big
              : event.key === 'Home' ? min
                : event.key === 'End' ? max
                  : null
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    onChange(snap(next))
  }
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(3))}
      aria-valuetext={valueText}
      className={`meshy-slider ${className}`}
      style={{ '--meshy-pct': `${pct}%` } as CSSProperties}
      onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        fromPointer(event.clientX)
      }}
      onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event.clientX)
      }}
      onKeyDown={onKeyDown}
    >
      <span className="meshy-slider-track"><span className="meshy-slider-fill" /></span>
      <span className="meshy-slider-thumb" />
    </div>
  )
}

/** An icon tool button with a tooltip. */
function Tool({ label, icon, pressed, onClick, expanded }: {
  label: string
  icon: ReactNode
  pressed?: boolean
  expanded?: boolean
  onClick(): void
}) {
  return (
    <Tooltip label={label} side="bottom" portal>
      <Button
        variant="ghost"
        size="sm"
        className="meshy-tool"
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        icon={icon}
        onClick={onClick}
      />
    </Tooltip>
  )
}

/** A tool that opens a small settings panel on dsh's Menu surface. */
function ToolPanel({ label, icon, align = 'start', children }: {
  label: string
  icon: ReactNode
  align?: 'start' | 'end'
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      portal
      align={align}
      items={[]}
      onClose={() => setOpen(false)}
      anchor={<Tool label={label} icon={icon} expanded={open} onClick={() => setOpen((v) => !v)} />}
    >
      <div className="meshy-root meshy-pop" role="group" aria-label={label}>
        <div className="meshy-pop-head">{label}</div>
        {children}
      </div>
    </Menu>
  )
}

/** A labelled text button that opens a pick list. */
function PickMenu({ label, value, items, selectedId, onSelect, align = 'start' }: {
  label: string
  value: ReactNode
  items: { id: string; label: string; icon?: ReactNode }[]
  selectedId?: string
  onSelect(id: string): void
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      portal
      compact
      align={align}
      side="top"
      items={items}
      selectedId={selectedId}
      onClose={() => setOpen(false)}
      onSelect={(id: string) => {
        setOpen(false)
        onSelect(id)
      }}
      anchor={(
        <Tooltip label={label} side="top" portal>
          <button type="button" className="meshy-pick" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {value}
            <IconChevronDownOutlineRegular size={12} />
          </button>
        </Tooltip>
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Toolbar, statistics and animation bar
// ---------------------------------------------------------------------------
function ChannelThumb({ thumb }: { thumb: string | null }) {
  return thumb ? <img src={thumb} alt="" draggable={false} /> : <span className="meshy-chan-blank" />
}

function Toolbar({ viewer, view, change, stats, setStats, width, t }: {
  viewer: Viewer
  view: ViewSettings
  change(patch: Partial<ViewSettings>): void
  stats: boolean
  setStats(on: boolean): void
  width: number
  t: T
}) {
  const channels = viewer.channels
  const unlit = view.mode === 'unlit'
  // Channel thumbnails in a row when they fit, else one picker.
  const rowFits = width >= 240 + channels.length * 30
  const current = channels.find((c) => c.id === view.channel) ?? channels[0]
  return (
    <div className="meshy-vtools" role="toolbar" aria-label={t('viewer.tools')}>
      <ToolPanel label={t('viewer.display')} icon={<IconSlidersTwoOutlineRegular size={16} />}>
        {([
          ['grid', t('viewer.grid'), view.grid, (on: boolean) => change({ grid: on })],
          ['stats', t('viewer.stats'), stats, setStats],
          ['autoRotate', t('viewer.autoRotate'), view.autoRotate, (on: boolean) => change({ autoRotate: on })],
        ] as const).map(([id, label, checked, set]) => (
          <div key={id} className="meshy-pop-row">
            <span>{label}</span>
            <Switch checked={checked} label={label} onChange={set} />
          </div>
        ))}
        <div className="meshy-pop-foot">
          <Button variant="ghost" size="sm" onClick={() => viewer.reset()}>{t('viewer.reset')}</Button>
        </div>
      </ToolPanel>
      {(viewer.hasTexture || viewer.hasColor) && (
        <>
          <span className="meshy-vtools-div" aria-hidden="true" />
          <span className="meshy-vtools-group" role="group" aria-label={t('viewer.mode')}>
            {(viewer.hasTexture ? ['solid', 'unlit', 'lit'] as const : ['solid', 'lit'] as const).map((mode) => (
              <Tool
                key={mode}
                label={t(`viewer.mode.${mode}`)}
                icon={GLYPHS[mode]}
                pressed={view.mode === mode}
                onClick={() => change(mode === 'unlit' ? { mode, channel: 'baseColor' } : { mode })}
              />
            ))}
          </span>
        </>
      )}
      <span className="meshy-vtools-div" aria-hidden="true" />
      <Tool
        label={t('viewer.wireframe')}
        icon={GLYPHS.wireframe}
        pressed={view.wireframe}
        onClick={() => change({ wireframe: !view.wireframe })}
      />
      {viewer.hasSkeleton && (
        <Tool
          label={t('viewer.skeleton')}
          icon={GLYPHS.skeleton}
          pressed={view.skeleton}
          onClick={() => change({ skeleton: !view.skeleton })}
        />
      )}
      {view.mode !== 'unlit' && (
        <ToolPanel label={t('viewer.lighting')} icon={<IconLightOutlineRegular size={16} />}>
          <div className="meshy-pop-slider">
            <span>{t('viewer.lightIntensity')}</span>
            <span className="meshy-pop-value">{Math.round(view.light * 100)}%</span>
            <Slider
              value={view.light}
              min={0}
              max={2}
              step={0.05}
              label={t('viewer.lightIntensity')}
              valueText={`${Math.round(view.light * 100)}%`}
              onChange={(light) => change({ light })}
            />
          </div>
          <div className="meshy-pop-slider">
            <span>{t('viewer.lightAngle')}</span>
            <span className="meshy-pop-value">{Math.round(view.lightAngle)}°</span>
            <Slider
              value={view.lightAngle}
              min={0}
              max={360}
              step={1}
              label={t('viewer.lightAngle')}
              valueText={`${Math.round(view.lightAngle)}°`}
              onChange={(lightAngle) => change({ lightAngle })}
            />
          </div>
          <div className="meshy-pop-foot">
            <Button variant="ghost" size="sm" onClick={() => change({ light: 1, lightAngle: 159 })}>{t('viewer.lightReset')}</Button>
          </div>
        </ToolPanel>
      )}
      {channels.length > 0 && current && (
        <span className="meshy-vtools-group meshy-vtools-end" role="group" aria-label={t('viewer.channels')}>
          {rowFits ? (
            channels.map((c) => (
              <Tooltip key={c.id} label={t(`viewer.channel.${c.id}`)} side="bottom" portal>
                <button
                  type="button"
                  className="meshy-chan"
                  aria-label={t(`viewer.channel.${c.id}`)}
                  aria-pressed={unlit && view.channel === c.id}
                  onClick={() => change({ mode: 'unlit', channel: c.id })}
                >
                  <ChannelThumb thumb={c.thumb} />
                </button>
              </Tooltip>
            ))
          ) : (
            <ChannelPicker
              channels={channels}
              value={unlit ? view.channel : undefined}
              current={current}
              onSelect={(channel) => change({ mode: 'unlit', channel })}
              t={t}
            />
          )}
        </span>
      )}
    </div>
  )
}

function ChannelPicker({ channels, value, current, onSelect, t }: {
  channels: Viewer['channels']
  value?: Channel
  current: Viewer['channels'][number]
  onSelect(channel: Channel): void
  t: T
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      portal
      compact
      align="end"
      items={channels.map((c) => ({ id: c.id, label: t(`viewer.channel.${c.id}`), icon: <span className="meshy-chan-icon"><ChannelThumb thumb={c.thumb} /></span> }))}
      selectedId={value}
      onClose={() => setOpen(false)}
      onSelect={(id: string) => {
        setOpen(false)
        onSelect(id as Channel)
      }}
      anchor={(
        <Tooltip label={t('viewer.channels')} side="bottom" portal>
          <button
            type="button"
            className="meshy-chan meshy-chan-pick"
            aria-label={`${t('viewer.channels')}: ${t(`viewer.channel.${(value ? channels.find((c) => c.id === value) : current)?.id ?? current.id}`)}`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-pressed={Boolean(value)}
            onClick={() => setOpen((v) => !v)}
          >
            <ChannelThumb thumb={(channels.find((c) => c.id === value) ?? current).thumb} />
            <IconChevronDownOutlineRegular size={12} />
          </button>
        </Tooltip>
      )}
    />
  )
}

function Stats({ viewer, size, t }: { viewer: Viewer; size: number; t: T }) {
  return (
    <dl className="meshy-stats" aria-label={t('viewer.stats')}>
      <dt>{t('viewer.faces')}</dt>
      <dd>{compact(viewer.triangles)}</dd>
      <dt>{t('viewer.vertices')}</dt>
      <dd>{compact(viewer.vertices)}</dd>
      {size > 0 && (
        <>
          <dt>{t('viewer.size')}</dt>
          <dd>{fileSizeText(size)}</dd>
        </>
      )}
    </dl>
  )
}

const CLIP_KEYS: Record<string, string> = { Walking: 'viewer.clip.walking', Running: 'viewer.clip.running', Animation: 'viewer.clip.animation' }
const clipName = (clip: ClipInfo | undefined, t: T) => (clip ? (CLIP_KEYS[clip.label] ? t(CLIP_KEYS[clip.label]) : clip.label) : '')

function AnimationBar({ viewer, width, t }: { viewer: Viewer; width: number; t: T }) {
  const [state, setState] = useState<PlaybackState>(() => viewer.playback)
  const [clips, setClips] = useState<readonly ClipInfo[]>(() => viewer.clips)
  useEffect(() => {
    setState(viewer.playback)
    setClips(viewer.clips)
    return viewer.onPlayback((next) => {
      setState(next)
      setClips((prev) => (prev.length === viewer.clips.length ? prev : viewer.clips))
    })
  }, [viewer])
  if (!clips.length) return null
  const current = clips[state.clip] ?? clips[0]
  const wide = width >= 380
  return (
    <div className="meshy-anim" role="group" aria-label={t('viewer.animation')}>
      <Tooltip label={state.playing ? t('viewer.pause') : t('viewer.play')} side="top" portal>
        <Button
          variant="ghost"
          size="sm"
          aria-label={state.playing ? t('viewer.pause') : t('viewer.play')}
          icon={state.playing ? <IconPauseOutlineRegular size={16} /> : <IconPlayOutlineRegular size={16} />}
          onClick={() => viewer.setPlaying(!state.playing)}
        />
      </Tooltip>
      {clips.length > 1 ? (
        <PickMenu
          label={t('viewer.clip')}
          value={<span className="meshy-anim-name">{clipName(current, t)}</span>}
          items={clips.map((c, i) => ({ id: String(i), label: clipName(c, t) }))}
          selectedId={String(state.clip)}
          onSelect={(id) => viewer.playClip(Number(id))}
        />
      ) : (
        <span className="meshy-anim-name meshy-anim-solo">{clipName(current, t)}</span>
      )}
      <Slider
        className="meshy-anim-scrub"
        value={state.time}
        min={0}
        max={state.duration || 1}
        step={0.01}
        label={t('viewer.timeline')}
        valueText={`${clock(state.time)} / ${clock(state.duration)}`}
        onChange={(time) => viewer.seek(time)}
      />
      {wide && <span className="meshy-anim-time">{clock(state.time)} / {clock(state.duration)}</span>}
      <PickMenu
        label={t('viewer.speed')}
        align="end"
        value={<span className="meshy-anim-speed">{state.speed}×</span>}
        items={SPEEDS.map((s) => ({ id: String(s), label: `${s}×` }))}
        selectedId={String(state.speed)}
        onSelect={(id) => viewer.setSpeed(Number(id))}
      />
    </div>
  )
}

/** Load failures in the user's terms; the raw message only when nothing better is known. */
function viewerError(err: unknown, t: T): string {
  if (err instanceof TooLarge) return t('viewer.tooLarge', { size: fileSizeText(err.size), limit: fileSizeText(MAX_GLB) })
  const message = String((err as Error)?.message ?? err)
  if (/draco/i.test(message)) return t('viewer.draco')
  if (/3MF is too large/i.test(message)) return t('viewer.threeMfTooLarge')
  if (/invalid zip|3MF has no/i.test(message)) return t('viewer.threeMfCorrupt')
  if (/\b(404|410)\b|not found|expired/i.test(message)) return t('viewer.gone')
  if (/HTTP 5\d\d|network|failed to fetch|timeout/i.test(message)) return t('viewer.network')
  if (/glTF|GLB|JSON|Unexpected|magic/i.test(message)) return t('viewer.corrupt')
  return message
}

// ---------------------------------------------------------------------------
// StageViewer
// ---------------------------------------------------------------------------
export function StageViewer({
  source,
  revision = 0,
  variants = [],
  task,
  t,
  onLoaded,
  onFailed,
  onModel,
  showSize = true,
  className = '',
}: {
  source: ModelSource
  revision?: number
  /** GLB variants of the task the model comes from; their animation clips are offered too. */
  variants?: readonly string[]
  /** That task, when `source` is a saved file rather than the task itself. */
  task?: { resource: string; taskId: string }
  t: T
  onLoaded?: (version?: string) => void
  onFailed?: () => void
  /** What the loaded model turned out to be (a walk cycle saved under any name is still animated). */
  onModel?: (info: { animated: boolean }) => void
  showSize?: boolean
  className?: string
}) {
  const root = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const width = useWidth(root)
  const [viewer, setViewer] = useState<Viewer>()
  const [view, setView] = useState<ViewSettings>()
  const [stats, setStatsState] = useState(remembered.stats)
  const [error, setError] = useState<string>()
  const [size, setSize] = useState(0)
  const [progress, setProgress] = useState<[number, number]>()
  const [preparing, setPreparing] = useState(false)
  const [retry, setRetry] = useState(0)

  const sourceKey =
    source.kind === 'address'
      ? `addr:${source.address}`
      : source.kind === 'file'
        ? `file:${source.sessionId}:${source.file}`
        : `task:${source.resource}:${source.taskId}:${source.variant ?? ''}`
  const clipTask = task ?? (source.kind === 'task' ? { resource: source.resource, taskId: source.taskId } : undefined)
  const clipKey = clipTask ? `${clipTask.resource}:${clipTask.taskId}:${variants.join(',')}` : ''

  useEffect(() => {
    const el = host.current
    if (!el) return
    const abort = new AbortController()
    let mounted: Viewer | undefined
    setError(undefined)
    setViewer(undefined)
    setView(undefined)
    setProgress(undefined)
    setPreparing(false)
    const initial: Partial<ViewSettings> = {}
    if (remembered.light !== undefined) initial.light = remembered.light
    if (remembered.lightAngle !== undefined) initial.lightAngle = remembered.lightAngle
    fetchModelBytes(source, abort.signal, (read, total) => setProgress([read, total]))
      .then(async ({ data, version }) => {
        if (abort.signal.aborted) return
        setPreparing(true)
        const mod = await loadViewer()
        const v = await mod.mountViewer(el, data, initial)
        if (abort.signal.aborted) {
          v.dispose()
          return
        }
        mounted = v
        setSize(data.byteLength)
        setView(v.view)
        setViewer(v)
        onLoaded?.(version)
        onModel?.({ animated: v.animated })
        // A still for tiles that have no thumbnail of their own.
        const keys = [
          source.kind === 'file' ? snapshotKey({ sessionId: source.sessionId, file: source.file }) : undefined,
          clipTask ? snapshotKey(clipTask) : undefined,
        ]
        if (keys.some(Boolean)) {
          const still = v.snapshot()
          if (still) saveSnapshot(keys, still)
        }
        // The task's other animated GLBs only lend their clips; one at a time keeps memory flat.
        for (const extra of extraClips(source, clipTask, variants)) {
          if (abort.signal.aborted) return
          try {
            const bytes = await fetchModelBytes(extra.source, abort.signal)
            if (abort.signal.aborted) return
            await v.addClips(bytes.data, extra.label)
          } catch {
            // An expired or missing variant just leaves its clip out.
          }
        }
      })
      .catch((err) => {
        if (abort.signal.aborted) return
        setError(viewerError(err, t))
        onFailed?.()
      })
    return () => {
      abort.abort()
      mounted?.dispose()
    }
  }, [sourceKey, revision, clipKey, retry])

  const change = (patch: Partial<ViewSettings>) => {
    if (!viewer) return
    const next = viewer.setView(patch)
    if (patch.light !== undefined) remembered.light = next.light
    if (patch.lightAngle !== undefined) remembered.lightAngle = next.lightAngle
    setView(next)
  }
  const setStats = (on: boolean) => {
    remembered.stats = on
    setStatsState(on)
  }

  return (
    <div ref={root} className={`meshy-root meshy-viewer ${className}`}>
      <div className="meshy-vtools-slot">
        {viewer && view && (
          <Toolbar viewer={viewer} view={view} change={change} stats={stats} setStats={setStats} width={width} t={t} />
        )}
      </div>
      <div className="meshy-canvas">
        <div ref={host} className="meshy-stage" role="img" aria-label={t('viewer.title')} />
        {!viewer && !error && (
          <div className="meshy-overlay" role="status">
            <Logo />
            <TextShimmer active>{preparing ? t('viewer.preparing') : t('viewer.loading')}</TextShimmer>
            {!preparing && progress && (progress[1] > WINDOW || progress[0] > WINDOW) && (
              progress[1] > 0 ? (
                <>
                  <span className="meshy-progress meshy-viewer-progress">
                    <span style={{ width: `${Math.min(100, (progress[0] / progress[1]) * 100)}%` }} />
                  </span>
                  <span className="meshy-small meshy-muted">{fileSizeText(progress[0])} / {fileSizeText(progress[1])}</span>
                </>
              ) : (
                <span className="meshy-small meshy-muted">{fileSizeText(progress[0])}</span>
              )
            )}
          </div>
        )}
        {error && (
          <div className="meshy-overlay" role="alert">
            <IconWarningOutlineRegular size={20} />
            <span>{t('viewer.failed')}</span>
            <span className="meshy-muted meshy-small">{error}</span>
            <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={14} />} onClick={() => setRetry((n) => n + 1)}>
              {t('viewer.retry')}
            </Button>
          </div>
        )}
        {viewer && stats && <Stats viewer={viewer} size={showSize ? size : 0} t={t} />}
        {viewer && <AnimationBar viewer={viewer} width={width} t={t} />}
      </div>
    </div>
  )
}
