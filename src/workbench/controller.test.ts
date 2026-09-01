import {beforeAll, describe, expect, test} from "bun:test"
import {
  createDocument,
  CustomEvent,
  Event,
  type HTMLButtonElement,
  type HTMLInputElement,
  type HTMLElement,
} from "@zavx0z/dom"
import {createDocumentRenderer} from "@zavx0z/renderer"
import {isCompiledTemplate} from "@zavx0z/template/compiled"
import {uiIcons} from "@ui/components/icons"
import {
  WORKBENCH_EVENTS,
  WORKBENCH_LAYOUT_PROTOCOL,
  WORKBENCH_REGIONS,
  type Workbench,
} from "./contract.ts"
import type * as ControllerModule from "./controller.ts"
import {WORKBENCH_STANDARD_WIDGET_REGISTRY} from "./inspector/registry.ts"
import {loadCompiledWorkbench} from "./testing/compile-workbench.ts"

let api: typeof ControllerModule

beforeAll(async () => {
  api = await loadCompiledWorkbench()
}, 30_000)

describe("compiled Storybook Workbench", () => {
  test("creates one ComponentRoot, six exact regions and one production Inspector", () => {
    const document = createDocument()
    const workbench = api.createWorkbench({
      document,
      parent: document,
      initial: {
        title: "UI Storybook",
        "catalog.items": [{id: "button", label: "Button", route: "components/button"}],
        "preview.label": "Кнопка Output",
        status: {lead: "Создано для ", owner: "MetaFor", detail: " · WebXR UI"},
      },
    })

    expect(document.documentElement).toBe(workbench.element)
    expect(workbench.element.getAttribute("aria-label")).toBe("UI Storybook")
    expect(workbench.element.getAttribute("role")).toBe("application")
    expect(WORKBENCH_LAYOUT_PROTOCOL).toBe("workbench-layout/2")
    expect(Array.from(workbench.element.querySelectorAll("[data-storybook-region]")).map((element) =>
      element.getAttribute("data-storybook-region"))).toEqual([...WORKBENCH_REGIONS])
    expect(workbench.elements.catalog.localName).toBe("nav")
    expect(workbench.elements.secondary.localName).toBe("nav")
    expect(workbench.elements.preview.localName).toBe("main")
    expect(workbench.elements.scenarios.getAttribute("role")).toBe("toolbar")
    for (const [region, label] of [
      [workbench.elements.catalog, "Каталог"],
      [workbench.elements.secondary, "Разделы"],
      [workbench.elements.scenarios, "Сценарии"],
      [workbench.elements.preview, "Кнопка Output"],
    ] as const) {
      expect(region.getAttribute("aria-label")).toBe(label)
      expect(region.querySelector("header")).toBeNull()
    }
    expect(workbench.elements.previewHost.getAttribute("aria-label")).toBe("Кнопка Output")
    expect(workbench.elements.scenarios.textContent).toBe("")
    const status = workbench.elements.status.querySelector("footer") as HTMLElement | null
    expect(status?.getAttribute("role")).toBe("status")
    expect(status?.getAttribute("aria-label")).toBe(
      "Создано для MetaFor · WebXR UI",
    )
    expect(status?.textContent).toBe("Создано для MetaFor · WebXR UI")
    expect(workbench.elements.status.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(workbench.elements.status.querySelector('[data-status-item="workbench-status-owner"]')
      ?.getAttribute("data-highlighted")).toBe("true")
    const renderer = createDocumentRenderer({
      document,
      root: workbench.element,
      viewport: {width: 1_280, height: 720},
    })
    const layout = renderer.flush().boxByNode
    expect(layout.get(status!)).toMatchObject({width: 1_280, height: 24})
    const scenariosBox = layout.get(workbench.elements.scenarios)
    const previewBox = layout.get(workbench.elements.preview)
    expect(scenariosBox).toBeDefined()
    expect(previewBox).toBeDefined()
    expect((scenariosBox?.y ?? Infinity) + (scenariosBox?.height ?? Infinity))
      .toBeLessThanOrEqual(previewBox?.y ?? -Infinity)
    renderer.dispose()
    expect(workbench.element.querySelectorAll("aside")).toHaveLength(1)
    expect(workbench.elements.inspectorHost.querySelector("aside")?.getAttribute("aria-label"))
      .toBe("Инспектор")
    const inspectorSearch = workbench.elements.inspectorHost.querySelector(
      'input[type="search"]',
    ) as HTMLInputElement | null
    expect(inspectorSearch?.placeholder).toBe("Поиск…")
    expect(inspectorSearch?.parentElement?.parentElement?.querySelector("img")?.getAttribute("src"))
      .toBe(uiIcons.search)
    expect(workbench.componentRoot.readStyleSheets().styleSheets.length).toBeGreaterThan(0)
    const componentNames = new Set(workbench.componentRoot.readStyleSheets().styleSheets
      .flatMap(sheet => sheet.source?.kind === "authored-css" ? [sheet.source.componentName] : []))
    for (const name of ["WorkbenchView", "Pane", "Button", "TextField", "Inspector", "StatusBar"]) {
      expect(componentNames.has(name), name).toBeTrue()
    }
  })

  test("updates addressed component state while preserving shell and keyed item identities", () => {
    const document = createDocument()
    const workbench = api.createWorkbench({document, parent: document})
    const shell = {...workbench.elements}
    const items = [
      {id: "button", label: "Кнопка", route: "components/button", title: "Открыть Button"},
      {id: "input", label: "Поле", route: "components/input"},
    ] as const
    workbench.update("catalog.items", items)
    workbench.update("catalog.active", "button")
    const buttonRow = row(workbench, "button")
    const inputRow = row(workbench, "input")

    expect(buttonRow.getAttribute("aria-current")).toBe("page")
    expect(workbench.controller.read("catalog.active")).toBe("button")
    workbench.update("catalog.items", [
      {...items[1], label: "Поле ввода"},
      {...items[0], label: "Button"},
    ])

    expect(row(workbench, "button")).toBe(buttonRow)
    expect(row(workbench, "input")).toBe(inputRow)
    expect(buttonRow.textContent).toContain("Button")
    expect(inputRow.textContent).toContain("Поле ввода")
    for (const [key, node] of Object.entries(shell)) {
      expect(workbench.elements[key as keyof typeof shell], key).toBe(node)
    }
  })

  test("atomically reparents one presentation Node between display, HUD and world hosts", () => {
    const document = createDocument()
    const workbench = api.createWorkbench({document, parent: document})
    const presentation = document.createElement("button")
    presentation.textContent = "Output"
    const identity = presentation
    const subject = {packageId: "@fixture/components", subjectId: "button", widgetIds: ["props"]}

    workbench.present({
      label: "Button",
      presentation: {node: presentation, projection: "display"},
      inspectorSubject: subject,
      inspectorValues: {props: {disabled: false}},
    })
    expect(workbench.elements.displayHost.firstChild).toBe(identity)
    expect(workbench.controller.read("preview.label")).toBe("Button")

    workbench.present({
      label: "Button HUD",
      presentation: {node: presentation, projection: "hud"},
      inspectorSubject: subject,
      inspectorValues: {props: {disabled: false}},
    })
    expect(workbench.elements.displayHost.firstChild).toBeNull()
    expect(workbench.elements.hudHost.firstChild).toBe(identity)
    expect(presentation.ownerDocument).toBe(document)

    workbench.present({
      label: "Button world",
      presentation: {node: presentation, projection: "world"},
      inspectorSubject: subject,
      inspectorValues: {props: {disabled: false}},
    })
    expect(workbench.elements.hudHost.firstChild).toBeNull()
    expect(workbench.elements.worldHost.firstChild).toBe(identity)
    expect(workbench.element.getAttribute("data-storybook-world-preview")).toBe("true")
    expect(workbench.elements.body.getAttribute("data-world")).toBe("true")

    const foreign = createDocument().createElement("div")
    expect(() => workbench.present({
      label: "Foreign",
      presentation: {node: foreign, projection: "display"},
      inspectorSubject: subject,
      inspectorValues: {},
    })).toThrow("another Document")
    expect(workbench.elements.worldHost.firstChild).toBe(identity)
  })

  test("uses production Fields and emits bubbling semantic navigation events", () => {
    const document = createDocument()
    const workbench = api.createWorkbench({document, parent: document})
    workbench.update("catalog.items", [
      {id: "button", label: "Кнопка", route: "components/button"},
      {id: "input", label: "Поле", route: "components/input"},
    ])
    workbench.update("scenarios.items", [{id: "hover", label: "Hover"}])
    expect(workbench.elements.scenarios.textContent).toBe("Hover")
    expect(workbench.elements.scenarios.querySelector("header")).toBeNull()
    const events: Array<Readonly<{type: string; detail: unknown}>> = []
    for (const type of Object.values(WORKBENCH_EVENTS)) {
      workbench.element.addEventListener(type, event => {
        events.push({type, detail: (event as CustomEvent).detail})
      })
    }

    buttonIn(row(workbench, "button")).click()
    expect(workbench.controller.read("catalog.active")).toBe("button")
    expect(events[0]).toEqual({
      type: "storybooknavigate",
      detail: {kind: "catalog", id: "button", route: "components/button"},
    })

    const search = workbench.elements.catalogSearch as HTMLInputElement
    search.value = "поле"
    search.dispatchEvent(new Event("input", {bubbles: true}))
    expect(workbench.controller.read("catalog.search")).toBe("поле")
    expect(row(workbench, "button", false)).toBeNull()
    expect(row(workbench, "input").textContent).toContain("Поле")
    expect(events[1]).toEqual({type: "storybooksearch", detail: {value: "поле"}})

    const scenario = workbench.elements.scenarioItems.querySelector("button") as HTMLButtonElement
    scenario.click()
    expect(workbench.controller.read("scenarios.active")).toBe("hover")
    expect(events[2]).toEqual({type: "storybookscenario", detail: {id: "hover"}})
  })

  test("retains Inspector widget selection by package and subject across variants", () => {
    const document = createDocument()
    const workbench = api.createWorkbench({document, parent: document})
    const node = document.createElement("button")
    const subject = {
      packageId: "@fixture/components",
      subjectId: "button",
      widgetIds: ["props", "source", "diagnostics"],
    }
    const values = {
      props: {disabled: false},
      source: {
        html: "<button>Output</button>",
        css: {authorStyleSheets: [], componentStyleSheets: [{
          moduleId: "@fixture/components/button.tsx",
          componentName: "Button",
          cssText: "& { color: red; }",
        }]},
        typescript: "<Button />",
      },
      diagnostics: {},
    }
    workbench.present({
      label: "Button primary",
      presentation: {node, projection: "display"},
      inspectorSubject: subject,
      inspectorValues: values,
    })
    categoryButton(workbench, "Исходники").click()
    expect(categoryButton(workbench, "Исходники").getAttribute("aria-pressed")).toBe("true")
    expect(categoryButton(workbench, "Исходники").querySelector("img")?.getAttribute("src"))
      .toBe(uiIcons.language)
    expect(workbench.elements.inspectorHost.querySelector('[title="@fixture/components/button"] img')?.getAttribute("src"))
      .toBe(uiIcons.resource)
    expect(workbench.elements.inspectorHost.querySelector('[data-language-id="css"]')?.textContent)
      .toContain("color: red")
    const sourcePanel = inspectorPanel(workbench, "Исходники")
    const sourceToggle = sourcePanel.querySelector("header button") as HTMLButtonElement
    expect(sourcePanel.getAttribute("id")).toBeNull()
    expect(sourceToggle.getAttribute("aria-expanded")).toBe("true")
    sourceToggle.click()
    expect(sourceToggle.getAttribute("aria-expanded")).toBe("false")
    expect(document.getElementById(sourceToggle.getAttribute("aria-controls")!)?.hasAttribute("hidden"))
      .toBe(true)
    expect(new Set(workbench.componentRoot.readStyleSheets().styleSheets
      .flatMap(sheet => sheet.source?.kind === "authored-css" ? [sheet.source.componentName] : []))
      .has("Panel")).toBeTrue()

    workbench.present({
      label: "Button disabled",
      presentation: {node, projection: "display"},
      inspectorSubject: subject,
      inspectorValues: {...values, props: {disabled: true}},
    })
    expect(categoryButton(workbench, "Исходники").getAttribute("aria-pressed")).toBe("true")
    expect(inspectorPanel(workbench, "Исходники")).toBe(sourcePanel)
    expect(sourceToggle.getAttribute("aria-expanded")).toBe("false")

    workbench.present({
      label: "Checkbox",
      presentation: {node, projection: "display"},
      inspectorSubject: {packageId: "@fixture/components", subjectId: "checkbox", widgetIds: ["props"]},
      inspectorValues: {props: {checked: true}},
    })
    expect(categoryButton(workbench, "Параметры").getAttribute("aria-pressed")).toBe("true")

    workbench.present({
      label: "Button primary",
      presentation: {node, projection: "display"},
      inspectorSubject: subject,
      inspectorValues: values,
    })
    expect(categoryButton(workbench, "Исходники").getAttribute("aria-pressed")).toBe("true")
    const restoredSourcePanel = inspectorPanel(workbench, "Исходники")
    expect(restoredSourcePanel.querySelector("header button")?.getAttribute("aria-expanded"))
      .toBe("false")
  })

  test("mounts a governed custom widget with only its value", async () => {
    const {CustomWorkbenchWidget} = await import("./inspector/custom-widget.fixture.tsx")
    expect(isCompiledTemplate(CustomWorkbenchWidget)).toBeTrue()
    const document = createDocument()
    const registry = [...WORKBENCH_STANDARD_WIDGET_REGISTRY, {
      id: "metrics",
      kind: "custom" as const,
      label: "M",
      title: "Metrics",
      component: CustomWorkbenchWidget as never,
    }]
    const workbench = api.createWorkbench({
      document,
      parent: document,
      initial: {"inspector.registry": registry},
    })
    workbench.present({
      label: "Metrics",
      presentation: {node: document.createElement("div"), projection: "display"},
      inspectorSubject: {packageId: "@fixture/components", subjectId: "metrics", widgetIds: ["metrics"]},
      inspectorValues: {metrics: "42 fps"},
    })
    expect(workbench.elements.inspectorHost.querySelector("[data-custom-workbench-widget]")?.textContent)
      .toBe("42 fps")
    expect(workbench.element.querySelectorAll("aside")).toHaveLength(1)
  })

  test("contains no handwritten visible Workbench element construction or global chrome CSS", async () => {
    const controller = await Bun.file(new URL("./controller.ts", import.meta.url)).text()
    const view = await Bun.file(new URL("./view.tsx", import.meta.url)).text()
    const inspector = await Bun.file(new URL("./inspector/panel.tsx", import.meta.url)).text()
    const widgetPanel = await Bun.file(new URL("./inspector/widget-panel.tsx", import.meta.url)).text()
    const inspectorRegistry = await Bun.file(new URL("./inspector/registry.ts", import.meta.url)).text()
    const sourceWidget = await Bun.file(new URL("./inspector/source-widget.tsx", import.meta.url)).text()
    const navigation = await Bun.file(new URL("./navigation/tree.tsx", import.meta.url)).text()
    expect(controller).not.toContain("createElement(")
    expect(controller).not.toContain("StorybookDom")
    expect(inspector).toContain('from "@ui/components/inspector"')
    expect(inspector).not.toContain("InspectorSections")
    expect(widgetPanel).toContain('from "@ui/components/panel"')
    expect(widgetPanel).not.toContain("InspectorSection")
    expect(inspector).not.toContain("uiIcons")
    expect(inspectorRegistry).not.toContain("uiIcons")
    expect(sourceWidget).toContain('from "@ui/components/code-editor"')
    expect(view).not.toContain("createElement(")
    expect(navigation).not.toContain("createElement(")
  })
})

function row(
  workbench: Workbench,
  id: string,
  required?: true,
): HTMLElement
function row(
  workbench: Workbench,
  id: string,
  required: false,
): HTMLElement | null
function row(
  workbench: Workbench,
  id: string,
  required = true,
): HTMLElement | null {
  const value = [...workbench.elements.catalogItems.querySelectorAll("[data-id]")]
    .find(element => element.getAttribute("data-id") === id &&
      element.getAttribute("role") === "treeitem") ?? null
  if (required && value === null) throw new Error(`Missing catalog row: ${id}`)
  return value as HTMLElement | null
}

function buttonIn(element: ReturnType<typeof row>): HTMLButtonElement {
  const button = element?.querySelector("button") as HTMLButtonElement | null
  if (button === null) throw new Error("Navigation row has no production Button")
  return button
}

function categoryButton(
  workbench: Workbench,
  title: string,
): HTMLButtonElement {
  const button = [...workbench.elements.inspectorHost.querySelectorAll("button")]
    .find(candidate => candidate.getAttribute("aria-label") === title) as HTMLButtonElement | undefined
  if (button === undefined) throw new Error(`Missing Inspector category: ${title}`)
  return button
}

function inspectorPanel(
  workbench: Workbench,
  title: string,
): HTMLElement {
  const panel = [...workbench.elements.inspectorHost.querySelectorAll("[data-panel]")]
    .find(candidate => candidate.querySelector("header button")?.getAttribute("title") === title)
  if (panel === undefined) throw new Error(`Missing Inspector panel: ${title}`)
  return panel as HTMLElement
}
