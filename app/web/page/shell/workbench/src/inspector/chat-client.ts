import type {Zavx0zStorybookChatView} from "@zavx0z/storybook-chat-view"
import type {Zavx0zStorybookChatSession} from "@zavx0z/storybook-chat-session"

/** Браузерный транспорт передаёт снимки сервера; закрытие представления только отписывает поток. */
export type ChatBrowserSnapshot = Awaited<ReturnType<Zavx0zStorybookChatSession.Output["read"]>>

export type ChatBrowserView = Readonly<{
  address: string
  label: string
  messages: Zavx0zStorybookChatView.Input["messages"]
  draft: string
  status: Zavx0zStorybookChatView.Input["status"]
  sending: boolean
  settings: NonNullable<ChatBrowserSnapshot["settings"]>
  configuring: boolean
  progress: string | undefined
  usage: ChatBrowserSnapshot["usage"]
  error: string | undefined
  permissions: NonNullable<Zavx0zStorybookChatView.Input["permissions"]>
}>

type ChatSocket = Pick<WebSocket, "addEventListener" | "removeEventListener" | "send" | "close">

type ChatClientOptions = Readonly<{
  createSocket?(path: string): ChatSocket
  address: string
  label: string
  fetcher?: typeof fetch
  storage?(): Pick<Storage, "getItem" | "setItem">
  scheduleRetry?(callback: () => void, delayMs: number): () => void
}>

const drafts = new Map<string, string>()
const pendingRequests = new Map<string, Readonly<{text: string; requestId: string}>>()
const draftStorageKey = (id: string) => `storybook.chat.draft.v1:${id}`

/** Общий canonical pathname исключает query выбора вида, варианта и секции. */
export function canonicalChatAddress(address: string): string {
  return new URL(address, "http://storybook.local").pathname
}

/**
Подготавливает источник UI. WebSocket не удерживает HTTP-поток вкладки.
Обрыв соединения восстанавливает grant, исходный снимок
и подписку с ограниченным backoff; prompt при этом не повторяется.
*/
export function createChatBrowserClient(options: ChatClientOptions) {
  const address = canonicalChatAddress(options.address)
  const fetcher = options.fetcher ?? globalThis.fetch
  const storage = options.storage ?? (() => globalThis.localStorage)
  const lifetime = new AbortController()
  const listeners = new Set<() => void>()
  let disposed = false
  let started = false
  let session: ChatBrowserSnapshot | null = null
  let connectionError: string | undefined
  let actionError: string | undefined
  let draft = ""
  let draftChanged = false
  let configuring = false
  let submitting = false
  let activeSocket: ChatSocket | null = null
  let finishRetry: (() => void) | null = null
  let view: ChatBrowserView = deriveView()

  function deriveView(): ChatBrowserView {
    return Object.freeze({
      address,
      label: session?.label ?? options.label,
      messages: session?.messages ?? [],
      draft,
      status: session?.status ?? (connectionError === undefined ? "connecting" : "failed"),
      sending: submitting,
      settings: session?.settings ?? [],
      progress: session?.progress,
      configuring: configuring || session?.configuring === true,
      usage: session?.usage ?? null,
      error: actionError ?? connectionError ?? session?.error ?? undefined,
      permissions: session?.permissions ?? [],
    })
  }

  const notify = (): void => {
    if (disposed) return
    view = deriveView()
    for (const listener of listeners) listener()
  }
  const saveDraft = (): void => {
    if (session === null) return
    drafts.set(session.id, draft)
    try { storage().setItem(draftStorageKey(session.id), draft) } catch {}
  }
  const accept = (value: unknown, initial = false): void => {
    const next = readChatBrowserSnapshot(value, address)
    if (disposed || !initial && session !== null && next.version < session.version) return
    if (session === null || session.id !== next.id) {
      if (!draftChanged) {
        draft = drafts.get(next.id) ?? ""
        if (!drafts.has(next.id)) {
          try { draft = storage().getItem(draftStorageKey(next.id)) ?? "" } catch {}
        }
      }
    }
    session = next
    saveDraft()
    notify()
  }
  const grant = async (): Promise<string> => {
    const response = await fetcher("/api/browser/registry-session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: "{}",
      signal: lifetime.signal,
    })
    if (!response.ok) throw new Error(`Не удалось открыть browser-сессию: HTTP ${response.status}`)
    const value = await response.json()
    if (typeof value.readerToken !== "string" || value.readerToken.length === 0) {
      throw new Error("Сервер не предоставил browser-сессию")
    }
    return value.readerToken
  }
  const post = async (operation: string, body: Record<string, unknown>, suppliedToken?: string): Promise<unknown> => {
    const token = suppliedToken ?? await grant()
    if (disposed) throw new Error("Представление чата закрыто")
    const response = await fetcher(`/api/browser/chat/${operation}`, {
      method: "POST",
      headers: {"content-type": "application/json", "x-storybook-session": token},
      body: JSON.stringify({address, ...body}),
      signal: lifetime.signal,
    })
    if (!response.ok) {
      let detail = ""
      try {
        const value = await response.json()
        if (typeof value.error === "string") detail = `: ${value.error}`
      } catch {}
      throw new Error(`Чат: HTTP ${response.status}${detail}`)
    }
    return response.json()
  }
  const stream = (token: string, onSnapshot: () => void): Promise<void> => {
    const path = `/api/events?session=${encodeURIComponent(token)}`
    const socket = options.createSocket?.(path) ?? (() => {
      const url = new URL(path, globalThis.location.href)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      return new WebSocket(url)
    })()
    activeSocket = socket
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        socket.removeEventListener("open", opened)
        socket.removeEventListener("message", message)
        socket.removeEventListener("close", closed)
        socket.removeEventListener("error", failed)
        lifetime.signal.removeEventListener("abort", aborted)
        if (activeSocket === socket) activeSocket = null
        socket.close()
        if (disposed || lifetime.signal.aborted) resolve()
        else reject(error ?? new Error("Соединение потеряно"))
      }
      const opened = (): void => {
        connectionError = undefined
        notify()
        socket.send(JSON.stringify({type: "subscribe", topic: `chat:${address}`}))
      }
      const message = (event: Event): void => {
        try {
          const value = JSON.parse(String((event as MessageEvent).data))
          if (value.type === "subscription.failed") throw new Error(value.message ?? "Подписка чата отклонена")
          if (value.type !== "chat.snapshot") return
          if (value.address !== address) throw new Error("Получен снимок другой беседы")
          accept(value.snapshot)
          onSnapshot()
        } catch (error) { finish(error instanceof Error ? error : new Error(String(error))) }
      }
      const closed = (): void => finish()
      const failed = (): void => finish(new Error("Соединение потеряно"))
      const aborted = (): void => finish()
      socket.addEventListener("open", opened)
      socket.addEventListener("message", message)
      socket.addEventListener("close", closed)
      socket.addEventListener("error", failed)
      lifetime.signal.addEventListener("abort", aborted, {once: true})
      if (disposed || lifetime.signal.aborted) finish()
    })
  }
  const waitForRetry = (delayMs: number): Promise<void> => new Promise(resolve => {
    const schedule = options.scheduleRetry ?? ((callback: () => void, delay: number) => {
      const timer = setTimeout(callback, delay)
      return () => clearTimeout(timer)
    })
    let settled = false
    let cancelTimer = () => {}
    const finish = () => {
      if (settled) return
      settled = true
      cancelTimer()
      finishRetry = null
      resolve()
    }
    finishRetry = finish
    cancelTimer = schedule(finish, delayMs)
  })
  const connect = async (): Promise<void> => {
    let attempts = 0
    while (!disposed) {
      try {
        const token = await grant()
        if (disposed) return
        accept(await post("session", {}, token), true)
        if (disposed) return
        await stream(token, () => { attempts = 0 })
      } catch (error) {
        if (disposed) return
        connectionError = error instanceof Error ? error.message : String(error)
        notify()
        await waitForRetry(Math.min(250 * 2 ** Math.min(attempts++, 6), 10_000))
      }
    }
  }
  const perform = async (operation: string, body: Record<string, unknown>): Promise<boolean> => {
    if (disposed) return false
    try {
      // Registry grants имеют ограниченный TTL; действие получает новый штатный grant.
      accept(await post(operation, body))
      actionError = undefined
      notify()
      return true
    } catch (error) {
      if (disposed) return false
      actionError = error instanceof Error ? error.message : String(error)
      notify()
      return false
    }
  }

  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    start() {
      if (started || disposed) return
      started = true
      void connect()
    },
    setDraft(value: string) {
      if (disposed) return
      draft = value
      draftChanged = true
      saveDraft()
      notify()
    },
    async send() {
      if (disposed || submitting || configuring || session?.configuring || draft.trim().length === 0 || view.status === "connecting" || view.status === "running") return
      const text = draft
      const key = session?.id ?? address
      const previous = pendingRequests.get(key)
      const request = previous?.text === text ? previous : {text, requestId: crypto.randomUUID()}
      pendingRequests.set(key, request)
      submitting = true
      notify()
      try {
        if (await perform("prompt", request)) {
          if (pendingRequests.get(key) === request) pendingRequests.delete(key)
          if (draft === text) {
            draft = ""
            saveDraft()
            notify()
          }
        }
      } finally {
        submitting = false
        notify()
      }
    },
    async prepare() {
      if (disposed || configuring) return
      configuring = true
      notify()
      try { await perform("prepare", {}) } finally { configuring = false; notify() }
    },
    async configure(id: string, value: string) {
      if (disposed || configuring || view.status === "running" || view.status === "connecting") return
      configuring = true
      notify()
      try { await perform("configure", {id, value}) } finally { configuring = false; notify() }
    },
    cancel: () => perform("cancel", {}),
    permission: (id: string, optionId: string) => perform("permission", {id, optionId}),
    dispose() {
      if (disposed) return
      disposed = true
      saveDraft()
      lifetime.abort()
      finishRetry?.()
      activeSocket?.close()
      listeners.clear()
    },
  }
}

function readChatBrowserSnapshot(value: unknown, address: string): ChatBrowserSnapshot {
  if (value === null || typeof value !== "object") throw new Error("Некорректный снимок чата")
  const snapshot = value as ChatBrowserSnapshot
  if (typeof snapshot.id !== "string" || snapshot.id.length === 0 || snapshot.address !== address ||
    typeof snapshot.label !== "string" || !Array.isArray(snapshot.messages) ||
    !["idle", "connecting", "running", "failed"].includes(snapshot.status) ||
    !(snapshot.error === null || typeof snapshot.error === "string") ||
    !Array.isArray(snapshot.permissions) || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0 ||
    snapshot.configuring !== undefined && typeof snapshot.configuring !== "boolean" ||
    snapshot.progress !== undefined && typeof snapshot.progress !== "string" ||
    snapshot.usage != null && (!Number.isFinite(snapshot.usage.used) || snapshot.usage.used < 0 ||
      !Number.isFinite(snapshot.usage.size) || snapshot.usage.size <= 0) ||
    snapshot.settings !== undefined && (!Array.isArray(snapshot.settings) || snapshot.settings.some(setting =>
      !setting || typeof setting.id !== "string" || typeof setting.name !== "string" || typeof setting.value !== "string" ||
      !["model", "thought_level"].includes(setting.category) || !Array.isArray(setting.options) || setting.options.some((option: NonNullable<ChatBrowserSnapshot["settings"]>[number]["options"][number]) =>
        !option || typeof option.value !== "string" || typeof option.name !== "string" ||
        option.description !== undefined && typeof option.description !== "string"))) ||
    snapshot.messages.some(message => message === null || typeof message !== "object" ||
      typeof message.id !== "string" || !["user", "assistant", "system"].includes(message.role) || typeof message.text !== "string") ||
    snapshot.permissions.some(permission => permission === null || typeof permission !== "object" ||
      typeof permission.id !== "string" || typeof permission.title !== "string" || !Array.isArray(permission.options) ||
      permission.options.some((option: ChatBrowserSnapshot["permissions"][number]["options"][number]) => option === null || typeof option !== "object" ||
        typeof option.id !== "string" || typeof option.name !== "string"))) {
    throw new Error("Некорректный снимок чата")
  }
  return snapshot
}
