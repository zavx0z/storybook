import {describe, expect, test} from "bun:test"
import {resolveMcpAddress} from "@mcp/address"

const paths = ["storybook", "storybook/archetypes/package", "library.v2"]

describe.each([
  "storybook/archetypes/package?view=scenarios", "storybook/archetypes/package?inspector=x",
  "storybook/archetypes/package#contract", "storybook/archetypes/package/src",
  "storybook/archetypes/package/readme", "storybook.archetypes.package",
  "/storybook", "storybook/", "storybook//package", "storybook/../package", "",
])("Недопустимый адрес %s", address => {
  test("Не подменяется адресом родителя", () => {
    expect(() => resolveMcpAddress({address, paths}), "Параметры, внутренние пути и альтернативная адресация не принимаются").toThrow()
  })
})
