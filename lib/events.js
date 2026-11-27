// Host-local pub/sub event bus for live task updates, workspace model announcements, and
// right-sidebar focus requests. Listeners are isolated so one error never interrupts others.

/**
 * Create a lightweight pub/sub bus scoped to one host instance (or test).
 */
export function createEventBus() {
  const listeners = new Set()

  function emit(event) {
    if (!event || typeof event !== 'object') return
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch {
        // One failing listener must not disrupt other subscribers or SSE streams.
      }
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {}
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  return { emit, subscribe }
}
