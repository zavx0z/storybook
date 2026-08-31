/** One package-tab realm driven by generated literal runtime/story loaders. */

import type {CustomEvent, Node as SemanticNode} from "@zavx0z/dom"
import {createDomInspector} from "@zavx0z/dom-devtools"
import type {BrowserLinkedAuthorStyleSheetSource} from "@zavx0z/renderer-browser"
import {isCompiledTemplate, type CompiledTemplate} from "@zavx0z/template/compiled"
import {
  WORKBENCH_EVENTS,
  type WorkbenchInspectorCustomWidgetRegistration,
  type WorkbenchPresentationUpdate,
} from "../../workbench/contract.ts"
import {WORKBENCH_STANDARD_WIDGET_REGISTRY} from "../../workbench/inspector/registry.ts"
import {mergeStorybookAuthorStyleSheets} from "../author-style-sheets.ts"
import {externalStorybookPageTitle} from "../page-title.ts"
import {createStorybookAgentBridge, type StorybookAgentBridge} from "./agent-bridge.ts"
import {
  STORYBOOK_PRESENTATION_PROTOCOL,
  validateStorybookRuntimeAdapter,
  validateStorybookRuntimeSession,
  type StorybookRuntimeAdapter,
  type StorybookRuntimeContext,
  type StorybookRuntimePresentationInput,
  type StorybookRuntimeSession,
  type StorybookWorldPreview,
} from "../runtime-protocol.ts"
import {
  decodeExternalStorybookPackagePath,
  encodeExternalStorybookPackagePath,
  EXTERNAL_STORYBOOK_CLIENT_PROTOCOL,
  type ExternalStorybookClientPackageSummary,
  type ExternalStorybookClientSnapshot,
} from "./client-protocol.ts"
import {
  validateStorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionStoryPresentation,
} from "../package-revision.ts"
import {
  deriveExternalStorybookPackageTab,
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
  type StorybookAggregatePresentationItem,
} from "./aggregate-presentation.tsx"
import {
  disposeStorybookAggregateChildren,
  mountStorybookAggregateChildren,
  planStorybookOverview,
  type MountedStorybookAggregateChild,
} from "./aggregate-runtime.ts"

export type ExternalStorybookStoryLoader = () => Promise<unknown>
export type ExternalStorybookWidgetLoader = () => Promise<unknown>
export type ExternalStorybookRuntimeLoader = (() => Promise<unknown>) | null

type ExternalStorybookSocket = Readonly<{
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
  projection: StorybookPackageRevisionStoryPresentation["projection"]
  presented: boolean
  presentedNode: SemanticNode | null
  worldNode: SemanticNode | null
}

type StorybookPresentationSubject = Readonly<{
  id: string
  kind: "subject"
  presentation: StorybookPackageRevisionStoryPresentation
}>

type MountedStorybookAggregate = Readonly<{
  presentation: StorybookAggregatePresentation
  children: readonly MountedStorybookAggregateChild[]
}>

export type ExternalStorybookPackageEnvironment = Readonly<{
  fetcher?: typeof fetch
  browserDocument?: globalThis.Document
  location?: Pick<Location, "pathname" | "href" | "reload">
  history?: Pick<History, "pushState" | "replaceState">
  createSocket?(url: string): ExternalStorybookSocket
  /** Focused test seam; production waits on the renderer-presented frame sequence. */
  waitForFrame?(): Promise<void>
  shell?: Omit<
    CreateExternalStorybookShellOptions,
    "title" | "browserDocument" | "authorStyleSheetSources"
  >
  acknowledgeActivation?(input: Readonly<{
    packageId: string
    revision: string
    packageGraphDigest: string
    route: string
    frameSequence: number
    working: boolean
    diagnostic?: string
  }>): Promise<void>
  /** Focused lifecycle cancellation seam; browser production also uses pagehide. */
  lifecycleSignal?: AbortSignal
  /** Focused cleanup seam; production bounds uncooperative owner cleanup. */
  cleanupTimeoutMs?: number
}>

export type StartExternalStorybookPackageInput = Readonly<{
  packageId: string
  candidateRevision: string | null
  revisionUrl: string | null
  loadRuntime: ExternalStorybookRuntimeLoader
  storyLoaders: ReadonlyMap<string, ExternalStorybookStoryLoader>
  widgetLoaders?: ReadonlyMap<string, ExternalStorybookWidgetLoader>
  graphSnapshot?: StorybookPackageRevisionGraphSnapshot
  environment?: ExternalStorybookPackageEnvironment
}>

export type ExternalStorybookPackageController = Readonly<{
  snapshot: ExternalStorybookClientSnapshot
  shell: ExternalStorybookShell
  get currentRoute(): string
  navigate(route: string): Promise<void>
  dispose(): Promise<void>
}>

export async function startExternalStorybookPackage(
  input: StartExternalStorybookPackageInput,
): Promise<ExternalStorybookPackageController> {
  const packageId = exactPackageId(input.packageId)
  const candidateRevision = input.candidateRevision === null ? null : safeRevision(input.candidateRevision)
  validateRevisionUrl(packageId, candidateRevision, input.revisionUrl)
  const storyLoaders = validateStoryLoaders(input.storyLoaders)
  const widgetLoaders = validateWidgetLoaders(input.widgetLoaders ?? new Map())
  if (input.loadRuntime !== null && typeof input.loadRuntime !== "function") {
    throw new TypeError("External Storybook runtime loader must be a function or null")
  }
  const environment = input.environment ?? {}
  const browserDocument = environment.browserDocument ?? globalThis.document
  const location = environment.location ?? globalThis.location
  const history = environment.history ?? globalThis.history
  if (browserDocument === undefined || location === undefined || history === undefined) {
    throw new Error("External Storybook package browser environment is unavailable")
  }
  if (browserDocument.defaultView !== null && browserDocument.defaultView !== undefined) {
    browserDocument.defaultView.name = `storybook:${packageId}`
  }
  browserDocument.documentElement.dataset.externalStorybook = "starting"
  browserDocument.documentElement.dataset.externalStorybookPackage = "starting"
  browserDocument.documentElement.dataset.externalStorybookPackageId = packageId
  browserDocument.documentElement.dataset.externalStorybookRevision = candidateRevision ?? "unavailable"
  browserDocument.documentElement.dataset.externalStorybookPhase = "snapshot"

  const fetcher = environment.fetcher ?? globalThis.fetch
  const revisionGraph = input.graphSnapshot === undefined
    ? null
    : validateStorybookPackageRevisionGraphSnapshot(input.graphSnapshot, packageId)
  validateRevisionWidgetLoaderKeys(revisionGraph, widgetLoaders)
  const bootstrap = await (async () => {
    try {
      const snapshot = revisionGraph === null
        ? await fetchExternalStorybookClientSnapshot(fetcher)
        : revisionClientSnapshot(revisionGraph, candidateRevision, input.revisionUrl)
      const summary = exactPackageSummary(snapshot, packageId)
      if (candidateRevision !== null &&
        summary.builtRevision !== candidateRevision && summary.activatingRevision !== candidateRevision &&
        summary.activeRevision !== candidateRevision && summary.lastWorkingRevision !== candidateRevision) {
        throw new Error(`External Storybook revision is not active or last-good, built, activating, or last-working: ${candidateRevision}`)
      }
      if (candidateRevision === null && (input.loadRuntime !== null || storyLoaders.size > 0)) {
        throw new Error(`Unavailable Storybook package cannot receive executable loaders: ${packageId}`)
      }
      for (const [route, loader] of storyLoaders) {
        if (typeof loader !== "function") throw new TypeError(`External Storybook story loader is not callable: ${route}`)
        const model = deriveExternalStorybookPackageTab(snapshot, packageId, route)
        if (model.selectedNode.kind !== "variant") {
          throw new Error(`External Storybook story loader route is not a variant: ${route}`)
        }
      }
      const initialRoute = packageRouteFromPathname(location.pathname, packageId)
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
  const {snapshot, summary, graph, initialRoute, initialModel} = bootstrap
  browserDocument.documentElement.dataset.externalStorybookPhase = "shell"
  let shell: ExternalStorybookShell
  try {
    shell = await createExternalStorybookShell({
      title: externalStorybookPageTitle(packageId, initialModel.packageNode.label),
      browserDocument,
      ...(environment.shell ?? {}),
      authorStyleSheetSources: exactAuthorStyleSheetSources(
        browserDocument,
        revisionGraph,
        input.revisionUrl,
      ),
    })
  } catch (error) {
    const diagnostic = errorText(error)
    browserDocument.documentElement.dataset.externalStorybook = "error"
    browserDocument.documentElement.dataset.externalStorybookPackage = "error"
    browserDocument.documentElement.dataset.externalStorybookPhase = "error"
    browserDocument.documentElement.dataset.externalStorybookError = diagnostic.slice(0, 2_048)
    if (candidateRevision !== null) {
      try {
        await acknowledgeActivation(environment, browserDocument, {
          packageId,
          revision: candidateRevision,
          packageGraphDigest: snapshot.graphDigest,
          route: initialRoute,
          frameSequence: 0,
          working: false,
          diagnostic,
        })
        const fallbackRevision = readMetaContent(browserDocument, "external-storybook-fallback-revision")
        if (fallbackRevision !== undefined && fallbackRevision !== candidateRevision) location.reload()
      } catch {
        // The exact shell/bootstrap failure remains the primary diagnostic.
      }
    }
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
  let activePresentationView: WorkbenchPresentationUpdate | null = null
  let routeDiagnostics: unknown[] = []
  let operationTail: Promise<void> = Promise.resolve()
  let disposePromise: Promise<void> | null = null
  let agentBridge: StorybookAgentBridge | null = null
  let activeWorldPreview: StorybookWorldPreview | null = null
  const customWidgetComponents = new Map<
    string,
    CompiledTemplate<Readonly<{value: unknown}>>
  >()
  let reloadingFallback = false
  let disposed = false
  const presentationInspector = createDomInspector({
    document: shell.document,
    ...(shell.workbenchOverlay.renderer === undefined
      ? {}
      : {renderer: shell.workbenchOverlay.renderer}),
  })
  let derivedPresentationSignature = ""

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
        candidate as CompiledTemplate<Readonly<{value: unknown}>>,
      )
    }
    const customRegistry: WorkbenchInspectorCustomWidgetRegistration[] = []
    for (const item of revisionGraph?.widgetContributions?.items ?? []) {
      if (item.kind !== "component") continue
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

  const disposeWorldPreview = (): void => {
    const preview = activeWorldPreview
    activeWorldPreview = null
    preview?.dispose()
  }

  const refreshDiagnostics = (): void => {
    const current = activePresentationView
    if (current === null) return
    const next = Object.freeze({
      ...current,
      inspectorValues: Object.freeze({
        ...current.inspectorValues,
        diagnostics: Object.freeze([...routeDiagnostics]),
      }),
    })
    activePresentationView = next
    shell.workbench.present(next)
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
    activePresentationView = next
    shell.workbench.present(next)
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
        if (operation.worldNode !== null && operation.worldNode !== committed.node) {
          throw new Error("Storybook world preview node differs from the atomic presentation node")
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
            widgetIds: presentation.widgets,
          }),
          inspectorValues: committed.inspectorValues,
        })
        activePresentationView = next
        shell.present(next)
      },
      reportDiagnostic(value: unknown) {
        const selectedSubject = exactPresentationSubject(revisionGraph, snapshot, currentModel)
        if (signal.aborted || selectedSubject?.id !== subject.id) {
          throw new Error("External Storybook runtime attempted a stale diagnostic")
        }
        reportDiagnostic(value)
      },
      requestRender() {
        shell.requestRender()
      },
    } as const
    if (presentation.projection !== "world") {
      return Object.freeze({...base, projection: presentation.projection})
    }
    return Object.freeze({
      ...base,
      projection: "world" as const,
      space: shell.runtime.space,
      mountWorldPreview(registration: Parameters<ExternalStorybookShell["mountWorldPreview"]>[1]) {
        const operation = activeOperation(subject.id, presentation.projection)
        if (operation.worldNode !== null) {
          throw new Error("Storybook runtime mount/update registered more than one world preview")
        }
        operation.worldNode = registration.node
        if (operation.presentedNode !== null && operation.presentedNode !== registration.node) {
          throw new Error("Storybook world preview node differs from the atomic presentation node")
        }
        disposeWorldPreview()
        const preview = shell.mountWorldPreview(currentModel.selectedNode.label, registration)
        activeWorldPreview = preview
        return preview
      },
    })
  }

  const ensureRuntimeAdapter = (): Promise<StorybookRuntimeAdapter> => {
    if (runtimeAdapterPromise !== null) return runtimeAdapterPromise
    if (input.loadRuntime === null) {
      throw new Error(`Executable Storybook variant has no runtime: ${packageId}`)
    }
    runtimeAdapterPromise = Promise.resolve()
      .then(() => input.loadRuntime!())
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
    await disposeStorybookAggregateChildren(current.children)
    current.presentation.dispose()
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
    if (plan.length === 0 || plan.some(({subject}) =>
      subject.presentation.projection === "world")) return false
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
    try {
      const aggregateSignal = AbortSignal.any([lifetime.signal, signal])
      const adapter = await abortable(ensureRuntimeAdapter(), aggregateSignal)
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
      const node = externalStorybookClientNode(snapshot, model.selectedNode.id)
      const aggregatePresentation = createStorybookAggregatePresentation(
        shell.document,
        `${node.label} · Обзор`,
        Object.freeze(children.map((child): StorybookAggregatePresentationItem => Object.freeze({
          id: child.plan.id,
          label: child.plan.label,
          route: child.plan.route,
          presentation: child.presentation,
        }))),
      )
      pendingPresentation = aggregatePresentation
      const overviewSubject = exactPresentationSubject(revisionGraph, snapshot, model)
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
        const subjectPresentation = requiredSubjectPresentation(overviewSubject)
        const committed = exactRuntimePresentation(
          Object.freeze({
            protocol: STORYBOOK_PRESENTATION_PROTOCOL,
            node: aggregatePresentation.element,
            componentRoot: aggregatePresentation.componentRoot,
            source: aggregatePresentation.source,
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
          projection: "display" as const,
        }),
        inspectorSubject,
        inspectorValues,
      })
      activePresentationView = next
      shell.workbench.present(next)
      shell.requestRender()
      aggregate = Object.freeze({
        presentation: aggregatePresentation,
        children: Object.freeze([...children]),
      })
      pendingPresentation = null
      return true
    } catch (error) {
      pendingPresentation?.dispose()
      await disposeStorybookAggregateChildren(children, error, true)
      throw error
    }
  }

  const showOverview = async (
    model: ExternalStorybookPackageTabModel,
    revision: number,
    signal: AbortSignal,
  ): Promise<void> => {
    disposeWorldPreview()
    if (await showAggregateOverview(model, revision, signal)) return
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
    const readme = await readExternalStorybookNodeReadme(node, fetcher)
    if (disposed || revision !== navigationRevision) return
    const label = readme === null ? `${node.label} · Обзор` : `${node.label} · README`
    const presentationNode = readme === null
      ? shell.showMessage(label, node.label, overviewDescription(node.kind, node.childIds.length))
      : shell.showMarkdown(label, readme, node.resourceUrl)
    const subjectPresentation = overviewSubject === null
      ? null
      : requiredSubjectPresentation(overviewSubject)
    const next = Object.freeze({
      label,
      presentation: Object.freeze({node: presentationNode, projection: "display" as const}),
      inspectorSubject: overviewSubject === null || subjectPresentation === null
        ? null
        : Object.freeze({
          packageId,
          subjectId: overviewSubject.id,
          widgetIds: subjectPresentation.widgets,
        }),
      inspectorValues: Object.freeze({diagnostics: Object.freeze([...routeDiagnostics])}),
    })
    activePresentationView = next
    shell.workbench.present(next)
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
    disposeWorldPreview()
    await disposeAggregate()
    shell.showMessage(`${model.selectedNode.label} · Загрузка`, model.selectedNode.label, "Загрузка owner story…")
    const [runtimeRecord, story] = await abortable(Promise.all([ensureSession(subject), loader()]), signal)
    if (disposed || revision !== navigationRevision || signal.aborted) return
    const storyInput = Object.freeze({route, story, signal})
    const operation: StorybookPresentationOperation = {
      revision,
      subjectId: subject.id,
      projection: presentation.projection,
      presented: false,
      presentedNode: null,
      worldNode: null,
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
          disposeWorldPreview()
          return
        }
      }
      if (!operation.presented) {
        throw new Error(`Storybook runtime mount/update published no atomic presentation: ${route}`)
      }
      if (operation.worldNode !== null && operation.worldNode !== operation.presentedNode) {
        throw new Error("Storybook world preview node differs from the atomic presentation node")
      }
      mountedRoute = route
    } catch (error) {
      mountedRoute = null
      disposeWorldPreview()
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
    if (presentationSubject !== null) await ensureInspectorRegistry(presentationSubject)
    if (revision !== navigationRevision || signal.aborted) return
    currentRoute = route
    currentModel = model
    browserDocument.documentElement.dataset.externalStorybookPackage = "starting"
    browserDocument.documentElement.dataset.externalStorybookRoute = route
    applyModel(shell, model)
    routeDiagnostics = []
    activePresentationView = null
    derivedPresentationSignature = ""
    for (const diagnostic of summary.diagnostics) reportDiagnostic(diagnostic)
    try {
      if (candidateRevision === null && summary.buildState === "failed") {
        throw new Error(summary.diagnostics.map(({message}) => message).join("\n") ||
          `Package ${packageId} has no last-good revision`)
      }
      if (model.selectedNode.kind === "variant") {
        await showVariant(model, revision, signal)
      } else {
        await showOverview(model, revision, signal)
      }
      if (disposed || revision !== navigationRevision || signal.aborted) return
      shell.updateStatus(`${packageId} · ${route.length === 0 ? "overview" : route}`)
      const beforeFrame = shell.presentedFrameSequence
      if (environment.waitForFrame !== undefined) {
        await environment.waitForFrame()
        if (refreshDerivedPresentation()) shell.requestRender()
      }
      else {
        let frameSequence = shell.presentFrame()
        if (frameSequence <= beforeFrame) throw new Error("Storybook activation did not present a new frame")
        if (refreshDerivedPresentation()) frameSequence = shell.presentFrame()
      }
      if (disposed || revision !== navigationRevision || signal.aborted) return
      browserDocument.documentElement.dataset.externalStorybook = "ready"
      browserDocument.documentElement.dataset.externalStorybookPackage = "ready"
    } catch (error) {
      if (disposed || revision !== navigationRevision) return
      isolatePackageError(browserDocument, shell, model, error)
      if (failActivation) throw error
    }
  }

  const scheduleRoute = (route: string, failActivation = false): Promise<void> => {
    assertActive(disposed)
    const model = deriveExternalStorybookPackageTab(graph, packageId, route)
    if (location.pathname !== model.selectedNode.urlPath) {
      history.pushState(null, "", model.selectedNode.urlPath)
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
  const onNavigate = (event: unknown): void => {
    const route = (event as CustomEvent<{route: string}>).detail.route
    void navigate(route).catch((error) => isolatePackageError(browserDocument, shell, currentModel, error))
  }
  const onScenario = (event: unknown): void => {
    const id = (event as CustomEvent<{id: string}>).detail.id
    const item = currentModel.variants.find((variant) => variant.id === id)
    if (item === undefined) {
      isolatePackageError(browserDocument, shell, currentModel, new Error(`Unknown Storybook variant item: ${id}`))
      return
    }
    void navigate(item.route).catch((error) => isolatePackageError(browserDocument, shell, currentModel, error))
  }
  const onPopState = (): void => {
    try {
      const route = packageRouteFromPathname(location.pathname, packageId)
      void scheduleRoute(route)
    } catch (error) {
      isolatePackageError(browserDocument, shell, currentModel, error)
    }
  }
  shell.workbench.element.addEventListener(WORKBENCH_EVENTS.navigate, onNavigate)
  shell.workbench.element.addEventListener(WORKBENCH_EVENTS.scenario, onScenario)
  globalThis.addEventListener?.("popstate", onPopState)

  const socket = createPackageSocket(
    environment,
    location.href,
    readBrowserSessionToken(browserDocument),
  )
  const onSocketOpen = (): void => {
    socket.send(JSON.stringify({type: "subscribe", topic: `package:${packageId}`}))
  }
  const onSocketMessage = (event: MessageEvent): void => {
    const update = parsePackageEvent(event.data)
    if (update === null || update.packageId !== packageId) return
    if (update.type === "package.built") {
      if (update.revision !== candidateRevision) location.reload()
      return
    }
    if (update.type === "package.updated") {
      if (update.revision !== candidateRevision) location.reload()
      return
    }
    if (update.type === "package.resources-updated" || update.type === "package.metadata-updated") {
      shell.updateStatus(`${packageId} · ${update.type}`)
      return
    }
    if (update.type === "package.code-updated") return
    if (update.type === "package.failed") {
      const fallbackRevision = readMetaContent(browserDocument, "external-storybook-fallback-revision")
      if (update.revision === candidateRevision && fallbackRevision !== undefined &&
        fallbackRevision !== candidateRevision && !reloadingFallback) {
        reloadingFallback = true
        const reason = new Error(`Storybook candidate activation failed: ${candidateRevision}`)
        routeAbort.abort(reason)
        void dispose(reason)
        location.reload()
        return
      }
      for (const diagnostic of update.diagnostics) reportDiagnostic(diagnostic)
      shell.updateStatus(`${packageId} · last-good · build failed`)
      return
    }
    reportDiagnostic(`Package detached: ${packageId}`)
    shell.updateStatus(`${packageId} · detached`)
  }
  socket.addEventListener("open", onSocketOpen)
  socket.addEventListener("message", onSocketMessage)

  const dispose = async (reason?: unknown): Promise<void> => {
    if (disposePromise !== null) return disposePromise
    disposed = true
    navigationRevision += 1
    lifetime.abort(reason)
    routeAbort.abort()
    socket.removeEventListener("open", onSocketOpen)
    socket.removeEventListener("message", onSocketMessage)
    socket.close()
    globalThis.removeEventListener?.("popstate", onPopState)
    globalThis.removeEventListener?.("pagehide", onPageHide)
    environment.lifecycleSignal?.removeEventListener("abort", onPageHide)
    shell.workbench.element.removeEventListener(WORKBENCH_EVENTS.navigate, onNavigate)
    shell.workbench.element.removeEventListener(WORKBENCH_EVENTS.scenario, onScenario)
    const cleanupTimeoutMs = boundedCleanupTimeout(environment.cleanupTimeoutMs ?? 5_000)
    disposePromise = (async () => {
      try {
        const deadline = Date.now() + cleanupTimeoutMs
        await settleBefore(operationTail, deadline)
        if (sessionPromise !== null) await settleBefore(sessionPromise, deadline)
        if (aggregate !== null) await settleBefore(disposeAggregate(), deadline)
        if (session !== null) {
          disposeWorldPreview()
          if (mountedRoute !== null) await settleBefore(Promise.resolve(session.session.unmount()), deadline)
          session.abort.abort(reason)
          await settleBefore(Promise.resolve(session.session.dispose()), deadline)
        }
      } finally {
        agentBridge?.dispose()
        presentationInspector.dispose()
        shell.dispose()
      }
    })()
    return disposePromise
  }
  const onPageHide = (): void => { void dispose(environment.lifecycleSignal?.reason) }
  globalThis.addEventListener?.("pagehide", onPageHide, {once: true})
  environment.lifecycleSignal?.addEventListener("abort", onPageHide, {once: true})
  if (environment.lifecycleSignal?.aborted === true) onPageHide()

  const canonicalInitial = currentModel.selectedNode.urlPath
  if (location.pathname !== canonicalInitial) history.replaceState(null, "", canonicalInitial)
  try {
    browserDocument.documentElement.dataset.externalStorybookPhase = "route"
    await scheduleRoute(currentRoute, true)
    browserDocument.documentElement.dataset.externalStorybookPhase = "bridge"
    agentBridge = createStorybookAgentBridge({
      packageId,
      revision: candidateRevision ?? "unavailable",
      graphDigest: snapshot.graphDigest,
      shell,
      getRoute: () => currentRoute,
      getModel: () => currentModel,
      navigate,
    })
    if (candidateRevision !== null) {
      browserDocument.documentElement.dataset.externalStorybookPhase = "activation"
      await acknowledgeActivation(environment, browserDocument, {
        packageId,
        revision: candidateRevision,
        packageGraphDigest: snapshot.graphDigest,
        route: currentRoute,
        frameSequence: shell.presentedFrameSequence,
        working: true,
      })
    }
    browserDocument.documentElement.dataset.externalStorybookPhase = "ready"
  } catch (error) {
    browserDocument.documentElement.dataset.externalStorybookPhase = "error"
    if (disposed) {
      await dispose(environment.lifecycleSignal?.reason)
      throw lifetime.signal.reason ?? error
    }
    if (candidateRevision !== null) {
      try {
        await acknowledgeActivation(environment, browserDocument, {
          packageId,
          revision: candidateRevision,
          packageGraphDigest: snapshot.graphDigest,
          route: currentRoute,
          frameSequence: shell.presentedFrameSequence,
          working: false,
          diagnostic: errorText(error),
        })
        const fallbackRevision = readMetaContent(browserDocument, "external-storybook-fallback-revision")
        if (fallbackRevision !== undefined && fallbackRevision !== candidateRevision) {
          browserDocument.documentElement.dataset.externalStorybookPhase = "fallback"
          reloadingFallback = true
          location.reload()
        }
      } catch {
        // The isolated candidate error remains visible when acknowledgement itself fails.
      }
    }
    if (!reloadingFallback) {
      agentBridge ??= createStorybookAgentBridge({
        packageId,
        revision: candidateRevision ?? "unavailable",
        graphDigest: snapshot.graphDigest,
        shell,
        getRoute: () => currentRoute,
        getModel: () => currentModel,
        navigate,
      })
    }
  }

  return Object.freeze({
    snapshot,
    shell,
    get currentRoute() {
      return currentRoute
    },
    navigate,
    dispose,
  })
}

function applyModel(shell: ExternalStorybookShell, model: ExternalStorybookPackageTabModel): void {
  shell.document.transaction(() => {
    shell.workbench.update("catalog.label", model.packageNode.label)
    shell.workbench.update("catalog.items", navigationItems(model.catalogItems))
    shell.workbench.update("catalog.active", model.catalogActiveId)
    shell.workbench.update(
      "secondary.label",
      model.catalogItems.find(({id}) => id === model.catalogActiveId)?.label ?? "Предметы",
    )
    shell.workbench.update("secondary.items", navigationItems(model.secondaryItems))
    shell.workbench.update("secondary.active", model.secondaryActiveId)
    shell.workbench.update("scenarios.label", "Варианты")
    shell.workbench.update("scenarios.items", variantItems(model.variants))
    shell.workbench.update("scenarios.active", model.variantActiveId)
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
  })))
}

function variantItems(items: readonly ExternalStorybookBrowserVariantItem[]) {
  return Object.freeze(items.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    title: item.group === null ? item.title : `${item.group.label} · ${item.title}`,
  })))
}

function packageRouteFromPathname(pathname: string, packageId: string): string {
  const segments = pathname.split("/")
  if (segments[0] !== "" || segments[1] !== "packages" || segments[2] === undefined) {
    throw new Error(`External Storybook package pathname is malformed: ${pathname}`)
  }
  const pathnamePackage = decodeExternalStorybookPackagePath(segments[2])
  if (pathnamePackage !== packageId) {
    throw new Error(`External Storybook package pathname belongs to ${pathnamePackage}, expected ${packageId}`)
  }
  const encodedRoute = segments.slice(3)
  if (encodedRoute.at(-1) === "") encodedRoute.pop()
  if (encodedRoute.some((segment) => segment.length === 0)) {
    throw new Error(`External Storybook package pathname is malformed: ${pathname}`)
  }
  return encodedRoute.map((segment) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(segment)
    } catch (error) {
      throw new Error(`External Storybook route segment is malformed: ${segment}`, {cause: error})
    }
    if (encodeURIComponent(decoded) !== segment) {
      throw new Error(`External Storybook route segment is not canonical: ${segment}`)
    }
    return decoded
  }).join("/")
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
): readonly BrowserLinkedAuthorStyleSheetSource[] {
  if (graph === null) return Object.freeze([])
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

async function acknowledgeActivation(
  environment: ExternalStorybookPackageEnvironment,
  browserDocument: globalThis.Document,
  input: Readonly<{
    packageId: string
    revision: string
    packageGraphDigest: string
    route: string
    frameSequence: number
    working: boolean
    diagnostic?: string
  }>,
): Promise<void> {
  if (environment.acknowledgeActivation !== undefined) {
    await environment.acknowledgeActivation(input)
    return
  }
  const activationId = readMetaContent(browserDocument, "external-storybook-activation-id")
  const sessionToken = readBrowserSessionToken(browserDocument)
  if (activationId === undefined || sessionToken === undefined) return
  const response = await (environment.fetcher ?? globalThis.fetch)("/api/browser/activation", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-storybook-session": sessionToken,
    },
    body: JSON.stringify({...input, activationId}),
  })
  if (!response.ok) throw new Error(`Storybook activation acknowledgement failed: ${response.status}`)
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
