import {createAudioPlayback} from "@zavx0z/immersive-browser/audio"
import {saveDraftMedia, loadDraftMedia} from "./chat-draft-media"
import {createHistoryRequests} from "./history-requests"
import {createMediaImageCache, filesToMedia, pickMedia, type MediaDraftAttachment} from "@zavx0z/chat/media"
import {mediaAttachmentBlob, downloadMediaBlob, type MediaHost, type MediaPreview} from "@zavx0z/chat/content"
import type {StorybookChatView} from "@zavx0z/storybook-chat-view"
import type {StorybookChatSession} from "@zavx0z/storybook-chat-session"

type Selection = NonNullable<Awaited<ReturnType<NonNullable<StorybookChatSession.Input["resolveExecution"]>>>>["selection"]
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
  activity: ChatBrowserSnapshot["activity"]
  sending: boolean
  settings: NonNullable<ChatBrowserSnapshot["settings"]>
  execution: ChatBrowserSnapshot["execution"]
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
  draftMedia?: Readonly<{load: typeof loadDraftMedia, save: typeof saveDraftMedia}>
}>

const drafts = new Map<string, string>()
type SubmissionReceipt = Readonly<{hash: string, requestId: string, accepted?: boolean}>
const pendingRequests = new Map<string, SubmissionReceipt>()
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
const removedMediaKey = (id: string) => `storybook.chat.removed-media.v1:${id}`
const removedMedia = new Map<string, Set<string>>()

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
  const draftMedia = options.draftMedia ?? {load: loadDraftMedia, save: saveDraftMedia}
  const lifetime = new AbortController()
  const images = createMediaImageCache()
  const listeners = new Set<() => void>()
  let visible = true
  let historyVisible = true
  const pageDocument = globalThis.document
  let pageActive = true
  const pageHidden = () => {pageActive = false; visibilityChanged()}
  const pageShown = () => {pageActive = true; visibilityChanged()}
  const wantsConnection = () => visible && pageActive && pageDocument?.visibilityState !== "hidden"
  const visibilityChanged = () => {
    history.setActive(wantsConnection() && historyVisible && media === null)
    if (!wantsConnection()) {
      images.clear()
      connectionEpoch++
      connectionAbort?.abort()
      finishRetry?.()
      activeSocket?.close()
      // Каталог параметров — компактные metadata чата, не содержимое окна истории.
      // Временная невидимость viewport не должна сбрасывать селекты и вызывать новый prepare.
      if (session) session = {...session, permissions: []}
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
  let attachmentsEpoch = 0
  let mediaRestoring: Promise<void> | null = null
  let media: MediaPreview | null = null
  let draft = ""
  let draftChanged = false
  let draftEpoch = 0
  let configuring = false
  let metadataProbe: Readonly<{identity: string, controller: AbortController}> | null = null
  let pendingConfiguration: Readonly<{sessionId: string, setting?: Readonly<{id: string, value: string}>, selection?: Selection}> | null = null
  let submitting = false
  let activeSocket: ChatSocket | null = null
  let finishRetry: (() => void) | null = null
  const historyRequests = createHistoryRequests()
  const historyRead = (operation: string, body: Record<string, unknown>, signal: AbortSignal) => {
    const active = AbortSignal.any([signal, lifetime.signal])
    return historyRequests(() => post(operation, body, undefined, active), active)
  }
  const history = createChatHistoryWindow({read: historyRead, changed: () => notify()})
  let view: ChatBrowserView = deriveView()

  function deriveView(): ChatBrowserView {
    const pending = pendingConfiguration !== null && pendingConfiguration.sessionId === session?.id ? pendingConfiguration : null
    const settings = pending?.setting ? (session?.settings ?? []).map(option => option.id === pending.setting!.id ? {...option, value: pending.setting!.value} : option) : session?.settings ?? []
    const execution = pending?.selection && session?.execution ? {...session.execution, selection: pending.selection} : session?.execution
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
      media,
      status: session?.status ?? (connectionError === undefined ? "connecting" : "failed"),
      sending: submitting,
      activity: session?.activity,
      settings,
      execution,
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
  const pendingReceipt = (key: string): SubmissionReceipt | undefined => {
    let receipt = pendingRequests.get(key)
    if (!receipt) {
      try {
        const saved = JSON.parse(storage().getItem(pendingStorageKey(key)) ?? "null")
        if (saved && /^[a-f0-9]{64}$/u.test(saved.hash) && typeof saved.requestId === "string" && saved.requestId.length > 0 && saved.requestId.length <= 128) {
          receipt = {hash: saved.hash, requestId: saved.requestId, ...(saved.accepted === true ? {accepted: true} : {})}
        }
      } catch {}
    }
    return receipt
  }
  const saveReceipt = (key: string, receipt: SubmissionReceipt): void => {
    pendingRequests.delete(key)
    pendingRequests.set(key, receipt)
    while (pendingRequests.size > 128) pendingRequests.delete(pendingRequests.keys().next().value!)
    try {storage().setItem(pendingStorageKey(key), JSON.stringify(receipt))} catch {}
  }
  const forgetAccepted = (key: string): void => {
    if (!pendingReceipt(key)?.accepted) return
    pendingRequests.delete(key)
    try {storage().setItem(pendingStorageKey(key), "")} catch {}
  }
  const retiredMedia = (id: string): Set<string> => {
    let ids = removedMedia.get(id)
    if (!ids) {
      ids = new Set()
      try {
        const saved = JSON.parse(storage().getItem(removedMediaKey(id)) ?? "[]")
        if (Array.isArray(saved) && saved.every(value => typeof value === "string" && value.length <= 128)) ids = new Set(saved)
      } catch {}
      if (ids.size) removedMedia.set(id, ids)
    }
    return ids
  }
  const retireMedia = (id: string, values: readonly string[]): void => {
    const ids = retiredMedia(id)
    for (const value of values) ids.add(value)
    if (ids.size) removedMedia.set(id, ids)
    while (removedMedia.size > 128) removedMedia.delete(removedMedia.keys().next().value!)
    try {storage().setItem(removedMediaKey(id), JSON.stringify([...ids]))} catch {}
  }
  const persistMedia = async (id: string, values: readonly MediaDraftAttachment[]): Promise<void> => {
    const savedRetired = [...retiredMedia(id)]
    await draftMedia.save(id, values)
    const ids = retiredMedia(id)
    for (const value of savedRetired) ids.delete(value)
    try {storage().setItem(removedMediaKey(id), JSON.stringify([...ids]))} catch {}
    if (!ids.size) removedMedia.delete(id)
  }
  const signature = (text: string, values: readonly MediaDraftAttachment[]) => JSON.stringify({text, attachments: values.map(item => item.attachment.id)})
  const metadataIdentity = (snapshot: ChatBrowserSnapshot | null): string | undefined => {
    if (!snapshot?.execution || snapshot.execution.pinnedConnectionId !== undefined || snapshot.pending.length > 0) return
    return JSON.stringify([snapshot.id, snapshot.execution.effective.connectionId, snapshot.execution.effective.model])
  }
  const accept = (value: unknown, initial = false): void => {
    if (disposed) return
    let next = readChatBrowserSnapshot(value, address)
    if (options.sessionId !== undefined && next.sessionId !== options.sessionId) throw new Error("Получен снимок другой сессии")
    if (options.executorId !== undefined && next.executorId !== options.executorId) throw new Error("Получен снимок другого исполнителя")
    if (session !== null && (session.id !== next.id || session.executorId !== next.executorId)) throw new Error("Получен снимок другой сессии")
    if (disposed || !initial && session !== null && next.version < session.version) return
    if (session === null || session.id !== next.id) {
      if (!draftChanged) {
        draft = drafts.get(next.id) ?? ""
        if (!drafts.has(next.id)) {
          try { draft = storage().getItem(draftStorageKey(next.id)) ?? "" } catch {}
        }
      }
    }
    const identity = metadataIdentity(next)
    if (metadataProbe && metadataProbe.identity !== identity) metadataProbe.controller.abort()
    // Probe не создаёт native сессию; её компактный каталог сохраняется при обычном серверном снимке.
    if (identity !== undefined && identity === metadataIdentity(session) && !next.settings?.length && session?.settings?.length) {
      next = {...next, settings: session.settings}
    }
    const initialIdentity = session === null
    session = next
    if (initialIdentity) {
      if (draftChanged) forgetAccepted(next.id)
      const epoch = attachmentsEpoch
      mediaRestoring = draftMedia.load(next.id, lifetime.signal).then(async items => {
        if (disposed || session?.id !== next.id || epoch !== attachmentsEpoch) {for (const item of items) item.release(); return}
        const receipt = pendingReceipt(next.id)
        if (!draftChanged && receipt?.accepted && await requestHash(signature(draft, items)) === receipt.hash) {
          if (disposed || session?.id !== next.id || epoch !== attachmentsEpoch || draftChanged) {for (const item of items) item.release(); return}
          draft = ""
          saveDraft()
        }
        if (disposed || session?.id !== next.id || epoch !== attachmentsEpoch) {for (const item of items) item.release(); return}
        const removed = retiredMedia(next.id)
        const remaining = items.filter(item => !removed.has(item.attachment.id))
        for (const item of items) if (removed.has(item.attachment.id)) item.release()
        releaseAttachments()
        attachments = remaining
        if (remaining.length !== items.length) {
          attachmentsEpoch++
          notify()
          await persistMedia(next.id, remaining)
        }
        notify()
      }).catch(failure => {if (!disposed && !lifetime.signal.aborted) {actionError = String(failure); notify()}})
    }
    history.accept(next)
    saveDraft()
    notify()
  }
  const grant = async (signal = lifetime.signal): Promise<string> => {
    signal = AbortSignal.any([signal, lifetime.signal])
    signal.throwIfAborted()
    const response = await fetcher("/api/browser/registry-session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: "{}",
      signal,
    })
    signal.throwIfAborted()
    if (!response.ok) throw new Error(`Не удалось открыть browser-сессию: HTTP ${response.status}`)
    const value = await response.json()
    if (typeof value.readerToken !== "string" || value.readerToken.length === 0) {
      throw new Error("Сервер не предоставил browser-сессию")
    }
    return value.readerToken
  }
  const post = async (operation: string, body: Record<string, unknown>, suppliedToken?: string, signal = lifetime.signal, scope: "session" | "agent" | "address" = "session"): Promise<unknown> => {
    signal = AbortSignal.any([signal, lifetime.signal])
    signal.throwIfAborted()
    // Identity фиксируется до получения grant: поздний запрос не выбирает новую default-беседу.
    const target = {address,
      ...(scope === "address" || (options.executorId ?? session?.executorId) === undefined ? {} : {executorId: options.executorId ?? session?.executorId}),
      ...(scope !== "session" || (options.sessionId ?? session?.sessionId) === undefined ? {} : {sessionId: options.sessionId ?? session?.sessionId}),
      ...body}
    const token = suppliedToken ?? await grant(signal)
    signal.throwIfAborted()
    if (disposed) throw new Error("Представление чата закрыто")
    const response = await fetcher(`/api/browser/chat/${operation}`, {
      method: "POST",
      headers: {"content-type": "application/json", "x-storybook-session": token},
      body: JSON.stringify(target),
      signal,
    })
    signal.throwIfAborted()
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
    const subscription = {type: "subscribe", topic: `chat:${address}`,
      ...((options.executorId ?? session?.executorId) === undefined ? {} : {executorId: options.executorId ?? session?.executorId}),
      ...((options.sessionId ?? session?.sessionId) === undefined ? {} : {sessionId: options.sessionId ?? session?.sessionId})}
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
        socket.send(JSON.stringify(subscription))
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
      const result = await post(operation, body)
      if (disposed) return false
      accept(result)
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
    if (disposed || attaching || view.sending || view.status === "connecting" || files === undefined && !pageDocument) return
    attaching = true
    notify()
    try {
      await mediaRestoring
      if (disposed) return
      const identity = session?.id
      const epoch = attachmentsEpoch
      const options = {signal: lifetime.signal, existing: attachments, isCurrent: () => !disposed && session?.id === identity && attachmentsEpoch === epoch,
        ...(session?.capabilities === undefined || session.capabilities === null ? {} : {capabilities: {
          image: session.capabilities.promptCapabilities?.image === true,
          audio: session.capabilities.promptCapabilities?.audio === true,
          files: session.capabilities.promptCapabilities?.embeddedContext === true,
        }})}
      const added = files === undefined
        ? await pickMedia({...options, browserDocument: pageDocument!})
        : await filesToMedia(files, options)
      if (!disposed && session?.id === identity && attachmentsEpoch === epoch) {
        attachments = [...attachments, ...added]
        attachmentsEpoch++
        actionError = undefined
        if (session) {forgetAccepted(session.id); await persistMedia(session.id, attachments)}
      }
      else for (const attachment of added) attachment.release()
    } catch (failure) {if (!disposed) actionError = failure instanceof Error ? failure.message : String(failure)}
    finally {attaching = false; notify()}
  }

  const mediaHost: MediaHost = {
    images,
    async load(source, signal) {
      signal = AbortSignal.any([signal, lifetime.signal])
      signal.throwIfAborted()
      const target = {address, executorId: session?.executorId ?? options.executorId, sessionId: session?.sessionId ?? options.sessionId}
      if (typeof source !== "string") return mediaAttachmentBlob(source)
      if (source.startsWith("blob:")) {
        const response = await fetcher(source, {signal})
        if (!response.ok) throw new Error("Не удалось прочитать локальное медиа")
        const blob = await response.blob()
        signal.throwIfAborted()
        return blob
      }
      const operation = source.startsWith("chat-media:") ? "media-read" : "media-external"
      const token = await grant(signal)
      const response = await fetcher(`/api/browser/chat/${operation}`, {method: "POST", signal,
        headers: {"content-type": "application/json", "x-storybook-session": token},
        body: JSON.stringify({...target, uri: source})})
      if (!response.ok) {
        let message = "Не удалось загрузить медиа"
        try {const result = await response.json(); if (typeof result.error === "string") message = result.error} catch {}
        throw new Error(message)
      }
      const blob = await response.blob()
      signal.throwIfAborted()
      return blob
    },
    async download(value, signal) {
      signal = AbortSignal.any([signal, lifetime.signal])
      if (!pageDocument) throw new Error("Скачивание доступно в браузере")
      const blob = await mediaHost.load(value.source, signal)
      signal.throwIfAborted()
      downloadMediaBlob(pageDocument, new Blob([blob], {type: value.mimeType}), value.label)
    },
    ...(pageDocument ? {createAudio: (blob: Blob, onChange: Parameters<typeof createAudioPlayback>[1]["onChange"]) => createAudioPlayback(blob, {document: pageDocument, onChange})} : {}),
  }

  return {
    mediaHost,
    createGroupHistory: history.createGroupHistory,
    historyRetryPage: history.retryPage,
    readHistoryTerminal: (id: string, cursor: {ordinal: number, offset: number} | undefined, signal: AbortSignal) => historyRead("history-terminal", {id, query: cursor === undefined ? {} : {cursor}}, signal) as Promise<import("@zavx0z/storybook-chat-session").HistoryTerminalPage>,
    readHistoryContent: (id: string, cursor: {block: number, offset: number}, signal: AbortSignal) => historyRead("history-content", {id, query: {cursor}}, signal) as Promise<import("@zavx0z/storybook-chat-session").HistoryContentPage>,
    readHistoryDetail: (id: string, offset: number, signal: AbortSignal, evidenceId?: string) => historyRead("history-detail", {id, query: {offset, ...(evidenceId ? {evidenceId} : {})}}, signal) as Promise<import("@zavx0z/storybook-chat-session").HistoryDetailPage>,
    async copyMessage(id: string) {
      const result = await post("history-copy", {id}) as {text: string}
      await navigator.clipboard.writeText(result.text)
    },
    async copyText(text: string) {await navigator.clipboard.writeText(text)},
    historyViewport: history.viewport,
    /** Видимость всей секции: соединение не зависит от высоты окна истории. */
    setVisible(value: boolean) {
      if (disposed || visible === value) return
      visible = value
      visibilityChanged()
    },
    historyVisible(value: boolean) {
      if (disposed || historyVisible === value) return
      historyVisible = value
      history.setActive(wantsConnection() && value && media === null)
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
    async executorPreferences(executorId: string, signal = lifetime.signal): Promise<ChatBrowserSnapshot> {
      return readChatBrowserSnapshot(await post("executor-preferences", {executorId}, undefined, signal, "agent"), address)
    },
    async configureExecutor(executorId: string, selection: Selection): Promise<ChatBrowserSnapshot> {
      return readChatBrowserSnapshot(await post("execution-configure", {executorId, configuration: {scope: "executor", selection}}, undefined, lifetime.signal, "agent"), address)
    },
    async executionOptions(connectionId: string, model?: string, signal = lifetime.signal): Promise<NonNullable<ChatBrowserSnapshot["settings"]>> {
      return await post("execution-options", {connectionId, ...(model ? {model} : {})}, undefined, signal, "address") as NonNullable<ChatBrowserSnapshot["settings"]>
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
    async listDeletedSessions(executorId: string, signal = lifetime.signal): Promise<readonly {id: string, title: string, recoverable: boolean}[]> {
      const value = await post("sessions-deleted", {executorId}, undefined, signal, "agent")
      if (!Array.isArray(value)) throw new Error("Некорректная корзина бесед")
      return value.map(item => {
        const snapshot = readChatBrowserSnapshot(item, address)
        if (snapshot.executorId !== executorId || typeof item.recoverable !== "boolean") throw new Error("Некорректная принадлежность записи корзины")
        return {id: snapshot.sessionId, title: snapshot.sessionLabel, recoverable: item.recoverable}
      })
    },
    async restoreSession(executorId: string, sessionId: string): Promise<void> {await post("session-restore", {executorId, sessionId})},
    async purgeSession(executorId: string, sessionId: string): Promise<void> {await post("session-purge", {executorId, sessionId})},
    async deleteSession(executorId: string, sessionId: string): Promise<void> {
      await post("session-delete", {executorId, sessionId})
    },
    attach: () => addAttachments(),
    attachFiles: (files: readonly File[]) => addAttachments(files),
    removeAttachment(id: string) {
      if (disposed || submitting || attaching) return
      const item = attachments.find(item => item.attachment.id === id)
      if (item && media?.source === item.attachment) {media = null; visibilityChanged()}
      item?.release()
      attachments = attachments.filter(item => item.attachment.id !== id)
      attachmentsEpoch++
      if (session) {
        forgetAccepted(session.id)
        retireMedia(session.id, [id])
        void persistMedia(session.id, attachments).catch(failure => {if (!disposed) {actionError = String(failure); notify()}})
      }
      notify()
    },
    preview(value: MediaPreview | null) {media = value; visibilityChanged(); notify()},
    setDraft(value: string) {
      if (disposed) return
      draft = value
      draftChanged = true
      draftEpoch++
      if (session) forgetAccepted(session.id)
      saveDraft()
      notify()
    },
    async send() {
      if (disposed || submitting || attaching || configuring || session?.configuring || view.status === "connecting") return
      submitting = true
      notify()
      try {
        await mediaRestoring
        if (disposed || session === null) return
        const text = draft
        const selectedDraftEpoch = draftEpoch
        const selectedAttachments = attachments
        if (text.trim().length === 0 && selectedAttachments.length === 0) return
        const target = {executorId: session.executorId, sessionId: session.sessionId}
        const key = session.id
        const hash = await requestHash(signature(text, selectedAttachments))
        if (disposed || session?.id !== key) return
        const previous = pendingReceipt(key)
        const request = previous?.hash === hash ? previous : {hash, requestId: crypto.randomUUID()}
        saveReceipt(key, request)
        const content = []
        for (const item of selectedAttachments) {
          const value = item.attachment
          let data = value.data
          if (data === undefined) {
            const bytes = new TextEncoder().encode(value.text ?? "")
            let binary = ""
            for (const byte of bytes) binary += String.fromCharCode(byte)
            data = btoa(binary)
          }
          const uploaded = await post("media-put", {...target, data, mimeType: value.mimeType, name: value.name, kind: value.kind,
            ...(value.text === undefined ? {} : {encoding: "utf8"})})
          if (!uploaded || typeof uploaded !== "object" || !("type" in uploaded) || uploaded.type !== "resource_link" ||
            !("uri" in uploaded) || typeof uploaded.uri !== "string" || !/^chat-media:[a-f0-9]{64}$/u.test(uploaded.uri)) throw new Error("Сервер не подтвердил сохранение вложения")
          content.push(uploaded)
        }
        if (!await perform(view.status === "running" ? "enqueue" : "prompt", {...target, requestId: request.requestId,
          ...(selectedAttachments.length === 0 ? {text} : {content: [...(text.length ? [{type: "text", text}] : []), ...content]})})) return
        // Принятый запрос не превращается в новый при ошибке очистки browser storage.
        saveReceipt(key, {...request, accepted: true})
        const sentIds = new Set(selectedAttachments.map(item => item.attachment.id))
        retireMedia(key, [...sentIds])
        for (const item of attachments) if (sentIds.has(item.attachment.id)) item.release()
        attachments = attachments.filter(item => !sentIds.has(item.attachment.id))
        attachmentsEpoch++
        media = null
        if (draftEpoch === selectedDraftEpoch) {draft = ""; saveDraft()}
        else forgetAccepted(key)
        visibilityChanged()
        notify()
        try {await persistMedia(key, attachments)}
        catch (failure) {if (!disposed) {actionError = `Сообщение принято, но не удалось очистить сохранённый черновик: ${failure instanceof Error ? failure.message : String(failure)}`; notify()}}
      } catch (failure) {
        if (!disposed) {actionError = failure instanceof Error ? failure.message : String(failure); notify()}
      } finally {
        submitting = false
        notify()
      }
    },
    async prepare() {
      if (disposed || configuring) return
      const identity = metadataIdentity(session)
      if (identity === undefined) {
        configuring = true
        notify()
        try {await perform("prepare", {})} finally {configuring = false; notify()}
        return
      }
      const execution = session!.execution!
      const probe = {identity, controller: new AbortController()}
      metadataProbe = probe
      configuring = true
      actionError = undefined
      notify()
      try {
        const settings = await post("execution-options", {
          connectionId: execution.effective.connectionId,
          ...(execution.effective.model === undefined ? {} : {model: execution.effective.model}),
        }, undefined, probe.controller.signal)
        probe.controller.signal.throwIfAborted()
        if (!disposed && metadataIdentity(session) === identity) {
          session = readChatBrowserSnapshot({...session!, settings}, address)
        }
      } catch (error) {
        if (!disposed && !probe.controller.signal.aborted && metadataIdentity(session) === identity) {
          actionError = error instanceof Error ? error.message : String(error)
        }
      } finally {
        if (metadataProbe === probe) {
          metadataProbe = null
          configuring = false
          notify()
        }
      }
    },
    async configure(id: string, value: string) {
      if (disposed || configuring || view.status === "running" || view.status === "connecting") return
      if (session && session.settings?.some(option => option.id === id && option.options.some(item => item.value === value))) pendingConfiguration = {sessionId: session.id, setting: {id, value}}
      configuring = true
      notify()
      try { await perform("configure", {id, value}) } finally { pendingConfiguration = null; configuring = false; notify() }
    },
    async configureExecution(selection: Selection) {
      if (disposed || configuring || view.status === "running" || view.status === "connecting") return
      if (session) pendingConfiguration = {sessionId: session.id, selection: {...selection}}
      configuring = true
      notify()
      try {await perform("execution-configure", {configuration: {scope: "session", selection}})} finally {pendingConfiguration = null; configuring = false; notify()}
    },
    cancel: () => {
      metadataProbe?.controller.abort()
      return perform("cancel", {})
    },
    stop: () => perform("stop", {}),
    async permission(id: string, optionId: string) {
      const requestHash = session?.permissions.find(item => item.id === id)?.requestHash
      if (!await perform("permission", {id, optionId, ...(requestHash ? {requestHash} : {})})) throw new Error(actionError ?? "Не удалось отправить решение")
    },
    dispose() {
      if (disposed) return
      disposed = true
      images.dispose()
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
      metadataProbe?.controller.abort()
      metadataProbe = null
      configuring = false
      finishRetry?.()
      activeSocket?.close()
      listeners.clear()
      session = null
      pendingConfiguration = null
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
    snapshot.activity !== undefined && !["responding", "waiting_for_approval", "cancelling", "recovery_required"].includes(snapshot.activity) ||
    snapshot.configuring !== undefined && typeof snapshot.configuring !== "boolean" ||
    snapshot.progress !== undefined && typeof snapshot.progress !== "string" ||
    snapshot.usage != null && (!Number.isFinite(snapshot.usage.used) || snapshot.usage.used < 0 ||
      !Number.isFinite(snapshot.usage.size) || snapshot.usage.size <= 0) ||
    snapshot.settings !== undefined && (!Array.isArray(snapshot.settings) || snapshot.settings.some(setting =>
      !setting || typeof setting.id !== "string" || typeof setting.name !== "string" || typeof setting.value !== "string" ||
      !["model", "thought_level", "mode"].includes(setting.category) || !Array.isArray(setting.options) || setting.options.some((option: NonNullable<ChatBrowserSnapshot["settings"]>[number]["options"][number]) =>
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
