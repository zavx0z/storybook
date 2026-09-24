import {ScenarioInspector} from "@storybook/app/inspector"
import type {ScenarioAppInput} from "@storybook/app/contract/input"
import {createScenarioPresentation} from "./scenario-presentation"
import {createScenarioRun} from "./scenario-run"
import {indexedWorkbenchAuthorStyleSheetSources} from "./author-style-sheets.ts"
import {navigatePackage} from "./package-navigation.ts"
import {externalStorybookBrowsePath} from "../catalog/graph.ts"
/** Вкладка структурного владельца с подготовленными сценариями. */

import type {CustomEvent} from "@zavx0z/dom"
import type {RootLinkedAuthorStyleSheet} from "@zavx0z/browser/integration"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {arrowDownIcon, arrowUpIcon} from "@zavx0z/ui/themes/icons"
import {
  WORKBENCH_EVENTS,
  type WorkbenchInspectorCustomWidgetProps,
  type WorkbenchInspectorCustomWidgetRegistration,
  type WorkbenchPresentationUpdate,
} from "../workbench/contract.ts"
import {WORKBENCH_STANDARD_WIDGET_REGISTRY} from "../workbench/inspector/registry.ts"
import {externalStorybookPageTitle} from "./page-title.ts"
import {createStorybookAgentBridge, type StorybookAgentBridge} from "./agent-bridge.ts"
import {
  encodeExternalStorybookPackagePath,
  EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
  type ExternalStorybookClientPackageSummary,
  type ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"
import {
  validateStorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionGraphSnapshot,
} from "../sessions/package-revision.ts"
import {deriveStorybookBreadcrumbs} from "./breadcrumbs.ts"
import {
  deriveExternalStorybookPackageTab,
  deriveExternalStorybookNavigationTree,
  type ExternalStorybookBrowserNavigationItem,
  type ExternalStorybookBrowserTabItem,
  type ExternalStorybookPackageTabModel,
} from "./model.ts"
import {
  createExternalStorybookShell,
  externalStorybookClientNode,
  fetchExternalStorybookClientSnapshot,
  readExternalStorybookNodeReadme,
  type CreateExternalStorybookShellOptions,
  type ExternalStorybookShell,
} from "./shell.ts"
import {StorybookContractOutline} from "./contract-outline.tsx"
import type {StorybookContractNavigationReady} from "./contract-view.tsx"
import {packageBuildStatus, packageEventStatus, storybookConnectionStatus} from "./package-status.ts"
import {
  buildProgressStatus,
  catalogProgressStatus,
  readBuildProgress,
  readCatalogProgress,
  readSharedCacheProgress,
  sharedCacheProgressStatus,
} from "./build-progress.ts"

export type ExternalStorybookScenarioLoader = () => Promise<ScenarioAppInput>

export const STORYBOOK_PAGE_REALM_PROTOCOL = "storybook-page-realm/1" as const

/** Immutable executable payload prepared for an in-page applied revision swap. */
export type ExternalStorybookAppliedRevision = Readonly<{
  protocol: typeof STORYBOOK_PAGE_REALM_PROTOCOL
  packageId: string
  candidateRevision: string
  revisionUrl: string
  sharedModuleEpoch: string
  hostModuleEpoch?: string
  startPackage?: typeof startExternalStorybookPackage
  graphSnapshot: StorybookPackageRevisionGraphSnapshot

  scenarioLoaders?: ReadonlyMap<string, ExternalStorybookScenarioLoader>
}>

export type ExternalStorybookSocket = Readonly<{
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  send(data: string): void
  close(): void
}>

type ScrollableStorybookElement = {
  scrollTop: number
  scrollLeft: number
}

const BUILTIN_INSPECTOR_WIDGETS = Object.freeze([
  Object.freeze({
    id: "storybook-scenarios",
    kind: "custom" as const,
    label: "С",
    title: "Сценарии",
    wrapInPanel: false,
    component: ScenarioInspector as unknown as CompiledTemplate<WorkbenchInspectorCustomWidgetProps>,
  }),
  Object.freeze({
    id: "storybook-contract-input",
    kind: "custom" as const,
    label: "В",
    title: "Вход",
    wrapInPanel: false,
    iconSrc: arrowDownIcon,
    component: StorybookContractOutline as unknown as CompiledTemplate<WorkbenchInspectorCustomWidgetProps>,
  }),
  Object.freeze({
    id: "storybook-contract-output",
    kind: "custom" as const,
    label: "В",
    title: "Выход",
    wrapInPanel: false,
    iconSrc: arrowUpIcon,
    component: StorybookContractOutline as unknown as CompiledTemplate<WorkbenchInspectorCustomWidgetProps>,
  }),
] as const satisfies readonly WorkbenchInspectorCustomWidgetRegistration[])

export type ExternalStorybookPackageEnvironment = Readonly<{
  fetcher?: typeof fetch
  browserDocument?: globalThis.Document
  location?: Pick<Location, "pathname" | "href" | "reload">
  history?: Pick<History, "pushState" | "replaceState">
  createSocket?(url: string): ExternalStorybookSocket
  navigatePackage?(input: Readonly<{packageId: string; route: string}>): Promise<void>
  navigateLanding?(pathname: string): Promise<void>
  /** Already authenticated pending socket transferred by the page controller at commit. */
  socket?: ExternalStorybookSocket
  bootstrapIntent?: "reader" | "navigation-candidate" | "preview"
  initialAppliedRevision?: string | null
  fallbackRevision?: string | null
  shell?: Omit<
    CreateExternalStorybookShellOptions,
    "title" | "browserDocument" | "authorStyleSheetSources"
  >
  /** Focused lifecycle cancellation seam; browser production also uses pagehide. */
  lifecycleSignal?: AbortSignal
  /** Focused cleanup seam; production bounds uncooperative owner cleanup. */
  cleanupTimeoutMs?: number
  /** Loads a payload whose executable imports share this page's exact platform module identities. */
  loadAppliedRevision?(
    revision: string,
    signal: AbortSignal,
  ): Promise<ExternalStorybookAppliedRevision>
  /** Page-owned shell and cross-package transition used by one replaceable package scope. */
  pageScope?: Readonly<{
    shell: ExternalStorybookShell
    initialRoute: string
    navigatePackage(input: Readonly<{packageId: string; route: string}>): Promise<void>
    navigateLanding(pathname: string): Promise<void>
    applyRevision?(revision: string): Promise<void>
    revisionApplied(payload: ExternalStorybookAppliedRevision): void
    revisionConfirmed(revision: string): void
  }>
}>

export type StartExternalStorybookPackageInput = Readonly<{
  packageId: string
  candidateRevision: string | null
  revisionUrl: string | null
  /** Digest of the stable platform/Storybook ESM owner set loaded by this page. */
  sharedModuleEpoch?: string
  /** Digest of the Storybook host implementation bound into the retained shell. */
  hostModuleEpoch?: string

  scenarioLoaders?: ReadonlyMap<string, ExternalStorybookScenarioLoader>
  graphSnapshot?: StorybookPackageRevisionGraphSnapshot
  environment?: ExternalStorybookPackageEnvironment
}>

export type ExternalStorybookPackageController = Readonly<{
  readonly snapshot: ExternalStorybookClientSnapshot
  shell: ExternalStorybookShell
  readonly packageId: string
  readonly revision: string | null
  readonly graphDigest: string
  get currentRoute(): string
  get currentModel(): ExternalStorybookPackageTabModel
  navigate(route: string): Promise<void>
  selectScenario(value: string): void
  restoreAddress(): void
  applyRevision(revision: string): Promise<void>
  canApplyRevision(): boolean
  dispose(): Promise<void>
}>

export async function startExternalStorybookPackage(
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
    : validateStorybookPackageRevisionGraphSnapshot(input.graphSnapshot, packageId)
  const bootstrap = await (async () => {
    try {
      const snapshot = initialRevisionGraph === null
        ? await fetchExternalStorybookClientSnapshot(fetcher)
        : revisionClientSnapshot(initialRevisionGraph, initialCandidateRevision, input.revisionUrl)
      const summary = exactPackageSummary(snapshot, packageId)
      if (initialCandidateRevision !== null &&
        summary.builtRevision !== initialCandidateRevision && summary.activatingRevision !== initialCandidateRevision &&
        summary.activeRevision !== initialCandidateRevision && summary.lastWorkingRevision !== initialCandidateRevision) {
        throw new Error(`External Storybook revision is not active or last-good, built, activating, or last-working: ${initialCandidateRevision}`)
      }
      const initialRoute = environment.pageScope?.initialRoute ?? packageRouteFromAddress(location.href, packageId, snapshot)
      return Object.freeze({
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
  let {snapshot, summary, graph} = bootstrap
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
  let navigationSnapshot = revisionGraph === null ? snapshot : await fetchExternalStorybookClientSnapshot(fetcher)
  browserDocument.documentElement.dataset.externalStorybookPhase = "shell"
  let shell: ExternalStorybookShell
  try {
    shell = embeddedPageScope?.shell ?? await createExternalStorybookShell({
      title: externalStorybookPageTitle(packageId, initialModel.packageNode.label),
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
  let stopScenarioCentering = () => {}
  const disposeScenario = (): void => {
    stopScenarioCentering()
    stopScenarioCentering = () => {}
    stopScenarioSelection?.()
    stopScenarioSelection = null
    scenarioPresentation?.dispose()
    scenarioPresentation = null
  }
  let reloadingFallback = false
  let disposed = false
  const publishInspectorRegistry = (): void => {
    shell.workbench.update("inspector.registry", Object.freeze([...WORKBENCH_STANDARD_WIDGET_REGISTRY, ...BUILTIN_INSPECTOR_WIDGETS]))
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
    activePresentationView = next
    if (ownerPresentation) shell.present(next)
    else shell.workbench.present(next)
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
    const readme = contract || dependencies || scenarios ? null : await readExternalStorybookNodeReadme(node, fetcher)
    if (disposed || revision !== navigationRevision) return
    const label = scenarios ? `${node.label} · Сценарии` : contract ? `${node.label} · Контракт` : dependencies ? `${node.label} · Зависимости` : readme === null ? `${node.label} · Обзор` : `${node.label} · ${node.hasModuleDocumentation ? "TSDoc" : "README"}`
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
            const direction = id === "storybook-contract-output" ? "output" : "input"
            if (contractDirections.includes(direction)) listener(direction)
          }
          selectContractDirection = select
          return () => { if (selectContractDirection === select) selectContractDirection = null }
        },
      })
      : dependencies
      ? await shell.showDependencies(label, node.dependencyCases!, signal)
      : readme === null
      ? shell.showMessage(label, node.label, overviewDescription(node.kind, node.childIds.length))
      : shell.showMarkdown(label, readme, node.resourceUrl)
    contractViewport = presentationNode as unknown as Element
    const contractWidgets = contract
      ? Object.freeze((node.contractDocuments ?? []).map(({direction}) =>
        direction === "input" ? "storybook-contract-input" : "storybook-contract-output"))
      : Object.freeze([])
    const contractValues = contract
      ? Object.freeze(Object.fromEntries((node.contractDocuments ?? []).map(entry => [
        entry.direction === "input" ? "storybook-contract-input" : "storybook-contract-output",
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
    if (scenarioPresentation !== null) {
      const mounted = scenarioPresentation
      stopScenarioCentering = shell.root.getProjection(shell.display).subscribeFrames(() => {
        if (mounted.center()) shell.requestRender()
      })
    }
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
      browserDocument.title = externalStorybookPageTitle(packageId, model.packageNode.label)
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
    snapshot = binding.snapshot
    summary = binding.summary
    graph = binding.graph

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
      throw new Error(`Storybook shared module epoch changed; page restart is required: ${packageId}:${revision}`)
    }
    const nextHostModuleEpoch = payload.hostModuleEpoch === undefined
      ? null
      : payload.hostModuleEpoch
    if (nextHostModuleEpoch !== hostModuleEpoch) {
      throw new Error(`Storybook host module epoch changed; page restart is required: ${packageId}:${revision}`)
    }
    assertCompatibleAuthorStyleSheets(revisionGraph, payload.graphSnapshot)
    const nextSnapshot = revisionClientSnapshot(
      payload.graphSnapshot,
      payload.candidateRevision,
      payload.revisionUrl,
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

  let appliedRevisionTail: Promise<void> = Promise.resolve()
  const applyPreparedRevision = async (next: RevisionBinding): Promise<void> => {
    const previous = readRevisionBinding()
    const previousRoute = currentRoute
    const scroll = readScrollState()
    const presentationScroll = activePresentationView?.presentation.node === scroll.at(-1)?.element
      ? Object.freeze({top: scroll.at(-1)!.top, left: scroll.at(-1)!.left})
      : null
    const stableScroll = presentationScroll === null ? scroll : scroll.slice(0, -1)
    const nextRoute = routeAvailable(next.graph, packageId, previousRoute) ? previousRoute : ""
    const reason = new DOMException("Storybook revision superseded", "AbortError")
    routeAbort.abort(reason)
    const revision = ++navigationRevision
    routeAbort = new AbortController()
    await disposeMountedExecution(reason)
    writeRevisionBinding(next)
    try {
      await applyRoute(nextRoute, revision, routeAbort.signal, true)
      restoreScrollState(stableScroll, presentationScroll)
      candidateRevision = next.candidateRevision
      browserDocument.documentElement.dataset.externalStorybookRevision = next.candidateRevision ?? "unavailable"
      delete browserDocument.documentElement.dataset.externalStorybookUpdateError
      agentBridge?.updateIdentity(packageId, next.candidateRevision ?? "unavailable", next.snapshot.graphDigest)
      if (next.payload !== null) embeddedPageScope?.revisionApplied(next.payload)
    } catch (error) {
      await disposeMountedExecution(error)
      writeRevisionBinding(previous)
      const rollbackRevision = ++navigationRevision
      routeAbort.abort(error)
      routeAbort = new AbortController()
      try {
        await applyRoute(previousRoute, rollbackRevision, routeAbort.signal, true)
        restoreScrollState(stableScroll, presentationScroll)
        browserDocument.documentElement.dataset.externalStorybookRevision = previous.candidateRevision ?? "unavailable"
        agentBridge?.updateIdentity(packageId, previous.candidateRevision ?? "unavailable", previous.snapshot.graphDigest)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], `Storybook failed to restore revision ${previous.candidateRevision}`)
      }
      throw error
    }
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
        followPageNavigation(embeddedPageScope.navigateLanding(externalStorybookBrowsePath(node)))
      } else if (environment.navigateLanding !== undefined) {
        followPageNavigation(environment.navigateLanding(externalStorybookBrowsePath(node)))
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
  shell.workbench.element.addEventListener(WORKBENCH_EVENTS.navigate, onNavigate)
  shell.workbench.element.addEventListener(WORKBENCH_EVENTS.tab, onTab)
  shell.workbench.element.addEventListener(WORKBENCH_EVENTS.inspector, onInspector)
  const browserWindow = browserDocument.defaultView ?? globalThis
  if (embeddedPageScope === undefined) browserWindow.addEventListener?.("popstate", onPopState)

  let socket = environment.socket ?? createPackageSocket(
    environment,
    location.href,
    readBrowserSessionToken(browserDocument),
  )
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = 250
  let latestBuildGeneration = 0
  let packageBuildActive = false
  let packageBuildStatusText = "Пакет · Ожидание очереди сборки"
  let reconnecting = false
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
      shell.updateStatus("Пакет · Нет применённой сборки; ожидание проверки и применения")
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
      observedApplied = revision
      shell.updateStatus("Пакет · Текущая версия готова")
    }).catch(error => {
      reportDiagnostic(error)
      browserDocument.documentElement.dataset.externalStorybookUpdateError = errorText(error).slice(0, 2_048)
      shell.updateStatus("Пакет · Обновление отклонено")
    })
  }
  const onSocketOpen = (): void => {
    latestBuildGeneration = 0
    reconnectDelay = 250
    socket.send(JSON.stringify({type: "subscribe", topic: `package:${packageId}`}))
    socket.send(JSON.stringify({type: "subscribe", topic: "catalog"}))
    if (!reconnecting) {
      shell.updateStatus(storybookConnectionStatus("connected"))
      return
    }
    shell.updateStatus(storybookConnectionStatus("reconnected"))
    void fetchExternalStorybookClientSnapshot(fetcher).then(value => {
      if (disposed) return
      navigationSnapshot = value
      applyModel(shell, currentModel, navigationSnapshot, snapshot)
      shell.updateStatus(packageBuildStatus(packageId, exactPackageSummary(value, packageId).buildState))
      reconnecting = false
    }).catch(error => shell.reportDiagnostic(errorText(error)))
  }
  const onSocketMessage = (event: MessageEvent): void => {
    if (disposed) return
    let raw: {type?: string; packageId?: string; revision?: string | null} | null = null
    try { raw = JSON.parse(String(event.data)) } catch {}
    if (raw?.type === "package.restart-required" && raw.packageId === packageId) {
      shell.updateStatus("Оболочка изменилась; требуется явное обновление страницы")
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
    const sharedCacheProgress = readSharedCacheProgress(raw)
    if (sharedCacheProgress !== null) {
      shell.updateStatus(packageBuildActive && sharedCacheProgress.state === "completed"
        ? packageBuildStatusText
        : sharedCacheProgressStatus(sharedCacheProgress))
      return
    }
    if (raw?.type === "package.applied-state" && raw.packageId === packageId) {
      followApplied(raw.revision ?? null, true)
      return
    }
    if (raw?.type === "registry.updated") {
      void fetchExternalStorybookClientSnapshot(fetcher).then(value => {
        if (disposed) return
        navigationSnapshot = value
        applyModel(shell, currentModel, navigationSnapshot, snapshot)
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
  const detachSocket = (): void => {
    socket.removeEventListener("open", onSocketOpen)
    socket.removeEventListener("message", onSocketMessage)
    socket.removeEventListener("close", onSocketClose)
  }
  const onSocketClose = (): void => {
    if (disposed || reconnectTimer !== null) return
    reconnecting = true
    shell.updateStatus(storybookConnectionStatus("disconnected"))
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void (async () => {
        try {
          const response = await fetcher("/api/browser/session", {
            method: "POST", headers: {"content-type": "application/json"},
            body: JSON.stringify({
              packageId,
              revision: candidateRevision,
              preview: readerIntent === "preview",
            }), signal: lifetime.signal,
          })
          if (!response.ok) throw new Error("Package event session is unavailable")
          const result = await response.json() as {token?: string}
          if (disposed) return
          if (typeof result.token !== "string") throw new Error("Invalid package event session")
          detachSocket()
          socket = createPackageSocket(environment, location.href, result.token)
          attachSocket()
        } catch {
          reconnectDelay = Math.min(2_000, reconnectDelay * 2)
          onSocketClose()
        }
      })()
    }, reconnectDelay)
  }
  const attachSocket = (): void => {
    socket.addEventListener("open", onSocketOpen)
    socket.addEventListener("message", onSocketMessage)
    socket.addEventListener("close", onSocketClose)
  }
  attachSocket()

  const dispose = async (reason?: unknown): Promise<void> => {
    if (disposePromise !== null) return disposePromise
    disposed = true
    navigationRevision += 1
    lifetime.abort(reason)
    routeAbort.abort()
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    detachSocket()
    socket.close()
    if (embeddedPageScope === undefined) browserWindow.removeEventListener?.("popstate", onPopState)
    if (embeddedPageScope === undefined) globalThis.removeEventListener?.("pagehide", onPageHide)
    environment.lifecycleSignal?.removeEventListener("abort", onPageHide)
        shell.workbench.element.removeEventListener(WORKBENCH_EVENTS.navigate, onNavigate)
        shell.workbench.element.removeEventListener(WORKBENCH_EVENTS.tab, onTab)
        shell.workbench.element.removeEventListener(WORKBENCH_EVENTS.inspector, onInspector)
    const cleanupTimeoutMs = boundedCleanupTimeout(environment.cleanupTimeoutMs ?? 5_000)
    disposePromise = (async () => {
      try {
        const deadline = Date.now() + cleanupTimeoutMs
        await settleBefore(appliedRevisionTail, deadline)
        await settleBefore(operationTail, deadline)
      } finally {
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

function applyModel(shell: ExternalStorybookShell, model: ExternalStorybookPackageTabModel, navigation: ExternalStorybookClientSnapshot, content: ExternalStorybookClientSnapshot): void {
  shell.document.transaction(() => {
    shell.workbench.update("catalog.label", "Репозитории и пакеты")
    shell.workbench.update("catalog.items", navigationItems(deriveExternalStorybookNavigationTree(navigation, {
      packageId: model.packageNode.packageId!, graph: content,
    })))
    shell.workbench.update("catalog.active", model.selectedNode.id)
    shell.workbench.update("tabs.label", "Панель вкладок")
    shell.workbench.update("tabs.items", tabItems(model.tabs))
    shell.workbench.update("tabs.active", model.tabActiveId)
  })
}

function navigationItems(items: readonly ExternalStorybookBrowserNavigationItem[]) {
  return Object.freeze(items.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    route: item.route,
    title: item.title,
    searchText: item.searchText,
    ...(item.expandable === undefined ? {} : {expandable: item.expandable}),
    ...(item.parentId === undefined ? {} : {parentId: item.parentId}),
  })))
}

function tabItems(items: readonly ExternalStorybookBrowserTabItem[]) {
  return Object.freeze(items.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    route: item.route,
    title: item.title,
  })))
}

function sameWorkspaceAddress(left: string, right: string): boolean {
  const a = new URL(left, "http://storybook.invalid")
  const b = new URL(right, a)
  return a.pathname.replace(/\/$/u, "") === b.pathname.replace(/\/$/u, "") &&
    (a.searchParams.get("view") ?? "overview") === (b.searchParams.get("view") ?? "overview")
}

function packageRouteFromAddress(address: string, packageId: string, graph: ExternalStorybookClientSnapshot): string {
  for (const node of graph.nodes) {
    if (node.packageId !== packageId || node.routePath === null) continue
    for (const route of [node.routePath, node.dependencyRoutePath, node.contractRoutePath, node.scenariosRoutePath]) {
      if (route === undefined) continue
      const model = deriveExternalStorybookPackageTab(graph, packageId, route)
      if (sameWorkspaceAddress(address, model.urlPath)) return route
    }
  }
  throw new Error(`External Storybook address is not in the applied package graph: ${address}`)
}

function revisionClientSnapshot(
  value: StorybookPackageRevisionGraphSnapshot,
  revision: string | null,
  revisionBase: string | null,
): ExternalStorybookClientSnapshot {
  const graph = validateStorybookPackageRevisionGraphSnapshot(value)
  return Object.freeze({
    protocol: EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
    graphDigest: graph.packageGraphDigest,
    rootIds: Object.freeze([graph.rootId]),
    nodes: Object.freeze(graph.nodes.map((node) => Object.freeze({
      ...node,
      resourceUrl: revisionBase === null ? node.resourceUrl : `${revisionBase}${node.resourceUrl}`,
    }))),
    packages: Object.freeze([Object.freeze({
      packageId: graph.packageId,
      declarationDigest: graph.declarationDigest,
      moduleGraphRevision: null,
      candidateRevision: null,
      builtRevision: revision,
      activatingRevision: null,
      activeRevision: null,
      lastWorkingRevision: null,
      lastGoodRevision: null,
      buildState: revision === null ? "idle" as const : "built" as const,
      diagnostics: Object.freeze([]),
    })]),
  })
}

function exactAuthorStyleSheetSources(
  browserDocument: globalThis.Document,
  graph: StorybookPackageRevisionGraphSnapshot | null,
  revisionBase: string | null,
): readonly RootLinkedAuthorStyleSheet[] {
  if (graph === null) return indexedWorkbenchAuthorStyleSheetSources(browserDocument)
  const styleSheets = graph.workbenchAuthorStyleSheets
  if (styleSheets.length === 0) return Object.freeze([])
  if (revisionBase === null) {
    throw new Error(`Storybook author stylesheets require a package revision: ${graph.packageId}`)
  }
  return Object.freeze(styleSheets.map((styleSheet, index) => {
    const elementId = `external-storybook-author-style-sheet-${index}`
    const element = browserDocument.getElementById(elementId)
    if (element === null || element.localName.toLowerCase() !== "link") {
      throw new Error(`Required Storybook author stylesheet link is missing: ${styleSheet.specifier}`)
    }
    const link = element as HTMLLinkElement
    const expectedUrl = `${revisionBase}${styleSheet.url}`
    if (link.ownerDocument !== browserDocument ||
      link.getAttribute("rel") !== "stylesheet" ||
      link.getAttribute("href") !== expectedUrl ||
      link.getAttribute("data-external-storybook-author-style-sheet") !== styleSheet.specifier ||
      link.getAttribute("data-external-storybook-author-style-sheet-digest") !== styleSheet.contentDigest) {
      throw new Error(`Storybook author stylesheet link does not match its revision: ${styleSheet.specifier}`)
    }
    if ((browserDocument.readyState === "interactive" || browserDocument.readyState === "complete") &&
      link.sheet === null) {
      throw new Error(`Required Storybook author stylesheet failed before package entry: ${styleSheet.specifier}`)
    }
    return Object.freeze({id: styleSheet.specifier, link})
  }))
}

function exactPackageSummary(
  snapshot: ExternalStorybookClientSnapshot,
  packageId: string,
): ExternalStorybookClientPackageSummary {
  const matches = snapshot.packages.filter((summary) => summary.packageId === packageId)
  if (matches.length === 0) throw new Error(`External Storybook client has no package summary: ${packageId}`)
  if (matches.length > 1) throw new Error(`External Storybook client package summary is ambiguous: ${packageId}`)
  return matches[0]!
}

/** Проверяет только подготовленные сценарии; неподдержанный preview может не иметь загрузчика. */
function validateScenarioLoaders(
  value: ReadonlyMap<string, ExternalStorybookScenarioLoader> | undefined,
  graph: Readonly<{nodes: readonly Readonly<{id: string; scenariosRoutePath?: string}>[]}>,
): ReadonlyMap<string, ExternalStorybookScenarioLoader> {
  if (value === undefined) return new Map()
  if (!(value instanceof Map)) throw new TypeError("Загрузчики сценариев должны быть Map")
  const owners = new Set(graph.nodes.filter(node => node.scenariosRoutePath !== undefined).map(node => node.id))
  const loaders = new Map<string, ExternalStorybookScenarioLoader>()
  for (const [id, loader] of value) {
    if (!owners.has(id) || typeof loader !== "function") throw new Error(`Некорректный загрузчик сценария: ${String(id)}`)
    loaders.set(id, loader)
  }
  return loaders
}

function validateAppliedRevision(
  value: ExternalStorybookAppliedRevision,
  packageId: string,
  revision: string,
): ExternalStorybookAppliedRevision {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Storybook applied revision payload must be an object")
  }
  if (value.protocol !== STORYBOOK_PAGE_REALM_PROTOCOL) {
    throw new Error(`Storybook applied revision does not share the current page realm: ${revision}`)
  }
  if (value.packageId !== packageId || safeRevision(value.candidateRevision) !== revision) {
    throw new Error(`Storybook applied revision identity does not match: ${packageId}:${revision}`)
  }
  exactBoundedText(value.sharedModuleEpoch, 256, "shared module epoch")
  if (value.hostModuleEpoch !== undefined) {
    exactBoundedText(value.hostModuleEpoch, 256, "host module epoch")
  }
  validateRevisionUrl(packageId, revision, value.revisionUrl)
  const graph = validateStorybookPackageRevisionGraphSnapshot(value.graphSnapshot, packageId)
  return Object.freeze({...value, graphSnapshot: graph, scenarioLoaders: validateScenarioLoaders(value.scenarioLoaders, graph)})
}

function assertCompatibleAuthorStyleSheets(
  current: StorybookPackageRevisionGraphSnapshot | null,
  next: StorybookPackageRevisionGraphSnapshot,
): void {
  const signature = (graph: StorybookPackageRevisionGraphSnapshot) => JSON.stringify([
    ...graph.workbenchAuthorStyleSheets.map(({specifier, contentDigest}) => ({specifier, contentDigest})),
  ])
  if (current === null) {
    if (signature(next) !== "[]") {
      throw new Error(`Storybook applied revision requires attaching Root author stylesheets: ${next.packageId}`)
    }
    return
  }
  if (signature(current) !== signature(next)) {
    throw new Error(`Storybook applied revision requires replacing Root author stylesheets: ${next.packageId}`)
  }
}

function routeAvailable(
  graph: ExternalStorybookClientSnapshot,
  packageId: string,
  route: string,
): boolean {
  try {
    deriveExternalStorybookPackageTab(graph, packageId, route)
    return true
  } catch {
    return false
  }
}

function isScrollableStorybookElement(value: unknown): value is ScrollableStorybookElement {
  return value !== null && typeof value === "object" &&
    typeof (value as ScrollableStorybookElement).scrollTop === "number" &&
    typeof (value as ScrollableStorybookElement).scrollLeft === "number"
}

function exactBoundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`Storybook ${label} must be bounded non-empty text`)
  }
  return value
}

function createPackageSocket(
  environment: ExternalStorybookPackageEnvironment,
  href: string,
  sessionToken?: string,
): ExternalStorybookSocket {
  const url = new URL("/api/events", href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  if (sessionToken !== undefined) url.searchParams.set("session", sessionToken)
  return environment.createSocket?.(url.href) ?? new WebSocket(url.href)
}

function parsePackageEvent(value: unknown): any | null {
  if (typeof value !== "string") return null
  let event: unknown
  try {
    event = JSON.parse(value)
  } catch {
    return null
  }
  if (event === null || typeof event !== "object" || !("type" in event) || !("packageId" in event)) return null
  const record = event as Record<string, unknown>
  if (record.type === "package.updated" && typeof record.packageId === "string" && typeof record.revision === "string") {
    return {type: record.type, packageId: record.packageId, revision: record.revision}
  }
  if (record.type === "package.built" && typeof record.packageId === "string" && typeof record.revision === "string") {
    return {type: record.type, packageId: record.packageId, revision: record.revision}
  }
  if (record.type === "package.activating" && typeof record.packageId === "string" &&
    typeof record.revision === "string" && typeof record.activationId === "string") {
    return {type: record.type, packageId: record.packageId, revision: record.revision}
  }
  if (["package.code-updated", "package.resources-updated", "package.metadata-updated"].includes(String(record.type)) &&
    typeof record.packageId === "string" && typeof record.path === "string") {
    return {type: record.type, packageId: record.packageId, path: record.path}
  }
  if (record.type === "package.failed" && typeof record.packageId === "string" &&
    typeof record.revision === "string" && Array.isArray(record.diagnostics)) {
    return {type: record.type, packageId: record.packageId, revision: record.revision, diagnostics: record.diagnostics}
  }
  if (record.type === "package.detached" && typeof record.packageId === "string") {
    return {type: record.type, packageId: record.packageId}
  }
  return null
}

function validateRevisionUrl(packageId: string, revision: string | null, value: string | null): void {
  if (revision === null) {
    if (value !== null) throw new Error(`Unavailable Storybook revision URL must be null: ${String(value)}`)
    return
  }
  const expected = `/__storybook/revisions/${encodeURIComponent(packageId)}/${revision}/`
  if (value !== expected) throw new Error(`External Storybook revision URL mismatch: ${value}`)
}

function exactPackageId(value: string): string {
  encodeExternalStorybookPackagePath(value)
  return value
}

function safeRevision(value: string): string {
  if (typeof value !== "string" || value.length === 0 || /[^a-zA-Z0-9._-]/u.test(value)) {
    throw new Error(`Invalid external Storybook revision: ${String(value)}`)
  }
  return value
}

function overviewDescription(kind: string, children: number): string {
  if (kind === "directory") return "В index.ts этой директории нет описания модуля с @packageDocumentation."
  if (kind === "package") return `${children} вложенных пакетов и директорий. Выберите элемент в дереве.`
  return "Documentation-only variant."
}

function isolatePackageError(
  document: globalThis.Document,
  shell: ExternalStorybookShell,
  model: ExternalStorybookPackageTabModel,
  error: unknown,
): void {
  const message = errorText(error)
  document.documentElement.dataset.externalStorybookPackage = "error"
  document.documentElement.dataset.externalStorybookError = message
  shell.reportDiagnostic(message)
  shell.showMessage(`${model.selectedNode.label} · Ошибка`, model.selectedNode.label, message)
  shell.updateStatus(`${model.packageNode.ownerId} · isolated error`)
  console.error(error)
}

function readBrowserSessionToken(browserDocument: globalThis.Document): string | undefined {
  const value = readMetaContent(browserDocument, "external-storybook-browser-session")
  return value === undefined || value.length === 0 ? undefined : value
}

function readMetaContent(browserDocument: globalThis.Document, name: string): string | undefined {
  return typeof browserDocument.querySelector === "function"
    ? browserDocument.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content
    : undefined
}

async function bestEffortDispose(value: unknown): Promise<void> {
  if (value === null || typeof value !== "object") return
  let dispose: unknown
  try {
    dispose = (value as {dispose?: unknown}).dispose
  } catch {
    return
  }
  if (typeof dispose !== "function") return
  try {
    await dispose.call(value)
  } catch {
    // The original validation/create error remains authoritative.
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function abortable<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
  return new Promise<Value>((resolvePromise, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener("abort", onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => reject(signal.reason ?? new DOMException("Aborted", "AbortError")))
    signal.addEventListener("abort", onAbort, {once: true})
    promise.then(
      (value) => finish(() => resolvePromise(value)),
      (error) => finish(() => reject(error)),
    )
  })
}

async function settleBefore(promise: Promise<unknown>, deadline: number): Promise<void> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return
  await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, remaining)),
  ])
}

function boundedCleanupTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 30_000) {
    throw new RangeError("Storybook cleanup timeout must be between 10 and 30000 ms")
  }
  return value
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("External Storybook package tab is disposed")
}

if (typeof document !== "undefined" && document.documentElement.dataset.externalStorybookEntry === "package") {
  // Generated immutable entries call startExternalStorybookPackage with their
  // literal loaders. A bare source module deliberately has nothing to start.
}
