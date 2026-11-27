// Meshy Studio: the 3D workspace in dsh's right sidebar, laid out like the Meshy web app's
// workspace. Tabs along the top pick the panel: Image (concept art and the step to 3D), then
// Model, Print and Animate, three toolsets over the same model in one viewport, and Assets, every
// asset of the session grouped by the model it came from. It shows the Meshy project of one
// session (assets derived by the host from the CLI's downloads, plus what the user and the agent
// set: the active asset, names, links, stars, archive, pins) and never calls the Meshy API to
// create anything: a tool writes a clear request into the session's draft, and the agent runs it
// through the skills, with their cost confirmation. The host is the only writer of the project;
// every change carries the revision it was made against.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Button, SegmentedControl, StateDot, TextShimmer, Tooltip, fileSizeText, writeClipboard,
  IconCheckOutlineRegular, IconChevronRightOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular,
  IconRefreshOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DisplayMode, Viewer } from './viewer.ts'
import { api, MAX_GLB, readFile, TooLarge, WINDOW } from './files.ts'

declare const require: { async(path: string): Promise<typeof import('./viewer.ts')> }
declare const __MESHY_ICON__: string

export type T = (key: string, params?: Record<string, string | number>) => string

export type Asset = {
  id: string
  kind: 'image' | 'model'
  operation: string
  /** The API's own task type, e.g. text-to-3d-refine; null when only the journal knows the task. */
  type: string | null
  /** The task's name or prompt, when it has one. */
  title: string | null
  taskId: string
  status: 'running' | 'downloading' | 'submitted' | 'succeeded' | 'failed'
  progress: number | null
  files: Record<string, string | null> & { images: string[]; thumbnail: string | null }
  stats: {
    faces: number | null; bytes: number | null; rigged: boolean; animations: string[]
    textured: boolean | null; smartTopology: boolean
  }
  credits: number | null
  parentId: string | null
  label: string | null
  starred: boolean
  archived: boolean
  createdAt: string | null
}
export type Pin = { id: string; assetId: string | null; note: string; snapshot: string | null; camera: { azimuth: number; elevation: number } | null; resolved: boolean }
export type Project = { revision: number; route: string | null; activeAssetId: string | null; assets: Asset[]; pins: Pin[]; file: string; signedIn: boolean }

/** dsh's InputActions, as the session-scoped slots receive them. */
export type InputActions = { captureInsertion(): unknown; insertText(text: string, span: unknown): boolean }

const MODEL_FORMATS = ['glb', 'fbx', 'obj', 'stl', '3mf', 'usdz', 'blend']
/** Still moving: shown with progress and polled faster. A `submitted` task is old and was never saved. */
const BUSY = new Set(['running', 'downloading'])
/** Changes that mean the same on a newer revision, so a conflict may retry them once. */
const SETTERS = new Set(['activate', 'label', 'star', 'archive'])
const PRINT_OPS = new Set(['analyze-printability', 'repair-printability', 'multi-color-print', 'auto-split'])
/** The API refuses to rig more than this; the web app sends such a model to Remesh first. */
const RIG_MAX_FACES = 300_000
const UV_MAX_FACES = 40_000

const Logo = () => <img className="meshy-logo" src={__MESHY_ICON__} alt="" />

export const mainFile = (a: Asset) => a.files.glb ?? MODEL_FORMATS.map((f) => a.files[f]).find(Boolean) ?? a.files.images[0] ?? null
const opName = (t: T, op: string) => { const k = `op.${op}`; const v = t(k); return v === k ? op : v }
/** What a task did, short: a refine is named apart from the preview it textures. */
const opOf = (t: T, a: Asset) => opName(t, a.type?.endsWith('-refine') ? 'refine' : a.type?.endsWith('-preview') ? 'preview' : a.operation)
/** A saved file's name as words: `christmas_tree_lowpoly.glb` reads "christmas tree lowpoly". */
const stem = (path: string | null) => {
  const base = path?.split('/').pop()?.replace(/\.[^.]+$/, '').replace(/[-_]?(meta|model|preview|thumbnail|image_\d+)$/i, '').replace(/[-_]+/g, ' ').trim()
  return base && !/^[0-9a-f]{8}\b/i.test(base) ? base : null
}
/** The name shown: the user's or agent's label, else the task's name or prompt, else its file, else what it did. */
export const assetName = (t: T, a: Asset) => a.label ?? a.title ?? stem(mainFile(a)) ?? opOf(t, a)
/** A file mention as dsh's composer reads it: `@path`, quoted when the path has spaces. */
const mention = (path: string) => /\s/.test(path) ? `@"${path}"` : `@${path}`
const ref = (t: T, a: Asset) => t('studio.ref', { name: assetName(t, a), id: a.id, file: mainFile(a) ?? '—' })

/** Where a model is in the web app's terms, which decides the tools it gets. */
type Stage = 'image' | 'untextured' | 'textured' | 'rigged' | 'animated' | 'print'
function stageOf(a: Asset): Stage {
  if (a.kind === 'image') return 'image'
  if (a.operation === 'animate') return 'animated'
  if (a.operation === 'rigging') return 'rigged'
  if (PRINT_OPS.has(a.operation)) return 'print'
  return a.stats.textured === false || a.type?.endsWith('-preview') || a.operation === 'uv-unwrap' ? 'untextured' : 'textured'
}
const isRigged = (a: Asset) => a.stats.rigged || a.operation === 'rigging' || a.operation === 'animate'

/** Put text at the caret of the session's draft; the clipboard when no composer is at hand. */
async function toDraft(input: InputActions | undefined, text: string): Promise<'draft' | 'clipboard' | 'failed'> {
  try {
    if (input && input.insertText(text, input.captureInsertion()) !== false) return 'draft'
  } catch {
    // Composer not mounted for this session: fall back to the clipboard.
  }
  return (await writeClipboard(text)) ? 'clipboard' : 'failed'
}

function useProject(sessionId: string | undefined) {
  const [project, setProject] = useState<Project>()
  const [error, setError] = useState<string>()
  const latest = useRef<Project>()
  latest.current = project
  const load = useCallback(async () => {
    if (!sessionId) return
    try {
      const { status, data } = await api(`meshy.project?session=${encodeURIComponent(sessionId)}`)
      if (status !== 200) { setError(data?.error ?? String(status)); return }
      setError(undefined)
      setProject(data)
    } catch (err) {
      setError(String((err as Error)?.message ?? err))
    }
  }, [sessionId])
  useEffect(() => {
    let timer = 0
    let stopped = false
    const loop = async () => {
      if (stopped) return
      if (typeof document === 'undefined' || !document.hidden) await load()
      const busy = latest.current?.assets.some((a) => BUSY.has(a.status))
      timer = window.setTimeout(loop, busy ? 3000 : 8000)
    }
    void loop()
    const wake = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', wake)
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', wake) }
  }, [load])
  /**
   * Apply one change against the revision shown; a conflict shows the newer project instead. A
   * change that only sets something (the current asset, a name, a star) is tried once more on
   * the newer revision, since it means the same there; a pin is not. An answer older than the
   * project shown never replaces it.
   */
  const change = useCallback(async (body: { op: string } & Record<string, unknown>) => {
    if (!sessionId) return undefined
    const show = (next: Project | undefined) => { if (next && next.revision >= (latest.current?.revision ?? -1)) { latest.current = next; setProject(next) } }
    for (let attempt = 0; ; attempt++) {
      const { status, data } = await api(`meshy.project?session=${encodeURIComponent(sessionId)}`, { revision: latest.current?.revision, change: body })
      if (status === 200 || status === 409) show(data.project)
      if (status === 200) return data as { project: Project; pin: Pin | null }
      if (status !== 409 || attempt > 0 || !SETTERS.has(body.op)) throw new Error(data?.error ?? String(status))
    }
  }, [sessionId])
  return { project, error, reload: load, change }
}

/** A small image of the workspace (thumbnail, concept image) as an object URL. */
function useImage(sessionId: string | undefined, path: string | null) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!sessionId || !path) { setUrl(undefined); return }
    const abort = new AbortController()
    let made: string | undefined
    readFile(sessionId, path, abort.signal, undefined, 16 << 20)
      .then(({ data }) => {
        if (abort.signal.aborted) return
        const type = /\.jpe?g$/i.test(path) ? 'image/jpeg' : /\.webp$/i.test(path) ? 'image/webp' : 'image/png'
        made = URL.createObjectURL(new Blob([data as BlobPart], { type }))
        setUrl(made)
      })
      .catch(() => setUrl(undefined))
    return () => { abort.abort(); if (made) URL.revokeObjectURL(made) }
  }, [sessionId, path])
  return url
}

/**
 * One model in 3D, read from the workspace window by window. `onViewer` hands the mounted viewer
 * to the Studio for the pin and the face count. Images (concept art) show as an image. `extra`
 * goes top right (the pin button); a file with animation clips gets a row to play them.
 */
export function Viewport({ t, sessionId, path, onViewer, compact, extra }: { t: T; sessionId: string; path: string | null; onViewer?: (v: Viewer | undefined) => void; compact?: boolean; extra?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [viewer, setViewer] = useState<Viewer>()
  const [error, setError] = useState<string>()
  const [spinning, setSpinning] = useState(false)
  const [mode, setMode] = useState<DisplayMode>('textured')
  const [clip, setClip] = useState<number | null>(null)
  const [size, setSize] = useState(0)
  const [progress, setProgress] = useState<[number, number]>()
  const isImage = !!path && /\.(png|jpe?g|webp)$/i.test(path)
  const image = useImage(isImage ? sessionId : undefined, isImage ? path : null)
  useEffect(() => {
    const el = host.current
    if (!el || !path || isImage) return
    const abort = new AbortController()
    let mounted: Viewer | undefined
    setError(undefined)
    setViewer(undefined)
    onViewer?.(undefined)
    setSpinning(false)
    setMode('textured')
    setClip(null)
    setProgress(undefined)
    readFile(sessionId, path, abort.signal, (read, total) => setProgress([read, total]))
      .then(async ({ data }) => {
        const v = await (await require.async('./client.viewer.js')).mountViewer(el, data)
        if (abort.signal.aborted) return v.dispose()
        mounted = v
        setSize(data.byteLength)
        setViewer(v)
        onViewer?.(v)
        // An animated file plays its first clip, as the web app's Animate panel does.
        if (v.animations.length) { v.play(0); setClip(0) }
      })
      .catch((err) => {
        if (abort.signal.aborted) return
        setError(err instanceof TooLarge
          ? t('viewer.tooLarge', { size: fileSizeText(err.size), limit: fileSizeText(MAX_GLB) })
          : String(err?.message ?? err))
      })
    return () => { abort.abort(); mounted?.dispose(); onViewer?.(undefined) }
  }, [sessionId, path, isImage])
  const toggle = () => { viewer?.setAutoRotate(!spinning); setSpinning(!spinning) }
  const pickMode = (m: DisplayMode) => { setMode(m); viewer?.setMode(m) }
  const pickClip = (i: number | null) => { setClip(i); viewer?.play(i) }
  return (
    <div className="meshy-viewport" data-compact={compact || undefined}>
      {isImage
        ? <div className="meshy-stage meshy-image">{image ? <img src={image} alt="" /> : <TextShimmer active>{t('viewer.loading')}</TextShimmer>}</div>
        : <div ref={host} className="meshy-stage" />}
      {!isImage && path && !viewer && !error && (
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
      {(viewer || extra) && (
        <div className="meshy-viewtools">
          {viewer && !compact ? (
            <SegmentedControl
              id={`meshy-mode-${compact ? 'b' : 'a'}`}
              label={t('studio.mode')}
              value={mode}
              onChange={pickMode}
              options={[{ value: 'textured', label: t('studio.mode.textured') }, { value: 'clay', label: t('studio.mode.clay') }, { value: 'wireframe', label: t('studio.mode.wireframe') }]}
            />
          ) : <span />}
          {extra}
        </div>
      )}
      {viewer && (
        <div className="meshy-bar">
          <span className="meshy-bar-left">
            {viewer.animations.length > 0 && (
              <span className="meshy-clips" role="group" aria-label={t('studio.clips')}>
                <button type="button" className="meshy-chipbtn" aria-pressed={clip === null} onClick={() => pickClip(null)}>{t('studio.restPose')}</button>
                {viewer.animations.map((name, i) => (
                  <button key={i} type="button" className="meshy-chipbtn" aria-pressed={clip === i} onClick={() => pickClip(i)} title={name}>{name}</button>
                ))}
              </span>
            )}
            <span className="meshy-chip">{fileSizeText(size)} · {t('viewer.triangles', { count: viewer.triangles.toLocaleString() })}</span>
          </span>
          <span className="meshy-tools">
            <Tooltip label={t('viewer.reset')} side="top" portal>
              <Button variant="ghost" size="sm" aria-label={t('viewer.reset')} icon={<IconRefreshOutlineRegular size={14} />} onClick={() => viewer.reset()} />
            </Tooltip>
            <Tooltip label={spinning ? t('viewer.stop') : t('viewer.spin')} side="top" portal>
              <Button variant="ghost" size="sm" aria-label={spinning ? t('viewer.stop') : t('viewer.spin')} aria-pressed={spinning}
                icon={spinning ? <IconPauseOutlineRegular size={14} /> : <IconPlayOutlineRegular size={14} />} onClick={toggle} />
            </Tooltip>
          </span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Tabs and tools, after the web app's workspace (Image, Model, Print, Animate, Assets).

type Tab = 'image' | 'model' | 'print' | 'animate' | 'assets'
const TABS: Tab[] = ['image', 'model', 'print', 'animate', 'assets']
type ToolId = 'texture' | 'retexture' | 'remesh' | 'uv' | 'export' | 'check' | 'repair' | 'multicolor' | 'split' | 'resize' | 'slicer' | 'rig' | 'animate'
const TAB_TOOLS: Record<'model' | 'print', ToolId[]> = {
  model: ['texture', 'retexture', 'remesh', 'uv', 'export'],
  print: ['check', 'repair', 'multicolor', 'split', 'resize', 'slicer'],
}

/**
 * Whether a tool applies to a model, by the web app's rules: null when it never shows at this
 * stage, else the i18n key of what blocks it, or '' when it is ready.
 */
function gate(tool: ToolId, a: Asset, faces: number | null): string | null {
  const stage = stageOf(a)
  const ready = a.status === 'succeeded' && !!mainFile(a)
  const blocked = (key: string | '') => (ready ? key : 'gate.notReady')
  switch (tool) {
    case 'texture': return stage === 'untextured' ? blocked('') : null
    case 'retexture': return stage === 'textured' ? blocked('') : null
    case 'remesh':
      if (stage === 'rigged' || stage === 'animated' || a.operation === 'auto-split') return null
      return blocked(a.stats.smartTopology ? 'gate.smartTopology' : '')
    case 'uv':
      if (stage !== 'untextured' && stage !== 'textured') return null
      return blocked(faces && faces > UV_MAX_FACES ? 'gate.uvFaces' : '')
    case 'export': return blocked('')
    case 'multicolor':
      if (stage === 'animated') return blocked('gate.animated')
      return blocked(a.stats.textured === false ? 'gate.needsTexture' : '')
    case 'check': case 'repair': case 'split': case 'resize': case 'slicer':
      return blocked(stage === 'animated' ? 'gate.animated' : '')
    default: return blocked('')
  }
}

/** Tab icons: plain strokes in currentColor, so they follow the theme. */
const TAB_ICON: Record<Tab, ReactNode> = {
  image: <path d="M3 4.5h10v7H3zM3 10l3-3 3 3 2-2 2 2" />,
  model: <path d="M8 2.5l5 2.75v5.5L8 13.5l-5-2.75v-5.5zM3 5.25L8 8l5-2.75M8 8v5.5" />,
  print: <path d="M4.5 6V2.5h7V6M3 6h10v5H3zM5 9.5h6v4H5z" />,
  animate: <path d="M8.5 3.2a1.2 1.2 0 1 0 0 .1M6 13.5l1.5-4 2 1.5v3M7.5 9.5l.5-3 2 1.5 2-.5M8 6.5L5.5 8" />,
  assets: <path d="M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z" />,
}
const TabIcon = ({ tab }: { tab: Tab }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TAB_ICON[tab]}</svg>
)
const StarIcon = ({ on }: { on: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 2l1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z" />
  </svg>
)

function Chips<V extends string | number>({ options, value, onToggle, label }: { options: { value: V; label: string; hint?: string }[]; value: V | V[]; onToggle(v: V): void; label: string }) {
  const on = (v: V) => (Array.isArray(value) ? value.includes(v) : value === v)
  return (
    <span className="meshy-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="meshy-chipbtn" aria-pressed={on(o.value)} title={o.hint} onClick={() => onToggle(o.value)}>
          {on(o.value) && Array.isArray(value) && <IconCheckOutlineRegular size={10} />}{o.label}
        </button>
      ))}
    </span>
  )
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="meshy-field"><span className="meshy-field-label">{label}</span>{children}</label>
)

const ANIMATIONS = ['idle', 'walk', 'run', 'jump', 'wave', 'dance', 'attack', 'sit']
const FACE_PRESETS = [1_000, 3_000, 5_000, 10_000, 30_000, 100_000]
const SLICERS = ['auto', 'bambu', 'orca', 'prusa', 'cura']
/** Half of what the model has, on a preset; 10,000 when nothing is known. */
const suggestFaces = (count: number | null | undefined) => {
  if (!count) return 10_000
  const below = FACE_PRESETS.filter((p) => p < count)
  return below.reduce((best, p) => (Math.abs(p - count / 2) < Math.abs(best - count / 2) ? p : best), below[0] ?? FACE_PRESETS[0])
}

/**
 * The options of one tool and the request they make. Nothing runs from here: "Add to message"
 * writes the request into the session's draft, and the agent quotes the cost before it spends.
 */
function ToolPanel({ t, tool, asset, faces, send, onClose }: { t: T; tool: ToolId; asset: Asset; faces: number | null; send(text: string): void; onClose?(): void }) {
  const count = asset.stats.faces ?? faces
  const [style, setStyle] = useState('')
  const [pbr, setPbr] = useState(true)
  const [target, setTarget] = useState(() => suggestFaces(count))
  const [topology, setTopology] = useState<'triangle' | 'quad'>('triangle')
  const owned = MODEL_FORMATS.filter((f) => asset.files[f])
  const [formats, setFormats] = useState<string[]>(() => (owned.includes('fbx') ? [] : ['fbx']))
  const [colors, setColors] = useState(4)
  const [parts, setParts] = useState('')
  const [height, setHeight] = useState('100')
  const [slicer, setSlicer] = useState('auto')
  const [rigHeight, setRigHeight] = useState('1.7')
  const [actions, setActions] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  const toggle = <V,>(list: V[], v: V) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const r = ref(t, asset)

  let body: ReactNode = null
  let text = ''
  let canSend = true
  switch (tool) {
    case 'texture':
    case 'retexture':
      body = (
        <>
          <Field label={t('tool.style')}>
            <textarea className="meshy-input" rows={2} value={style} placeholder={t('tool.stylePlaceholder')} onChange={(e) => setStyle(e.target.value)} />
          </Field>
          <label className="meshy-check"><input type="checkbox" checked={pbr} onChange={(e) => setPbr(e.target.checked)} />{t('tool.pbr')}</label>
        </>
      )
      text = t(`draft.${tool}`, { ref: r, style: style.trim(), pbr: pbr ? t('draft.pbr') : '' })
      break
    case 'remesh':
      body = (
        <>
          <Field label={t('tool.targetFaces', { now: count ? count.toLocaleString() : '—' })}>
            <Chips label={t('tool.targetFaces', { now: '' })} value={target} onToggle={setTarget}
              options={FACE_PRESETS.map((n) => ({ value: n, label: n >= 1000 ? `${n / 1000}k` : String(n) }))} />
          </Field>
          <Field label={t('tool.topology')}>
            <Chips label={t('tool.topology')} value={topology} onToggle={setTopology}
              options={[{ value: 'triangle', label: t('tool.triangle') }, { value: 'quad', label: t('tool.quad') }]} />
          </Field>
        </>
      )
      text = t('draft.remesh', { ref: r, faces: target.toLocaleString(), topology: t(`tool.${topology}`) })
      break
    case 'uv':
      body = <span className="meshy-muted meshy-small">{t('tool.uvHint')}</span>
      text = t('draft.uv', { ref: r })
      break
    case 'export':
      body = (
        <>
          {owned.length > 0 && <span className="meshy-muted meshy-small">{t('tool.owned', { formats: owned.map((f) => f.toUpperCase()).join(' · ') })}</span>}
          <Field label={t('tool.formats')}>
            <Chips label={t('tool.formats')} value={formats} onToggle={(f) => setFormats(toggle(formats, f))}
              options={MODEL_FORMATS.filter((f) => !owned.includes(f)).map((f) => ({ value: f, label: f.toUpperCase() }))} />
          </Field>
        </>
      )
      canSend = formats.length > 0
      text = t('draft.export', { ref: r, formats: formats.map((f) => f.toUpperCase()).join(', ') })
      break
    case 'check':
      body = <span className="meshy-muted meshy-small">{t('tool.checkHint')}</span>
      text = t('draft.check', { ref: r })
      break
    case 'repair':
      body = <span className="meshy-muted meshy-small">{t('tool.repairHint')}</span>
      text = t('draft.repair', { ref: r })
      break
    case 'multicolor':
      body = (
        <Field label={t('tool.colors')}>
          <Chips label={t('tool.colors')} value={colors} onToggle={setColors} options={[2, 3, 4, 6, 8].map((n) => ({ value: n, label: String(n) }))} />
        </Field>
      )
      text = t('draft.multicolor', { ref: r, colors })
      break
    case 'split':
      body = (
        <Field label={t('tool.parts')}>
          <input className="meshy-input" value={parts} placeholder={t('tool.partsPlaceholder')} onChange={(e) => setParts(e.target.value)} />
        </Field>
      )
      text = t('draft.split', { ref: r, parts: parts.trim() })
      break
    case 'resize':
      body = (
        <Field label={t('tool.height')}>
          <span className="meshy-unit"><input className="meshy-input" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} /><span>mm</span></span>
        </Field>
      )
      canSend = Number(height) > 0
      text = t('draft.resize', { ref: r, height: height.trim() })
      break
    case 'slicer':
      body = (
        <Field label={t('tool.slicerPick')}>
          <Chips label={t('tool.slicerPick')} value={slicer} onToggle={setSlicer} options={SLICERS.map((s) => ({ value: s, label: t(`slicer.${s}`) }))} />
        </Field>
      )
      text = t('draft.slicer', { ref: r, slicer: t(`slicer.${slicer}`) })
      break
    case 'rig':
      body = (
        <>
          <span className="meshy-muted meshy-small">{t('tool.rigHint')}</span>
          <Field label={t('tool.rigHeight')}>
            <span className="meshy-unit"><input className="meshy-input" inputMode="decimal" value={rigHeight} onChange={(e) => setRigHeight(e.target.value)} /><span>m</span></span>
          </Field>
        </>
      )
      canSend = Number(rigHeight) > 0
      text = t('draft.rig', { ref: r, height: rigHeight.trim() })
      break
    case 'animate': {
      const picked = [...actions.map((a) => t(`anim.${a}`)), custom.trim()].filter(Boolean)
      body = (
        <>
          <Field label={t('tool.actions')}>
            <Chips label={t('tool.actions')} value={actions} onToggle={(a) => setActions(toggle(actions, a).slice(-10))}
              options={ANIMATIONS.map((a) => ({ value: a, label: t(`anim.${a}`) }))} />
          </Field>
          <Field label={t('tool.customAction')}>
            <input className="meshy-input" value={custom} placeholder={t('tool.customPlaceholder')} onChange={(e) => setCustom(e.target.value)} />
          </Field>
        </>
      )
      canSend = picked.length > 0
      text = t('draft.animate', { ref: r, actions: picked.join(t('list.sep')) })
      break
    }
  }
  return (
    <div className="meshy-panel">
      <div className="meshy-panel-head">
        <span className="meshy-name">{t(`tool.${tool}`)}</span>
        {onClose && <button type="button" className="meshy-textbtn meshy-small" onClick={onClose}>{t('tool.close')}</button>}
      </div>
      {body}
      <div className="meshy-panel-foot">
        <span className="meshy-muted meshy-small">{t('studio.actionsHint')}</span>
        <Button variant="primary" className="meshy-accent" size="sm" disabled={!canSend} onClick={() => send(text)}>{t('tool.send')}</Button>
      </div>
    </div>
  )
}

/** A row of tool tiles; a blocked tool says why and opens nothing. */
function ToolRow({ t, tools, asset, faces, open, onOpen }: { t: T; tools: ToolId[]; asset: Asset; faces: number | null; open?: ToolId; onOpen(tool: ToolId): void }) {
  const shown = tools.map((tool) => [tool, gate(tool, asset, faces)] as const).filter(([, g]) => g !== null)
  return (
    <div className="meshy-toolgrid" role="toolbar" aria-label={t('studio.tools')}>
      {shown.map(([tool, why]) => (
        <Tooltip key={tool} label={why ? t(why) : t(`tool.${tool}.hint`)} side="top" portal>
          <button type="button" className="meshy-tool" aria-pressed={open === tool} aria-disabled={!!why || undefined}
            onClick={() => { if (!why) onOpen(tool) }}>
            <span className="meshy-tool-name">{t(`tool.${tool}`)}</span>
            <span className="meshy-tool-hint">{why ? t(why) : t(`tool.${tool}.hint`)}</span>
          </button>
        </Tooltip>
      ))}
    </div>
  )
}

function Thumb({ t, sessionId, asset, active, compared, onPick }: { t: T; sessionId: string; asset: Asset; active: boolean; compared?: boolean; onPick(): void }) {
  const src = useImage(sessionId, asset.files.thumbnail ?? (asset.kind === 'image' ? asset.files.images[0] ?? null : null))
  const busy = BUSY.has(asset.status)
  return (
    <button type="button" className="meshy-thumb" data-active={active || undefined} data-compared={compared || undefined} onClick={onPick} title={ref(t, asset)}>
      <span className="meshy-thumb-img">
        {src ? <img src={src} alt="" /> : busy ? <StateDot state="ongoing" size={12} /> : <span className="meshy-muted meshy-small">{asset.kind === 'image' ? '2D' : '3D'}</span>}
        {busy && asset.progress !== null && <span className="meshy-thumb-progress" style={{ width: `${Math.round(asset.progress * 100)}%` }} />}
        <span className="meshy-thumb-tag">{opOf(t, asset)}</span>
        {asset.status === 'failed' && <span className="meshy-thumb-failed"><IconWarningOutlineRegular size={14} /></span>}
      </span>
      <span className="meshy-thumb-label">{assetName(t, asset)}</span>
    </button>
  )
}

/** Ancestors of `id`, oldest first, guarded against a cycle in hand-set links. */
function lineage(assets: Asset[], id: string | null) {
  const byId = new Map(assets.map((a) => [a.id, a]))
  const chain: Asset[] = []
  const seen = new Set<string>()
  for (let a = id ? byId.get(id) : undefined; a && !seen.has(a.id); a = a.parentId ? byId.get(a.parentId) : undefined) {
    seen.add(a.id)
    chain.unshift(a)
  }
  return chain
}
/** The web app's asset root: the oldest known source of an asset. */
const rootOf = (assets: Asset[], id: string) => lineage(assets, id)[0]?.id ?? id
/** Every asset per root, newest first, roots by their latest activity. */
function families(assets: Asset[]) {
  const groups = new Map<string, Asset[]>()
  for (const a of assets) {
    const root = rootOf(assets, a.id)
    groups.set(root, [...(groups.get(root) ?? []), a])
  }
  const newest = (list: Asset[]) => list.reduce((m, a) => (String(a.createdAt ?? '') > m ? String(a.createdAt ?? '') : m), '')
  return [...groups.entries()]
    .map(([root, list]) => ({ root, list: [...list].sort((x, y) => String(y.createdAt ?? '').localeCompare(String(x.createdAt ?? ''))) }))
    .sort((x, y) => newest(y.list).localeCompare(newest(x.list)))
}

const shortDate = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

type Filter = 'all' | 'image' | 'untextured' | 'textured' | 'animation' | 'starred' | 'archived'
const FILTERS: Filter[] = ['all', 'image', 'untextured', 'textured', 'animation', 'starred', 'archived']
function matches(a: Asset, f: Filter) {
  if (f === 'archived') return a.archived
  if (a.archived) return false
  const stage = stageOf(a)
  switch (f) {
    case 'image': return stage === 'image'
    case 'untextured': return stage === 'untextured'
    case 'textured': return stage === 'textured' || stage === 'print'
    case 'animation': return stage === 'rigged' || stage === 'animated'
    case 'starred': return a.starred
    default: return true
  }
}

/** One asset in the library: open, star, rename, mention in the chat, archive. */
function AssetCard({ t, sessionId, asset, active, change, onOpen, onMention }: { t: T; sessionId: string; asset: Asset; active: boolean; change(body: { op: string } & Record<string, unknown>): Promise<unknown>; onOpen(): void; onMention(): void }) {
  const src = useImage(sessionId, asset.files.thumbnail ?? (asset.kind === 'image' ? asset.files.images[0] ?? null : null))
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const busy = BUSY.has(asset.status)
  const save = () => { setEditing(false); if (name.trim() !== (asset.label ?? '')) void change({ op: 'label', assetId: asset.id, label: name.trim() }).catch(() => {}) }
  const facts = [opOf(t, asset), asset.stats.faces ? t('viewer.faces', { count: asset.stats.faces.toLocaleString() }) : null, shortDate(asset.createdAt)].filter(Boolean).join(' · ')
  return (
    <div className="meshy-asset" data-active={active || undefined} data-archived={asset.archived || undefined}>
      <button type="button" className="meshy-asset-img" onClick={onOpen} title={t('assets.open')}>
        {src ? <img src={src} alt="" /> : busy ? <StateDot state="ongoing" size={12} /> : <span className="meshy-muted meshy-small">{asset.kind === 'image' ? '2D' : '3D'}</span>}
        {busy && asset.progress !== null && <span className="meshy-thumb-progress" style={{ width: `${Math.round(asset.progress * 100)}%` }} />}
        {asset.status !== 'succeeded' && <span className="meshy-thumb-tag">{t(`status.${asset.status}`)}</span>}
      </button>
      <button type="button" className="meshy-asset-star" aria-pressed={asset.starred} aria-label={t(asset.starred ? 'assets.unstar' : 'assets.star')}
        onClick={() => change({ op: 'star', assetId: asset.id, on: !asset.starred }).catch(() => {})}><StarIcon on={asset.starred} /></button>
      {editing
        ? <input className="meshy-input meshy-asset-rename" autoFocus value={name} aria-label={t('assets.rename')}
            onChange={(e) => setName(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
        : <span className="meshy-asset-name" title={assetName(t, asset)}>{assetName(t, asset)}</span>}
      <span className="meshy-asset-facts">{facts}</span>
      <span className="meshy-asset-actions">
        <button type="button" className="meshy-textbtn" onClick={() => { setName(asset.label ?? asset.title ?? ''); setEditing(true) }}>{t('assets.rename')}</button>
        {mainFile(asset) && <button type="button" className="meshy-textbtn" onClick={onMention}>{t('assets.mention')}</button>}
        <button type="button" className="meshy-textbtn" onClick={() => change({ op: 'archive', assetId: asset.id, on: !asset.archived }).catch(() => {})}>{t(asset.archived ? 'assets.restore' : 'assets.archive')}</button>
      </span>
    </div>
  )
}

/** The Assets tab: every asset of the session, by the model it came from, or as one grid. */
function AssetLibrary({ t, sessionId, project, activeId, change, open, onMention }: { t: T; sessionId: string; project: Project; activeId?: string; change(body: { op: string } & Record<string, unknown>): Promise<unknown>; open(a: Asset): void; onMention(a: Asset): void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [layout, setLayout] = useState<'folder' | 'grid'>('folder')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const q = query.trim().toLowerCase()
  const shown = project.assets.filter((a) => matches(a, filter) && (!q || [assetName(t, a), a.title, a.id, mainFile(a)].some((s) => s?.toLowerCase().includes(q))))
  const counts = Object.fromEntries(FILTERS.map((f) => [f, project.assets.filter((a) => matches(a, f)).length])) as Record<Filter, number>
  const credits = project.assets.reduce((sum, a) => sum + (a.credits ?? 0), 0)
  const card = (a: Asset) => <AssetCard key={a.id} t={t} sessionId={sessionId} asset={a} active={a.id === activeId} change={change} onOpen={() => open(a)} onMention={() => onMention(a)} />
  const byId = new Map(project.assets.map((a) => [a.id, a]))
  return (
    <div className="meshy-library">
      <div className="meshy-library-bar">
        <input className="meshy-input meshy-search" type="search" value={query} placeholder={t('assets.search')} aria-label={t('assets.search')} onChange={(e) => setQuery(e.target.value)} />
        <SegmentedControl id="meshy-layout" label={t('assets.layout')} value={layout} onChange={setLayout}
          options={[{ value: 'folder', label: t('assets.folder') }, { value: 'grid', label: t('assets.grid') }]} />
      </div>
      <Chips label={t('assets.filter')} value={filter} onToggle={setFilter}
        options={FILTERS.filter((f) => f === 'all' || counts[f] > 0 || f === filter).map((f) => ({ value: f, label: `${t(`filter.${f}`)} ${counts[f]}` }))} />
      {shown.length === 0 && <span className="meshy-muted meshy-small meshy-empty">{t(project.assets.length ? 'assets.none' : 'studio.empty')}</span>}
      {layout === 'grid'
        ? <div className="meshy-assetgrid">{[...shown].reverse().map(card)}</div>
        : families(project.assets).map(({ root, list }) => {
            const items = list.filter((a) => shown.includes(a))
            if (!items.length) return null
            // Named after what someone named, else the source or the first asset that has a name of its own.
            const first = byId.get(root)!
            const head = list.find((a) => a.label) ?? [first, ...list].find((a) => a.title || stem(mainFile(a))) ?? first
            const isClosed = closed.has(root)
            return (
              <section key={root} className="meshy-family">
                <button type="button" className="meshy-family-head" aria-expanded={!isClosed}
                  onClick={() => { const next = new Set(closed); if (isClosed) next.delete(root); else next.add(root); setClosed(next) }}>
                  <span className="meshy-chevron" data-open={!isClosed || undefined}><IconChevronRightOutlineRegular size={12} /></span>
                  <span className="meshy-name">{assetName(t, head)}</span>
                  <span className="meshy-muted meshy-small">{t('assets.related', { count: list.length })}</span>
                </button>
                {!isClosed && <div className="meshy-assetgrid">{items.map(card)}</div>}
              </section>
            )
          })}
      <span className="meshy-muted meshy-small">{t('assets.footer', { count: project.assets.length, credits })}</span>
    </div>
  )
}

/**
 * The Studio body. `focusPath`, from a .glb preview, makes the asset that owns that file the
 * active one; a file no asset owns falls back to the plain viewer.
 */
export function Studio({ t, sessionId, focusPath, inputActions, onReady }: { t: T; sessionId: string; focusPath?: string; inputActions?: InputActions; onReady?: (ok: boolean) => void }) {
  const { project, error, reload, change } = useProject(sessionId)
  const [tab, setTab] = useState<Tab>()
  const [tool, setTool] = useState<ToolId>()
  const [compare, setCompare] = useState(false)
  const [compareId, setCompareId] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [faces, setFaces] = useState<number | null>(null)
  const viewer = useRef<Viewer>()
  const focused = useRef(false)
  const say = (text: string) => { setNotice(text); window.setTimeout(() => setNotice((n) => (n === text ? undefined : n)), 4000) }

  useEffect(() => { if (project || error) onReady?.(!!project) }, [!!project, !!error])
  // A .glb opened from the file tree or a chat card: show its asset, once.
  const owner = focusPath ? project?.assets.find((a) => Object.values(a.files).some((f) => f === focusPath)) : undefined
  useEffect(() => {
    if (!owner || focused.current || !project) return
    focused.current = true
    if (project.activeAssetId !== owner.id) void change({ op: 'activate', assetId: owner.id }).catch(() => {})
  }, [owner?.id, !!project])

  const assets = project?.assets ?? []
  const live = assets.filter((a) => !a.archived)
  const active = assets.find((a) => a.id === project?.activeAssetId) ?? live.at(-1)
  const family = useMemo(() => {
    if (!active) return []
    const root = rootOf(assets, active.id)
    return families(assets).find((f) => f.root === root)?.list.filter((a) => !a.archived || a.id === active.id) ?? []
  }, [assets, active?.id])
  // The model the Model, Print and Animate tabs work on: the active one, else the newest model
  // made from the active image, else the newest model.
  const model = active?.kind === 'model' ? active
    : family.find((a) => a.kind === 'model') ?? [...live].reverse().find((a) => a.kind === 'model')
  const images = live.filter((a) => a.kind === 'image')
  const image = active?.kind === 'image' ? active : family.find((a) => a.kind === 'image') ?? images.filter(mainFile).at(-1) ?? images.at(-1)
  const current: Tab = tab ?? (active?.kind === 'image' ? 'image' : 'model')
  const compared = compare && compareId ? assets.find((a) => a.id === compareId) : undefined
  const openPins = (project?.pins ?? []).filter((p) => !p.resolved)
  useEffect(() => { setTool(undefined) }, [model?.id, current])
  useEffect(() => { setFaces(null) }, [model?.id])

  if (focusPath && project && !owner) return <Viewport t={t} sessionId={sessionId} path={focusPath} />
  if (!project) {
    return (
      <div className="meshy-root meshy-studio">
        {error
          ? <div className="meshy-overlay" role="alert"><IconWarningOutlineRegular size={20} /><span>{t('studio.unavailable')}</span><span className="meshy-muted meshy-small">{error}</span>
              <Button variant="outline" size="sm" onClick={reload}>{t('retry')}</Button></div>
          : <div className="meshy-overlay meshy-muted"><Logo /><TextShimmer active>{t('studio.loading')}</TextShimmer></div>}
      </div>
    )
  }

  const activate = async (a: Asset) => { try { await change({ op: 'activate', assetId: a.id }) } catch { /* the newer project is shown */ } }
  const pick = (a: Asset) => {
    if (compare && model && a.id !== model.id) { setCompareId(a.id); return }
    void activate(a)
  }
  const draft = async (text: string, ok = 'studio.drafted') => {
    const where = await toDraft(inputActions, text)
    say(t(where === 'draft' ? ok : where === 'clipboard' ? 'studio.copied' : 'studio.draftFailed'))
  }
  /** Open an asset where it belongs: an image in the Image tab, a model in the Model tab. */
  const open = (a: Asset) => { void activate(a); setTab(a.kind === 'image' ? 'image' : 'model') }
  const mentionOf = (a: Asset) => { const f = mainFile(a); if (f) void draft(`${mention(f)} `, 'studio.mentioned') }
  const go = (next: Tab) => {
    setTab(next)
    setCompare(false); setCompareId(undefined)
    // Switching between Image and the model tabs follows the source chain, as the web app does.
    if (next === 'image' && image && active?.kind !== 'image') void activate(image)
    if ((next === 'model' || next === 'print' || next === 'animate') && model && active?.id !== model.id) void activate(model)
  }
  const pin = async (a: Asset) => {
    const v = viewer.current
    if (!v || busy) return
    setBusy(true)
    try {
      const camera = v.camera()
      const res = await change({ op: 'pin', assetId: a.id, note: '', camera, snapshotPng: v.snapshot(1024) })
      const p = res?.pin
      if (!p) return
      await draft(t('draft.pin', {
        mention: p.snapshot ? `${mention(p.snapshot)} ` : '',
        pin: p.id,
        ref: ref(t, a),
        azimuth: camera.azimuth,
        elevation: camera.elevation,
        faces: (a.stats.faces ?? v.triangles).toLocaleString(),
      }), 'studio.pinned')
    } catch (err) {
      say(t('error.generic', { message: String((err as Error)?.message ?? err) }))
    } finally {
      setBusy(false)
    }
  }
  const counts: Record<Tab, number> = {
    image: images.length,
    model: live.filter((a) => a.kind === 'model').length,
    print: live.filter((a) => stageOf(a) === 'print').length,
    animate: live.filter(isRigged).length,
    assets: live.length,
  }

  const nav = (
    <nav className="meshy-tabs" aria-label={t('studio.flow')}>
      {TABS.map((id) => (
        <button key={id} type="button" className="meshy-tab" aria-current={current === id ? 'page' : undefined} data-assets={id === 'assets' || undefined} onClick={() => go(id)}>
          <TabIcon tab={id} />
          <span>{t(`tab.${id}`)}</span>
          {counts[id] > 0 && <span className="meshy-tab-count">{counts[id]}</span>}
        </button>
      ))}
    </nav>
  )
  const foot = (
    <>
      {notice && <div className="meshy-toast meshy-small" role="status">{notice}</div>}
      {!project.signedIn && <div className="meshy-alert meshy-small" role="status"><IconWarningOutlineRegular size={14} /><span>{t('studio.signedOut')}</span></div>}
    </>
  )

  if (current === 'assets') {
    return (
      <div className="meshy-root meshy-studio">
        {nav}
        <AssetLibrary t={t} sessionId={sessionId} project={project} activeId={active?.id} change={change} open={open} onMention={mentionOf} />
        {foot}
      </div>
    )
  }

  if (current === 'image') {
    const made = image ? assets.filter((a) => a.parentId === image.id && a.kind === 'model' && !a.archived) : []
    return (
      <div className="meshy-root meshy-studio">
        {nav}
        {!image ? (
          <div className="meshy-empty-state meshy-muted"><Logo /><span>{t('image.empty')}</span>
            <Button variant="outline" size="sm" onClick={() => draft(t('draft.concept'))}>{t('image.ask')}</Button></div>
        ) : (
          <>
            <AssetHead t={t} asset={image} change={change} />
            {mainFile(image) ? <Viewport t={t} sessionId={sessionId} path={mainFile(image)} /> : <Pending t={t} asset={image} />}
            <div className="meshy-actions-row">
              <Button variant="primary" className="meshy-accent" size="sm" disabled={image.status !== 'succeeded'} onClick={() => draft(t('draft.build', { ref: ref(t, image) }))}>{t('action.build')}</Button>
              <Button variant="outline" size="sm" disabled={image.status !== 'succeeded'} onClick={() => draft(t('draft.editImage', { ref: ref(t, image) }))}>{t('action.editImage')}</Button>
              <Button variant="outline" size="sm" onClick={() => draft(t('draft.concept'))}>{t('action.newImage')}</Button>
            </div>
            {made.length > 0 && (
              <>
                <span className="meshy-section-title">{t('image.models', { count: made.length })}</span>
                <div className="meshy-strip">{made.map((a) => <Thumb key={a.id} t={t} sessionId={sessionId} asset={a} active={false} onPick={() => open(a)} />)}</div>
              </>
            )}
            <span className="meshy-section-title">{t('image.all', { count: images.length })}</span>
            <div className="meshy-strip">{[...images].reverse().map((a) => <Thumb key={a.id} t={t} sessionId={sessionId} asset={a} active={a.id === image.id} onPick={() => void activate(a)} />)}</div>
          </>
        )}
        {foot}
      </div>
    )
  }

  // Model, Print and Animate: one model in one viewport, each tab with its own tools.
  if (!model) {
    return (
      <div className="meshy-root meshy-studio">
        {nav}
        <div className="meshy-empty-state meshy-muted">
          <Logo />
          <span>{t(images.length ? 'model.fromImage' : 'studio.empty')}</span>
          {images.length > 0 && <Button variant="outline" size="sm" onClick={() => go('image')}>{t('tab.image')}</Button>}
        </div>
        {foot}
      </div>
    )
  }

  const ready = model.status === 'succeeded' && !!mainFile(model)
  const pinButton = ready && (
    <Tooltip label={t('action.pinHint')} side="bottom" portal>
      <Button variant="primary" className="meshy-accent" size="sm" disabled={busy} onClick={() => pin(model)}>{t('action.pin')}</Button>
    </Tooltip>
  )
  const view = model.status === 'failed' || !mainFile(model) ? <Pending t={t} asset={model} /> : (
    <Viewport t={t} sessionId={sessionId} path={mainFile(model)} extra={pinButton} onViewer={(v) => { viewer.current = v; setFaces(v?.triangles ?? null) }} />
  )
  const panel = (toolId: ToolId, closable = true) => (
    <ToolPanel key={`${toolId}:${model.id}`} t={t} tool={toolId} asset={model} faces={faces} send={(text) => draft(text)} onClose={closable ? () => setTool(undefined) : undefined} />
  )

  let tools: ReactNode
  if (current === 'animate') {
    tools = <AnimateTools t={t} sessionId={sessionId} model={model} assets={assets} faces={faces} tool={tool} setTool={setTool} panel={panel}
      open={(a) => void activate(a)} toRemesh={() => { setTab('model'); setTool('remesh') }} />
  } else {
    tools = (
      <>
        <ToolRow t={t} tools={TAB_TOOLS[current]} asset={model} faces={faces} open={tool} onOpen={(x) => setTool(tool === x ? undefined : x)} />
        {tool && TAB_TOOLS[current].includes(tool) && panel(tool)}
        {current === 'model' && ready && (
          <div className="meshy-jump meshy-small">
            <span className="meshy-muted">{t('model.next')}</span>
            <button type="button" className="meshy-textbtn" onClick={() => go('print')}>{t('tab.print')} ›</button>
            <button type="button" className="meshy-textbtn" onClick={() => go('animate')}>{t('tab.animate')} ›</button>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="meshy-root meshy-studio">
      {nav}
      <AssetHead t={t} asset={model} change={change} />
      <div className="meshy-views">
        {view}
        {compared && (
          <div className="meshy-compare">
            <div className="meshy-compare-head meshy-small">
              <span className="meshy-muted">{t('studio.comparing', { name: assetName(t, compared) })}</span>
              <Button variant="outline" size="sm" onClick={async () => { setCompare(false); setCompareId(undefined); await activate(compared) }}>{t('studio.makeCurrent')}</Button>
            </div>
            <Viewport t={t} sessionId={sessionId} path={mainFile(compared)} compact />
          </div>
        )}
      </div>
      {tools}

      <div className="meshy-strip-head meshy-small">
        <span className="meshy-section-title">{t('studio.related', { count: family.length })}</span>
        <span className="meshy-strip-tools">
          {family.length > 1 && <button type="button" className="meshy-textbtn" aria-pressed={compare} onClick={() => { setCompare(!compare); setCompareId(undefined) }}>{t(compare ? 'studio.compareOff' : 'studio.compare')}</button>}
          <button type="button" className="meshy-textbtn" onClick={() => go('assets')}>{t('studio.allAssets')} ›</button>
        </span>
      </div>
      {compare && !compared && <span className="meshy-muted meshy-small">{t('studio.compareHint')}</span>}
      <div className="meshy-strip" role="listbox" aria-label={t('studio.versionsLabel')}>
        {family.map((a) => (
          <Thumb key={a.id} t={t} sessionId={sessionId} asset={a} active={a.id === model.id} compared={a.id === compareId}
            onPick={() => (a.kind === 'image' ? open(a) : pick(a))} />
        ))}
      </div>

      {openPins.length > 0 && (
        <div className="meshy-card meshy-rows">
          <span className="meshy-small meshy-muted">{t('studio.openPins', { count: openPins.length })}</span>
          {openPins.slice(-5).map((p) => {
            const a = assets.find((x) => x.id === p.assetId)
            return (
              <div key={p.id} className="meshy-row meshy-small">
                <span>{p.id} · {a ? assetName(t, a) : '—'}{p.camera ? ` · ${t('studio.angle', { azimuth: p.camera.azimuth, elevation: p.camera.elevation })}` : ''}</span>
                <button type="button" className="meshy-textbtn" onClick={() => change({ op: 'resolve', pinId: p.id }).catch(() => {})}>{t('studio.dismissPin')}</button>
              </div>
            )
          })}
        </div>
      )}

      <details className="meshy-advanced meshy-small">
        <summary>{t('studio.advanced')}</summary>
        <dl>
          <dt>{t('studio.operation')}</dt><dd>{model.operation}{model.type && model.type !== model.operation ? ` (${model.type})` : ''}</dd>
          <dt>{t('studio.taskId')}</dt><dd><code>{model.taskId}</code></dd>
          {model.title && <><dt>{t('studio.prompt')}</dt><dd>{model.title}</dd></>}
          {model.credits !== null && <><dt>{t('studio.creditsLabel')}</dt><dd>{model.credits}</dd></>}
          {MODEL_FORMATS.filter((f) => model.files[f]).map((f) => <span key={f} style={{ display: 'contents' }}><dt>{f.toUpperCase()}</dt><dd><code>{model.files[f]}</code></dd></span>)}
          <dt>{t('studio.projectFile')}</dt><dd><code>{project.file}</code></dd>
        </dl>
      </details>
      {foot}
    </div>
  )
}

/** The viewport of an asset with nothing to show yet: its progress, or why it never will. */
function Pending({ t, asset }: { t: T; asset: Asset }) {
  if (asset.status === 'failed') {
    return <div className="meshy-viewport"><div className="meshy-overlay" role="alert"><IconWarningOutlineRegular size={20} /><span>{t('status.failed')}</span></div></div>
  }
  return (
    <div className="meshy-viewport">
      <div className="meshy-overlay meshy-muted">
        <Logo />
        <TextShimmer active={BUSY.has(asset.status)}>{t(`status.${asset.status}`)}</TextShimmer>
        {asset.progress !== null && (
          <span className="meshy-meter" role="progressbar" aria-valuenow={Math.round(asset.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.round(asset.progress * 100)}%` }} />
          </span>
        )}
        <span className="meshy-small">{asset.status === 'submitted' ? t('status.submittedHint') : `${assetName(t, asset)}${asset.progress !== null ? ` · ${Math.round(asset.progress * 100)}%` : ''}`}</span>
      </div>
    </div>
  )
}

/** Name (renamable), star and the facts of the asset in view. */
function AssetHead({ t, asset, change }: { t: T; asset: Asset; change(body: { op: string } & Record<string, unknown>): Promise<unknown> }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const save = () => { setEditing(false); if (name.trim() !== (asset.label ?? '')) void change({ op: 'label', assetId: asset.id, label: name.trim() }).catch(() => {}) }
  const stage = stageOf(asset)
  const facts = [
    opOf(t, asset),
    asset.stats.faces !== null ? t('viewer.faces', { count: asset.stats.faces.toLocaleString() }) : null,
    asset.kind === 'model' ? t(`stage.${stage}`) : null,
    asset.stats.smartTopology ? t('studio.smartTopology') : null,
    asset.credits !== null ? t('studio.credits', { count: asset.credits }) : null,
    asset.status !== 'succeeded' ? t(`status.${asset.status}`) : null,
  ].filter(Boolean)
  return (
    <div className="meshy-head">
      <div className="meshy-head-title">
        {editing
          ? <input className="meshy-input" autoFocus value={name} aria-label={t('assets.rename')} onChange={(e) => setName(e.target.value)} onBlur={save}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} />
          : <button type="button" className="meshy-head-name" title={t('assets.rename')} onClick={() => { setName(asset.label ?? asset.title ?? ''); setEditing(true) }}>{assetName(t, asset)}</button>}
        <button type="button" className="meshy-asset-star" aria-pressed={asset.starred} aria-label={t(asset.starred ? 'assets.unstar' : 'assets.star')}
          onClick={() => change({ op: 'star', assetId: asset.id, on: !asset.starred }).catch(() => {})}><StarIcon on={asset.starred} /></button>
      </div>
      <span className="meshy-facts meshy-small">{facts.join(' · ')}</span>
    </div>
  )
}

/**
 * The Animate tab, the web app's rig states: unrigged (rig it, or remesh first when it has too
 * many faces), rigging, rig failed, rigged (add animations, play the clips the file has).
 */
function AnimateTools({ t, sessionId, model, assets, faces, tool, setTool, panel, open, toRemesh }: {
  t: T; sessionId: string; model: Asset; assets: Asset[]; faces: number | null; tool?: ToolId; setTool(tool?: ToolId): void
  panel(tool: ToolId, closable?: boolean): ReactNode; open(a: Asset): void; toRemesh(): void
}) {
  const rigs = assets.filter((a) => a.parentId === model.id && a.operation === 'rigging' && !a.archived)
  const rig = rigs.at(-1)
  const animations = assets.filter((a) => a.parentId === (isRigged(model) ? model.id : rig?.id) && a.operation === 'animate' && !a.archived)
  const count = model.stats.faces ?? faces
  const ready = model.status === 'succeeded' && !!mainFile(model)
  let state: 'unrigged' | 'rigging' | 'failed' | 'rigged' | 'hasRig' | 'notReady'
  if (!ready) state = 'notReady'
  else if (isRigged(model)) state = 'rigged'
  else if (rig && BUSY.has(rig.status)) state = 'rigging'
  else if (rig?.status === 'succeeded') state = 'hasRig'
  else if (rig?.status === 'failed') state = 'failed'
  else state = 'unrigged'
  const tooMany = !!count && count > RIG_MAX_FACES
  const steps = (
    <ol className="meshy-steps meshy-small">
      <li data-done={state === 'rigged' || state === 'hasRig' || undefined} data-current={state === 'unrigged' || state === 'rigging' || state === 'failed' || undefined}>{t('anim.step.rig')}</li>
      <li data-current={state === 'rigged' || undefined} data-done={animations.length > 0 || undefined}>{t('anim.step.animate')}</li>
    </ol>
  )
  return (
    <div className="meshy-rows">
      {steps}
      {state === 'notReady' && <span className="meshy-muted meshy-small">{t('gate.notReady')}</span>}
      {(state === 'unrigged' || state === 'failed') && (
        tooMany ? (
          <div className="meshy-alert meshy-small" role="alert">
            <IconWarningOutlineRegular size={14} />
            <span>{t('anim.tooMany', { count: count!.toLocaleString(), max: RIG_MAX_FACES.toLocaleString() })}</span>
            <Button variant="outline" size="sm" onClick={toRemesh}>{t('tool.remesh')}</Button>
          </div>
        ) : (
          <>
            {state === 'failed' && <div className="meshy-alert meshy-small" role="alert"><IconWarningOutlineRegular size={14} /><span>{t('anim.rigFailed')}</span></div>}
            {model.stats.textured === false && <span className="meshy-muted meshy-small">{t('anim.needsTexture')}</span>}
            {panel('rig', false)}
          </>
        )
      )}
      {state === 'rigging' && rig && (
        <div className="meshy-card meshy-rows">
          <TextShimmer active>{t('anim.rigging')}</TextShimmer>
          {rig.progress !== null && <span className="meshy-meter" style={{ width: '100%' }}><span style={{ width: `${Math.round(rig.progress * 100)}%` }} /></span>}
        </div>
      )}
      {state === 'hasRig' && rig && (
        <div className="meshy-card meshy-row meshy-small">
          <span>{t('anim.hasRig')}</span>
          <Button variant="primary" className="meshy-accent" size="sm" onClick={() => open(rig)}>{t('anim.openRig')}</Button>
        </div>
      )}
      {state === 'rigged' && (
        <>
          <span className="meshy-muted meshy-small">{t(model.stats.animations.length || model.operation === 'animate' ? 'anim.playHint' : 'anim.riggedHint')}</span>
          {tool === 'animate' ? panel('animate') : (
            <Button variant="primary" className="meshy-accent" size="sm" onClick={() => setTool('animate')}>{t('tool.animate')}</Button>
          )}
        </>
      )}
      {animations.length > 0 && (
        <>
          <span className="meshy-section-title">{t('anim.made', { count: animations.length })}</span>
          <div className="meshy-strip">{animations.map((a) => <Thumb key={a.id} t={t} sessionId={sessionId} asset={a} active={a.id === model.id} onPick={() => open(a)} />)}</div>
        </>
      )}
    </div>
  )
}

/** The `meshy_open_studio` card: the asset it points at and a button that opens the Studio. */
const autoOpened = new Set<string>()
export function OpenStudioCard(props: { t: T; phase: string; block?: any; callId: string; openFile(path: string): void }) {
  const { t, phase, block, callId, openFile } = props
  const meta = phase === 'result' && !block?.isError ? block?.meta : undefined
  const fresh = typeof block?.time === 'number' && Date.now() - block.time < 20_000
  useEffect(() => {
    // Open once for a call that just finished; a transcript replay never opens anything.
    if (meta?.assetId && fresh && !autoOpened.has(callId)) {
      autoOpened.add(callId)
      try { openFile(meta.projectFile) } catch { /* no right sidebar here */ }
    }
  }, [meta?.assetId, fresh, callId])
  if (phase !== 'result') return <div className="meshy-root meshy-toolrow meshy-muted"><Logo /><TextShimmer active>{t('card.opening')}</TextShimmer></div>
  if (!meta) return <div className="meshy-root meshy-toolrow meshy-muted"><Logo /><span>{t('card.failed')}</span></div>
  return (
    <div className="meshy-root meshy-card meshy-toolcard">
      <Logo />
      <div className="meshy-copy" style={{ flex: 1 }}>
        <span className="meshy-name">{t('studio.title')}</span>
        <span className="meshy-muted meshy-small">
          {meta.assetId ? [meta.label ?? opName(t, meta.operation ?? ''), meta.faces ? t('viewer.faces', { count: Number(meta.faces).toLocaleString() }) : null, t('card.assets', { count: meta.assets })].filter(Boolean).join(' · ') : t('studio.empty')}
        </span>
      </div>
      <Button variant="primary" className="meshy-accent" size="sm" onClick={() => openFile(meta.projectFile)}>{t('card.open')}</Button>
    </div>
  )
}

/** The `meshy_project` row: what the agent read or changed. */
export function ProjectRow({ t, phase, block }: { t: T; phase: string; block?: any }) {
  const meta = phase === 'result' && !block?.isError ? block?.meta : undefined
  const text = phase !== 'result' ? t('card.reading')
    : !meta ? t('card.failed')
    : meta.action === 'read' ? t('card.read', { assets: meta.assets, pins: meta.openPins })
    : t(`card.${meta.action}`)
  return <div className="meshy-root meshy-toolrow meshy-muted"><Logo /><span>{text}</span></div>
}
