import {describe, expect, test} from "bun:test"
import {basename, resolve} from "node:path"

describe.each([
  {name: "Сущность", props: {path: resolve(import.meta.dir, "..")}},
])("$name", ({props}) => {
  const result = basename(props.path)

  test("Имя директории", () => {
    expect(result, "Имя директории сущности, которой принадлежит сценарий").toBe("entity")
  })
})
