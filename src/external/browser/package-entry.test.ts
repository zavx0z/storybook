import {createRoot} from "@zavx0z/component"
import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {createDocument, type Element} from "@zavx0z/dom"
import type {
  Root,
  RootDocumentProjection,
  RootProjection,
  RootSpaceProjection,
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
import {createStorybookPackageRevisionGraphSnapshot} from "../package-revision.ts"
import {STORYBOOK_RUNTIME_PROTOCOL, type StorybookRuntimeContext} from "../runtime-protocol.ts"
import {createExternalStorybookClientSnapshot} from "./client-protocol.ts"
import {
  startExternalStorybookPackage,
  type ExternalStorybookPackageEnvironment,
} from "./package-entry.ts"
import type {ExternalStorybookRootFactory} from "./shell.ts"

const fixtureRoot = join(import.meta.dir, "..", "fixtures", "valid")

describe("external Storybook package frontend", () => {
  test("binds only exact revision-declared native author links before activation", async () => {
    const graph = await fixtureGraph()
    const revision = "revision-theme"
    const revisionUrl = `/__storybook/revisions/%40fixture%2Fcomponents/${revision}/`
    const revisionGraph = createStorybookPackageRevisionGraphSnapshot(
      graph,
      "@fixture/components",
      "fixture-declaration",
    )
    const dataset: Record<string, string> = {}
    const browserDocument = {
      documentElement: {dataset},
    } as unknown as globalThis.Document
    const links = new Map<string, HTMLLinkElement>(revisionGraph.authorStyleSheets.map((styleSheet, index) => {
      const attributes = new Map([
        ["rel", "stylesheet"],
        ["href", `${revisionUrl}${styleSheet.url}`],
        ["data-external-storybook-author-style-sheet", styleSheet.specifier],
        ["data-external-storybook-author-style-sheet-digest", styleSheet.contentDigest],
      ])
      const link = {
        localName: "link",
        ownerDocument: browserDocument,
        getAttribute: (name: string) => attributes.get(name) ?? null,
      } as unknown as HTMLLinkElement
      return [`external-storybook-author-style-sheet-${index}`, link] as const
    }))
    browserDocument.getElementById = (id) => links.get(id) ?? null
    const lifecycle: string[] = []
    const acknowledged: boolean[] = []
    const experienceState = createFakeRootState(lifecycle)
    const location = locationFixture("/packages/%40fixture%2Fcomponents/")
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: revision,
      revisionUrl,
      graphSnapshot: revisionGraph,
      loadRuntime: null,
      storyLoaders: new Map(),
      widgetLoaders: new Map([["fixture-controls", async () => ({})]]),
      environment: {
        browserDocument,
        location,
        history: historyFixture(location),
        fetcher: (async () => new Response("# UI Components")) as unknown as typeof fetch,
        createSocket: () => new FakeSocket(),
        async acknowledgeActivation({working}) {
          lifecycle.push("activation")
          acknowledged.push(working)
        },
        shell: {
          canvas: {} as HTMLCanvasElement,
          loadFont: async () => ({}) as never,
          attach: fakeRootFactory(experienceState),
        },
      },
    })

    expect(acknowledged).toEqual([true])
    expect(experienceState.stylesheets.map(({id}) => id)).toEqual(
      revisionGraph.authorStyleSheets.map(({specifier}) => specifier),
    )
    expect(experienceState.stylesheets.map(({link}) => link)).toEqual([...links.values()])
    expect(lifecycle.slice(0, 2)).toEqual(["root-create", "activation"])
    expect(controller.shell.workbench.controller.read("status").breadcrumbs?.map(({label}) => label)).toEqual([
      "Fixture Workspace",
      "Fixture Alpha",
      "Fixture Components",
    ])
    const workspaceBreadcrumb = controller.shell.workbench.elements.status.querySelector(
      '[data-breadcrumb-id="workspace:fixture-workspace"] button',
    ) as import("@zavx0z/dom").HTMLButtonElement
    workspaceBreadcrumb.click()
    expect(location.href).toBe("http://localhost/workspaces/fixture-workspace/")
    await controller.dispose()
    expect(lifecycle.at(-1)).toBe("root-dispose")
  })

  test("materializes real overview children without selecting their representative routes", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-a"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const dataset: Record<string, string> = {}
    const browserDocument = {documentElement: {dataset}} as unknown as globalThis.Document
    const browserLocation = locationFixture("/packages/%40fixture%2Fcomponents/")
    const history = historyFixture(browserLocation)
    const socket = new FakeSocket()
    const experienceState = createFakeRootState()
    let runtimeLoads = 0
    let containedLoads = 0
    let outlinedLoads = 0
    let mounts = 0
    let unmounts = 0
    let disposes = 0
    const contexts: StorybookRuntimeContext[] = []

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
            return {
              async mount(input: Readonly<{route: string, story: any}>) {
                mounts += 1
                const node = ownerContext.document.createElement("section")
                node.className = "owner-story"
                node.textContent = `${input.route}:${input.story.label}`
                ownerContext.present({
                  protocol: "story-presentation/1",
                  node,
                  componentRoot: {
                    readStyleSheets: () => Object.freeze({
                    revision: mounts,
                    styleSheets: Object.freeze([Object.freeze({
                      id: `owner-story-${mounts}`,
                      cssText: ".generated-owner-story { color: cyan; }",
                      source: Object.freeze({
                        kind: "authored-css",
                        moduleId: "@fixture/components/story.tsx",
                        componentName: "FixtureStory",
                        cssText: "color: cyan;",
                      }),
                    })]),
                    }),
                  },
                  source: {
                    html: `<section>${input.story.label}</section>`,
                    typescript: `export const route = ${JSON.stringify(input.route)}`,
                  },
                  values: {props: {label: input.story.label}},
                })
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
        shell: {
          canvas: {} as HTMLCanvasElement,
          loadFont: async () => ({}) as never,
          attach: fakeRootFactory(experienceState),
        },
      },
    })

    expect(dataset.externalStorybookPackage).toBe("ready")
    expect(controller.shell.workbench.element.getAttribute("aria-label")).toBe("Fixture Components")
    expect(controller.currentRoute).toBe("")
    expect(controller.shell.workbench.controller.read("presentation").node?.textContent).toContain("Owner README")
    expect(runtimeLoads).toBe(0)
    expect(containedLoads).toBe(0)
    expect(outlinedLoads).toBe(0)

    await controller.navigate("components")
    expect(controller.shell.workbench.controller.read("catalog.active"))
      .toBe("category:@fixture/components/components")
    expect(controller.shell.workbench.controller.read("secondary.label")).toBe("Components")
    expect(controller.shell.workbench.controller.read("secondary.active")).toBeNull()
    expect(controller.shell.workbench.controller.read("scenarios.active")).toBeNull()
    const categoryOverview = controller.shell.workbench.controller.read("presentation").node
    expect((categoryOverview as Element | null)?.querySelectorAll("[data-storybook-aggregate-item]"))
      .toHaveLength(1)
    expect(categoryOverview?.textContent).toContain("Contained")
    expect(controller.shell.workbench.controller.read("inspector.subject")).toEqual({
      packageId: "@fixture/components",
      subjectId: "subject:@fixture/components/components/button",
      widgetIds: ["props", "source", "diagnostics"],
    })
    expect(controller.shell.workbench.controller.read("inspector.values")).toMatchObject({
      props: {label: "Contained"},
    })
    expect(controller.shell.workbench.elements.inspectorHost.textContent).toContain("Contained")

    await controller.navigate("components/button")
    expect(controller.shell.workbench.controller.read("catalog.active"))
      .toBe("category:@fixture/components/components")
    expect(controller.shell.workbench.controller.read("secondary.active"))
      .toBe("subject:@fixture/components/components/button")
    expect(controller.shell.workbench.controller.read("scenarios.active")).toBeNull()
    expect(runtimeLoads).toBe(1)
    expect(containedLoads).toBe(2)
    expect(outlinedLoads).toBe(1)
    expect(mounts).toBe(3)
    const subjectOverview = controller.shell.workbench.controller.read("presentation").node
    expect((subjectOverview as Element | null)?.querySelectorAll("[data-storybook-aggregate-item]"))
      .toHaveLength(2)
    expect(subjectOverview?.textContent).toContain("Contained")
    expect(subjectOverview?.textContent).toContain("Outlined")

    await controller.navigate("components/button/basic/contained")
    expect(runtimeLoads).toBe(1)
    expect(containedLoads).toBe(3)
    expect(outlinedLoads).toBe(1)
    expect(mounts).toBe(4)
    const ownerContext = contexts[0]!
    const experienceDocument = experienceState.document
    if (experienceDocument === null) throw new Error("Fake Root did not publish its semantic Document")
    expect(ownerContext.document).toBe(controller.shell.document)
    expect(ownerContext.document).toBe(experienceDocument)
    expect(ownerContext.projection).toBe("display")
    expect("space" in ownerContext).toBeFalse()
    expect("mountSpacePreview" in ownerContext).toBeFalse()
    expect(controller.shell.workbench.controller.read("presentation").node?.textContent)
      .toBe("components/button/basic/contained:Contained")
    expect(controller.shell.workbench.elements.inspectorHost.textContent).toContain("owner-ready")
    expect(controller.shell.workbench.controller.read("status").breadcrumbs?.map(({label}) => label)).toEqual([
      "Fixture Workspace",
      "Fixture Alpha",
      "Fixture Components",
      "Components",
      "Button",
      "Contained",
    ])
    await controller.navigate("components/button/outlined")
    expect(runtimeLoads).toBe(1)
    expect(containedLoads).toBe(3)
    expect(outlinedLoads).toBe(2)
    expect(mounts).toBe(5)
    expect(controller.shell.workbench.controller.read("scenarios.active"))
      .toBe("variant:@fixture/components/components/button/outlined")

    await controller.navigate("components/button")
    expect(controller.shell.workbench.controller.read("scenarios.active")).toBeNull()
    const restoredOverview = controller.shell.workbench.controller.read("presentation").node
    expect((restoredOverview as Element | null)?.querySelectorAll("[data-storybook-aggregate-item]"))
      .toHaveLength(2)
    expect(restoredOverview?.textContent).toContain("Contained")
    expect(restoredOverview?.textContent).toContain("Outlined")
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
      revision: "revision-b",
      diagnostics: [{phase: "compile", message: "broken candidate"}],
    })})
    expect(controller.shell.workbench.elements.inspectorHost.textContent).toContain("broken candidate")

    await controller.dispose()
    expect(unmounts).toBeGreaterThanOrEqual(6)
    expect(disposes).toBeGreaterThanOrEqual(6)
    expect(socket.closed).toBeTrue()
    expect(experienceState.disposals).toBe(1)
  })

  test("grants only a declared space subject the exact semantic Root Space", async () => {
    const sourceGraph = await fixtureGraph()
    const buttonSubjectId = "subject:@fixture/components/components/button"
    const spaceGraph: ExternalStorybookGraph = Object.freeze({
      ...sourceGraph,
      nodes: Object.freeze(sourceGraph.nodes.map((node) =>
        node.id === buttonSubjectId || node.parentId === buttonSubjectId && node.kind === "variant"
          ? Object.freeze({
            ...node,
            presentation: node.presentation === null
              ? null
              : Object.freeze({...node.presentation, projection: "space" as const}),
          })
          : node)),
    })
    const candidate = "revision-space"
    const snapshot = createExternalStorybookClientSnapshot(
      spaceGraph,
      packageSnapshots(spaceGraph, candidate),
    )
    const baseEnvironment = environmentFixture(
      snapshot,
      "/packages/%40fixture%2Fcomponents/components/button/basic/contained",
    )
    const experienceState = createFakeRootState()
    const environment: ExternalStorybookPackageEnvironment = {
      ...baseEnvironment,
      shell: {
        ...(baseEnvironment.shell ?? {}),
        canvas: {} as HTMLCanvasElement,
        loadFont: async () => ({}) as never,
        attach: fakeRootFactory(experienceState),
      },
    }
    const contexts: StorybookRuntimeContext[] = []
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: candidate,
      revisionUrl: `/__storybook/revisions/%40fixture%2Fcomponents/${candidate}/`,
      async loadRuntime() {
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          create(context: StorybookRuntimeContext) {
            contexts.push(context)
            if (context.projection !== "space") throw new Error("Expected space context")
            return {
              mount() {
                const node = context.document.createElement("section")
                context.present({
                  protocol: "story-presentation/1",
                  node,
                  componentRoot: {readStyleSheets: () => ({revision: 0, styleSheets: []})},
                  source: {html: "<section></section>", typescript: "<Space />"},
                })
                context.mountSpacePreview({
                  node,
                  camera: {position: {x: 0, y: -10, z: 4}, target: {x: 0, y: 0, z: 0}},
                })
              },
              unmount() {},
              dispose() {},
            }
          },
        }
      },
      storyLoaders: new Map([["components/button/basic/contained", async () => ({})]]),
      environment,
    })
    const contextSeen = contexts[0]
    expect(contextSeen?.projection).toBe("space")
    if (contextSeen?.projection !== "space") throw new Error("Space context was not created")
    const experienceSpace = experienceState.space
    if (experienceSpace === null) throw new Error("Fake Root did not publish its semantic Space")
    expect(contextSeen.space).toBe(controller.shell.space)
    expect(contextSeen.space).toBe(experienceSpace)
    expect(contextSeen.space.ownerDocument).toBe(controller.shell.document)
    expect(controller.shell.workbench.controller.read("presentation").projection).toBe("space")
    expect(experienceState.creations).toBe(1)
    await controller.dispose()
    expect(experienceState.disposals).toBe(1)
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

  test("acknowledges a required author link that failed before module entry as non-working", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-author-failure"
    const revisionUrl = `/__storybook/revisions/%40fixture%2Fcomponents/${candidate}/`
    const revisionGraph = createStorybookPackageRevisionGraphSnapshot(
      graph,
      "@fixture/components",
      "fixture-author-failure",
    )
    const environment = environmentFixture(
      createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate)),
      "/packages/%40fixture%2Fcomponents/",
    )
    const browserDocument = {
      documentElement: {dataset: {}},
      readyState: "interactive",
    } as unknown as globalThis.Document
    const links = new Map<string, HTMLLinkElement>(revisionGraph.authorStyleSheets.map((styleSheet, index) => {
      const attributes = new Map([
        ["rel", "stylesheet"],
        ["href", `${revisionUrl}${styleSheet.url}`],
        ["data-external-storybook-author-style-sheet", styleSheet.specifier],
        ["data-external-storybook-author-style-sheet-digest", styleSheet.contentDigest],
      ])
      return [`external-storybook-author-style-sheet-${index}`, {
        localName: "link",
        ownerDocument: browserDocument,
        sheet: null,
        getAttribute: (name: string) => attributes.get(name) ?? null,
      } as unknown as HTMLLinkElement] as const
    }))
    browserDocument.getElementById = (id) => links.get(id) ?? null
    const acknowledgements: Array<Readonly<{
      packageId: string
      revision: string
      packageGraphDigest: string
      route: string
      working: boolean
      frameSequence: number
      diagnostic?: string
    }>> = []
    await expect(startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: candidate,
      revisionUrl,
      graphSnapshot: revisionGraph,
      loadRuntime: null,
      storyLoaders: new Map(),
      widgetLoaders: new Map([["fixture-controls", async () => ({})]]),
      environment: {
        ...environment,
        browserDocument,
        acknowledgeActivation: async (value) => { acknowledgements.push(value) },
      },
    })).rejects.toThrow("failed before package entry")
    expect(acknowledgements).toEqual([{
      packageId: "@fixture/components",
      revision: candidate,
      packageGraphDigest: revisionGraph.packageGraphDigest,
      route: "",
      frameSequence: 0,
      working: false,
      diagnostic: "Required Storybook author stylesheet failed before package entry: @fixture/components/tokens.css",
    }])
  })

  test("unmounts a partially mounted root when runtime/4 atomic source provenance fails", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-missing-provenance"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const environment = environmentFixture(
      snapshot,
      "/packages/%40fixture%2Fcomponents/components/button/basic/contained",
    )
    let unmounts = 0
    let rootActive = true
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: candidate,
      revisionUrl: `/__storybook/revisions/%40fixture%2Fcomponents/${candidate}/`,
      async loadRuntime() {
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          create(context: StorybookRuntimeContext) {
            return {
              mount() {
                const node = context.document.createElement("button")
                context.present({
                  protocol: "story-presentation/1",
                  node,
                  source: {html: "<button></button>", typescript: "<Button />"},
                  componentRoot: {readStyleSheets: () => ({
                    revision: 1,
                    styleSheets: [{id: "generated-only", cssText: "[data-z] {}"}],
                  })},
                })
              },
              unmount() {
                unmounts += 1
                rootActive = false
              },
              dispose() {},
            }
          },
        }
      },
      storyLoaders: new Map([["components/button/basic/contained", async () => ({})]]),
      environment,
    })
    expect(unmounts).toBe(1)
    expect(rootActive).toBeFalse()
    expect((environment.browserDocument as any).documentElement.dataset.externalStorybookPackage)
      .toBe("error")
    await controller.navigate("components/button")
    expect(unmounts).toBe(2)
    expect((environment.browserDocument as any).documentElement.dataset.externalStorybookPackage)
      .toBe("error")
    await controller.dispose()
  })

  test("requires exactly one atomic presentation and rejects derived or unselected values", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-atomic-law"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    for (const violation of ["missing", "double", "derived", "unselected"] as const) {
      const environment = environmentFixture(
        snapshot,
        "/packages/%40fixture%2Fcomponents/components/button/basic/contained",
      )
      let unmounts = 0
      const controller = await startExternalStorybookPackage({
        packageId: "@fixture/components",
        candidateRevision: candidate,
        revisionUrl: `/__storybook/revisions/%40fixture%2Fcomponents/${candidate}/`,
        async loadRuntime() {
          return {
            protocol: STORYBOOK_RUNTIME_PROTOCOL,
            create(context: StorybookRuntimeContext) {
              return {
                mount() {
                  if (violation === "missing") return
                  const node = context.document.createElement("button")
                  const present = (values?: Readonly<Record<string, unknown>>) => context.present({
                    protocol: "story-presentation/1",
                    node,
                    componentRoot: {readStyleSheets: () => ({revision: 0, styleSheets: []})},
                    source: {html: "<button></button>", typescript: "<Button />"},
                    ...(values === undefined ? {} : {values}),
                  })
                  present(violation === "derived"
                    ? {dom: {}}
                    : violation === "unselected"
                      ? {events: []}
                      : undefined)
                  if (violation === "double") present()
                },
                unmount() { unmounts += 1 },
                dispose() {},
              }
            },
          }
        },
        storyLoaders: new Map([["components/button/basic/contained", async () => ({})]]),
        environment,
      })
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookPackage, violation)
        .toBe("error")
      expect(unmounts, violation).toBe(1)
      await controller.dispose()
    }
  })

  test("reports create, session, mount and first-frame failures without acknowledging working", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-a"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    for (const failure of ["create", "session", "mount", "frame"] as const) {
      const baseEnvironment = environmentFixture(
        snapshot,
        "/packages/%40fixture%2Fcomponents/components/button/basic/contained",
      )
      const acknowledgements: Array<Readonly<{working: boolean; diagnostic?: string}>> = []
      let invalidDispose = 0
      const experienceState = createFakeRootState()
      if (failure === "frame") experienceState.failRenderAt = 2
      const environment: ExternalStorybookPackageEnvironment = {
        ...baseEnvironment,
        acknowledgeActivation: async (value) => { acknowledgements.push(value) },
        shell: {
          ...(baseEnvironment.shell ?? {}),
          attach: fakeRootFactory(experienceState),
        },
      }
      const controller = await startExternalStorybookPackage({
        packageId: "@fixture/components",
        candidateRevision: candidate,
        revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
        async loadRuntime() {
          return {
            protocol: STORYBOOK_RUNTIME_PROTOCOL,
            async create(context: StorybookRuntimeContext) {
              if (failure === "create") throw new Error("create failed")
              if (failure === "session") return {dispose() { invalidDispose += 1 }} as never
              return {
                async mount() {
                  if (failure === "mount") throw new Error("mount failed")
                  const node = context.document.createElement("div")
                  node.textContent = "working"
                  context.present({
                    protocol: "story-presentation/1",
                    node,
                    componentRoot: {readStyleSheets: () => ({revision: 0, styleSheets: []})},
                    source: {html: "<div>working</div>", typescript: "<Working />"},
                  })
                },
                async unmount() {},
                async dispose() {},
              }
            },
          }
        },
        storyLoaders: new Map([["components/button/basic/contained", async () => ({label: "Contained"})]]),
        environment,
      })
      expect(acknowledgements).toHaveLength(1)
      expect(acknowledgements[0]?.working, failure).toBeFalse()
      expect(acknowledgements[0]?.diagnostic?.length, failure).toBeGreaterThan(0)
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookPackage).toBe("error")
      await controller.dispose()
      if (failure === "session") expect(invalidDispose).toBe(1)
    }
  })

  test("reloads the previous working revision after acknowledged candidate runtime failure", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-a"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const environment = environmentFixture(
      snapshot,
      "/packages/%40fixture%2Fcomponents/components/button/basic/contained",
    )
    const browserDocument = environment.browserDocument as unknown as {
      querySelector(selector: string): {content: string} | null
    }
    browserDocument.querySelector = (selector) => {
      if (selector.includes("browser-session")) return {content: "a".repeat(43)}
      if (selector.includes("activation-id")) return {content: "activation-id"}
      if (selector.includes("fallback-revision")) return {content: "revision-working"}
      return null
    }
    const fetcher = (async (_input: URL | RequestInfo, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ok: false}) : Response.json(snapshot)) as typeof fetch
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: candidate,
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
      async loadRuntime() {
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          async create() { throw new Error("candidate create failed") },
        }
      },
      storyLoaders: new Map([["components/button/basic/contained", async () => ({})]]),
      environment: {...environment, fetcher},
    })
    expect((environment.location as LocationFixture).reloads).toBe(1)
    await controller.dispose()
  })

  test("aborts a hung candidate and reloads lastWorking on activation-timeout event", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-timeout"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const environment = environmentFixture(
      snapshot,
      "/packages/%40fixture%2Fcomponents/components/button/basic/contained",
    )
    const socket = new FakeSocket()
    const browserDocument = environment.browserDocument as unknown as {
      querySelector(selector: string): {content: string} | null
    }
    browserDocument.querySelector = (selector) => {
      if (selector.includes("browser-session")) return {content: "b".repeat(43)}
      if (selector.includes("fallback-revision")) return {content: "revision-working"}
      return null
    }
    let createStarted!: () => void
    const creating = new Promise<void>((resolvePromise) => { createStarted = resolvePromise })
    const pending = startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: candidate,
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-timeout/",
      async loadRuntime() {
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          async create() {
            createStarted()
            await new Promise<never>(() => {})
          },
        }
      },
      storyLoaders: new Map([["components/button/basic/contained", async () => ({})]]),
      environment: {
        ...environment,
        createSocket: () => socket,
        cleanupTimeoutMs: 10,
      },
    })
    await creating
    socket.emit("message", {data: JSON.stringify({
      type: "package.failed",
      packageId: "@fixture/components",
      revision: candidate,
      diagnostics: [{phase: "timeout", message: "activation timed out"}],
    })})
    await expect(pending).rejects.toThrow(`Storybook candidate activation failed: ${candidate}`)
    expect((environment.location as LocationFixture).reloads).toBe(1)
    expect(socket.closed).toBeTrue()
  })

  test("serializes rapid runtime routes and disposes a session created after cancellation", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-a"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const environment = environmentFixture(snapshot, "/packages/%40fixture%2Fcomponents/")
    let concurrent = 0
    let maximum = 0
    let startFirst!: () => void
    const firstStarted = new Promise<void>((resolvePromise) => { startFirst = resolvePromise })
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolvePromise) => { releaseFirst = resolvePromise })
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: candidate,
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
      async loadRuntime() {
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          async create(context: StorybookRuntimeContext) {
            return {
              async mount({route}: {route: string}) {
                concurrent += 1
                maximum = Math.max(maximum, concurrent)
                if (route.endsWith("contained")) {
                  startFirst()
                  await firstGate
                }
                concurrent -= 1
                const node = context.document.createElement("div")
                context.present({
                  protocol: "story-presentation/1",
                  node,
                  componentRoot: {readStyleSheets: () => ({revision: 0, styleSheets: []})},
                  source: {html: `<div>${route}</div>`, typescript: `<Story route=${JSON.stringify(route)} />`},
                })
              },
              async unmount() {},
              async dispose() {},
            }
          },
        }
      },
      storyLoaders: new Map([
        ["components/button/basic/contained", async () => ({})],
        ["components/button/outlined", async () => ({})],
      ]),
      environment,
    })
    const first = controller.navigate("components/button/basic/contained")
    await firstStarted
    const second = controller.navigate("components/button/outlined")
    releaseFirst()
    await Promise.all([first, second])
    expect(maximum).toBe(1)
    expect(controller.currentRoute).toBe("components/button/outlined")
    await controller.dispose()

    const cancellation = new AbortController()
    let createStarted!: () => void
    const creating = new Promise<void>((resolvePromise) => { createStarted = resolvePromise })
    let releaseCreate!: () => void
    const createGate = new Promise<void>((resolvePromise) => { releaseCreate = resolvePromise })
    let lateDispose = 0
    const pending = startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: candidate,
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
      async loadRuntime() {
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          async create() {
            createStarted()
            await createGate
            return {
              async mount() {},
              async unmount() {},
              async dispose() { lateDispose += 1 },
            }
          },
        }
      },
      storyLoaders: new Map([["components/button/basic/contained", async () => ({})]]),
      environment: {
        ...environmentFixture(snapshot, "/packages/%40fixture%2Fcomponents/components/button/basic/contained"),
        lifecycleSignal: cancellation.signal,
      },
    })
    await creating
    cancellation.abort(new Error("view closed"))
    releaseCreate()
    await expect(pending).rejects.toThrow("view closed")
    expect(lateDispose).toBe(1)

    const hungCancellation = new AbortController()
    let hungStarted!: () => void
    const hungCreating = new Promise<void>((resolvePromise) => { hungStarted = resolvePromise })
    const hung = startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: candidate,
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
      async loadRuntime() {
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          async create() {
            hungStarted()
            await new Promise<never>(() => {})
          },
        }
      },
      storyLoaders: new Map([["components/button/basic/contained", async () => ({})]]),
      environment: {
        ...environmentFixture(snapshot, "/packages/%40fixture%2Fcomponents/components/button/basic/contained"),
        lifecycleSignal: hungCancellation.signal,
        cleanupTimeoutMs: 10,
      },
    })
    await hungCreating
    hungCancellation.abort(new Error("hung view closed"))
    await expect(hung).rejects.toThrow("hung view closed")
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
    shell: {
      canvas: {} as HTMLCanvasElement,
      loadFont: async () => ({}) as never,
      attach: fakeRootFactory(),
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

type FakeRootState = {
  creations: number
  disposals: number
  frames: number
  document: ReturnType<typeof createDocument> | null
  space: XRSpaceElement | null
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
  return async options => {
    state.creations += 1
    state.lifecycle.push("root-create")
    state.stylesheets = Object.freeze((options.stylesheets ?? []).filter((source): source is Readonly<{id: string; link: HTMLLinkElement}> => typeof source !== "string"))

    const document = createDocument({elementFactories: createSpaceElementFactories()})
    const appRoot = createRoot(document)
    appRoot.render(options.app)
    appRoot.flush()
    const space = document.documentElement as XRSpaceElement
    const viewPoint = space.querySelector("xr-view-point") as XRViewPointElement
    state.document = document
    state.space = space

    const presented = new Set<(sequence: number) => void>()
    const documentProjections = new Map<XRDisplayElement | XRHUDElement, Readonly<{
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
      owner: XRDisplayElement | XRHUDElement,
    ): RootDocumentProjection => {
      const existing = documentProjections.get(owner)
      if (existing !== undefined) return existing.projection
      if (owner.ownerDocument !== document || owner.parentNode !== space) {
        throw new Error("Fake Root projection owner must be a direct child of its semantic Space")
      }
      const subscribers = new Set<(frame: RenderFrame) => void>()
      let frame: RenderFrame | null = null
      const projection: RootDocumentProjection = Object.freeze({
        kind: owner instanceof XRDisplayElement ? "display" : "hud",
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
    function getProjection(owner: XRDisplayElement | XRHUDElement): RootDocumentProjection
    function getProjection(
      owner: XRSpaceElement | XRDisplayElement | XRHUDElement,
    ): RootProjection {
      if (owner === space) return spaceProjection
      return documentProjection(owner as XRDisplayElement | XRHUDElement)
    }

    const root: Root = Object.freeze({
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
        state.disposals += 1
        state.lifecycle.push("root-dispose")
        presented.clear()
        documentProjections.clear()
      },
    })
    return root
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
