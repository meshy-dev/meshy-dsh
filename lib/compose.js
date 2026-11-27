// Adaptive system-prompt section (`meshy:compose`): run Meshy through the native `meshy` tool
// (the Meshy CLI's own arguments, which the Meshy skills teach), and take advantage of canvas or
// genui tools only when they are already installed in the current session.

const GENUI_PATTERNS = [/^genui/, /^dsh_genui/, /^render_ui$/, /^show_widget$/]

function getService(ctx, name) {
  if (!ctx || typeof ctx !== 'object') return undefined
  if (typeof ctx.get === 'function') return ctx.get(name)
  return ctx[name]
}

function visibleToolNames(ctx, fallbackCtx, scope, toolSet) {
  const tools = getService(ctx, 'tools') ?? getService(fallbackCtx, 'tools')
  if (!tools) return null
  if (typeof tools.definitions === 'function') {
    try {
      const defs = tools.definitions(scope, toolSet)
      if (Array.isArray(defs)) return new Set(defs.map((d) => d?.name).filter(Boolean))
    } catch {
      // Fall through to schemas/get inspection.
    }
  }
  if (typeof tools.schemas === 'function') {
    try {
      const schemas = tools.schemas(scope, toolSet)
      if (Array.isArray(schemas)) return new Set(schemas.map((s) => s?.name).filter(Boolean))
    } catch {
      // Fall through to per-name lookup.
    }
  }
  if (typeof tools.get === 'function') {
    const probes = [
      'meshy',
      'meshy_sign_in',
      'canvas_write',
      'genui_render',
      'dsh_genui_render',
      'render_ui',
      'show_widget',
    ]
    const found = new Set()
    for (const name of probes) {
      try {
        if (tools.get(name, scope, toolSet)) found.add(name)
      } catch {
        // Ignore unavailable probe.
      }
    }
    return found
  }
  return null
}

/**
 * Build the `meshy:compose` prompt section text for a given assembly scope.
 */
export function buildComposeText(ctx, { scope, toolSet, fallbackCtx } = {}) {
  const names = visibleToolNames(ctx, fallbackCtx, scope, toolSet)
  if (names && toolSet && ![...names].some((n) => n === 'meshy' || n.startsWith('meshy_'))) {
    return ''
  }

  const lines = [
    '## Meshy 3D Creation',
    '- Run Meshy through the native `meshy` tool: its `args` are the Meshy CLI arguments the Meshy skills document, without the leading `meshy`. It runs signed in as the user, in this workspace, and returns the CLI\'s JSON envelope. Use it rather than running meshy in the shell.',
    '- Which AI model suits a job is in the Meshy skills; every model and option a command accepts, with its default, is in its `--help` (for example `["image-to-3d", "create", "--help"]`), which costs nothing. Check there rather than assuming, and tell the user which model you will use.',
    '- A command that spends credits asks the user first. Pass `estimated_credits` and `estimate_source` only from `make --dry-run` or the published price list, never a guess.',
    '- Commands that spend credits, and `wait`/`stream`, run as background jobs: a notice with the envelope arrives when they end. Meanwhile keep talking or do other work; do not poll, and never rerun a command whose task is still running. If the CLI\'s wait times out, resume with the `wait` command the envelope names.',
    '- A command that submits a task already follows it to its result in that background job, so let the one call carry the task from submission to its files; submitting it and then waiting on it in a second call only adds a call. Give that call a `title` naming what it makes (for example "oak chest"), not the step.',
    '- Images the user picks from a Meshy entry are saved under `meshy_input/` and named in the message; pass those paths to the CLI.',
    '- Saved .glb and .3mf models and images open in the Meshy Studio on their own; call `meshy_preview_model` to show another workspace file or task there.',
    '- If Meshy reports that nobody is signed in, call `meshy_sign_in`; never run `auth login`.',
  ]

  const hasCanvas = Boolean(names?.has('canvas_write'))
  const hasGenUi = Boolean(names && [...names].some((n) => GENUI_PATTERNS.some((re) => re.test(n))))
  if (hasCanvas) {
    lines.push('- Because `canvas_write` is available in this session, you may also write companion asset sheets, material notes, or structured summaries to the canvas when helpful.')
  }
  if (hasGenUi) {
    lines.push('- Because interactive UI rendering is available in this session, you may present structured comparisons or interactive previews alongside generated assets when helpful.')
  }

  return lines.join('\n')
}

/**
 * Register the `meshy:compose` section on `ctx.systemPrompt`.
 */
export function registerCompose(ctx, fallbackCtx) {
  const systemPrompt = getService(ctx, 'systemPrompt')
  if (!systemPrompt || typeof systemPrompt.section !== 'function') return undefined
  return systemPrompt.section({
    name: 'meshy:compose',
    order: 500,
    interpolate: false,
    text: (assembleCtx) => buildComposeText(ctx, { ...assembleCtx, fallbackCtx }),
  })
}
