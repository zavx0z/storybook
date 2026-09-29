import type {StorybookSharedHost} from "./shared-host"
import type {ComponentValue} from "@zavx0z/component"
import type {JSX} from "@jsx-compiler/session"
import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {DisplayElement} from "@zavx0z/dom/display"
import {createRoot} from "@zavx0z/component"
import {createDocumentClipboardController} from "@zavx0z/browser/clipboard"
import {createDocument} from "@zavx0z/dom"
import type {Presentation as Root, RootDocumentProjection, RootProjection, RootSpaceProjection} from "@zavx0z/browser/integration"
import type {RenderFrame} from "@renderer/html"
import {createSpaceElementFactories} from "@zavx0z/space"
import {HUDElement} from "../../webxr-space/dom/hud/index.ts"
import {SpaceElement} from "@zavx0z/dom/space"
import {ViewPointElement} from "@zavx0z/dom/viewpoint"
import {presentationRootFixture} from "./browser-root.fixture.ts"
import {discoverStorybookPackages} from "../discovery/packages.ts"
import {createExternalStorybookGraph, type ExternalStorybookGraph} from "../catalog/graph.ts"
import type {StorybookPackageSessionSnapshot} from "../sessions/package-session.ts"
import {createStorybookPackageRevisionGraphSnapshot} from "../sessions/package-revision.ts"
import {deriveExternalStorybookPackageTab} from "./model.ts"
import {createExternalStorybookClientSnapshot} from "./client-protocol.ts"
import {STORYBOOK_PAGE_REALM_PROTOCOL, startExternalStorybookPackage, type ExternalStorybookPackageEnvironment} from "./package-entry.ts"
import {startExternalStorybookPage, type ExternalStorybookPreparedPackageTarget} from "./page-entry.ts"
import {STORYBOOK_AGENT_BRIDGE_GLOBAL, type StorybookAgentBridge} from "./agent-bridge.ts"
import type {ExternalStorybookRootFactory} from "./shell.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")
const packageId = "@fixture/components"
const packagePath = "/fixture-workspace/projects/alpha/packages/components"

describe("structural package frontend", () => {
  test("navigates package and directory in one Browser Root", async () => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-a"))
    const state = createFakeRootState()
    const environment = environmentFixture(snapshot, packagePath)
    const controller = await startExternalStorybookPackage({packageId, candidateRevision: "revision-a",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
      sharedModuleEpoch: "epoch", graphSnapshot: createStorybookPackageRevisionGraphSnapshot(graph, packageId, "revision-a"),
      environment: {...environment, shell: {...environment.shell!, createRoot: fakeRootFactory(state)}}})
    try {
      expect(controller.currentRoute).toBe("")
      expect(controller.currentModel.selectedNode.id).toBe("package:@fixture/components")
      await controller.navigate("dir-docs")
      expect(controller.currentRoute).toBe("dir-docs")
      expect(controller.currentModel.selectedNode.id).toBe("directory:package:@fixture/components/docs")
      expect(state.creations).toBe(1)
      expect(environment.location!.pathname).toBe(`${packagePath}/docs`)
    } finally {
      await controller.dispose()
    }
    expect(state.disposals).toBe(1)
  })

  test("rejects a foreign pathname before creating a shell", async () => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-a"))
    const state = createFakeRootState()
    const environment = environmentFixture(snapshot, "/standalone")
    await expect(startExternalStorybookPackage({packageId, candidateRevision: null, revisionUrl: null,
      environment: {...environment, shell: {...environment.shell!, createRoot: fakeRootFactory(state)}}}))
      .rejects.toThrow("address is not in the applied package graph")
    expect(state.creations).toBe(0)
  })

  test("shows an empty package state and preserves route navigation without an applied revision", async () => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-a"))
    const controller = await startExternalStorybookPackage({packageId, candidateRevision: null,
      revisionUrl: null, environment: environmentFixture(snapshot, packagePath)})
    try {
      expect(controller.revision).toBeNull()
      await controller.navigate("dir-docs")
      expect(controller.currentModel.selectedNode.kind).toBe("directory")
    } finally { await controller.dispose() }
  })

  test("rejects a scenario loader for a node without scenarios before shell creation", async () => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-a"))
    const state = createFakeRootState()
    const environment = environmentFixture(snapshot, packagePath)
    await expect(startExternalStorybookPackage({packageId, candidateRevision: "revision-a",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
      graphSnapshot: createStorybookPackageRevisionGraphSnapshot(graph, packageId, "revision-a"),
      scenarioLoaders: new Map([["directory:package:@fixture/components/docs", async () => ({kind: "function", variants: []})]]),
      environment: {...environment, shell: {...environment.shell!, createRoot: fakeRootFactory(state)}}}))
      .rejects.toThrow("Некорректный загрузчик сценария")
    expect(state.creations).toBe(0)
  })

  test("applies and rolls back scenario revisions inside the same Browser Root", async () => {
    const graph = await fixtureGraphWithScenarios()
    const directoryId = "directory:package:@fixture/components/docs"
    const route = "dir-docs/scenarios"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-a"))
    const state = createFakeRootState()
    const environment = environmentFixture(snapshot, `${packagePath}/docs?view=scenarios`)
    const scenario = async () => ({kind: "function" as const,
      variants: [{id: "a", title: "A", source: "A()", points: [], calls: []}]})
    const revisionGraph = (revision: string) => createStorybookPackageRevisionGraphSnapshot(graph, packageId, revision)
    const controller = await startExternalStorybookPackage({packageId, candidateRevision: "revision-a",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/", sharedModuleEpoch: "epoch",
      graphSnapshot: revisionGraph("revision-a"), scenarioLoaders: new Map([[directoryId, scenario]]),
      environment: {...environment, shell: {...environment.shell!, createRoot: fakeRootFactory(state)},
        async loadAppliedRevision(revision) {
          return {protocol: STORYBOOK_PAGE_REALM_PROTOCOL, packageId, candidateRevision: revision,
            revisionUrl: `/__storybook/revisions/%40fixture%2Fcomponents/${revision}/`, sharedModuleEpoch: "epoch",
            graphSnapshot: revisionGraph(revision), scenarioLoaders: new Map([[directoryId,
              revision === "revision-c" ? async () => { throw new Error("fixture scenario failed") } : scenario]])}
        }},
    })
    try {
      expect(controller.currentRoute).toBe(route)
      expect(controller.currentModel.viewKind).toBe("scenarios")
      await controller.applyRevision("revision-b")
      expect(controller.revision).toBe("revision-b")
      expect(state.creations).toBe(1)
      await expect(controller.applyRevision("revision-c")).rejects.toThrow("fixture scenario failed")
      expect(controller.revision).toBe("revision-b")
      expect(controller.currentRoute).toBe(route)
      expect(state.creations).toBe(1)
    } finally { await controller.dispose() }
    expect(state.disposals).toBe(1)
  })

  test("HMR платформы сохраняет browser Document, Canvas, адрес и действующий bridge", async () => {
    const fixture = await pageFixture()
    const page = fixture.page
    const canvas = page.shell.canvas
    const document = page.shell.document
    const browserDocument = page.shell.browserDocument
    const before = await currentBridge().call("identity") as {timeOrigin: number}
    page.shell.workbench.controller.update("catalog.search", "docs")
    page.shell.workbench.elements.catalogItems.scrollTop = 57
    try {
      const result = await currentBridge().call("applyRevision", {
        expectedPackageId: packageId, revision: "revision-b",
      })
      expect(result).toMatchObject({packageId, revision: "revision-b", timeOrigin: before.timeOrigin})
      expect(page.shell.browserDocument).toBe(browserDocument)
      expect(page.shell.canvas).toBe(canvas)
      expect(page.shell.document).not.toBe(document)
      expect(page.shell.workbench.elements.catalogItems.scrollTop).toBe(57)
      expect(page.shell.workbench.controller.read("catalog.search")).toBe("docs")
      expect(fixture.location.href).toBe(`http://localhost${packagePath}`)
      expect(fixture.location.reloads).toBe(0)
      expect(fixture.state.lifecycle).toEqual(["root-create", "root-dispose", "root-create"])
      const nextDocument = page.shell.document
      await currentBridge().call("applyRevision", {expectedPackageId: packageId, revision: "revision-c"})
      expect(page.shell.document).toBe(nextDocument)
      expect(fixture.state.creations).toBe(2)
      await page.navigatePackage({packageId, route: "dir-docs"})
      expect(page.route).toBe("dir-docs")
    } finally { await page.dispose() }
    expect(fixture.state.disposals).toBe(2)
  })

  test("ошибка HMR после создания новой оболочки восстанавливает прежнюю среду и освобождает кандидат", async () => {
    const fixture = await pageFixture(true)
    const canvas = fixture.page.shell.canvas
    try {
      await expect(currentBridge().call("applyRevision", {
        expectedPackageId: packageId, revision: "revision-b",
      })).rejects.toThrow("new platform mount failed")
      expect(await currentBridge().call("identity")).toMatchObject({packageId, revision: "revision-a"})
      expect(fixture.page.shell.canvas).toBe(canvas)
      expect(fixture.state.lifecycle).toEqual([
        "root-create", "root-dispose", "root-create", "root-dispose", "root-create",
      ])
      expect(fixture.location.reloads).toBe(0)
      expect(fixture.location.href).toBe(`http://localhost${packagePath}`)
    } finally { await fixture.page.dispose() }
    expect(fixture.state.disposals).toBe(fixture.state.creations)
  })

  test("переход с HMR добавляет один history entry и сохраняет запрошенный маршрут", async () => {
    const fixture = await pageFixture()
    try {
      await fixture.page.navigatePackage({packageId, route: "dir-docs"})
      expect(fixture.page.route).toBe("dir-docs")
      expect(fixture.history.pushed).toEqual([`${packagePath}/docs`])
      expect(fixture.location.reloads).toBe(0)
      expect(fixture.state.lifecycle).toEqual(["root-create", "root-dispose", "root-create"])
    } finally { await fixture.page.dispose() }
  })

  test("HMR заменяет App оболочки, сохраняя Browser root и semantic Document той же платформы", async () => {
    const fixture = await pageFixture(false, false)
    const shell = fixture.page.shell
    try {
      await currentBridge().call("applyRevision", {expectedPackageId: packageId, revision: "revision-b"})
      expect(fixture.page.shell).not.toBe(shell)
      expect(fixture.page.shell.document).toBe(shell.document)
      expect(fixture.page.shell.canvas).toBe(shell.canvas)
      expect(fixture.state.lifecycle).toEqual(["root-create"])
      expect(await currentBridge().call("identity")).toMatchObject({revision: "revision-b"})
    } finally { await fixture.page.dispose() }
    expect(fixture.state.disposals).toBe(1)
  })

  test.each([false, true])("запросы bridge во время HMR завершаются на рабочей среде, rollback=%s", async failMount => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const fixture = await pageFixture(failMount, true, async () => {
      entered.resolve()
      await release.promise
    })
    const bridge = currentBridge()
    try {
      const applying = Promise.allSettled([bridge.call("applyRevision", {expectedPackageId: packageId, revision: "revision-b"})])
      await entered.promise
      const observing = Promise.allSettled([
        bridge.call("identity"),
        bridge.call("inspect", {expectedPackageId: packageId, include: ["state"]}),
        bridge.call("inspect", {expectedPackageId: "@fixture/another", include: ["state"]}),
      ])
      release.resolve()
      expect((await applying)[0]?.status).toBe(failMount ? "rejected" : "fulfilled")
      const revision = failMount ? "revision-a" : "revision-b"
      expect(await observing, "Ожидающие запросы читают рабочую ревизию и сохраняют проверку владельца")
        .toMatchObject([
          {status: "fulfilled", value: {packageId, revision}},
          {status: "fulfilled", value: {packageId, revision}},
          {status: "rejected", reason: expect.objectContaining({message: "Storybook view navigated to another package"})},
        ])
    } finally {
      release.resolve()
      await fixture.page.dispose()
    }
  })
})

/** Текущая точка входа переживает замену платформенного экземпляра bridge. */
function currentBridge(): StorybookAgentBridge {
  return (globalThis as typeof globalThis & Record<string, unknown>)[STORYBOOK_AGENT_BRIDGE_GLOBAL] as StorybookAgentBridge
}

test("общая оболочка обновляет две страницы без изменения ревизий пакетов и browser realm", async () => {
  const first = await pageFixture(false, false)
  const second = await pageFixture(false, false, undefined, "@fixture/standalone")
  const before = [first, second].map(fixture => ({shell: fixture.page.shell, address: fixture.location.href,
    document: fixture.page.shell.document, canvas: fixture.page.shell.canvas, packageId: fixture.page.packageId,
    settings: fixture.page.shell.captureUserState()}))
  try {
    first.page.shell.workbench.controller.update("catalog.search", "первое окно")
    second.page.shell.workbench.controller.update("catalog.search", "второе окно")
    first.page.shell.workbench.elements.catalogItems.scrollTop = 31
    second.page.shell.workbench.elements.catalogItems.scrollTop = 67
    first.updateHost()
    second.updateHost()
    const deadline = Date.now() + 5000
    while ((first.page.shell === before[0]!.shell || second.page.shell === before[1]!.shell) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    for (const [index, fixture] of [first, second].entries()) {
      expect(fixture.page.shell).not.toBe(before[index]!.shell)
      expect(fixture.page.shell.document).toBe(before[index]!.document)
      expect(fixture.page.shell.canvas).toBe(before[index]!.canvas)
      expect(fixture.page.packageId).toBe(before[index]!.packageId)
      expect(fixture.location.href).toBe(before[index]!.address)
      expect(fixture.location.reloads).toBe(0)
      expect(fixture.state.creations).toBe(1)
      expect(fixture.page.shell.captureUserState()).toEqual(before[index]!.settings)
      expect(fixture.page.shell.browserDocument.documentElement.dataset.externalStorybookRevision).toBe("revision-a")
    }
    expect(first.page.shell.workbench.controller.read("catalog.search")).toBe("первое окно")
    expect(second.page.shell.workbench.controller.read("catalog.search")).toBe("второе окно")
    expect(first.page.shell.workbench.elements.catalogItems.scrollTop).toBe(31)
    expect(second.page.shell.workbench.elements.catalogItems.scrollTop).toBe(67)
  } finally {
    await first.page.dispose()
    await second.page.dispose()
  }
})

test("после reconnect обновление оболочки использует новый socket и новый reader token", async () => {
  const fixture = await pageFixture(false, false)
  const shell = fixture.page.shell
  try {
    const socket = fixture.sockets.at(-1)!
    socket.close()
    socket.emit("close", {})
    const deadline = Date.now() + 5000
    while (fixture.sockets.at(-1) === socket && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    expect(fixture.sockets.at(-1)).not.toBe(socket)
    fixture.sockets.at(-1)!.emit("open", {})
    fixture.updateHost()
    while (fixture.page.shell === shell && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    expect(fixture.page.shell).not.toBe(shell)
    expect(fixture.hostReaders.at(-1)).toBe("reader-1")
    expect(new Set(fixture.sockets.map(socket => socket.url)).size).toBe(fixture.sockets.length)
    expect(fixture.page.shell.document).toBe(shell.document)
    expect(fixture.location.reloads).toBe(0)
    expect(fixture.page.shell.browserDocument.documentElement.dataset.externalStorybookRevision).toBe("revision-a")
  } finally { await fixture.page.dispose() }
})

/** Реальный page controller с управляемыми immutable payloads и наблюдаемым Root lifecycle. */
async function pageFixture(failPlatformMount = false, changePlatform = true, beforePrepare?: () => Promise<void>, selectedPackageId = "@fixture/components") {
  const packageId = selectedPackageId
  const graph = await fixtureGraph()
  const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-a"))
  const packagePath = deriveExternalStorybookPackageTab(snapshot, packageId, "").urlPath
  const environment = environmentFixture(snapshot, packagePath)
  const location = environment.location as LocationFixture
  const history = environment.history as ReturnType<typeof historyFixture>
  Object.assign(environment.browserDocument!, {location})
  const state = createFakeRootState()
  const payload = (revision: string) => ({
    protocol: STORYBOOK_PAGE_REALM_PROTOCOL,
    packageId,
    candidateRevision: revision,
    revisionUrl: `/__storybook/revisions/${encodeURIComponent(packageId)}/${revision}/`,
    sharedModuleEpoch: (revision === "revision-a" || !changePlatform ? "a" : "b").repeat(64),
    hostModuleEpoch: (revision === "revision-a" ? "a" : "b").repeat(64),
    graphSnapshot: createStorybookPackageRevisionGraphSnapshot(graph, packageId, revision),
    startPage: async () => { throw new Error("Ревизия пакета не выбирает page host") },
    startPackage: async () => { throw new Error("Ревизия пакета не выбирает package host") },
  })
  const target = (revision: string, route = ""): ExternalStorybookPreparedPackageTarget => ({
    kind: "revision", packageId, revision,
    revisionUrl: payload(revision).revisionUrl,
    route, urlPath: deriveExternalStorybookPackageTab(snapshot, packageId, route).urlPath,
    intent: "reader", preview: false, initialAppliedRevision: "revision-a", fallbackRevision: null,
    readerToken: "fixture-reader",
  })
  let hostRevision = "a"
  const sockets: FakeSocket[] = []
  const hostReaders: string[] = []
  let readerGeneration = 0
  const sharedHost = (epoch = "a".repeat(64)): StorybookSharedHost => ({
    protocol: "storybook-shared-host/1", sharedModuleEpoch: epoch, hostModuleEpoch: hostRevision.repeat(64),
    pageEntryUrl: `/__storybook/shared/page-${hostRevision}.js`, packageHostUrl: `/__storybook/shared/package-${hostRevision}.js`,
    authorStyleSheets: [],
  })
  const page = await startExternalStorybookPage({
    browserDocument: environment.browserDocument!, location, history: environment.history!,
    sharedModuleEpoch: "a".repeat(64),
    hostModuleEpoch: "a".repeat(64),
    initialTarget: target("revision-a"), initialPayload: payload("revision-a"),
    sharedHost: sharedHost(),
    readSharedHost: async (epoch, token) => {
      hostReaders.push(token)
      return sharedHost(epoch)
    },
    importSharedHost: async () => async options => startExternalStorybookPage({...options,
      ...(failPlatformMount && options.hostModuleEpoch === "b".repeat(64)
        ? {startPackage: async () => { throw new Error("new platform mount failed") }} : {}),
    }),
    shell: {...environment.shell!, createRoot: fakeRootFactory(state)},
    fetcher: (async input => String(input).includes("/api/browser/session")
      ? Response.json({token: `reader-${++readerGeneration}`}) : Response.json(snapshot)) as typeof fetch,
    createSocket: url => {
      const socket = new FakeSocket()
      socket.url = url
      sockets.push(socket)
      return socket
    },
    prepareTarget: async input => {
      hostRevision = "b"
      await beforePrepare?.()
      return target(input.requestedRevision ?? "revision-c", input.route)
    },
    loadAppliedRevision: async (_packageId, revision) => payload(revision),
  })
  return {page, state, location, history, sockets, hostReaders,
    updateHost() {
      hostRevision = "b"
      for (const socket of [...sockets]) if (!socket.closed) socket.emit("message", {data: JSON.stringify({type: "shared.updated", host: sharedHost()})})
    },
  }
}

async function fixtureGraphWithScenarios(): Promise<ExternalStorybookGraph> {
  const catalog = await discoverStorybookPackages([fixtureRoot, join(fixtureRoot, "standalone")])
  const scopes = catalog.scopes.map(scope => scope.id === packageId && scope.kind === "package"
    ? {...scope, directories: scope.directories!.map(directory => directory.relativePath === "docs"
      ? {...directory, scenarioSpec: {sourcePaths: [join(scope.scopeRoot, "docs/spec/scenario.spec.ts")]}}
      : directory)} : scope)
  return createExternalStorybookGraph({...catalog, scopes})
}
class FakeSocket {
  url = ""
  sent: string[] = []
  closed = false
  readonly listeners = new Map<string, Set<(event: any) => void>>()

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  emit(type: string, event: any): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

type LocationFixture = Pick<Location, "pathname" | "href" | "reload"> & {
  pathname: string
  reloads: number
}

function locationFixture(pathname: string): LocationFixture {
  const url = new URL(pathname, "http://localhost")
  return {
    pathname: url.pathname,
    href: url.href,
    reloads: 0,
    reload() {
      this.reloads += 1
    },
  }
}

function historyFixture(location: LocationFixture) {
  const pushed: string[] = []
  const replaced: string[] = []
  return {
    pushed,
    replaced,
    pushState(_data: unknown, _unused: string, url: string | URL | null) {
      if (url === null) return
      const path = String(url)
      pushed.push(path)
      const next = new URL(path, location.href)
      location.pathname = next.pathname
      location.href = next.href
    },
    replaceState(_data: unknown, _unused: string, url: string | URL | null) {
      if (url === null) return
      const path = String(url)
      replaced.push(path)
      const next = new URL(path, location.href)
      location.pathname = next.pathname
      location.href = next.href
    },
  }
}

function fixtureAddress(snapshot: ReturnType<typeof createExternalStorybookClientSnapshot>, route: string, query = ""): string {
  const model = deriveExternalStorybookPackageTab(snapshot, "@fixture/components", route)
  const address = new URL(model.urlPath, "http://localhost")
  for (const [key, value] of new URLSearchParams(query)) address.searchParams.set(key, value)
  return `${address.pathname}${address.search}`
}

function environmentFixture(
  snapshot: ReturnType<typeof createExternalStorybookClientSnapshot>,
  pathname: string,
): ExternalStorybookPackageEnvironment {
  const location = locationFixture(pathname)
  return {
    browserDocument: {documentElement: {dataset: {}}} as unknown as globalThis.Document,
    location,
    history: historyFixture(location),
    fetcher: (async (_input: URL | RequestInfo) => Response.json(snapshot)) as typeof fetch,
    createSocket: () => new FakeSocket(),
    shell: {
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      createRoot: fakeRootFactory(),
    },
  }
}

async function fixtureGraph(): Promise<ExternalStorybookGraph> {
  return createExternalStorybookGraph(await discoverStorybookPackages([
    fixtureRoot,
    join(fixtureRoot, "standalone"),
  ]))
}

function packageSnapshots(
  graph: ExternalStorybookGraph,
  componentsRevision: string,
): readonly StorybookPackageSessionSnapshot[] {
  return Object.freeze(graph.nodes.flatMap((node) => node.kind === "package" ? [Object.freeze({
    packageId: node.packageId!,
    declarationDigest: node.digest,
    moduleGraphRevision: "module-revision",
    candidateRevision: null,
    activeRevision: node.packageId === "@fixture/components" ? componentsRevision : "revision-good",
    lastGoodRevision: node.packageId === "@fixture/components" ? componentsRevision : "revision-good",
    entryRelativePath: "entry.js",
    diagnostics: Object.freeze([]),
    dependencyRealpaths: Object.freeze([]),
    subscribers: 0,
    buildState: "ready" as const,
    builds: 1,
  })] : []))
}

type FakeRootState = {
  creations: number
  disposals: number
  frames: number
  document: ReturnType<typeof createDocument> | null
  space: SpaceElement | null
  stylesheets: readonly Readonly<{id: string; link: HTMLLinkElement}>[]
  lifecycle: string[]
  failRenderAt: number | null
}

function createFakeRootState(lifecycle: string[] = []): FakeRootState {
  return {
    creations: 0,
    disposals: 0,
    frames: 0,
    document: null,
    space: null,
    stylesheets: Object.freeze([]),
    lifecycle,
    failRenderAt: null,
  }
}

function fakeRootFactory(
  state: FakeRootState = createFakeRootState(),
): ExternalStorybookRootFactory {
  return presentationRootFixture(async options => {
    state.creations += 1
    state.lifecycle.push("root-create")
    state.stylesheets = Object.freeze((options.stylesheets ?? []).filter((source): source is Readonly<{id: string; link: HTMLLinkElement}> => typeof source !== "string"))

    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const clipboard = createDocumentClipboardController(document)
    const html = document.createElement("html")
    const body = document.createElement("body")
    html.append(body)
    document.append(html)
    const appRoot = createRoot(body)
    appRoot.render(options.app)
    appRoot.flush()
    let space = body.querySelector("space") as SpaceElement
    let viewPoint = space.querySelector("viewpoint") as ViewPointElement
    state.document = document
    state.space = space

    const presented = new Set<(sequence: number) => void>()
    const documentProjections = new Map<DisplayElement | HUDElement, Readonly<{
      projection: RootDocumentProjection
      subscribers: Set<(frame: RenderFrame) => void>
      setFrame(frame: RenderFrame): void
    }>>()
    const spaceProjection: RootSpaceProjection = Object.freeze({
      kind: "space",
      get owner() { return space },
      orbit() {},
      pan() {},
      zoom() {},
    })
    let disposed = false

    const documentProjection = (
      owner: DisplayElement | HUDElement,
    ): RootDocumentProjection => {
      const existing = documentProjections.get(owner)
      if (existing !== undefined) return existing.projection
      if (owner.ownerDocument !== document || owner.parentNode !== space) {
        throw new Error("Fake Root projection owner must be a direct child of its semantic Space")
      }
      const subscribers = new Set<(frame: RenderFrame) => void>()
      let frame: RenderFrame | null = null
      const projection: RootDocumentProjection = Object.freeze({
        kind: owner instanceof DisplayElement ? "display" : "hud",
        owner,
        projectPoint: (point: {x: number; y: number}) => point,
        readFrame: () => frame,
        subscribeFrames(listener) {
          subscribers.add(listener)
          return () => subscribers.delete(listener)
        },
        pointerDown: () => null,
        pointerMove: () => null,
        pointerUp: () => null,
        wheel: () => null,
      })
      documentProjections.set(owner, Object.freeze({
        projection,
        subscribers,
        setFrame(value: RenderFrame) {
          frame = value
        },
      }))
      return projection
    }

    function getProjection(owner: SpaceElement): RootSpaceProjection
    function getProjection(owner: DisplayElement | HUDElement): RootDocumentProjection
    function getProjection(
      owner: SpaceElement | DisplayElement | HUDElement,
    ): RootProjection {
      if (owner === space) return spaceProjection
      return documentProjection(owner as DisplayElement | HUDElement)
    }

    const root: Root & {renderApplication(app: ComponentValue | JSX.Element): void} = Object.freeze({
      clipboard,
      input: {
        pointerDown() {},
        pointerMove() {},
        pointerUp() {},
        pointerCancel() {},
        wheel() {},
      },
      canvas: options.canvas,
      document,
      get space() { return space },
      get viewPoint() { return viewPoint },
      renderApplication(app: ComponentValue | JSX.Element) {
        appRoot.render(app)
        appRoot.flush()
        space = body.querySelector("space") as SpaceElement
        viewPoint = space.querySelector("viewpoint") as ViewPointElement
        state.space = space
        documentProjections.clear()
      },
      get presentedFrame() {
        return state.frames
      },
      get disposed() {
        return disposed
      },
      getProjection,
      subscribePresented(listener) {
        presented.add(listener)
        return () => presented.delete(listener)
      },
      dispatchKey: () => true,
      dispatchText: () => true,
      resetViewPoint() {},
      render() {
        const nextFrame = state.frames + 1
        if (state.failRenderAt === nextFrame) throw new Error("frame failed")
        state.frames = nextFrame
        for (const [owner, binding] of documentProjections) {
          const frame = fakeRenderFrame(document, owner, state.frames)
          binding.setFrame(frame)
          for (const listener of binding.subscribers) listener(frame)
        }
        for (const listener of presented) listener(state.frames)
      },
      invalidate() {},
      resize() {},
      captureLastPresentedFramePng: async () => new Blob(["fake-png"], {type: "image/png"}),
      unmount() {
        if (disposed) return
        disposed = true
        appRoot.unmount()
        clipboard.dispose()
        state.disposals += 1
        state.lifecycle.push("root-dispose")
        presented.clear()
        documentProjections.clear()
      },
    })
    return root
  })
}

function fakeRenderFrame(
  document: ReturnType<typeof createDocument>,
  root: DisplayElement | HUDElement,
  revision: number,
): RenderFrame {
  return Object.freeze({
    revision,
    document,
    root,
    viewport: Object.freeze({width: 1024, height: 768}),
    boxes: Object.freeze([]),
    boxByNode: new Map(),
    displayList: Object.freeze([]),
    hits: new Map(),
    scrolls: new Map(),
  })
}
