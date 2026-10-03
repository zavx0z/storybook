import WebProtocol from "@app-web/protocol"
import RouteUrlOwner from "@route/url"
const storybookPackageUrlPath = RouteUrlOwner.storybookPackageUrlPath
import {DisplayElement} from "@zavx0z/dom/display"
import ScenarioInspector from "@scenario/inspector"
import presentationRootFixture from "@web/browser-fixture"
import {createRoot} from "@zavx0z/component"
import {createDocumentClipboardController} from "@zavx0z/browser/clipboard"
import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {createDocument} from "@zavx0z/dom"
import type {Presentation as Root, RootDocumentProjection, RootProjection, RootSpaceProjection} from "@zavx0z/browser/integration"
import type {RenderFrame} from "@renderer/html"
import {createSpaceElementFactories} from "@zavx0z/space"
import {HUDElement} from "@zavx0z/dom/hud"
import {SpaceElement} from "@zavx0z/dom/space"
import {ViewPointElement} from "@zavx0z/dom/viewpoint"
import discoverStorybookPackages from "@repo/discovery"
import createExternalStorybookGraph, {type PackageGraphCreate} from "@package-graph/create"
type ExternalStorybookGraph = PackageGraphCreate.Output
import type {PackageSession} from "@package/session"
type StorybookPackageSessionSnapshot = ReturnType<PackageSession.Output["snapshot"]>
import startExternalStorybookLanding from "@page/home"
import type {PageShell} from "@page/shell"
type ExternalStorybookRootFactory = NonNullable<PageShell.Input["createRoot"]>

const fixtureRoot = join(import.meta.dir, "../../../../../repo/discovery/fixtures/valid")

describe("external Storybook landing frontend", () => {
  test("updates Project name from an unchanged graph and keeps navigation in the same page", async () => {
    const graph = await fixtureGraph()
    let snapshot = WebProtocol.clientSnapshot(graph, packageSnapshots(graph), "Fixture Project")
    const location = {href: "http://127.0.0.1:3000/", pathname: "/", reload() {}}
    const history = {pushState(_data: unknown, _unused: string, path: string) {
      location.href = new URL(path, location.href).href
      location.pathname = new URL(location.href).pathname
    }}
    const requests: string[] = []
    const state = createFakeRootState()
    let onMessage: ((event: MessageEvent) => void) | undefined
    const controller = await startExternalStorybookLanding({
      browserDocument: {documentElement: {dataset: {}}, querySelector() { return null }} as unknown as Document,
      location,
      history,
      fetcher: (async input => {
        requests.push(String(input))
        if (String(input) === "/api/browser/registry-session") return new Response("", {status: 404})
        return Response.json(snapshot)
      }) as typeof fetch,
      createSocket() { return {
        addEventListener(type, listener) { if (type === "message") onMessage = listener },
        removeEventListener() {}, send() {}, close() {},
      } },
      async navigatePackage({packageId, route}) {
        const next = new URL(storybookPackageUrlPath(packageId, route), location.href)
        location.href = next.href
        location.pathname = next.pathname
      },
      shell: {canvas: {} as HTMLCanvasElement, loadFont: async () => ({}) as never, createRoot: fakeRootFactory(state)},
    })
    try {
      expect(controller.shell.workbench.controller.read("projectName")).toBe("Fixture Project")
      expect(controller.shell.document.querySelector("[data-storybook-minimap] [data-window-title]")?.textContent).toBe("Fixture Project")
      const home = controller.shell.workbench.elements.status.querySelector('[data-breadcrumb-id="storybook:root"] button')!
      expect(home.textContent).toBe("Fixture Project")
      expect(controller.shell.workbench.controller.read("status").breadcrumbs?.[0]?.label).toBe("Fixture Project")
      expect([...home.querySelectorAll("img")].some(icon => !icon.hasAttribute("hidden"))).toBeFalse()
      const navigation = controller.shell.workbench.controller.read("catalog.items")
      expect(navigation.filter(item => item.id.startsWith("package:")).map(item => item.id)).toEqual([
        "package:fixture-workspace", "package:fixture-alpha", "package:@fixture/components",
        "package:fixture-beta", "package:@fixture/docs", "package:@fixture/standalone",
      ])
      expect(navigation.find(item => item.id === "directory:package:@fixture/components/docs")?.parentId)
        .toBe("package:@fixture/components")
      for (const [id, path] of [
        ["package:fixture-workspace", "/pkg-fixture-workspace/"],
        ["package:fixture-alpha", "/pkg-fixture-alpha/"],
        ["package:@fixture/components", "/pkg-fixture-components/"],
        ["package:@fixture/standalone", "/pkg-fixture-standalone/"],
      ] as const) {
        await controller.select(id)
        expect(new URL(location.href).pathname).toBe(path)
      }
      // Callback выше проверяет package intent, но не монтирует новый page scope.
      // Домашнюю ссылку landing проверяем из его собственного обзора директории.
      await controller.select("directory:package:@fixture/components/docs")
      expect(controller.shell.workbench.controller.read("catalog.active")).toBe("directory:package:@fixture/components/docs")
      const homeButton = controller.shell.workbench.elements.status.querySelector('[data-breadcrumb-id="storybook:root"] button') as import("@zavx0z/dom").HTMLButtonElement
      expect(homeButton.hasAttribute("disabled")).toBeFalse()
      homeButton.click()
      await waitUntil(() => location.pathname === "/")
      expect(location.pathname).toBe("/")
      expect(controller.shell.workbench.controller.read("catalog.active")).toBeNull()
      expect(requests).toEqual(["/api/client", "/api/browser/registry-session", "/api/browser/registry-session", "/api/browser/registry-session"])
      const minimap = controller.shell.document.querySelector("[data-storybook-minimap] [data-window]")!
      const tree = minimap.querySelector('[role="tree"]')!
      snapshot = {...snapshot, projectName: "Renamed Project"}
      onMessage!({data: JSON.stringify({type: "registry.updated", graphDigest: snapshot.graphDigest})} as MessageEvent)
      await waitUntil(() => controller.shell.workbench.controller.read("projectName") === "Renamed Project")
      expect(minimap.querySelector("[data-window-title]")?.textContent).toBe("Renamed Project")
      expect(home.textContent).toBe("Renamed Project")
      expect(controller.shell.workbench.controller.read("status").breadcrumbs?.[0]?.label).toBe("Renamed Project")
      expect(controller.shell.document.querySelector("[data-storybook-minimap] [data-window]") === minimap).toBeTrue()
      expect(minimap.querySelector('[role="tree"]') === tree).toBeTrue()
      expect(controller.snapshot.graphDigest).toBe(graph.digest)
      await waitUntil(() => requests.filter(request => request === "/api/browser/registry-session").length === 4)
      expect(requests).toEqual(["/api/client", "/api/browser/registry-session", "/api/browser/registry-session", "/api/browser/registry-session", "/api/client", "/api/browser/registry-session"])
      expect(state.creations).toBe(1)
    } finally { controller.dispose() }
  })

  test("отложенные действия с Repo видны disabled и не изменяют каталог", async () => {
    const graph = await fixtureGraph()
    const snapshot = WebProtocol.clientSnapshot(graph, packageSnapshots(graph), "Fixture Project")
    const requests: string[] = []
    let picks = 0
    let reloads = 0
    const controller = await startExternalStorybookLanding({
      browserDocument: {
        documentElement: {dataset: {}},
        querySelector: () => ({content: "registry-session"}),
      } as unknown as globalThis.Document,
      pickDirectory: async () => {
        picks += 1
        throw new Error("Недоступное действие не открывает picker")
      },
      fetcher: (async input => {
        requests.push(String(input))
        if (String(input) === "/api/client") return Response.json(snapshot)
        if (String(input) === "/api/browser/registry-session") return new Response("", {status: 404})
        throw new Error("Недоступное действие не выполняет HTTP-запрос")
      }) as typeof fetch,
      location: {href: "http://localhost/", pathname: "/", reload() { reloads += 1 }},
      history: {pushState() {}},
      shell: {canvas: {} as HTMLCanvasElement, loadFont: async () => ({}) as never, createRoot: fakeRootFactory(createFakeRootState())},
    })
    try {
      const element = controller.shell.workbench.element
      const before = controller.shell.workbench.controller.read("catalog.items")
      const add = element.querySelector('[aria-label="Добавить репозиторий"]') as import("@zavx0z/dom").HTMLButtonElement
      const remove = element.querySelector('[aria-label="Удалить Fixture Workspace из каталога"]') as import("@zavx0z/dom").HTMLButtonElement
      expect(add.hasAttribute("disabled")).toBeTrue()
      expect(remove.hasAttribute("disabled")).toBeTrue()
      add.click()
      remove.click()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(picks).toBe(0)
      expect(requests).toEqual(["/api/client", "/api/browser/registry-session"])
      expect(controller.shell.workbench.controller.read("catalog.items")).toEqual(before)
      expect(element.querySelector('[aria-label="Развернуть всё дерево"]')!.hasAttribute("disabled")).toBeFalse()
      expect(element.querySelector('[aria-label="Свернуть всё дерево"]')!.hasAttribute("disabled")).toBeFalse()
      expect(reloads).toBe(0)
    } finally { controller.dispose() }
  })

  test("updates Project name and clears package Inspector while reusing the page shell", async () => {
    const graph = await fixtureGraph()
    const snapshot = WebProtocol.clientSnapshot(graph, packageSnapshots(graph), "Fixture Project")
    const browserDocument = {documentElement: {dataset: {}}, querySelector() { return null }} as unknown as Document
    const options = {
      browserDocument,
      location: {href: "http://localhost/", pathname: "/", reload() {}},
      fetcher: (async () => Response.json(snapshot)) as unknown as typeof fetch,
      createSocket() { return {addEventListener() {}, removeEventListener() {}, send() {}, close() {}} },
      shell: {canvas: {} as HTMLCanvasElement, loadFont: async () => ({}) as never, createRoot: fakeRootFactory(createFakeRootState())},
    }
    const first = await startExternalStorybookLanding(options)
    const workbench = first.shell.workbench
    const registry = workbench.controller.read("inspector.registry")
    workbench.update("inspector.subject", {packageId: "@fixture/components", subjectId: "stale", workspaceId: "stale", widgetIds: ["source"]})
    workbench.update("inspector.values", {source: "stale"})
    workbench.update("inspector.registry", [...registry, {
      id: "fixture-custom", kind: "custom", label: "X", title: "Fixture", component: ScenarioInspector,
    }] as never)
    const document = first.shell.document
    const space = first.shell.space
    const minimap = document.querySelector("[data-storybook-minimap] [data-window]")!
    const tree = minimap.querySelector('[role="tree"]')!
    const beforeState = first.shell.captureUserState()
    const second = await startExternalStorybookLanding({...options,
      fetcher: (async () => Response.json({...snapshot, projectName: "Renamed Project"})) as unknown as typeof fetch,
      pageScope: {
        shell: first.shell, initialPathname: "/", async navigatePackage() {},
      },
    })
    try {
      expect(workbench.controller.read("projectName")).toBe("Renamed Project")
      expect(document.querySelector("[data-storybook-minimap] [data-window-title]")?.textContent).toBe("Renamed Project")
      const home = workbench.elements.status.querySelector('[data-breadcrumb-id="storybook:root"] button')!
      expect(home.textContent).toBe("Renamed Project")
      expect(workbench.controller.read("status").breadcrumbs?.[0]?.label).toBe("Renamed Project")
      expect([...home.querySelectorAll("img")].some(icon => !icon.hasAttribute("hidden"))).toBeFalse()
      expect(first.shell.document === document).toBeTrue()
      expect(first.shell.space === space).toBeTrue()
      expect(document.querySelector("[data-storybook-minimap] [data-window]") === minimap).toBeTrue()
      expect(minimap.querySelector('[role="tree"]') === tree).toBeTrue()
      expect(first.shell.captureUserState().minimap).toEqual(beforeState.minimap)
      expect(workbench.controller.read("inspector.subject")).toEqual({subjectId: "/", workspaceId: "/", widgetIds: ["chat"]})
      expect(workbench.controller.read("inspector.values").source).toBeUndefined()
      expect(workbench.controller.read("inspector.values").chat).toMatchObject({address: "/", label: "Renamed Project"})
      expect(workbench.controller.read("inspector.registry")).toEqual(registry)
    } finally { second.dispose(); first.dispose() }
  })

})

async function fixtureGraph(): Promise<ExternalStorybookGraph> {
  return createExternalStorybookGraph(await discoverStorybookPackages([
    fixtureRoot,
    join(fixtureRoot, "standalone"),
  ]))
}

function packageSnapshots(graph: ExternalStorybookGraph): readonly StorybookPackageSessionSnapshot[] {
  return Object.freeze(graph.nodes.flatMap((node) => node.kind === "package" ? [Object.freeze({
    packageId: node.packageId!,
    declarationDigest: node.digest,
    moduleGraphRevision: "module-revision",
    candidateRevision: null,
    activeRevision: "revision-good",
    lastGoodRevision: "revision-good",
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
}

function createFakeRootState(): FakeRootState {
  return {creations: 0, disposals: 0, frames: 0}
}

function fakeRootFactory(
  state: FakeRootState = createFakeRootState(),
): ExternalStorybookRootFactory {
  return presentationRootFixture(async options => {
    state.creations += 1
    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const clipboard = createDocumentClipboardController(document)
    const html = document.createElement("html")
    const body = document.createElement("body")
    html.append(body)
    document.append(html)
    const appRoot = createRoot(body)
    appRoot.render(options.app)
    appRoot.flush()
    const space = body.querySelector("space") as SpaceElement
    const viewPoint = space.querySelector("viewpoint") as ViewPointElement
    const presented = new Set<(sequence: number) => void>()
    const documentProjections = new Map<DisplayElement | HUDElement, Readonly<{
      projection: RootDocumentProjection
      subscribers: Set<(frame: RenderFrame) => void>
      setFrame(frame: RenderFrame): void
    }>>()
    const spaceProjection: RootSpaceProjection = Object.freeze({
      kind: "space",
      owner: space,
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

    const root: Root = Object.freeze({
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
      space,
      viewPoint,
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
        state.frames += 1
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

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Project management did not settle")
    await Bun.sleep(5)
  }
}
