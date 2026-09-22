import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readPackage} from "@archetypes/package"

describe.each([
  {
    name: "Корневой пакет",
    props: {
      path: resolve(import.meta.dir, "../.."),
    },
  },
  {
    name: "Вложенный пакет",
    props: {
      path: resolve(import.meta.dir, "../../specs"),
    },
  },
])("$name", async ({props}) => {
  const result = await readPackage(props)

  test("Данные пакета", () => {
    expect(result, "Содержимое package.json выбранного пакета").toBeDefined()
  })
})
