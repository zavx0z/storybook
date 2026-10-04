import {expect, test} from "bun:test"
import {createRoot} from "@immersive/component"
import {createDocument, MouseEvent, KeyboardEvent} from "@immersive/dom"
import {createSpaceElementFactories} from "@immersive/space"
import type {CompiledTemplate} from "@immersive/template/compiled"
import Workbench, {type StorybookAppWebPageShellWorkbench} from "../index"
type WorkbenchProps = StorybookAppWebPageShellWorkbench.Input
import {selectWorkbenchNavigationBranch} from "../src/navigation/branch.ts"
import type {WorkbenchNavigationItem} from "../src/types"

const items: readonly WorkbenchNavigationItem[] = [
  {id: "repo", label: "Проект", route: "/repo"},
  {id: "package", parentId: "repo", label: "Пакет", route: "/repo/package"},
  {id: "component", parentId: "package", label: "Компонент", route: "/repo/package/component"},
  {id: "child", parentId: "component", label: "Часть", route: "/repo/package/component/child"},
  {id: "sibling", parentId: "package", label: "Сосед", route: "/repo/package/component-other"},
  {id: "other", label: "Другой проект", route: "/other"},
]

test("ветка следует parentId, сохраняет порядок и не меняет полный каталог", () => {
  const branch = selectWorkbenchNavigationBranch(items, "component")
  expect(branch).toEqual([
    {id: "component", label: "Компонент", route: "/repo/package/component"},
    items[3]!,
  ])
  expect(branch[1]).toBe(items[3])
  expect(items[2]!.parentId).toBe("package")
  expect(selectWorkbenchNavigationBranch(items, null)).toBe(items)
  expect(selectWorkbenchNavigationBranch(items, "missing")).toEqual([])
  expect(selectWorkbenchNavigationBranch(items, "child")).toEqual([
    {id: "child", label: "Часть", route: "/repo/package/component/child"},
  ])
})

test("ветка не зависит от порядка родителей и снимает внешнюю группу корня", () => {
  expect(selectWorkbenchNavigationBranch([...items].reverse(), "package").map(item => item.id))
    .toEqual(["sibling", "child", "component", "package"])
  expect(selectWorkbenchNavigationBranch([
    {id: "leaf", label: "Лист", route: "/leaf", group: {id: "group", label: "Группа"}},
  ], "leaf")).toEqual([{id: "leaf", label: "Лист", route: "/leaf"}])
})

test("Ветка следует адресу, но клики и поиск Minimap не меняют её состав", () => {
  const document = createDocument({elementFactories: createSpaceElementFactories()})
  const space = document.createElement("space")
  const display = document.createElement("display")
  const hud = document.createElement("hud")
  display.id = "display"
  hud.id = "hud"
  document.append(space)
  space.append(display, hud)
  const component = createRoot(display)
  let workbench: StorybookAppWebPageShellWorkbench.Output | undefined
  const rows = () => [...display.querySelectorAll("[data-tree-id]")]
    .filter(node => node.closest("[hidden]") === null)
    .map(node => node.getAttribute("data-tree-id"))
  try {
    component.render(Workbench as unknown as CompiledTemplate<WorkbenchProps>, {
      initial: {"catalog.items": items, "catalog.active": "package"},
      displayId: "display", hudId: "hud", onReady: handle => { workbench = handle },
    })
    component.flush()
    expect(rows()).toEqual(["package", "component", "child", "sibling"])
    const fullCatalog = workbench!.getSnapshot().state["catalog.items"]
    const navigations: unknown[] = []
    workbench!.element.addEventListener(workbench!.events.navigate, event => navigations.push(event))
    const leaf = display.querySelector('[data-tree-id="sibling"]')!
    leaf.querySelector('[data-tree-row]')!.dispatchEvent(new MouseEvent("click", {bubbles: true}))
    leaf.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}))
    component.flush()
    expect(navigations).toEqual([])
    expect(workbench!.controller.read("catalog.active")).toBe("package")
    expect(workbench!.getSnapshot().state["catalog.items"]).toBe(fullCatalog)
    expect(rows()).toEqual(["package", "component", "child", "sibling"])
    const toolbar = workbench!.elements.catalog.querySelector('[data-storybook-part="catalog-search"]')!
    expect([...toolbar.querySelectorAll("button")].map(button => button.getAttribute("aria-label")))
      .toEqual(["Развернуть всё дерево", "Свернуть всё дерево"])
    expect(workbench!.elements.catalog.querySelector('input[type="search"]')).toBeNull()
    workbench!.update("catalog.active", "component")
    component.flush()
    expect(rows()).toEqual(["component", "child"])
    expect(workbench!.getSnapshot().state["catalog.items"]).toBe(fullCatalog)
    expect(fullCatalog.map(item => item.id)).toEqual(items.map(item => item.id))
    workbench!.update("catalog.search", "Сосед")
    component.flush()
    expect(rows()).toEqual(["component", "child"])
    workbench!.update("catalog.search", "")
    workbench!.update("catalog.active", "child")
    component.flush()
    expect(rows()).toEqual(["child"])
    workbench!.update("catalog.active", "package")
    component.flush()
    expect(rows()).toEqual(["package", "component", "child", "sibling"])
    workbench!.update("catalog.active", null)
    component.flush()
    expect(rows()).toEqual(["repo", "package", "component", "child", "sibling", "other"])
  } finally {
    component.unmount()
  }
})
