import Minimap from "@web/minimap"
import {expect, test} from "bun:test"
import {createRoot} from "@zavx0z/component"
import {createDocument, MouseEvent, type Element} from "@zavx0z/dom"
import {flushDocumentLayoutObservers} from "@zavx0z/dom/geometry"
import {createDocumentInteractionController, createDocumentRenderer, hitTestProjection} from "@renderer/html"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import type {WebMinimap} from "@web/minimap"
type MinimapProps = WebMinimap.Input
type MinimapState = WebMinimap.Output
import {createMinimapPersistence} from "../src/minimap-persistence"

const initialLayout: MinimapState = {collapsed: false, geometry: {x: 8, y: 8, width: 300, height: 480}, tab: {edge: "left", offset: .5}}

const theme = await Bun.file(Bun.resolveSync("@zavx0z/ui/theme/theme.css", import.meta.dir)).text()

/** Новая сессия компонента использует настоящее дерево, layout, ввод и переданное хранилище. */
function mount(storage: () => Pick<Storage, "getItem" | "setItem">, width = 800, height = 600) {
  const document = createDocument()
  const root = document.createElement("div")
  root.setAttribute("style", `position:relative;width:${width}px;height:${height}px`)
  document.append(root)
  const component = createRoot(root)
  const persistence = createMinimapPersistence(storage)
  const props: MinimapProps = {
    projectName: "Fixture Project",
    initialState: persistence.initialState,
    onStateChange: persistence.save,
    catalog: {label: "Каталог", search: "", items: [{id: "item", label: "Пример", route: "/example"}], activeId: "item", management: null,
      onAction() {}, onNavigate() {}, onSearch() {}, onGroupToggle() {}},
  }
  component.render(Minimap as unknown as CompiledTemplate<MinimapProps>, props)
  const renderer = createDocumentRenderer({document, root, viewport: {width, height}, styleSheets: [theme]})
  const input = createDocumentInteractionController({document, hitTest: hitTestProjection})
  const flush = () => {
    for (let round = 0; round < 5; round++) {
      component.flush()
      renderer.flush()
      if (!flushDocumentLayoutObservers(document)) {
        component.flush()
        return renderer.flush()
      }
    }
    throw new Error("Minimap layout did not settle")
  }
  const button = (name: string) => root.querySelector(`button[aria-label="${name}"]`)!
  const point = (element: Element, pointerId: number) => {
    const box = flush().boxByNode.get(element)!
    return {clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerId, button: 0, buttons: 1}
  }
  flush()
  return {root, input, flush, point, button,
    click(name: string) {
      button(name).dispatchEvent(new MouseEvent("click", {bubbles: true}))
      return flush()
    },
    dispose() {
      input.dispose()
      component.unmount()
      renderer.dispose()
    },
  }
}

test("Minimap восстанавливает окно и Tab после новой сессии; drag записывается только при завершении", () => {
  let saved: string | null = null
  const writes: string[] = []
  const storage = () => ({getItem: () => saved, setItem: (key: string, value: string) => {
    writes.push(key)
    saved = value
  }})
  let host = mount(storage)
  try {
    expect(writes).toHaveLength(0)
    const title = host.root.querySelector("[data-window-title]")!
    const start = host.point(title, 1)
    let frame = host.flush()
    host.input.pointerDown(frame, start)
    host.input.pointerMove(frame, {...start, clientX: start.clientX + 40, clientY: start.clientY + 30})
    frame = host.flush()
    expect(writes).toHaveLength(0)
    host.input.pointerUp(frame, {...start, clientX: start.clientX + 40, clientY: start.clientY + 30})
    frame = host.flush()
    expect(writes).toHaveLength(1)

    const resize = host.point(host.root.querySelector('[data-window-resize="se"]')!, 2)
    host.input.pointerDown(frame, resize)
    host.input.pointerMove(frame, {...resize, clientX: resize.clientX + 40, clientY: resize.clientY + 20})
    frame = host.flush()
    expect(writes).toHaveLength(1)
    host.input.pointerUp(frame, {...resize, clientX: resize.clientX + 40, clientY: resize.clientY + 20})
    host.flush()
    expect(writes).toHaveLength(2)
    host.click("Скрыть Fixture Project")
    expect(writes).toHaveLength(3)

    const tab = host.root.querySelector("[data-tab]")!
    const tabStart = host.point(tab, 3)
    frame = host.flush()
    host.input.pointerDown(frame, tabStart)
    const tabEnd = {...tabStart, clientX: 790, clientY: 360}
    host.input.pointerMove(frame, tabEnd)
    frame = host.flush()
    expect(writes).toHaveLength(3)
    host.input.pointerUp(frame, tabEnd)
    host.flush()
    expect(writes).toEqual(Array(4).fill("storybook.minimap.v1"))
    const state = JSON.parse(saved!) as MinimapState
    expect(state.collapsed).toBeTrue()
    expect(state.geometry).toEqual({x: 48, y: 38, width: 340, height: 500})
    expect(state.tab.edge).toBe("right")
    expect(state.tab.offset).toBeGreaterThan(.5)

    host.dispose()
    host = mount(storage)
    const shell = host.root.querySelector("[data-window]")!
    expect(shell.hasAttribute("hidden")).toBeTrue()
    expect(host.root.querySelector("[data-tab]")!.getAttribute("data-edge")).toBe("right")
    expect(createMinimapPersistence(storage).initialState).toEqual(state)
    expect(writes).toHaveLength(4)
    host.click("Fixture Project")
    const box = host.flush().boxByNode.get(shell)!
    expect({x: box.x, y: box.y, width: box.width, height: box.height}).toEqual(state.geometry)
    expect(createMinimapPersistence(storage).initialState?.collapsed).toBeFalse()
  } finally { host.dispose() }
})

test("отмена перемещения окна и Tab не перезаписывает завершённое состояние", () => {
  const state = structuredClone(initialLayout)
  let saved = JSON.stringify(state)
  let writes = 0
  const storage = () => ({getItem: () => saved, setItem: (_key: string, value: string) => {
    writes++
    saved = value
  }})
  const host = mount(storage)
  try {
    const start = host.point(host.root.querySelector("[data-window-title]")!, 4)
    let frame = host.flush()
    host.input.pointerDown(frame, start)
    host.input.pointerMove(frame, {...start, clientX: start.clientX + 60})
    frame = host.flush()
    host.input.pointerCancel(frame, start)
    host.flush()
    expect(writes).toBe(0)
    expect(createMinimapPersistence(storage).initialState).toEqual(state)
    host.click("Скрыть Fixture Project")
    const before = saved
    const tabStart = host.point(host.root.querySelector("[data-tab]")!, 5)
    frame = host.flush()
    host.input.pointerDown(frame, tabStart)
    host.input.pointerMove(frame, {...tabStart, clientX: 790})
    frame = host.flush()
    host.input.pointerCancel(frame, tabStart)
    host.flush()
    expect(writes).toBe(1)
    expect(saved).toBe(before)
  } finally { host.dispose() }
})

test("восстановленное окно помещается в уменьшившуюся область", () => {
  const state: MinimapState = {collapsed: false, geometry: {x: 1000, y: 1000, width: 1200, height: 800}, tab: {edge: "bottom", offset: 1}}
  const host = mount(() => ({getItem: () => JSON.stringify(state), setItem() {}}), 300, 200)
  try {
    const box = host.flush().boxByNode.get(host.root.querySelector("[data-window]")!)!
    expect({x: box.x, y: box.y, width: box.width, height: box.height}).toEqual({x: 0, y: 0, width: 300, height: 200})
  } finally { host.dispose() }
})

test("повреждённое или недоступное хранилище сохраняет работоспособность Minimap", () => {
  const blocked = createMinimapPersistence(() => { throw new Error("Storage disabled") })
  expect(blocked.initialState).toBeUndefined()
  expect(() => blocked.save(initialLayout)).not.toThrow()
  const broken = createMinimapPersistence(() => ({getItem: () => "{", setItem() {}}))
  expect(broken.initialState).toBeUndefined()
  let saved: string | null = null
  const storage = () => ({getItem: () => saved ?? JSON.stringify({collapsed: true, geometry: {x: -10, y: "bad", width: 0, height: 200}, tab: {edge: "invalid", offset: 2}}), setItem: (_key: string, value: string) => { saved = value }})
  const host = mount(storage)
  try {
    expect(host.root.querySelector("[data-window]")!.hasAttribute("hidden")).toBeTrue()
    host.click("Fixture Project")
    expect(JSON.parse(saved!), "После действия Minimap сохраняет полный проверенный снимок").toEqual({collapsed: false, geometry: {x: 0, y: 8, width: 300, height: 200}, tab: {edge: "left", offset: 1}})
  } finally { host.dispose() }
})
