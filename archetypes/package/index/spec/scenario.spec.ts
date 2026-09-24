import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readPackageIndex} from "@archetypes/package/index"

describe.each([
  {name: "Публичный вход пакета", props: {path: resolve(import.meta.dir, "../.."), exports: {".": "./index.ts"}}},
])("$name", async ({props}) => {
  const result = await readPackageIndex(props)

  test("Файл и контракты", () => {
    expect(result.entries, "Точный вход связывает публичный путь с принадлежащим пакету кодом и контрактами").toEqual([{
      path: ".", target: "./index.ts", conditions: [], status: "owned", code: true, entrypoint: true,
      input: "./contract/input.ts", output: "./contract/output.ts",
    }])
    expect(result.unchecked, "Простая строковая цель проверяется полностью на уровне файлов").toEqual([])
  })
})
