import {ViewPoint, Vector3} from "@zavx0z/immersive-engine"
/** Переходы и обновления одной страницы.
@packageDocumentation
*/
import {describe} from "bun:test"
import WebProtocol from "@zavx0z/storybook-app-web-protocol"
import type {ComponentValue} from "@zavx0z/immersive-component"
import type {JSX} from "@zavx0z/immersive-jsx-compiler-session"
import {expect, test} from "bun:test"
import {join} from "node:path"
import {DisplayElement} from "@zavx0z/immersive-dom/display"
import {createRoot} from "@zavx0z/immersive-component"
import {createDocumentClipboardController} from "@zavx0z/immersive-browser/clipboard"
import {createDocument, PointerEvent, MouseEvent} from "@zavx0z/immersive-dom"
import type {Presentation as Root, RootDocumentProjection, RootProjection, RootSpaceProjection} from "@zavx0z/immersive-browser/integration"
import type {RenderFrame} from "@zavx0z/immersive-renderer-html"
import {createSpaceElementFactories} from "@zavx0z/immersive-space"
import {HUDElement} from "@zavx0z/immersive-dom/hud"
import {SpaceElement} from "@zavx0z/immersive-dom/space"
import {ViewPointElement} from "@zavx0z/immersive-dom/viewpoint"
import presentationRootFixture from "@zavx0z/storybook-tech-testing-browser-root"
import discoverStorybookPackages from "@zavx0z/storybook-package-metadata-collect"
import createExternalStorybookGraph, {type StorybookPackageGraphCreate} from "@zavx0z/storybook-package-graph-create"
import type {StorybookPackageSession} from "@zavx0z/storybook-package-session"
import Revision from "@zavx0z/storybook-package-revision"
import WebNavigationOwner from "@zavx0z/storybook-app-web-page-navigation"
import PagePackageOwner from "@zavx0z/storybook-app-web-page-package"
import type {StorybookAppWebPagePackage} from "@zavx0z/storybook-app-web-page-package"
import startExternalStorybookPage from "@zavx0z/storybook-app-web-page"
import type {StorybookAppWebPage} from "@zavx0z/storybook-app-web-page"
import createStorybookAgentBridge, {type StorybookAppWebPageAgentBridge} from "@zavx0z/storybook-app-web-page-agent-bridge"
import type {StorybookAppWebPageShell} from "@zavx0z/storybook-app-web-page-shell"

type StorybookSharedHost = ReturnType<typeof WebProtocol.validateSharedHost>

type ExternalStorybookGraph = StorybookPackageGraphCreate.Output

type StorybookPackageSessionSnapshot = ReturnType<StorybookPackageSession.Output["snapshot"]>

const deriveExternalStorybookPackageTab = WebNavigationOwner.deriveExternalStorybookPackageTab

const STORYBOOK_PAGE_REALM_PROTOCOL = PagePackageOwner.protocol

type ExternalStorybookPackageEnvironment = NonNullable<StorybookAppWebPagePackage.Input["environment"]>

type ExternalStorybookPreparedPackageTarget = Extract<NonNullable<StorybookAppWebPage.Input["initialTarget"]>, {kind: "revision" | "fallback"}>

const STORYBOOK_AGENT_BRIDGE_GLOBAL = createStorybookAgentBridge.global

type StorybookAgentBridge = StorybookAppWebPageAgentBridge.Output

type ExternalStorybookRootFactory = NonNullable<StorybookAppWebPageShell.Input["createRoot"]>

const fixtureRoot = join(import.meta.dir, "../../../../package/metadata/collect/fixtures/valid")

const packageId = "@fixture/components"

const packagePath = "/fixture-workspace/projects/alpha/packages/components"

/** Текущая точка входа переживает замену платформенного экземпляра bridge. */
function currentBridge(): StorybookAgentBridge {
  return (globalThis as typeof globalThis & Record<string, unknown>)[STORYBOOK_AGENT_BRIDGE_GLOBAL] as StorybookAgentBridge
}

/** Реальный page controller с управляемыми immutable payloads и наблюдаемым Root lifecycle. */
async function pageFixture(failPlatformMount = false, changePlatform = true, beforePrepare?: (input: Parameters<NonNullable<StorybookAppWebPage.Input["prepareTarget"]>>[0], signal: AbortSignal) => Promise<void>, selectedPackageId: string | null = "@fixture/components", stableNavigation = false, navigationCandidate = false, strictHostGrants = false, hostPreparation?: (phase: "read" | "import") => Promise<void>) {
  const packageId = selectedPackageId ?? "@fixture/components"
  const graph = await fixtureGraph()
  const snapshot = WebProtocol.clientSnapshot(graph, packageSnapshots(graph, "revision-a"), "Fixture Project")
  const packagePath = selectedPackageId === null ? "/" : deriveExternalStorybookPackageTab(snapshot, packageId, "").urlPath
  const environment = environmentFixture(snapshot, packagePath)
  const location = environment.location as LocationFixture
  const history = environment.history as ReturnType<typeof historyFixture>
  Object.assign(environment.browserDocument!, {location})
  const state = createFakeRootState()
  const payload = (revision: string, ownerId = packageId) => ({
    protocol: STORYBOOK_PAGE_REALM_PROTOCOL,
    packageId: ownerId,
    candidateRevision: revision,
    revisionUrl: `/__storybook/revisions/${encodeURIComponent(ownerId)}/${revision}/`,
    sharedModuleEpoch: (revision === "revision-a" || !changePlatform ? "a" : "b").repeat(64),
    hostModuleEpoch: (revision === "revision-a" ? "a" : "b").repeat(64),
    graphSnapshot: Revision.create(graph, ownerId, revision),
    startPage: async () => { throw new Error("Ревизия пакета не выбирает page host") },
    startPackage: async () => { throw new Error("Ревизия пакета не выбирает package host") },
  })
  const target = (revision: string, route = "", ownerId = packageId): ExternalStorybookPreparedPackageTarget => ({
    kind: "revision", packageId: ownerId, revision,
    revisionUrl: payload(revision, ownerId).revisionUrl,
    route, urlPath: deriveExternalStorybookPackageTab(snapshot, ownerId, route).urlPath,
    intent: navigationCandidate ? "navigation-candidate" : "reader", preview: false, initialAppliedRevision: "revision-a", fallbackRevision: null,
    readerToken: "fixture-reader",
  })
  let hostRevision = "a"
  const requests: string[] = []
  const sockets: FakeSocket[] = []
  let nextSocket = Promise.withResolvers<FakeSocket>()
  const confirmation = Promise.withResolvers<void>()
  const hostReaders: string[] = []
  const hostRequests: Readonly<{epoch: string | undefined; token: string; preview: boolean}>[] = []
  const previewGrants = new Map<string, string>()
  const candidateGrants = new Map<string, string>()
  const payloadLoads: string[] = []
  const controllers = new Map<string, StorybookAppWebPagePackage.Output>()
  const packageStarts: string[] = []
  const navigationTargets: Readonly<{
    packageId: string | null
    route: string
  }>[] = []
  let readerGeneration = 0
  const sharedHost = (epoch = "a".repeat(64)): StorybookSharedHost => ({
    protocol: "storybook-shared-host/1", sharedModuleEpoch: epoch, hostModuleEpoch: hostRevision.repeat(64),
    pageEntryUrl: `/__storybook/shared/page-${hostRevision}.js`,
    authorStyleSheets: [],
  })
  const page = await startExternalStorybookPage({
    browserDocument: environment.browserDocument!, location, history: environment.history!,
    sharedModuleEpoch: "a".repeat(64),
    hostModuleEpoch: "a".repeat(64),
    initialTarget: selectedPackageId === null ? {kind: "landing", pathname: "/", readerToken: "fixture-reader"} : target("revision-a"),
    ...(selectedPackageId === null ? {} : {initialPayload: payload("revision-a")}),
    sharedHost: sharedHost(),
    startPackage: async input => {
      packageStarts.push(input.packageId)
      const controller = await PagePackageOwner(input)
      controllers.set(input.packageId, controller)
      return controller
    },
    readSharedHost: async (epoch, token, _signal, preview = false) => {
      hostReaders.push(token)
      hostRequests.push({epoch, token, preview})
      await hostPreparation?.("read")
      if (strictHostGrants && preview && previewGrants.get(token) !== epoch && candidateGrants.get(token) !== epoch) {
        throw new Error("Shared host preview is not authorized: 403")
      }
      if (strictHostGrants && preview) {
        const revision = epoch === "a".repeat(64) ? "a" : "b"
        return {...sharedHost(epoch), hostModuleEpoch: revision.repeat(64), pageEntryUrl: `/__storybook/shared/page-${revision}.js`}
      }
      return sharedHost(epoch)
    },
    importSharedHost: async () => {
      await hostPreparation?.("import")
      return async options => startExternalStorybookPage({...options,
        ...(failPlatformMount && options.hostModuleEpoch === "b".repeat(64)
          ? {startPackage: async () => { throw new Error("new platform mount failed") }} : {}),
      })
    },
    shell: {...environment.shell!, createRoot: fakeRootFactory(state)},
    fetcher: (async (input, init) => {
      requests.push(String(input))
      if (String(input) === "/api/browser/confirm-navigation") confirmation.resolve()
      if (String(input) === "/api/browser/route" && typeof init?.body === "string") {
        const address = JSON.parse(init.body).route
        const node = snapshot.nodes.find(value => value.urlPath === address)
        return node?.packageId ? Response.json({packageId: node.packageId, route: node.routePath ?? "", urlPath: node.urlPath}) : Response.json({error: "Unknown address"}, {status: 404})
      }
      if (String(input).includes("/api/browser/session")) {
        const token = `reader-${++readerGeneration}`
        // Как сервер: новый built B имеет navigation-candidate grant, прежняя A — обычный reader.
        if (strictHostGrants && typeof init?.body === "string" && JSON.parse(init.body).revision === "revision-b") {
          candidateGrants.set(token, payload("revision-b").sharedModuleEpoch)
        }
        return Response.json({token})
      }
      return Response.json(snapshot)
    }) as typeof fetch,
    createSocket: url => {
      const socket = new FakeSocket()
      socket.url = url
      sockets.push(socket)
      const created = nextSocket
      nextSocket = Promise.withResolvers<FakeSocket>()
      created.resolve(socket)
      return socket
    },
    prepareTarget: async (input, signal) => {
      navigationTargets.push({packageId: input.packageId, route: input.route})
      // Подготовка пакетов моделирует HMR; переход домой сохраняет текущий host.
      if (input.packageId !== null && !stableNavigation) hostRevision = "b"
      await beforePrepare?.(input, signal)
      if (input.packageId === null) return {kind: "landing", pathname: input.route, readerToken: `reader-${++readerGeneration}`}
      const prepared = target(input.requestedRevision ?? (stableNavigation ? "revision-a" : "revision-c"), input.route, input.packageId)
      if (strictHostGrants && input.intent === "preview") {
        const readerToken = `preview-${++readerGeneration}`
        previewGrants.set(readerToken, payload(prepared.revision!, input.packageId).sharedModuleEpoch)
        return {...prepared, readerToken, intent: "preview", preview: true}
      }
      return prepared
    },
    loadAppliedRevision: async (ownerId, revision) => {
      payloadLoads.push(`${ownerId}:${revision}`)
      return payload(revision, ownerId)
    },
  })
  return {page, state, location, history, snapshot, sockets, hostReaders, hostRequests, payloadLoads, controllers, packageStarts, navigationTargets, requests,
    confirmation: confirmation.promise,
    nextSocket: async () => {
      const socket = await nextSocket.promise
      await socket.listening.promise
      return socket
    },
    replayHost(socket: FakeSocket) {
      socket.emit("message", {data: JSON.stringify({type: "shared.updated", host: sharedHost()})})
    },
    updateHost(broadcast = true) {
      hostRevision = "b"
      if (broadcast) for (const socket of [...sockets]) if (!socket.closed) socket.emit("message", {data: JSON.stringify({type: "shared.updated", host: sharedHost()})})
    },
  }
}

class FakeSocket {
  readonly listening = Promise.withResolvers<void>()
  url = ""
  sent: string[] = []
  closed = false
  readonly listeners = new Map<string, Set<(event: any) => void>>()

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
    if (type === "message") this.listening.resolve()
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

function environmentFixture(
  snapshot: ReturnType<typeof WebProtocol.clientSnapshot>,
  pathname: string,
): ExternalStorybookPackageEnvironment {
  const location = locationFixture(pathname)
  return {
    browserDocument: {documentElement: {dataset: {}}, defaultView: {name: "", addEventListener() {}, removeEventListener() {}}} as unknown as globalThis.Document,
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
      ...fakeWorldProjection(() => viewPoint, options.canvas),
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
      if (owner.ownerDocument !== document || owner.closest("space") !== space) {
        throw new Error("Fake Root projection owner must belong to the same semantic Space")
      }
      const subscribers = new Set<(frame: RenderFrame) => void>()
      let frame: RenderFrame | null = null
      const projection: RootDocumentProjection = Object.freeze({
        kind: owner instanceof DisplayElement ? "display" : "hud",
        owner,
        projectPoint: (point: {x: number; y: number}) => point,
        unprojectPoint: () => null,
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
        appRoot.flush()
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

describe("Переходы и обновления одной страницы", () => {
  test.each(["back", "route"] as const)("ручной адрес отменяет pending Follow до позднего transport: %s", async mode => {
    const listeners = new Set<() => void>()
    const addDescriptor = Object.getOwnPropertyDescriptor(globalThis, "addEventListener")
    const removeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "removeEventListener")
    const add = globalThis.addEventListener
    const remove = globalThis.removeEventListener
    Object.defineProperty(globalThis, "addEventListener", {configurable: true, value(type: string, listener: EventListener, options?: AddEventListenerOptions) {
      if (type === "popstate") {listeners.add(listener as () => void); return}
      add?.call(globalThis, type, listener, options)
    }})
    Object.defineProperty(globalThis, "removeEventListener", {configurable: true, value(type: string, listener: EventListener, options?: EventListenerOptions) {
      if (type === "popstate") {listeners.delete(listener as () => void); return}
      remove?.call(globalThis, type, listener, options)
    }})
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let fixture: Awaited<ReturnType<typeof pageFixture>> | undefined
    try {
      fixture = await pageFixture(false, false, async input => {
        if (input.packageId !== "@fixture/standalone") return
        entered.resolve()
        await release.promise
      }, packageId, true)
      const canvas = fixture.page.shell.canvas
      fixture.page.shell.setFollowEnvironment(true)
      const address = deriveExternalStorybookPackageTab(fixture.snapshot, "@fixture/standalone", "").urlPath
      fixture.sockets[0]!.emit("message", {data: JSON.stringify({type: "environment.activity", id: "history-stall", address, startedAt: 100})})
      await entered.promise
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const manual = mode === "route" ? fixture.controllers.get(packageId)!.navigate("dir-docs") : (async () => {
          fixture!.history.replaceState(null, "", "/")
          for (const listener of [...listeners]) listener()
          await fixture!.page.whenSettled()
        })()
        await Promise.race([manual, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Pending Follow blocked manual history/route")), 2000)
        })])
      } finally {if (timer !== undefined) clearTimeout(timer)}
      const manualAddress = fixture.location.href
      expect(fixture.location.pathname, "Ручной адрес принят до ответа старого transport").toBe(mode === "back" ? "/" : `${packagePath}/docs`)
      expect(fixture.page.shell.canvas, "Ручной адрес сохраняет Canvas workspace").toBe(canvas)
      release.resolve()
      await fixture.page.whenSettled()
      expect(fixture.location.href, "Поздний Follow не перезаписывает ручной адрес").toBe(manualAddress)
      expect(fixture.packageStarts, "Отменённый Follow не создаёт controller другого пакета").toEqual([packageId])
    } finally {
      release.resolve()
      await fixture?.page.dispose()
      if (addDescriptor !== undefined) Object.defineProperty(globalThis, "addEventListener", addDescriptor)
      else Reflect.deleteProperty(globalThis, "addEventListener")
      if (removeDescriptor !== undefined) Object.defineProperty(globalThis, "removeEventListener", removeDescriptor)
      else Reflect.deleteProperty(globalThis, "removeEventListener")
    }
  })

  test.each(["read", "import"] as const)("отмена Follow освобождает очередь при незавершённой подготовке host: %s", async phase => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let stalled = false
    const fixture = await pageFixture(false, false, undefined, packageId, false, false, false, async current => {
      if (current !== phase || stalled) return
      stalled = true
      entered.resolve()
      await release.promise
    })
    const canvas = fixture.page.shell.canvas
    try {
      fixture.page.shell.setFollowEnvironment(true)
      const address = deriveExternalStorybookPackageTab(fixture.snapshot, "@fixture/standalone", "").urlPath
      fixture.sockets[0]!.emit("message", {data: JSON.stringify({type: "environment.activity", id: "host-stall", address, startedAt: 100})})
      await entered.promise
      fixture.page.shell.setFollowEnvironment(false)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([fixture.page.navigateLanding("/"), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Canceled host preparation blocked manual navigation")), 2000)
        })])
      } finally {if (timer !== undefined) clearTimeout(timer)}
      expect(fixture.page.packageId, "Ручной переход завершён до ответа host transport/import").toBeNull()
      expect(fixture.page.shell.canvas, "Host cancellation сохраняет общий native Canvas").toBe(canvas)
      const manualAddress = fixture.location.href
      const creations = fixture.state.creations
      const starts = [...fixture.packageStarts]
      release.resolve()
      await fixture.page.whenSettled()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(fixture.location.href, "Поздний host не фиксирует отменённый адрес").toBe(manualAddress)
      expect(fixture.state.creations, "Поздний host не создаёт новый Root").toBe(creations)
      expect(fixture.packageStarts, "Поздний host не запускает отменённый package controller").toEqual(starts)
    } finally {release.resolve(); await fixture.page.dispose()}
  })

  test("Следовать меняет адрес по start, сохраняет режим и использует настоящий landing bridge", async () => {
    const fixture = await pageFixture(false, false, undefined, packageId, true)
    const shell = fixture.page.shell
    const address = fixture.location.href
    const destination = deriveExternalStorybookPackageTab(fixture.snapshot, "@fixture/standalone", "").urlPath
    const event = {type: "environment.activity", id: "work-1", address: destination, startedAt: 100}
    try {
      expect(await currentBridge().call("identity"), "Режим workspace выключен по умолчанию").toMatchObject({followEnvironment: false, capabilities: {inPageNavigation: true}})
      fixture.sockets[0]!.emit("message", {data: JSON.stringify(event)})
      await fixture.page.whenSettled()
      expect(fixture.location.href, "Выключенный режим не меняет адрес").toBe(address)
      const toggle = shell.hud.querySelector('[aria-label="Следовать"]')!
      toggle.dispatchEvent(new MouseEvent("click", {bubbles: true}))
      shell.presentFrame()
      expect(toggle.getAttribute("aria-pressed"), "Переключатель раскрывает включённое состояние").toBe("true")
      fixture.sockets[0]!.emit("message", {data: JSON.stringify({...event, id: "work-2", startedAt: 200})})
      await fixture.page.whenSettled()
      expect(fixture.page.packageId, "Start выбирает адрес сущности окружения").toBe("@fixture/standalone")
      const prepared = fixture.navigationTargets.length
      for (const socket of fixture.sockets) if (!socket.closed) socket.emit("message", {data: JSON.stringify({...event, id: "same-address", startedAt: 300})})
      await fixture.page.whenSettled()
      expect(fixture.navigationTargets.length, "Повтор адреса через несколько sockets не подготавливает содержимое").toBe(prepared)
      const identity = await currentBridge().call("navigate", {schemaVersion: 1, expectedPackageId: "@fixture/standalone", packageId: null, route: "", url: "/"})
      expect(identity, "Корневой обзор имеет nullable package identity и рабочий bridge").toMatchObject({packageId: null, revision: null, route: "", ready: true, followEnvironment: true, viewName: "storybook:workspace", selected: null})
      fixture.updateHost()
      await fixture.page.whenSettled()
      expect(await currentBridge().call("identity"), "HMR сохраняет режим общего workspace").toMatchObject({packageId: null, followEnvironment: true})
    } finally { await fixture.page.dispose() }
  })

  test("выключение Следовать отменяет позднюю подготовку и освобождает ручной переход", async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const fixture = await pageFixture(false, false, async input => {
      if (input.packageId !== "@fixture/standalone") return
      entered.resolve()
      await release.promise
    }, packageId, true)
    const shell = fixture.page.shell
    const address = fixture.location.href
    try {
      shell.setFollowEnvironment(true)
      const destination = deriveExternalStorybookPackageTab(fixture.snapshot, "@fixture/standalone", "").urlPath
      fixture.sockets[0]!.emit("message", {data: JSON.stringify({type: "environment.activity", id: "slow", address: destination, startedAt: 100})})
      await entered.promise
      shell.setFollowEnvironment(false)
      await fixture.page.whenSettled()
      expect(fixture.location.href, "Отмена ожидания сохраняет committed адрес до позднего ответа").toBe(address)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([fixture.page.navigateLanding("/"), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Canceled Follow blocked manual navigation")), 2000)
        })])
      } finally {if (timer !== undefined) clearTimeout(timer)}
      expect(fixture.page.packageId, "Ручной переход завершается до освобождения игнорирующего abort transport").toBeNull()
      expect(fixture.page.shell.canvas, "Отмена и ручной переход сохраняют native Canvas").toBe(shell.canvas)
      const manualAddress = fixture.location.href
      release.resolve()
      await new Promise(resolve => setTimeout(resolve, 0))
      await fixture.page.whenSettled()
      expect(fixture.payloadLoads, "Поздний target не загружает payload после выключения").toEqual([])
      expect(fixture.packageStarts, "Поздний target не создаёт новое исполнение").toEqual([packageId])
      expect(fixture.location.href, "Поздняя подготовка не меняет адрес ручного перехода").toBe(manualAddress)
      await expect(currentBridge().call("navigate", {schemaVersion: 1, expectedPackageId: null, packageId: "@fixture/standalone", route: "", followEnvironment: true}),
        "Backend follow navigation проверяет актуальное состояние переключателя").rejects.toThrow("following was disabled")
    } finally {release.resolve(); await fixture.page.dispose()}
  })

  test("ViewPoint и idle сохраняют холодный Display без загрузки; новый адрес загружает пакет", async () => {
    const fixture = await pageFixture(false, false, undefined, packageId, true)
    const shell = fixture.page.shell
    const address = fixture.location.href
    const workload = (requests: readonly string[]) => requests.filter(value => /^(?:\/api\/browser\/(?:prepare|session|confirm-navigation|scenarios)|\/api\/control\/(?:check|app\/web\/rebuild)|\/api\/client\/node|\/__storybook\/revisions\/)/u.test(value))
    const requests = workload(fixture.requests)
    const coldPath = deriveExternalStorybookPackageTab(fixture.snapshot, "@fixture/standalone", "").urlPath
    try {
      shell.selectSubject(coldPath, true)
      for (let frame = 0; frame < 12; frame++) {
        shell.presentFrame()
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      await new Promise(resolve => setTimeout(resolve, 220))
      expect(fixture.navigationTargets, "Фокусировка холодного Display меняет ViewPoint без server preparation").toEqual([])
      expect(fixture.payloadLoads, "Представленные кадры и idle не импортируют payload холодного пакета").toEqual([])
      expect(fixture.packageStarts, "Холодный пакет не получает controller до перехода по адресу").toEqual([packageId])
      shell.viewPoint.x += 25
      shell.viewPoint.targetX += 25
      shell.presentFrame()
      for (const label of ["Отдалить ViewPoint", "Вписать в область просмотра"]) {
        const action = shell.hud.querySelector(`[aria-label="${label}"]`)!
        expect(action, "Команда ViewPoint доступна в общем HUD").not.toBeNull()
        expect(action.hasAttribute("disabled"), "Команда ViewPoint исполняется в готовой среде").toBe(false)
        action.dispatchEvent(new MouseEvent("click", {bubbles: true}))
        for (let frame = 0; frame < 8; frame++) {
          shell.presentFrame()
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        await new Promise(resolve => setTimeout(resolve, 220))
      }
      expect(workload(fixture.requests), "Обзор, pan, zoom, fit и idle не отправляют запросы содержимого или сборки; registry grants остаются lifecycle подписок").toEqual(requests)
      expect(fixture.navigationTargets, "Перемещение ViewPoint не разрешает подготовку другой цели").toEqual([])
      expect(fixture.payloadLoads, "Изменение обзора не загружает код пакетов").toEqual([])
      expect(fixture.packageStarts, "Изменение обзора не создаёт предметные исполнения").toEqual([packageId])
      expect(fixture.location.href, "Перемещение ViewPoint сохраняет выбранный адрес").toBe(address)
      expect(fixture.page.packageId, "Обзор холодного Display не выбирает его пакет").toBe(packageId)
      await fixture.page.navigatePackage({packageId: "@fixture/standalone", route: ""})
      expect(fixture.navigationTargets, "Явный переход по новому адресу готовит одну цель").toEqual([
        {packageId: "@fixture/standalone", route: ""},
      ])
      expect(fixture.payloadLoads, "Новый адрес загружает точную ревизию выбранного пакета").toEqual(["@fixture/standalone:revision-a"])
      expect(fixture.packageStarts, "Новый пакет получает собственное исполнение").toEqual([packageId, "@fixture/standalone"])
      expect(fixture.location.pathname, "Успешный переход фиксирует адрес нового пакета").toBe(coldPath)
    } finally { await fixture.page.dispose() }
  })

  test("текущий адрес и повтор в очереди сохраняют исполнение без подготовки", async () => {
    const fixture = await pageFixture(false, false, undefined, packageId, true)
    const shell = fixture.page.shell
    const address = fixture.location.href
    const requests = [...fixture.requests]
    const input = shell.document.createElement("input")
    input.value = "Состояние текущего адреса"
    shell.mountPreview("Состояние", input)
    try {
      await Promise.all([
        fixture.page.navigatePackage({packageId, route: ""}),
        fixture.page.navigatePackage({packageId, route: ""}),
      ])
      expect(fixture.requests, "Повтор текущего адреса не создаёт pending session или запросы содержимого").toEqual(requests)
      expect(fixture.navigationTargets, "Повтор текущего адреса не вызывает server preparation").toEqual([])
      expect(fixture.payloadLoads, "Повтор текущего адреса не импортирует payload").toEqual([])
      expect(fixture.packageStarts, "Повтор текущего адреса сохраняет controller").toEqual([packageId])
      expect(shell.display.contains(input), "Текущий Frame сохраняет смонтированное содержимое").toBe(true)
      expect(input.value, "Состояние текущего Frame сохраняется").toBe("Состояние текущего адреса")
      await Promise.all([
        fixture.page.navigatePackage({packageId: "@fixture/standalone", route: ""}),
        fixture.page.navigatePackage({packageId: "@fixture/standalone", route: ""}),
        fixture.page.navigatePackage({packageId, route: ""}),
      ])
      expect(fixture.navigationTargets, "Очередь сравнивает адрес после завершения предыдущего перехода").toEqual([
        {packageId: "@fixture/standalone", route: ""},
        {packageId, route: ""},
      ])
      expect(fixture.payloadLoads, "Только два изменения адреса загружают ревизии").toEqual([
        "@fixture/standalone:revision-a", `${packageId}:revision-a`,
      ])
      expect(fixture.packageStarts, "Возврат по адресу использует уже посещённое исполнение").toEqual([packageId, "@fixture/standalone"])
      expect(fixture.page.shell, "Последний переход возвращает сохранённый Frame").toBe(shell)
      expect(fixture.location.href, "Последний переход в очереди определяет адрес страницы").toBe(address)
      expect(input.value, "Возврат сохраняет локальное состояние посещённого Frame").toBe("Состояние текущего адреса")
    } finally { await fixture.page.dispose() }
  })

  test("два пакета сохраняют собственное содержимое и возвращаются без remount", async () => {
    const fixture = await pageFixture(false, false, undefined, packageId, true)
    try {
      const first = fixture.page.shell
      const input = first.document.createElement("input")
      input.value = "Сохранённый ввод"
      first.mountPreview("Состояние", input)
      await fixture.page.navigatePackage({packageId: "@fixture/standalone", route: ""})
      const second = fixture.page.shell
      expect(second).not.toBe(first)
      expect(second.root).toBe(first.root)
      expect(second.canvas).toBe(first.canvas)
      expect(second.document).toBe(first.document)
      expect(first.display.contains(input)).toBe(true)
      await fixture.page.navigatePackage({packageId, route: ""})
      expect(fixture.page.shell).toBe(first)
      expect(input.value).toBe("Сохранённый ввод")
      expect(second.display.isConnected).toBe(true)
      expect(fixture.state.creations).toBe(1)
      expect(fixture.location.reloads).toBe(0)
    } finally { await fixture.page.dispose() }
  })

  test("выбор посещённого Frame сохраняет внутренний маршрут во время перехода на другой адрес", async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let block = false
    const fixture = await pageFixture(false, false, async () => {
      if (!block) return
      entered.resolve()
      await release.promise
    }, packageId, true)
    try {
      const warm = fixture.page.shell
      const workbench = warm.workbench
      const controller = fixture.controllers.get(packageId)!
      expect(controller).toBeDefined()
      const button = warm.document.createElement("button")
      button.textContent = "Открыть docs"
      let routeChange: Promise<void> | undefined
      button.addEventListener("click", () => { routeChange = controller.navigate("dir-docs") })
      warm.mountPreview("Навигация из тёплого Frame", button)
      await fixture.page.navigatePackage({packageId: "@fixture/standalone", route: ""})
      const beforeTargets = fixture.navigationTargets.length
      const beforeLoads = fixture.payloadLoads.length
      const beforeHosts = fixture.hostReaders.length
      expect(button.isConnected).toBe(true)
      expect(button.closest("display")).not.toBeNull()
      // Page занят переходом на Project. Нормальная кнопка в
      // посещённом Frame выбирает его на pointerdown и вызывает публичный
      // Package.navigate своей независимой очереди на click.
      block = true
      const navigating = fixture.page.navigateLanding("/")
      await entered.promise
      button.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerId: 1}))
      button.dispatchEvent(new MouseEvent("click", {bubbles: true}))
      expect(routeChange).toBeDefined()
      await routeChange
      expect(controller.currentRoute).toBe("dir-docs")
      release.resolve()
      await navigating
      await fixture.page.whenSettled()
      expect(fixture.page.packageId).toBe(packageId)
      expect(fixture.page.route).toBe("dir-docs")
      expect(fixture.page.shell).toBe(warm)
      expect(fixture.page.shell.workbench).toBe(workbench)
      expect(fixture.navigationTargets.length).toBe(beforeTargets + 1)
      expect(fixture.payloadLoads.length).toBe(beforeLoads)
      expect(fixture.hostReaders.length).toBe(beforeHosts + 1)
      expect(fixture.location.pathname).toBe(`${packagePath}/docs`)
      expect(fixture.state.creations).toBe(1)
    } finally {
      release.resolve()
      await fixture.page.dispose()
    }
  })

  test("внутренняя директория открывается в том же Display пакета без отдельного узла", async () => {
    const fixture = await pageFixture(false, false, undefined, packageId, true)
    try {
      const first = fixture.page.shell
      const displays = [...first.document.querySelectorAll("display")]
      await fixture.page.navigatePackage({packageId, route: "dir-docs"})
      expect(fixture.page.route).toBe("dir-docs")
      expect(fixture.page.shell).toBe(first)
      expect(fixture.page.shell.display).toBe(first.display)
      expect(fixture.history.pushed).toEqual([`${packagePath}/docs?inspector=chat`])
      expect([...first.document.querySelectorAll("display")]).toEqual(displays)
      expect(first.document.getElementById(`spatial-content-${encodeURIComponent(`${packagePath}/docs`)}`)).toBeNull()
      await fixture.page.navigatePackage({packageId, route: ""})
      expect(fixture.page.shell).toBe(first)
      expect(fixture.page.route).toBe("")
      expect(fixture.state.creations).toBe(1)
    } finally { await fixture.page.dispose() }
  })

  test("ревизия предмета сохраняет его Display, Workbench, поиск и прокрутку", async () => {
    const fixture = await pageFixture(false, false, undefined, packageId, true)
    try {
      const before = fixture.page.shell
      before.workbench.controller.update("catalog.search", "docs")
      before.workbench.elements.catalogItems.scrollTop = 57
      const result = await currentBridge().call("applyRevision", {expectedPackageId: packageId, revision: "revision-b"})
      expect(result).toMatchObject({packageId, revision: "revision-b"})
      expect(fixture.page.shell).toBe(before)
      expect(fixture.page.shell.workbench).toBe(before.workbench)
      expect(fixture.page.shell.display).toBe(before.display)
      expect(before.workbench.controller.read("catalog.search")).toBe("docs")
      expect(before.workbench.elements.catalogItems.scrollTop).toBe(57)
      expect(fixture.state.creations).toBe(1)
      expect(fixture.location.reloads).toBe(0)
    } finally { await fixture.page.dispose() }
  })

  test("фоновая ревизия другой платформы сохраняет работающую среду выбранного предмета", async () => {
    const fixture = await pageFixture(false, true, undefined, packageId, true)
    try {
      const first = fixture.page.shell
      await fixture.page.navigatePackage({packageId: "@fixture/standalone", route: ""})
      const selected = fixture.page.shell
      const address = fixture.location.href
      fixture.sockets[0]!.emit("message", {data: JSON.stringify({
        type: "package.updated", packageId, revision: "revision-b",
      })})
      const result = await currentBridge().call("identity")
      expect(result).toMatchObject({packageId: "@fixture/standalone", revision: "revision-a"})
      expect(fixture.page.shell).toBe(selected)
      expect(fixture.location.href).toBe(address)
      expect(fixture.state.creations).toBe(1)
      expect(first.display.isConnected).toBe(true)
      expect(first.workbench.controller.read("status").detail).toContain("Обновление отклонено")
    } finally { await fixture.page.dispose() }
  })

  test("явное применение ревизии не запускает повторное подтверждение навигации", async () => {
    const fixture = await pageFixture(false, false, undefined, packageId, true, true)
    try {
      const confirmations = () => fixture.requests.filter(path => path === "/api/browser/confirm-navigation").length
      await fixture.confirmation
      const before = confirmations()
      expect(before).toBe(1)
      await currentBridge().call("applyRevision", {expectedPackageId: packageId, revision: "revision-b"})
      await Promise.resolve()
      expect(confirmations()).toBe(before)
      expect(await currentBridge().call("identity")).toMatchObject({revision: "revision-b", ready: true})
    } finally { await fixture.page.dispose() }
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
        expect(fixture.location.href).toBe(`http://localhost${packagePath}?inspector=chat`)
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

  test("явный HMR и rollback читают exact host через preview grant, сохраняя normal scope и History", async () => {
    const fixture = await pageFixture(false, true, undefined, packageId, false, true, true)
    const address = fixture.location.href
    const before = await currentBridge().call("identity") as {timeOrigin: number}
    try {
      const updated = await currentBridge().call("applyRevision", {expectedPackageId: packageId, revision: "revision-b"})
      expect(updated).toMatchObject({packageId, revision: "revision-b", sharedModuleEpoch: "b".repeat(64), preview: false, timeOrigin: before.timeOrigin})
      const restored = await currentBridge().call("applyRevision", {expectedPackageId: packageId, revision: "revision-a"})
      expect(restored).toMatchObject({packageId, revision: "revision-a", sharedModuleEpoch: "a".repeat(64), preview: false, timeOrigin: before.timeOrigin})
      expect(fixture.hostRequests.map(({epoch, preview}) => ({epoch, preview}))).toEqual([
        {epoch: "b".repeat(64), preview: true},
        {epoch: "a".repeat(64), preview: true},
      ])
      expect(fixture.hostRequests.every(request => request.token.startsWith("preview-"))).toBe(true)
      expect(new Set(fixture.hostRequests.map(request => request.token)).size).toBe(2)
      expect(fixture.location.href).toBe(address)
      expect(fixture.history.pushed).toEqual([])
      expect(fixture.location.reloads).toBe(0)
    } finally { await fixture.page.dispose() }
  })

  test("ошибка HMR после создания новой оболочки восстанавливает прежнюю среду и освобождает кандидат", async () => {
      const fixture = await pageFixture(true)
      const canvas = fixture.page.shell.canvas
      try {
        await expect(currentBridge().call("applyRevision", {
          expectedPackageId: packageId, revision: "revision-b",
        })).rejects.toThrow("new platform mount failed")
        await expect(fixture.page.whenSettled()).rejects.toThrow("new platform mount failed")
        expect(await currentBridge().call("identity")).toMatchObject({packageId, revision: "revision-a"})
        expect(fixture.page.shell.canvas).toBe(canvas)
        expect(fixture.state.lifecycle).toEqual([
          "root-create", "root-dispose", "root-create", "root-dispose", "root-create",
        ])
        expect(fixture.location.reloads).toBe(0)
        expect(fixture.location.href).toBe(`http://localhost${packagePath}?inspector=chat`)
      } finally { await fixture.page.dispose() }
      expect(fixture.state.disposals).toBe(fixture.state.creations)
    })

  test("переход с HMR добавляет один history entry и сохраняет запрошенный маршрут", async () => {
      const fixture = await pageFixture()
      try {
        await fixture.page.navigatePackage({packageId, route: "dir-docs"})
        expect(fixture.page.route).toBe("dir-docs")
        expect(fixture.history.pushed).toEqual([`${packagePath}/docs?inspector=chat`])
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

  test("Домашняя ссылка с именем Project передаёт переход page controller", async () => {
    const fixture = await pageFixture(false, false)
    const shell = fixture.page.shell
    const minimap = shell.document.querySelector("[data-storybook-minimap] [data-window]")!
    const globalJournal = shell.hud.querySelector('[aria-label="Общий журнал вызовов"][data-window]')!
    const settings = shell.captureUserState().minimap
    try {
      expect(globalJournal).toBeDefined()
      expect(shell.document.querySelector('[aria-label="Журнал агента"][data-window]'), "Локальный журнал заменён чатом").toBeNull()
      expect(globalJournal.ownerDocument).toBe(shell.document)
      expect(shell.display.querySelector('[aria-label="Общий журнал вызовов"][data-window]')).toBeNull()
      expect(shell.hud.querySelector('[aria-label="Журнал агента"][data-window]')).toBeNull()
      const home = shell.workbench.elements.status.querySelector('[data-breadcrumb-id="storybook:root"] button') as import("@zavx0z/immersive-dom").HTMLButtonElement
      expect(home.textContent).toBe("Fixture Project")
      expect(home.hasAttribute("disabled")).toBeFalse()
      home.click()
      await fixture.page.whenSettled()
      expect(fixture.navigationTargets).toEqual([{packageId: null, route: "/"}])
      expect(fixture.page.packageId).toBeNull()
      expect(fixture.location.pathname).toBe("/")
      expect(fixture.page.shell.workbench.controller.read("status").breadcrumbs?.[0]?.label).toBe("Fixture Project")
      expect(fixture.page.shell).not.toBe(shell)
      expect(fixture.page.shell.root).toBe(shell.root)
      expect(fixture.page.shell.document).toBe(shell.document)
      expect(fixture.page.shell.space).toBe(shell.space)
      expect(shell.display.isConnected).toBe(true)
      expect(fixture.page.shell.document === shell.document).toBeTrue()
      expect(fixture.page.shell.space === shell.space).toBeTrue()
      expect(shell.document.querySelector("[data-storybook-minimap] [data-window]") === minimap).toBeTrue()
      expect(shell.hud.querySelector('[aria-label="Общий журнал вызовов"][data-window]')).toBe(globalJournal)
      expect(shell.captureUserState().localMcpWindows, "Удалённый локальный журнал не создаёт сохраняемого состояния").toBeUndefined()
      expect(fixture.page.shell.captureUserState().localMcpWindows, "Навигация не восстанавливает локальный журнал").toBeUndefined()
      expect(shell.captureUserState().minimap).toEqual(settings)
      expect(fixture.state.creations).toBe(1)
      expect(fixture.location.reloads).toBe(0)
    } finally { await fixture.page.dispose() }
  })

  test("общая оболочка обновляет landing и две package страницы без reload и смены Root", async () => {
    const first = await pageFixture(false, false)
    const second = await pageFixture(false, false, undefined, "@fixture/standalone")
    const landing = await pageFixture(false, false, undefined, null)
    const fixtures = [first, second, landing]
    const before = fixtures.map(fixture => ({shell: fixture.page.shell, address: fixture.location.href,
      document: fixture.page.shell.document, canvas: fixture.page.shell.canvas, packageId: fixture.page.packageId,
      settings: fixture.page.shell.captureUserState()}))
    try {
      first.page.shell.workbench.controller.update("catalog.search", "первое окно")
      second.page.shell.workbench.controller.update("catalog.search", "второе окно")
      first.page.shell.workbench.elements.catalogItems.scrollTop = 31
      second.page.shell.workbench.elements.catalogItems.scrollTop = 67
      for (const fixture of fixtures) fixture.updateHost()
      await Promise.all(fixtures.map(fixture => fixture.page.whenSettled()))
      for (const [index, fixture] of fixtures.entries()) {
        expect(fixture.page.shell).not.toBe(before[index]!.shell)
        expect(fixture.page.shell.document).toBe(before[index]!.document)
        expect(fixture.page.shell.canvas).toBe(before[index]!.canvas)
        expect(fixture.page.packageId).toBe(before[index]!.packageId)
        expect(fixture.location.href).toBe(before[index]!.address)
        expect(fixture.location.reloads).toBe(0)
        expect(fixture.state.creations).toBe(1)
        expect(fixture.page.shell.captureUserState()).toEqual(before[index]!.settings)
        expect(fixture.page.shell.browserDocument.documentElement.dataset.externalStorybookHostModuleEpoch).toBe("b".repeat(64))
        if (fixture.page.packageId !== null) expect(fixture.page.shell.browserDocument.documentElement.dataset.externalStorybookRevision).toBe("revision-a")
      }
      expect(first.page.shell.workbench.controller.read("catalog.search")).toBe("первое окно")
      expect(second.page.shell.workbench.controller.read("catalog.search")).toBe("второе окно")
      expect(first.page.shell.workbench.elements.catalogItems.scrollTop).toBe(31)
      expect(second.page.shell.workbench.elements.catalogItems.scrollTop).toBe(67)
    } finally {
      await first.page.dispose()
      await second.page.dispose()
      await landing.page.dispose()
    }
  })

  test.each([
    {name: "пакет", selectedPackageId: "@fixture/components", navigationCandidate: false, strictHostGrants: false},
    {name: "корневой обзор", selectedPackageId: null, navigationCandidate: false, strictHostGrants: false},
    {name: "кандидат пакета", selectedPackageId: "@fixture/components", navigationCandidate: true, strictHostGrants: true},
  ])("после reconnect $name читает опубликованный host через новый reader", async ({selectedPackageId, navigationCandidate, strictHostGrants}) => {
    const fixture = await pageFixture(false, false, undefined, selectedPackageId, false, navigationCandidate, strictHostGrants)
    const shell = fixture.page.shell
    try {
      const socket = fixture.sockets.at(-1)!
      socket.close()
      fixture.updateHost(false)
      const reconnected = fixture.nextSocket()
      socket.emit("close", {})
      await reconnected
      expect(fixture.sockets.at(-1)).not.toBe(socket)
      fixture.sockets.at(-1)!.emit("open", {})
      fixture.replayHost(fixture.sockets.at(-1)!)
      await fixture.page.whenSettled()
      expect(fixture.page.shell).not.toBe(shell)
      expect(fixture.hostReaders.at(-1)).toBe("reader-1")
      expect(fixture.hostRequests.at(-1), "Опубликованная оболочка читается обычным reader grant, включая бывшего кандидата").toEqual({
        epoch: selectedPackageId === null ? undefined : "a".repeat(64), token: "reader-1", preview: false,
      })
      expect(new Set(fixture.sockets.map(socket => socket.url)).size).toBe(fixture.sockets.length)
      expect(fixture.page.shell.document).toBe(shell.document)
      expect(fixture.page.shell.canvas, "Обновление Web сохраняет Canvas работающей платформы").toBe(shell.canvas)
      expect(fixture.location.reloads).toBe(0)
      expect(fixture.page.shell.browserDocument.documentElement.dataset.externalStorybookHostModuleEpoch).toBe("b".repeat(64))
      if (selectedPackageId !== null) expect(fixture.page.shell.browserDocument.documentElement.dataset.externalStorybookRevision).toBe("revision-a")
    } finally { await fixture.page.dispose() }
  })
})

/** Реальные числовые camera/ray/frustum в fake того же Root; отрисовка остаётся seam. */
function fakeWorldProjection(viewPoint: () => ViewPointElement, canvas: HTMLCanvasElement):
  Pick<RootSpaceProjection, "projectPoint" | "rayForPoint" | "frustumPlanes" | "fly"> {
  if (typeof canvas.getBoundingClientRect !== "function") Object.defineProperty(canvas, "getBoundingClientRect", {
    value: () => ({left: 0, top: 0, width: canvas.width || 1024, height: canvas.height || 768}),
  })
  const camera = () => {
    const current = viewPoint()
    const bounds = canvas.getBoundingClientRect()
    return new ViewPoint({
      position: {x: current.x, y: current.y, z: current.z},
      target: {x: current.targetX, y: current.targetY, z: current.targetZ},
      fov: current.fov,
      near: current.near,
      far: current.far,
      viewport: {left: bounds.left, top: bounds.top, width: bounds.width || 1024, height: bounds.height || 768},
    })
  }
  return {
    projectPoint(point) {
      const projection = camera()
      const view = new Vector3(point.x, point.y, point.z).applyMatrix4(projection.viewMatrix)
      if (view.z >= 0 || -view.z < projection.near || -view.z > projection.far) return null
      const projected = view.applyMatrix4(projection.projectionMatrix)
      const bounds = canvas.getBoundingClientRect()
      return {x: bounds.left + (projected.x + 1) * (bounds.width || 1024) / 2,
        y: bounds.top + (1 - projected.y) * (bounds.height || 768) / 2}
    },
    rayForPoint(point) {
      const ray = camera().rayForClientPoint(point)
      return ray === null ? null : {
        origin: {x: ray.origin.x, y: ray.origin.y, z: ray.origin.z},
        direction: {x: ray.direction.x, y: ray.direction.y, z: ray.direction.z},
      }
    },
    frustumPlanes(overscan) { return camera().frustumPlanes(overscan) },
    fly(distance, anchor) {
      const projection = camera()
      projection.fly(distance, anchor)
      const current = viewPoint()
      current.x = projection.position.x
      current.y = projection.position.y
      current.z = projection.position.z
      const target = projection.getTarget()
      current.targetX = target.x
      current.targetY = target.y
      current.targetZ = target.z
    },
  }
}
