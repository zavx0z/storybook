/**
Общее пространство внешнего Storybook: выбранный предмет, инспекция, ввод
и снимки в одной браузерной странице. Смена адреса сохраняет пространство
и проверяет принадлежность каждого последующего действия.

@packageDocumentation
*/
import {preserveStorybookInspector, sameStorybookViewUrl} from "./src/view-query.ts"
import routeUrl from "@zavx0z/storybook-package-route-url"
import {resolve} from "node:path"
import type {
  ChromeTargetSummary,
  StorybookBrowserPackage,
  StoredStorybookCapture,
  StorybookBridgeClip,
  StorybookBridgeIdentity,
  StorybookBrowserCaptureInput,
  StorybookBrowserInteractInput,
  StorybookChromeClient,
  StorybookChromeConsoleEntry,
  StorybookProcessStart,
  StorybookPublicView,
  StorybookBrowserOpenInput,
  StorybookBrowserCaptureResult,
} from "./contract/types"
import type {StorybookAppServerBrowser} from "./contract"
import {StorybookCaptureStore} from "./src/capture-store.ts"
import {StorybookCdpClient} from "./src/chrome-client.ts"
import {StorybookBrowserState} from "./src/browser-state.ts"
import {withStorybookBrowserLock} from "./src/target-operation-lock.ts"
import {StorybookViewRegistry} from "./src/view-registry.ts"

export type {StorybookAppServerBrowser} from "./contract"

const {validViewQuery: validStorybookViewQuery, storybookPackageRouteFromPathname} = routeUrl

/**
Создаёт жизненный цикл общего пространства и хранилище снимков.

@param options - Корни приватного состояния и необязательный Chrome client
согласно {@link StorybookAppServerBrowser.Input}.
@returns Операции одного browser owner согласно
{@link StorybookAppServerBrowser.Output}.
*/
export default function createStorybookBrowserLifecycle(
  options: StorybookAppServerBrowser.Input,
): StorybookAppServerBrowser.Output {
  const stateRoot = resolve(options.stateRoot)
  return new DefaultStorybookBrowserLifecycle({
    state: new StorybookBrowserState(stateRoot),
    chrome: options.chrome ?? new StorybookCdpClient({
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

/** Единственный владелец браузерного пространства канонического сервера Storybook. */
class DefaultStorybookBrowserLifecycle implements StorybookAppServerBrowser.Output {
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
    const packageId = input.packageId === null ? null : exactPackageId(input.packageId)
    const route = exactRoute(input.route)
    const url = exactPackageUrl(input.url, origin, packageId, route)
    const timeoutMs = boundedTimeout(input.timeoutMs ?? 30_000)
    const timeout = AbortSignal.timeout(timeoutMs)
    const operationSignal = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let phase = "workspace lock"
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: "workspace",
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
    }, operationSignal, next => { phase = next })).catch(error => {
      const failure = new Error(`Storybook open failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`, {cause: error})
      if (error instanceof Error) failure.name = error.name
      throw failure
    })
  }

  async #openLocked(
    input: StorybookBrowserOpenInput & Readonly<{origin: string; route: string; url: string; timeoutMs: number}>,
    signal: AbortSignal,
    reportPhase: (phase: string) => void,
  ): Promise<Readonly<{view: StorybookPublicView; identity: StorybookBridgeIdentity; reused: boolean}>> {
    const {origin, packageId, route, url, timeoutMs} = input
    reportPhase("Chrome connection")
    await this.#chrome.ensure(signal)
    reportPhase("workspace inventory")
    const targets = await this.#chrome.targets(signal)
    const cdpOrigin = await this.#chrome.cdpOrigin(signal)
    const browserIdentity = await this.#chrome.browserIdentity(signal)
    let record = this.#state.readWorkspace()
    const sameBrowser = record?.cdpOrigin === cdpOrigin && record.browserIdentity === browserIdentity
    const pending = sameBrowser && record?.phase === "reserved" ? record : null
    const receipts = pending?.url === null || pending === null ? [] : targets.filter(target =>
      target.type === "page" && !pending.baselineTargetIds.includes(target.targetId) && target.url === pending.url)
    if (receipts.length > 1) throw new Error("Ambiguous Storybook reserved workspace target")
    let selected = receipts[0] ?? null
    let unresolved = pending?.createSent === true && selected === null ? pending : null
    reportPhase("workspace attestation")
    const workspace = selected === null ? await this.#observeWorkspace(origin, signal, input.knownPackages, {
      targets,
      ...(unresolved === null ? {} : {baseline: new Set(unresolved.baselineTargetIds)}),
      recover: input.recover === true,
      timeoutMs,
      ...(sameBrowser && record?.phase === "owned" ? {preferred: record.targetId} : {}),
    }) : null
    selected ??= workspace?.target ?? null
    if (input.followEnvironment === true && workspace?.identity?.followEnvironment !== true) throw new Error("Storybook environment following was disabled before navigation")
    const reused = selected !== null
    if (selected === null) {
      if (unresolved !== null) {
        const present = targets.some(target => target.type === "page" && workspaceCandidateUrl(target.url, origin))
        if (input.recover !== true || present) {
          const evidence = await this.#reservationEvidence(unresolved, targets, origin, signal)
          throw new Error(`Storybook workspace target creation is indeterminate; evidence=${JSON.stringify(evidence)}`)
        }
        signal.throwIfAborted()
        this.#state.clearWorkspace()
        unresolved = null
        record = null
      }
      if (pending === null || record === null || record.url !== url) {
        this.#state.reserveWorkspace({packageId, cdpOrigin, browserIdentity, url,
          baselineTargetIds: targets.map(({targetId}) => targetId)})
      }
      reportPhase("workspace creation")
      const beforeSend = () => { this.#state.markCreateSent() }
      try {
        if (this.#chrome.createTargetWithDispatch !== undefined) {
          selected = await this.#chrome.createTargetWithDispatch(url, beforeSend, signal)
        } else {
          beforeSend()
          selected = await this.#chrome.createTarget(url, signal)
        }
      } catch (error) {
        this.#state.clearUnsentReservation()
        throw error
      }
    }
    const navigationUrl = preserveStorybookInspector(url, selected.url)
    const sameDestination = sameStorybookViewUrl(selected.url, navigationUrl)
    // Запись receipt создаётся до ожидания bridge; timeout не разрешает новый create.
    if (unresolved === null) this.#state.writeWorkspace({packageId: workspace !== null ? workspace.packageId : reused && pending !== null ? pending.packageId : packageId,
      cdpOrigin, browserIdentity, targetId: selected.targetId, url: selected.url,
      viewName: typeof workspace?.raw?.viewName === "string" ? workspace.raw.viewName : undefined})
    reportPhase("workspace readiness")
    let before = workspace?.identity ?? null
    const legacy = workspace !== null && (workspace.raw?.capabilities as {inPageNavigation?: unknown} | undefined)?.inPageNavigation !== true
    const nativeNavigation = workspace?.stalled === true || new URL(selected.url).origin !== origin ||
      legacy && (!sameDestination || input.expectedRevision !== undefined && before?.revision !== input.expectedRevision)
    if (nativeNavigation) {
      // Только bootstrap legacy, перенос записанного origin или явный recover могут заменить realm.
      const current = (await this.#chrome.targets(signal)).find(target => target.targetId === selected!.targetId)
      if (current?.url !== selected.url) throw new Error("Storybook recovery target changed before navigation")
      if (workspace?.stalled === true) {
        const previous = new URL(selected.url)
        const requested = new URL(navigationUrl)
        previous.searchParams.delete("preview")
        requested.searchParams.delete("preview")
        if (!sameStorybookViewUrl(previous.href, requested.href) ||
          !sameDestination && input.expectedRevision === undefined) throw new Error("Storybook recovery route change is not authorised")
      }
      await this.#chrome.navigate(selected.targetId, navigationUrl, signal)
      before = null
    }
    await this.#chrome.waitReady(selected.targetId, timeoutMs, signal)
    reportPhase("agent bridge")
    let identity = before ?? await this.#waitBridgeIdentity(selected.targetId, timeoutMs, signal)
    if (reused && !nativeNavigation && (!sameDestination || identity.packageId !== packageId ||
      identity.route !== route || input.expectedRevision !== undefined && identity.revision !== input.expectedRevision)) {
      const navigationIdentity = workspace?.raw ?? objectResult(await this.#chrome.callBridge(selected.targetId, "identity", {schemaVersion: 1}, signal), "Storybook workspace identity")
      if ((navigationIdentity.capabilities as {inPageNavigation?: unknown} | undefined)?.inPageNavigation !== true) {
        throw new Error("Storybook workspace requires a legacy navigation upgrade")
      }
      if (input.followEnvironment === true && navigationIdentity.followEnvironment !== true) throw new Error("Storybook environment following was disabled before navigation")
      const previous = identity
      const result = bridgeIdentity(await this.#chrome.callBridge(selected.targetId, "navigate", {
        schemaVersion: 1, expectedPackageId: previous.packageId, packageId, route,
        url: new URL(navigationUrl).pathname + new URL(navigationUrl).search,
        ...(input.expectedRevision === undefined ? {} : {revision: input.expectedRevision}),
        ...(input.followEnvironment === true ? {followEnvironment: true} : {}),
      }, signal))
      identity = await this.#waitBridgeIdentity(selected.targetId, timeoutMs, signal)
      if (identity.timeOrigin !== previous.timeOrigin || result.timeOrigin !== previous.timeOrigin) {
        throw new Error("Storybook in-page navigation replaced its realm")
      }
    }
    if (identity.packageId !== packageId || identity.route !== route) {
      throw new Error(`Storybook bridge identity mismatch: expected ${packageId}:${route}`)
    }
    if (input.expectedRevision !== undefined && identity.revision !== input.expectedRevision) {
      throw new Error(`Storybook view revision mismatch: expected ${input.expectedRevision}`)
    }
    if (!identity.ready) throw new Error("Storybook workspace did not become ready")
    const current = (await this.#chrome.targets(signal)).find(target => target.targetId === selected!.targetId)
    if (current === undefined || !workspaceUrl(current.url, origin) || !mayAttestPackageTarget(current.url, packageId)) {
      throw new Error("Storybook target did not become the exact workspace address")
    }
    if (unresolved === null) this.#state.writeWorkspace({packageId, cdpOrigin, browserIdentity,
      targetId: selected.targetId, url: current.url, viewName: identity.viewName})
    const view = this.#views.register({...current, packageId, route: identity.route}, origin)
    return Object.freeze({view, identity, reused})
  }

  async #observeWorkspace(
    origin: string,
    signal?: AbortSignal,
    packages?: readonly StorybookBrowserPackage[],
    options: Readonly<{
      targets?: readonly ChromeTargetSummary[]
      baseline?: ReadonlySet<string>
      preferred?: string
      recover?: boolean
      timeoutMs?: number
    }> = {},
  ): Promise<Readonly<{
    target: ChromeTargetSummary
    packageId: string | null
    identity: StorybookBridgeIdentity | null
    raw: Record<string, unknown> | null
    stalled: boolean
  }> | null> {
    const record = this.#state.readWorkspace()
    const targets = options.targets ?? await this.#chrome.targets(signal)
    const preferred = options.preferred ?? (record?.phase === "owned" ? record.targetId : undefined)
    const candidates = targets.filter(target => target.type === "page" &&
      (workspaceUrl(target.url, origin) || target.targetId === options.preferred && workspaceUrl(target.url, new URL(target.url).origin)) &&
      (options.baseline === undefined || options.baseline.has(target.targetId)))
    candidates.sort((left, right) => Number(right.targetId === preferred) - Number(left.targetId === preferred))
    const observed = []
    let indeterminate: unknown = null
    for (const target of candidates) {
      signal?.throwIfAborted()
      const observationSignal = signal === undefined ? AbortSignal.timeout(1_000) :
        AbortSignal.any([signal, AbortSignal.timeout(Math.max(50, Math.min(1_000, Math.floor((options.timeoutMs ?? 3_000) / 3))))])
      try {
        const raw = objectResult(await this.#chrome.callBridge(target.targetId, "identity", {schemaVersion: 1}, observationSignal), "Storybook workspace identity")
        const identity = bridgeIdentity(raw)
        if (!mayAttestPackageTarget(target.url, identity.packageId) || identity.packageId !== null &&
          packages !== undefined && !packages.some(item => item.packageId === identity.packageId)) continue
        const result = {target, packageId: identity.packageId, identity, raw, stalled: false}
        // После миграции записанное пространство остаётся единственным физическим owner.
        if (target.targetId === preferred && this.#state.hasWorkspace()) return result
        if ((raw.nativePage as {hasFocus?: unknown} | undefined)?.hasFocus === true) return result
        observed.push(result)
      } catch (error) {
        signal?.throwIfAborted()
        if (target.targetId === preferred && record?.phase === "owned") {
          const diagnosticSignal = signal === undefined ? AbortSignal.timeout(1_000) :
            AbortSignal.any([signal, AbortSignal.timeout(1_000)])
          const diagnostics = await this.#chrome.bridgeDiagnostics(target.targetId, diagnosticSignal)
          const markers = diagnostics.markers === undefined ? {} : objectResult(diagnostics.markers, "Storybook workspace markers")
          if (mayAttestPackageTarget(target.url, record.packageId) && markers.packageId === record.packageId &&
            matchesWorkspaceName(diagnostics.viewName, record.packageId, record.viewName !== "storybook:workspace")) {
            if (options.recover !== true) throw error
            if (new URL(target.url).origin !== origin || record.url !== null && !sameStorybookViewUrl(record.url, target.url)) throw new Error("Storybook recovery target address does not match its record")
            return {target, packageId: record.packageId, identity: null, raw: null, stalled: true}
          }
          if (options.recover !== true) throw error
          throw new Error("Storybook recovery recorded workspace ownership is indeterminate", {cause: error})
        }
        try {
          await this.#chrome.bridgeDiagnostics(target.targetId, AbortSignal.timeout(500))
        } catch (diagnosticError) {
          signal?.throwIfAborted()
          indeterminate = diagnosticError
        }
      }
    }
    if (observed.length === 0 && indeterminate !== null) throw new Error("Storybook browser inventory observation is indeterminate", {cause: indeterminate})
    observed.sort((left, right) => Number((right.raw.nativePage as {hasFocus?: unknown} | undefined)?.hasFocus === true) - Number((left.raw.nativePage as {hasFocus?: unknown} | undefined)?.hasFocus === true) ||
      Number((right.raw.nativePage as {visibilityState?: unknown} | undefined)?.visibilityState === "visible") - Number((left.raw.nativePage as {visibilityState?: unknown} | undefined)?.visibilityState === "visible") ||
      Number(right.target.targetId === preferred) - Number(left.target.targetId === preferred))
    return observed[0] ?? null
  }

  async currentWorkspace(origin: string, signal?: AbortSignal, packages?: readonly StorybookBrowserPackage[]): Promise<Readonly<{
    view: StorybookPublicView
    identity: StorybookBridgeIdentity
  }> | null> {
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(), scope: "workspace",
      ...(signal === undefined ? {} : {signal}),
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      const canonicalOrigin = loopbackOrigin(origin)
      const workspace = await this.#observeWorkspace(canonicalOrigin, signal, packages)
      signal?.throwIfAborted()
      if (workspace?.identity === null || workspace === null) {
        this.#views.synchronize([], canonicalOrigin)
        return null
      }
      const record = this.#state.readWorkspace()
      if (record?.phase !== "reserved" || !record.createSent) {
        const cdpOrigin = await this.#chrome.cdpOrigin(signal)
        const browserIdentity = await this.#chrome.browserIdentity(signal)
        this.#state.writeWorkspace({packageId: workspace.packageId, cdpOrigin, browserIdentity,
          targetId: workspace.target.targetId, url: workspace.target.url, viewName: workspace.identity.viewName})
      }
      const view = this.#views.register({...workspace.target, packageId: workspace.packageId, route: workspace.identity.route}, canonicalOrigin)
      return Object.freeze({view, identity: workspace.identity})
    })
  }

  async listViews(origin: string, signal?: AbortSignal, packages?: readonly StorybookBrowserPackage[], packageId?: string): Promise<readonly StorybookPublicView[]> {
    const workspace = await this.currentWorkspace(origin, signal, packages)
    const scope = packageId === undefined ? undefined : exactPackageId(packageId)
    return Object.freeze(workspace === null || scope !== undefined && workspace.view.packageId !== scope ? [] : [workspace.view])
  }

  async applyRevision(
    viewId: string,
    revision: string,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (!/^[A-Za-z0-9_-]{1,256}$/u.test(revision)) throw new Error("Invalid Storybook revision")
    const view = this.#views.internal(viewId)
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: "workspace",
      ...(signal === undefined ? {} : {signal}),
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      await this.#assertCurrentPackage(viewId, signal)
      const initial = objectResult(await this.#chrome.callBridge(
        view.targetId, "identity", {schemaVersion: 1}, signal,
      ), "Storybook current realm")
      if ((initial.capabilities as {inPageUpdates?: unknown} | undefined)?.inPageUpdates !== true) {
        throw new Error("Storybook page restart is required to install in-page updates")
      }
      const before = bridgeIdentity(initial)
      // Только применение ревизии может заменить уже существующий preview pin.
      // Обычный адрес и все остальные части выбранного адреса сохраняются.
      const attest = async (appliedRevision: string, applied: Readonly<Record<string, unknown>>) => {
        const expected = new URL(view.url)
        if (expected.searchParams.has("preview")) expected.searchParams.set("preview", appliedRevision)
        const after = bridgeIdentity(await this.#chrome.callBridge(
          view.targetId, "identity", {schemaVersion: 1}, signal,
        ))
        const target = (await this.#chrome.targets(signal)).find(target => target.targetId === view.targetId)
        if (target === undefined || target.type !== "page" || !validStorybookViewQuery(new URL(target.url)) ||
          !sameStorybookViewUrl(target.url, expected.href) || new URL(target.url).origin !== view.origin ||
          !mayAttestPackageTarget(target.url, view.packageId)) {
          throw new Error("Storybook view navigated away during revision application")
        }
        if (after.timeOrigin !== before.timeOrigin || after.packageId !== view.packageId ||
          after.route !== view.route || after.revision !== appliedRevision || applied.revision !== appliedRevision) {
          throw new Error("Storybook in-page application replaced its realm or returned another revision")
        }
        return {target, identity: after}
      }
      const commit = ({target, identity}: Awaited<ReturnType<typeof attest>>) => {
        const record = this.#state.readWorkspace()
        if (record?.phase === "owned" && record.targetId === view.targetId && record.browserIdentity !== null) {
          this.#state.writeWorkspace({packageId: view.packageId, cdpOrigin: record.cdpOrigin,
            browserIdentity: record.browserIdentity, targetId: view.targetId, url: target.url, viewName: identity.viewName})
        }
        this.#views.register({...target, packageId: view.packageId, route: view.route}, view.origin)
      }
      const priorConsole = await this.#chrome.consoleEntries(view.targetId, 0, signal)
      const current = await this.#assertCurrentPackage(viewId, signal)
      if (current.timeOrigin !== before.timeOrigin) throw new Error("Storybook revision source replaced its realm")
      const result = objectResult(await this.#chrome.callBridge(view.targetId, "applyRevision", {
        schemaVersion: 1, expectedPackageId: view.packageId, revision,
      }, signal), "Storybook in-page application")
      await attest(revision, result)
      const currentConsole = await this.#chrome.consoleEntries(view.targetId, 250, signal)
      const seen = new Set(priorConsole.filter(entry => typeof entry.timestamp === "number").map(entry => JSON.stringify(entry)))
      const errors = consoleErrors(currentConsole.filter(entry => !seen.has(JSON.stringify(entry))))
      const applied = await attest(revision, result)
      if (errors.length > 0) {
        if (before.revision !== null && before.revision !== "unavailable" && before.revision !== revision) {
          const rollback = objectResult(await this.#chrome.callBridge(view.targetId, "applyRevision", {
            schemaVersion: 1, expectedPackageId: view.packageId, revision: before.revision,
          }, signal), "Storybook revision rollback")
          commit(await attest(before.revision, rollback))
        } else commit(applied)
        throw new Error("Storybook new revision reported console errors; previous revision retained")
      }
      commit(applied)
      return Object.freeze({...result, viewId, inPageApplied: true, consoleErrors: errors})
    })
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
      if (!signal?.aborted && input.include?.includes("diagnostics") && this.#chrome.sampleExecution !== undefined) {
        const target = (await this.#chrome.targets(signal)).find(target => target.targetId === view.targetId)
        if (target && new URL(target.url).origin === view.origin && sameStorybookViewUrl(target.url, view.url)) {
          return Object.freeze({
            ready: false,
            bridgeAvailable: false,
            view: this.#views.public(viewId),
            diagnostics: [{phase: "bridge", message: error instanceof Error ? error.message : String(error)}],
            execution: await this.#chrome.sampleExecution(view.targetId, signal),
          })
        }
      }
      if (!(error instanceof Error) || error.message !== "Storybook agent bridge is unavailable in the exact target") throw error
      const target = (await this.#chrome.targets(signal)).find(target => target.targetId === view.targetId)
      if (!target || new URL(target.url).origin !== view.origin ||
        !mayAttestPackageTarget(target.url, view.packageId) ||
        !await this.#attestsPackage(target, view.packageId, signal ?? AbortSignal.timeout(5_000))) throw error
      bridgeAvailable = false
    }
    return withStorybookBrowserLock({
      root: this.#state.lockRoot(),
      scope: "workspace",
      ...(signal === undefined ? {} : {signal}),
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      if (bridgeAvailable) await this.#assertCurrentPackage(viewId, signal)
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
      scope: "workspace",
      timeoutMs: input.timeoutMs ?? 8_000,
      signal: operationSignal,
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      await this.#assertCurrentPackage(input.viewId, operationSignal)
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
      scope: "workspace",
      timeoutMs: input.timeoutMs ?? 30_000,
      signal: operationSignal,
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      await this.#assertCurrentPackage(input.viewId!, operationSignal)
      const identity = bridgeIdentity(await this.#chrome.callBridge(
        view.targetId,
        "identity",
        Object.freeze({schemaVersion: 1}),
        operationSignal,
      ))
      if (identity.packageId !== view.packageId || identity.route !== view.route) throw new Error("Storybook view navigated to another package or route")
      if (!identity.ready || !identity.presented || identity.graphDigest === null ||
        (identity.packageId === null ? identity.route !== "" || identity.revision !== null : identity.revision === null)) {
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
      await this.#assertCurrentPackage(input.viewId!, operationSignal)
      const png = await this.#chrome.screenshot(view.targetId, {
        caption: `Ожидаю готовый ${input.area} Storybook ${identity.packageId ?? "Project"} на exact route ${identity.route}`,
        ...(clip === undefined ? {} : {clip}),
        ...(input.timeoutMs === undefined ? {} : {timeoutMs: input.timeoutMs}),
      }, operationSignal)
      const capturedIdentity = await this.#assertCurrentPackage(input.viewId!, operationSignal)
      if (capturedIdentity.revision !== identity.revision || capturedIdentity.graphDigest !== identity.graphDigest ||
        capturedIdentity.timeOrigin !== identity.timeOrigin) throw new Error("Storybook capture identity changed during screenshot")
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
      scope: "workspace",
      ...(signal === undefined ? {} : {signal}),
      ...(this.#processStart === undefined ? {} : {processStart: this.#processStart}),
    }, async () => {
      const current = (await this.#chrome.targets(signal)).find(({targetId}) => targetId === view.targetId)
      if (current !== undefined && sameStorybookViewUrl(current.url, view.url) && mayAttestPackageTarget(current.url, view.packageId)) {
        const attested = await this.#attestsPackage(
          current,
          view.packageId,
          signal ?? AbortSignal.timeout(5_000),
        )
        if (!attested) {
          throw new Error(`Storybook exact package target attestation is indeterminate: ${view.packageId}`)
        }
        await this.#assertCurrentPackage(viewId, signal)
        await this.#chrome.closeTarget(view.targetId, signal)
        this.#state.clearWorkspace(view.targetId)
        this.#views.forget(viewId)
        return Object.freeze({closed: true, viewId})
      }
      this.#state.clearWorkspace(view.targetId)
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

  async #assertCurrentPackage(viewId: string, signal?: AbortSignal): Promise<StorybookBridgeIdentity> {
    const view = this.#views.internal(viewId)
    const target = (await this.#chrome.targets(signal)).find(target => target.targetId === view.targetId)
    if (target === undefined || !sameStorybookViewUrl(target.url, view.url) || new URL(target.url).origin !== view.origin || !mayAttestPackageTarget(target.url, view.packageId)) {
      throw new Error("Storybook view navigated away from the requested package")
    }
    const identity = bridgeIdentity(await this.#chrome.callBridge(view.targetId, "identity", {schemaVersion: 1}, signal))
    if (identity.packageId !== view.packageId || identity.route !== view.route) throw new Error("Storybook view navigated to another package or route")
    return identity
  }

  async #reservationEvidence(
    record: Extract<ReturnType<StorybookBrowserState["readWorkspace"]>, {phase: "reserved"}>,
    targets: readonly ChromeTargetSummary[],
    origin: string,
    signal: AbortSignal,
  ) {
    const candidates = targets.filter(target => target.type === "page" && workspaceCandidateUrl(target.url, origin))
    const observations = []
    for (const target of candidates.slice(0, 3)) {
      signal.throwIfAborted()
      const observationSignal = AbortSignal.any([signal, AbortSignal.timeout(1_000)])
      let attestation = "indeterminate"
      let ready: boolean | null = null
      let presented: boolean | null = null
      try {
        const identity = bridgeIdentity(await this.#chrome.callBridge(target.targetId, "identity", {schemaVersion: 1}, observationSignal))
        attestation = identity.ready ? "verified" : "not-ready"
        ready = identity.ready
        presented = identity.presented
      } catch {
        signal.throwIfAborted()
        if (!observationSignal.aborted) {
          try {
            const diagnostic = await this.#chrome.bridgeDiagnostics(target.targetId, observationSignal)
            const markers = objectResult(diagnostic.markers, "Storybook target markers")
            attestation = markers.packageId === record.packageId
              ? "bootstrap-owned" : "not-attested"
          } catch {signal.throwIfAborted()}
        }
      }
      observations.push({path: new URL(target.url).pathname, inBaseline: record.baselineTargetIds.includes(target.targetId),
        sameReservationUrl: target.url === record.url, attestation, ready, presented})
    }
    return {reservation: {protocol: record.protocol, phase: record.phase, createSent: record.createSent,
      recordedReceipt: false, sendHistoryAvailable: false, expectedPath: new URL(record.url!).pathname},
      observation: {inventoryCompleted: true, sameBrowserSession: true,
        exactNewReservationUrlCount: candidates.filter(target => !record.baselineTargetIds.includes(target.targetId) && target.url === record.url).length,
        matchingWorkspaceCount: candidates.length, omittedCount: Math.max(0, candidates.length - observations.length), targets: observations}}
  }

  async #attestsPackage(target: ChromeTargetSummary, packageId: string | null, signal: AbortSignal): Promise<boolean> {
    try {
      return bridgeIdentity(await this.#chrome.callBridge(target.targetId, "identity", {schemaVersion: 1}, signal)).packageId === packageId
    } catch {
      signal.throwIfAborted()
      const diagnostic = await this.#chrome.bridgeDiagnostics(target.targetId, signal)
      const markers = objectResult(diagnostic.markers, "Storybook target markers")
      return mayAttestPackageTarget(target.url, packageId) && markers.packageId === packageId &&
        matchesWorkspaceName(diagnostic.viewName, packageId, this.#state.readWorkspace()?.viewName !== "storybook:workspace")
    }
  }

  async #waitBridgeIdentity(
    targetId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<StorybookBridgeIdentity> {
    const deadline = Date.now() + boundedTimeout(timeoutMs)
    let unavailable: unknown = null
    try {
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
          if (!(error instanceof Error) || error.message !== "Storybook agent bridge is unavailable in the exact target" &&
            error.name !== "StorybookCdpTargetTransition") {
            throw error
          }
          unavailable = error
        }
        await Bun.sleep(Math.min(50, Math.max(1, deadline - Date.now())))
      }
    } catch (error) {
      if (!signal?.aborted) throw error
      unavailable = error
    }
    // Истёкший deadline не должен уничтожать read-only причину сбоя загрузки страницы.
    const diagnosticSignal = AbortSignal.timeout(2_000)
    const entries = await this.#chrome.consoleEntries(targetId, 250, diagnosticSignal).catch(() => Object.freeze([]))
    const diagnostics = consoleErrors(entries)
      .map(({text}) => typeof text === "string" ? text : "browser error")
      .slice(0, 5)
      .join(" | ")
    const bridgeDiagnostics = await this.#chrome.bridgeDiagnostics(targetId, diagnosticSignal)
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
  const packageId = record.packageId === null ? null : exactPackageId(record.packageId)
  const route = exactRoute(record.route)
  const revision = optionalText(record.revision, "bridge revision", 256)
  if (!matchesWorkspaceName(record.viewName, packageId, (record.capabilities as {inPageNavigation?: unknown} | undefined)?.inPageNavigation !== true)) {
    throw new Error("Storybook bridge window.name does not match its workspace identity")
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
    viewName: String(record.viewName),
    packageId,
    route,
    revision,
    graphDigest: optionalDigest(record.graphDigest),
    ready: record.ready === true,
    presented: record.presented === true,
    timeOrigin: finiteNumber(record.timeOrigin, "bridge timeOrigin"),
    frameSequence: Number.isSafeInteger(record.frameSequence) ? Number(record.frameSequence) : 0,
    followEnvironment: record.followEnvironment === true,
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

function exactPackageUrl(value: string, origin: string, packageId: string | null, route: string): string {
  const url = new URL(value)
  if (url.origin !== origin || !validStorybookViewQuery(url) || url.hash.length > 0) {
    throw new Error(`Storybook package URL must belong to the exact server origin: ${value}`)
  }
  if (packageId === null) {
    if (url.pathname !== "/" || route !== "") throw new Error("Storybook landing address must be root")
    return url.href
  }
  const decodedRoute = storybookPackageRouteFromPathname(url.pathname, packageId)
  if ((url.pathname.startsWith("/pkg-") || url.pathname.startsWith("/packages/")) && decodedRoute !== route) throw new Error(`Storybook package URL route mismatch: ${decodedRoute}; expected ${route}`)
  if (url.pathname === "/") throw new Error("Storybook package URL cannot be landing")
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
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || !validStorybookViewQuery(url) || url.hash.length > 0) return null
    const parts = url.pathname.split("/")
    const segment = parts[parts[1] === "packages" ? 2 : 1]
    return segment ? Object.freeze({segment, pathname: url.pathname}) : null
  } catch {
    return null
  }
}

/** Структурный адрес разрешает проверку bridge, но сам не доказывает принадлежность пакету. */
function mayAttestPackageTarget(value: string, packageId: string | null): boolean {
  if (packageId === null) {
    try {return new URL(value).pathname === "/"} catch {return false}
  }
  const parsed = packageTargetPath(value)
  if (parsed === null) return false
  if (parsed.pathname.startsWith("/pkg-") || parsed.pathname.startsWith("/packages/")) {
    return storybookPackageRouteFromPathname(parsed.pathname, packageId) !== null
  }
  return true
}

function matchesWorkspaceName(value: unknown, packageId: string | null, allowLegacy: boolean): boolean {
  return value === "storybook:workspace" || allowLegacy && packageId !== null && value === `storybook:${packageId}`
}

function workspaceCandidateUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value)
    return url.origin === origin && url.pathname.startsWith("/") && !url.pathname.startsWith("/__storybook/")
  } catch {return false}
}

function workspaceUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) &&
      url.origin === origin && validStorybookViewQuery(url) && url.hash.length === 0 &&
      (url.pathname === "/" || packageTargetPath(value) !== null)
  } catch {
    return false
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
