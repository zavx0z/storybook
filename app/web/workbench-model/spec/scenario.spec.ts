import {afterAll, describe, expect, test} from "bun:test"
import createWorkbenchModel, {type WebWorkbenchModel} from "@web/workbench-model"
import type {WebWorkbench} from "@web/workbench"
import type {HTMLDivElement} from "@zavx0z/dom"
import type {CompiledTemplate} from "@zavx0z/template/compiled"
import {WorkbenchFrame} from "./fixture/frame"
import {createFrameEnvironment} from "./fixture/environment"

describe.each([
  {name: "Пустая область", props: {title: "Модель", "catalog.items": []}},
  {name: "Выбранный узел", props: {title: "Модель каталога", "catalog.items": [{id: "example", label: "Пример", route: "/example"}], "catalog.active": "example"}},
])("$name", ({props}) => {
  const frame = createFrameEnvironment()
  const model = createWorkbenchModel({document: frame.document, initial: props})
  const firstSnapshot = model.getSnapshot()
  let ready: ReturnType<WebWorkbenchModel.Output["bind"]> | undefined
  frame.component.render(WorkbenchFrame as unknown as CompiledTemplate<WebWorkbench.Input>, {
    model,
    displayId: "model-display",
    hudId: "model-hud",
    onReady(value) { ready = value },
  })
  frame.component.flush()
  afterAll(() => {
    frame.component.unmount()
    model.dispose()
  })

  test("Исходный снимок", () => {
    expect(firstSnapshot.document, "Factory использует переданный semantic Document").toBe(frame.document)
    expect(firstSnapshot.state.title, "Снимок отражает начальные данные выбранного варианта").toBe(props.title)
    expect(firstSnapshot.state["catalog.items"].map(item => item.id), "Порядок каталога соответствует публичному входу").toEqual(props["catalog.items"].map(item => item.id))
    expect(model.getSnapshot(), "Чтение без изменения возвращает тот же снимок").toBe(firstSnapshot)
  })

  test("Привязка и подписка", () => {
    const handle = model.bind(ready!.element as HTMLDivElement)
    const changes: string[] = []
    const unsubscribe = model.subscribe(() => changes.push(model.getSnapshot().state.title))
    try {
      expect(handle.document, "Bind возвращает управление узлами исходного Document").toBe(frame.document)
      expect(handle.element, "Bind использует уже смонтированный Workbench, сохраняя identity").toBe(ready!.element)
      handle.update("title", "Первое обновление")
      frame.component.flush()
      expect(changes, "Подписчик получает опубликованное изменение состояния").toEqual(["Первое обновление"])
      expect(model.getSnapshot(), "Изменение публикует новый снимок").not.toBe(firstSnapshot)
      expect(unsubscribe(), "Первая отписка удаляет наблюдателя").toBeTrue()
      handle.update("title", "После отписки")
      frame.component.flush()
      expect(changes, "Отписанный наблюдатель не получает следующие изменения").toEqual(["Первое обновление"])
      expect(unsubscribe(), "Повторная отписка сообщает, что наблюдатель уже удалён").toBeFalse()
    } finally {
      unsubscribe()
    }
  })

  test("Освобождение представления", () => {
    const node = frame.document.createElement("article")
    ready!.present({label: "Представление", presentation: {node, projection: "display"}, inspectorSubject: null, inspectorValues: {}})
    expect(node.parentNode, "Публикация размещает один semantic узел в Display Workbench").toBe(ready!.elements.displayHost)
    model.dispose()
    expect(node.parentNode, "Dispose удаляет принадлежащее модели содержимое").toBeNull()
    expect(frame.document.querySelectorAll("space"), "Модель не освобождает чужой Root или Space").toHaveLength(1)
    expect(() => ready!.update("title", "Позднее обновление"), "Завершённая модель отклоняет записи").toThrow("Workbench is disposed")
    expect(() => model.dispose(), "Повторное завершение безопасно").not.toThrow()
  })
})
