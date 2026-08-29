import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {createDocument} from "@zavx0z/dom"
import type {DocumentCanvasRuntime} from "@zavx0z/renderer-browser"
import {resolveExternalStorybookDeclarations} from "../declarations.ts"
import {createExternalStorybookGraph, type ExternalStorybookGraph} from "../graph.ts"
import type {StorybookPackageSessionSnapshot} from "../package-session.ts"
import {STORYBOOK_RUNTIME_PROTOCOL, type StorybookRuntimeContext} from "../runtime-protocol.ts"
import {createExternalStorybookClientSnapshot} from "./client-protocol.ts"
import {
  startExternalStorybookPackage,
  type ExternalStorybookPackageEnvironment,
} from "./package-entry.ts"
import type {ExternalStorybookShellCanvasRuntimeFactory} from "./shell.ts"

const fixtureRoot = join(import.meta.dir, "..", "fixtures", "valid")

describe("external Storybook package frontend", () => {
  test("keeps overviews real and loads one runtime plus only exact selected stories", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-a"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const dataset: Record<string, string> = {}
    const browserDocument = {documentElement: {dataset}} as unknown as globalThis.Document
    const browserLocation = locationFixture("/packages/%40fixture%2Fcomponents/")
    const history = historyFixture(browserLocation)
    const socket = new FakeSocket()
    const semanticDocument = createDocument()
    let runtimeLoads = 0
    let containedLoads = 0
    let outlinedLoads = 0
    let mounts = 0
    let unmounts = 0
    let disposes = 0
    const contexts: StorybookRuntimeContext[] = []
    const bounds: unknown[] = []

    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: candidate,
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
      async loadRuntime() {
        runtimeLoads += 1
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          async create(ownerContext: StorybookRuntimeContext) {
            contexts.push(ownerContext)
            ownerContext.subscribePreviewBounds((value) => bounds.push(value))
            return {
              styleSheets: [".owner-story { color: cyan; }"],
              async mount(input: Readonly<{route: string, story: any}>) {
                mounts += 1
                const node = ownerContext.document.createElement("section")
                node.className = "owner-story"
                node.textContent = `${input.route}:${input.story.label}`
                ownerContext.mount(node)
                ownerContext.publishInspector({route: input.route})
                ownerContext.publishSource({typescript: `export const route = ${JSON.stringify(input.route)}`})
                ownerContext.publishProps({label: input.story.label})
                ownerContext.reportDiagnostic({phase: "runtime", message: "owner-ready"})
                ownerContext.requestRender()
              },
              async unmount() {
                unmounts += 1
              },
              async dispose() {
                disposes += 1
              },
            }
          },
        }
      },
      storyLoaders: new Map([
        ["components/button/basic/contained", async () => {
          containedLoads += 1
          return {label: "Contained"}
        }],
        ["components/button/outlined", async () => {
          outlinedLoads += 1
          return {label: "Outlined"}
        }],
      ]),
      environment: {
        browserDocument,
        location: browserLocation,
        history,
        fetcher: (async (input) => String(input) === "/api/client"
          ? Response.json(snapshot)
          : new Response("# Owner README")) as typeof fetch,
        createSocket(url) {
          socket.url = url
          return socket
        },
        async waitForFrame() {},
        shell: {
          document: semanticDocument,
          canvas: {} as HTMLCanvasElement,
          loadFont: async () => ({}) as never,
          createCanvasRuntime: fakeRuntimeFactory(),
        },
      },
    })

    expect(dataset.externalStorybookPackage).toBe("ready")
    expect(controller.currentRoute).toBe("")
    expect(controller.shell.workbench.controller.read("preview.node")?.textContent).toContain("Owner README")
    expect(runtimeLoads).toBe(0)
    expect(containedLoads).toBe(0)
    expect(outlinedLoads).toBe(0)

    await controller.navigate("components")
    await controller.navigate("components/button")
    expect(controller.shell.workbench.controller.read("catalog.active"))
      .toBe("category:@fixture/components/components")
    expect(controller.shell.workbench.controller.read("secondary.active"))
      .toBe("subject:@fixture/components/components/button")
    expect(controller.shell.workbench.controller.read("scenarios.active")).toBeNull()
    expect(runtimeLoads).toBe(0)

    await controller.navigate("components/button/basic/contained")
    expect(runtimeLoads).toBe(1)
    expect(containedLoads).toBe(1)
    expect(outlinedLoads).toBe(0)
    expect(mounts).toBe(1)
    const ownerContext = contexts[0]!
    expect(ownerContext.document).toBe(semanticDocument)
    expect(ownerContext.browserDocument).toBe(browserDocument)
    expect(ownerContext.canvas).toBe(controller.shell.canvas)
    expect(bounds).toEqual([null])
    expect(controller.shell.workbench.controller.read("preview.node")?.textContent)
      .toBe("components/button/basic/contained:Contained")
    expect(controller.shell.workbench.elements.inspectorHost.textContent).toContain("owner-ready")

    await controller.navigate("components/button/outlined")
    expect(runtimeLoads).toBe(1)
    expect(containedLoads).toBe(1)
    expect(outlinedLoads).toBe(1)
    expect(mounts).toBe(2)
    expect(unmounts).toBe(1)
    expect(controller.shell.workbench.controller.read("scenarios.active"))
      .toBe("variant:@fixture/components/components/button/outlined")

    await controller.navigate("components/button")
    expect(unmounts).toBe(2)
    expect(controller.shell.workbench.controller.read("preview.node")?.textContent)
      .toContain("2 вариантов")
    expect(history.pushed).toEqual([
      "/packages/%40fixture%2Fcomponents/components/",
      "/packages/%40fixture%2Fcomponents/components/button/",
      "/packages/%40fixture%2Fcomponents/components/button/basic/contained",
      "/packages/%40fixture%2Fcomponents/components/button/outlined",
      "/packages/%40fixture%2Fcomponents/components/button/",
    ])
    const beforeUnknown = [...history.pushed]
    await expect(controller.navigate("missing")).rejects.toThrow("Unknown external Storybook route")
    expect(history.pushed).toEqual(beforeUnknown)
    expect(controller.currentRoute).toBe("components/button")

    socket.emit("open", {})
    expect(socket.sent).toEqual([JSON.stringify({type: "subscribe", topic: "package:@fixture/components"})])
    const pathnameBeforeUpdate = browserLocation.pathname
    socket.emit("message", {data: JSON.stringify({
      type: "package.updated",
      packageId: "@fixture/other",
      revision: "revision-b",
    })})
    socket.emit("message", {data: JSON.stringify({
      type: "package.updated",
      packageId: "@fixture/components",
      revision: candidate,
    })})
    expect(browserLocation.reloads).toBe(0)
    socket.emit("message", {data: JSON.stringify({
      type: "package.updated",
      packageId: "@fixture/components",
      revision: "revision-b",
    })})
    expect(browserLocation.reloads).toBe(1)
    expect(browserLocation.pathname).toBe(pathnameBeforeUpdate)
    socket.emit("message", {data: JSON.stringify({
      type: "package.failed",
      packageId: "@fixture/components",
      diagnostics: [{phase: "compile", message: "broken candidate"}],
    })})
    expect(controller.shell.workbench.elements.inspectorHost.textContent).toContain("broken candidate")

    await controller.dispose()
    expect(disposes).toBe(1)
    expect(socket.closed).toBeTrue()
  })

  test("fails before shell creation for a foreign pathname or unpublished revision", async () => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-a"))
    const base = {
      packageId: "@fixture/components",
      candidateRevision: "revision-a",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
      loadRuntime: null,
      storyLoaders: new Map(),
    } as const
    await expect(startExternalStorybookPackage({
      ...base,
      environment: environmentFixture(snapshot, "/packages/%40fixture%2Fstandalone/"),
    })).rejects.toThrow("pathname belongs to @fixture/standalone")
    await expect(startExternalStorybookPackage({
      ...base,
      candidateRevision: "revision-other",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-other/",
      environment: environmentFixture(snapshot, "/packages/%40fixture%2Fcomponents/"),
    })).rejects.toThrow("revision is not active or last-good")
  })
})

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
  return {
    pathname,
    href: `http://localhost${pathname}`,
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
      location.pathname = path
      location.href = `http://localhost${path}`
    },
    replaceState(_data: unknown, _unused: string, url: string | URL | null) {
      if (url === null) return
      const path = String(url)
      replaced.push(path)
      location.pathname = path
      location.href = `http://localhost${path}`
    },
  }
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
    async waitForFrame() {},
    shell: {
      document: createDocument(),
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      createCanvasRuntime: fakeRuntimeFactory(),
    },
  }
}

async function fixtureGraph(): Promise<ExternalStorybookGraph> {
  return createExternalStorybookGraph(await resolveExternalStorybookDeclarations([
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

function fakeRuntimeFactory(): ExternalStorybookShellCanvasRuntimeFactory {
  return (async () => ({
    requestRender() {},
    subscribe() {
      return () => {}
    },
    dispose() {},
  } as unknown as DocumentCanvasRuntime)) as ExternalStorybookShellCanvasRuntimeFactory
}
