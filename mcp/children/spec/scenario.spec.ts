import {describe, expect, test} from "bun:test"
import {readMcpChildren} from "@mcp/children"

const entries = [
  {path: "shop/button", label: "Кнопка", description: "Команды пользователя в интерфейсе магазина.", parent: "shop"},
  {path: "shop/button/icons", label: "Значки", description: "Значки действий кнопки.", parent: "shop/button"},
]

describe.each([
  {name: "Проект", props: {path: "shop", label: "Магазин", description: "Интерфейс магазина и его компоненты.", entries}, expected: {path: "shop/button", label: "Кнопка", description: "Команды пользователя в интерфейсе магазина."}},
  {name: "Компонент", props: {path: "shop/button", label: "Кнопка", description: "Команды пользователя в интерфейсе магазина.", entries}, expected: {path: "shop/button/icons", description: "Значки действий кнопки."}},
])("$name", ({props, expected}) => {
  const result = readMcpChildren(props)
  test("Контекст и выбор следующего шага", () => {
    expect(result, "Назначение и путь сохраняются на каждом уровне; дополнительная подпись не повторяет описание").toEqual({
      path: props.path, label: props.label, description: props.description,
      children: [expected],
    })
    expect(result.children, "Раскрывается один непосредственный уровень, без содержимого соседних ветвей").toHaveLength(1)
  })
})
