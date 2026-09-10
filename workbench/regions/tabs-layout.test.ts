import {beforeAll, expect, test} from "bun:test"
import {createDocument, CustomEvent, KeyboardEvent, type HTMLButtonElement} from "@zavx0z/dom"
import {createDocumentRenderer} from "@renderer/html"
import {WORKBENCH_EVENTS, type WorkbenchTabItem} from "../contract.ts"
import {loadCompiledWorkbench} from "../../src/workbench/testing/compile-workbench.ts"

let api: Awaited<ReturnType<typeof loadCompiledWorkbench>>
const theme = await Bun.file(new URL(import.meta.resolve("@zavx0z/ui/themes/theme.css"))).text()

beforeAll(async () => { api = await loadCompiledWorkbench() }, 30_000)

for (const projection of ["display", "hud", "space"] as const) {
  test(`[TABS-SPACING] ${projection}: вкладки примыкают к Preview при разной ширине`, () => {
    for (const width of [1280, 960]) {
      const document = createDocument()
      const workbench = api.createWorkbench({
        document,
        parent: document,
        initial: {
          presentation: {node: null, projection},
          "tabs.items": [
            {id: "basic", label: "Обычная", route: "button/basic"},
            {id: "disabled", label: "Недоступная", route: "button/disabled", disabled: true},
          ],
          "tabs.active": "basic",
        },
      })
      const renderer = createDocumentRenderer({
        document,
        root: workbench.element,
        viewport: {width, height: 720},
        styleSheets: [theme],
      })
      try {
        const boxes = renderer.flush().boxByNode
        const strip = boxes.get(workbench.elements.tabs)!
        const preview = boxes.get(workbench.elements.preview)!
        const row = boxes.get(workbench.elements.tabItems)!
        const buttons = [...workbench.elements.tabItems.querySelectorAll("button")]
        const first = boxes.get(buttons[0]!)!
        const second = boxes.get(buttons[1]!)!
        expect(strip.y + strip.height).toBe(preview.y)
        expect(first.y + first.height).toBe(preview.y)
        expect(second.y + second.height).toBe(preview.y)
        expect(first.x).toBe(row.x)
        expect(row.x).toBe(preview.x)
        expect(row.width).toBe(preview.width)
        expect(row.padding).toEqual({top: 2, right: 0, bottom: 0, left: 0})
        expect(first.height).toBe(22)
        expect(first.padding).toEqual({top: 2, right: 6, bottom: 2, left: 6})
        expect(second.x - first.x - first.width).toBe(2)
        expect(strip.height).toBe(first.height + row.padding.top)

        // Меняется только граница вкладок и Preview; остальные интервалы Workbench сохранены.
        const body = boxes.get(workbench.elements.body)!
        const catalog = boxes.get(workbench.elements.catalog)!
        const secondary = boxes.get(workbench.elements.secondary)!
        const inspector = boxes.get(workbench.elements.inspectorHost)!
        const status = boxes.get(workbench.elements.status)!
        expect(body.padding).toEqual({top: 4, right: 4, bottom: 4, left: 4})
        expect(secondary.x - catalog.x - catalog.width).toBe(4)
        expect(strip.x - secondary.x - secondary.width).toBe(4)
        expect(inspector.x - strip.x - strip.width).toBe(4)
        expect(status.y - preview.y - preview.height).toBe(4)
      } finally {
        renderer.dispose()
        workbench.dispose()
      }
      expect(document.childNodes).toHaveLength(0)
    }
  })
}

test("[TABS-EVENTS] выбор передаёт адрес; disabled, фокус и клавиши сохраняют контракт Button", () => {
  const document = createDocument()
  const items = [
    {id: "basic", label: "Обычная", route: "button/basic"},
    {id: "other", label: "Другая", route: "button/other", title: "Открыть другую"},
    {id: "disabled", label: "Недоступная", route: "button/disabled", disabled: true},
  ] satisfies readonly WorkbenchTabItem[]
  const workbench = api.createWorkbench({
    document,
    parent: document,
    initial: {"tabs.items": items, "tabs.active": "basic"},
  })
  try {
    const buttons = [...workbench.elements.tabItems.querySelectorAll("button")] as HTMLButtonElement[]
    const [first, other, disabled] = buttons
    const selections: unknown[] = []
    const keys: string[] = []
    workbench.element.addEventListener(WORKBENCH_EVENTS.tab, event => {
      selections.push((event as CustomEvent).detail)
    })
    workbench.element.addEventListener("keydown", event => {
      keys.push((event as KeyboardEvent).key)
    })
    expect(first!.getAttribute("aria-pressed")).toBe("true")
    expect(other!.title).toBe("Открыть другую")
    expect(other!.tabIndex).toBe(0)
    other!.focus()
    expect(document.activeElement).toBe(other!)
    const key = new KeyboardEvent("keydown", {key: "Enter", bubbles: true, cancelable: true})
    other!.dispatchEvent(key)
    expect(keys).toEqual(["Enter"])
    expect(key.defaultPrevented).toBe(false)
    other!.click()
    expect(workbench.controller.read("tabs.active")).toBe("other")
    expect(other!.getAttribute("aria-pressed")).toBe("true")
    expect(first!.getAttribute("aria-pressed")).toBe("false")
    expect(selections).toEqual([{id: "other", route: "button/other"}])
    disabled!.click()
    expect(disabled!.disabled).toBe(true)
    expect(selections).toHaveLength(1)
    expect(workbench.controller.read("tabs.active")).toBe("other")

    workbench.update("tabs.items", items.map(item => item.id === "other"
      ? {...item, route: "button/updated", label: "Обновлённая"}
      : item))
    expect([...workbench.elements.tabItems.querySelectorAll("button")]).toEqual(buttons)
    expect(document.activeElement).toBe(other!)
    other!.click()
    expect(selections[1]).toEqual({id: "other", route: "button/updated"})
    expect(() => workbench.update("tabs.active", "missing")).toThrow()
    workbench.update("tabs.items", [items[0]!])
    expect(workbench.controller.read("tabs.active")).toBeNull()
    expect(workbench.elements.tabItems.querySelector("button")).toBe(first!)
  } finally {
    workbench.dispose()
  }
})

test("[TABS-ADDRESSES] каждая вкладка требует route и уникальный id", () => {
  const document = createDocument()
  const workbench = api.createWorkbench({document, parent: document})
  try {
    expect(() => {
      // @ts-expect-error Адрес вкладки обязателен также в публичном TypeScript API.
      workbench.update("tabs.items", [{id: "missing", label: "Без адреса"}])
    }).toThrow("Адрес вкладки must be a string")
    expect(workbench.controller.read("tabs.items")).toEqual([])
    expect(() => workbench.update("tabs.items", [
      {id: "duplicate", label: "Первая", route: "one"},
      {id: "duplicate", label: "Вторая", route: "two"},
    ])).toThrow("Повторный идентификатор вкладки")
  } finally {
    workbench.dispose()
  }
})
