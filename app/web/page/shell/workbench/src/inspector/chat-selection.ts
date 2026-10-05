/** Inspector tabs разделяют только identity/имя выбора; списки и history сюда не попадают. */
export type ChatSelection = Readonly<{executorId?: string, sessionId?: string, title?: string}>
const empty: ChatSelection = Object.freeze({})
const selections = new Map<string, ChatSelection>()
const listeners = new Map<string, Set<() => void>>()

export function readChatSelection(address: string): ChatSelection {return selections.get(address) ?? empty}
export function selectChatSession(address: string, value: ChatSelection): void {
  const previous = readChatSelection(address)
  if (previous.executorId === value.executorId && previous.sessionId === value.sessionId && previous.title === value.title) return
  selections.delete(address)
  selections.set(address, Object.freeze({...value}))
  if (selections.size > 256) for (const key of selections.keys()) {
    if (!listeners.has(key)) {selections.delete(key); break}
  }
  for (const listener of listeners.get(address) ?? []) listener()
}
export function subscribeChatSelection(address: string, listener: () => void): () => void {
  let set = listeners.get(address)
  if (set === undefined) listeners.set(address, set = new Set())
  set.add(listener)
  return () => {set.delete(listener); if (set.size === 0) listeners.delete(address)}
}
