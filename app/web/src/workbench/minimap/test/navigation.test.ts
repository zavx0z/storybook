import {expect, test} from "bun:test"
import {createRoot} from "@zavx0z/component"
import {createDocument, CustomEvent, type HTMLDivElement} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {createWorkbenchModel} from "../../controller.ts"
import {WORKBENCH_EVENTS} from "../../contract.ts"
import {WorkbenchView, type WorkbenchViewProps} from "../../view.tsx"

test("HUD обновляет общую модель и доставляет события существующим подписчикам Workbench", () => {
  const document = createDocument()
  const display = document.createElement("div")
  const hud = document.createElement("div")
  const root = document.createElement("div")
  document.append(root)
  root.append(display, hud)
  const item = {id: "component", label: "Компонент", route: "/component"}
  const model = createWorkbenchModel({document, initial: {"catalog.items": [item]}})
  const component = createRoot(display)
  component.render(WorkbenchView as unknown as CompiledTemplate<WorkbenchViewProps>, model.getSnapshot())
  const workbench = model.bind(display.firstElementChild as HTMLDivElement)
  const seen: unknown[] = []
  const unsubscribe = model.subscribe(() => seen.push(model.getSnapshot().state["catalog.active"]))
  const events: unknown[] = []
  for (const name of [WORKBENCH_EVENTS.navigate, WORKBENCH_EVENTS.search, WORKBENCH_EVENTS.catalogAction, WORKBENCH_EVENTS.groupToggle]) {
    workbench.element.addEventListener(name, event => events.push([name, (event as CustomEvent).detail]))
  }
  try {
    const view = model.getSnapshot()
    const source = hud as unknown as HTMLElement
    view.onCatalogNavigate(item, source)
    view.onCatalogSearch("Компонент", source)
    view.onCatalogAction({action: "attach"}, source)
    view.onGroupToggle({id: "project", label: "Проект"}, true, source)
    expect(workbench.controller.read("catalog.active")).toBe("component")
    expect(workbench.controller.read("catalog.search")).toBe("Компонент")
    expect(seen).toEqual(["component", "component"])
    expect(events).toEqual([
      [WORKBENCH_EVENTS.navigate, {kind: "catalog", id: "component", route: "/component"}],
      [WORKBENCH_EVENTS.search, {value: "Компонент"}],
      [WORKBENCH_EVENTS.catalogAction, {action: "attach"}],
      [WORKBENCH_EVENTS.groupToggle, {kind: "catalog", id: "project", collapsed: true}],
    ])
  } finally {
    unsubscribe()
    component.unmount()
    model.dispose()
  }
})
