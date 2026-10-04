/**
Управляет одной вкладкой Storybook: оболочкой, текущей областью Home или Package
и согласованными переходами между ними. Подготовка цели, замена области и запись
истории выполняются как одна операция с восстановлением прежней страницы при ошибке.
При HMR сохраняет пользовательское состояние и передаёт существующий Canvas новой среде.

@packageDocumentation
*/
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
  options: StartExternalStorybookPageOptions,
): Promise<ExternalStorybookPageController> {
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
  const execution = createHmrPage<ActivePageScope>({
    release: scope => disposeScope(scope),
    restore: scope => restoreScope(scope),
  })
  let bridge: StorybookAgentBridge | null = null
  let disposed = false
  let replacement: ExternalStorybookPageController | null = null
  let transitionTail: Promise<void> = Promise.resolve()
  let activeAddress = `${location.pathname}${new URL(location.href).search}${new URL(location.href).hash}`

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
        shell.updateStatus(buildProgressStatus(build))
        return
      }
      const catalog = readCatalogProgress(value)
      if (catalog !== null) {
        shell.updateStatus(catalogProgressStatus(catalog))
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
  ) => Object.freeze({
    shell,
    initialRoute: target.route,
    navigatePackage,
    navigateLanding,
    applyRevision: (revision: string) => applyPageRevision(target.packageId, revision),
    refreshSharedHost,
    readerRenewed(readerToken: string) {
      if (execution.current?.kind === "package" && execution.current.target.packageId === target.packageId) {
        execution.current.target = {...execution.current.target, readerToken}
      }
    },
    /** После серверного acknowledgement последующее переподключение возвращает ordinary reader. */
    revisionConfirmed(revision: string) {
      if (execution.current?.kind !== "package" || execution.current.target.packageId !== target.packageId || execution.current.controller.revision !== revision) return
      execution.current.target = {...execution.current.target, intent: "reader", preview: false, initialAppliedRevision: revision}
    },
    revisionApplied(payload: ExternalStorybookAppliedRevision) {
      const current = execution.current?.kind === "package" && execution.current.target.packageId === payload.packageId
        ? execution.current
        : null
      if (current === null) return
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

  const startPackageScope = async (
    target: ExternalStorybookPreparedPackageTarget,
    payload: ExternalStorybookAppliedRevision | null,
    address = createStorybookScopeAddress(target, location, history, value => { activeAddress = value }),
  ): Promise<ActivePackagePageScope> => {
    const deferredSocket = createDeferredStorybookSocket(() => eventSocket(target))
    const startPackage = options.startPackage ?? startExternalStorybookPackage
    const controller = await startPackage({
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
        lifecycleSignal: pageLifetime.signal,
        pageScope: pageScope(target),
        loadAppliedRevision: (revision, signal) => (options.loadAppliedRevision ?? loadStorybookAppliedRevision)(
          target.packageId,
          revision,
          signal,
        ),
      },
    })
    return {kind: "package", target, payload, controller, connect: deferredSocket.connect, address}
  }

  const startLandingScope = async (
    target: ExternalStorybookPreparedLandingTarget,
    address = createStorybookScopeAddress(target, location, history, value => { activeAddress = value }),
  ): Promise<ActiveLandingPageScope> => {
    const controller = await startExternalStorybookLanding({
      browserDocument,
      location: address.location,
      history: address.history,
      fetcher,
      createSocket: () => eventSocket(target),
      readerToken: target.readerToken,
      pageScope: {shell, initialPathname: target.pathname, navigatePackage, refreshSharedHost,
        async reconnectSocket() {
          const next = await prepareTarget({packageId: null, route: target.pathname, intent: "navigation"}, pageLifetime.signal)
          if (next.kind !== "landing" || execution.current?.kind !== "landing") throw new DOMException("Landing scope changed", "AbortError")
          execution.current.target = next
          return eventSocket(next)
        },
      },
    })
    return {kind: "landing", target, controller, address}
  }

  const syncBridge = (): void => {
    browserDocument.documentElement.dataset.externalStorybookSharedModuleEpoch = host.sharedModuleEpoch
    browserDocument.documentElement.dataset.externalStorybookHostModuleEpoch = host.hostModuleEpoch
    const current = execution.current?.kind === "package" ? execution.current.controller : null
    if (current === null) {
      bridge?.dispose()
      bridge = null
      return
    }
    if (bridge !== null) {
      bridge.updateIdentity(current.packageId, current.revision ?? "unavailable", current.graphDigest)
      return
    }
    bridge = createStorybookAgentBridge({
      packageId: current.packageId,
      revision: current.revision ?? "unavailable",
      graphDigest: current.graphDigest,
      shell,
      getRoute: () => requirePackageScope(execution.current).controller.currentRoute,
      getModel: () => requirePackageScope(execution.current).controller.currentModel,
      navigate: route => requirePackageScope(execution.current).controller.navigate(route),
      selectScenario: value => requirePackageScope(execution.current).controller.selectScenario(value),
      applyRevision: revision => applyPageRevision(requirePackageScope(execution.current).target.packageId, revision),
      canApplyRevision: () => requirePackageScope(execution.current).controller.canApplyRevision(),
      async waitForStableScope() {
        let pending: Promise<void>
        do {
          pending = transitionTail
          await pending
        } while (pending !== transitionTail)
        if (!disposed && replacement !== null) {
          const next = (globalThis as typeof globalThis & Record<string, unknown>)[STORYBOOK_AGENT_BRIDGE_GLOBAL] as StorybookAgentBridge | undefined
          if (next === undefined || next === bridge) throw new Error("Storybook platform did not install its agent bridge")
          return next
        }
        if (disposed || execution.current?.kind !== "package") {
          throw new DOMException("Storybook view navigated away from the requested package", "AbortError")
        }
      },
    })
  }

  const disposeScope = async (scope: ActivePageScope | null): Promise<void> => {
    if (scope?.kind === "package") await scope.controller.dispose()
    else scope?.controller.dispose()
  }

  const renewPackageTarget = async (
    target: ExternalStorybookPreparedPackageTarget,
  ): Promise<ExternalStorybookPreparedPackageTarget> => {
    const response = await fetcher("/api/browser/session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        packageId: target.packageId,
        revision: target.revision,
        preview: target.preview || target.intent === "navigation-candidate",
      }),
      signal: pageLifetime.signal,
    })
    if (!response.ok) throw new Error(`Storybook package reader renewal failed: ${target.packageId}`)
    const result = await response.json() as {token?: unknown}
    if (typeof result.token !== "string") throw new Error("Storybook package reader renewal returned no token")
    return {...target, readerToken: result.token}
  }

  const restoreScope = async (scope: ActivePageScope): Promise<ActivePageScope> => {
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
      shell.reportDiagnostic(error)
      shell.updateStatus("Пакет открыт; подтверждение рабочей версии не завершено")
    })
  }

  const install = async (
    target: ExternalStorybookPreparedPageTarget,
    payload: ExternalStorybookAppliedRevision | null,
    replaceAddress: boolean | null,
  ): Promise<void> => {
    const scroll = readPageScroll(shell)
    const previousAddress = activeAddress
    try {
      await execution.replace(
        () => target.kind === "landing" ? startLandingScope(target) : startPackageScope(target, payload),
        (scope, restored) => {
          if (restored) {
            history.replaceState(null, "", previousAddress)
            activeAddress = previousAddress
          }
          syncBridge()
          scope.address.commit(!restored && replaceAddress === false ? "push" : "replace")
          activeAddress = scope.address.address
          if (scope.kind === "package") scope.connect()
          restorePageScroll(shell, scroll)
        },
      )
      confirmNavigation()
    } catch (error) {
      if (execution.current === null) {
        history.replaceState(null, "", previousAddress)
        activeAddress = previousAddress
      }
      throw error
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
  ): Promise<void> => {
    const startPage = await (options.importSharedHost ?? WebProtocol.importSharedHost<typeof startExternalStorybookPage>)(nextHost)
    const previous = execution.current
    if (previous === null) throw new Error("Storybook platform replacement requires an active scope")
    const scroll = readPageScroll(shell)
    const previousAddress = activeAddress
    const shellOptions = {...options.shell, canvas: shell.canvas, userState: shell.captureUserState()}
    const catalogSearch = shell.workbench.controller.read("catalog.search")
    let retainedRoot: StorybookRetainedRoot | undefined
    const {retainedRoot: _previousRoot, ...pageOptions} = options
    globalThis.removeEventListener?.("popstate", onPopState)
    globalThis.removeEventListener?.("pagehide", onPageHide)
    await execution.detach()
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
      })
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
  ): Promise<void> => {
    const nextHost = await readHost(payload?.sharedModuleEpoch, target.readerToken, pageLifetime.signal,
      target.kind !== "landing" && (target.preview || target.intent === "navigation-candidate"))
    if (nextHost.sharedModuleEpoch !== host.sharedModuleEpoch || nextHost.hostModuleEpoch !== host.hostModuleEpoch) {
      await replacePage(target, payload, replaceAddress, nextHost)
    } else await install(target, payload, replaceAddress)
  }

  /**
  Применяет текущую общую оболочку без изменения package revision или адреса вкладки.
  Передача управления выдаёт новый reader grant: одноразовый токен прежнего
  WebSocket не переносится в соединение нового scope. Неудача сохраняет рабочую страницу.
  */
  function refreshSharedHost(): Promise<void> {
    const operation = transitionTail.catch(() => {}).then(async () => {
      if (disposed || pageLifetime.signal.aborted || replacement !== null || execution.current === null) return
      const current = execution.current
      const payload = current.kind === "package" ? current.payload : null
      const nextHost = await readHost(payload?.sharedModuleEpoch, current.target.readerToken, pageLifetime.signal,
        current.kind === "package" && (current.target.preview || current.target.intent === "navigation-candidate"))
      if (nextHost.hostModuleEpoch === host.hostModuleEpoch && nextHost.sharedModuleEpoch === host.sharedModuleEpoch) return
      const target = current.kind === "package" ? await renewPackageTarget({
        ...current.target,
        route: current.controller.currentRoute,
        urlPath: current.controller.currentModel.urlPath,
      }) : await prepareTarget({packageId: null, route: current.target.pathname, intent: "navigation"}, pageLifetime.signal)
      await replacePage(target, payload, null, nextHost)
    })
    transitionTail = operation.catch(() => {})
    return operation
  }

  const transition = (
    request: ExternalStorybookPagePrepareInput,
    replaceAddress: boolean | null,
  ): Promise<void> => {
    const operation = transitionTail
      .catch(() => {})
      .then(async () => {
        if (disposed) throw new Error("External Storybook page is disposed")
        if (replacement !== null) {
          if (request.packageId === null) await replacement.navigateLanding(request.route)
          else await replacement.navigatePackage({packageId: request.packageId, route: request.route})
          return
        }
        delete browserDocument.documentElement.dataset.externalStorybookNavigationError
        shell.updateStatus("Storybook · Подготовка выбранного пакета")
        const pending = request.packageId === null
          ? null
          : await pendingTargetStatus(request.packageId, pageLifetime.signal)
        try {
          const target = await prepareTarget(request, pageLifetime.signal)
          const payload = target.kind === "landing" ? null : await loadPayload(target, pageLifetime.signal)
          pending?.dispose()
          await installPrepared(target, payload, replaceAddress)
        } finally {
          pending?.dispose()
        }
      })
    transitionTail = operation.catch(() => {})
    return operation
  }

  /**
  Заменяет контроллер пакета вместе с его payload, сохраняя общий Root и оболочку.
  Новая host-реализация приходит из того же immutable payload. Смена платформы
  передаёт Canvas новой среде; ошибка mount восстанавливает предыдущую среду.
  */
  function applyPageRevision(packageId: string, revision: string): Promise<void> {
    const operation = transitionTail.catch(() => {}).then(async () => {
      const current = execution.current
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
      const target = await renewPackageTarget({
        ...prepared,
        intent: current.target.intent,
        preview: current.target.preview,
      })
      await installPrepared(target, payload, null)
    })
    transitionTail = operation.catch(() => {})
    return operation
  }

  async function navigatePackage(input: Readonly<{packageId: string; route: string}>): Promise<void> {
    if (replacement !== null) return replacement.navigatePackage(input)
    await transition({packageId: input.packageId, route: input.route, intent: "navigation"}, false)
  }

  async function navigateLanding(pathname = "/"): Promise<void> {
    if (replacement !== null) return replacement.navigateLanding(pathname)
    if (pathname === "/") await transition({packageId: null, route: pathname, intent: "navigation"}, false)
    else {
      const target = await resolveAddress(pathname)
      await transition({packageId: target.packageId, route: target.route, intent: "navigation"}, false)
    }
  }

  const resolveAddress = async (address: string): Promise<Readonly<{packageId: string; route: string; urlPath: string}>> => {
    const requested = new URL(address, location.href)
    for (const key of [...requested.searchParams.keys()]) {
      if (key !== "view" && key !== "variant") requested.searchParams.delete(key)
    }
    const response = await fetcher("/api/browser/route", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({route: `${requested.pathname}${requested.search}`}),
      signal: pageLifetime.signal,
    })
    if (!response.ok) throw new Error(`Unknown Storybook address: ${address}`)
    const value = await response.json() as Record<string, unknown>
    if (typeof value.packageId !== "string" || typeof value.route !== "string" || typeof value.urlPath !== "string") {
      throw new Error("Storybook route resolver response is invalid")
    }
    return {packageId: value.packageId, route: value.route, urlPath: value.urlPath}
  }

  const onPopState = (): void => {
    const pathname = location.pathname
    const current = new URL(location.href)
    const workspace = execution.current?.kind === "package" ? new URL(execution.current.controller.currentModel.urlPath, current) : null
    if (execution.current?.kind === "package" && workspace?.pathname === pathname &&
      (workspace.searchParams.get("view") ?? "overview") === (current.searchParams.get("view") ?? "overview")) {
      if (typeof execution.current.controller.restoreAddress === "function") execution.current.controller.restoreAddress()
      activeAddress = currentPageAddress(location)
      return
    }
    if (pathname === "/") {
      followHistoryTransition(transition({packageId: null, route: pathname, intent: "navigation"}, null))
      return
    }
    followHistoryTransition((async () => {
      const target = await resolveAddress(currentPageAddress(location))
      await transition({packageId: target.packageId, route: target.route, intent: "navigation"}, null)
    })())
  }

  const followHistoryTransition = (operation: Promise<void>): void => {
    void operation.catch(error => {
      history.replaceState(null, "", activeAddress)
      shell.reportDiagnostic(error)
      shell.updateStatus("Storybook · History-переход отклонён; восстановлена текущая страница")
    })
  }

  try {
    const initialPayload = options.initialPayload ?? (
      initialTarget.kind === "landing" ? null : await loadPayload(initialTarget, pageLifetime.signal)
    )
    await install(initialTarget, initialPayload, options.initialHistory === "push" ? false : null)
  } catch (error) {
    ;(bridge as StorybookAgentBridge | null)?.dispose()
    if (options.retainedRoot === undefined) shell.dispose()
    else shell.releaseRoot()
    pageLifetime.abort(error)
    throw error
  }
  globalThis.addEventListener?.("popstate", onPopState)

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    pageLifetime.abort(new DOMException("External Storybook page disposed", "AbortError"))
    globalThis.removeEventListener?.("popstate", onPopState)
    await transitionTail.catch(() => {})
    globalThis.removeEventListener?.("pagehide", onPageHide)
    if (replacement !== null) {
      await replacement.dispose()
      return
    }
    await execution.dispose()
    bridge?.dispose()
    bridge = null
    shell.dispose()
  }
  const onPageHide = (): void => { void dispose() }
  globalThis.addEventListener?.("pagehide", onPageHide, {once: true})

  return Object.freeze({
    get shell() { return replacement?.shell ?? shell },
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
    dispose,
  })
}

export default startExternalStorybookPage
