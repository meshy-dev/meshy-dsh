// Browser half of meshy-dsh: locales, Settings -> Meshy and Plugins -> Meshy, the left-sidebar
// Meshy page, the `.glb` document preview, the right-sidebar Meshy Studio tab, the `/meshy`
// command, the cards of the three Meshy tools, and the `meshyUi` service. The UI only shows and
// hands off: every generation is the agent's, started from a request put in the composer.
import {
  ensureStyles, MeshyGlyph, MeshyIcon, mountedSession, onSessionEvents, openMeshyPage, openStudio,
  readPlugin, setOpenBundle, setSelectPanel, setSidebarRight, setStartSession, setWorkspaceFiles,
  GLB_ID, PAGE_ID, TASKS_ID, TASKS_KIND, UPDATE_POLL_MS,
  type SidebarRight, type StudioTarget, type WorkspaceFiles,
} from './common.tsx'
import { COMMAND_ENTRIES, ComposerTracker, handOffFromCommand } from './handoff.tsx'
import { detectLocale, en, NS, zh, type T } from './locales.ts'
import { GlbBody, GlbMeshyAction, MeshyStudioTab, MeshyTabTitle } from './sidebar.tsx'
import { MeshyPage, MeshyPanel } from './studio-page.tsx'
import { MESHY_TOOL_NAMES, MeshyToolView } from './toolviews.tsx'

export const name = 'meshy-dsh-client'
export const inject = ['slots', 'locale']

type Ctx = {
  uiWorkspace: {
    startSession(
      workspaceId?: string,
      options?: { prompt?: string; whenDraftExists?: 'keep' | 'replace' | 'append' },
    ): void
  }
  slots: {
    inject(name: string, register: () => () => void): () => void
    register(spec: object, component: unknown): () => void
  }
  commandUi: { register(contribution: object): () => void }
  locale: {
    register(ns: string, dicts: object): () => void
    bind(ns: string): T
  }
  documentPreviews: { register(definition: object): () => void }
  sidebarRightTabs: { register(definition: object): () => void }
  sidebarRight: SidebarRight
  remote: { workspaceFiles: WorkspaceFiles }
  pluginNavigation: { openBundle(packageName: string): void }
  layout: { selectPanel(id: string): void }
  effect(execute: () => () => unknown, label?: string): unknown
  inject(deps: string[], callback: (ctx: Ctx) => void): unknown
  provide?(serviceName: string, value: unknown): void
}

/**
 * Keep the on-screen Session's Meshy event stream open, so the first Meshy task of a page load
 * (from a tool or from the CLI in a shell) opens the Studio even before any Meshy card mounts.
 */
function followMountedSession(sidebarRight: SidebarRight): () => void {
  const mounted = sidebarRight.mounted
  if (!mounted) return () => {}
  let current: string | undefined
  let release: () => void = () => {}
  const follow = () => {
    const next = mounted.getSnapshot()
    if (next === current) return
    release()
    current = next
    release = next ? onSessionEvents(next, () => {}) : () => {}
  }
  const unsubscribe = mounted.subscribe(follow)
  follow()
  return () => {
    unsubscribe()
    release()
  }
}

function MeshyGuideIcon() {
  return <MeshyGlyph size={16} />
}

export type MeshyUiService = {
  version: 1
  /** Open the Meshy Studio tab for the on-screen Session, optionally on one task's or file's asset. */
  openTab(target?: StudioTarget): boolean
  /** Open the left-sidebar Meshy page. */
  openStudioPage(): void
}

export function apply(ctx: Ctx) {
  ensureStyles()

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'meshy-dsh: dictionaries')

  // Settings -> Meshy & Plugins -> Meshy
  ctx.effect(
    () =>
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'meshy', order: 40, label: () => ctx.locale.bind(NS)('nav'), locale: NS },
          MeshyPanel,
        ),
      ),
    'meshy-dsh: settings section',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          { name: 'plugins.bundle.config', key: 'meshy-dsh', locale: NS },
          MeshyPanel,
        ),
      ),
    'meshy-dsh: bundle page',
  )

  // Left-sidebar entry and the Meshy page
  ctx.inject(['layout', 'slots', 'locale'], (c) => {
    c.effect(() => {
      setSelectPanel((id) => c.layout.selectPanel(id))
      return () => setSelectPanel(undefined)
    }, 'meshy-dsh: open the Meshy page')
    c.effect(
      () => c.slots.inject('main', () => c.slots.register({ name: 'main', key: PAGE_ID, locale: NS }, MeshyPage)),
      'meshy-dsh: page',
    )
    c.effect(
      () =>
        c.slots.inject('sidebar.panellist', () =>
          c.slots.register({ name: 'sidebar.panellist', id: PAGE_ID, order: 20, label: 'Meshy' }, MeshyIcon),
        ),
      'meshy-dsh: sidebar entry',
    )
  })

  // Each chat's composer, so the Meshy entries can put a request in it
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.input.overlay', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.overlay',
            id: 'meshy-composer',
            order: 90,
            locale: NS,
            inject: (sessionId: string) => ({ meshySession: sessionId }),
          },
          ComposerTracker,
        ),
      ),
    'meshy-dsh: composer handoff',
  )

  // `/meshy`: the Studio's New menu entries, plus Creative Lab
  ctx.inject(['commandUi', 'locale'], (c) => {
    const t = c.locale.bind(NS)
    c.effect(
      () =>
        c.commandUi.register({
          name: 'meshy',
          label: () => 'Meshy',
          description: () => t('entry.command'),
          available: () => true,
          ui: {
            kind: 'popupSelect',
            options: async () => COMMAND_ENTRIES.map((e) => ({ id: e.id, label: t(`entry.${e.id}`), detail: t(`entry.${e.id}.detail`) })),
            onSelect: (option: { id: string }, session: { sessionId: string }) => {
              const entry = COMMAND_ENTRIES.find((e) => e.id === option.id)
              if (entry) handOffFromCommand(session.sessionId, entry, detectLocale(t), t)
            },
          },
        }),
      'meshy-dsh: /meshy command',
    )
  })

  // New sessions from the page's prompts and the library
  ctx.inject(['uiWorkspace'], (c) => {
    c.effect(() => {
      setStartSession((prompt) => c.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: 'replace' }))
      return () => setStartSession(undefined)
    }, 'meshy-dsh: start session')
  })

  // Plugin update check
  ctx.effect(() => {
    void readPlugin()
    const timer = setInterval(readPlugin, UPDATE_POLL_MS)
    return () => clearInterval(timer)
  }, 'meshy-dsh: update check')

  ctx.inject(['pluginNavigation'], (c) => {
    c.effect(() => {
      setOpenBundle((packageName) => c.pluginNavigation.openBundle(packageName))
      return () => setOpenBundle(undefined)
    }, 'meshy-dsh: open plugin page')
  })

  // `.glb` and `.3mf` document preview and its Meshy action menu
  ctx.inject(['documentPreviews', 'slots', 'locale', 'remote', 'remote.workspaceFiles'], (c) => {
    c.effect(() => {
      setWorkspaceFiles(c.remote.workspaceFiles)
      return () => setWorkspaceFiles(undefined)
    }, 'meshy-dsh: workspace file reads')
    c.effect(
      () =>
        c.documentPreviews.register({
          id: GLB_ID,
          extensions: ['glb', '3mf'],
          binaryExtensions: ['glb', '3mf'],
          priority: 'extension',
          title: () => c.locale.bind(NS)('viewer.title'),
          loading: 'renderer',
        }),
      'meshy-dsh: glb preview',
    )
    c.effect(
      () =>
        c.slots.inject('sidebar.right.tab.document', () =>
          c.slots.register({ name: 'sidebar.right.tab.document', key: GLB_ID, locale: NS }, GlbBody),
        ),
      'meshy-dsh: glb body',
    )
    c.effect(
      () =>
        c.slots.inject('sidebar.right.tab.document.action', () =>
          c.slots.register(
            { name: 'sidebar.right.tab.document.action', key: GLB_ID, locale: NS },
            GlbMeshyAction,
          ),
        ),
      'meshy-dsh: glb action',
    )
  })

  // Right-sidebar Meshy Studio tab
  ctx.inject(['sidebarRightTabs', 'sidebarRight', 'slots', 'locale'], (c) => {
    const t = c.locale.bind(NS)
    c.effect(() => {
      setSidebarRight(c.sidebarRight)
      return () => setSidebarRight(undefined)
    }, 'meshy-dsh: sidebar opener')
    c.effect(
      () =>
        c.sidebarRightTabs.register({
          id: TASKS_ID,
          kind: TASKS_KIND,
          title: () => t('sidebar.title'),
          guide: [
            {
              id: 'tasks',
              order: 60,
              title: () => t('sidebar.title'),
              description: () => t('sidebar.guide'),
              icon: MeshyGuideIcon,
            },
          ],
        }),
      'meshy-dsh: sidebar tab type',
    )
    c.effect(
      () =>
        c.slots.inject('sidebar.right.pane.tab', () =>
          c.slots.register({ name: 'sidebar.right.pane.tab', key: TASKS_ID, locale: NS }, MeshyStudioTab),
        ),
      'meshy-dsh: sidebar tab body',
    )
    c.effect(
      () =>
        c.slots.inject('sidebar.right.pane.tab.title', () =>
          c.slots.register({ name: 'sidebar.right.pane.tab.title', key: TASKS_ID, locale: NS }, MeshyTabTitle),
        ),
      'meshy-dsh: sidebar tab title',
    )
    c.effect(() => followMountedSession(c.sidebarRight), 'meshy-dsh: follow the on-screen session')
  })

  // Cards for the three Meshy tools
  for (const toolName of MESHY_TOOL_NAMES) {
    ctx.effect(
      () =>
        ctx.slots.inject('tool.call.toolview', () =>
          ctx.slots.register({ name: 'tool.call.toolview', key: toolName, locale: NS }, MeshyToolView),
        ),
      `meshy-dsh: toolview ${toolName}`,
    )
  }

  // Client service for other plugins
  const service: MeshyUiService = {
    version: 1,
    openTab: (target) => openStudio(mountedSession(), target ?? null),
    openStudioPage: openMeshyPage,
  }
  ctx.provide?.('meshyUi', service)
}
