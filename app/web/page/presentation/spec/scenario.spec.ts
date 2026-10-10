import {afterAll, describe, expect, test} from "bun:test"
import {createDocument, type HTMLButtonElement} from "@zavx0z/immersive"
import type {DOMComponentConstructor} from "@zavx0z/immersive"
import createPresentation from "@zavx0z/storybook-app-web-page-presentation"
import {PresentationExample, FragmentPresentation, type ExampleProps} from "./fixture/view"

describe.each([
  {name: "Первое представление", template: PresentationExample, props: {label: "Первое"}},
  {name: "Другое представление", template: PresentationExample, props: {label: "Другое"}},
  {name: "Фрагмент", template: FragmentPresentation, props: {label: "Рядом"}},
])("$name", ({name, template, props}) => {
  const document = createDocument()
  const firstHost = document.createElement("section")
  const secondHost = document.createElement("section")
  const hostRoot = document.createElement("main")
  document.append(hostRoot)
  hostRoot.append(firstHost, secondHost)
  const view = createPresentation(document, template as unknown as DOMComponentConstructor<ExampleProps>, props, "[data-presentation-example]")
  afterAll(() => view.dispose())

  test("Отделённый корень", () => {
    expect(view.element.ownerDocument, "Представление использует исходный semantic Document").toBe(document)
    expect(view.node.parentNode, "Factory отделяет весь результат от staging").toBeNull()
    expect(view.element.textContent, "Шаблон получает данные выбранного варианта").toBe(props.label + ":0")
  })

  test("Same-Document reparent сохраняет state и listeners", () => {
    const element = view.element
    const button = element.querySelector("button") as HTMLButtonElement
    firstHost.append(view.node)
    button.click()
    view.componentRoot.flush()
    expect(button.textContent, "Listener обновляет собственное состояние шаблона").toBe(props.label + ":1")
    secondHost.append(view.node)
    expect(firstHost.childNodes.length, "Перенос не оставляет границы или содержимое в прежнем месте").toBe(0)
    button.click()
    view.componentRoot.flush()
    expect(view.element, "Перенос сохраняет корневой Element").toBe(element)
    expect(element.ownerDocument, "Перенос остаётся внутри того же Document").toBe(document)
    expect(element.querySelector("button"), "Listener остаётся у того же дочернего узла").toBe(button)
    expect(button.textContent, "После переноса сохраняются состояние и обработчик").toBe(props.label + ":2")
    expect(secondHost.querySelector("[data-presentation-sibling]")?.textContent ?? null,
      "Сосед фрагмента переносится и читает то же состояние, у одиночного элемента соседа нет").toBe(name === "Фрагмент" ? props.label + ":2" : null)
  })

  test("Завершение", () => {
    view.dispose()
    expect(secondHost.contains(view.element), "Dispose удаляет Element из текущего принимающего узла").toBeFalse()
    expect(view.node.parentNode, "После завершения полный результат отделён").toBeNull()
    expect(() => view.dispose(), "Повторный dispose безопасен").not.toThrow()
  })
})
