/**
Обзор принадлежит исходнику и сохраняет происхождение прочитанного текста.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import readModuleDocumentation from "@archetypes/package-documentation"

describe.each([
  {name: "Модульный обзор", props: {source: "/** Описание пакета.\n@packageDocumentation\n*/\nexport {}", path: "index.ts"}, markdown: "Описание пакета."},
])("$name", ({props, markdown}) => {
  const result = readModuleDocumentation(props)
  test("Содержание", () => {
    expect(result?.markdown, "Обзор извлечён из TSDoc исходника").toBe(markdown)
  })
  test("Происхождение", () => {
    expect(result?.sourcePath, "Документ сохраняет владельца своего текста").toBe(props.path)
    expect(result?.sourceDigest, "Изменение исходника различается digest").toMatch(/^[a-f0-9]{64}$/u)
  })
})
