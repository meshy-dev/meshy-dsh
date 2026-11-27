// What the bundled Meshy CLI says about itself (`meshy resources`): its per-endpoint commands, the
// kind of each (a `task` resource's `create` spends credits) and the verbs they share. The plugin
// reads it instead of keeping its own list, so a CLI release with a new or renamed command needs
// no change here.

/** A resource name as the CLI prints them (`image-to-3d`, `creative-lab.figure.build`). */
const NAME = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/
/** A task id as the API issues them; never starts with "-", so it cannot read as an option. */
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/

/** `meshy creative-lab figure build` → ['creative-lab', 'figure', 'build']. */
export function commandTokens(command) {
  const parts = String(command ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts[0] === 'meshy' || parts[0] === 'meshy-cli') parts.shift()
  return parts.every((p) => /^[a-z0-9][a-z0-9-]*$/.test(p)) ? parts : []
}

/** The CLI's listing, kept only where each entry has a usable name, kind and command. */
export function parseResources(envelope) {
  const raw = envelope?.ok ? envelope.result?.items : null
  if (!Array.isArray(raw)) return null
  const items = []
  for (const it of raw) {
    const tokens = commandTokens(it?.command)
    if (typeof it?.name !== 'string' || !NAME.test(it.name) || tokens.length === 0) continue
    items.push({
      name: it.name,
      kind: typeof it.kind === 'string' ? it.kind : 'unknown',
      tokens,
      verbs: Array.isArray(it.verbs) ? it.verbs.filter((v) => typeof v === 'string') : [],
    })
  }
  return items.length > 0 ? items : null
}

/**
 * Whether one CLI command spends credits (`paid`, so the user approves it first) and whether it
 * can run for minutes (`long`, so it runs as a background job). The rule follows the CLI's own
 * contract: `make` (not with `--dry-run`), `create` on a `task` resource, and `api` with a method
 * other than GET. `items` null (the listing could not be read) fails closed: any `create` counts
 * as paid. Help never spends.
 */
export function classify(argv, items) {
  const help = argv.some((a) => a === '--help' || a === '-h') || argv[0] === 'help'
  if (help) return { paid: false, long: false, resource: null, verb: null }
  if (argv[0] === 'make') {
    const dry = argv.some((a) => a === '--dry-run' || a === '--dry-run=true')
    return { paid: !dry, long: !dry, resource: null, verb: null }
  }
  if (argv[0] === 'api') {
    const method = typeof argv[1] === 'string' ? argv[1].toUpperCase() : ''
    return { paid: method !== 'GET', long: false, resource: null, verb: null }
  }
  if (!items) {
    const create = argv.includes('create')
    return { paid: create, long: create || argv.includes('wait') || argv.includes('stream'), resource: null, verb: null }
  }
  let match = null
  for (const it of items) {
    if (it.tokens.length > argv.length) continue
    if (!it.tokens.every((t, i) => argv[i] === t)) continue
    if (!match || it.tokens.length > match.tokens.length) match = it
  }
  if (!match) return { paid: false, long: false, resource: null, verb: null }
  const verb = argv[match.tokens.length] ?? null
  const task = match.kind === 'task'
  return {
    paid: task && verb === 'create',
    long: task && (verb === 'create' || verb === 'wait' || verb === 'stream'),
    resource: match.name,
    verb,
  }
}

/**
 * The listing read once through `cli(['resources'])` and kept for `ttlMs`; a failed read is
 * retried on the next ask. `taskCommand` is the only way a resource name from a journal record,
 * the asset index or a browser request becomes CLI arguments.
 */
export function createCatalog({ cli, ttlMs = 30 * 60_000, now = Date.now }) {
  let hit = null
  let loading = null

  async function items({ signal } = {}) {
    if (hit && now() - hit.at < ttlMs) return hit.items
    loading ??= (async () => {
      try {
        const parsed = parseResources(await cli(['resources'], { timeoutMs: 30_000, signal }))
        if (parsed) hit = { at: now(), items: parsed }
        return parsed ?? hit?.items ?? null
      } catch {
        return hit?.items ?? null
      } finally {
        loading = null
      }
    })()
    return loading
  }

  /** The command of a `task` resource, or undefined for any other name. */
  async function taskCommand(name, opts) {
    if (typeof name !== 'string' || !NAME.test(name)) return undefined
    const found = (await items(opts))?.find((it) => it.name === name && it.kind === 'task')
    return found ? found.tokens : undefined
  }

  /** `[...command, verb, taskId]` for one task, or undefined when the resource or id is refused. */
  async function taskArgs(name, verb, taskId, opts) {
    if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) return undefined
    const tokens = await taskCommand(name, opts)
    return tokens ? [...tokens, verb, taskId] : undefined
  }

  /** Task resources that support `list`. */
  async function listable(opts) {
    return new Set(((await items(opts)) ?? []).filter((it) => it.kind === 'task' && it.verbs.includes('list')).map((it) => it.name))
  }

  async function classifyArgs(argv, opts) {
    return classify(argv, await items(opts))
  }

  return { items, taskCommand, taskArgs, listable, classify: classifyArgs }
}
