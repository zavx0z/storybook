import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {
  createDocument,
  readDocumentCompiledStyleSheets,
  type Element,
  type Node,
} from "@zavx0z/dom"
import type {
  DocumentOverlayRuntime,
  DocumentSpaceRuntime,
} from "@zavx0z/renderer-browser"
import {resolveExternalStorybookDeclarations} from "../declarations.ts"
import {createExternalStorybookGraph, type ExternalStorybookGraph} from "../graph.ts"
import type {StorybookPackageSessionSnapshot} from "../package-session.ts"
import {createExternalStorybookClientSnapshot} from "./client-protocol.ts"
import {
  indexedLandingAuthorStyleSheetSources,
  startExternalStorybookLanding,
} from "./landing-entry.ts"
import type {ExternalStorybookShellSpaceRuntimeFactory} from "./shell.ts"

const fixtureRoot = join(import.meta.dir, "..", "fixtures", "valid")

describe("external Storybook landing frontend", () => {
  test("renders mixed roots, project packages, owner README and named package tabs without runtime code", async () => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph))
    const requests: string[] = []
    const opened: Array<Readonly<{url: string, name: string}>> = []
    const pushed: string[] = []
    const semanticDocument = createDocument()
    const location = {
      href: "http://127.0.0.1:3000/projects/fixture-alpha/",
      pathname: "/projects/fixture-alpha/",
      reload() {},
    }
    const dataset: Record<string, string> = {}
    const controller = await startExternalStorybookLanding({
      browserDocument: {documentElement: {dataset}} as unknown as globalThis.Document,
      fetcher: (async (input) => {
        const url = String(input)
        requests.push(url)
        if (url === "/api/client") return Response.json(snapshot)
        return new Response(`# ${decodeURIComponent(url.split("/").filter(Boolean).at(-1) ?? "README")}`)
      }) as typeof fetch,
      openWindow(url, name) {
        opened.push({url, name})
      },
      location,
      history: {
        pushState(_data, _unused, url) {
          const path = String(url)
          pushed.push(path)
          location.pathname = path
        },
      },
      async waitForFrame() {},
      shell: {
        document: semanticDocument,
        canvas: {} as HTMLCanvasElement,
        loadFont: async () => ({}) as never,
        createSpaceRuntime: fakeRuntimeFactory(),
      },
    })

    expect(dataset.externalStorybookLanding).toBe("ready")
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
    const nestedAction = descendants(controller.shell.workbench.elements.previewHost)
      .find((element) => element.nodeName === "BUTTON")
    expect(nestedAction?.textContent).toBe("Открыть Fixture Components")
    click(nestedAction)
    expect(opened.at(-1)).toEqual({
      url: "/packages/%40fixture%2Fcomponents/",
      name: "storybook:@fixture/components",
    })

    await controller.select("package:@fixture/standalone")
    expect(controller.shell.workbench.controller.read("secondary.items")).toEqual([])
    const directAction = descendants(controller.shell.workbench.elements.previewHost)
      .find((element) => element.nodeName === "BUTTON")
    click(directAction)
    expect(opened.at(-1)).toEqual({
      url: "/packages/%40fixture%2Fstandalone/",
      name: "storybook:@fixture/standalone",
    })

    const source = await Bun.file(join(import.meta.dir, "landing-entry.ts")).text()
    const view = await Bun.file(join(import.meta.dir, "message-view.tsx")).text()
    expect(source).not.toContain("runtime-protocol")
    expect(source).not.toContain("loadRuntime")
    expect(source).not.toContain("storyLoaders")
    expect(source).not.toContain("createElement(")
    expect(source).not.toContain("className")
    expect(source).not.toContain("external-storybook-action")
    expect(view).toContain('from "../components/overview-action-button.tsx"')
    expect(view).not.toContain("actionStyle")
    controller.dispose()
    expect(readDocumentCompiledStyleSheets(semanticDocument).styleSheets).toEqual([])
  })

  test("reads only bounded contiguous indexed Workbench author links", () => {
    const document = indexedLinkDocument([
      {specifier: "@ui/components/theme.css", digest: "a".repeat(64), href: "/revision/theme.css"},
      {specifier: "@fixture/tokens.css", digest: "b".repeat(64), href: "/revision/tokens.css"},
    ])
    expect(indexedLandingAuthorStyleSheetSources(document).map(({id}) => id)).toEqual([
      "@ui/components/theme.css",
      "@fixture/tokens.css",
    ])

    const duplicate = indexedLinkDocument([
      {specifier: "@ui/components/theme.css", digest: "a".repeat(64), href: "/revision/a.css"},
      {specifier: "@ui/components/theme.css", digest: "a".repeat(64), href: "/revision/b.css"},
    ])
    expect(() => indexedLandingAuthorStyleSheetSources(duplicate)).toThrow("invalid or duplicate")

    const invalidDigest = indexedLinkDocument([
      {specifier: "@ui/components/theme.css", digest: "invalid", href: "/revision/theme.css"},
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

function fakeRuntimeFactory(): ExternalStorybookShellSpaceRuntimeFactory {
  return (async (options) => {
    const presented = new Set<(frame: number) => void>()
    let frames = 0
    return {
      document: options.document,
      styleSheets: options.styleSheets,
      font: options.font,
      addOverlay() {
        return {
          subscribe() {
            return () => {}
          },
          dispose() {},
        } as unknown as DocumentOverlayRuntime
      },
      render() {
        frames += 1
        for (const listener of presented) listener(frames)
      },
      subscribePresented(listener: (frame: number) => void) {
        presented.add(listener)
        return () => presented.delete(listener)
      },
      requestRender() {},
      dispose() { presented.clear() },
    } as unknown as DocumentSpaceRuntime
  }) as ExternalStorybookShellSpaceRuntimeFactory
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
