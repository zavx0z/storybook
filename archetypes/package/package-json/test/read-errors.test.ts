/**
Проверяет передачу ошибок файлового чтения и разбора JSON вызывающему коду.
Использует отсутствующий файл, директорию и файл с некорректным JSON.
Проверки состава возвращаемых данных остаются в spec.

@packageDocumentation
*/
import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import type {ReadPackageJsonInput} from "@archetypes/package/package-json"

describe.each([
  {
    runtime: async (props: ReadPackageJsonInput) => {
      const {readPackageJson} = await import("@archetypes/package/package-json")
      return readPackageJson(props)
    },
  },
])("Ошибки чтения package.json", ({runtime}) => {
  test("Файл отсутствует", () => {
    const path = resolve(import.meta.dir, "fixture", "missing.json")
    expect(runtime({path}), "Отсутствующий файл должен приводить к ошибке чтения")
      .rejects.toMatchObject({code: "ENOENT"})
  })

  test("Вместо файла передана директория", () => {
    const path = resolve(import.meta.dir, "fixture")
    expect(runtime({path}), "Директория не должна приниматься вместо файла package.json")
      .rejects.toMatchObject({code: "EISDIR"})
  })

  test("Некорректный JSON", () => {
    const path = resolve(import.meta.dir, "fixture", "invalid.json")
    expect(runtime({path}), "Некорректный JSON должен приводить к ошибке разбора")
      .rejects.toMatchObject({name: "SyntaxError"})
  })
})
