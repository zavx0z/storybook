import {expect, test} from "bun:test"
import {createRoot} from "@zavx0z/component"
import {createDocument} from "@zavx0z/dom"
import {createSpaceElementFactories} from "@zavx0z/space"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {createWorkbenchModel} from "../controller.ts"
import {Workbench, type WorkbenchProps} from "../workbench.tsx"
import {selectWorkbenchNavigationBranch} from "./branch.ts"
import type {WorkbenchNavigationItem} from "./model.ts"

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

test("Display сужается при смене пути и поиске, модель для HUD сохраняет полный обзор", () => {
  const document = createDocument({elementFactories: createSpaceElementFactories()})
  const space = document.createElement("space")
  const display = document.createElement("display")
  const hud = document.createElement("hud")
  display.id = "display"
  hud.id = "hud"
  document.append(space)
  space.append(display, hud)
  const model = createWorkbenchModel({document, initial: {"catalog.items": items, "catalog.active": "package"}})
  const component = createRoot(display)
  let workbench: ReturnType<typeof model.bind> | undefined
  const rows = () => [...display.querySelectorAll("[data-tree-id]")]
    .filter(node => node.closest("[hidden]") === null)
    .map(node => node.getAttribute("data-tree-id"))
  try {
    component.render(Workbench as unknown as CompiledTemplate<WorkbenchProps>, {
      model, displayId: "display", hudId: "hud", onReady: handle => { workbench = handle },
    })
    component.flush()
    expect(rows()).toEqual(["package", "component", "child", "sibling"])
    const fullCatalog = model.getSnapshot().state["catalog.items"]
    workbench!.update("catalog.active", "component")
    component.flush()
    expect(rows()).toEqual(["component", "child"])
    expect(model.getSnapshot().state["catalog.items"]).toBe(fullCatalog)
    expect(fullCatalog.map(item => item.id)).toEqual(items.map(item => item.id))
    workbench!.update("catalog.search", "Сосед")
    component.flush()
    expect(rows()).toEqual([])
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
    model.dispose()
  }
})
