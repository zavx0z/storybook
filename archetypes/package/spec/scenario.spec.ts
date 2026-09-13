import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"
import {readPackage} from "@storybook/archetypes/package"

const packagePath = (path: string) => resolve(import.meta.dir, "../..", path)
const inputPath = process.env.PACKAGE_PATH

describe.each([
  {
    name: "Корневой пакет",
    fail: "Корневой пакет должен непосредственно принадлежать репозиторию",
    props: {
      path: inputPath ?? packagePath("."),
    },
  },
  {
    name: "Вложенный пакет",
    fail: "Вложенный пакет должен непосредственно принадлежать содержащему его пакету",
    props: {
      path: inputPath ?? packagePath("specs"),
    },
  },
])("$name", async ({props}) => {
  const result = await readPackage(props)

  test("Возвращает результат чтения пакета", () => {
    expect(result, "readPackage должна возвращать результат чтения пакета").toBeDefined()
  })
})
