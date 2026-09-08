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
import {
  createSpaceElementFactories,
  XRHUDElement,
  XRSpaceElement,
  XRViewPointElement,
} from "@zavx0z/space"
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
  test("adds and removes projects through the catalog controls without reloading the Root", async () => {
    const catalog = await resolveExternalStorybookDeclarations([fixtureRoot, join(fixtureRoot, "standalone")])
    const full = createExternalStorybookGraph(catalog)
    const registry = new ExternalStorybookRegistry(resolveExternalStorybookDeclarations)
    await registry.configure([fixtureRoot, join(fixtureRoot, "standalone")])
    const removed = (await registry.detach("workspace:fixture-workspace")).graph
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
      expect(controller.shell.workbench.controller.read("catalog.items")).toHaveLength(7)
      const removeButton = (root.querySelector('[aria-label="Удалить Fixture Workspace из каталога"]') as import("@zavx0z/dom").HTMLButtonElement)
      removeButton.click()
      await waitUntil(() => controller.shell.workbench.controller.read("catalog.management")?.pending === false)
      expect(changes[1]).toEqual({scopeId: "workspace:fixture-workspace"})
      expect(controller.shell.workbench.controller.read("catalog.items").map(item => item.id))
        .toEqual(["project:fixture-standalone", "package:@fixture/standalone"])
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

  test("renders repository overviews and navigates packages in the current tab", async () => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph))
    const requests: string[] = []
    const opened: Array<Readonly<{packageId: string, route: string}>> = []
    const pushed: string[] = []
    const location = {
      href: "http://127.0.0.1:3000/projects/fixture-alpha/",
      pathname: "/projects/fixture-alpha/",
      reload() {},
    }
    const dataset: Record<string, string> = {}
    const experienceState = createFakeRootState()
    const controller = await startExternalStorybookLanding({
      browserDocument: {
        documentElement: {dataset},
        querySelector(selector: string) {
          return selector === 'meta[name="external-storybook-browser-session"]'
            ? {content: "landing-session"}
            : null
        },
      } as unknown as globalThis.Document,
      fetcher: (async (input, init) => {
        const url = String(input)
        requests.push(url)
        if (url === "/api/client") return Response.json(snapshot)
        if (url === "/api/browser/open") {
          opened.push(JSON.parse(String(init?.body)))
          expect(init?.method).toBe("POST")
          expect((init?.headers as Record<string, string>)["x-storybook-session"]).toBe("landing-session")
          return Response.json({ok: true})
        }
        return new Response(`# ${decodeURIComponent(url.split("/").filter(Boolean).at(-1) ?? "README")}`)
      }) as typeof fetch,
      location,
      history: {
        pushState(_data, _unused, url) {
          const path = String(url)
          pushed.push(path)
          location.pathname = path
        },
      },
      shell: {
        canvas: {} as HTMLCanvasElement,
        loadFont: async () => ({}) as never,
        createRoot: fakeRootFactory(experienceState),
      },
    })

    expect(dataset.externalStorybookLanding).toBe("ready")
    expect(controller.shell.workbench.element.getAttribute("aria-label")).toBe("Storybook")
    expect(controller.shell.workbench.controller.read("catalog.items").map(item => item.id)).toEqual([
      "workspace:fixture-workspace", "project:fixture-alpha", "package:@fixture/components",
      "project:fixture-beta", "package:@fixture/docs", "project:fixture-standalone", "package:@fixture/standalone",
    ])
    expect(requests[0]).toBe("/api/client")
    expect(requests.at(-1)).toContain("project%3Afixture-alpha")
    expect(statusBreadcrumbLabels(controller)).toEqual([
      "Главная",
      "Fixture Workspace",
      "Fixture Alpha",
    ])
    expect(controller.shell.workbench.controller.read("status").detail).toBe("")

    expect(controller.shell.workbench.controller.read("secondary.items").map(({label}) => label))
      .toEqual(["packages"])
    expect(controller.shell.workbench.controller.read("presentation").node?.textContent)
      .toContain("project:fixture-alpha")
    const initialPresentation = controller.shell.workbench.controller.read("presentation").node
    const semanticDocument = controller.shell.document
    const initialStyleSheetCount = readDocumentCompiledStyleSheets(semanticDocument).styleSheets.length
    expect(initialStyleSheetCount).toBeGreaterThan(0)

    await controller.select("project:fixture-beta")
    expect(pushed).toEqual(["/projects/fixture-beta/"])
    expect(initialPresentation?.parentNode).toBeNull()
    expect(statusBreadcrumbLabels(controller)).toEqual([
      "Главная",
      "Fixture Workspace",
      "Fixture Beta",
    ])

    await controller.select("project:fixture-alpha")
    expect(controller.shell.workbench.controller.read("secondary.items").map(({label}) => label))
      .toEqual(["packages"])
    expect(pushed).toEqual(["/projects/fixture-beta/", "/projects/fixture-alpha/"])
    expect(controller.shell.workbench.controller.read("presentation").node?.textContent)
      .toContain("project:fixture-alpha")
    expect(statusBreadcrumbLabels(controller)).toEqual([
      "Главная",
      "Fixture Workspace",
      "Fixture Alpha",
    ])

    await controller.select("package:@fixture/components")
    expect(location.href).toBe("http://127.0.0.1:3000/packages/%40fixture%2Fcomponents/")
    expect(opened).toEqual([])
    expect(descendants(controller.shell.display).some(element => element.textContent?.startsWith("Открыть "))).toBeFalse()
    await controller.select("package:@fixture/standalone")
    expect(location.href).toBe("http://127.0.0.1:3000/packages/%40fixture%2Fstandalone/")
    expect(opened).toEqual([])

    const source = await Bun.file(join(import.meta.dir, "landing-entry.ts")).text()
    const view = await Bun.file(join(import.meta.dir, "message-view.tsx")).text()
    expect(source).not.toContain("runtime-protocol")
    expect(source).not.toContain("loadRuntime")
    expect(source).not.toContain("storyLoaders")
    expect(source).not.toContain("createElement(")
    expect(source).not.toContain("className")
    expect(source).not.toContain("external-storybook-action")
    expect(source).not.toContain("globalThis.open")
    expect(source).not.toContain("window.open")
    expect(view).toContain('from "./components/overview-action-button.tsx"')
    expect(view).not.toContain("actionStyle")
    const home = controller.shell.workbench.elements.status.querySelector(
      '[data-breadcrumb-id="storybook:root"] button',
    ) as Element
    expect(home.textContent).toBe("")
    expect(home.getAttribute("aria-label")).toBe("Главная")
    click(home)
    expect(location.pathname).toBe("/")
    expect(statusBreadcrumbLabels(controller)).toEqual(["Главная"])
    expect(controller.shell.workbench.controller.read("catalog.active")).toBeNull()
    expect(controller.shell.workbench.controller.read("secondary.items")).toEqual([])
    expect(controller.shell.document).toBe(semanticDocument)
    expect(controller.shell.workbench.elements.status.querySelector('[aria-current="page"]')?.hasAttribute("disabled")).toBe(true)
    controller.dispose()
    expect(readDocumentCompiledStyleSheets(semanticDocument).styleSheets).toEqual([])
    expect(experienceState.creations).toBe(1)
    expect(experienceState.disposals).toBe(1)
  })

  test("updates only the selected README without recreating the document or reloading the page", async () => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph))
    const listeners = new Map<string, (event: any) => void>()
    let source = "# First\n\nBefore"
    let reads = 0
    let reloads = 0
    const experienceState = createFakeRootState()
    const controller = await startExternalStorybookLanding({
      browserDocument: {documentElement: {dataset: {}}, querySelector() { return null }} as unknown as Document,
      location: {
        href: "http://127.0.0.1:3000/projects/fixture-alpha/",
        pathname: "/projects/fixture-alpha/",
        reload() { reloads += 1 },
      },
      fetcher: (async input => {
        if (String(input) === "/api/client") return Response.json(snapshot)
        reads += 1
        return new Response(source)
      }) as typeof fetch,
      createSocket() {
        return {
          addEventListener(type, listener) { listeners.set(type, listener) },
          removeEventListener(type) { listeners.delete(type) },
          send() {},
          close() {},
        }
      },
      shell: {
        canvas: {} as HTMLCanvasElement,
        loadFont: async () => ({}) as never,
        createRoot: fakeRootFactory(experienceState),
      },
    })
    try {
      const article = controller.shell.display.querySelector("article")!
      const workbench = controller.shell.workbench.element
      const beforeReads = reads
      listeners.get("message")?.({data: JSON.stringify({type: "registry.readme-updated", nodeIds: ["project:unrelated"]})})
      expect(reads).toBe(beforeReads)
      source = "# Second\n\nAfter"
      listeners.get("message")?.({data: JSON.stringify({type: "registry.readme-updated", nodeIds: ["project:fixture-alpha"]})})
      await waitFor(() => article.textContent.includes("After"), "selected README refresh")
      expect(controller.shell.display.querySelector("article")).toBe(article)
      expect(controller.shell.workbench.element).toBe(workbench)
      expect(reads).toBe(beforeReads + 1)
      expect(reloads).toBe(0)
      expect(experienceState.creations).toBe(1)
      expect(experienceState.disposals).toBe(0)
      listeners.get("message")?.({data: JSON.stringify({type: "shared.updated", entry: "landing-new.js"})})
      expect(reloads).toBe(1)
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
    const space = body.querySelector("xr-space") as XRSpaceElement
    const viewPoint = space.querySelector("xr-view-point") as XRViewPointElement
    const presented = new Set<(sequence: number) => void>()
    const documentProjections = new Map<DisplayElement | XRHUDElement, Readonly<{
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
      owner: DisplayElement | XRHUDElement,
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

    function getProjection(owner: XRSpaceElement): RootSpaceProjection
    function getProjection(owner: DisplayElement | XRHUDElement): RootDocumentProjection
    function getProjection(
      owner: XRSpaceElement | DisplayElement | XRHUDElement,
    ): RootProjection {
      if (owner === space) return spaceProjection
      return documentProjection(owner as DisplayElement | XRHUDElement)
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
  root: DisplayElement | XRHUDElement,
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
