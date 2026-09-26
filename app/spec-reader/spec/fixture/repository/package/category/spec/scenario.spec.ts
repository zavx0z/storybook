import {describe, expect, test} from "bun:test"
import {basename, resolve} from "node:path"

describe.each([
  {name: "Категория", props: {path: resolve(import.meta.dir, "..")}},
])("$name", ({props}) => {
  const result = basename(props.path)

  test("Имя директории", () => {
    expect(result, "Имя директории категории, которой принадлежит сценарий").toBe("category")
  })
})
