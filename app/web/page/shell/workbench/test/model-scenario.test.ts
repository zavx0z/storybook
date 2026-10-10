import {afterAll, describe, expect, test} from "bun:test"
import type {StorybookAppWebPageShellWorkbench} from "@zavx0z/storybook-app-web-page-shell-workbench"
import type {CompiledTemplate} from "@zavx0z/immersive/XReact/compiled"
import {WorkbenchFrame} from "../spec/fixture/frame"
import {createFrameEnvironment} from "../spec/fixture/environment"

describe.each([
  {name: "Пустая область", props: {title: "Модель", "catalog.items": []}},
  {name: "Выбранный узел", props: {title: "Модель каталога", "catalog.items": [{id: "example", label: "Пример", route: "/example"}], "catalog.active": "example"}},
])("$name", ({props}) => {
  const frame = createFrameEnvironment()
  let ready: StorybookAppWebPageShellWorkbench.Output | undefined
  frame.component.render(WorkbenchFrame as unknown as CompiledTemplate<StorybookAppWebPageShellWorkbench.Input>, {
    initial: props,
    displayId: "model-display",
    hudId: "model-hud",
    onReady(value) { ready = value },
  })
  frame.component.flush()
  const firstSnapshot = ready!.getSnapshot()
  afterAll(() => {
    frame.component.unmount()
  })

  test("Исходный снимок", () => {
    expect(firstSnapshot.document, "Factory использует переданный semantic Document").toBe(frame.document)
    expect(firstSnapshot.state.title, "Снимок отражает начальные данные выбранного варианта").toBe(props.title)
    expect(firstSnapshot.state["catalog.items"].map(item => item.id), "Порядок каталога соответствует публичному входу").toEqual(props["catalog.items"].map(item => item.id))
    expect(ready!.getSnapshot(), "Чтение без изменения возвращает тот же снимок").toBe(firstSnapshot)
  })

  test("Привязка и подписка", () => {
    const handle = ready!
    const changes: string[] = []
    const unsubscribe = handle.subscribe(() => changes.push(handle.getSnapshot().state.title))
    try {
      expect(handle.document, "Bind возвращает управление узлами исходного Document").toBe(frame.document)
      expect(handle.element, "Bind использует уже смонтированный Workbench, сохраняя identity").toBe(ready!.element)
      handle.update("title", "Первое обновление")
      frame.component.flush()
      expect(changes, "Подписчик получает опубликованное изменение состояния").toEqual(["Первое обновление"])
      expect(handle.getSnapshot(), "Изменение публикует новый снимок").not.toBe(firstSnapshot)
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
    ready!.dispose()
    expect(node.parentNode, "Dispose удаляет принадлежащее модели содержимое").toBeNull()
    expect(frame.document.querySelectorAll("space"), "Модель не освобождает чужой Root или Space").toHaveLength(1)
    expect(() => ready!.update("title", "Позднее обновление"), "Завершённая модель отклоняет записи").toThrow("Workbench is disposed")
    expect(() => ready!.dispose(), "Повторное завершение безопасно").not.toThrow()
  })
})
