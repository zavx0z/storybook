import {afterAll, describe, expect, test} from "bun:test"
import type {WebWorkbench} from "@web/workbench"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {WorkbenchFrame} from "./fixture/frame"
import {createFrameEnvironment} from "./fixture/environment"

describe.each([
  {name: "Обзор", props: {title: "Обзор", "catalog.items": []}},
  {name: "Каталог", props: {title: "Каталог", "catalog.items": [{id: "example", label: "Пример", route: "/example"}]}},
])("$name", ({props}) => {
  const frame = createFrameEnvironment()
  let ready: WebWorkbench.Output | undefined
  frame.component.render(WorkbenchFrame as unknown as CompiledTemplate<WebWorkbench.Input>, {
    initial: props,
    displayId: "scenario-display",
    hudId: "scenario-hud",
    onReady(value) { ready = value },
  })
  frame.component.flush()
  afterAll(() => {
    frame.component.unmount()
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
    expect(ready!.getSnapshot().state["catalog.items"].map(item => item.id), "Обновление заголовка сохраняет переданный каталог").toEqual(props["catalog.items"].map(item => item.id))
  })

  test("Адресный Inspector принадлежит тому же Workbench", () => {
    ready!.configureInspector()
    ready!.setChatContext({address: "/example?view=source", label: "Пример"})
    expect(ready!.controller.read("inspector.registry").map(widget => widget.id),
      "Workbench задаёт чат и предметные секции в одном реестре").toEqual([
      "chat", "props", "source", "events", "diagnostics", "dom", "layout", "display", "reference",
    ])
    expect(ready!.controller.read("inspector.subject"),
      "Чат сохраняет канонический адрес без выбора представления").toEqual({
      subjectId: "/example", workspaceId: "/example", widgetIds: ["chat"],
    })
    ready!.present({
      label: "Исходник",
      presentation: {node: null, projection: "display"},
      inspectorSubject: {subjectId: "example", widgetIds: ["source"]},
      inspectorValues: {source: "text"},
      chat: {address: "/example?view=source", label: "Пример"},
    })
    expect(ready!.controller.read("inspector.subject")?.widgetIds,
      "Предметная секция остаётся рядом с чатом при согласованной публикации").toEqual(["chat", "source"])
    expect(ready!.events.navigate, "Страница подписывается на события конкретного Workbench").toBe("storybooknavigate")
  })

  test("Завершение сцены", () => {
    frame.component.unmount()
    ready!.dispose()
    expect(frame.container.childNodes, "Unmount освобождает авторскую сцену").toHaveLength(0)
    expect(() => ready!.controller.read("title"), "Завершённая модель отклоняет дальнейшее чтение состояния").toThrow("Workbench is disposed")
  })
})
