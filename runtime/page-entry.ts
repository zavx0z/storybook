import {createStorybookAgentBridge, type StorybookAgentBridge} from "./agent-bridge.ts"
import {indexedWorkbenchAuthorStyleSheetSources} from "./author-style-sheets.ts"
import {mergeStorybookAuthorStyleSheets} from "../catalog/author-style-sheets.ts"
import type {ExternalStorybookClientSnapshot} from "./client-protocol.ts"
import {
  startExternalStorybookLanding,
  type ExternalStorybookLandingController,
} from "./landing-entry.ts"
import {
  startExternalStorybookPackage,
  type ExternalStorybookAppliedRevision,
  type ExternalStorybookPackageController,
  type ExternalStorybookSocket,
} from "./package-entry.ts"
import {createStorybookPackageStyleSheetOwner} from "./package-style-sheets.ts"
import {loadStorybookAppliedRevision} from "./revision-loader.ts"
import {
  buildProgressStatus,
  catalogProgressStatus,
  readBuildProgress,
  readCatalogProgress,
  readSharedCacheProgress,
  sharedCacheProgressStatus,
} from "./build-progress.ts"
import {
  createExternalStorybookShell,
  fetchExternalStorybookClientSnapshot,
  type CreateExternalStorybookShellOptions,
  type ExternalStorybookShell,
} from "./shell.ts"

/**
Режим, связывающий загруженную ревизию с правом её автоматического применения.

`navigation-candidate` удерживает built candidate до browser evidence,
`preview` остаётся изолированным, а `reader` следует фактически применённой ревизии.
*/
export type ExternalStorybookPageIntent = "reader" | "navigation-candidate" | "preview"

/**
Подготовленная server-owned цель одного package scope.

@property kind - `revision` несёт immutable payload; `fallback` показывает пакет без доступной ревизии.

@property packageId - Exact владелец graph, runtime, socket subscription и diagnostics.

@property revision - Загружаемая ревизия; `null` допустим только для fallback.

@property revisionUrl - Immutable base URL ресурсов той же ревизии.

@property [payloadUrl] - Диагностический exact URL side-effect-free payload; импорт выполняет {@link loadStorybookAppliedRevision}.

@property route - Нормализованный route внутри revision graph.

@property urlPath - Server-resolved публичный адрес route; runtime не восстанавливает его из packageId.

@property intent - Отделяет обычного reader от candidate и explicit preview.

@property preview - Запрещает autoapply для reader grant независимо от query после commit.

@property initialAppliedRevision - Фактически применённая ревизия до проверки candidate; не подменяется loaded revision.

@property fallbackRevision - Last-working revision для восстановления failed candidate.

@property readerToken - Одноразовый token exact package subscription и revision lease.
*/
export type ExternalStorybookPreparedPackageTarget = Readonly<{
  kind: "revision" | "fallback"
  packageId: string
  revision: string | null
  revisionUrl: string | null
  payloadUrl?: string | null
  route: string
  urlPath: string
  intent: ExternalStorybookPageIntent
  preview: boolean
  initialAppliedRevision: string | null
  fallbackRevision: string | null
  readerToken: string
}>

/**
Подготовленная цель landing scope в том же {@link ExternalStorybookShell}.

@property pathname - Server-recognized landing address для staged history.

@property readerToken - Token registry subscription; package topics им не разрешены.
*/
export type ExternalStorybookPreparedLandingTarget = Readonly<{
  kind: "landing"
  pathname: string
  readerToken: string
}>

/** Server-owned package либо landing target для одной атомарной page transition. */
export type ExternalStorybookPreparedPageTarget =
  | ExternalStorybookPreparedPackageTarget
  | ExternalStorybookPreparedLandingTarget

/**
Запрос цели без локального выбора built, active или last-working revision.

@property packageId - Exact package либо `null` для landing.

@property route - Package route или landing pathname, которые разрешает server owner.

@property intent - `preview` требует exact requestedRevision; `navigation` оставляет revision policy серверу.

@property [requestedRevision] - Opaque bounded revision только explicit preview.
*/
export type ExternalStorybookPagePrepareInput = Readonly<{
  packageId: string | null
  route: string
  intent: "navigation" | "preview"
  requestedRevision?: string
}>

/**
Зависимости единственного page owner.

@property [initialTarget] - Cold target; при отсутствии читается из `external-storybook-page-target` текущего HTML.

@property [initialPayload] - Уже импортированный payload generated package entry; исключает повторный import.

@property sharedModuleEpoch - Identity платформенных ESM owners, общих для всех scopes страницы.

@property [hostModuleEpoch] - Identity Storybook host implementation, создавшего retained shell.

@property [browserDocument] - Native Document страницы; semantic Document принадлежит {@link ExternalStorybookShell}.

@property [location] - Фактический URL страницы. Новый scope получает staged adapter до успешного commit.

@property [history] - Единственный владелец browser entries; scope не пишет сюда до commit.

@property [fetcher] - Same-origin transport `/api/client`, prepare и reader sessions.

@property [createSocket] - Browser socket factory для exact reader token.

@property [shell] - Seams создания одного {@link ExternalStorybookShell}; package scopes не получают право его dispose.

@property [prepareTarget] - Server resolver target. Default вызывает {@link prepareExternalStorybookPageTarget}.

@property [loadAppliedRevision] - Generic exact package/revision payload loader. Default использует {@link loadStorybookAppliedRevision}.
*/
export type StartExternalStorybookPageOptions = Readonly<{
  initialTarget?: ExternalStorybookPreparedPageTarget
  initialPayload?: ExternalStorybookAppliedRevision | null
  sharedModuleEpoch: string
  hostModuleEpoch?: string
  browserDocument?: globalThis.Document
  location?: Pick<Location, "href" | "pathname">
  history?: Pick<History, "pushState" | "replaceState">
  fetcher?: typeof fetch
  createSocket?(url: string): ExternalStorybookSocket
  shell?: Omit<CreateExternalStorybookShellOptions, "title" | "browserDocument" | "authorStyleSheetSources">
  prepareTarget?(
    input: ExternalStorybookPagePrepareInput,
    signal: AbortSignal,
  ): Promise<ExternalStorybookPreparedPageTarget>
  loadAppliedRevision?(
    packageId: string,
    revision: string,
    signal: AbortSignal,
  ): Promise<ExternalStorybookAppliedRevision>
}>

/**
Page-level lifecycle одного Root, Canvas и Workbench.

@property shell - Stable {@link ExternalStorybookShell}, общий для landing и всех package scopes.

@property packageId - Текущий committed package либо `null` на landing.

@property route - Committed package route или landing pathname.

@property navigatePackage - Сериализует prepare, scoped teardown, mount и history commit.

@property navigateLanding - Заменяет package scope landing scope без замены shell.

@property dispose - Abort-ит transition, освобождает текущий scope, styles, bridge и затем shell.
*/
export type ExternalStorybookPageController = Readonly<{
  shell: ExternalStorybookShell
  get packageId(): string | null
  get route(): string
  navigatePackage(input: Readonly<{packageId: string; route: string}>): Promise<void>
  navigateLanding(pathname?: string): Promise<void>
  dispose(): Promise<void>
}>

/** Package-owned runtime, subscription и staged address без владения page shell. */
type ActivePackagePageScope = {
  kind: "package"
  target: ExternalStorybookPreparedPackageTarget
  payload: ExternalStorybookAppliedRevision | null
  controller: ExternalStorybookPackageController
  connect(): void
  address: StorybookScopeAddress
}

/** Landing-owned registry subscription и staged address без владения page shell. */
type ActiveLandingPageScope = {
  kind: "landing"
  target: ExternalStorybookPreparedLandingTarget
  controller: ExternalStorybookLandingController
  address: StorybookScopeAddress
}

/** Ровно один committed child scope page controller. */
type ActivePageScope = ActivePackagePageScope | ActiveLandingPageScope

/**
Создаёт один page owner и заменяет только package/landing scopes внутри его shell.

Каждый переход сначала получает server target, payload, pending status и semantic
styles. Старый scope освобождается только перед mount; ошибка восстанавливает его
payload, styles, socket, Inspector, scroll и последний committed URL. `popstate`
использует тот же pipeline, поэтому незавершённый history target не становится
адресом рабочей страницы.

@param options - Epochs page realm, cold target и узкие transport seams.

@returns Контроллер, который должен быть освобождён через {@link ExternalStorybookPageController.dispose}.

@throws При отсутствии browser environment, несовместимой module epoch, ошибке prepare/mount или невозможности rollback.

@example
```ts
const page = await startExternalStorybookPage({sharedModuleEpoch})
try {
  await page.navigatePackage({packageId: "@webxr/markdown", route: ""})
} finally {
  await page.dispose()
}
```
*/
export async function startExternalStorybookPage(
  options: StartExternalStorybookPageOptions,
): Promise<ExternalStorybookPageController> {
  const browserDocument = options.browserDocument ?? globalThis.document
  const location = options.location ?? globalThis.location
  const history = options.history ?? globalThis.history
  if (browserDocument === undefined || location === undefined || history === undefined) {
    throw new Error("External Storybook page browser environment is unavailable")
  }
  const fetcher = options.fetcher ?? globalThis.fetch
  const initialTarget = options.initialTarget ?? readInitialPageTarget(browserDocument)
  const prepareTarget = options.prepareTarget ?? ((input, signal) =>
    prepareExternalStorybookPageTarget(fetcher, input, signal))
  const pageLifetime = new AbortController()
  let navigationSnapshot = await fetchExternalStorybookClientSnapshot(fetcher)
  const shell = await createExternalStorybookShell({
    title: "Storybook",
    browserDocument,
    ...(options.shell ?? {}),
    authorStyleSheetSources: indexedWorkbenchAuthorStyleSheetSources(browserDocument),
  })
  const styleOwner = createStorybookPackageStyleSheetOwner(shell)
  let active: ActivePageScope | null = null
  let bridge: StorybookAgentBridge | null = null
  let disposed = false
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
    if (payload.sharedModuleEpoch !== options.sharedModuleEpoch ||
      (payload.hostModuleEpoch ?? null) !== (options.hostModuleEpoch ?? null)) {
      throw new Error(`Storybook page module epoch changed; page restart is required: ${target.packageId}:${target.revision}`)
    }
    return payload
  }

  const eventSocket = (target: ExternalStorybookPreparedPageTarget): ExternalStorybookSocket => {
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
      const shared = readSharedCacheProgress(value)
      if (shared !== null) shell.updateStatus(sharedCacheProgressStatus(shared))
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
    /** После серверного acknowledgement последующее переподключение возвращает ordinary reader. */
    revisionConfirmed(revision: string) {
      if (active?.kind !== "package" || active.target.packageId !== target.packageId || active.controller.revision !== revision) return
      active.target = {...active.target, intent: "reader", preview: false, initialAppliedRevision: revision}
    },
    revisionApplied(payload: ExternalStorybookAppliedRevision) {
      const current = active?.kind === "package" && active.target.packageId === payload.packageId
        ? active
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
    prepareRevisionStyleSheets(payload: ExternalStorybookAppliedRevision, signal: AbortSignal) {
      return styleOwner.prepare(
        payload.revisionUrl,
        packageOwnedAuthorStyleSheets(payload),
        signal,
      )
    },
  })

  const startPackageScope = async (
    target: ExternalStorybookPreparedPackageTarget,
    payload: ExternalStorybookAppliedRevision | null,
    address = createStorybookScopeAddress(target, location, history, value => { activeAddress = value }),
  ): Promise<ActivePackagePageScope> => {
    const deferredSocket = createDeferredStorybookSocket(() => eventSocket(target))
    const controller = await startExternalStorybookPackage({
      packageId: target.packageId,
      candidateRevision: target.revision,
      revisionUrl: target.revisionUrl,
      sharedModuleEpoch: options.sharedModuleEpoch,
      ...(options.hostModuleEpoch === undefined ? {} : {hostModuleEpoch: options.hostModuleEpoch}),
      ...(payload === null ? {} : {graphSnapshot: payload.graphSnapshot}),
      loadRuntime: payload?.loadRuntime ?? null,
      storyLoaders: payload?.storyLoaders ?? new Map(),
      widgetLoaders: payload?.widgetLoaders ?? new Map(),
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
      pageScope: {shell, initialPathname: target.pathname, navigatePackage},
    })
    return {kind: "landing", target, controller, address}
  }

  const syncBridge = (): void => {
    const current = active?.kind === "package" ? active.controller : null
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
      getRoute: () => requirePackageScope(active).controller.currentRoute,
      getModel: () => requirePackageScope(active).controller.currentModel,
      navigate: route => requirePackageScope(active).controller.navigate(route),
      applyRevision: revision => requirePackageScope(active).controller.applyRevision(revision),
      canApplyRevision: () => requirePackageScope(active).controller.canApplyRevision(),
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
        preview: target.preview,
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

  const install = async (
    target: ExternalStorybookPreparedPageTarget,
    payload: ExternalStorybookAppliedRevision | null,
    replaceAddress: boolean | null,
  ): Promise<void> => {
    const previous = active
    const scroll = readPageScroll(shell)
    const previousAddress = activeAddress
    const styleTransaction = await styleOwner.prepare(
      payload?.revisionUrl ?? "",
      payload === null ? [] : packageOwnedAuthorStyleSheets(payload),
      pageLifetime.signal,
    )
    try {
      await disposeScope(previous)
      active = null
      await styleTransaction.commit()
      active = target.kind === "landing"
        ? await startLandingScope(target)
        : await startPackageScope(target, payload)
      syncBridge()
      active.address.commit(replaceAddress === false ? "push" : "replace")
      activeAddress = active.address.address
      if (active.kind === "package") active.connect()
      restorePageScroll(shell, scroll)
      styleTransaction.release()
    } catch (error) {
      if (active !== null) await disposeScope(active)
      active = null
      await styleTransaction.rollback()
      history.replaceState(null, "", previousAddress)
      activeAddress = previousAddress
      if (previous !== null) {
        active = await restoreScope(previous)
        syncBridge()
        active.address.commit("replace")
        activeAddress = active.address.address
        if (active.kind === "package") active.connect()
        restorePageScroll(shell, scroll)
      }
      throw error
    }
  }

  const transition = (
    request: ExternalStorybookPagePrepareInput,
    replaceAddress: boolean | null,
  ): Promise<void> => {
    const operation = transitionTail
      .catch(() => {})
      .then(async () => {
        if (disposed) throw new Error("External Storybook page is disposed")
        shell.updateStatus("Storybook · Подготовка выбранного пакета")
        const pending = request.packageId === null
          ? null
          : await pendingTargetStatus(request.packageId, pageLifetime.signal)
        try {
          const target = await prepareTarget(request, pageLifetime.signal)
          const payload = target.kind === "landing" ? null : await loadPayload(target, pageLifetime.signal)
          const preparedNavigation = await fetchExternalStorybookClientSnapshot(fetcher)
          pending?.dispose()
          await install(target, payload, replaceAddress)
          navigationSnapshot = preparedNavigation
        } finally {
          pending?.dispose()
        }
      })
    transitionTail = operation.catch(() => {})
    return operation
  }

  async function navigatePackage(input: Readonly<{packageId: string; route: string}>): Promise<void> {
    await transition({packageId: input.packageId, route: input.route, intent: "navigation"}, false)
  }

  async function navigateLanding(pathname = "/"): Promise<void> {
    await transition({packageId: null, route: pathname, intent: "navigation"}, false)
  }

  const onPopState = (): void => {
    const pathname = location.pathname
    if (pathname === "/" || !pathname.startsWith("/pkg-")) {
      followHistoryTransition(transition({packageId: null, route: pathname, intent: "navigation"}, null))
      return
    }
    const node = navigationSnapshot.nodes.find(candidate => candidate.urlPath === pathname)
    if (node?.packageId === null || node?.packageId === undefined) {
      shell.reportDiagnostic(`Unknown Storybook history address: ${pathname}`)
      return
    }
    followHistoryTransition(transition({packageId: node.packageId, route: node.routePath ?? "", intent: "navigation"}, null))
  }

  const followHistoryTransition = (operation: Promise<void>): void => {
    void operation.catch(error => {
      shell.reportDiagnostic(error)
      shell.updateStatus("Storybook · History-переход отклонён; восстановлена текущая страница")
    })
  }

  const initialPayload = options.initialPayload ?? (
    initialTarget.kind === "landing" ? null : await loadPayload(initialTarget, pageLifetime.signal)
  )
  await install(initialTarget, initialPayload, null)
  globalThis.addEventListener?.("popstate", onPopState)

  const dispose = async (): Promise<void> => {
    if (disposed) return
    disposed = true
    pageLifetime.abort(new DOMException("External Storybook page disposed", "AbortError"))
    globalThis.removeEventListener?.("popstate", onPopState)
    await transitionTail.catch(() => {})
    await disposeScope(active)
    active = null
    bridge?.dispose()
    bridge = null
    styleOwner.clear()
    shell.dispose()
  }
  const onPageHide = (): void => { void dispose() }
  globalThis.addEventListener?.("pagehide", onPageHide, {once: true})

  return Object.freeze({
    shell,
    get packageId() {
      return active?.kind === "package" ? active.target.packageId : null
    },
    get route() {
      return active?.kind === "package" ? active.controller.currentRoute : active?.target.pathname ?? "/"
    },
    navigatePackage,
    navigateLanding,
    dispose,
  })
}

/** Возвращает текущий package scope для bridge callback после live owner check. */
function requirePackageScope(scope: ActivePageScope | null): ActivePackagePageScope {
  if (scope?.kind !== "package") throw new Error("External Storybook page has no active package scope")
  return scope
}

/** Минимальный public scroll transport semantic Workbench host. */
type ScrollablePageElement = {scrollTop: number; scrollLeft: number}

/** Stable host positions и позиция заменяемого presentation root. */
type ExternalStorybookPageScroll = Readonly<{
  stable: readonly Readonly<{element: ScrollablePageElement; top: number; left: number}>[]
  presentation: Readonly<{top: number; left: number}> | null
}>

/** Снимает scroll до scoped teardown без клонирования semantic nodes. */
function readPageScroll(shell: ExternalStorybookShell): ExternalStorybookPageScroll {
  const values: unknown[] = [
    shell.workbench.elements.catalogItems,
    shell.workbench.elements.secondaryItems,
    shell.workbench.elements.tabItems,
    shell.workbench.elements.inspectorHost,
    shell.workbench.elements.previewHost,
  ]
  const stable = Object.freeze(values.filter(isScrollablePageElement)
    .map(element => Object.freeze({element, top: element.scrollTop, left: element.scrollLeft})))
  const presentation = shell.workbench.controller.read("presentation").node
  return Object.freeze({
    stable,
    presentation: isScrollablePageElement(presentation)
      ? Object.freeze({top: presentation.scrollTop, left: presentation.scrollLeft})
      : null,
  })
}

/** Возвращает stable host scroll и переносит presentation position на новый root. */
function restorePageScroll(shell: ExternalStorybookShell, scroll: ExternalStorybookPageScroll): void {
  for (const value of scroll.stable) {
    value.element.scrollTop = value.top
    value.element.scrollLeft = value.left
  }
  const presentation = shell.workbench.controller.read("presentation").node
  if (scroll.presentation !== null && isScrollablePageElement(presentation)) {
    presentation.scrollTop = scroll.presentation.top
    presentation.scrollLeft = scroll.presentation.left
  }
}

/** Проверяет только нужную page controller часть scroll contract. */
function isScrollablePageElement(value: unknown): value is ScrollablePageElement {
  return value !== null && typeof value === "object" &&
    typeof (value as {scrollTop?: unknown}).scrollTop === "number" &&
    typeof (value as {scrollLeft?: unknown}).scrollLeft === "number"
}

/** Вычитает exact shared Workbench sheets из валидированного merged revision set. */
function packageOwnedAuthorStyleSheets(
  payload: ExternalStorybookAppliedRevision,
) {
  const workbench = new Set(payload.graphSnapshot.workbenchAuthorStyleSheets.map(({specifier, contentDigest}) =>
    `${specifier}\0${contentDigest}`))
  return mergeStorybookAuthorStyleSheets(
    payload.graphSnapshot.workbenchAuthorStyleSheets,
    payload.graphSnapshot.authorStyleSheets,
  ).filter(({specifier, contentDigest}) => !workbench.has(`${specifier}\0${contentDigest}`))
}

/**
Staged URL одного ещё не committed scope.

@property location - Читает draft до commit и реальный page URL после него; reload всегда запрещён.

@property history - До commit нормализует только draft, затем передаёт операции единственному browser History.

@property address - Последний нормализованный адрес этого scope.

@property commit - Создаёт либо заменяет browser entry ровно один раз и начинает отслеживать дальнейшие route/Inspector изменения.
*/
type StorybookScopeAddress = Readonly<{
  location: Pick<Location, "href" | "pathname" | "reload">
  history: Pick<History, "pushState" | "replaceState">
  readonly address: string
  commit(mode: "push" | "replace"): void
}>

/**
Создаёт staged URL, чтобы initial `replaceState` нового scope не изменил history прежнего.

@param target - Server-resolved package URL либо landing pathname.

@param pageLocation - Реальный URL, который до commit остаётся нетронутым.

@param pageHistory - Единственный browser History owner.

@param onCommittedAddress - Обновляет rollback address после route и Inspector операций active scope.

@returns Draft adapter, передаваемый только создаваемому package или landing scope.
*/
function createStorybookScopeAddress(
  target: ExternalStorybookPreparedPageTarget,
  pageLocation: Pick<Location, "href" | "pathname">,
  pageHistory: Pick<History, "pushState" | "replaceState">,
  onCommittedAddress: (address: string) => void,
): StorybookScopeAddress {
  let committed = false
  let draft = new URL(pageLocation.href)
  draft.pathname = target.kind === "landing" ? target.pathname : target.urlPath
  draft.searchParams.delete("preview")
  if (target.kind !== "landing" && target.intent === "preview" && target.revision !== null) {
    draft.searchParams.set("preview", target.revision)
  }
  const updateDraft = (value: string | URL | null): void => {
    if (value !== null) draft = new URL(String(value), draft.href)
  }
  const location = {
    get href() {
      return committed ? pageLocation.href : draft.href
    },
    set href(value: string) {
      if (committed) throw new Error("Storybook scope cannot assign browser location")
      draft = new URL(value, draft.href)
    },
    get pathname() {
      return committed ? pageLocation.pathname : draft.pathname
    },
    reload() {
      throw new Error("Storybook scope cannot reload its page")
    },
  }
  const history = {
    pushState(data: unknown, unused: string, url?: string | URL | null) {
      if (!committed) {
        updateDraft(url ?? null)
        return
      }
      pageHistory.pushState(data, unused, url)
      onCommittedAddress(currentPageAddress(pageLocation))
    },
    replaceState(data: unknown, unused: string, url?: string | URL | null) {
      if (!committed) {
        updateDraft(url ?? null)
        return
      }
      pageHistory.replaceState(data, unused, url)
      onCommittedAddress(currentPageAddress(pageLocation))
    },
  }
  const value: StorybookScopeAddress = Object.freeze({
    location,
    history,
    get address() {
      const current = committed ? new URL(pageLocation.href) : draft
      return `${current.pathname}${current.search}${current.hash}`
    },
    commit(mode) {
      if (committed) return
      const address = `${draft.pathname}${draft.search}${draft.hash}`
      if (mode === "push") pageHistory.pushState(null, "", address)
      else pageHistory.replaceState(null, "", address)
      committed = true
      onCommittedAddress(address)
    },
  })
  return value
}

/** Возвращает pathname, query и hash без origin для bounded rollback history. */
function currentPageAddress(location: Pick<Location, "href" | "pathname">): string {
  const url = new URL(location.href)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
Читает server-generated JSON target без исполнения HTML и выбора revision.

@throws При отсутствии exact script, неверном JSON или несовместимом target shape.
*/
function readInitialPageTarget(
  document: globalThis.Document,
): ExternalStorybookPreparedPageTarget {
  const script = document.getElementById("external-storybook-page-target")
  if (script === null || script.localName.toLowerCase() !== "script" || !script.textContent) {
    throw new Error("Storybook page has no initial target")
  }
  let value: unknown
  try { value = JSON.parse(script.textContent) } catch {
    throw new Error("Storybook initial page target is invalid JSON")
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Storybook initial page target must be an object")
  }
  const record = value as Record<string, unknown>
  if (record.kind === "landing" && typeof record.pathname === "string" &&
    typeof record.readerToken === "string") {
    return Object.freeze({kind: "landing", pathname: record.pathname, readerToken: record.readerToken})
  }
  if ((record.kind === "revision" || record.kind === "fallback") &&
    typeof record.packageId === "string" &&
    (typeof record.revision === "string" || record.revision === null) &&
    (typeof record.revisionUrl === "string" || record.revisionUrl === null) &&
    typeof record.route === "string" && typeof record.urlPath === "string" &&
    ["reader", "navigation-candidate", "preview"].includes(String(record.intent)) &&
    typeof record.preview === "boolean" && typeof record.readerToken === "string") {
    return Object.freeze({
      kind: record.kind,
      packageId: record.packageId,
      revision: record.revision,
      revisionUrl: record.revisionUrl,
      payloadUrl: typeof record.payloadUrl === "string" ? record.payloadUrl : null,
      route: record.route,
      urlPath: record.urlPath,
      intent: record.intent as ExternalStorybookPageIntent,
      preview: record.preview,
      initialAppliedRevision: typeof record.initialAppliedRevision === "string" ? record.initialAppliedRevision : null,
      fallbackRevision: typeof record.fallbackRevision === "string" ? record.fallbackRevision : null,
      readerToken: record.readerToken,
    })
  }
  throw new Error("Storybook initial page target has an invalid shape")
}

/**
Вызывает единственный server-owned resolver package target без выбора revision в runtime.

Для landing получает отдельный registry reader. Для package отправляет только
packageId, route и optional preview revision; built/active/last-working policy
остаётся на сервере.

@param fetcher - Same-origin transport текущего Storybook server.

@param input - Typed navigation intent из {@link ExternalStorybookPagePrepareInput}.

@param signal - Отменяет HTTP и запрещает использовать поздний target.

@returns Exact target с reader token и server-resolved URL.

@throws При ошибке transport, protocol или shape ответа.

@example
```ts
const target = await prepareExternalStorybookPageTarget(
  fetch,
  {packageId: "@webxr/markdown", route: "", intent: "navigation"},
  signal,
)
```
*/
export async function prepareExternalStorybookPageTarget(
  fetcher: typeof fetch,
  input: ExternalStorybookPagePrepareInput,
  signal: AbortSignal,
): Promise<ExternalStorybookPreparedPageTarget> {
  if (input.packageId === null) {
    const response = await fetcher("/api/browser/registry-session", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({}),
      signal,
    })
    if (!response.ok) throw new Error("Storybook registry reader prepare failed")
    const value = await response.json() as Record<string, unknown>
    if (value.protocol !== "storybook-registry-reader/1" || typeof value.readerToken !== "string") {
      throw new Error("Storybook registry reader response is invalid")
    }
    return Object.freeze({kind: "landing", pathname: input.route || "/", readerToken: value.readerToken})
  }
  const response = await fetcher("/api/browser/prepare", {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      packageId: input.packageId,
      route: input.route,
      previewRevision: input.intent === "preview" ? input.requestedRevision ?? null : null,
    }),
    signal,
  })
  if (!response.ok) throw new Error(`Storybook package prepare failed: ${input.packageId}`)
  const value = await response.json() as Record<string, unknown>
  if (value.protocol !== "storybook-package-prepare/1" || value.packageId !== input.packageId ||
    typeof value.revision !== "string" || typeof value.revisionUrl !== "string" ||
    typeof value.route !== "string" || typeof value.urlPath !== "string" ||
    !["reader", "navigation-candidate", "preview"].includes(String(value.intent)) ||
    typeof value.preview !== "boolean" || typeof value.readerToken !== "string") {
    throw new Error(`Storybook package prepare response is invalid: ${input.packageId}`)
  }
  return Object.freeze({
    kind: "revision",
    packageId: value.packageId,
    revision: value.revision,
    revisionUrl: value.revisionUrl,
    payloadUrl: typeof value.payloadUrl === "string" ? value.payloadUrl : null,
    route: value.route,
    urlPath: value.urlPath,
    intent: value.intent as ExternalStorybookPageIntent,
    preview: value.preview,
    initialAppliedRevision: typeof value.initialAppliedRevision === "string" ? value.initialAppliedRevision : null,
    fallbackRevision: typeof value.fallbackRevision === "string" ? value.fallbackRevision : null,
    readerToken: value.readerToken,
  })
}

/**
Откладывает создание final package socket до committed markers, bridge и кадра.

Listeners регистрируются сразу, поэтому scope не знает о задержке. `close()` до
`connect()` отменяет владение без открытия transport; после `connect()` adapter
прозрачно передаёт события exact socket.

@param create - Factory с уже выданным exact reader token.

@returns Socket-compatible adapter с однократным `connect()`.
*/
function createDeferredStorybookSocket(
  create: () => ExternalStorybookSocket,
): ExternalStorybookSocket & Readonly<{connect(): void}> {
  const listeners = new Map<string, Set<(event: any) => void>>()
  let socket: ExternalStorybookSocket | null = null
  let closed = false
  const deferred = {
    addEventListener(type: string, listener: (event: any) => void) {
      const values = listeners.get(type) ?? new Set()
      values.add(listener)
      listeners.set(type, values)
      socket?.addEventListener(type, listener)
    },
    removeEventListener(type: string, listener: (event: any) => void) {
      listeners.get(type)?.delete(listener)
      socket?.removeEventListener(type, listener)
    },
    send(data: string) {
      if (socket === null) throw new Error("Storybook package socket is not connected")
      socket.send(data)
    },
    close() {
      closed = true
      socket?.close()
      socket = null
    },
    connect() {
      if (closed || socket !== null) return
      socket = create()
      for (const [type, values] of listeners) {
        for (const listener of values) socket.addEventListener(type, listener)
      }
    },
  }
  return Object.freeze(deferred)
}
