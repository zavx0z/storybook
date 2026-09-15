import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readPackage} from "@archetypes/package"

const packagePath = (path: string) => resolve(import.meta.dir, "../..", path)
const inputPath = process.env.PACKAGE_PATH

describe.each([
  {
    name: "Корневой пакет",
    props: {
      path: inputPath ?? packagePath("."),
    },
  },
  {
    name: "Вложенный пакет",
    props: {
      path: inputPath ?? packagePath("specs"),
    },
  },
])("$name", async ({props}) => {
  const result = await readPackage(props)

  test("Данные пакета", () => {
    expect(result, "Содержимое package.json выбранного пакета").toBeDefined()
  })
})
