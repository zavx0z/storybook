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
import {StorybookViewRegistry} from "./view-registry.ts"

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
  foreground?: boolean
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
    const foreground = optionalBoolean(input.foreground, "Storybook foreground open")
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
      foreground,
    }, operationSignal))
  }

  async #openLocked(
    input: StorybookBrowserOpenInput & Readonly<{
      origin: string
      packageId: string
      route: string
      url: string
      timeoutMs: number
      foreground: boolean
    }>,
    operationSignal: AbortSignal,
  ): Promise<Readonly<{
    view: StorybookPublicView
    identity: StorybookBridgeIdentity
    reused: boolean
  }>> {
    const {origin, packageId, route, url, timeoutMs, foreground} = input
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
        const identity = packageTargetIdentity(target.url)
        const protocol = new URL(target.url).protocol
        if (identity?.packageId === packageId || protocol !== "http:" && protocol !== "https:") {
          owned.push(target)
        } else {
          this.#state.clearTarget(packageId, target.targetId)
          this.#views.forgetTarget(target.targetId)
        }
        continue
      }
      const candidate = packageTargetIdentity(target.url)
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
    const currentTargets = await this.#chrome.targets(operationSignal)
    for (const duplicate of owned) {
      if (duplicate.targetId === selected.targetId) continue
      const current = currentTargets.find(({targetId}) => targetId === duplicate.targetId)
      if (current === undefined || packageTargetIdentity(current.url)?.packageId !== packageId ||
        !await this.#attestsPackage(current, packageId, operationSignal, input.packageLabel)) continue
      await this.#chrome.closeTarget(current.targetId, operationSignal)
    }
    const current = (await this.#chrome.targets(operationSignal))
      .find(({targetId}) => targetId === selected.targetId)
    if (current === undefined || new URL(current.url).origin !== origin) {
      throw new Error(`Storybook target did not become the exact package view for ${packageId}`)
    }
    if (foreground && (packageTargetIdentity(current.url)?.packageId !== packageId ||
      !await this.#attestsPackage(current, packageId, operationSignal, input.packageLabel))) {
      throw new Error(`Storybook foreground package target attestation is indeterminate: ${packageId}`)
    }
    if (foreground) await this.#chrome.activateTarget(current.targetId, operationSignal)
    const view = this.#views.register(current, origin)
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
  ): Promise<readonly StorybookPublicView[]> {
    await this.#chrome.health(signal)
    const canonicalOrigin = loopbackOrigin(origin)
    const labels = packages === undefined ? null : new Map(packages.map(({packageId, label}) => [
      exactPackageId(packageId),
      exactPackageLabel(label),
    ] as const))
    const candidates = (await this.#chrome.targets(signal)).filter((target) =>
      target.type === "page" && packageTargetIdentity(target.url) !== null &&
      (labels === null || labels.has(packageTargetIdentity(target.url)!.packageId)))
    const grouped = new Map<string, ChromeTargetSummary[]>()
    for (const target of candidates) {
      const identity = packageTargetIdentity(target.url)
      if (identity === null) continue
      const group = grouped.get(identity.packageId) ?? []
      group.push(target)
      grouped.set(identity.packageId, group)
    }
    const retained: ChromeTargetSummary[] = []
    for (const [packageId, targets] of grouped) {
      retained.push(await this.#normalizePackageTargets(
        canonicalOrigin,
        packageId,
        targets,
        signal,
        labels?.get(packageId),
      ))
    }
    return this.#views.synchronize(retained, canonicalOrigin)
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
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
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

  getView(viewId: string): StorybookPublicView {
    return this.#views.public(viewId)
  }

  async interact(input: StorybookBrowserInteractInput, signal?: AbortSignal): Promise<Readonly<Record<string, unknown>>> {
    const view = this.#views.internal(input.viewId)
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
      if (current !== undefined && packageTargetIdentity(current.url)?.packageId === view.packageId) {
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

  async #attestsPackage(
    target: ChromeTargetSummary,
    packageId: string,
    signal: AbortSignal,
    packageLabel?: string,
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
        const markerPackageId = markers.packageId
        if (packageTargetIdentity(target.url)?.packageId !== packageId ||
          typeof markerPackageId === "string" && markerPackageId !== packageId) return false
        const revisionPrefix = `/__storybook/revisions/${encodeURIComponent(packageId)}/`
        const ownsRevisionScript = Array.isArray(diagnostic.scripts) &&
          diagnostic.scripts.some((value) => typeof value === "string" && value.startsWith(revisionPrefix))
        return markerPackageId === packageId ||
          diagnostic.viewName === `storybook:${packageId}` &&
            (markerPackageId === null || markerPackageId === undefined) ||
          ownsRevisionScript ||
          packageLabel !== undefined && target.title === packageLabel
      } catch {
        return packageTargetIdentity(target.url)?.packageId === packageId &&
          packageLabel !== undefined && target.title === packageLabel
      }
    }
  }

  async #attestationSummary(
    target: ChromeTargetSummary,
    packageId: string,
    signal: AbortSignal,
    packageLabel?: string,
  ): Promise<string> {
    try {
      const diagnostic = await this.#chrome.bridgeDiagnostics(target.targetId, signal)
      const markers = diagnostic.markers !== null && typeof diagnostic.markers === "object" &&
        !Array.isArray(diagnostic.markers)
        ? diagnostic.markers as Record<string, unknown>
        : {}
      const marker = markers.packageId
      const scripts = Array.isArray(diagnostic.scripts) ? diagnostic.scripts : []
      const revisionPrefix = `/__storybook/revisions/${encodeURIComponent(packageId)}/`
      return [
        `name=${diagnostic.viewName === `storybook:${packageId}` ? "exact" : diagnostic.viewName ? "other" : "empty"}`,
        `marker=${marker === packageId ? "exact" : typeof marker === "string" ? "conflict" : "empty"}`,
        `title=${packageLabel === undefined ? "unavailable" : target.title === packageLabel ? "exact" : target.title ? "other" : "empty"}`,
        `revisionScript=${scripts.some((value) => typeof value === "string" && value.startsWith(revisionPrefix)) ? "yes" : "no"}`,
      ].join(",")
    } catch {
      return `diagnostics=unavailable,title=${packageLabel === undefined
        ? "unavailable"
        : target.title === packageLabel
          ? "exact"
          : target.title
            ? "other"
            : "empty"}`
    }
  }

  async #normalizePackageTargets(
    origin: string,
    packageId: string,
    targets: readonly ChromeTargetSummary[],
    signal?: AbortSignal,
    packageLabel?: string,
  ): Promise<ChromeTargetSummary> {
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: `package:${packageId}`,
      ...(signal === undefined ? {} : {signal}),
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      const cdpOrigin = await this.#chrome.cdpOrigin(signal)
      const browserIdentity = await this.#chrome.browserIdentity(signal)
      const recorded = this.#state.readTarget(packageId)
      let selected = targets.find(({targetId}) => recorded?.phase === "owned" &&
        recorded.cdpOrigin === cdpOrigin && recorded.browserIdentity === browserIdentity &&
        recorded.targetId === targetId) ??
        targets.find((target) => new URL(target.url).origin === origin) ??
        targets[0]
      if (selected === undefined) throw new Error(`Storybook package has no attested target: ${packageId}`)
      if (new URL(selected.url).origin !== origin) {
        const previous = new URL(selected.url)
        const nextUrl = new URL(`${previous.pathname}${previous.search}${previous.hash}`, origin).href
        await this.#chrome.navigate(selected.targetId, nextUrl, signal)
        await this.#chrome.waitReady(selected.targetId, 30_000, signal)
        const identity = await this.#waitBridgeIdentity(selected.targetId, 30_000, signal)
        if (identity.packageId !== packageId) {
          throw new Error(`Storybook normalized target belongs to another package: ${packageId}`)
        }
        selected = (await this.#chrome.targets(signal)).find(({targetId}) => targetId === selected!.targetId)
        if (selected === undefined) throw new Error(`Storybook normalized target disappeared: ${packageId}`)
      }
      const selectedSignal = signal ?? AbortSignal.timeout(5_000)
      if (packageTargetIdentity(selected.url)?.packageId !== packageId ||
        !await this.#attestsPackage(selected, packageId, selectedSignal, packageLabel)) {
        throw new Error(`Storybook selected package target attestation is indeterminate: ${packageId}`)
      }
      const selectedTargetId = selected.targetId
      for (const duplicate of targets) {
        if (duplicate.targetId === selectedTargetId) continue
        const current = (await this.#chrome.targets(signal)).find(({targetId}) => targetId === duplicate.targetId)
        if (current === undefined || packageTargetIdentity(current.url)?.packageId !== packageId) continue
        const operationSignal = signal ?? AbortSignal.timeout(5_000)
        if (!await this.#attestsPackage(current, packageId, operationSignal, packageLabel)) {
          const evidence = await this.#attestationSummary(current, packageId, operationSignal, packageLabel)
          throw new Error(
            `Storybook duplicate package target attestation is indeterminate: ${packageId}; ${evidence}`,
          )
        }
        await this.#chrome.closeTarget(current.targetId, signal)
      }
      const retained = (await this.#chrome.targets(signal)).find(({targetId}) => targetId === selectedTargetId)
      if (retained === undefined || new URL(retained.url).origin !== origin ||
        packageTargetIdentity(retained.url)?.packageId !== packageId ||
        !await this.#attestsPackage(
          retained,
          packageId,
          signal ?? AbortSignal.timeout(5_000),
          packageLabel,
        )) {
        throw new Error(`Storybook retained package target changed during normalization: ${packageId}`)
      }
      selected = retained
      this.#state.writeTarget({packageId, cdpOrigin, browserIdentity, targetId: selected.targetId})
      return selected
    })
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

function optionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined) return false
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`)
  return value
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
