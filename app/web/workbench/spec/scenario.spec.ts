import {afterAll, describe, expect, test} from "bun:test"
import createWorkbenchModel, {type WebWorkbenchModel} from "@web/workbench-model"
import type {WebWorkbench} from "@web/workbench"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {WorkbenchFrame} from "./fixture/frame"
import {createFrameEnvironment} from "./fixture/environment"

describe.each([
  {name: "Обзор", props: {title: "Обзор", "catalog.items": []}},
  {name: "Каталог", props: {title: "Каталог", "catalog.items": [{id: "example", label: "Пример", route: "/example"}]}},
])("$name", ({props}) => {
  const frame = createFrameEnvironment()
  const model = createWorkbenchModel({document: frame.document, initial: props})
  let ready: ReturnType<WebWorkbenchModel.Output["bind"]> | undefined
  frame.component.render(WorkbenchFrame as unknown as CompiledTemplate<WebWorkbench.Input>, {
    model,
    displayId: "scenario-display",
    hudId: "scenario-hud",
    onReady(value) { ready = value },
  })
  frame.component.flush()
  afterAll(() => {
    frame.component.unmount()
    model.dispose()
  })

  test("Общий Document и Space", () => {
    expect(ready, "Публичный Workbench передаёт управление после монтажа").toBeDefined()
    expect(ready!.document, "Управление относится к тому Document, куда смонтирована сцена").toBe(frame.document)
    expect(ready!.element.parentElement, "Рабочая область находится в переданном Display").toBe(frame.document.getElementById("scenario-display"))
    expect(ready!.element.closest("space"), "Display и HUD принадлежат одному Space").toBe(frame.document.getElementById("scenario-hud")!.closest("space"))
    expect(frame.document.querySelectorAll("space"), "Сценарий сохраняет один Space").toHaveLength(1)
    expect(frame.document.querySelectorAll("viewpoint"), "Сцена сохраняет единственный ViewPoint").toHaveLength(1)
  })

  test("Обновление модели сохраняет рабочую область", () => {
    const element = ready!.element
    const space = element.closest("space")
    ready!.update("title", "Обновлённая область")
    frame.component.flush()
    expect(ready!.element, "Изменение данных сохраняет корневой semantic Element").toBe(element)
    expect(element.closest("space"), "Обновление не заменяет общий Space").toBe(space)
    expect(element.getAttribute("aria-label"), "Production JSX получает новый заголовок из публичной модели").toBe("Обновлённая область")
    expect(model.getSnapshot().state["catalog.items"].map(item => item.id), "Обновление заголовка сохраняет переданный каталог").toEqual(props["catalog.items"].map(item => item.id))
  })

  test("Завершение сцены", () => {
    frame.component.unmount()
    model.dispose()
    expect(frame.container.childNodes, "Unmount освобождает авторскую сцену").toHaveLength(0)
    expect(() => ready!.controller.read("title"), "Завершённая модель отклоняет дальнейшее чтение состояния").toThrow("Workbench is disposed")
  })
})
