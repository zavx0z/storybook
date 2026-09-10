import {storybookPackageRouteFromPathname} from "./contract.ts"
import {resolve} from "node:path"
import type {
  ChromeTargetSummary,
  StoredStorybookCapture,
  StorybookBridgeClip,
  StorybookBridgeIdentity,
  StorybookBrowserCaptureInput,
  StorybookBrowserInteractInput,
  StorybookChromeClient,
  StorybookChromeConsoleEntry,
  StorybookProcessStart,
  StorybookPublicView,
} from "./contract.ts"
import {StorybookCaptureStore} from "./capture-store.ts"
import {StorybookCdpClient} from "./chrome-client.ts"
import {StorybookBrowserState} from "./browser-state.ts"
import {withStorybookBrowserLock} from "./target-operation-lock.ts"
import {StorybookViewRegistry, type StorybookIdentifiedTarget} from "./view-registry.ts"

export type CreateStorybookBrowserLifecycleOptions = Readonly<{
  stateRoot: string
  captureRoot: string
  chrome?: StorybookChromeClient
  processStart?: StorybookProcessStart
}>

export type StorybookBrowserOpenInput = Readonly<{
  origin: string
  packageId: string
  route: string
  url: string
  packageLabel?: string
  timeoutMs?: number
  expectedRevision?: string
}>

export type StorybookBrowserCaptureResult = StoredStorybookCapture & Readonly<{
  image: Readonly<{data: string; mimeType: "image/png"}>
}>

export interface StorybookBrowserLifecycle {
  openPackage(input: StorybookBrowserOpenInput, signal?: AbortSignal): Promise<Readonly<{
    view: StorybookPublicView
    identity: StorybookBridgeIdentity
    reused: boolean
  }>>
  listViews(
    origin: string,
    signal?: AbortSignal,
    packages?: readonly Readonly<{packageId: string; label: string}>[],
    packageId?: string,
  ): Promise<readonly StorybookPublicView[]>
  getView(viewId: string): StorybookPublicView
  inspect(
    viewId: string,
    input: Readonly<{include?: readonly string[]; maxDepth?: number; limit?: number; cursor?: string}>,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>>
  interact(input: StorybookBrowserInteractInput, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>>
  capture(input: StorybookBrowserCaptureInput, signal?: AbortSignal): Promise<StorybookBrowserCaptureResult>
  close(viewId: string, signal?: AbortSignal): Promise<Readonly<{
    closed: boolean
    viewId: string
    preserved?: boolean
  }>>
  readCapture(captureId: string): Readonly<{metadata: StoredStorybookCapture; png: Uint8Array}>
}

export function createStorybookBrowserLifecycle(
  options: CreateStorybookBrowserLifecycleOptions,
): StorybookBrowserLifecycle {
  const stateRoot = resolve(options.stateRoot)
  return new DefaultStorybookBrowserLifecycle({
    state: new StorybookBrowserState(stateRoot),
    chrome: options.chrome ?? new StorybookCdpClient({
      stateRoot,
      ...(options.processStart === undefined ? {} : {processStart: options.processStart}),
    }),
    captures: new StorybookCaptureStore({root: resolve(options.captureRoot)}),
    ...(options.processStart === undefined ? {} : {processStart: options.processStart}),
  })
}

type DefaultStorybookBrowserLifecycleOptions = Readonly<{
  chrome: StorybookChromeClient
  captures: StorybookCaptureStore
  state: StorybookBrowserState
  processStart?: StorybookProcessStart
}>

/** Sole package-target lifecycle owner composed by the canonical Storybook server. */
class DefaultStorybookBrowserLifecycle implements StorybookBrowserLifecycle {
  readonly #chrome: StorybookChromeClient
  readonly #views: StorybookViewRegistry
  readonly #captures: StorybookCaptureStore
  readonly #state: StorybookBrowserState
  readonly #processStart: StorybookProcessStart | undefined

  constructor(options: DefaultStorybookBrowserLifecycleOptions) {
    this.#state = options.state
    this.#chrome = options.chrome
    this.#views = new StorybookViewRegistry(this.#state.secret())
    this.#captures = options.captures
    this.#processStart = options.processStart
  }

  async openPackage(input: StorybookBrowserOpenInput, signal?: AbortSignal): Promise<Readonly<{
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
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, () => this.#openLocked({
      ...input,
      origin,
      packageId,
      route,
      url,
      timeoutMs,
    }, operationSignal))
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
    const browserIdentity = await this.#chrome.browserIdentity(operationSignal)
    const recorded = this.#state.readTarget(packageId)
    let reserved: ChromeTargetSummary | null = null
    if (recorded?.phase === "reserved" && recorded.cdpOrigin === cdpOrigin &&
      recorded.browserIdentity === browserIdentity && recorded.url !== null) {
      const baseline = new Set(recorded.baselineTargetIds)
      const candidates = targets.filter((target) =>
        !baseline.has(target.targetId) && target.url === recorded.url)
      if (candidates.length > 1) {
        throw new Error(`Ambiguous Storybook reserved package target: ${packageId}`)
      }
      reserved = candidates[0] ?? null
      if (reserved === null && recorded.createSent) {
        throw new Error(`Storybook package target creation is indeterminate: ${packageId}`)
      }
    }
    const owned: ChromeTargetSummary[] = []
    for (const target of targets) {
      if (target.type !== "page") continue
      if (recorded?.phase === "owned" && recorded.cdpOrigin === cdpOrigin &&
        recorded.browserIdentity === browserIdentity &&
        recorded.targetId === target.targetId) {
        const identity = packageTargetIdentity(target.url, packageId)
        if (identity?.packageId === packageId && await this.#attestsPackage(target, packageId, operationSignal, input.packageLabel)) {
          owned.push(target)
        } else {
          this.#state.clearTarget(packageId, target.targetId)
          this.#views.forgetTarget(target.targetId)
        }
        continue
      }
      const candidate = packageTargetIdentity(target.url, packageId)
      if (candidate?.packageId === packageId &&
        await this.#attestsPackage(target, packageId, operationSignal, input.packageLabel)) owned.push(target)
    }
    let selected = reserved ?? owned.find(({targetId}) => recorded?.targetId === targetId) ??
      owned.find((target) => new URL(target.url).origin === origin) ??
      owned[0] ?? null
    const reused = selected !== null
    if (selected === null) {
      if (recorded?.phase !== "reserved" || recorded.cdpOrigin !== cdpOrigin ||
        recorded.browserIdentity !== browserIdentity || recorded.url !== url) {
        this.#state.reserveTarget({
          packageId,
          cdpOrigin,
          browserIdentity,
          url,
          baselineTargetIds: targets.map(({targetId}) => targetId),
        })
      }
      this.#state.markCreateSent(packageId)
      const created = await this.#chrome.createTarget(url, operationSignal)
      selected = created
    }
    // Bind the reservation before navigation/readiness. A broken page remains
    // the package's one reusable target on the next lifecycle invocation.
    this.#state.writeTarget({packageId, cdpOrigin, browserIdentity, targetId: selected.targetId})
    if (selected.url !== url) await this.#chrome.navigate(selected.targetId, url, operationSignal)
    await this.#chrome.waitReady(selected.targetId, timeoutMs, operationSignal)
    if (reused && selected.url === url) {
      try {
        await this.#chrome.callBridge(selected.targetId, "identity", Object.freeze({schemaVersion: 1}), operationSignal)
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "Storybook agent bridge is unavailable in the exact target") throw error
        // A failed bootstrap can leave the correct URL without a bridge. Reopen
        // that same owned target once so a repaired revision can initialize.
        await this.#chrome.navigate(selected.targetId, url, operationSignal)
        await this.#chrome.waitReady(selected.targetId, timeoutMs, operationSignal)
      }
    }
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
    const current = (await this.#chrome.targets(operationSignal))
      .find(({targetId}) => targetId === selected.targetId)
    if (current === undefined || new URL(current.url).origin !== origin) {
      throw new Error(`Storybook target did not become the exact package view for ${packageId}`)
    }
    const view = this.#views.register({...current, packageId}, origin)
    return Object.freeze({
      view,
      identity,
      reused,
    })
  }

  async listViews(
    origin: string,
    signal?: AbortSignal,
    packages?: readonly Readonly<{packageId: string; label: string}>[],
    packageId?: string,
  ): Promise<readonly StorybookPublicView[]> {
    await this.#chrome.health(signal)
    const canonicalOrigin = loopbackOrigin(origin)
    const scope = packageId === undefined ? undefined : exactPackageId(packageId)
    const labels = packages === undefined ? null : new Map(packages.map(({packageId, label}) => [
      exactPackageId(packageId),
      exactPackageLabel(label),
    ] as const))
    const candidates = (await this.#chrome.targets(signal)).filter(target =>
      target.type === "page" && packageTargetPath(target.url) !== null && new URL(target.url).origin === canonicalOrigin &&
      (scope === undefined || packageTargetIdentity(target.url, scope)?.packageId === scope))
    const retained: StorybookIdentifiedTarget[] = []
    for (const target of candidates) {
      signal?.throwIfAborted()
      let packageId: string | null = null
      if (labels !== null) {
        const matches = [...labels.keys()].filter(id => packageTargetIdentity(target.url, id) !== null)
        if (matches.length > 1) throw new Error("Ambiguous Storybook package URL")
        packageId = matches[0] ?? null
      } else {
        try {
          packageId = bridgeIdentity(await this.#chrome.callBridge(target.targetId, "identity", {schemaVersion: 1}, signal)).packageId
        } catch {
          signal?.throwIfAborted()
          try {
            const diagnostic = await this.#chrome.bridgeDiagnostics(target.targetId, signal)
            const markers = objectResult(diagnostic.markers, "Storybook target markers")
            packageId = typeof markers.packageId === "string" ? markers.packageId :
              typeof diagnostic.viewName === "string" && diagnostic.viewName.startsWith("storybook:")
                ? diagnostic.viewName.slice("storybook:".length) : null
          } catch (error) {
            signal?.throwIfAborted()
            throw new Error("Storybook browser inventory observation is indeterminate", {cause: error})
          }
        }
      }
      if (packageId === null || packageTargetIdentity(target.url, packageId) === null) continue
      if (await this.#attestsPackage(target, packageId, signal ?? AbortSignal.timeout(5_000), labels?.get(packageId), true)) {
        retained.push({...target, packageId})
      }
    }
    const preferred = new Set(retained.flatMap(target =>
      this.#state.readTarget(target.packageId)?.targetId === target.targetId ? [target.targetId] : []))
    retained.sort((left, right) => Number(preferred.has(right.targetId)) - Number(preferred.has(left.targetId)))
    // Только завершённое наблюдение заменяет registry; чужие пакеты не перепроверялись.
    signal?.throwIfAborted()
    return this.#views.synchronize(retained, canonicalOrigin, scope)
  }

  async inspect(
    viewId: string,
    input: Readonly<{include?: readonly string[]; maxDepth?: number; limit?: number; cursor?: string}>,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    const view = this.#views.internal(viewId)
    let bridgeAvailable = true
    try {
      await this.#assertCurrentPackage(viewId, signal)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Storybook agent bridge is unavailable in the exact target") throw error
      const target = (await this.#chrome.targets(signal)).find(target => target.targetId === view.targetId)
      if (!target || new URL(target.url).origin !== view.origin ||
        packageTargetIdentity(target.url, view.packageId)?.packageId !== view.packageId ||
        !await this.#attestsPackage(target, view.packageId, signal ?? AbortSignal.timeout(5_000))) throw error
      bridgeAvailable = false
    }
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${view.packageId}`,
      ...(signal === undefined ? {} : {signal}),
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      const projection = bridgeAvailable ? objectResult(await this.#chrome.callBridge(view.targetId, "inspect", Object.freeze({
        schemaVersion: 1,
        expectedPackageId: view.packageId,
        ...(input.include === undefined ? {} : {include: Object.freeze([...input.include])}),
        ...(input.maxDepth === undefined ? {} : {maxDepth: input.maxDepth}),
        ...(input.limit === undefined ? {} : {limit: input.limit}),
        ...(input.cursor === undefined ? {} : {cursor: input.cursor}),
      }), signal), "Storybook inspect bridge result") : Object.freeze({
        ready: false,
        bridgeAvailable: false,
        diagnostics: [{phase: "bootstrap", message: "Storybook agent bridge is unavailable"}],
        bootstrap: await this.#chrome.bridgeDiagnostics(view.targetId, signal),
      })
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

  getView(viewId: string): StorybookPublicView {
    return this.#views.public(viewId)
  }

  async interact(input: StorybookBrowserInteractInput, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    const view = this.#views.internal(input.viewId)
    await this.#assertCurrentPackage(input.viewId, signal)
    const timeout = AbortSignal.timeout(input.timeoutMs ?? 8_000)
    const operationSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${view.packageId}`,
      timeoutMs: input.timeoutMs ?? 8_000,
      signal: operationSignal,
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      const result = objectResult(await this.#chrome.callBridge(view.targetId, "interact", Object.freeze({
        ...input,
        schemaVersion: 1,
        expectedPackageId: view.packageId,
      }), operationSignal),
        "Storybook interact bridge result")
      return Object.freeze({...result, view: this.#views.public(input.viewId)})
    })
  }

  async capture(input: StorybookBrowserCaptureInput, signal?: AbortSignal): Promise<StorybookBrowserCaptureResult> {
    if (input.viewId === undefined) throw new Error("Browser capture requires an exact viewId")
    const timeout = AbortSignal.timeout(input.timeoutMs ?? 30_000)
    const operationSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    const view = this.#views.internal(input.viewId)
    await this.#assertCurrentPackage(input.viewId, signal)
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${view.packageId}`,
      timeoutMs: input.timeoutMs ?? 30_000,
      signal: operationSignal,
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      const identity = bridgeIdentity(await this.#chrome.callBridge(
        view.targetId,
        "identity",
        Object.freeze({schemaVersion: 1}),
        operationSignal,
      ))
      if (identity.packageId !== view.packageId) throw new Error("Storybook view navigated to another package")
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
          expectedPackageId: view.packageId,
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

  async close(viewId: string, signal?: AbortSignal): Promise<Readonly<{
    closed: boolean
    viewId: string
    preserved?: boolean
  }>> {
    const view = this.#views.internal(viewId)
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${view.packageId}`,
      ...(signal === undefined ? {} : {signal}),
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      const current = (await this.#chrome.targets(signal)).find(({targetId}) => targetId === view.targetId)
      if (current !== undefined && packageTargetIdentity(current.url, view.packageId)?.packageId === view.packageId) {
        const attested = await this.#attestsPackage(
          current,
          view.packageId,
          signal ?? AbortSignal.timeout(5_000),
        )
        if (!attested) {
          throw new Error(`Storybook exact package target attestation is indeterminate: ${view.packageId}`)
        }
        await this.#chrome.closeTarget(view.targetId, signal)
        this.#state.clearTarget(view.packageId, view.targetId)
        this.#views.forget(viewId)
        return Object.freeze({closed: true, viewId})
      }
      this.#state.clearTarget(view.packageId, view.targetId)
      this.#views.forget(viewId)
      return Object.freeze({
        closed: false,
        viewId,
        ...(current === undefined ? {} : {preserved: true}),
      })
    })
  }

  readCapture(captureId: string): Readonly<{metadata: StoredStorybookCapture; png: Uint8Array}> {
    return this.#captures.read(captureId)
  }

  async #assertCurrentPackage(viewId: string, signal?: AbortSignal): Promise<void> {
    const view = this.#views.internal(viewId)
    const target = (await this.#chrome.targets(signal)).find(target => target.targetId === view.targetId)
    if (target === undefined || new URL(target.url).origin !== view.origin || packageTargetIdentity(target.url, view.packageId)?.packageId !== view.packageId) {
      throw new Error("Storybook view navigated away from the requested package")
    }
    const identity = bridgeIdentity(await this.#chrome.callBridge(view.targetId, "identity", {schemaVersion: 1}, signal))
    if (identity.packageId !== view.packageId) throw new Error("Storybook view navigated to another package")
  }

  async #attestsPackage(
    target: ChromeTargetSummary,
    packageId: string,
    signal: AbortSignal,
    packageLabel?: string,
    requireComplete = false,
  ): Promise<boolean> {
    try {
      return bridgeIdentity(await this.#chrome.callBridge(
        target.targetId,
        "identity",
        Object.freeze({schemaVersion: 1}),
        signal,
      )).packageId === packageId
    } catch {
      signal.throwIfAborted()
      try {
        const diagnostic = await this.#chrome.bridgeDiagnostics(target.targetId, signal)
        const markers = objectResult(diagnostic.markers, "Storybook target markers")
        const markerPackageId = markers.packageId
        if (packageTargetIdentity(target.url, packageId)?.packageId !== packageId ||
          typeof markerPackageId === "string" && markerPackageId !== packageId) return false
        const revisionPrefix = `/__storybook/revisions/${encodeURIComponent(packageId)}/`
        const ownsRevisionScript = Array.isArray(diagnostic.scripts) &&
          diagnostic.scripts.some((value) => typeof value === "string" && value.startsWith(revisionPrefix))
        return markerPackageId === packageId ||
          diagnostic.viewName === `storybook:${packageId}` &&
            (markerPackageId === null || markerPackageId === undefined) ||
          ownsRevisionScript ||
          packageLabel !== undefined && legacyEncodedPackageTarget(target.url, packageId) && target.title === packageLabel
      } catch (error) {
        signal.throwIfAborted()
        const legacy = packageTargetIdentity(target.url, packageId)?.packageId === packageId &&
          packageLabel !== undefined && legacyEncodedPackageTarget(target.url, packageId) && target.title === packageLabel
        if (requireComplete) {
          throw new Error(`Storybook package inventory observation is indeterminate: ${packageId}`, {cause: error})
        }
        return legacy
      }
    }
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
    frameSequence: Number.isSafeInteger(record.frameSequence) ? Number(record.frameSequence) : 0,
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
  if (url.origin !== origin || !validPreviewQuery(url) || url.hash.length > 0) {
    throw new Error(`Storybook package URL must belong to the exact server origin: ${value}`)
  }
  const decodedRoute = storybookPackageRouteFromPathname(url.pathname, packageId)
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

function packageTargetPath(value: string): Readonly<{segment: string; pathname: string}> | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !validPreviewQuery(url) || url.hash.length > 0) return null
    const parts = url.pathname.split("/")
    const segment = parts[parts[1] === "packages" ? 2 : 1]
    return segment ? Object.freeze({segment, pathname: url.pathname}) : null
  } catch {
    return null
  }
}

function packageTargetIdentity(value: string, packageId: string): Readonly<{packageId: string; route: string}> | null {
  const parsed = packageTargetPath(value)
  const route = parsed === null ? null : storybookPackageRouteFromPathname(parsed.pathname, packageId)
  return route === null ? null : Object.freeze({packageId, route})
}

function legacyEncodedPackageTarget(value: string, packageId: string): boolean {
  const parsed = packageTargetPath(value)
  return packageId.startsWith("@") && parsed?.pathname.startsWith("/packages/") === true && parsed.segment === encodeURIComponent(packageId)
}

function exactPackageId(value: unknown): string {
  if (typeof value !== "string" || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value)) {
    throw new Error(`Invalid Storybook package identity: ${String(value)}`)
  }
  return value
}

function exactPackageLabel(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error("Invalid Storybook browser package label")
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

function validPreviewQuery(url: URL): boolean {
  return url.search === "" || [...url.searchParams.keys()].length === 1 && url.searchParams.has("preview") &&
    /^[A-Za-z0-9_-]{1,256}$/u.test(url.searchParams.get("preview") ?? "")
}
