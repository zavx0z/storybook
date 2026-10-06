import {describe, expect, test} from "bun:test"
import access from "@zavx0z/storybook-package-resources-access"

describe.each([{name: "Ресурсы подключённого пакета", props: {}}])("$name", ({props}) => {
  const result = access(props)
  test("Документ", () => {
    expect(result.read({package: "@zavx0z/storybook", path: "package/src/architecture.md"}),
      "Читается настоящий документ владельца из состава поставки, без копирования в декларацию")
      .toStartWith("# Общие правила Package")
  })
  test("Исходник модуля", () => {
    expect(result.source({package: "@zavx0z/storybook-package-resources-access", export: "."}),
      "Публичный модуль разрешается через exports; чтение текста не выполняет функцию")
      .toContain("export default function access")
  })
})
