import {storybookPackageRouteFromPathname} from "@zavx0z/storybook-browser-lifecycle/contract"
import {indexedWorkbenchAuthorStyleSheetSources} from "./author-style-sheets.ts"
import {navigatePackage} from "./package-navigation.ts"
import {externalStorybookBrowsePath} from "../catalog/graph.ts"
/** One package-tab realm driven by generated literal runtime/story loaders. */

import type {CustomEvent, Node as SemanticNode} from "@zavx0z/dom"
import {createDomInspector} from "@zavx0z/devtools"
import type {RootLinkedAuthorStyleSheet} from "@zavx0z/browser/integration"
import {isCompiledTemplate, type CompiledTemplate} from "@zavx0z/template/compiled"
import {arrowDownIcon, arrowUpIcon} from "@zavx0z/ui/themes/icons"
import {
  WORKBENCH_EVENTS,
  type WorkbenchInspectorCustomWidgetProps,
  type WorkbenchInspectorCustomWidgetRegistration,
  type WorkbenchPresentationUpdate,
} from "../workbench/contract.ts"
import {WORKBENCH_STANDARD_WIDGET_REGISTRY} from "../workbench/inspector/registry.ts"
import {mergeStorybookAuthorStyleSheets} from "../catalog/author-style-sheets.ts"
import {externalStorybookPageTitle} from "./page-title.ts"
import {createStorybookAgentBridge, type StorybookAgentBridge} from "./agent-bridge.ts"
import {
  STORYBOOK_PRESENTATION_PROTOCOL,
  validateStorybookRuntimeAdapter,
  validateStorybookRuntimeSession,
  type StorybookRuntimeAdapter,
  type StorybookRuntimeContext,
  type StorybookRuntimePresentationInput,
  type StorybookRuntimeSession,
  type StorybookSpacePreview,
} from "./runtime-protocol.ts"
import {
  encodeExternalStorybookPackagePath,
  EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
  type ExternalStorybookClientPackageSummary,
  type ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"
import {
  validateStorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionStoryPresentation,
} from "../sessions/package-revision.ts"
import {deriveStorybookBreadcrumbs} from "./breadcrumbs.ts"
import {
  deriveExternalStorybookPackageTab,
  deriveExternalStorybookLanding,
  deriveExternalStorybookPackageContents,
  type ExternalStorybookBrowserNavigationItem,
  type ExternalStorybookBrowserVariantItem,
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
import {projectStorybookSource} from "./source-projection.ts"
import {
  createStorybookAggregatePresentation,
  type StorybookAggregatePresentation,
} from "./aggregate-presentation.tsx"
import {
  disposeStorybookAggregateChildren,
  mountStorybookAggregateChildren,
  planStorybookOverview,
  type MountedStorybookAggregateChild,
} from "./aggregate-runtime.ts"
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

export type ExternalStorybookStoryLoader = () => Promise<unknown>
export type ExternalStorybookWidgetLoader = () => Promise<unknown>
export type ExternalStorybookRuntimeLoader = (() => Promise<unknown>) | null

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
  loadRuntime: ExternalStorybookRuntimeLoader
  storyLoaders: ReadonlyMap<string, ExternalStorybookStoryLoader>
  widgetLoaders?: ReadonlyMap<string, ExternalStorybookWidgetLoader>
}>

export type ExternalStorybookSocket = Readonly<{
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  send(data: string): void
  close(): void
}>

type BoundStorybookRuntimeSession = Readonly<{
  subjectId: string
  projection: StorybookPackageRevisionStoryPresentation["projection"]
  context: StorybookRuntimeContext
  abort: AbortController
  session: StorybookRuntimeSession
}>

type StorybookPresentationOperation = {
  revision: number
  subjectId: string
  route: string
  projection: StorybookPackageRevisionStoryPresentation["projection"]
  presented: boolean
  presentedNode: SemanticNode | null
  spaceNode: SemanticNode | null
}

type StorybookPresentationSubject = Readonly<{
  id: string
  kind: "subject"
  presentation: StorybookPackageRevisionStoryPresentation
}>

type MountedStorybookAggregate = Readonly<{
  presentation: StorybookAggregatePresentation
  children: readonly MountedStorybookAggregateChild[]
  stopFitting(): void
}>

type ScrollableStorybookElement = {
  scrollTop: number
  scrollLeft: number
}

const CONTRACT_OUTLINE_WIDGETS = Object.freeze([
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
    prepareRevisionStyleSheets(
      payload: ExternalStorybookAppliedRevision,
      signal: AbortSignal,
    ): Promise<Readonly<{
      commit(): Promise<void>
      rollback(): Promise<void>
      release(): void
    }>>
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
  loadRuntime: ExternalStorybookRuntimeLoader
  storyLoaders: ReadonlyMap<string, ExternalStorybookStoryLoader>
  widgetLoaders?: ReadonlyMap<string, ExternalStorybookWidgetLoader>
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
  const initialStoryLoaders = validateStoryLoaders(input.storyLoaders)
  const initialWidgetLoaders = validateWidgetLoaders(input.widgetLoaders ?? new Map())
  if (input.loadRuntime !== null && typeof input.loadRuntime !== "function") {
    throw new TypeError("External Storybook runtime loader must be a function or null")
  }
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
  validateRevisionWidgetLoaderKeys(initialRevisionGraph, initialWidgetLoaders)
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
      if (initialCandidateRevision === null && (input.loadRuntime !== null || initialStoryLoaders.size > 0)) {
        throw new Error(`Unavailable Storybook package cannot receive executable loaders: ${packageId}`)
      }
      for (const [route, loader] of initialStoryLoaders) {
        if (typeof loader !== "function") throw new TypeError(`External Storybook story loader is not callable: ${route}`)
        const model = deriveExternalStorybookPackageTab(snapshot, packageId, route)
        if (model.selectedNode.kind !== "variant") {
          throw new Error(`External Storybook story loader route is not a variant: ${route}`)
        }
      }
      const initialRoute = environment.pageScope?.initialRoute ?? packageRouteFromPathname(location.pathname, packageId)
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
  let loadRuntime = input.loadRuntime
  let storyLoaders = initialStoryLoaders
  let widgetLoaders = initialWidgetLoaders
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
        loadRuntime,
        storyLoaders,
        widgetLoaders,
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
  let runtimeAdapterPromise: Promise<StorybookRuntimeAdapter> | null = null
  let session: BoundStorybookRuntimeSession | null = null
  let sessionPromise: Promise<BoundStorybookRuntimeSession> | null = null
  let aggregate: MountedStorybookAggregate | null = null
  let mountedRoute: string | null = null
  let currentRoute = initialRoute
  let currentModel = initialModel
  let navigationRevision = 0
  let activePresentationOperation: StorybookPresentationOperation | null = null
  let selectContractDirection: ((id: string) => void) | null = null
  let activePresentationView: WorkbenchPresentationUpdate | null = null
  let routeDiagnostics: unknown[] = []
  let operationTail: Promise<void> = Promise.resolve()
  let disposePromise: Promise<void> | null = null
  let agentBridge: StorybookAgentBridge | null = null
  let activeSpacePreview: StorybookSpacePreview | null = null
  const customWidgetComponents = new Map<
    string,
    CompiledTemplate<WorkbenchInspectorCustomWidgetProps>
  >()
  let reloadingFallback = false
  let disposed = false
  const presentationInspector = createDomInspector({
    document: shell.document,
    readFrame(node) {
      const projection = shell.projectionFor(node)
      return projection.kind === "space" ? null : projection.readFrame()
    },
  })
  let derivedPresentationSignature = ""

  /** Публикует базовый реестр и уже загруженные custom widgets пакета. */
  const publishInspectorRegistry = (): void => {
    const customRegistry: WorkbenchInspectorCustomWidgetRegistration[] = [...CONTRACT_OUTLINE_WIDGETS]
    for (const item of revisionGraph?.widgetContributions?.items ?? []) {
      if (item.kind !== "component") continue
      if (CONTRACT_OUTLINE_WIDGETS.some(widget => widget.id === item.id)) {
        throw new Error(`Storybook widget contribution uses reserved Inspector id: ${item.id}`)
      }
      const component = customWidgetComponents.get(item.id)
      if (component === undefined) continue
      customRegistry.push(Object.freeze({
        id: item.id,
        kind: "custom",
        label: item.label,
        title: item.label,
        component,
      }))
    }
    shell.workbench.update("inspector.registry", Object.freeze([
      ...WORKBENCH_STANDARD_WIDGET_REGISTRY,
      ...customRegistry,
    ]))
  }

  /** Загружает custom widgets предмета и обновляет общий реестр Inspector. */
  const ensureInspectorRegistry = async (
    subject: StorybookPresentationSubject,
  ): Promise<void> => {
    const presentation = requiredSubjectPresentation(subject)
    const customItems = revisionGraph?.widgetContributions?.items.filter((item) =>
      item.kind === "component" && presentation.widgets.includes(item.id)) ?? []
    for (const item of customItems) {
      if (customWidgetComponents.has(item.id)) continue
      const loader = widgetLoaders.get(item.id)
      if (loader === undefined) {
        throw new Error(`Storybook presentation widget has no exact loader: ${packageId}:${item.id}`)
      }
      const candidate = await loader()
      if (!isCompiledTemplate(candidate)) {
        throw new TypeError(`Storybook component widget is not governed compiled TSX: ${packageId}:${item.id}`)
      }
      customWidgetComponents.set(
        item.id,
        candidate as CompiledTemplate<WorkbenchInspectorCustomWidgetProps>,
      )
    }
    publishInspectorRegistry()
  }

  const disposeSpacePreview = (): void => {
    const preview = activeSpacePreview
    activeSpacePreview = null
    preview?.dispose()
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

  const refreshDerivedPresentation = (): boolean => {
    const current = activePresentationView
    const node = current?.presentation.node
    const widgetIds = current?.inspectorSubject?.widgetIds ?? Object.freeze([])
    if (current === null || node === null ||
      !widgetIds.some((id) => id === "dom" || id === "layout" || id === "display")) return false
    const snapshot = presentationInspector.snapshot(node)
    const root = snapshot.nodes.find(({id}) => id === snapshot.root)
    if (root === undefined) throw new Error("Storybook DOM Inspector omitted the presentation root")
    const derived = Object.freeze({
      ...(widgetIds.includes("dom") ? {dom: snapshot} : {}),
      ...(widgetIds.includes("layout") ? {layout: root.box ?? null} : {}),
      ...(widgetIds.includes("display") ? {
        display: Object.freeze({
          hit: root.hit ?? null,
          display: root.display ?? Object.freeze([]),
        }),
      } : {}),
    })
    const signature = JSON.stringify(derived)
    if (signature === derivedPresentationSignature) return false
    derivedPresentationSignature = signature
    const next = Object.freeze({
      ...current,
      inspectorValues: Object.freeze({...current.inspectorValues, ...derived}),
    })
    publishPresentation(next)
    return true
  }

  const activeOperation = (
    subjectId: string,
    projection: StorybookPackageRevisionStoryPresentation["projection"],
  ): StorybookPresentationOperation => {
    const operation = activePresentationOperation
    if (operation === null || operation.revision !== navigationRevision ||
      operation.subjectId !== subjectId || operation.projection !== projection ||
      routeAbort.signal.aborted) {
      throw new Error("External Storybook runtime attempted a stale presentation")
    }
    return operation
  }

  const createContext = (
    subject: StorybookPresentationSubject,
    abort: AbortController,
  ): StorybookRuntimeContext => {
    const presentation = requiredSubjectPresentation(subject)
    const signal = AbortSignal.any([lifetime.signal, abort.signal])
    const base = {
      document: shell.document,
      signal,
      present(value: StorybookRuntimePresentationInput) {
        const operation = activeOperation(subject.id, presentation.projection)
        if (operation.presented) {
          throw new Error("Storybook runtime mount/update published more than one atomic presentation")
        }
        const committed = exactRuntimePresentation(
          value,
          shell,
          presentation,
          revisionGraph?.authorStyleSheets.map(({specifier}) => specifier) ?? Object.freeze([]),
          routeDiagnostics,
        )
        if (operation.spaceNode !== null && operation.spaceNode !== committed.node) {
          throw new Error("Storybook Space preview node differs from the atomic presentation node")
        }
        operation.presented = true
        operation.presentedNode = committed.node
        const next = Object.freeze({
          label: currentModel.selectedNode.label,
          presentation: Object.freeze({
            node: committed.node,
            projection: presentation.projection,
          }),
          inspectorSubject: Object.freeze({
            packageId,
            subjectId: subject.id,
            workspaceId: `variant:${operation.route}`,
            widgetIds: presentation.widgets,
          }),
          inspectorValues: committed.inspectorValues,
        })
        publishPresentation(next, true)
      },
      reportDiagnostic(value: unknown) {
        const selectedSubject = exactPresentationSubject(revisionGraph, snapshot, currentModel)
        const inspector = activePresentationView?.inspectorSubject
        if (signal.aborted || currentModel.selectedNode.kind !== "variant" ||
          selectedSubject?.id !== subject.id || inspector?.workspaceId !== `variant:${currentRoute}`) {
          throw new Error("External Storybook runtime attempted a stale diagnostic")
        }
        reportDiagnostic(value)
      },
      requestRender() {
        shell.requestRender()
      },
    } as const
    if (presentation.projection !== "space") {
      return Object.freeze({...base, projection: presentation.projection})
    }
    return Object.freeze({
      ...base,
      projection: "space" as const,
      space: shell.space,
      mountSpacePreview(registration: Parameters<ExternalStorybookShell["mountSpacePreview"]>[1]) {
        const operation = activeOperation(subject.id, presentation.projection)
        if (operation.spaceNode !== null) {
          throw new Error("Storybook runtime mount/update registered more than one Space preview")
        }
        operation.spaceNode = registration.node
        if (operation.presentedNode !== null && operation.presentedNode !== registration.node) {
          throw new Error("Storybook Space preview node differs from the atomic presentation node")
        }
        disposeSpacePreview()
        const preview = shell.mountSpacePreview(currentModel.selectedNode.label, registration)
        activeSpacePreview = preview
        return preview
      },
    })
  }

  const ensureRuntimeAdapter = (): Promise<StorybookRuntimeAdapter> => {
    if (runtimeAdapterPromise !== null) return runtimeAdapterPromise
    if (loadRuntime === null) {
      throw new Error(`Executable Storybook variant has no runtime: ${packageId}`)
    }
    runtimeAdapterPromise = Promise.resolve()
      .then(() => loadRuntime!())
      .then(validateStorybookRuntimeAdapter)
    return runtimeAdapterPromise
  }

  const disposeSession = async (record: BoundStorybookRuntimeSession | null): Promise<void> => {
    if (record === null) return
    record.abort.abort(new DOMException("Storybook subject session disposed", "AbortError"))
    await record.session.dispose()
    if (session === record) session = null
  }

  const disposeAggregate = async (): Promise<void> => {
    const current = aggregate
    aggregate = null
    if (current === null) return
    current.stopFitting()
    try {
      await disposeStorybookAggregateChildren(current.children)
    } finally {
      current.presentation.dispose()
    }
  }

  const ensureSession = async (
    subject: StorybookPresentationSubject,
  ): Promise<BoundStorybookRuntimeSession> => {
    const presentation = requiredSubjectPresentation(subject)
    if (session !== null && session.subjectId === subject.id &&
      session.projection === presentation.projection) return session
    if (sessionPromise !== null) {
      const pending = await sessionPromise
      if (pending.subjectId === subject.id && pending.projection === presentation.projection) return pending
    }
    if (session !== null) {
      if (mountedRoute !== null) {
        await session.session.unmount()
        mountedRoute = null
      }
      await disposeSession(session)
    }
    const abort = new AbortController()
    const context = createContext(subject, abort)
    const pending = ensureRuntimeAdapter()
      .then((adapter) => adapter.create(context))
      .then(async (candidate) => {
        let created: StorybookRuntimeSession
        try {
          created = validateStorybookRuntimeSession(candidate)
        } catch (error) {
          await bestEffortDispose(candidate)
          throw error
        }
        if (disposed || lifetime.signal.aborted || abort.signal.aborted) {
          await created.dispose()
          throw lifetime.signal.reason ?? abort.signal.reason ?? new DOMException("Aborted", "AbortError")
        }
        const record = Object.freeze({
          subjectId: subject.id,
          projection: presentation.projection,
          context,
          abort,
          session: created,
        })
        session = record
        return record
      })
      .finally(() => {
        if (sessionPromise === pending) sessionPromise = null
      })
    sessionPromise = pending
    return pending
  }

  const showAggregateOverview = async (
    model: ExternalStorybookPackageTabModel,
    revision: number,
    signal: AbortSignal,
  ): Promise<boolean> => {
    const plan = planStorybookOverview(snapshot, model)
    const projection = plan[0]?.subject.presentation.projection
    if (projection === undefined || projection === "space" || plan.some(({subject}) =>
      subject.presentation.projection !== projection)) return false
    await disposeAggregate()
    if (session !== null) {
      if (mountedRoute !== null) {
        await session.session.unmount()
        mountedRoute = null
      }
      await disposeSession(session)
    }
    let children: readonly MountedStorybookAggregateChild[] = Object.freeze([])
    let pendingPresentation: StorybookAggregatePresentation | null = null
    let stopFitting = () => {}
    try {
      const aggregateSignal = AbortSignal.any([lifetime.signal, signal])
      const adapter = await abortable(ensureRuntimeAdapter(), aggregateSignal)
      if (disposed || revision !== navigationRevision || signal.aborted) {
        throw signal.reason ?? new DOMException("Storybook aggregate navigation superseded", "AbortError")
      }
      const node = externalStorybookClientNode(snapshot, model.selectedNode.id)
      const aggregatePresentation = createStorybookAggregatePresentation(
        shell.document,
        `${node.label} · Обзор`,
        plan,
      )
      pendingPresentation = aggregatePresentation
      const mountingView: WorkbenchPresentationUpdate = Object.freeze({
        label: `${node.label} · Обзор`,
        presentation: Object.freeze({node: aggregatePresentation.element, projection}),
        inspectorSubject: null,
        inspectorValues: Object.freeze({diagnostics: Object.freeze([...routeDiagnostics])}),
      })
      publishPresentation(mountingView, true)
      stopFitting = shell.root.getProjection(projection === "display" ? shell.display : shell.hud)
        .subscribeFrames(frame => {
          if (aggregatePresentation.fitToFrame(frame)) shell.requestRender()
        })
      children = await mountStorybookAggregateChildren({
        document: shell.document,
        adapter,
        plan,
        signal: aggregateSignal,
        async loadStory(route) {
          const loader = storyLoaders.get(route)
          if (loader === undefined) {
            throw new Error(`Storybook aggregate representative has no exact loader: ${route}`)
          }
          return loader()
        },
        present(item, value) {
          return aggregatePresentation.present(item.id, value)
        },
        validatePresentation(value, presentation) {
          exactRuntimePresentation(
            value,
            shell,
            presentation,
            revisionGraph?.authorStyleSheets.map(({specifier}) => specifier) ?? Object.freeze([]),
            routeDiagnostics,
          )
        },
        reportDiagnostic,
        requestRender: () => shell.requestRender(),
      })
      if (disposed || revision !== navigationRevision || signal.aborted) {
        throw signal.reason ?? new DOMException("Storybook aggregate navigation superseded", "AbortError")
      }
      const selectedSubject = exactPresentationSubject(revisionGraph, snapshot, model)
      const overviewSubject = selectedSubject ?? (
        plan.length === 1 && children.length === 1 ? plan[0]!.subject : null
      )
      const representative = children.length === 1 ? children[0]!.presentation : null
      let inspectorValues: Readonly<Record<string, unknown>> = Object.freeze({
        diagnostics: Object.freeze([...routeDiagnostics]),
      })
      let inspectorSubject: WorkbenchPresentationUpdate["inspectorSubject"] = null
      if (overviewSubject === null) {
        projectStorybookSource(
          aggregatePresentation.source,
          aggregatePresentation.componentRoot,
          shell.document,
          revisionGraph?.authorStyleSheets.map(({specifier}) => specifier) ?? Object.freeze([]),
        )
      } else {
        await ensureInspectorRegistry(overviewSubject)
        if (disposed || revision !== navigationRevision || signal.aborted) {
          throw signal.reason ?? new DOMException(
            "Storybook aggregate Inspector setup superseded",
            "AbortError",
          )
        }
        const subjectPresentation = requiredSubjectPresentation(overviewSubject)
        const committed = exactRuntimePresentation(
          Object.freeze({
            protocol: STORYBOOK_PRESENTATION_PROTOCOL,
            node: aggregatePresentation.element,
            componentRoot: aggregatePresentation.componentRoot,
            source: aggregatePresentation.source,
            ...(representative?.values === undefined
              ? {}
              : {values: representative.values}),
          }),
          shell,
          subjectPresentation,
          revisionGraph?.authorStyleSheets.map(({specifier}) => specifier) ?? Object.freeze([]),
          routeDiagnostics,
        )
        inspectorValues = committed.inspectorValues
        inspectorSubject = Object.freeze({
          packageId,
          subjectId: overviewSubject.id,
          widgetIds: subjectPresentation.widgets,
        })
      }
      const next = Object.freeze({
        label: `${node.label} · Обзор`,
        presentation: Object.freeze({
          node: aggregatePresentation.element,
          projection,
        }),
        inspectorSubject,
        inspectorValues,
      })
      publishPresentation(next)
      shell.requestRender()
      aggregate = Object.freeze({
        presentation: aggregatePresentation,
        children: Object.freeze([...children]),
        stopFitting,
      })
      pendingPresentation = null
      return true
    } catch (error) {
      stopFitting()
      try {
        await disposeStorybookAggregateChildren(children, error, true)
      } finally {
        if (activePresentationView?.presentation.node === pendingPresentation?.element) {
          activePresentationView = null
        }
        pendingPresentation?.dispose()
      }
      throw error
    }
  }

  const showOverview = async (
    model: ExternalStorybookPackageTabModel,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> => {
    selectContractDirection = null
    const dependencies = model.viewKind === "dependencies"
    const contract = model.viewKind === "contract"
    disposeSpacePreview()
    if (!dependencies && !contract && await showAggregateOverview(model, revision, signal)) return
    await disposeAggregate()
    if (session !== null && mountedRoute !== null) {
      await session.session.unmount()
      mountedRoute = null
    }
    const overviewSubject = exactPresentationSubject(revisionGraph, snapshot, model)
    if (session !== null && session.subjectId !== overviewSubject?.id) {
      await disposeSession(session)
    }
    const node = externalStorybookClientNode(snapshot, model.selectedNode.id)
    const readme = contract || dependencies ? null : await readExternalStorybookNodeReadme(node, fetcher)
    if (disposed || revision !== navigationRevision) return
    const label = contract ? `${node.label} · Контракт` : dependencies ? `${node.label} · Зависимости` : readme === null ? `${node.label} · Обзор` : `${node.label} · ${node.hasModuleDocumentation ? "TSDoc" : "README"}`
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
    const presentationNode = contract
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
    const subjectPresentation = overviewSubject === null
      ? null
      : requiredSubjectPresentation(overviewSubject)
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
      inspectorSubject: contract
        ? Object.freeze({
          packageId,
          subjectId: node.id,
          workspaceId: `contract:${model.urlPath}`,
          widgetIds: contractWidgets,
        })
        : dependencies || overviewSubject === null || subjectPresentation === null
        ? null
        : Object.freeze({
          packageId,
          subjectId: overviewSubject.id,
          widgetIds: subjectPresentation.widgets,
        }),
      inspectorValues: contractValues ?? Object.freeze({diagnostics: Object.freeze([...routeDiagnostics])}),
    })
    publishPresentation(next)
    shell.requestRender()
  }

  const showVariant = async (
    model: ExternalStorybookPackageTabModel,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> => {
    const route = model.selectedNode.routePath
    if (route === null) throw new Error(`External Storybook variant has no route: ${model.selectedNode.id}`)
    const loader = storyLoaders.get(route)
    if (loader === undefined) {
      await showOverview(model, revision, signal)
      return
    }
    const subject = exactPresentationSubject(revisionGraph, snapshot, model)
    if (subject === null) throw new Error(`Executable Storybook variant has no presentation subject: ${route}`)
    const presentation = requiredSubjectPresentation(subject)
    disposeSpacePreview()
    await disposeAggregate()
    shell.showMessage(`${model.selectedNode.label} · Загрузка`, model.selectedNode.label, "Загрузка owner story…")
    const [runtimeRecord, story] = await abortable(Promise.all([ensureSession(subject), loader()]), signal)
    if (disposed || revision !== navigationRevision || signal.aborted) return
    const storyInput = Object.freeze({route, story, signal})
    const operation: StorybookPresentationOperation = {
      revision,
      subjectId: subject.id,
      route,
      projection: presentation.projection,
      presented: false,
      presentedNode: null,
      spaceNode: null,
    }
    activePresentationOperation = operation
    try {
      if (mountedRoute !== null && runtimeRecord.session.update !== undefined) {
        await abortable(Promise.resolve(runtimeRecord.session.update(storyInput)), signal)
        if (disposed || revision !== navigationRevision || signal.aborted) return
      } else {
        if (mountedRoute !== null) await abortable(Promise.resolve(runtimeRecord.session.unmount()), signal)
        mountedRoute = null
        if (disposed || revision !== navigationRevision || signal.aborted) return
        await abortable(Promise.resolve(runtimeRecord.session.mount(storyInput)), signal)
        if (disposed || revision !== navigationRevision || signal.aborted) {
          await runtimeRecord.session.unmount()
          disposeSpacePreview()
          return
        }
      }
      if (!operation.presented) {
        throw new Error(`Storybook runtime mount/update published no atomic presentation: ${route}`)
      }
      if (operation.spaceNode !== null && operation.spaceNode !== operation.presentedNode) {
        throw new Error("Storybook Space preview node differs from the atomic presentation node")
      }
      mountedRoute = route
    } catch (error) {
      mountedRoute = null
      disposeSpacePreview()
      try {
        await runtimeRecord.session.unmount()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], `Storybook failed to clean up route ${route}`)
      }
      throw error
    } finally {
      if (activePresentationOperation === operation) activePresentationOperation = null
    }
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
    const presentationSubject = exactPresentationSubject(revisionGraph, snapshot, model)
    if (candidateRevision !== null && presentationSubject !== null) await ensureInspectorRegistry(presentationSubject)
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
    derivedPresentationSignature = ""
    for (const diagnostic of summary.diagnostics) reportDiagnostic(diagnostic)
    try {
      if (candidateRevision === null && summary.buildState === "failed") {
        throw new Error(summary.diagnostics.map(({message}) => message).join("\n") ||
          `Package ${packageId} has no last-good revision`)
      }
      if (candidateRevision === null) {
        shell.showMessage(model.packageNode.label, "Нет применённой сборки", "Пакет станет доступен после успешной проверки и применения агентом.")
      } else if (model.selectedNode.kind === "variant") {
        await showVariant(model, revision, signal)
      } else {
        await showOverview(model, revision, signal)
      }
      if (disposed || revision !== navigationRevision || signal.aborted) return
      const beforeFrame = shell.presentedFrameSequence
      let frameSequence = shell.presentFrame()
      if (frameSequence <= beforeFrame) throw new Error("Storybook activation did not present a new frame")
      if (refreshDerivedPresentation()) frameSequence = shell.presentFrame()
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
    if (updateHistory && location.pathname !== model.urlPath) {
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
      shell.workbench.elements.secondaryItems,
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

  const disposeMountedExecution = async (reason?: unknown): Promise<void> => {
    disposeSpacePreview()
    await disposeAggregate()
    const current = session
    if (current === null) return
    if (mountedRoute !== null) {
      await current.session.unmount()
      mountedRoute = null
    }
    current.abort.abort(reason)
    await disposeSession(current)
  }

  type RevisionBinding = Readonly<{
    candidateRevision: string | null
    revisionUrl: string | null
    loadRuntime: ExternalStorybookRuntimeLoader
    storyLoaders: ReadonlyMap<string, ExternalStorybookStoryLoader>
    widgetLoaders: ReadonlyMap<string, ExternalStorybookWidgetLoader>
    revisionGraph: StorybookPackageRevisionGraphSnapshot | null
    snapshot: ExternalStorybookClientSnapshot
    summary: ExternalStorybookClientPackageSummary
    graph: ExternalStorybookClientSnapshot
    runtimeAdapterPromise: Promise<StorybookRuntimeAdapter> | null
    customWidgets: readonly [string, CompiledTemplate<WorkbenchInspectorCustomWidgetProps>][]
    payload: ExternalStorybookAppliedRevision | null
    styleTransaction: Readonly<{
      commit(): Promise<void>
      rollback(): Promise<void>
      release(): void
    }> | null
  }>

  const readRevisionBinding = (): RevisionBinding => Object.freeze({
    candidateRevision,
    revisionUrl,
    loadRuntime,
    storyLoaders,
    widgetLoaders,
    revisionGraph,
    snapshot,
    summary,
    graph,
    runtimeAdapterPromise,
    customWidgets: Object.freeze([...customWidgetComponents.entries()]),
    payload: currentPayload,
    styleTransaction: null,
  })

  const writeRevisionBinding = (binding: RevisionBinding): void => {
    candidateRevision = binding.candidateRevision
    revisionUrl = binding.revisionUrl
    loadRuntime = binding.loadRuntime
    storyLoaders = binding.storyLoaders
    widgetLoaders = binding.widgetLoaders
    revisionGraph = binding.revisionGraph
    snapshot = binding.snapshot
    summary = binding.summary
    graph = binding.graph
    runtimeAdapterPromise = binding.runtimeAdapterPromise
    currentPayload = binding.payload
    customWidgetComponents.clear()
    for (const [id, component] of binding.customWidgets) customWidgetComponents.set(id, component)
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
    const styleTransaction = embeddedPageScope === undefined
      ? (assertCompatibleAuthorStyleSheets(revisionGraph, payload.graphSnapshot), null)
      : await embeddedPageScope.prepareRevisionStyleSheets(payload, signal)
    const nextSnapshot = revisionClientSnapshot(
      payload.graphSnapshot,
      payload.candidateRevision,
      payload.revisionUrl,
    )
    const nextSummary = exactPackageSummary(nextSnapshot, packageId)
    const preparedAdapter = payload.loadRuntime === null
      ? null
      : await Promise.resolve(payload.loadRuntime()).then(validateStorybookRuntimeAdapter)
    signal.throwIfAborted()
    return Object.freeze({
      candidateRevision: payload.candidateRevision,
      revisionUrl: payload.revisionUrl,
      loadRuntime: payload.loadRuntime,
      storyLoaders: validateStoryLoaders(payload.storyLoaders),
      widgetLoaders: validateWidgetLoaders(payload.widgetLoaders ?? new Map()),
      revisionGraph: payload.graphSnapshot,
      snapshot: nextSnapshot,
      summary: nextSummary,
      graph: nextSnapshot,
      runtimeAdapterPromise: preparedAdapter === null ? null : Promise.resolve(preparedAdapter),
      customWidgets: Object.freeze([]),
      payload,
      styleTransaction,
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
    await next.styleTransaction?.commit()
    writeRevisionBinding(next)
    try {
      await applyRoute(nextRoute, revision, routeAbort.signal, true)
      restoreScrollState(stableScroll, presentationScroll)
      candidateRevision = next.candidateRevision
      browserDocument.documentElement.dataset.externalStorybookRevision = next.candidateRevision ?? "unavailable"
      delete browserDocument.documentElement.dataset.externalStorybookUpdateError
      agentBridge?.updateIdentity(packageId, next.candidateRevision ?? "unavailable", next.snapshot.graphDigest)
      if (next.payload !== null) embeddedPageScope?.revisionApplied(next.payload)
      next.styleTransaction?.release()
    } catch (error) {
      await disposeMountedExecution(error)
      await next.styleTransaction?.rollback()
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
            if (sessionPromise !== null) {
              throw new Error(`Storybook pending runtime cannot change page realm; page restart is required: ${packageId}:${requested}`)
            }
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
      if (node.kind === "package") {
        if (node.packageId === packageId) void navigate("")
        else if (embeddedPageScope !== undefined) {
          followPageNavigation(embeddedPageScope.navigatePackage({packageId: node.packageId!, route: ""}))
        } else followPageNavigation(navigatePackage({packageId: node.packageId!, route: ""}, environment.navigatePackage))
      } else if (node.packageId !== null && embeddedPageScope !== undefined) {
        followPageNavigation(embeddedPageScope.navigatePackage({packageId: node.packageId, route: node.routePath ?? ""}))
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
      const route = packageRouteFromPathname(location.pathname, packageId)
      if (route === currentRoute) {
        restoreInspectorSelection()
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
        if (sessionPromise !== null) await settleBefore(sessionPromise, deadline)
        if (aggregate !== null) await settleBefore(disposeAggregate(), deadline)
        if (session !== null) {
          disposeSpacePreview()
          if (mountedRoute !== null) await settleBefore(Promise.resolve(session.session.unmount()), deadline)
          session.abort.abort(reason)
          await settleBefore(Promise.resolve(session.session.dispose()), deadline)
        }
      } finally {
        agentBridge?.dispose()
        presentationInspector.dispose()
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
  if (embeddedPageScope === undefined && location.pathname !== canonicalInitial) {
    const next = new URL(canonicalInitial, location.href)
    const preview = new URL(location.href).searchParams.get("preview")
    if (preview !== null) next.searchParams.set("preview", preview)
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
    applyRevision,
    canApplyRevision: () => environment.loadAppliedRevision !== undefined && sharedModuleEpoch !== null && /^[a-f0-9]{64}$/u.test(sharedModuleEpoch),
    dispose,
  })
}

function applyModel(shell: ExternalStorybookShell, model: ExternalStorybookPackageTabModel, navigation: ExternalStorybookClientSnapshot, content: ExternalStorybookClientSnapshot): void {
  shell.document.transaction(() => {
    shell.workbench.update("catalog.label", "Репозитории и пакеты")
    shell.workbench.update("catalog.items", navigationItems(deriveExternalStorybookLanding(navigation).catalogItems))
    shell.workbench.update("catalog.active", model.packageNode.id)
    shell.workbench.update("secondary.label", model.packageNode.label)
    shell.workbench.update("secondary.items", navigationItems(deriveExternalStorybookPackageContents(content, model.packageNode.packageId!)))
    shell.workbench.update("secondary.active", model.secondaryActiveId ?? model.catalogActiveId)
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
    ...(item.group === null ? {} : {group: item.group}),
    ...(item.parentId === undefined ? {} : {parentId: item.parentId}),
  })))
}

function tabItems(items: readonly ExternalStorybookBrowserVariantItem[]) {
  return Object.freeze(items.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    route: item.route,
    title: item.group === null ? item.title : `${item.group.label} · ${item.title}`,
  })))
}

function packageRouteFromPathname(pathname: string, packageId: string): string {
  const route = storybookPackageRouteFromPathname(pathname, packageId)
  if (route === null) throw new Error(`Unknown or ambiguous external Storybook package path: ${pathname}`)
  return route
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
  const styleSheets = mergeStorybookAuthorStyleSheets(
    graph.workbenchAuthorStyleSheets,
    graph.authorStyleSheets,
  )
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

function exactPresentationSubject(
  graph: StorybookPackageRevisionGraphSnapshot | null,
  snapshot: ExternalStorybookClientSnapshot,
  model: ExternalStorybookPackageTabModel,
): StorybookPresentationSubject | null {
  if (model.selectedNode.kind === "directory") return null
  const subjectId = model.secondaryActiveId
  if (subjectId === null) return null
  const matches = (graph?.nodes ?? snapshot.nodes).filter(({id}) => id === subjectId)
  const subject = matches[0]
  if (matches.length !== 1 || subject?.kind !== "subject" || subject.presentation === null) {
    throw new Error(`Storybook package model has no exact presentation subject: ${subjectId}`)
  }
  return Object.freeze({id: subject.id, kind: "subject", presentation: subject.presentation})
}

function exactRuntimePresentation(
  value: StorybookRuntimePresentationInput,
  shell: ExternalStorybookShell,
  presentation: StorybookPackageRevisionStoryPresentation,
  authorStyleSheetSpecifiers: readonly string[],
  diagnostics: readonly unknown[],
): Readonly<{
  node: SemanticNode
  inspectorValues: Readonly<Record<string, unknown>>
}> {
  const input = exactRecord(value, "Storybook runtime presentation")
  assertExactKeys(
    input,
    "Storybook runtime presentation",
    ["protocol", "node", "componentRoot", "source", "values"],
    ["protocol", "node", "componentRoot", "source"],
  )
  if (input.protocol !== STORYBOOK_PRESENTATION_PROTOCOL) {
    throw new Error(`Unsupported Storybook presentation protocol: ${String(input.protocol)}`)
  }
  const node = input.node as SemanticNode
  if (node === null || typeof node !== "object" || node.ownerDocument !== shell.document) {
    throw new TypeError("Storybook atomic presentation node must belong to the exact semantic Document")
  }
  const source = projectStorybookSource(
    input.source,
    input.componentRoot as StorybookRuntimePresentationInput["componentRoot"],
    shell.document,
    authorStyleSheetSpecifiers,
  )
  const values = input.values === undefined
    ? Object.freeze({}) as Readonly<Record<string, unknown>>
    : exactRecord(input.values, "Storybook presentation values")
  const selected = new Set(presentation.widgets)
  const derived = new Set(["source", "diagnostics", "dom", "layout", "display"])
  for (const key of Object.keys(values)) {
    if (derived.has(key)) {
      throw new Error(`Storybook presentation value is host-derived and forbidden: ${key}`)
    }
    if (!selected.has(key)) {
      throw new Error(`Storybook presentation value is unknown or unselected: ${key}`)
    }
  }
  const inspectorValues: Record<string, unknown> = {}
  for (const id of presentation.widgets) {
    if (id === "source") inspectorValues[id] = source
    else if (id === "diagnostics") inspectorValues[id] = Object.freeze([...diagnostics])
    else if (id === "dom") inspectorValues[id] = semanticNodeValue(node)
    else if (id === "layout") inspectorValues[id] = Object.freeze({state: "current-frame"})
    else if (id === "display") inspectorValues[id] = Object.freeze({state: "current-frame"})
    else inspectorValues[id] = values[id]
  }
  return Object.freeze({node, inspectorValues: Object.freeze(inspectorValues)})
}

function semanticNodeValue(node: SemanticNode): Readonly<Record<string, unknown>> {
  const candidate = node as SemanticNode & Readonly<{
    nodeName?: unknown
    localName?: unknown
    textContent?: unknown
    getAttributeNames?(): readonly string[]
    getAttribute?(name: string): string | null
  }>
  const attributes = typeof candidate.getAttributeNames === "function" &&
    typeof candidate.getAttribute === "function"
    ? Object.freeze(Object.fromEntries(candidate.getAttributeNames().map((name) =>
      [name, candidate.getAttribute!(name)] as const)))
    : Object.freeze({})
  return Object.freeze({
    nodeName: typeof candidate.nodeName === "string" ? candidate.nodeName : null,
    localName: typeof candidate.localName === "string" ? candidate.localName : null,
    textContent: typeof candidate.textContent === "string" ? candidate.textContent : null,
    attributes,
  })
}

function assertExactKeys(
  value: Record<string, unknown>,
  label: string,
  allowed: readonly string[],
  required: readonly string[],
): void {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new TypeError(`${label} has an unknown field: ${key}`)
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${label} is missing required field: ${key}`)
  }
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requiredSubjectPresentation(
  subject: StorybookPresentationSubject,
): StorybookPackageRevisionStoryPresentation {
  if (subject.kind !== "subject" || subject.presentation === null) {
    throw new Error(`Storybook subject has no required presentation: ${subject.id}`)
  }
  return subject.presentation
}

function validateStoryLoaders(
  value: ReadonlyMap<string, ExternalStorybookStoryLoader>,
): ReadonlyMap<string, ExternalStorybookStoryLoader> {
  if (!(value instanceof Map)) throw new TypeError("External Storybook storyLoaders must be a Map")
  return value
}

function validateWidgetLoaders(
  value: ReadonlyMap<string, ExternalStorybookWidgetLoader>,
): ReadonlyMap<string, ExternalStorybookWidgetLoader> {
  if (!(value instanceof Map)) throw new TypeError("External Storybook widgetLoaders must be a Map")
  for (const [id, loader] of value) {
    if (typeof id !== "string" || id.length === 0 || typeof loader !== "function") {
      throw new TypeError(`External Storybook widget loader is invalid: ${String(id)}`)
    }
  }
  return value
}

function validateRevisionWidgetLoaderKeys(
  graph: StorybookPackageRevisionGraphSnapshot | null,
  loaders: ReadonlyMap<string, ExternalStorybookWidgetLoader>,
): void {
  const expected = graph?.widgetLoaders.map(({id}) => id) ?? Object.freeze([])
  if (JSON.stringify([...loaders.keys()]) !== JSON.stringify(expected)) {
    throw new Error(`Storybook widget loader registry does not match its revision: ${graph?.packageId ?? "unavailable"}`)
  }
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
  const storyLoaders = validateStoryLoaders(value.storyLoaders)
  const widgetLoaders = validateWidgetLoaders(value.widgetLoaders ?? new Map())
  if (value.loadRuntime !== null && typeof value.loadRuntime !== "function") {
    throw new TypeError("Storybook applied revision runtime loader must be a function or null")
  }
  const expectedRoutes = graph.loaders.map(({route}) => route).sort()
  const actualRoutes = [...storyLoaders.keys()].sort()
  if (JSON.stringify(actualRoutes) !== JSON.stringify(expectedRoutes)) {
    throw new Error(`Storybook story loader registry does not match its applied revision: ${packageId}`)
  }
  validateRevisionWidgetLoaderKeys(graph, widgetLoaders)
  if (value.loadRuntime === null && storyLoaders.size > 0) {
    throw new Error(`Executable Storybook applied revision has no runtime: ${packageId}:${revision}`)
  }
  return Object.freeze({...value, graphSnapshot: graph, storyLoaders, widgetLoaders})
}

function assertCompatibleAuthorStyleSheets(
  current: StorybookPackageRevisionGraphSnapshot | null,
  next: StorybookPackageRevisionGraphSnapshot,
): void {
  const signature = (graph: StorybookPackageRevisionGraphSnapshot) => JSON.stringify([
    ...graph.workbenchAuthorStyleSheets.map(({specifier, contentDigest}) => ({specifier, contentDigest})),
    ...graph.authorStyleSheets.map(({specifier, contentDigest}) => ({specifier, contentDigest})),
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
  if (kind === "package") return `${children} категорий. Выберите категорию слева.`
  if (kind === "category") return `${children} предметов. Выберите предмет во второй панели.`
  if (kind === "subject") return `${children} вариантов. Выберите вариант в нижней панели.`
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
