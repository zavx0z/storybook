/**
Показывает состав проекта и обзоры его Repo, пакетов и директорий в общей странице.
Каталог и сообщения о подготовке обновляются из серверного снимка и событий;
выбор узла связывает адрес, Inspector и содержимое существующего Shell.
Встроенный запуск использует переданную оболочку, а самостоятельный освобождает
созданную оболочку при завершении. Переход к пакету передаётся владельцу страницы.

@packageDocumentation
*/
import WebProtocol from "@zavx0z/storybook-app-web-protocol"
import createHmrConnection from "@zavx0z/storybook-tech-hmr-connection"
import WebNavigationOwner from "@zavx0z/storybook-app-web-page-navigation"
const navigatePackage = WebNavigationOwner.navigatePackage
import ReadGraph from "@zavx0z/storybook-package-graph-read"
import {attachPickedDirectory, pickStorybookDirectory} from "./src/directory-picker.ts"

import type {CustomEvent} from "@zavx0z/immersive-dom"
import indexedWorkbenchAuthorStyleSheetSources from "@zavx0z/storybook-app-web-page-style-sheets"
import type {StorybookAppWebPageShellWorkbenchCatalog} from "@zavx0z/storybook-app-web-page-shell-workbench-catalog"
type WorkbenchCatalogAction = Parameters<StorybookAppWebPageShellWorkbenchCatalog.Input["onAction"]>[0]
type WorkbenchCatalogManagement = NonNullable<StorybookAppWebPageShellWorkbenchCatalog.Input["management"]>
const deriveExternalStorybookLanding = WebNavigationOwner.deriveExternalStorybookLanding
const deriveExternalStorybookLandingSelection = WebNavigationOwner.deriveExternalStorybookLandingSelection
const deriveExternalStorybookNavigationTree = WebNavigationOwner.deriveExternalStorybookNavigationTree
import createExternalStorybookShell from "@zavx0z/storybook-app-web-page-shell"
import WebClientOwner from "@zavx0z/storybook-app-web-page-client"
const externalStorybookClientNode = WebClientOwner.externalStorybookClientNode
const fetchExternalStorybookClientSnapshot = WebClientOwner.fetchExternalStorybookClientSnapshot
const readExternalStorybookNodeDocumentation = WebClientOwner.readExternalStorybookNodeDocumentation
const deriveStorybookBreadcrumbs = WebNavigationOwner.deriveStorybookBreadcrumbs
const storybookRootBreadcrumb = WebNavigationOwner.storybookRootBreadcrumb
const STORYBOOK_ROOT_BREADCRUMB = WebNavigationOwner.STORYBOOK_ROOT_BREADCRUMB
import WebStatusOwner from "@zavx0z/storybook-app-web-page-status"
const packageEventStatus = WebStatusOwner.packageEvent
const storybookConnectionStatus = WebStatusOwner.connection
const buildProgressStatus = WebStatusOwner.build
const catalogProgressStatus = WebStatusOwner.catalog
const readBuildProgress = WebStatusOwner.readBuild
const readCatalogProgress = WebStatusOwner.readCatalog
import type {StorybookAppWebPageHome} from "./contract"
type StartExternalStorybookLandingOptions = StorybookAppWebPageHome.Input
type ExternalStorybookLandingController = StorybookAppWebPageHome.Output
import {createLandingSocket, parseLandingEvent, navigationItems, overviewDescription, requestRegistryChange, isolateLandingError, errorText, assertActive} from './src/implementation'
export type {StorybookAppWebPageHome} from './contract'

async function startExternalStorybookLanding(
  options: StartExternalStorybookLandingOptions = {},
): Promise<ExternalStorybookLandingController> {
  const browserDocument = options.browserDocument ?? globalThis.document
  if (browserDocument === undefined) throw new Error("External Storybook landing Document is unavailable")
  const embeddedPageScope = options.pageScope
  const isSelected = () => embeddedPageScope?.isSelected?.() !== false
  if (embeddedPageScope === undefined) {
    if (isSelected()) browserDocument.documentElement.dataset.externalStorybook = "starting"
    if (isSelected()) browserDocument.documentElement.dataset.externalStorybookLanding = "starting"
  }
  const fetcher = options.fetcher ?? globalThis.fetch
  let snapshot = await fetchExternalStorybookClientSnapshot(fetcher)
  let graph = snapshot
  let landing = deriveExternalStorybookLanding(graph)
  const shell = embeddedPageScope?.shell ?? await createExternalStorybookShell({
    title: WebProtocol.pageTitle(null),
    browserDocument,
    ...(options.shell ?? {}),
    authorStyleSheetSources: options.shell?.authorStyleSheetSources ??
      indexedWorkbenchAuthorStyleSheetSources(browserDocument),
  })
  const location = options.location ?? globalThis.location
  const history = options.history ?? globalThis.history
  let selectionRevision = 0
  let selectedNodeId: string | null = null
  let disposed = false

  let management: WorkbenchCatalogManagement = {pending: false, error: "", removableIds: []}
  const updateManagement = (patch: Partial<WorkbenchCatalogManagement> = {}): void => {
    management = {...management, ...patch}
    management = {...management, removableIds: management.pending ? [] : landing.catalogItems.filter(item => item.parentId === undefined).map(item => item.id)}
    shell.workbench.update("catalog.management", null)
  }
  updateManagement()
  shell.document.transaction(() => {
    shell.workbench.update("inspector.subject", null)
    shell.workbench.configureInspector()
    shell.workbench.setChatContext({address: "/", label: snapshot.projectName, fetcher})
  })

  const restoreInspectorSelection = (): void => {
    const url = location === undefined ? null : new URL(location.href)
    const selected = url?.searchParams.get("inspector") === "tree" ? "tree" : "chat"
    shell.workbench.controller.selectInspector(selected)
    if (url === null || history?.replaceState === undefined) return
    if (url.searchParams.get("inspector") === selected) return
    url.searchParams.set("inspector", selected)
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
  }
  const publishChat = (address: string, label: string): void => {
    shell.workbench.setChatContext({address, label, fetcher})
  }

  shell.workbench.update("projectName", snapshot.projectName)
  shell.workbench.update("catalog.label", "Репозитории и пакеты")
  shell.workbench.update("catalog.items", navigationItems(deriveExternalStorybookNavigationTree(graph)))
  const showRootOverview = (): void => {
    selectedNodeId = null
    if (isSelected()) browserDocument.title = WebProtocol.pageTitle(null)
    selectionRevision += 1
    shell.document.transaction(() => {
      publishChat("/", snapshot.projectName)
      shell.workbench.update("catalog.active", null)
      shell.workbench.update("tabs.items", [])
      shell.workbench.update("tabs.active", null)
      shell.workbench.update("status", {
        lead: "",
        owner: "External Storybook",
        detail: "",
        breadcrumbs: [storybookRootBreadcrumb(shell.workbench.controller.read("projectName"))],
      })
      shell.showMessage(
        "External Storybook · Обзор",
        "External Storybook",
        "Выберите Repo или пакет в дереве. Состав Project читается из зависимостей package.json.",
      )
    })
    restoreInspectorSelection()
  }

  const breadcrumbsFor = (nodeId: string) => deriveStorybookBreadcrumbs(graph, nodeId, {kind: "landing"})

  const select = async (nodeId: string, updateHistory = true): Promise<void> => {
    assertActive(disposed)
    selectedNodeId = nodeId
    const revision = ++selectionRevision
    const target = externalStorybookClientNode(snapshot, nodeId)
    if (target.kind === "package") {
      if (location === undefined) throw new Error("Storybook navigation requires a browser location")
      if (embeddedPageScope !== undefined) {
        await embeddedPageScope.navigatePackage({packageId: target.packageId!, route: ""})
      } else await navigatePackage({packageId: target.packageId!, route: ""}, options.navigatePackage)
      return
    }
    const selection = deriveExternalStorybookLandingSelection(graph, nodeId)
    shell.document.transaction(() => {
      publishChat(ReadGraph.browsePath(selection.overviewNode), selection.overviewNode.label)
      shell.workbench.update("catalog.active", nodeId)
      shell.workbench.update("tabs.items", Object.freeze([]))
      shell.workbench.update("tabs.active", null)
      shell.workbench.update("status", {
        lead: "",
        owner: selection.overviewNode.label,
        detail: "",
        breadcrumbs: breadcrumbsFor(selection.overviewNode.id),
      })
    })
    const clientNode = externalStorybookClientNode(snapshot, selection.overviewNode.id)
    if (isSelected()) browserDocument.title = clientNode.label
    if (updateHistory && location !== undefined && history !== undefined &&
      location.pathname !== ReadGraph.browsePath(clientNode)) {
      history.pushState(null, "", ReadGraph.browsePath(clientNode))
    }
    restoreInspectorSelection()
    try {
      const documentation = await readExternalStorybookNodeDocumentation(clientNode, fetcher)
      if (disposed || revision !== selectionRevision) return
      if (documentation === null) {
        shell.showMessage(
          `${clientNode.label} · Обзор`,
          clientNode.label,
          overviewDescription(clientNode.kind),
        )
      } else {
        shell.showMarkdown(`${clientNode.label} · TSDoc`, documentation, clientNode.resourceUrl)
      }
      shell.clearDiagnostics()
    } catch (error) {
      if (disposed || revision !== selectionRevision) return
      shell.reportDiagnostic(errorText(error))
      shell.showMessage(`${clientNode.label} · Ошибка`, clientNode.label, errorText(error))
      shell.updateStatus(`${clientNode.label} · error`)
    }
  }

  let refreshRevision = 0
  const refreshRegistry = async (): Promise<void> => {
    const revision = ++refreshRevision
    const updated = await fetchExternalStorybookClientSnapshot(fetcher)
    if (disposed || revision !== refreshRevision) return
    snapshot = updated
    embeddedPageScope?.catalogChanged?.(updated)
    graph = updated
    landing = deriveExternalStorybookLanding(graph)
    shell.workbench.update("projectName", snapshot.projectName)
    shell.workbench.update("catalog.items", navigationItems(deriveExternalStorybookNavigationTree(graph)))
    updateManagement()
    if (selectedNodeId !== null && graph.nodes.some(node => node.id === selectedNodeId)) {
      const node = externalStorybookClientNode(snapshot, selectedNodeId)
      await select(node.id, false)
    } else {
      showRootOverview()
      if (location !== undefined && history !== undefined && location.pathname !== "/") {
        if ("replaceState" in history && typeof history.replaceState === "function") history.replaceState(null, "", "/")
        else history.pushState(null, "", "/")
      }
      restoreInspectorSelection()
    }
  }
  const changeRepository = async (action: WorkbenchCatalogAction): Promise<void> => {
    if (management.pending) return
    if (action.action === "detach" && !management.removableIds.includes(action.value ?? "")) return
    updateManagement({pending: true, error: ""})
    try {
      if (action.action === "attach") {
        const directory = await (options.pickDirectory?.() ?? pickStorybookDirectory())
        await attachPickedDirectory(directory, (operation, body) => requestRegistryChange(fetcher, browserDocument, {action: operation, body}, options.readerToken))
      } else {
        await requestRegistryChange(fetcher, browserDocument, {action: "detach", body: {scopeId: action.value!}}, options.readerToken)
      }
      await refreshRegistry()
      updateManagement({pending: false})
    } catch (error) {
      const cancelled = error instanceof Error && error.name === "AbortError"
      updateManagement({pending: false, error: cancelled ? "" : errorText(error)})
    }
  }
  const onCatalogAction = (event: unknown): void => {
    void changeRepository((event as CustomEvent<WorkbenchCatalogAction>).detail)
  }

  const onInspector = (event: unknown): void => {
    const id = (event as CustomEvent<{id?: unknown}>).detail?.id
    if (id !== "chat" && id !== "tree" || location === undefined || history === undefined) return
    const url = new URL(location.href)
    if (url.searchParams.get("inspector") === id) return
    url.searchParams.set("inspector", id)
    history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`)
  }

  const onNavigate = (event: unknown): void => {
    const detail = (event as CustomEvent<{id: string; kind?: string; urlPath?: string}>).detail
    if (detail.kind === "breadcrumb" && detail.id === STORYBOOK_ROOT_BREADCRUMB.id) {
      showRootOverview()
      if (location !== undefined && history !== undefined && location.pathname !== "/") history.pushState(null, "", "/")
      restoreInspectorSelection()
      return
    }
    const node = externalStorybookClientNode(snapshot, detail.id)
    if ((node.kind === "directory" || node.kind === "entry") && node.packageId !== null) {
      if (embeddedPageScope !== undefined) {
        followPageNavigation(embeddedPageScope.navigatePackage({packageId: node.packageId!, route: node.routePath!}))
      } else followPageNavigation(navigatePackage({packageId: node.packageId!, route: node.routePath!}, options.navigatePackage))
      return
    }
    const navigation = select(node.id)
    void navigation.catch((error) => isolateLandingError(browserDocument, shell, error))
  }

  const followPageNavigation = (operation: Promise<void>): void => {
    void operation.catch(error => {
      shell.reportDiagnostic(errorText(error))
      shell.updateStatus("Storybook · Переход не выполнен; показана текущая страница")
    })
  }

  shell.workbench.element.addEventListener(shell.workbench.events.catalogAction, onCatalogAction)
  shell.workbench.element.addEventListener(shell.workbench.events.navigate, onNavigate)
  shell.workbench.element.addEventListener(shell.workbench.events.inspector, onInspector)

  const socket = createLandingSocket(options, location?.href)
  if (socket !== null) shell.updateStatus(storybookConnectionStatus("connecting"))
  const onSocketMessage = (event: MessageEvent): void => {
    let decoded: unknown
    try { decoded = JSON.parse(String(event.data)) } catch {}
    const progress = readBuildProgress(decoded)
    if (progress !== null) {
      shell.updateStatus(buildProgressStatus(progress))
      return
    }
    const catalogProgress = readCatalogProgress(decoded)
    if (catalogProgress !== null) {
      shell.updateStatus(catalogProgressStatus(catalogProgress))
      return
    }
    const update = parseLandingEvent(event.data)
    if (update === null) return
    if (update.type === "registry.updated") {
      void refreshRegistry().catch(error => updateManagement({error: errorText(error)}))
    } else if (update.type === "shared.updated") {
      void embeddedPageScope?.refreshSharedHost?.().catch(error => {
        if (!disposed) shell.reportDiagnostic(error)
      })
    } else if (update.type === "shared.failed") {
      shell.reportDiagnostic(update.message)
    } else if (update.type === "package.failed") {
      shell.updateStatus(packageEventStatus(update.packageId, update.type))
    } else if (update.type === "package.updated") {
      shell.updateStatus(packageEventStatus(update.packageId, update.type))
    } else if (update.type === "package.built") {
      shell.updateStatus(packageEventStatus(update.packageId, update.type))
    } else if (update.type === "package.activating" || update.type === "package.code-updated" ||
      update.type === "package.resources-updated" || update.type === "package.metadata-updated") {
      shell.updateStatus(packageEventStatus(update.packageId, update.type))
    }
  }
  const connection = socket === null ? null : createHmrConnection({
    socket,
    ...(embeddedPageScope?.reconnectSocket ? {reconnect: () => embeddedPageScope.reconnectSocket!()} : {}),
    onOpen(socket, reconnected) {
      shell.updateStatus(storybookConnectionStatus(reconnected ? "reconnected" : "connected"))
      socket.send(JSON.stringify({type: "subscribe", topic: "registry"}))
    },
    onMessage: onSocketMessage,
    onClose() { shell.updateStatus(storybookConnectionStatus("disconnected")) },
  })

  const applyLandingPath = async (): Promise<void> => {
    const pathname = embeddedPageScope?.initialPathname ?? location?.pathname ?? "/"
    if (pathname === "/") {
      showRootOverview()
      return
    }
    const node = snapshot.nodes.find((candidate) => ReadGraph.browsePath(candidate) === pathname)
    if (node?.kind === "package" || node?.kind === "directory" || node?.kind === "entry" || node?.kind === "unavailable") await select(node.id, false)
    else throw new Error(`Unknown external Storybook landing pathname: ${pathname}`)
  }
  const onPopState = (): void => {
    void applyLandingPath().catch((error) => isolateLandingError(browserDocument, shell, error))
  }
  if (embeddedPageScope === undefined) globalThis.addEventListener?.("popstate", onPopState)
  await applyLandingPath()

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    selectionRevision += 1
    shell.workbench.element.removeEventListener(shell.workbench.events.catalogAction, onCatalogAction)
    shell.workbench.element.removeEventListener(shell.workbench.events.navigate, onNavigate)
    shell.workbench.element.removeEventListener(shell.workbench.events.inspector, onInspector)
    connection?.dispose()
    if (embeddedPageScope === undefined) globalThis.removeEventListener?.("popstate", onPopState)
    if (embeddedPageScope === undefined) shell.dispose()
  }
  if (embeddedPageScope === undefined) globalThis.addEventListener?.("pagehide", dispose, {once: true})
  shell.presentFrame()
  shell.workbench.element.setAttribute("aria-label", browserDocument.title || "Storybook")
  delete browserDocument.documentElement.dataset.externalStorybookPackage
  delete browserDocument.documentElement.dataset.externalStorybookPackageId
  delete browserDocument.documentElement.dataset.externalStorybookRevision
  delete browserDocument.documentElement.dataset.externalStorybookRoute
  if (isSelected()) browserDocument.documentElement.dataset.externalStorybook = "ready"
  if (isSelected()) browserDocument.documentElement.dataset.externalStorybookLanding = "ready"
  return Object.freeze({get snapshot() { return snapshot }, shell, select, dispose})
}

export default startExternalStorybookLanding
