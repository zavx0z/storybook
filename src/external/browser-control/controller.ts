import type {ChromeTargetSummary, StorybookCaptureInput, StorybookInteractInput, StorybookPublicView} from "./types.ts"
import type {StorybookBridgeClip, StorybookBridgeIdentity} from "./types.ts"
import {StorybookCaptureStore, type StoredStorybookCapture} from "./capture-store.ts"
import {
  StorybookCdpClient,
  type StorybookChromeClient,
  type StorybookChromeConsoleEntry,
} from "./chrome-client.ts"
import {StorybookBrowserState} from "./browser-state.ts"
import {withStorybookBrowserLock} from "./target-operation-lock.ts"
import {StorybookViewRegistry} from "./view-registry.ts"

export type StorybookBrowserControllerOptions = Readonly<{
  chrome?: StorybookChromeClient
  views?: StorybookViewRegistry
  captures: StorybookCaptureStore
  state?: StorybookBrowserState
}>

export type StorybookBrowserOpenInput = Readonly<{
  origin: string
  packageId: string
  route: string
  url: string
  timeoutMs?: number
  expectedRevision?: string
}>

export type StorybookBrowserCaptureResult = StoredStorybookCapture & Readonly<{
  image: Readonly<{data: string; mimeType: "image/png"}>
}>

/** Browser mechanics shared by CLI and MCP while keeping every CDP identity private. */
export class StorybookBrowserController {
  readonly #chrome: StorybookChromeClient
  readonly #views: StorybookViewRegistry
  readonly #captures: StorybookCaptureStore
  readonly #state: StorybookBrowserState

  constructor(options: StorybookBrowserControllerOptions) {
    this.#state = options.state ?? new StorybookBrowserState()
    this.#chrome = options.chrome ?? new StorybookCdpClient()
    this.#views = options.views ?? new StorybookViewRegistry(this.#state.secret())
    this.#captures = options.captures
  }

  async open(input: StorybookBrowserOpenInput, signal?: AbortSignal): Promise<Readonly<{
    view: StorybookPublicView
    identity: StorybookBridgeIdentity
    reused: boolean
  }>> {
    const origin = loopbackOrigin(input.origin)
    const packageId = exactPackageId(input.packageId)
    const route = exactRoute(input.route)
    const url = exactPackageUrl(input.url, origin, packageId, route)
    const timeoutMs = boundedTimeout(input.timeoutMs ?? 30_000)
    const timeout = AbortSignal.timeout(timeoutMs)
    const operationSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${packageId}`,
      timeoutMs,
      signal: operationSignal,
    }, () => this.#openLocked({...input, origin, packageId, route, url, timeoutMs}, operationSignal))
  }

  async #openLocked(
    input: StorybookBrowserOpenInput & Readonly<{
      origin: string
      packageId: string
      route: string
      url: string
      timeoutMs: number
    }>,
    operationSignal: AbortSignal,
  ): Promise<Readonly<{
    view: StorybookPublicView
    identity: StorybookBridgeIdentity
    reused: boolean
  }>> {
    const {origin, packageId, route, url, timeoutMs} = input
    await this.#chrome.health(operationSignal)
    let targets = await this.#chrome.targets(operationSignal)
    const cdpOrigin = await this.#chrome.cdpOrigin(operationSignal)
    const recorded = this.#state.readTarget(packageId)
    const owned: ChromeTargetSummary[] = []
    for (const target of targets) {
      if (target.type !== "page") continue
      if (recorded?.cdpOrigin === cdpOrigin && recorded.targetId === target.targetId) {
        owned.push(target)
        continue
      }
      const candidate = packageTargetIdentity(target.url)
      if (candidate?.packageId === packageId &&
        await this.#attestsPackage(target, packageId, operationSignal)) owned.push(target)
    }
    let selected = owned.find(({targetId}) => recorded?.targetId === targetId) ??
      owned.find((target) => new URL(target.url).origin === origin) ??
      owned[0] ?? null
    const reused = selected !== null
    if (selected === null) {
      const created = await this.#chrome.createTarget(url, operationSignal)
      selected = created
    }
    // Persist provisional ownership before navigation/readiness. A broken page
    // is still the package's one reusable target on the next MCP invocation.
    this.#state.writeTarget({packageId, cdpOrigin, targetId: selected.targetId})
    if (selected.url !== url) await this.#chrome.navigate(selected.targetId, url, operationSignal)
    await this.#chrome.waitReady(selected.targetId, timeoutMs, operationSignal)
    let identity = await this.#waitBridgeIdentity(selected.targetId, timeoutMs, operationSignal)
    if (identity.packageId !== packageId || identity.route !== route) {
      throw new Error(`Storybook bridge identity mismatch: expected ${packageId}:${route}`)
    }
    if (input.expectedRevision !== undefined && identity.revision !== input.expectedRevision) {
      await this.#chrome.navigate(selected.targetId, url, operationSignal)
      await this.#chrome.waitReady(selected.targetId, timeoutMs, operationSignal)
      identity = await this.#waitBridgeIdentity(selected.targetId, timeoutMs, operationSignal)
    }
    if (input.expectedRevision !== undefined && identity.revision !== input.expectedRevision) {
      throw new Error(`Storybook view revision mismatch: expected ${input.expectedRevision}`)
    }
    if (!identity.ready) {
      await this.#chrome.navigate(selected.targetId, url, operationSignal)
      await this.#chrome.waitReady(selected.targetId, timeoutMs, operationSignal)
      identity = await this.#waitBridgeIdentity(selected.targetId, timeoutMs, operationSignal)
    }
    const currentTargets = await this.#chrome.targets(operationSignal)
    for (const duplicate of owned) {
      if (duplicate.targetId === selected.targetId) continue
      const current = currentTargets.find(({targetId}) => targetId === duplicate.targetId)
      if (current === undefined || packageTargetIdentity(current.url)?.packageId !== packageId ||
        !await this.#attestsPackage(current, packageId, operationSignal)) continue
      await this.#chrome.closeTarget(current.targetId, operationSignal)
    }
    this.#views.synchronize(await this.#verifiedCurrentTargets(origin, operationSignal), origin)
    const internal = this.#views.exactPackage(packageId, origin)
    if (internal === null || internal.targetId !== selected.targetId) {
      throw new Error(`Storybook target did not become the exact package view for ${packageId}`)
    }
    return Object.freeze({
      view: this.#views.public(internal.viewId),
      identity,
      reused,
    })
  }

  views(): readonly StorybookPublicView[] {
    return this.#views.list()
  }

  async synchronize(origin: string, signal?: AbortSignal): Promise<readonly StorybookPublicView[]> {
    await this.#chrome.health(signal)
    const canonicalOrigin = loopbackOrigin(origin)
    return this.#views.synchronize(await this.#verifiedCurrentTargets(canonicalOrigin, signal), canonicalOrigin)
  }

  async inspect(
    viewId: string,
    input: Readonly<{include?: readonly string[]; maxDepth?: number; limit?: number; cursor?: string}>,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const view = this.#views.internal(viewId)
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${view.packageId}`,
      ...(signal === undefined ? {} : {signal}),
    }, async () => {
      const projection = objectResult(await this.#chrome.callBridge(view.targetId, "inspect", Object.freeze({
        schemaVersion: 1,
        ...(input.include === undefined ? {} : {include: Object.freeze([...input.include])}),
        ...(input.maxDepth === undefined ? {} : {maxDepth: input.maxDepth}),
        ...(input.limit === undefined ? {} : {limit: input.limit}),
        ...(input.cursor === undefined ? {} : {cursor: input.cursor}),
      }), signal), "Storybook inspect bridge result")
      const includeConsole = input.include?.includes("console") ?? false
      const consoleEntries = includeConsole
        ? await this.#chrome.consoleEntries(view.targetId, 250, signal)
        : Object.freeze([])
      return Object.freeze({
        ...projection,
        view: this.#views.public(viewId),
        ...(includeConsole ? {console: consoleEntries, consoleErrors: consoleErrors(consoleEntries)} : {}),
      })
    })
  }

  async interact(input: StorybookInteractInput, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    const view = this.#views.internal(input.viewId)
    const timeout = AbortSignal.timeout(input.timeoutMs ?? 8_000)
    const operationSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${view.packageId}`,
      timeoutMs: input.timeoutMs ?? 8_000,
      signal: operationSignal,
    }, async () => {
      const result = objectResult(await this.#chrome.callBridge(view.targetId, "interact", input, operationSignal),
        "Storybook interact bridge result")
      return Object.freeze({...result, view: this.#views.public(input.viewId)})
    })
  }

  async capture(input: StorybookCaptureInput, signal?: AbortSignal): Promise<StorybookBrowserCaptureResult> {
    if (input.viewId === undefined) throw new Error("Browser capture requires an exact viewId")
    const timeout = AbortSignal.timeout(input.timeoutMs ?? 30_000)
    const operationSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const view = this.#views.internal(input.viewId)
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${view.packageId}`,
      timeoutMs: input.timeoutMs ?? 30_000,
      signal: operationSignal,
    }, async () => {
      const identity = bridgeIdentity(await this.#chrome.callBridge(
        view.targetId,
        "identity",
        Object.freeze({schemaVersion: 1}),
        operationSignal,
      ))
      if (!identity.ready || !identity.presented || identity.revision === null || identity.graphDigest === null) {
        throw new Error(`Storybook view is not ready and presented: ${input.viewId}`)
      }
      const entries = await this.#chrome.consoleEntries(view.targetId, 250, operationSignal)
      const errors = consoleErrors(entries)
      if (input.failOnConsoleError === true && errors.length > 0) {
        throw new Error(`Storybook view has ${errors.length} console error(s)`)
      }
      let clip: StorybookBridgeClip | undefined
      if (input.area !== "page") {
        const region = objectResult(await this.#chrome.callBridge(view.targetId, "capture", Object.freeze({
          schemaVersion: 1,
          area: input.area,
          ...(input.nodeId === undefined ? {} : {nodeId: input.nodeId}),
          ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
        }), operationSignal), "Storybook capture bridge result")
        clip = bridgeClip(region.clip)
      }
      const png = await this.#chrome.screenshot(view.targetId, {
        caption: `Ожидаю готовый ${input.area} Storybook ${identity.packageId} на exact route ${identity.route}`,
        ...(clip === undefined ? {} : {clip}),
        ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
      }, operationSignal)
      const stored = this.#captures.put(png, {
        packageId: identity.packageId,
        route: identity.route,
        graphDigest: identity.graphDigest,
        revision: identity.revision,
        area: input.area,
        ...(input.nodeId === undefined ? {} : {nodeId: input.nodeId}),
        consoleErrors: errors,
      })
      return Object.freeze({
        ...stored,
        image: Object.freeze({data: Buffer.from(png).toString("base64"), mimeType: "image/png"}),
      })
    })
  }

  async close(viewId: string, signal?: AbortSignal): Promise<Readonly<{closed: true; viewId: string}>> {
    const view = this.#views.internal(viewId)
    await withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${view.packageId}`,
      ...(signal === undefined ? {} : {signal}),
    }, async () => {
      await this.#chrome.closeTarget(view.targetId, signal)
      this.#state.clearTarget(view.packageId, view.targetId)
      this.#views.forget(viewId)
    })
    return Object.freeze({closed: true, viewId})
  }

  async #attestsPackage(
    target: ChromeTargetSummary,
    packageId: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      return bridgeIdentity(await this.#chrome.callBridge(
        target.targetId,
        "identity",
        Object.freeze({schemaVersion: 1}),
        signal,
      )).packageId === packageId
    } catch {
      try {
        const diagnostic = await this.#chrome.bridgeDiagnostics(target.targetId, signal)
        const markers = objectResult(diagnostic.markers, "Storybook target markers")
        return diagnostic.viewName === `storybook:${packageId}` && markers.packageId === packageId
      } catch {
        return false
      }
    }
  }

  async #verifiedCurrentTargets(
    origin: string,
    signal?: AbortSignal,
  ): Promise<readonly ChromeTargetSummary[]> {
    const targets = await this.#chrome.targets(signal)
    const cdpOrigin = await this.#chrome.cdpOrigin(signal)
    const verified: ChromeTargetSummary[] = []
    for (const target of targets) {
      const identity = packageTargetIdentity(target.url)
      if (target.type !== "page" || identity === null || new URL(target.url).origin !== origin) continue
      const recorded = this.#state.readTarget(identity.packageId)
      if (recorded?.cdpOrigin === cdpOrigin && recorded.targetId === target.targetId) {
        verified.push(target)
        continue
      }
      const timeout = AbortSignal.timeout(2_000)
      const operationSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
      if (await this.#attestsPackage(target, identity.packageId, operationSignal)) verified.push(target)
    }
    return Object.freeze(verified)
  }

  async #waitBridgeIdentity(
    targetId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<StorybookBridgeIdentity> {
    const deadline = Date.now() + boundedTimeout(timeoutMs)
    let unavailable: unknown = null
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      try {
        return bridgeIdentity(await this.#chrome.callBridge(
          targetId,
          "identity",
          Object.freeze({schemaVersion: 1}),
          signal,
        ))
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "Storybook agent bridge is unavailable in the exact target") {
          throw error
        }
        unavailable = error
      }
      await Bun.sleep(Math.min(50, Math.max(1, deadline - Date.now())))
    }
    const entries = await this.#chrome.consoleEntries(targetId, 250, signal).catch(() => Object.freeze([]))
    const diagnostics = consoleErrors(entries)
      .map(({text}) => typeof text === "string" ? text : "browser error")
      .slice(0, 5)
      .join(" | ")
    const bridgeDiagnostics = await this.#chrome.bridgeDiagnostics(targetId, signal)
      .then((value) => JSON.stringify(value))
      .catch(() => "unavailable")
    throw new DOMException(
      `${unavailable instanceof Error ? unavailable.message : "Storybook agent bridge timed out"}${
        diagnostics.length === 0 ? "" : `; browser diagnostics: ${diagnostics}`
      }; bridge diagnostics: ${bridgeDiagnostics}`,
      "TimeoutError",
    )
  }
}

function bridgeIdentity(value: unknown): StorybookBridgeIdentity {
  const record = objectResult(value, "Storybook bridge identity")
  if (record.protocol !== "external-storybook-agent-bridge/1") {
    throw new Error(`Unsupported Storybook bridge protocol: ${String(record.protocol)}`)
  }
  const packageId = exactPackageId(record.packageId)
  const route = exactRoute(record.route)
  const revision = optionalText(record.revision, "bridge revision", 256)
  if (record.viewName !== `storybook:${packageId}`) {
    throw new Error("Storybook bridge window.name does not match its package identity")
  }
  const markers = objectResult(record.markers, "Storybook bridge markers")
  if (markers.packageId !== packageId || markers.route !== route || markers.revision !== revision) {
    throw new Error("Storybook browser markers do not match the bridge identity")
  }
  if (record.ready === true && markers.package !== "ready") {
    throw new Error("Storybook ready bridge has a non-ready package marker")
  }
  return Object.freeze({
    protocol: "external-storybook-agent-bridge/1",
    packageId,
    route,
    revision,
    graphDigest: optionalDigest(record.graphDigest),
    ready: record.ready === true,
    presented: record.presented === true,
    timeOrigin: finiteNumber(record.timeOrigin, "bridge timeOrigin"),
  })
}

function bridgeClip(value: unknown): StorybookBridgeClip {
  const record = objectResult(value, "Storybook bridge capture clip")
  return Object.freeze({
    x: finiteNumber(record.x, "capture clip.x"),
    y: finiteNumber(record.y, "capture clip.y"),
    width: positiveNumber(record.width, "capture clip.width"),
    height: positiveNumber(record.height, "capture clip.height"),
    ...(record.scale === undefined ? {} : {scale: positiveNumber(record.scale, "capture clip.scale")}),
  })
}

function consoleErrors(entries: readonly StorybookChromeConsoleEntry[]): readonly StorybookChromeConsoleEntry[] {
  return Object.freeze(entries.filter((entry) => entry.level === "error" || entry.type === "error"))
}

function exactPackageUrl(value: string, origin: string, packageId: string, route: string): string {
  const url = new URL(value)
  if (url.origin !== origin || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`Storybook package URL must belong to the exact server origin: ${value}`)
  }
  const prefix = `/packages/${encodeURIComponent(packageId)}/`
  if (!url.pathname.startsWith(prefix)) throw new Error(`Storybook package URL belongs to another package: ${value}`)
  const encodedRoute = url.pathname.slice(prefix.length).replace(/\/$/u, "")
  const decodedRoute = encodedRoute.length === 0 ? "" : encodedRoute.split("/").map((segment) => {
    const decoded = decodeURIComponent(segment)
    if (encodeURIComponent(decoded) !== segment) throw new Error(`Non-canonical Storybook route segment: ${segment}`)
    return decoded
  }).join("/")
  if (decodedRoute !== route) throw new Error(`Storybook package URL route mismatch: ${decodedRoute}; expected ${route}`)
  return url.href
}

function loopbackOrigin(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/" || url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`Storybook origin must be loopback HTTP: ${value}`)
  }
  return url.origin
}

function packageTargetIdentity(value: string): Readonly<{packageId: string; route: string}> | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.search.length > 0 || url.hash.length > 0) return null
  const segments = url.pathname.split("/")
  if (segments[0] !== "" || segments[1] !== "packages" || segments[2] === undefined) return null
  try {
    const packageId = decodeURIComponent(segments[2])
    if (encodeURIComponent(packageId) !== segments[2] ||
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageId)) return null
    const encodedRoute = segments.slice(3)
    if (encodedRoute.at(-1) === "") encodedRoute.pop()
    if (encodedRoute.some((segment) => segment.length === 0)) return null
    const route = encodedRoute.map((segment) => {
      const decoded = decodeURIComponent(segment)
      if (encodeURIComponent(decoded) !== segment || decoded === "." || decoded === ".." || decoded.includes("\\")) {
        throw new Error("invalid route")
      }
      return decoded
    }).join("/")
    return Object.freeze({packageId, route})
  } catch {
    return null
  }
}

function exactPackageId(value: unknown): string {
  if (typeof value !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value)) {
    throw new Error(`Invalid Storybook package identity: ${String(value)}`)
  }
  return value
}

function exactRoute(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_048 || value.startsWith("/") || value.endsWith("/") ||
    value.includes("//") || value.includes("\\") || /[?#\u0000-\u001f\u007f]/u.test(value) ||
    value.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`Invalid Storybook route: ${String(value)}`)
  }
  return value
}

function objectResult(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === null) return null
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw new Error(`Invalid ${label}`)
  return value
}

function optionalDigest(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) throw new Error("Invalid bridge graph digest")
  return value
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${label}`)
  return value
}

function positiveNumber(value: unknown, label: string): number {
  const number = finiteNumber(value, label)
  if (number <= 0 || number > 1_000_000) throw new Error(`Invalid ${label}`)
  return number
}

function boundedTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 100 || value > 120_000) throw new Error("Invalid Storybook browser timeout")
  return value
}
