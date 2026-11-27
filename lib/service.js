// Public Cordis host service (`ctx.provide('meshy', service)`): other dsh plugins and Creator Mode
// compositions read Meshy status, tasks and models, run Meshy CLI commands through the same
// approval as the agent's `meshy` tool, drive the right-sidebar Studio, and subscribe
// to live events.
import { listModels, recordAsset, resolveWorkspaceFile } from './tasks.js'

export function createMeshyService({ getStatus, sessionTasks, library, taskStates, events, meshyTool }) {
  return {
    version: 1,

    async status() {
      return getStatus()
    },

    tasks: {
      session(sessionId, opts) {
        return sessionTasks(sessionId, opts)
      },
      library(opts) {
        return library.list(opts)
      },
      get(resource, taskId) {
        return taskStates.get(resource, taskId)
      },
    },

    models: {
      list(workspace) {
        return listModels(workspace)
      },
      async announce(workspace, file, meta = {}) {
        const resolved = await resolveWorkspaceFile(workspace, file, { allowedExts: new Set(['.glb', '.3mf']) })
        if (typeof meta?.taskId === 'string') {
          await recordAsset(workspace, meta.taskId, {
            resource: typeof meta.resource === 'string' ? meta.resource : null,
            kind: 'model',
            file: resolved.rel,
            files: [resolved.rel],
          })
        }
        events.emit({
          type: 'model',
          sessionId: typeof meta?.sessionId === 'string' ? meta.sessionId : null,
          workspace,
          file: resolved.rel,
          resource: typeof meta?.resource === 'string' ? meta.resource : null,
          taskId: typeof meta?.taskId === 'string' ? meta.taskId : null,
        })
        return { file: resolved.rel }
      },
    },

    ui: {
      openModel(sessionId, target) {
        events.emit({
          type: 'open',
          sessionId: typeof sessionId === 'string' ? sessionId : null,
          workspace: null,
          target: target ?? null,
        })
      },
      openTasks(sessionId) {
        events.emit({
          type: 'open',
          sessionId: typeof sessionId === 'string' ? sessionId : null,
          workspace: null,
          target: null,
        })
      },
    },

    /**
     * Run one Meshy CLI command in a chat (`agent` carries its session), as the agent's `meshy`
     * tool does: `args` are the CLI arguments after `meshy`; a command that spends credits asks
     * the user first, showing `estimatedCredits` (from `make --dry-run` or the published price
     * list) when given. Resolves when the command ends, with the CLI's envelope and saved files.
     */
    async run({ agent, callId, signal, requester, args, estimatedCredits, estimateSource, title } = {}) {
      return meshyTool.execute(
        { args, estimated_credits: estimatedCredits, estimate_source: estimateSource, title },
        { agent, callId, signal, requester, meshyWait: true },
      )
    },

    subscribe(listener) {
      return events.subscribe(listener)
    },
  }
}
