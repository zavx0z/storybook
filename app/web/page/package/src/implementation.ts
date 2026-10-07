import WebProtocol from "@zavx0z/storybook-app-web-protocol"

import {type StorybookTechHmrConnection} from "@zavx0z/storybook-tech-hmr-connection"
import StorybookAppWebPagePackageScenarioInspector from "@zavx0z/storybook-app-web-page-package-scenario-inspector"

import indexedWorkbenchAuthorStyleSheetSources from "@zavx0z/storybook-app-web-page-style-sheets"
import WebNavigationOwner from "@zavx0z/storybook-app-web-page-navigation"

/** Вкладка структурного владельца с подготовленными сценариями. */

import type {RootLinkedAuthorStyleSheet} from "@zavx0z/immersive-browser/integration"
import type {CompiledTemplate} from "@zavx0z/immersive-template/compiled"
import {arrowDownIcon, arrowUpIcon} from "@zavx0z/immersive-ui-theme-icon"

import type {StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
type WorkbenchInspectorCustomWidgetProps = Extract<ReturnType<StorybookAppWebPageShellWorkbench.Output["getSnapshot"]>["state"]["inspector.registry"][number], {kind: "custom"}>["component"] extends CompiledTemplate<infer Props> ? Props : never
type WorkbenchInspectorCustomWidgetRegistration = Extract<ReturnType<StorybookAppWebPageShellWorkbench.Output["getSnapshot"]>["state"]["inspector.registry"][number], {kind: "custom"}>

import Revision from "@zavx0z/storybook-package-revision"
const storybookRootBreadcrumb = WebNavigationOwner.storybookRootBreadcrumb
const STORYBOOK_ROOT_BREADCRUMB = WebNavigationOwner.STORYBOOK_ROOT_BREADCRUMB
const deriveExternalStorybookPackageTab = WebNavigationOwner.deriveExternalStorybookPackageTab
const deriveExternalStorybookNavigationTree = WebNavigationOwner.deriveExternalStorybookNavigationTree
import type {StorybookAppWebPageNavigation} from "@zavx0z/storybook-app-web-page-navigation"
type ExternalStorybookBrowserNavigationItem = ReturnType<StorybookAppWebPageNavigation.Output["deriveExternalStorybookNavigationTree"]>[number]
type ExternalStorybookBrowserTabItem = ReturnType<StorybookAppWebPageNavigation.Output["deriveExternalStorybookPackageTab"]>["tabs"][number]
type ExternalStorybookPackageTabModel = ReturnType<StorybookAppWebPageNavigation.Output["deriveExternalStorybookPackageTab"]>

import type {StorybookAppWebPageShell} from "@zavx0z/storybook-app-web-page-shell"
type ExternalStorybookShell = StorybookAppWebPageShell.Output
import {StorybookContractOutline} from "./contract-outline.tsx"

import type {ExternalStorybookClientSnapshot, StorybookPackageRevisionGraphSnapshot, ExternalStorybookScenarioLoader, ExternalStorybookAppliedRevision, ExternalStorybookPackageEnvironment} from "../contract/types"

import type {ExternalStorybookClientPackageSummary, ScrollableStorybookElement} from "./types"

export const STORYBOOK_PAGE_REALM_PROTOCOL = "storybook-page-realm/1" as const

export const BUILTIN_INSPECTOR_WIDGETS = Object.freeze([
  Object.freeze({
    id: "storybook-scenarios",
    kind: "custom" as const,
    label: "С",
    title: "Сценарии",
    wrapInPanel: false,
    component: StorybookAppWebPagePackageScenarioInspector as unknown as CompiledTemplate<WorkbenchInspectorCustomWidgetProps>,
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
  Object.freeze({
    id: "storybook-contract-slots",
    kind: "custom" as const,
    label: "Сл",
    title: "Слоты",
    wrapInPanel: false,
    component: StorybookContractOutline as unknown as CompiledTemplate<WorkbenchInspectorCustomWidgetProps>,
  }),
] as const satisfies readonly WorkbenchInspectorCustomWidgetRegistration[])

export function applyModel(shell: ExternalStorybookShell, model: ExternalStorybookPackageTabModel, navigation: ExternalStorybookClientSnapshot, content: ExternalStorybookClientSnapshot): void {
  shell.document.transaction(() => {
    shell.workbench.update("projectName", navigation.projectName)
    const status = shell.workbench.controller.read("status")
    if (status.breadcrumbs?.some(item => item.id === STORYBOOK_ROOT_BREADCRUMB.id && item.label !== navigation.projectName)) {
      shell.workbench.update("status", {
        ...status,
        breadcrumbs: status.breadcrumbs.map(item => item.id === STORYBOOK_ROOT_BREADCRUMB.id
          ? storybookRootBreadcrumb(navigation.projectName)
          : item),
      })
    }
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

export function navigationItems(items: readonly ExternalStorybookBrowserNavigationItem[]) {
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

export function tabItems(items: readonly ExternalStorybookBrowserTabItem[]) {
  return Object.freeze(items.map((item) => Object.freeze({
    id: item.id,
    label: item.label,
    route: item.route,
    title: item.title,
  })))
}

export function sameWorkspaceAddress(left: string, right: string): boolean {
  const a = new URL(left, "http://storybook.invalid")
  const b = new URL(right, a)
  return a.pathname.replace(/\/$/u, "") === b.pathname.replace(/\/$/u, "") &&
    (a.searchParams.get("view") ?? "overview") === (b.searchParams.get("view") ?? "overview")
}

export function packageRouteFromAddress(address: string, packageId: string, graph: ExternalStorybookClientSnapshot): string {
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

export function revisionClientSnapshot(
  value: StorybookPackageRevisionGraphSnapshot,
  revision: string | null,
  revisionBase: string | null,
  projectName: string,
): ExternalStorybookClientSnapshot {
  const graph = Revision.validate(value)
  return Object.freeze({
    protocol: WebProtocol.clientProtocol,
    projectName,
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

export function exactAuthorStyleSheetSources(
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

export function exactPackageSummary(
  snapshot: ExternalStorybookClientSnapshot,
  packageId: string,
): ExternalStorybookClientPackageSummary {
  const matches = snapshot.packages.filter((summary) => summary.packageId === packageId)
  if (matches.length === 0) throw new Error(`External Storybook client has no package summary: ${packageId}`)
  if (matches.length > 1) throw new Error(`External Storybook client package summary is ambiguous: ${packageId}`)
  return matches[0]!
}

/** Проверяет только подготовленные сценарии; неподдержанный preview может не иметь загрузчика. */
export function validateScenarioLoaders(
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

export function validateAppliedRevision(
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
  const graph = Revision.validate(value.graphSnapshot, packageId)
  return Object.freeze({...value, graphSnapshot: graph, scenarioLoaders: validateScenarioLoaders(value.scenarioLoaders, graph)})
}

export function assertCompatibleAuthorStyleSheets(
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

export function routeAvailable(
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

export function isScrollableStorybookElement(value: unknown): value is ScrollableStorybookElement {
  return value !== null && typeof value === "object" &&
    typeof (value as ScrollableStorybookElement).scrollTop === "number" &&
    typeof (value as ScrollableStorybookElement).scrollLeft === "number"
}

export function exactBoundedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`Storybook ${label} must be bounded non-empty text`)
  }
  return value
}

export function createPackageSocket(
  environment: ExternalStorybookPackageEnvironment,
  href: string,
  sessionToken?: string,
): StorybookTechHmrConnection.Input["socket"] {
  const url = new URL("/api/events", href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  if (sessionToken !== undefined) url.searchParams.set("session", sessionToken)
  return environment.createSocket?.(url.href) ?? new WebSocket(url.href)
}

export function parsePackageEvent(value: unknown): any | null {
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

export function validateRevisionUrl(packageId: string, revision: string | null, value: string | null): void {
  if (revision === null) {
    if (value !== null) throw new Error(`Unavailable Storybook revision URL must be null: ${String(value)}`)
    return
  }
  const expected = `/__storybook/revisions/${encodeURIComponent(packageId)}/${revision}/`
  if (value !== expected) throw new Error(`External Storybook revision URL mismatch: ${value}`)
}

export function exactPackageId(value: string): string {
  WebProtocol.encodePackagePath(value)
  return value
}

export function safeRevision(value: string): string {
  if (typeof value !== "string" || value.length === 0 || /[^a-zA-Z0-9._-]/u.test(value)) {
    throw new Error(`Invalid external Storybook revision: ${String(value)}`)
  }
  return value
}

export function overviewDescription(kind: string, children: number): string {
  if (kind === "entry") return "У этого публичного входа нет описания с @packageDocumentation."
  if (kind === "directory") return "В index.ts этой директории нет описания модуля с @packageDocumentation."
  if (kind === "package") return `${children} вложенных пакетов, входов и директорий. Выберите элемент в дереве.`
  return "Представление документации."
}

export function isolatePackageError(
  document: globalThis.Document,
  shell: ExternalStorybookShell,
  model: ExternalStorybookPackageTabModel,
  error: unknown,
  publishNative = true,
): void {
  const message = errorText(error)
  if (publishNative) {
    document.documentElement.dataset.externalStorybookPackage = "error"
    document.documentElement.dataset.externalStorybookError = message
  }
  shell.reportDiagnostic(message)
  shell.showMessage(`${model.selectedNode.label} · Ошибка`, model.selectedNode.label, message)
  shell.updateStatus(`${model.packageNode.ownerId} · isolated error`)
  console.error(error)
}

export function readBrowserSessionToken(browserDocument: globalThis.Document): string | undefined {
  const value = readMetaContent(browserDocument, "external-storybook-browser-session")
  return value === undefined || value.length === 0 ? undefined : value
}

export function readMetaContent(browserDocument: globalThis.Document, name: string): string | undefined {
  return typeof browserDocument.querySelector === "function"
    ? browserDocument.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content
    : undefined
}

export async function bestEffortDispose(value: unknown): Promise<void> {
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

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function abortable<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
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

export async function settleBefore(promise: Promise<unknown>, deadline: number): Promise<void> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) return
  await Promise.race([
    promise.then(() => undefined, () => undefined),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, remaining)),
  ])
}

export function boundedCleanupTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 10 || value > 30_000) {
    throw new RangeError("Storybook cleanup timeout must be between 10 and 30000 ms")
  }
  return value
}

export function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("External Storybook package tab is disposed")
}

if (typeof document !== "undefined" && document.documentElement.dataset.externalStorybookEntry === "package") {
  // Generated immutable entries call startExternalStorybookPackage with their
  // literal loaders. A bare source module deliberately has nothing to start.
}
