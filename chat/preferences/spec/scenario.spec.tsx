import {afterAll, describe, expect, mock, test} from "bun:test"
import {createHeadless} from "@zavx0z/immersive-headless"
import {Event, type HTMLSelectElement} from "@zavx0z/immersive-dom"
import Preferences, {type StorybookChatPreferences} from "@zavx0z/storybook-chat-preferences"

describe.each([
  {name: "Наследование типа", props: {
    selection: {model: "fast"}, effective: {connectionId: "codex", model: "fast", thoughtLevel: "high"},
    sources: {connectionId: "general", model: "session", thoughtLevel: "type"},
    connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}],
    settings: [{id: "model", category: "model", name: "Model", value: "fast", options: [{value: "fast", name: "Fast"}]}],
    onChange: mock((value: unknown) => {}),
  } satisfies StorybookChatPreferences.Input},
  {name: "Варианты ещё не загружены", props: {
    selection: {model: "saved-model"}, effective: {connectionId: "codex", model: "saved-model"},
    sources: {connectionId: "general", model: "session"},
    connections: [{id: "codex", provider: "codex", label: "Codex", enabled: true}],
    settings: [], onChange: mock((value: unknown) => {}),
  } satisfies StorybookChatPreferences.Input},
])("$name", async ({props}) => {
  const headless = createHeadless({width: 400, height: 400})
  afterAll(() => headless.dispose())
  const element = await headless.render(<Preferences {...props} />)
  test("Выбор провайдера", () => {
    expect(element.querySelectorAll("select").length,
      "Провайдер остаётся видимым при одном подключении вместе с моделью, мышлением и подтверждениями").toBe(4)
  })
  test("Сохранённый выбор", () => {
    const select = element.querySelectorAll("select")[1] as HTMLSelectElement
    expect(select.value, "Явная модель остаётся видимой независимо от загрузки вариантов").toBe(props.selection.model)
  })
  test("Источники значений", () => {
    expect(element.textContent, "Человек видит уровень, задающий выбранную модель").toContain("Эта беседа")
  })
  test("Смена провайдера", () => {
    const select = element.querySelectorAll("select")[0] as HTMLSelectElement
    select.value = "codex"
    select.dispatchEvent(new Event("change", {bubbles: true}))
    expect(props.onChange.mock.calls,
      "Смена провайдера удаляет зависимые параметры прежнего исполнителя").toEqual([[{connectionId: "codex"}]])
    props.onChange.mockClear()
  })
  test("Возврат наследования", () => {
    const select = element.querySelectorAll("select")[1] as HTMLSelectElement
    select.value = ""
    select.dispatchEvent(new Event("change", {bubbles: true}))
    expect(props.onChange.mock.calls, "Наследование удаляет модель из override, а не копирует текущее значение").toEqual([[{}]])
  })
})
