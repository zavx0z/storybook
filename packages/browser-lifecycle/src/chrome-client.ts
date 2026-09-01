import {createHash} from "node:crypto"
import {existsSync, mkdirSync, readFileSync, unlinkSync} from "node:fs"
import {join, resolve} from "node:path"
import {StorybookCdpConnection, type StorybookCdpWebSocketFactory} from "./cdp-connection.ts"
import {withStorybookBrowserLock} from "./target-operation-lock.ts"
import type {
  ChromeTargetSummary,
  StorybookBridgeClip,
  StorybookBridgeMethod,
  StorybookChromeClient,
  StorybookChromeConsoleEntry,
  StorybookProcessStart,
} from "./contract.ts"

export type StorybookCdpClientOptions = Readonly<{
  origin?: string
  fetcher?: typeof fetch
  webSocketFactory?: StorybookCdpWebSocketFactory
  requestTimeoutMs?: number
  launchIfMissing?: boolean
  stateRoot?: string
  chromeBinary?: string
  spawnChrome?: (command: readonly string[]) => void
  processStart?: StorybookProcessStart
}>

type StorybookCdpTarget = ChromeTargetSummary & Readonly<{webSocketDebuggerUrl: string}>

const BRIDGE_GLOBAL = "__EXTERNAL_STORYBOOK_AGENT_BRIDGE__"

/** Storybook-owned direct Chrome DevTools Protocol client. */
export class StorybookCdpClient implements StorybookChromeClient {
  readonly #configuredOrigin: string | null
  readonly #fetcher: typeof fetch
  readonly #webSocketFactory: StorybookCdpWebSocketFactory | undefined
  readonly #requestTimeoutMs: number
  readonly #launchIfMissing: boolean
  readonly #stateRoot: string
  readonly #chromeBinary: string | undefined
  readonly #spawnChrome: (command: readonly string[]) => void
  readonly #processStart: StorybookProcessStart | undefined
  #originPromise: Promise<string> | null = null

  constructor(options: StorybookCdpClientOptions = {}) {
    const configured = options.origin ?? Bun.env.STORYBOOK_CDP_ORIGIN
    this.#configuredOrigin = configured === undefined ? null : chromeOrigin(configured)
    this.#fetcher = options.fetcher ?? globalThis.fetch
    this.#webSocketFactory = options.webSocketFactory
    this.#requestTimeoutMs = boundedTimeout(options.requestTimeoutMs ?? 30_000, 100, 120_000)
    this.#launchIfMissing = options.launchIfMissing ?? true
    this.#stateRoot = resolve(options.stateRoot ?? join(process.cwd(), ".storybook-browser-lifecycle"))
    this.#chromeBinary = options.chromeBinary
    this.#spawnChrome = options.spawnChrome ?? ((command) => spawnOwnedChrome(command, this.#stateRoot))
    this.#processStart = options.processStart
  }

  async health(signal?: AbortSignal): Promise<void> {
    const origin = await this.cdpOrigin(signal)
    try {
      await this.#version(origin, signal)
    } catch (error) {
      if (this.#configuredOrigin !== null) throw error
      this.#originPromise = null
      await this.#version(await this.cdpOrigin(signal), signal)
    }
  }

  cdpOrigin(signal?: AbortSignal): Promise<string> {
    this.#originPromise ??= this.#resolveOrigin(signal).catch((error) => {
      this.#originPromise = null
      throw error
    })
    return this.#originPromise
  }

  async browserIdentity(signal?: AbortSignal): Promise<string> {
    const version = await this.#version(await this.cdpOrigin(signal), signal)
    return createHash("sha256")
      .update("external-storybook-cdp-browser\0")
      .update(version.webSocketDebuggerUrl)
      .digest("hex")
  }

  async targets(signal?: AbortSignal): Promise<readonly ChromeTargetSummary[]> {
    return Object.freeze((await this.#targetInventory(signal)).map(({targetId, type, title, url}) =>
      Object.freeze({targetId, type, title, url})))
  }

  async createTarget(url: string, signal?: AbortSignal): Promise<ChromeTargetSummary> {
    const targetUrl = absoluteHttpUrl(url)
    const before = new Set((await this.#targetInventory(signal)).map(({targetId}) => targetId))
    signal?.throwIfAborted()
    try {
      const result = await this.#withBrowser((connection) => {
        signal?.throwIfAborted()
        // Once the non-idempotent command is sent, caller cancellation must not
        // discard the targetId. The package lock keeps this bounded handoff unique.
        return connection.command("Target.createTarget", {
          url: targetUrl,
          background: true,
        }, {timeoutMs: Math.min(this.#requestTimeoutMs, 10_000)})
      }, signal)
      const targetId = exactTargetId(result.targetId)
      return Object.freeze({targetId, type: "page", title: "", url: targetUrl})
    } catch (error) {
      const recovered = await this.#recoverCreatedTarget(targetUrl, before)
      if (recovered !== null) return recovered
      throw error
    }
  }

  async closeTarget(targetId: string, signal?: AbortSignal): Promise<void> {
    const result = await this.#withBrowser((connection) => connection.command("Target.closeTarget", {
      targetId: exactTargetId(targetId),
    }, {signal, timeoutMs: 5_000}), signal)
    if (result.success !== true) throw new Error("Storybook CDP did not close the target")
  }

  async navigate(targetId: string, url: string, signal?: AbortSignal): Promise<void> {
    const targetUrl = absoluteHttpUrl(url)
    await this.#withTarget(targetId, async (connection) => {
      await connection.command("Page.enable", {}, {signal, timeoutMs: 5_000})
      const result = await connection.command("Page.navigate", {url: targetUrl}, {
        signal,
        timeoutMs: this.#requestTimeoutMs,
      })
      if (typeof result.errorText === "string" && result.errorText.length > 0) {
        throw new Error(`Storybook CDP navigation failed: ${result.errorText}`)
      }
    }, signal)
    // Navigation destroys the old Runtime context. Reconnect before polling so a
    // pending evaluation can never pin the previous context.
    await this.waitReady(targetId, this.#requestTimeoutMs, signal)
  }

  async waitReady(targetId: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
    const bounded = boundedTimeout(timeoutMs, 100, 120_000)
    const deadline = Date.now() + bounded
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      try {
        await this.#withTarget(targetId, (connection) => waitReadyConnection(
          connection,
          Math.max(100, deadline - Date.now()),
          signal,
        ), signal)
        return
      } catch (error) {
        if (!(error instanceof StorybookCdpTargetTransition)) throw error
      }
      await abortableDelay(25, signal)
    }
    throw new DOMException("Storybook CDP target transition timed out", "TimeoutError")
  }

  async consoleEntries(
    targetId: string,
    durationMs: number,
    signal?: AbortSignal,
  ): Promise<readonly StorybookChromeConsoleEntry[]> {
    const bounded = boundedTimeout(durationMs, 0, 30_000)
    return this.#withTarget(targetId, async (connection) => {
      const entries: StorybookChromeConsoleEntry[] = []
      const unsubscribe = connection.onMessage((message) => {
        if (message.method === "Runtime.consoleAPICalled") {
          const params = objectValue(message.params, "console params")
          const args = Array.isArray(params.args) ? params.args : []
          entries.push(Object.freeze({
            source: "console",
            type: typeof params.type === "string" ? params.type : "log",
            level: typeof params.type === "string" ? consoleLevel(params.type) : "log",
            text: args.map(remoteObjectText).join(" ").slice(0, 8_192),
            ...(typeof params.timestamp === "number" ? {timestamp: params.timestamp} : {}),
          }))
        } else if (message.method === "Log.entryAdded") {
          const params = objectValue(message.params, "log params")
          const entry = objectValue(params.entry, "log entry")
          entries.push(Object.freeze({
            source: "log",
            type: typeof entry.source === "string" ? entry.source : "log",
            level: typeof entry.level === "string" ? entry.level : "log",
            text: typeof entry.text === "string" ? entry.text.slice(0, 8_192) : "",
            ...(typeof entry.url === "string" ? {url: entry.url} : {}),
            ...(typeof entry.lineNumber === "number" ? {line: entry.lineNumber} : {}),
            ...(typeof entry.timestamp === "number" ? {timestamp: entry.timestamp} : {}),
          }))
        }
      })
      try {
        await connection.command("Runtime.enable", {}, {signal, timeoutMs: 5_000})
        await connection.command("Log.enable", {}, {signal, timeoutMs: 5_000})
        if (bounded > 0) await abortableDelay(bounded, signal)
      } finally {
        unsubscribe()
      }
      return Object.freeze(entries)
    }, signal)
  }

  async callBridge(
    targetId: string,
    method: StorybookBridgeMethod,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const exactMethod = bridgeMethod(method)
    const expression = `globalThis[${safeJson(BRIDGE_GLOBAL)}]?.call(${safeJson(exactMethod)}, ${safeJson(params)})`
    return this.#evaluate(targetId, expression, {awaitPromise: true, signal, timeoutMs: this.#requestTimeoutMs})
  }

  async bridgeDiagnostics(targetId: string, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    const expression = `(() => ({
      readyState: document.readyState,
      bridge: typeof globalThis[${safeJson(BRIDGE_GLOBAL)}],
      viewName: globalThis.name,
      markers: {
        state: document.documentElement.dataset.externalStorybook ?? null,
        package: document.documentElement.dataset.externalStorybookPackage ?? null,
        packageId: document.documentElement.dataset.externalStorybookPackageId ?? null,
        route: document.documentElement.dataset.externalStorybookRoute ?? null,
        revision: document.documentElement.dataset.externalStorybookRevision ?? null,
        error: document.documentElement.dataset.externalStorybookError ?? null,
        phase: document.documentElement.dataset.externalStorybookPhase ?? null,
        shellPhase: document.documentElement.dataset.externalStorybookShellPhase ?? null,
      },
      scripts: Array.from(document.scripts, script => script.src ? new URL(script.src).pathname : "inline").slice(0, 16),
      resources: performance.getEntriesByType("resource")
        .map(entry => ({name: new URL(entry.name).pathname, type: entry.initiatorType, duration: Math.round(entry.duration)}))
        .slice(0, 24),
    }))()`
    const value = await this.#evaluate(targetId, expression, {signal, timeoutMs: 5_000})
    return Object.freeze(objectValue(value, "Storybook bridge diagnostics"))
  }

  async screenshot(
    targetId: string,
    options: Readonly<{caption: string; clip?: StorybookBridgeClip; timeoutMs?: number}>,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    boundedText(options.caption, "screenshot caption", 512)
    const timeoutMs = boundedTimeout(options.timeoutMs ?? this.#requestTimeoutMs, 100, 120_000)
    return this.#withTarget(targetId, async (connection) => {
      await connection.command("Page.enable", {}, {signal, timeoutMs: 5_000})
      await waitReadyConnection(connection, timeoutMs, signal)
      const result = await connection.command("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
        ...(options.clip === undefined ? {} : {clip: screenshotClip(options.clip)}),
      }, {signal, timeoutMs})
      if (typeof result.data !== "string" || result.data.length === 0) {
        throw new Error("Storybook CDP returned no screenshot data")
      }
      return new Uint8Array(Buffer.from(result.data, "base64"))
    }, signal)
  }

  async #evaluate(
    targetId: string,
    expression: string,
    options: Readonly<{awaitPromise?: boolean; signal?: AbortSignal | undefined; timeoutMs: number}>,
  ): Promise<unknown> {
    return this.#withTarget(targetId, async (connection) => {
      await connection.command("Runtime.enable", {}, {signal: options.signal, timeoutMs: 5_000})
      const command = await connection.command("Runtime.evaluate", {
        expression,
        awaitPromise: options.awaitPromise ?? false,
        returnByValue: true,
      }, {signal: options.signal, timeoutMs: options.timeoutMs})
      if (command.exceptionDetails !== undefined) {
        throw new Error(`Storybook agent bridge call failed: ${remoteExceptionMessage(command.exceptionDetails)}`)
      }
      const result = objectValue(command.result, "Runtime.evaluate result")
      if (result.subtype === "error" || result.type === "undefined") {
        throw new Error("Storybook agent bridge is unavailable in the exact target")
      }
      return result.value
    }, options.signal)
  }

  async #withBrowser<Value>(
    operation: (connection: StorybookCdpConnection) => Promise<Value>,
    signal?: AbortSignal,
  ): Promise<Value> {
    const version = await this.#version(await this.cdpOrigin(signal), signal)
    const connection = await StorybookCdpConnection.connect(version.webSocketDebuggerUrl, {
      ...(this.#webSocketFactory === undefined ? {} : {factory: this.#webSocketFactory}),
      ...(signal === undefined ? {} : {signal}),
      timeoutMs: 5_000,
    })
    try {
      return await operation(connection)
    } finally {
      connection.close()
    }
  }

  async #withTarget<Value>(
    targetId: string,
    operation: (connection: StorybookCdpConnection) => Promise<Value>,
    signal?: AbortSignal,
  ): Promise<Value> {
    const exactId = exactTargetId(targetId)
    const target = (await this.#targetInventory(signal)).find((candidate) => candidate.targetId === exactId)
    if (target === undefined) throw new StorybookCdpTargetTransition()
    const connection = await StorybookCdpConnection.connect(target.webSocketDebuggerUrl, {
      ...(this.#webSocketFactory === undefined ? {} : {factory: this.#webSocketFactory}),
      ...(signal === undefined ? {} : {signal}),
      timeoutMs: 5_000,
    })
    try {
      return await operation(connection)
    } finally {
      connection.close()
    }
  }

  async #targetInventory(signal?: AbortSignal): Promise<readonly StorybookCdpTarget[]> {
    const origin = await this.cdpOrigin(signal)
    const value = await this.#json(new URL("/json/list", origin), signal, 5_000)
    if (!Array.isArray(value)) throw new Error("Storybook CDP returned no target inventory")
    return Object.freeze(value.flatMap((candidate, index) => {
      try {
        const target = targetSummary(candidate, `target ${index}`, origin)
        return target.type === "page" ? [target] : []
      } catch {
        return []
      }
    }))
  }

  async #version(origin: string, signal?: AbortSignal): Promise<Readonly<{
    browser: string
    webSocketDebuggerUrl: string
  }>> {
    const value = objectValue(await this.#json(new URL("/json/version", origin), signal, 3_000), "CDP version")
    const browser = boundedText(value.Browser, "CDP browser", 256)
    const webSocketDebuggerUrl = exactCdpWebSocketUrl(value.webSocketDebuggerUrl, origin)
    return Object.freeze({browser, webSocketDebuggerUrl})
  }

  async #json(url: URL, signal: AbortSignal | undefined, timeoutMs: number): Promise<unknown> {
    const response = await this.#fetcher(url, {
      headers: {accept: "application/json"},
      redirect: "error",
      signal: combinedSignal(signal, timeoutMs),
    })
    if (!response.ok) throw new Error(`Storybook CDP HTTP failed: ${response.status}`)
    return response.json()
  }

  async #resolveOrigin(signal?: AbortSignal): Promise<string> {
    if (this.#configuredOrigin !== null) {
      await this.#version(this.#configuredOrigin, signal)
      return this.#configuredOrigin
    }
    for (const candidate of [ownedChromeOrigin(this.#stateRoot), "http://127.0.0.1:9222"]) {
      if (candidate === null) continue
      try {
        await this.#version(candidate, signal)
        return candidate
      } catch {
        // Try the next owned/direct endpoint before launching Chrome.
      }
    }
    if (!this.#launchIfMissing) throw new Error("Storybook Chrome CDP is unavailable")
    return withStorybookBrowserLock({
      root: join(this.#stateRoot, "locks"),
      scope: "owned-chrome-launch",
      timeoutMs: 20_000,
      ...(signal === undefined ? {} : {signal}),
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      const existing = ownedChromeOrigin(this.#stateRoot)
      if (existing !== null) {
        try {
          await this.#version(existing, signal)
          return existing
        } catch {
          // Stale DevToolsActivePort belongs to no healthy owned Chrome.
        }
      }
      const profile = join(this.#stateRoot, "chrome-profile")
      mkdirSync(profile, {recursive: true, mode: 0o700})
      const activePort = join(profile, "DevToolsActivePort")
      if (existsSync(activePort)) unlinkSync(activePort)
      const binary = this.#chromeBinary ?? discoverChromeBinary()
      this.#spawnChrome([
        binary,
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--no-startup-window",
      ])
      const deadline = Date.now() + 20_000
      while (Date.now() < deadline) {
        signal?.throwIfAborted()
        const origin = ownedChromeOrigin(this.#stateRoot)
        if (origin !== null) {
          try {
            await this.#version(origin, signal)
            return origin
          } catch {
            // Chrome may publish the file shortly before its endpoint is ready.
          }
        }
        await abortableDelay(50, signal)
      }
      throw new DOMException("Storybook owned Chrome startup timed out", "TimeoutError")
    })
  }

  async #recoverCreatedTarget(
    url: string,
    previousTargetIds: ReadonlySet<string>,
  ): Promise<ChromeTargetSummary | null> {
    const deadline = Date.now() + Math.min(this.#requestTimeoutMs, 10_000)
    while (Date.now() < deadline) {
      try {
        const target = (await this.#targetInventory()).find((candidate) =>
          candidate.url === url && !previousTargetIds.has(candidate.targetId))
        if (target !== undefined) return Object.freeze({
          targetId: target.targetId,
          type: target.type,
          title: target.title,
          url: target.url,
        })
      } catch {
        // The CDP endpoint itself may still be settling after an uncertain send.
      }
      await abortableDelay(25)
    }
    return null
  }
}

class StorybookCdpTargetTransition extends Error {
  constructor() {
    super("Storybook CDP target is transitioning")
    this.name = "StorybookCdpTargetTransition"
  }
}

async function waitReadyConnection(
  connection: StorybookCdpConnection,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + boundedTimeout(timeoutMs, 100, 120_000)
  await connection.command("Runtime.enable", {}, {signal, timeoutMs: 5_000})
  while (Date.now() < deadline) {
    signal?.throwIfAborted()
    try {
      const response = await connection.command("Runtime.evaluate", {
        expression: `({
          readyState: document.readyState,
          fonts: document.fonts === undefined || document.fonts.status === "loaded",
          images: Array.from(document.images).every(image => image.complete),
        })`,
        returnByValue: true,
      }, {signal, timeoutMs: Math.max(100, Math.min(1_000, deadline - Date.now()))})
      const remote = objectValue(response.result, "ready Runtime result")
      const value = objectValue(remote.value, "ready state")
      if (value.readyState === "complete" && value.fonts === true && value.images === true) return
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      // A navigation can briefly remove every Runtime context. Retry through
      // the bounded loop instead of waiting forever on the destroyed one.
    }
    await abortableDelay(25, signal)
  }
  throw new DOMException("Storybook page readiness timed out", "TimeoutError")
}

function ownedChromeOrigin(stateRoot: string): string | null {
  const path = join(stateRoot, "chrome-profile", "DevToolsActivePort")
  if (!existsSync(path)) return null
  const port = Number(readFileSync(path, "utf8").split(/\r?\n/u)[0])
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? `http://127.0.0.1:${port}` : null
}

function discoverChromeBinary(): string {
  const candidates = [
    Bun.env.STORYBOOK_CHROME_BINARY,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    Bun.which("google-chrome"),
    Bun.which("chromium"),
  ]
  const path = candidates.find((candidate): candidate is string => typeof candidate === "string" && existsSync(candidate))
  if (path === undefined) throw new Error("Storybook cannot find a Chrome binary for direct CDP")
  return path
}

function spawnOwnedChrome(command: readonly string[], stateRoot: string): void {
  const child = Bun.spawn([...command], {
    cwd: stateRoot,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  })
  child.unref()
}

function targetSummary(value: unknown, label: string, cdpOrigin: string): StorybookCdpTarget {
  const target = objectValue(value, label)
  return Object.freeze({
    targetId: exactTargetId(target.id ?? target.targetId),
    type: boundedText(target.type, `${label} type`, 64),
    title: typeof target.title === "string" ? target.title.slice(0, 2_048) : "",
    url: absoluteUrl(target.url),
    webSocketDebuggerUrl: exactCdpWebSocketUrl(target.webSocketDebuggerUrl, cdpOrigin),
  })
}

function remoteObjectText(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return String(value)
  const record = value as Record<string, unknown>
  if (record.value !== undefined) {
    try {
      return typeof record.value === "string" ? record.value : JSON.stringify(record.value)
    } catch {
      return String(record.value)
    }
  }
  return typeof record.description === "string" ? record.description : String(record.type ?? "unknown")
}

function consoleLevel(type: string): string {
  if (type === "warning") return "warn"
  if (["error", "assert"].includes(type)) return "error"
  if (["debug", "info", "log"].includes(type)) return type
  return "log"
}

function bridgeMethod(value: StorybookBridgeMethod): StorybookBridgeMethod {
  if (!["identity", "inspect", "interact", "capture"].includes(value)) {
    throw new Error(`Unsupported Storybook bridge method: ${String(value)}`)
  }
  return value
}

function screenshotClip(value: StorybookBridgeClip): Required<StorybookBridgeClip> {
  if (value === null || typeof value !== "object") throw new Error("Storybook screenshot clip must be an object")
  return Object.freeze({
    x: finiteCoordinate(value.x, "clip.x"),
    y: finiteCoordinate(value.y, "clip.y"),
    width: finiteExtent(value.width, "clip.width"),
    height: finiteExtent(value.height, "clip.height"),
    scale: value.scale === undefined ? 1 : finiteExtent(value.scale, "clip.scale", 4),
  })
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(boundedTimeout(timeoutMs, 100, 120_000))
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout])
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) {
    await Bun.sleep(ms)
    return
  }
  if (signal.aborted) throw signal.reason
  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolvePromise()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener("abort", onAbort, {once: true})
  })
}

function exactTargetId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(value)) {
    throw new Error("Invalid Storybook CDP target identity")
  }
  return value
}

function exactWebSocketUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Storybook CDP WebSocket URL is missing")
  const url = new URL(value)
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Invalid Storybook CDP WebSocket URL")
  return url.href
}

function exactCdpWebSocketUrl(value: unknown, cdpOrigin: string): string {
  const href = exactWebSocketUrl(value)
  const socket = new URL(href)
  const origin = new URL(cdpOrigin)
  if (socket.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(socket.hostname) ||
    socket.username.length > 0 || socket.password.length > 0 || effectivePort(socket) !== effectivePort(origin)) {
    throw new Error("Storybook CDP WebSocket must remain on the exact loopback endpoint")
  }
  return socket.href
}

function effectivePort(url: URL): number {
  if (url.port.length > 0) return Number(url.port)
  if (url.protocol === "http:" || url.protocol === "ws:") return 80
  if (url.protocol === "https:" || url.protocol === "wss:") return 443
  throw new Error(`Unsupported Storybook endpoint protocol: ${url.protocol}`)
}

function absoluteHttpUrl(value: unknown): string {
  const url = new URL(absoluteUrl(value))
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Unsupported browser URL: ${url.href}`)
  return url.href
}

function absoluteUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8_192) {
    throw new Error("Invalid browser URL")
  }
  return new URL(value).href
}

function chromeOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`Storybook CDP origin must be loopback HTTP: ${value}`)
  }
  return url.origin
}

function finiteCoordinate(value: number, label: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) throw new Error(`Invalid ${label}`)
  return value
}

function finiteExtent(value: number, label: string, maximum = 16_384): number {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) throw new Error(`Invalid ${label}`)
  return value
}

function boundedTimeout(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`Timeout must be between ${minimum} and ${maximum}`)
  }
  return value
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function remoteExceptionMessage(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "browser exception"
  const details = value as Record<string, unknown>
  if (details.exception !== null && typeof details.exception === "object" && !Array.isArray(details.exception)) {
    const exception = details.exception as Record<string, unknown>
    for (const candidate of [exception.description, exception.value]) {
      if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.slice(0, 2_048)
    }
  }
  return typeof details.text === "string" && details.text.trim().length > 0
    ? details.text.slice(0, 2_048)
    : "browser exception"
}

function safeJson(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error("Storybook bridge parameters must be JSON-serializable")
  return serialized.replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029")
}
