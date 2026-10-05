import {filesToMedia, pickMedia, type MediaDraftAttachment} from "@zavx0z/chat/media"
import type {MediaPreview} from "@zavx0z/chat/content"
import type {StorybookChatView} from "@zavx0z/storybook-chat-view"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"
import {createChatHistoryWindow} from "./chat-history"

/** Браузерный транспорт передаёт снимки сервера; закрытие представления только отписывает поток. */
export type ChatBrowserSnapshot = Awaited<ReturnType<StorybookChatSession.Output["read"]>>

export type ChatBrowserView = Readonly<{
  address: string
  label: string
  executorId: string | undefined
  executorLabel: string | undefined
  sessionId: string | undefined
  sessionLabel: string | undefined
  pending: number
  history: StorybookChatView.Input["history"]
  draft: string
  attachments: readonly MediaDraftAttachment[]
  attaching: boolean
  media: MediaPreview | null
  status: StorybookChatView.Input["status"]
  sending: boolean
  settings: NonNullable<ChatBrowserSnapshot["settings"]>
  configuring: boolean
  progress: string | undefined
  usage: ChatBrowserSnapshot["usage"]
  error: string | undefined
  permissions: NonNullable<StorybookChatView.Input["permissions"]>
}>

type ChatSocket = Pick<WebSocket, "addEventListener" | "removeEventListener" | "send" | "close">

type ChatClientOptions = Readonly<{
  createSocket?(path: string): ChatSocket
  address: string
  label: string
  executorId?: string
  sessionId?: string
  fetcher?: typeof fetch
  storage?(): Pick<Storage, "getItem" | "setItem">
  scheduleRetry?(callback: () => void, delayMs: number): () => void
}>

const drafts = new Map<string, string>()
const pendingRequests = new Map<string, Readonly<{hash: string, requestId: string}>>()
const rememberDraft = (id: string, text: string): void => {
  drafts.delete(id)
  if (text.length > 0 && text.length * 2 <= 1024 * 1024) drafts.set(id, text)
  let bytes = [...drafts.values()].reduce((sum, value) => sum + value.length * 2, 0)
  while (drafts.size > 64 || bytes > 1024 * 1024) {
    const first = drafts.entries().next().value!
    bytes -= first[1].length * 2
    drafts.delete(first[0])
  }
}
const requestHash = async (value: string): Promise<string> => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("")
}
const pendingStorageKey = (id: string) => `storybook.chat.pending.v1:${id}`
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
  let visible = true
  const pageDocument = globalThis.document
  let pageActive = true
  const pageHidden = () => {pageActive = false; visibilityChanged()}
  const pageShown = () => {pageActive = true; visibilityChanged()}
  const wantsConnection = () => visible && pageActive && pageDocument?.visibilityState !== "hidden"
  const visibilityChanged = () => {
    history.setActive(wantsConnection() && media === null)
    if (!wantsConnection()) {
      connectionEpoch++
      connectionAbort?.abort()
      finishRetry?.()
      activeSocket?.close()
      if (session) session = {...session, settings: [], permissions: []}
      notify()
    } else if (started && !connecting && !disposed) void connect()
  }
  let disposed = false
  let started = false
  let connecting = false
  let connectionEpoch = 0
  let connectionAbort: AbortController | null = null
  let session: ChatBrowserSnapshot | null = null
  let connectionError: string | undefined
  let actionError: string | undefined
  let attachments: readonly MediaDraftAttachment[] = []
  let attaching = false
  let media: MediaPreview | null = null
  let draft = ""
  let draftChanged = false
  let configuring = false
  let submitting = false
  let activeSocket: ChatSocket | null = null
  let finishRetry: (() => void) | null = null
  const history = createChatHistoryWindow({read: (operation, body, signal) => post(operation, body, undefined, signal), changed: () => notify()})
  let view: ChatBrowserView = deriveView()

  function deriveView(): ChatBrowserView {
    return Object.freeze({
      address,
      label: session?.label ?? options.label,
      executorId: session?.executorId,
      executorLabel: session?.executorLabel,
      sessionId: session?.sessionId,
      sessionLabel: session?.sessionLabel,
      pending: session?.pending.length ?? 0,
      history: history.getSnapshot(),
      draft,
      attachments,
      attaching,
      media,      status: session?.status ?? (connectionError === undefined ? "connecting" : "failed"),
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
  const releaseAttachments = () => {for (const attachment of attachments) attachment.release(); attachments = []}
  const saveDraft = (): void => {
    if (session === null) return
    rememberDraft(session.id, draft)
    try { storage().setItem(draftStorageKey(session.id), draft) } catch {}
  }
  const accept = (value: unknown, initial = false): void => {
    if (disposed) return
    const next = readChatBrowserSnapshot(value, address)
    if (options.sessionId !== undefined && next.sessionId !== options.sessionId) throw new Error("Получен снимок другой сессии")
    if (options.executorId !== undefined && next.executorId !== options.executorId) throw new Error("Получен снимок другого исполнителя")
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
    history.accept(next)
    saveDraft()
    notify()
  }
  const grant = async (signal = lifetime.signal): Promise<string> => {
    const response = await fetcher("/api/browser/registry-session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: "{}",
      signal,
    })
    if (!response.ok) throw new Error(`Не удалось открыть browser-сессию: HTTP ${response.status}`)
    const value = await response.json()
    if (typeof value.readerToken !== "string" || value.readerToken.length === 0) {
      throw new Error("Сервер не предоставил browser-сессию")
    }
    return value.readerToken
  }
  const post = async (operation: string, body: Record<string, unknown>, suppliedToken?: string, signal = lifetime.signal, scope: "session" | "agent" | "address" = "session"): Promise<unknown> => {
    const token = suppliedToken ?? await grant()
    if (disposed) throw new Error("Представление чата закрыто")
    const response = await fetcher(`/api/browser/chat/${operation}`, {
      method: "POST",
      headers: {"content-type": "application/json", "x-storybook-session": token},
      body: JSON.stringify({address, ...(scope === "address" || options.executorId === undefined ? {} : {executorId: options.executorId}), ...(scope !== "session" || options.sessionId === undefined ? {} : {sessionId: options.sessionId}), ...body}),
      signal,
    })
    if (!response.ok) {
      let detail = ""
      try {
        const value = await response.json()
        if (typeof value.error === "string") detail = value.error.trim()
      } catch {}
      const message = detail && !/^(internal error|internal server error)$/iu.test(detail) ? detail
        : response.status === 413 ? "Сообщение слишком большое. Уменьшите размер вложений или текста"
        : response.status === 429 ? "Слишком много запросов. Подождите немного и повторите действие"
        : response.status === 401 || response.status === 403 ? "Нет доступа к чату. Обновите страницу и повторите действие"
        : "Не удалось выполнить действие в чате. Повторите попытку; если ошибка сохранится, проверьте журнал среды"
      throw new Error(message, {cause: {status: response.status, detail}})
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
        socket.send(JSON.stringify({type: "subscribe", topic: `chat:${address}`,
          ...(options.executorId === undefined ? {} : {executorId: options.executorId}),
          ...(options.sessionId === undefined ? {} : {sessionId: options.sessionId})}))
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
    if (connecting || disposed || !wantsConnection()) return
    connecting = true
    const epoch = connectionEpoch
    const controller = new AbortController()
    connectionAbort = controller
    let attempts = 0
    try {
      while (!disposed && wantsConnection() && epoch === connectionEpoch) {
        try {
          const token = await grant(controller.signal)
          if (disposed || controller.signal.aborted || epoch !== connectionEpoch) return
          const snapshot = await post("session", {}, token, controller.signal)
          if (disposed || controller.signal.aborted || epoch !== connectionEpoch) return
          accept(snapshot, true)
          await stream(token, () => {attempts = 0})
        } catch (failure) {
          if (disposed || controller.signal.aborted || !wantsConnection() || epoch !== connectionEpoch) return
          connectionError = failure instanceof Error ? failure.message : String(failure)
          notify()
          await waitForRetry(Math.min(250 * 2 ** Math.min(attempts++, 6), 10_000))
        }
      }
    } finally {
      if (connectionAbort === controller) connectionAbort = null
      connecting = false
      if (!disposed && wantsConnection() && started) void connect()
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

  const addAttachments = async (files?: readonly File[]): Promise<void> => {
    if (disposed || attaching || view.sending || view.status === "connecting" || view.status === "running" || files === undefined && !pageDocument) return
    attaching = true
    notify()
    try {
      const options = {signal: lifetime.signal, existing: attachments, isCurrent: () => !disposed,
        ...(session?.capabilities === undefined || session.capabilities === null ? {} : {capabilities: {
          image: session.capabilities.promptCapabilities?.image === true,
          audio: session.capabilities.promptCapabilities?.audio === true,
          files: session.capabilities.promptCapabilities?.embeddedContext === true,
        }})}
      const added = files === undefined
        ? await pickMedia({...options, browserDocument: pageDocument!})
        : await filesToMedia(files, options)
      if (!disposed) {attachments = [...attachments, ...added]; actionError = undefined}
      else for (const attachment of added) attachment.release()
    } catch (failure) {if (!disposed) actionError = failure instanceof Error ? failure.message : String(failure)}
    finally {attaching = false; notify()}
  }

  return {
    historyViewport: history.viewport,
    historyVisible(value: boolean) {
      if (visible === value) return
      visible = value
      visibilityChanged()
    },
    historyExpand: history.expand,
    historyRetry: history.retry,
    historyEvidence: history.evidence,
    historyTail: history.tail,
    getSnapshot: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    start() {
      if (started || disposed) return
      started = true
      pageDocument?.addEventListener("visibilitychange", visibilityChanged)
      globalThis.addEventListener?.("pagehide", pageHidden)
      globalThis.addEventListener?.("pageshow", pageShown)
      visibilityChanged()
    },
    async listExecutors(): Promise<readonly Pick<ChatBrowserSnapshot, "executorId" | "executorLabel" | "status" | "pending">[]> {
      if (disposed) return []
      // Первый список включает текущую default-беседу даже при параллельном открытии потока.
      if (session === null) accept(await post("session", {}), true)
      const value = await post("list", {}, undefined, lifetime.signal, "address")
      if (disposed) return []
      if (!Array.isArray(value)) throw new Error("Некорректный список исполнителей")
      return value.map(item => {
        const snapshot = readChatBrowserSnapshot(item, address)
        return {executorId: snapshot.executorId, executorLabel: snapshot.executorLabel, status: snapshot.status, pending: snapshot.pending}
      })
    },
    async createExecutor(label: string): Promise<ChatBrowserSnapshot> {
      return readChatBrowserSnapshot(await post("create", {label}, undefined, lifetime.signal, "address"), address)
    },
    async listSessions(executorId: string, signal = lifetime.signal): Promise<readonly Readonly<{id: string, title: string}>[]> {
      const value = await post("sessions", {executorId}, undefined, signal, "agent")
      if (!Array.isArray(value)) throw new Error("Некорректный список сессий")
      return value.map(item => {
        const snapshot = readChatBrowserSnapshot(item, address)
        if (snapshot.executorId !== executorId) throw new Error("Сессия другого агента")
        return {id: snapshot.sessionId, title: snapshot.sessionLabel}
      })
    },
    async createSession(executorId: string): Promise<ChatBrowserSnapshot> {
      return readChatBrowserSnapshot(await post("session-create", {executorId}, undefined, lifetime.signal, "agent"), address)
    },
    async renameSession(executorId: string, sessionId: string, label: string): Promise<ChatBrowserSnapshot> {
      return readChatBrowserSnapshot(await post("session-rename", {executorId, sessionId, label}), address)
    },
    async deleteSession(executorId: string, sessionId: string): Promise<void> {
      await post("session-delete", {executorId, sessionId})
    },
    attach: () => addAttachments(),
    attachFiles: (files: readonly File[]) => addAttachments(files),
    removeAttachment(id: string) {
      const item = attachments.find(item => item.attachment.id === id)
      if (item && media?.source === item.attachment) {media = null; visibilityChanged()}
      item?.release()
      attachments = attachments.filter(item => item.attachment.id !== id)
      notify()
    },
    preview(value: MediaPreview | null) {media = value; visibilityChanged(); notify()},
    setDraft(value: string) {
      if (disposed) return
      draft = value
      draftChanged = true
      saveDraft()
      notify()
    },
    async send() {
      if (disposed || submitting || configuring || session?.configuring || draft.trim().length === 0 && attachments.length === 0 || view.status === "connecting" || view.status === "running") return
      const text = draft
      const selectedAttachments = attachments
      const signature = `${text}\0${selectedAttachments.map(item => item.attachment.id).join(":")}`
      const key = session?.id ?? address
      submitting = true
      notify()
      try {
        const hash = await requestHash(signature)
        if (disposed) return
        let previous = pendingRequests.get(key)
        if (!previous) {
          try {
            const saved = JSON.parse(storage().getItem(pendingStorageKey(key)) ?? "null")
            if (saved && /^[a-f0-9]{64}$/u.test(saved.hash) && typeof saved.requestId === "string" && saved.requestId.length <= 128) previous = {hash: saved.hash, requestId: saved.requestId}
          } catch {}
        }
        const request = previous?.hash === hash ? previous : {hash, requestId: crypto.randomUUID()}
        pendingRequests.delete(key)
        pendingRequests.set(key, request)
        try {storage().setItem(pendingStorageKey(key), JSON.stringify(request))} catch {}
        while (pendingRequests.size > 128) pendingRequests.delete(pendingRequests.keys().next().value!)
        const content = selectedAttachments.map(item => {
          const value = item.attachment
          if (value.kind === "image") return {type: "image", mimeType: value.mimeType, data: value.data!}
          if (value.kind === "audio") return {type: "audio", mimeType: value.mimeType, data: value.data!}
          return {type: "resource", resource: {uri: `attachment:${value.id}/${encodeURIComponent(value.name)}`, mimeType: value.mimeType,
            ...(value.text === undefined ? {blob: value.data!} : {text: value.text})}}
        })
        if (await perform("prompt", {requestId: request.requestId, ...(selectedAttachments.length === 0 ? {text} : {content: [...(text.length ? [{type: "text", text}] : []), ...content]})})) {
          if (pendingRequests.get(key) === request) pendingRequests.delete(key)
          try {storage().setItem(pendingStorageKey(key), "")} catch {}
          const sentIds = new Set(selectedAttachments.map(item => item.attachment.id))
          for (const item of attachments) if (sentIds.has(item.attachment.id)) item.release()
          attachments = attachments.filter(item => !sentIds.has(item.attachment.id))
          media = null
          visibilityChanged()
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
      pageDocument?.removeEventListener("visibilitychange", visibilityChanged)
      globalThis.removeEventListener?.("pagehide", pageHidden)
      globalThis.removeEventListener?.("pageshow", pageShown)
      media = null
      releaseAttachments()
      history.dispose()
      connectionEpoch++
      connectionAbort?.abort()
      lifetime.abort()
      finishRetry?.()
      activeSocket?.close()
      listeners.clear()
      session = null
      draft = ""
      actionError = undefined
      connectionError = undefined
      view = deriveView()
    },
  }
}

function readChatBrowserSnapshot(value: unknown, address: string): ChatBrowserSnapshot {
  if (value === null || typeof value !== "object") throw new Error("Некорректный снимок чата")
  const snapshot = value as ChatBrowserSnapshot
  if (typeof snapshot.id !== "string" || snapshot.id.length === 0 || snapshot.address !== address ||
    snapshot.sessionId !== snapshot.id || typeof snapshot.sessionLabel !== "string" || snapshot.sessionLabel.length === 0 ||
    typeof snapshot.executorId !== "string" || !snapshot.executorId || typeof snapshot.executorLabel !== "string" || !snapshot.executorLabel ||
    !Array.isArray(snapshot.pending) || snapshot.pending.some(id => typeof id !== "string" || !id) ||
    typeof snapshot.label !== "string" || !snapshot.history ||
    ![snapshot.history.revision, snapshot.history.total, snapshot.history.lastSequence].every(value => Number.isSafeInteger(value) && value >= 0) ||
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
    snapshot.permissions.some(permission => permission === null || typeof permission !== "object" ||
      typeof permission.id !== "string" || typeof permission.title !== "string" || !Array.isArray(permission.options) ||
      permission.options.some((option: ChatBrowserSnapshot["permissions"][number]["options"][number]) => option === null || typeof option !== "object" ||
        typeof option.id !== "string" || typeof option.name !== "string"))) {
    throw new Error("Некорректный снимок чата")
  }
  // Snapshot identity/config/state только; старые full-history payload не принимаются.
  if (Object.hasOwn(value, "timeline") || Object.hasOwn(value, "messages")) throw new Error("Полная история в снимке чата запрещена")
  return snapshot
}
