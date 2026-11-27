// The Meshy entries' handoff to the agent, on the page: each chat's composer as its input overlay
// reports it, the browser's image chooser, and saving picked images under meshy_input/ in the
// chat's workspace. What an entry asks for, and the order of its steps, are in workbench.ts.
import { useEffect, useRef, useState } from 'react'
import { IconWarningOutlineRegular, Toast, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { T } from './locales.ts'
import { putInComposer, runEntry, type Entry, type HandOffResult, type InputActions } from './workbench.ts'

export { COMMAND_ENTRIES, ENTRIES, type Entry, type HandOffResult } from './workbench.ts'

/** The largest image saved (the host refuses larger ones too). */
export const MAX_IMAGE_BYTES = 20 << 20

/** A short notice; `warn` marks one that reports a problem. */
export type Notice = { text: string; warn?: boolean }

/** The notice for an entry's outcome, if it needs one. */
export function handOffNotice(result: HandOffResult, t: T): Notice | undefined {
  switch (result.status) {
    case 'composer': return { text: t('sidebar.composerAdded') }
    case 'copied': return { text: t('sidebar.composerCopied') }
    case 'tooMany': return { text: t('entry.tooMany', { count: result.max }), warn: true }
    case 'failed': return { text: t('entry.uploadFailed', { message: result.message }), warn: true }
    default: return undefined
  }
}

/** A notice as the host's toast: a check for done, the warning sign for a problem. */
export function NoticeToast({ notice, anchor, onDone }: { notice: Notice; anchor?: HTMLElement; onDone(): void }) {
  return notice.warn
    ? <Toast text={notice.text} icon={<IconWarningOutlineRegular />} anchor={anchor} onDone={onDone} />
    : <Toast text={notice.text} tone="success" anchor={anchor} onDone={onDone} />
}

type InputHook = <V>(select: (s: { draft: string }) => V) => V
type Composer = { actions: InputActions; draftEmpty(): boolean | undefined; focus(): void; notify(notice: Notice): void }
const composers = new Map<string, Composer>()

/**
 * An invisible `conversation.input.overlay` entry: it records its chat's input actions, so an
 * entry opened outside the conversation (the /meshy command, the Studio) can fill the composer.
 */
export function ComposerTracker(props: { meshySession?: string; inputActions?: InputActions; useInput?: InputHook }) {
  const draftEmpty = props.useInput ? props.useInput((s) => !s.draft.trim()) : undefined
  const empty = useRef(draftEmpty)
  empty.current = draftEmpty
  const anchor = useRef<HTMLSpanElement>(null)
  const [notice, setNotice] = useState<Notice & { seq: number }>()
  const { meshySession: id, inputActions: actions } = props
  useEffect(() => {
    if (!id || !actions) return
    const entry: Composer = {
      actions,
      draftEmpty: () => empty.current,
      focus: () => focusEditor(anchor.current),
      notify: (n) => setNotice((prev) => ({ ...n, seq: (prev?.seq ?? 0) + 1 })),
    }
    composers.set(id, entry)
    return () => {
      if (composers.get(id) === entry) composers.delete(id)
    }
  }, [id, actions])
  return (
    <>
      <span ref={anchor} hidden />
      {notice && <NoticeToast key={notice.seq} notice={notice} onDone={() => setNotice(undefined)} />}
    </>
  )
}

/** The composer's editor next to this overlay's anchor, if it can be found. */
function editorNear(anchor: HTMLElement | null): HTMLElement | null {
  let scope = anchor?.parentElement ?? null
  for (let depth = 0; scope && depth < 8; depth++) {
    const editor = scope.querySelector<HTMLElement>('[contenteditable="true"]')
    if (editor) return editor
    scope = scope.parentElement
  }
  return null
}

function isEditable(el: Element | null): boolean {
  return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)
}

/**
 * Put the caret at the end of the composer this overlay belongs to (best effort). A menu that
 * started the handoff hands focus back to its button as it closes, so this tries again shortly
 * after, unless the user has meanwhile moved to another text field.
 */
function focusEditor(anchor: HTMLElement | null): void {
  const attempt = () => {
    try {
      const editor = editorNear(anchor)
      const active = document.activeElement
      if (!editor || editor.contains(active)) return true
      if (isEditable(active)) return false
      editor.focus({ preventScroll: true })
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return true
    } catch {
      return false // The request is in the composer either way.
    }
  }
  if (!attempt()) return
  for (const delay of [150, 400]) setTimeout(attempt, delay)
}

/** The browser's file chooser for PNG, JPEG or WebP images; resolves to [] when cancelled. */
export function pickImages(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp'
    input.multiple = multiple
    input.style.display = 'none'
    let settled = false
    const done = (files: File[]) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(files)
    }
    input.addEventListener('change', () => done([...(input.files ?? [])]))
    input.addEventListener('cancel', () => done([]))
    document.body.appendChild(input)
    input.click()
  })
}

/** Save one picked image under meshy_input/ in the chat's workspace; resolves to its path. */
export async function saveImage(sessionId: string, file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is over ${MAX_IMAGE_BYTES >> 20} MB`)
  const query = `session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(file.name)}`
  const res = await fetch(`api/meshy.input?${query}`, { method: 'POST', cache: 'no-store', body: file })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data?.file !== 'string') throw new Error(data?.error ?? `HTTP ${res.status}`)
  return data.file
}

/**
 * Run one entry picked from the `/meshy` command. dsh removes the typed `/meshy` once the pick
 * settles, and only while the draft is unchanged, so the request goes in after that; a problem
 * is shown next to the composer.
 */
export function handOffFromCommand(sessionId: string, entry: Entry, locale: 'en' | 'zh', t: T): void {
  setTimeout(() => {
    void handOff(sessionId, entry, locale).then((result) => {
      const notice = result.status === 'composer' ? undefined : handOffNotice(result, t)
      if (notice) composers.get(sessionId)?.notify(notice)
    })
  }, 0)
}

/** Run one entry for a chat; the composer is the chat's own, else the request is copied. */
export function handOff(sessionId: string, entry: Entry, locale: 'en' | 'zh', opts: { onSaving?(): void } = {}): Promise<HandOffResult> {
  return runEntry(entry, locale, {
    pick: pickImages,
    save: (file) => saveImage(sessionId, file),
    put: async (text) => {
      const composer = composers.get(sessionId)
      const outcome = await putInComposer({ inputActions: composer?.actions, draftEmpty: composer?.draftEmpty(), copy: writeClipboard }, text)
      if (outcome === 'composer') requestAnimationFrame(() => composer?.focus())
      return outcome
    },
    onSaving: opts.onSaving,
  })
}
