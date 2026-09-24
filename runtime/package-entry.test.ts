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
})

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
    const space = body.querySelector("space") as SpaceElement
    const viewPoint = space.querySelector("viewpoint") as ViewPointElement
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
