/** Global external Storybook landing entry. It never imports package runtime code. */

import type {CustomEvent} from "@zavx0z/dom"
import type {ExperienceLinkedAuthorStyleSheet} from "@zavx0z/browser"
import {WORKBENCH_EVENTS} from "../../workbench/contract.ts"
import {
  deriveExternalStorybookLanding,
  deriveExternalStorybookLandingSelection,
  type ExternalStorybookBrowserNavigationItem,
} from "./model.ts"
import {
  createExternalStorybookShell,
  externalStorybookClientNode,
  fetchExternalStorybookClientSnapshot,
  readExternalStorybookNodeReadme,
  type CreateExternalStorybookShellOptions,
  type ExternalStorybookShell,
} from "./shell.ts"
import type {ExternalStorybookClientSnapshot} from "./client-protocol.ts"
import type {StorybookOverviewAction} from "../components/overview-action.ts"
import {externalStorybookPageTitle} from "../page-title.ts"
import {deriveStorybookBreadcrumbs} from "./breadcrumbs.ts"

export type StartExternalStorybookLandingOptions = Readonly<{
  fetcher?: typeof fetch
  browserDocument?: globalThis.Document
  openPackage?(input: Readonly<{packageId: string; route: string}>): Promise<void>
  createSocket?(url: string): LandingSocket
  location?: Pick<Location, "href" | "pathname" | "reload">
  history?: Pick<History, "pushState">
  shell?: Omit<CreateExternalStorybookShellOptions, "title" | "browserDocument">
}>

export type ExternalStorybookLandingController = Readonly<{
  snapshot: ExternalStorybookClientSnapshot
  shell: ExternalStorybookShell
  select(nodeId: string): Promise<void>
  dispose(): void
}>

export async function startExternalStorybookLanding(
  options: StartExternalStorybookLandingOptions = {},
): Promise<ExternalStorybookLandingController> {
  const browserDocument = options.browserDocument ?? globalThis.document
  if (browserDocument === undefined) throw new Error("External Storybook landing Document is unavailable")
  browserDocument.documentElement.dataset.externalStorybook = "starting"
  browserDocument.documentElement.dataset.externalStorybookLanding = "starting"
  const fetcher = options.fetcher ?? globalThis.fetch
  const snapshot = await fetchExternalStorybookClientSnapshot(fetcher)
  const graph = snapshot
  const landing = deriveExternalStorybookLanding(graph)
  const shell = await createExternalStorybookShell({
    title: externalStorybookPageTitle(null),
    browserDocument,
    ...(options.shell ?? {}),
    authorStyleSheetSources: options.shell?.authorStyleSheetSources ??
      indexedLandingAuthorStyleSheetSources(browserDocument),
  })
  const openPackage = options.openPackage ?? ((input) => requestPackageView(fetcher, browserDocument, input))
  const location = options.location ?? globalThis.location
  const history = options.history ?? globalThis.history
  let selectionRevision = 0
  let disposed = false

  shell.workbench.update("catalog.label", "Проекты и пакеты")
  shell.workbench.update("catalog.items", navigationItems(landing.catalogItems))
  shell.showMessage(
    "External Storybook · Обзор",
    "External Storybook",
    "Выберите проект или самостоятельный пакет. Workspace используется только как раскрываемая композиция.",
  )

  const breadcrumbsFor = (nodeId: string) => deriveStorybookBreadcrumbs(graph, nodeId, {kind: "landing"})

  const showWorkspace = async (nodeId: string, updateHistory = false): Promise<void> => {
    const revision = ++selectionRevision
    const node = externalStorybookClientNode(snapshot, nodeId)
    if (node.kind !== "workspace") throw new Error(`Landing group is not a workspace: ${nodeId}`)
    const readme = await readExternalStorybookNodeReadme(node, fetcher)
    if (disposed || revision !== selectionRevision) return
    shell.document.transaction(() => {
      shell.workbench.update("catalog.active", null)
      shell.workbench.update("secondary.items", Object.freeze([]))
      shell.workbench.update("secondary.active", null)
      shell.workbench.update("status", {
        lead: "",
        owner: node.label,
        detail: "",
        breadcrumbs: breadcrumbsFor(node.id),
      })
    })
    if (readme === null) shell.showMessage(`${node.label} · Обзор`, node.label, "Workspace composition")
    else shell.showMarkdown(`${node.label} · README`, readme, node.resourceUrl)
    if (updateHistory && location !== undefined && history !== undefined && location.pathname !== node.urlPath) {
      history.pushState(null, "", node.urlPath)
    }
  }

  const select = async (nodeId: string, updateHistory = true): Promise<void> => {
    assertActive(disposed)
    const revision = ++selectionRevision
    const selection = deriveExternalStorybookLandingSelection(graph, nodeId)
    shell.document.transaction(() => {
      shell.workbench.update("catalog.active", selection.catalogActiveId)
      shell.workbench.update("secondary.label", "Пакеты")
      shell.workbench.update("secondary.items", navigationItems(selection.secondaryItems))
      shell.workbench.update("secondary.active", selection.secondaryActiveId)
      shell.workbench.update("scenarios.items", Object.freeze([]))
      shell.workbench.update("scenarios.active", null)
      shell.workbench.update("status", {
        lead: "",
        owner: selection.overviewNode.label,
        detail: "",
        breadcrumbs: breadcrumbsFor(selection.overviewNode.id),
      })
    })
    const clientNode = externalStorybookClientNode(snapshot, selection.overviewNode.id)
    try {
      const readme = await readExternalStorybookNodeReadme(clientNode, fetcher)
      if (disposed || revision !== selectionRevision) return
      const action = clientNode.kind === "package"
        ? packageOpenAction(clientNode, (input) => {
          void openPackage(input).then(() => {
            shell.clearDiagnostics()
          }).catch((error) => {
            shell.reportDiagnostic(errorText(error))
            shell.updateStatus(`${input.packageId} · open failed`)
          })
        })
        : undefined
      if (readme === null) {
        shell.showMessage(
          `${clientNode.label} · Обзор`,
          clientNode.label,
          overviewDescription(clientNode.kind),
          action,
        )
      } else {
        shell.showMarkdown(`${clientNode.label} · README`, readme, clientNode.resourceUrl, action)
      }
      if (clientNode.kind !== "package" && updateHistory && location !== undefined && history !== undefined &&
        location.pathname !== clientNode.urlPath) {
        history.pushState(null, "", clientNode.urlPath)
      }
      shell.clearDiagnostics()
    } catch (error) {
      if (disposed || revision !== selectionRevision) return
      shell.reportDiagnostic(errorText(error))
      shell.showMessage(`${clientNode.label} · Ошибка`, clientNode.label, errorText(error))
      shell.updateStatus(`${clientNode.label} · error`)
    }
  }

  const onNavigate = (event: unknown): void => {
    const detail = (event as CustomEvent<{id: string; kind?: string}>).detail
    const node = externalStorybookClientNode(snapshot, detail.id)
    const navigation = detail.kind === "breadcrumb" && node.kind === "workspace"
      ? showWorkspace(node.id, true)
      : select(node.id)
    void navigation.catch((error) => isolateLandingError(browserDocument, shell, error))
  }
  const onGroupToggle = (event: unknown): void => {
    const detail = (event as CustomEvent<{id: string}>).detail
    void showWorkspace(detail.id).catch((error) => isolateLandingError(browserDocument, shell, error))
  }
  shell.workbench.element.addEventListener(WORKBENCH_EVENTS.navigate, onNavigate)
  shell.workbench.element.addEventListener(WORKBENCH_EVENTS.groupToggle, onGroupToggle)

  const socket = createLandingSocket(options, location?.href)
  const onSocketOpen = (): void => socket?.send(JSON.stringify({type: "subscribe", topic: "registry"}))
  const onSocketMessage = (event: MessageEvent): void => {
    const update = parseLandingEvent(event.data)
    if (update === null) return
    if (update.type === "registry.updated") {
      location?.reload()
    } else if (update.type === "package.failed") {
      shell.updateStatus(`${update.packageId} · build failed`)
    } else if (update.type === "package.updated") {
      shell.updateStatus(`${update.packageId} · ${update.revision}`)
    } else if (update.type === "package.built") {
      shell.updateStatus(`${update.packageId} · built · ${update.revision}`)
    } else if (update.type === "package.resources-updated" || update.type === "package.metadata-updated") {
      shell.updateStatus(`${update.packageId} · ${update.type}`)
    }
  }
  socket?.addEventListener("open", onSocketOpen)
  socket?.addEventListener("message", onSocketMessage)

  const applyLandingPath = async (): Promise<void> => {
    const pathname = location?.pathname ?? "/"
    if (pathname === "/") {
      if (snapshot.rootIds.length === 1) {
        const root = externalStorybookClientNode(snapshot, snapshot.rootIds[0]!)
        if (root.kind === "workspace") await showWorkspace(root.id, false)
      }
      return
    }
    const node = snapshot.nodes.find((candidate) => candidate.urlPath === pathname)
    if (node?.kind === "workspace") await showWorkspace(node.id, false)
    else if (node?.kind === "project") await select(node.id, false)
    else throw new Error(`Unknown external Storybook landing pathname: ${pathname}`)
  }
  const onPopState = (): void => {
    void applyLandingPath().catch((error) => isolateLandingError(browserDocument, shell, error))
  }
  globalThis.addEventListener?.("popstate", onPopState)
  await applyLandingPath()

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    selectionRevision += 1
    shell.workbench.element.removeEventListener(WORKBENCH_EVENTS.navigate, onNavigate)
    shell.workbench.element.removeEventListener(WORKBENCH_EVENTS.groupToggle, onGroupToggle)
    socket?.removeEventListener("open", onSocketOpen)
    socket?.removeEventListener("message", onSocketMessage)
    socket?.close()
    globalThis.removeEventListener?.("popstate", onPopState)
    shell.dispose()
  }
  globalThis.addEventListener?.("pagehide", dispose, {once: true})
  shell.presentFrame()
  browserDocument.documentElement.dataset.externalStorybook = "ready"
  browserDocument.documentElement.dataset.externalStorybookLanding = "ready"
  return Object.freeze({snapshot, shell, select, dispose})
}

type LandingSocket = Readonly<{
  addEventListener(type: string, listener: (event: any) => void): void
  removeEventListener(type: string, listener: (event: any) => void): void
  send(data: string): void
  close(): void
}>

function createLandingSocket(
  options: StartExternalStorybookLandingOptions,
  href: string | undefined,
): LandingSocket | null {
  if (href === undefined) return null
  const url = new URL("/api/events", href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  const token = typeof options.browserDocument?.querySelector === "function"
    ? options.browserDocument.querySelector<HTMLMetaElement>(
      'meta[name="external-storybook-browser-session"]',
    )?.content
    : typeof globalThis.document?.querySelector === "function"
      ? globalThis.document.querySelector<HTMLMetaElement>(
        'meta[name="external-storybook-browser-session"]',
      )?.content
      : undefined
  if (token !== undefined && token.length > 0) url.searchParams.set("session", token)
  if (options.createSocket !== undefined) return options.createSocket(url.href)
  return typeof WebSocket === "undefined" ? null : new WebSocket(url.href)
}

function parseLandingEvent(value: unknown): any | null {
  if (typeof value !== "string") return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== "object" || !("type" in parsed)) return null
  const record = parsed as Record<string, unknown>
  if (record.type === "registry.updated" && typeof record.graphDigest === "string") return record
  if (record.type === "package.updated" && typeof record.packageId === "string" && typeof record.revision === "string") return record
  if (record.type === "package.built" && typeof record.packageId === "string" && typeof record.revision === "string") return record
  if (["package.resources-updated", "package.metadata-updated"].includes(String(record.type)) &&
    typeof record.packageId === "string") return record
  if (record.type === "package.failed" && typeof record.packageId === "string") return record
  return null
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

function overviewDescription(kind: string): string {
  if (kind === "project") return "Выберите пакет во второй панели."
  if (kind === "package") return "Откройте пакет в отдельной вкладке для изучения его каталога."
  return "Owner README для этого узла не объявлен."
}

function packageOpenAction(
  node: Readonly<{
    id: string
    label: string
    packageId: string | null
  }>,
  openPackage: (input: Readonly<{packageId: string; route: string}>) => void,
): StorybookOverviewAction {
  const packageId = node.packageId
  if (packageId === null) throw new Error(`Landing package has no package identity: ${node.id}`)
  return Object.freeze({
    label: `Открыть ${node.label}`,
    title: `Открыть пакет ${packageId} в отдельной вкладке`,
    activate() {
      openPackage(Object.freeze({packageId, route: ""}))
    },
  })
}

async function requestPackageView(
  fetcher: typeof fetch,
  browserDocument: globalThis.Document,
  input: Readonly<{packageId: string; route: string}>,
): Promise<void> {
  const session = browserDocument.querySelector<HTMLMetaElement>(
    'meta[name="external-storybook-browser-session"]',
  )?.content
  if (session === undefined || session.length === 0) {
    throw new Error("External Storybook landing has no browser session")
  }
  const response = await fetcher("/api/browser/open", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-storybook-session": session,
    },
    body: JSON.stringify(input),
  })
  const result = await response.json().catch(() => null) as unknown
  if (!response.ok || result === null || typeof result !== "object" || (result as Record<string, unknown>).ok !== true) {
    const message = result !== null && typeof result === "object" &&
      typeof (result as Record<string, unknown>).error === "string"
      ? (result as Record<string, unknown>).error as string
      : `External Storybook package view request failed with ${response.status}`
    throw new Error(message)
  }
}

/** Reads only the server-indexed landing links; it never scans native CSSOM. */
export function indexedLandingAuthorStyleSheetSources(
  document: globalThis.Document,
): readonly ExperienceLinkedAuthorStyleSheet[] {
  if (typeof document.querySelectorAll !== "function" || typeof document.getElementById !== "function") {
    return Object.freeze([])
  }
  const annotated = [...document.querySelectorAll<HTMLLinkElement>(
    'link[data-external-storybook-author-style-sheet]',
  )]
  if (annotated.length > 32) throw new Error("Landing Workbench author stylesheet list exceeds 32 links")
  const annotatedSet = new Set(annotated)
  const specifiers = new Set<string>()
  return Object.freeze(annotated.map((_candidate, index) => {
    const elementId = `external-storybook-author-style-sheet-${index}`
    const element = document.getElementById(elementId)
    if (element === null || !annotatedSet.has(element as HTMLLinkElement) ||
      element.localName.toLowerCase() !== "link") {
      throw new Error(`Required landing Workbench author stylesheet link is missing at index ${index}`)
    }
    const link = element as HTMLLinkElement
    const specifier = exactLandingLinkText(
      link.getAttribute("data-external-storybook-author-style-sheet"),
      `landing Workbench author stylesheet ${index} specifier`,
    )
    const digest = exactLandingLinkText(
      link.getAttribute("data-external-storybook-author-style-sheet-digest"),
      `landing Workbench author stylesheet ${specifier} digest`,
    )
    const href = exactLandingLinkText(
      link.getAttribute("href"),
      `landing Workbench author stylesheet ${specifier} href`,
    )
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`Landing Workbench author stylesheet digest is invalid: ${specifier}`)
    }
    if (!href.startsWith("/") || /[\u0000-\u001f\u007f]/u.test(href)) {
      throw new Error(`Landing Workbench author stylesheet href is invalid: ${specifier}`)
    }
    if (specifier.includes("\\") || specifiers.has(specifier)) {
      throw new Error(`Landing Workbench author stylesheet specifier is invalid or duplicate: ${specifier}`)
    }
    specifiers.add(specifier)
    if (link.ownerDocument !== document || link.getAttribute("rel") !== "stylesheet") {
      throw new Error(`Landing Workbench author stylesheet link belongs to another realm: ${specifier}`)
    }
    if ((document.readyState === "interactive" || document.readyState === "complete") && link.sheet === null) {
      throw new Error(`Required landing Workbench author stylesheet failed before entry: ${specifier}`)
    }
    return Object.freeze({id: specifier, link})
  }))
}

function exactLandingLinkText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-empty text`)
  }
  return value
}

function isolateLandingError(
  document: globalThis.Document,
  shell: ExternalStorybookShell,
  error: unknown,
): void {
  document.documentElement.dataset.externalStorybookLanding = "error"
  document.documentElement.dataset.externalStorybookError = errorText(error)
  shell.reportDiagnostic(errorText(error))
  shell.updateStatus("landing error")
  console.error(error)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("External Storybook landing is disposed")
}

if (typeof document !== "undefined") {
  void startExternalStorybookLanding().catch((error) => {
    document.documentElement.dataset.externalStorybook = "error"
    document.documentElement.dataset.externalStorybookLanding = "error"
    document.documentElement.dataset.externalStorybookError = errorText(error)
    console.error(error)
  })
}
