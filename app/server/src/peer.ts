import {constants} from "node:fs"
import {open} from "node:fs/promises"
import {dirname, isAbsolute, join} from "node:path"
import type {PeerConnectionFactory, PeerNetwork, PeerNetworkOptions, PeerSnapshot, RelaySignalTransport, SignalTransport} from "@metafor/tech-peer"
import type {PeerClient} from "@zavx0z/provider-tech-peer/types"
import type {StorybookAppServer} from "../contract"
import type {OpenProviderPeer} from "./provider-routing"
import type {BrowserViewerPeerAdapter} from "./browser-viewer-peer"

/** Operator configuration живёт рядом с приватным daemon state, вне переносимых настроек Project. */
type Configuration = Exclude<NonNullable<StorybookAppServer.Input["peer"]>, false>

/** Preview client освобождает только свои signaling линии, сохраняя общую сеть у Server. */
type BrowserClient = BrowserViewerPeerAdapter & Readonly<{close(): void | Promise<void>}>

/** Подмены только публичных владельцев для изолированных проверок без настоящей сети. */
export type PeerExecutionDependencies = Readonly<{
  signaling?(options: {url: string, id: string, token: string, relay?: boolean}): Promise<SignalTransport>
  network?(options: PeerNetworkOptions): PeerNetwork
  routedNetwork?(options: PeerNetworkOptions & {bootstrap: RelaySignalTransport}): PeerNetwork
  rtc?(): PeerConnectionFactory
  client?(network: PeerNetwork): PeerClient
  browserClient?(network: PeerNetwork): BrowserClient
}>

/** Готовый runtime не раскрывает credentials; при отсутствии configuration openPeer не предоставляется. */
export type PeerExecution = Readonly<{
  openPeer?: OpenProviderPeer
  describeBrowser?: BrowserViewerPeerAdapter["describe"]
  createBrowserSocket?: BrowserViewerPeerAdapter["socket"]
  snapshot(): PeerSnapshot | undefined
  close(): Promise<void>
}>

/** Читает ограниченный обычный файл текущего пользователя без перехода по конечному symlink. */
async function privateFile(path: string, maximum: number): Promise<string> {
  if (!isAbsolute(path) || /[\u0000-\u001f\u007f]/u.test(path)) throw new TypeError("Peer private file требует абсолютный путь")
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid() || stat.size > maximum) {
      throw new Error("Peer configuration требует приватный обычный файл текущего пользователя")
    }
    return await file.readFile("utf8")
  } finally {await file.close()}
}

/** Проверяет configuration до передачи публичным transport factories, не раскрывая её значения в ошибке. */
function configuration(value: unknown): Configuration {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Некорректная peer configuration")
  const record = value as Record<string, unknown>
  if (Object.keys(record).some(key => !["id", "signalingUrl", "tokenFile", "iceServers", "relay"].includes(key))
    || typeof record.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(record.id)
    || typeof record.signalingUrl !== "string" || record.signalingUrl.length > 2048
    || typeof record.tokenFile !== "string" || !isAbsolute(record.tokenFile) || /[\u0000-\u001f\u007f]/u.test(record.tokenFile)) throw new TypeError("Некорректная peer configuration")
  let url: URL
  try {url = new URL(record.signalingUrl)} catch {throw new TypeError("Некорректный peer signaling URL")}
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError("Peer signaling URL не принимает credentials, query или fragment")
  if (record.relay !== undefined && typeof record.relay !== "boolean") throw new TypeError("Некорректный peer relay mode")
  if (record.iceServers !== undefined) {
    if (!Array.isArray(record.iceServers) || record.iceServers.length > 32) throw new TypeError("Некорректные peer ICE servers")
    for (const ice of record.iceServers) {
      if (!ice || typeof ice !== "object" || Array.isArray(ice) || Object.keys(ice).some(key => !["urls", "username", "credential"].includes(key))) throw new TypeError("Некорректные peer ICE servers")
      const urls = typeof ice.urls === "string" ? [ice.urls] : ice.urls
      if (!Array.isArray(urls) || !urls.length || urls.length > 16 || !urls.every(url => typeof url === "string" && url.length <= 2048 && /^(?:stun|stuns|turn|turns):[^\s]+$/u.test(url))) throw new TypeError("Некорректные peer ICE servers")
      for (const key of ["username", "credential"]) if (ice[key] !== undefined && (typeof ice[key] !== "string" || ice[key].length > 4096)) throw new TypeError("Некорректные peer ICE credentials")
    }
  }
  return structuredClone(record) as Configuration
}

/** Явное false выключает peer; отсутствующий приватный peer.json означает прежнюю process/SSH композицию. */
export async function loadPeerConfiguration(input: {peer?: Configuration | false, statePath: string}): Promise<Configuration | undefined> {
  if (input.peer === false) return
  if (input.peer !== undefined) return configuration(input.peer)
  let text: string
  try {text = await privateFile(join(dirname(input.statePath), "peer.json"), 65536)}
  catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") return
    throw new Error("Не удалось прочитать приватную peer configuration")
  }
  try {return configuration(JSON.parse(text))}
  catch {throw new Error("Некорректная приватная peer configuration")}
}

/** Отмена одного запроса не прерывает общий connect, используемый соседними сессиями. */
async function waitWithSignal<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort!: () => void
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, {once: true})
  })
  try {return await Promise.race([pending, cancelled])}
  finally {signal.removeEventListener("abort", abort)}
}

/**
Создаёт принадлежащую серверу исходящую peer сеть при первом открытии executor.
Public peer transport владеет signaling/RTC; Provider сохраняет ACP framing и
сессии. Явный relay включает routed transport и восстановление bootstrap у его
публичного владельца; потеря bootstrap сохраняет открытые прямые связи.
Никаких SSH fallback и повторов prompt здесь нет. close освобождает
Provider client, затем сеть и bootstrap, включая незавершённую подготовку.
*/
export function createPeerExecution(value: Configuration | undefined, dependencies: PeerExecutionDependencies = {}): PeerExecution {
  if (value === undefined) return {snapshot: () => undefined, async close() {}}
  const config = configuration(value)
  let network: PeerNetwork | undefined
  let client: PeerClient | undefined
  let browserClient: BrowserClient | undefined
  let browserPreparing: Promise<BrowserClient> | undefined
  let preparing: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let disposed = false
  const connects = new Map<string, Promise<void>>()
  /** После явного отказа следующая заявка вправе заново открыть bootstrap, без повтора предыдущей ACP команды. */
  const ready = () => preparing ??= (async () => {
    let bootstrap: SignalTransport | undefined
    try {
      let token: string
      try {token = (await privateFile(config.tokenFile, 4096)).trim()}
      catch {throw new Error("Не удалось прочитать приватный peer token")}
      if (token.length < 16) throw new Error("Некорректный приватный peer token")
      const [signaling, rtc, createNetwork, createClient] = await Promise.all([
        dependencies.signaling ?? import("@metafor/tech-peer/signaling").then(module => module.connectWebSocketSignaling),
        dependencies.rtc ?? import("@metafor/tech-peer/werift").then(module => module.createWeriftPeerConnectionFactory),
        config.relay === true
          ? dependencies.routedNetwork ?? import("@metafor/tech-peer").then(module => module.createRoutedPeerNetwork)
          : dependencies.network ?? import("@metafor/tech-peer").then(module => module.createPeerNetwork),
        dependencies.client ?? import("@zavx0z/provider-tech-peer").then(module => module.default.createPeerClient),
      ])
      if (disposed) throw new Error("Peer execution закрыт")
      bootstrap = await signaling({url: config.signalingUrl, id: config.id, token,
        ...(config.relay === true ? {relay: true} : {})})
      token = ""
      if (disposed) throw new Error("Peer execution закрыт")
      network = createNetwork({id: config.id, rtc: rtc(), bootstrap: bootstrap as RelaySignalTransport,
        ...(config.iceServers === undefined ? {} : {iceServers: config.iceServers.map(ice => ({...ice, urls: typeof ice.urls === "string" ? ice.urls : [...ice.urls]}))})})
      client = createClient(network)
    } catch (error) {
      if (network) await network.close()
      else bootstrap?.close()
      network = undefined
      client = undefined
      preparing = undefined
      throw error
    }
  })()
  /** ACP и preview разделяют одну прямую связь, сохраняя независимые owned линии. */
  const connect = async (peerId: string, signal: AbortSignal) => {
    if (disposed) throw new Error("Peer execution закрыт")
    signal.throwIfAborted()
    await waitWithSignal(ready(), signal)
    if (disposed) throw new Error("Peer execution закрыт")
    signal.throwIfAborted()
    if (!network!.snapshot().links.some(link => link.peerId === peerId && link.state === "open")) {
      let pending = connects.get(peerId)
      if (!pending) {
        pending = network!.connect(peerId)
        connects.set(peerId, pending)
        void pending.finally(() => connects.delete(peerId)).catch(() => {})
      }
      await waitWithSignal(pending, signal)
    }
    if (disposed) throw new Error("Peer execution закрыт")
    signal.throwIfAborted()
  }
  /** Загружает public Provider preview adapter только после явной заявки, без process fallback. */
  const browser = () => browserPreparing ??= (async () => {
    const factory = dependencies.browserClient ?? (await import("@zavx0z/provider-tech-peer/browser")).default.createBrowserPeerClient
    const value = factory(network!)
    if (disposed) {
      await value.close()
      throw new Error("Peer preview закрыт")
    }
    return browserClient = value
  })().catch(error => {
    browserPreparing = undefined
    throw error
  })
  return {
    async openPeer(input) {
      await connect(input.peerId, input.signal)
      const owned = await client!.open({peerId: input.peerId, executorId: input.executorId, assignmentId: input.assignmentId,
        ...(input.previousSessionId === undefined ? {} : {previousSessionId: input.previousSessionId}), signal: input.signal})
      if (disposed || input.signal.aborted) {
        await owned.dispose()
        input.signal.throwIfAborted()
        throw new Error("Peer execution закрыт")
      }
      return owned
    },
    async describeBrowser(input) {
      await connect(input.peerId, input.signal)
      const adapter = await waitWithSignal(browser(), input.signal)
      input.signal.throwIfAborted()
      return adapter.describe(input)
    },
    createBrowserSocket(input) {
      if (disposed) throw new Error("Peer preview закрыт")
      if (!browserClient) throw new Error("Peer preview требует предварительную проверку профиля")
      return browserClient.socket(input)
    },
    snapshot() {
      const current = network?.snapshot()
      return current === undefined ? undefined : {id: current.id, peers: [...current.peers], bootstrap: current.bootstrap,
        links: current.links.map(link => ({peerId: link.peerId, generation: link.generation, state: link.state,
          ...(link.via === undefined ? {} : {via: link.via}), ...(link.transport === undefined ? {} : {transport: link.transport})}))}
    },
    close() {
      if (closing) return closing
      disposed = true
      closing = (async () => {
        await preparing?.catch(() => {})
        await browserPreparing?.catch(() => {})
        const closed = await Promise.allSettled([client?.close(), browserClient?.close()])
        await network?.close()
        connects.clear()
        const failures = closed.flatMap(result => result.status === "rejected" ? [result.reason] : [])
        if (failures.length) throw new AggregateError(failures, "Не подтверждено освобождение peer clients")
      })()
      return closing
    },
  }
}
