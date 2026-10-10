import {createHash, randomBytes} from "node:crypto"
import type {StorybookAppSettings} from "@zavx0z/storybook-app-settings"
import state from "@zavx0z/storybook-app-server-state"
import type {ProviderTechSsh} from "@zavx0z/provider-tech-ssh"
import type {BrowserViewerClient as Client} from "../contract/browser-viewer-client"
import type {BrowserViewerRelay} from "../contract/browser-viewer-relay"

type Connection = Awaited<ReturnType<StorybookAppSettings.Output["read"]>>["connections"][number]
type BrowserConnection = Extract<Connection, {provider: "capsule" | "chrome-studio"}>
export type BrowserViewerDescriptor = Readonly<{instanceId: string, profile: string, socketPath: string, controlEnabled: boolean}>
type Socket = Pick<WebSocket, "readyState" | "bufferedAmount" | "send" | "close" | "addEventListener">
const FRAME_BYTES = 65_536
const BUFFER_BYTES = 262_144
const STATE_BYTES = 262_144
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value)
const token = (value: unknown, maximum: number): value is string => typeof value === "string" && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9_.:-]+$/u.test(value)

type Entry = {
  connection: BrowserConnection
  fingerprint: string
  instanceId?: string
  origin?: string
  tunnel?: ProviderTechSsh.Output
  timer?: ReturnType<typeof setTimeout>
  expiresAt: number
  used: boolean
  closed: boolean
  preparing: boolean
  cleanupFinished: boolean
  relay?: BrowserViewerRelay
  abort?: () => void
  controller: AbortController
  cleanup?: Promise<void>
}

/** Билеты относятся только к сохранённому подключению и существующему active instance. */
export function createBrowserViewerAccess(options: Readonly<{
  connections(): Promise<readonly Connection[]>
  fetch?: (input: string | URL, init?: RequestInit) => Promise<Response>
  tunnel?: (input: ProviderTechSsh.Input) => Promise<ProviderTechSsh.Output>
  socket?: (url: string) => Socket
  now?: () => number
  ticketTtlMs?: number
  maximum?: number
}>) {
  const now = options.now ?? Date.now
  const ttl = options.ticketTtlMs ?? 30_000
  const maximum = options.maximum ?? 4
  if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 120_000 || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 16) throw new RangeError("Некорректный предел viewer")
  const entries = new Map<string, Entry>()
  // Удаление билета запрещает upgrade, а слот живёт до завершения подготовки и cleanup.
  const owned = new Set<Entry>()
  const preparing = new Set<Promise<unknown>>()
  const cleanup = new Set<Promise<void>>()
  let disposed = false
  const trackCleanup = (promise: Promise<void>) => {
    cleanup.add(promise)
    void promise.finally(() => cleanup.delete(promise)).catch(() => {})
    return promise
  }
  const releaseOwned = (entry: Entry) => {
    if (entry.closed && !entry.preparing && entry.cleanupFinished) owned.delete(entry)
  }
  const close = (ticket: string, entry: Entry): Promise<void> => {
    if (entry.closed) return entry.cleanup ?? Promise.resolve()
    entry.closed = true
    entries.delete(ticket)
    entry.controller.abort(new Error("Подключение viewer закрыто"))
    clearTimeout(entry.timer)
    entry.abort?.()
    entry.cleanup = trackCleanup(Promise.allSettled([entry.relay?.close(), entry.tunnel?.dispose()]).then(() => {
      entry.cleanupFinished = true
      releaseOwned(entry)
    }))
    return entry.cleanup
  }
  async function connection(id: unknown): Promise<BrowserConnection> {
    if (typeof id !== "string" || !id || id.length > 200) throw new TypeError("Нужно сохранённое подключение браузера")
    const matches = (await options.connections()).filter(item => item.id === id)
    const selected = matches.length === 1 ? matches[0] : undefined
    if (!selected || (selected.provider !== "capsule" && selected.provider !== "chrome-studio") || !selected.enabled) throw new Error("Подключение браузера недоступно или отключено")
    const url = new URL(selected.endpoint.url)
    if (!["http:", "https:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new TypeError("Для браузера нужен сохранённый loopback origin")
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(selected.endpoint.profile) || !["qwen", "deepseek", "chatgpt"].includes(selected.endpoint.service)) throw new TypeError("Некорректный профиль браузера")
    return selected
  }
  async function active(entry: Entry, signal: AbortSignal): Promise<string> {
    const path = entry.connection.provider === "capsule" ? "/api/studio/lifecycle/state"
      : `/api/profiles/browser-control?name=${encodeURIComponent(entry.connection.endpoint.profile)}`
    const response = await (options.fetch ?? fetch)(new URL(path, entry.origin), {signal, redirect: "error"})
    if (!response.ok || !response.body) throw new Error("Не удалось прочитать состояние Capsule")
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        signal.throwIfAborted()
        const next = await reader.read()
        if (next.done) break
        bytes += next.value.byteLength
        if (bytes > STATE_BYTES) throw new Error("Слишком большой ответ Capsule")
        chunks.push(next.value)
      }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {reader.releaseLock()}
    const source = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {source.set(chunk, offset); offset += chunk.byteLength}
    const value: unknown = JSON.parse(new TextDecoder().decode(source))
    if (entry.connection.provider === "chrome-studio") {
      if (!object(value) || value.ok !== true || !object(value.connection)
        || value.connection.profileName !== entry.connection.endpoint.profile
        || typeof value.connection.webSocketDebuggerUrl !== "string") throw new Error("Studio не подтвердила запущенный профиль")
      const endpoint = new URL(value.connection.webSocketDebuggerUrl)
      if (endpoint.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
        || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
        || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/u.test(endpoint.pathname)) throw new Error("Некорректный экземпляр Chrome Studio")
      return createHash("sha256").update(endpoint.href).digest("hex")
    }
    if (!object(value) || value.ok !== true || !Array.isArray(value.sessions) || !value.sessions.every(object)) throw new Error("Некорректное состояние Capsule")
    const matches = value.sessions.filter(session => session.profileName === entry.connection.endpoint.profile && session.active === true)
    if (matches.length !== 1 || matches[0]!.containerState !== "running" || !token(matches[0]!.instanceId, 128)) throw new Error("Нужен единственный запущенный экземпляр выбранного профиля Capsule")
    return matches[0]!.instanceId
  }
  async function open(id: unknown, signal: AbortSignal): Promise<BrowserViewerDescriptor> {
    signal.throwIfAborted()
    if (disposed) throw new Error("Viewer недоступен")
    const selected = await connection(id)
    signal.throwIfAborted()
    if (disposed || owned.size >= maximum) throw new Error("Превышено число подключений viewer")
    const ticket = randomBytes(32).toString("base64url")
    const entry: Entry = {connection: structuredClone(selected), fingerprint: fingerprint(selected), expiresAt: Infinity, used: false, closed: false, preparing: true, cleanupFinished: false, controller: new AbortController()}
    entries.set(ticket, entry)
    owned.add(entry)
    const cancel = () => {void close(ticket, entry)}
    signal.addEventListener("abort", cancel, {once: true})
    entry.abort = () => signal.removeEventListener("abort", cancel)
    const preparation = (async () => {
      try {
        let origin = new URL(selected.endpoint.url)
        if (selected.ssh) {
          const {host, user, port} = selected.ssh
          const tunnel = await (options.tunnel ?? (async input => (await import("@zavx0z/provider-tech-ssh")).default(input)))({host,
            ...(user === undefined ? {} : {user}), ...(port === undefined ? {} : {port}),
            destination: {host: origin.hostname.replace(/^\[|\]$/gu, ""), port: Number(origin.port || (origin.protocol === "https:" ? 443 : 80))}})
          if (entry.closed) {await tunnel.dispose(); throw new Error("Подключение viewer отменено")}
          entry.tunnel = tunnel
          origin.hostname = "127.0.0.1"
          origin.port = String(tunnel.port)
        }
        entry.origin = origin.origin
        entry.instanceId = await active(entry, AbortSignal.any([signal, entry.controller.signal, AbortSignal.timeout(20_000)]))
        signal.throwIfAborted()
        if (entry.closed || disposed) throw new Error("Подключение viewer отменено")
        if (fingerprint(await connection(id)) !== entry.fingerprint) throw new Error("Подключение браузера изменилось")
        signal.throwIfAborted()
        if (entry.closed || disposed) throw new Error("Подключение viewer отменено")
        entry.expiresAt = now() + ttl
        entry.timer = setTimeout(cancel, ttl)
        entry.timer.unref()
        return {instanceId: entry.instanceId, profile: selected.endpoint.profile, controlEnabled: selected.provider === "capsule", socketPath: `/api/browser/browser-viewer?ticket=${ticket}`}
      } catch (error) {await close(ticket, entry); throw error}
    })()
    preparing.add(preparation)
    try {return await preparation} finally {
      preparing.delete(preparation)
      entry.preparing = false
      releaseOwned(entry)
    }
  }
  async function consume(ticket: string, peer: string, signal: AbortSignal): Promise<BrowserViewerRelay> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(ticket) || !token(peer, 192)) throw new state.ExternalStorybookSecurityError("invalid-browser-session", 401, "Некорректный билет или peer viewer")
    const entry = entries.get(ticket)
    if (!entry || entry.used || !entry.instanceId || entry.closed || entry.expiresAt <= now() || disposed) {
      if (entry && entry.expiresAt <= now()) await close(ticket, entry)
      throw new state.ExternalStorybookSecurityError("invalid-browser-session", 401, "Билет viewer использован, истёк или недоступен")
    }
    entry.used = true
    const cancel = () => {void close(ticket, entry)}
    signal.addEventListener("abort", cancel, {once: true})
    const previousAbort = entry.abort
    entry.abort = () => {previousAbort?.(); signal.removeEventListener("abort", cancel)}
    try {
      signal.throwIfAborted()
      if (fingerprint(await connection(entry.connection.id)) !== entry.fingerprint) throw new Error("Подключение браузера изменилось")
      const current = await active(entry, AbortSignal.any([signal, entry.controller.signal, AbortSignal.timeout(10_000)]))
      if (current !== entry.instanceId) throw new Error("Экземпляр Capsule изменился")
      signal.throwIfAborted()
      if (entry.closed) throw new Error("Подключение viewer отменено")
      const url = new URL("/rtc/signaling", entry.origin)
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      url.searchParams.set("profile", entry.connection.provider === "capsule" ? entry.instanceId : entry.connection.endpoint.profile)
      url.searchParams.set("role", "viewer")
      url.searchParams.set("peer", peer)
      const relay = signalingRelay(url.toString(), options.socket ?? (url => new WebSocket(url)), cancel,
        () => {clearTimeout(entry.timer); entry.abort?.(); delete entry.timer})
      entry.relay = relay
      return {attach: relay.attach, message: relay.message, close: () => close(ticket, entry)}
    } catch (error) {await close(ticket, entry); throw error}
  }
  return {
    open, consume,
    async invalidate() {
      const current = await options.connections()
      await Promise.all([...entries].filter(([, entry]) => !current.some(value => value.id === entry.connection.id && value.enabled && fingerprint(value) === entry.fingerprint)).map(([ticket, entry]) => close(ticket, entry)))
    },
    async dispose() {
      disposed = true
      await Promise.all([...entries].map(([ticket, entry]) => close(ticket, entry)))
      await Promise.allSettled([...preparing])
      await Promise.allSettled([...cleanup])
    },
  }
}

function fingerprint(connection: Connection): string {
  return JSON.stringify((connection.provider === "capsule" || connection.provider === "chrome-studio") ? [connection.id, connection.provider, connection.enabled, connection.endpoint, connection.ssh] : [connection.id, connection.provider])
}

function signalingRelay(url: string, factory: (url: string) => Socket, release: () => void, connected: () => void): BrowserViewerRelay {
  let client: Client | undefined
  let upstream: Socket | undefined
  let closed = false
  const queue: string[] = []
  let queuedBytes = 0
  let opening: ReturnType<typeof setTimeout> | undefined
  const stop = (code = 1000, reason = "Viewer отключён") => {
    if (closed) return
    closed = true
    clearTimeout(opening)
    queue.length = 0
    try {client?.close(code, reason)} catch {}
    try {upstream?.close(code, reason)} catch {}
    release()
  }
  const bounded = (value: unknown): value is string => typeof value === "string" && Buffer.byteLength(value) <= FRAME_BYTES
  return {
    attach(value) {
      if (closed) {value.close(1001, "Viewer отключён"); return}
      if (client) throw new Error("Viewer уже подключён")
      client = value
      connected()
      try {
        upstream = factory(url)
        opening = setTimeout(() => stop(1013, "Capsule не подключилась"), 10_000)
        opening.unref()
        upstream.addEventListener("open", () => {
          if (closed) return
          clearTimeout(opening)
          try {for (const message of queue) upstream!.send(message)} catch {stop(1011, "Ошибка signaling")}
          queue.length = 0
          queuedBytes = 0
        })
        upstream.addEventListener("message", event => {
          if (closed) return
          const value = (event as MessageEvent).data
          if (!bounded(value)) {stop(1009, "Недопустимый signaling frame"); return}
          if (client!.getBufferedAmount() + Buffer.byteLength(value) > BUFFER_BYTES) {stop(1013, "Viewer не успевает читать"); return}
          try {client!.send(value)} catch {stop(1011, "Ошибка signaling")}
        })
        upstream.addEventListener("error", () => stop(1011, "Ошибка signaling Capsule"))
        upstream.addEventListener("close", () => stop(1000, "Capsule отключилась"))
      } catch {stop(1011, "Ошибка подключения Capsule")}
    },
    message(value) {
      if (closed) return
      if (!bounded(value)) {stop(1009, "Недопустимый signaling frame"); return}
      if (upstream?.readyState === WebSocket.OPEN) {
        if (upstream.bufferedAmount + Buffer.byteLength(value) > BUFFER_BYTES) {stop(1013, "Capsule не успевает читать"); return}
        try {upstream.send(value)} catch {stop(1011, "Ошибка signaling")}
      } else if (queue.length < 8 && queuedBytes + Buffer.byteLength(value) <= FRAME_BYTES) {
        queue.push(value)
        queuedBytes += Buffer.byteLength(value)
      } else {stop(1009, "Переполнена очередь signaling")}
    },
    async close() {stop()},
  }
}
