/**
Управляет единым пространством Storybook: иерархией пакетов, выбранным
адресом и независимыми представлениями Home и Package в настоящих Display.
Число удерживаемых исполнений ограничено; выбор сохраняет соседние представления.
Навигация загружает содержимое при смене адреса. Перемещение ViewPoint меняет
обзор и видимость готового дерева; посещённые представления остаются в пределах бюджета.
Подготовка цели и запись истории восстанавливают прежний выбор при ошибке.
При HMR сохраняет пользовательское состояние и передаёт существующий Canvas новой среде.

@packageDocumentation
*/
import WebClient from "@zavx0z/storybook-app-web-page-client"
import WebProtocol from "@zavx0z/storybook-app-web-protocol"
import type {StorybookTechHmrConnection} from "@zavx0z/storybook-tech-hmr-connection"
import createHmrPage from "@zavx0z/storybook-tech-hmr-page"
import PageTarget from "@zavx0z/storybook-app-web-page-target"
import createStorybookAgentBridge from "@zavx0z/storybook-app-web-page-agent-bridge"
import indexedWorkbenchAuthorStyleSheetSources from "@zavx0z/storybook-app-web-page-style-sheets"
import startExternalStorybookLanding from "@zavx0z/storybook-app-web-page-home"

import startExternalStorybookPackage from "@zavx0z/storybook-app-web-page-package"
import type {StorybookAppWebPagePackage} from "@zavx0z/storybook-app-web-page-package"
type ExternalStorybookAppliedRevision = Awaited<ReturnType<NonNullable<NonNullable<StorybookAppWebPagePackage.Input["environment"]>["loadAppliedRevision"]>>>
import {loadStorybookAppliedRevision} from "./src/revision-loader.ts"
import {spatialPackages} from "./src/spatial-catalog"
import {createScopeOwnership} from "./src/scope-ownership"
import {createEnvironmentFollow} from "./src/environment-follow"
import {awaitNavigationWork} from "./src/navigation-admission"
import WebStatusOwner from "@zavx0z/storybook-app-web-page-status"
const buildProgressStatus = WebStatusOwner.build
const catalogProgressStatus = WebStatusOwner.catalog
const readBuildProgress = WebStatusOwner.readBuild
const readCatalogProgress = WebStatusOwner.readCatalog
import createExternalStorybookShell from "@zavx0z/storybook-app-web-page-shell"
import type {StorybookAppWebPageShell} from "@zavx0z/storybook-app-web-page-shell"
type StorybookRetainedRoot = ReturnType<StorybookAppWebPageShell.Output["releaseRoot"]>
import type {StorybookAppWebPage} from "./contract"
type StartExternalStorybookPageOptions = StorybookAppWebPage.Input
type ExternalStorybookPageController = StorybookAppWebPage.Output
import type {StorybookSharedHost, ExternalStorybookPreparedPageTarget, ExternalStorybookPagePrepareInput} from "./contract/types"
import type {StorybookAgentBridge, ExternalStorybookPreparedPackageTarget, ExternalStorybookPreparedLandingTarget, ActivePackagePageScope, ActiveLandingPageScope, ActivePageScope} from "./src/types"
import {STORYBOOK_AGENT_BRIDGE_GLOBAL, requirePackageScope, readPageScroll, restorePageScroll, createStorybookScopeAddress, currentPageAddress, createDeferredStorybookSocket} from "./src/implementation"
export type {StorybookAppWebPage} from './contract'

/**
Создаёт один page owner с динамическим обновлением пакетов и платформы.

Каждый переход сначала получает server target, payload, pending status и semantic
styles. Старый scope освобождается только перед mount; ошибка восстанавливает его
payload, styles, socket, Inspector, scroll и последний committed URL. `popstate`
использует тот же pipeline, поэтому незавершённый history target не становится
адресом рабочей страницы.
Повторный текущий адрес сохраняет исполнение и может сфокусировать его Display.
Первоначальная загрузка, HMR и переподключение сохраняют собственные lifecycle paths.
Смена платформы передаёт тот же native Canvas контроллеру из нового payload:
он создаёт согласованные Root и semantic Document после освобождения прежних.

@param options - Epochs page realm, cold target и узкие transport seams.

@returns Контроллер, который должен быть освобождён через {@link ExternalStorybookPageController.dispose}.

@throws При отсутствии browser environment или dynamic entry, ошибке prepare/mount или невозможности rollback.

@example
```ts
const page = await startExternalStorybookPage({sharedModuleEpoch})
try {
  await page.navigatePackage({packageId: "@zavx0z/immersive-markdown", route: ""})
} finally {
  await page.dispose()
}
```
*/
async function startExternalStorybookPage(
  inputOptions: StartExternalStorybookPageOptions,
): Promise<ExternalStorybookPageController> {
  const {initialTransition, ...options} = inputOptions
  let initialAdmission = initialTransition ?? null
  const maxRetainedSubjects = options.maxWarmSubjects ?? 6
  if (!Number.isSafeInteger(maxRetainedSubjects) || maxRetainedSubjects < 1 || maxRetainedSubjects > 32) throw new RangeError("maxWarmSubjects must be an integer in 1..32")
  const browserDocument = options.browserDocument ?? globalThis.document
  const location = options.location ?? globalThis.location
  const history = options.history ?? globalThis.history
  if (browserDocument === undefined || location === undefined || history === undefined) {
    throw new Error("External Storybook page browser environment is unavailable")
  }
  const fetcher = options.fetcher ?? globalThis.fetch
  const initialTarget = options.initialTarget ?? PageTarget.read(browserDocument)
  const prepareTarget = options.prepareTarget ?? ((input, signal) =>
    PageTarget.prepare(fetcher, input, signal))
  const pageLifetime = new AbortController()
  const readHost = (epoch: string | undefined, token: string, signal: AbortSignal, preview = false) => options.readSharedHost?.(epoch, token, signal, preview)
    ?? WebProtocol.readSharedHost(fetcher, token, signal, epoch, preview)
  const host = options.sharedHost ?? await readHost(options.sharedModuleEpoch, initialTarget.readerToken, pageLifetime.signal,
    initialTarget.kind !== "landing" && (initialTarget.preview || initialTarget.intent === "navigation-candidate"))
  if (host.sharedModuleEpoch !== options.sharedModuleEpoch || host.hostModuleEpoch !== options.hostModuleEpoch) {
    const start = await (options.importSharedHost ?? WebProtocol.importSharedHost<typeof startExternalStorybookPage>)(host)
    return start({...options, sharedHost: host, sharedModuleEpoch: host.sharedModuleEpoch, hostModuleEpoch: host.hostModuleEpoch})
  }
  await WebProtocol.synchronizeStyles(browserDocument, host)
  const shell = await createExternalStorybookShell({
    title: "Storybook",
    browserDocument,
    ...(options.shell ?? {}),
    authorStyleSheetSources: indexedWorkbenchAuthorStyleSheetSources(browserDocument),
    ...(options.retainedRoot === undefined ? {} : {retainedRoot: options.retainedRoot}),
  })
  const following = createEnvironmentFollow({
    enabled: () => shell.followEnvironment,
    subscribe: shell.subscribeFollowEnvironment,
    signal: pageLifetime.signal,
    navigate: async (address, signal) => {
      const target = address === "/" ? {packageId: null, route: "/"} : await awaitNavigationWork(resolveAddress(address, signal), signal)
      signal.throwIfAborted()
      await transition({packageId: target.packageId, route: target.route, intent: "navigation"}, false, true, signal)
    },
    failed: error => selectedShell().reportDiagnostic(error),
  })
  const stopInitialAdmission = shell.subscribeFollowEnvironment(() => {
    if (!shell.followEnvironment) initialAdmission?.cancel()
  })
  if (!shell.followEnvironment) initialAdmission?.cancel()
  pageLifetime.signal.addEventListener("abort", stopInitialAdmission, {once: true})
  const execution = createHmrPage<ActivePageScope>({
    release: scope => releaseSelection(scope),
    restore: scope => restoreScope(scope),
  })
  let bridge: StorybookAgentBridge | null = null
  let disposed = false
  let replacement: ExternalStorybookPageController | null = null
  let transitionTail: Promise<void> = Promise.resolve()
  let transitionResult = transitionTail
  let selectionGeneration = 0
  /** Следующий переход лишает ещё не зарегистрированный scope права записывать состояние страницы. */
  const invalidatePendingScope = () => { selectionGeneration++ }
  let activeAddress = `${location.pathname}${new URL(location.href).search}${new URL(location.href).hash}`
  let committingAddress = false
  /** Независимая запись адреса активным scope имеет приоритет над ожидающим Follow. */
  const scopeAddressChanged = (value: string) => {
    if (!committingAddress && value !== activeAddress) following.cancel("Storybook environment following was superseded before navigation")
    activeAddress = value
  }
  // Выбранный scope и время жизни видимых предметов независимы.
  const subjects = new Map<string, ActivePageScope>()
  const navigationConfirmations = new Set<string>()
  const savedSubjects = new Map<string, ReturnType<StorybookAppWebPageShell.Output["captureUserState"]>>()
  let catalog = await WebClient.fetchExternalStorybookClientSnapshot(fetcher)
  const packagePaths = new Map(catalog.nodes.filter(node => node.kind === "package")
    .map(node => [node.packageId!, new URL(node.urlPath, location.href).pathname]))
  const subjectKey = (target: ExternalStorybookPreparedPageTarget) =>
    target.kind === "landing" ? "/" : packagePaths.get(target.packageId) ?? new URL(target.urlPath, location.href).pathname
  if (options.shell?.userState !== undefined) savedSubjects.set(subjectKey(initialTarget), options.shell.userState)
  let replacingSubject: string | null = null
  let releasingSubjects = false
  const selectedShell = () => execution.current?.controller.shell ?? shell
  if (options.initialHistory === "replace" && options.shell?.userState !== undefined && initialTarget.kind !== "landing") {
    navigationConfirmations.add(`${initialTarget.packageId}:${initialTarget.revision}`)
  }
  const subjectsByPath = new Map(catalog.nodes.map(node => [new URL(node.urlPath, location.href).pathname, node]))
  const pathsById = new Map(catalog.nodes.map(node => [node.id, new URL(node.urlPath, location.href).pathname]))

  const releaseSelection = async (scope: ActivePageScope): Promise<void> => {
    if (scope.kind === "package") scope.target = {...scope.target, route: scope.controller.currentRoute, urlPath: scope.controller.currentModel.urlPath}
    scope.address.deactivate()
    if (subjects.get(subjectKey(scope.target)) !== scope) return
    if (releasingSubjects) await disposeScope(scope)
    else if (replacingSubject === subjectKey(scope.target)) {
      savedSubjects.set(subjectKey(scope.target), scope.controller.shell.captureUserState())
      await disposeScope(scope, true)
    }
  }
  const trimSubjects = async (reserve = 0): Promise<void> => {
    for (const [key, scope] of subjects) {
      if (subjects.size <= maxRetainedSubjects - reserve) break
      if (scope === execution.current || scope.controller.shell.workbench.element.contains(shell.document.activeElement)) continue
      savedSubjects.set(key, scope.controller.shell.captureUserState())
      await disposeScope(scope)
    }
  }
  const closeSubjects = async (): Promise<void> => {
    invalidatePendingScope()
    releasingSubjects = true
    await execution.detach()
    for (const scope of [...subjects.values()]) await disposeScope(scope)
  }


  const loadPayload = async (
    target: ExternalStorybookPreparedPackageTarget,
    signal: AbortSignal,
  ): Promise<ExternalStorybookAppliedRevision | null> => {
    if (target.revision === null) return null
    const payload = await (options.loadAppliedRevision ?? loadStorybookAppliedRevision)(
      target.packageId,
      target.revision,
      signal,
    )
    return payload
  }

  const eventSocket = (target: ExternalStorybookPreparedPageTarget): StorybookTechHmrConnection.Input["socket"] => {
    const url = new URL("/api/events", location.href)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.searchParams.set("session", target.readerToken)
    return options.createSocket?.(url.href) ?? new WebSocket(url.href)
  }

  const pendingTargetStatus = async (
    packageId: string,
    signal: AbortSignal,
  ): Promise<Readonly<{dispose(): void}>> => {
    const response = await fetcher("/api/browser/session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({packageId, revision: null, preview: false}),
      signal,
    })
    if (!response.ok) throw new Error(`Storybook pending package reader failed: ${packageId}`)
    const result = await response.json() as {token?: unknown}
    if (typeof result.token !== "string") throw new Error("Storybook pending package reader returned no token")
    const socket = eventSocket({kind: "landing", pathname: "/", readerToken: result.token})
    let disposed = false
    const onOpen = (): void => {
      socket.send(JSON.stringify({type: "subscribe", topic: `package:${packageId}`}))
      socket.send(JSON.stringify({type: "subscribe", topic: "catalog"}))
    }
    const onMessage = (event: MessageEvent): void => {
      let value: unknown
      try { value = JSON.parse(String(event.data)) } catch { return }
      const build = readBuildProgress(value)
      if (build !== null && (build.packageId === packageId || build.packageId === null)) {
        selectedShell().updateStatus(buildProgressStatus(build))
        return
      }
      const catalog = readCatalogProgress(value)
      if (catalog !== null) {
        selectedShell().updateStatus(catalogProgressStatus(catalog))
        return
      }
    }
    socket.addEventListener("open", onOpen)
    socket.addEventListener("message", onMessage)
    const disposePending = (): void => {
      if (disposed) return
      disposed = true
      socket.removeEventListener("open", onOpen)
      socket.removeEventListener("message", onMessage)
      socket.close()
    }
    signal.addEventListener("abort", disposePending, {once: true})
    return Object.freeze({
      dispose() {
        signal.removeEventListener("abort", disposePending)
        disposePending()
      },
    })
  }

  const pageScope = (
    target: ExternalStorybookPreparedPackageTarget,
  ) => {
    const key = subjectKey(target)
    const ownedShell = shell.createSubjectView({id: key, title: subjectsByPath.get(key)?.label ?? target.packageId,
      ...(savedSubjects.has(key) ? {userState: savedSubjects.get(key)!} : {})})
    const ownership = createScopeOwnership<ActivePackagePageScope>({shell: ownedShell, signal: pageLifetime.signal,
      generation: selectionGeneration, readGeneration: () => selectionGeneration,
      readOwner: () => subjects.get(key), selected: () => execution.current, live: () => !disposed && !releasingSubjects})
    const owns = ownership.owns
    return Object.freeze({
      shell: ownedShell,
      bind: ownership.bind,
      initialRoute: target.route,
      environmentActivity: following.receive,
      isSelected: ownership.selected,
      navigatePackage: (input: Parameters<typeof navigatePackage>[0]) => owns() ? navigatePackage(input) : Promise.resolve(),
      navigateLanding: (path?: string) => owns() ? navigateLanding(path) : Promise.resolve(),
      applyRevision: (revision: string) => owns() ? applyPageRevision(target.packageId, revision, key)
        : Promise.reject(new DOMException("Storybook scope no longer owns this Frame", "AbortError")),
      refreshSharedHost: () => owns() ? refreshSharedHost() : Promise.resolve(),
      catalogChanged(value: typeof catalog) {if (owns()) updateSpatialCatalog(value)},
      readerRenewed(readerToken: string) {
        const bound = ownership.scope()
        if (bound === null) return
        bound.target = {...bound.target, readerToken}
      },
      /** После серверного acknowledgement последующее переподключение возвращает ordinary reader. */
      revisionConfirmed(revision: string) {
        const bound = ownership.scope()
        if (bound === null || bound.controller.revision !== revision) return
        bound.target = {...bound.target, intent: "reader", preview: false, initialAppliedRevision: revision}
      },
      revisionApplied(payload: ExternalStorybookAppliedRevision) {
        const current = ownership.scope()
        if (current === null || payload.packageId !== target.packageId) return
        const route = payload.graphSnapshot.routes.find(({path}) => path === current.controller.currentRoute) ??
          payload.graphSnapshot.routes.find(({path}) => path === "")
        if (route === undefined) throw new Error(`Storybook applied revision has no current route: ${payload.packageId}`)
        current.payload = payload
        current.target = {
          ...current.target,
          revision: payload.candidateRevision,
          revisionUrl: payload.revisionUrl,
          route: route.path,
          urlPath: route.urlPath,
        }
        syncBridge()
      },

    })
  }

  const startPackageScope = async (
    target: ExternalStorybookPreparedPackageTarget,
    payload: ExternalStorybookAppliedRevision | null,
    address = createStorybookScopeAddress(target, location, history, scopeAddressChanged),
    retainViewOnFailure = false,
    admission = pageLifetime.signal,
  ): Promise<ActivePackagePageScope> => {
    const embeddedScope = pageScope(target)
    const initialization = new AbortController()
    const cancelInitialization = () => {initialization.abort(admission.reason)}
    admission.addEventListener("abort", cancelInitialization, {once: true})
    if (admission.aborted) cancelInitialization()
    const deferredSocket = createDeferredStorybookSocket(() => eventSocket(target))
    const startPackage = options.startPackage ?? startExternalStorybookPackage
    let controller: StorybookAppWebPagePackage.Output
    try {
      controller = await startPackage({
        packageId: target.packageId,
        candidateRevision: target.revision,
        revisionUrl: target.revisionUrl,
        sharedModuleEpoch: options.sharedModuleEpoch,
        ...((options.hostModuleEpoch) === undefined ? {} : {hostModuleEpoch: options.hostModuleEpoch}),
        ...(payload === null ? {} : {graphSnapshot: payload.graphSnapshot}),
        scenarioLoaders: payload?.scenarioLoaders ?? new Map(),
        environment: {
          browserDocument,
          location: address.location,
          history: address.history,
          fetcher,
          socket: deferredSocket,
          ...(options.createSocket === undefined ? {} : {createSocket: options.createSocket}),
          bootstrapIntent: target.intent,
          initialAppliedRevision: target.initialAppliedRevision,
          fallbackRevision: target.fallbackRevision,
          lifecycleSignal: AbortSignal.any([pageLifetime.signal, initialization.signal]),
          pageScope: embeddedScope,
          loadAppliedRevision: (revision, signal) => (options.loadAppliedRevision ?? loadStorybookAppliedRevision)(
            target.packageId,
            revision,
            signal,
          ),
        },
      })
      if (admission.aborted) {await controller.dispose(); admission.throwIfAborted()}
    } catch (error) {
      deferredSocket.close()
      if (!retainViewOnFailure) embeddedScope.shell.dispose()
      throw error
    } finally {
      admission.removeEventListener("abort", cancelInitialization)
    }
    const scope: ActivePackagePageScope = {kind: "package", target, payload, controller, connect: deferredSocket.connect, address}
    embeddedScope.bind(scope)
    subjects.set(subjectKey(target), scope)
    return scope
  }

  const startLandingScope = async (
    target: ExternalStorybookPreparedLandingTarget,
    address = createStorybookScopeAddress(target, location, history, scopeAddressChanged),
  ): Promise<ActiveLandingPageScope> => {
    const controller = await startExternalStorybookLanding({
      browserDocument,
      location: address.location,
      history: address.history,
      fetcher,
      createSocket: () => eventSocket(target),
      readerToken: target.readerToken,
      pageScope: {environmentActivity: following.receive, shell: shell.createSubjectView({id: subjectKey(target), title: catalog.projectName, ...(savedSubjects.has(subjectKey(target)) ? {userState: savedSubjects.get(subjectKey(target))!} : {})}), initialPathname: target.pathname, navigatePackage, refreshSharedHost, catalogChanged: updateSpatialCatalog,
        isSelected: () => execution.current !== null && subjectKey(execution.current.target) === subjectKey(target),
        async reconnectSocket() {
          const next = await prepareTarget({packageId: null, route: target.pathname, intent: "navigation"}, pageLifetime.signal)
          const own = subjects.get(subjectKey(target))
          if (next.kind !== "landing" || own?.kind !== "landing") throw new DOMException("Landing scope changed", "AbortError")
          own.target = next
          return eventSocket(next)
        },
      },
    })
    const scope: ActiveLandingPageScope = {kind: "landing", target, controller, address}
    subjects.set(subjectKey(target), scope)
    return scope
  }

  const syncBridge = (focus = false): void => {
    browserDocument.documentElement.dataset.externalStorybookSharedModuleEpoch = host.sharedModuleEpoch
    browserDocument.documentElement.dataset.externalStorybookHostModuleEpoch = host.hostModuleEpoch
    const current = execution.current?.kind === "package" ? execution.current.controller : null
    if (execution.current !== null) {
      const view = execution.current.controller.shell
      const state = view.workbench.getSnapshot().state
      shell.workbench.update("projectName", catalog.projectName)
      shell.workbench.update("catalog.items", state["catalog.items"])
      shell.workbench.update("catalog.active", state["catalog.active"])
      shell.selectSubject(subjectKey(execution.current.target), focus)
    }
    if (current === null) {
      browserDocument.title = WebProtocol.pageTitle(null)
      if (browserDocument.defaultView) browserDocument.defaultView.name = "storybook:workspace"
      Object.assign(browserDocument.documentElement.dataset, {externalStorybook: "ready", externalStorybookLanding: "ready", externalStorybookPackage: "ready", externalStorybookRoute: ""})
      delete browserDocument.documentElement.dataset.externalStorybookPackageId
      delete browserDocument.documentElement.dataset.externalStorybookRevision
    } else {
      browserDocument.title = WebProtocol.pageTitle(current.packageId, current.currentModel.packageNode.label)
      if (browserDocument.defaultView) browserDocument.defaultView.name = "storybook:workspace"
      delete browserDocument.documentElement.dataset.externalStorybookLanding
      Object.assign(browserDocument.documentElement.dataset, {externalStorybook: "ready", externalStorybookPackage: "ready",
        externalStorybookPackageId: current.packageId, externalStorybookRevision: current.revision ?? "unavailable", externalStorybookRoute: current.currentRoute})
    }
    browserDocument.documentElement.dataset.externalStorybookPhase = "ready"
    bridge?.dispose()
    const nextBridge: StorybookAgentBridge = createStorybookAgentBridge({
      packageId: current?.packageId ?? null,
      revision: current?.revision ?? null,
      graphDigest: current?.graphDigest ?? catalog.graphDigest,
      shell: selectedShell(),
      getRoute: () => execution.current?.kind === "package" ? execution.current.controller.currentRoute : "",
      getModel: () => execution.current?.kind === "package" ? execution.current.controller.currentModel : null,
      navigate: async route => {if (execution.current?.kind === "package") await execution.current.controller.navigate(route)},
      navigateWorkspace,
      selectScenario: value => requirePackageScope(execution.current).controller.selectScenario(value),
      applyRevision: revision => applyPageRevision(requirePackageScope(execution.current).target.packageId, revision),
      canApplyRevision: () => execution.current?.kind === "package" && execution.current.controller.canApplyRevision(),
      async waitForStableScope() {
        if (!(following.pending && execution.current !== null)) {
          let pending: Promise<void>
          do {pending = transitionResult; await pending.catch(() => {})} while (pending !== transitionResult)
        }
        if (!disposed && replacement !== null) {
          const next = (globalThis as typeof globalThis & Record<string, unknown>)[STORYBOOK_AGENT_BRIDGE_GLOBAL] as StorybookAgentBridge | undefined
          if (next === undefined || next === bridge) throw new Error("Storybook platform did not install its agent bridge")
          return next
        }
        if (disposed || execution.current === null) throw new DOMException("Storybook workspace has no committed scope", "AbortError")
        if (bridge !== null && bridge !== nextBridge) return bridge
      },
    })
    bridge = nextBridge
  }

  const disposeScope = async (scope: ActivePageScope | null, retainView = false): Promise<void> => {
    if (scope === null) return
    const key = subjectKey(scope.target)
    if (subjects.get(key) === scope) subjects.delete(key)
    scope.address.deactivate()
    if (scope.kind === "package") await scope.controller.dispose()
    else scope.controller.dispose()
    if (!retainView) shell.releaseSubjectView(key)
  }

  const renewPackageTarget = async (
    target: ExternalStorybookPreparedPackageTarget,
    admission = pageLifetime.signal,
  ): Promise<ExternalStorybookPreparedPackageTarget> => {
    const response = await fetcher("/api/browser/session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        packageId: target.packageId,
        revision: target.revision,
        preview: target.preview,
      }),
      signal: admission,
    })
    if (!response.ok) throw new Error(`Storybook package reader renewal failed: ${target.packageId}`)
    const result = await response.json() as {token?: unknown}
    if (typeof result.token !== "string") throw new Error("Storybook package reader renewal returned no token")
    return {...target, readerToken: result.token}
  }

  const restoreScope = async (scope: ActivePageScope): Promise<ActivePageScope> => {
    if (subjects.get(subjectKey(scope.target)) === scope) return scope
    if (scope.kind === "landing") {
      const prepared = await prepareTarget(
        {packageId: null, route: scope.target.pathname, intent: "navigation"},
        pageLifetime.signal,
      )
      if (prepared.kind !== "landing") throw new Error("Storybook landing rollback returned a package")
      return startLandingScope(prepared)
    }
    return startPackageScope(await renewPackageTarget(scope.target), scope.payload)
  }

  /** Запрашивает независимое подтверждение первого кандидата после завершения перехода. */
  const confirmNavigation = (): void => {
    const scope = execution.current
    if (scope?.kind !== "package" || scope.target.intent !== "navigation-candidate" ||
      scope.target.fallbackRevision !== null) return
    const key = `${scope.target.packageId}:${scope.target.revision}`
    if (navigationConfirmations.has(key)) return
    navigationConfirmations.add(key)
    // Инспекция сервера ждёт устойчивого scope через bridge; запрос не входит в очередь перехода.
    void Promise.resolve().then(() => transitionTail).then(async () => {
      if (disposed || execution.current !== scope) return
      const response = await fetcher("/api/browser/confirm-navigation", {
        method: "POST",
        headers: {"content-type": "application/json", "x-storybook-session": scope.target.readerToken},
        body: JSON.stringify({route: scope.controller.currentRoute}),
        signal: pageLifetime.signal,
      })
      if (!response.ok) {
        const result = await response.json() as {error?: string}
        throw new Error(result.error ?? "Не удалось подтвердить отображение пакета")
      }
    }).catch(error => {
      if (disposed || execution.current !== scope) return
      selectedShell().reportDiagnostic(error instanceof Error ? {phase: "page", message: error.message} : error)
      selectedShell().updateStatus("Пакет открыт; подтверждение рабочей версии не завершено")
    })
  }

  const install = async (
    target: ExternalStorybookPreparedPageTarget,
    payload: ExternalStorybookAppliedRevision | null,
    replaceAddress: boolean | null,
    focus = false,
    selectionOnly = false,
    admission = pageLifetime.signal,
  ): Promise<void> => {
    admission.throwIfAborted()
    const selectedBefore = execution.current
    const scroll = readPageScroll(selectedShell())
    const previousAddress = activeAddress
    const key = subjectKey(target)
    const sameSubject = execution.current !== null && subjectKey(execution.current.target) === key
    const retained = subjects.get(key)
    const reusable = !(admission !== pageLifetime.signal && retained === execution.current && retained?.kind === "package" && target.kind !== "landing" && retained.controller.currentRoute !== target.route) && (retained?.kind === "landing" && target.kind === "landing" ||
      retained?.kind === "package" && target.kind !== "landing" && retained.controller.revision === target.revision && retained.target.preview === target.preview)
    replacingSubject = reusable ? null : key
    try {
      if (retained !== undefined && !reusable && retained !== execution.current) await disposeScope(retained)
      // Освобождение до нового content сохраняет общий бюджет Display и исполнений.
      if (!reusable && retained === undefined) await trimSubjects(1)
      await execution.replace(
        async () => {
          if (retained !== undefined && reusable) {
            subjects.delete(key)
            subjects.set(key, retained)
            if (!selectionOnly && retained.kind === "package" && target.kind !== "landing" && retained.controller.currentRoute !== target.route) {
              await retained.controller.navigate(target.route)
            }
            admission.throwIfAborted()
            return retained
          }
          const created = await (target.kind === "landing" ? startLandingScope(target) : startPackageScope(target, payload, undefined, sameSubject, admission))
          if (admission.aborted) {await disposeScope(created); admission.throwIfAborted()}
          return created
        },
        async (scope, restored) => {
          if (!restored && admission.aborted && scope !== selectedBefore) await disposeScope(scope)
          if (!restored) admission.throwIfAborted()
          if (restored) {
            history.replaceState(null, "", previousAddress)
            activeAddress = previousAddress
          }
          syncBridge(!restored && focus)
          committingAddress = true
          try {scope.address.commit(!restored && replaceAddress === false && scope.address.address !== previousAddress ? "push" : "replace")}
          finally {committingAddress = false}
          activeAddress = scope.address.address
          if (scope.kind === "package") scope.connect()
          if (restored || sameSubject) restorePageScroll(selectedShell(), scroll)
        },
      )
      await trimSubjects()
      confirmNavigation()
    } catch (error) {
      if (execution.current === null) {
        history.replaceState(null, "", previousAddress)
        activeAddress = previousAddress
      }
      throw error
    } finally {
      replacingSubject = null
    }
  }

  /**
  Передаёт владение Canvas новой модульной среде в том же browser realm.
  Предыдущие scope и listeners освобождаются перед созданием следующего контроллера.
  При совпадении платформы передаётся Browser root и заново монтируется App;
  прежние компоненты оболочки не передаются новой реализации. При смене платформы освобождается Root.
  При ошибке новая среда освобождает свои ресурсы, а прежняя монтируется из своего payload.
  */
  const replacePage = async (
    target: ExternalStorybookPreparedPageTarget,
    payload: ExternalStorybookAppliedRevision | null,
    replaceAddress: boolean | null,
    nextHost: StorybookSharedHost,
    focus = false,
    admission = pageLifetime.signal,
  ): Promise<void> => {
    const startPage = await awaitNavigationWork((options.importSharedHost ?? WebProtocol.importSharedHost<typeof startExternalStorybookPage>)(nextHost), admission)
    admission.throwIfAborted()
    const previous = execution.current
    if (previous === null) throw new Error("Storybook platform replacement requires an active scope")
    const scroll = readPageScroll(selectedShell())
    const previousAddress = activeAddress
    const shellOptions = {...options.shell, canvas: shell.canvas, userState: selectedShell().captureUserState()}
    const catalogSearch = selectedShell().workbench.controller.read("catalog.search")
    let retainedRoot: StorybookRetainedRoot | undefined
    const {retainedRoot: _previousRoot, ...pageOptions} = options
    globalThis.removeEventListener?.("popstate", onPopState)
    globalThis.removeEventListener?.("pagehide", onPageHide)
    await closeSubjects()
    bridge?.dispose()
    bridge = null
    if (nextHost.sharedModuleEpoch === options.sharedModuleEpoch &&
      JSON.stringify(nextHost.authorStyleSheets.map(style => style.specifier)) === JSON.stringify(host.authorStyleSheets.map(style => style.specifier))) {
      retainedRoot = shell.releaseRoot()
    }
    else shell.dispose()
    try {
      replacement = await startPage({
        ...pageOptions,
        browserDocument,
        location,
        history,
        shell: shellOptions,
        ...(retainedRoot === undefined ? {} : {retainedRoot}),
        sharedModuleEpoch: nextHost.sharedModuleEpoch,
        hostModuleEpoch: nextHost.hostModuleEpoch,
        sharedHost: nextHost,
        initialTarget: target,
        initialPayload: payload,
        initialHistory: replaceAddress === false ? "push" : "replace",
        initialFocus: focus,
        ...(admission === pageLifetime.signal ? {} : {initialTransition: {signal: admission, cancel() {
          shell.setFollowEnvironment(false)
          following.cancel()
        }}}),
      })
      admission.throwIfAborted()
      replacement.shell.workbench.controller.update("catalog.search", catalogSearch)
      restorePageScroll(replacement.shell, scroll)
      delete browserDocument.documentElement.dataset.externalStorybookUpdateError
    } catch (error) {
      if (replacement !== null) {
        await replacement.dispose()
        replacement = null
        retainedRoot = undefined
      }
      history.replaceState(null, "", previousAddress)
      shellOptions.userState = {...shellOptions.userState, followEnvironment: shell.followEnvironment}
      try {
        await WebProtocol.synchronizeStyles(browserDocument, host)
        const restoredTarget = previous.kind === "package"
          ? await renewPackageTarget(previous.target)
          : await prepareTarget({packageId: null, route: previous.target.pathname, intent: "navigation"}, pageLifetime.signal)
        replacement = await startExternalStorybookPage({
          ...pageOptions,
          browserDocument,
          location,
          history,
          shell: shellOptions,
          ...(retainedRoot === undefined ? {} : {retainedRoot}),
          initialTarget: restoredTarget,
          initialPayload: previous.kind === "package" ? previous.payload : null,
          initialHistory: "replace",
          initialFocus: false,
        })
        replacement.shell.workbench.controller.update("catalog.search", catalogSearch)
        restorePageScroll(replacement.shell, scroll)
        browserDocument.documentElement.dataset.externalStorybookUpdateError = error instanceof Error ? error.message : String(error)
        replacement.shell.reportDiagnostic(error)
        replacement.shell.updateStatus("Обновление страницы отклонено; восстановлена рабочая версия")
      } catch (rollbackError) {
        retainedRoot?.application.unmount()
        throw new AggregateError([error, rollbackError], "Storybook failed to restore its platform")
      }
      throw error
    } finally {
      pageLifetime.abort(new DOMException("Storybook platform ownership transferred", "AbortError"))
    }
  }

  /** Выбирает границу HMR по identity платформы до монтирования объектов нового пакета. */
  const installPrepared = async (
    target: ExternalStorybookPreparedPageTarget,
    payload: ExternalStorybookAppliedRevision | null,
    replaceAddress: boolean | null,
    focus = false,
    preparedHost?: StorybookSharedHost,
    admission = pageLifetime.signal,
  ): Promise<void> => {
    admission.throwIfAborted()
    const nextHost = preparedHost ?? await awaitNavigationWork(readHost(payload?.sharedModuleEpoch, target.readerToken, admission,
      target.kind !== "landing" && (target.preview || target.intent === "navigation-candidate")), admission)
    admission.throwIfAborted()
    if (payload !== null && nextHost.sharedModuleEpoch !== payload.sharedModuleEpoch) {
      throw new Error("Оболочка Storybook вернула другую платформу")
    }
    if (nextHost.sharedModuleEpoch !== host.sharedModuleEpoch || nextHost.hostModuleEpoch !== host.hostModuleEpoch) {
      await replacePage(target, payload, replaceAddress, nextHost, focus, admission)
    } else await install(target, payload, replaceAddress, focus, false, admission)
  }

  /**
  Применяет текущую общую оболочку без изменения package revision или адреса вкладки.
  Событие выпуска читает опубликованный host по обычному reader grant после reconnect.
  Передача управления выдаёт новый reader grant: одноразовый токен прежнего
  WebSocket не переносится в соединение нового scope. Неудача сохраняет рабочую страницу.
  */
  function refreshSharedHost(): Promise<void> {
    invalidatePendingScope()
    const operation = transitionTail.catch(() => {}).then(async () => {
      if (disposed || pageLifetime.signal.aborted || replacement !== null || execution.current === null) return
      const current = execution.current
      const payload = current.kind === "package" ? current.payload : null
      const nextHost = await readHost(payload?.sharedModuleEpoch, current.target.readerToken, pageLifetime.signal)
      if (nextHost.hostModuleEpoch === host.hostModuleEpoch && nextHost.sharedModuleEpoch === host.sharedModuleEpoch) return
      const target = current.kind === "package" ? await renewPackageTarget({
        ...current.target,
        route: current.controller.currentRoute,
        urlPath: current.controller.currentModel.urlPath,
      }) : await prepareTarget({packageId: null, route: current.target.pathname, intent: "navigation"}, pageLifetime.signal)
      await replacePage(target, payload, null, nextHost)
    })
    transitionResult = operation
    transitionTail = operation.catch(() => {})
    return operation
  }

  /** Выполняет подготовку внутри уже выбранной общей очереди переходов. */
  const prepareTransition = async (
    request: ExternalStorybookPagePrepareInput,
    replaceAddress: boolean | null,
    focus: boolean,
    admission = pageLifetime.signal,
  ): Promise<void> => {
    admission.throwIfAborted()
    if (disposed) throw new Error("External Storybook page is disposed")
    if (replacement !== null) {
      if (request.packageId === null) await replacement.navigateLanding(request.route)
      else await replacement.navigatePackage({packageId: request.packageId, route: request.route})
      return
    }
    const current = execution.current
    if (request.intent === "navigation" && current !== null && (
      request.packageId === null
        ? current.kind === "landing" && current.target.pathname === request.route
        : current.kind === "package" && !current.target.preview && current.target.packageId === request.packageId && current.controller.currentRoute === request.route
    )) {
      if (focus) shell.selectSubject(subjectKey(current.target), true)
      return
    }
    delete browserDocument.documentElement.dataset.externalStorybookNavigationError
    selectedShell().updateStatus("Storybook · Подготовка выбранного пакета")
    const pending = request.packageId === null
      ? null
      : await pendingTargetStatus(request.packageId, admission)
    try {
      const target = await awaitNavigationWork(prepareTarget(request, admission), admission)
      admission.throwIfAborted()
      const payload = target.kind === "landing" ? null : await awaitNavigationWork(loadPayload(target, admission), admission)
      admission.throwIfAborted()
      pending?.dispose()
      await installPrepared(target, payload, replaceAddress, focus, undefined, admission)
    } finally {
      pending?.dispose()
    }
  }

  const transition = (
    request: ExternalStorybookPagePrepareInput,
    replaceAddress: boolean | null,
    focus = false,
    admission = pageLifetime.signal,
  ): Promise<void> => {
    invalidatePendingScope()
    const operation = transitionTail.catch(() => {}).then(() => prepareTransition(request, replaceAddress, focus, admission))
    transitionResult = admission === pageLifetime.signal ? operation : operation.catch(error => {if (!admission.aborted) throw error})
    transitionTail = operation.catch(() => {})
    return operation
  }

  /**
  Заменяет контроллер пакета вместе с его payload, сохраняя общий Root и оболочку.
  Новая host-реализация приходит из того же immutable payload. Смена платформы
  передаёт Canvas новой среде; ошибка mount восстанавливает предыдущую среду.
  */
  function applyPageRevision(packageId: string, revision: string, key?: string): Promise<void> {
    invalidatePendingScope()
    // Проверка/HMR подтверждает эту ревизию у своего владельца; навигация не
    // запускает конкурирующее подтверждение и не переиспользует preview grant.
    navigationConfirmations.add(`${packageId}:${revision}`)
    const operation = transitionTail.catch(() => {}).then(async () => {
      const current = key === undefined ? execution.current : subjects.get(key) ?? null
      if (current?.kind !== "package" || current.target.packageId !== packageId) {
        throw new DOMException("Storybook view navigated to another package", "AbortError")
      }
      if (current.controller.revision === revision) return
      const prepared = await prepareTarget({
        packageId,
        route: current.controller.currentRoute,
        intent: "preview",
        requestedRevision: revision,
      }, pageLifetime.signal)
      if (prepared.kind !== "revision" || prepared.packageId !== packageId || prepared.revision !== revision) {
        throw new Error("Storybook revision preparation returned a different target")
      }
      const payload = await loadPayload(prepared, pageLifetime.signal)
      // Exact preview grant принадлежит запрошенной ревизии, включая прежнюю при rollback.
      // Обновлённый normal grant может уже иметь intent reader; он нужен конечному scope.
      const nextHost = await readHost(payload?.sharedModuleEpoch, prepared.readerToken, pageLifetime.signal, prepared.preview)
      const target = await renewPackageTarget({
        ...prepared,
        intent: current.target.intent,
        preview: current.target.preview,
      })
      if (current === execution.current) await installPrepared(target, payload, null, false, nextHost)
      else {
        if (nextHost.sharedModuleEpoch !== host.sharedModuleEpoch) {
          throw new Error("Фоновая ревизия требует другой платформы; рабочее представление сохранено до выбора предмета")
        }
        if (nextHost.hostModuleEpoch !== host.hostModuleEpoch) {
          // Совместимая Web-оболочка обновляется вокруг выбранного предмета.
          const selected = execution.current
          if (selected === null) throw new Error("Storybook shared update has no selected subject")
          await replacePage(selected.target, selected.kind === "package" ? selected.payload : null, null, nextHost)
          return
        }
        const previous = current
        const previousScroll = readPageScroll(previous.controller.shell)
        savedSubjects.set(subjectKey(previous.target), previous.controller.shell.captureUserState())
        await disposeScope(previous, true)
        try {
          const next = await startPackageScope(target, payload, undefined, true)
          restorePageScroll(next.controller.shell, previousScroll)
          next.connect()
        } catch (error) {
          const restored = await restoreScope(previous)
          if (restored.kind === "package") restored.connect()
          throw error
        }
      }
    })
    transitionResult = operation
    transitionTail = operation.catch(() => {})
    return operation
  }

  /** Частный переход browser owner проверяет captured source и сервером выбранную ревизию в очереди Page. */
  async function navigateWorkspace(input: Readonly<{expectedPackageId: string | null; packageId: string | null; route: string; revision?: string; url?: string; followEnvironment?: true}>): Promise<void> {
    if (replacement !== null) {
      const next = (globalThis as typeof globalThis & Record<string, unknown>)[STORYBOOK_AGENT_BRIDGE_GLOBAL] as StorybookAgentBridge
      await next.call("navigate", input)
      return
    }
    if (input.followEnvironment !== true) following.cancel("Storybook environment following was superseded before navigation")
    const execute = (admission: AbortSignal) => {
      const operation = transitionTail.catch(() => {}).then(async () => {
        admission.throwIfAborted()
        const selected = execution.current
        const source = selected?.kind === "package" ? selected.target.packageId : null
        if (source !== input.expectedPackageId) throw new Error("Storybook view navigated to another package")
        const requested = input.url === undefined ? null : new URL(input.url, location.href)
        if (requested !== null && (!input.url!.startsWith("/") || input.url!.startsWith("//") || requested.origin !== new URL(location.href).origin || requested.hash)) {
          throw new Error("Storybook workspace navigation URL must be origin-relative")
        }
        if (requested?.searchParams.has("preview") && requested.searchParams.get("preview") !== input.revision) {
          throw new Error("Storybook workspace preview URL requires its exact revision")
        }
        const sameRoute = selected?.kind === "package" ? selected.target.packageId === input.packageId && selected.controller.currentRoute === input.route
          : selected?.kind === "landing" && input.packageId === null && (input.route === "" || input.route === "/")
        if (sameRoute && (input.revision === undefined || selected?.kind === "package" && selected.controller.revision === input.revision) &&
          (requested === null ? selected?.kind !== "package" || !selected.target.preview : requested.href === location.href)) {
          shell.selectSubject(subjectKey(selected!.target), true)
          return
        }
        if (input.packageId === null) {
          if (input.revision !== undefined || input.route !== "" && input.route !== "/") throw new Error("Landing navigation cannot carry a package revision")
          if (requested !== null && (requested.pathname !== "/" || [...requested.searchParams.keys()].some(key => key !== "inspector"))) throw new Error("Landing navigation requires the root address")
          await prepareTransition({packageId: null, route: "/", intent: "navigation"}, false, true, admission)
          return
        }
        const prepared = await awaitNavigationWork(prepareTarget({packageId: input.packageId, route: input.route,
          intent: input.revision === undefined ? "navigation" : "preview", ...(input.revision === undefined ? {} : {requestedRevision: input.revision})}, admission), admission)
        admission.throwIfAborted()
        if (prepared.kind === "landing" || prepared.packageId !== input.packageId || input.revision !== undefined && prepared.revision !== input.revision) {
          throw new Error("Storybook workspace preparation returned another package or revision")
        }
        if (requested !== null) {
          const canonical = new URL(prepared.urlPath, location.href)
          if (canonical.pathname !== requested.pathname || ["view", "variant"].some(key => canonical.searchParams.get(key) !== requested.searchParams.get(key))) {
            throw new Error("Storybook workspace URL does not match its prepared route")
          }
        }
        const payload = await awaitNavigationWork(loadPayload(prepared, admission), admission)
        admission.throwIfAborted()
        const nextHost = await awaitNavigationWork(readHost(payload?.sharedModuleEpoch, prepared.readerToken, admission, prepared.preview || prepared.intent === "navigation-candidate"), admission)
        admission.throwIfAborted()
        const pinned = requested?.searchParams.has("preview") ?? prepared.preview
        const target = input.revision !== undefined && !pinned
          ? await renewPackageTarget({...prepared, intent: "reader", preview: false}, admission)
          : prepared
        await installPrepared(requested === null ? target : {...target, urlPath: `${requested.pathname}${requested.search}`}, payload, false, true, nextHost, admission)
      })
      transitionResult = input.followEnvironment === true ? operation.catch(error => {if (!admission.aborted) throw error}) : operation
      transitionTail = operation.catch(() => {})
      return operation
    }
    await (input.followEnvironment === true ? following.run(execute) : execute(pageLifetime.signal))
  }

  async function navigatePackage(input: Readonly<{packageId: string; route: string}>): Promise<void> {
    if (replacement !== null) return replacement.navigatePackage(input)
    following.cancel("Storybook environment following was superseded before navigation")
    await transition({packageId: input.packageId, route: input.route, intent: "navigation"}, false, true)
  }

  async function navigateLanding(pathname = "/"): Promise<void> {
    if (replacement !== null) return replacement.navigateLanding(pathname)
    following.cancel("Storybook environment following was superseded before navigation")
    if (pathname === "/") await transition({packageId: null, route: pathname, intent: "navigation"}, false, true)
    else {
      const target = await resolveAddress(pathname)
      await transition({packageId: target.packageId, route: target.route, intent: "navigation"}, false, true)
    }
  }

  const resolveAddress = async (address: string, signal = pageLifetime.signal): Promise<Readonly<{packageId: string; route: string; urlPath: string}>> => {
    const requested = new URL(address, location.href)
    for (const key of [...requested.searchParams.keys()]) {
      if (key !== "view" && key !== "variant") requested.searchParams.delete(key)
    }
    const response = await fetcher("/api/browser/route", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({route: `${requested.pathname}${requested.search}`}),
      signal,
    })
    if (!response.ok) throw new Error(`Unknown Storybook address: ${address}`)
    const value = await awaitNavigationWork(response.json(), signal) as Record<string, unknown>
    if (typeof value.packageId !== "string" || typeof value.route !== "string" || typeof value.urlPath !== "string") {
      throw new Error("Storybook route resolver response is invalid")
    }
    return {packageId: value.packageId, route: value.route, urlPath: value.urlPath}
  }

  const onPopState = (): void => {
    following.cancel("Storybook environment following was superseded before navigation")
    const pathname = location.pathname
    const focus = execution.current === null || subjectKey(execution.current.target) !== pathname
    const current = new URL(location.href)
    const workspace = execution.current?.kind === "package" ? new URL(execution.current.controller.currentModel.urlPath, current) : null
    if (execution.current?.kind === "package" && workspace?.pathname === pathname &&
      (workspace.searchParams.get("view") ?? "overview") === (current.searchParams.get("view") ?? "overview")) {
      if (typeof execution.current.controller.restoreAddress === "function") execution.current.controller.restoreAddress()
      activeAddress = currentPageAddress(location)
      return
    }
    if (pathname === "/") {
      followHistoryTransition(transition({packageId: null, route: pathname, intent: "navigation"}, null, focus))
      return
    }
    followHistoryTransition((async () => {
      const target = await resolveAddress(currentPageAddress(location))
      await transition({packageId: target.packageId, route: target.route, intent: "navigation"}, null, focus)
    })())
  }

  const followHistoryTransition = (operation: Promise<void>): void => {
    void operation.catch(error => {
      history.replaceState(null, "", activeAddress)
      selectedShell().reportDiagnostic(error instanceof Error ? {phase: "page", message: error.message} : error)
      selectedShell().updateStatus("Storybook · History-переход отклонён; восстановлена текущая страница")
    })
  }

  const selectSpatialSubject = (id: string, focus = true): void => {
    if (disposed || pageLifetime.signal.aborted) return
    following.cancel("Storybook environment following was superseded before navigation")
    invalidatePendingScope()
    const pending = transitionTail.catch(() => {}).then(async () => {
      if (disposed || pageLifetime.signal.aborted) return
      const retained = subjects.get(id)
      if (retained !== undefined && replacement === null) {
        // Выбираем живой scope, не переигрывая route: внутренний click может
        // уже сменить вкладку, пока pointerdown ждёт очереди Page.
        await install(retained.target, retained.kind === "package" ? retained.payload : null, false, focus, true)
        return
      }
      const node = subjectsByPath.get(id)
      await prepareTransition({
        packageId: node?.packageId ?? null,
        route: node?.packageId ? node.routePath ?? "" : id,
        intent: "navigation",
      }, false, focus)
    })
    transitionResult = pending
    transitionTail = pending.catch(() => {})
    void pending.catch(error => {
      selectedShell().reportDiagnostic(error instanceof Error ? {phase: "page", message: error.message} : error)
    })
  }
  let spatialSignature = ""
  function updateSpatialCatalog(value: typeof catalog): void {
    if (disposed || releasingSubjects) return
    catalog = value
    subjectsByPath.clear()
    pathsById.clear()
    packagePaths.clear()
    for (const node of value.nodes) {
      const path = new URL(node.urlPath, location.href).pathname
      subjectsByPath.set(path, node)
      pathsById.set(node.id, path)
      if (node.kind === "package") packagePaths.set(node.packageId!, path)
    }
    const items = [
      {id: "/", label: value.projectName},
      ...spatialPackages(value).map(({node, parentId, rootId}) => ({
        id: pathsById.get(node.id)!,
        surfaceId: pathsById.get(rootId)!,
        parentId: parentId === null ? "/" : pathsById.get(parentId)!,
        label: node.label,
      })),
    ]
    const signature = JSON.stringify(items)
    if (signature === spatialSignature) return
    invalidatePendingScope()
    spatialSignature = signature
    // Не удалять живую оболочку раньше её controller cleanup.
    void (async () => {
      const selected = execution.current
      if (selected !== null && subjectKey(selected.target) !== "/" && !subjectsByPath.has(subjectKey(selected.target))) {
        await navigateLanding("/")
      }
      for (const [key, scope] of subjects) {
        if (key !== "/" && !subjectsByPath.has(key) && scope !== execution.current) await disposeScope(scope)
      }
      if (!disposed && !releasingSubjects) {
        shell.configureSubjects(items, selectSpatialSubject)
      }
    })().catch(error => selectedShell().reportDiagnostic(error instanceof Error ? {phase: "page", message: error.message} : error))
  }
  updateSpatialCatalog(catalog)

  const onGlobalNavigate = (event: unknown): void => {
    const detail = (event as {detail: {id?: string}}).detail
    if (detail.id === undefined) return
    const path = pathsById.get(detail.id)
    if (path !== undefined) selectSpatialSubject(path)
  }
  shell.workbench.element.addEventListener(shell.workbench.events.navigate, onGlobalNavigate)

  try {
    const initialPayload = options.initialPayload ?? (
      initialTarget.kind === "landing" ? null : await loadPayload(initialTarget, pageLifetime.signal)
    )
    await install(initialTarget, initialPayload, options.initialHistory === "push" ? false : null,
      options.initialFocus ?? (options.shell?.userState === undefined && initialTarget.kind !== "landing"), false,
      initialAdmission?.signal ?? pageLifetime.signal)
    initialAdmission = null
    stopInitialAdmission()
  } catch (error) {
    initialAdmission = null
    stopInitialAdmission()
    ;(bridge as StorybookAgentBridge | null)?.dispose()
    if (options.retainedRoot === undefined) shell.dispose()
    else shell.releaseRoot()
    pageLifetime.abort(error)
    throw error
  }
  globalThis.addEventListener?.("popstate", onPopState)

  /** Возвращает результат запущенных переходов, включая ошибку обновления из socket. */
  const whenSettled = async (): Promise<void> => {
    await following.whenSettled()
    let pending: Promise<void>
    do {
      pending = transitionResult
      await pending
    } while (pending !== transitionResult)
    if (replacement !== null) await replacement.whenSettled()
  }

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    pageLifetime.abort(new DOMException("External Storybook page disposed", "AbortError"))
    globalThis.removeEventListener?.("popstate", onPopState)
    shell.workbench.element.removeEventListener(shell.workbench.events.navigate, onGlobalNavigate)
    await transitionTail.catch(() => {})
    globalThis.removeEventListener?.("pagehide", onPageHide)
    if (replacement !== null) {
      await replacement.dispose()
      return
    }
    await closeSubjects()
    await execution.dispose()
    bridge?.dispose()
    bridge = null
    shell.dispose()
  }
  const onPageHide = (): void => { void dispose() }
  globalThis.addEventListener?.("pagehide", onPageHide, {once: true})

  return Object.freeze({
    get shell() { return replacement?.shell ?? selectedShell() },
    get packageId() {
      if (replacement !== null) return replacement.packageId
      return execution.current?.kind === "package" ? execution.current.target.packageId : null
    },
    get route() {
      if (replacement !== null) return replacement.route
      return execution.current?.kind === "package" ? execution.current.controller.currentRoute : execution.current?.target.pathname ?? "/"
    },
    navigatePackage,
    navigateLanding,
    whenSettled,
    dispose,
  })
}

export default startExternalStorybookPage
