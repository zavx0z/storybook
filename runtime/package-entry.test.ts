import {DisplayElement} from "@zavx0z/dom/display"
import {presentationRootFixture, type PresentationFixtureOptions} from "./browser-root.fixture.ts"
import {createRoot} from "@zavx0z/component"
import {createDocumentClipboardController} from "@zavx0z/browser/clipboard"
import {describe, expect, test} from "bun:test"
import {join} from "node:path"
import {createDocument, DOMRect, Event as SemanticEvent, MouseEvent, readDocumentScrollIntoViewRequests, type Element, type HTMLButtonElement} from "@zavx0z/dom"
import type {
  Presentation as Root,
  RootDocumentProjection,
  RootProjection,
  RootSpaceProjection,
} from "@zavx0z/browser/integration"
import type {RenderFrame} from "@renderer/html"
import {createSpaceElementFactories} from "@zavx0z/space"
import {HUDElement} from "../../webxr-space/dom/hud/index.ts"
import {SpaceElement} from "@zavx0z/dom/space"
import {ViewPointElement} from "@zavx0z/dom/viewpoint"
import {
  resolveExternalStorybookDeclarations,
} from "../discovery/declarations.ts"
import {createExternalStorybookGraph, type ExternalStorybookGraph} from "../catalog/graph.ts"
import type {StorybookPackageSessionSnapshot} from "../sessions/package-session.ts"
import {
  createStorybookPackageRevisionGraphSnapshot,
  type StorybookPackageRevisionGraphSnapshot,
} from "../sessions/package-revision.ts"
import {
  STORYBOOK_RUNTIME_PROTOCOL,
  type StorybookRuntimeContext,
  type StorybookRuntimeStoryInput,
} from "./runtime-protocol.ts"
import {createExternalStorybookClientSnapshot} from "./client-protocol.ts"
import {sha256Hex} from "../src/shared/sha256.ts"
import {
  STORYBOOK_PAGE_REALM_PROTOCOL,
  startExternalStorybookPackage,
  type ExternalStorybookPackageEnvironment,
} from "./package-entry.ts"
import type {ExternalStorybookRootFactory} from "./shell.ts"
import {startExternalStorybookPage, type ExternalStorybookPreparedPackageTarget} from "./page-entry.ts"

const fixtureRoot = join(import.meta.dir, "../discovery/fixtures/valid")

describe("external Storybook package frontend", () => {
  test.each(["components/button", "components/button/contract"])("[STORYBOOK-CONTRACT-DISPLAY] TypeDoc и history из %s в том же Display", async initialRoute => {
    const base = await fixtureGraph()
    const subjectId = "subject:@fixture/components/components/button"
    const contractDocumentation = {sources: [], documents: [{direction: "input" as const, document: {
      name: "input.ts", declarations: [{name: "Input", kind: "interface" as const,
        signature: "export interface Input {label?: string}",
        comment: {summary: "Описание входного контракта", examples: []},
        members: [
          {name: "label", type: "string | undefined", optional: true, defaultValue: "Example", description: "Текст подписи"},
          {name: "a.b", type: "string", optional: false, description: "Поле с точкой"},
          {name: "a", type: "{b: number}", optional: false, description: "Вложенный объект", children: [
            {name: "b", type: "number", optional: false, description: "Вложенное поле"},
          ]},
        ],
      }],
    }}, {direction: "output" as const, document: {
      name: "output.ts", declarations: [{name: "Output", kind: "interface" as const,
        signature: "export interface Output {result: {code: number}}",
        comment: {summary: "Описание выходного контракта", examples: []},
        members: [{name: "result", type: "{code: number}", optional: false, description: "Результат", children: [
          {name: "code", type: "number", optional: false, description: "Код результата"},
        ]}],
      }],
    }}]}
    const graph = {...base, nodes: base.nodes.map(node => node.id === subjectId
      ? {...node, childIds: [], contractRoutePath: "components/button/contract", contractDocumentation}
      : node)}
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-contract"))
    const environment = environmentFixture(snapshot, `/pkg-fixture-components/${initialRoute}?preview=revision-contract`)
    const events = new EventTarget()
    Object.defineProperty(environment.browserDocument, "defaultView", {value: events})
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components", candidateRevision: "revision-contract",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-contract/",
      loadRuntime: null, storyLoaders: new Map(), environment,
    })
    try {
      const {document, display, workbench} = controller.shell
      expect(controller.currentRoute).toBe(initialRoute)
      expect(display.querySelector("[data-storybook-contract]") !== null).toBe(initialRoute.endsWith("/contract"))
      const tab = [...workbench.element.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === "Контракт") as HTMLButtonElement
      tab.click()
      const deadline = Date.now() + 10000
      while (!display.querySelector("[data-typedoc]") && Date.now() < deadline) await Bun.sleep(10)
      expect(display.querySelector("[data-typedoc]")).not.toBeNull()
      expect(display.textContent).toContain("Текст подписи")
      expect(display.querySelector("[data-token-category]")).not.toBeNull()
      expect(display.textContent).toContain("Входные данные")
      expect(display.textContent).not.toContain("Выходные данные")
      expect(workbench.controller.read("tabs.active")).toBe(`contract:${subjectId}`)
      expect(controller.currentRoute).toBe("components/button/contract")
      expect(new URL(environment.location!.href).searchParams.get("preview")).toBe("revision-contract")
      expect(workbench.controller.read("inspector.subject")).toMatchObject({
        packageId: "@fixture/components",
        subjectId,
        workspaceId: "contract:/pkg-fixture-components/components/button/contract",
        widgetIds: ["storybook-contract-input", "storybook-contract-output"],
      })
      expect(workbench.elements.inspectorHost.querySelector('[data-widget="tree"]')?.textContent).toContain("Input")
      expect(workbench.elements.inspectorHost.textContent).not.toContain("Параметры")
      expect(workbench.elements.inspectorHost.querySelector('button[aria-expanded][title="Вход"]') === null).toBe(true)
      expect([...workbench.elements.inspectorHost.querySelectorAll("button")]
        .some(button => button.textContent?.trim() === "Вход" || button.textContent?.trim() === "Выход")).toBe(false)
      expect(new URL(environment.location!.href).searchParams.get("inspector")).toBe("input")
      const inputTree = workbench.elements.inspectorHost.querySelector('[data-widget="tree"]') as Element
      expect(inputTree.querySelector('button[aria-label="Раскрыть"]')).toBeNull()
      expect(inputTree.querySelectorAll('[aria-expanded="true"]')).toHaveLength(2)
      const inputItems = [...inputTree.querySelectorAll("[data-tree-id]")]
      const dotted = inputItems.find(item => item.getAttribute("data-tree-id") === JSON.stringify(["input", "Input", "a.b"]))
      const nested = inputItems.find(item => item.getAttribute("data-tree-id") === JSON.stringify(["input", "Input", "a"]))
      expect(dotted).not.toBeNull()
      expect(nested).not.toBeNull()
      expect(dotted?.getAttribute("data-tree-id")).not.toBe(nested?.getAttribute("data-tree-id"))
      expect(inputTree.textContent).toContain("b")
      const nestedLeaf = [...inputTree.querySelectorAll("[data-tree-id]")].find(item =>
        item.getAttribute("data-tree-id") === JSON.stringify(["input", "Input", "a", "b"]))!
      const nestedDescription = [...display.querySelectorAll("[data-typedoc-member]")].find(item =>
        item.getAttribute("data-typedoc-member") === "b")!
      nestedLeaf.dispatchEvent(new MouseEvent("click", {bubbles: true}))
      expect(readDocumentScrollIntoViewRequests(document).at(-1)?.target === nestedDescription).toBe(true)
      expect(nestedLeaf.getAttribute("aria-selected")).toBe("true")
      expect(inputTree.textContent).toContain("Входные поля")
      expect(inputTree.querySelector('button[title="Свернуть всё"]')).toBeNull()
      expect(inputTree.querySelector('button[title="Развернуть всё"]')).toBeNull()
      const collapseBranch = nested?.querySelector('button[aria-label="Свернуть"]') as HTMLButtonElement
      collapseBranch.click()
      expect(inputTree.querySelectorAll('[aria-expanded="true"]')).toHaveLength(2)
      const contractViewport = display.querySelector("[data-storybook-contract]")!
      contractViewport.getBoundingClientRect = () => new DOMRect(0, 100, 600, 200)
      for (const target of [
        ...display.querySelectorAll("[data-typedoc-declaration]"),
        ...display.querySelectorAll("[data-typedoc-member]"),
      ]) {
        target.getBoundingClientRect = () => new DOMRect(0, 500, 400, 40)
        for (const child of target.children) {
          if (!child.hasAttribute("data-typedoc-members")) child.getBoundingClientRect = () => target.getBoundingClientRect()
        }
      }
      nestedDescription.getBoundingClientRect = () => new DOMRect(0, 95, 400, 40)
      expect(inputTree.querySelector('button[title="Показать текущее место"]')).toBeNull()
      controller.shell.presentFrame()
      const revealedLeaf = [...inputTree.querySelectorAll("[data-tree-id]")].find(item =>
        item.getAttribute("data-tree-id") === JSON.stringify(["input", "Input", "a", "b"]))!
      expect(revealedLeaf.getAttribute("aria-selected")).toBe("true")
      expect(inputTree.querySelectorAll('[aria-expanded="true"]')).toHaveLength(2)
      expect(readDocumentScrollIntoViewRequests(document).at(-1)?.target === revealedLeaf.querySelector("[data-tree-row]")).toBe(true)
      const output = workbench.elements.inspectorHost.querySelector('button[title="Выход"]') as HTMLButtonElement
      output.click()
      expect(new URL(environment.location!.href).searchParams.get("inspector")).toBe("output")
      expect(output.getAttribute("aria-pressed")).toBe("true")
      expect(display.textContent).toContain("Выходные данные")
      expect(display.textContent).not.toContain("Входные данные")
      expect(display.querySelectorAll("[data-typedoc]")).toHaveLength(1)
      expect(workbench.controller.read("inspector.values")["storybook-contract-output"])
        .toMatchObject({direction: "output"})
      const input = workbench.elements.inspectorHost.querySelector('button[title="Вход"]') as HTMLButtonElement
      input.click()
      expect(display.textContent).toContain("Входные данные")
      expect(display.textContent).not.toContain("Выходные данные")
      expect(nested?.getAttribute("aria-expanded")).toBe("true")
      const subject = workbench.elements.secondary.querySelector(`[data-id="${subjectId}"] button`) as HTMLButtonElement
      subject.click()
      const until = Date.now() + 5000
      while (controller.currentRoute !== "components/button" && Date.now() < until) await Bun.sleep(10)
      expect(controller.currentRoute).toBe("components/button")
      const location = environment.location! as LocationFixture
      const url = new URL("/pkg-fixture-components/components/button/contract?preview=revision-contract&inspector=output", location.href)
      location.pathname = url.pathname
      location.href = url.href
      events.dispatchEvent(new Event("popstate"))
      const restored = Date.now() + 5000
      while (!display.querySelector("[data-typedoc]") && Date.now() < restored) await Bun.sleep(10)
      expect(display.querySelector("[data-typedoc]")).not.toBeNull()
      expect(new URL(environment.location!.href).searchParams.get("inspector")).toBe("output")
      expect(display.textContent).toContain("Выходные данные")
      expect(display.textContent).not.toContain("Входные данные")
      location.href = location.href.replace("inspector=output", "inspector=input")
      events.dispatchEvent(new Event("popstate"))
      expect(display.textContent).toContain("Входные данные")
      expect(display.textContent).not.toContain("Выходные данные")
      expect(controller.shell.document).toBe(document)
      expect(controller.shell.display).toBe(display)
    } finally { await controller.dispose() }
  })

  test("[INSPECTOR-WORKSPACE] variant, contract и dependencies не смешивают Inspector и URL", async () => {
    const base = await fixtureGraph()
    const subjectId = "subject:@fixture/components/components/button"
    const graph = {...base, nodes: base.nodes.map(node => node.id === subjectId
      ? {...node,
        contractRoutePath: "components/button/contract",
        contractDocumentation: {sources: [], documents: [{direction: "input" as const, document: {
          name: "input.ts", declarations: [{name: "Input", kind: "interface" as const,
            signature: "export interface Input {value: string}",
            comment: {summary: "Вход", examples: []},
            members: [{name: "value", type: "string", optional: false, description: "Значение"}],
          }],
        }}]},
        dependencyRoutePath: "components/button/dependencies",
        dependencySpec: {sourcePath: "/fixture/deps.spec.ts", sourceDigest: "fixture", cases: []},
      }
      : node)}
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-inspector"))
    const environment = environmentFixture(snapshot, "/pkg-fixture-components/components/button/basic/contained?preview=revision-inspector")
    const events = new EventTarget()
    Object.defineProperty(environment.browserDocument, "defaultView", {value: events})
    let ownerContext: StorybookRuntimeContext | null = null
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: "revision-inspector",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-inspector/",
      async loadRuntime() {
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          create(context: StorybookRuntimeContext) {
            ownerContext = context
            return {
              mount({route}: StorybookRuntimeStoryInput) {
                const node = context.document.createElement("article")
                node.textContent = route
                context.present({
                  protocol: "story-presentation/1",
                  node,
                  componentRoot: {readStyleSheets: () => ({revision: 0, styleSheets: []})},
                  source: {html: "<article></article>", typescript: "export const story = {}"},
                  values: {props: {route}},
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
    try {
      const {workbench} = controller.shell
      expect(workbench.controller.read("inspector.subject")).toMatchObject({
        workspaceId: "variant:components/button/basic/contained",
        widgetIds: ["props", "source", "diagnostics"],
      })
      const source = workbench.elements.inspectorHost.querySelector('button[title="Исходники"]') as HTMLButtonElement
      source.click()
      expect(new URL(environment.location!.href).searchParams.get("inspector")).toBe("source")

      await controller.navigate("components/button/contract")
      expect(workbench.controller.read("inspector.subject")).toMatchObject({
        workspaceId: "contract:/pkg-fixture-components/components/button/contract",
        widgetIds: ["storybook-contract-input"],
      })
      expect(new URL(environment.location!.href).searchParams.get("inspector")).toBe("input")
      const location = environment.location! as LocationFixture
      const invalid = new URL(location.href)
      invalid.searchParams.set("inspector", "missing")
      location.pathname = invalid.pathname
      location.href = invalid.href
      events.dispatchEvent(new Event("popstate"))
      expect(new URL(location.href).searchParams.get("inspector")).toBe("input")
      expect(() => ownerContext!.reportDiagnostic("late owner diagnostic")).toThrow("stale diagnostic")
      expect(workbench.controller.read("inspector.subject")?.widgetIds).toEqual(["storybook-contract-input"])

      await controller.navigate("components/button/dependencies")
      expect(workbench.controller.read("inspector.subject")).toBeNull()
      expect(new URL(environment.location!.href).searchParams.get("inspector")).toBeNull()

      await controller.navigate("components/button/basic/contained")
      expect(workbench.controller.read("inspector.subject")).toMatchObject({
        workspaceId: "variant:components/button/basic/contained",
      })
      expect(workbench.controller.selectedInspector()).toBe("source")
      expect(new URL(environment.location!.href).searchParams.get("inspector")).toBe("source")
    } finally {
      await controller.dispose()
    }
  }, 20_000)

  test.each(["components/button", "components/button/dependencies"])("[STORYBOOK-DEPS-DISPLAY] вкладка восстанавливается из %s, меняет URL и возвращается через предмет/history", async initialRoute => {
    const base = await fixtureGraph()
    const subjectId = "subject:@fixture/components/components/button"
    const cases = [{
      name: "Example", file: "component/index.tsx", testName: "Зависимости",
      graph: {"component/index.tsx#Example": {uses: [], elements: ["article"]}},
    }]
    const graph = {...base, nodes: base.nodes.map(node => node.id === subjectId
      ? {...node, childIds: [], dependencyRoutePath: "components/button/dependencies", dependencySpec: {sourcePath: "/fixture/component/spec/deps.spec.ts", sourceDigest: "fixture", cases}}
      : node)}
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-deps"))
    const environment = environmentFixture(snapshot, `/pkg-fixture-components/${initialRoute}?preview=revision-deps`)
    const events = new EventTarget()
    Object.defineProperty(environment.browserDocument, "defaultView", {value: events})
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: "revision-deps",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-deps/",
      loadRuntime: null,
      storyLoaders: new Map(),
      environment,
    })
    try {
      const {document, display, workbench} = controller.shell
      expect(controller.currentRoute).toBe(initialRoute)
      expect(display.querySelector("[data-storybook-dependencies]") !== null).toBe(initialRoute.endsWith("/dependencies"))
      expect(workbench.controller.read("tabs.items").map(item => item.label)).toEqual(["Зависимости"])
      expect(workbench.controller.read("tabs.items")[0]?.route).toBe("components/button/dependencies")
      const button = [...workbench.element.querySelectorAll("button")].find(node => node.getAttribute("aria-label") === "Зависимости") as HTMLButtonElement
      button.click()
      const deadline = Date.now() + 10000
      while (display.querySelector("[data-storybook-dependencies]") === null && Date.now() < deadline) await Bun.sleep(20)
      expect(display.querySelector("[data-storybook-dependencies]")).not.toBeNull()
      expect(workbench.controller.read("tabs.active")).toBe(`dependencies:${subjectId}`)
      expect(controller.currentRoute).toBe("components/button/dependencies")
      expect(environment.location!.pathname).toBe("/pkg-fixture-components/components/button/dependencies")
      expect(new URL(environment.location!.href).searchParams.get("preview")).toBe("revision-deps")
      expect(new URL(environment.location!.href).searchParams.get("inspector")).toBeNull()
      expect(workbench.controller.read("inspector.subject")).toBeNull()
      expect(display.querySelectorAll("[data-graph-view]")).toHaveLength(1)
      expect(display.textContent).toContain("Example")
      expect(display.textContent).toContain("<article>")
      expect(display.querySelector("[data-storybook-markdown]")).toBeNull()
      const previous = display.querySelector("[data-storybook-dependencies]")!
      const subject = workbench.elements.secondary.querySelector(`[data-id="${subjectId}"] button`) as HTMLButtonElement
      subject.click()
      const cleanupDeadline = Date.now() + 10000
      while (previous.isConnected && Date.now() < cleanupDeadline) await Bun.sleep(20)
      expect(previous.isConnected).toBe(false)
      expect(controller.currentRoute).toBe("components/button")
      expect(workbench.controller.read("tabs.active")).toBeNull()
      const historyCount = (environment.history as ReturnType<typeof historyFixture>).pushed.length
      const restore = async (route: string) => {
        const url = new URL(`/pkg-fixture-components/${route}?preview=revision-deps`, environment.location!.href)
        const location = environment.location! as LocationFixture
        location.pathname = url.pathname
        location.href = url.href
        events.dispatchEvent(new Event("popstate"))
        const until = Date.now() + 5000
        while ((controller.currentRoute !== route || environment.browserDocument!.documentElement.dataset.externalStorybookPackage !== "ready") && Date.now() < until) await Bun.sleep(10)
        expect(controller.currentRoute).toBe(route)
      }
      await restore("components/button/dependencies")
      expect(display.querySelector("[data-storybook-dependencies]")).not.toBeNull()
      expect(workbench.controller.read("tabs.active")).toBe(`dependencies:${subjectId}`)
      await restore("components/button")
      expect(display.querySelector("[data-storybook-dependencies]")).toBeNull()
      expect((environment.history as ReturnType<typeof historyFixture>).pushed).toHaveLength(historyCount)
      expect(controller.shell.document).toBe(document)
      expect(controller.shell.display).toBe(display)
      await controller.navigate("")
      expect(workbench.controller.read("tabs.items").some(item => item.id === `dependencies:${subjectId}`)).toBe(false)
    } finally {
      await controller.dispose()
    }
  })

  test.each([true, false])("fallback preserves the indexed Workbench stylesheet and rejects failed loading: loaded=%s", async loaded => {
    const graph = await fixtureGraph()
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-a"))
    const environment = environmentFixture(snapshot, "/pkg-fixture-components/")
    const browserDocument = environment.browserDocument!
    const attributes = new Map([
      ["rel", "stylesheet"],
      ["href", "/__storybook/revisions/%40zavx0z%2Fstorybook/host/workbench-author-style-sheets/0.css"],
      ["data-external-storybook-author-style-sheet", "@zavx0z/ui/themes/theme.css"],
      ["data-external-storybook-author-style-sheet-digest", "a".repeat(64)],
    ])
    const link = {
      localName: "link",
      ownerDocument: browserDocument,
      sheet: loaded ? {} : null,
      getAttribute: (name: string) => attributes.get(name) ?? null,
    } as unknown as HTMLLinkElement
    Object.assign(browserDocument, {
      readyState: "complete",
      querySelectorAll: () => [link],
      getElementById: (id: string) => id === "external-storybook-author-style-sheet-0" ? link : null,
    })
    const state = createFakeRootState()
    const pending = startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: null,
      revisionUrl: null,
      loadRuntime: null,
      storyLoaders: new Map(),
      environment: {...environment, shell: {...environment.shell, createRoot: fakeRootFactory(state)}},
    })
    if (!loaded) {
      await expect(pending).rejects.toThrow("stylesheet failed before entry")
      expect(state.creations).toBe(0)
      return
    }
    const controller = await pending
    try {
      expect(state.stylesheets).toEqual([{id: "@zavx0z/ui/themes/theme.css", link}])
      expect(state.creations).toBe(1)
      expect(browserDocument.documentElement.dataset.externalStorybookPhase).toBe("ready")
    } finally { await controller.dispose() }
  })

  test.each(["display", "hud"] as const)("mounts %s overview children into the existing projection before owner continuation", async projection => {
    const graph = await fixtureGraph()
    const base = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-projection"))
    const snapshot = {
      ...base,
      nodes: base.nodes.map(node => ({
        ...node,
        presentation: node.presentation === null ? null : {...node.presentation, projection},
      })),
    }
    let mounts = 0
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: "revision-projection",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-projection/",
      async loadRuntime() {
        return {
          protocol: STORYBOOK_RUNTIME_PROTOCOL,
          create(context: StorybookRuntimeContext) {
            return {
              mount() {
                const node = context.document.createElement("article")
                context.present({
                  protocol: "story-presentation/1",
                  node,
                  componentRoot: {readStyleSheets: () => ({revision: 0, styleSheets: []})},
                  source: {html: "<article></article>", typescript: "export const owner = {}"},
                })
                expect(context.projection).toBe(projection)
                expect(node.closest(projection === "display" ? "display" : "hud")).toBeInstanceOf(
                  projection === "display" ? DisplayElement : HUDElement,
                )
                mounts += 1
              },
              unmount() {},
              dispose() {},
            }
          },
        }
      },
      storyLoaders: new Map([
        ["components/button/basic/contained", async () => ({})],
        ["components/button/outlined", async () => ({})],
      ]),
      environment: environmentFixture(snapshot, "/pkg-fixture-components/components/button"),
    })
    try {
      expect(mounts).toBe(2)
      expect(controller.shell.document.querySelectorAll("display")).toHaveLength(1)
      expect(controller.shell.document.querySelectorAll("hud")).toHaveLength(1)
      const view = controller.shell.workbench.controller.read("presentation")
      expect(view.projection).toBe(projection)
      expect((view.node as Element).querySelectorAll("article")).toHaveLength(2)
      await controller.navigate("foundation/event-target")
      expect(controller.shell.document.querySelectorAll("[data-storybook-aggregate-overview]"))
        .toHaveLength(0)
    } finally {
      await controller.dispose()
    }
  })

  test("reconnects a package reader and follows a publication missed while disconnected", async () => {
    const graph = await fixtureGraph()
    const candidate = "preview-candidate"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const sockets: FakeSocket[] = []
    let renewed = 0
    const environment = {
      ...environmentFixture(snapshot, "/pkg-fixture-components/"),
      browserDocument: {
        documentElement: {dataset: {}},
        querySelector: (selector: string) => selector.includes("applied-revision") ? {content: "older-applied"} : null,
      } as unknown as globalThis.Document,
      createSocket() {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      fetcher: (async (input: RequestInfo | URL) => {
        if (String(input) === "/api/browser/session") {
          renewed += 1
          return Response.json({token: "a".repeat(43)})
        }
        if (String(input) === "/api/client") return Response.json(snapshot)
        return new Response("# Package")
      }) as typeof fetch,
    }
    const location = environment.location as LocationFixture
    location.href += `?preview=${candidate}`
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components", candidateRevision: candidate,
      revisionUrl: `/__storybook/revisions/%40fixture%2Fcomponents/${candidate}/`,
      loadRuntime: null, storyLoaders: new Map(), environment,
    })
    try {
      sockets[0]!.emit("open", {})
      sockets[0]!.emit("message", {data: JSON.stringify({type: "package.applied-state", packageId: "@fixture/components", revision: "older-applied"})})
      expect(location.reloads).toBe(0)
      expect(controller.shell.workbench.controller.read("status").detail).toContain("Кандидат готов; ожидание проверки и применения")
      sockets[0]!.emit("close", {})
      expect(controller.shell.workbench.controller.read("status").detail).toContain("ожидание восстановления")
      const deadline = Date.now() + 3_000
      while (sockets.length < 2 && Date.now() < deadline) await Bun.sleep(20)
      expect(renewed).toBe(1)
      expect(sockets).toHaveLength(2)
      sockets[1]!.emit("open", {})
      const restored = Date.now() + 3_000
      while (!controller.shell.workbench.controller.read("status").detail.includes("Готов к запуску") && Date.now() < restored) {
        await Bun.sleep(10)
      }
      expect(controller.shell.workbench.controller.read("status").detail).toContain("Готов к запуску")
      sockets[1]!.emit("message", {data: JSON.stringify({type: "package.applied-state", packageId: "@fixture/components", revision: "new-applied"})})
      expect(location.reloads).toBe(0)
      expect(location.href).toContain(`preview=${candidate}`)
      sockets[1]!.emit("message", {data: JSON.stringify({type: "package.updated", packageId: "@fixture/components", revision: "new-applied"})})
      expect(location.href).toContain(`preview=${candidate}`)
      sockets[1]!.emit("message", {data: JSON.stringify({type: "package.updated", packageId: "@fixture/components", revision: candidate})})
      expect(location.href).not.toContain("preview=")
    } finally {
      await controller.dispose()
    }
    sockets.at(-1)!.emit("close", {})
    await Bun.sleep(300)
    expect(renewed).toBe(1)
  })

  test("applies an executable revision in the same page and restores the working revision after a failed mount", async () => {
    const sourceGraph = await fixtureGraph()
    const packageId = "@fixture/components"
    const packageNode = sourceGraph.nodes.find(node => node.kind === "package" && node.packageId === packageId)!
    const generatedRevisionGraph = createStorybookPackageRevisionGraphSnapshot(
      sourceGraph,
      packageId,
      packageNode.digest,
    )
    const withoutAuthorStyles = {
      ...generatedRevisionGraph,
      authorStyleSheets: Object.freeze([]),
      workbenchAuthorStyleSheets: Object.freeze([]),
    }
    const {packageGraphDigest: _digest, ...digestInput} = withoutAuthorStyles
    const revisionGraph = Object.freeze({
      ...withoutAuthorStyles,
      packageGraphDigest: sha256Hex(JSON.stringify(digestInput)),
    })
    const initialRevision = "revision-page-a"
    const nextRevision = "revision-page-b"
    const automaticRevision = "revision-page-automatic"
    const hostMismatchRevision = "revision-page-host-mismatch"
    const failedRevision = "revision-page-failed"
    const navigation = createExternalStorybookClientSnapshot(
      sourceGraph,
      packageSnapshots(sourceGraph, initialRevision),
    )
    const route = "components/button/basic/contained"
    const socket = new FakeSocket()
    const rootState = createFakeRootState()
    const environment = environmentFixture(navigation, `/pkg-fixture-components/${route}`)
    const revisionUrl = `/__storybook/revisions/%40fixture%2Fcomponents/${initialRevision}/`
    const browserLocation = environment.location as LocationFixture
    browserLocation.href += "?inspector=diagnostics"
    const history = environment.history as ReturnType<typeof historyFixture>
    const canvas = {} as HTMLCanvasElement

    const storyLoaders = (label: string) => new Map(revisionGraph.loaders.map(({route}) => [
      route,
      async () => ({label}),
    ] as const))
    const widgetLoaders = () => new Map(revisionGraph.widgetLoaders.map(({id}) => [
      id,
      async () => ({}),
    ] as const))
    const runtimeLoader = (label: string, fail = false) => async () => ({
      protocol: STORYBOOK_RUNTIME_PROTOCOL,
      create(context: StorybookRuntimeContext) {
        return {
          mount(input: StorybookRuntimeStoryInput) {
            if (fail) throw new Error(`${label} mount failed`)
            const node = context.document.createElement("section")
            node.textContent = `${label}:${input.route}`
            context.present({
              protocol: "story-presentation/1",
              node,
              componentRoot: {readStyleSheets: () => ({revision: 0, styleSheets: []})},
              source: {html: `<section>${label}</section>`, typescript: `<Story label=${JSON.stringify(label)} />`},
            })
          },
          unmount() {},
          dispose() {},
        }
      },
    })
    const applied = new Map([
      [nextRevision, {label: "next", fail: false, hostModuleEpoch: "fixture-host-epoch"}],
      [automaticRevision, {label: "automatic", fail: false, hostModuleEpoch: "fixture-host-epoch"}],
      [hostMismatchRevision, {label: "host-change", fail: false, hostModuleEpoch: "changed-host-epoch"}],
      [failedRevision, {label: "broken", fail: true, hostModuleEpoch: "fixture-host-epoch"}],
    ] as const)
    const controller = await startExternalStorybookPackage({
      packageId,
      candidateRevision: initialRevision,
      revisionUrl,
      sharedModuleEpoch: "a".repeat(64),
      hostModuleEpoch: "fixture-host-epoch",
      graphSnapshot: revisionGraph,
      loadRuntime: runtimeLoader("initial"),
      storyLoaders: storyLoaders("initial"),
      widgetLoaders: widgetLoaders(),
      environment: {
        ...environment,
        createSocket: () => socket,
        shell: {
          canvas,
          loadFont: async () => ({}) as never,
          createRoot: fakeRootFactory(rootState),
        },
        async loadAppliedRevision(revision) {
          const value = applied.get(revision as typeof nextRevision | typeof automaticRevision | typeof hostMismatchRevision | typeof failedRevision)
          if (value === undefined) throw new Error(`Unknown applied revision: ${revision}`)
          return {
            protocol: STORYBOOK_PAGE_REALM_PROTOCOL,
            packageId,
            candidateRevision: revision,
            revisionUrl: `/__storybook/revisions/%40fixture%2Fcomponents/${revision}/`,
            sharedModuleEpoch: "a".repeat(64),
            hostModuleEpoch: value.hostModuleEpoch,
            graphSnapshot: revisionGraph,
            loadRuntime: runtimeLoader(value.label, value.fail),
            storyLoaders: storyLoaders(value.label),
            widgetLoaders: widgetLoaders(),
          }
        },
      },
    })
    try {
      const root = controller.shell.root
      const document = controller.shell.document
      const progress = {
        type: "build.progress",
        operationId: "status-build",
        packageId,
        generation: 1,
        owner: "watch",
        state: "running",
        phase: "bundle",
        at: new Date().toISOString(),
      }
      socket.emit("message", {data: JSON.stringify(progress)})
      expect(controller.shell.workbench.controller.read("status").detail).toContain("Компиляция интерфейса")
      for (const type of ["catalog.progress", "shared.cache-progress"]) {
        socket.emit("message", {data: JSON.stringify({type, state: type === "catalog.progress" ? "running" : "started"})})
        socket.emit("message", {data: JSON.stringify({type, state: "completed", hit: true})})
        expect(controller.shell.workbench.controller.read("status").detail).toContain("Компиляция интерфейса")
      }
      socket.emit("message", {data: JSON.stringify({...progress, packageId: null, owner: "shared", state: "completed", outcome: "failed"})})
      expect(controller.shell.workbench.controller.read("status").detail).toContain("Ошибка обработки")
      const presentation = controller.shell.workbench.controller.read("presentation").node as unknown as {scrollTop: number}
      presentation.scrollTop = 73
      controller.shell.workbench.elements.catalogItems.scrollTop = 96
      const bridge = (globalThis as typeof globalThis & {
        __EXTERNAL_STORYBOOK_AGENT_BRIDGE__: {
          call(method: "applyRevision", params: unknown): Promise<any>
        }
      }).__EXTERNAL_STORYBOOK_AGENT_BRIDGE__
      const next = await bridge.call("applyRevision", {
        expectedPackageId: packageId,
        revision: nextRevision,
      })

      expect(next.revision).toBe(nextRevision)
      expect(next.route).toBe(route)
      expect(controller.shell.root).toBe(root)
      expect(controller.shell.document).toBe(document)
      expect(controller.shell.canvas).toBe(canvas)
      expect(rootState.creations).toBe(1)
      expect(browserLocation.reloads).toBe(0)
      expect(browserLocation.pathname).toBe(`/pkg-fixture-components/${route}`)
      expect(new URL(browserLocation.href).searchParams.get("inspector")).toBe("diagnostics")
      expect(controller.shell.workbench.controller.selectedInspector()).toBe("diagnostics")
      expect(controller.shell.workbench.elements.catalogItems.scrollTop).toBe(96)
      expect((controller.shell.workbench.controller.read("presentation").node as unknown as {scrollTop: number}).scrollTop).toBe(73)
      expect(controller.shell.workbench.controller.read("presentation").node?.textContent).toContain("next")

      socket.emit("message", {data: JSON.stringify({type: "package.updated", packageId, revision: nextRevision})})
      socket.emit("message", {data: JSON.stringify({
        type: "package.applied-state",
        packageId,
        revision: automaticRevision,
      })})
      const automaticDeadline = Date.now() + 3_000
      while ((environment.browserDocument as any).documentElement.dataset.externalStorybookRevision !== automaticRevision &&
        Date.now() < automaticDeadline) await Bun.sleep(10)
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookRevision)
        .toBe(automaticRevision)
      expect(controller.shell.workbench.controller.read("presentation").node?.textContent).toContain("automatic")
      expect(controller.shell.root).toBe(root)
      expect(browserLocation.reloads).toBe(0)

      await expect(bridge.call("applyRevision", {
        expectedPackageId: packageId,
        revision: hostMismatchRevision,
      })).rejects.toThrow("host module epoch changed; page restart is required")
      expect(controller.shell.root).toBe(root)
      expect(controller.shell.document).toBe(document)
      expect(controller.shell.canvas).toBe(canvas)
      expect(rootState.creations).toBe(1)
      expect(browserLocation.reloads).toBe(0)
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookRevision)
        .toBe(automaticRevision)
      expect(controller.shell.workbench.controller.read("presentation").node?.textContent).toContain("automatic")

      await expect(bridge.call("applyRevision", {
        expectedPackageId: packageId,
        revision: failedRevision,
      })).rejects.toThrow("broken mount failed")
      expect(controller.shell.root).toBe(root)
      expect(controller.shell.document).toBe(document)
      expect(controller.shell.canvas).toBe(canvas)
      expect(rootState.creations).toBe(1)
      expect(browserLocation.reloads).toBe(0)
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookRevision)
        .toBe(automaticRevision)
      expect(controller.shell.workbench.controller.read("presentation").node?.textContent).toContain("automatic")
      expect(history.pushed).toEqual([])
    } finally {
      await controller.dispose()
    }
  })

  test("switches package scopes across host updates and rolls back inside one page Root", async () => {
    const sourceGraph = await fixtureGraph()
    const packageGraph = (packageId: string) => withoutAuthorStyleSheets(
      createStorybookPackageRevisionGraphSnapshot(
        sourceGraph,
        packageId,
        sourceGraph.nodes.find(node => node.kind === "package" && node.packageId === packageId)!.digest,
      ),
    )
    const componentsGraph = packageGraph("@fixture/components")
    const standaloneGraph = packageGraph("@fixture/standalone")
    const initialRevision = "page-components"
    const styleRevision = "page-standalone-style"
    const standaloneRevision = "revision-good"
    const failedRevision = "page-components-failed"
    const snapshot = createExternalStorybookClientSnapshot(
      sourceGraph,
      packageSnapshots(sourceGraph, initialRevision),
    )
    const environment = environmentFixture(
      snapshot,
      "/pkg-fixture-components/components/button/basic/contained",
    )
    const location = environment.location as LocationFixture
    const history = environment.history as ReturnType<typeof historyFixture>
    const rootState = createFakeRootState()
    const sockets: FakeSocket[] = []
    const runtimeLoader = (label: string, fail = false) => async () => ({
      protocol: STORYBOOK_RUNTIME_PROTOCOL,
      create(context: StorybookRuntimeContext) {
        return {
          mount(input: StorybookRuntimeStoryInput) {
            if (fail) throw new Error(`${label} package failed`)
            const node = context.document.createElement("article")
            node.textContent = `${label}:${input.route}`
            context.present({
              protocol: "story-presentation/1",
              node,
              componentRoot: {readStyleSheets: () => ({revision: 0, styleSheets: []})},
              source: {html: `<article>${label}</article>`, typescript: `<Story label=${JSON.stringify(label)} />`},
            })
          },
          unmount() {},
          dispose() {},
        }
      },
    })
    const componentLoaders = (label: string) => new Map(componentsGraph.loaders.map(({route}) => [
      route,
      async () => ({label}),
    ] as const))
    const componentWidgets = () => new Map(componentsGraph.widgetLoaders.map(({id}) => [id, async () => ({})] as const))
    const payload = (
      packageId: string,
      revision: string,
      graphSnapshot: StorybookPackageRevisionGraphSnapshot,
      loadRuntime: ReturnType<typeof runtimeLoader> | null,
      storyLoaders: ReadonlyMap<string, () => Promise<unknown>>,
    ) => ({
      protocol: STORYBOOK_PAGE_REALM_PROTOCOL,
      packageId,
      candidateRevision: revision,
      revisionUrl: `/__storybook/revisions/${encodeURIComponent(packageId)}/${revision}/`,
      sharedModuleEpoch: "a".repeat(64),
      hostModuleEpoch: "host-page",
      graphSnapshot,
      loadRuntime,
      storyLoaders,
      widgetLoaders: packageId === "@fixture/components" ? componentWidgets() : new Map(),
    } as const)
    const initialPayload = payload(
      "@fixture/components",
      initialRevision,
      componentsGraph,
      runtimeLoader("components"),
      componentLoaders("components"),
    )
    const standaloneStyleSheet = Object.freeze({
      specifier: "@fixture/standalone/theme.css",
      url: "author-style-sheets/0.css",
      contentDigest: "c".repeat(64),
    })
    const standaloneStyleWithoutDigest = {
      ...standaloneGraph,
      authorStyleSheets: Object.freeze([standaloneStyleSheet]),
    }
    const {packageGraphDigest: _standaloneDigest, ...standaloneStyleDigestInput} = standaloneStyleWithoutDigest
    const standaloneStyleGraph = Object.freeze({
      ...standaloneStyleWithoutDigest,
      packageGraphDigest: sha256Hex(JSON.stringify(standaloneStyleDigestInput)),
    })
    const styleBase = payload(
      "@fixture/standalone",
      styleRevision,
      standaloneStyleGraph,
      null,
      new Map(),
    )
    const standaloneBase = payload(
      "@fixture/standalone",
      standaloneRevision,
      standaloneGraph,
      null,
      new Map(),
    )
    let hostStarts = 0
    const nextHost = async (input: Parameters<typeof startExternalStorybookPackage>[0]) => {
      hostStarts += 1
      return startExternalStorybookPackage(input)
    }
    const stylePayload = {...styleBase, hostModuleEpoch: "host-styles", startPackage: nextHost}
    const standalonePayload = {...standaloneBase, hostModuleEpoch: "host-next", startPackage: nextHost}
    let compatibility: "valid" | "kernel" | "missing-host" = "valid"
    const failedPayload = payload(
      "@fixture/components",
      failedRevision,
      componentsGraph,
      runtimeLoader("broken", true),
      componentLoaders("broken"),
    )
    const target = (
      packageId: string,
      revision: string,
      route: string,
    ): ExternalStorybookPreparedPackageTarget => ({
      kind: "revision",
      packageId,
      revision,
      revisionUrl: `/__storybook/revisions/${encodeURIComponent(packageId)}/${revision}/`,
      route,
      urlPath: packageId === "@fixture/standalone"
        ? "/pkg-fixture-standalone/"
        : `/pkg-fixture-components/${route}`,
      intent: "reader",
      preview: false,
      initialAppliedRevision: revision,
      fallbackRevision: null,
      readerToken: `${packageId}:${revision}`,
    })
    const initialTarget = target(
      "@fixture/components",
      initialRevision,
      "components/button/basic/contained",
    )
    let failComponents = false
    const controller = await startExternalStorybookPage({
      initialTarget,
      initialPayload,
      sharedModuleEpoch: "a".repeat(64),
      hostModuleEpoch: "host-page",
      browserDocument: environment.browserDocument!,
      location,
      history,
      fetcher: (async (input, init) => {
        if (String(input) === "/api/client") return Response.json(snapshot)
        if (String(input) === "/api/browser/session") return Response.json({token: `renewed-${String(init?.body).length}`})
        return new Response(`# ${String(input)}`)
      }) as typeof fetch,
      createSocket() {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      shell: {
        canvas: {} as HTMLCanvasElement,
        loadFont: async () => ({}) as never,
        createRoot: fakeRootFactory(rootState),
      },
      async prepareTarget(input) {
        if (input.packageId === null) {
          return {kind: "landing", pathname: input.route || "/", readerToken: "landing-reader"}
        }
        if (input.packageId === "@fixture/standalone") {
          return target("@fixture/standalone", input.requestedRevision ?? standaloneRevision, "")
        }
        if (input.packageId === "@fixture/components") {
          return target(
            "@fixture/components",
            failComponents ? failedRevision : initialRevision,
            input.route,
          )
        }
        throw new Error("Unknown page target")
      },
      async loadAppliedRevision(packageId, revision) {
        if (packageId === "@fixture/standalone" && revision === standaloneRevision) {
          if (compatibility === "kernel") return {...standalonePayload, sharedModuleEpoch: "b".repeat(64)}
          if (compatibility === "missing-host") {
            const {startPackage, ...missingHost} = standalonePayload
            return missingHost
          }
          return standalonePayload
        }
        if (packageId === "@fixture/components" && revision === failedRevision) return failedPayload
        if (packageId === "@fixture/standalone" && revision === styleRevision) return stylePayload
        if (packageId === "@fixture/components" && revision === initialRevision) return initialPayload
        throw new Error("Unknown page payload")
      },
    })
    try {
      const root = controller.shell.root
      const document = controller.shell.document
      const canvas = controller.shell.canvas
      controller.shell.document.subscribeMutations(batch => {
        for (const record of batch.records) {
          if (record.type !== "childList") continue
          for (const node of record.addedNodes) {
            if ((node as {localName?: string}).localName === "link") {
              queueMicrotask(() => node.dispatchEvent(new SemanticEvent("load")))
            }
          }
        }
      })
      expect(controller.packageId).toBe("@fixture/components")
      expect(controller.shell.workbench.controller.read("presentation").node?.textContent)
        .toContain("components")
      controller.shell.workbench.elements.catalogItems.scrollTop = 144
      const sourceButton = controller.shell.workbench.elements.inspectorHost.querySelector(
        'button[title="Исходники"]',
      ) as HTMLButtonElement
      sourceButton.click()
      expect(new URL(location.href).searchParams.get("inspector")).toBe("source")
      const pageBridge = (globalThis as typeof globalThis & {
        __EXTERNAL_STORYBOOK_AGENT_BRIDGE__: {
          call(method: "identity" | "applyRevision", params?: unknown): Promise<any>
        }
      }).__EXTERNAL_STORYBOOK_AGENT_BRIDGE__

      compatibility = "kernel"
      await expect(controller.navigatePackage({packageId: "@fixture/standalone", route: ""}))
        .rejects.toThrow("page module epoch changed")
      compatibility = "missing-host"
      await expect(controller.navigatePackage({packageId: "@fixture/standalone", route: ""}))
        .rejects.toThrow("without a compatible package controller")
      expect(controller.packageId).toBe("@fixture/components")
      expect(hostStarts).toBe(0)
      compatibility = "valid"
      await controller.navigatePackage({packageId: "@fixture/standalone", route: ""})
      expect(hostStarts).toBe(1)
      expect(controller.packageId).toBe("@fixture/standalone")
      expect(controller.shell.root).toBe(root)
      expect(controller.shell.document).toBe(document)
      expect(controller.shell.canvas).toBe(canvas)
      expect(rootState.creations).toBe(1)
      expect(location.reloads).toBe(0)
      expect(location.pathname).toBe("/pkg-fixture-standalone/")
      expect((environment.browserDocument as any).title).toBe("Standalone Fixture")
      expect(controller.shell.workbench.element.getAttribute("aria-label")).toBe("Standalone Fixture")
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookPackageId)
        .toBe("@fixture/standalone")
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookLanding)
        .toBeUndefined()
      expect(controller.shell.workbench.controller.read("presentation").node?.textContent)
        .toContain("/__storybook/revisions/")
      expect(controller.shell.workbench.elements.catalogItems.scrollTop).toBe(144)
      expect(new URL(location.href).searchParams.has("inspector")).toBeFalse()
      await pageBridge.call("applyRevision", {
        expectedPackageId: "@fixture/standalone",
        revision: styleRevision,
      })
      expect(controller.packageId).toBe("@fixture/standalone")
      expect(controller.shell.root).toBe(root)
      expect(rootState.creations).toBe(1)
      expect(hostStarts).toBe(2)
      expect(controller.shell.document.querySelectorAll('link[data-external-storybook-package-style]'))
        .toHaveLength(1)
      expect(await pageBridge.call("identity")).toMatchObject({
        packageId: "@fixture/standalone",
        revision: styleRevision,
      })

      await controller.navigateLanding()
      expect(controller.packageId).toBeNull()
      expect(controller.shell.root).toBe(root)
      expect(rootState.creations).toBe(1)
      expect(location.pathname).toBe("/")
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookLanding)
        .toBe("ready")
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookPackageId)
        .toBeUndefined()

      await controller.navigatePackage({packageId: "@fixture/standalone", route: ""})
      expect(controller.packageId).toBe("@fixture/standalone")
      expect(controller.shell.root).toBe(root)
      expect(rootState.creations).toBe(1)
      expect(location.pathname).toBe("/pkg-fixture-standalone/")

      location.href = "http://localhost/pkg-fixture-components/components/button/basic/contained?inspector=source"
      location.pathname = "/pkg-fixture-components/components/button/basic/contained"
      globalThis.dispatchEvent(new globalThis.Event("popstate"))
      const backDeadline = Date.now() + 3_000
      while (controller.packageId !== "@fixture/components" && Date.now() < backDeadline) await Bun.sleep(10)
      expect(controller.packageId).toBe("@fixture/components")
      expect(new URL(location.href).searchParams.get("inspector")).toBe("source")
      expect(controller.shell.workbench.controller.selectedInspector()).toBe("source")

      await controller.navigatePackage({packageId: "@fixture/standalone", route: ""})
      failComponents = true
      location.href = "http://localhost/pkg-fixture-components/components/button/basic/contained?inspector=source"
      location.pathname = "/pkg-fixture-components/components/button/basic/contained"
      globalThis.dispatchEvent(new globalThis.Event("popstate"))
      const failedBackDeadline = Date.now() + 3_000
      while (location.pathname !== "/pkg-fixture-standalone/" && Date.now() < failedBackDeadline) await Bun.sleep(10)
      expect(controller.packageId).toBe("@fixture/standalone")
      expect(controller.shell.root).toBe(root)
      expect(controller.shell.document).toBe(document)
      expect(controller.shell.canvas).toBe(canvas)
      expect(rootState.creations).toBe(1)
      expect(location.reloads).toBe(0)
      expect(location.pathname).toBe("/pkg-fixture-standalone/")
      expect(history.pushed).toEqual([
        "/pkg-fixture-components/components/button/basic/contained?inspector=source",
        "/pkg-fixture-standalone/",
        "/",
        "/pkg-fixture-standalone/",
        "/pkg-fixture-standalone/",
      ])
      const bridge = (globalThis as typeof globalThis & {
        __EXTERNAL_STORYBOOK_AGENT_BRIDGE__: {call(method: "identity"): Promise<any>}
      }).__EXTERNAL_STORYBOOK_AGENT_BRIDGE__
      expect(await bridge.call("identity")).toMatchObject({
        packageId: "@fixture/standalone",
        revision: standaloneRevision,
      })
    } finally {
      await controller.dispose()
    }
    expect(rootState.disposals).toBe(1)
    expect(sockets.filter(socket => socket.closed).length).toBeGreaterThan(0)
  })

  test("keeps a mixed Display/HUD category as an overview without remapping its children", async () => {
    const graph = await fixtureGraph()
    const base = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-mixed"))
    const subject = base.nodes.find(({id}) => id === "subject:@fixture/components/components/button")!
    const variant = base.nodes.find(({id}) => id === "variant:@fixture/components/components/button/contained")!
    const hudSubjectId = "subject:@fixture/components/components/hud-button"
    const hudVariantId = "variant:@fixture/components/components/hud-button/contained"
    const presentation = {...subject.presentation!, projection: "hud" as const}
    const snapshot = {
      ...base,
      nodes: [
        ...base.nodes.map(node => node.id === subject.parentId
          ? {...node, childIds: [...node.childIds, hudSubjectId]}
          : node),
        {
          ...subject,
          id: hudSubjectId,
          childIds: [hudVariantId],
          routePath: "components/hud-button",
          urlPath: "/pkg-fixture-components/components/hud-button",
          presentation,
        },
        {
          ...variant,
          id: hudVariantId,
          parentId: hudSubjectId,
          routePath: "components/hud-button/contained",
          urlPath: "/pkg-fixture-components/components/hud-button/contained",
          presentation,
        },
      ],
    }
    let runtimeLoads = 0
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components",
      candidateRevision: "revision-mixed",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-mixed/",
      async loadRuntime() {
        runtimeLoads += 1
        throw new Error("Mixed projection overview must not execute child runtimes")
      },
      storyLoaders: new Map(),
      environment: environmentFixture(snapshot, "/pkg-fixture-components/components"),
    })
    try {
      expect(runtimeLoads).toBe(0)
      expect(controller.currentRoute).toBe("components")
      expect(controller.shell.workbench.controller.read("secondary.active")).toBe("category:@fixture/components/components")
      expect(controller.shell.document.querySelectorAll("[data-storybook-aggregate-overview]"))
        .toHaveLength(0)
    } finally {
      await controller.dispose()
    }
  })

  test("binds only exact revision-declared native author links before readiness", async () => {
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
    const experienceState = createFakeRootState(lifecycle)
    const location = locationFixture("/pkg-fixture-components/")
    const packageTransitions: Array<Readonly<{packageId: string; route: string}>> = []
    const landingTransitions: string[] = []
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
        fetcher: (async (input: RequestInfo | URL) => String(input) === "/api/client"
          ? Response.json(createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, revision)))
          : new Response("# UI Components")) as unknown as typeof fetch,
        createSocket: () => new FakeSocket(),
        async navigatePackage(input) { packageTransitions.push(input) },
        async navigateLanding(pathname) { landingTransitions.push(pathname) },
        shell: {
          canvas: {} as HTMLCanvasElement,
          loadFont: async () => ({}) as never,
          createRoot: fakeRootFactory(experienceState),
        },
      },
    })

    expect(browserDocument.documentElement.dataset.externalStorybookPhase).toBe("ready")
    expect(experienceState.stylesheets.map(({id}) => id)).toEqual(
      revisionGraph.authorStyleSheets.map(({specifier}) => specifier),
    )
    expect(experienceState.stylesheets.map(({link}) => link)).toEqual([...links.values()])
    expect(lifecycle[0]).toBe("root-create")
    expect(controller.shell.workbench.controller.read("status").breadcrumbs?.map(({label}) => label)).toEqual([
      "Главная",
      "Fixture Workspace",
      "Fixture Alpha",
      "Fixture Components",
    ])
    const workspaceBreadcrumb = controller.shell.workbench.elements.status.querySelector(
      '[data-breadcrumb-id="package:fixture-workspace"] button',
    ) as import("@zavx0z/dom").HTMLButtonElement
    workspaceBreadcrumb.click()
    expect(packageTransitions).toEqual([{packageId: "fixture-workspace", route: ""}])
    expect(location.href).toBe("http://localhost/pkg-fixture-components/")
    const homeBreadcrumb = controller.shell.workbench.elements.status.querySelector(
      '[data-breadcrumb-id="storybook:root"] button',
    ) as import("@zavx0z/dom").HTMLButtonElement
    expect(homeBreadcrumb.textContent).toBe("")
    expect(homeBreadcrumb.getAttribute("aria-label")).toBe("Главная")
    expect(homeBreadcrumb.querySelector("img")).not.toBeNull()
    homeBreadcrumb.click()
    expect(landingTransitions).toEqual(["/"])
    expect(location.href).toBe("http://localhost/pkg-fixture-components/")
    await controller.dispose()
    expect(lifecycle.at(-1)).toBe("root-dispose")
  })

  test("navigates a directory in the existing package Root without creating a story runtime", async () => {
    const graph = await fixtureGraph()
    const directory = graph.nodes.find(node => node.kind === "directory" && node.packageId === "@fixture/components")!
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, "revision-a"))
    const environment = environmentFixture(snapshot, "/pkg-fixture-components/")
    let runtimeLoads = 0
    const controller = await startExternalStorybookPackage({
      packageId: "@fixture/components", candidateRevision: "revision-a",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-a/",
      loadRuntime: async () => { runtimeLoads += 1; throw new Error("Directory must not load runtime") },
      storyLoaders: new Map(), environment,
    })
    const document = controller.shell.document
    await controller.navigate(directory.routePath!)
    expect(controller.shell.document).toBe(document)
    expect(controller.currentRoute).toBe(directory.routePath!)
    expect(controller.shell.workbench.controller.read("secondary.active")).toBe(directory.id)
    expect(runtimeLoads).toBe(0)
    expect(controller.shell.workbench.controller.read("status").breadcrumbs?.at(-1)?.label).toBe(directory.label)
    await controller.dispose()
  })

  test("materializes real overview children without selecting their representative routes", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-a"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const dataset: Record<string, string> = {}
    const browserDocument = {documentElement: {dataset}} as unknown as globalThis.Document
    const browserLocation = locationFixture("/pkg-fixture-components/")
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
                expect(node.ownerDocument).toBe(ownerContext.document)
                expect(node.closest("display")).toBeInstanceOf(DisplayElement)
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
        fetcher: (async (input: RequestInfo | URL) => String(input) === "/api/client"
          ? Response.json(snapshot)
          : new Response("# Owner README")) as typeof fetch,
        createSocket(url) {
          socket.url = url
          return socket
        },
        shell: {
          canvas: {} as HTMLCanvasElement,
          loadFont: async () => ({}) as never,
          createRoot: fakeRootFactory(experienceState),
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
      .toBe("package:@fixture/components")
    expect(controller.shell.workbench.controller.read("secondary.label")).toBe("Fixture Components")
    expect(controller.shell.workbench.controller.read("secondary.active")).toBe("category:@fixture/components/components")
    expect(controller.shell.workbench.controller.read("tabs.active")).toBeNull()
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
    expect((controller.shell.workbench.elements.inspectorHost.querySelector(
      '[data-widget-kind="props"] input[data-text-field-value]',
    ) as import("@zavx0z/dom").HTMLInputElement | null)?.value).toBe("Contained")

    await controller.navigate("components/button")
    expect(controller.shell.workbench.controller.read("catalog.active"))
      .toBe("package:@fixture/components")
    expect(controller.shell.workbench.controller.read("secondary.active"))
      .toBe("subject:@fixture/components/components/button")
    expect(controller.shell.workbench.controller.read("tabs.active")).toBeNull()
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
    const diagnosticsCategory = controller.shell.workbench.elements.inspectorHost.querySelector(
      'button[title="Диагностика"]',
    ) as import("@zavx0z/dom").HTMLButtonElement
    diagnosticsCategory.click()
    expect(controller.shell.workbench.elements.inspectorHost.textContent).toContain("owner-ready")
    expect(controller.shell.workbench.controller.read("status").breadcrumbs?.map(({label}) => label)).toEqual([
      "Главная",
      "Fixture Workspace",
      "Fixture Alpha",
      "Fixture Components",
      "Components",
      "Button",
      "Contained",
    ])
    const outlinedTab = controller.shell.workbench.elements.tabItems.querySelector('button[aria-label="Outlined"]') as HTMLButtonElement
    outlinedTab.click()
    const tabDeadline = Date.now() + 5000
    while ((controller.currentRoute !== "components/button/outlined" || dataset.externalStorybookPackage !== "ready") && Date.now() < tabDeadline) await Bun.sleep(10)
    expect(browserLocation.pathname).toBe("/pkg-fixture-components/components/button/outlined")
    expect(runtimeLoads).toBe(1)
    expect(containedLoads).toBe(3)
    expect(outlinedLoads).toBe(2)
    expect(mounts).toBe(5)
    expect(controller.shell.workbench.controller.read("tabs.active"))
      .toBe("variant:@fixture/components/components/button/outlined")

    const selectedSubject = controller.shell.workbench.elements.secondary.querySelector('[data-id="subject:@fixture/components/components/button"] button') as HTMLButtonElement
    selectedSubject.click()
    const overviewDeadline = Date.now() + 5000
    while ((controller.currentRoute !== "components/button" || dataset.externalStorybookPackage !== "ready") && Date.now() < overviewDeadline) await Bun.sleep(10)
    expect(browserLocation.pathname).toBe("/pkg-fixture-components/components/button")
    expect(controller.shell.workbench.controller.read("tabs.active")).toBeNull()
    const restoredOverview = controller.shell.workbench.controller.read("presentation").node
    expect((restoredOverview as Element | null)?.querySelectorAll("[data-storybook-aggregate-item]"))
      .toHaveLength(2)
    expect(restoredOverview?.textContent).toContain("Contained")
    expect(restoredOverview?.textContent).toContain("Outlined")
    expect(history.pushed).toEqual([
      "/pkg-fixture-components/components",
      "/pkg-fixture-components/components/button",
      "/pkg-fixture-components/components/button/basic/contained",
      "/pkg-fixture-components/components/button/basic/contained?inspector=diagnostics",
      "/pkg-fixture-components/components/button/outlined",
      "/pkg-fixture-components/components/button",
    ])
    const beforeUnknown = [...history.pushed]
    await expect(controller.navigate("missing")).rejects.toThrow("Unknown external Storybook route")
    expect(history.pushed).toEqual(beforeUnknown)
    expect(controller.currentRoute).toBe("components/button")

    socket.emit("open", {})
    expect(socket.sent).toEqual([JSON.stringify({type: "subscribe", topic: "package:@fixture/components"}), JSON.stringify({type: "subscribe", topic: "catalog"})])
    const pathnameBeforeUpdate = browserLocation.pathname
    socket.emit("message", {data: JSON.stringify({type: "package.built", packageId: "@fixture/components", revision: "not-applied"})})
    expect(browserLocation.reloads).toBe(0)
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
    expect(browserLocation.reloads).toBe(0)
    expect(browserLocation.pathname).toBe(pathnameBeforeUpdate)
    const aggregateDiagnostics = controller.shell.workbench.elements.inspectorHost.querySelector(
      'button[title="Диагностика"]',
    ) as HTMLButtonElement
    aggregateDiagnostics.click()
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
      "/pkg-fixture-components/components/button/basic/contained",
    )
    const experienceState = createFakeRootState()
    const environment: ExternalStorybookPackageEnvironment = {
      ...baseEnvironment,
      shell: {
        ...(baseEnvironment.shell ?? {}),
        canvas: {} as HTMLCanvasElement,
        loadFont: async () => ({}) as never,
        createRoot: fakeRootFactory(experienceState),
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
                  source: {html: "<section></section>", typescript: "<space />"},
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
      environment: environmentFixture(snapshot, "/pkg-fixture-standalone/"),
    })).rejects.toThrow("Unknown or ambiguous external Storybook package path")
    await expect(startExternalStorybookPackage({
      ...base,
      candidateRevision: "revision-other",
      revisionUrl: "/__storybook/revisions/%40fixture%2Fcomponents/revision-other/",
      environment: environmentFixture(snapshot, "/pkg-fixture-components/"),
    })).rejects.toThrow("revision is not active or last-good")
  })

  test("reports a required author link failure before module entry", async () => {
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
      "/pkg-fixture-components/",
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
      },
    })).rejects.toThrow("failed before package entry")
    expect(browserDocument.documentElement.dataset.externalStorybookError)
      .toContain("Required Storybook author stylesheet failed before package entry")
  })

  test("unmounts a partially mounted root when runtime/4 atomic source provenance fails", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-missing-provenance"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const environment = environmentFixture(
      snapshot,
      "/pkg-fixture-components/components/button/basic/contained",
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
        "/pkg-fixture-components/components/button/basic/contained",
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

  test("reports create, session, mount and first-frame failures as non-working", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-a"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    for (const failure of ["create", "session", "mount", "frame"] as const) {
      const baseEnvironment = environmentFixture(
        snapshot,
        "/pkg-fixture-components/components/button/basic/contained",
      )
      let invalidDispose = 0
      const experienceState = createFakeRootState()
      if (failure === "frame") experienceState.failRenderAt = 2
      const environment: ExternalStorybookPackageEnvironment = {
        ...baseEnvironment,
        shell: {
          ...(baseEnvironment.shell ?? {}),
          createRoot: fakeRootFactory(experienceState),
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
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookError.length, failure).toBeGreaterThan(0)
      expect((environment.browserDocument as any).documentElement.dataset.externalStorybookPackage).toBe("error")
      await controller.dispose()
      if (failure === "session") expect(invalidDispose).toBe(1)
    }
  })

  test("keeps a failed candidate visible for agent inspection without publishing from the browser", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-a"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const environment = environmentFixture(
      snapshot,
      "/pkg-fixture-components/components/button/basic/contained",
    )
    const browserDocument = environment.browserDocument as unknown as {
      querySelector(selector: string): {content: string} | null
    }
    browserDocument.querySelector = (selector) => {
      if (selector.includes("browser-session")) return {content: "a".repeat(43)}
      if (selector.includes("fallback-revision")) return {content: "revision-working"}
      return null
    }
    const posts: string[] = []
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      if (init?.method === "POST") posts.push(String(input))
      return Response.json(snapshot)
    }) as typeof fetch
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
    expect((environment.location as LocationFixture).reloads).toBe(0)
    expect(posts).toEqual([])
    await controller.dispose()
  })

  test("aborts a hung candidate without reloading the page when no in-page fallback loader exists", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-timeout"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const environment = environmentFixture(
      snapshot,
      "/pkg-fixture-components/components/button/basic/contained",
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
    const controller = await pending
    expect((environment.location as LocationFixture).reloads).toBe(0)
    const rejectedDeadline = Date.now() + 1_000
    while (!(environment.browserDocument as any).documentElement.dataset.externalStorybookUpdateError &&
      Date.now() < rejectedDeadline) await Bun.sleep(10)
    expect((environment.browserDocument as any).documentElement.dataset.externalStorybookUpdateError)
      .toContain("identity-safe applied revision loader")
    await controller.dispose()
    expect(socket.closed).toBeTrue()
  })

  test("serializes rapid runtime routes and disposes a session created after cancellation", async () => {
    const graph = await fixtureGraph()
    const candidate = "revision-a"
    const snapshot = createExternalStorybookClientSnapshot(graph, packageSnapshots(graph, candidate))
    const environment = environmentFixture(snapshot, "/pkg-fixture-components/")
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
        ...environmentFixture(snapshot, "/pkg-fixture-components/components/button/basic/contained"),
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
        ...environmentFixture(snapshot, "/pkg-fixture-components/components/button/basic/contained"),
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

function withoutAuthorStyleSheets(
  graph: StorybookPackageRevisionGraphSnapshot,
): StorybookPackageRevisionGraphSnapshot {
  const withoutStyles = {
    ...graph,
    authorStyleSheets: Object.freeze([]),
    workbenchAuthorStyleSheets: Object.freeze([]),
  }
  const {packageGraphDigest: _digest, ...digestInput} = withoutStyles
  return Object.freeze({
    ...withoutStyles,
    packageGraphDigest: sha256Hex(JSON.stringify(digestInput)),
  })
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
