import {afterAll, describe, spyOn} from "bun:test"
import {resolve} from "node:path"
import * as packageModule from "@storybook/archetypes/package"

const readPackageSpy = spyOn(packageModule, "readPackage")

afterAll(() => {
  readPackageSpy.mockRestore()
})

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
  packageModule.readPackage(props)
})
