/** Предметный JSON передаётся одновременно в structured и текстовом MCP ответе. */
import {describe, expect, test} from "bun:test"
import ResponseContent from "@zavx0z/storybook-app-mcp-response"

describe.each([
  {name: "Готовый результат", props: {value: {status: "active", revision: "r1"}}},
  {name: "Пустая коллекция", props: {value: {status: "ready", packages: [] as string[]}}},
])("$name", ({props}) => {
  const result = ResponseContent(props.value)

  test("Структурный результат", () => {
    expect(result.structuredContent, "Публичный результат сохраняет предметные поля JSON-объекта").toEqual(props.value)
  })
  test("Текстовое представление", () => {
    expect(result.content[0], "Текстовый блок несёт тот же очищенный JSON для MCP-клиента").toEqual({
      type: "text", text: JSON.stringify(result.structuredContent),
    })
  })
})
