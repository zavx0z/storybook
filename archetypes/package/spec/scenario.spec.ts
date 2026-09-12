import {describe, test} from "bun:test"
import {resolve} from "node:path"

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
])("$name", ({props}) => {
  test.each([
    {
      runtime: async () => {
        const {readPackage} = await import("@storybook/archetypes/package")
        return readPackage(props)
      },
    },
  ])("Структура пакета", async ({runtime}) => {
    await runtime()
  })
})
