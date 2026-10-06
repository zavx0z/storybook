/** Inspector tabs разделяют только identity/имя выбора; списки и history сюда не попадают. */
export type ChatSelection = Readonly<{executorId?: string, sessionId?: string, title?: string}>
const empty: ChatSelection = Object.freeze({})
const selections = new Map<string, ChatSelection>()
const listeners = new Map<string, Set<() => void>>()
const canonical = (address: string) => new URL(address, "http://storybook.local").pathname
const key = (address: string) => `storybook.chat.selection.v1:${address}`
const identity = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 128

function selection(value: unknown): ChatSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !["executorId", "sessionId", "title"].includes(key)) ||
    input.executorId !== undefined && !identity(input.executorId) ||
    input.sessionId !== undefined && (!identity(input.sessionId) || input.executorId === undefined) ||
    input.title !== undefined && (typeof input.title !== "string" || input.title.length > 128)) return null
  return Object.freeze({...input}) as ChatSelection
}

function remember(address: string, value: ChatSelection): void {
  selections.delete(address)
  selections.set(address, value)
  for (const address of selections.keys()) {
    if (selections.size <= 256) break
    if (!listeners.has(address)) selections.delete(address)
  }
}

export function readChatSelection(address: string): ChatSelection {
  address = canonical(address)
  const current = selections.get(address)
  if (current) return current
  try {
    const stored = globalThis.localStorage?.getItem(key(address))
    if (stored && stored.length <= 4096) {
      const value = selection(JSON.parse(stored))
      if (value !== null) {remember(address, value); return value}
    }
  } catch {}
  return empty
}

export function selectChatSession(address: string, value: ChatSelection): void {
  address = canonical(address)
  const normalized = selection(value)
  if (normalized === null) throw new TypeError("Некорректный выбор агента или беседы")
  const previous = readChatSelection(address)
  if (previous.executorId === normalized.executorId && previous.sessionId === normalized.sessionId && previous.title === normalized.title) return
  remember(address, normalized)
  try {globalThis.localStorage?.setItem(key(address), JSON.stringify(normalized))} catch {}
  for (const listener of listeners.get(address) ?? []) listener()
}

export function subscribeChatSelection(address: string, listener: () => void): () => void {
  address = canonical(address)
  let set = listeners.get(address)
  if (set === undefined) listeners.set(address, set = new Set())
  set.add(listener)
  return () => {set.delete(listener); if (set.size === 0) listeners.delete(address)}
}
