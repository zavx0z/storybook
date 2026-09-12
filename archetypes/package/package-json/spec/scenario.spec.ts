import {describe, expect, test} from "bun:test"
import {resolve} from "node:path"

const packageJsonPath = (path: string) => resolve(import.meta.dir, "../..", path)
const inputPath = process.env.PACKAGE_JSON_PATH

describe.each([
  {
    name: "package.json",
    fail: "Содержимое package.json должно соответствовать контракту пакета",
    props: {
      path: inputPath ?? packageJsonPath("package.json"),
    },
  },
])("$name", ({props}) => {
  describe.each([
    {
      runtime: async () => {
        const {readPackageJson} = await import("@archetypes/package/package-json")
        return readPackageJson(props)
      },
    },
  ])("Чтение package.json", async ({runtime}) => {
    const result = await runtime()

    const fields = [
      {field: "name"},
      {field: "label"},
      {field: "description"},
      {field: "exports"},
    ]

    test.each(fields)("Содержит обязательное поле $field", ({field}) => {
      expect(result, `В package.json должно присутствовать поле ${field}`).toHaveProperty(field)
    })

    test("Не содержит других полей", () => {
      const extraFields = Object.keys(result ?? {}).filter(key => !fields.some(({field}) => field === key))
      expect(extraFields, "В package.json не должно быть полей вне проверяемого состава").toEqual([])
    })
  })
})
