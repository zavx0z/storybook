import {describe, expect, test} from "bun:test"
import {basename, resolve} from "node:path"

describe.each([
  {name: "Пакет", props: {path: resolve(import.meta.dir, "..")}},
])("$name", ({props}) => {
  const result = basename(props.path)

  test("Имя директории", () => {
    expect(result, "Имя директории пакета, которому принадлежит сценарий").toBe("package")
  })
})
