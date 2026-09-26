import {describe, expect, test} from "bun:test"
import {resolveMcpAddress} from "@mcp/address"

const paths = ["storybook", "storybook/archetypes/package", "storybook/archetypes/package/documentation", "library.v2"]

describe.each([
  {name: "Корневой пакет", props: {address: "storybook", paths}},
  {name: "Вложенный пакет", props: {address: "storybook/archetypes/package", paths}},
  {name: "Функция пакета", props: {address: "storybook/archetypes/package/documentation", paths}},
  {name: "Точка в имени", props: {address: "library.v2", paths}},
])("$name", ({props}) => {
  const result = resolveMcpAddress(props)
  test("Адрес совпадает с выбранным направлением", () => {
    expect(result, "Используется точный адрес общего каталога; точки внутри имени сохраняются").toBe(props.address)
  })
})
