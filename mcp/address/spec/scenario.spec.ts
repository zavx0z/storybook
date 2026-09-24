import {describe, expect, test} from "bun:test"
import {resolveMcpAddress} from "@mcp/address"

const packages = ["storybook", "storybook/archetypes/package", "library.v2"]

describe.each([
  {name: "Корневой пакет", props: {address: "storybook", packages}},
  {name: "Вложенный пакет", props: {address: "storybook/archetypes/package", packages}},
  {name: "Точка в имени", props: {address: "library.v2", packages}},
])("$name", ({props}) => {
  const result = resolveMcpAddress(props)
  test("Адрес заканчивается на пакете", () => {
    expect(result, "Используется точный пакетный адрес общего каталога; точки внутри имени сохраняются").toBe(props.address)
  })
})
