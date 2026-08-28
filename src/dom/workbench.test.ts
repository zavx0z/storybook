import {describe, expect, test} from "bun:test"
import {createDocument, CustomEvent, Event, type HTMLButtonElement} from "@zavx0z/dom"
import {
  createStorybookDomWorkbench,
  STORYBOOK_DOM_WORKBENCH_EVENTS,
  storybookDomWorkbenchCss,
} from "./workbench.ts"

describe("DOM-native Storybook Workbench", () => {
  test("creates the complete semantic shell with standard title and aria metadata", () => {
    const document = createDocument()
    const inspector = document.createElement("aside")
    inspector.setAttribute("aria-label", "Props")
    const workbench = createStorybookDomWorkbench({
      document,
      parent: document,
      initial: {
        title: "UI Storybook",
        "preview.label": "Кнопка Output",
        "inspector.node": inspector,
        status: {lead: "Создано для ", owner: "MetaFor", detail: " · WebXR UI"},
      },
    })

    expect(document.documentElement).toBe(workbench.element)
    expect(workbench.element.title).toBe("")
    expect(workbench.element.getAttribute("aria-label")).toBe("UI Storybook")
    expect(workbench.element.getAttribute("role")).toBe("application")
    expect(workbench.elements.catalog.localName).toBe("nav")
    expect(workbench.elements.catalogSearch.localName).toBe("input")
    expect(workbench.elements.catalogSearch.type).toBe("search")
    expect(workbench.elements.secondary.localName).toBe("nav")
    expect(workbench.elements.preview.localName).toBe("main")
    expect(workbench.elements.previewHost.getAttribute("role")).toBe("region")
    expect(workbench.elements.scenarios.getAttribute("role")).toBe("toolbar")
    expect(workbench.elements.inspectorHost.localName).toBe("div")
    expect(workbench.elements.inspectorHost.firstChild).toBe(inspector)
    expect(workbench.elements.status.getAttribute("role")).toBe("status")
    expect(workbench.elements.status.getAttribute("aria-label")).toBe(
      "Создано для MetaFor · WebXR UI",
    )
  })

  test("updates addressed state while preserving shell and keyed item identity", () => {
    const document = createDocument()
    const workbench = createStorybookDomWorkbench({document, parent: document})
    const shell = {...workbench.elements}
    const items = [
      {id: "button", label: "Кнопка", route: "components/button", title: "Открыть Button"},
      {id: "input", label: "Поле", route: "components/input"},
    ] as const
    workbench.update("catalog.items", items)
    workbench.update("catalog.active", "button")
    const button = workbench.elements.catalogItems.children[0] as HTMLButtonElement
    const input = workbench.elements.catalogItems.children[1] as HTMLButtonElement

    expect(button.getAttribute("aria-current")).toBe("page")
    expect(button.title).toBe("Открыть Button")
    expect(workbench.controller.read("catalog.active")).toBe("button")

    workbench.update("catalog.items", [
      {...items[1], label: "Поле ввода"},
      {...items[0], label: "Button"},
    ])
    expect(workbench.elements.catalogItems.children).toEqual([input, button])
    expect(button.textContent).toBe("Button")
    expect(input.textContent).toBe("Поле ввода")
    for (const [key, node] of Object.entries(shell)) {
      expect(workbench.elements[key as keyof typeof shell], key).toBe(node)
    }

    const preview = document.createElement("button")
    preview.title = "Подсказка Output"
    workbench.update("preview.node", preview)
    expect(workbench.elements.previewHost.firstChild).toBe(preview)
    workbench.update("preview.node", preview)
    expect(workbench.elements.previewHost.childNodes).toEqual([preview])

    const foreign = createDocument().createElement("div")
    expect(() => workbench.update("preview.node", foreign)).toThrow("another Document")
    expect(() => workbench.update("inspector.node", foreign)).toThrow("another Document")
  })

  test("uses native click/input dispatch and emits bubbling semantic events", () => {
    const document = createDocument()
    const workbench = createStorybookDomWorkbench({document, parent: document})
    workbench.update("catalog.items", [
      {id: "button", label: "Кнопка", route: "components/button"},
      {id: "input", label: "Поле", route: "components/input"},
    ])
    workbench.update("scenarios.items", [{id: "hover", label: "Hover"}])

    const events: Array<Readonly<{type: string; detail: unknown}>> = []
    for (const type of Object.values(STORYBOOK_DOM_WORKBENCH_EVENTS)) {
      workbench.element.addEventListener(type, (event) => {
        events.push({type, detail: (event as CustomEvent).detail})
      })
    }

    const button = workbench.elements.catalogItems.children[0] as HTMLButtonElement
    button.click()
    expect(workbench.controller.read("catalog.active")).toBe("button")
    expect(events[0]).toEqual({
      type: "storybooknavigate",
      detail: {kind: "catalog", id: "button", route: "components/button"},
    })

    workbench.elements.catalogSearch.value = "поле"
    workbench.elements.catalogSearch.dispatchEvent(new Event("input", {bubbles: true}))
    expect(workbench.controller.read("catalog.search")).toBe("поле")
    expect(button.getAttribute("style")).toBe("display: none")
    expect((workbench.elements.catalogItems.children[1] as HTMLButtonElement).getAttribute("style")).toBe(
      "display: block",
    )
    expect(events[1]).toEqual({type: "storybooksearch", detail: {value: "поле"}})

    const scenario = workbench.elements.scenarioItems.firstChild as HTMLButtonElement
    scenario.click()
    expect(workbench.controller.read("scenarios.active")).toBe("hover")
    expect(events[2]).toEqual({type: "storybookscenario", detail: {id: "hover"}})

    workbench.dispose()
    expect(workbench.element.parentNode).toBeNull()
    expect(() => workbench.update("title", "Disposed")).toThrow("disposed")
  })

  test("exports one flat executable CSS sheet without renderer-specific drawing", () => {
    const rules = [...storybookDomWorkbenchCss.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    expect(rules.length).toBeGreaterThan(10)
    expect(storybookDomWorkbenchCss.match(/\{/gu)?.length).toBe(rules.length)
    expect(storybookDomWorkbenchCss.match(/\}/gu)?.length).toBe(rules.length)
    expect(storybookDomWorkbenchCss).not.toMatch(/[>+~]/u)

    const supportedProperties = new Set([
      "display",
      "box-sizing",
      "flex-direction",
      "width",
      "height",
      "min-height",
      "min-width",
      "flex",
      "flex-grow",
      "gap",
      "margin",
      "padding",
      "border",
      "border-top",
      "border-color",
      "border-radius",
      "background",
      "color",
      "font-size",
      "line-height",
      "opacity",
      "white-space",
      "align-items",
      "justify-content",
      "overflow",
    ])
    for (const rule of rules) {
      const declarations = rule[2] ?? ""
      for (const declaration of declarations.split(";").filter((entry) => entry.trim().length > 0)) {
        const property = declaration.split(":", 1)[0]?.trim() ?? ""
        expect(supportedProperties.has(property), property).toBeTrue()
      }
    }
  })

  test("keeps the compact editor fallback and measured StatusBar", () => {
    expect(storybookDomWorkbenchCss).toContain("height: 24px")
    expect(storybookDomWorkbenchCss).toContain("border-top: 2px solid #161616")
    expect(storybookDomWorkbenchCss).toContain("padding: 0 12px 0 8px")
    expect(storybookDomWorkbenchCss).toContain("font-size: 11px")
    expect(storybookDomWorkbenchCss).not.toMatch(/border-radius:\s*(?:999px|50%)/u)
  })
})
