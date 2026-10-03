/**
Показывает выбранный пакет и его подготовленную ревизию в существующей оболочке.
Владеет маршрутами документации, выбором и исполнением сценария, подпиской пакета
и освобождением его ресурсов при переходе. Новая ревизия сохраняет допустимый
выбор Inspector и сценария; ошибочная замена оставляет рабочее представление.

@packageDocumentation
*/
import WebProtocol from "@app-web/protocol"
import createHmrPage from "@hmr/page"
import createHmrConnection, {type HmrConnection} from "@hmr/connection"

import {createScenarioPresentation} from "./src/scenario-presentation.ts"
import {createScenarioRun} from "./src/scenario-run.ts"

import WebNavigationOwner from "@web/navigation"
const navigatePackage = WebNavigationOwner.navigatePackage
import ReadGraph from "@package-graph/read"
/** Вкладка структурного владельца с подготовленными сценариями. */

import type {CustomEvent} from "@zavx0z/dom"

import type {WebWorkbench} from "@web/workbench"
type WorkbenchPresentationUpdate = Parameters<WebWorkbench.Output["present"]>[0]

import createStorybookAgentBridge from "@web/agent-bridge"
import Revision from "@package/revision"
const deriveStorybookBreadcrumbs = WebNavigationOwner.deriveStorybookBreadcrumbs
const STORYBOOK_ROOT_BREADCRUMB = WebNavigationOwner.STORYBOOK_ROOT_BREADCRUMB
const deriveExternalStorybookPackageTab = WebNavigationOwner.deriveExternalStorybookPackageTab
import type {WebNavigation} from "@web/navigation"
type ExternalStorybookPackageTabModel = ReturnType<WebNavigation.Output["deriveExternalStorybookPackageTab"]>
import createExternalStorybookShell from "@page/shell"
import WebClientOwner from "@web/client"
const externalStorybookClientNode = WebClientOwner.externalStorybookClientNode
const fetchExternalStorybookClientSnapshot = WebClientOwner.fetchExternalStorybookClientSnapshot
const readExternalStorybookNodeDocumentation = WebClientOwner.readExternalStorybookNodeDocumentation
import type {PageShell} from "@page/shell"
type ExternalStorybookShell = PageShell.Output

type StorybookContractNavigationReady = NonNullable<Parameters<PageShell.Output["showContract"]>[3]>
import WebStatusOwner from "@web/status"
const packageBuildStatus = WebStatusOwner.packageBuild
const packageEventStatus = WebStatusOwner.packageEvent
const storybookConnectionStatus = WebStatusOwner.connection
const buildProgressStatus = WebStatusOwner.build
const catalogProgressStatus = WebStatusOwner.catalog
const readBuildProgress = WebStatusOwner.readBuild
const readCatalogProgress = WebStatusOwner.readCatalog
import type {PagePackage} from "./contract"
type StartExternalStorybookPackageInput = PagePackage.Input
type ExternalStorybookPackageController = PagePackage.Output
import type {ExternalStorybookClientSnapshot, StorybookPackageRevisionGraphSnapshot, ExternalStorybookScenarioLoader, ExternalStorybookAppliedRevision} from "./contract/types"
import type {ExternalStorybookClientPackageSummary, StorybookAgentBridge, ScrollableStorybookElement} from "./src/types"
import {STORYBOOK_PAGE_REALM_PROTOCOL, BUILTIN_INSPECTOR_WIDGETS, applyModel, sameWorkspaceAddress, packageRouteFromAddress, revisionClientSnapshot, exactAuthorStyleSheetSources, exactPackageSummary, validateScenarioLoaders, validateAppliedRevision, assertCompatibleAuthorStyleSheets, routeAvailable, isScrollableStorybookElement, exactBoundedText, createPackageSocket, parsePackageEvent, validateRevisionUrl, exactPackageId, safeRevision, overviewDescription, isolatePackageError, readBrowserSessionToken, readMetaContent, errorText, abortable, settleBefore, boundedCleanupTimeout, assertActive} from "./src/implementation"
export type {PagePackage} from './contract'

async function startExternalStorybookPackage(
  input: StartExternalStorybookPackageInput,
): Promise<ExternalStorybookPackageController> {
  const packageId = exactPackageId(input.packageId)
  const initialCandidateRevision = input.candidateRevision === null ? null : safeRevision(input.candidateRevision)
  validateRevisionUrl(packageId, initialCandidateRevision, input.revisionUrl)
  const environment = input.environment ?? {}
  const embeddedPageScope = environment.pageScope
  const browserDocument = environment.browserDocument ?? globalThis.document
  const location = environment.location ?? globalThis.location
  const history = environment.history ?? globalThis.history
  if (browserDocument === undefined || location === undefined || history === undefined) {
    throw new Error("External Storybook package browser environment is unavailable")
  }
  if (embeddedPageScope === undefined && browserDocument.defaultView !== null && browserDocument.defaultView !== undefined) {
    browserDocument.defaultView.name = `storybook:${packageId}`
  }
  if (embeddedPageScope === undefined) {
    browserDocument.documentElement.dataset.externalStorybook = "starting"
    browserDocument.documentElement.dataset.externalStorybookPackage = "starting"
    browserDocument.documentElement.dataset.externalStorybookPackageId = packageId
    browserDocument.documentElement.dataset.externalStorybookRevision = initialCandidateRevision ?? "unavailable"
  }
  browserDocument.documentElement.dataset.externalStorybookPhase = "snapshot"

  const fetcher = environment.fetcher ?? globalThis.fetch
  const initialRevisionGraph = input.graphSnapshot === undefined
    ? null
    : Revision.validate(input.graphSnapshot, packageId)
  const bootstrap = await (async () => {
    try {
      const navigationSnapshot = await fetchExternalStorybookClientSnapshot(fetcher)
      const snapshot = initialRevisionGraph === null
        ? navigationSnapshot
        : revisionClientSnapshot(initialRevisionGraph, initialCandidateRevision, input.revisionUrl, navigationSnapshot.projectName)
      const summary = exactPackageSummary(snapshot, packageId)
      if (initialCandidateRevision !== null &&
        summary.builtRevision !== initialCandidateRevision && summary.activatingRevision !== initialCandidateRevision &&
        summary.activeRevision !== initialCandidateRevision && summary.lastWorkingRevision !== initialCandidateRevision) {
        throw new Error(`External Storybook revision is not active or last-good, built, activating, or last-working: ${initialCandidateRevision}`)
      }
      const initialRoute = environment.pageScope?.initialRoute ?? packageRouteFromAddress(location.href, packageId, snapshot)
      return Object.freeze({
        navigationSnapshot,
        snapshot,
        summary,
        graph: snapshot,
        initialRoute,
        initialModel: deriveExternalStorybookPackageTab(snapshot, packageId, initialRoute),
      })
    } catch (error) {
      browserDocument.documentElement.dataset.externalStorybook = "error"
      browserDocument.documentElement.dataset.externalStorybookPackage = "error"
      browserDocument.documentElement.dataset.externalStorybookPhase = "error"
      browserDocument.documentElement.dataset.externalStorybookError = errorText(error).slice(0, 2_048)
      throw error
    }
  })()
  let {snapshot, summary, graph, navigationSnapshot} = bootstrap
  const {initialRoute, initialModel} = bootstrap
  let candidateRevision = initialCandidateRevision
  let revisionUrl = input.revisionUrl
  const sharedModuleEpoch = input.sharedModuleEpoch === undefined
    ? null
    : exactBoundedText(input.sharedModuleEpoch, 256, "shared module epoch")
  const hostModuleEpoch = input.hostModuleEpoch === undefined
    ? null
    : exactBoundedText(input.hostModuleEpoch, 256, "host module epoch")
  let scenarioLoaders = validateScenarioLoaders(input.scenarioLoaders, snapshot)
  let revisionGraph = initialRevisionGraph
  let currentPayload: ExternalStorybookAppliedRevision | null =
    candidateRevision === null || revisionUrl === null || revisionGraph === null || sharedModuleEpoch === null
      ? null
      : Object.freeze({
        protocol: STORYBOOK_PAGE_REALM_PROTOCOL,
        packageId,
        candidateRevision,
        revisionUrl,
        sharedModuleEpoch,
        ...(hostModuleEpoch === null ? {} : {hostModuleEpoch}),
        graphSnapshot: revisionGraph,

        scenarioLoaders,
      })
  browserDocument.documentElement.dataset.externalStorybookPhase = "shell"
  let shell: ExternalStorybookShell
  try {
    shell = embeddedPageScope?.shell ?? await createExternalStorybookShell({
      title: WebProtocol.pageTitle(packageId, initialModel.packageNode.label),
      browserDocument,
      ...(environment.shell ?? {}),
      authorStyleSheetSources: exactAuthorStyleSheetSources(
        browserDocument,
        revisionGraph,
        revisionUrl,
      ),
    })
  } catch (error) {
    const diagnostic = errorText(error)
    browserDocument.documentElement.dataset.externalStorybook = "error"
    browserDocument.documentElement.dataset.externalStorybookPackage = "error"
    browserDocument.documentElement.dataset.externalStorybookPhase = "error"
    browserDocument.documentElement.dataset.externalStorybookError = diagnostic.slice(0, 2_048)
    throw error
  }
  const lifetime = new AbortController()
  let routeAbort = new AbortController()
  let currentRoute = initialRoute
  let currentModel = initialModel
  let navigationRevision = 0
  let selectContractDirection: ((id: string) => void) | null = null
  let activePresentationView: WorkbenchPresentationUpdate | null = null
  let routeDiagnostics: unknown[] = []
  let operationTail: Promise<void> = Promise.resolve()
  let disposePromise: Promise<void> | null = null
  let agentBridge: StorybookAgentBridge | null = null
  let scenarioPresentation: ReturnType<typeof createScenarioPresentation> | null = null
  let stopScenarioSelection: (() => void) | null = null
  let restoringScenarioSelection = false
  const disposeScenario = (): void => {
    stopScenarioSelection?.()
    stopScenarioSelection = null
    scenarioPresentation?.dispose()
    scenarioPresentation = null
  }
  let reloadingFallback = false
  let disposed = false
  const publishInspectorRegistry = (): void => {
    shell.workbench.configureInspector(BUILTIN_INSPECTOR_WIDGETS)
  }

  /**
  Публикует единую текущую модель Preview и Inspector.

  Вкладка может ждать асинхронный owner view, поэтому перед его созданием
  публикуется пустое рабочее пространство. Последующие diagnostics и derived
  values изменяют только опубликованную модель и не восстанавливают секции
  предыдущего маршрута.
  */
  const publishPresentation = (
    next: WorkbenchPresentationUpdate,
    ownerPresentation = false,
  ): void => {
    const withChat: WorkbenchPresentationUpdate = Object.freeze({...next, chat: {
      address: currentModel.selectedNode.urlPath,
      label: currentModel.selectedNode.label,
      fetcher,
    }, inspectorSubject: next.inspectorSubject ?? {
      packageId,
      subjectId: currentModel.selectedNode.id,
      workspaceId: currentModel.urlPath,
      widgetIds: [],
    }})
    activePresentationView = withChat
    if (ownerPresentation) shell.present(withChat)
    else shell.workbench.present(withChat)
  }

  const refreshDiagnostics = (): void => {
    const current = activePresentationView
    if (current === null || !current.inspectorSubject?.widgetIds.includes("diagnostics")) return
    const next = Object.freeze({
      ...current,
      inspectorValues: Object.freeze({
        ...current.inspectorValues,
        diagnostics: Object.freeze([...routeDiagnostics]),
      }),
    })
    publishPresentation(next)
    shell.requestRender()
  }

  const reportDiagnostic = (value: unknown): void => {
    routeDiagnostics.push(value)
    refreshDiagnostics()
  }

  const showOverview = async (
    model: ExternalStorybookPackageTabModel,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> => {
    selectContractDirection = null
    const dependencies = model.viewKind === "dependencies"
    const contract = model.viewKind === "contract"
    const scenarios = model.viewKind === "scenarios"
    disposeScenario()
    const node = externalStorybookClientNode(snapshot, model.selectedNode.id)
    const documentation = contract || dependencies || scenarios ? null : await readExternalStorybookNodeDocumentation(node, fetcher)
    if (disposed || revision !== navigationRevision) return
    const label = scenarios ? `${node.label} · Сценарии` : contract ? `${node.label} · Контракт` : dependencies ? `${node.label} · Зависимости` : documentation === null ? `${node.label} · Обзор` : `${node.label} · TSDoc`
    const contractNavigators = new Map<
      Parameters<StorybookContractNavigationReady>[0],
      NonNullable<Parameters<StorybookContractNavigationReady>[1]>
    >()
    type ContractLocation = ReturnType<NonNullable<Parameters<StorybookContractNavigationReady>[1]>["locate"]>
    const contractLocationListeners = new Map<string, Set<(location: ContractLocation) => void>>()
    let contractViewport: Element | null = null
    const contractDirections = node.contractDocuments?.map(entry => entry.direction) ?? []
    const requestedDirection = new URL(location.href).searchParams.get("inspector")
    const initialDirection = contractDirections.find(direction => direction === requestedDirection)
      ?? (contractDirections.includes("input") ? "input" : contractDirections[0] ?? "input")
    const scenarioLoader = scenarios ? scenarioLoaders.get(node.id) : undefined
    if (scenarioLoader !== undefined) {
      const input = await abortable(scenarioLoader(), signal)
      if (disposed || revision !== navigationRevision || signal.aborted) return
      scenarioPresentation = createScenarioPresentation(shell.document, {
        ...input,
        run: createScenarioRun(fetcher, packageId, node.id, candidateRevision!),
      })
      restoreScenarioSelection()
      const app = scenarioPresentation.app
      let selectedId = app.getSnapshot().id
      stopScenarioSelection = app.subscribe(() => {
        if (restoringScenarioSelection) return
        if (selectedId === app.getSnapshot().id) return
        selectedId = app.getSnapshot().id
        const next = new URL(location.href)
        next.searchParams.set("variant", app.getSnapshot().title)
        history.pushState(null, "", `${next.pathname}${next.search}`)
      })
    }
    const presentationNode = scenarios
      ? scenarioPresentation?.element ?? shell.showMessage(label, "Сценарии", "Для этой спецификации пока нет подготовленного представления")
      : contract
      ? await shell.showContract(label, node.contractDocuments!, signal, (direction, navigation) => {
        if (navigation === null) contractNavigators.delete(direction)
        else contractNavigators.set(direction, navigation)
      }, () => {
        if (contractViewport === null) return
        for (const [direction, navigation] of contractNavigators) {
          const location = navigation.locate(contractViewport)
          for (const listener of contractLocationListeners.get(direction) ?? []) listener(location)
        }
      }, {
        initial: initialDirection,
        subscribe(listener) {
          const select = (id: string) => {
            const direction = id === "storybook-contract-input" ? "input"
              : id === "storybook-contract-output" ? "output"
              : id === "storybook-contract-slots" ? "slots" : null
            if (direction !== null && contractDirections.includes(direction)) listener(direction)
          }
          selectContractDirection = select
          return () => { if (selectContractDirection === select) selectContractDirection = null }
        },
      })
      : dependencies
      ? await shell.showDependencies(label, node.dependencyCases!, signal)
      : documentation === null
      ? shell.showMessage(label, node.label, overviewDescription(node.kind, node.childIds.length))
      : shell.showMarkdown(label, documentation, node.resourceUrl)
    contractViewport = presentationNode as unknown as Element
    const contractWidgets = contract
      ? Object.freeze((node.contractDocuments ?? []).map(({direction}) => `storybook-contract-${direction}`))
      : Object.freeze([])
    const contractValues = contract
      ? Object.freeze(Object.fromEntries((node.contractDocuments ?? []).map(entry => [
        `storybook-contract-${entry.direction}`,
        Object.freeze({
          ...entry,
          navigate: (declaration: string, path: readonly string[]) =>
            contractNavigators.get(entry.direction)?.navigate(declaration, path) ?? false,
          // Runtime передаёт тот же semantic Element через авторский lib.dom контракт.
          locate: () => contractNavigators.get(entry.direction)?.locate(presentationNode as unknown as Element) ?? null,
          subscribeLocation: (listener: (location: ContractLocation) => void) => {
            const listeners = contractLocationListeners.get(entry.direction) ?? new Set()
            contractLocationListeners.set(entry.direction, listeners)
            listeners.add(listener)
            return () => { listeners.delete(listener) }
          },
        }),
      ])))
      : null
    const next = Object.freeze({
      label,
      presentation: Object.freeze({node: presentationNode, projection: "display" as const}),
      inspectorSubject: scenarios && scenarioPresentation !== null
        ? Object.freeze({packageId, subjectId: node.id, workspaceId: `scenarios:${model.urlPath}`, widgetIds: Object.freeze(["storybook-scenarios"])})
        : contract
        ? Object.freeze({
          packageId,
          subjectId: node.id,
          workspaceId: `contract:${model.urlPath}`,
          widgetIds: contractWidgets,
        })
        : null,
      inspectorValues: scenarios ? Object.freeze(scenarioPresentation === null ? {} : {"storybook-scenarios": scenarioPresentation.app}) : contractValues ?? Object.freeze({diagnostics: Object.freeze([...routeDiagnostics])}),
    })
    publishPresentation(next, scenarioPresentation !== null)
    shell.requestRender()
  }

  const applyRoute = async (
    route: string,
    revision: number,
    signal: AbortSignal,
    failActivation = false,
  ): Promise<void> => {
    if (disposed) throw new Error("External Storybook package tab is disposed")
    const model = deriveExternalStorybookPackageTab(graph, packageId, route)
    if (revision !== navigationRevision || signal.aborted) return
    if (revision !== navigationRevision || signal.aborted) return
    currentRoute = route
    currentModel = model
    if (embeddedPageScope === undefined ||
      browserDocument.documentElement.dataset.externalStorybookPackageId === packageId) {
      browserDocument.documentElement.dataset.externalStorybookPackage = "starting"
      browserDocument.documentElement.dataset.externalStorybookRoute = route
    }
    applyModel(shell, model, navigationSnapshot, snapshot)
    shell.workbench.update("status", {
      lead: "",
      owner: packageId,
      detail: "",
      breadcrumbs: deriveStorybookBreadcrumbs(graph, model.selectedNode.id, {
        kind: "package",
        ancestors: revisionGraph?.ancestors ?? [],
      }),
    })
    routeDiagnostics = []
    publishPresentation(Object.freeze({
      label: model.selectedNode.label,
      presentation: Object.freeze({node: null, projection: "display" as const}),
      inspectorSubject: null,
      inspectorValues: Object.freeze({}),
    }), true)
    for (const diagnostic of summary.diagnostics) reportDiagnostic(diagnostic)
    for (const warning of summary.warnings ?? []) reportDiagnostic({...warning, severity: "warning"})
    try {
      if (candidateRevision === null && summary.buildState === "failed") {
        throw new Error(summary.diagnostics.map(({message}) => message).join("\n") ||
          `Package ${packageId} has no last-good revision`)
      }
      if (candidateRevision === null) {
        shell.showMessage(model.packageNode.label, "Нет применённой сборки", "Пакет станет доступен после успешной проверки и применения агентом.")
      } else {
        await showOverview(model, revision, signal)
      }
      if (disposed || revision !== navigationRevision || signal.aborted) return
      const beforeFrame = shell.presentedFrameSequence
      let frameSequence = shell.presentFrame()
      if (frameSequence <= beforeFrame) throw new Error("Storybook activation did not present a new frame")
      if (disposed || revision !== navigationRevision || signal.aborted) return
      restoreInspectorSelection()
      browserDocument.title = WebProtocol.pageTitle(packageId, model.packageNode.label)
      shell.workbench.element.setAttribute("aria-label", model.packageNode.label)
      if (browserDocument.defaultView !== null && browserDocument.defaultView !== undefined) {
        browserDocument.defaultView.name = `storybook:${packageId}`
      }
      delete browserDocument.documentElement.dataset.externalStorybookLanding
      browserDocument.documentElement.dataset.externalStorybookPackageId = packageId
      browserDocument.documentElement.dataset.externalStorybookRevision = candidateRevision ?? "unavailable"
      browserDocument.documentElement.dataset.externalStorybookRoute = route
      browserDocument.documentElement.dataset.externalStorybook = "ready"
      browserDocument.documentElement.dataset.externalStorybookPackage = "ready"
    } catch (error) {
      if (disposed || revision !== navigationRevision) return
      isolatePackageError(browserDocument, shell, model, error)
      if (failActivation) throw error
    }
  }

  const scheduleRoute = (
    route: string,
    failActivation = false,
    updateHistory = true,
  ): Promise<void> => {
    assertActive(disposed)
    const model = deriveExternalStorybookPackageTab(graph, packageId, route)
    if (updateHistory && !sameWorkspaceAddress(location.href, model.urlPath)) {
      const next = new URL(model.urlPath, location.href)
      const preview = new URL(location.href).searchParams.get("preview")
      if (preview !== null) next.searchParams.set("preview", preview)
      history.pushState(null, "", `${next.pathname}${next.search}`)
    }
    const revision = ++navigationRevision
    routeAbort.abort()
    routeAbort = new AbortController()
    const signal = routeAbort.signal
    const operation = operationTail
      .catch(() => {})
      .then(async () => {
        await applyRoute(route, revision, signal, failActivation)
        if (disposed) throw lifetime.signal.reason ?? new DOMException("Aborted", "AbortError")
      })
    operationTail = operation.catch(() => {})
    return operation
  }
  const navigate = async (route: string): Promise<void> => {
    await scheduleRoute(route)
  }

  /** Переводит internal contract widget id в стабильное имя URL. */
  const inspectorUrlId = (id: string): string => {
    if (id === "storybook-contract-input") return "input"
    if (id === "storybook-contract-output") return "output"
    if (id === "storybook-contract-slots") return "slots"
    return id
  }

  /**
  Восстанавливает выбор Inspector из query без повторного mount Preview.

  Неверное значение и отсутствие Inspector нормализуются через replaceState,
  чтобы URL всегда описывал реально выбранную либо пустую секцию.
  */
  const selectScenario = (value: string): void => {
    if (scenarioPresentation === null) throw new Error("На текущей странице нет сценариев")
    const app = scenarioPresentation.app
    const matches = app.variants.filter(variant => variant.id === value || variant.title === value)
    if (matches.length !== 1) throw new Error(`Неизвестный или неоднозначный вариант сценария: ${value}`)
    app.select(matches[0]!.id)
  }

  const restoreScenarioSelection = (): void => {
    if (scenarioPresentation === null) return
    const app = scenarioPresentation.app
    const url = new URL(location.href)
    const requested = url.searchParams.get("variant")
    const matches = app.variants.filter(variant => variant.title === requested)
    if (matches.length > 1) throw new Error(`Неоднозначное название варианта сценария: ${requested}`)
    const selected = matches[0] ?? app.variants[0]!
    restoringScenarioSelection = true
    try {
      app.select(selected.id)
    } finally {
      restoringScenarioSelection = false
    }
    if (requested !== null && requested !== selected.title) {
      url.searchParams.delete("variant")
      history.replaceState(null, "", `${url.pathname}${url.search}`)
    }
  }

  const restoreInspectorSelection = (): void => {
    const subject = shell.workbench.controller.read("inspector.subject")
    const current = new URL(location.href)
    const requested = current.searchParams.get("inspector")
    if (subject === null || subject.widgetIds.length === 0) {
      if (requested === null) return
      current.searchParams.delete("inspector")
      history.replaceState(null, "", `${current.pathname}${current.search}${current.hash}`)
      return
    }
    const selected = subject.widgetIds.find(id => inspectorUrlId(id) === requested)
      ?? (currentModel.viewKind === "contract" ? subject.widgetIds.find(id => inspectorUrlId(id) === "input") ?? subject.widgetIds[0] : null)
      ?? shell.workbench.controller.selectedInspector()
      ?? subject.widgetIds[0]!
    shell.workbench.controller.selectInspector(selected)
    selectContractDirection?.(selected)
    const normalized = inspectorUrlId(selected)
    if (requested === normalized) return
    current.searchParams.set("inspector", normalized)
    history.replaceState(null, "", `${current.pathname}${current.search}${current.hash}`)
  }

  const readScrollState = (): readonly Readonly<{
    element: ScrollableStorybookElement
    top: number
    left: number
  }>[] => {
    const elements: unknown[] = [
      shell.workbench.elements.catalogItems,
      shell.workbench.elements.tabItems,
      shell.workbench.elements.inspectorHost,
      activePresentationView?.presentation.node,
    ]
    const scrollable = elements.filter(isScrollableStorybookElement)
    return Object.freeze(scrollable.map(element => Object.freeze({
      element,
      top: element.scrollTop,
      left: element.scrollLeft,
    })))
  }

  const restoreScrollState = (
    state: readonly Readonly<{
      element: ScrollableStorybookElement
      top: number
      left: number
    }>[],
    presentation: Readonly<{top: number; left: number}> | null,
  ): void => {
    for (const item of state) {
      item.element.scrollTop = item.top
      item.element.scrollLeft = item.left
    }
    const node = activePresentationView?.presentation.node
    if (presentation !== null && node !== null && node !== undefined &&
      isScrollableStorybookElement(node)) {
      const scrollable = node
      scrollable.scrollTop = presentation.top
      scrollable.scrollLeft = presentation.left
    }
  }
  const disposeMountedExecution = async (_reason?: unknown): Promise<void> => { disposeScenario() }

  type RevisionBinding = Readonly<{
    candidateRevision: string | null
    revisionUrl: string | null

    scenarioLoaders: ReadonlyMap<string, ExternalStorybookScenarioLoader>
    revisionGraph: StorybookPackageRevisionGraphSnapshot | null
    snapshot: ExternalStorybookClientSnapshot
    summary: ExternalStorybookClientPackageSummary
    graph: ExternalStorybookClientSnapshot

    payload: ExternalStorybookAppliedRevision | null
  }>

  const readRevisionBinding = (): RevisionBinding => Object.freeze({
    candidateRevision,
    revisionUrl,

    scenarioLoaders,
    revisionGraph,
    snapshot,
    summary,
    graph,

    payload: currentPayload,
  })

  const writeRevisionBinding = (binding: RevisionBinding): void => {
    candidateRevision = binding.candidateRevision
    revisionUrl = binding.revisionUrl

    scenarioLoaders = binding.scenarioLoaders
    revisionGraph = binding.revisionGraph
    snapshot = binding.snapshot.projectName === navigationSnapshot.projectName
      ? binding.snapshot
      : Object.freeze({...binding.snapshot, projectName: navigationSnapshot.projectName})
    summary = binding.summary
    graph = snapshot

    currentPayload = binding.payload
    publishInspectorRegistry()
  }

  const prepareAppliedRevision = async (
    revision: string,
    signal: AbortSignal,
  ): Promise<RevisionBinding> => {
    if (environment.loadAppliedRevision === undefined) {
      throw new Error(`Storybook page has no identity-safe applied revision loader: ${packageId}:${revision}`)
    }
    const payload = validateAppliedRevision(
      await environment.loadAppliedRevision(revision, signal),
      packageId,
      revision,
    )
    signal.throwIfAborted()
    if (sharedModuleEpoch === null || payload.sharedModuleEpoch !== sharedModuleEpoch) {
      throw new Error(`Storybook platform update requires the page owner: ${packageId}:${revision}`)
    }
    const nextHostModuleEpoch = payload.hostModuleEpoch === undefined
      ? null
      : payload.hostModuleEpoch
    if (nextHostModuleEpoch !== hostModuleEpoch) {
      throw new Error(`Storybook host update requires the page owner: ${packageId}:${revision}`)
    }
    assertCompatibleAuthorStyleSheets(revisionGraph, payload.graphSnapshot)
    const nextSnapshot = revisionClientSnapshot(
      payload.graphSnapshot,
      payload.candidateRevision,
      payload.revisionUrl,
      navigationSnapshot.projectName,
    )
    const nextSummary = exactPackageSummary(nextSnapshot, packageId)
    signal.throwIfAborted()
    return Object.freeze({
      candidateRevision: payload.candidateRevision,
      revisionUrl: payload.revisionUrl,

      scenarioLoaders: payload.scenarioLoaders ?? new Map(),
      revisionGraph: payload.graphSnapshot,
      snapshot: nextSnapshot,
      summary: nextSummary,
      graph: nextSnapshot,

      payload,
    })
  }

  const localExecution = embeddedPageScope === undefined ? createHmrPage<RevisionBinding>({
    initial: readRevisionBinding(),
    release: () => disposeMountedExecution(),
    async restore(previous) { return previous },
  }) : null
  let appliedRevisionTail: Promise<void> = Promise.resolve()
  const applyPreparedRevision = async (next: RevisionBinding): Promise<void> => {
    if (localExecution === null) throw new Error("Package update belongs to the page owner")
    const previousRoute = currentRoute
    const scroll = readScrollState()
    const presentationScroll = activePresentationView?.presentation.node === scroll.at(-1)?.element
      ? Object.freeze({top: scroll.at(-1)!.top, left: scroll.at(-1)!.left})
      : null
    const stableScroll = presentationScroll === null ? scroll : scroll.slice(0, -1)
    await localExecution.replace(async () => next, async (binding, restored) => {
      routeAbort.abort(new DOMException("Storybook revision superseded", "AbortError"))
      const revision = ++navigationRevision
      routeAbort = new AbortController()
      writeRevisionBinding(binding)
      const route = restored || routeAvailable(binding.graph, packageId, previousRoute) ? previousRoute : ""
      await applyRoute(route, revision, routeAbort.signal, true)
      restoreScrollState(stableScroll, presentationScroll)
      browserDocument.documentElement.dataset.externalStorybookRevision = binding.candidateRevision ?? "unavailable"
      agentBridge?.updateIdentity(packageId, binding.candidateRevision ?? "unavailable", binding.snapshot.graphDigest)
      if (!restored) delete browserDocument.documentElement.dataset.externalStorybookUpdateError
    })
  }

  const applyRevision = (revision: string): Promise<void> => {
    const requested = safeRevision(revision)
    if (embeddedPageScope?.applyRevision !== undefined) return embeddedPageScope.applyRevision(requested)
    const operation = appliedRevisionTail
      .catch(() => {})
      .then(async () => {
        if (disposed || requested === candidateRevision) return
        shell.updateStatus("Пакет · Загрузка и проверка новой версии")
        const prepared = await prepareAppliedRevision(requested, lifetime.signal)
        if (disposed || lifetime.signal.aborted) return
        routeAbort.abort(new DOMException("Storybook applied revision is ready", "AbortError"))
        const swap = operationTail
          .catch(() => {})
          .then(async () => {
            shell.updateStatus("Пакет · Обновление содержимого страницы")
            await applyPreparedRevision(prepared)
            shell.updateStatus("Пакет · Обновление показано; проверка применения")
          })
        operationTail = swap.catch(() => {})
        await swap
      })
    appliedRevisionTail = operation.catch(() => {})
    return operation
  }

  /** Записывает user-selected Inspector section, сохраняя route и прочие query. */
  const onInspector = (event: unknown): void => {
    const id = (event as CustomEvent<{id?: unknown}>).detail?.id
    if (typeof id !== "string") return
    const subject = shell.workbench.controller.read("inspector.subject")
    if (subject === null || !subject.widgetIds.includes(id)) return
    const next = new URL(location.href)
    const value = inspectorUrlId(id)
    selectContractDirection?.(id)
    if (next.searchParams.get("inspector") === value) return
    next.searchParams.set("inspector", value)
    history.pushState(null, "", `${next.pathname}${next.search}${next.hash}`)
  }

  const followPageNavigation = (operation: Promise<void>): void => {
    delete browserDocument.documentElement.dataset.externalStorybookNavigationError
    void operation.catch(error => {
      if (disposed) return
      browserDocument.documentElement.dataset.externalStorybookNavigationError = errorText(error).slice(0, 4096)
      reportDiagnostic(error)
      shell.updateStatus("Storybook · Переход не выполнен; показана текущая страница")
    })
  }

  const onNavigate = (event: unknown): void => {
    const detail = (event as CustomEvent<{route: string; urlPath?: string; kind?: string; id?: string}>).detail
    if (detail.kind === "catalog" && detail.id !== undefined) {
      const node = externalStorybookClientNode(navigationSnapshot, detail.id)
      if (node.packageId === packageId) {
        const exact = externalStorybookClientNode(snapshot, node.id)
        void navigate(exact.routePath ?? "").catch(error => isolatePackageError(browserDocument, shell, currentModel, error))
      } else if (node.packageId !== null && embeddedPageScope !== undefined) {
        followPageNavigation(embeddedPageScope.navigatePackage({packageId: node.packageId, route: node.routePath ?? ""}))
      } else if (node.packageId !== null) {
        followPageNavigation(navigatePackage({packageId: node.packageId, route: node.routePath ?? ""}, environment.navigatePackage))
      } else if (embeddedPageScope !== undefined) {
        followPageNavigation(embeddedPageScope.navigateLanding(ReadGraph.browsePath(node)))
      } else if (environment.navigateLanding !== undefined) {
        followPageNavigation(environment.navigateLanding(ReadGraph.browsePath(node)))
      } else shell.reportDiagnostic("Storybook page controller is required for landing navigation")
      return
    }
    // Домашняя ссылка принадлежит Project; её identity отсутствует в package graph.
    if (detail.kind === "breadcrumb" && detail.id === STORYBOOK_ROOT_BREADCRUMB.id) {
      if (embeddedPageScope !== undefined) {
        followPageNavigation(embeddedPageScope.navigateLanding("/"))
      } else if (environment.navigateLanding !== undefined) {
        followPageNavigation(environment.navigateLanding("/"))
      } else shell.reportDiagnostic("Storybook page controller is required for landing navigation")
      return
    }
    if (detail.kind === "breadcrumb" && detail.id?.startsWith("package:") && detail.id !== `package:${packageId}`) {
      const nextPackageId = detail.id.slice("package:".length)
      if (embeddedPageScope !== undefined) {
        followPageNavigation(embeddedPageScope.navigatePackage({packageId: nextPackageId, route: ""}))
      } else followPageNavigation(navigatePackage({packageId: nextPackageId, route: ""}, environment.navigatePackage))
      return
    }
    if (detail.urlPath !== undefined) {
      if (embeddedPageScope !== undefined) {
        const node = externalStorybookClientNode(navigationSnapshot, detail.id!)
        if (node.packageId !== null) {
          followPageNavigation(embeddedPageScope.navigatePackage({packageId: node.packageId, route: node.routePath ?? ""}))
          return
        }
        followPageNavigation(embeddedPageScope.navigateLanding(detail.urlPath))
        return
      }
      if (environment.navigateLanding !== undefined) {
        followPageNavigation(environment.navigateLanding(detail.urlPath))
      } else shell.reportDiagnostic("Storybook page controller is required for landing navigation")
      return
    }
    const route = detail.route
    void navigate(route).catch((error) => isolatePackageError(browserDocument, shell, currentModel, error))
  }
  const onTab = (event: unknown): void => {
    const detail = (event as CustomEvent<{id: string; route: string}>).detail
    const item = currentModel.tabs.find(tab => tab.id === detail.id && tab.route === detail.route)
    if (item === undefined) {
      isolatePackageError(browserDocument, shell, currentModel, new Error(`Unknown Storybook tab: ${detail.id}`))
      return
    }
    void navigate(item.route).catch(error => isolatePackageError(browserDocument, shell, currentModel, error))
  }
  const onPopState = (): void => {
    try {
      const route = packageRouteFromAddress(location.href, packageId, graph)
      if (route === currentRoute) {
        restoreInspectorSelection()
        restoreScenarioSelection()
        return
      }
      void scheduleRoute(route)
    } catch (error) {
      isolatePackageError(browserDocument, shell, currentModel, error)
    }
  }
  shell.workbench.element.addEventListener(shell.workbench.events.navigate, onNavigate)
  shell.workbench.element.addEventListener(shell.workbench.events.tab, onTab)
  shell.workbench.element.addEventListener(shell.workbench.events.inspector, onInspector)
  const browserWindow = browserDocument.defaultView ?? globalThis
  if (embeddedPageScope === undefined) browserWindow.addEventListener?.("popstate", onPopState)

  const socket = environment.socket ?? createPackageSocket(
    environment,
    location.href,
    readBrowserSessionToken(browserDocument),
  )
  let latestBuildGeneration = 0
  let packageBuildActive = false
  let packageBuildStatusText = "Пакет · Ожидание очереди сборки"
  let readerIntent = environment.bootstrapIntent ??
    (new URL(location.href).searchParams.has("preview") ? "preview" : "reader")
  let observedApplied = environment.initialAppliedRevision ??
    (readMetaContent(browserDocument, "external-storybook-applied-revision") || null)
  // Пересозданный scope кандидата не откатывается по первому сообщению о прежней рабочей версии.
  if (embeddedPageScope !== undefined && readerIntent === "reader" &&
    candidateRevision !== null && candidateRevision !== observedApplied) {
    readerIntent = "navigation-candidate"
  }
  shell.updateStatus(storybookConnectionStatus("connecting"))
  const followApplied = (revision: string | null, initial: boolean): void => {
    if (disposed) return
    if (revision === null) {
      shell.updateStatus(candidateRevision === null
        ? "Пакет · Сборка недоступна"
        : "Пакет · Кандидат готов; проверка отображения")
      return
    }
    const url = new URL(location.href)
    if ((readerIntent === "preview" || initial && readerIntent === "navigation-candidate") && revision !== candidateRevision) {
      shell.updateStatus("Пакет · Кандидат готов; ожидание проверки и применения")
      return
    }
    url.searchParams.delete("preview")
    history.replaceState(null, "", `${url.pathname}${url.search}`)
    if (revision === candidateRevision) {
      observedApplied = revision
      readerIntent = "reader"
      embeddedPageScope?.revisionConfirmed(revision)
      shell.updateStatus("Пакет · Текущая версия готова")
      return
    }
    void applyRevision(revision).then(() => {
      if (disposed) return
      observedApplied = revision
      shell.updateStatus("Пакет · Текущая версия готова")
    }).catch(error => {
      if (disposed) return
      reportDiagnostic(error)
      browserDocument.documentElement.dataset.externalStorybookUpdateError = errorText(error).slice(0, 2_048)
      shell.updateStatus("Пакет · Обновление отклонено")
    })
  }
  /** Project меняет имя независимо от package revision; его metadata обновляется без замены содержимого. */
  const applyNavigationSnapshot = (value: ExternalStorybookClientSnapshot): void => {
    navigationSnapshot = value
    if (snapshot.projectName !== value.projectName) {
      snapshot = Object.freeze({...snapshot, projectName: value.projectName})
      graph = snapshot
    }
    applyModel(shell, currentModel, navigationSnapshot, snapshot)
  }
  const onSocketOpen = (socket: HmrConnection.Input["socket"], reconnecting: boolean): void => {
    latestBuildGeneration = 0
    socket.send(JSON.stringify({type: "subscribe", topic: `package:${packageId}`}))
    socket.send(JSON.stringify({type: "subscribe", topic: "catalog"}))
    if (!reconnecting) {
      shell.updateStatus(storybookConnectionStatus("connected"))
      return
    }
    shell.updateStatus(storybookConnectionStatus("reconnected"))
    void fetchExternalStorybookClientSnapshot(fetcher).then(value => {
      if (disposed) return
      applyNavigationSnapshot(value)
      shell.updateStatus(packageBuildStatus(packageId, exactPackageSummary(value, packageId).buildState))
    }).catch(error => shell.reportDiagnostic(errorText(error)))
  }
  const onSocketMessage = (event: MessageEvent): void => {
    if (disposed) return
    let raw: {type?: string; packageId?: string; revision?: string | null} | null = null
    try { raw = JSON.parse(String(event.data)) } catch {}
    if (raw?.type === "shared.updated") {
      void embeddedPageScope?.refreshSharedHost?.().catch(error => {
        if (disposed) return
        reportDiagnostic(error)
        shell.updateStatus("Обновление общей оболочки отклонено; сохранена рабочая версия")
      })
      return
    }
    const progress = readBuildProgress(raw)
    if (progress !== null && progress.packageId === null) {
      shell.updateStatus(packageBuildActive && progress.state === "completed" && progress.outcome === "completed"
        ? packageBuildStatusText
        : buildProgressStatus(progress))
      return
    }
    if (progress !== null && progress.packageId === packageId) {
      const generation = progress.generation ?? 0
      if (generation >= latestBuildGeneration) {
        latestBuildGeneration = generation
        packageBuildActive = progress.state !== "completed"
        packageBuildStatusText = buildProgressStatus(progress)
        shell.updateStatus(packageBuildStatusText)
      }
      return
    }
    const catalogProgress = readCatalogProgress(raw)
    if (catalogProgress !== null) {
      shell.updateStatus(packageBuildActive && catalogProgress.state === "completed"
        ? packageBuildStatusText
        : catalogProgressStatus(catalogProgress))
      return
    }
    if (raw?.type === "package.applied-state" && raw.packageId === packageId) {
      followApplied(raw.revision ?? null, true)
      return
    }
    if (raw?.type === "registry.updated") {
      void fetchExternalStorybookClientSnapshot(fetcher).then(value => {
        if (disposed) return
        applyNavigationSnapshot(value)
      }).catch(error => shell.reportDiagnostic(errorText(error)))
      return
    }
    const update = parsePackageEvent(event.data)
    if (update === null || update.packageId !== packageId) return
    if (update.type === "package.built") {
      shell.updateStatus(packageEventStatus(packageId, update.type))
      return
    }
    if (update.type === "package.activating") {
      shell.updateStatus(packageEventStatus(packageId, update.type))
      return
    }
    if (update.type === "package.updated") {
      shell.updateStatus(packageEventStatus(packageId, update.type))
      followApplied(update.revision, false)
      return
    }
    if (update.type === "package.resources-updated" || update.type === "package.metadata-updated") {
      shell.updateStatus(packageEventStatus(packageId, update.type))
      return
    }
    if (update.type === "package.code-updated") {
      shell.updateStatus(packageEventStatus(packageId, update.type))
      return
    }
    if (update.type === "package.failed") {
      const fallbackRevision = environment.fallbackRevision ??
        readMetaContent(browserDocument, "external-storybook-fallback-revision")
      if (update.revision === candidateRevision && fallbackRevision !== undefined &&
        fallbackRevision !== candidateRevision && !reloadingFallback) {
        reloadingFallback = true
        routeAbort.abort(new Error(`Storybook candidate activation failed: ${candidateRevision}`))
        void applyRevision(fallbackRevision).then(() => {
          observedApplied = fallbackRevision
          reloadingFallback = false
        }).catch(error => {
          reloadingFallback = false
          reportDiagnostic(error)
          browserDocument.documentElement.dataset.externalStorybookUpdateError = errorText(error).slice(0, 2_048)
        })
        return
      }
      for (const diagnostic of update.diagnostics) reportDiagnostic(diagnostic)
      shell.updateStatus(packageEventStatus(packageId, update.type))
      return
    }
    reportDiagnostic(`Package detached: ${packageId}`)
    shell.updateStatus(packageEventStatus(packageId, update.type))
  }
  const connection = createHmrConnection({
    socket,
    onOpen: onSocketOpen,
    onMessage: onSocketMessage,
    onClose() { shell.updateStatus(storybookConnectionStatus("disconnected")) },
    async reconnect(signal) {
      const response = await fetcher("/api/browser/session", {
        method: "POST", headers: {"content-type": "application/json"},
        body: JSON.stringify({
          packageId,
          revision: candidateRevision,
          preview: readerIntent === "preview" || readerIntent === "navigation-candidate",
        }), signal,
      })
      if (!response.ok) throw new Error("Package event session is unavailable")
      const result = await response.json() as {token?: string}
      signal.throwIfAborted()
      if (typeof result.token !== "string") throw new Error("Invalid package event session")
      embeddedPageScope?.readerRenewed?.(result.token)
      return createPackageSocket(environment, location.href, result.token)
    },
  })

  const dispose = async (reason?: unknown): Promise<void> => {
    if (disposePromise !== null) return disposePromise
    disposed = true
    navigationRevision += 1
    lifetime.abort(reason)
    routeAbort.abort()
    connection.dispose()
    if (embeddedPageScope === undefined) browserWindow.removeEventListener?.("popstate", onPopState)
    if (embeddedPageScope === undefined) globalThis.removeEventListener?.("pagehide", onPageHide)
    environment.lifecycleSignal?.removeEventListener("abort", onPageHide)
        shell.workbench.element.removeEventListener(shell.workbench.events.navigate, onNavigate)
        shell.workbench.element.removeEventListener(shell.workbench.events.tab, onTab)
        shell.workbench.element.removeEventListener(shell.workbench.events.inspector, onInspector)
    const cleanupTimeoutMs = boundedCleanupTimeout(environment.cleanupTimeoutMs ?? 5_000)
    disposePromise = (async () => {
      try {
        const deadline = Date.now() + cleanupTimeoutMs
        await settleBefore(appliedRevisionTail, deadline)
        await settleBefore(operationTail, deadline)
      } finally {
        await localExecution?.dispose()
        disposeScenario()
        agentBridge?.dispose()
        if (embeddedPageScope === undefined) shell.dispose()
      }
    })()
    return disposePromise
  }
  const onPageHide = (): void => { void dispose(environment.lifecycleSignal?.reason) }
  if (embeddedPageScope === undefined) globalThis.addEventListener?.("pagehide", onPageHide, {once: true})
  environment.lifecycleSignal?.addEventListener("abort", onPageHide, {once: true})
  if (environment.lifecycleSignal?.aborted === true) onPageHide()

  const canonicalInitial = currentModel.urlPath
  if (embeddedPageScope === undefined && !sameWorkspaceAddress(location.href, canonicalInitial)) {
    const next = new URL(location.href)
    const canonical = new URL(canonicalInitial, location.href)
    next.pathname = canonical.pathname
    next.searchParams.delete("view")
    const view = canonical.searchParams.get("view")
    if (view !== null) next.searchParams.set("view", view)
    history.replaceState(null, "", `${next.pathname}${next.search}`)
  }
  try {
    publishInspectorRegistry()
    browserDocument.documentElement.dataset.externalStorybookPhase = "route"
    await scheduleRoute(currentRoute, true, embeddedPageScope === undefined)
    browserDocument.documentElement.dataset.externalStorybookPhase = "bridge"
    if (embeddedPageScope === undefined) agentBridge = createStorybookAgentBridge({
      packageId,
      revision: candidateRevision ?? "unavailable",
      graphDigest: snapshot.graphDigest,
      shell,
      getRoute: () => currentRoute,
      getModel: () => currentModel,
      navigate,
      selectScenario,
      applyRevision,
      canApplyRevision: () => environment.loadAppliedRevision !== undefined && sharedModuleEpoch !== null && /^[a-f0-9]{64}$/u.test(sharedModuleEpoch),
    })
    browserDocument.documentElement.dataset.externalStorybookPhase = "ready"
  } catch (error) {
    browserDocument.documentElement.dataset.externalStorybookPhase = "error"
    if (embeddedPageScope !== undefined) {
      await dispose(error)
      throw error
    }
    if (disposed) {
      await dispose(environment.lifecycleSignal?.reason)
      throw lifetime.signal.reason ?? error
    }
    if (!reloadingFallback) {
      if (embeddedPageScope === undefined) agentBridge ??= createStorybookAgentBridge({
        packageId,
        revision: candidateRevision ?? "unavailable",
        graphDigest: snapshot.graphDigest,
        shell,
        getRoute: () => currentRoute,
        getModel: () => currentModel,
        navigate,
        selectScenario,
        applyRevision,
        canApplyRevision: () => environment.loadAppliedRevision !== undefined && sharedModuleEpoch !== null && /^[a-f0-9]{64}$/u.test(sharedModuleEpoch),
      })
    }
  }

  return Object.freeze({
    get snapshot() {
      return snapshot
    },
    shell,
    packageId,
    get revision() {
      return candidateRevision
    },
    get graphDigest() {
      return snapshot.graphDigest
    },
    get currentRoute() {
      return currentRoute
    },
    get currentModel() {
      return currentModel
    },
    navigate,
    selectScenario,
    restoreAddress() {
      restoreInspectorSelection()
      restoreScenarioSelection()
    },
    applyRevision,
    canApplyRevision: () => environment.loadAppliedRevision !== undefined && sharedModuleEpoch !== null && /^[a-f0-9]{64}$/u.test(sharedModuleEpoch),
    dispose,
  })
}

export default Object.assign(startExternalStorybookPackage, {protocol: STORYBOOK_PAGE_REALM_PROTOCOL})
