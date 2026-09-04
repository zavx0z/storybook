import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {
  createDocument,
  readDocumentCompiledStyleSheets,
  type Element,
  type Node,
} from "@zavx0z/dom"
import type {
  Experience,
  ExperienceDocumentProjection,
  ExperienceProjection,
  ExperienceSpaceProjection,
} from "@zavx0z/browser"
import type {RenderFrame} from "@zavx0z/renderer"
import {
  createSpaceElementFactories,
  XRDisplayElement,
  XRHUDElement,
  XRSpaceElement,
  XRViewPointElement,
} from "@zavx0z/space"
import {resolveExternalStorybookDeclarations} from "../declarations.ts"
import {createExternalStorybookGraph, type ExternalStorybookGraph} from "../graph.ts"
import type {StorybookPackageSessionSnapshot} from "../package-session.ts"
import {createExternalStorybookClientSnapshot} from "./client-protocol.ts"
import {
  indexedLandingAuthorStyleSheetSources,
  startExternalStorybookLanding,
} from "./landing-entry.ts"
import type {ExternalStorybookExperienceFactory} from "./shell.ts"

const fixtureRoot = join(import.meta.dir, "..", "fixtures", "valid")

describe("external Storybook landing frontend", () => {
  test("renders mixed roots, project packages, owner README and delegates package views to the lifecycle owner", async () => {
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
    const experienceState = createFakeExperienceState()
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
        createExperience: fakeExperienceFactory(experienceState),
      },
    })

    expect(dataset.externalStorybookLanding).toBe("ready")
    expect(controller.shell.workbench.element.getAttribute("aria-label")).toBe("MetaFor")
    expect(controller.shell.workbench.controller.read("catalog.items").map(({id, group}) => ({id, group})))
      .toEqual([
        {id: "project:fixture-alpha", group: {id: "workspace:fixture-workspace", label: "Fixture Workspace"}},
        {id: "project:fixture-beta", group: {id: "workspace:fixture-workspace", label: "Fixture Workspace"}},
        {id: "package:@fixture/standalone", group: undefined},
      ])
    expect(requests[0]).toBe("/api/client")
    expect(requests.at(-1)).toContain("project%3Afixture-alpha")
    expect(controller.shell.workbench.controller.read("secondary.items").map(({id}) => id))
      .toEqual(["package:@fixture/components"])
    expect(controller.shell.workbench.controller.read("presentation").node?.textContent)
      .toContain("project:fixture-alpha")
    const initialPresentation = controller.shell.workbench.controller.read("presentation").node
    const semanticDocument = controller.shell.document
    const initialStyleSheetCount = readDocumentCompiledStyleSheets(semanticDocument).styleSheets.length
    expect(initialStyleSheetCount).toBeGreaterThan(0)

    await controller.select("project:fixture-beta")
    expect(pushed).toEqual(["/projects/fixture-beta/"])
    expect(initialPresentation?.parentNode).toBeNull()
    await controller.select("project:fixture-alpha")
    expect(controller.shell.workbench.controller.read("secondary.items").map(({id}) => id))
      .toEqual(["package:@fixture/components"])
    expect(pushed).toEqual(["/projects/fixture-beta/", "/projects/fixture-alpha/"])
    expect(controller.shell.workbench.controller.read("presentation").node?.textContent)
      .toContain("project:fixture-alpha")
    await controller.select("package:@fixture/components")
    expect(controller.shell.workbench.controller.read("secondary.active")).toBe("package:@fixture/components")
    const nestedAction = descendants(controller.shell.display)
      .find((element) => element.nodeName === "BUTTON")
    expect(nestedAction?.textContent).toBe("Открыть Fixture Components")
    click(nestedAction)
    await Promise.resolve()
    expect(opened.at(-1)).toEqual({
      packageId: "@fixture/components",
      route: "",
    })
    await controller.select("package:@fixture/standalone")
    expect(controller.shell.workbench.controller.read("secondary.items")).toEqual([])
    const directAction = descendants(controller.shell.display)
      .find((element) => element.nodeName === "BUTTON")
    click(directAction)
    await Promise.resolve()
    expect(opened.at(-1)).toEqual({
      packageId: "@fixture/standalone",
      route: "",
    })

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
    expect(view).toContain('from "../components/overview-action-button.tsx"')
    expect(view).not.toContain("actionStyle")
    controller.dispose()
    expect(readDocumentCompiledStyleSheets(semanticDocument).styleSheets).toEqual([])
    expect(experienceState.creations).toBe(1)
    expect(experienceState.disposals).toBe(1)
  })

  test("reads only bounded contiguous indexed Workbench author links", () => {
    const document = indexedLinkDocument([
      {specifier: "@zavx0z/ui/themes/theme.css", digest: "a".repeat(64), href: "/revision/theme.css"},
      {specifier: "@fixture/tokens.css", digest: "b".repeat(64), href: "/revision/tokens.css"},
    ])
    expect(indexedLandingAuthorStyleSheetSources(document).map(({id}) => id)).toEqual([
      "@zavx0z/ui/themes/theme.css",
      "@fixture/tokens.css",
    ])

    const duplicate = indexedLinkDocument([
      {specifier: "@zavx0z/ui/themes/theme.css", digest: "a".repeat(64), href: "/revision/a.css"},
      {specifier: "@zavx0z/ui/themes/theme.css", digest: "a".repeat(64), href: "/revision/b.css"},
    ])
    expect(() => indexedLandingAuthorStyleSheetSources(duplicate)).toThrow("invalid or duplicate")

    const invalidDigest = indexedLinkDocument([
      {specifier: "@zavx0z/ui/themes/theme.css", digest: "invalid", href: "/revision/theme.css"},
    ])
    expect(() => indexedLandingAuthorStyleSheetSources(invalidDigest)).toThrow("digest is invalid")
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

type FakeExperienceState = {
  creations: number
  disposals: number
  frames: number
}

function createFakeExperienceState(): FakeExperienceState {
  return {creations: 0, disposals: 0, frames: 0}
}

function fakeExperienceFactory(
  state: FakeExperienceState = createFakeExperienceState(),
): ExternalStorybookExperienceFactory {
  return async options => {
    state.creations += 1
    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const space = document.createElement("xr-space") as XRSpaceElement
    const viewPoint = document.createElement("xr-view-point") as XRViewPointElement
    document.transaction(() => {
      space.append(viewPoint)
      document.append(space)
    })
    const presented = new Set<(sequence: number) => void>()
    const documentProjections = new Map<XRDisplayElement | XRHUDElement, Readonly<{
      projection: ExperienceDocumentProjection
      subscribers: Set<(frame: RenderFrame) => void>
      setFrame(frame: RenderFrame): void
    }>>()
    const spaceProjection: ExperienceSpaceProjection = Object.freeze({
      kind: "space",
      owner: space,
      orbit() {},
      pan() {},
      zoom() {},
    })
    let disposed = false

    const documentProjection = (
      owner: XRDisplayElement | XRHUDElement,
    ): ExperienceDocumentProjection => {
      const existing = documentProjections.get(owner)
      if (existing !== undefined) return existing.projection
      if (owner.ownerDocument !== document || owner.parentNode !== space) {
        throw new Error("Fake Experience projection owner must be a direct child of its semantic Space")
      }
      const subscribers = new Set<(frame: RenderFrame) => void>()
      let frame: RenderFrame | null = null
      const projection: ExperienceDocumentProjection = Object.freeze({
        kind: owner instanceof XRDisplayElement ? "display" : "hud",
        owner,
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

    function getProjection(owner: XRSpaceElement): ExperienceSpaceProjection
    function getProjection(owner: XRDisplayElement | XRHUDElement): ExperienceDocumentProjection
    function getProjection(
      owner: XRSpaceElement | XRDisplayElement | XRHUDElement,
    ): ExperienceProjection {
      if (owner === space) return spaceProjection
      return documentProjection(owner as XRDisplayElement | XRHUDElement)
    }

    const experience: Experience = Object.freeze({
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
      resetViewPoint() {},
      render() {
        state.frames += 1
        for (const [owner, binding] of documentProjections) {
          const frame = fakeRenderFrame(document, owner, state.frames)
          binding.setFrame(frame)
          for (const listener of binding.subscribers) listener(frame)
        }
        for (const listener of presented) listener(state.frames)
      },
      requestFrame() {},
      resize() {},
      captureLastPresentedFramePng: async () => new Blob(["fake-png"], {type: "image/png"}),
      dispose() {
        if (disposed) return
        disposed = true
        state.disposals += 1
        presented.clear()
        documentProjections.clear()
      },
    })
    return experience
  }
}

function fakeRenderFrame(
  document: ReturnType<typeof createDocument>,
  root: XRDisplayElement | XRHUDElement,
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
