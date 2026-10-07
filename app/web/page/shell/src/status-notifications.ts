type StatusNotification = Readonly<{id: string; heading: string; message: string}>

/** Последнее сообщение каждого Display в общем HUD; закрытие действует до следующего изменения. */
export function createStatusNotifications() {
  let entries: readonly StatusNotification[] = []
  const listeners = new Set<() => void>()
  const publish = (next: readonly StatusNotification[]) => {
    entries = next
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => entries,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    report(id: string, heading: string, detail: string) {
      const message = detail.replace(/^\s*·\s*/u, "").trim()
      const previous = entries.find(entry => entry.id === id)
      if (previous?.heading === heading && previous.message === message) return
      const remaining = entries.filter(entry => entry.id !== id)
      publish(message === "" ? remaining : [...remaining, {id, heading, message}].slice(-4))
    },
    dismiss(id: string) {
      if (entries.some(entry => entry.id === id)) publish(entries.filter(entry => entry.id !== id))
    },
  }
}
