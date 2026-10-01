import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import readPackageIndex from "@archetypes/package-index"

describe.each([
  {name: "Публичный вход пакета", props: {path: resolve(import.meta.dir, "../.."), exports: {".": "./index.ts"}}},
])("$name", async ({props}) => {
  const result = await readPackageIndex(props)

  test("Файл входа", () => {
    expect(result.entries.map(({input: _input, output: _output, ...entry}) => entry),
      "Точный вход связывает публичный путь с принадлежащим пакету кодом; типовые роли проверяет Contracts").toEqual([{
      path: ".", target: "./index.ts", conditions: [], status: "owned", code: true, entrypoint: true,
    }])
    expect(result.unchecked, "Простая строковая цель проверяется полностью на уровне файлов").toEqual([])
  })
})
