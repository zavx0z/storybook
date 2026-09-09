import {DisplayElement} from "@zavx0z/dom/display"
import {indexedWorkbenchAuthorStyleSheetSources} from "./author-style-sheets.ts"
import {presentationRootFixture, type PresentationFixtureOptions} from "./browser-root.fixture.ts"
import {createRoot} from "@zavx0z/component"
import {createDocumentClipboardController} from "@zavx0z/browser/clipboard"
import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {
  createDocument,
  readDocumentCompiledStyleSheets,
  type Element,
  type Node,
} from "@zavx0z/dom"
import type {
  Presentation as Root,
  RootDocumentProjection,
  RootProjection,
  RootSpaceProjection,
} from "@zavx0z/browser/integration"
import type {RenderFrame} from "@zavx0z/renderer"
import {createSpaceElementFactories} from "@zavx0z/space"
import {HUDElement} from "../../webxr-space/dom/hud/index.ts"
import {SpaceElement} from "@zavx0z/dom/space"
import {ViewPointElement} from "@zavx0z/dom/viewpoint"
import {
  resolveExternalStorybookDeclarations,
} from "../discovery/declarations.ts"
import {createExternalStorybookGraph, type ExternalStorybookGraph} from "../catalog/graph.ts"
import {ExternalStorybookRegistry} from "../catalog/registry.ts"
import type {StorybookPackageSessionSnapshot} from "../sessions/package-session.ts"
import {createExternalStorybookClientSnapshot} from "./client-protocol.ts"
import {
  startExternalStorybookLanding,
} from "./landing-entry.ts"
import type {ExternalStorybookRootFactory} from "./shell.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")

describe("external Storybook landing frontend", () => {
  test("navigates root and nested packages through the same page contract", async () => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph))
    const location = {href: "http://127.0.0.1:3000/", pathname: "/", reload() {}}
    const requests: string[] = []
    const state = createFakeRootState()
    const controller = await startExternalStorybookLanding({
      browserDocument: {documentElement: {dataset: {}}, querySelector() { return null }} as unknown as Document,
      location,
      fetcher: (async input => {
        requests.push(String(input))
        return Response.json(snapshot)
      }) as typeof fetch,
      createSocket() { return {addEventListener() {}, removeEventListener() {}, send() {}, close() {}} },
      shell: {canvas: {} as HTMLCanvasElement, loadFont: async () => ({}) as never, createRoot: fakeRootFactory(state)},
    })
    try {
      expect(controller.shell.workbench.controller.read("catalog.items").map(item => item.id)).toEqual([
        "package:fixture-workspace", "package:fixture-alpha", "package:@fixture/components",
        "package:fixture-beta", "package:@fixture/docs", "package:@fixture/standalone",
      ])
      for (const [id, path] of [
        ["package:fixture-workspace", "/pkg-fixture-workspace/"],
        ["package:fixture-alpha", "/pkg-fixture-alpha/"],
        ["package:@fixture/components", "/pkg-fixture-components/"],
        ["package:@fixture/standalone", "/pkg-fixture-standalone/"],
      ] as const) {
        await controller.select(id)
        expect(new URL(location.href).pathname).toBe(path)
      }
      expect(requests).toEqual(["/api/client"])
      expect(state.creations).toBe(1)
    } finally { controller.dispose() }
  })

  test("adds and removes projects through the catalog controls without reloading the Root", async () => {
    const catalog = await resolveExternalStorybookDeclarations([fixtureRoot, join(fixtureRoot, "standalone")])
    const full = createExternalStorybookGraph(catalog)
    const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
    await registry.configure([fixtureRoot, join(fixtureRoot, "standalone")])
    const removed = (await registry.detach("package:fixture-workspace")).graph
    const empty = createExternalStorybookGraph({schemaVersion: 1, rootIds: [], scopes: []})
    let snapshot = createExternalStorybookClientSnapshot(empty, [])
    const changes: unknown[] = []
    const token = "11111111-1111-4111-8111-111111111111"
    const files = new Map<string, string>()
    let picks = 0
    const selectedDirectory = {
      async getFileHandle(name: string) {
        return {async createWritable() { return {
          async write(value: string) { files.set(name, value) },
          async close() {},
          async abort() {},
        } }}
      },
      async removeEntry(name: string) { files.delete(name) },
    } as unknown as FileSystemDirectoryHandle
    let reloads = 0
    const controller = await startExternalStorybookLanding({
      browserDocument: {
        documentElement: {dataset: {}},
        querySelector: () => ({content: "registry-session"}),
      } as unknown as globalThis.Document,
      pickDirectory: async () => {
        picks += 1
        if (picks > 1) throw new DOMException("Cancelled", "AbortError")
        return selectedDirectory
      },
      fetcher: (async (input, init) => {
        if (String(input) === "/api/client") return Response.json(snapshot)
        if (String(input) === "/api/browser/directory") {
          expect(picks).toBe(1)
          return Response.json({ok: true, token, filename: `.storybook-selection-${token}`, content: "proof"})
        }
        if (String(input).startsWith("/api/browser/")) {
          const body = JSON.parse(String(init?.body))
          changes.push(body)
          expect((init?.headers as Record<string, string>)["x-storybook-session"]).toBe("registry-session")
          const nextGraph = String(input).endsWith("attach") ? full : removed
          snapshot = createExternalStorybookClientSnapshot(nextGraph, packageSnapshots(nextGraph))
          return Response.json({ok: true})
        }
        return new Response("# Project")
      }) as typeof fetch,
      location: {href: "http://localhost/", pathname: "/", reload() { reloads += 1 }},
      history: {pushState() {}},
      shell: {canvas: {} as HTMLCanvasElement, loadFont: async () => ({}) as never, createRoot: fakeRootFactory(createFakeRootState())},
    })
    try {
      const root = controller.shell.workbench.element
      const button = root.querySelector('[aria-label="Добавить проект"]') as import("@zavx0z/dom").HTMLButtonElement
      button.click()
      await waitUntil(() => controller.shell.workbench.controller.read("catalog.management")?.pending === false)
      expect(controller.shell.workbench.controller.read("catalog.management")?.error).toBe("")
      expect(changes).toEqual([{selectionToken: token}])
      expect(files.size).toBe(0)
      expect(controller.shell.workbench.controller.read("catalog.items")).toHaveLength(6)
      const removeButton = (root.querySelector('[aria-label="Удалить Fixture Workspace из каталога"]') as import("@zavx0z/dom").HTMLButtonElement)
      removeButton.click()
      await waitUntil(() => controller.shell.workbench.controller.read("catalog.management")?.pending === false)
      expect(changes[1]).toEqual({scopeId: "package:fixture-workspace"})
      expect(controller.shell.workbench.controller.read("catalog.items").map(item => item.id))
        .toEqual(["package:@fixture/standalone"])
      expect(controller.shell.workbench.element).toBe(root)
      expect(reloads).toBe(0)
      button.click()
      await waitUntil(() => controller.shell.workbench.controller.read("catalog.management")?.pending === false)
      expect(changes).toHaveLength(2)
      expect(controller.shell.workbench.controller.read("catalog.management")?.error).toBe("")
    } finally {
      controller.dispose()
    }
  })



  test("reads only bounded contiguous indexed Workbench author links", () => {
    const document = indexedLinkDocument([
      {specifier: "@zavx0z/ui/themes/theme.css", digest: "a".repeat(64), href: "/revision/theme.css"},
      {specifier: "@fixture/tokens.css", digest: "b".repeat(64), href: "/revision/tokens.css"},
    ])
    expect(indexedWorkbenchAuthorStyleSheetSources(document).map(({id}) => id)).toEqual([
      "@zavx0z/ui/themes/theme.css",
      "@fixture/tokens.css",
    ])

    const duplicate = indexedLinkDocument([
      {specifier: "@zavx0z/ui/themes/theme.css", digest: "a".repeat(64), href: "/revision/a.css"},
      {specifier: "@zavx0z/ui/themes/theme.css", digest: "a".repeat(64), href: "/revision/b.css"},
    ])
    expect(() => indexedWorkbenchAuthorStyleSheetSources(duplicate)).toThrow("invalid or duplicate")

    const invalidDigest = indexedLinkDocument([
      {specifier: "@zavx0z/ui/themes/theme.css", digest: "invalid", href: "/revision/theme.css"},
    ])
    expect(() => indexedWorkbenchAuthorStyleSheetSources(invalidDigest)).toThrow("digest is invalid")
  })
})

async function fixtureGraph(): Promise<ExternalStorybookGraph> {
  return createExternalStorybookGraph(await resolveExternalStorybookDeclarations([
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

function descendants(root: Node): Element[] {
  const output: Element[] = []
  for (const child of root.childNodes) {
    if (!("localName" in child)) continue
    output.push(child as Element, ...descendants(child))
  }
  return output
}

function click(element: Element | undefined): void {
  if (element === undefined || !("click" in element) || typeof element.click !== "function") {
    throw new Error("Fixture action button is missing")
  }
  element.click()
}

function statusBreadcrumbLabels(
  controller: Awaited<ReturnType<typeof startExternalStorybookLanding>>,
): readonly string[] {
  return controller.shell.workbench.controller.read("status").breadcrumbs?.map(({label}) => label) ?? []
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 1_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(1)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

function indexedLinkDocument(
  values: readonly Readonly<{specifier: string; digest: string; href: string}>[],
): globalThis.Document {
  const links: HTMLLinkElement[] = []
  const byId = new Map<string, HTMLLinkElement>()
  const document = {
    readyState: "loading",
    querySelectorAll() {
      return links
    },
    getElementById(id: string) {
      return byId.get(id) ?? null
    },
  } as unknown as globalThis.Document
  for (const [index, value] of values.entries()) {
    const attributes = new Map<string, string>([
      ["rel", "stylesheet"],
      ["href", value.href],
      ["data-external-storybook-author-style-sheet", value.specifier],
      ["data-external-storybook-author-style-sheet-digest", value.digest],
    ])
    const link = {
      localName: "link",
      ownerDocument: document,
      sheet: {},
      getAttribute(name: string) {
        return attributes.get(name) ?? null
      },
    } as unknown as HTMLLinkElement
    links.push(link)
    byId.set(`external-storybook-author-style-sheet-${index}`, link)
  }
  return document
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Project management did not settle")
    await Bun.sleep(5)
  }
}
