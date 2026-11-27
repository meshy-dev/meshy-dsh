// `tool.call.toolview` renderers for the three Meshy tools. A tool's card data arrives in
// `result.meta` (presentation only). A `meshy` run that makes something (a task or saved files)
// gets a result card, kept live from the session's task stream while it runs in the background;
// any other command is one row showing the command and the CLI's JSON envelope.
import { useState } from 'react'
import {
  Button, DisclosureRow, StateDot, TextShimmer, Toast, Tooltip, writeClipboard,
  IconCheckOutlineRegular, IconCopyOutlineRegular, IconInspectOutlineRegular,
  IconRightUpOutlineRegular, IconWarningOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { insertPrompt, MeshyGlyph, openStudio, useTask, useWorkspaceImage } from './common.tsx'
import { detectLocale, type T } from './locales.ts'
import {
  actionPrompt, agoText, cardOf, displayPath, kindOf, phaseOf, titleOf,
  type ActionKind, type InputActions, type MeshyCard, type TaskPhase,
} from './workbench.ts'

export const MESHY_TOOL_NAMES = ['meshy', 'meshy_sign_in', 'meshy_preview_model'] as const

/** Tools whose result is one model or image the card shows (`meshy` decides per run). */
const ASSET_TOOLS: Record<string, 'model' | 'image'> = {
  meshy_preview_model: 'model',
}

type ToolBlockContent = { type: string; text?: string }
type StartedBlock = { callId?: string; argsRaw?: string }
type ResultBlock = {
  kind: string
  callId?: string
  call?: { argsRaw?: string }
  content?: readonly ToolBlockContent[]
  meta?: unknown
  isError?: boolean
  error?: { name?: string; code?: string; message?: string }
}

export type MeshyToolViewProps = {
  phase: 'preparing' | 'start' | 'result'
  callId: string
  toolName: string
  sessionId?: string
  cwd?: string
  block: StartedBlock | ResultBlock
  openFile?: (path: string) => void
  inspect?: () => void
  inputActions?: InputActions
  useInput?: <V>(select: (s: { draft: string; phase: string }) => V) => V
  t: T
}

const noop = (): void => undefined
const REMOTE_FRESH_MS = 60 * 3600_000

function argsOf(argsRaw: string | undefined): { prompt?: string; command?: string } {
  if (!argsRaw) return {}
  try {
    const parsed = JSON.parse(argsRaw) as Record<string, unknown>
    const argv = Array.isArray(parsed.args) ? parsed.args.filter((a): a is string => typeof a === 'string') : []
    const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : undefined
    return { prompt: title, command: argv.length ? argv.join(' ') : undefined }
  } catch {
    return {}
  }
}

/** The command a `meshy` card ran, without the leading `meshy`. */
function commandOf(card: MeshyCard | null, argsRaw?: string): string {
  const raw = card?.command ?? argsOf(argsRaw).command ?? ''
  return raw.replace(/^meshy\s+/, '')
}

/** The card data of a `meshy` run, as the result card reads it: its last task stands for the run. */
function runCard(card: MeshyCard | null): MeshyCard | null {
  if (!card) return null
  const task = card.tasks?.at(-1)
  const status = card.status === 'started' ? 'submitted' : card.status === 'failed' ? 'FAILED' : task?.status ?? 'SUCCEEDED'
  return {
    ...card,
    status,
    taskId: task?.taskId,
    resource: task?.resource,
    kind: task?.kind ?? (card.file && /\.(png|jpe?g|webp)$/i.test(card.file) ? 'image' : 'model'),
    thumbnail: task?.thumbnail ?? card.thumbnail,
  }
}

/** The CLI's envelope, indented for reading, and cut for the row. */
function envelopeBody(text: string): string {
  let out = text
  try {
    out = JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    // Not JSON: as it came.
  }
  return out.length > 6000 ? `${out.slice(0, 6000)}…` : out
}

function flattenContent(block: ResultBlock): string {
  const parts: string[] = []
  for (const item of block.content ?? []) {
    if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text)
  }
  if (parts.length === 0 && block.error) {
    parts.push(block.error.message ?? `${block.error.name ?? 'Error'}: ${block.error.code ?? ''}`.trim())
  }
  return parts.join('\n')
}

function firstLine(text: string): string {
  const idx = text.indexOf('\n')
  return (idx === -1 ? text : text.slice(0, idx)).trim()
}

function toolTitle(t: T, toolName: string): string {
  const key = `tool.name.${toolName}`
  const label = t(key)
  return label === key ? toolName : label
}

/** A card status (`submitted`, API statuses) as a lifecycle phase. */
function cardPhase(status: string | undefined): TaskPhase {
  const s = (status ?? '').toLowerCase()
  if (s === 'submitted' || s === 'pending' || s === 'in_progress' || s === 'queued' || s === 'running') return 'active'
  return phaseOf({ status: status ?? 'SUCCEEDED' })
}

function InspectButton({ inspect, t }: { inspect?: () => void; t: T }) {
  if (!inspect) return null
  return (
    <Tooltip label={t('tool.inspect')} side="top" portal>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t('tool.inspect')}
        icon={<IconInspectOutlineRegular size={14} />}
        onClick={inspect}
      />
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Model and image results (live while the generation runs in the background)
// ---------------------------------------------------------------------------
function AssetCard({
  toolName, label, callId, sessionId, cwd, card, argsRaw, settled, inspect, openFile, inputActions, draftEmpty, t,
}: {
  toolName: string
  label?: string
  callId: string
  sessionId?: string
  cwd?: string
  card: MeshyCard | null
  argsRaw?: string
  settled: boolean
  inspect?: () => void
  openFile?: (path: string) => void
  inputActions?: InputActions
  draftEmpty?: boolean
  t: T
}) {
  const locale = detectLocale(t)
  const live = useTask(sessionId, callId, card?.taskId)
  const [toast, setToast] = useState<string>()
  const args = argsOf(argsRaw)

  const kind = kindOf({ kind: card?.kind ?? live?.kind, resource: card?.resource ?? live?.resource }) ?? ASSET_TOOLS[toolName] ?? 'model'
  const phase: TaskPhase = live ? phaseOf(live) : settled ? cardPhase(card?.status) : 'active'
  const file = live?.localFile ?? card?.file ?? null
  const relFile = file ? displayPath(file, cwd) : ''
  const taskId = card?.taskId ?? live?.taskId ?? null
  const resource = card?.resource ?? live?.resource ?? null
  const title = live?.title || card?.title
    ? titleOf({ title: live?.title ?? card?.title }, 240, locale)
    : args.prompt
      ? titleOf({ prompt: args.prompt }, 240, locale)
      : toolTitle(t, toolName)
  const remote = live?.thumbnail ?? card?.thumbnail ?? null
  // The card shows the API's copy while it is served (files written before 0.4.0 could be
  // overwritten by a later task) and the saved file once it expires.
  const at = live?.finishedAt ?? live?.createdAt ?? live?.startedAt ?? null
  const remoteFresh = Boolean(remote) && (at === null || Date.now() - at < REMOTE_FRESH_MS)
  const localImage = useWorkspaceImage(sessionId, kind === 'image' && phase === 'done' && !remoteFresh ? file : null, remote)
  const thumb = kind === 'image' ? localImage : remote
  const pct = typeof live?.progress === 'number' ? Math.max(0, Math.min(100, Math.round(live.progress))) : null
  const credits = live?.credits ?? card?.credits
  const isPreview = card?.stage === 'preview' || live?.stage === 'preview'
  const error = live?.error ?? card?.error ?? null

  const target = taskId || file ? { taskId, resource, file } : null
  const view = () => {
    if (openStudio(sessionId, target)) return
    if (file) openFile?.(file)
  }
  const next: ActionKind | null = phase !== 'done' ? null : kind === 'image' ? 'imageTo3d' : isPreview && taskId ? 'refine' : null
  const runNext = async () => {
    if (!next) return
    const outcome = await insertPrompt(
      actionPrompt(next, { taskId, resource, file: relFile || null, title }, locale),
      { inputActions, draftEmpty },
    )
    if (outcome === 'composer') setToast(t('sidebar.composerAdded'))
    else if (outcome === 'copied') setToast(t('sidebar.composerCopied'))
  }

  const status =
    phase === 'active'
      ? pct
        ? t('studio.generatingPct', { pct })
        : settled ? t('tool.background') : t('tool.running')
      : phase === 'failed'
        ? error ? firstLine(error) : t('tool.failed')
        : phase === 'canceled'
          ? t('studio.canceled')
          : null

  const meta = [
    label ?? toolTitle(t, toolName),
    typeof credits === 'number' && credits > 0
      ? t('tool.creditsSpent', { count: credits })
      : phase === 'active' && typeof card?.estimate === 'number' ? t('tool.estimate', { count: card.estimate }) : null,
    phase === 'done' && card?.format ? card.format.toUpperCase() : null,
    phase === 'done' && live?.finishedAt ? agoText(live.finishedAt, Date.now(), locale) : null,
  ].filter(Boolean) as string[]

  return (
    <div className="meshy-root meshy-tool" data-tool={toolName} data-phase={phase}>
      <div className="meshy-tool-card">
        <button
          type="button"
          className="meshy-tool-thumb"
          data-clickable={target ? '' : undefined}
          disabled={!target}
          aria-label={t('tool.view')}
          onClick={view}
        >
          {thumb ? <img src={thumb} alt="" loading="lazy" draggable={false} /> : <MeshyGlyph size={22} />}
        </button>
        <div className="meshy-tool-body">
          <span className="meshy-tool-title" title={title}>
            {phase === 'active' ? <TextShimmer active>{title}</TextShimmer> : title}
          </span>
          <span className="meshy-meta">
            {meta.map((m) => <span key={m}>{m}</span>)}
          </span>
          {status && (
            <span className="meshy-tool-status" role={phase === 'failed' ? 'alert' : undefined}>
              {phase === 'active' ? (
                <>
                  <span className="meshy-progress" data-indeterminate={pct ? undefined : ''}>
                    <span style={{ width: `${pct ?? 0}%` }} />
                  </span>
                  <span>{status}</span>
                </>
              ) : (
                <>
                  <IconWarningOutlineRegular size={13} />
                  <span className="meshy-ellipsis">{status}</span>
                </>
              )}
            </span>
          )}
          <span className="meshy-tool-actions">
            {target && (phase === 'done' || phase === 'active') && (
              <Button variant="outline" size="sm" onClick={view}>
                {t('tool.view')}
              </Button>
            )}
            {next && (
              <Button variant="outline" size="sm" onClick={() => { void runNext() }}>
                {t(`action.${next}`)}
              </Button>
            )}
            <span className="meshy-spacer" />
            <InspectButton inspect={inspect} t={t} />
          </span>
        </div>
      </div>
      {toast && <Toast text={toast} tone="success" onDone={() => setToast(undefined)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sign-in, utility and error rows
// ---------------------------------------------------------------------------
function SignInCard({ card, inspect, t }: { card: MeshyCard | null; inspect?: () => void; t: T }) {
  const [copied, setCopied] = useState(false)
  const copyCode = async () => {
    if (card?.userCode && (await writeClipboard(card.userCode))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }
  const mins = typeof card?.expiresIn === 'number' ? Math.max(1, Math.round(card.expiresIn / 60)) : null
  if (card?.authenticated && !card.userCode) {
    return <UtilityRow toolName="meshy_sign_in" summary={<span className="meshy-small meshy-muted">{t('signedIn')}{card.accountName ? ` · ${card.accountName}` : ''}</span>} inspect={inspect} t={t} />
  }
  return (
    <div className="meshy-root meshy-tool" data-tool="meshy_sign_in">
      <div className="meshy-tool-card">
        <span className="meshy-tool-thumb"><MeshyGlyph size={22} /></span>
        <div className="meshy-tool-body">
          <span className="meshy-tool-title">{t('tool.name.meshy_sign_in')}</span>
          {mins !== null && <span className="meshy-meta"><span>{t('tool.expiresIn', { minutes: mins })}</span></span>}
          <span className="meshy-tool-actions">
            {card?.userCode && (
              <span className="meshy-code">
                <code>{card.userCode}</code>
                <Tooltip label={copied ? t('copied') : t('copy')} side="top" portal>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('copy')}
                    icon={copied ? <IconCheckOutlineRegular size={13} /> : <IconCopyOutlineRegular size={13} />}
                    onClick={() => { void copyCode() }}
                  />
                </Tooltip>
              </span>
            )}
            {card?.verificationUrl?.startsWith('https://') && (
              <a className="meshy-link meshy-link-sm meshy-accent" href={card.verificationUrl} target="_blank" rel="noreferrer">
                {t('signIn.open')}
                <IconRightUpOutlineRegular size={12} />
              </a>
            )}
            <span className="meshy-spacer" />
            <InspectButton inspect={inspect} t={t} />
          </span>
        </div>
      </div>
    </div>
  )
}

function UtilityRow({ toolName, summary, children, inspect, t }: {
  toolName: string
  summary: React.ReactNode
  children?: React.ReactNode
  inspect?: () => void
  t: T
}) {
  const [open, setOpen] = useState(false)
  const expandable = Boolean(children || inspect)
  return (
    <div className="meshy-root meshy-tool" data-tool={toolName}>
      <DisclosureRow
        title={toolTitle(t, toolName)}
        icon={<MeshyGlyph size={14} />}
        open={open && expandable}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setOpen((v) => !v)}
        collapsedContent={<span className="meshy-summary">{summary}</span>}
      >
        {children}
        {inspect && (
          <Button variant="ghost" size="sm" icon={<IconInspectOutlineRegular size={13} />} onClick={inspect}>
            {t('tool.inspect')}
          </Button>
        )}
      </DisclosureRow>
    </div>
  )
}

/** A `meshy` command that made nothing to show: the command, and the CLI's envelope when expanded. */
function CommandRow({ card, argsRaw, body, inspect, t }: {
  card: MeshyCard | null
  argsRaw?: string
  body: string
  inspect?: () => void
  t: T
}) {
  const failed = card?.status === 'failed'
  const summary = (
    <span className="meshy-inline meshy-small">
      {failed && <IconWarningOutlineRegular size={13} className="meshy-err" />}
      <code className="meshy-ellipsis">{commandOf(card, argsRaw)}</code>
      {failed && card?.error && <span className="meshy-muted meshy-ellipsis">{card.error}</span>}
    </span>
  )
  return (
    <UtilityRow toolName="meshy" summary={summary} inspect={inspect} t={t}>
      {body && <pre className="meshy-tool-pre">{envelopeBody(body)}</pre>}
    </UtilityRow>
  )
}

function ErrorRow({ toolName, state, body, inspect, t }: {
  toolName: string
  state: 'error' | 'stopped'
  body: string
  inspect?: () => void
  t: T
}) {
  const [open, setOpen] = useState(false)
  // The raw API text stays in the expanded body; the row itself says what happened.
  const summary = state === 'stopped' ? t('tool.stopped') : t('tool.failed')
  const expandable = Boolean(body || inspect)
  return (
    <div className="meshy-root meshy-tool" data-tool={toolName} data-state={state}>
      <DisclosureRow
        title={toolTitle(t, toolName)}
        icon={<IconWarningOutlineRegular size={14} className={state === 'error' ? 'meshy-err' : undefined} />}
        open={open && expandable}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => setOpen((v) => !v)}
        collapsedContent={<span className="meshy-summary meshy-ellipsis">{summary}</span>}
      >
        {body && <pre className="meshy-tool-pre">{body}</pre>}
        {inspect && (
          <Button variant="ghost" size="sm" icon={<IconInspectOutlineRegular size={13} />} onClick={inspect}>
            {t('tool.inspect')}
          </Button>
        )}
      </DisclosureRow>
    </div>
  )
}

/** The entry registered for every `meshy_*` `tool.call.toolview` key. */
export function MeshyToolView(props: MeshyToolViewProps) {
  const { phase, toolName, callId, sessionId, cwd, block, openFile, inspect, inputActions, t } = props
  const draftEmpty = props.useInput ? props.useInput((s) => !s.draft.trim()) : undefined
  // Hooks run on every render, whatever the card turns out to be.
  const live = useTask(sessionId, toolName === 'meshy' ? callId : null, null)

  if (phase === 'preparing') {
    return (
      <div className="meshy-root meshy-tool" data-tool={toolName}>
        <DisclosureRow
          title={toolTitle(t, toolName)}
          icon={<MeshyGlyph size={14} />}
          open={false}
          expandable={false}
          onToggle={noop}
          running
          collapsedContent={<span className="meshy-summary"><TextShimmer active>{t('tool.preparing')}</TextShimmer></span>}
        />
      </div>
    )
  }

  const settled = phase === 'result' && 'kind' in block
  const result = settled ? (block as ResultBlock) : undefined
  const argsRaw = result?.call?.argsRaw ?? (block as StartedBlock).argsRaw
  const raw = result ? flattenContent(result) : ''
  const { card, body } = result ? cardOf(result.meta, raw) : { card: null, body: '' }
  const state = result?.error?.code === 'interrupted' ? 'stopped' : result?.isError ? 'error' : 'ok'

  if (state !== 'ok') return <ErrorRow toolName={toolName} state={state} body={body || raw} inspect={inspect} t={t} />

  // A `meshy` run gets the result card once it has made, or is making, something.
  const run = toolName === 'meshy' ? runCard(card) : null
  const makes = toolName === 'meshy'
    && Boolean(live || run?.status === 'submitted' || run?.taskId || (card?.files?.length ?? 0) > 0)
  if (ASSET_TOOLS[toolName] || makes) {
    return (
      <AssetCard
        toolName={toolName}
        label={toolName === 'meshy' ? commandOf(card, argsRaw).split(' ').slice(0, 2).join(' ') : undefined}
        callId={callId}
        sessionId={sessionId}
        cwd={cwd}
        card={run ?? card}
        argsRaw={argsRaw}
        settled={settled}
        inspect={inspect}
        openFile={openFile}
        inputActions={inputActions}
        draftEmpty={draftEmpty}
        t={t}
      />
    )
  }
  if (!settled) {
    return (
      <div className="meshy-root meshy-tool" data-tool={toolName}>
        <DisclosureRow
          title={toolTitle(t, toolName)}
          icon={<MeshyGlyph size={14} />}
          open={false}
          expandable={false}
          onToggle={noop}
          running
          collapsedContent={<span className="meshy-summary meshy-inline"><StateDot state="ongoing" size={10} />{t('tool.running')}</span>}
        />
      </div>
    )
  }
  if (toolName === 'meshy_sign_in') return <SignInCard card={card} inspect={inspect} t={t} />
  return <CommandRow card={card} argsRaw={argsRaw} body={body || raw} inspect={inspect} t={t} />
}
