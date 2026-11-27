// Native Cordis tools for Meshy. `meshy` runs the bundled Meshy CLI with the agent's own
// arguments, unchanged: a command that spends credits asks the user first (with the agent's
// estimate and the current balance) and runs as a dsh background job, and every command's chat
// card and Studio row come from the CLI's own JSON envelope. `meshy_sign_in` signs the user in;
// `meshy_preview_model` opens a file or task in the right-sidebar Meshy Studio. Nothing here knows
// a CLI flag, model or price: which commands spend credits comes from `meshy resources`.
import { realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import {
  assetUrl,
  kindOfResource,
  outputKind,
  readAssetIndex,
  recordAsset,
  resolveWorkspaceFile,
  sessionStateDir,
  TASK_ID,
  viewOf,
} from './tasks.js'

const REGIONS = new Set(['global', 'cn'])
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MODEL_EXTS = new Set(['.glb', '.3mf'])
const PREVIEW_EXTS = new Set([...MODEL_EXTS, ...IMAGE_EXTS])

const MAX_ARGS = 200
const MAX_ARG = 8192
/** A paid or watching command: the CLI's own wait gives up first (600s a step by default). */
const LONG_TIMEOUT_MS = 3 * 3600_000
const SHORT_TIMEOUT_MS = 10 * 60_000
const JOB_OUTPUT_LIMIT = 16384
const JOB_LABEL_MAX = 120
/** What the agent reads back: the CLI's envelope, compact, cut here. */
const RESULT_TEXT_MAX = 16_000
/** Abort reason used when a job started but the tool falls back to running inside the call. */
const FALLBACK = 'meshy-dsh: fall back to running in the tool call'

/** Options that would replace the user's Meshy sign-in, send it elsewhere, or print it. */
const REFUSED = /^--(?:api-key|api-key-file|base-url[a-z0-9-]*|show-token)$/
/** Options the plugin sets itself on every run. */
const OWNED_WITH_VALUE = new Set(['--format', '--workspace'])
const OWNED_FLAGS = new Set(['--json', '--no-update-check'])

const short = (value, max = 64) => {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * The chat card's data (`result.meta`): Meshy-hosted thumbnails only, short text, and no null or
 * undefined fields. Never part of what the model reads.
 */
function cardMeta(card) {
  const clean = {}
  for (const [k, v] of Object.entries(card)) {
    if (v === undefined || v === null) continue
    if (k === 'thumbnail') {
      const safe = assetUrl(v)
      if (safe) clean.thumbnail = safe
    } else if (k === 'title' || k === 'prompt') {
      const s = short(v, 72)
      if (s) clean[k] = s
    } else {
      clean[k] = v
    }
  }
  return clean
}

function abortError(message) {
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

const isAbort = (err, signal) => err?.name === 'AbortError' || Boolean(signal?.aborted)

function getService(ctx, name) {
  if (!ctx || typeof ctx !== 'object') return undefined
  if (typeof ctx.get === 'function') return ctx.get(name)
  return ctx[name]
}

function sessionInfo(exec) {
  const header = exec?.agent?.session?.header
  const sessionId = typeof header?.id === 'string' && header.id ? header.id : null
  const workspace = typeof header?.cwd === 'string' && header.cwd ? header.cwd : null
  return { sessionId, workspace }
}

function interpretApproval(outcome) {
  if (typeof outcome === 'string') {
    return { approved: outcome === 'allowed-once' || outcome === 'allowed', code: outcome }
  }
  if (outcome && typeof outcome === 'object') {
    if (outcome.allowed === true) return { approved: true, code: 'allowed-once' }
    const tag = outcome.outcome ?? outcome.decision ?? outcome.kind ?? outcome.status
    if (tag === 'allowed-once' || tag === 'allowed') return { approved: true, code: tag }
    return { approved: false, code: typeof tag === 'string' ? tag : 'rejected' }
  }
  return { approved: false, code: 'unavailable' }
}

/**
 * The agent's argv, checked and without the options the plugin owns: it starts with the command
 * (a leading `meshy` is dropped), never replaces or prints the sign-in, and its output format and
 * workspace are set by the plugin. Everything else passes through as given.
 */
export function prepareArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error('args must be the Meshy CLI arguments as a list of strings, starting with the command (e.g. ["balance"]).')
  }
  if (args.length > MAX_ARGS) throw new Error(`args takes at most ${MAX_ARGS} items.`)
  const argv = args.map((a, i) => {
    if (typeof a !== 'string' || a.length > MAX_ARG || a.includes('\0')) throw new Error(`args[${i}] must be a string (at most ${MAX_ARG} characters).`)
    return a
  })
  if (argv[0] === 'meshy' || argv[0] === 'meshy-cli') argv.shift()
  if (!argv[0] || argv[0].startsWith('-')) {
    throw new Error('args must start with the command (e.g. ["image-to-3d", "create", ...]); put options after it.')
  }
  if (argv[0] === 'auth' && argv[1] !== 'status') {
    throw new Error('The plugin keeps the Meshy sign-in: call meshy_sign_in instead of `meshy auth`. Only `auth status` runs here.')
  }
  if (argv[0] === 'view') {
    throw new Error('The Meshy Studio is the 3D viewer here: call meshy_preview_model to open a workspace model in it. `meshy view` does not run here.')
  }
  const kept = []
  let literal = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (literal) { kept.push(a); continue }
    if (a === '--') { literal = true; kept.push(a); continue }
    const flag = a.startsWith('--') ? a.split('=', 1)[0] : a
    if (REFUSED.test(flag)) throw new Error(`${flag} is not allowed here: the plugin runs the Meshy CLI with the user's own sign-in.`)
    if (OWNED_WITH_VALUE.has(flag)) {
      if (!a.includes('=')) i++
      continue
    }
    if (OWNED_FLAGS.has(a)) continue
    kept.push(a)
  }
  return kept
}

/** `meshy make 'a red fox'`: how the command reads in the approval and card. */
export function displayOf(argv) {
  const quote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)
  return ['meshy', ...argv.map(quote)].join(' ')
}

/**
 * The tasks a command ran, by id, from the places the CLI's envelope reports them: `make`'s
 * `executed` steps and `submitted` step, a create's `submission` (or a `--async` create's
 * `task_id`), and the `task` it followed. A `list` names other tasks in `items` and is left out.
 * `resource` is the command's own task resource, for the records that do not carry one.
 */
export function collectTasks(result, resource = null) {
  const found = new Map()
  const add = (v, fallback = null) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.task_id !== 'string' || !TASK_ID.test(v.task_id)) return
    const prior = found.get(v.task_id)
    found.set(v.task_id, { ...(fallback ? { resource: fallback } : {}), ...prior, ...v })
  }
  if (!result || typeof result !== 'object') return []
  for (const step of Array.isArray(result.executed) ? result.executed.slice(0, 20) : []) add(step)
  add(result.submitted)
  add(result.submission, resource)
  if (typeof result.task_id === 'string') add({ task_id: result.task_id }, resource)
  add(result.task, resource)
  return [...found.values()]
}

/** The files the CLI wrote (`downloads.files` with status written), wherever its result puts them. */
export function collectFiles(result) {
  const paths = []
  const walk = (v, depth) => {
    if (!v || typeof v !== 'object' || depth > 6) return
    if (Array.isArray(v)) {
      for (const x of v.slice(0, 50)) walk(x, depth + 1)
      return
    }
    if (Array.isArray(v.files) && ('metadata_path' in v || 'state' in v)) {
      for (const f of v.files) {
        if (f?.status === 'written' && typeof f.path === 'string' && !paths.includes(f.path)) paths.push(f.path)
      }
    }
    for (const [k, x] of Object.entries(v)) {
      if (k !== 'raw' && k !== 'response' && k !== 'files') walk(x, depth + 1)
    }
  }
  walk(result, 0)
  return paths
}

/** Workspace-relative POSIX paths of the files inside the workspace; others are left out. */
async function inWorkspace(workspace, paths) {
  const roots = [workspace]
  try {
    const real = await realpath(workspace)
    if (real !== workspace) roots.unshift(real)
  } catch {
    // The workspace path as given.
  }
  const out = []
  for (const p of paths) {
    for (const root of roots) {
      const rel = relative(root, resolve(root, p))
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
        const posix = rel.split(sep).join('/')
        if (!out.includes(posix)) out.push(posix)
        break
      }
    }
  }
  return out
}

const kindOfFile = (file) => {
  const ext = extname(file).toLowerCase()
  return MODEL_EXTS.has(ext) ? 'model' : IMAGE_EXTS.has(ext) ? 'image' : 'file'
}

/** The compact envelope the agent reads, cut at RESULT_TEXT_MAX. */
function envelopeText(env) {
  let text
  try {
    const { timedOut: _t, ...body } = env ?? {}
    text = JSON.stringify(body)
  } catch {
    text = String(env?.error?.message ?? 'the Meshy CLI printed no result')
  }
  return text.length > RESULT_TEXT_MAX ? `${text.slice(0, RESULT_TEXT_MAX)}… (cut; ${text.length} characters)` : text
}

/** The name the asset index has for the first task id among `argv` (a `wait`/`get` on it). */
async function knownTitle(workspace, argv) {
  const ids = argv
    .map((a) => (a.startsWith('--') && a.includes('=') ? a.slice(a.indexOf('=') + 1) : a))
    .filter((a) => TASK_ID.test(a) && /\d/.test(a) && a.includes('-'))
  if (ids.length === 0) return null
  try {
    const index = await readAssetIndex(workspace)
    for (const id of ids) if (index[id]?.title) return index[id].title
  } catch {
    // No name: the call shows the agent's label.
  }
  return null
}

/**
 * Build the native Cordis tools for `meshy-dsh`.
 * `cli(argv, opts)` runs the bundled CLI and resolves to its envelope; `catalog` is the CLI's
 * resource listing (`createCatalog`).
 */
export function createTools({ ctx, cli, catalog, signIn, events }) {
  /** One `task` SSE event for a task a `meshy` call is running. */
  function emitTask(run, view, extra = {}) {
    const title = short(run.taskTitle ?? view?.name ?? view?.prompt, 72)
    events.emit({
      type: 'task',
      sessionId: run.sessionId,
      workspace: run.workspace,
      callId: run.callId,
      jobId: run.jobId ?? null,
      resource: view.resource ?? null,
      stage: null,
      taskId: view.taskId,
      parentTaskId: view.parentTaskId ?? null,
      kind: view.kind,
      title,
      name: title,
      status: view.status ?? 'PENDING',
      progress: view.progress ?? 0,
      thumbnail: view.thumbnail ?? null,
      localFile: extra.localFile ?? null,
      ...(Array.isArray(extra.files) ? { files: extra.files } : {}),
      credits: view.credits ?? null,
      error: view.error ?? null,
    })
  }

  /** The CLI's tasks as the Studio shows them: status, progress, thumbnail, credits. */
  function viewsOf(run, result) {
    return collectTasks(result, run.resource).map((t) => {
      const v = viewOf(t) ?? {}
      const resource = typeof t.resource === 'string' ? t.resource : null
      return { ...v, taskId: t.task_id, resource, kind: outputKind(v) }
    })
  }

  /**
   * A task seen for the first time: index it so its Studio row knows the call that ran it. Only
   * the call that submitted a task names it; a `wait` or `get` keeps the name it has.
   */
  async function remember(run, view) {
    const before = run.seen.get(view.taskId)
    run.seen.set(view.taskId, view)
    // Seen before: only what it produced is new, once it has finished.
    if (before && ((before.kind && before.kind !== 'none') || !view.kind || view.kind === before.kind)) return
    try {
      await recordAsset(run.workspace, view.taskId, before ? { kind: view.kind } : {
        resource: view.resource,
        kind: view.kind,
        title: run.creates ? run.taskTitle ?? short(view.name ?? view.prompt, 72) : null,
        // The Studio row links to the call that submitted the task, never a later wait on it.
        ...(run.creates ? { callId: run.callId, ...(run.jobId ? { jobId: run.jobId } : {}) } : {}),
      })
    } catch {
      // The index is a convenience; the journal still lists the task.
    }
  }

  /** One streamed CLI event: update the card and Studio rows of the tasks it names. */
  function observe(run, envelope, job) {
    for (const view of viewsOf(run, envelope?.result)) {
      const sig = `${view.status}|${view.progress}|${view.thumbnail ?? ''}`
      if (run.lastSig.get(view.taskId) === sig) continue
      run.lastSig.set(view.taskId, sig)
      void remember(run, view)
      emitTask(run, view)
      if (job) {
        const pct = Number.isFinite(view.progress) ? Math.round(view.progress) : 0
        try {
          job.updateProgress?.(`${view.status ?? 'PENDING'} ${pct}%`)
        } catch {
          // Progress is best-effort.
        }
      }
    }
  }

  /** Run the CLI for one call. Resolves to its envelope; rejects only on abort or a spawn failure. */
  function execute(run, signal, job) {
    return cli(run.argv, {
      cwd: run.workspace,
      workspace: run.workspace,
      extraEnv: { DSH_MESHY_STATE_DIR: sessionStateDir(run.workspace, run.sessionId) },
      timeoutMs: run.long ? LONG_TIMEOUT_MS : SHORT_TIMEOUT_MS,
      signal,
      stream: run.long,
      onEvent: (e) => observe(run, e, job),
      onStderrLine: job ? (line) => {
        try {
          job.append?.(`${line}\n`)
        } catch {
          // job_output is best-effort.
        }
      } : undefined,
    })
  }

  /** After the CLI exits: final rows, index and open the saved files, and the call's result. */
  async function settle(run, env) {
    const views = viewsOf(run, env?.result)
    const files = await inWorkspace(run.workspace, collectFiles(env?.result))
    const primary = files.find((f) => kindOfFile(f) === 'model') ?? files.find((f) => kindOfFile(f) === 'image') ?? files[0] ?? null
    // Saved files belong to the last task the command reports (make: the final stage).
    const owner = [...views].reverse().find((v) => v.status === 'SUCCEEDED') ?? views.at(-1) ?? null
    for (const view of views) {
      await remember(run, view)
      emitTask(run, view, view === owner ? { localFile: primary, files } : {})
    }
    const route = { sessionId: run.sessionId, workspace: run.workspace }
    let savedTitle = null
    if (files.length > 0) {
      const kind = primary ? kindOfFile(primary) : 'file'
      let title = run.taskTitle ?? short(owner?.name ?? owner?.prompt, 72) ?? null
      if (owner) {
        try {
          const saved = await recordAsset(run.workspace, owner.taskId, {
            resource: owner.resource,
            kind: owner.kind ?? (kind === 'model' || kind === 'image' ? kind : null),
            title: run.creates ? title : null,
            file: primary,
            files,
          })
          title = saved?.title ?? title
        } catch {
          // The files are on disk either way.
        }
      }
      savedTitle = title
      events.emit({ type: 'asset', ...route, taskId: owner?.taskId ?? null, resource: owner?.resource ?? null, kind, file: primary, files, title })
      if (primary && kind === 'model') {
        events.emit({ type: 'model', ...route, file: primary, resource: owner?.resource ?? null, taskId: owner?.taskId ?? null })
        events.emit({ type: 'open', ...route, kind: 'model', target: { file: primary } })
      } else if (primary && kind === 'image') {
        events.emit({ type: 'open', ...route, kind: 'image', target: { file: primary } })
      }
    }
    const byId = new Map(views.map((v) => [v.taskId, v.credits]))
    const spent = [...byId.values()].filter((c) => typeof c === 'number')
    return {
      status: env?.ok ? 'ok' : 'failed',
      command: run.display,
      ok: env?.ok === true,
      tasks: views.slice(0, 8).map((v) => ({
        taskId: v.taskId,
        resource: v.resource,
        kind: v.kind,
        status: v.status ?? null,
        progress: v.progress ?? null,
        thumbnail: v.thumbnail ?? null,
        credits: v.credits ?? null,
      })),
      files,
      file: primary,
      credits: spent.length > 0 ? spent.reduce((a, b) => a + b, 0) : null,
      title: savedTitle ?? null,
      ...(run.paid ? { paid: true, estimate: run.estimate } : {}),
      error: env?.ok ? null : (short(env?.error?.message, 240) ?? 'the Meshy CLI failed'),
      envelope: env,
    }
  }

  /** The background job body: run the CLI, then settle. `done` never rejects. */
  function runAsJob(run, job) {
    const controller = new AbortController()
    if (!run.jobId && typeof job?.id === 'string') run.jobId = job.id
    const done = (async () => {
      let env
      try {
        env = await execute(run, controller.signal, job)
      } catch (err) {
        if (controller.signal.aborted) {
          for (const view of run.seen.values()) emitTask(run, { ...view, error: 'no longer watched here; the task keeps running on Meshy' })
          const ids = [...run.seen.keys()]
          return {
            status: 'killed',
            detail: ids.length > 0
              ? `Stopped the Meshy CLI. Task ${ids.join(', ')} keeps running on Meshy; follow it with the resource's \`wait\` command (no new task, no credits).`
              : 'Stopped the Meshy CLI before it reported a task.',
          }
        }
        return { status: 'failed', detail: String(err?.message ?? err) }
      }
      const value = await settle(run, env).catch((err) => ({ ok: false, envelope: env, error: String(err?.message ?? err) }))
      const text = envelopeText(value.envelope ?? env)
      return value.ok ? { status: 'completed', result: text } : { status: 'failed', detail: text }
    })()
    return { cancel: (reason) => controller.abort(reason ?? 'killed'), done }
  }

  /** Start the background job; null when dsh cannot run one (the call then runs inline). */
  async function startJob(jobs, run, exec) {
    let hooks = null
    try {
      const id = await jobs.start({
        kind: 'meshy',
        label: short(run.taskTitle ? `${run.taskTitle} · ${run.display}` : run.display, JOB_LABEL_MAX) ?? 'meshy',
        owner: run.sessionId,
        ...(run.callId
          ? { toolCall: { callId: run.callId, rootCallId: typeof exec?.rootCallId === 'string' && exec.rootCallId ? exec.rootCallId : run.callId } }
          : {}),
        outputLimitBytes: JOB_OUTPUT_LIMIT,
        run(job) {
          hooks = runAsJob(run, job)
          return hooks
        },
      })
      const jobId = typeof id === 'string' && id ? id : typeof id === 'number' ? String(id) : run.jobId
      if (!jobId) throw new Error('the job registry returned no id')
      run.jobId = jobId
      return jobId
    } catch {
      hooks?.cancel(FALLBACK)
      run.jobId = null
      return null
    }
  }

  async function readBalance(signal) {
    try {
      const env = await cli(['balance'], { timeoutMs: 20_000, signal })
      const value = env?.ok ? env.result?.balance : null
      return typeof value === 'number' && Number.isFinite(value) ? value : null
    } catch (err) {
      if (isAbort(err, signal)) throw err
      return null
    }
  }

  /** The approval text, in both languages: the command, the agent's estimate, the balance. */
  function approvalText({ display, estimate, source, balance, requester }) {
    const en = [`Run ${display}${requester ? ` (requested by ${requester})` : ''}.`]
    const zh = [`运行 ${display}${requester ? `（由 ${requester} 发起）` : ''}。`]
    if (typeof estimate === 'number') {
      en.push(`Estimated ~${estimate} credits${source ? ` (${source})` : ''}.`)
      zh.push(`预计约 ${estimate} 积分${source ? `（${source}）` : ''}。`)
    } else {
      en.push('Price unknown; the actual charge applies.')
      zh.push('价格未知，以实际扣费为准。')
    }
    if (typeof balance === 'number') {
      en.push(`Balance: ${balance} credits.`)
      zh.push(`当前余额 ${balance} 积分。`)
    }
    return { reason: en.join(' '), displayReason: { en: en.join(' '), zh: zh.join('') } }
  }

  /** Fail-closed approval for a command that spends credits. */
  async function approve(exec, { display, estimate, source }) {
    const approval = getService(ctx, 'approval')
    const refused = (what) => `${what}; ${display} did not run (0 credits spent).`
    if (!approval || typeof approval.request !== 'function') throw new Error(refused('Approval is unavailable in this session'))
    const balance = await readBalance(exec?.signal)
    const { reason, displayReason } = approvalText({ display, estimate, source, balance, requester: exec?.requester })
    let res
    try {
      res = await approval.request({ agent: exec?.agent, toolName: 'meshy', callId: exec?.callId, reason, displayReason, signal: exec?.signal })
    } catch (err) {
      if (isAbort(err, exec?.signal)) throw err
      throw new Error(refused(`Approval failed (${err?.message ?? err})`))
    }
    const decision = interpretApproval(res)
    if (decision.approved) return
    if (decision.code === 'cancelled') throw abortError(refused('Approval cancelled'))
    if (decision.code === 'unavailable') throw new Error(refused('Approval is unavailable in this session'))
    throw new Error(refused('The user declined'))
  }

  // 1. meshy: the bundled CLI, arguments passed through
  const meshyTool = {
    name: 'meshy',
    description:
      'Run the Meshy CLI that this plugin ships, signed in as the user: pass its arguments exactly as ' +
      'the Meshy skills document them, one item per argument and without the leading `meshy` (e.g. ' +
      '["make", "a red fox"]). Use this tool instead of running meshy in the shell. The plugin adds the ' +
      'JSON output and the workspace limit itself, runs in the session workspace (relative paths ' +
      'resolve there), and returns the CLI\'s JSON envelope. A command that spends credits (`make`, ' +
      '`create` on a task resource, a non-GET `api`) asks the user first: pass `estimated_credits` ' +
      'and `estimate_source` from `make --dry-run` or the published price list when you have one, ' +
      'never a guess. Such a command, and `wait`/`stream`, runs as a background job: a notice with ' +
      'the envelope arrives when it ends; do not poll it or run it again. A command that submits a ' +
      'task follows it to its result in that job, so one call carries it from submission to its ' +
      'files: do not submit it and then wait on it in a second call. If the CLI\'s wait times ' +
      'out the task keeps running on Meshy: resume with the `wait` command the envelope names (no new ' +
      'task). Saved .glb and .3mf models and images open in the Meshy Studio on their own.',
    parameters: {
      type: 'object',
      properties: {
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'The Meshy CLI arguments after `meshy`, starting with the command, one item per argument.',
        },
        estimated_credits: {
          type: 'number',
          description: 'For a command that spends credits: the estimate shown to the user, from `make --dry-run` or the published price list. Omit when unknown.',
        },
        estimate_source: {
          type: 'string',
          description: 'Where estimated_credits comes from (e.g. "make --dry-run" or "Meshy pricing page").',
        },
        title: {
          type: 'string',
          description: 'For a command that submits a task: the name of what it makes, a few words in the user\'s language (e.g. "oak chest"), shown in the job list and the Meshy Studio. Name the thing, not the step ("oak chest", not "generating the chest"). A command on an existing task keeps that task\'s name, so omit it there.',
        },
      },
      required: ['args'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, v) => [{
        type: 'text',
        text: v.status === 'started'
          ? `${v.command} is running as background job ${v.jobId}. A notice with the CLI's result arrives when it ends; do not poll it or run it again.`
          : envelopeText(v.envelope),
      }],
      presentationMeta: (_args, v) => cardMeta({
        tool: 'meshy',
        status: v.status,
        command: short(v.command, 240),
        title: v.title,
        jobId: v.jobId,
        paid: v.paid,
        estimate: v.estimate,
        credits: v.credits,
        tasks: Array.isArray(v.tasks) ? v.tasks.map((t) => cardMeta(t)) : undefined,
        file: v.file,
        files: Array.isArray(v.files) ? v.files.slice(0, 12) : undefined,
        error: v.error,
      }),
    },
    async execute(args, exec) {
      const argv = prepareArgs(args?.args)
      const { sessionId, workspace } = sessionInfo(exec)
      if (!workspace) throw new Error('The Meshy CLI runs in the session workspace, and this session has none.')
      const estimate = typeof args?.estimated_credits === 'number' && Number.isFinite(args.estimated_credits) && args.estimated_credits >= 0
        ? Math.round(args.estimated_credits * 100) / 100
        : null
      const source = short(args?.estimate_source, 120)
      const kind = await catalog.classify(argv, { signal: exec?.signal })
      const display = displayOf(argv)
      if (kind.paid) await approve(exec, { display, estimate, source })
      if (exec?.signal?.aborted) throw abortError(`Aborted before ${display} ran (0 credits spent).`)

      // A call that submits tasks names them; any other call shows the name its task already has.
      const creates = argv[0] === 'make' || kind.verb === 'create'
      const label = short(args?.title, 72)
      const run = {
        sessionId,
        workspace,
        callId: typeof exec?.callId === 'string' ? exec.callId : null,
        jobId: null,
        argv,
        display,
        creates,
        // The agent's title names what a create makes; a call on an existing task shows its name.
        taskTitle: creates ? label : await knownTitle(workspace, argv),
        resource: kind.resource ?? null,
        long: kind.long,
        paid: kind.paid,
        estimate,
        seen: new Map(),
        lastSig: new Map(),
      }

      const jobs = exec?.meshyWait === true ? null : getService(ctx, 'jobs')
      if (run.long && sessionId && typeof jobs?.start === 'function') {
        const jobId = await startJob(jobs, run, exec)
        if (jobId) {
          return {
            status: 'started',
            command: display,
            jobId,
            title: run.taskTitle,
            ...(run.paid ? { paid: true, estimate } : {}),
          }
        }
      }

      let env
      try {
        env = await execute(run, exec?.signal, null)
      } catch (err) {
        if (isAbort(err, exec?.signal)) {
          const ids = [...run.seen.keys()]
          throw abortError(ids.length > 0
            ? `Aborted ${display}. Task ${ids.join(', ')} keeps running on Meshy; follow it with the resource's \`wait\` command (do not resubmit).`
            : `Aborted ${display}.`)
        }
        throw err
      }
      const value = await settle(run, env)
      return { ...value, title: value.title ?? run.taskTitle }
    },
  }

  // 2. meshy_sign_in
  const meshySignIn = {
    name: 'meshy_sign_in',
    description:
      'Sign the user in to Meshy. The Meshy plugin keeps the sign-in for both the `meshy` tool and ' +
      'shell calls. Call this when Meshy reports that nobody is signed in or the session was rejected; ' +
      'never run `auth login` in the shell. Show the link and code to the user and wait for approval. ' +
      'Use region "cn" only for the China site (meshy.cn).',
    parameters: {
      type: 'object',
      properties: {
        region: { type: 'string', enum: ['global', 'cn'], description: 'Meshy site; default global.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          verification_url: { type: 'string' },
          user_code: { type: 'string' },
          expires_in: { type: 'integer' },
          region: { type: 'string' },
        },
        required: ['status', 'verification_url', 'user_code', 'expires_in'],
        additionalProperties: false,
      },
      render: (_args, v) => [{
        type: 'text',
        text: `Open ${v.verification_url} and confirm code ${v.user_code} (valid ${Math.round(v.expires_in / 60)} minutes).`,
      }],
      presentationMeta: (args, v) => cardMeta({
        tool: 'meshy_sign_in',
        status: v.status,
        verificationUrl: v.verification_url,
        userCode: v.user_code,
        expiresIn: v.expires_in,
        region: v.region ?? args?.region ?? 'global',
      }),
    },
    async execute(args) {
      const region = args?.region ?? 'global'
      if (!REGIONS.has(region)) throw new Error('meshy_sign_in: region must be global or cn')
      const view = await signIn(region)
      return { ...view, region }
    },
  }

  // 3. meshy_preview_model
  const meshyPreviewModel = {
    name: 'meshy_preview_model',
    description: 'Open a workspace .glb or .3mf model or image, or a finished Meshy task, in the right-sidebar Meshy Studio (no credits spent).',
    isConcurrencySafe: () => true,
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Workspace-relative .glb, .3mf, .png, .jpg or .webp file path.' },
        resource: { type: 'string', description: 'Meshy task resource as `meshy resources` names it (paired with task_id).' },
        task_id: { type: 'string', description: 'Meshy task id (paired with resource).' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, v) => [{
        type: 'text',
        text: v.file
          ? `Opened ${v.file} in Meshy Studio.`
          : `Opened Meshy ${v.resource} task ${v.taskId} in Meshy Studio.`,
      }],
      presentationMeta: (_args, v) => cardMeta({
        tool: 'meshy_preview_model',
        status: 'ok',
        kind: v.kind,
        file: v.file,
        resource: v.resource,
        taskId: v.taskId,
      }),
    },
    async execute(args, exec) {
      const { sessionId, workspace } = sessionInfo(exec)
      if (typeof args?.file === 'string' && args.file.trim()) {
        if (!workspace) throw new Error('previewing a workspace file requires an active session workspace')
        const resolved = await resolveWorkspaceFile(workspace, args.file.trim(), { allowedExts: PREVIEW_EXTS })
        const kind = kindOfFile(resolved.rel)
        events.emit({ type: 'open', sessionId, workspace, kind, target: { file: resolved.rel } })
        return { status: 'ok', kind, file: resolved.rel, resource: null, taskId: null }
      }
      if (args?.resource && args?.task_id) {
        if (!(await catalog.taskArgs(args.resource, 'get', args.task_id, { signal: exec?.signal }))) {
          throw new Error(`not a Meshy task: ${args.resource} ${args.task_id} (see \`meshy resources\`)`)
        }
        const kind = kindOfResource(args.resource)
        events.emit({ type: 'open', sessionId, workspace, kind, target: { resource: args.resource, taskId: args.task_id } })
        return { status: 'ok', kind, file: null, resource: args.resource, taskId: args.task_id }
      }
      throw new Error('provide either file (a workspace .glb, .3mf or image) or resource + task_id')
    },
  }

  return { tools: [meshyTool, meshySignIn, meshyPreviewModel], meshyTool }
}
